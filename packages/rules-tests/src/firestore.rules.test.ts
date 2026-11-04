import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const RULES = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../firestore.rules"),
  "utf8",
);

let env: RulesTestEnvironment;

/** Today's date in Karachi (UTC+5) — staff may file expenses under it only. */
const KARACHI_TODAY = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() + 5 * 60 * 60 * 1000 - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function staffAuth() {
  return env.authenticatedContext("staff1").firestore();
}
function coworkerAuth() {
  return env.authenticatedContext("staff2").firestore();
}
function ownerAuth() {
  return env.authenticatedContext("owner1").firestore();
}

async function seedUsers() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/owner1"), {
      role: "owner",
      isActive: true,
      isPrimaryOwner: true,
      branchIds: ["main"],
    });
    await setDoc(doc(db, "users/owner2"), {
      role: "owner",
      isActive: true,
      isPrimaryOwner: false,
      branchIds: ["main"],
    });
    await setDoc(doc(db, "users/staff1"), {
      role: "counter",
      isActive: true,
      branchIds: ["main"],
      permissions: {
        canAddExpenses: true,
        canDeleteExpenses: true,
        canApplyDiscount: true,
        canEditOrders: true,
        canCancelOrders: true,
        canManageInventory: true,
      },
    });
    await setDoc(doc(db, "users/staff2"), {
      role: "counter",
      isActive: true,
      branchIds: ["main"],
    });
  });
}

function coOwnerAuth() {
  return env.authenticatedContext("owner2").firestore();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-bravobites",
    firestore: { rules: RULES, host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers();
});

describe("orders — same-branch staff can read all branch orders", () => {
  it("allows reading coworker and owner orders on the same branch", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/o-other"), {
        branchId: "main",
        createdBy: "staff2",
        orderNumber: 2,
        status: "completed",
        total: 500,
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(ctx.firestore(), "orders/o-owner"), {
        branchId: "main",
        createdBy: "owner1",
        orderNumber: 3,
        status: "completed",
        total: 800,
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(ctx.firestore(), "orders/o-other-branch"), {
        branchId: "other",
        createdBy: "owner1",
        orderNumber: 4,
        status: "completed",
        total: 900,
        createdAt: new Date().toISOString(),
      });
    });
    await assertSucceeds(getDoc(doc(staffAuth(), "orders/o-other")));
    await assertSucceeds(getDoc(doc(staffAuth(), "orders/o-owner")));
    await assertSucceeds(getDoc(doc(coworkerAuth(), "orders/o-other")));
    await assertSucceeds(getDoc(doc(ownerAuth(), "orders/o-other")));
    await assertFails(getDoc(doc(staffAuth(), "orders/o-other-branch")));
  });
});

describe("orders — WhatsApp review requests", () => {
  const send = (uid: string, count: number, id = `rev_${count}`) => ({
    reviewSentCount: count,
    reviewSentAtServer: serverTimestamp(),
    reviewSentBy: uid,
    reviewSentByName: uid,
    reviewSentByEmail: `${uid}@test.pk`,
    reviewLastSendId: id,
  });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      // A coworker's old order: staff2 has no edit permission and is outside the window.
      await setDoc(doc(ctx.firestore(), "orders/r1"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 7,
        status: "completed",
        total: 500,
        createdAt: "2026-01-01T10:00:00.000Z",
        createdAtServer: Timestamp.fromMillis(Date.parse("2026-01-01T10:00:00.000Z")),
      });
      await setDoc(doc(ctx.firestore(), "orders/r-cancelled"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 8,
        status: "cancelled",
        total: 500,
        createdAt: "2026-01-01T10:00:00.000Z",
      });
    });
  });

  it("anyone at the branch logs a send, again and again, one at a time in their own name", async () => {
    await assertSucceeds(updateDoc(doc(coworkerAuth(), "orders/r1"), send("staff2", 1)));
    await assertSucceeds(updateDoc(doc(staffAuth(), "orders/r1"), send("staff1", 2)));
    await assertFails(updateDoc(doc(coworkerAuth(), "orders/r1"), send("staff2", 4)));
    await assertFails(updateDoc(doc(coworkerAuth(), "orders/r1"), send("staff1", 3)));
    await assertFails(
      updateDoc(doc(coworkerAuth(), "orders/r1"), {
        ...send("staff2", 3),
        reviewSentAtServer: Timestamp.fromMillis(Date.now() - 60_000),
      }),
    );
  });

  it("one send id counts once; order edits never set the count", async () => {
    await assertSucceeds(updateDoc(doc(staffAuth(), "orders/r1"), send("staff1", 1, "rev_a")));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r1"), send("staff1", 2, "rev_a")));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r1"), { reviewSentCount: 9 }));
    await assertFails(
      updateDoc(doc(staffAuth(), "orders/r1"), { ...send("staff1", 2, "rev_b"), reviewSentByName: 5 }),
    );
  });

  it("works on a cancelled order too, but never carries other changes", async () => {
    await assertSucceeds(updateDoc(doc(coworkerAuth(), "orders/r-cancelled"), send("staff2", 1)));
    await assertFails(
      updateDoc(doc(coworkerAuth(), "orders/r1"), { ...send("staff2", 1), paymentMethod: "card" }),
    );
    await assertFails(
      updateDoc(doc(coworkerAuth(), "orders/r-cancelled"), { ...send("staff2", 2), status: "completed" }),
    );
  });
});

describe("orders — refunds and the staff edit window", () => {
  it("staff refund their own order in their name, with a log entry, up to the total", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const fresh = {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 8,
        status: "completed",
        paymentMethod: "cash",
        createdAt: "2026-10-09T10:00:00.000Z",
        createdAtServer: Timestamp.now(),
        total: 1000,
        items: [],
      };
      await setDoc(doc(db, "orders/r-ok"), fresh);
      await setDoc(doc(db, "orders/r-old"), {
        ...fresh,
        createdAtServer: Timestamp.fromMillis(Date.now() - 73 * 60 * 60 * 1000),
      });
      await setDoc(doc(db, "users/staff6"), {
        role: "counter",
        isActive: true,
        branchIds: ["main"],
        permissions: { canEditOrders: true, canCancelOrders: false },
      });
      await setDoc(doc(db, "orders/r-nocancel"), { ...fresh, createdBy: "staff6" });
    });
    const refund = (by: string, amount: number, entries = 1) => ({
      refundAmount: amount,
      refundReason: "Wrong item",
      refundedAt: "2026-10-09T11:00:00.000Z",
      refundedBy: by,
      refundedByName: "Staff",
      refundCount: 1,
      refunds: Array.from({ length: entries }, () => ({ amount, at: "2026-10-09T11:00:00.000Z" })),
    });
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-ok"), refund("staff1", 1200)));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-ok"), refund("owner1", 400)));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-ok"), refund("staff1", 400, 2)));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-ok"), { ...refund("staff1", 400), total: 0 }));
    await assertFails(updateDoc(doc(coworkerAuth(), "orders/r-ok"), refund("staff2", 400)));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-old"), refund("staff1", 400)));
    await assertFails(
      updateDoc(doc(env.authenticatedContext("staff6").firestore(), "orders/r-nocancel"), refund("staff6", 400)),
    );
    await assertSucceeds(updateDoc(doc(staffAuth(), "orders/r-ok"), refund("staff1", 400)));
  });

  it("staff refund log entry must be exactly the amount refunded now; earlier entries stay", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/r-log"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 9,
        status: "completed",
        paymentMethod: "cash",
        createdAt: "2026-10-09T10:00:00.000Z",
        createdAtServer: Timestamp.now(),
        total: 1000,
        items: [],
        refundAmount: 100,
        refundedBy: "staff1",
        refunds: [{ amount: 100, at: "2026-10-09T10:30:00.000Z" }],
      });
    });
    const base = { refundReason: "x", refundedBy: "staff1", refundedAt: "2026-10-09T11:00:00.000Z" };
    // Entry far bigger than the +50 refund → refused (it would empty the drawer).
    await assertFails(
      updateDoc(doc(staffAuth(), "orders/r-log"), {
        ...base,
        refundAmount: 150,
        refunds: [{ amount: 100, at: "2026-10-09T10:30:00.000Z" }, { amount: 50000, at: "2026-10-09T11:00:00.000Z" }],
      }),
    );
    // Rewriting the earlier entry → refused.
    await assertFails(
      updateDoc(doc(staffAuth(), "orders/r-log"), {
        ...base,
        refundAmount: 150,
        refunds: [{ amount: 1, at: "2026-10-01T10:30:00.000Z" }, { amount: 50, at: "2026-10-09T11:00:00.000Z" }],
      }),
    );
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "orders/r-log"), {
        ...base,
        refundAmount: 150,
        refunds: [{ amount: 100, at: "2026-10-09T10:30:00.000Z" }, { amount: 50, at: "2026-10-09T11:00:00.000Z" }],
      }),
    );
    // A refunded order is locked for staff edits, and nobody takes the total below the refunds.
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-log"), { paymentMethod: "card", updatedBy: "staff1" }));
    await assertFails(updateDoc(doc(staffAuth(), "orders/r-log"), { total: 0, items: [], updatedBy: "staff1" }));
    await assertFails(updateDoc(doc(ownerAuth(), "orders/r-log"), { total: 100, items: [] }));
    // Cancelling a partly refunded order stays allowed.
    await assertSucceeds(updateDoc(doc(staffAuth(), "orders/r-log"), { status: "cancelled", updatedBy: "staff1" }));
  });

  it("denies a staff refund without a log entry or name", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/o1"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 1,
        status: "completed",
        paymentMethod: "cash",
        createdAt: "2026-09-27T10:00:00.000Z",
        createdAtServer: Timestamp.now(),
        total: 1000,
        items: [],
      });
    });
    await assertFails(
      updateDoc(doc(staffAuth(), "orders/o1"), { refundAmount: 1000 }),
    );
    await assertFails(
      updateDoc(doc(staffAuth(), "orders/o1"), {
        refunds: [{ amount: 1000, at: "2026-09-27T11:00:00.000Z" }],
      }),
    );
    await assertSucceeds(
      updateDoc(doc(ownerAuth(), "orders/o1"), { refundAmount: 1000 }),
    );
  });

  it("allows staff to edit their own order inside the window", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/fresh"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 4,
        status: "completed",
        paymentMethod: "cash",
        createdAt: "2026-09-27T10:00:00.000Z",
        createdAtServer: Timestamp.now(),
        total: 400,
        items: [{ productId: "p", qty: 1 }],
      });
    });
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "orders/fresh"), {
        items: [{ productId: "p", qty: 2 }],
        total: 800,
      }),
    );
  });

  it("allows a late-synced staff edit (offline) within the 72h server limit", async () => {
    // e.g. a whole-day internet outage, then the PC off overnight: the sale
    // reached the cloud before it, the cancel made offline syncs 30h later
    const synced = Timestamp.fromMillis(Date.now() - 30 * 60 * 60 * 1000);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/late"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 5,
        status: "completed",
        paymentMethod: "cash",
        createdAt: "2026-09-27T08:00:00.000Z",
        // Offline POS order: sale time kept in createdAt, cloud arrival here.
        syncedAtServer: synced,
        total: 400,
        items: [{ productId: "p", qty: 1 }],
      });
    });
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "orders/late"), { status: "cancelled" }),
    );
  });

  it("denies staff edit after the 72h server limit", async () => {
    const old = Timestamp.fromMillis(Date.now() - 73 * 60 * 60 * 1000);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/old"), {
        branchId: "main",
        createdBy: "staff1",
        orderNumber: 3,
        status: "completed",
        paymentMethod: "cash",
        createdAt: "2026-09-27T08:00:00.000Z",
        createdAtServer: old,
        total: 400,
        items: [{ productId: "p", qty: 1 }],
      });
    });
    await assertFails(
      updateDoc(doc(staffAuth(), "orders/old"), {
        items: [{ productId: "p", qty: 2 }],
        total: 800,
      }),
    );
  });
});

describe("offline sync — staff existence checks on not-yet-created docs", () => {
  it("lets staff read a missing order / expense / stock movement (sync idempotency check)", async () => {
    await assertSucceeds(getDoc(doc(staffAuth(), "orders/not-there-yet")));
    await assertSucceeds(getDoc(doc(staffAuth(), "expenses/not-there-yet")));
    await assertSucceeds(getDoc(doc(staffAuth(), "stockMovements/not-there-yet")));
  });

  it("keeps list queries branch-scoped for staff", async () => {
    for (const col of ["orders", "expenses", "stockMovements"]) {
      await assertSucceeds(getDocs(query(collection(staffAuth(), col), where("branchId", "==", "main"))));
      await assertFails(getDocs(query(collection(staffAuth(), col), where("branchId", "==", "other"))));
      await assertFails(getDocs(collection(staffAuth(), col)));
    }
  });

  it("still denies staff reading another branch's existing docs", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "orders/other-b"), { branchId: "other", createdBy: "x", status: "completed" });
      await setDoc(doc(db, "expenses/other-b"), { branchId: "other", createdBy: "x", amount: 1 });
      await setDoc(doc(db, "stockMovements/other-b"), { branchId: "other", createdBy: "x" });
    });
    await assertFails(getDoc(doc(staffAuth(), "orders/other-b")));
    await assertFails(getDoc(doc(staffAuth(), "expenses/other-b")));
    await assertFails(getDoc(doc(staffAuth(), "stockMovements/other-b")));
  });
});

describe("owner report — staff look at it read-only", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const log = (createdBy: string, branchId = "main") => ({
        branchId,
        entityType: "order",
        entityId: "o1",
        action: "cancel",
        summary: "Cancelled order #1",
        createdBy,
        createdByName: createdBy,
        createdAt: "2026-10-04T10:00:00.000Z",
      });
      await setDoc(doc(db, "activityLogs/by-coworker"), log("staff2"));
      await setDoc(doc(db, "activityLogs/by-owner"), log("owner1"));
      await setDoc(doc(db, "activityLogs/other-branch"), log("x", "other"));
    });
  });

  it("staff read everyone's change log in their branch (the report's range query)", async () => {
    const range = (branchId: string) =>
      query(
        collection(staffAuth(), "activityLogs"),
        where("entityType", "==", "order"),
        where("branchId", "==", branchId),
        where("createdAt", ">=", "2026-10-04T00:00:00.000Z"),
        where("createdAt", "<=", "2026-10-04T23:59:59.999Z"),
        orderBy("createdAt", "desc"),
        limit(2000),
      );
    await assertSucceeds(getDocs(range("main")));
    await assertSucceeds(getDoc(doc(staffAuth(), "activityLogs/by-coworker")));
    await assertSucceeds(getDoc(doc(staffAuth(), "activityLogs/by-owner")));
    await assertFails(getDocs(range("other")));
    await assertFails(getDoc(doc(staffAuth(), "activityLogs/other-branch")));
  });

  it("staff read owners' profiles (who the owners are), never a coworker's", async () => {
    await assertSucceeds(getDocs(query(collection(staffAuth(), "users"), where("role", "==", "owner"))));
    await assertSucceeds(getDoc(doc(staffAuth(), "users/owner1")));
    await assertSucceeds(getDoc(doc(staffAuth(), "users/staff1")));
    await assertFails(getDoc(doc(staffAuth(), "users/staff2")));
    await assertFails(getDocs(collection(staffAuth(), "users")));
    await assertFails(updateDoc(doc(staffAuth(), "users/owner1"), { displayName: "x" }));
  });

  it("a disabled staff account reads neither", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "users/staff2"), { isActive: false });
    });
    await assertFails(getDoc(doc(coworkerAuth(), "users/owner1")));
    await assertFails(getDoc(doc(coworkerAuth(), "activityLogs/by-owner")));
  });
});

describe("offline sync — each person's work under their own login", () => {
  const order = (createdBy: string, extra: Record<string, unknown> = {}) => ({
    branchId: "main",
    createdBy,
    orderNumber: 77,
    status: "completed",
    paymentMethod: "cash",
    createdAt: "2026-10-04T10:00:00.000Z",
    total: 100,
    items: [],
    syncedAtServer: serverTimestamp(),
    ...extra,
  });
  const expense = (createdBy: string) => ({
    branchId: "main",
    category: "supplies",
    description: "Gas",
    amount: 50,
    date: KARACHI_TODAY,
    createdBy,
    createdAt: "2026-10-04T10:00:00.000Z",
    syncedAtServer: serverTimestamp(),
  });
  // The app stamps who uploaded someone else's work.
  const stampBy = (uid: string) => ({
    uploadedBy: uid,
    uploadedByName: "Uploader",
    uploadedAt: serverTimestamp(),
  });
  const log = (createdBy: string, extra: Record<string, unknown> = {}) => ({
    branchId: "main",
    entityType: "order",
    entityId: "o1",
    action: "cancel",
    summary: "Cancelled order #1",
    createdBy,
    createdByName: "Staff One",
    createdAt: "2026-10-04T10:00:00.000Z",
    ...extra,
  });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const saved = { ...order("staff1"), syncedAtServer: Timestamp.now() };
      await setDoc(doc(db, "orders/staff-sale"), saved);
      await setDoc(doc(db, "orders/staff-sale2"), saved);
      await setDoc(doc(db, "orders/owner-sale"), { ...saved, createdBy: "owner1" });
      await setDoc(doc(db, "expenses/staff-exp"), expense("staff1"));
      await setDoc(doc(db, "expenses/staff-exp2"), expense("staff1"));
      await setDoc(doc(db, "expenses/owner-exp"), expense("owner1"));
    });
  });

  it("an owner uploads a staff member's offline work under the staff's name", async () => {
    await assertSucceeds(setDoc(doc(ownerAuth(), "orders/stuck-1"), { ...order("staff1"), ...stampBy("owner1") }));
    await assertSucceeds(setDoc(doc(ownerAuth(), "expenses/stuck-1"), { ...expense("staff1"), ...stampBy("owner1") }));
    await assertSucceeds(
      updateDoc(doc(ownerAuth(), "orders/staff-sale"), { status: "cancelled", updatedBy: "staff1", ...stampBy("owner1") }),
    );
    await assertSucceeds(setDoc(doc(ownerAuth(), "activityLogs/act_owner_for_staff"), log("staff1", { syncedBy: "owner1" })));
    // Stamp-then-delete of the staff member's expense.
    await assertSucceeds(
      updateDoc(doc(ownerAuth(), "expenses/staff-exp"), { deleteRequestedBy: "staff1", ...stampBy("owner1") }),
    );
    await assertSucceeds(deleteDoc(doc(ownerAuth(), "expenses/staff-exp")));
  });

  it("anyone signed in uploads a coworker's or the owner's saved work, stamped, under the maker's name", async () => {
    await assertSucceeds(setDoc(doc(coworkerAuth(), "orders/as-coworker"), { ...order("staff1"), ...stampBy("staff2") }));
    await assertSucceeds(setDoc(doc(coworkerAuth(), "expenses/as-coworker"), { ...expense("staff1"), ...stampBy("staff2") }));
    await assertSucceeds(
      updateDoc(doc(coworkerAuth(), "orders/staff-sale"), { status: "cancelled", updatedBy: "staff1", ...stampBy("staff2") }),
    );
    await assertSucceeds(
      updateDoc(doc(coworkerAuth(), "expenses/staff-exp2"), { amount: 1, updatedBy: "staff1", ...stampBy("staff2") }),
    );
    // Saved delete: stamp, then delete — only by that uploader.
    await assertSucceeds(
      updateDoc(doc(coworkerAuth(), "expenses/staff-exp"), { deleteRequestedBy: "staff1", ...stampBy("staff2") }),
    );
    await assertSucceeds(deleteDoc(doc(coworkerAuth(), "expenses/staff-exp")));
    await assertSucceeds(setDoc(doc(coworkerAuth(), "activityLogs/act_synced"), log("staff1", { syncedBy: "staff2" })));
    // The owner's saved sale, too.
    await assertSucceeds(setDoc(doc(coworkerAuth(), "orders/as-owner"), { ...order("owner1"), ...stampBy("staff2") }));
  });

  it("never without the uploader's own stamp, never someone else's stamp, never an order delete", async () => {
    await assertFails(setDoc(doc(coworkerAuth(), "orders/unstamped"), order("staff1")));
    await assertFails(setDoc(doc(coworkerAuth(), "orders/wrong-stamp"), { ...order("staff1"), ...stampBy("owner1") }));
    await assertFails(
      updateDoc(doc(coworkerAuth(), "orders/staff-sale2"), { paymentMethod: "card", updatedBy: "staff1" }),
    );
    await assertFails(setDoc(doc(coworkerAuth(), "activityLogs/act_forged"), log("staff1")));
    await assertFails(deleteDoc(doc(coworkerAuth(), "orders/staff-sale2")));
    // Deleting a stamped row the uploader didn't stamp.
    await assertFails(deleteDoc(doc(coworkerAuth(), "expenses/staff-exp2")));
  });

  it("staff change their own order only in their own name", async () => {
    await assertFails(updateDoc(doc(staffAuth(), "orders/staff-sale"), { paymentMethod: "card", updatedBy: "owner1" }));
    await assertSucceeds(updateDoc(doc(staffAuth(), "orders/staff-sale"), { paymentMethod: "card", updatedBy: "staff1" }));
  });
});

describe("orders — server stamps and amounts can't be faked", () => {
  const own = (extra: Record<string, unknown> = {}) => ({
    branchId: "main",
    createdBy: "staff1",
    orderNumber: 91,
    status: "completed",
    paymentMethod: "cash",
    createdAt: "2026-10-04T10:00:00.000Z",
    subtotal: 100,
    total: 100,
    items: [{ productId: "p", qty: 1 }],
    ...extra,
  });

  it("a new order carries a cloud stamp and no refund", async () => {
    await assertFails(setDoc(doc(staffAuth(), "orders/no-stamp"), own()));
    await assertFails(setDoc(doc(ownerAuth(), "orders/no-stamp-owner"), own()));
    const preRefunded = own({
      syncedAtServer: serverTimestamp(),
      refundAmount: 100,
      refundedAt: "2026-10-04T11:00:00.000Z",
      refunds: [{ amount: 100, at: "2026-10-04T11:00:00.000Z" }],
    });
    await assertFails(setDoc(doc(staffAuth(), "orders/pre-refunded"), preRefunded));
    await assertFails(setDoc(doc(ownerAuth(), "orders/pre-refunded-owner"), preRefunded));
  });

  it("cloud-arrival stamp must be this write's server time", async () => {
    await assertSucceeds(setDoc(doc(staffAuth(), "orders/s-ok"), own({ createdAtServer: serverTimestamp() })));
    await assertSucceeds(setDoc(doc(staffAuth(), "orders/s-ok2"), own({ syncedAtServer: serverTimestamp() })));
    const future = Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await assertFails(setDoc(doc(staffAuth(), "orders/s-future"), own({ createdAtServer: future })));
    await assertFails(setDoc(doc(staffAuth(), "orders/s-future2"), own({ syncedAtServer: future })));
  });

  it("nobody moves the stamp later (it anchors the staff window)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/s-stamped"), own({ createdAtServer: Timestamp.now() }));
    });
    const future = Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await assertFails(updateDoc(doc(staffAuth(), "orders/s-stamped"), { createdAtServer: future }));
    await assertFails(updateDoc(doc(staffAuth(), "orders/s-stamped"), { syncedAtServer: future }));
    await assertFails(updateDoc(doc(ownerAuth(), "orders/s-stamped"), { createdAtServer: future }));
    await assertSucceeds(updateDoc(doc(staffAuth(), "orders/s-stamped"), { paymentMethod: "card" }));
  });

  it("money fields must be non-negative numbers", async () => {
    const stamped = (extra: Record<string, unknown>) => own({ syncedAtServer: serverTimestamp(), ...extra });
    await assertFails(setDoc(doc(staffAuth(), "orders/neg"), stamped({ total: -100 })));
    await assertFails(setDoc(doc(ownerAuth(), "orders/str"), stamped({ total: "100" })));
    await assertFails(setDoc(doc(staffAuth(), "orders/neg-disc"), stamped({ discountAmount: -5 })));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/amend"), own({ createdAtServer: Timestamp.now() }));
    });
    await assertFails(updateDoc(doc(staffAuth(), "orders/amend"), { total: -1 }));
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "orders/amend"), { items: [{ productId: "p", qty: 2 }], subtotal: 200, total: 200 }),
    );
  });
});

describe("users — only the main owner makes owners", () => {
  it("nobody rewrites when an account was created (it picks the main owner)", async () => {
    await assertFails(updateDoc(doc(coOwnerAuth(), "users/owner2"), { createdAt: "2020-01-01T00:00:00.000Z" }));
  });

  it("co-owner can't promote staff; main owner can; co-owner still edits staff", async () => {
    await assertFails(updateDoc(doc(coOwnerAuth(), "users/staff2"), { role: "owner" }));
    await assertSucceeds(updateDoc(doc(coOwnerAuth(), "users/staff2"), { branchIds: ["main", "other"] }));
    await assertSucceeds(updateDoc(doc(ownerAuth(), "users/staff2"), { role: "owner" }));
  });
});

describe("cash drawers — opened and closed in your own name", () => {
  const drawer = (openedBy: string) => ({
    branchId: "main",
    date: "2026-10-04",
    openingBalance: 1000,
    closingCount: null,
    expectedCash: null,
    difference: null,
    status: "open",
    openedBy,
    openedAt: "2026-10-04T07:00:00.000Z",
  });

  it("staff open a drawer only as themselves", async () => {
    await assertFails(setDoc(doc(staffAuth(), "cashDrawers/d-forged"), drawer("staff2")));
    await assertSucceeds(setDoc(doc(staffAuth(), "cashDrawers/d-own"), drawer("staff1")));
  });

  it("staff close as themselves or as the day-end auto close", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "cashDrawers/d1"), drawer("staff1"));
      await setDoc(doc(db, "cashDrawers/d2"), drawer("staff1"));
      await setDoc(doc(db, "cashDrawers/d3"), drawer("staff1"));
    });
    const close = (closedBy: string, extra: Record<string, unknown> = {}) => ({
      status: "closed",
      closingCount: 1000,
      expectedCash: 1000,
      difference: 0,
      closedBy,
      closedAt: "2026-10-04T22:00:00.000Z",
      ...extra,
    });
    await assertFails(updateDoc(doc(coworkerAuth(), "cashDrawers/d1"), close("staff1")));
    await assertFails(updateDoc(doc(coworkerAuth(), "cashDrawers/d1"), close("system")));
    await assertSucceeds(updateDoc(doc(coworkerAuth(), "cashDrawers/d1"), close("staff2")));
    await assertSucceeds(
      updateDoc(doc(coworkerAuth(), "cashDrawers/d2"), close("system", { autoClosed: true, closingCount: null, difference: null })),
    );
    await assertSucceeds(updateDoc(doc(ownerAuth(), "cashDrawers/d3"), close("owner1")));
  });

  it("staff can't fake an auto close or change an open drawer", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "cashDrawers/d4"), drawer("staff1"));
    });
    await assertFails(
      updateDoc(doc(coworkerAuth(), "cashDrawers/d4"), {
        status: "closed",
        closedBy: "system",
        autoClosed: true,
        closingCount: 1000,
        expectedCash: 1000,
        difference: 0,
      }),
    );
    await assertFails(updateDoc(doc(coworkerAuth(), "cashDrawers/d4"), { date: "2026-10-05" }));
    await assertFails(
      updateDoc(doc(coworkerAuth(), "cashDrawers/d4"), {
        status: "closed",
        closedBy: "staff2",
        closingCount: 900,
        expectedCash: 900,
        difference: 0,
        openedAt: "2026-10-04T20:00:00.000Z",
      }),
    );
  });
});

describe("counters", () => {
  it("denies rewinding the order number", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "counters/global"), {
        lastOrderNumber: 10,
      });
    });
    await assertFails(
      setDoc(doc(staffAuth(), "counters/global"), { lastOrderNumber: 1 }),
    );
    await assertSucceeds(
      setDoc(doc(staffAuth(), "counters/global"), { lastOrderNumber: 11 }),
    );
  });
});

describe("inventory — staff with manage permission", () => {
  it("allows staff catalog create/edit, purchase/waste/adjust; denies delete", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "inventory/inv1"), {
        branchId: "main",
        productId: "p1",
        productName: "Chicken",
        currentStock: 10,
        lowStockThreshold: 2,
        unit: "kg",
      });
    });

    await assertSucceeds(
      setDoc(doc(staffAuth(), "stockMovements/m-buy"), {
        branchId: "main",
        inventoryItemId: "inv1",
        productId: "p1",
        productName: "Chicken",
        movementType: "purchase",
        quantity: 5,
        previousStock: 10,
        newStock: 15,
        createdBy: "staff1",
        createdAt: new Date().toISOString(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(staffAuth(), "stockMovements/m-restock"), {
        branchId: "main",
        inventoryItemId: "inv1",
        productId: "p1",
        productName: "Chicken",
        movementType: "restock",
        quantity: 2,
        previousStock: 8,
        newStock: 10,
        createdBy: "staff1",
        createdAt: new Date().toISOString(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(staffAuth(), "stockMovements/m-waste"), {
        branchId: "main",
        inventoryItemId: "inv1",
        productId: "p1",
        productName: "Chicken",
        movementType: "waste",
        quantity: 2,
        previousStock: 10,
        newStock: 8,
        createdBy: "staff1",
        createdAt: new Date().toISOString(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(staffAuth(), "inventory/inv-new"), {
        branchId: "main",
        productId: "p2",
        productName: "Rice",
        currentStock: 1,
        lowStockThreshold: 1,
        unit: "kg",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "inventory/inv1"), {
        currentStock: 15,
        lastUpdated: new Date().toISOString(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "inventory/inv1"), {
        lowStockThreshold: 99,
      }),
    );
    await assertSucceeds(deleteDoc(doc(staffAuth(), "inventory/inv1")));
  });

  it("staff delete stock rows only in their branch, and only with the inventory permission", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const row = { productId: "p1", productName: "Soft Drink", currentStock: 3, lowStockThreshold: 1, unit: "bottle" };
      await setDoc(doc(db, "inventory/inv-main"), { ...row, branchId: "main" });
      await setDoc(doc(db, "inventory/inv-other"), { ...row, branchId: "other" });
      await setDoc(doc(db, "users/staff3"), {
        role: "counter",
        isActive: true,
        branchIds: ["main"],
        permissions: { canManageInventory: false },
      });
    });
    const noPerm = env.authenticatedContext("staff3").firestore();
    await assertFails(deleteDoc(doc(noPerm, "inventory/inv-main")));
    await assertFails(deleteDoc(doc(staffAuth(), "inventory/inv-other")));
    await assertSucceeds(deleteDoc(doc(staffAuth(), "inventory/inv-main")));
  });
});

describe("expenses — staff add and edit", () => {
  it("amount must be a non-negative number", async () => {
    const base = {
      branchId: "main",
      category: "supplies",
      description: "Gas",
      date: KARACHI_TODAY,
      createdBy: "staff1",
      createdAt: new Date().toISOString(),
    };
    const stamped = { ...base, createdAtServer: serverTimestamp() };
    await assertFails(setDoc(doc(staffAuth(), "expenses/neg"), { ...stamped, amount: -500 }));
    await assertFails(setDoc(doc(staffAuth(), "expenses/str"), { ...stamped, amount: "abc" }));
    await assertSucceeds(setDoc(doc(staffAuth(), "expenses/ok"), { ...stamped, amount: 500 }));
    await assertFails(updateDoc(doc(staffAuth(), "expenses/ok"), { amount: -1 }));
  });

  it("an expense saved offline syncs days later; not older than a week", async () => {
    const base = {
      branchId: "main",
      category: "supplies",
      description: "Gas",
      amount: 500,
      createdBy: "staff1",
      createdAt: new Date().toISOString(),
      syncedAtServer: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(staffAuth(), "expenses/q-3d"), { ...base, date: daysAgo(3) }));
    await assertFails(setDoc(doc(staffAuth(), "expenses/q-10d"), { ...base, date: daysAgo(10) }));
  });

  it("staff file expenses under today only and keep their day and name", async () => {
    const base = {
      branchId: "main",
      category: "supplies",
      description: "Gas",
      amount: 500,
      createdBy: "staff1",
      createdAt: new Date().toISOString(),
      createdAtServer: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(staffAuth(), "expenses/d-today"), { ...base, date: KARACHI_TODAY }));
    await assertFails(setDoc(doc(staffAuth(), "expenses/d-old"), { ...base, date: daysAgo(3) }));
    await assertFails(setDoc(doc(staffAuth(), "expenses/d-future"), { ...base, date: daysAgo(-2) }));
    await assertFails(setDoc(doc(staffAuth(), "expenses/d-bad"), { ...base, date: "soon" }));
    // The owner may back-date.
    await assertSucceeds(
      setDoc(doc(ownerAuth(), "expenses/d-owner-old"), { ...base, createdBy: "owner1", date: daysAgo(3) }),
    );
    // Staff can't move it to another day, rename the author, or edit in someone else's name.
    await assertFails(updateDoc(doc(staffAuth(), "expenses/d-today"), { date: daysAgo(3) }));
    await assertFails(updateDoc(doc(staffAuth(), "expenses/d-today"), { createdByName: "Owner" }));
    await assertFails(updateDoc(doc(staffAuth(), "expenses/d-today"), { amount: 1, updatedBy: "owner1" }));
    await assertSucceeds(updateDoc(doc(staffAuth(), "expenses/d-today"), { amount: 1, updatedBy: "staff1" }));
  });

  it("allows staff create and update", async () => {
    await assertSucceeds(
      setDoc(doc(staffAuth(), "expenses/e1"), {
        branchId: "main",
        category: "supplies",
        description: "Gas",
        amount: 500,
        date: KARACHI_TODAY,
        createdBy: "staff1",
        createdAt: new Date().toISOString(),
        createdAtServer: serverTimestamp(),
      }),
    );
    // A new expense carries a cloud stamp (it anchors the staff window).
    await assertFails(
      setDoc(doc(staffAuth(), "expenses/e1-nostamp"), {
        branchId: "main",
        category: "supplies",
        description: "Gas",
        amount: 500,
        date: KARACHI_TODAY,
        createdBy: "staff1",
        createdAt: new Date().toISOString(),
      }),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "expenses/e2"), {
        branchId: "main",
        category: "supplies",
        description: "Gas",
        amount: 500,
        date: "2026-09-28",
        createdBy: "staff1",
        createdAt: new Date().toISOString(),
        createdAtServer: Timestamp.now(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(staffAuth(), "expenses/e2"), { amount: 100 }),
    );
    await assertSucceeds(
      updateDoc(doc(ownerAuth(), "expenses/e2"), { amount: 100 }),
    );
  });

  it("staff edit only their own expenses, inside the window; owner any", async () => {
    const base = {
      branchId: "main",
      category: "supplies",
      description: "Gas",
      amount: 500,
      date: "2026-09-28",
      createdBy: "staff1",
      createdAt: new Date().toISOString(),
      createdAtServer: Timestamp.now(),
    };
    const old = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "expenses/mine"), base);
      await setDoc(doc(db, "expenses/mine-old"), { ...base, createdAtServer: old });
      await setDoc(doc(db, "expenses/coworker"), { ...base, createdBy: "staff2" });
    });
    await assertSucceeds(updateDoc(doc(staffAuth(), "expenses/mine"), { amount: 900 }));
    await assertFails(updateDoc(doc(staffAuth(), "expenses/mine-old"), { amount: 900 }));
    await assertFails(updateDoc(doc(staffAuth(), "expenses/coworker"), { amount: 900 }));
    await assertSucceeds(updateDoc(doc(coworkerAuth(), "expenses/coworker"), { amount: 900 }));
    await assertSucceeds(updateDoc(doc(ownerAuth(), "expenses/mine-old"), { amount: 1 }));
    // The stamp that anchors the window never moves.
    await assertFails(updateDoc(doc(staffAuth(), "expenses/mine"), { createdAtServer: Timestamp.now() }));
  });

  it("staff delete only their own expenses, inside the window; owner any", async () => {
    const base = {
      branchId: "main",
      category: "supplies",
      description: "Gas",
      amount: 500,
      date: "2026-09-28",
      createdBy: "staff1",
      createdAt: new Date().toISOString(),
    };
    const old = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/staff3"), {
        role: "counter",
        isActive: true,
        branchIds: ["main"],
        permissions: { canAddExpenses: true, canDeleteExpenses: false },
      });
      const fresh = { ...base, createdAtServer: Timestamp.now() };
      await setDoc(doc(db, "expenses/mine"), fresh);
      await setDoc(doc(db, "expenses/mine-old"), { ...base, createdAtServer: old });
      await setDoc(doc(db, "expenses/mine-synced"), { ...base, syncedAtServer: Timestamp.now() });
      await setDoc(doc(db, "expenses/coworker"), { ...fresh, createdBy: "staff2" });
      await setDoc(doc(db, "expenses/coworker2"), { ...base, createdBy: "staff2" });
      await setDoc(doc(db, "expenses/staff3-own"), { ...fresh, createdBy: "staff3" });
      await setDoc(doc(db, "expenses/other"), { ...fresh, branchId: "other" });
    });
    await assertSucceeds(deleteDoc(doc(staffAuth(), "expenses/mine")));
    await assertSucceeds(deleteDoc(doc(staffAuth(), "expenses/mine-synced")));
    await assertFails(deleteDoc(doc(staffAuth(), "expenses/mine-old")));
    await assertFails(deleteDoc(doc(staffAuth(), "expenses/coworker")));
    await assertFails(deleteDoc(doc(staffAuth(), "expenses/other")));
    // Permission switched off by the owner → no delete, even own rows.
    await assertFails(
      deleteDoc(doc(env.authenticatedContext("staff3").firestore(), "expenses/staff3-own")),
    );
    // Old staff docs without the field keep delete (missing = allowed).
    await assertSucceeds(deleteDoc(doc(coworkerAuth(), "expenses/coworker")));
    await assertSucceeds(deleteDoc(doc(ownerAuth(), "expenses/coworker2")));
  });
});

describe("users — primary owner protection", () => {
  it("denies co-owner disabling the main owner", async () => {
    await assertFails(
      updateDoc(doc(coOwnerAuth(), "users/owner1"), { isActive: false }),
    );
  });

  it("denies clearing isPrimaryOwner via client update", async () => {
    await assertFails(
      updateDoc(doc(ownerAuth(), "users/owner1"), { isPrimaryOwner: false }),
    );
  });

  it("allows primary to disable a co-owner", async () => {
    await assertSucceeds(
      updateDoc(doc(ownerAuth(), "users/owner2"), { isActive: false }),
    );
  });

  it("denies co-owner disabling another owner", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/owner3"), {
        role: "owner",
        isActive: true,
        isPrimaryOwner: false,
        branchIds: ["main"],
      });
    });
    await assertFails(
      updateDoc(doc(coOwnerAuth(), "users/owner3"), { isActive: false }),
    );
  });
});

describe("owner report email — recipients are owner-only", () => {
  const settings = { emails: ["owner@gmail.com"], autoDaily: true, updatedAt: "2026-10-24T00:00:00.000Z", updatedBy: "owner1" };

  it("owners read and save who gets the report; staff can't even read it", async () => {
    await assertSucceeds(setDoc(doc(ownerAuth(), "privateSettings/ownerReport"), settings));
    await assertSucceeds(getDoc(doc(ownerAuth(), "privateSettings/ownerReport")));
    await assertFails(getDoc(doc(staffAuth(), "privateSettings/ownerReport")));
    await assertFails(setDoc(doc(staffAuth(), "privateSettings/ownerReport"), settings));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "privateSettings/ownerReport")));
  });

  it("keeps the doc's shape: up to 5 emails, no extra fields, no other docs", async () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@gmail.com`);
    await assertFails(setDoc(doc(ownerAuth(), "privateSettings/ownerReport"), { ...settings, emails: six }));
    // Older docs kept a report language: still saves, a wrong one still doesn't.
    await assertSucceeds(setDoc(doc(ownerAuth(), "privateSettings/ownerReport"), { ...settings, lang: "ur" }));
    await assertFails(setDoc(doc(ownerAuth(), "privateSettings/ownerReport"), { ...settings, lang: "fr" }));
    await assertFails(setDoc(doc(ownerAuth(), "privateSettings/ownerReport"), { ...settings, extra: 1 }));
    await assertFails(setDoc(doc(ownerAuth(), "privateSettings/other"), settings));
  });

  it("the sent-email log: owners read, nobody writes from the app", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reportEmails/daily_2026-10-24"), { kind: "daily", status: "sent" });
    });
    await assertSucceeds(getDoc(doc(ownerAuth(), "reportEmails/daily_2026-10-24")));
    await assertFails(getDoc(doc(staffAuth(), "reportEmails/daily_2026-10-24")));
    await assertFails(setDoc(doc(ownerAuth(), "reportEmails/x"), { kind: "manual" }));
  });
});

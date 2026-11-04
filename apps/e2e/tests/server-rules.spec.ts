/**
 * The server rules enforce the staff policy even without the app's UI
 * (DevTools / an old cached client): writes go through the emulator REST API
 * with the staff member's real Auth-emulator ID token, so the deployed
 * firestore.rules decide. Setup docs are written with the admin bypass.
 *
 * Test orders here are CARD sales so they never move the cash drawer; every
 * doc created here is deleted again at the end.
 */
import { expect, test } from "@playwright/test";
import {
  commitAdmin,
  commitAs,
  deleteWrite,
  getDoc,
  karachiDateKey,
  ownerToken,
  shiftDateKey,
  staffToken,
  tag,
  updateWrite,
  type Json,
} from "./support";

const HOUR = 3_600_000;
const created: string[] = [];

function orderFields(createdBy: string, customerName: string, extra: Json = {}): Json {
  return {
    branchId: "main",
    branchName: "Bravo Bites — Main",
    orderNumber: 9_000_000 + Math.floor(Math.random() * 900_000),
    orderType: "takeaway",
    customerName,
    items: [
      { productId: "tb2PaFXzTNqViGVgpCvw", productName: "Classic Zinger", unitPrice: 380, qty: 1, lineTotal: 380 },
    ],
    subtotal: 380,
    total: 380,
    paymentMethod: "card",
    status: "completed",
    createdBy,
    createdByName: "E2E rules",
    createdByEmail: "",
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

/** Admin-created order; `reachedCloud` = when its syncedAtServer says it reached the cloud. */
async function seedOrder(createdBy: string, reachedCloud?: Date): Promise<string> {
  const id = tag("rules-order");
  const path = `orders/${id}`;
  const fields = orderFields(createdBy, id, { clientId: id, ...(reachedCloud ? { syncedAtServer: reachedCloud } : {}) });
  const res = await commitAdmin([
    updateWrite(path, fields, { serverTime: reachedCloud ? [] : ["syncedAtServer"], exists: false }),
  ]);
  expect(res.status, res.body).toBe(200);
  created.push(path);
  return path;
}

async function seedExpense(createdBy: string, reachedCloud?: Date, date = karachiDateKey()): Promise<string> {
  const id = tag("rules-exp");
  const path = `expenses/${id}`;
  const res = await commitAdmin([
    updateWrite(
      path,
      {
        branchId: "main",
        category: "other",
        description: id,
        amount: 5,
        date,
        createdBy,
        createdByName: "E2E rules",
        createdAt: new Date().toISOString(),
        ...(reachedCloud ? { syncedAtServer: reachedCloud } : {}),
      },
      { serverTime: reachedCloud ? [] : ["syncedAtServer"], exists: false },
    ),
  ]);
  expect(res.status, res.body).toBe(200);
  created.push(path);
  return path;
}

type LogEntry = { amount: number; at: string };

/** refundAmount (lifetime total) + the refund log as written; the rules want the old log kept and one entry for exactly the new amount. */
function refundWrite(path: string, amount: number, log: LogEntry[], by: string, extra: Json = {}, extraMask: string[] = []) {
  const at = new Date().toISOString();
  const fields: Json = {
    refundAmount: amount,
    refundReason: "rules test",
    refundedBy: by,
    refundedByName: "E2E",
    refundCount: log.length,
    refunds: log,
    refundedAt: at,
    updatedAt: at,
    ...extra,
  };
  return updateWrite(path, fields, {
    mask: [...Object.keys(fields), ...extraMask],
    serverTime: ["refundedAtServer", "updatedAtServer"],
  });
}

test.afterAll(async () => {
  if (created.length) await commitAdmin(created.splice(0).map((p) => deleteWrite(p)));
});

test.describe("server rules — staff orders", () => {
  test("staff refunds: own order only, more than before, ≤ total, one ledger entry, in own name", async () => {
    const staff = await staffToken();
    const owner = await ownerToken();
    const path = await seedOrder(staff.uid);
    const as = (w: Json) => commitAs(staff.idToken, [w]);

    const first: LogEntry = { amount: 50, at: new Date().toISOString() };
    const next = (amount: number): LogEntry => ({ amount, at: new Date().toISOString() });
    expect((await as(refundWrite(path, 50, [first], staff.uid))).status).toBe(200);
    // second refund: must add exactly one log entry, for exactly the new amount, and raise the total
    expect((await as(refundWrite(path, 60, [first], staff.uid))).status, "no new log entry").toBe(403);
    expect((await as(refundWrite(path, 40, [first, next(10)], staff.uid))).status, "refund total went down").toBe(403);
    expect((await as(refundWrite(path, 400, [first, next(350)], staff.uid))).status, "more than the order total").toBe(403);
    expect((await as(refundWrite(path, 60, [first, next(5), next(5)], staff.uid))).status, "two log entries at once").toBe(403);
    expect((await as(refundWrite(path, 60, [first, next(5000)], staff.uid))).status, "entry bigger than the refund").toBe(403);
    expect(
      (await as(refundWrite(path, 60, [{ ...first, amount: 1 }, next(10)], staff.uid))).status,
      "earlier entry rewritten",
    ).toBe(403);
    expect((await as(refundWrite(path, 60, [first, next(10)], owner.uid))).status, "refund in the owner's name").toBe(403);
    expect(
      (await as(refundWrite(path, 60, [first, next(10)], staff.uid, { total: 1000, subtotal: 1000 }))).status,
      "edit sneaked into a refund",
    ).toBe(403);
    expect((await as(refundWrite(path, 60, [first, next(10)], staff.uid))).status).toBe(200);

    const doc = await getDoc(path);
    expect(doc?.data.refundAmount).toBe(60);
    expect(doc?.data.refunds).toHaveLength(2);

    // someone else's order: no refund at all
    const ownerPath = await seedOrder(owner.uid);
    expect((await as(refundWrite(ownerPath, 10, [next(10)], staff.uid))).status).toBe(403);
  });

  test("staff create: own name, server stamp now, no refund fields, completed only", async () => {
    const staff = await staffToken();
    const owner = await ownerToken();
    const create = async (fields: Json, serverTime: string[] = ["syncedAtServer"]) => {
      const id = tag("rules-create");
      const path = `orders/${id}`;
      const res = await commitAs(staff.idToken, [updateWrite(path, { clientId: id, ...fields }, { serverTime, exists: false })]);
      if (res.status === 200) created.push(path);
      return res.status;
    };
    expect(await create(orderFields(staff.uid, tag("ok")))).toBe(200);
    expect(await create(orderFields(owner.uid, tag("other-name"))), "in the owner's name").toBe(403);
    expect(await create(orderFields(staff.uid, tag("no-stamp")), []), "no cloud-arrival stamp").toBe(403);
    expect(
      await create(orderFields(staff.uid, tag("old-stamp"), { syncedAtServer: new Date(Date.now() - 2 * HOUR) }), []),
      "back-dated stamp",
    ).toBe(403);
    expect(
      await create(orderFields(staff.uid, tag("pre-refunded"), { refundAmount: 100, refunds: [{ amount: 100, at: "x" }] })),
      "pre-refunded sale",
    ).toBe(403);
    expect(await create(orderFields(staff.uid, tag("cancelled"), { status: "cancelled" })), "created cancelled").toBe(403);
    expect(await create(orderFields(staff.uid, tag("negative"), { total: -5 })), "negative total").toBe(403);
  });

  test("staff edit/cancel: own order, within 24h of reaching the cloud, stamps immutable, never delete", async () => {
    const staff = await staffToken();
    const owner = await ownerToken();
    const as = (w: Json) => commitAs(staff.idToken, [w]);
    const cancel = (path: string, by = staff.uid) =>
      updateWrite(path, { status: "cancelled", updatedBy: by }, { mask: ["status", "updatedBy"] });

    const fresh = await seedOrder(staff.uid);
    expect((await as(updateWrite(fresh, { customerPhone: "0300" }, { mask: ["customerPhone"] }))).status).toBe(200);
    expect(
      (await as(updateWrite(fresh, { syncedAtServer: new Date() }, { mask: ["syncedAtServer"] }))).status,
      "moving the cloud stamp",
    ).toBe(403);
    expect((await as(cancel(fresh, owner.uid))).status, "updatedBy someone else").toBe(403);
    expect((await as(deleteWrite(fresh))).status, "staff delete").toBe(403);
    expect((await as(cancel(fresh))).status).toBe(200);
    expect(
      (await as(updateWrite(fresh, { status: "completed" }, { mask: ["status"] }))).status,
      "un-cancel",
    ).toBe(403);

    const old = await seedOrder(staff.uid, new Date(Date.now() - 73 * HOUR));
    expect((await as(cancel(old))).status, "73h after reaching the cloud").toBe(403);
    expect(
      (await as(refundWrite(old, 10, [{ amount: 10, at: new Date().toISOString() }], staff.uid))).status,
      "refund 73h later",
    ).toBe(403);
    expect((await as(updateWrite(old, { customerPhone: "1" }, { mask: ["customerPhone"] }))).status).toBe(403);

    // A whole-day outage: the change made offline reaches the server ~30h later.
    const recent = await seedOrder(staff.uid, new Date(Date.now() - 30 * HOUR));
    expect((await as(cancel(recent))).status, "30h: still inside the server cap").toBe(200);

    // Owner (rules applied, not the admin bypass) may delete a staff order.
    const ownerDel = await seedOrder(staff.uid);
    expect((await commitAs(owner.idToken, [deleteWrite(ownerDel)])).status).toBe(200);
  });
});

test.describe("server rules — staff expenses", () => {
  test("staff: own expenses only, server stamp required, 72h cap", async () => {
    const staff = await staffToken();
    const owner = await ownerToken();
    const as = (w: Json) => commitAs(staff.idToken, [w]);
    const today = karachiDateKey();
    const base = (createdBy: string, description: string): Json => ({
      branchId: "main",
      category: "other",
      description,
      amount: 7,
      date: today,
      createdBy,
      createdByName: "E2E rules",
      createdAt: new Date().toISOString(),
      source: "pos",
    });
    const create = async (fields: Json, serverTime = ["syncedAtServer"]) => {
      const id = tag("rules-exp-create");
      const path = `expenses/${id}`;
      const res = await commitAs(staff.idToken, [updateWrite(path, fields, { serverTime, exists: false })]);
      if (res.status === 200) created.push(path);
      return { status: res.status, path };
    };

    const ok = await create(base(staff.uid, tag("ok")));
    expect(ok.status).toBe(200);
    expect((await create(base(owner.uid, tag("owner-name")))).status, "in the owner's name").toBe(403);
    expect((await create(base(staff.uid, tag("no-stamp")), [])).status, "no stamp").toBe(403);
    expect((await create({ ...base(staff.uid, tag("neg")), amount: -1 })).status, "negative").toBe(403);

    expect((await as(updateWrite(ok.path, { amount: 9 }, { mask: ["amount"] }))).status).toBe(200);
    expect((await as(updateWrite(ok.path, { amount: -9 }, { mask: ["amount"] }))).status, "negative").toBe(403);
    expect(
      (await as(updateWrite(ok.path, { createdBy: owner.uid }, { mask: ["createdBy"] }))).status,
      "re-owning",
    ).toBe(403);

    const ownerExp = await seedExpense(owner.uid);
    expect((await as(updateWrite(ownerExp, { amount: 1 }, { mask: ["amount"] }))).status).toBe(403);
    expect((await as(deleteWrite(ownerExp))).status).toBe(403);

    const oldOwn = await seedExpense(staff.uid, new Date(Date.now() - 73 * HOUR), shiftDateKey(today, -3));
    expect((await as(updateWrite(oldOwn, { amount: 1 }, { mask: ["amount"] }))).status, "73h later").toBe(403);
    expect((await as(deleteWrite(oldOwn))).status, "delete 73h later").toBe(403);
    // Owner (rules applied) may still fix it.
    expect((await commitAs(owner.idToken, [updateWrite(oldOwn, { amount: 2 }, { mask: ["amount"] })])).status).toBe(200);

    expect((await as(deleteWrite(ok.path))).status).toBe(200);
  });

  test("staff cannot file or move an expense to a past day directly (app: today only)", async () => {
    const staff = await staffToken();
    // 10 days back (older than the 7-day offline allowance): always refused. (Yesterday is allowed until noon Karachi —
    // an overnight shop's business day ends after midnight.)
    const pastDay = shiftDateKey(karachiDateKey(), -10);
    const id = tag("rules-exp-backdate");
    const path = `expenses/${id}`;
    const res = await commitAs(staff.idToken, [
      updateWrite(
        path,
        {
          branchId: "main",
          category: "other",
          description: id,
          amount: 3,
          date: pastDay,
          createdBy: staff.uid,
          createdByName: "E2E rules",
          createdAt: new Date().toISOString(),
        },
        { serverTime: ["syncedAtServer"], exists: false },
      ),
    ]);
    if (res.status === 200) created.push(path);

    const own = await seedExpense(staff.uid);
    const move = await commitAs(staff.idToken, [updateWrite(own, { date: pastDay }, { mask: ["date"] })]);

    expect.soft(res.status, "staff created an expense dated 10 days ago").toBe(403);
    expect.soft(move.status, "staff moved their expense to another day").toBe(403);
  });
});

test.describe("server rules — cash drawer & activity log", () => {
  test("staff opens/closes drawers only in their own name; a closed drawer stays closed", async () => {
    const staff = await staffToken();
    const owner = await ownerToken();
    const as = (w: Json) => commitAs(staff.idToken, [w]);
    const drawer = (openedBy: string): Json => ({
      branchId: "main",
      date: "2000-01-01", // never "today": the drawer screen must not pick it up
      openingBalance: 10,
      closingCount: null,
      expectedCash: null,
      difference: null,
      status: "open",
      openedBy,
      openedByName: "E2E rules",
      openedAt: new Date().toISOString(),
    });
    const close = (path: string, by: string, extra: Json = {}) => {
      const fields: Json = {
        status: "closed",
        closingCount: 10,
        expectedCash: 10,
        difference: 0,
        closedBy: by,
        closedByName: "E2E",
        closedAt: new Date().toISOString(),
        autoClosed: false,
        ...extra,
      };
      return updateWrite(path, fields, { mask: Object.keys(fields), serverTime: ["updatedAtServer"] });
    };

    const other = `cashDrawers/${tag("rules-drawer-other")}`;
    expect((await as(updateWrite(other, drawer(owner.uid), { exists: false }))).status, "open in owner's name").toBe(403);

    const path = `cashDrawers/${tag("rules-drawer")}`;
    try {
      expect((await as(updateWrite(path, drawer(staff.uid), { serverTime: ["createdAtServer"], exists: false }))).status).toBe(200);
      expect((await as(close(path, owner.uid))).status, "close in owner's name").toBe(403);
      expect(
        (await as(close(path, "system", { autoClosed: true }))).status,
        "auto close carrying a hand count",
      ).toBe(403);
      expect(
        (await as(close(path, staff.uid, { openingBalance: 9999 }))).status,
        "changing the opening balance while closing",
      ).toBe(403);
      expect((await as(close(path, staff.uid))).status).toBe(200);
      expect(
        (await as(updateWrite(path, { status: "open" }, { mask: ["status"] }))).status,
        "reopen a closed drawer",
      ).toBe(403);
      expect((await as(deleteWrite(path))).status, "staff delete drawer").toBe(403);
    } finally {
      await commitAdmin([deleteWrite(path)]);
    }
  });

  test("activity log: staff write only as themselves, never edit or delete", async () => {
    const staff = await staffToken();
    const owner = await ownerToken();
    const log = (createdBy: string): Json => ({
      branchId: "main",
      entityType: "order",
      entityId: "rules-test",
      action: "update",
      summary: "rules test",
      createdBy,
      createdByName: "E2E rules",
      createdAt: new Date().toISOString(),
    });
    const mine = `activityLogs/${tag("rules-log")}`;
    const theirs = `activityLogs/${tag("rules-log-owner")}`;
    try {
      expect((await commitAs(staff.idToken, [updateWrite(theirs, log(owner.uid), { exists: false })])).status).toBe(403);
      expect((await commitAs(staff.idToken, [updateWrite(mine, log(staff.uid), { exists: false })])).status).toBe(200);
      expect(
        (await commitAs(staff.idToken, [updateWrite(mine, { summary: "x" }, { mask: ["summary"] })])).status,
      ).toBe(403);
      expect((await commitAs(staff.idToken, [deleteWrite(mine)])).status).toBe(403);
    } finally {
      await commitAdmin([deleteWrite(mine)]);
    }
  });
});

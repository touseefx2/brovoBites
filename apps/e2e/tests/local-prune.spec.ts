/**
 * The PC keeps synced sales / changes / expenses as a local copy for 30 days,
 * then prunes them. Pruning must never drop a row that still needs the cloud,
 * nor a synced row of an order / expense that such a row is about.
 *
 * Rows are written straight into the app's IndexedDB queue; the first sync
 * pass after a reload prunes. Rows that still need the cloud can't go up from
 * the staff session here: an owner-only delete, and an edit by a user the
 * cloud refuses.
 */
import { expect, test, type Page } from "@playwright/test";
import { commitAdmin, deleteWrite, newSession, ownerToken, Pos, staffToken, updateWrite } from "./support";

const DAY = 86_400_000;

async function idb(page: Page, op: "put" | "keys", store: string, rows: unknown[] = []) {
  return page.evaluate(
    ({ op, store, rows }) =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open("bravobites-pos-queue");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(store, op === "put" ? "readwrite" : "readonly");
          const s = tx.objectStore(store);
          let keys: string[] = [];
          if (op === "put") for (const r of rows) s.put(r);
          else {
            const k = s.getAllKeys();
            k.onsuccess = () => {
              keys = (k.result as IDBValidKey[]).map(String);
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(keys);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { op, store, rows },
  );
}

test("30-day prune drops only old synced rows, never work still waiting for the cloud", async ({ browser }) => {
  test.setTimeout(120_000);
  const staff = await staffToken();
  const owner = await ownerToken();
  const { context, page } = await newSession(browser, "staff");
  const pos = new Pos(page);
  await pos.goto();
  await pos.waitCounterReady();
  await pos.waitAllSynced(30_000);

  const now = Date.now();
  const old = now - 40 * DAY;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ownerUser = {
    uid: owner.uid,
    email: "e2e.owner@bravobites.test",
    displayName: "E2E Owner",
    phone: "",
    role: "owner",
    branchIds: ["main"],
    isActive: true,
    createdAt: iso(old),
  };
  const order = (clientId: string, o: Record<string, unknown>) => ({
    clientId,
    orderNumber: 1,
    branchId: "main",
    orderType: "takeaway",
    items: [],
    subtotal: 0,
    total: 0,
    paymentMethod: "cash",
    createdBy: staff.uid,
    createdByName: "E2E Staff",
    createdAt: iso(old),
    status: "synced",
    stockStatus: "synced",
    enqueuedAt: old,
    updatedAt: old,
    syncedAt: old,
    ...o,
  });
  const asOrder = (id: string) => ({
    id,
    branchId: "main",
    orderNumber: 1,
    items: [],
    subtotal: 0,
    total: 0,
    paymentMethod: "cash",
    status: "completed",
    createdBy: owner.uid,
    createdByName: "E2E Owner",
    createdAt: iso(old),
  });
  const expense = (clientId: string, o: Record<string, unknown>) => ({
    clientId,
    branchId: "main",
    category: "other",
    description: clientId,
    amount: 1,
    date: iso(old).slice(0, 10),
    createdBy: staff.uid,
    createdByName: "E2E Staff",
    createdAt: iso(old),
    status: "synced",
    enqueuedAt: old,
    updatedAt: old,
    syncedAt: old,
    ...o,
  });

  const before = {
    orders: await idb(page, "keys", "orders"),
    mutations: await idb(page, "keys", "mutations"),
    expenses: await idb(page, "keys", "expenses"),
  };

  await idb(page, "put", "orders", [
    order("prune-old-synced", {}),
    order("keep-old-but-waiting", { createdBy: owner.uid, createdByName: "E2E Owner", status: "pending", stockStatus: "pending", syncedAt: undefined }),
    order("keep-old-synced-busy", { createdBy: owner.uid }),
    order("keep-recent-synced", { enqueuedAt: now - 2 * DAY, updatedAt: now - 2 * DAY, syncedAt: now - 2 * DAY }),
    order("keep-synced-late", { syncedAt: now - DAY, updatedAt: now - DAY }),
  ]);
  await idb(page, "put", "mutations", [
    {
      mutationId: "prune-m-old-synced",
      kind: "cancel",
      orderId: "prune-old-synced",
      orderBefore: asOrder("prune-old-synced"),
      orderAfter: { ...asOrder("prune-old-synced"), status: "cancelled" },
      user: ownerUser,
      occurredAt: iso(old),
      status: "synced",
      enqueuedAt: old,
      updatedAt: old,
      syncedAt: old,
    },
    {
      // Owner's delete: any login syncs other work, but a delete waits for the owner.
      mutationId: "keep-m-waiting",
      kind: "delete",
      orderId: "keep-old-synced-busy",
      orderBefore: asOrder("keep-old-synced-busy"),
      orderAfter: asOrder("keep-old-synced-busy"),
      user: ownerUser,
      occurredAt: iso(old),
      status: "pending",
      enqueuedAt: old,
      updatedAt: old,
    },
  ]);
  await idb(page, "put", "expenses", [
    expense("prune-e-old-synced", {}),
    expense("keep-e-old-synced-busy", { createdBy: owner.uid, actor: ownerUser }),
    // By a user the cloud doesn't know: refused under any login, so it keeps waiting.
    expense("keep-e-waiting", {
      kind: "update",
      expenseId: "keep-e-old-synced-busy",
      createdBy: "e2e-gone-user",
      actor: { ...ownerUser, uid: "e2e-gone-user", role: "counter" },
      status: "pending",
      syncedAt: undefined,
    }),
  ]);

  // The cloud copy of that expense exists, so the refused edit really fails (not "already gone").
  const seeded = await commitAdmin([
    updateWrite("expenses/keep-e-old-synced-busy", {
      branchId: "main",
      category: "other",
      description: "keep-e-old-synced-busy",
      amount: 1,
      date: iso(old).slice(0, 10),
      createdBy: owner.uid,
      createdByName: "E2E Owner",
      createdAt: iso(old),
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  // Fresh app start → first sync pass prunes.
  await page.reload();
  await expect(page.locator(".pos-product-card").first()).toBeVisible({ timeout: 45_000 });

  await expect
    .poll(async () => (await idb(page, "keys", "orders")).includes("prune-old-synced"), { timeout: 30_000 })
    .toBe(false);
  const after = {
    orders: await idb(page, "keys", "orders"),
    mutations: await idb(page, "keys", "mutations"),
    expenses: await idb(page, "keys", "expenses"),
  };

  expect(after.orders).not.toContain("prune-old-synced");
  expect(after.mutations).not.toContain("prune-m-old-synced");
  expect(after.expenses).not.toContain("prune-e-old-synced");
  for (const k of ["keep-old-but-waiting", "keep-old-synced-busy", "keep-recent-synced", "keep-synced-late"]) {
    expect(after.orders, k).toContain(k);
  }
  expect(after.mutations).toContain("keep-m-waiting");
  expect(after.expenses).toContain("keep-e-old-synced-busy");
  expect(after.expenses).toContain("keep-e-waiting");
  // This session's own (recent) rows are untouched.
  for (const k of before.orders) expect(after.orders).toContain(k);
  for (const k of before.mutations) expect(after.mutations).toContain(k);
  for (const k of before.expenses) expect(after.expenses).toContain(k);

  await commitAdmin([deleteWrite("expenses/keep-e-old-synced-busy")]);
  await context.close();
});

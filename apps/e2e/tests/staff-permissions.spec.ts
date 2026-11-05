/**
 * Per-staff permissions, app + server:
 *  - canEditOrders off → no edits, but cancel / refund still allowed
 *  - canCancelOrders off → no cancel and no refund (a refund is a partial cancel)
 *  - canDeleteExpenses off → own expense editable, not deletable
 *  - canAddExpenses off → no Expenses on the POS, server refuses add / edit
 * The shared staff account's permissions are always restored (finally).
 */
import { expect, test } from "@playwright/test";
import {
  commitAdmin,
  commitAs,
  deleteWrite,
  karachiDateKey,
  newSession,
  Pos,
  staffToken,
  tag,
  updateWrite,
  type Json,
  serialOnly,
} from "./support";

const ALL_ON = {
  canAddExpenses: true,
  canDeleteExpenses: true,
  canApplyDiscount: true,
  canEditOrders: true,
  canCancelOrders: true,
  canManageInventory: true,
};

test("staff permission switches hide the controls and the server agrees", async ({ browser }) => {
  test.setTimeout(240_000);
  serialOnly();
  const staff = await staffToken();
  const setPerms = async (p: Json) => {
    const res = await commitAdmin([updateWrite(`users/${staff.uid}`, { permissions: p }, { mask: ["permissions"] })]);
    expect(res.status, res.body).toBe(200);
  };

  const orderId = tag("perm-order");
  const expId = tag("perm-exp");
  const newExp = tag("perm-exp-new");
  const paths = [`orders/${orderId}`, `expenses/${expId}`, `expenses/${newExp}`];
  const seeded = await commitAdmin([
    updateWrite(
      paths[0]!,
      {
        clientId: orderId,
        branchId: "main",
        branchName: "Brovo Bites — Main",
        orderNumber: 9_000_000 + Math.floor(Math.random() * 900_000),
        orderType: "takeaway",
        customerName: orderId,
        items: [{ productId: "kUY4BhnB5U65JYl5x1h5", productName: "Chicken Club", unitPrice: 250, qty: 1, lineTotal: 250 }],
        subtotal: 250,
        total: 250,
        paymentMethod: "card",
        status: "completed",
        createdBy: staff.uid,
        createdByName: "E2E Staff",
        createdByEmail: "e2e.staff@bravobites.test",
        createdAt: new Date().toISOString(),
      },
      { serverTime: ["syncedAtServer"], exists: false },
    ),
    updateWrite(
      paths[1]!,
      {
        branchId: "main",
        category: "other",
        description: expId,
        amount: 12,
        date: karachiDateKey(),
        createdBy: staff.uid,
        createdByName: "E2E Staff",
        createdAt: new Date().toISOString(),
        source: "pos",
      },
      { serverTime: ["syncedAtServer"], exists: false },
    ),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  const asStaff = (w: Json) => commitAs(staff.idToken, [w]).then((r) => r.status);
  const refund = (n: number) => {
    const at = new Date().toISOString();
    const fields: Json = {
      refundAmount: n,
      refundReason: "perm test",
      refundedBy: staff.uid,
      refundedByName: "E2E Staff",
      refundCount: 1,
      refunds: [{ amount: n, at }],
      refundedAt: at,
    };
    return updateWrite(paths[0]!, fields, { mask: Object.keys(fields) });
  };
  const cancel = updateWrite(paths[0]!, { status: "cancelled", updatedBy: staff.uid }, { mask: ["status", "updatedBy"] });
  const edit = updateWrite(paths[0]!, { customerPhone: "0300", updatedBy: staff.uid }, { mask: ["customerPhone", "updatedBy"] });

  try {
    // ── canEditOrders off: cancel / refund stay ──
    await setPerms({ ...ALL_ON, canEditOrders: false });
    let session = await newSession(browser, "staff");
    let pos = new Pos(session.page);
    await pos.goto();
    let sheet = await pos.openOrder(orderId);
    await expect(sheet).toContainText("Only the owner can edit orders");
    await expect(sheet.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Refund order" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Cancel this order" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete order" })).toHaveCount(0);
    expect(await asStaff(edit), "edit with canEditOrders off").toBe(403);
    await session.context.close();

    // ── canCancelOrders + canDeleteExpenses off: no cancel, no refund, no expense delete ──
    await setPerms({ ...ALL_ON, canCancelOrders: false, canDeleteExpenses: false });
    session = await newSession(browser, "staff");
    pos = new Pos(session.page);
    await pos.goto();
    sheet = await pos.openOrder(orderId);
    await expect(sheet.getByRole("button", { name: "Add item", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Refund order" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Cancel this order" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Close" }).last().click();
    expect(await asStaff(refund(50)), "refund with canCancelOrders off").toBe(403);
    expect(await asStaff(cancel), "cancel with canCancelOrders off").toBe(403);
    expect(await asStaff(edit), "edit still allowed").toBe(200);

    const expenses = await pos.openExpenses();
    const row = expenses.locator("li").filter({ hasText: expId });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
    expect(await asStaff(deleteWrite(paths[1]!)), "expense delete with canDeleteExpenses off").toBe(403);
    expect(await asStaff(updateWrite(paths[1]!, { amount: 13 }, { mask: ["amount"] }))).toBe(200);
    await session.context.close();

    // ── canAddExpenses off: no Expenses button; server refuses add / edit ──
    await setPerms({ ...ALL_ON, canAddExpenses: false });
    session = await newSession(browser, "staff");
    pos = new Pos(session.page);
    await pos.goto();
    await expect(pos.toolbar().getByRole("button", { name: /^Expenses/ })).toHaveCount(0);
    expect(await asStaff(updateWrite(paths[1]!, { amount: 14 }, { mask: ["amount"] })), "edit with canAddExpenses off").toBe(403);
    const create = updateWrite(
      paths[2]!,
      {
        branchId: "main",
        category: "other",
        description: newExp,
        amount: 3,
        date: karachiDateKey(),
        createdBy: staff.uid,
        createdByName: "E2E Staff",
        createdAt: new Date().toISOString(),
      },
      { serverTime: ["syncedAtServer"], exists: false },
    );
    expect(await asStaff(create), "add with canAddExpenses off").toBe(403);
    await session.context.close();
  } finally {
    await setPerms(ALL_ON);
    await commitAdmin(paths.map((p) => deleteWrite(p)));
  }
});

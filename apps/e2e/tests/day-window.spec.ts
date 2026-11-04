/**
 * Staff window = the business day. A staff member's own order / expense from
 * YESTERDAY is locked for them in the app — even though the server's 72h cap
 * (counted from when it reached the cloud) would still accept a change. The
 * owner can still change both.
 */
import { expect, test } from "@playwright/test";
import {
  commitAdmin,
  deleteWrite,
  karachiDateKey,
  newSession,
  orderSheet,
  Pos,
  shiftDateKey,
  staffToken,
  tag,
  updateWrite,
} from "./support";

test("staff's own order and expense from yesterday are locked for staff; owner can change them", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const staff = await staffToken();
  const yesterday = shiftDateKey(karachiDateKey(), -1);
  const createdAt = new Date(`${yesterday}T15:00:00+05:00`).toISOString();

  const orderId = tag("yesterday-order");
  const expId = tag("yesterday-exp");
  const paths = [`orders/${orderId}`, `expenses/${expId}`];
  const seeded = await commitAdmin([
    updateWrite(
      paths[0]!,
      {
        clientId: orderId,
        branchId: "main",
        branchName: "Bravo Bites — Main",
        orderNumber: 9_000_000 + Math.floor(Math.random() * 900_000),
        orderType: "takeaway",
        customerName: orderId,
        items: [{ productId: "WUqxiFi9NxKtBWeZ0Rx0", productName: "Special Sandwich", unitPrice: 500, qty: 1, lineTotal: 500 }],
        subtotal: 500,
        total: 500,
        paymentMethod: "card",
        status: "completed",
        createdBy: staff.uid,
        createdByName: "E2E Staff",
        createdByEmail: "e2e.staff@bravobites.test",
        createdAt,
      },
      // Reached the cloud just now: the server cap alone would still allow staff.
      { serverTime: ["syncedAtServer"], exists: false },
    ),
    updateWrite(
      paths[1]!,
      {
        branchId: "main",
        category: "other",
        description: expId,
        amount: 40,
        date: yesterday,
        createdBy: staff.uid,
        createdByName: "E2E Staff",
        createdAt,
        source: "pos",
      },
      { serverTime: ["syncedAtServer"], exists: false },
    ),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    // ── Staff ──
    const { context, page } = await newSession(browser, "staff");
    await page.goto("/admin/orders");
    await page.locator(".admin-filter-panel select").first().selectOption("yesterday");
    const card = page.getByRole("button").filter({ hasText: orderId });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.click();
    const sheet = orderSheet(page);
    await expect(sheet).toContainText("This order's business day has ended — only the owner can change it now.");
    for (const name of ["Add item", "Save changes", "Refund order", "Cancel this order", "Delete order"]) {
      await expect(sheet.getByRole("button", { name, exact: true })).toHaveCount(0);
    }

    const pos = new Pos(page);
    await pos.goto();
    const expenses = await pos.openExpenses();
    await expenses.getByRole("button", { name: "Yesterday", exact: true }).click();
    const row = expenses.locator("li").filter({ hasText: expId });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await context.close();

    // ── Owner ──
    const owner = await newSession(browser, "owner");
    await owner.page.goto("/admin/orders");
    await owner.page.locator(".admin-filter-panel select").first().selectOption("yesterday");
    const ownerCard = owner.page.getByRole("button").filter({ hasText: orderId });
    await expect(ownerCard).toHaveCount(1, { timeout: 30_000 });
    await ownerCard.click();
    const ownerSheet = orderSheet(owner.page);
    for (const name of ["Add item", "Refund order", "Cancel this order", "Delete order"]) {
      await expect(ownerSheet.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await owner.context.close();
  } finally {
    await commitAdmin(paths.map((p) => deleteWrite(p)));
  }
});

/**
 * Owner: any order, any time — delete, refund someone else's order; expenses
 * on any past day.
 */
import { expect, test } from "@playwright/test";
import {
  acknowledgeSuccess,
  confirmAlert,
  isTimestamp,
  karachiDateKey,
  newSession,
  orderSheet,
  ownerToken,
  Pos,
  shiftDateKey,
  staffToken,
  tag,
  waitForGone,
  waitForOne,
} from "./support";

test.describe("owner powers", () => {
  test("owner deletes an order from the POS", async ({ browser }) => {
    test.setTimeout(150_000);
    const owner = await ownerToken();
    const { context, page } = await newSession(browser, "owner");
    const pos = new Pos(page);
    await pos.goto();

    const customer = tag("owner-delete");
    const sale = await pos.sell("Roti", customer);
    expect(sale.data.createdBy).toBe(owner.uid);
    await pos.waitAllSynced(45_000);

    const sheet = await pos.openOrder(customer);
    await expect(sheet.getByRole("button", { name: "Add item", exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Delete order" }).click();
    await confirmAlert(page, "Delete this order permanently?");
    await acknowledgeSuccess(page, "Order deleted");
    await waitForGone(`orders/${sale.id}`);
    await waitForOne("activityLogs", { entityId: sale.id, action: "delete" }, (d) => d.data.createdBy === owner.uid);
    await pos.waitAllSynced(45_000);

    // Gone from Recent orders too.
    const recent = await pos.openRecent();
    await expect(recent.getByRole("button").filter({ hasText: customer })).toHaveCount(0);
    await context.close();
  });

  test("owner refunds and can edit a staff member's order from admin Orders", async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = await ownerToken();
    const staff = await staffToken();

    const staffSession = await newSession(browser, "staff");
    const staffPos = new Pos(staffSession.page);
    await staffPos.goto();
    const customer = tag("staff-sale-owner-refund");
    const sale = await staffPos.sell("Classic Zinger", customer);
    expect(sale.data.createdBy).toBe(staff.uid);
    await staffPos.waitAllSynced(45_000);
    await staffSession.context.close();

    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin/orders");
    const card = page.getByRole("button").filter({ hasText: customer });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.click();
    const sheet = orderSheet(page);
    await expect(sheet).toBeVisible();
    // Owner has every control on a staff order.
    await expect(sheet.getByRole("button", { name: "Add item", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Cancel this order" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete order" })).toBeVisible();

    await sheet.getByRole("button", { name: "Refund order" }).click();
    await sheet.locator('input[type="number"]').fill("50");
    await sheet.getByPlaceholder("e.g. wrong item, quality issue").fill("E2E owner refund");
    await sheet.getByRole("button", { name: "Confirm refund" }).click();
    await confirmAlert(page, "Confirm this refund?");
    await acknowledgeSuccess(page, "Refund processed");

    const refunded = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => d.data.refundAmount === 50,
    );
    expect(refunded.data.refundedBy).toBe(owner.uid);
    expect(refunded.data.createdBy).toBe(staff.uid);
    const ledger = refunded.data.refunds as { amount: number; at: string }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe(50);
    expect(refunded.data.status).toBe("completed");

    // The admin list reflects the refund (live listener).
    await expect(page.getByRole("button").filter({ hasText: customer })).toContainText("Refunded");
    await context.close();
  });

  test("owner can back-date an expense on admin Expenses and edit it", async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await ownerToken();
    const today = karachiDateKey();
    const past = shiftDateKey(today, -3);
    const desc = tag("owner-backdated");

    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin/expenses");
    await expect(page.getByRole("heading", { name: "Expenses", level: 1 })).toBeVisible({ timeout: 30_000 });
    // Branch list loaded first (see admin-expenses-race.spec.ts for the race).
    await expect(page.locator("select", { has: page.locator("option", { hasText: "All branches" }) })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Add expense" }).click();
    const modal = page.locator("div.panel").filter({ has: page.getByRole("heading", { name: "Add expense" }) });
    const date = modal.locator('input[type="date"]');
    // Owner: no lower bound, nothing after today.
    expect(await date.getAttribute("min")).toBeNull();
    await expect(date).toHaveAttribute("max", today);
    await modal.getByPlaceholder("Description").fill(desc);
    await modal.locator('input[type="number"]').fill("321");
    await date.fill(past);
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    const exp = await waitForOne("expenses", { description: desc });
    expect(exp.data.date).toBe(past);
    expect(exp.data.amount).toBe(321);
    expect(exp.data.createdBy).toBe(owner.uid);
    expect(isTimestamp(exp.data.createdAtServer)).toBe(true);

    // Not in "Today"; listed under "Last 7 days" — and the owner can edit it.
    await page.getByRole("button", { name: "Last 7 days" }).click();
    const row = page.locator("div.flex.items-center.rounded-xl.bg-white").filter({ hasText: desc });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(past);
    await row.getByRole("button", { name: "Edit" }).click();
    const editModal = page.locator("div.panel").filter({ has: page.getByRole("heading", { name: "Edit expense" }) });
    await editModal.locator('input[type="number"]').fill("300");
    await editModal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editModal).toBeHidden({ timeout: 15_000 });
    const edited = await waitForOne("expenses", { description: desc }, (d) => d.data.amount === 300);
    expect(edited.data.date).toBe(past);
    expect(edited.data.updatedBy).toBe(owner.uid);
    await context.close();
  });
});

/**
 * Staff expenses: dated TODAY only, edit / delete only their OWN expenses
 * (until that day ends). An expense the owner added is read-only for staff.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  commitAs,
  deleteWrite,
  getDoc,
  isTimestamp,
  karachiDateKey,
  newSession,
  ownerToken,
  Pos,
  shiftDateKey,
  staffToken,
  tag,
  updateWrite,
  waitForGone,
  waitForOne,
} from "./support";

/** Owner adds an expense on /admin/expenses. */
async function ownerAddsExpense(page: Page, opts: { desc: string; amount: number; date?: string }) {
  await page.goto("/admin/expenses");
  await expect(page.getByRole("heading", { name: "Expenses", level: 1 })).toBeVisible({ timeout: 30_000 });
  // Wait for the branch list (owner's branch filter) — see the "Add expense before
  // branches load" bug in admin-expenses-race.spec.ts.
  await expect(page.locator("select", { has: page.locator("option", { hasText: "All branches" }) })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Add expense" }).click();
  const modal = page.locator("div.panel").filter({ has: page.getByRole("heading", { name: "Add expense" }) });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder("Description").fill(opts.desc);
  await modal.locator('input[type="number"]').fill(String(opts.amount));
  if (opts.date) await modal.locator('input[type="date"]').fill(opts.date);
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

test.describe("staff expenses", () => {
  test("staff adds today only, edits and deletes their own; owner's expense is read-only", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const today = karachiDateKey();
    const staff = await staffToken();
    const owner = await ownerToken();

    // Owner's expense for today (so it is in the staff's default "Today" list).
    const ownerDesc = tag("owner-exp");
    const ownerSession = await newSession(browser, "owner");
    await ownerAddsExpense(ownerSession.page, { desc: ownerDesc, amount: 123 });
    const ownerExp = await waitForOne("expenses", { description: ownerDesc });
    expect(ownerExp.data.createdBy).toBe(owner.uid);
    expect(ownerExp.data.date).toBe(today);
    await ownerSession.context.close();

    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    let sheet = await pos.openExpenses();

    // Date picker for a new entry: today only (min = max = today).
    const formDate = sheet.locator('form input[type="date"]');
    await expect(formDate).toHaveAttribute("min", today);
    await expect(formDate).toHaveAttribute("max", today);
    await expect(formDate).toHaveValue(today);

    // The owner's row: visible, but no edit / delete for staff.
    const ownerRow = sheet.locator("li").filter({ hasText: ownerDesc });
    await expect(ownerRow).toBeVisible({ timeout: 30_000 });
    await expect(ownerRow.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(ownerRow.getByRole("button", { name: "Delete" })).toHaveCount(0);

    // Back-dating is refused by the app even if the input is forced.
    const desc = tag("staff-exp");
    await sheet.locator('form input[type="number"]').fill("77");
    await sheet.getByLabel("Description").fill(desc);
    await formDate.fill(shiftDateKey(today, -1));
    await expect(sheet.getByRole("button", { name: /Add expense/ })).toBeDisabled();
    await formDate.fill(today);

    // ── Add ──
    const add = sheet.getByRole("button", { name: /Add expense/ });
    await expect(add).toBeEnabled();
    await add.click();
    const row = sheet.locator("li").filter({ hasText: desc });
    await expect(row).toBeVisible();

    const created = await waitForOne("expenses", { description: desc }, (d) => isTimestamp(d.data.syncedAtServer));
    expect(created.data.createdBy).toBe(staff.uid);
    expect(created.data.date).toBe(today);
    expect(created.data.amount).toBe(77);
    expect(created.data.branchId).toBe("main");
    await expect(row.locator('[aria-label="Pending sync"]')).toHaveCount(0, { timeout: 45_000 });

    // ── Edit (own) ──
    await row.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit expense" });
    await expect(edit).toBeVisible();
    // Staff keep the day an expense was filed under: the date can't be changed on edit.
    await expect(edit.locator('input[type="date"]')).toBeDisabled();
    await expect(edit.locator('input[type="date"]')).toHaveValue(today);
    await edit.locator('input[type="number"]').fill("88");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toBeHidden();

    const edited = await waitForOne("expenses", { description: desc }, (d) => d.data.amount === 88);
    expect(edited.data.updatedBy).toBe(staff.uid);
    expect(edited.data.createdBy).toBe(staff.uid);
    expect(edited.id).toBe(created.id);
    await expect(row.locator('[aria-label="Pending sync"]')).toHaveCount(0, { timeout: 45_000 });

    // ── Delete (own) ──
    await row.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete this expense?" });
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row).toHaveCount(0);
    await waitForGone(`expenses/${created.id}`);

    // Activity log has the staff's add / edit / delete.
    for (const action of ["create", "update", "delete"]) {
      await waitForOne("activityLogs", { entityId: created.id, action }, (d) => d.data.createdBy === staff.uid);
    }

    // Server refuses changing the owner's expense directly.
    const path = `expenses/${ownerExp.id}`;
    const patch = await commitAs(staff.idToken, [
      updateWrite(path, { amount: 1, updatedBy: staff.uid }, { mask: ["amount", "updatedBy"] }),
    ]);
    expect(patch.status, patch.body).toBe(403);
    const del = await commitAs(staff.idToken, [deleteWrite(path)]);
    expect(del.status, del.body).toBe(403);
    expect((await getDoc(path))?.data.amount).toBe(123);

    // Staff admin Expenses page: same rules (owner's row has no controls).
    await page.goto("/admin/expenses");
    const adminRow = page.locator("div.flex.items-center.rounded-xl.bg-white").filter({ hasText: ownerDesc });
    await expect(adminRow).toBeVisible({ timeout: 30_000 });
    await expect(adminRow.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(adminRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add expense" }).click();
    const modal = page.locator("div.panel").filter({ has: page.getByRole("heading", { name: "Add expense" }) });
    await expect(modal.locator('input[type="date"]')).toHaveAttribute("min", today);
    await expect(modal.locator('input[type="date"]')).toHaveAttribute("max", today);
    await modal.getByRole("button", { name: "Cancel" }).click();

    // Re-open the POS sheet: still listed for staff, still locked.
    await pos.goto();
    sheet = await pos.openExpenses();
    await expect(sheet.locator("li").filter({ hasText: ownerDesc })).toBeVisible({ timeout: 30_000 });
    await context.close();
  });
});

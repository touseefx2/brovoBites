/**
 * Regression probe: on /admin/expenses, "Add expense" opened before the branch
 * list has loaded. The modal then shows the (single) branch name, but the form
 * kept an empty branch — Save stays disabled until the modal is closed and
 * reopened. A slow network (or a quick click) is enough to hit it.
 */
import { expect, test } from "@playwright/test";
import { newSession, tag } from "./support";

test("owner: Add expense opened while branches load can still be saved", async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await newSession(browser, "owner");

  // Slow Firestore down (emulator traffic only) so the click lands before
  // fetchBranches() returns — what a slow shop connection does.
  let slow = true;
  await page.route(/127\.0\.0\.1:8080/, async (route) => {
    if (slow) await new Promise((r) => setTimeout(r, 2500));
    await route.continue().catch(() => {});
  });

  await page.goto("/admin/expenses");
  const addBtn = page.getByRole("button", { name: "Add expense" });
  await expect(addBtn).toBeVisible({ timeout: 30_000 });
  await addBtn.click();
  slow = false;

  const modal = page.locator("div.panel").filter({ has: page.getByRole("heading", { name: "Add expense" }) });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder("Description").fill(tag("race"));
  await modal.locator('input[type="number"]').fill("10");

  // Once the branch has loaded the modal shows it…
  await expect(modal).toContainText("Bravo Bites — Main", { timeout: 30_000 });
  // …so saving must be possible without closing and reopening the form.
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 5_000 });

  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await context.close();
});

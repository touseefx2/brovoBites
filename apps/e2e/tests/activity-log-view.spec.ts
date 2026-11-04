/**
 * Activity logs read plainly: an order edit shows the bill before → after and
 * what changed — also for older logs that only kept a line of text — and an
 * expense edit shows its fields before / after.
 */
import { expect, test } from "@playwright/test";
import { commitAdmin, deleteWrite, newSession, ownerToken, tag, updateWrite } from "./support";

test("activity page: order edit and expense edit read as before → after", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await ownerToken();
  const now = new Date().toISOString();
  const num = 9_500_000 + Math.floor(Math.random() * 400_000);
  const legacy = tag("log-legacy");
  const expense = tag("log-expense");
  const log = (id: string, f: Record<string, unknown>) =>
    updateWrite(
      `activityLogs/${id}`,
      { branchId: "main", createdBy: owner.uid, createdByName: "E2E Owner", createdAt: now, ...f },
      { exists: false },
    );
  const seeded = await commitAdmin([
    // Older log: text only.
    log(legacy, {
      entityType: "order",
      entityId: "legacy-order",
      action: "update",
      summary: `Edited order #${num} · Rs 1,200 → Rs 980 · by E2E Owner`,
      detail:
        "Added item: Fries ×2 · Removed item: Zinger (Large) ×1 · Payment: cash → card · Before: Zinger (Large) ×1 · After: Fries ×2",
    }),
    log(expense, {
      entityType: "expense",
      entityId: "exp-1",
      action: "update",
      summary: "Edited expense → Rs 800",
      detail: "Before: other · gas · Rs 500 · 2026-10-24 → After: other · gas cylinder · Rs 800 · 2026-10-24",
      change: {
        kind: "expense",
        before: { category: "other", description: "gas", amount: 500, date: "2026-10-24" },
        after: { category: "other", description: "gas cylinder", amount: 800, date: "2026-10-24" },
      },
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    const { context, page } = await newSession(browser, "owner");
    await page.goto("/activity?type=order");
    const row = page.locator("li").filter({ hasText: `Order #${num}` });
    await expect(row).toContainText("Rs 220 less", { timeout: 30_000 });
    await expect(row).toContainText("Added: Fries ×2");
    await expect(row).toContainText("Removed: Zinger (Large) ×1");
    await expect(row.locator('[data-kind="field"]')).toContainText(/Payment:\s*Cash\s*→\s*Card/);
    await row.getByRole("button", { name: /Show full bill/ }).click();
    await expect(row).toContainText("Before");
    await expect(row).toContainText("After");

    await page.goto("/activity?type=expense");
    const exp = page.locator("li").filter({ hasText: "gas cylinder" });
    await expect(exp).toContainText("Rs 500", { timeout: 30_000 });
    await expect(exp).toContainText("Rs 800");
    await expect(exp.locator("tr").filter({ hasText: "Description" })).toContainText("gas cylinder");
    await context.close();
  } finally {
    await commitAdmin([deleteWrite(`activityLogs/${legacy}`), deleteWrite(`activityLogs/${expense}`)]);
  }
});

/** Day End Report opens on Today; other periods and custom dates on demand. */
import { expect, test } from "@playwright/test";
import { newSession } from "./support";

test("day end report: Today by default, presets and custom dates", async ({ browser }) => {
  const { context, page } = await newSession(browser, "owner");
  await page.goto("/admin/day-report");
  const chip = (name: string) => page.getByRole("button", { name, exact: true });
  for (const name of ["Today", "Yesterday", "Last 7 days", "This month", "All time", "Custom"]) {
    await expect(chip(name)).toBeVisible({ timeout: 30_000 });
  }
  await expect(chip("Today")).toHaveClass(/is-active/);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Today's sales" })).toBeVisible();

  for (const name of ["This month", "All time", "Yesterday"]) {
    await chip(name).click();
    await expect(chip(name)).toHaveClass(/is-active/);
    await expect(page.getByRole("heading", { name: "Total", exact: true })).toBeVisible();
  }

  await chip("Custom").click();
  await expect(page.locator('input[type="date"]')).toHaveCount(2);
  await context.close();
});

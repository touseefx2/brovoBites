import { expect, test } from "@playwright/test";
import { login, OWNER_EMAIL, PASSWORD, STAFF_EMAIL } from "./helpers";

test.describe("owner vs staff", () => {
  test("owner reaches admin dashboard and menu", async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.goto("/admin");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.goto("/admin/menu");
    await expect(page.getByRole("heading", { name: /menu/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: /add/i }).first()).toBeVisible();
  });

  test("staff cannot open landing settings or staff admin", async ({ page }) => {
    await login(page, STAFF_EMAIL, PASSWORD);
    await page.goto("/admin/landing");
    await expect(page).not.toHaveURL(/\/admin\/landing/);
    await page.goto("/admin/staff");
    await expect(page).not.toHaveURL(/\/admin\/staff/);
  });

  test("staff can open POS and the read-only menu", async ({ page }) => {
    await login(page, STAFF_EMAIL, PASSWORD);
    await page.goto("/admin/menu");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /add menu item/i })).toHaveCount(0);
    await page.goto("/pos");
    await expect(page.locator("body")).toContainText(/POS|Checkout|Cart|Menu/i);
  });
});

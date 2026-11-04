import { expect, test } from "@playwright/test";
import { login, PASSWORD, STAFF_EMAIL } from "./helpers";

test.describe("phone viewport", () => {
  test("POS header and cart stay inside the viewport", async ({ page }) => {
    await login(page, STAFF_EMAIL, PASSWORD);
    await page.goto("/pos");
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 8;
    });
    expect(overflow).toBe(false);
    await expect(page.locator("body")).toBeVisible();
  });
});

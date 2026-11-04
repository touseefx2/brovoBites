import { expect, type Page } from "@playwright/test";

export const OWNER_EMAIL =
  process.env.E2E_OWNER_EMAIL || "e2e.owner@bravobites.test";
export const STAFF_EMAIL =
  process.env.E2E_STAFF_EMAIL || "e2e.staff@bravobites.test";
export const PASSWORD = process.env.E2E_PASSWORD || "E2ePass123!";

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

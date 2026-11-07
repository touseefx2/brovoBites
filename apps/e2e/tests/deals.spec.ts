import { expect, test } from "@playwright/test";
import { login, OWNER_EMAIL, PASSWORD } from "./helpers";

const DEAL = "10. Mega Family Deal";

test.describe("deals", () => {
  test("a category of only deals shows deal cards on the website", async ({ page }) => {
    test.setTimeout(150_000); // the first page of a fresh dev server compiles slowly
    await page.goto("/");
    const card = page.locator(".landing-deal", { hasText: DEAL });
    await expect(card).toBeAttached({ timeout: 120_000 });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card.locator(".landing-deal-lines li").first()).toBeVisible();
    await expect(card.locator(".landing-price-badge")).toBeVisible();

    // The menu's two parts have their big titles; while searching, only results show.
    await expect(page.getByRole("heading", { name: "TOP DEALS" }).first()).toBeAttached();
    await expect(page.getByRole("heading", { name: "ALA-CARTE" }).first()).toBeAttached();
    await page.locator(".landing-menu-search-input").fill("deal");
    await expect(page.locator(".landing-part-title")).toHaveCount(0);

    // The shop's social accounts are in the footer, opening in a new tab.
    for (const [name, href] of [
      ["Facebook", "https://www.facebook.com/brovobites"],
      ["Instagram", "https://www.instagram.com/brovobites"],
      ["TikTok", "https://www.tiktok.com/@brovobites"],
      ["YouTube", "https://www.youtube.com/@brovobites"],
    ]) {
      const link = page.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
    }
  });

  test("deal lines that aren't menu items survive an admin edit", async ({ page, request }) => {
    const lines = async () => {
      const res = await request.get("/api/public/menu?fresh=1");
      const menu = (await res.json()) as {
        products: { name: string; dealItems: { label: string; productId?: string }[] }[];
      };
      return menu.products.find((p) => p.name === DEAL)!.dealItems;
    };
    const before = await lines();
    const unlinked = before.filter((d) => !d.productId).map((d) => d.label);
    expect(unlinked.length).toBeGreaterThan(0);

    await login(page, OWNER_EMAIL, PASSWORD);
    await page.goto("/admin/menu");
    const card = page.locator("article", { hasText: DEAL }).first();
    const href = await card.locator('a[href*="/edit"]').first().getAttribute("href");
    await page.goto(href!);

    // Free-text lines are shown as text, not as an empty "pick an item" that blocks saving.
    const first = page.locator(`input[type="text"][value="${unlinked[0]}"]`);
    await expect(first).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /add custom line/i }).click();
    await page.locator('input[placeholder*="Regular Fries"]').last().fill("E2E Juice Pack");
    // A linked line keeps the wording it was given, not the menu item's name.
    await page.getByRole("button", { name: /^add line$/i }).click();
    await page.getByRole("textbox", { name: /name shown on the menu/i }).last().fill("E2E Crunchy Item");
    await page.locator('button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/edit/, { timeout: 20_000 });

    const saved = await lines();
    const after = saved.map((d) => d.label);
    for (const label of unlinked) expect(after).toContain(label);
    expect(after).toContain("E2E Juice Pack");
    expect(saved.find((d) => d.label === "E2E Crunchy Item")?.productId).toBeTruthy();
  });
});

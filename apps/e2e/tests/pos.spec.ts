import { expect, test } from "@playwright/test";
import { login, PASSWORD, STAFF_EMAIL } from "./helpers";
import { isTimestamp, Pos, tag, waitForOne } from "./support";

test.describe("POS checkout", () => {
  test("staff can add a product and open checkout preview", async ({ page }) => {
    await login(page, STAFF_EMAIL, PASSWORD);
    await page.goto("/pos");

    // A real menu card — not any button whose text happens to contain "rs"
    // (that matched "Recent orders" and never added anything).
    const product = page
      .locator(".pos-product-card", {
        has: page.locator(".pos-product-name", { hasText: /^Classic Zinger$/ }),
      })
      .first();
    await expect(product).toBeVisible({ timeout: 45_000 });
    await product.click();

    // The cart now holds the line and Review bill is enabled.
    await expect(page.locator(".pos-cart-thumb").first()).toBeVisible();
    const review = page.getByRole("button", { name: "Review bill" });
    await expect(review).toBeEnabled();
    await review.click();

    const preview = page.getByRole("dialog", { name: "Receipt preview" });
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview.getByRole("button", { name: "Checkout", exact: true })).toBeVisible();

    // Leave without saving a sale.
    await preview.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(preview).toBeHidden();
  });

  test("checkout with Print bill on saves the sale, clears the cart and starts a print job", async ({ page }) => {
    // The path a shop PC takes on Vercel, where the server has no printer. It also keeps test
    // slips away from a real printer on a machine that has one.
    await page.route("**/api/local-print", (r) => r.fulfill({ status: 500, body: "" }));
    await login(page, STAFF_EMAIL, PASSWORD);
    const pos = new Pos(page);
    await pos.goto();
    const customer = tag("print-on");
    await pos.addProduct("Special Sandwich");
    await pos.addProduct("Mineral Water 500ml");
    await pos.checkout({ customer }); // print switch left on (default)

    // The server can't print, so the receipt goes to a hidden print iframe; the cart is empty again.
    await expect(page.locator("iframe[data-print-job]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Review bill" })).toBeDisabled();
    const order = await waitForOne("orders", { customerName: customer }, (d) => isTimestamp(d.data.syncedAtServer));
    expect(order.data.total).toBe(580);
    expect((order.data.items as unknown[]).length).toBe(2);
  });
});

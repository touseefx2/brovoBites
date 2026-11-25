/**
 * Changing a deal at the counter and custom deals, end to end on the POS:
 * Customize a menu deal (take an item out, loose nugget pieces, a size) →
 * receipt copies list what's inside → the saved order carries it; a custom
 * deal → changed again from Recent orders; staff without discount permission
 * can't price under the menu; the report counts what went out inside deals.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  acknowledgeSuccess,
  commitAdmin,
  confirmAlert,
  newSession,
  Pos,
  serialOnly,
  staffToken,
  tag,
  updateWrite,
  waitForOne,
} from "./support";

const DEAL = "1. Solo Zinger Deal"; // Rs 580: Classic Zinger, Half Fries, Regular Bottle
/** Set E2E_SHOTS=<folder> to save screenshots of the new report views. */
const SHOTS = process.env.E2E_SHOTS;

type Part = { label: string; qty: number; pieces?: number; pack?: number; price?: number; productId?: string; variationId?: string };
type Item = { productId: string; productName: string; unitPrice: number; qty: number; lineTotal: number; parts?: Part[]; changed?: boolean };

function editor(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.locator("#deal-editor-title") });
}

function tile(ed: Locator, name: string): Locator {
  return ed.locator(".pos-deal-tile", { has: ed.page().locator(".pos-deal-tile-name", { hasText: new RegExp(`^${name}$`) }) });
}

/** An added row, found by the name it will print ("Nuggets (", "Fries ("). */
function addedRow(ed: Locator, printed: RegExp): Locator {
  return ed.locator(".pos-deal-row.is-added", { has: ed.page().locator(".pos-deal-row-print", { hasText: printed }) });
}

test.describe("deal customize", () => {
  test("change a menu deal: receipts, saved order, stock-ready parts", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await newSession(browser, "owner");
    // Test slips never reach a real printer (counter-Mac helper / local print route).
    await page.route("http://127.0.0.1:17800/**", (r) => r.abort());
    await page.route("**/api/local-print", (r) => r.fulfill({ status: 500, body: "" }));
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();

    await pos.addProduct(DEAL);
    const cartLine = page.locator(".pos-cart-aside .pos-cart-line", { hasText: DEAL });
    await cartLine.getByRole("button", { name: "Customize" }).click();
    const ed = editor(page);
    await expect(ed).toBeVisible();

    // Take the drink out of the deal.
    const bottle = ed.locator(".pos-deal-row", { hasText: "Regular Bottle" });
    await bottle.getByRole("button", { name: "−" }).click();
    await expect(bottle).toContainText("Removed");

    // Nuggets (sizes "6 pcs" / "12 pcs") come as a 6-piece pack, sold here as 3 pieces.
    await tile(ed, "Nuggets").click();
    const nug = addedRow(ed, /^Nuggets \(/);
    await expect(nug.locator(".pos-deal-row-print")).toHaveText("Nuggets (6 pcs)");
    await nug.locator(".pos-deal-pcs", { hasText: /^3$/ }).click();
    await expect(nug.locator(".pos-deal-row-print")).toHaveText("Nuggets (3 pcs)");
    await expect(nug.locator(".pos-deal-money input")).toHaveValue("225"); // 450 / 6 × 3

    // Fries: a size, switchable on the row — the price follows it.
    await tile(ed, "Fries").click();
    const fries = addedRow(ed, /^Fries \(/);
    await expect(fries.locator(".pos-deal-money input")).toHaveValue("180");
    await fries.getByRole("button", { name: "Full", exact: true }).click();
    await expect(fries.locator(".pos-deal-row-print")).toHaveText("Fries (Full)");
    await expect(fries.locator(".pos-deal-money input")).toHaveValue("250");

    await expect(ed.locator(".pos-deal-foot .pos-cart-total-amount")).toHaveText("Rs 1,055"); // 580 + 225 + 250
    await ed.getByRole("button", { name: /Save changes/ }).click();
    await expect(ed).toBeHidden();

    // The cart line says what changed.
    await expect(cartLine).toContainText("Changed");
    await expect(cartLine).toContainText("No Regular Bottle");
    await expect(cartLine).toContainText("Nuggets (3 pcs)");
    await expect(cartLine).toContainText("Rs 1,055");

    // Every copy lists what's inside; the kitchen sees it was changed.
    const customer = tag("deal-change");
    await page.getByRole("button", { name: "Review bill" }).click();
    const dlg = page.getByRole("dialog", { name: "Receipt preview" });
    await expect(dlg).toBeVisible();
    const receipt = dlg.frameLocator('iframe[title="Receipt preview"]').locator("body");
    await expect(receipt).toContainText("1x Classic Zinger");
    await expect(receipt).toContainText("No Regular Bottle");
    await expect(receipt).toContainText("Nuggets (3 pcs)");
    await expect(receipt).toContainText("1x Fries (Full)");
    await expect(receipt).toContainText("(CHANGED)");
    await dlg.locator("#checkout-customer-name").fill(customer);
    const sw = dlg.getByRole("switch").last();
    if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
    await dlg.getByRole("button", { name: "Checkout", exact: true }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });

    const order = await waitForOne("orders", { customerName: customer }, (d) => d.data.total === 1055);
    const [item] = order.data.items as Item[];
    expect(item!.changed).toBe(true);
    expect(item!.unitPrice).toBe(1055);
    const byLabel = new Map(item!.parts!.map((p) => [p.label, p]));
    expect(byLabel.get("Regular Bottle")?.qty).toBe(0);
    expect(byLabel.get("Nuggets (3 pcs)")).toMatchObject({ qty: 1, pieces: 3, pack: 6, price: 225 });
    expect(byLabel.get("Fries (Full)")).toMatchObject({ qty: 1, price: 250, variationId: "full" });

    // A plain menu deal sold now also carries its contents (receipts, report).
    const plainCustomer = tag("deal-plain");
    const plain = await pos.sell(DEAL, plainCustomer);
    const [plainItem] = plain.data.items as Item[];
    expect(plainItem!.changed).toBe(false);
    expect(plainItem!.parts!.map((p) => p.label)).toEqual(["Classic Zinger", "Half Fries", "Regular Bottle"]);

    // Report: Menu Sales keeps the billed lines; Items Made adds alone + inside deals.
    await pos.toolbar().locator("button", { hasText: "Report" }).click();
    const report = page.getByRole("dialog", { name: "Day End Report" });
    await report.getByRole("tab", { name: /Menu Sales/ }).click();
    await expect(report.getByRole("table").getByText(DEAL).first()).toBeVisible({ timeout: 30_000 });
    await report.getByRole("tab", { name: /Items Made/ }).click();
    const made = report.getByRole("table", { name: "Items Made" });
    await expect(made).toBeVisible({ timeout: 30_000 });
    // Both deals sold here had a Classic Zinger inside: ≥ 2 in deals, and Total = Alone + In deals.
    const zingerRow = made.locator('tr[data-item="Classic Zinger"]');
    await expect(zingerRow).toHaveCount(1);
    const cell = async (col: string) => Number((await zingerRow.locator(`[data-col="${col}"]`).innerText()).replace("—", "0"));
    expect(await cell("deals")).toBeGreaterThanOrEqual(2);
    expect(await cell("total")).toBe((await cell("alone")) + (await cell("deals")));
    // Nuggets (sizes "6 pcs" / "12 pcs") count in pieces: the 3 loose pieces of the changed deal at least.
    await expect(made.locator('tr[data-item="Nuggets"] [data-col="deals"]')).toContainText("pcs");
    if (SHOTS) await report.screenshot({ path: `${SHOTS}/pos-items-made.png` });
    await report.getByRole("tab", { name: /Menu Sales/ }).click();
    if (SHOTS) await report.screenshot({ path: `${SHOTS}/pos-menu-sales.png` });

    // Admin → Item Sales: Menu Sales | Items Made, same numbers.
    await page.goto("/admin/item-sales");
    await page.getByRole("tab", { name: "Items Made" }).click();
    const adminMade = page.getByRole("table", { name: "Items Made" });
    await expect(adminMade.locator('tr[data-item="Classic Zinger"]')).toHaveCount(1, { timeout: 30_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-items-made.png`, fullPage: true });
    await context.close();
  });

  test("custom deal, then changed again from Recent orders", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await newSession(browser, "owner");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();

    await page.getByRole("button", { name: /Custom deal/ }).click();
    const ed = editor(page);
    await expect(ed).toBeVisible();
    await ed.locator("#deal-editor-title").fill("Phone Combo");
    await tile(ed, "Classic Zinger").click();
    await tile(ed, "Nuggets").click();
    const nug = addedRow(ed, /^Nuggets \(/);
    await nug.locator(".pos-deal-pcs", { hasText: /^2$/ }).click();
    await expect(nug.locator(".pos-deal-money input")).toHaveValue("150");
    await nug.locator(".pos-deal-money input").fill("120"); // owner may price under the menu
    await expect(ed.locator(".pos-deal-blocked")).toHaveCount(0);
    await ed.getByRole("button", { name: /Add to order/ }).click();
    await expect(ed).toBeHidden();

    const customer = tag("custom-deal");
    await pos.checkout({ customer, print: false });
    const sale = await waitForOne("orders", { customerName: customer }, (d) => Boolean(d.data.syncedAtServer));
    const [item] = sale.data.items as Item[];
    expect(item).toMatchObject({ productId: "custom-deal", productName: "Phone Combo", unitPrice: 500, changed: true });
    expect(item!.parts!.map((p) => p.label)).toEqual(["Classic Zinger", "Nuggets (2 pcs)"]);
    await pos.waitAllSynced(60_000);

    // Recent orders → Customize the custom deal → one more Classic Zinger.
    const sheet = await pos.openOrder(customer);
    await expect(sheet).toContainText("Nuggets (2 pcs)");
    await sheet.getByRole("button", { name: "Customize" }).click();
    const ed2 = editor(page);
    await expect(ed2).toBeVisible();
    await expect(ed2.locator("#deal-editor-title")).toHaveValue("Phone Combo");
    const zinger = ed2.locator(".pos-deal-row.is-added").first(); // added first: Classic Zinger
    await expect(zinger.locator('input[aria-label="Item name"]')).toHaveValue("Classic Zinger");
    await zinger.getByRole("button", { name: "+" }).click();
    await expect(ed2.locator(".pos-deal-foot .pos-cart-total-amount")).toHaveText("Rs 880"); // 380 × 2 + 120
    await ed2.getByRole("button", { name: /Save changes/ }).click();
    await expect(ed2).toBeHidden();

    await sheet.getByRole("button", { name: "Save changes" }).click();
    await confirmAlert(page, "Save order changes?");
    await acknowledgeSuccess(page, "Order updated");
    const edited = await waitForOne("orders", { customerName: customer }, (d) => d.data.total === 880);
    const [after] = edited.data.items as Item[];
    expect(after!.parts!.find((p) => p.label === "Classic Zinger")).toMatchObject({ qty: 2, price: 760 });
    await context.close();
  });

  test("staff without discount permission can't price a deal under the menu", async ({ browser }) => {
    test.setTimeout(150_000);
    serialOnly();
    const staff = await staffToken();
    const setDiscount = async (on: boolean) => {
      const res = await commitAdmin([
        updateWrite(
          `users/${staff.uid}`,
          {
            permissions: {
              canAddExpenses: true,
              canDeleteExpenses: true,
              canApplyDiscount: on,
              canEditOrders: true,
              canCancelOrders: true,
              canManageInventory: true,
            },
          },
          { mask: ["permissions"] },
        ),
      ]);
      expect(res.status, res.body).toBe(200);
    };
    await setDiscount(false);
    try {
      const { context, page } = await newSession(browser, "staff");
      const pos = new Pos(page);
      await pos.goto();
      await pos.addProduct(DEAL);
      await page.locator(".pos-cart-aside .pos-cart-line", { hasText: DEAL }).getByRole("button", { name: "Customize" }).click();
      const ed = editor(page);
      const base = ed.locator(".pos-deal-row", { hasText: "Deal price" }).locator(".pos-deal-money input");
      await base.fill("500");
      await expect(ed.locator(".pos-deal-blocked")).toBeVisible();
      await expect(ed.getByRole("button", { name: /Save changes/ })).toBeDisabled();
      // Raising the price is fine.
      await base.fill("650");
      await expect(ed.locator(".pos-deal-blocked")).toHaveCount(0);
      await expect(ed.getByRole("button", { name: /Save changes/ })).toBeEnabled();
      // No more of the deal's own items than it comes with (that would be free food)…
      const zinger = ed.locator(".pos-deal-row", { hasText: "Classic Zinger" });
      await expect(zinger.getByRole("button", { name: "+" })).toBeDisabled();
      // …and an added item's name can't be changed (a cheap item renamed to a dear one).
      await tile(ed, "Fries").click();
      await expect(addedRow(ed, /^Fries \(/).locator('input[aria-label="Item name"]')).toHaveAttribute("readonly", "");
      await context.close();
    } finally {
      await setDiscount(true);
    }
  });
});

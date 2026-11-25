/**
 * Customers end to end: a sale with a phone (typed in any shape) makes a
 * customer, rebuilt from the orders by the server; the next checkout finds
 * them by phone or name (also offline, from this PC's copy) and fills the
 * fields; the counter note is saved; Admin → Customers lists them with their
 * orders. Staff see full numbers but not the owner's tools.
 */
import { expect, test, type Page } from "@playwright/test";
import { acknowledgeSuccess, confirmAlert, getDoc, newSession, Pos, tag, waitForOne, type Json } from "./support";

const ITEM = "Classic Zinger"; // Rs 380

/** A fresh number each run (03 + 9 digits). */
function freshPhone(): { typed: string; key: string } {
  const nine = String(Math.floor(100_000_000 + Math.random() * 899_999_999));
  const key = `03${nine}`;
  // Typed the way WhatsApp pastes it: +92, spaces, invisible direction marks.
  return { typed: `‪+92 ${key.slice(1, 4)} ${key.slice(4)}‬`, key };
}

async function customer(key: string): Promise<Json | null> {
  return (await getDoc(`customers/${key}`))?.data ?? null;
}

async function openCheckout(page: Page) {
  await page.getByRole("button", { name: "Review bill" }).click();
  const dlg = page.getByRole("dialog", { name: "Receipt preview" });
  await expect(dlg).toBeVisible();
  return dlg;
}

async function finishCheckout(page: Page, dlg: ReturnType<Page["getByRole"]>) {
  const sw = dlg.getByRole("switch").last();
  if ((await sw.getAttribute("aria-checked")) === "true") await sw.click(); // no print in tests
  const btn = dlg.getByRole("button", { name: "Checkout", exact: true });
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  await btn.click();
  await expect(dlg).toBeHidden({ timeout: 15_000 });
}

test.describe("customers", () => {
  test("sale → customer; next checkout finds them by phone or name, also offline; note saved", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await newSession(browser, "owner");
    await page.route("http://127.0.0.1:17800/**", (r) => r.abort());
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();

    const name = tag("Cust Ali");
    const phone = freshPhone();

    // ── 1st sale: delivery, phone pasted from WhatsApp, address, a note ──
    await pos.addProduct(ITEM);
    let dlg = await openCheckout(page);
    await dlg.getByRole("button", { name: "Delivery", exact: true }).click();
    await dlg.locator("#checkout-customer-name").fill(name);
    await dlg.locator("#checkout-customer-phone").fill(phone.typed);
    await expect(dlg.getByTestId("checkout-customer-badge")).toHaveText("New customer");
    await dlg.locator("#checkout-delivery-address").fill("House 7, Street 3");
    await dlg.locator("#checkout-customer-note").fill("Gate 2, extra spicy");
    await finishCheckout(page, dlg);

    // The order carries the key; the server builds the customer from it.
    const sale1 = await waitForOne("orders", { customerName: name }, (d) => Boolean(d.data.syncedAtServer));
    expect(sale1.data.customerKey).toBe(phone.key);
    await expect.poll(async () => (await customer(phone.key))?.orderCount, { timeout: 60_000 }).toBe(1);
    const c1 = (await customer(phone.key))!;
    expect(c1).toMatchObject({ name, phone: phone.key, addresses: ["House 7, Street 3"], totalSpent: 380 });
    await expect.poll(async () => (await customer(phone.key))?.note, { timeout: 30_000 }).toBe("Gate 2, extra spicy");

    // ── 2nd sale: typing in the fields opens nothing; the arrow opens the saved customers ──
    await pos.addProduct(ITEM);
    dlg = await openCheckout(page);
    const phoneInput = dlg.locator("#checkout-customer-phone");
    await phoneInput.pressSequentially(phone.key.slice(0, 7));
    await expect(dlg.getByTestId("customer-picker")).toHaveCount(0);
    await phoneInput.fill("");
    await dlg.getByTestId("customer-picker-button").click();
    const picker = dlg.getByTestId("customer-picker");
    await expect(picker).toBeVisible();
    const search = picker.getByRole("searchbox");
    await expect(search).toBeFocused();
    await search.pressSequentially(phone.key.slice(0, 7)); // by number
    const row = picker.locator(`[data-customer="${phone.key}"]`);
    await expect(row).toContainText(name);
    await expect(row).toContainText("House 7, Street 3");
    await expect(row).toContainText("Gate 2, extra spicy");
    await search.press("Enter");
    await expect(picker).toHaveCount(0);
    // Dine-in: everything filled; the address waits (not on this bill).
    await expect(dlg.locator("#checkout-customer-name")).toHaveValue(name);
    await expect(phoneInput).toHaveValue(`${phone.key.slice(0, 4)} ${phone.key.slice(4)}`);
    await expect(dlg.getByTestId("checkout-customer-badge")).toContainText("Returning customer · 1 order");
    await expect(dlg.locator("#checkout-customer-note")).toHaveValue("Gate 2, extra spicy");
    await expect(dlg.locator("#checkout-delivery-address")).toHaveCount(0);
    await expect(dlg).not.toContainText("House 7, Street 3");
    // Delivery chosen afterwards: the address is already there, and on the bill.
    await dlg.getByRole("button", { name: "Delivery", exact: true }).click();
    await expect(dlg.locator("#checkout-delivery-address")).toHaveValue("House 7, Street 3");
    await finishCheckout(page, dlg);
    await expect.poll(async () => (await customer(phone.key))?.orderCount, { timeout: 60_000 }).toBe(2);

    // ── 3rd sale offline, dine-in: search by name (this PC's copy), checkout never waits ──
    await context.setOffline(true);
    await pos.addProduct(ITEM);
    dlg = await openCheckout(page);
    await dlg.getByTestId("customer-picker-button").click();
    await dlg.getByTestId("customer-picker").getByRole("searchbox").pressSequentially(name.slice(0, 8));
    const byName = dlg.getByTestId("customer-picker").getByRole("option").filter({ hasText: name });
    await expect(byName).toHaveCount(1);
    await byName.click();
    await expect(dlg.locator("#checkout-customer-phone")).toHaveValue(`${phone.key.slice(0, 4)} ${phone.key.slice(4)}`);
    await expect(dlg.getByTestId("checkout-customer-badge")).toContainText("2 orders");
    await finishCheckout(page, dlg);
    // Back online: the sale goes up and the customer counts it once.
    await context.setOffline(false);
    await pos.waitAllSynced(90_000);
    await expect.poll(async () => (await customer(phone.key))?.orderCount, { timeout: 90_000 }).toBe(3);
    expect((await customer(phone.key))!.totalSpent).toBe(1140);
    // The dine-in sale carries no address (it was filled, but only Delivery puts it on the order).
    const sales = await waitForOne("orders", { customerName: name, orderType: "dine-in" }, (d) => Boolean(d.data.syncedAtServer));
    expect(sales.data.deliveryAddress ?? "").toBe("");
    await context.close();
  });

  test("Admin → Customers: search, numbers, orders, note; staff see it without the owner's tools", async ({ browser }) => {
    test.setTimeout(180_000);
    // A customer made through a real sale (as staff).
    const { context: sc, page: sp } = await newSession(browser, "staff");
    await sp.route("http://127.0.0.1:17800/**", (r) => r.abort());
    const pos = new Pos(sp);
    await pos.goto();
    await pos.waitCounterReady();
    const name = tag("Cust Sara");
    const phone = freshPhone();
    await pos.addProduct(ITEM);
    const dlg = await openCheckout(sp);
    await dlg.locator("#checkout-customer-name").fill(name);
    await dlg.locator("#checkout-customer-phone").fill(phone.key);
    await finishCheckout(sp, dlg);
    await expect.poll(async () => (await customer(phone.key))?.orderCount, { timeout: 60_000 }).toBe(1);

    // Staff: the list with the full number, the sheet and orders, no rename/merge/recount.
    await sp.goto("/admin/customers");
    await sp.getByPlaceholder("Search name or phone…").fill(phone.key.slice(-4));
    const row = sp.locator(`[data-customer="${phone.key}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(`${phone.key.slice(0, 4)} ${phone.key.slice(4)}`);
    await row.click();
    const sheet = sp.getByRole("dialog", { name });
    await expect(sheet.getByTestId("customer-orders")).toContainText(name);
    await expect(sheet.getByText("Change name")).toHaveCount(0);
    await expect(sp.getByRole("button", { name: "Recount from orders" })).toHaveCount(0);
    // Staff write the note.
    await sheet.locator("#customer-note").fill("Calls ahead");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await customer(phone.key))?.note, { timeout: 30_000 }).toBe("Calls ahead");
    await sc.close();

    // Owner: renames (kept over the orders' name) and sees the KPIs.
    const { context: oc, page: op } = await newSession(browser, "owner");
    await op.goto("/admin/customers");
    await op.getByPlaceholder("Search name or phone…").fill(name);
    await op.locator(`[data-customer="${phone.key}"]`).click();
    const osheet = op.getByRole("dialog", { name });
    await osheet.locator("#customer-name").fill(`${name} Khan`);
    await osheet.getByRole("button", { name: "Save" }).last().click();
    await expect.poll(async () => (await customer(phone.key))?.name, { timeout: 30_000 }).toBe(`${name} Khan`);
    expect((await customer(phone.key))!.nameLocked).toBe(true);
    await expect(op.getByRole("button", { name: "Recount from orders" })).toBeVisible();
    await oc.close();
  });

  test("order edited later (name, phone), then cancelled: each customer recounted from its orders", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await newSession(browser, "owner");
    await page.route("http://127.0.0.1:17800/**", (r) => r.abort());
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    const A = freshPhone();
    const B = freshPhone();
    const n1 = tag("Edit One");
    const n2 = tag("Edit Two");

    // Two sales on number A (different names on the bill).
    for (const n of [n1, n2]) {
      await pos.addProduct(ITEM);
      const dlg = await openCheckout(page);
      await dlg.locator("#checkout-customer-name").fill(n);
      await dlg.locator("#checkout-customer-phone").fill(A.key);
      await finishCheckout(page, dlg);
      await waitForOne("orders", { customerName: n }, (d) => Boolean(d.data.syncedAtServer));
    }
    await expect.poll(async () => (await customer(A.key))?.orderCount, { timeout: 60_000 }).toBe(2);
    expect((await customer(A.key))!.name).toBe(n2); // newest bill's name leads

    const editCustomer = async (cardText: string, name: string, phone?: string) => {
      const sheet = await pos.openOrder(cardText);
      await sheet.getByRole("textbox", { name: /Customer name/ }).fill(name);
      if (phone) await sheet.getByRole("textbox", { name: /Customer phone/ }).fill(phone);
      await sheet.getByRole("button", { name: "Save changes" }).click();
      await confirmAlert(page, "Save order changes?");
      await acknowledgeSuccess(page, "Order updated");
      await expect(sheet).toBeHidden();
    };

    // Edit the 2nd sale: new name AND a new number (B) — it moves from A to B.
    await editCustomer(n2, `${n2} Khan`, B.typed);
    const moved = await waitForOne("orders", { customerName: `${n2} Khan` }, (d) => d.data.customerKey === B.key);
    expect(moved.data.customerKey).toBe(B.key);
    await expect.poll(async () => (await customer(B.key))?.orderCount, { timeout: 60_000 }).toBe(1);
    expect((await customer(B.key))!.name).toBe(`${n2} Khan`);
    await expect.poll(async () => (await customer(A.key))?.orderCount, { timeout: 60_000 }).toBe(1);
    expect((await customer(A.key))!).toMatchObject({ name: n1, totalSpent: 380 });

    // Edit the 1st sale's name only (same number): A's name follows the bill.
    await editCustomer(n1, `${n1} Ali`);
    await expect.poll(async () => (await customer(A.key))?.name, { timeout: 60_000 }).toBe(`${n1} Ali`);
    expect((await customer(A.key))!.orderCount).toBe(1);

    // Cancel B's only sale: B had no note, so B goes; A untouched.
    const sheet = await pos.openOrder(`${n2} Khan`);
    await sheet.getByRole("button", { name: "Cancel this order" }).click();
    await confirmAlert(page, "Cancel this order?");
    await acknowledgeSuccess(page, "Order cancelled");
    await expect.poll(async () => await customer(B.key), { timeout: 60_000 }).toBeNull();
    expect((await customer(A.key))!.orderCount).toBe(1);
    await context.close();
  });
});

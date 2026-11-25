/**
 * Payment status on orders: Paid (default) or Payment pending (the customer
 * pays later). A pending sale needs a name or phone, prints PAYMENT PENDING,
 * shows a badge, is not in the cash drawer and can't be refunded. Anyone of
 * the branch marks it paid later (any method) — then the drawer counts the
 * cash and a reprint says "Cash - PAID" + "Paid on". Only the owner sets it
 * back to pending. Pending sales and mark-paid also work offline.
 *
 * The first test shares the branch's drawer for today — run with --workers=1.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  acknowledgeSuccess,
  confirmAlert,
  getDoc,
  isTimestamp,
  newSession,
  orderSheet,
  Pos,
  queryDocs,
  serialOnly,
  staffToken,
  ownerToken,
  tag,
  waitForOne,
  type FsDoc,
} from "./support";

const ITEM = "Classic Zinger"; // Rs 380

/* ─────────────────────── printing ─────────────────────── */

/**
 * No printer: local print route 404 (as on Vercel), no counter-Mac helper, so
 * the receipt goes to a hidden print iframe. Its text is kept in
 * `window.__printJobs` (read right after the synchronous write, before the
 * iframe cleans itself up).
 */
async function capturePrints(page: Page) {
  await page.route("**/api/local-print", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("http://127.0.0.1:17800/**", (r) => r.abort());
  // On a Mac the POS asks before opening the browser print dialog — say yes.
  page.on("dialog", (d) => void d.accept());
  await page.addInitScript(() => {
    const w = window as unknown as { __printJobs: string[] };
    w.__printJobs = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof HTMLIFrameElement && n.hasAttribute("data-print-job")) {
            try {
              w.__printJobs.push((n.contentDocument?.body?.textContent ?? "").replace(/\s+/g, " "));
            } catch {
              w.__printJobs.push("");
            }
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function printJobs(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __printJobs?: string[] }).__printJobs ?? []);
}

/** Text of the last print job once there are `count` of them. */
async function waitPrintJob(page: Page, count: number): Promise<string> {
  await expect.poll(async () => (await printJobs(page)).length, { timeout: 30_000 }).toBe(count);
  return (await printJobs(page))[count - 1]!;
}

/* ─────────────────────── POS checkout ─────────────────────── */

async function openCheckout(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Review bill" }).click();
  const dlg = page.getByRole("dialog", { name: "Receipt preview" });
  await expect(dlg).toBeVisible();
  return dlg;
}

async function setPrint(dlg: Locator, on: boolean) {
  const sw = dlg.getByRole("switch").last();
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on));
}

async function chooseUnpaid(dlg: Locator) {
  await dlg.getByTestId("checkout-payment-pending").click();
  await expect(dlg.getByTestId("checkout-payment-pending")).toHaveAttribute("aria-checked", "true");
  await expect(dlg.getByTestId("checkout-unpaid-pill")).toHaveText("Payment pending");
}

async function clickCheckout(dlg: Locator) {
  const btn = dlg.getByRole("button", { name: "Checkout", exact: true });
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  await btn.click();
}

/** Sell ITEM as Payment pending (named customer, cash expected). */
async function sellUnpaid(page: Page, pos: Pos, customer: string, opts: { print: boolean }) {
  await pos.addProduct(ITEM);
  const dlg = await openCheckout(page);
  await chooseUnpaid(dlg);
  await dlg.locator("#checkout-customer-name").fill(customer);
  await setPrint(dlg, opts.print);
  await clickCheckout(dlg);
  await expect(dlg).toBeHidden({ timeout: 15_000 });
}

/* ─────────────────────── order sheet ─────────────────────── */

function paymentRow(sheet: Locator): Locator {
  return sheet.getByTestId("order-payment-row");
}

async function closeSheet(page: Page) {
  const sheet = orderSheet(page);
  if (await sheet.isVisible()) {
    await sheet.locator("header").getByRole("button", { name: "Close" }).click();
  }
  await expect(sheet).toBeHidden();
}

/** Order sheet → Mark as paid → method → confirm → OK. */
async function markPaid(page: Page, sheet: Locator, method: "Cash" | "Card" | "Online", amount: string) {
  const row = paymentRow(sheet);
  await row.getByRole("button", { name: "Mark as paid", exact: true }).click();
  await expect(row).toContainText("How was it paid?");
  // Starts on the order's expected method (cash here); pick another first, then the real one.
  await expect(row.getByRole("button", { name: "Cash", exact: true })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: method === "Card" ? "Online" : "Card", exact: true }).click();
  await row.getByRole("button", { name: method, exact: true }).click();
  await expect(row.getByRole("button", { name: method, exact: true })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: "Mark as paid", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Mark as paid" });
  await expect(confirm).toContainText(`Received ${amount} by ${method}?`);
  await confirmAlert(page, "Mark as paid");
  await acknowledgeSuccess(page, "Payment received");
  await closeSheet(page);
}

/* ─────────────────────── cash drawer ─────────────────────── */

function drawerSection(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Drawer open" }) });
}

function drawerStat(page: Page, label: string) {
  return drawerSection(page)
    .locator("div.bg-white.p-4")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("p")
    .nth(1);
}

async function gotoDrawer(page: Page) {
  await page.goto("/admin/cash-drawer");
  await expect(page.getByRole("heading", { name: "Cash Drawer", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(drawerSection(page).or(page.getByRole("button", { name: "Open drawer" }))).toBeVisible({
    timeout: 30_000,
  });
}

async function openDrawer(page: Page, amount: number) {
  await page.getByRole("button", { name: "Open drawer" }).click();
  await page.locator('input[type="number"]').fill(String(amount));
  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(drawerSection(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".toast-error")).toHaveCount(0);
}

async function closeDrawer(page: Page, count: number) {
  const section = drawerSection(page);
  const start = section.getByRole("button", { name: "Close drawer" });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  await section.locator('input[type="number"]').fill(String(count));
  await section.getByRole("button", { name: "Close drawer" }).click();
  await confirmAlert(page, "Close cash drawer?");
  await expect(section).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".toast-error")).toHaveCount(0);
}

/* ─────────────────────── cloud ─────────────────────── */

type PaymentLog = { to: string; method: string; amount: number };

async function paymentLogs(orderId: string): Promise<PaymentLog[]> {
  const logs = await queryDocs("activityLogs", { entityId: orderId });
  return logs
    .map((d) => (d.data.change as { payment?: PaymentLog } | undefined)?.payment)
    .filter((p): p is PaymentLog => Boolean(p));
}

function expectUnpaidDoc(d: FsDoc) {
  expect(d.data.paymentStatus).toBe("pending");
  expect(d.data.paymentMethod).toBe("cash");
  expect(d.data.paidAt).toBeUndefined();
  expect(d.data.paidBy).toBeUndefined();
  expect(d.data.paidByName).toBeUndefined();
}

/* ─────────────────────── tests ─────────────────────── */

test("payment pending: needs a customer, prints PENDING, badge, not in the drawer; marked paid by another user, owner sets it back", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  serialOnly();
  const staff = await staffToken();
  const owner = await ownerToken();
  const staffSession = await newSession(browser, "staff");
  const ownerSession = await newSession(browser, "owner");
  const sp = staffSession.page;
  const op = ownerSession.page;
  await capturePrints(sp);
  await capturePrints(op);

  // ── Staff: today's drawer starts clean at Rs 1,000 ──
  await gotoDrawer(sp);
  if (!(await drawerSection(sp).isVisible())) await openDrawer(sp, 0);
  await closeDrawer(sp, 1);
  await openDrawer(sp, 1000);
  await expect(drawerStat(sp, "Expected cash")).toHaveText("Rs 1,000", { timeout: 30_000 });

  // ── Owner sells on credit ──
  const ownerPos = new Pos(op);
  await ownerPos.goto();
  await ownerPos.addProduct(ITEM);
  let dlg = await openCheckout(op);
  // Paid is the default.
  await expect(dlg.getByTestId("checkout-payment-paid")).toHaveAttribute("aria-checked", "true");
  await expect(dlg.getByTestId("checkout-unpaid-pill")).toHaveCount(0);
  await chooseUnpaid(dlg);
  // The preview slip already says so.
  await expect(op.frameLocator('iframe[title="Receipt preview"]').locator("body")).toContainText("PAYMENT PENDING");

  // No name and no phone: refused, nothing saved, the sale stays open.
  await expect(dlg.getByText("Add the customer's name or phone for a payment-pending order")).toBeVisible();
  await clickCheckout(dlg);
  const refused = op.getByRole("alertdialog", { name: "Checkout failed" });
  await expect(refused).toContainText("Add the customer's name or phone for a payment-pending order");
  await refused.getByRole("button", { name: "OK", exact: true }).click();
  await expect(refused).toBeHidden();
  await expect(dlg).toBeVisible();

  const customer = tag("unpaid");
  await dlg.locator("#checkout-customer-name").fill(customer);
  await expect(dlg.getByText("Add the customer's name or phone for a payment-pending order")).toHaveCount(0);
  await setPrint(dlg, true);
  await clickCheckout(dlg);
  await expect(dlg).toBeHidden({ timeout: 15_000 });

  // The slip printed at checkout says PAYMENT PENDING (never "PAID").
  const slip = await waitPrintJob(op, 1);
  expect(slip).toContain("PAYMENT PENDING");
  expect(slip).toMatch(/Payment\s*PENDING/);
  expect(slip).not.toContain("- PAID");

  const sale = await waitForOne("orders", { customerName: customer }, (d) => isTimestamp(d.data.syncedAtServer));
  expectUnpaidDoc(sale);
  expect(sale.data.createdBy).toBe(owner.uid);
  expect(sale.data.total).toBe(380);
  expect(sale.data.updatedAt).toBeUndefined();
  await ownerPos.waitAllSynced(60_000);

  // The next sale starts on Paid again.
  await ownerPos.addProduct("Naan");
  dlg = await openCheckout(op);
  await expect(dlg.getByTestId("checkout-payment-paid")).toHaveAttribute("aria-checked", "true");
  await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dlg).toBeHidden();

  // Owner's sheet: no refund while the payment is pending — not even for the owner.
  let sheet = await ownerPos.openOrder(customer);
  await expect(paymentRow(sheet)).toContainText("Payment pending");
  await expect(paymentRow(sheet)).toContainText("Rs 380");
  await expect(sheet.getByRole("button", { name: "Refund order" })).toHaveCount(0);
  await expect(sheet).toContainText("Payment is pending — no refund. Edit the items or cancel the order.");
  await expect(paymentRow(sheet).getByRole("button", { name: "Mark as paid", exact: true })).toBeVisible();
  await expect(paymentRow(sheet).getByRole("button", { name: "Set back to pending" })).toHaveCount(0);
  await closeSheet(op);

  // ── Staff: badge in Recent orders + the "Payment pending" list (any date) ──
  const staffPos = new Pos(sp);
  await staffPos.goto();
  const recent = await staffPos.openRecent();
  const card = recent.getByRole("button").filter({ hasText: customer });
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await expect(card.getByTestId("order-unpaid-badge")).toHaveText("Payment pending");
  await recent.getByTestId("recent-unpaid-tab").click();
  await expect(recent.getByTestId("recent-unpaid-list").getByRole("button").filter({ hasText: customer })).toHaveCount(
    1,
    { timeout: 30_000 },
  );
  await expect(recent.getByTestId("recent-unpaid-summary")).toContainText("pending ·");
  // Back to today's list for the next helpers.
  await recent.getByRole("tab", { name: "Today" }).click();
  await recent.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(recent).toBeHidden();

  // ── Drawer: the credit sale's cash is not in it ──
  await gotoDrawer(sp);
  await expect(drawerStat(sp, "Cash")).toHaveText("+Rs 0", { timeout: 30_000 });
  await expect(drawerStat(sp, "Expected cash")).toHaveText("Rs 1,000");
  await expect(sp.getByTestId("drawer-unpaid")).toContainText("Payment pending (not in drawer) (1)");
  await expect(sp.getByTestId("drawer-unpaid")).toContainText("Rs 380");

  // ── Staff (not the seller) collects it in cash ──
  await staffPos.goto();
  sheet = await staffPos.openOrder(customer);
  await expect(paymentRow(sheet)).toContainText("Payment pending");
  await expect(sheet.getByRole("button", { name: "Refund order" })).toHaveCount(0);
  await expect(paymentRow(sheet).getByRole("button", { name: "Set back to pending" })).toHaveCount(0);
  const tapAt = Date.now();
  await markPaid(sp, sheet, "Cash", "Rs 380");

  const paid = await waitForOne(
    "orders",
    { customerName: customer },
    (d) => d.data.paymentStatus === undefined && typeof d.data.paidAt === "string",
  );
  expect(paid.data.paymentMethod).toBe("cash");
  expect(paid.data.paidBy).toBe(staff.uid);
  expect(typeof paid.data.paidByName).toBe("string");
  const paidAtMs = Date.parse(String(paid.data.paidAt));
  expect(paidAtMs).toBeGreaterThanOrEqual(tapAt - 5_000);
  // A payment is not an edit: no "Edited" / REPRINT, no updatedBy.
  expect(paid.data.updatedAt).toBeUndefined();
  expect(paid.data.updatedBy).toBeUndefined();
  expect(paid.data.total).toBe(380);
  await expect.poll(() => paymentLogs(paid.id), { timeout: 30_000 }).toEqual([
    { to: "paid", method: "cash", amount: 380 },
  ]);
  await staffPos.waitAllSynced(60_000);

  // Paid now: no badge any more, the sheet says who took it.
  const recentAfter = await staffPos.openRecent();
  const cardAfter = recentAfter.getByRole("button").filter({ hasText: customer });
  await expect(cardAfter).toHaveCount(1, { timeout: 30_000 });
  await expect(cardAfter.getByTestId("order-unpaid-badge")).toHaveCount(0);
  await cardAfter.click();
  sheet = orderSheet(sp);
  await expect(sheet).toBeVisible();
  await expect(paymentRow(sheet)).toContainText("Paid");
  await expect(paymentRow(sheet)).toContainText(/Paid .+ · Cash · by /);
  await expect(paymentRow(sheet).getByRole("button", { name: "Mark as paid", exact: true })).toHaveCount(0);

  // Reprint: "Cash - PAID" + "Paid on", in the preview and on the printed job.
  await sheet.getByRole("button", { name: /^(Print bill|Reprint)$/ }).click();
  const preview = sp.frameLocator('iframe[title="Print bill"]').locator("body");
  await expect(preview).toContainText("Cash - PAID");
  await expect(preview).toContainText("Paid on");
  await expect(preview).not.toContainText("PAYMENT PENDING");
  await expect(preview).not.toContainText("REPRINT");
  const before = (await printJobs(sp)).length;
  await sp
    .locator("div.relative.z-10")
    .filter({ has: sp.getByRole("heading", { name: "Print bill" }) })
    .getByRole("button", { name: "Print bill" })
    .click();
  const reprint = await waitPrintJob(sp, before + 1);
  expect(reprint).toContain("Cash - PAID");
  expect(reprint).toContain("Paid on");
  expect(reprint).not.toContain("PAYMENT PENDING");
  await closeSheet(sp);

  // ── Drawer: the cash is in now (collected, not a sale of the drawer) ──
  await gotoDrawer(sp);
  await expect(drawerStat(sp, "Expected cash")).toHaveText("Rs 1,380", { timeout: 30_000 });
  await expect(sp.getByTestId("drawer-collected")).toContainText("Old bills collected (1)");
  await expect(sp.getByTestId("drawer-collected")).toContainText("+Rs 380");
  await expect(sp.getByTestId("drawer-unpaid")).toHaveCount(0);

  // ── Owner sets it back to pending (logged) ──
  await ownerPos.goto();
  // Recent orders shows this PC's Firestore cache first (still the unpaid copy
  // the owner sold), then swaps in the server's: open it once it reads paid.
  const ownerRecent = await ownerPos.openRecent();
  const ownerCard = ownerRecent.getByRole("button").filter({ hasText: customer });
  await expect(ownerCard).toHaveCount(1, { timeout: 30_000 });
  await expect(ownerCard.getByTestId("order-unpaid-badge")).toHaveCount(0, { timeout: 30_000 });
  await ownerCard.click();
  sheet = orderSheet(op);
  await expect(sheet).toBeVisible();
  await expect(paymentRow(sheet)).toContainText(/Paid .+ · Cash · by /);
  await paymentRow(sheet).getByRole("button", { name: "Set back to pending" }).click();
  await confirmAlert(op, "Set back to pending");
  await acknowledgeSuccess(op, "Payment set back to pending");
  await closeSheet(op);
  const back = await waitForOne("orders", { customerName: customer }, (d) => d.data.paymentStatus === "pending");
  expectUnpaidDoc(back);
  expect(back.data.paidAtServer).toBeUndefined();
  await expect.poll(async () => (await paymentLogs(back.id)).map((p) => p.to).sort(), { timeout: 30_000 }).toEqual([
    "paid",
    "pending",
  ]);
  await ownerPos.waitAllSynced(60_000);

  await gotoDrawer(sp);
  await expect(drawerStat(sp, "Expected cash")).toHaveText("Rs 1,000", { timeout: 30_000 });
  await expect(sp.getByTestId("drawer-collected")).toHaveCount(0);
  await expect(sp.getByTestId("drawer-unpaid")).toContainText("Rs 380");

  // ── Owner cancels it: no cash goes back, the drawer stays at its opening ──
  await ownerPos.goto();
  sheet = await ownerPos.openOrder(customer);
  await sheet.getByRole("button", { name: "Cancel this order" }).click();
  await expect(op.getByRole("alertdialog", { name: "Cancel this order?" })).toContainText(
    "Payment was never received — no cash goes back from the drawer.",
  );
  await confirmAlert(op, "Cancel this order?");
  await acknowledgeSuccess(op, "Order cancelled");
  await waitForOne("orders", { customerName: customer }, (d) => d.data.status === "cancelled");
  await ownerPos.waitAllSynced(60_000);

  await gotoDrawer(sp);
  await expect(drawerStat(sp, "Expected cash")).toHaveText("Rs 1,000", { timeout: 30_000 });
  await expect(drawerStat(sp, "Cash")).toHaveText("+Rs 0");
  await expect(sp.getByTestId("drawer-unpaid")).toHaveCount(0);

  await staffSession.context.close();
  await ownerSession.context.close();
});

test("offline: a payment-pending sale syncs with its status, and marking it paid offline syncs too", async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const staff = await staffToken();
  const { context, page } = await newSession(browser, "staff");
  const pos = new Pos(page);
  await pos.goto();
  await pos.waitCounterReady();
  await pos.waitAllSynced(30_000);

  // ── Pending sale while offline ──
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  const customer = tag("unpaid-offline");
  await sellUnpaid(page, pos, customer, { print: false });
  await expect(pos.reportPendingDot()).toHaveCount(1);

  let recent = await pos.openRecent();
  let card = recent.getByRole("button").filter({ hasText: customer });
  await expect(card).toBeVisible();
  await expect(card.locator('[aria-label="Pending sync"]')).toHaveCount(1);
  await expect(card.getByTestId("order-unpaid-badge")).toHaveText("Payment pending");
  await recent.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(recent).toBeHidden();

  await page.waitForTimeout(3_000);
  expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);

  await context.setOffline(false);
  const sale = await waitForOne(
    "orders",
    { customerName: customer },
    (d) => isTimestamp(d.data.syncedAtServer),
    120_000,
  );
  expectUnpaidDoc(sale);
  expect(sale.data.createdBy).toBe(staff.uid);
  expect(sale.data.total).toBe(380);
  await pos.waitAllSynced(100_000);

  // ── Collected while offline (paid by Online) ──
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  const sheet = await pos.openOrder(customer);
  await expect(paymentRow(sheet)).toContainText("Payment pending");
  const tapAt = Date.now();
  await markPaid(page, sheet, "Online", "Rs 380");
  await expect(pos.reportPendingDot()).toHaveCount(1);

  // The card already shows it paid on this PC (change waiting to upload).
  recent = await pos.openRecent();
  card = recent.getByRole("button").filter({ hasText: customer });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("order-unpaid-badge")).toHaveCount(0);
  await recent.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(recent).toBeHidden();

  await page.waitForTimeout(3_000);
  expect((await getDoc(`orders/${sale.id}`))?.data.paymentStatus).toBe("pending");

  await context.setOffline(false);
  const backAt = Date.now();
  const paid = await waitForOne(
    "orders",
    { customerName: customer },
    (d) => d.data.paymentStatus === undefined && typeof d.data.paidAt === "string",
    120_000,
  );
  expect(paid.data.paymentMethod).toBe("digital");
  expect(paid.data.paidBy).toBe(staff.uid);
  // paidAt is the time of the tap, not of the upload; no server stamp for a queued payment.
  const paidAtMs = Date.parse(String(paid.data.paidAt));
  expect(paidAtMs).toBeGreaterThanOrEqual(tapAt - 5_000);
  expect(paidAtMs).toBeLessThan(backAt);
  expect(paid.data.paidAtServer).toBeUndefined();
  expect(paid.data.updatedAt).toBeUndefined();
  await expect.poll(() => paymentLogs(paid.id), { timeout: 60_000 }).toEqual([
    { to: "paid", method: "digital", amount: 380 },
  ]);
  await pos.waitAllSynced(100_000);
  await context.close();
});

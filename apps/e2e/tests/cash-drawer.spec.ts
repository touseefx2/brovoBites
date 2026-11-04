/**
 * Cash drawer: opening + cash sales − cash refunds (by refund time) − expenses.
 * A drawer reopened the same day starts from the previous close, so earlier
 * sales are never counted twice.
 *
 * Shares the branch's drawer for today — run with --workers=1.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  acknowledgeSuccess,
  commitAdmin,
  confirmAlert,
  deleteWrite,
  getDoc,
  karachiDateKey,
  newSession,
  ownerToken,
  Pos,
  shiftDateKey,
  staffToken,
  tag,
  updateWrite,
  waitForOne,
  serialOnly,
} from "./support";

function openSection(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Drawer open" }) });
}

function stat(page: Page, label: string) {
  return openSection(page)
    .locator("div.bg-white.p-4")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("p")
    .nth(1);
}

async function gotoDrawer(page: Page) {
  await page.goto("/admin/cash-drawer");
  await expect(page.getByRole("heading", { name: "Cash Drawer", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(openSection(page).or(page.getByRole("button", { name: "Open drawer" }))).toBeVisible({
    timeout: 30_000,
  });
}

async function openDrawer(page: Page, amount: number) {
  await page.getByRole("button", { name: "Open drawer" }).click();
  await page.locator('input[type="number"]').fill(String(amount));
  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(openSection(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".toast-error")).toHaveCount(0);
}

async function closeDrawer(page: Page, count: number) {
  const section = openSection(page);
  const start = section.getByRole("button", { name: "Close drawer" });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  await section.locator('input[type="number"]').fill(String(count));
  await section.getByRole("button", { name: "Close drawer" }).click();
  await confirmAlert(page, "Close cash drawer?");
  await expect(section).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".toast-error")).toHaveCount(0);
}

async function openDrawerDocId(): Promise<string> {
  const open = await waitForOne("cashDrawers", { branchId: "main", status: "open" });
  return open.id;
}

/** The close reaches the server a moment after the UI updates. */
async function waitClosed(id: string, fields: Record<string, unknown>) {
  await expect
    .poll(async () => (await getDoc(`cashDrawers/${id}`))?.data, { timeout: 30_000, intervals: [300, 600, 1000] })
    .toMatchObject({ status: "closed", ...fields });
}

test("cash drawer: expected cash, close with a count, reopen without double counting", async ({ browser }) => {
  test.setTimeout(300_000);
  serialOnly();
  const staff = await staffToken();
  const { context, page } = await newSession(browser, "staff");
  const pos = new Pos(page);

  // Baseline: whatever earlier tests did today ends at a close.
  await gotoDrawer(page);
  if (await openSection(page).isVisible()) {
    await closeDrawer(page, 1);
  } else {
    await openDrawer(page, 0);
    await closeDrawer(page, 1);
  }

  // ── Drawer 1: opening Rs 1,000 ──
  await openDrawer(page, 1000);
  const drawer1 = await openDrawerDocId();
  await expect(stat(page, "Expected cash")).toHaveText("Rs 1,000", { timeout: 30_000 });

  await pos.goto();
  const saleA = tag("drawer-sale-a");
  await pos.sell("Classic Zinger", saleA);
  await pos.waitAllSynced(45_000);

  await gotoDrawer(page);
  await expect(stat(page, "Cash")).toHaveText("+Rs 380", { timeout: 30_000 });
  await expect(stat(page, "Expected cash")).toHaveText("Rs 1,380");

  // Count Rs 50 short.
  await closeDrawer(page, 1330);
  await waitClosed(drawer1, {
    openingBalance: 1000,
    expectedCash: 1380,
    closingCount: 1330,
    difference: -50,
    closedBy: staff.uid,
    openedBy: staff.uid,
    autoClosed: false,
  });
  const closedList = page.locator("section").filter({ has: page.getByRole("heading", { name: "Drawer closed" }) });
  const row1 = closedList.locator("div.flex.items-center.justify-between").filter({ hasText: "Expected cash: Rs 1,380" });
  await expect(row1.first()).toContainText("Actual cash count: Rs 1,330");
  await expect(row1.first()).toContainText("Rs -50");

  // ── Drawer 2 (reopened the same day): opening Rs 500 ──
  await openDrawer(page, 500);
  const drawer2 = await openDrawerDocId();
  expect(drawer2).not.toBe(drawer1);
  // Sale A was counted by drawer 1 — not again.
  await expect(stat(page, "Expected cash")).toHaveText("Rs 500", { timeout: 30_000 });
  await expect(stat(page, "Cash")).toHaveText("+Rs 0");

  // Refund Rs 100 of sale A now: cash leaves the drawer now (refund time).
  await pos.goto();
  const sheet = await pos.openOrder(saleA);
  await sheet.getByRole("button", { name: "Refund order" }).click();
  await sheet.locator('input[type="number"]').fill("100");
  await sheet.getByPlaceholder("e.g. wrong item, quality issue").fill("E2E drawer refund");
  await sheet.getByRole("button", { name: "Confirm refund" }).click();
  await confirmAlert(page, "Confirm this refund?");
  await acknowledgeSuccess(page, "Refund processed");

  // A cash sale (counted), a card sale (not counted) and an expense.
  const saleB = tag("drawer-sale-b");
  await pos.sell("Naan", saleB);
  await pos.addProduct("Roti");
  const saleC = tag("drawer-sale-card");
  await pos.checkout({ customer: saleC, payment: "Card", print: false });
  const expenses = await pos.openExpenses();
  const expDesc = tag("drawer-exp");
  await expenses.locator('form input[type="number"]').fill("20");
  await expenses.getByLabel("Description").fill(expDesc);
  await expenses.getByRole("button", { name: /Add expense/ }).click();
  await expect(expenses.locator("li").filter({ hasText: expDesc })).toBeVisible();
  await expenses.getByRole("button", { name: "Close", exact: true }).last().click();
  await waitForOne("orders", { customerName: saleC }, (d) => d.data.paymentMethod === "card");
  await waitForOne("orders", { customerName: saleA }, (d) => d.data.refundAmount === 100);
  await waitForOne("expenses", { description: expDesc });
  await pos.waitAllSynced(60_000);

  await gotoDrawer(page);
  // 500 + 30 (cash sale) − 100 (refund) − 20 (expense) = 410
  await expect(stat(page, "Cash")).toHaveText("+Rs 30", { timeout: 30_000 });
  await expect(stat(page, "Expenses")).toHaveText("-Rs 20");
  await expect(openSection(page)).toContainText("Total refunds: Rs 100");
  await expect(stat(page, "Expected cash")).toHaveText("Rs 410");

  await closeDrawer(page, 410);
  await waitClosed(drawer2, {
    openingBalance: 500,
    expectedCash: 410,
    closingCount: 410,
    difference: 0,
    closedBy: staff.uid,
  });
  const row2 = closedList.locator("div.flex.items-center.justify-between").filter({ hasText: "Expected cash: Rs 410" });
  await expect(row2.first()).toContainText("Cash matches!");

  // The earlier drawer's saved result did not change.
  expect((await getDoc(`cashDrawers/${drawer1}`))?.data.expectedCash).toBe(1380);
  await context.close();
});

test("cash drawer: an earlier day's cash sale cancelled today leaves today's drawer", async ({ browser }) => {
  test.setTimeout(240_000);
  serialOnly();
  const staff = await staffToken();
  const owner = await ownerToken();
  const { context, page } = await newSession(browser, "staff");

  // Baseline: today's earlier work ends at a close, so the new drawer starts clean.
  await gotoDrawer(page);
  if (!(await openSection(page).isVisible())) await openDrawer(page, 0);
  await closeDrawer(page, 1);
  await openDrawer(page, 1000);
  const drawer = await openDrawerDocId();
  await expect(stat(page, "Expected cash")).toHaveText("Rs 1,000", { timeout: 30_000 });

  // Sold on an earlier business day for Rs 700 cash; the owner cancels it now
  // and the money is handed back from this drawer. (Two calendar days back:
  // after midnight "yesterday" can still be today's business day.)
  const id = tag("drawer-old-cancel");
  const yesterday = shiftDateKey(karachiDateKey(), -2);
  const seeded = await commitAdmin([
    updateWrite(
      `orders/${id}`,
      {
        clientId: id,
        branchId: "main",
        orderNumber: 9_990_000 + Math.floor(Math.random() * 9_000),
        orderType: "takeaway",
        customerName: id,
        items: [{ productId: "p", productName: "E2E item", unitPrice: 700, qty: 1, lineTotal: 700 }],
        subtotal: 700,
        total: 700,
        paymentMethod: "cash",
        status: "cancelled",
        createdBy: staff.uid,
        createdByName: "E2E Staff",
        createdAt: `${yesterday}T09:00:00.000Z`,
        updatedAt: new Date().toISOString(),
        updatedBy: owner.uid,
        updatedByName: "E2E Owner",
      },
      { serverTime: ["syncedAtServer"], exists: false },
    ),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  try {
    await expect(stat(page, "Expected cash")).toHaveText("Rs 300", { timeout: 30_000 });
    // Counted right: no false "short" against the staff who closes.
    await closeDrawer(page, 300);
    await waitClosed(drawer, { expectedCash: 300, closingCount: 300, difference: 0 });
  } finally {
    await commitAdmin([deleteWrite(`orders/${id}`)]);
    await context.close();
  }
});

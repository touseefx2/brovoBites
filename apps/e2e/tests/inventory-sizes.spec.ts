/**
 * Stock per drink size: the owner adds two sizes of Soft Drink from the menu
 * picker, receives / wastes stock, a POS sale of a Tin Can takes only that
 * size's count down, the POS Inventory sheet shows the same list, and the
 * owner report lists the day's stock (opening, in, sold, left).
 */
import { expect, test, type Page } from "@playwright/test";
import { login, OWNER_EMAIL, PASSWORD } from "./helpers";
import { acknowledgeSuccess, commitAdmin, confirmAlert, deleteWrite, getDoc, newSession, ownerToken, Pos, queryDocs, staffToken, tag, updateWrite } from "./support";

const SHOTS = process.env.E2E_SHOTS_DIR;
const POS_THEME_KEY = "bravobites-pos-theme";
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) : null);

test("drink sizes are stocked apart; sale, receive, waste and report agree", async ({ browser }) => {
  test.setTimeout(240_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink, "Soft Drink is in the seeded menu").toBeTruthy();
  const canPath = `inventory/main__${drink!.id}__can`;
  const bigPath = `inventory/main__${drink!.id}__1_5l`;
  const cleanup = [canPath, bigPath];

  try {
    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin/inventory");
    await expect(page.getByText("No stock items yet")).toBeVisible({ timeout: 30_000 });

    // Pick two sizes at once, each with its own opening count.
    await page.getByRole("button", { name: "Add stock item" }).first().click();
    const picker = page.getByRole("dialog", { name: "Choose items to track" });
    await picker.getByPlaceholder("Search product…").fill("Soft");
    await picker.getByRole("button", { name: "Tin Can" }).click();
    await picker.getByRole("button", { name: "1.5 Litre" }).click();
    await shot(page, "1a-pick");
    await picker.getByRole("button", { name: /Next — 2 selected/ }).click();
    const counts = page.getByRole("dialog", { name: "How much is in stock?" });
    await counts.getByLabel(/Opening stock — Soft Drink Tin Can/).fill("10");
    await counts.getByLabel(/Opening stock — Soft Drink 1.5 Litre/).fill("4");
    await shot(page, "1b-counts");
    await counts.getByRole("button", { name: "Add 2" }).click();
    await expect(counts).toBeHidden();

    await expect.poll(async () => (await getDoc(canPath))?.data, { timeout: 30_000 }).toMatchObject({
      variationId: "can",
      variationLabel: "Tin Can",
      currentStock: 10,
      unit: "can",
    });
    expect((await getDoc(bigPath))?.data).toMatchObject({ currentStock: 4, unit: "bottle" });

    // Receive 12 cans.
    const canRow = page.locator("li").filter({ hasText: "Tin Can" });
    await canRow.getByRole("button", { name: /^Receive/ }).click();
    let dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByRole("button", { name: "+12" }).click();
    await expect(dlg.getByRole("status")).toContainText("22");
    await shot(page, "2-receive");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await getDoc(canPath))?.data.currentStock, { timeout: 30_000 }).toBe(22);

    // Waste one 1.5 Litre bottle.
    const bigRow = page.locator("li").filter({ hasText: "1.5 Litre" });
    await bigRow.getByRole("button", { name: /^Waste/ }).click();
    dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("Quantity").fill("1");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await getDoc(bigPath))?.data.currentStock, { timeout: 30_000 }).toBe(3);
    await shot(page, "3-admin-list");

    // Row menu opens above everything; Recount sets the count.
    await bigRow.getByRole("button", { name: "Soft Drink · 1.5 Litre", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Recount" })).toBeVisible();
    await shot(page, "3b-menu");
    await menu.getByRole("menuitem", { name: "Recount" }).click();
    dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("New stock count").fill("5");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await getDoc(bigPath))?.data.currentStock, { timeout: 30_000 }).toBe(5);
    await bigRow.getByRole("button", { name: "Soft Drink · 1.5 Litre", exact: true }).click();
    await page.getByRole("menuitem", { name: "Recount" }).click();
    await page.getByRole("dialog", { name: "Soft Drink" }).getByLabel("New stock count").fill("3");
    await page.getByRole("dialog", { name: "Soft Drink" }).getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await getDoc(bigPath))?.data.currentStock, { timeout: 30_000 }).toBe(3);
    await context.close();

    // A POS sale of a Tin Can moves only the can row.
    const staff = await newSession(browser, "staff");
    const pos = new Pos(staff.page);
    await pos.goto();
    await pos.addProduct("Soft Drink");
    await staff.page.getByRole("button", { name: /Tin Can/ }).click();
    const customer = tag("can-sale");
    await pos.checkout({ customer, print: false });
    await expect.poll(async () => (await getDoc(canPath))?.data.currentStock, { timeout: 60_000 }).toBe(21);
    expect((await getDoc(bigPath))?.data.currentStock).toBe(3);
    const [order] = await queryDocs("orders", { customerName: customer });
    if (order) cleanup.push(`orders/${order.id}`, `stockMovements/${order.id}__${drink!.id}__can`);

    // Same list in the POS Inventory sheet.
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    const sheet = staff.page.getByRole("dialog", { name: "Inventory" });
    await expect(sheet.locator("li").filter({ hasText: "Tin Can" })).toContainText("21");
    await shot(staff.page, "4-pos-sheet");
    // Staff waste one 1.5 Litre from the POS sheet (their own log line below).
    await sheet.locator("li").filter({ hasText: "1.5 Litre" }).getByRole("button", { name: /^Waste/ }).click();
    const wasteDlg = staff.page.getByRole("dialog", { name: "Soft Drink" });
    await wasteDlg.getByLabel("Quantity").fill("1");
    await wasteDlg.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await getDoc(bigPath))?.data.currentStock, { timeout: 30_000 }).toBe(2);
    await sheet.getByRole("button", { name: "Close" }).last().click();

    // Dark POS: the sheet and the Day End Report's Inventory tab.
    await staff.page.evaluate((key) => localStorage.setItem(key, "dark"), POS_THEME_KEY);
    await pos.goto();
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    await expect(staff.page.getByRole("dialog", { name: "Inventory" }).locator("li").filter({ hasText: "Tin Can" })).toContainText("21");
    await shot(staff.page, "4b-pos-sheet-dark");
    await staff.page.getByRole("dialog", { name: "Inventory" }).getByRole("button", { name: "Close" }).last().click();
    await pos.toolbar().locator("button", { hasText: "Report" }).click();
    const report = staff.page.getByRole("dialog", { name: "Day End Report" });
    await report.getByRole("tab").nth(4).click(); // Summary, Item Sales, Orders, Expenses, Inventory
    const dayStock = report.locator("#or-stock");
    await expect(dayStock).toContainText("Soft Drink · Tin Can");
    // The hand changes start closed: the arrow opens them.
    await expect(dayStock).not.toContainText("Received stock");
    await dayStock.getByRole("button", { name: /Stock changes by hand/ }).click();
    await expect(dayStock).toContainText("Received stock");
    await shot(staff.page, "4c-day-report-stock-dark");
    // Its activity log opens below the tab, like Orders / Expenses.
    await report.getByRole("button", { name: /See activity log/ }).click();
    const logs = staff.page.getByRole("dialog", { name: "Stock activity" });
    // Staff see their own changes here (owner: everyone's), like Orders / Expenses.
    await expect(logs).toContainText("Recorded waste", { timeout: 30_000 });
    await shot(staff.page, "4d-stock-activity-dark");
    await staff.page.evaluate((key) => localStorage.setItem(key, "light"), POS_THEME_KEY);
    await staff.context.close();

    // Owner report: the day's stock.
    const owner = await newSession(browser, "owner");
    await owner.page.goto("/admin/owner-report");
    const stock = owner.page.locator("#or-stock");
    await expect(stock).toBeVisible({ timeout: 60_000 });
    const canLine = stock.locator("tr").filter({ hasText: "Tin Can" });
    await expect(canLine).toContainText("+12");
    await expect(canLine).toContainText("−1");
    await expect(canLine).toContainText("21");
    await stock.scrollIntoViewIfNeeded();
    await shot(owner.page, "5-owner-report");
    await owner.context.close();
  } finally {
    const moves = [
      ...(await queryDocs("stockMovements", { inventoryItemId: canPath.split("/")[1]! })),
      ...(await queryDocs("stockMovements", { inventoryItemId: bigPath.split("/")[1]! })),
    ].map((m) => `stockMovements/${m.id}`);
    await commitAdmin([...new Set([...cleanup, ...moves])].map((p) => deleteWrite(p)));
  }
});

test("a deal whose text names a drink size takes that size's stock", async ({ browser }) => {
  test.setTimeout(180_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const halfPath = `inventory/main__${drink!.id}__half`;
  const seeded = await commitAdmin([
    updateWrite(halfPath, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "half",
      variationLabel: "Half Litre",
      currentStock: 5,
      lowStockThreshold: 2,
      unit: "bottle",
      lastUpdated: new Date().toISOString(),
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const cleanup = [halfPath];
  try {
    const staff = await newSession(browser, "staff");
    const pos = new Pos(staff.page);
    await pos.goto();
    // "4. Duo Zinger Deal" = Double Zinger ×2, Full Fries, "Half Litre Bottle" (plain text, no link).
    const sale = await pos.sell("4. Duo Zinger Deal", tag("deal-drink"));
    await expect.poll(async () => (await getDoc(halfPath))?.data.currentStock, { timeout: 60_000 }).toBe(4);
    cleanup.push(`orders/${sale.id}`);
    const moves = await queryDocs("stockMovements", { inventoryItemId: halfPath.split("/")[1]! });
    expect(moves.map((m) => m.data.movementType)).toEqual(["sale"]);
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    await staff.context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("an offline POS sale counts in stock and in the day's Sold at once; syncing doesn't count it twice", async ({ browser }) => {
  test.setTimeout(180_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const path1L = `inventory/main__${drink!.id}__1l`;
  const seeded = await commitAdmin([
    updateWrite(path1L, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "1l",
      variationLabel: "1 Litre",
      currentStock: 100,
      lowStockThreshold: 5,
      unit: "bottle",
      lastUpdated: new Date(Date.now() - 60_000).toISOString(),
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const cleanup = [path1L];
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);
    // The Inventory sheet was never opened: the POS keeps the stock rows cached by itself.
    await page.waitForTimeout(3000);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const customer = tag("offline-1l");
    await pos.addProduct("Soft Drink");
    await page.getByRole("button", { name: /^1 Litre Rs/ }).click();
    await pos.addProduct("Soft Drink");
    await page.getByRole("button", { name: /^1 Litre Rs/ }).click();
    await pos.checkout({ customer, print: false });

    // Stock list: 98 at once, marked as waiting.
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    const sheet = page.getByRole("dialog", { name: "Inventory" });
    const row = sheet.locator("li").filter({ hasText: "1 Litre" });
    await expect(row).toContainText("98");
    await expect(row).toContainText("Waiting to sync");
    await sheet.getByRole("button", { name: "Close" }).last().click();

    // Day End Report → Inventory: Sold −2, Left 98 — still offline.
    await pos.toolbar().locator("button", { hasText: "Report" }).click();
    const report = page.getByRole("dialog", { name: "Day End Report" });
    await report.getByRole("tab").nth(4).click();
    const line = report.locator("#or-stock tr").filter({ hasText: "1 Litre" });
    await expect(line).toContainText("−2");
    await expect(line).toContainText("98");
    expect((await getDoc(path1L))?.data.currentStock).toBe(100);

    // Net back: the sale syncs, the cloud says 98, and the screen still says 98 (not 96).
    await context.setOffline(false);
    await expect.poll(async () => (await getDoc(path1L))?.data.currentStock, { timeout: 90_000 }).toBe(98);
    await expect(line).toContainText("98", { timeout: 30_000 });
    await expect(line).not.toContainText("96");
    await expect(line).toContainText("−2");
    const [order] = await queryDocs("orders", { customerName: customer });
    if (order) cleanup.push(`orders/${order.id}`);
    const moves = await queryDocs("stockMovements", { inventoryItemId: path1L.split("/")[1]! });
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    await context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("offline receive, recount and adding an item all land right when the net is back", async ({ browser }) => {
  test.setTimeout(240_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const path1L = `inventory/main__${drink!.id}__1l`;
  const halfPath = `inventory/main__${drink!.id}__half`;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = await commitAdmin([
    updateWrite(path1L, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "1l",
      variationLabel: "1 Litre",
      currentStock: 100,
      lowStockThreshold: 5,
      unit: "bottle",
      createdAt: hourAgo,
      lastUpdated: hourAgo,
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  await commitAdmin([deleteWrite(halfPath)]);
  const cleanup = [path1L, halfPath];
  const customers = [tag("off-half"), tag("off-1l")];
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);
    await page.waitForTimeout(3000);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

    // A Half Litre sold before anyone stocks it, then two 1 Litres.
    await pos.addProduct("Soft Drink");
    await page.getByRole("button", { name: /^Half Litre Rs/ }).click();
    await pos.checkout({ customer: customers[0], print: false });
    for (let i = 0; i < 2; i++) {
      await pos.addProduct("Soft Drink");
      await page.getByRole("button", { name: /^1 Litre Rs/ }).click();
    }
    await pos.checkout({ customer: customers[1], print: false });

    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    const sheet = page.getByRole("dialog", { name: "Inventory" });
    const row1L = sheet.locator("li").filter({ hasText: "1 Litre" });
    await expect(row1L).toContainText("98");

    // Receive 10 → 108, then the shelf count says 105.
    await row1L.getByRole("button", { name: /^Receive/ }).click();
    let dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("Quantity").fill("10");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(row1L).toContainText("108");
    await row1L.getByRole("button", { name: "Soft Drink · 1 Litre", exact: true }).click();
    await page.getByRole("menuitem", { name: "Recount" }).click();
    dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("New stock count").fill("105");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(row1L).toContainText("105");

    // Half Litre stocked now with 20 on the shelf: the earlier sale doesn't take it to 19.
    await sheet.getByRole("button", { name: "Add stock item" }).first().click();
    const picker = page.getByRole("dialog", { name: "Choose items to track" });
    await picker.getByPlaceholder("Search product…").fill("Soft");
    await picker.getByRole("button", { name: "Half Litre" }).click();
    await picker.getByRole("button", { name: /Next — 1 selected/ }).click();
    const counts = page.getByRole("dialog", { name: "How much is in stock?" });
    await counts.getByLabel(/Opening stock — Soft Drink Half Litre/).fill("20");
    await counts.getByRole("button", { name: /^Add/ }).last().click();
    await expect(counts).toBeHidden();
    const rowHalf = sheet.locator("li").filter({ hasText: "Half Litre" });
    await expect(rowHalf).toContainText("20");
    await expect(rowHalf).not.toContainText("19");
    expect((await getDoc(path1L))?.data.currentStock).toBe(100);
    await shot(page, "6-offline-sheet");

    // Net back: the cloud ends where the screen was.
    await context.setOffline(false);
    await expect.poll(async () => (await getDoc(path1L))?.data.currentStock, { timeout: 90_000 }).toBe(105);
    await expect.poll(async () => (await getDoc(halfPath))?.data.currentStock, { timeout: 60_000 }).toBe(20);
    await expect.poll(async () => (await queryDocs("orders", { customerName: customers[1] })).length, { timeout: 60_000 }).toBe(1);
    await expect(row1L).toContainText("105");
    await expect(row1L).not.toContainText("Waiting to sync", { timeout: 60_000 });
    await expect(rowHalf).toContainText("20");
    await page.waitForTimeout(5000);
    expect((await getDoc(path1L))?.data.currentStock).toBe(105);
    expect((await getDoc(halfPath))?.data.currentStock).toBe(20);
    const moves1L = await queryDocs("stockMovements", { inventoryItemId: path1L.split("/")[1]! });
    expect(moves1L.map((m) => m.data.movementType).sort()).toEqual(["adjustment", "purchase", "sale"]);
    const movesHalf = await queryDocs("stockMovements", { inventoryItemId: halfPath.split("/")[1]! });
    expect(movesHalf).toHaveLength(0);
    cleanup.push(...moves1L.map((m) => `stockMovements/${m.id}`));
    for (const c of customers) {
      const [order] = await queryDocs("orders", { customerName: c });
      if (order) cleanup.push(`orders/${order.id}`);
    }
    await context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("logout uploads the cashier's waiting stock change first, like a sale", async ({ browser }) => {
  test.setTimeout(240_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const path1L = `inventory/main__${drink!.id}__1l`;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = await commitAdmin([
    updateWrite(path1L, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "1l",
      variationLabel: "1 Litre",
      currentStock: 50,
      lowStockThreshold: 5,
      unit: "bottle",
      createdAt: hourAgo,
      lastUpdated: hourAgo,
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const cleanup = [path1L];
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    const sheet = page.getByRole("dialog", { name: "Inventory" });
    const row = sheet.locator("li").filter({ hasText: "1 Litre" });
    await expect(row).toContainText("50");

    // Wi-Fi up, cloud unreachable: the receive waits on this PC.
    const cloud = /127\.0\.0\.1:8080/;
    await context.route(cloud, (route) => route.abort("connectionrefused"));
    await page.waitForTimeout(2000);
    await row.getByRole("button", { name: /^Receive/ }).click();
    const dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("Quantity").fill("6");
    await dlg.getByRole("button", { name: "Save" }).click();
    // A dead line holds the dialog a few seconds (a refusal would show), then it closes.
    await expect(dlg).toBeHidden({ timeout: 15_000 });
    await expect(row).toContainText("56");
    await expect(row).toContainText("Waiting to sync");
    await page.waitForTimeout(3000);
    expect((await getDoc(path1L))?.data.currentStock).toBe(50);
    await sheet.getByRole("button", { name: "Close" }).last().click();
    await expect(sheet).toBeHidden();

    // The cloud never answers: logout stays locked (the change can't be left behind).
    await page.getByRole("button", { name: "Logout", exact: true }).click();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByText("Inventory not uploaded yet — turn on the internet")).toBeVisible({ timeout: 45_000 });
    await shot(page, "7-logout-stock-popup");
    await expect(page).toHaveURL(/\/pos/);
    await page.getByRole("button", { name: "OK", exact: true }).click();
    expect((await getDoc(path1L))?.data.currentStock).toBe(50);

    // Log out while the cloud is just coming back: logout waits for the change to go up.
    await page.getByRole("button", { name: "Logout", exact: true }).click();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/pos/);
    await context.unroute(cloud);
    await expect(page).toHaveURL(/\/login/, { timeout: 45_000 });
    expect((await getDoc(path1L))?.data.currentStock, "uploaded before logout").toBe(56);
    const moves = await queryDocs("stockMovements", { inventoryItemId: path1L.split("/")[1]! });
    expect(moves.map((m) => m.data.movementType)).toEqual(["purchase"]);
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    await context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("a stock change waiting on a dead line survives a page reload and goes up when the line is back", async ({ browser }) => {
  test.setTimeout(180_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const path1L = `inventory/main__${drink!.id}__1l`;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = await commitAdmin([
    updateWrite(path1L, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "1l",
      variationLabel: "1 Litre",
      currentStock: 30,
      lowStockThreshold: 5,
      unit: "bottle",
      createdAt: hourAgo,
      lastUpdated: hourAgo,
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const cleanup = [path1L];
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    let sheet = page.getByRole("dialog", { name: "Inventory" });
    await expect(sheet.locator("li").filter({ hasText: "1 Litre" })).toContainText("30");

    const cloud = /127\.0\.0\.1:8080/;
    await context.route(cloud, (route) => route.abort("connectionrefused"));
    await page.waitForTimeout(2000);
    await sheet.locator("li").filter({ hasText: "1 Litre" }).getByRole("button", { name: /^Waste/ }).click();
    const dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("Quantity").fill("4");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });

    // PC restarted / page reloaded with the line still down: still 26, still waiting.
    await page.reload();
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    sheet = page.getByRole("dialog", { name: "Inventory" });
    const row = sheet.locator("li").filter({ hasText: "1 Litre" });
    await expect(row).toContainText("26", { timeout: 30_000 });
    await expect(row).toContainText("Waiting to sync");
    expect((await getDoc(path1L))?.data.currentStock).toBe(30);

    await context.unroute(cloud);
    await expect.poll(async () => (await getDoc(path1L))?.data.currentStock, { timeout: 90_000 }).toBe(26);
    await expect(row).not.toContainText("Waiting to sync", { timeout: 30_000 });
    const moves = await queryDocs("stockMovements", { inventoryItemId: path1L.split("/")[1]! });
    expect(moves.map((m) => m.data.movementType)).toEqual(["waste"]);
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    await context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("offline add + sales, a short sync, offline again with more: every count and the day's report come out right", async ({ browser }) => {
  test.setTimeout(300_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const canPath = `inventory/main__${drink!.id}__can`;
  const bigPath = `inventory/main__${drink!.id}__1_5l`;
  await commitAdmin([deleteWrite(canPath), deleteWrite(bigPath)]);
  const cleanup = [canPath, bigPath];
  const customers: string[] = [];
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);
    await page.waitForTimeout(3000);
    const sell = async (size: RegExp, n: number) => {
      for (let i = 0; i < n; i++) {
        await pos.addProduct("Soft Drink");
        await page.getByRole("button", { name: size }).click();
      }
      const c = tag("mix");
      customers.push(c);
      await pos.checkout({ customer: c, print: false });
    };
    const openSheet = async () => {
      await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
      return page.getByRole("dialog", { name: "Inventory" });
    };
    const addItem = async (size: string, count: string) => {
      const sheet = await openSheet();
      await sheet.getByRole("button", { name: "Add stock item" }).first().click();
      const picker = page.getByRole("dialog", { name: "Choose items to track" });
      await picker.getByPlaceholder("Search product…").fill("Soft");
      await picker.getByRole("button", { name: size }).click();
      await picker.getByRole("button", { name: /Next — 1 selected/ }).click();
      const counts = page.getByRole("dialog", { name: "How much is in stock?" });
      await counts.getByLabel(new RegExp(`Opening stock — Soft Drink ${size}`)).fill(count);
      await counts.getByRole("button", { name: /^Add/ }).last().click();
      await expect(counts).toBeHidden();
      await sheet.getByRole("button", { name: "Close" }).last().click();
      await expect(sheet).toBeHidden();
    };

    // ── Offline: stock Tin Can (20), sell 2 ──
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await addItem("Tin Can", "20");
    await sell(/^Tin Can Rs/, 2);

    // ── Net on: everything goes up ──
    await context.setOffline(false);
    await pos.waitAllSynced(90_000);
    await expect.poll(async () => (await getDoc(canPath))?.data.currentStock, { timeout: 60_000 }).toBe(18);

    // ── Offline again: receive 12 cans, sell 3; stock 1.5 Litre (10), sell 1 ──
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    let sheet = await openSheet();
    await sheet.locator("li").filter({ hasText: "Tin Can" }).getByRole("button", { name: /^Receive/ }).click();
    const dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByRole("button", { name: "+12" }).click();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });
    await sheet.getByRole("button", { name: "Close" }).last().click();
    await sell(/^Tin Can Rs/, 3);
    await addItem("1.5 Litre", "10");
    await sell(/^1\.5 Litre Rs/, 1);
    sheet = await openSheet();
    await expect(sheet.locator("li").filter({ hasText: "Tin Can" })).toContainText("27");
    await expect(sheet.locator("li").filter({ hasText: "1.5 Litre" })).toContainText("9");
    await sheet.getByRole("button", { name: "Close" }).last().click();

    // ── Net on: the cloud ends where the screen was ──
    await context.setOffline(false);
    await pos.waitAllSynced(90_000);
    await expect.poll(async () => (await getDoc(canPath))?.data.currentStock, { timeout: 60_000 }).toBe(27);
    await expect.poll(async () => (await getDoc(bigPath))?.data.currentStock, { timeout: 60_000 }).toBe(9);
    await page.waitForTimeout(5000);
    expect((await getDoc(canPath))?.data.currentStock).toBe(27);
    expect((await getDoc(bigPath))?.data.currentStock).toBe(9);
    const canMoves = await queryDocs("stockMovements", { inventoryItemId: canPath.split("/")[1]! });
    const bigMoves = await queryDocs("stockMovements", { inventoryItemId: bigPath.split("/")[1]! });
    cleanup.push(...[...canMoves, ...bigMoves].map((m) => `stockMovements/${m.id}`));
    expect(canMoves.map((m) => m.data.movementType).sort()).toEqual(["purchase", "sale", "sale"]);
    expect(bigMoves.map((m) => m.data.movementType)).toEqual(["sale"]);
    await context.close();

    // ── Owner report (cloud): opening 20, in +12, sold −5, left 27 ──
    const owner = await newSession(browser, "owner");
    await owner.page.goto("/admin/owner-report");
    const stock = owner.page.locator("#or-stock");
    await expect(stock).toBeVisible({ timeout: 60_000 });
    const can = stock.locator("tr").filter({ hasText: "Tin Can" });
    await expect(can).toContainText("20");
    await expect(can).toContainText("+12");
    await expect(can).toContainText("−5");
    await expect(can).toContainText("27");
    const big = stock.locator("tr").filter({ hasText: "1.5 Litre" });
    await expect(big).toContainText("10");
    await expect(big).toContainText("−1");
    await expect(big).toContainText("9");
    await stock.scrollIntoViewIfNeeded();
    await shot(owner.page, "8-mixed-offline-report");
    await owner.context.close();
  } finally {
    for (const c of customers) {
      const [order] = await queryDocs("orders", { customerName: c });
      if (order) cleanup.push(`orders/${order.id}`);
    }
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("a deal whose drink reads \"Regular Bottle\" takes the Regular size (as on the live menu)", async ({ browser }) => {
  test.setTimeout(180_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  // Live calls this size "Regular"; the deals' text says "Regular Bottle" with no link.
  const regPath = `inventory/main__${drink!.id}__glass`;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = await commitAdmin([
    updateWrite(regPath, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "glass",
      variationLabel: "Regular",
      currentStock: 10,
      lowStockThreshold: 2,
      unit: "bottle",
      createdAt: hourAgo,
      lastUpdated: hourAgo,
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const cleanup = [regPath];
  try {
    const staff = await newSession(browser, "staff");
    const pos = new Pos(staff.page);
    await pos.goto();
    const sale = await pos.sell("1. Solo Zinger Deal", tag("regular-deal"));
    cleanup.push(`orders/${sale.id}`);
    await expect.poll(async () => (await getDoc(regPath))?.data.currentStock, { timeout: 60_000 }).toBe(9);
    const moves = await queryDocs("stockMovements", { inventoryItemId: regPath.split("/")[1]! });
    expect(moves.map((m) => m.data.movementType)).toEqual(["sale"]);
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    await staff.context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

test("a sale cancelled while offline gives its stock back — on screen at once, in the cloud once synced", async ({ browser }) => {
  test.setTimeout(240_000);
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const path1L = `inventory/main__${drink!.id}__1l`;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = await commitAdmin([
    updateWrite(path1L, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "1l",
      variationLabel: "1 Litre",
      currentStock: 40,
      lowStockThreshold: 5,
      unit: "bottle",
      createdAt: hourAgo,
      lastUpdated: hourAgo,
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const cleanup = [path1L];
  const customer = tag("off-cancel-stock");
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);
    await page.waitForTimeout(3000);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    for (let i = 0; i < 2; i++) {
      await pos.addProduct("Soft Drink");
      await page.getByRole("button", { name: /^1 Litre Rs/ }).click();
    }
    await pos.checkout({ customer, print: false });

    const expectOnSheet = async (n: string) => {
      await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
      const sheet = page.getByRole("dialog", { name: "Inventory" });
      await expect(sheet.locator("li").filter({ hasText: "1 Litre" })).toContainText(n, { timeout: 15_000 });
      await sheet.getByRole("button", { name: "Close" }).last().click();
      await expect(sheet).toBeHidden();
    };
    await expectOnSheet("38");

    const order = await pos.openOrder(customer);
    await order.getByRole("button", { name: "Cancel this order" }).click();
    await confirmAlert(page, "Cancel this order?");
    await acknowledgeSuccess(page, "Order cancelled");
    await expectOnSheet("40");

    await context.setOffline(false);
    await waitForCancelled(customer);
    await pos.waitAllSynced(100_000);
    await expect.poll(async () => (await getDoc(path1L))?.data.currentStock, { timeout: 60_000 }).toBe(40);
    await page.waitForTimeout(5000);
    expect((await getDoc(path1L))?.data.currentStock).toBe(40);
    const moves = await queryDocs("stockMovements", { inventoryItemId: path1L.split("/")[1]! });
    expect(moves.map((m) => m.data.movementType).sort()).toEqual(["restock", "sale"]);
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    await expectOnSheet("40");
    await context.close();
  } finally {
    const [o] = await queryDocs("orders", { customerName: customer });
    if (o) cleanup.push(`orders/${o.id}`);
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

async function waitForCancelled(customer: string) {
  await expect
    .poll(async () => (await queryDocs("orders", { customerName: customer }))[0]?.data.status, { timeout: 120_000 })
    .toBe("cancelled");
}

test("staff disabled while their stock change waits: the server refuses it, the next login on that PC still puts it on", async ({ browser }) => {
  test.setTimeout(480_000);
  const staff = await staffToken();
  const owner = await ownerToken();
  const [drink] = await queryDocs("products", { name: "Soft Drink" });
  expect(drink).toBeTruthy();
  const path1L = `inventory/main__${drink!.id}__1l`;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = await commitAdmin([
    updateWrite(path1L, {
      branchId: "main",
      productId: drink!.id,
      productName: "Soft Drink",
      variationId: "1l",
      variationLabel: "1 Litre",
      currentStock: 50,
      lowStockThreshold: 5,
      unit: "bottle",
      createdAt: hourAgo,
      lastUpdated: hourAgo,
    }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);
  const setStaffActive = (v: boolean) => commitAdmin([updateWrite(`users/${staff.uid}`, { isActive: v }, { mask: ["isActive"] })]);
  const cleanup = [path1L];
  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.toolbar().getByRole("button", { name: /^Inventory/ }).click();
    const sheet = page.getByRole("dialog", { name: "Inventory" });
    const row = sheet.locator("li").filter({ hasText: "1 Litre" });
    await expect(row).toContainText("50");

    // Line down: the staff receives 6.
    const cloud = /127\.0\.0\.1:8080/;
    await context.route(cloud, (route) => route.abort("connectionrefused"));
    await page.waitForTimeout(2000);
    await row.getByRole("button", { name: /^Receive/ }).click();
    const dlg = page.getByRole("dialog", { name: "Soft Drink" });
    await dlg.getByLabel("Quantity").fill("6");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });
    await expect(row).toContainText("56");

    // The owner disables the staff; then the line comes back: the server refuses the change.
    expect((await setStaffActive(false)).status).toBe(200);
    await context.unroute(cloud);
    await expect(page).toHaveURL(/\/login/, { timeout: 60_000 });
    await page.waitForTimeout(3000);
    expect((await getDoc(path1L))?.data.currentStock).toBe(50);

    // The owner logs in on the same PC: the waiting change goes on, under the staff's name.
    await login(page, OWNER_EMAIL, PASSWORD);
    await pos.goto();
    await expect.poll(async () => (await getDoc(path1L))?.data.currentStock, { timeout: 300_000, intervals: [5000] }).toBe(56);
    const moves = await queryDocs("stockMovements", { inventoryItemId: path1L.split("/")[1]! });
    cleanup.push(...moves.map((m) => `stockMovements/${m.id}`));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.data).toMatchObject({ movementType: "purchase", delta: 6, createdBy: owner.uid, actorUid: staff.uid, createdByName: "E2E Staff" });
    // Later passes don't put it on again.
    await page.waitForTimeout(70_000);
    expect((await getDoc(path1L))?.data.currentStock).toBe(56);
    await context.close();
  } finally {
    await setStaffActive(true);
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});

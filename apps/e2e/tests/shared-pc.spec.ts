/**
 * One shared shop PC: unsynced work waits on the PC for the right login.
 * - Staff upload only their own; the owner's (or a coworker's) waits.
 * - An owner login uploads anyone's, under the original person's name
 *   (uploadedBy = the owner).
 *
 * "Unsynced while online" is produced by blocking the emulator at the network
 * level (the browser still reports navigator.onLine = true), so logout is
 * allowed and the next login happens on the same browser profile.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { login, OWNER_EMAIL, PASSWORD, STAFF_EMAIL } from "./helpers";
import {
  BASE_URL,
  isTimestamp,
  ownerToken,
  Pos,
  queryDocs,
  staffToken,
  tag,
  waitForOne,
} from "./support";

const CLOUD = /127\.0\.0\.1:8080/;

async function blockCloud(context: BrowserContext) {
  await context.route(CLOUD, (route) => route.abort("connectionrefused"));
}

async function unblockCloud(context: BrowserContext) {
  await context.unroute(CLOUD);
}

function unsyncedMark(pos: Pos) {
  return pos
    .toolbar()
    .locator("button", { hasText: "Report" })
    .locator('[aria-label="Pending sync"], [aria-label^="Sync failed"]');
}

/** POS logout while something is unsynced: warned, but allowed (online). */
async function logoutWithUnsynced(page: Page) {
  await page.getByRole("button", { name: "Logout" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Log out?" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("not synced yet");
  await dlg.getByRole("button", { name: "Yes" }).click();
  await page.waitForURL(/\/login/, { timeout: 60_000 });
}

test.describe("shared PC sync", () => {
  test("owner's next login uploads the staff's unsynced sale + expense under the staff's name", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const staff = await staffToken();
    const owner = await ownerToken();
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page, STAFF_EMAIL, PASSWORD);
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);

    await blockCloud(context);
    const customer = tag("shared-staff-sale");
    await pos.addProduct("Extra Mayo");
    await pos.checkout({ customer, print: false });
    const expDesc = tag("shared-staff-exp");
    const sheet = await pos.openExpenses();
    await sheet.locator('form input[type="number"]').fill("15");
    await sheet.getByLabel("Description").fill(expDesc);
    await sheet.getByRole("button", { name: /Add expense/ }).click();
    await expect(sheet.locator("li").filter({ hasText: expDesc })).toBeVisible();
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(unsyncedMark(pos)).toHaveCount(1);

    await logoutWithUnsynced(page);
    expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);
    await unblockCloud(context);

    // Owner signs in on the same PC → uploads the staff's work.
    await login(page, OWNER_EMAIL, PASSWORD);
    const order = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => isTimestamp(d.data.syncedAtServer),
      90_000,
    );
    expect(order.data.createdBy).toBe(staff.uid);
    expect(order.data.createdByName).toBe("E2E Staff");
    expect(order.data.uploadedBy).toBe(owner.uid);
    const exp = await waitForOne("expenses", { description: expDesc }, () => true, 90_000);
    expect(exp.data.createdBy).toBe(staff.uid);
    expect(exp.data.uploadedBy).toBe(owner.uid);
    // The activity log keeps the staff member as the one who added it.
    const log = await waitForOne("activityLogs", { entityId: exp.id, action: "create" }, () => true, 60_000);
    expect(log.data.createdBy).toBe(staff.uid);
    expect(log.data.syncedBy).toBe(owner.uid);
    await context.close();
  });

  test("staff's login uploads the owner's unsynced sale under the owner's name; numbering stays unique", async ({ browser }) => {
    test.setTimeout(300_000);
    const staff = await staffToken();
    const owner = await ownerToken();
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page, OWNER_EMAIL, PASSWORD);
    let pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);

    await blockCloud(context);
    const ownerCustomer = tag("shared-owner-sale");
    await pos.addProduct("Extra Mayo");
    await pos.checkout({ customer: ownerCustomer, print: false });
    await expect(unsyncedMark(pos)).toHaveCount(1);
    await logoutWithUnsynced(page);
    await unblockCloud(context);

    // Staff signs in on the same PC and keeps selling.
    await login(page, STAFF_EMAIL, PASSWORD);
    pos = new Pos(page);
    await pos.goto();
    const staffCustomer = tag("shared-staff-after");
    const staffSale = await pos.sell("Naan", staffCustomer);
    expect(staffSale.data.createdBy).toBe(staff.uid);

    // Whoever is signed in uploads it — still under the owner's name, with the
    // staff member on record as the uploader.
    const ownerSale = await waitForOne(
      "orders",
      { customerName: ownerCustomer },
      (d) => isTimestamp(d.data.syncedAtServer),
      120_000,
    );
    expect(ownerSale.data.createdBy).toBe(owner.uid);
    expect(ownerSale.data.uploadedBy).toBe(staff.uid);
    const ownerNo = Number(ownerSale.data.orderNumber);
    const staffNo = Number(staffSale.data.orderNumber);
    expect(ownerNo).not.toBe(staffNo);
    // No other order shares either number.
    expect(await queryDocs("orders", { orderNumber: ownerNo })).toHaveLength(1);
    expect(await queryDocs("orders", { orderNumber: staffNo })).toHaveLength(1);
    console.log(`owner sale #${ownerNo} (printed ${ownerSale.data.printedOrderNumber ?? ownerNo}), staff sale #${staffNo}`);
    await context.close();
  });
});

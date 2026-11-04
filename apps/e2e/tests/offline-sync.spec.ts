/**
 * Offline POS: sales, expenses and order changes are saved on this PC while
 * the network is down, shown as pending, and uploaded by themselves once it
 * is back (online event, or the 1-minute retry timer).
 */
import { expect, test } from "@playwright/test";
import {
  acknowledgeSuccess,
  confirmAlert,
  isTimestamp,
  karachiDateKey,
  newSession,
  Pos,
  queryDocs,
  staffToken,
  tag,
  waitForOne,
} from "./support";

test.describe("offline POS", () => {
  test("sale + expense made offline are kept locally, then sync when the net is back", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const staff = await staffToken();
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);

    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const offlineAt = Date.now();

    // ── Sale while offline ──
    const customer = tag("offline-sale");
    await pos.addProduct("Chicken Club");
    await pos.checkout({ customer, print: false });
    await expect(pos.reportPendingDot()).toHaveCount(1);

    const recent = await pos.openRecent();
    const card = recent.getByRole("button").filter({ hasText: customer });
    await expect(card).toBeVisible();
    await expect(card.locator('[aria-label="Pending sync"]')).toHaveCount(1);
    await recent.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(recent).toBeHidden();

    // ── Expense while offline ──
    const expDesc = tag("offline-exp");
    const sheet = await pos.openExpenses();
    await sheet.locator('form input[type="number"]').fill("55");
    await sheet.getByLabel("Description").fill(expDesc);
    await sheet.getByRole("button", { name: /Add expense/ }).click();
    const row = sheet.locator("li").filter({ hasText: expDesc });
    await expect(row).toBeVisible();
    await expect(row.locator('[aria-label="Pending sync"]')).toHaveCount(1);
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(sheet).toBeHidden();
    await expect(pos.expensesPendingDot()).toHaveCount(1);

    // Logging out offline is refused (nobody could log back in).
    await page.getByRole("button", { name: "Logout" }).click();
    const blocked = page.getByRole("alertdialog", { name: "Can't log out offline" });
    await expect(blocked).toBeVisible();
    await blocked.getByRole("button", { name: "OK" }).click();

    // Nothing reached the cloud while offline (stays offline a few seconds).
    await page.waitForTimeout(4_000);
    expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);
    expect(await queryDocs("expenses", { description: expDesc })).toHaveLength(0);

    // ── Back online: uploads by itself ──
    await context.setOffline(false);
    const backAt = Date.now();
    const order = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => isTimestamp(d.data.syncedAtServer),
      100_000,
    );
    expect(order.data.createdBy).toBe(staff.uid);
    expect(order.data.total).toBe(250);
    expect(order.data.status).toBe("completed");
    // Sale keeps the time it was made, not the upload time.
    const soldAt = Date.parse(String(order.data.createdAt));
    const syncedAt = Date.parse((order.data.syncedAtServer as { timestamp: string }).timestamp);
    expect(soldAt).toBeGreaterThanOrEqual(offlineAt - 1_000);
    expect(soldAt).toBeLessThan(backAt);
    expect(syncedAt).toBeGreaterThan(soldAt);

    const exp = await waitForOne(
      "expenses",
      { description: expDesc },
      (d) => isTimestamp(d.data.syncedAtServer),
      100_000,
    );
    expect(exp.data.createdBy).toBe(staff.uid);
    expect(exp.data.amount).toBe(55);
    expect(exp.data.date).toBe(karachiDateKey());
    expect(exp.data.source).toBe("pos");

    // Pending indicators clear.
    await pos.waitAllSynced(100_000);
    const recentAfter = await pos.openRecent();
    const cardAfter = recentAfter.getByRole("button").filter({ hasText: customer });
    await expect(cardAfter).toBeVisible();
    await expect(cardAfter.locator('[aria-label="Pending sync"]')).toHaveCount(0);
    console.log(`offline sale synced ${((syncedAt - backAt) / 1000).toFixed(1)}s after reconnect`);
    await context.close();
  });

  test("dead line (browser still 'online', cloud unreachable): sale uploads by itself once the line is back", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const staff = await staffToken();
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);

    // No `offline`/`online` events: only the 1-minute retry timer can recover.
    const cloud = /127\.0\.0\.1:8080/;
    await context.route(cloud, (route) => route.abort("connectionrefused"));
    const customer = tag("dead-line");
    await pos.addProduct("Classic Zinger");
    await pos.checkout({ customer, print: false });
    const mark = pos
      .toolbar()
      .locator("button", { hasText: "Report" })
      .locator('[aria-label="Pending sync"], [aria-label^="Sync failed"]');
    await expect(mark).toHaveCount(1);
    // Let the first upload attempt give up: the sale is marked failed (red count).
    const failedAt0 = Date.now();
    await expect(
      pos.toolbar().locator("button", { hasText: "Report" }).locator('[aria-label^="Sync failed"]'),
    ).toHaveCount(1, { timeout: 150_000 });
    console.log(`dead-line sale marked failed after ${((Date.now() - failedAt0) / 1000).toFixed(1)}s`);
    expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);

    const restoredAt = Date.now();
    await context.unroute(cloud);
    const order = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => isTimestamp(d.data.syncedAtServer),
      200_000,
    );
    const secs = (Date.now() - restoredAt) / 1000;
    console.log(`dead-line sale uploaded ${secs.toFixed(1)}s after the line came back`);
    expect(order.data.createdBy).toBe(staff.uid);
    await pos.waitAllSynced(120_000);
    await context.close();
  });

  test("hanging line (requests never answered): the queue doesn't freeze — the sale uploads without a reload", async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const staff = await staffToken();
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);
    // Survives only if the page is never reloaded.
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

    // Requests are taken but never answered (no error either) — the shop's
    // line that day. Before the fix one such await froze every later pass.
    const cloud = /127\.0\.0\.1:8080/;
    const health = /\/api\/health/;
    const hang = () => {};
    await context.route(cloud, hang);
    await context.route(health, hang);
    const customer = tag("hanging-line");
    await pos.addProduct("Classic Zinger");
    await pos.checkout({ customer, print: false });
    const report = pos.toolbar().locator("button", { hasText: "Report" });
    await expect(report.locator('[aria-label="Pending sync"], [aria-label^="Sync failed"]')).toHaveCount(1);
    // The upload gives up on the silent line and says so (red count).
    const failedAt0 = Date.now();
    await expect(report.locator('[aria-label^="Sync failed"]')).toHaveCount(1, { timeout: 240_000 });
    console.log(`hanging-line sale marked failed after ${((Date.now() - failedAt0) / 1000).toFixed(1)}s`);
    expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);

    const restoredAt = Date.now();
    await context.unroute(cloud);
    await context.unroute(health);
    const order = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => isTimestamp(d.data.syncedAtServer),
      300_000,
    );
    console.log(`hanging-line sale uploaded ${((Date.now() - restoredAt) / 1000).toFixed(1)}s after the line came back`);
    expect(order.data.createdBy).toBe(staff.uid);
    await pos.waitAllSynced(120_000);
    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    ).toBe(true);
    await context.close();
  });

  test("a sale cancelled while still offline reaches the cloud as cancelled", async ({ browser }) => {
    test.setTimeout(300_000);
    const staff = await staffToken();
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    await pos.waitCounterReady();
    await pos.waitAllSynced(30_000);

    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

    const customer = tag("offline-cancel");
    await pos.addProduct("Mint Margarita");
    await pos.checkout({ customer, print: false });

    const sheet = await pos.openOrder(customer);
    await expect(sheet.getByRole("button", { name: "Delete order" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Cancel this order" }).click();
    await confirmAlert(page, "Cancel this order?");
    await acknowledgeSuccess(page, "Order cancelled");

    await page.waitForTimeout(2_000);
    expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);

    await context.setOffline(false);
    const order = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => d.data.status === "cancelled",
      120_000,
    );
    expect(order.data.createdBy).toBe(staff.uid);
    expect(order.data.updatedBy).toBe(staff.uid);
    await waitForOne("activityLogs", { entityId: order.id, action: "cancel" }, () => true, 60_000);
    await pos.waitAllSynced(100_000);
    await context.close();
  });
});

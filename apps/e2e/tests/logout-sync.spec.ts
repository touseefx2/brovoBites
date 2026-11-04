/**
 * Logging out uploads the cashier's waiting work first, under their name — so
 * the next login on this PC (any staff or the owner) has nothing of theirs left.
 */
import { expect, test } from "@playwright/test";
import { isTimestamp, newSession, Pos, queryDocs, staffToken, tag } from "./support";

test("logout uploads the cashier's stuck sale under their name before signing out", async ({ browser }) => {
  test.setTimeout(240_000);
  const staff = await staffToken();
  const { context, page } = await newSession(browser, "staff");
  const pos = new Pos(page);
  await pos.goto();
  await pos.waitCounterReady();
  await pos.waitAllSynced(30_000);

  // Wi-Fi up, cloud unreachable: the sale fails to upload and waits on the PC.
  const cloud = /127\.0\.0\.1:8080/;
  await context.route(cloud, (route) => route.abort("connectionrefused"));
  const customer = tag("logout-sync");
  await pos.addProduct("Classic Zinger");
  await pos.checkout({ customer, print: false });
  await expect(
    pos.toolbar().locator("button", { hasText: "Report" }).locator('[aria-label^="Sync failed"]'),
  ).toHaveCount(1, { timeout: 150_000 });
  expect(await queryDocs("orders", { customerName: customer })).toHaveLength(0);

  // Line back; log out at once (before the 1-minute timer would retry).
  await context.unroute(cloud);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 45_000 });

  const [order] = await queryDocs("orders", { customerName: customer });
  expect(order, "uploaded before logout").toBeTruthy();
  expect(order!.data.createdBy).toBe(staff.uid);
  expect(order!.data.uploadedBy).toBeUndefined(); // uploaded by the cashier themselves
  expect(isTimestamp(order!.data.syncedAtServer)).toBe(true);
  await context.close();
});

test("logout is refused while the login service can't be reached (line down, PC still 'online')", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newSession(browser, "staff");
  const pos = new Pos(page);
  await pos.goto();
  // The router is up, the internet isn't: the browser keeps saying "online".
  const login = /127\.0\.0\.1:9099/;
  await context.route(login, (route) => route.abort("connectionrefused"));
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  // Nobody could log back in — so no logout, and the POS keeps selling.
  await expect(page.getByText("Can't log out offline")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/pos/);
  await context.unroute(login);
  await context.close();
});

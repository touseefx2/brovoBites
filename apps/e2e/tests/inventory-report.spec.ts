/**
 * Stock in the owner report beyond the screen: yesterday's stock (opening,
 * in, sold, left) and the hand changes log reach the emailed PDF, and the
 * inventory screens + report read well at phone width.
 *
 * Emails land in REPORT_EMAIL_OUTBOX (set by pnpm test:e2e:local), not Gmail.
 */
import { copyFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { commitAdmin, deleteWrite, karachiDateKey, newSession, ownerToken, serialOnly, shiftDateKey, updateWrite } from "./support";

const OUTBOX = process.env.REPORT_EMAIL_OUTBOX ?? "";
const SHOTS = process.env.E2E_SHOTS_DIR;
const PHONE = { width: 412, height: 915 };
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : null);

type Mail = { to: string[]; subject: string; attachments: { filename: string; file: string }[] };

async function outbox(): Promise<Mail[]> {
  const files = (await readdir(OUTBOX).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(OUTBOX, f), "utf8")) as Mail));
}

test("yesterday's stock and its hand changes go into the emailed PDF; screens fit a phone", async ({ browser }) => {
  serialOnly();
  test.setTimeout(240_000);
  test.skip(!OUTBOX, "needs REPORT_EMAIL_OUTBOX (pnpm test:e2e:local)");
  const owner = await ownerToken();
  const y = shiftDateKey(karachiDateKey(), -1);
  // Seeded shop day = midnight to midnight, Karachi (UTC+5).
  const at = (hh: string) => new Date(`${y}T${hh}:00:00+05:00`).toISOString();
  const inv = "inventory/e2e-report-water";
  const docs = [inv, "stockMovements/e2e-report-in", "stockMovements/e2e-report-sale", "activityLogs/e2e-report-log", "privateSettings/ownerReport"];
  const move = (id: string, f: Record<string, unknown>) =>
    updateWrite(`stockMovements/${id}`, {
      branchId: "main",
      inventoryItemId: "e2e-report-water",
      productId: "p-e2e-water",
      productName: "E2E Water",
      notes: "",
      createdBy: owner.uid,
      createdByName: "E2E Owner",
      ...f,
    });
  const seeded = await commitAdmin([
    updateWrite(inv, {
      branchId: "main",
      productId: "p-e2e-water",
      productName: "E2E Water",
      currentStock: 7,
      lowStockThreshold: 3,
      unit: "bottle",
      lastUpdated: at("14"),
    }),
    move("e2e-report-in", { movementType: "purchase", quantity: 5, previousStock: 4, newStock: 9, delta: 5, createdAt: at("10") }),
    move("e2e-report-sale", { movementType: "sale", quantity: 2, previousStock: 9, newStock: 7, delta: -2, createdAt: at("14") }),
    updateWrite("activityLogs/e2e-report-log", {
      branchId: "main",
      entityType: "inventory",
      entityId: "e2e-report-water",
      action: "update",
      summary: "Received stock “E2E Water” · 4 → 9",
      detail: "Type: purchase · Qty: +5 bottle",
      createdBy: owner.uid,
      createdByName: "E2E Owner",
      createdAt: at("10"),
    }),
    updateWrite("privateSettings/ownerReport", { emails: ["e2e-stock@gmail.com"] }),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    // ── Email: the server builds yesterday's PDF ──
    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin/landing");
    const box = page.getByTestId("report-email-settings");
    const before = (await outbox()).length;
    await box.getByRole("button", { name: "Send last day's report now" }).click();
    await expect(box).toContainText("Sent to e2e-stock@gmail.com", { timeout: 90_000 });
    let mails: Mail[] = [];
    await expect.poll(async () => (mails = await outbox()).length, { timeout: 30_000 }).toBeGreaterThan(before);
    const mail = mails[mails.length - 1]!;
    expect(mail.attachments).toHaveLength(2);
    if (SHOTS) {
      for (const a of mail.attachments) await copyFile(path.join(OUTBOX, a.file), path.join(SHOTS, a.filename));
    }

    // ── Phone width: inventory, its menu and add dialog, the report ──
    await page.setViewportSize(PHONE);
    await page.goto("/admin/inventory");
    const row = page.locator("li").filter({ hasText: "E2E Water" });
    await expect(row).toContainText("7");
    await shot(page, "m1-inventory");
    await row.getByRole("button", { name: "E2E Water", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Recount" })).toBeVisible();
    await shot(page, "m2-menu");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add stock item" }).first().click();
    const picker = page.getByRole("dialog", { name: "Choose items to track" });
    await picker.getByRole("button", { name: "Tin Can" }).click();
    await shot(page, "m3-pick");
    await picker.getByRole("button", { name: /Next — 1 selected/ }).click();
    await shot(page, "m4-counts");
    await page.keyboard.press("Escape");

    await page.goto("/admin/owner-report");
    await page.getByRole("button", { name: "Yesterday", exact: true }).click();
    const stock = page.locator("#or-stock");
    await expect(stock).toBeVisible({ timeout: 60_000 });
    await expect(stock).toContainText("E2E Water");
    await stock.getByRole("button", { name: /Stock changes by hand/ }).click();
    await expect(stock).toContainText("Received stock “E2E Water” · 4 → 9");
    await stock.scrollIntoViewIfNeeded();
    await shot(page, "m5-report-stock");
    await context.close();
  } finally {
    await commitAdmin(docs.map((d) => deleteWrite(d)));
  }
});

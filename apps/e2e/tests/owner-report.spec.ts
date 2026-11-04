/**
 * Owner report: who did what in a business day — a bill lowered after the
 * sale, a cash order cancelled, cash short at closing — and what was sold, on
 * the POS (owner tab of the Day End Report) and on the admin page with longer
 * periods. Staff see it too, read-only: no opening orders. "Send to Gmail"
 * sends the PDF to the emails the owner set on the Landing Page; the daily
 * email goes once after the shop day closes.
 *
 * Emails land in REPORT_EMAIL_OUTBOX (set by pnpm test:e2e:local), not Gmail.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import {
  commitAdmin,
  deleteWrite,
  getDoc,
  karachiDateKey,
  newSession,
  ownerToken,
  Pos,
  serialOnly,
  shiftDateKey,
  staffToken,
  tag,
  updateWrite,
} from "./support";

const OUTBOX = process.env.REPORT_EMAIL_OUTBOX ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const OWNER_MAIL = "e2e-owner@gmail.com";

type Mail = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; size: number; file: string }[];
};

/** Emails the server "sent" (oldest first). */
async function outbox(): Promise<Mail[]> {
  const files = (await readdir(OUTBOX).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(OUTBOX, f), "utf8")) as Mail));
}

async function nextMail(before: number): Promise<Mail> {
  let mails: Mail[] = [];
  await expect.poll(async () => (mails = await outbox()).length, { timeout: 30_000 }).toBeGreaterThan(before);
  return mails[mails.length - 1]!;
}

/** Every report email: the report twice — an English PDF and an Urdu PDF. */
async function expectPdf(mail: Mail) {
  expect(mail.attachments.map((a) => a.filename)).toEqual([
    expect.stringMatching(/^BravoBites-Owner-Report_.+_English\.pdf$/),
    expect.stringMatching(/^BravoBites-Owner-Report_.+_Urdu\.pdf$/),
  ]);
  for (const a of mail.attachments) {
    const pdf = await readFile(path.join(OUTBOX, a.file));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  }
}

/** Shop, then in English and in Urdu: "Owner report", branch, period (+ a one-line note) — not the report. */
function expectHeaderOnly(mail: Mail & { html?: string }) {
  const [shop, english, ...rest] = mail.text.split("\n\n");
  expect(shop).toBe("BRAVO BITES");
  const lines = english!.split("\n");
  expect(lines[0]).toMatch(/^Owner report/);
  expect(lines[lines.length - 1]).toMatch(/→/);
  expect(lines.length).toBeLessThanOrEqual(3);
  expect(mail.text).toContain("Attached: the report as 2 PDFs");
  expect(rest.join("\n\n")).toContain("مالک کی رپورٹ");
  expect(mail.text).not.toContain("Needs attention");
  expect(mail.html ?? "").not.toContain("Needs attention");
}

function reportEmails(emails: string[], autoDaily = true) {
  return updateWrite("privateSettings/ownerReport", {
    emails,
    autoDaily,
    updatedAt: new Date().toISOString(),
    updatedBy: "e2e",
  });
}

function order(id: string, num: number, staff: { uid: string }, o: { total: number; status: "completed" | "cancelled"; at: string }) {
  return updateWrite(
    `orders/${id}`,
    {
      clientId: id,
      branchId: "main",
      branchName: "Bravo Bites — Main",
      orderNumber: num,
      orderType: "takeaway",
      customerName: id,
      items: [{ productId: "p", productName: "E2E item", unitPrice: o.total, qty: 1, lineTotal: o.total }],
      subtotal: o.total,
      total: o.total,
      paymentMethod: "cash",
      status: o.status,
      createdBy: staff.uid,
      createdByName: "E2E Staff",
      createdByEmail: "",
      createdAt: o.at,
    },
    { serverTime: ["syncedAtServer"], exists: false },
  );
}

function log(
  id: string,
  by: { uid: string },
  l: { entityId: string; action: string; summary: string; at: string; byName?: string },
) {
  return updateWrite(
    `activityLogs/${id}`,
    {
      branchId: "main",
      entityType: "order",
      entityId: l.entityId,
      action: l.action,
      summary: l.summary,
      createdBy: by.uid,
      createdByName: l.byName ?? "E2E Staff",
      createdAt: l.at,
    },
    { exists: false },
  );
}

function flagRow(flags: Locator, kind: string, text: string | RegExp): Locator {
  return flags.locator(`li[data-kind="${kind}"]`).filter({ hasText: text });
}

/** "Order #800" but not "#8001". */
function ord(n: number): RegExp {
  return new RegExp(`#${n}(?!\\d)`);
}

/** The list shows the 8 most serious first; open the rest when there are more. */
async function showAll(scope: Locator) {
  const more = scope.locator("#or-check").getByRole("button", { name: /^Show all/ });
  if (await more.isVisible()) await more.click();
}

test("owner report flags a lowered bill, a cash cancel and cash short — staff only look", async ({ browser }) => {
  serialOnly();
  test.setTimeout(200_000);
  const staff = await staffToken();
  const owner = await ownerToken();
  const today = karachiDateKey();
  const now = Date.now();
  // Seeded shop day = Karachi calendar day; rows an hour old must still be "today".
  test.skip(karachiDateKey(new Date(now - 61 * 60_000)) !== today, "too close to midnight");
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const num = 9_100_000 + Math.floor(Math.random() * 800_000);
  const lowered = tag("or-lowered");
  const cancelled = tag("or-cancelled");
  const logEdit = tag("or-log-edit");
  const logCancel = tag("or-log-cancel");
  const logOwner = tag("or-log-owner");
  const drawer = tag("or-drawer");

  const seeded = await commitAdmin([
    order(lowered, num, staff, { total: 900, status: "completed", at: iso(30 * 60_000) }),
    order(cancelled, num + 1, staff, { total: 700, status: "cancelled", at: iso(25 * 60_000) }),
    log(logEdit, staff, {
      entityId: lowered,
      action: "update",
      summary: `Edited order #${num} · Rs 1,200 → Rs 900 · by E2E Staff`,
      at: iso(10 * 60_000),
    }),
    log(logCancel, staff, {
      entityId: cancelled,
      action: "cancel",
      summary: `Cancelled order #${num + 1} · Rs 700 · by E2E Staff`,
      at: iso(5 * 60_000),
    }),
    // The owner's own change: staff see it too, as a note (not a warning).
    log(logOwner, owner, {
      entityId: cancelled,
      action: "update",
      summary: `Edited order #${num + 1} · Rs 800 → Rs 700 · by E2E Owner`,
      at: iso(20 * 60_000),
      byName: "E2E Owner",
    }),
    updateWrite(
      `cashDrawers/${drawer}`,
      {
        branchId: "main",
        date: today,
        openingBalance: 1000,
        closingCount: 1400,
        expectedCash: 1900,
        difference: -500,
        status: "closed",
        openedBy: staff.uid,
        openedByName: "E2E Staff",
        openedAt: iso(60 * 60_000),
        closedBy: staff.uid,
        closedByName: "E2E Staff",
        closedAt: iso(60_000),
      },
      { exists: false },
    ),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    // ── POS: owner tab of the Day End Report ──
    const { context, page } = await newSession(browser, "owner");
    const pos = new Pos(page);
    await pos.goto();
    await pos.toolbar().locator("button", { hasText: "Report" }).click();
    const dlg = page.getByRole("dialog", { name: "Day End Report" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("tab", { name: "Owner report" }).click();

    // Other specs sell / cancel today too: find our rows by order number.
    const flags = dlg.getByTestId("owner-flags");
    await expect(flags).toBeVisible({ timeout: 30_000 });
    await showAll(dlg);
    await expect(dlg.getByTestId("owner-verdict")).toContainText(/needs? your check/);
    const lowered1 = flagRow(flags, "editDown", ord(num));
    await expect(lowered1).toContainText(`Bill made smaller after the sale · Order #${num}`);
    await expect(lowered1).toContainText("Rs 1,200 → Rs 900");
    await expect(lowered1).toContainText("−Rs 300");
    const cashCancel = flagRow(flags, "cancelCash", ord(num + 1));
    await expect(cashCancel).toContainText(`Cash bill cancelled · Order #${num + 1}`);
    await expect(cashCancel).toContainText("Rs 700");
    await expect(flagRow(flags, "drawerShort", "Rs 500")).toContainText("Cash short in the drawer");
    const staffCard = dlg.getByTestId("owner-staff").locator(`[data-uid="${staff.uid}"]`);
    await expect(staffCard).toContainText("E2E Staff");
    await expect(staffCard).toContainText(/Made \d+ bills? smaller/);
    await expect(dlg.getByTestId("owner-timeline")).toContainText(`E2E Staff changed order #${num}: Rs 1,200 → Rs 900`);

    // ── Print: preview first, then the slip goes to the printer ──
    const actions = dlg.getByTestId("owner-actions");
    await actions.getByRole("button", { name: "Print slip", exact: true }).click();
    const preview = page.getByTestId("owner-print-preview");
    await expect(preview).toBeVisible();
    await expect(preview.locator("iframe")).toHaveCount(1);
    await preview.getByRole("button", { name: "Print", exact: true }).click();
    await expect(preview).toBeHidden();
    const printed = page.locator("iframe[data-print-job]").last();
    await expect(printed).toHaveCount(1);
    // The slip keeps "Rs" and the number together with a no-break space.
    const slip = (await printed.evaluate((f: HTMLIFrameElement) => f.contentDocument?.body.innerText ?? "")).replace(/ /g, " ");
    expect(slip.toLowerCase()).toContain("owner report");
    expect(slip).toContain(`Bill made smaller after the sale · Order #${num}`);
    expect(slip).toContain("Rs 1,200 → Rs 900");
    expect(slip).toContain("Cash short by Rs 500");

    // ── PDF: a real file, saved with the day + time in its name — offline too ──
    for (const offline of [false, true]) {
      await context.setOffline(offline);
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        actions.getByRole("button", { name: "Save PDF" }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^BravoBites-Owner-Report_${today}_saved-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.pdf$`),
      );
      const file = await download.path();
      const head = (await readFile(file)).subarray(0, 5).toString();
      expect(head).toBe("%PDF-");
      expect((await stat(file)).size).toBeGreaterThan(20_000);
      await expect(actions).toContainText("PDF saved in Downloads");
    }

    // ── Email report: the same PDF goes to the emails the owner set on the
    //    Landing Page (none yet → says where to add them, nothing waits) ──
    await context.setOffline(false);
    const waitingChip = actions.getByTestId("owner-email-waiting");
    expect((await commitAdmin([deleteWrite("privateSettings/ownerReport")])).status).toBe(200);
    await actions.getByRole("button", { name: "Send to Gmail" }).click();
    await expect(actions).toContainText("No email added yet", { timeout: 60_000 });
    await expect(waitingChip).toHaveCount(0);
    if (OUTBOX) {
      expect((await commitAdmin([reportEmails([OWNER_MAIL])])).status).toBe(200);
      const before = (await outbox()).length;
      await actions.getByRole("button", { name: "Send to Gmail" }).click();
      await expect(actions).toContainText(`Report emailed to ${OWNER_MAIL}`, { timeout: 60_000 });
      const mail = await nextMail(before);
      expect(mail.to).toEqual([OWNER_MAIL]);
      expect(mail.subject).toContain("Owner report");
      // The email only says which report it is; everything else is the PDF.
      expectHeaderOnly(mail);
      await expectPdf(mail);

      // No internet: it waits on this PC and goes by itself once the net is back.
      await context.setOffline(true);
      await actions.getByRole("button", { name: "Send to Gmail" }).click();
      await expect(actions).toContainText("Saved on this PC", { timeout: 60_000 });
      await expect(waitingChip).toContainText("1 report email waiting for the internet");
      const queuedFrom = (await outbox()).length;
      await context.setOffline(false);
      await expect(waitingChip).toHaveCount(0, { timeout: 60_000 });
      const late = await nextMail(queuedFrom);
      expect(late.to).toEqual([OWNER_MAIL]);
      expectHeaderOnly(late);
      await expectPdf(late);
      expect((await outbox()).length).toBe(queuedFrom + 1);
    }

    // What was sold: the seeded sale's item is listed.
    await expect(dlg.getByTestId("owner-items")).toContainText("E2E item");

    // The lowered order opens from the list.
    await flagRow(flags, "editDown", ord(num)).getByRole("button", { name: "Open order", exact: true }).click();
    await expect(page.locator('[role="dialog"]').filter({ has: page.locator("header h3.font-mono") })).toBeVisible();
    await context.close();

    // ── Admin page: Today, then a longer period (counted first, small → loads) ──
    const admin = await newSession(browser, "owner");
    await admin.page.goto("/admin");
    await admin.page.getByRole("link", { name: "Owner report" }).first().click();
    await expect(admin.page).toHaveURL(/\/admin\/owner-report/);
    const ap = admin.page.getByTestId("owner-report");
    await expect(ap.getByTestId("owner-flags")).toBeVisible({ timeout: 30_000 });
    await showAll(ap);
    await expect(flagRow(ap.getByTestId("owner-flags"), "editDown", ord(num))).toBeVisible();
    for (const period of ["This month", "All time"]) {
      await admin.page.getByRole("button", { name: period, exact: true }).click();
      // Counted first (small here) → loads by itself.
      await expect(ap.getByTestId("owner-flags")).toBeVisible({ timeout: 30_000 });
      await showAll(ap);
      await expect(flagRow(ap.getByTestId("owner-flags"), "cancelCash", ord(num + 1))).toBeVisible();
    }
    await admin.context.close();

    // ── Staff: the same report, read-only — everyone's changes (the owner's as
    //    a note), the 3 buttons, but no opening orders; their email goes to the
    //    owner's addresses, which they only see masked ──
    const st = await newSession(browser, "staff");
    const spos = new Pos(st.page);
    await spos.goto();
    await spos.toolbar().locator("button", { hasText: "Report" }).click();
    const sdlg = st.page.getByRole("dialog", { name: "Day End Report" });
    await sdlg.getByRole("tab", { name: "Owner report" }).click();
    const sflags = sdlg.getByTestId("owner-flags");
    await expect(sflags).toBeVisible({ timeout: 30_000 });
    await showAll(sdlg);
    await expect(flagRow(sflags, "editDown", ord(num))).toBeVisible();
    await expect(sdlg.getByTestId("owner-timeline")).toContainText(`E2E Owner changed order #${num + 1}: Rs 800 → Rs 700`);
    await expect(flagRow(sflags, "editDown", ord(num + 1))).toHaveCount(0);
    await sdlg.getByRole("button", { name: /^Show notes/ }).click();
    await expect(flagRow(sflags, "editDown", ord(num + 1))).toHaveAttribute("data-level", "low");
    await expect(sdlg.getByRole("button", { name: "Open order", exact: true })).toHaveCount(0);
    const sactions = sdlg.getByTestId("owner-actions");
    await expect(sactions.getByRole("button", { name: "Save PDF" })).toBeVisible();
    await expect(sactions.getByRole("button", { name: "Print slip", exact: true })).toBeVisible();
    if (OUTBOX) {
      const before = (await outbox()).length;
      await sactions.getByRole("button", { name: "Send to Gmail" }).click();
      await expect(sactions).toContainText("Report emailed to e2***@gmail.com", { timeout: 60_000 });
      const smail = await nextMail(before);
      expect(smail.to).toEqual([OWNER_MAIL]);
      expectHeaderOnly(smail);
      await expectPdf(smail);
    }

    await st.page.goto("/admin");
    await st.page.getByRole("link", { name: "Owner report" }).first().click();
    await expect(st.page).toHaveURL(/\/admin\/owner-report/);
    const sap = st.page.getByTestId("owner-report");
    await expect(sap.getByTestId("owner-flags")).toBeVisible({ timeout: 30_000 });
    await showAll(sap);
    await expect(flagRow(sap.getByTestId("owner-flags"), "editDown", ord(num))).toBeVisible();
    await expect(sap.getByRole("button", { name: "Open order", exact: true })).toHaveCount(0);
    await expect(sap.getByTestId("owner-actions").getByRole("button", { name: "Send to Gmail" })).toBeVisible();
    await st.context.close();
  } finally {
    await commitAdmin([
      deleteWrite(`orders/${lowered}`),
      deleteWrite(`orders/${cancelled}`),
      deleteWrite(`activityLogs/${logEdit}`),
      deleteWrite(`activityLogs/${logCancel}`),
      deleteWrite(`activityLogs/${logOwner}`),
      deleteWrite(`cashDrawers/${drawer}`),
      deleteWrite("privateSettings/ownerReport"),
    ]);
  }
});

test("report emails: the owner sets who gets them; the daily email goes once after the day closes", async ({ browser, request }) => {
  serialOnly();
  test.setTimeout(240_000);
  test.skip(!OUTBOX || !CRON_SECRET, "needs REPORT_EMAIL_OUTBOX + CRON_SECRET (pnpm test:e2e:local)");
  // Seeded shop day = midnight to midnight: the newest closed day is yesterday.
  const yesterday = shiftDateKey(karachiDateKey(), -1);
  const marker = `reportEmails/daily_${yesterday}`;
  const a = "owner.one@gmail.com";
  const b = "partner.two@gmail.com";
  expect((await commitAdmin([deleteWrite("privateSettings/ownerReport"), deleteWrite(marker)])).status).toBe(200);

  try {
    // ── Landing Page: add, check, save, still there after a reload ──
    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin/landing");
    const box = page.getByTestId("report-email-settings");
    await expect(box).toContainText("No email yet");
    const input = box.getByLabel("Send to");
    await input.fill("not-an-email");
    await box.getByRole("button", { name: "Add", exact: true }).click();
    await expect(box.getByRole("alert")).toContainText("Enter a valid email");
    await input.fill(a.toUpperCase());
    await input.press("Enter");
    await input.fill(b);
    await box.getByRole("button", { name: "Add", exact: true }).click();
    await expect(box.getByTestId("report-email-list")).toContainText(a);
    await expect(box.getByTestId("report-email-list")).toContainText(b);
    await expect(box).toContainText("unsaved changes");
    await box.getByRole("button", { name: "Save emails" }).click();
    await expect(box).toContainText("Saved.");
    expect((await getDoc("privateSettings/ownerReport"))?.data.emails).toEqual([a, b]);
    await page.reload();
    await expect(box.getByTestId("report-email-list")).toContainText(b);
    await box.getByRole("button", { name: `Remove ${b}` }).click();
    await expect(box.getByTestId("report-email-list")).not.toContainText(b);
    await box.getByRole("button", { name: "Save emails" }).click();
    await expect(box).toContainText("Saved.");
    expect((await getDoc("privateSettings/ownerReport"))?.data.emails).toEqual([a]);

    // ── "Send last day's report now": the server makes the PDF and emails it ──
    let before = (await outbox()).length;
    await box.getByRole("button", { name: "Send last day's report now" }).click();
    await expect(box).toContainText(`Sent to ${a}`, { timeout: 90_000 });
    const test1 = await nextMail(before);
    expect(test1.to).toEqual([a]);
    expect(test1.subject).toContain("Owner report");
    await expectPdf(test1);

    // ── The hourly cron: only with its secret; sends the closed day once ──
    expect((await request.get("/api/admin/cron/owner-report")).status()).toBe(401);
    const cron = () =>
      request.get("/api/admin/cron/owner-report", { headers: { Authorization: `Bearer ${CRON_SECRET}` }, timeout: 90_000 });
    before = (await outbox()).length;
    const first = await cron();
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = (await first.json()) as { daily: { empty: boolean } };
    expect(firstBody).toMatchObject({ daily: { status: "sent", dateKey: yesterday, to: [a] }, updates: [] });
    const daily = await nextMail(before);
    expectHeaderOnly(daily);
    await expectPdf(daily);
    // A day with nothing on the cloud says so (an offline POS uploads later).
    expect(daily.text.includes("No sales have reached the cloud")).toBe(firstBody.daily.empty);
    expect((await getDoc(marker))?.data).toMatchObject({ status: "sent", dateKey: yesterday });
    const again = await cron();
    expect(await again.json()).toMatchObject({ daily: { status: "skipped", reason: "already-handled" }, updates: [] });
    expect((await outbox()).length).toBe(before + 1);

    // ── The POS was offline: yesterday's sale reaches the cloud today → the
    //    next hourly check sends yesterday again, marked "updated" — once ──
    const lateSale = tag("or-late-sale");
    const lateNum = 9_950_000 + Math.floor(Math.random() * 40_000);
    const staff = await staffToken();
    expect(
      // 23:30 in Karachi: late in yesterday's day (the hours check below moves it).
      (await commitAdmin([order(lateSale, lateNum, staff, { total: 1234, status: "completed", at: `${yesterday}T18:30:00.000Z` })])).status,
    ).toBe(200);
    try {
      const upd = await cron();
      expect(upd.status(), await upd.text()).toBe(200);
      expect(await upd.json()).toMatchObject({
        daily: { status: "skipped", reason: "already-handled" },
        updates: [{ status: "sent", dateKey: yesterday }],
      });
      const updated = await nextMail(before + 1);
      expect(updated.subject).toContain("Owner report (updated)");
      expect(updated.text).toContain("Owner report (updated)");
      expect(updated.text).toContain("reached the cloud after the first report");
      await expectPdf(updated);
      expect(await (await cron()).json()).toMatchObject({ updates: [] });
      expect((await outbox()).length).toBe(before + 2);
      expect((await getDoc(marker))?.data).toMatchObject({ status: "sent", updates: 1 });

      // Cancelled later (only its status changes, not the day's total) → updated again.
      expect(
        (await commitAdmin([
          updateWrite(`orders/${lateSale}`, { status: "cancelled", updatedAt: new Date().toISOString() }, { mask: ["status", "updatedAt"] }),
        ])).status,
      ).toBe(200);
      expect(await (await cron()).json()).toMatchObject({ updates: [{ status: "sent", dateKey: yesterday }] });
      expect((await outbox()).length).toBe(before + 3);
      expect((await getDoc(marker))?.data).toMatchObject({ status: "sent", updates: 2 });

      // New shop hours (day ends 23:00): the 23:30 sale moves to the next day.
      // Nothing new happened — no "updated" email, only a fresh fingerprint.
      const hourKeys = ["businessDayStart", "businessDayEnd"];
      const shop = (await getDoc("settings/shop"))?.data ?? {};
      const oldHours = Object.fromEntries(hourKeys.filter((k) => shop[k] != null).map((k) => [k, shop[k]]));
      const setHours = (h: Record<string, unknown>) => commitAdmin([updateWrite("settings/shop", h as never, { mask: hourKeys })]);
      expect((await setHours({ businessDayStart: "00:00", businessDayEnd: "23:00" })).status).toBe(200);
      try {
        expect(await (await cron()).json()).toMatchObject({ updates: [] });
        expect((await getDoc(marker))?.data).toMatchObject({ hours: "00:00-23:00", updates: 2 });
      } finally {
        expect((await setHours(oldHours)).status).toBe(200);
      }
      // Back to the old hours: the same — no email.
      expect(await (await cron()).json()).toMatchObject({ updates: [] });
      expect((await getDoc(marker))?.data).toMatchObject({ updates: 2 });
    } finally {
      await commitAdmin([deleteWrite(`orders/${lateSale}`)]);
    }

    // ── The same "Send to Gmail" twice (the PC missed the first answer) → one email.
    //    Sent the way an older app queued it (one PDF, plain fields): still goes. ──
    const owner = await ownerToken();
    const sentSoFar = await outbox();
    const pdf = await readFile(path.join(OUTBOX, sentSoFar[sentSoFar.length - 1]!.attachments[0]!.file));
    const dupId = `rep_e2e_${Date.now().toString(36)}`;
    const post = () =>
      request.post("/api/admin/owner-report/email", {
        headers: { Authorization: `Bearer ${owner.idToken}` },
        multipart: {
          pdf: { name: "BravoBites-Owner-Report_test.pdf", mimeType: "application/pdf", buffer: pdf },
          fileName: "BravoBites-Owner-Report_test.pdf",
          subject: "Owner report test",
          periodLabel: "test",
          locale: "en",
          outboxId: dupId,
        },
      });
    const dupFrom = (await outbox()).length;
    const one = await post();
    expect(one.status(), await one.text()).toBe(200);
    const two = await post();
    expect(two.status(), await two.text()).toBe(200);
    expect(await two.json()).toMatchObject({ ok: true, to: [a] });
    expect((await outbox()).length).toBe(dupFrom + 1);

    await page.reload();
    await expect(box.getByTestId("report-email-last")).toContainText("Last daily email:");
    await expect(box.getByTestId("report-email-last")).toContainText("sent");

    // Daily email switched off → the cron sends nothing.
    await box.getByRole("checkbox", { name: /Email the day's report by itself/ }).uncheck();
    await box.getByRole("button", { name: "Save emails" }).click();
    await expect(box).toContainText("Saved.");
    expect(await (await cron()).json()).toMatchObject({ daily: { status: "skipped", reason: "off" }, updates: [] });
    await context.close();
  } finally {
    await commitAdmin([deleteWrite("privateSettings/ownerReport"), deleteWrite(marker)]);
  }
});

test("admin owner report on the POS PC counts its not-yet-synced sale — once", async ({ browser }) => {
  serialOnly();
  test.setTimeout(240_000);
  const { context, page } = await newSession(browser, "owner");
  const pos = new Pos(page);
  await pos.goto();
  await pos.waitCounterReady();
  await pos.waitAllSynced(30_000);

  const admin = await context.newPage();
  await admin.goto("/admin/owner-report");
  const items = admin.getByTestId("owner-items");
  await expect(admin.getByTestId("owner-report")).toBeVisible({ timeout: 30_000 });
  const clubQty = async () => {
    if (!(await items.isVisible())) return 0;
    // Each group shows its first items; open the rest.
    for (const more of await items.getByRole("button", { name: /^Show all/ }).all()) await more.click();
    const row = items.locator("li").filter({ hasText: "Chicken Club" });
    if ((await row.count()) === 0) return 0;
    const m = /×(\d+)/.exec(await row.first().innerText());
    return m ? Number(m[1]) : 0;
  };
  const before = await clubQty();

  // A sale while the net is down: only on this PC's queue.
  await context.setOffline(true);
  await page.bringToFront();
  await pos.addProduct("Chicken Club");
  await pos.checkout({ customer: tag("or-local"), print: false });
  await expect(pos.reportPendingDot()).toHaveCount(1);

  // The admin tab picks it up when it's looked at again.
  await admin.bringToFront();
  await admin.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(clubQty, { timeout: 15_000 }).toBe(before + 1);

  // Synced: now it comes from the cloud — still counted once.
  await context.setOffline(false);
  await page.bringToFront();
  await pos.waitAllSynced();
  await admin.bringToFront();
  await admin.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(clubQty, { timeout: 30_000 }).toBe(before + 1);
  await admin.waitForTimeout(2_000);
  expect(await clubQty()).toBe(before + 1);
  await context.close();
});

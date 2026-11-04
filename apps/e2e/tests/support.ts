/**
 * Shared helpers for the emulator-backed e2e specs.
 *
 * - Emulator REST (admin bypass "Bearer owner") to read what really reached
 *   Firestore, and REST as a signed-in user (Auth emulator ID token) to check
 *   what the security rules accept or refuse.
 * - Small page helpers for the POS / order sheet / expenses UI.
 *
 * Never clears emulator data: every test writes its own uniquely named docs.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { login, OWNER_EMAIL, PASSWORD, STAFF_EMAIL } from "./helpers";

export const PROJECT_ID = process.env.E2E_PROJECT_ID || "demo-bravobites";
export const FIRESTORE_HOST = process.env.E2E_FIRESTORE_HOST || "127.0.0.1:8080";
export const AUTH_HOST = process.env.E2E_AUTH_HOST || "127.0.0.1:9099";
export const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3001";
export const BRANCH_ID = "main";

const DOC_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS = `http://${FIRESTORE_HOST}/v1/${DOC_ROOT}`;

/** Guard: these helpers must only ever talk to a local demo emulator. */
if (!/^demo-/.test(PROJECT_ID) || !/^(127\.0\.0\.1|localhost):/.test(FIRESTORE_HOST)) {
  throw new Error(`e2e support refuses to run against ${PROJECT_ID} @ ${FIRESTORE_HOST}`);
}

/* ───────────────────────── time ───────────────────────── */

/** Karachi calendar day (seeded shop day = 00:00 → 23:59). */
export function karachiDateKey(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

export function shiftDateKey(key: string, days: number): string {
  const noon = new Date(`${key}T12:00:00+05:00`);
  return karachiDateKey(new Date(noon.getTime() + days * 86_400_000));
}

/** Unique, searchable tag for docs a test creates. */
export function tag(label: string): string {
  return `E2E-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/* ─────────────────────── Firestore REST ─────────────────────── */

export type Json = Record<string, unknown>;
export type FsDoc = { id: string; path: string; data: Json; raw: Json };

type FsValue = Record<string, unknown>;

function decodeValue(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return { timestamp: String(v.timestampValue) };
  if ("arrayValue" in v) {
    const vals = ((v.arrayValue as Json)?.values ?? []) as FsValue[];
    return vals.map(decodeValue);
  }
  if ("mapValue" in v) return decodeFields(((v.mapValue as Json)?.fields ?? {}) as Json);
  if ("referenceValue" in v) return v.referenceValue;
  return undefined;
}

export function decodeFields(fields: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v as FsValue);
  return out;
}

export function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Json) } };
  throw new Error(`cannot encode ${typeof v}`);
}

export function encodeFields(obj: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v);
  return out;
}

function toDoc(raw: Json): FsDoc {
  const name = String(raw.name);
  const path = name.slice(name.indexOf("/documents/") + "/documents/".length);
  return {
    id: path.split("/").pop()!,
    path,
    raw: (raw.fields ?? {}) as Json,
    data: decodeFields((raw.fields ?? {}) as Json),
  };
}

const ADMIN = "owner"; // emulator admin bypass token (rules not applied)

/** Read one doc (admin bypass). null when missing. */
export async function getDoc(path: string): Promise<FsDoc | null> {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return toDoc((await res.json()) as Json);
}

/** Equality query (admin bypass). */
export async function queryDocs(
  collectionId: string,
  equals: Record<string, string | number | boolean>,
): Promise<FsDoc[]> {
  const filters = Object.entries(equals).map(([field, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encodeValue(value) },
  }));
  const where =
    filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } };
  const res = await fetch(`${FS}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where } }),
  });
  if (!res.ok) throw new Error(`runQuery ${collectionId} → ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as { document?: Json }[];
  return rows.filter((r) => r.document).map((r) => toDoc(r.document!));
}

/** Poll until exactly one doc matches and `check` passes; returns it. */
export async function waitForOne(
  collectionId: string,
  equals: Record<string, string | number | boolean>,
  check: (d: FsDoc) => boolean = () => true,
  timeout = 45_000,
): Promise<FsDoc> {
  const holder: { doc: FsDoc | null } = { doc: null };
  await expect
    .poll(
      async () => {
        const docs = await queryDocs(collectionId, equals);
        holder.doc = docs.length === 1 && check(docs[0]!) ? docs[0]! : null;
        return holder.doc
          ? "ok"
          : `${docs.length} match(es)` + (docs[0] ? ` ${JSON.stringify(docs[0].data).slice(0, 400)}` : "");
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBe("ok");
  return holder.doc!;
}

export async function waitForGone(path: string, timeout = 45_000): Promise<void> {
  await expect
    .poll(async () => ((await getDoc(path)) ? "present" : "gone"), {
      timeout,
      intervals: [500, 1000, 2000],
    })
    .toBe("gone");
}

export function isTimestamp(v: unknown): boolean {
  return typeof v === "object" && v !== null && "timestamp" in (v as Json);
}

/* ─────────────────────── REST as a user (rules apply) ─────────────────────── */

export type Token = { idToken: string; uid: string };
const tokenCache = new Map<string, Token>();

export async function signIn(email: string, password = PASSWORD): Promise<Token> {
  const hit = tokenCache.get(email);
  if (hit) return hit;
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as Json;
  if (!res.ok) throw new Error(`signIn ${email} → ${res.status} ${JSON.stringify(body)}`);
  const tok = { idToken: String(body.idToken), uid: String(body.localId) };
  tokenCache.set(email, tok);
  return tok;
}

export const staffToken = () => signIn(STAFF_EMAIL);
export const ownerToken = () => signIn(OWNER_EMAIL);

export type Write = Json;

/** `update` write; `serverTime` fields get REQUEST_TIME, `exists` sets a precondition. */
export function updateWrite(
  path: string,
  fields: Json,
  opts: { mask?: string[]; serverTime?: string[]; exists?: boolean } = {},
): Write {
  return {
    update: { name: `${DOC_ROOT}/${path}`, fields: encodeFields(fields) },
    ...(opts.mask ? { updateMask: { fieldPaths: opts.mask } } : {}),
    ...(opts.serverTime?.length
      ? {
          updateTransforms: opts.serverTime.map((fieldPath) => ({
            fieldPath,
            setToServerValue: "REQUEST_TIME",
          })),
        }
      : {}),
    ...(opts.exists !== undefined ? { currentDocument: { exists: opts.exists } } : {}),
  };
}

export function deleteWrite(path: string): Write {
  return { delete: `${DOC_ROOT}/${path}` };
}

/** Commit writes as a user (rules enforced) or as admin (token "owner"). */
export async function commitAs(
  token: string,
  writes: Write[],
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${FS}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  return { status: res.status, body: await res.text() };
}

export const commitAdmin = (writes: Write[]) => commitAs(ADMIN, writes);

/**
 * For tests that use state shared by the whole branch (today's cash drawer,
 * the staff account's permissions, the total order count): other tests
 * running at the same time would change what they measure. Run the suite with
 * `--workers=1`; with more workers these skip instead of failing falsely.
 */
export function serialOnly() {
  test.skip(test.info().config.workers > 1, "shares branch-wide state — run with --workers=1");
}

/* ─────────────────────── browser sessions ─────────────────────── */

export type Role = "owner" | "staff";

export async function newSession(
  browser: Browser,
  role: Role,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, role === "owner" ? OWNER_EMAIL : STAFF_EMAIL, PASSWORD);
  return { context, page };
}

/** Collects uncaught page errors + console errors for a page. */
export function watchErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") consoleErrors.push(text);
    else if (msg.type() === "warning") consoleWarnings.push(text);
  });
  return { pageErrors, consoleErrors, consoleWarnings };
}

/** Dev-server / browser noise that is not the app's fault. */
export function isNoise(text: string): boolean {
  return (
    /\[HMR\]|\[Fast Refresh\]|webpack-hmr|turbopack|__nextjs|_next\/static\/development/i.test(text) ||
    /Download the React DevTools/i.test(text) ||
    /favicon\.ico/i.test(text)
  );
}

/* ─────────────────────── POS page ─────────────────────── */

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Pos {
  constructor(readonly page: Page) {}

  toolbar(): Locator {
    return this.page.locator("nav.pos-toolbar");
  }

  reportPendingDot(): Locator {
    return this.toolbar()
      .locator("button", { hasText: "Report" })
      .locator('[aria-label="Pending sync"]');
  }

  expensesPendingDot(): Locator {
    return this.toolbar()
      .locator("button", { hasText: "Expenses" })
      .locator('[aria-label="Pending sync"]');
  }

  async goto() {
    await this.page.goto("/pos");
    await expect(this.page.locator(".pos-product-card").first()).toBeVisible({ timeout: 45_000 });
  }

  /** The PC has loaded the cloud order counter once (needed to sell offline). */
  async waitCounterReady() {
    await expect
      .poll(
        () =>
          this.page.evaluate(async () => {
            const dbs = (await indexedDB.databases?.()) ?? [];
            if (!dbs.some((d) => d.name === "bravobites-pos-queue")) return null;
            return await new Promise<string | null>((resolve) => {
              const req = indexedDB.open("bravobites-pos-queue");
              req.onerror = () => resolve(null);
              req.onsuccess = () => {
                const db = req.result;
                try {
                  if (!db.objectStoreNames.contains("meta")) {
                    db.close();
                    resolve(null);
                    return;
                  }
                  const get = db.transaction("meta").objectStore("meta").get("meta");
                  get.onsuccess = () => {
                    db.close();
                    resolve((get.result as { lastCloudSyncAt?: string } | undefined)?.lastCloudSyncAt ?? null);
                  };
                  get.onerror = () => {
                    db.close();
                    resolve(null);
                  };
                } catch {
                  db.close();
                  resolve(null);
                }
              };
            });
          }),
        { timeout: 30_000, intervals: [300, 600, 1000] },
      )
      .not.toBeNull();
  }

  async addProduct(name: string) {
    const search = this.page.locator("input.pos-menu-search");
    await search.fill(name);
    const card = this.page.locator(".pos-product-card", {
      has: this.page.locator(".pos-product-name", { hasText: new RegExp(`^${escapeRe(name)}$`) }),
    });
    await expect(card).toHaveCount(1);
    await card.click();
    await search.fill("");
  }

  /** Review bill → fill → Checkout. Returns once the preview has closed (saved locally). */
  async checkout(opts: { customer?: string; payment?: "Cash" | "Card" | "Online"; print?: boolean } = {}) {
    await this.page.getByRole("button", { name: "Review bill" }).click();
    const dlg = this.page.getByRole("dialog", { name: "Receipt preview" });
    await expect(dlg).toBeVisible();
    if (opts.customer) await dlg.locator("#checkout-customer-name").fill(opts.customer);
    if (opts.payment) await dlg.getByRole("button", { name: opts.payment, exact: true }).click();
    if (opts.print === false) {
      const sw = dlg.getByRole("switch");
      if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
    }
    const btn = dlg.getByRole("button", { name: "Checkout", exact: true });
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    await btn.click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });
  }

  /** Sell one product to a named customer; returns the cloud doc once synced. */
  async sell(product: string, customer: string, opts: { payment?: "Cash" | "Card" | "Online" } = {}) {
    await this.addProduct(product);
    await this.checkout({ customer, payment: opts.payment, print: false });
    return waitForOne("orders", { customerName: customer }, (d) => isTimestamp(d.data.syncedAtServer));
  }

  async openRecent(): Promise<Locator> {
    await this.toolbar().getByRole("button", { name: /Recent orders/ }).click();
    const dlg = this.page
      .getByRole("dialog")
      .filter({ has: this.page.getByRole("heading", { name: "Recent orders" }) });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText("Loading…")).toBeHidden({ timeout: 30_000 });
    return dlg;
  }

  /** Recent orders → the card containing `text` → order detail sheet. */
  async openOrder(text: string): Promise<Locator> {
    const dlg = await this.openRecent();
    const card = dlg.getByRole("button").filter({ hasText: text });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.click();
    const sheet = orderSheet(this.page);
    await expect(sheet).toBeVisible();
    return sheet;
  }

  async waitAllSynced(timeout = 90_000) {
    await expect(this.reportPendingDot()).toHaveCount(0, { timeout });
    await expect(this.expensesPendingDot()).toHaveCount(0, { timeout });
  }

  async openExpenses(): Promise<Locator> {
    await this.toolbar().getByRole("button", { name: /^Expenses/ }).click();
    const dlg = this.page.getByRole("dialog", { name: "Expenses" });
    await expect(dlg).toBeVisible();
    return dlg;
  }
}

/** The order detail sheet (POS and admin Orders) — its header shows "#0001". */
export function orderSheet(page: Page): Locator {
  return page.locator('[role="dialog"]').filter({ has: page.locator("header h3.font-mono") });
}

/** Click a confirm dialog's button, then (optionally) OK on the success notice. */
export async function confirmAlert(page: Page, title: string, button = "Yes") {
  const dlg = page.getByRole("alertdialog", { name: title });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: button, exact: true }).click();
}

export async function acknowledgeSuccess(page: Page, title: string) {
  const dlg = page.getByRole("alertdialog", { name: title });
  await expect(dlg).toBeVisible({ timeout: 15_000 });
  await dlg.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dlg).toBeHidden();
}

import {
  businessDayHoursFromSettings,
  DEFAULT_SETTINGS,
  endOfBusinessDay,
  openingOfBusinessDay,
  startOfBusinessDay,
  type ActivityLog,
  type CashDrawerSession,
  type InventoryItem,
  type StockMovement,
  type Expense,
  type Order,
  type ShopSettings,
} from "@bravobites/domain";
import { AggregateField, type Firestore } from "firebase-admin/firestore";
import { translator, type Locale } from "@/i18n/dictionaries";
import {
  asActivityLog,
  asCashDrawer,
  asCategory,
  asExpense,
  asOrder,
  asInventoryItem,
  asProduct,
  asStockMovement,
  parseShopSettings,
} from "@/lib/firestore-parse";
import { computeOwnerReport, type OwnerReport } from "@/lib/owner-report";
import { fill, ownerReportFileName, periodText } from "@/lib/owner-report-text";
import { buildOwnerReportHtml } from "@/lib/print-owner-report";
import { localePdfName, REPORT_EMAIL_LOCALES } from "@/lib/report-email";
import { reportEmailBody } from "@/lib/server/mailer";

/**
 * One business day's owner report, made on the server (Admin SDK) for the
 * daily email: the same queries the owner's screen runs for that day, the
 * same math, the same A4 page.
 */

export const serverT = translator;

export async function readShopSettings(db: Firestore): Promise<ShopSettings> {
  // Same doc the app reads (the settings collection holds one).
  const snap = await db.collection("settings").limit(1).get();
  return snap.empty ? DEFAULT_SETTINGS : parseShopSettings(snap.docs[0]!.data());
}

async function branchData(db: Firestore, branchId: string, sinceIso: string, untilIso: string, dateKey: string) {
  const [orders, expenses, orderLogs, expenseLogs, stockLogs, drawers, stockItems, stockMoves] = await Promise.all([
    db
      .collection("orders")
      .where("branchId", "==", branchId)
      .where("createdAt", ">=", sinceIso)
      .where("createdAt", "<=", untilIso)
      .get(),
    db.collection("expenses").where("branchId", "==", branchId).where("date", "in", ["", dateKey]).get(),
    ...(["order", "expense", "inventory"] as const).map((entityType) =>
      db
        .collection("activityLogs")
        .where("entityType", "==", entityType)
        .where("branchId", "==", branchId)
        .where("createdAt", ">=", sinceIso)
        .where("createdAt", "<=", untilIso)
        .orderBy("createdAt", "desc")
        .limit(2000)
        .get(),
    ),
    db.collection("cashDrawers").where("branchId", "==", branchId).where("date", "==", dateKey).get(),
    // Stock: rows + every movement from the day's start up to now (the
    // opening is worked back from the live count).
    db.collection("inventory").where("branchId", "==", branchId).get(),
    db.collection("stockMovements").where("branchId", "==", branchId).where("createdAt", ">=", sinceIso).get(),
  ]);
  return {
    orders: orders.docs.map((d) => asOrder(d.id, d.data())),
    expenses: expenses.docs.map((d) => asExpense(d.id, d.data())),
    logs: [...orderLogs.docs, ...expenseLogs.docs, ...stockLogs.docs].map((d) => asActivityLog(d.id, d.data())),
    drawers: drawers.docs.map((d) => asCashDrawer(d.id, d.data())),
    stockItems: stockItems.docs.map((d) => asInventoryItem(d.id, d.data())),
    stockMoves: stockMoves.docs.map((d) => asStockMovement(d.id, d.data())),
  };
}

/** The report in one language: its A4 page (→ PDF) and the email's labels. */
export type ServerReportPage = {
  locale: Locale;
  branchLabel?: string;
  periodLabel: string;
  html: string;
  fileName: string;
};

export type ServerOwnerReport = {
  report: OwnerReport;
  /** Nothing of the day reached the cloud (no sale, expense or change). */
  empty: boolean;
  shopName: string;
  /** One per language, English first. */
  pages: ServerReportPage[];
};

/** The email's subject and text, each language in turn (its PDFs go with it). */
export function reportEmailContent(o: {
  shopName: string;
  pages: { locale: Locale; periodLabel: string; branchLabel?: string }[];
  updated?: boolean;
  empty?: boolean;
}): { subject: string; text: string; html: string } {
  const [first, ...rest] = o.pages;
  const tFirst = serverT(first.locale);
  const subject = [
    fill(tFirst(o.updated ? "orEmailSubjectUpdated" : "orEmailSubject"), { shop: o.shopName, period: first.periodLabel }),
    ...rest.map((p) => serverT(p.locale)(o.updated ? "orEmailTitleUpdated" : "ownerReport")),
  ].join(" · ");
  const body = reportEmailBody({
    shopName: o.shopName,
    parts: o.pages.map((p) => {
      const t = serverT(p.locale);
      return {
        dir: p.locale === "ur" ? "rtl" : "ltr",
        title: t(o.updated ? "orEmailTitleUpdated" : "ownerReport"),
        branchLabel: p.branchLabel,
        periodLabel: p.periodLabel,
        // Nothing reached the cloud: say so, rather than look like a day of no sales.
        note: o.updated ? t("orEmailUpdatedNote") : o.empty ? t("orEmailEmptyNote") : undefined,
        attached: o.pages.length > 1 ? t("orEmailAttached") : undefined,
      };
    }),
  });
  return { subject, ...body };
}

export async function buildServerOwnerReport(
  db: Firestore,
  opts: { dateKey: string; settings?: ShopSettings },
): Promise<ServerOwnerReport> {
  const { dateKey } = opts;
  const settings = opts.settings ?? (await readShopSettings(db));
  const hours = businessDayHoursFromSettings(settings);
  const from = startOfBusinessDay(dateKey, hours);
  const to = endOfBusinessDay(dateKey, hours);

  const [branchSnap, ownerSnap, catSnap, productSnap] = await Promise.all([
    db.collection("branches").get(),
    db.collection("users").where("role", "==", "owner").get(),
    db.collection("categories").get(),
    db.collection("products").get(),
  ]);
  const branches = branchSnap.docs
    .filter((d) => d.data().isActive !== false)
    .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }));

  const orders: Order[] = [];
  const expenses: Expense[] = [];
  const logs: ActivityLog[] = [];
  const drawers: CashDrawerSession[] = [];
  const stockItems: InventoryItem[] = [];
  const stockMoves: StockMovement[] = [];
  const parts = await Promise.all(
    branches.map((b) => branchData(db, b.id, from.toISOString(), to.toISOString(), dateKey)),
  );
  for (const p of parts) {
    orders.push(...p.orders);
    expenses.push(...p.expenses);
    logs.push(...p.logs);
    drawers.push(...p.drawers);
    stockItems.push(...p.stockItems);
    stockMoves.push(...p.stockMoves);
  }

  const report = computeOwnerReport({
    orders,
    expenses,
    logs,
    drawers,
    stock: { items: stockItems, movements: stockMoves },
    from,
    to,
    fromKey: dateKey,
    toKey: dateKey,
    ownerUids: new Set(ownerSnap.docs.map((d) => d.id)),
    catalog: {
      categories: catSnap.docs.map((d) => asCategory(d.id, d.data())),
      products: productSnap.docs.map((d) => asProduct(d.id, d.data())),
    },
  });

  const shopName = settings.shopName || serverT("en")("brand");
  const multiBranch = branches.length > 1;
  const branchNameFor = multiBranch ? (id: string) => branches.find((b) => b.id === id)?.name : undefined;
  const fileName = ownerReportFileName(dateKey, dateKey);
  const printedAt = new Date();
  const pages = REPORT_EMAIL_LOCALES.map((locale): ServerReportPage => {
    const t = serverT(locale);
    const branchLabel = multiBranch ? t("allBranches") : branches[0]?.name;
    const periodLabel = periodText({ from: openingOfBusinessDay(dateKey, hours), to, locale, t });
    return {
      locale,
      branchLabel,
      periodLabel,
      html: buildOwnerReportHtml({ report, t, locale, multiDay: false, shopName, branchLabel, periodLabel, branchNameFor, format: "a4", printedAt }),
      fileName: localePdfName(fileName, locale),
    };
  });

  return {
    report,
    empty: report.day.dayOrders.length === 0 && report.day.dayExpenses.length === 0 && report.events.length === 0,
    shopName,
    pages,
  };
}

/**
 * A short fingerprint of everything one business day's report is made of —
 * per branch: how many orders and their total, the cancelled ones, refunds,
 * cash / card split, change-log lines, expenses and their amount. Server
 * counts (about 1 read each), not the documents: cheap enough to check every
 * hour whether a day changed after its email went out (an offline PC
 * uploading the day late, a later cancel / refund / payment fix).
 *
 * Each aggregate has its own composite index (firestore.indexes.json); a
 * missing one makes this throw — callers treat the fingerprint as optional.
 */
/** Fingerprint format version — a stored one of another version is not compared. */
export const DAY_SIGNATURE_VERSION = "v2|";

/** The fingerprint shows any sale, refund, change or expense for the day. */
export function signatureHasData(signature: string): boolean {
  return signature
    .slice(DAY_SIGNATURE_VERSION.length)
    .split("|")
    .some((part) => /[1-9]/.test(part.replace(/^[^:]*:/, "")));
}

export async function daySignature(db: Firestore, dateKey: string, settings: ShopSettings): Promise<string> {
  const hours = businessDayHoursFromSettings(settings);
  const since = startOfBusinessDay(dateKey, hours).toISOString();
  const until = endOfBusinessDay(dateKey, hours).toISOString();
  const branchSnap = await db.collection("branches").get();
  const ids = branchSnap.docs.filter((d) => d.data().isActive !== false).map((d) => d.id);
  const parts = await Promise.all(
    ids.map(async (branchId) => {
      const dayOrders = () =>
        db.collection("orders").where("branchId", "==", branchId).where("createdAt", ">=", since).where("createdAt", "<=", until);
      const ordersWhere = (field: "status" | "paymentMethod", value: string) =>
        db
          .collection("orders")
          .where("branchId", "==", branchId)
          .where(field, "==", value)
          .where("createdAt", ">=", since)
          .where("createdAt", "<=", until)
          .aggregate({ n: AggregateField.count(), total: AggregateField.sum("total") })
          .get();
      const logs = (entityType: "order" | "expense") =>
        db
          .collection("activityLogs")
          .where("entityType", "==", entityType)
          .where("branchId", "==", branchId)
          .where("createdAt", ">=", since)
          .where("createdAt", "<=", until)
          .orderBy("createdAt", "desc")
          .count()
          .get();
      const [orders, cancelled, refunds, cash, card, orderLogs, expenseLogs, expenses] = await Promise.all([
        dayOrders().aggregate({ n: AggregateField.count(), total: AggregateField.sum("total") }).get(),
        ordersWhere("status", "cancelled"),
        dayOrders().aggregate({ refunds: AggregateField.sum("refundAmount") }).get(),
        ordersWhere("paymentMethod", "cash"),
        ordersWhere("paymentMethod", "card"),
        logs("order"),
        logs("expense"),
        db
          .collection("expenses")
          .where("branchId", "==", branchId)
          .where("date", "==", dateKey)
          .aggregate({ n: AggregateField.count(), amount: AggregateField.sum("amount") })
          .get(),
      ]);
      const o = orders.data();
      const c = cancelled.data();
      const e = expenses.data();
      return [
        branchId,
        `${o.n}/${o.total ?? 0}`,
        `x${c.n}/${c.total ?? 0}`,
        `r${refunds.data().refunds ?? 0}`,
        `c${cash.data().n}/${cash.data().total ?? 0}`,
        `k${card.data().n}/${card.data().total ?? 0}`,
        `l${orderLogs.data().count}/${expenseLogs.data().count}`,
        `e${e.n}/${e.amount ?? 0}`,
      ].join(":");
    }),
  );
  return DAY_SIGNATURE_VERSION + parts.sort().join("|");
}

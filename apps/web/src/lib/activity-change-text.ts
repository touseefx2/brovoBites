import { formatPkr, type ExpenseCategory } from "@bravobites/domain";
import type { MessageKey } from "@/i18n/dictionaries";
import type { ActivityLog } from "@bravobites/domain";
import { buildLogView, type ChangeField, type ChangeLine } from "@/lib/activity-change";
import { expenseCategoryLabelKey } from "@/lib/expense-labels";

/** Wording for a log's "what changed" lines — the screen and print use the same. */

type T = (key: MessageKey) => string;

export const FIELD_LABEL: Record<ChangeField, MessageKey> = {
  orderType: "orderType",
  payment: "paymentMethod",
  customer: "customerName",
  phone: "customerPhone",
  table: "tableNumber",
  address: "address",
  delivery: "deliveryCharges",
  discount: "discount",
  tax: "tax",
  category: "category",
  description: "description",
  amount: "lgAmount",
  date: "lgDate",
};

const ENUM: Record<string, MessageKey> = {
  cash: "cash",
  card: "card",
  digital: "digital",
  "dine-in": "dineIn",
  takeaway: "takeaway",
  delivery: "delivery",
};

/** A field's value as people read it: payment / type / category translated, "" → "none". */
export function fieldValue(field: ChangeField, value: string, t: T): string {
  if (!value) return t("lgNone");
  if ((field === "payment" || field === "orderType") && ENUM[value]) return t(ENUM[value]);
  if (field === "category" && value in expenseCategoryLabelKey) {
    return t(expenseCategoryLabelKey[value as ExpenseCategory]);
  }
  return value;
}

export function categoryText(category: string, t: T): string {
  return category in expenseCategoryLabelKey ? t(expenseCategoryLabelKey[category as ExpenseCategory]) : category;
}

/** Signed rupees: "+Rs 600" / "−Rs 200". */
export function signedPkr(n: number): string {
  return `${n < 0 ? "−" : "+"}${formatPkr(Math.abs(n))}`;
}

/**
 * Right-to-left text (Urdu): every English name, number and Rs amount inside
 * a plain-text line is wrapped in invisible "first strong isolate" marks, so
 * the arrow between two of them points the reading way and old → new can't
 * flip. lgArrow is "←" exactly in the right-to-left languages. Left-to-right:
 * unchanged text.
 */
export function isolator(t: T): (v: string | number) => string {
  return t("lgArrow") === "←" ? (v) => `\u2068${v}\u2069` : (v) => String(v);
}

/** One line as plain text (print). */
export function changeLineText(line: ChangeLine, t: T): string {
  const i = isolator(t);
  const to = ` ${t("lgArrow")} `;
  switch (line.kind) {
    case "add":
      return `${t("lgAdded")}: ${i(line.name)} ${i(`×${line.qty}`)}${line.amount ? ` (${i(signedPkr(line.amount))})` : ""}`;
    case "remove":
      return `${t("lgRemoved")}: ${i(line.name)} ${i(`×${line.qty}`)}${line.amount ? ` (${i(signedPkr(line.amount))})` : ""}`;
    case "qty":
      return `${t("lgQty")}: ${i(line.name)} ${i(line.from)}${to}${i(line.to)}${line.amount ? ` (${i(signedPkr(line.amount))})` : ""}`;
    case "price":
      return `${t("lgPrice")}: ${i(line.name)} ${i(formatPkr(line.from))}${to}${i(formatPkr(line.to))}`;
    case "field":
      return `${t(FIELD_LABEL[line.field])}: ${i(fieldValue(line.field, line.from, t))}${to}${i(fieldValue(line.field, line.to, t))}`;
  }
}

/** "Removed: Zinger ×1 · Payment: Cash → Card" — a log's changes on one line ("" when none). */
export function changeSummary(log: ActivityLog, t: T, max = 3): string {
  const lines = buildLogView(log).lines;
  const shown = lines.slice(0, max).map((l) => changeLineText(l, t));
  if (lines.length > max) shown.push(`+${lines.length - max}`);
  return shown.join(" · ");
}

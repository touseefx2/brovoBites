import type {
  ActivityExpenseSnapshot,
  ActivityLog,
  ActivityOrderSnapshot,
} from "@bravobites/domain";
import { formatPkr, money } from "@bravobites/domain";

/**
 * One activity log line made readable: what kind of change, the bill before
 * and after, and a short "what changed" list (item added / removed, qty,
 * price, payment, discount…). Newer logs carry the before / after bills
 * (`log.change`); older ones only text — that text is taken apart here.
 * Shared by the POS log popup, the admin Activity page and the owner report.
 */

export type LogViewKind =
  | "orderEdit"
  | "orderCancel"
  | "orderDelete"
  | "orderRefund"
  | "expenseAdd"
  | "expenseEdit"
  | "expenseDelete"
  | "other";

/** Fields the "what changed" list can name (the UI translates the label and enum values). */
export type ChangeField =
  | "orderType"
  | "payment"
  | "customer"
  | "phone"
  | "table"
  | "address"
  | "delivery"
  | "discount"
  | "tax"
  | "category"
  | "description"
  | "amount"
  | "date";

export type ChangeLine =
  | { kind: "add" | "remove"; name: string; qty: number; amount?: number }
  | { kind: "qty"; name: string; from: number; to: number; amount?: number }
  | { kind: "price"; name: string; from: number; to: number }
  | { kind: "field"; field: ChangeField; from: string; to: string };

export interface LogView {
  kind: LogViewKind;
  orderNumber?: number;
  /** Bill total before / after an edit. */
  totalBefore?: number;
  totalAfter?: number;
  /** Cancelled / deleted bill, refund, or expense amount. */
  amount?: number;
  lines: ChangeLine[];
  before?: ActivityOrderSnapshot;
  after?: ActivityOrderSnapshot;
  /** Older logs: the item lists as text ("Zinger ×1, Fries ×2"). */
  beforeItemsText?: string;
  afterItemsText?: string;
  expenseBefore?: ActivityExpenseSnapshot;
  expenseAfter?: ActivityExpenseSnapshot;
  refund?: { amount: number; reason?: string; totalRefunded?: number };
  /** Who uploaded it for the person (shared PC). */
  uploadedBy?: string;
  /** Anything else the log said (older logs). */
  notes: string[];
}

const AMOUNT = String.raw`Rs\s*(-?[\d,]+(?:\.\d+)?)`;
const rupees = (s: string) => money(Number(s.replace(/,/g, "")));
const firstAmount = (text: string) => {
  const m = new RegExp(AMOUNT).exec(text);
  return m ? rupees(m[1]) : undefined;
};

/* ── Order bills: before → after ── */

function lineMap(bill: ActivityOrderSnapshot) {
  const map = new Map<string, { qty: number; lineTotal: number; unitPrice: number }>();
  for (const i of bill.items) {
    const cur = map.get(i.name);
    if (cur) {
      cur.qty += i.qty;
      cur.lineTotal += i.lineTotal;
    } else {
      map.set(i.name, { qty: i.qty, lineTotal: i.lineTotal, unitPrice: i.unitPrice });
    }
  }
  return map;
}

function discountText(b: ActivityOrderSnapshot): string {
  if (!(b.discountAmount > 0)) return "";
  return b.discountLabel ? `${b.discountLabel} (−${formatPkr(b.discountAmount)})` : `−${formatPkr(b.discountAmount)}`;
}

export function diffBills(before: ActivityOrderSnapshot, after: ActivityOrderSnapshot): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const a = lineMap(before);
  const b = lineMap(after);
  for (const [name, x] of b) {
    const prev = a.get(name);
    if (!prev) lines.push({ kind: "add", name, qty: x.qty, amount: money(x.lineTotal) });
    else if (prev.qty !== x.qty) {
      lines.push({ kind: "qty", name, from: prev.qty, to: x.qty, amount: money(x.lineTotal - prev.lineTotal) });
    } else if (prev.unitPrice !== x.unitPrice) {
      lines.push({ kind: "price", name, from: prev.unitPrice, to: x.unitPrice });
    }
  }
  for (const [name, x] of a) {
    if (!b.has(name)) lines.push({ kind: "remove", name, qty: x.qty, amount: money(-x.lineTotal) });
  }
  const field = (f: ChangeField, from: string, to: string) => {
    if (from !== to) lines.push({ kind: "field", field: f, from, to });
  };
  field("orderType", before.orderType ?? "", after.orderType ?? "");
  field("payment", before.paymentMethod, after.paymentMethod);
  field("discount", discountText(before), discountText(after));
  field("delivery", before.deliveryCharges ? formatPkr(before.deliveryCharges) : "", after.deliveryCharges ? formatPkr(after.deliveryCharges) : "");
  field("tax", before.taxAmount ? formatPkr(before.taxAmount) : "", after.taxAmount ? formatPkr(after.taxAmount) : "");
  field("customer", before.customerName ?? "", after.customerName ?? "");
  field("phone", before.customerPhone ?? "", after.customerPhone ?? "");
  field("table", before.tableNumber ?? "", after.tableNumber ?? "");
  field("address", before.deliveryAddress ?? "", after.deliveryAddress ?? "");
  return lines;
}

/* ── Older logs: text only ── */

const clean = (v: string) => {
  const t = v.trim().replace(/^“|”$/g, "").trim();
  return t === "—" ? "" : t;
};

/** "Added item: Zinger ×1 · Payment: cash → card · Before: … · After: …" → lines. */
function parseOrderEditText(detail: string, view: LogView) {
  for (const raw of detail.split(/\s·\s/)) {
    const part = raw.trim();
    if (!part) continue;
    let m: RegExpExecArray | null;
    if ((m = /^Added item:\s*(.+?)\s*×(\d+)$/.exec(part))) {
      view.lines.push({ kind: "add", name: m[1], qty: Number(m[2]) });
    } else if ((m = /^Removed item:\s*(.+?)\s*×(\d+)$/.exec(part))) {
      view.lines.push({ kind: "remove", name: m[1], qty: Number(m[2]) });
    } else if ((m = /^Qty change:\s*(.+?)\s+(\d+)\s*→\s*(\d+)$/.exec(part))) {
      view.lines.push({ kind: "qty", name: m[1], from: Number(m[2]), to: Number(m[3]) });
    } else if ((m = /^(Type|Payment|Customer|Phone|Address|Table|Delivery|Discount):\s*(.*?)\s*→\s*(.*)$/.exec(part))) {
      const field: Record<string, ChangeField> = {
        Type: "orderType",
        Payment: "payment",
        Customer: "customer",
        Phone: "phone",
        Address: "address",
        Table: "table",
        Delivery: "delivery",
        Discount: "discount",
      };
      const strip = (v: string) => clean(v).replace(/^Discount\s*/i, "").trim();
      view.lines.push({ kind: "field", field: field[m[1]], from: strip(m[2]), to: strip(m[3]) });
    } else if ((m = /^Before:\s*(.+)$/.exec(part))) {
      view.beforeItemsText = m[1];
    } else if ((m = /^After:\s*(.+)$/.exec(part))) {
      view.afterItemsText = m[1];
    } else if ((m = /^Synced by\s+(.+)$/i.exec(part))) {
      view.uploadedBy = m[1];
    } else if (!/^Updated$/i.test(part)) {
      view.notes.push(part);
    }
  }
}

/** "other · gas · Rs 500 · 2026-10-24" → expense fields. */
export function parseExpenseLabel(label: string): ActivityExpenseSnapshot | undefined {
  const parts = label.split(/\s·\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parts[parts.length - 1]) ? parts.pop()! : "";
  const amountAt = parts.findIndex((p) => /^Rs\s*-?[\d,]/.test(p));
  if (amountAt < 0) return undefined;
  const amount = rupees(new RegExp(AMOUNT).exec(parts[amountAt])![1]);
  const [category, ...rest] = parts.slice(0, amountAt);
  return { category: category ?? "", description: rest.join(" · "), amount, date };
}

function splitNotes(detail: string | undefined, view: LogView, skip: RegExp) {
  for (const raw of (detail ?? "").split(/\s·\s/)) {
    const part = raw.trim();
    if (!part || skip.test(part)) continue;
    const by = /^Synced by\s+(.+)$/i.exec(part);
    if (by) view.uploadedBy = by[1];
    else view.notes.push(part);
  }
}

/**
 * An order refund (logged as an order "update"). Only order logs — an expense
 * whose text mentions "refund" is not one.
 */
export function isRefundLog(log: ActivityLog): boolean {
  if (log.entityType !== "order" || log.action !== "update") return false;
  return (log.change?.kind === "order" && !!log.change.refund) || /^refund/i.test(log.summary);
}

export function buildLogView(log: ActivityLog): LogView {
  const num = /#(\d+)/.exec(log.summary);
  const view: LogView = {
    kind: "other",
    orderNumber: num ? Number(num[1]) : undefined,
    lines: [],
    notes: [],
  };
  const change = log.change;

  if (log.entityType === "order") {
    const before = change?.kind === "order" ? change.before : undefined;
    const after = change?.kind === "order" ? change.after : undefined;
    if (before) {
      view.before = before;
      view.orderNumber = before.orderNumber || view.orderNumber;
    }

    if (log.action === "update" && /^refund/i.test(log.summary)) {
      view.kind = "orderRefund";
      const refund = change?.kind === "order" ? change.refund : undefined;
      const total = /total refunded\s*Rs\s*([\d,]+(?:\.\d+)?)/i.exec(log.summary);
      view.refund = refund ?? {
        amount: firstAmount(log.summary) ?? 0,
        totalRefunded: total ? rupees(total[1]) : undefined,
      };
      view.amount = view.refund.amount;
      if (!refund) {
        // Older text: "reason · Items: … · Stock restored"
        const parts = (log.detail ?? "").split(/\s·\s/).map((p) => p.trim()).filter(Boolean);
        const reason = parts.find((p) => !/^(Items:|Stock |Partial|Synced by)/i.test(p));
        if (reason) view.refund.reason = reason;
        const items = parts.find((p) => /^Items:/i.test(p));
        if (items) view.beforeItemsText = items.replace(/^Items:\s*/i, "");
        const by = parts.find((p) => /^Synced by/i.test(p));
        if (by) view.uploadedBy = by.replace(/^Synced by\s+/i, "");
      } else {
        splitNotes(log.detail, view, new RegExp(`^(Items:|Stock |Partial|${escapeRe(refund.reason ?? "\u0000")}$)`, "i"));
      }
      return view;
    }

    if (log.action === "update") {
      view.kind = "orderEdit";
      const totals = new RegExp(`${AMOUNT}\\s*→\\s*${AMOUNT}`).exec(log.summary);
      if (before && after) {
        view.after = after;
        view.totalBefore = before.total;
        view.totalAfter = after.total;
        view.lines = diffBills(before, after);
        splitNotes(log.detail, view, /^(Added item|Removed item|Qty change|Type|Payment|Customer|Phone|Address|Table|Delivery|Discount|Before|After|Updated)\b/i);
      } else {
        if (totals) {
          view.totalBefore = rupees(totals[1]);
          view.totalAfter = rupees(totals[2]);
        }
        parseOrderEditText(log.detail ?? "", view);
      }
      return view;
    }

    if (log.action === "cancel" || log.action === "delete") {
      view.kind = log.action === "cancel" ? "orderCancel" : "orderDelete";
      view.amount = before?.total ?? firstAmount(log.summary);
      if (!before) {
        const items = /^(?:Cancelled|Deleted) items:\s*(.+?)(?:\s·\s|$)/i.exec(log.detail ?? "");
        if (items) view.beforeItemsText = items[1];
      }
      splitNotes(log.detail, view, /^(Cancelled items|Deleted items|Order cancelled)\b/i);
      return view;
    }
    return view;
  }

  if (log.entityType === "expense") {
    const before = change?.kind === "expense" ? change.before : undefined;
    const after = change?.kind === "expense" ? change.after : undefined;
    if (log.action === "create") {
      view.kind = "expenseAdd";
      view.expenseAfter = after ?? parseExpenseLabel(log.detail ?? "");
      view.amount = view.expenseAfter?.amount ?? firstAmount(log.summary);
      return view;
    }
    if (log.action === "update") {
      view.kind = "expenseEdit";
      if (before || after) {
        view.expenseBefore = before;
        view.expenseAfter = after;
      } else {
        const [b, a] = (log.detail ?? "").split(/\s*→\s*After:\s*/);
        view.expenseBefore = parseExpenseLabel((b ?? "").replace(/^Before:\s*/i, ""));
        view.expenseAfter = a ? parseExpenseLabel(a.replace(/\s·\sSynced by.+$/i, "")) : undefined;
        const by = /Synced by\s+(.+)$/i.exec(log.detail ?? "");
        if (by) view.uploadedBy = by[1];
      }
      const eb = view.expenseBefore;
      const ea = view.expenseAfter;
      if (eb && ea) {
        const f = (field: ChangeField, from: string, to: string) => {
          if (from !== to) view.lines.push({ kind: "field", field, from, to });
        };
        f("amount", formatPkr(eb.amount), formatPkr(ea.amount));
        f("category", eb.category, ea.category);
        f("description", eb.description, ea.description);
        f("date", eb.date, ea.date);
      }
      view.amount = ea?.amount ?? firstAmount(log.summary);
      return view;
    }
    if (log.action === "delete") {
      view.kind = "expenseDelete";
      view.expenseBefore = before ?? parseExpenseLabel(log.summary.replace(/^Deleted expense\s*/i, ""));
      view.amount = view.expenseBefore?.amount ?? firstAmount(log.summary);
      splitNotes(log.detail, view, /^$/);
      return view;
    }
  }
  return view;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

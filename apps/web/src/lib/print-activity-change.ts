import type { ActivityExpenseSnapshot, ActivityLog, ActivityOrderSnapshot } from "@bravobites/domain";
import { formatPkr } from "@bravobites/domain";
import type { MessageKey } from "@/i18n/dictionaries";
import { buildLogView, type ChangeLine } from "@/lib/activity-change";
import { categoryText, changeLineText, FIELD_LABEL, fieldValue } from "@/lib/activity-change-text";
import { escapeHtml as e } from "@/lib/print-receipt";

/**
 * ActivityChangeView on paper (A4 owner report / emailed PDF): the same bill
 * before → after, "what changed" list and full bills — already open, since
 * nobody can click "Details" on a PDF. Styles: LOG_DETAIL_CSS.
 */

type T = (key: MessageKey) => string;

const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

function money(value: number, cls = "", sign = ""): string {
  return `<bdi dir="ltr" class="m ${cls}">${sign}${e(formatPkr(value))}</bdi>`;
}

function signed(value: number): string {
  return money(Math.abs(value), value < 0 ? "neg" : "pos", value < 0 ? "−" : "+");
}

function arrow(t: T): string {
  return `<span class="arr">${e(t("lgArrow"))}</span>`;
}

const MARK: Record<ChangeLine["kind"], { sym: string; cls: string }> = {
  add: { sym: "+", cls: "mk-add" },
  remove: { sym: "−", cls: "mk-rem" },
  qty: { sym: "×", cls: "mk-chg" },
  price: { sym: "Rs", cls: "mk-chg" },
  field: { sym: "✎", cls: "mk-fld" },
};

function changeList(lines: ChangeLine[], t: T): string {
  return `<ul class="ld-chg">${lines
    .map((l) => {
      let label: string;
      let body: string;
      let amount: number | undefined;
      switch (l.kind) {
        case "add":
        case "remove":
          label = t(l.kind === "add" ? "lgAdded" : "lgRemoved");
          body = `<span${l.kind === "remove" ? ' class="struck"' : ""}>${e(l.name)}</span> <span class="dim">×${l.qty}</span>`;
          amount = l.amount;
          break;
        case "qty":
          label = t("lgQty");
          body = `${e(l.name)} <bdi dir="ltr" class="b">${l.from}</bdi>${arrow(t)}<bdi dir="ltr" class="b">${l.to}</bdi>`;
          amount = l.amount;
          break;
        case "price":
          label = t("lgPrice");
          body = `${e(l.name)} ${money(l.from)}${arrow(t)}${money(l.to, "b")}`;
          break;
        case "field":
          label = t(FIELD_LABEL[l.field]);
          body = `<bdi class="dim">${e(fieldValue(l.field, l.from, t))}</bdi>${arrow(t)}<bdi class="b">${e(fieldValue(l.field, l.to, t))}</bdi>`;
          break;
      }
      const mark = MARK[l.kind];
      return `<li><span class="mk ${mark.cls}">${mark.sym}</span><span class="ld-line"><b>${e(label)}:</b> ${body}</span>${amount ? signed(amount) : ""}</li>`;
    })
    .join("")}</ul>`;
}

function billCard(
  t: T,
  title: string,
  bill?: ActivityOrderSnapshot,
  itemsText?: string,
  mark?: Set<string>,
  tone?: "before" | "after",
): string {
  const hl = tone === "after" ? "hl-after" : "hl-before";
  const items = bill
    ? bill.items.length === 0
      ? `<li class="dim">—</li>`
      : bill.items
          .map(
            (i) =>
              `<li class="${mark?.has(i.name) ? hl : ""}"><span>${e(i.name)} <span class="dim">×${i.qty}</span></span>${money(i.lineTotal)}</li>`,
          )
          .join("")
    : (itemsText ? itemsText.split(/,\s+/) : []).map((x) => `<li><span>${e(x)}</span></li>`).join("");
  let foot = "";
  if (bill) {
    const typeKey: MessageKey | null =
      bill.orderType === "dine-in" ? "dineIn" : bill.orderType === "takeaway" ? "takeaway" : bill.orderType === "delivery" ? "delivery" : null;
    const rows = [
      `<div><span>${e(t("subtotal"))}</span>${money(bill.subtotal)}</div>`,
      bill.discountAmount > 0
        ? `<div><span>${e(t("discount"))}${bill.discountLabel ? ` ${e(bill.discountLabel)}` : ""}</span>${money(bill.discountAmount, "", "−")}</div>`
        : "",
      bill.taxAmount > 0 ? `<div><span>${e(t("tax"))}</span>${money(bill.taxAmount, "", "+")}</div>` : "",
      bill.deliveryCharges > 0 ? `<div><span>${e(t("deliveryCharges"))}</span>${money(bill.deliveryCharges, "", "+")}</div>` : "",
      `<div class="tot"><span>${e(t("total"))}</span>${money(bill.total)}</div>`,
    ];
    const meta = [
      t(bill.paymentMethod),
      typeKey ? t(typeKey) : "",
      bill.tableNumber ? `${t("tableNumber")} ${bill.tableNumber}` : "",
      bill.customerName ?? "",
    ].filter(Boolean);
    foot = `<div class="bill-foot">${rows.join("")}<p class="dim">${e(meta.join(" · "))}</p></div>`;
  }
  return `<div class="bill"><p class="cap">${e(title)}</p><ul>${items}</ul>${foot}</div>`;
}

function changedNames(lines: ChangeLine[], side: "before" | "after"): Set<string> {
  const names = new Set<string>();
  for (const l of lines) {
    if (l.kind === "qty" || l.kind === "price") names.add(l.name);
    if (l.kind === "add" && side === "after") names.add(l.name);
    if (l.kind === "remove" && side === "before") names.add(l.name);
  }
  return names;
}

function expenseLine(x: ActivityExpenseSnapshot, t: T, struck: boolean): string {
  return `<p class="ld-exp${struck ? " struck" : ""}">${money(x.amount, "b")} <b>${e(categoryText(x.category, t))}</b>${
    x.description ? ` <span class="dim">· ${e(x.description)}</span>` : ""
  }${x.date ? ` <bdi dir="ltr" class="dim">${e(x.date)}</bdi>` : ""}</p>`;
}

function expenseCompare(t: T, before?: ActivityExpenseSnapshot, after?: ActivityExpenseSnapshot): string {
  const rows: { key: MessageKey; b: string; a: string }[] = [
    { key: "lgAmount", b: before ? formatPkr(before.amount) : "—", a: after ? formatPkr(after.amount) : "—" },
    { key: "category", b: before ? categoryText(before.category, t) : "—", a: after ? categoryText(after.category, t) : "—" },
    { key: "description", b: before?.description || t("lgNone"), a: after?.description || t("lgNone") },
    { key: "lgDate", b: before?.date || "—", a: after?.date || "—" },
  ];
  return `<table class="ld-cmp"><thead><tr><th></th><th>${e(t("lgBefore"))}</th><th>${e(t("lgAfter"))}</th></tr></thead><tbody>${rows
    .map((r) => {
      const changed = r.b !== r.a;
      return `<tr${changed ? ' class="chg"' : ""}><th>${e(t(r.key))}</th><td${changed ? ' class="struck dim"' : ""}><bdi>${e(r.b)}</bdi></td><td${changed ? ' class="b"' : ""}><bdi>${e(r.a)}</bdi></td></tr>`;
    })
    .join("")}</tbody></table>`;
}

/**
 * One log's details, open. `bills: false` leaves out the full bills (the
 * timeline, when the same change is already shown in full under a flag).
 * "" when the log has nothing more to show.
 */
export function logDetailHtml(log: ActivityLog, t: T, opts: { bills?: boolean } = {}): string {
  const bills = opts.bills ?? true;
  const view = buildLogView(log);
  const footer = [
    view.uploadedBy ? `<p class="dim sm">${e(fill(t("lgUploadedBy"), { name: view.uploadedBy }))}</p>` : "",
    view.notes.length > 0 ? `<p class="dim sm">${e(view.notes.join(" · "))}</p>` : "",
  ].join("");
  const wrap = (inner: string) => `<div class="ld">${inner}${footer}</div>`;

  if (view.kind === "orderEdit") {
    const parts: string[] = [];
    if (view.totalBefore != null && view.totalAfter != null) {
      const diff = view.totalAfter - view.totalBefore;
      parts.push(
        `<p class="ld-tot"><span class="dim">${e(t("lgBill"))}</span> ${money(view.totalBefore, "struck dim")}${arrow(t)}${money(view.totalAfter, "b")} ${
          diff
            ? `<span class="pill ${diff < 0 ? "pill-neg" : "pill-pos"}">${e(fill(t(diff < 0 ? "lgLess" : "lgMore"), { amount: formatPkr(Math.abs(diff)) }))}</span>`
            : `<span class="dim sm">${e(t("lgSame"))}</span>`
        }</p>`,
      );
    }
    parts.push(
      view.lines.length > 0
        ? `<p class="cap">${e(t("lgWhatChanged"))}</p>${changeList(view.lines, t)}`
        : `<p class="dim sm">${e(t("lgNoItemChange"))}</p>`,
    );
    if (bills && (view.before || view.beforeItemsText || view.afterItemsText)) {
      parts.push(
        `<div class="bills">${billCard(t, t("lgBefore"), view.before, view.beforeItemsText, changedNames(view.lines, "before"), "before")}${billCard(
          t,
          t("lgAfter"),
          view.after,
          view.afterItemsText,
          changedNames(view.lines, "after"),
          "after",
        )}</div>`,
      );
    }
    return wrap(parts.join(""));
  }

  if (view.kind === "orderCancel" || view.kind === "orderDelete" || view.kind === "orderRefund") {
    const b = view.before;
    let headLine: string;
    if (view.kind === "orderRefund") {
      const total =
        view.refund?.totalRefunded != null
          ? ` <span class="dim sm">· ${e(
              fill(t(b ? "lgTotalRefundedOf" : "lgTotalRefunded"), {
                amount: formatPkr(view.refund.totalRefunded),
                total: b ? formatPkr(b.total) : "",
              }),
            )}</span>`
          : "";
      const reason = view.refund?.reason ? `<p><b>${e(t("lgReason"))}:</b> “${e(view.refund.reason)}”</p>` : "";
      headLine = `<p class="ld-tot"><span class="dim">${e(t("lgRefund"))}</span> ${money(view.refund?.amount ?? 0, "b refund")}${total}</p>${reason}`;
    } else {
      const n = b ? b.items.reduce((s, i) => s + i.qty, 0) : 0;
      const sub = b ? ` <span class="dim sm">· ${e(t(b.paymentMethod))} · ${e(n === 1 ? t("lgItemOne") : fill(t("lgItemsN"), { n }))}</span>` : "";
      headLine = `<p class="ld-tot"><span class="dim">${e(t(view.kind === "orderCancel" ? "lgCancelledBill" : "lgDeletedBill"))}</span> ${
        view.amount != null ? money(view.amount, "b neg") : ""
      }${sub}</p>`;
    }
    const bill = bills && (b || view.beforeItemsText) ? `<div class="bills one">${billCard(t, t("lgBill"), b, view.beforeItemsText)}</div>` : "";
    return wrap(headLine + bill);
  }

  if (view.kind === "expenseEdit") {
    return wrap(view.expenseBefore || view.expenseAfter ? expenseCompare(t, view.expenseBefore, view.expenseAfter) : `<p>${e(log.summary)}</p>`);
  }

  if (view.kind === "expenseAdd" || view.kind === "expenseDelete") {
    const x = view.kind === "expenseAdd" ? view.expenseAfter : view.expenseBefore;
    return wrap(x ? expenseLine(x, t, view.kind === "expenseDelete") : `<p>${e(log.summary)}</p>`);
  }

  return "";
}

function slipBill(t: T, title: string, bill?: ActivityOrderSnapshot, itemsText?: string): string {
  const row = (label: string, value: string, cls = "") => `<div class="row${cls}"><span>${label}</span><span class="v">${value}</span></div>`;
  const pkr = (n: number, sign = "") => `<bdi dir="ltr">${sign}${e(formatPkr(n))}</bdi>`;
  const items = bill
    ? bill.items.map((i) => row(`${e(i.name)} ×${i.qty}`, pkr(i.lineTotal))).join("")
    : (itemsText ? itemsText.split(/,\s+/) : []).map((x) => `<div>${e(x)}</div>`).join("");
  const totals = bill
    ? [
        bill.discountAmount > 0 ? row(`${e(t("discount"))}${bill.discountLabel ? ` ${e(bill.discountLabel)}` : ""}`, pkr(bill.discountAmount, "−")) : "",
        bill.taxAmount > 0 ? row(e(t("tax")), pkr(bill.taxAmount, "+")) : "",
        bill.deliveryCharges > 0 ? row(e(t("deliveryCharges")), pkr(bill.deliveryCharges, "+")) : "",
        row(e(t("total")), pkr(bill.total), " tot"),
      ].join("")
    : "";
  return `<div class="ld-bill"><div class="cap">${e(title)}</div>${items}${totals}</div>`;
}

/**
 * logDetailHtml for the receipt slip: black and white, one column — the bill
 * before → after, every change on its own line, then the bills one under the
 * other.
 */
/** "Rs 760" never breaks between "Rs" and the number (the narrow slip wraps there, and in Urdu the halves swap). */
function keepRs(text: string): string {
  return text.replace(/Rs /g, "Rs\u00a0");
}

export function logDetailSlipHtml(log: ActivityLog, t: T, opts: { bills?: boolean } = {}): string {
  const bills = opts.bills ?? true;
  const view = buildLogView(log);
  const to = ` ${t("lgArrow")} `;
  const parts: string[] = [];

  if (view.kind === "orderEdit") {
    if (view.totalBefore != null && view.totalAfter != null) {
      const diff = view.totalAfter - view.totalBefore;
      const tag = diff
        ? ` (${e(t(diff < 0 ? "lgLess" : "lgMore")).replace("{amount}", `<bdi dir="ltr">${e(keepRs(formatPkr(Math.abs(diff))))}</bdi>`)})`
        : "";
      // Each amount isolated on its own, the arrow in the text's direction: in
      // Urdu (right to left) old → new must not flip.
      parts.push(`<div><b>${e(t("lgBill"))}:</b> <bdi dir="ltr">${e(keepRs(formatPkr(view.totalBefore)))}</bdi>${e(to)}<bdi dir="ltr">${e(keepRs(formatPkr(view.totalAfter)))}</bdi>${tag}</div>`);
    }
    if (view.lines.length > 0) {
      parts.push(`<div class="cap">${e(t("lgWhatChanged"))}</div>`);
      for (const l of view.lines) parts.push(`<div class="ln">${MARK[l.kind].sym} ${e(keepRs(changeLineText(l, t)))}</div>`);
    } else {
      parts.push(`<div>${e(t("lgNoItemChange"))}</div>`);
    }
    if (bills && (view.before || view.beforeItemsText)) parts.push(slipBill(t, t("lgBefore"), view.before, view.beforeItemsText));
    if (bills && (view.after || view.afterItemsText)) parts.push(slipBill(t, t("lgAfter"), view.after, view.afterItemsText));
  } else if (view.kind === "orderCancel" || view.kind === "orderDelete" || view.kind === "orderRefund") {
    if (view.kind === "orderRefund") {
      parts.push(`<div><b>${e(t("lgRefund"))}:</b> <bdi dir="ltr">${e(formatPkr(view.refund?.amount ?? 0))}</bdi></div>`);
      if (view.refund?.reason) parts.push(`<div><b>${e(t("lgReason"))}:</b> “${e(view.refund.reason)}”</div>`);
    }
    if (bills && (view.before || view.beforeItemsText)) parts.push(slipBill(t, t("lgBill"), view.before, view.beforeItemsText));
  } else if (view.kind === "expenseEdit" || view.kind === "expenseAdd" || view.kind === "expenseDelete") {
    for (const l of view.lines) parts.push(`<div class="ln">${MARK[l.kind].sym} ${e(keepRs(changeLineText(l, t)))}</div>`);
    // The whole expense too (after an edit: as it is now), like the screen's table.
    const x = view.kind === "expenseDelete" ? view.expenseBefore : view.expenseAfter;
    if (x) parts.push(`<div>${e(formatPkr(x.amount))} · ${e(categoryText(x.category, t))}${x.description ? ` · ${e(x.description)}` : ""}</div>`);
  }
  if (view.uploadedBy) parts.push(`<div>${e(fill(t("lgUploadedBy"), { name: view.uploadedBy }))}</div>`);
  return parts.length ? `<div class="ld">${parts.join("")}</div>` : "";
}

/** Receipt-slip styles for logDetailSlipHtml. */
export const LOG_DETAIL_SLIP_CSS = `
  .ld { flex-basis: 100%; margin: 0.8mm 0 0; padding: 0.8mm 0 0 1.5mm; border-inline-start: 1px solid #000; font-size: 0.92em; }
  .ld .cap { font-weight: 700; text-transform: uppercase; font-size: 0.85em; margin-top: 0.8mm; }
  .ld .ln { padding-inline-start: 0.5mm; }
  .ld-bill { margin-top: 0.8mm; border-top: 1px dotted #000; }
  .ld-bill .row { margin: 0.2mm 0; }
  .ld-bill .row .v { font-weight: 400; }
  .ld-bill .tot, .ld-bill .tot .v { font-weight: 700; }
`;

/** A4 styles for logDetailHtml (same colours as the screen's details panel). */
export const LOG_DETAIL_CSS = `
  .ld { margin-top: 1.5mm; padding: 2mm 2.5mm; background: #faf7f2; border-radius: 5px; font-size: 10.5px; color: #44403c; }
  .ld p { margin: 0; }
  .ld > :not(:first-child) { margin-top: 1.4mm; }
  .ld .m { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ld .b { font-weight: 700; color: #1c1917; }
  .ld .dim { color: #78716c; }
  .ld .sm { font-size: 9.5px; }
  .ld .struck { text-decoration: line-through; text-decoration-color: #d6d3d1; }
  .ld .neg { color: #b91c1c; font-weight: 700; }
  .ld .pos { color: #047857; font-weight: 700; }
  .ld .refund { color: #c2410c; }
  .ld .arr { color: #a8a29e; padding: 0 0.6mm; }
  .ld .cap { font-size: 8.5px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #78716c; }
  .ld .pill { display: inline-block; margin-inline-start: 1mm; padding: 0 1.8mm; border-radius: 99px; font-size: 9px; font-weight: 800; }
  .ld .pill-neg { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .ld .pill-pos { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .ld-tot { font-size: 11px; }
  .ld-chg li { display: flex; align-items: flex-start; gap: 1.5mm; padding: 0.4mm 0; }
  .ld-chg .ld-line { flex: 1; min-width: 0; }
  .ld-chg b { color: #1c1917; }
  .mk { flex-shrink: 0; min-width: 4.2mm; text-align: center; border-radius: 3px; font-size: 8.5px; font-weight: 800; padding: 0 0.6mm; }
  .mk-add { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .mk-rem { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .mk-chg { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .mk-fld { background: #f5f5f4; color: #57534e; border: 1px solid #e7e5e4; }
  .bills { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; break-inside: avoid; }
  .bills.one { grid-template-columns: minmax(0, 60%); }
  .bill { background: #fff; border: 1px solid #e8dfcf; border-radius: 5px; padding: 1.8mm 2.2mm; min-width: 0; }
  .bill ul { margin-top: 0.8mm; }
  .bill li { display: flex; justify-content: space-between; gap: 2mm; padding: 0 0.8mm; border-radius: 2px; }
  .bill li.hl-before { background: #fef2f2; font-weight: 700; }
  .bill li.hl-after { background: #ecfdf5; font-weight: 700; }
  .bill-foot { margin-top: 1.2mm; padding-top: 1.2mm; border-top: 1px solid #f5f5f4; font-size: 9.5px; color: #57534e; }
  .bill-foot div { display: flex; justify-content: space-between; gap: 2mm; }
  .bill-foot .tot { font-size: 10.5px; font-weight: 800; color: #1c1917; padding-top: 0.4mm; }
  .bill-foot p { margin-top: 0.6mm; font-size: 9px; }
  .ld-cmp { background: #fff; border: 1px solid #e8dfcf; font-size: 10px; }
  .ld-cmp th, .ld-cmp td { text-align: start; padding: 0.8mm 2mm; }
  .ld-cmp tbody th { font-weight: 600; color: #78716c; }
  .ld-cmp tr.chg { background: #fffbeb; }
  /* Urdu: Naskh reads much smaller than Latin at the same size. */
  [dir="rtl"] :is(.ld, .bill) { font-size: 13px; line-height: 1.7; }
  [dir="rtl"] :is(.ld .sm, .ld .cap, .ld .pill, .ld-cmp, .bill-foot, .bill-foot p) { font-size: 12px; }
  [dir="rtl"] :is(.ld-tot, .bill-foot .tot) { font-size: 13px; }
  [dir="rtl"] .ld .cap { letter-spacing: 0; text-transform: none; }
  [dir="rtl"] .mk { font-size: 10px; }
`;

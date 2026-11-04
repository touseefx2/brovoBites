"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { ActivityExpenseSnapshot, ActivityLog, ActivityOrderSnapshot } from "@bravobites/domain";
import { formatPkr } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { buildLogView, type ChangeLine, type LogView } from "@/lib/activity-change";
import { categoryText, FIELD_LABEL, fieldValue } from "@/lib/activity-change-text";

/**
 * One activity log, readable at a glance: the bill before → after and what
 * changed (items added / removed, qty, price, payment, discount…), with the
 * full bills side by side on demand. Cancels, deletes, refunds and expenses
 * get the same treatment. Used by the POS log popup, the admin Activity page
 * and the owner report.
 */

const NUM: CSSProperties = { fontFamily: "var(--font-en), system-ui, sans-serif" };

function Money({ value, className = "", sign }: { value: number; className?: string; sign?: "+" | "−" }) {
  return (
    <bdi dir="ltr" className={`whitespace-nowrap tabular-nums ${className}`} style={NUM}>
      {sign ?? ""}
      {formatPkr(value)}
    </bdi>
  );
}

function Signed({ value }: { value: number }) {
  return (
    <Money
      value={Math.abs(value)}
      sign={value < 0 ? "−" : "+"}
      className={`text-xs font-bold ${value < 0 ? "text-red-700" : "text-emerald-700"}`}
    />
  );
}

function Arrow() {
  const { t } = useLocale();
  return (
    <span className="px-0.5 text-stone-400" aria-hidden>
      {t("lgArrow")}
    </span>
  );
}

function fill(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

const MARK: Record<ChangeLine["kind"], { sym: string; cls: string }> = {
  add: { sym: "+", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  remove: { sym: "−", cls: "bg-red-50 text-red-700 ring-red-200" },
  qty: { sym: "×", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  price: { sym: "Rs", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  field: { sym: "✎", cls: "bg-stone-100 text-stone-600 ring-stone-200" },
};

function ChangeList({ lines }: { lines: ChangeLine[] }) {
  const { t } = useLocale();
  return (
    <ul className="space-y-1" data-testid="log-changes">
      {lines.map((l, i) => {
        const mark = MARK[l.kind];
        let label: ReactNode;
        let body: ReactNode;
        let amount: number | undefined;
        switch (l.kind) {
          case "add":
          case "remove":
            label = t(l.kind === "add" ? "lgAdded" : "lgRemoved");
            body = (
              <>
                <span className={l.kind === "remove" ? "line-through decoration-red-300" : ""}>{l.name}</span>{" "}
                <span className="text-stone-500" style={NUM}>×{l.qty}</span>
              </>
            );
            amount = l.amount;
            break;
          case "qty":
            label = t("lgQty");
            body = (
              <>
                {l.name}{" "}
                <bdi dir="ltr" className="font-semibold" style={NUM}>
                  {l.from}
                </bdi>
                <Arrow />
                <bdi dir="ltr" className="font-semibold" style={NUM}>
                  {l.to}
                </bdi>
              </>
            );
            amount = l.amount;
            break;
          case "price":
            label = t("lgPrice");
            body = (
              <>
                {l.name} <Money value={l.from} />
                <Arrow />
                <Money value={l.to} className="font-semibold" />
              </>
            );
            break;
          case "field":
            label = t(FIELD_LABEL[l.field]);
            body = (
              <>
                <bdi className="text-stone-500">{fieldValue(l.field, l.from, t)}</bdi>
                <Arrow />
                <bdi className="font-semibold text-[var(--ink)]">{fieldValue(l.field, l.to, t)}</bdi>
              </>
            );
            break;
        }
        return (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug" data-kind={l.kind}>
            <span
              className={`mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-bold ring-1 ${mark.cls}`}
              aria-hidden
            >
              {mark.sym}
            </span>
            <span className="min-w-0 flex-1 text-stone-700">
              <span className="font-semibold text-[var(--ink)]">{label}:</span> {body}
            </span>
            {amount ? <Signed value={amount} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function BillCard({
  title,
  bill,
  itemsText,
  mark,
  tone,
}: {
  title: string;
  bill?: ActivityOrderSnapshot;
  itemsText?: string;
  /** Item names to highlight (added / removed / changed). */
  mark?: Set<string>;
  tone?: "before" | "after";
}) {
  const { t } = useLocale();
  const hl = tone === "after" ? "bg-emerald-50" : "bg-red-50";
  const textItems = !bill && itemsText ? itemsText.split(/,\s+/) : [];
  const typeKey = bill?.orderType === "dine-in" ? "dineIn" : bill?.orderType === "takeaway" ? "takeaway" : bill?.orderType === "delivery" ? "delivery" : null;
  return (
    <div className="min-w-0 rounded-xl border border-[#e8dfcf] bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">{title}</p>
      <ul className="mt-1.5 space-y-0.5 text-[13px]">
        {bill
          ? bill.items.map((i, k) => (
              <li
                key={k}
                className={`flex items-baseline justify-between gap-2 rounded px-1 ${mark?.has(i.name) ? `${hl} font-semibold` : ""}`}
              >
                <span className="min-w-0 text-[var(--ink)]">
                  {i.name} <span className="text-stone-500" style={NUM}>×{i.qty}</span>
                </span>
                <Money value={i.lineTotal} className="text-stone-700" />
              </li>
            ))
          : textItems.map((x, k) => (
              <li key={k} className="px-1 text-[var(--ink)]">
                {x}
              </li>
            ))}
        {bill && bill.items.length === 0 ? <li className="px-1 text-stone-500">—</li> : null}
      </ul>
      {bill ? (
        <div className="mt-2 space-y-0.5 border-t border-stone-100 pt-2 text-[12px] text-stone-600">
          <div className="flex justify-between gap-2">
            <span>{t("subtotal")}</span>
            <Money value={bill.subtotal} />
          </div>
          {bill.discountAmount > 0 ? (
            <div className="flex justify-between gap-2">
              <span>
                {t("discount")}
                {bill.discountLabel ? ` ${bill.discountLabel}` : ""}
              </span>
              <Money value={bill.discountAmount} sign="−" />
            </div>
          ) : null}
          {bill.taxAmount > 0 ? (
            <div className="flex justify-between gap-2">
              <span>{t("tax")}</span>
              <Money value={bill.taxAmount} sign="+" />
            </div>
          ) : null}
          {bill.deliveryCharges > 0 ? (
            <div className="flex justify-between gap-2">
              <span>{t("deliveryCharges")}</span>
              <Money value={bill.deliveryCharges} sign="+" />
            </div>
          ) : null}
          <div className="flex justify-between gap-2 pt-0.5 text-[13px] font-bold text-[var(--ink)]">
            <span>{t("total")}</span>
            <Money value={bill.total} />
          </div>
          <p className="pt-1 text-[11px] text-stone-500">
            {t(bill.paymentMethod)}
            {typeKey ? ` · ${t(typeKey)}` : ""}
            {bill.tableNumber ? ` · ${t("tableNumber")} ${bill.tableNumber}` : ""}
            {bill.customerName ? ` · ${bill.customerName}` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ open, onClick, show, hide }: { open: boolean; onClick: () => void; show: string; hide: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-[var(--gold-deep)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
    >
      {open ? hide : show}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={open ? "rotate-180" : ""} aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

function ExpenseLine({ e, struck }: { e: ActivityExpenseSnapshot; struck?: boolean }) {
  const { t } = useLocale();
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] ${struck ? "line-through decoration-red-300" : ""}`}>
      <Money value={e.amount} className="font-bold text-[var(--ink)]" />
      <span className="font-semibold text-stone-700">{categoryText(e.category, t)}</span>
      {e.description ? <span className="text-stone-600">· {e.description}</span> : null}
      {e.date ? (
        <span className="text-xs text-stone-500" style={NUM} dir="ltr">
          {e.date}
        </span>
      ) : null}
    </p>
  );
}

function ExpenseCompare({ before, after }: { before?: ActivityExpenseSnapshot; after?: ActivityExpenseSnapshot }) {
  const { t } = useLocale();
  const rows: { key: "lgAmount" | "category" | "description" | "lgDate"; b: string; a: string }[] = [
    { key: "lgAmount", b: before ? formatPkr(before.amount) : "—", a: after ? formatPkr(after.amount) : "—" },
    { key: "category", b: before ? categoryText(before.category, t) : "—", a: after ? categoryText(after.category, t) : "—" },
    { key: "description", b: before?.description || t("lgNone"), a: after?.description || t("lgNone") },
    { key: "lgDate", b: before?.date || "—", a: after?.date || "—" },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-[#e8dfcf] bg-white">
      <table className="w-full text-[13px]">
        <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
          <tr>
            <th scope="col" className="px-3 py-1.5 text-start font-bold" />
            <th scope="col" className="px-3 py-1.5 text-start font-bold">{t("lgBefore")}</th>
            <th scope="col" className="px-3 py-1.5 text-start font-bold">{t("lgAfter")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => {
            const changed = r.b !== r.a;
            return (
              <tr key={r.key} className={changed ? "bg-amber-50" : ""}>
                <th scope="row" className="px-3 py-1.5 text-start text-xs font-semibold text-stone-500">{t(r.key)}</th>
                <td className={`px-3 py-1.5 ${changed ? "text-stone-500 line-through decoration-stone-300" : "text-stone-700"}`}>
                  <bdi>{r.b}</bdi>
                </td>
                <td className={`px-3 py-1.5 ${changed ? "font-bold text-[var(--ink)]" : "text-stone-700"}`}>
                  <bdi>{r.a}</bdi>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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

/** True when buildLogView understood the log (else show its raw text). */
export function logHasView(log: ActivityLog): boolean {
  return buildLogView(log).kind !== "other";
}

export function ActivityChangeView({
  log,
  view: given,
  showTotals = true,
  billsOpen = false,
}: {
  log: ActivityLog;
  view?: LogView;
  /** Bill "before → after" line (the owner report's flag text already says it). */
  showTotals?: boolean;
  /** Bill(s) always shown, no show / hide of its own (the owner report row has one). */
  billsOpen?: boolean;
}) {
  const { t } = useLocale();
  const view = useMemo(() => given ?? buildLogView(log), [given, log]);
  const [open, setOpen] = useState(billsOpen);
  const hasBill = Boolean(view.before || view.beforeItemsText);

  const footer = (
    <>
      {view.uploadedBy ? (
        <p className="text-[11px] text-stone-500">{fill(t("lgUploadedBy"), { name: view.uploadedBy })}</p>
      ) : null}
      {view.notes.length > 0 ? <p className="text-[11px] text-stone-500">{view.notes.join(" · ")}</p> : null}
    </>
  );

  if (view.kind === "orderEdit") {
    const diff = view.totalBefore != null && view.totalAfter != null ? view.totalAfter - view.totalBefore : null;
    return (
      <div className="space-y-2" data-testid="log-view" data-kind={view.kind}>
        {showTotals && view.totalBefore != null && view.totalAfter != null ? (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            <span className="text-stone-500">{t("lgBill")}</span>
            <Money value={view.totalBefore} className="text-stone-500 line-through decoration-stone-300" />
            <Arrow />
            <Money value={view.totalAfter} className="font-bold text-[var(--ink)]" />
            {diff ? (
              <span
                className={`ms-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${
                  diff < 0 ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                }`}
              >
                {fill(t(diff < 0 ? "lgLess" : "lgMore"), { amount: formatPkr(Math.abs(diff)) })}
              </span>
            ) : (
              <span className="ms-1 text-xs text-stone-500">{t("lgSame")}</span>
            )}
          </div>
        ) : null}
        {view.lines.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-stone-500">{t("lgWhatChanged")}</p>
            <ChangeList lines={view.lines} />
          </div>
        ) : (
          <p className="text-xs text-stone-500">{t("lgNoItemChange")}</p>
        )}
        {view.before || view.beforeItemsText || view.afterItemsText ? (
          <>
            {billsOpen ? null : <Toggle open={open} onClick={() => setOpen((v) => !v)} show={t("lgShowBill")} hide={t("lgHideBill")} />}
            {open ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <BillCard
                  title={t("lgBefore")}
                  bill={view.before}
                  itemsText={view.beforeItemsText}
                  mark={changedNames(view.lines, "before")}
                  tone="before"
                />
                <BillCard
                  title={t("lgAfter")}
                  bill={view.after}
                  itemsText={view.afterItemsText}
                  mark={changedNames(view.lines, "after")}
                  tone="after"
                />
              </div>
            ) : null}
          </>
        ) : null}
        {footer}
      </div>
    );
  }

  if (view.kind === "orderCancel" || view.kind === "orderDelete" || view.kind === "orderRefund") {
    const b = view.before;
    return (
      <div className="space-y-2" data-testid="log-view" data-kind={view.kind}>
        {view.kind === "orderRefund" ? (
          <div className="space-y-0.5 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-stone-500">{t("lgRefund")}</span>
              <Money value={view.refund?.amount ?? 0} className="font-bold text-orange-700" />
              {view.refund?.totalRefunded != null ? (
                <span className="text-xs text-stone-500">
                  ·{" "}
                  {fill(t(b ? "lgTotalRefundedOf" : "lgTotalRefunded"), {
                    amount: formatPkr(view.refund.totalRefunded),
                    total: b ? formatPkr(b.total) : "",
                  })}
                </span>
              ) : null}
            </p>
            {view.refund?.reason ? (
              <p className="text-[13px] text-stone-700">
                <span className="font-semibold text-[var(--ink)]">{t("lgReason")}:</span> “{view.refund.reason}”
              </p>
            ) : null}
          </div>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="text-stone-500">{t(view.kind === "orderCancel" ? "lgCancelledBill" : "lgDeletedBill")}</span>
            {view.amount != null ? <Money value={view.amount} className="font-bold text-red-700" /> : null}
            {b ? (
              <span className="text-xs text-stone-500">
                · {t(b.paymentMethod)} ·{" "}
                {(() => {
                  const n = b.items.reduce((s, i) => s + i.qty, 0);
                  return n === 1 ? t("lgItemOne") : fill(t("lgItemsN"), { n });
                })()}
              </span>
            ) : null}
          </p>
        )}
        {hasBill ? (
          <>
            {billsOpen ? null : <Toggle open={open} onClick={() => setOpen((v) => !v)} show={t("lgShowItems")} hide={t("lgHideBill")} />}
            {open ? <BillCard title={t("lgBill")} bill={b} itemsText={view.beforeItemsText} /> : null}
          </>
        ) : null}
        {footer}
      </div>
    );
  }

  if (view.kind === "expenseEdit") {
    return (
      <div className="space-y-2" data-testid="log-view" data-kind={view.kind}>
        {view.expenseBefore || view.expenseAfter ? (
          <ExpenseCompare before={view.expenseBefore} after={view.expenseAfter} />
        ) : (
          <p className="text-[13px] text-stone-700">{log.summary}</p>
        )}
        {footer}
      </div>
    );
  }

  if (view.kind === "expenseAdd" || view.kind === "expenseDelete") {
    const e = view.kind === "expenseAdd" ? view.expenseAfter : view.expenseBefore;
    return (
      <div className="space-y-1" data-testid="log-view" data-kind={view.kind}>
        {e ? <ExpenseLine e={e} struck={view.kind === "expenseDelete"} /> : <p className="text-[13px] text-stone-700">{log.summary}</p>}
        {footer}
      </div>
    );
  }

  return null;
}

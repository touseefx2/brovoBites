"use client";

import type { Order, OrderItem, OrderType, PaymentMethod } from "@bravobites/domain";
import { formatOrderDateTime, formatOrderNumber, formatPkr } from "@bravobites/domain";
import { ReviewRequest } from "@/components/ReviewRequest";
import { useLocale } from "@/i18n/locale-context";

function formatItemsLine(items: OrderItem[] | undefined, maxVisible: number): string {
  const list = items ?? [];
  if (list.length === 0) return "";
  const shown = list.slice(0, maxVisible).map((item) => {
    const name = item.variationLabel
      ? `${item.productName} (${item.variationLabel})`
      : item.productName;
    return `${item.qty}× ${name}`;
  });
  const hidden = list.length - shown.length;
  if (hidden > 0) shown.push(`+${hidden}`);
  return shown.join(" · ");
}

function cashierShortName(order: Order) {
  const raw = (order.createdByName || "").trim() || "—";
  if (raw.includes("@")) return raw.split("@")[0] || raw;
  return raw;
}

export function OrderCashierLine({
  order,
  showEmail = false,
}: {
  order: Order;
  showEmail?: boolean;
}) {
  const { t, locale } = useLocale();
  const rawName = (order.createdByName || "").trim() || "—";
  const nameLooksLikeEmail = rawName.includes("@");
  const name = nameLooksLikeEmail ? rawName.split("@")[0] || rawName : rawName;
  const email =
    (order.createdByEmail || "").trim() || (nameLooksLikeEmail ? rawName : "");

  const nameEl = <span className="capitalize">{name}</span>;
  const emailEl =
    showEmail && email ? (
      <span className="font-normal text-[var(--muted)]" dir="ltr">
        {" "}
        ({email})
      </span>
    ) : null;

  if (locale === "ur") {
    return (
      <span className="truncate font-medium text-[var(--ink)]">
        {nameEl}
        {emailEl}
        <span> {t("orderBySuffix")}</span>
      </span>
    );
  }

  return (
    <span className="truncate font-medium text-[var(--ink)]">
      {t("orderByPrefix")} {nameEl}
      {emailEl}
    </span>
  );
}

function paymentLabel(
  method: PaymentMethod,
  t: (k: "cash" | "card" | "digital") => string,
) {
  if (method === "card") return t("card");
  if (method === "digital") return t("digital");
  return t("cash");
}

function orderTypeLabel(
  type: OrderType | undefined,
  t: (k: "dineIn" | "takeaway" | "delivery") => string,
) {
  if (type === "takeaway") return t("takeaway");
  if (type === "delivery") return t("delivery");
  if (type === "dine-in") return t("dineIn");
  return null;
}

function orderAccent(order: Order) {
  if (order.status === "cancelled") return "bg-red-500";
  if (order.refundAmount && order.refundAmount > 0) return "bg-orange-500";
  if (order.updatedAt) return "bg-amber-500";
  if (order.discountAmount && order.discountAmount > 0) return "bg-emerald-600";
  return "bg-[var(--gold-deep)]";
}

export function OrderListCard({
  order,
  onClick,
  showBranch = false,
  dense = false,
  badge,
}: {
  order: Order;
  onClick: () => void;
  showBranch?: boolean;
  dense?: boolean;
  badge?: React.ReactNode;
}) {
  const { t, locale } = useLocale();
  const cancelled = order.status === "cancelled";
  const refunded = Boolean(order.refundAmount && order.refundAmount > 0);
  const amended = !cancelled && Boolean(order.updatedAt);
  const discounted =
    !cancelled && Boolean(order.discountAmount && order.discountAmount > 0);
  const taxAmount = !cancelled ? order.taxAmount ?? 0 : 0;
  const deliveryAmount = !cancelled ? order.deliveryCharges ?? 0 : 0;
  const discountAmount = discounted ? order.discountAmount ?? 0 : 0;
  const itemsSubtotal =
    order.subtotal > 0
      ? order.subtotal
      : order.items.reduce((s, i) => s + i.lineTotal, 0);
  const typeLabel = orderTypeLabel(order.orderType, t);
  const payLabel = paymentLabel(order.paymentMethod, t);
  const itemsLine = formatItemsLine(order.items, dense ? 2 : 3);
  const branchLabel = showBranch ? (order.branchName || "").trim() : "";
  const customerName = order.customerName?.trim() || "";
  const tableNumber = order.tableNumber?.trim() || "";
  const customerPhone = order.customerPhone?.trim() || "";
  const deliveryAddress = order.deliveryAddress?.trim() || "";
  const cashier = cashierShortName(order);
  const hasMoneyNotes =
    discountAmount > 0 || taxAmount > 0 || deliveryAmount > 0;

  const discountPct =
    order.discountType === "percent" && (order.discountValue ?? 0) > 0
      ? `−${order.discountValue}%`
      : null;

  const taxPct =
    (order.taxPercent ?? 0) > 0 ? `${order.taxPercent}%` : null;

  const cashierLabel =
    locale === "ur" ? (
      <>
        <span className="capitalize">{cashier}</span> {t("orderBySuffix")}
      </>
    ) : (
      <>
        {t("orderByPrefix")} <span className="capitalize">{cashier}</span>
      </>
    );

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition hover:border-[rgba(184,134,11,0.35)] hover:shadow-[0_4px_14px_rgba(28,25,23,0.06)] ${
        cancelled ? "opacity-65" : ""
      }`}
    >
      <span
        className={`absolute inset-y-0 start-0 w-[3px] ${orderAccent(order)}`}
        aria-hidden
      />
      <button
        type="button"
        onClick={onClick}
        className="flex w-full cursor-pointer text-start active:scale-[0.998]"
      >

        <div
          className={`flex w-full min-w-0 items-start gap-3 ${
            dense ? "px-3 py-2.5 ps-3.5" : "px-3.5 py-3 ps-4 sm:px-4"
          }`}
        >
          {/* Order # */}
          <div className="shrink-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--gold-deep)]">
              {t("order")}
            </p>
            <p
              className={`mt-0.5 font-mono font-bold tabular-nums leading-none text-[var(--ink)] ${
                dense ? "text-[15px]" : "text-base sm:text-lg"
              }`}
              dir="ltr"
            >
              #{formatOrderNumber(order.orderNumber)}
            </p>
            {order.printedOrderNumber != null ? (
              <p className="mt-0.5 text-[10px] font-semibold text-stone-500" dir="ltr">
                {t("receiptNumber").replace("{n}", formatOrderNumber(order.printedOrderNumber))}
              </p>
            ) : null}
            {badge ? <div className="mt-1">{badge}</div> : null}
          </div>

          {/* Main */}
          <div className="min-w-0 flex-1 space-y-1">
            {/* Items — strongest line */}
            <p
              className={`font-semibold leading-snug text-[var(--ink)] ${
                dense ? "truncate text-[13px]" : "line-clamp-1 text-sm"
              }`}
            >
              {itemsLine || "—"}
            </p>

            {/* Staff · pay · type · flags */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--ink)]/75">
              <span className="font-medium">{cashierLabel}</span>
              <span className="text-stone-300" aria-hidden>
                |
              </span>
              <span className="font-medium">{payLabel}</span>
              {typeLabel ? (
                <>
                  <span className="text-stone-300" aria-hidden>
                    |
                  </span>
                  <span className="font-medium">{typeLabel}</span>
                </>
              ) : null}
              {cancelled ? (
                <span className="font-semibold text-red-600">{t("cancelled")}</span>
              ) : null}
              {amended ? (
                <span className="font-semibold text-amber-700">{t("amended")}</span>
              ) : null}
              {refunded ? (
                <span className="font-semibold text-orange-600">{t("refunded")}</span>
              ) : null}
              {discounted ? (
                <span className="font-semibold text-emerald-700" dir="ltr">
                  {t("discounted")}
                  {discountPct ? ` ${discountPct}` : ""}
                </span>
              ) : null}
            </div>

            {/* Customer meta — labeled, readable */}
            {customerName || tableNumber || customerPhone || deliveryAddress ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
                {customerName ? (
                  <span>
                    <span className="font-medium text-[var(--muted)]">
                      {t("customerName")}:{" "}
                    </span>
                    <span className="font-semibold text-[var(--ink)]">{customerName}</span>
                  </span>
                ) : null}
                {tableNumber ? (
                  <span dir="ltr">
                    <span className="font-medium text-[var(--muted)]">
                      {t("tableNumber")}:{" "}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--ink)]">
                      {tableNumber}
                    </span>
                  </span>
                ) : null}
                {customerPhone ? (
                  <span dir="ltr">
                    <span className="font-medium text-[var(--muted)]">
                      {t("customerPhone")}:{" "}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--ink)]">
                      {customerPhone}
                    </span>
                  </span>
                ) : null}
                {deliveryAddress ? (
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-[var(--muted)]">
                      {t("deliveryAddress")}:{" "}
                    </span>
                    <span className="font-semibold text-[var(--ink)]">
                      {deliveryAddress}
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <p className="text-[11px] font-medium text-[var(--muted)]" dir="ltr">
              {formatOrderDateTime(order.createdAt)}
              {branchLabel ? ` · ${branchLabel}` : ""}
            </p>
          </div>

          {/* Amount column — mini bill when charges differ from items */}
          <div className="flex w-[6.75rem] shrink-0 flex-col items-end gap-1 pt-0.5 sm:w-[7.5rem]">
            {hasMoneyNotes ? (
              <div className="w-full space-y-0.5 border-b border-stone-200/80 pb-1.5 text-[10px] leading-tight sm:text-[11px]">
                <div className="flex w-full items-baseline justify-between gap-2" dir="ltr">
                  <span className="font-medium text-[var(--muted)]">{t("subtotal")}</span>
                  <span className="font-semibold tabular-nums text-[var(--ink)]">
                    {formatPkr(itemsSubtotal)}
                  </span>
                </div>
                {discountAmount > 0 ? (
                  <div className="flex w-full items-baseline justify-between gap-2" dir="ltr">
                    <span className="font-medium text-emerald-700">
                      {t("discount")}
                      {discountPct ? ` ${discountPct}` : ""}
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-700">
                      −{formatPkr(discountAmount)}
                    </span>
                  </div>
                ) : null}
                {taxAmount > 0 ? (
                  <div className="flex w-full items-baseline justify-between gap-2" dir="ltr">
                    <span className="font-medium text-[var(--muted)]">
                      {t("tax")}
                      {taxPct ? ` ${taxPct}` : ""}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--ink)]">
                      +{formatPkr(taxAmount)}
                    </span>
                  </div>
                ) : null}
                {deliveryAmount > 0 ? (
                  <div className="flex w-full items-baseline justify-between gap-2" dir="ltr">
                    <span className="font-medium text-[var(--muted)]">{t("deliveryShort")}</span>
                    <span className="font-semibold tabular-nums text-[var(--ink)]">
                      +{formatPkr(deliveryAmount)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p
              className={`font-bold tabular-nums leading-none ${
                dense ? "text-[15px]" : "text-base sm:text-lg"
              } ${cancelled ? "text-[var(--muted)] line-through" : "text-[var(--gold-deep)]"}`}
              dir="ltr"
            >
              {formatPkr(order.total)}
            </p>
            {hasMoneyNotes ? (
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] sm:text-[10px]">
                {t("total")}
              </p>
            ) : null}
            <span className="mt-0.5 text-[var(--muted)] opacity-50 transition group-hover:opacity-100 group-hover:text-[var(--gold-deep)]">
              <svg
                className="size-3.5 rtl:rotate-180"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </span>
          </div>
        </div>
      </button>
      <ReviewRequest order={order} dense={dense} />
    </div>
  );
}

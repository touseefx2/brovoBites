"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppUser,
  DiscountType,
  Order,
  OrderItem,
  OrderType,
  PaymentMethod,
  Product,
  ShopSettings,
} from "@bravobites/domain";
import {
  amendOrderTotals,
  businessDayHoursFromSettings,
  canApplyDiscount,
  canCancelOrder,
  canDeleteOrder,
  canEditOrder,
  canRefundOrder,
  DEFAULT_SETTINGS,
  formatOrderDateTime,
  formatOrderNumber,
  formatPkr,
  lineTotal,
  money,
  orderRefundableAmount,
  orderRefundedAmount,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { pcClockBlocksSales, shopNow } from "@/lib/shop-clock";
import { mapFirebaseError } from "@/lib/errors";
import {
  fetchProducts,
  orderItemsTotal,
  sanitizeOrderItems,
} from "@/lib/firestore";
import {
  enqueueOrderCancel,
  enqueueOrderDelete,
  enqueueOrderEdit,
  enqueueOrderRefund,
  kickSync,
} from "@/lib/pos-queue";
import { buildReceiptHtml, printReceipt, receiptLabels, type ReceiptCopy } from "@/lib/print-receipt";
import { ReceiptPreview } from "@/components/ReceiptPreview";
import { reviewUrlOf } from "@/lib/review-request";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function cloneItems(items: OrderItem[]): OrderItem[] {
  return items.map((i) => ({ ...i }));
}

function itemsEqual(a: OrderItem[], b: OrderItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, idx) => {
    const o = b[idx];
    return (
      o &&
      item.productId === o.productId &&
      item.variationId === o.variationId &&
      item.qty === o.qty &&
      item.unitPrice === o.unitPrice
    );
  });
}

function norm(s: string | undefined): string {
  return (s || "").trim();
}

/** Restore editable discount controls from a saved order (incl. legacy amount-only). */
function discountDraftFromOrder(order: Order): {
  type: DiscountType;
  value: number;
} {
  if (order.discountType && (order.discountValue ?? 0) > 0) {
    return { type: order.discountType, value: money(order.discountValue!) };
  }
  if ((order.discountAmount ?? 0) > 0) {
    return { type: "fixed", value: money(order.discountAmount!) };
  }
  return { type: "percent", value: 0 };
}

export function OrderDetailSheet({
  order,
  user,
  settings,
  branchName,
  catalogProducts,
  onClose,
  onSaved,
  onDeleted,
}: {
  order: Order;
  user: AppUser;
  settings?: ShopSettings | null;
  /** Fallback when older orders have no stored branchName */
  branchName?: string;
  /**
   * When set (POS one-shot catalog), use these products instead of live fetch.
   * Admin pages omit this and still fetch once when opening the item picker.
   */
  catalogProducts?: Product[];
  onClose: () => void;
  onSaved: (order: Order) => void;
  onDeleted: (orderId: string) => void;
}) {
  const { t, locale, dir } = useLocale();
  const [draft, setDraft] = useState<OrderItem[]>(() => cloneItems(order.items));
  const [draftOrderType, setDraftOrderType] = useState<OrderType>(
    () => order.orderType ?? "dine-in",
  );
  const [draftPayment, setDraftPayment] = useState<PaymentMethod>(
    () => order.paymentMethod,
  );
  const [draftCustomerName, setDraftCustomerName] = useState(
    () => order.customerName ?? "",
  );
  const [draftCustomerPhone, setDraftCustomerPhone] = useState(
    () => order.customerPhone ?? "",
  );
  const [draftDeliveryAddress, setDraftDeliveryAddress] = useState(
    () => order.deliveryAddress ?? "",
  );
  const [draftTableNumber, setDraftTableNumber] = useState(
    () => order.tableNumber ?? "",
  );
  const initialDiscount = discountDraftFromOrder(order);
  const [draftDiscountType, setDraftDiscountType] = useState<DiscountType>(
    () => initialDiscount.type,
  );
  const [draftDiscountValue, setDraftDiscountValue] = useState(
    () => initialDiscount.value,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>(() =>
    catalogProducts?.filter((p) => p.isActive) ?? [],
  );
  const [pickerSearch, setPickerSearch] = useState("");
  const [productsLoading, setProductsLoading] = useState(false);
  const [refundFormOpen, setRefundFormOpen] = useState(false);
  const [refundAmt, setRefundAmt] = useState(0);
  const [refundReason, setRefundReason] = useState("");
  const [successNotice, setSuccessNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printCopies, setPrintCopies] = useState<Set<ReceiptCopy>>(() => {
    try {
      const saved = localStorage.getItem("pos:printCopies");
      if (saved) return new Set(JSON.parse(saved) as ReceiptCopy[]);
    } catch {}
    return new Set(["customer", "branch", "kitchen"]);
  });
  useEffect(() => {
    try { localStorage.setItem("pos:printCopies", JSON.stringify([...printCopies])); } catch {}
  }, [printCopies]);

  const resolvedBranch =
    (order.branchName || branchName || "").trim() || null;

  function showSuccess(title: string, message: string) {
    setSuccessNotice({ title, message });
  }

  function dismissSuccess() {
    setSuccessNotice(null);
    onClose();
  }

  useEffect(() => {
    setDraft(cloneItems(order.items));
    setDraftOrderType(order.orderType ?? "dine-in");
    setDraftPayment(order.paymentMethod);
    setDraftCustomerName(order.customerName ?? "");
    setDraftCustomerPhone(order.customerPhone ?? "");
    setDraftDeliveryAddress(order.deliveryAddress ?? "");
    setDraftTableNumber(order.tableNumber ?? "");
    const d = discountDraftFromOrder(order);
    setDraftDiscountType(d.type);
    setDraftDiscountValue(d.value);
    setError(null);
  }, [order]);

  const shopDeliveryFee = money(settings?.deliveryCharges ?? 0);
  const draftDeliveryCharges = useMemo(() => {
    if (draftOrderType !== "delivery") return 0;
    const prevType = order.orderType ?? "dine-in";
    if (prevType === "delivery") {
      // A fee of 0 isn't stored — missing means 0, never today's shop fee.
      return money(order.deliveryCharges ?? 0);
    }
    return shopDeliveryFee;
  }, [draftOrderType, order.orderType, order.deliveryCharges, shopDeliveryFee]);

  const itemsDirty = useMemo(
    () => !itemsEqual(sanitizeOrderItems(draft), sanitizeOrderItems(order.items)),
    [draft, order.items],
  );
  const metaDirty = useMemo(() => {
    const nextTable =
      draftOrderType === "dine-in" ? norm(draftTableNumber) : "";
    const nextAddress =
      draftOrderType === "delivery" ? norm(draftDeliveryAddress) : "";
    const savedDiscount = discountDraftFromOrder(order);
    return (
      (order.orderType ?? "dine-in") !== draftOrderType ||
      order.paymentMethod !== draftPayment ||
      norm(order.customerName) !== norm(draftCustomerName) ||
      norm(order.customerPhone) !== norm(draftCustomerPhone) ||
      norm(order.deliveryAddress) !== nextAddress ||
      norm(order.tableNumber) !== nextTable ||
      money(order.deliveryCharges ?? 0) !== draftDeliveryCharges ||
      savedDiscount.type !== draftDiscountType ||
      savedDiscount.value !== money(draftDiscountValue)
    );
  }, [
    order,
    draftOrderType,
    draftPayment,
    draftCustomerName,
    draftCustomerPhone,
    draftDeliveryAddress,
    draftTableNumber,
    draftDeliveryCharges,
    draftDiscountType,
    draftDiscountValue,
  ]);
  const dirty = itemsDirty || metaDirty;

  // Same math as the server-side amend, so the sheet can't preview a total
  // that differs from what gets saved.
  const draftTotals = useMemo(() => {
    const hasDiscount = draftDiscountValue > 0;
    return amendOrderTotals(
      {
        ...order,
        deliveryCharges: draftDeliveryCharges,
        discountType: hasDiscount ? draftDiscountType : null,
        discountValue: hasDiscount ? draftDiscountValue : 0,
        discountAmount: hasDiscount ? order.discountAmount : 0,
      },
      orderItemsTotal(draft),
    );
  }, [
    order,
    draft,
    draftDeliveryCharges,
    draftDiscountType,
    draftDiscountValue,
  ]);
  const draftSubtotal = draftTotals.subtotal;
  const taxAmount = draftTotals.taxAmount;
  const deliveryCharges = draftTotals.deliveryCharges;
  const discountAmount = draftTotals.discountAmount;
  const draftTotal = draftTotals.total;
  const isCancelled = order.status === "cancelled";
  const refundedSoFar = orderRefundedAmount(order);
  const refundableAmount = orderRefundableAmount(order);
  // A refunded order is locked: an edit would subtract the refunded items twice.
  const hasRefund = refundedSoFar > 0;
  const dayHours = businessDayHoursFromSettings(settings ?? null);
  // Staff: own order until its business day ends. They wait for the shop hours
  // (settings) to know that day, and for a sane PC clock — set back while
  // offline it could reopen a closed day. Checked again when confirming.
  const staffClockBlocked = user.role !== "owner" && pcClockBlocksSales();
  const staffWaitsForHours = user.role !== "owner" && !settings;
  const mayEditNow = () =>
    !staffWaitsForHours &&
    !(user.role !== "owner" && pcClockBlocksSales()) &&
    canEditOrder(user, order, shopNow().getTime(), dayHours);
  const mayCancelNow = () =>
    !staffWaitsForHours &&
    !(user.role !== "owner" && pcClockBlocksSales()) &&
    canCancelOrder(user, order, shopNow().getTime(), dayHours);
  const allowEdit = !isCancelled && !hasRefund && mayEditNow();
  const canEditDiscount =
    user.role === "owner" || user.permissions?.canApplyDiscount !== false;
  // Freeze discount when staff lack permission; otherwise same gate as POS.
  const discountAllowed =
    !canEditDiscount ||
    canApplyDiscount(
      user.role,
      draftDiscountType,
      draftDiscountValue,
      user.permissions,
    );
  const allowCancel = !isCancelled && mayCancelNow();
  const allowDelete = canDeleteOrder(user);
  const mayRefundNow = () =>
    !staffWaitsForHours &&
    !(user.role !== "owner" && pcClockBlocksSales()) &&
    canRefundOrder(user, order, shopNow().getTime(), dayHours);
  const allowRefund = !isCancelled && refundableAmount > 0 && mayRefundNow();
  const isAmended = Boolean(order.updatedAt) || dirty;

  const loadProducts = useCallback(async () => {
    if (products.length > 0) return;
    if (catalogProducts && catalogProducts.length > 0) {
      setProducts(catalogProducts.filter((p) => p.isActive));
      return;
    }
    setProductsLoading(true);
    try {
      // Menu is shared across branches (SHARED_MENU_ID) — do not filter by order.branchId.
      const all = await fetchProducts();
      setProducts(all.filter((p) => p.isActive));
    } catch {
      // silent — picker just shows empty
    } finally {
      setProductsLoading(false);
    }
  }, [products.length, catalogProducts]);

  useEffect(() => {
    if (!catalogProducts) return;
    setProducts(catalogProducts.filter((p) => p.isActive));
  }, [catalogProducts]);

  function openPicker() {
    setPickerOpen(true);
    setPickerSearch("");
    void loadProducts();
  }

  function addProduct(product: Product, variationId?: string, variationLabel?: string, price?: number) {
    const unitPrice = price ?? product.basePrice;
    const existing = draft.findIndex(
      (d) => d.productId === product.id && (d.variationId ?? "") === (variationId ?? ""),
    );
    if (existing >= 0) {
      setQty(existing, draft[existing].qty + 1);
    } else {
      setDraft((prev) => [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          variationId,
          variationLabel,
          unitPrice,
          qty: 1,
          lineTotal: unitPrice,
        },
      ]);
    }
    setPickerOpen(false);
  }

  const filteredProducts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, pickerSearch]);

  function setQty(index: number, qty: number) {
    setDraft((list) =>
      list
        .map((item, i) => {
          if (i !== index) return item;
          const nextQty = Math.max(0, Math.floor(qty));
          return {
            ...item,
            qty: nextQty,
            lineTotal: lineTotal(money(item.unitPrice), nextQty),
          };
        })
        .filter((item) => item.qty > 0),
    );
  }

  function removeLine(index: number) {
    setDraft((list) => list.filter((_, i) => i !== index));
  }

  async function onSave() {
    setError(null);
    // The day may have ended while the confirm dialog was open.
    if (!mayEditNow()) {
      setError(t("editWindowExpired"));
      setConfirmSave(false);
      return;
    }
    const nextItems = sanitizeOrderItems(draft);
    if (nextItems.length === 0) {
      setError(t("orderMustHaveItem"));
      setConfirmSave(false);
      return;
    }
    if (!discountAllowed) {
      setError(t("staffDiscountLimit"));
      setConfirmSave(false);
      return;
    }
    setBusy(true);
    try {
      const saved = await enqueueOrderEdit({
        order,
        items: nextItems,
        user,
        orderType: draftOrderType,
        paymentMethod: draftPayment,
        customerName: draftCustomerName,
        customerPhone: draftCustomerPhone,
        deliveryAddress:
          draftOrderType === "delivery" ? draftDeliveryAddress : "",
        tableNumber: draftOrderType === "dine-in" ? draftTableNumber : "",
        deliveryFee: draftDeliveryCharges,
        ...(canEditDiscount
          ? {
              discountType:
                draftDiscountValue > 0 ? draftDiscountType : null,
              discountValue: draftDiscountValue > 0 ? draftDiscountValue : 0,
            }
          : {}),
      });
      setConfirmSave(false);
      onSaved(saved);
      void kickSync();
      showSuccess(
        t("orderSavedSuccessTitle"),
        t("orderSavedSuccessBody").replace(
          "{n}",
          formatOrderNumber(saved.orderNumber),
        ),
      );
    } catch (e) {
      setError(mapFirebaseError(e, locale));
      setConfirmSave(false);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await enqueueOrderDelete({ order, user });
      setConfirmDelete(false);
      onDeleted(order.id);
      void kickSync();
      showSuccess(
        t("orderDeletedSuccessTitle"),
        t("orderDeletedSuccessBody").replace(
          "{n}",
          formatOrderNumber(order.orderNumber),
        ),
      );
    } catch (e) {
      setError(mapFirebaseError(e, locale));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!mayCancelNow()) {
      setError(t("editWindowExpired"));
      setConfirmCancel(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cancelled = await enqueueOrderCancel({ order, user });
      setConfirmCancel(false);
      onSaved(cancelled);
      void kickSync();
      showSuccess(
        t("orderCancelledSuccessTitle"),
        t("orderCancelledSuccessBody").replace(
          "{n}",
          formatOrderNumber(cancelled.orderNumber),
        ),
      );
    } catch (e) {
      setError(mapFirebaseError(e, locale));
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  }

  async function onRefund() {
    const amount = Math.min(money(refundAmt), refundableAmount);
    if (amount <= 0 || !refundReason.trim()) {
      setConfirmRefund(false);
      return;
    }
    // The day may have ended while the confirm dialog was open.
    if (!mayRefundNow()) {
      setError(t("editWindowExpired"));
      setConfirmRefund(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await enqueueOrderRefund({
        order,
        user,
        refundAmount: amount,
        refundReason: refundReason.trim(),
      });
      setConfirmRefund(false);
      setRefundFormOpen(false);
      onSaved(saved);
      void kickSync();
      showSuccess(
        t("refundSuccessTitle"),
        t("refundSuccessBody")
          .replace("{amount}", formatPkr(amount))
          .replace("{n}", formatOrderNumber(order.orderNumber)),
      );
    } catch (e) {
      setError(mapFirebaseError(e, locale));
      setConfirmRefund(false);
    } finally {
      setBusy(false);
    }
  }

  function printSnapshot(): Order {
    const nextTable =
      draftOrderType === "dine-in" ? norm(draftTableNumber) : "";
    const nextAddress =
      draftOrderType === "delivery" ? norm(draftDeliveryAddress) : "";
    return dirty
      ? {
          ...order,
          items: sanitizeOrderItems(draft),
          orderType: draftOrderType,
          paymentMethod: draftPayment,
          ...(norm(draftCustomerName)
            ? { customerName: norm(draftCustomerName) }
            : { customerName: undefined }),
          ...(norm(draftCustomerPhone)
            ? { customerPhone: norm(draftCustomerPhone) }
            : { customerPhone: undefined }),
          ...(nextAddress
            ? { deliveryAddress: nextAddress }
            : { deliveryAddress: undefined }),
          ...(nextTable ? { tableNumber: nextTable } : { tableNumber: undefined }),
          subtotal: draftSubtotal,
          ...(taxAmount > 0 ? { taxAmount } : {}),
          ...(deliveryCharges > 0
            ? { deliveryCharges }
            : { deliveryCharges: undefined }),
          ...(discountAmount > 0
            ? {
                discountType: draftDiscountType,
                discountValue: draftDiscountValue,
                discountAmount,
              }
            : {
                discountType: undefined,
                discountValue: undefined,
                discountAmount: undefined,
              }),
          total: draftTotal,
        }
      : order;
  }

  function onPrint() {
    setPrintPreviewOpen(true);
  }

  function doPrint() {
    if (printCopies.size === 0) return;
    const snapshot = printSnapshot();
    printReceipt({
      order: snapshot,
      shopName: settings?.shopName ?? "Brovo Bites",
      branchName: resolvedBranch || undefined,
      softwareCompanyName:
        settings?.softwareCompanyName ?? DEFAULT_SETTINGS.softwareCompanyName,
      softwareCompanyPhone:
        settings?.softwareCompanyPhone ?? DEFAULT_SETTINGS.softwareCompanyPhone,
      labels: receiptLabels(t),
      reviewUrl: reviewUrlOf(settings),
      showReprint: Boolean(order.updatedAt) || dirty,
      dir,
      paper: settings?.receiptPaper,
      paperWidthMm: settings?.receiptPrintWidthMm,
      copies: [...printCopies] as ReceiptCopy[],
    });
    setPrintPreviewOpen(false);
  }

  const printPreviewHtml = useMemo(() => {
    if (!printPreviewOpen) return "";
    const snapshot = printSnapshot();
    return buildReceiptHtml({
      order: snapshot,
      shopName: settings?.shopName ?? "Brovo Bites",
      branchName: resolvedBranch || undefined,
      softwareCompanyName:
        settings?.softwareCompanyName ?? DEFAULT_SETTINGS.softwareCompanyName,
      softwareCompanyPhone:
        settings?.softwareCompanyPhone ?? DEFAULT_SETTINGS.softwareCompanyPhone,
      labels: receiptLabels(t),
      reviewUrl: reviewUrlOf(settings),
      showReprint: Boolean(order.updatedAt) || dirty,
      dir,
      paper: settings?.receiptPaper,
      paperWidthMm: settings?.receiptPrintWidthMm,
      copies: [...printCopies] as ReceiptCopy[],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printPreviewOpen, printCopies, dirty, draft, draftOrderType, draftPayment, draftCustomerName, draftCustomerPhone, draftDeliveryAddress, draftTableNumber, draftDiscountType, draftDiscountValue]);

  const typeOptions: { id: OrderType; label: string }[] = [
    { id: "dine-in", label: t("dineIn") },
    { id: "takeaway", label: t("takeaway") },
    { id: "delivery", label: t("delivery") },
  ];
  const payOptions: { id: PaymentMethod; label: string }[] = [
    { id: "cash", label: t("cash") },
    { id: "card", label: t("card") },
    { id: "digital", label: t("digital") },
  ];

  const sectionTitle =
    "text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--gold-deep)]";
  const fieldLabel = "mb-1 flex items-baseline gap-1 text-[11px] font-semibold text-stone-600";
  const fieldInput =
    "min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/25 disabled:opacity-60 pointer-coarse:text-base sm:pointer-fine:min-h-9";
  const segWrap = "flex gap-1 rounded-xl bg-stone-100 p-0.5 ring-1 ring-stone-200/80";
  const segBtn = (on: boolean) =>
    `min-h-8 flex-1 rounded-lg px-2 text-[13px] font-semibold transition disabled:opacity-50 pointer-coarse:min-h-11 ${
      on
        ? "pos-seg-on"
        : "text-stone-600 hover:bg-white hover:text-stone-900"
    }`;
  const itemCount = draft.reduce((n, i) => n + i.qty, 0);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="absolute inset-0"
          aria-label={t("close")}
          onClick={() => {
            if (!busy) onClose();
          }}
        />
        <div className="relative z-10 flex max-h-[min(96dvh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.25rem] bg-[#fff4e8] shadow-[0_24px_80px_rgba(0,0,0,0.4)] sm:max-h-[min(92dvh,52rem)] sm:rounded-[1.25rem]">
          {/* Header — espresso rail: order #, status, who / when */}
          <header className="modal-dark-head shrink-0 px-4 pb-3.5 pt-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#f0b028]">
                    {t("order")}
                  </span>
                  <h3
                    className="font-mono text-[1.6rem] font-bold leading-none tracking-tight text-[#fff4e8] sm:text-[1.75rem]"
                    dir="ltr"
                  >
                    #{formatOrderNumber(order.orderNumber)}
                  </h3>
                  {order.printedOrderNumber != null ? (
                    <span
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#f0b028] ring-1 ring-[#f0b028]/40"
                      dir="ltr"
                      title={t("receiptNumber").replace("{n}", formatOrderNumber(order.printedOrderNumber))}
                    >
                      {t("receiptNumber").replace("{n}", formatOrderNumber(order.printedOrderNumber))}
                    </span>
                  ) : null}
                  {isCancelled ? (
                    <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-200 ring-1 ring-red-400/40">
                      {t("cancelled")}
                    </span>
                  ) : order.updatedAt ? (
                    <span className="rounded-full bg-[rgba(240,176,40,0.14)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#f6c95a] ring-1 ring-[rgba(240,176,40,0.35)]">
                      {t("amended")}
                    </span>
                  ) : null}
                  {(order.refundAmount ?? 0) > 0 ? (
                    <span
                      className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-200 ring-1 ring-amber-300/35"
                      dir="ltr"
                    >
                      {t("refunded")}: {formatPkr(order.refundAmount!)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-snug text-[#e9d5c1]">
                  <span dir="ltr">{formatOrderDateTime(order.createdAt)}</span>
                  {resolvedBranch ? (
                    <>
                      <span className="mx-1.5 text-[#8f7563]">·</span>
                      {resolvedBranch}
                    </>
                  ) : null}
                </p>
                <p className="mt-1 text-xs leading-snug text-[#cbb3a0]">
                  {t("orderByPrefix")}{" "}
                  <span className="font-semibold capitalize text-[#fff4e8]">
                    {order.createdByName || "—"}
                  </span>
                  {order.updatedByName && order.updatedAt ? (
                    <>
                      <span className="mx-1.5 text-[#8f7563]">·</span>
                      {isCancelled ? t("cancelledBy") : t("editedBy")}{" "}
                      <span className="font-semibold capitalize text-[#fff4e8]">
                        {order.updatedByName}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full pointer-coarse:size-11 border border-[rgba(240,176,40,0.28)] bg-white/10 text-[#fff4e8] transition hover:bg-[rgba(240,176,40,0.18)] hover:text-white disabled:opacity-50"
                disabled={busy}
                onClick={onClose}
                aria-label={t("close")}
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          {/* Body — one scroll region: details → items → picker */}
          <div className="min-h-0 flex-auto space-y-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
            {error ? <div className="toast-error">{error}</div> : null}

            {allowEdit ? (
              <section className="space-y-2.5 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-[0_1px_3px_rgba(42,20,14,0.05)] sm:px-4">
                <p className={sectionTitle}>{t("orderDetailsTitle")}</p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div>
                    <p className={fieldLabel}>{t("orderType")}</p>
                    <div className={segWrap}>
                      {typeOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={busy}
                          aria-pressed={draftOrderType === opt.id}
                          onClick={() => {
                            setDraftOrderType(opt.id);
                            if (opt.id !== "delivery") setDraftDeliveryAddress("");
                            if (opt.id !== "dine-in") setDraftTableNumber("");
                          }}
                          className={segBtn(draftOrderType === opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className={fieldLabel}>{t("paymentMethod")}</p>
                    <div className={segWrap}>
                      {payOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={busy}
                          aria-pressed={draftPayment === opt.id}
                          onClick={() => setDraftPayment(opt.id)}
                          className={segBtn(draftPayment === opt.id)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className={fieldLabel}>
                      {t("customerNameLabel")}
                      <span className="font-normal text-stone-400">({t("fieldOptional")})</span>
                    </span>
                    <input
                      className={fieldInput}
                      value={draftCustomerName}
                      disabled={busy}
                      autoComplete="name"
                      placeholder={t("customerNamePlaceholder")}
                      onChange={(e) => setDraftCustomerName(e.target.value)}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className={fieldLabel}>
                      {t("customerPhoneLabel")}
                      <span className="font-normal text-stone-400">({t("fieldOptional")})</span>
                    </span>
                    <input
                      className={`${fieldInput} tabular-nums`}
                      value={draftCustomerPhone}
                      disabled={busy}
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      placeholder={t("customerPhonePlaceholder")}
                      onChange={(e) => setDraftCustomerPhone(e.target.value)}
                    />
                  </label>
                  {draftOrderType === "dine-in" ? (
                    <label className="block min-w-0">
                      <span className={fieldLabel}>
                        {t("tableNumberLabel")}
                        <span className="font-normal text-stone-400">({t("fieldOptional")})</span>
                      </span>
                      <input
                        className={`${fieldInput} tabular-nums`}
                        value={draftTableNumber}
                        disabled={busy}
                        inputMode="numeric"
                        dir="ltr"
                        placeholder="T#"
                        onChange={(e) => setDraftTableNumber(e.target.value)}
                      />
                    </label>
                  ) : null}
                  {draftOrderType === "delivery" ? (
                    <label className="block min-w-0">
                      <span className={fieldLabel}>
                        {t("deliveryAddressLabel")}
                        <span className="font-normal text-stone-400">({t("fieldOptional")})</span>
                      </span>
                      <input
                        className={fieldInput}
                        value={draftDeliveryAddress}
                        disabled={busy}
                        autoComplete="street-address"
                        maxLength={160}
                        placeholder={t("deliveryAddressPlaceholder")}
                        onChange={(e) => setDraftDeliveryAddress(e.target.value)}
                      />
                    </label>
                  ) : null}
                  {canEditDiscount ? (
                    <div className="min-w-0">
                      <p className={fieldLabel}>{t("discount")}</p>
                      <div className="flex gap-2">
                        <div className="grid shrink-0 grid-cols-2 gap-0.5 rounded-xl bg-stone-100 p-1 ring-1 ring-stone-200/80">
                          {(["percent", "fixed"] as const).map((dt) => (
                            <button
                              key={dt}
                              type="button"
                              disabled={busy}
                              aria-pressed={draftDiscountType === dt}
                              className={`h-9 min-w-10 rounded-lg px-2 text-sm font-bold transition pointer-coarse:h-11 pointer-coarse:min-w-11 ${
                                draftDiscountType === dt
                                  ? "pos-seg-on"
                                  : "text-stone-600 hover:bg-white hover:text-stone-900"
                              }`}
                              onClick={() => {
                                setDraftDiscountType(dt);
                                setDraftDiscountValue(0);
                              }}
                            >
                              {dt === "percent" ? "%" : "Rs"}
                            </button>
                          ))}
                        </div>
                        <div className="relative min-w-0 flex-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={busy}
                            value={draftDiscountValue || ""}
                            placeholder="0"
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d.]/g, "");
                              const n = Math.max(0, Number(raw) || 0);
                              const capped =
                                draftDiscountType === "percent"
                                  ? Math.min(100, n)
                                  : Math.min(draftSubtotal, n);
                              setDraftDiscountValue(capped);
                            }}
                            className={`${fieldInput} pe-9 tabular-nums`}
                            dir="ltr"
                            aria-label={t("discount")}
                          />
                          {draftDiscountValue ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="absolute end-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 pointer-coarse:end-0 pointer-coarse:size-11"
                              aria-label={t("clear")}
                              onClick={() => setDraftDiscountValue(0)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                                <path d="M18 6 6 18M6 6l12 12" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {!discountAllowed ? (
                        <p className="mt-1 text-[11px] leading-snug text-red-600">
                          {t("staffDiscountLimit")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="flex flex-wrap gap-1.5 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-[0_1px_3px_rgba(42,20,14,0.05)]">
                <span className="pos-seg-on rounded-lg px-2.5 py-1 text-xs font-bold">
                  {draftOrderType === "takeaway"
                    ? t("takeaway")
                    : draftOrderType === "delivery"
                      ? t("delivery")
                      : t("dineIn")}
                </span>
                <span className="pos-seg-on rounded-lg px-2.5 py-1 text-xs font-bold">
                  {draftPayment === "card"
                    ? t("card")
                    : draftPayment === "digital"
                      ? t("digital")
                      : t("cash")}
                </span>
                {norm(order.tableNumber) ? (
                  <span className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-800" dir="ltr">
                    T{norm(order.tableNumber)}
                  </span>
                ) : null}
                {norm(order.customerName) ? (
                  <span className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold capitalize text-stone-800">
                    {norm(order.customerName)}
                  </span>
                ) : null}
                {norm(order.customerPhone) ? (
                  <span className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-800" dir="ltr">
                    {norm(order.customerPhone)}
                  </span>
                ) : null}
                {norm(order.deliveryAddress) ? (
                  <span className="max-w-full truncate rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-800">
                    {norm(order.deliveryAddress)}
                  </span>
                ) : null}
              </section>
            )}

            {/* Line items */}
            <section>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <p className={sectionTitle}>{t("orderItemsTitle")}</p>
                <p className="text-xs font-medium text-stone-500" dir="ltr">
                  {itemCount} {t("itemsCount")}
                </p>
              </div>
              {draft.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-stone-300 bg-white py-8 text-center text-sm text-stone-500">
                  {t("orderMustHaveItem")}
                </p>
              ) : (
                <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_3px_rgba(42,20,14,0.05)]">
                  {draft.map((item, index) => (
                    <li
                      key={`${item.productId}-${item.variationId ?? ""}-${index}`}
                      className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-snug text-stone-900">
                          {item.productName}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {item.variationLabel ? (
                            <span className="pos-variant-chip inline-flex max-w-full truncate">
                              {item.variationLabel}
                            </span>
                          ) : null}
                          <span className="text-[11px] tabular-nums text-stone-500" dir="ltr">
                            {item.qty} × {formatPkr(item.unitPrice)}
                          </span>
                        </div>
                        {item.note ? (
                          <p className="mt-0.5 truncate text-[11px] italic text-stone-500">
                            ↳ {item.note}
                          </p>
                        ) : null}
                      </div>

                      {allowEdit ? (
                        <div className="inline-flex shrink-0 items-center rounded-full bg-stone-100 p-0.5 ring-1 ring-stone-200">
                          <button
                            type="button"
                            className="inline-flex size-9 items-center justify-center rounded-full text-lg font-semibold text-stone-700 transition hover:bg-white hover:shadow-sm disabled:opacity-40 pointer-coarse:size-11"
                            disabled={busy}
                            onClick={() => setQty(index, item.qty - 1)}
                            aria-label="−"
                          >
                            −
                          </button>
                          <span className="min-w-7 text-center text-sm font-bold tabular-nums text-stone-900">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            className="inline-flex size-9 items-center justify-center rounded-full text-lg font-semibold text-stone-700 transition hover:bg-white hover:shadow-sm disabled:opacity-40 pointer-coarse:size-11"
                            disabled={busy}
                            onClick={() => setQty(index, item.qty + 1)}
                            aria-label="+"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-stone-500">
                          ×{item.qty}
                        </span>
                      )}

                      <p
                        className="w-[4.75rem] shrink-0 text-end text-sm font-bold tabular-nums text-stone-900 sm:w-[5.25rem]"
                        dir="ltr"
                      >
                        {formatPkr(lineTotal(item.unitPrice, item.qty))}
                      </p>

                      {allowEdit ? (
                        <button
                          type="button"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-stone-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 pointer-coarse:size-11"
                          disabled={busy}
                          onClick={() => removeLine(index)}
                          aria-label={t("remove")}
                          title={t("remove")}
                        >
                          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {allowEdit && !isCancelled && !pickerOpen ? (
                <button
                  type="button"
                  className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--gold)]/50 bg-white/60 text-sm font-semibold text-[var(--gold-deep)] transition hover:border-[var(--gold)] hover:bg-white disabled:opacity-50"
                  onClick={openPicker}
                  disabled={busy}
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  {t("addItems")}
                </button>
              ) : null}

              {pickerOpen ? (
                <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--gold)]/40 bg-white shadow-[0_4px_16px_rgba(42,20,14,0.08)]">
                  <div className="flex items-center gap-2 border-b border-stone-100 p-2">
                    <input
                      type="search"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder={t("searchMenu")}
                      className="min-h-10 flex-1 rounded-xl border-0 bg-stone-100 px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--gold)]/40 pointer-coarse:min-h-11 pointer-coarse:text-base"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="inline-flex min-h-10 shrink-0 items-center rounded-xl px-3 text-sm font-semibold text-stone-600 hover:bg-stone-100 pointer-coarse:min-h-11"
                      onClick={() => setPickerOpen(false)}
                    >
                      {t("close")}
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1.5">
                    {productsLoading ? (
                      <p className="py-4 text-center text-xs text-stone-500">{t("loading")}</p>
                    ) : filteredProducts.length === 0 ? (
                      <p className="py-4 text-center text-xs text-stone-500">{t("noResults")}</p>
                    ) : (
                      filteredProducts.map((p) =>
                        p.variations.length > 0 ? (
                          p.variations.map((v) => (
                            <button
                              key={`${p.id}-${v.id}`}
                              type="button"
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-start transition hover:bg-[#fff1df]"
                              onClick={() => addProduct(p, v.id, v.label, v.price)}
                            >
                              <span className="text-sm font-medium text-stone-900">
                                {p.name} <span className="text-stone-500">({v.label})</span>
                              </span>
                              <span className="text-xs font-bold text-[var(--gold-deep)]" dir="ltr">
                                {formatPkr(v.price)}
                              </span>
                            </button>
                          ))
                        ) : (
                          <button
                            key={p.id}
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-start transition hover:bg-[#fff1df]"
                            onClick={() => addProduct(p)}
                          >
                            <span className="text-sm font-medium text-stone-900">{p.name}</span>
                            <span className="text-xs font-bold text-[var(--gold-deep)]" dir="ltr">
                              {formatPkr(p.basePrice)}
                            </span>
                          </button>
                        ),
                      )
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          {/* Footer — totals, primary actions, then secondary (refund / cancel / delete) */}
          <footer
            className={`border-t border-stone-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 sm:px-6 ${
              refundFormOpen
                ? "min-h-0 max-h-[min(58dvh,26rem)] shrink overflow-y-auto overscroll-contain"
                : "shrink-0"
            }`}
          >
            {!refundFormOpen &&
            (taxAmount > 0 || deliveryCharges > 0 || discountAmount > 0) ? (
              <div className="mb-1.5 space-y-0.5 text-xs text-stone-500">
                <div className="flex justify-between gap-3">
                  <span>{t("subtotal")}</span>
                  <span className="font-medium tabular-nums text-stone-700" dir="ltr">
                    {formatPkr(draftSubtotal)}
                  </span>
                </div>
                {taxAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <span>{t("tax")}</span>
                    <span className="font-medium tabular-nums text-stone-700" dir="ltr">
                      {formatPkr(taxAmount)}
                    </span>
                  </div>
                ) : null}
                {deliveryCharges > 0 ? (
                  <div className="flex justify-between gap-3">
                    <span>{t("deliveryCharges")}</span>
                    <span className="font-medium tabular-nums text-stone-700" dir="ltr">
                      {formatPkr(deliveryCharges)}
                    </span>
                  </div>
                ) : null}
                {discountAmount > 0 ? (
                  <div className="flex justify-between gap-3 text-red-600">
                    <span>
                      {t("discount")}
                      {draftDiscountType === "percent" && draftDiscountValue > 0
                        ? ` (${draftDiscountValue}%)`
                        : ""}
                    </span>
                    <span className="font-medium tabular-nums" dir="ltr">
                      {"−"}
                      {formatPkr(discountAmount)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mb-2.5 flex items-center justify-between gap-3 border-t border-dashed border-stone-200 pt-1.5">
              <p className="text-sm font-bold text-stone-900">{t("total")}</p>
              <p className="text-xl font-extrabold tabular-nums tracking-tight text-stone-900" dir="ltr">
                {formatPkr(draftTotal)}
              </p>
            </div>

            {!refundFormOpen ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm flex-1 gap-2"
                  style={{ minHeight: 40 }}
                  disabled={busy}
                  onClick={onPrint}
                >
                  <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {isAmended ? t("reprint") : t("printBill")}
                </button>
                {!isCancelled && allowEdit ? (
                  <button
                    type="button"
                    className="btn btn-sm flex-[1.6] gap-2"
                    style={{ minHeight: 40 }}
                    disabled={busy || !dirty || draft.length === 0 || !discountAllowed}
                    onClick={() => setConfirmSave(true)}
                  >
                    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {busy ? t("saving") : t("saveOrder")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {!refundFormOpen && !isCancelled && !allowEdit && !staffWaitsForHours ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
                {hasRefund
                  ? t("orderRefundedNoEdit")
                  : order.createdBy !== user.uid ||
                      user.permissions?.canEditOrders === false
                    ? t("staffNoEditOrder")
                    : staffClockBlocked
                      ? t("pcClockBlocked")
                      : t("editWindowExpired")}
              </p>
            ) : null}

            {!refundFormOpen && (allowRefund || allowCancel || allowDelete) ? (
              <div className="mt-3 border-t border-stone-100 pt-3">
                {/* Labelled so "Cancel" reads as cancelling the ORDER, not closing this popup (✕ does that). */}
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400">
                  {t("orderActions")}
                </p>
                <div className="grid auto-cols-fr grid-flow-col gap-2">
                  {allowRefund ? (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl pointer-coarse:min-h-11 border border-amber-200 bg-amber-50/60 px-2 text-xs font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50 sm:text-[13px]"
                      disabled={busy}
                      onClick={() => {
                        setRefundAmt(refundableAmount);
                        setRefundReason("");
                        setRefundFormOpen(true);
                      }}
                    >
                      <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M9 14 4 9l5-5" />
                        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                      </svg>
                      {t("refundOrder")}
                    </button>
                  ) : null}
                  {allowCancel ? (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl pointer-coarse:min-h-11 border border-orange-300 bg-orange-50 px-2 text-xs font-semibold text-orange-700 transition hover:border-orange-400 hover:bg-orange-100 disabled:opacity-50 sm:text-[13px]"
                      disabled={busy}
                      onClick={() => setConfirmCancel(true)}
                    >
                      <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <circle cx="12" cy="12" r="9" />
                        <path d="m5.7 5.7 12.6 12.6" />
                      </svg>
                      {t("cancelThisOrder")}
                    </button>
                  ) : null}
                  {allowDelete ? (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl pointer-coarse:min-h-11 border border-red-200 bg-white px-2 text-xs font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-50 sm:text-[13px]"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      </svg>
                      {t("deleteOrder")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {refundFormOpen ? (
              <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
                    {t("refund")}
                  </p>
                  {refundedSoFar > 0 ? (
                    <p className="text-[11px] font-medium text-stone-500" dir="ltr">
                      {t("alreadyRefunded")}: {formatPkr(refundedSoFar)}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel}>
                      {t("refundAmount")}
                      <span className="font-normal text-stone-400" dir="ltr">
                        (max {formatPkr(refundableAmount)})
                      </span>
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={refundableAmount}
                      value={refundAmt || ""}
                      onChange={(e) =>
                        setRefundAmt(
                          Math.min(
                            refundableAmount,
                            Math.max(0, Number(e.target.value) || 0),
                          ),
                        )
                      }
                      className={`${fieldInput} font-semibold tabular-nums`}
                      dir="ltr"
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>{t("refundReason")}</span>
                    <input
                      type="text"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder={t("refundReasonPlaceholder")}
                      className={fieldInput}
                    />
                  </label>
                </div>

                <p className="rounded-lg bg-white px-3 py-2 text-xs leading-snug text-stone-600 ring-1 ring-amber-200/70">
                  {money(refundAmt) > 0 && money(refundAmt) >= refundableAmount
                    ? t("refundFullStockHint")
                    : t("refundPartialStockHint")}
                </p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost min-h-11 flex-1"
                    disabled={busy}
                    onClick={() => setRefundFormOpen(false)}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn min-h-11 flex-[1.4]"
                    disabled={
                      busy ||
                      refundAmt <= 0 ||
                      refundAmt > refundableAmount ||
                      !refundReason.trim()
                    }
                    onClick={() => setConfirmRefund(true)}
                  >
                    {busy ? t("saving") : t("confirmRefund")}
                  </button>
                </div>
              </div>
            ) : null}
          </footer>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title={t("saveOrderTitle")}
        message={t("confirmSaveOrder")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={busy}
        focusConfirm
        onCancel={() => {
          if (!busy) setConfirmSave(false);
        }}
        onConfirm={() => void onSave()}
      />

      <ConfirmDialog
        open={confirmRefund}
        title={t("confirmRefundTitle")}
        message={t("confirmRefundBody").replace(
          "{amount}",
          formatPkr(Math.min(money(refundAmt), refundableAmount)),
        )}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={busy}
        danger
        focusConfirm
        onCancel={() => {
          if (!busy) setConfirmRefund(false);
        }}
        onConfirm={() => void onRefund()}
      />

      <ConfirmDialog
        open={confirmCancel}
        title={t("cancelOrderTitle")}
        message={t("confirmCancelOrder")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={busy}
        danger
        onCancel={() => {
          if (!busy) setConfirmCancel(false);
        }}
        onConfirm={() => void onCancel()}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t("deleteOrderTitle")}
        message={t("confirmDeleteOrder")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={busy}
        danger
        onCancel={() => {
          if (!busy) setConfirmDelete(false);
        }}
        onConfirm={() => void onDelete()}
      />

      <ConfirmDialog
        open={Boolean(successNotice)}
        success
        hideCancel
        focusConfirm
        title={successNotice?.title ?? ""}
        message={successNotice?.message ?? ""}
        confirmLabel={t("ok")}
        cancelLabel={t("ok")}
        onConfirm={dismissSuccess}
        onCancel={dismissSuccess}
        onDismiss={dismissSuccess}
      />

      {/* Print preview modal */}
      {printPreviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-stone-950/65 backdrop-blur-[3px]"
            aria-label={t("close")}
            onClick={() => setPrintPreviewOpen(false)}
          />
          <div className="relative z-10 flex max-h-[min(90dvh,38rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-[0_25px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h3 className="text-base font-bold text-stone-800">{t("printBill")}</h3>
              <div className="flex items-center gap-3">
                {(["customer", "branch", "kitchen"] as const).map((copy) => (
                  <label key={copy} className="flex cursor-pointer items-center gap-1.5 select-none">
                    <input
                      type="checkbox"
                      checked={printCopies.has(copy)}
                      onChange={() => {
                        setPrintCopies((prev) => {
                          const next = new Set(prev);
                          if (next.has(copy)) next.delete(copy);
                          else next.add(copy);
                          return next;
                        });
                      }}
                      className="size-4 rounded accent-amber-600"
                    />
                    <span className="text-xs font-medium text-stone-600 capitalize">{copy}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#efe2d3] px-3 py-3">
              {printCopies.size > 0 ? (
                <ReceiptPreview html={printPreviewHtml} title={t("printBill")} />
              ) : (
                <p className="py-8 text-center text-sm text-stone-500">No copies selected</p>
              )}
            </div>
            <div className="flex gap-2 border-t px-4 py-3">
              <button
                type="button"
                className="btn btn-ghost btn-sm flex-1"
                onClick={() => setPrintPreviewOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn btn-sm flex-1 gap-2"
                disabled={printCopies.size === 0}
                onClick={doPrint}
              >
                <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("printBill")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import type { DocumentData } from "firebase/firestore";
import type {
  ActivityAction,
  ActivityChange,
  ActivityEntityType,
  ActivityExpenseSnapshot,
  ActivityLog,
  ActivityOrderSnapshot,
  CashDrawerSession,
  Category,
  DealLineItem,
  DiscountType,
  Expense,
  ExpenseCategory,
  InventoryItem,
  Order,
  OrderItem,
  OrderRefund,
  OrderType,
  PaymentMethod,
  Product,
  ShopSettings,
  StockMovement,
  StockMovementType,
  StockUnit,
} from "@bravobites/domain";
import { DEFAULT_SETTINGS, SHARED_MENU_ID, businessDateKey, coerceBusinessTime } from "@bravobites/domain";

/**
 * Firestore documents → app types. No Firebase SDK calls here, so the app
 * (web SDK) and the server (Admin SDK: the daily owner-report email) read
 * the same data the same way.
 */

export function asCategory(id: string, data: DocumentData): Category {
  return {
    id,
    branchId: String(data.branchId || SHARED_MENU_ID),
    name: String(data.name),
    imageUrl: String(data.imageUrl ?? ""),
    sortOrder: Number(data.sortOrder ?? 0),
    isActive: data.isActive !== false,
  };
}

export function asDealLineItem(raw: unknown): DealLineItem | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const productId = d.productId ? String(d.productId).trim() : "";
  const label = String(d.label ?? "").trim();
  const qty = Math.max(1, Math.floor(Number(d.qty) || 1));
  if (!productId && !label) return null;
  const item: DealLineItem = {
    label: label || productId,
    qty,
  };
  if (productId) item.productId = productId;
  return item;
}

export function asProduct(id: string, data: DocumentData): Product {
  const compareRaw = data.compareAtPrice;
  const compareAtPrice =
    compareRaw === null || compareRaw === undefined || compareRaw === ""
      ? null
      : Number(compareRaw);
  const dealItems = Array.isArray(data.dealItems)
    ? data.dealItems
        .map(asDealLineItem)
        .filter((d): d is DealLineItem => d != null)
    : [];
  return {
    id,
    branchId: String(data.branchId || SHARED_MENU_ID),
    categoryId: String(data.categoryId),
    name: String(data.name),
    type: data.type === "sized" || data.type === "bundle" ? data.type : "simple",
    basePrice: Number(data.basePrice ?? 0),
    variations: Array.isArray(data.variations) ? data.variations : [],
    dealItems,
    imageUrl: String(data.imageUrl ?? ""),
    compareAtPrice: Number.isFinite(compareAtPrice) ? compareAtPrice : null,
    isActive: data.isActive !== false,
    sortOrder: Number(data.sortOrder ?? 0),
  };
}

/** Prefer Firebase server time so a wrong POS PC clock cannot stamp receipts. */
export function firestoreTimeToIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveServerTime(
  data: DocumentData,
  serverKey: string,
  clientKey: string,
): string {
  return (
    firestoreTimeToIso(data[serverKey]) ??
    firestoreTimeToIso(data[clientKey]) ??
    new Date().toISOString()
  );
}

export function resolveCreatedAt(data: DocumentData): string {
  return resolveServerTime(data, "createdAtServer", "createdAt");
}

export function asOrder(id: string, data: DocumentData): Order {
  const updatedAt = data.updatedAt || data.updatedAtServer
    ? resolveServerTime(data, "updatedAtServer", "updatedAt")
    : undefined;
  const refundedAt =
    data.refundedAt || data.refundedAtServer
      ? resolveServerTime(data, "refundedAtServer", "refundedAt")
      : undefined;
  return {
    id,
    ...(typeof data.clientId === "string" && data.clientId
      ? { clientId: String(data.clientId) }
      : id
        ? { clientId: id }
        : {}),
    ...(typeof data.printedOrderNumber === "number" &&
    data.printedOrderNumber !== data.orderNumber
      ? { printedOrderNumber: data.printedOrderNumber }
      : {}),
    branchId: String(data.branchId),
    ...(data.branchName ? { branchName: String(data.branchName) } : {}),
    orderNumber: Number(data.orderNumber ?? 0),
    ...(data.orderType ? { orderType: data.orderType as OrderType } : {}),
    ...(typeof data.customerName === "string" && data.customerName.trim()
      ? { customerName: data.customerName.trim() }
      : {}),
    ...(typeof data.customerPhone === "string" && data.customerPhone.trim()
      ? { customerPhone: data.customerPhone.trim() }
      : {}),
    ...(typeof data.deliveryAddress === "string" && data.deliveryAddress.trim()
      ? { deliveryAddress: data.deliveryAddress.trim() }
      : {}),
    ...(typeof data.tableNumber === "string" && data.tableNumber.trim()
      ? { tableNumber: data.tableNumber.trim() }
      : {}),
    items: Array.isArray(data.items) ? data.items.map(asOrderItem) : [],
    subtotal: Number(data.subtotal ?? 0),
    ...(data.taxAmount ? { taxAmount: Number(data.taxAmount) } : {}),
    ...(data.taxPercent ? { taxPercent: Number(data.taxPercent) } : {}),
    ...(data.deliveryCharges ? { deliveryCharges: Number(data.deliveryCharges) } : {}),
    total: Number(data.total ?? 0),
    paymentMethod: (data.paymentMethod === "other" ? "digital" : data.paymentMethod as PaymentMethod) ?? "cash",
    status: data.status === "cancelled" ? "cancelled" : "completed",
    createdBy: String(data.createdBy ?? ""),
    createdByName: String(data.createdByName ?? ""),
    ...(data.createdByEmail
      ? { createdByEmail: String(data.createdByEmail) }
      : {}),
    createdAt: resolveCreatedAt(data),
    ...(updatedAt ? { updatedAt } : {}),
    ...(data.updatedBy ? { updatedBy: String(data.updatedBy) } : {}),
    ...(data.updatedByName ? { updatedByName: String(data.updatedByName) } : {}),
    ...(data.discountType ? { discountType: data.discountType as DiscountType } : {}),
    ...(data.discountValue ? { discountValue: Number(data.discountValue) } : {}),
    ...(data.discountAmount ? { discountAmount: Number(data.discountAmount) } : {}),
    ...(data.refundAmount ? { refundAmount: Number(data.refundAmount) } : {}),
    ...(data.refundReason ? { refundReason: String(data.refundReason) } : {}),
    ...(refundedAt ? { refundedAt } : {}),
    ...(data.refundedBy ? { refundedBy: String(data.refundedBy) } : {}),
    ...(data.refundedByName ? { refundedByName: String(data.refundedByName) } : {}),
    ...(data.refundCount ? { refundCount: Number(data.refundCount) } : {}),
    ...(Array.isArray(data.refunds) ? { refunds: asOrderRefunds(data.refunds) } : {}),
    ...(data.reviewSentCount ? { reviewSentCount: Number(data.reviewSentCount) } : {}),
    ...(firestoreTimeToIso(data.reviewSentAtServer)
      ? { reviewSentAt: firestoreTimeToIso(data.reviewSentAtServer)! }
      : {}),
    ...(data.reviewSentByName ? { reviewSentByName: String(data.reviewSentByName) } : {}),
    ...(data.reviewSentByEmail ? { reviewSentByEmail: String(data.reviewSentByEmail) } : {}),
  };
}

export function asOrderRefunds(raw: unknown[]): OrderRefund[] {
  return raw.flatMap((r) => {
    const e = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const amount = Number(e.amount) || 0;
    const at = typeof e.at === "string" ? e.at : "";
    return amount > 0 && at ? [{ amount, at }] : [];
  });
}

/**
 * Items are written by clients and the rules can't type-check list entries —
 * coerce each field so a tampered order can't put markup into receipts or UI.
 */
export function asOrderItem(raw: unknown): OrderItem {
  const i = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const item: OrderItem = {
    productId: String(i.productId ?? ""),
    productName: String(i.productName ?? ""),
    unitPrice: Number(i.unitPrice) || 0,
    qty: Number(i.qty) || 0,
    lineTotal: Number(i.lineTotal) || 0,
  };
  if (i.variationId) item.variationId = String(i.variationId);
  if (i.variationLabel) item.variationLabel = String(i.variationLabel);
  if (i.note) item.note = String(i.note);
  return item;
}

export function asExpense(id: string, data: DocumentData): Expense {
  return {
    id,
    branchId: String(data.branchId ?? ""),
    category: (data.category as ExpenseCategory) ?? "other",
    description: String(data.description ?? ""),
    amount: Number(data.amount ?? 0),
    date: String(data.date ?? ""),
    createdBy: String(data.createdBy ?? ""),
    createdByName: String(data.createdByName ?? ""),
    createdAt: resolveCreatedAt(data),
    ...(data.updatedAt || data.updatedAtServer
      ? { updatedAt: resolveServerTime(data, "updatedAtServer", "updatedAt") }
      : {}),
    ...(data.updatedBy ? { updatedBy: String(data.updatedBy) } : {}),
    ...(data.updatedByName ? { updatedByName: String(data.updatedByName) } : {}),
  };
}

export function asOrderLogSnapshot(raw: unknown): ActivityOrderSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const snap: ActivityOrderSnapshot = {
    orderNumber: Number(d.orderNumber ?? 0),
    items: Array.isArray(d.items)
      ? d.items.map((x) => {
          const i = (x ?? {}) as Record<string, unknown>;
          return {
            name: String(i.name ?? ""),
            qty: Number(i.qty ?? 0),
            unitPrice: Number(i.unitPrice ?? 0),
            lineTotal: Number(i.lineTotal ?? 0),
          };
        })
      : [],
    subtotal: Number(d.subtotal ?? 0),
    discountAmount: Number(d.discountAmount ?? 0),
    taxAmount: Number(d.taxAmount ?? 0),
    deliveryCharges: Number(d.deliveryCharges ?? 0),
    total: Number(d.total ?? 0),
    paymentMethod: (d.paymentMethod as PaymentMethod) ?? "cash",
  };
  const label = str(d.discountLabel);
  if (label) snap.discountLabel = label;
  if (d.orderType) snap.orderType = d.orderType as OrderType;
  for (const k of ["customerName", "customerPhone", "tableNumber", "deliveryAddress", "createdAt"] as const) {
    const v = str(d[k]);
    if (v) snap[k] = v;
  }
  if (Number(d.refundAmount ?? 0) > 0) snap.refundAmount = Number(d.refundAmount);
  return snap;
}

export function asExpenseLogSnapshot(raw: unknown): ActivityExpenseSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  return {
    category: String(d.category ?? ""),
    description: String(d.description ?? ""),
    amount: Number(d.amount ?? 0),
    date: String(d.date ?? ""),
  };
}

/** A log's before / after, read defensively (older logs have none). */
export function asActivityChange(raw: unknown): ActivityChange | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  if (d.kind === "order") {
    const r = d.refund as Record<string, unknown> | undefined;
    const before = asOrderLogSnapshot(d.before);
    const after = asOrderLogSnapshot(d.after);
    return {
      kind: "order",
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(r && typeof r === "object"
        ? {
            refund: {
              amount: Number(r.amount ?? 0),
              ...(typeof r.reason === "string" && r.reason ? { reason: r.reason } : {}),
              totalRefunded: Number(r.totalRefunded ?? 0),
            },
          }
        : {}),
    };
  }
  if (d.kind === "expense") {
    const before = asExpenseLogSnapshot(d.before);
    const after = asExpenseLogSnapshot(d.after);
    return { kind: "expense", ...(before ? { before } : {}), ...(after ? { after } : {}) };
  }
  return undefined;
}

export function asActivityLog(id: string, data: DocumentData): ActivityLog {
  return {
    id,
    branchId: String(data.branchId ?? ""),
    entityType: (data.entityType as ActivityEntityType) ?? "expense",
    entityId: String(data.entityId ?? ""),
    action: (data.action as ActivityAction) ?? "create",
    summary: String(data.summary ?? ""),
    ...(data.detail ? { detail: String(data.detail) } : {}),
    ...(() => {
      const change = asActivityChange(data.change);
      return change ? { change } : {};
    })(),
    createdBy: String(data.createdBy ?? ""),
    createdByName: String(data.createdByName ?? ""),
    createdAt: resolveCreatedAt(data),
  };
}

export function asCashDrawer(id: string, d: DocumentData): CashDrawerSession {
  const openedAt = resolveServerTime(d, "createdAtServer", "openedAt");
  const closedAt =
    d.status === "closed" && (d.closedAt || d.updatedAtServer)
      ? resolveServerTime(d, "updatedAtServer", "closedAt")
      : undefined;
  const date =
    String(d.date ?? "").trim() ||
    businessDateKey(new Date(openedAt)); // legacy docs without date; calendar fallback

  return {
    id,
    branchId: String(d.branchId ?? ""),
    date,
    openingBalance: Number(d.openingBalance ?? 0),
    closingCount: d.closingCount != null ? Number(d.closingCount) : null,
    expectedCash: d.expectedCash != null ? Number(d.expectedCash) : null,
    difference: d.difference != null ? Number(d.difference) : null,
    status: d.status === "closed" ? "closed" : "open",
    openedBy: String(d.openedBy ?? ""),
    openedByName: String(d.openedByName ?? ""),
    openedAt,
    closedBy: d.closedBy ? String(d.closedBy) : undefined,
    closedByName: d.closedByName ? String(d.closedByName) : undefined,
    ...(closedAt ? { closedAt } : {}),
    ...(d.autoClosed ? { autoClosed: true } : {}),
  };
}

export function parseShopSettings(d: DocumentData): ShopSettings {
  return {
    shopName: String(d.shopName ?? DEFAULT_SETTINGS.shopName),
    phone: String(d.phone ?? DEFAULT_SETTINGS.phone),
    currency: String(d.currency ?? "PKR"),
    slogan: String(d.slogan ?? DEFAULT_SETTINGS.slogan),
    eyebrow: String(d.eyebrow ?? DEFAULT_SETTINGS.eyebrow),
    logoUrl: String(d.logoUrl ?? ""),
    copyrightName: String(d.copyrightName ?? DEFAULT_SETTINGS.copyrightName),
    heroSlides: Array.isArray(d.heroSlides) ? d.heroSlides.map(String) : [],
    whatsappNumber: String(d.whatsappNumber ?? ""),
    googleReviewUrl: String(d.googleReviewUrl ?? ""),
    reviewMessageLang:
      d.reviewMessageLang === "en" || d.reviewMessageLang === "ur" ? d.reviewMessageLang : "both",
    menuUrl: String(d.menuUrl ?? ""),
    taxPercent: Number(d.taxPercent ?? 0),
    deliveryCharges: Number(d.deliveryCharges ?? 0),
    softwareCompanyName: String(
      d.softwareCompanyName ?? DEFAULT_SETTINGS.softwareCompanyName,
    ),
    softwareCompanyPhone: String(
      d.softwareCompanyPhone ?? DEFAULT_SETTINGS.softwareCompanyPhone,
    ),
    receiptPaper:
      d.receiptPaper === "58mm" || d.receiptPaper === "custom" ? d.receiptPaper : "80mm",
    receiptPrintWidthMm:
      Number(d.receiptPrintWidthMm) > 0
        ? Number(d.receiptPrintWidthMm)
        : DEFAULT_SETTINGS.receiptPrintWidthMm,
    businessDayStart:
      coerceBusinessTime(
        d.businessDayStart != null ? String(d.businessDayStart) : null,
      ) ?? DEFAULT_SETTINGS.businessDayStart,
    businessDayEnd:
      coerceBusinessTime(
        d.businessDayEnd != null ? String(d.businessDayEnd) : null,
      ) ?? DEFAULT_SETTINGS.businessDayEnd,
  };
}

export function asInventoryItem(id: string, data: DocumentData, pendingSync = false): InventoryItem {
  return {
    id,
    branchId: String(data.branchId ?? ""),
    productId: String(data.productId ?? ""),
    productName: String(data.productName ?? ""),
    ...(data.variationId
      ? { variationId: String(data.variationId), variationLabel: String(data.variationLabel ?? "") }
      : {}),
    description: data.description ? String(data.description) : undefined,
    currentStock: Number(data.currentStock ?? 0),
    lowStockThreshold: Number(data.lowStockThreshold ?? 5),
    unit: (data.unit as StockUnit) ?? "pcs",
    lastUpdated: resolveServerTime(data, "lastUpdatedServer", "lastUpdated"),
    ...(data.createdAt ? { createdAt: String(data.createdAt) } : {}),
    ...(pendingSync ? { pendingSync: true } : {}),
  };
}

export function asStockMovement(id: string, data: DocumentData): StockMovement {
  return {
    id,
    branchId: String(data.branchId ?? ""),
    inventoryItemId: String(data.inventoryItemId ?? ""),
    productId: String(data.productId ?? ""),
    productName: String(data.productName ?? ""),
    ...(data.variationId ? { variationId: String(data.variationId) } : {}),
    movementType: (data.movementType as StockMovementType) ?? "adjustment",
    quantity: Number(data.quantity ?? 0),
    previousStock: Number(data.previousStock ?? 0),
    newStock: Number(data.newStock ?? 0),
    ...(typeof data.delta === "number" ? { delta: data.delta } : {}),
    notes: String(data.notes ?? ""),
    createdBy: String(data.createdBy ?? ""),
    createdByName: String(data.createdByName ?? ""),
    createdAt: resolveCreatedAt(data),
  };
}

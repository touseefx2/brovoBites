export type UserRole = "owner" | "counter";

export type ProductType = "simple" | "sized" | "bundle";

export type OrderStatus = "completed" | "cancelled";

export type PaymentMethod = "cash" | "card" | "digital";

export type OrderType = "dine-in" | "takeaway" | "delivery";

export interface Branch {
  id: string;
  name: string;
  phone: string;
  address: string;
  /** Optional map pin — e.g. 31.5204 */
  latitude: number | null;
  /** Optional map pin — e.g. 74.3587 */
  longitude: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  role: UserRole;
  branchIds: string[];
  isActive: boolean;
  createdAt: string;
  /**
   * Exactly one owner should have this true (the main owner).
   * Co-owners are role "owner" with isPrimaryOwner false/undefined.
   */
  isPrimaryOwner?: boolean;
  permissions?: StaffPermissions;
}

/**
 * Menu is central (shared across all branches). Stored on Category/Product as
 * branchId for backward compatibility — always SHARED_MENU_ID for new docs.
 * Orders / inventory / cash drawer stay per real branch.
 */
export const SHARED_MENU_ID = "shared";

export interface Category {
  id: string;
  /** Legacy field — menu is central; prefer SHARED_MENU_ID */
  branchId: string;
  name: string;
  /** Optional cover image for public menu / landing */
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductVariation {
  id: string;
  label: string;
  price: number;
}

export interface DealLineItem {
  /** Linked menu product for stock deduct (preferred). */
  productId?: string;
  /** Display text on menu / POS (usually product name). */
  label: string;
  qty: number;
}

export interface Product {
  id: string;
  /** Legacy field — menu is central; prefer SHARED_MENU_ID */
  branchId: string;
  categoryId: string;
  name: string;
  type: ProductType;
  /** Used when type === "simple" or as fallback */
  basePrice: number;
  variations: ProductVariation[];
  /** Human-readable contents for bundle/deal products */
  dealItems: DealLineItem[];
  /** Optional product / deal photo for public menu */
  imageUrl: string;
  /** Optional original price (strikethrough) for deals */
  compareAtPrice: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CartLine {
  /** Stable key for cart line (productId + variationId) */
  key: string;
  productId: string;
  productName: string;
  variationId?: string;
  variationLabel?: string;
  unitPrice: number;
  qty: number;
  /** Optional note for kitchen */
  note?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  variationId?: string;
  variationLabel?: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  note?: string;
}

export interface Order {
  id: string;
  /**
   * Stable client-generated id used for idempotent POS sync.
   * Same as `id` for local-first checkouts; absent on legacy auto-id orders.
   */
  clientId?: string;
  branchId: string;
  /** Snapshot of branch name at order time (optional on older orders) */
  branchName?: string;
  orderNumber: number;
  /** Number printed on the receipt, kept when sync had to give the sale a new one. */
  printedOrderNumber?: number;
  orderType?: OrderType;
  /** Optional name entered at counter (dine-in / takeaway / delivery) */
  customerName?: string;
  /** Optional phone entered at counter */
  customerPhone?: string;
  /** Delivery address — only for delivery orders */
  deliveryAddress?: string;
  /** Optional table number — dine-in only */
  tableNumber?: string;
  items: OrderItem[];
  subtotal: number;
  taxAmount?: number;
  /** Tax rate at checkout — lets amendments re-derive tax on the new subtotal */
  taxPercent?: number;
  deliveryCharges?: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdBy: string;
  createdByName: string;
  /** Email of cashier/owner who created the order (optional on older orders) */
  createdByEmail?: string;
  createdAt: string;
  /** Set when order is amended after checkout */
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  refundAmount?: number;
  refundReason?: string;
  refundedAt?: string;
  refundedBy?: string;
  refundedByName?: string;
  /** How many separate refunds were issued (partial refunds accumulate) */
  refundCount?: number;
  /** WhatsApp review requests sent to the customer (each send counts) */
  reviewSentCount?: number;
  /** Last review request — server time, by whom */
  reviewSentAt?: string;
  reviewSentByName?: string;
  /** Unique — shown on the order card */
  reviewSentByEmail?: string;
  /**
   * Each refund given — amount and when. refundAmount is the lifetime total and
   * refundedAt only the latest, so the cash drawer uses these to count a refund
   * on the day the cash left. Absent on orders refunded before it existed.
   */
  refunds?: OrderRefund[];
}

export interface OrderRefund {
  amount: number;
  /** ISO time the refund was given. */
  at: string;
}

/** 80mm roll prints 72mm wide, 58mm roll prints 48mm; "custom" uses receiptPrintWidthMm. */
export type ReceiptPaper = "80mm" | "58mm" | "custom";

/** Language of the WhatsApp review message. */
export type ReviewMessageLang = "both" | "en" | "ur";

export interface ShopSettings {
  shopName: string;
  phone: string;
  currency: string;
  slogan: string;
  /** Landing page eyebrow text (e.g. "Burgers · Wings · Fries · Wraps") */
  eyebrow: string;
  /** Uploaded logo URL for branding */
  logoUrl: string;
  /** Footer copyright name */
  copyrightName: string;
  /** Hero background slideshow image URLs */
  heroSlides: string[];
  /** WhatsApp number for the Order Now button */
  whatsappNumber: string;
  /** Google review link (g.page/r/…/review) — receipt QR + WhatsApp review message */
  googleReviewUrl: string;
  /** WhatsApp review message: Urdu + English, or one of them */
  reviewMessageLang: ReviewMessageLang;
  /** Online menu link in the WhatsApp review message; empty → not sent */
  menuUrl: string;
  /** Tax percentage (0 = no tax) */
  taxPercent: number;
  /** Fixed delivery charges (0 = free delivery) */
  deliveryCharges: number;
  /** POS software company name on receipt footer ("Software by …") */
  softwareCompanyName: string;
  /** POS software company phone on receipt footer */
  softwareCompanyPhone: string;
  /** Thermal roll in the counter printer — sets receipt width and type sizes. */
  receiptPaper: ReceiptPaper;
  /** Printable width in mm, used when receiptPaper is "custom" (e.g. 76). */
  receiptPrintWidthMm: number;
  /**
   * Shop day open time in Pakistan (`HH:mm`), e.g. `"12:00"`.
   * Orders from this time count toward that business date.
   */
  businessDayStart: string;
  /**
   * Shop day close time in Pakistan (`HH:mm`), e.g. `"04:00"`.
   * If on/before start, closes the next calendar morning.
   */
  businessDayEnd: string;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: "Brovo Bites",
  phone: "",
  currency: "PKR",
  slogan: "Authentic Taste, Royal Experience",
  eyebrow: "Burgers · Wings · Fries · Wraps",
  logoUrl: "",
  copyrightName: "Brovo Bites",
  heroSlides: [],
  whatsappNumber: "",
  googleReviewUrl: "",
  reviewMessageLang: "both",
  menuUrl: "",
  taxPercent: 0,
  deliveryCharges: 0,
  softwareCompanyName: "Nexora",
  softwareCompanyPhone: "0307-5839836",
  receiptPaper: "80mm",
  receiptPrintWidthMm: 72,
  businessDayStart: "00:00",
  businessDayEnd: "23:59",
};

export const DEFAULT_BRANCH_ID = "main";

/* ── Expense tracking ── */

export type ExpenseCategory =
  | "rent"
  | "salaries"
  | "utilities"
  | "supplies"
  | "maintenance"
  | "transport"
  | "marketing"
  | "other";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "rent",
  "salaries",
  "utilities",
  "supplies",
  "maintenance",
  "transport",
  "marketing",
  "other",
];

export interface Expense {
  id: string;
  branchId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}

/** Immutable audit trail: owner sees branch-wide; staff sees own actions only. */
export type ActivityEntityType = "expense" | "order" | "inventory";
export type ActivityAction = "create" | "update" | "delete" | "cancel";

export interface ActivityLog {
  id: string;
  branchId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  summary: string;
  detail?: string;
  /** What the order / expense looked like before and after (newer logs only). */
  change?: ActivityChange;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

/** An order's bill as a log keeps it — enough to show "before → after". */
export interface ActivityOrderSnapshot {
  orderNumber: number;
  items: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discountAmount: number;
  /** "10%" for a percent discount; empty for a fixed one. */
  discountLabel?: string;
  taxAmount: number;
  deliveryCharges: number;
  total: number;
  paymentMethod: PaymentMethod;
  orderType?: OrderType;
  customerName?: string;
  customerPhone?: string;
  tableNumber?: string;
  deliveryAddress?: string;
  /** Refunded so far (before this change). */
  refundAmount?: number;
  createdAt?: string;
}

export interface ActivityExpenseSnapshot {
  category: string;
  description: string;
  amount: number;
  date: string;
}

export type ActivityChange =
  | {
      kind: "order";
      /** The bill before the change (edit / cancel / refund / delete). */
      before?: ActivityOrderSnapshot;
      /** The bill after an edit. */
      after?: ActivityOrderSnapshot;
      refund?: { amount: number; reason?: string; totalRefunded: number };
    }
  | {
      kind: "expense";
      before?: ActivityExpenseSnapshot;
      after?: ActivityExpenseSnapshot;
    };

/* ── Inventory / Stock ── */

export type StockUnit =
  | "pcs"
  | "bottle"
  | "can"
  | "pack"
  | "plate"
  | "kg"
  | "g"
  | "ltr"
  | "ml"
  | "dozen"
  | "box"
  | "bag";

export const STOCK_UNITS: StockUnit[] = ["pcs", "bottle", "can", "pack", "plate", "kg", "g", "ltr", "ml", "dozen", "box", "bag"];

export type StockMovementType = "purchase" | "sale" | "adjustment" | "waste" | "restock";

export interface InventoryItem {
  id: string;
  branchId: string;
  productId: string;
  productName: string;
  /** Set when one size of a sized item (Soft Drink · 1.5 Litre) is stocked on its own. */
  variationId?: string;
  variationLabel?: string;
  description?: string;
  currentStock: number;
  lowStockThreshold: number;
  unit: StockUnit;
  lastUpdated: string;
  /** When it was added to stock: sales made before that never move it. */
  createdAt?: string;
  /** Local write not on the server yet (offline). */
  pendingSync?: boolean;
}

export interface StockMovement {
  id: string;
  branchId: string;
  inventoryItemId: string;
  productId: string;
  productName: string;
  variationId?: string;
  movementType: StockMovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  /** Signed change to the stock (−2 for a sale of two). Older rows: newStock − previousStock. */
  delta?: number;
  notes: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

/* ── Discount ── */

export type DiscountType = "percent" | "fixed";

/* ── Cash Drawer ── */

export interface CashDrawerSession {
  id: string;
  branchId: string;
  date: string;
  openingBalance: number;
  closingCount: number | null;
  expectedCash: number | null;
  difference: number | null;
  status: "open" | "closed";
  openedBy: string;
  openedByName: string;
  openedAt: string;
  closedBy?: string;
  closedByName?: string;
  closedAt?: string;
  /** Closed automatically at business-day end (no physical count). */
  autoClosed?: boolean;
}

/* ── Staff Permissions ── */

export interface StaffPermissions {
  canAddExpenses: boolean;
  /** Delete own expenses (owner can always delete any). */
  canDeleteExpenses: boolean;
  canApplyDiscount: boolean;
  canEditOrders: boolean;
  canCancelOrders: boolean;
  canManageInventory: boolean;
}

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  canAddExpenses: true,
  canDeleteExpenses: true,
  canApplyDiscount: true,
  canEditOrders: true,
  canCancelOrders: true,
  canManageInventory: true,
};

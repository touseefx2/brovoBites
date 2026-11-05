"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Branch, CartLine, Category, DiscountType, OrderType, Product } from "@bravobites/domain";
import {
  addToCart,
  businessDateKey,
  businessDayHoursFromSettings,
  canAddExpenses,
  canManageInventory,
  canApplyDiscount,
  cartSubtotal,
  DEFAULT_SETTINGS,
  formatPkr,
  isCartEmpty,
  money,
  removeFromCart,
  SHARED_MENU_ID,
  startOfBusinessDay,
  toOrderItems,
  updateCartQty,
} from "@bravobites/domain";
import { RequireAuth } from "@/components/RequireAuth";
import { BranchGate } from "@/components/BranchGate";
import { LanguageToggle } from "@/components/LanguageToggle";
import { PosThemeToggle } from "@/components/PosThemeToggle";
import { BrandLogo } from "@/components/Brand";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { OrderDetailSheet } from "@/components/OrderDetailSheet";
import { OrderListCard } from "@/components/OrderListCard";
import { PosExpensesSheet } from "@/components/PosExpensesSheet";
import { PosInventorySheet } from "@/components/PosInventorySheet";
import { PosDayReport } from "@/components/PosDayReport";
import { PosActivityLog, PosLogsLink } from "@/components/PosActivityLog";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { usePosThemeScope } from "@/lib/pos-theme";
import { mapFirebaseError } from "@/lib/errors";
import {
  fetchOrders,
  getCloudLastOrderNumber,
  onBranchesSnapshot,
  onCategoriesSnapshot,
  onInventorySnapshot,
  onProductsSnapshot,
  onSettingsSnapshot,
} from "@/lib/firestore";
import type { Unsubscribe } from "firebase/firestore";
import {
  enqueueCheckout,
  kickSync,
  listActiveQueuedMutations,
  listActiveQueuedOrders,
  peekLocalNextOrderNumber,
  queuedToOrder,
  reconcileFromServer,

  subscribeQueue,
  type QueueSnapshot,
} from "@/lib/pos-queue";
import {
  bootstrapPosCatalog,
  writeCachedPosCatalog,
} from "@/lib/pos-catalog";
import type { PosCatalogSnapshot } from "@/lib/pos-catalog";
import { buildReceiptHtml, printReceipt, receiptLabels } from "@/lib/print-receipt";
import { reviewUrlOf } from "@/lib/review-request";
import { ReceiptPreview } from "@/components/ReceiptPreview";
import { checkLogout, reloadToLogin, stockChangesUploaded, syncBeforeLogout, type LogoutBlock } from "@/lib/logout-guard";
import {
  isPcClockWrong,
  pcClockBlocksSales,
  PcClockWrongError,
  shopNow,
  shopNowIso,
  subscribeShopClock,
} from "@/lib/shop-clock";
import { resolveCategoryImage, resolveProductImage } from "@/lib/menu-images";
import type { Order, PaymentMethod, ShopSettings } from "@bravobites/domain";


/** Recent orders = this business day only (e.g. 12 PM → 4 AM), not the whole history. */
function todayStartIso(settings: ShopSettings | null): string {
  const hours = businessDayHoursFromSettings(settings);
  return startOfBusinessDay(businessDateKey(shopNow(), hours), hours).toISOString();
}

function CartPanel({
  cart,
  subtotal,
  taxAmount,
  taxPercent,
  dlvCharges,
  total,
  busy,
  hideTitle = false,
  getItemImage,
  onQty,
  onRemove,
  onClear,
  onReview,
  noteEditKey,
  onNoteEditKey,
  onNoteChange,
}: {
  cart: CartLine[];
  subtotal: number;
  taxAmount: number;
  taxPercent: number;
  dlvCharges: number;
  total: number;
  busy: boolean;
  hideTitle?: boolean;
  getItemImage: (line: CartLine) => string;
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onReview: () => void;
  noteEditKey: string | null;
  onNoteEditKey: (key: string | null) => void;
  onNoteChange: (key: string, note: string) => void;
}) {
  const { t } = useLocale();
  const hasCharges = taxAmount > 0 || dlvCharges > 0;
  const itemCount = cart.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideTitle ? (
        <div className="pos-cart-head">
          <h2 className="pos-cart-title">
            {t("currentOrder")}
            {itemCount > 0 ? (
              <span className="pos-cart-count" dir="ltr">
                {itemCount}
              </span>
            ) : null}
          </h2>
          {cart.length > 0 ? (
            <button
              type="button"
              className="pos-cart-clear"
              disabled={busy}
              onClick={onClear}
              aria-label={t("clearCart")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              {t("clearCart")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {cart.length === 0 ? (
          <div className="pos-cart-empty">
            <span className="pos-cart-empty-icon" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 7h12l-1 13H7L6 7Z" />
                <path d="M9 7V5a3 3 0 0 1 6 0v2" />
                <path d="M12 11v5M9.5 13.5h5" />
              </svg>
            </span>
            <p className="m-0">{t("addItems")}</p>
          </div>
        ) : (
          <div className="pos-cart-list">
            {cart.map((line) => (
              <div key={line.key} className="pos-cart-line">
                <img
                  src={getItemImage(line)}
                  alt=""
                  className="pos-cart-thumb"
                />
                <div className="pos-cart-line-body">
                  <div className="pos-cart-line-top">
                    <p className="pos-cart-line-name">{line.productName}</p>
                    <button
                      type="button"
                      className="pos-cart-delete"
                      onClick={() => onRemove(line.key)}
                      aria-label={t("remove")}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>
                  {line.variationLabel ? (
                    <span className="pos-variant-chip">{line.variationLabel}</span>
                  ) : null}
                  {noteEditKey === line.key ? (
                    <input
                      type="text"
                      defaultValue={line.note ?? ""}
                      placeholder={t("addNote")}
                      aria-label={t("addNote")}
                      autoFocus
                      className="pos-cart-note-input"
                      onBlur={(e) => {
                        onNoteChange(line.key, e.target.value.trim());
                        onNoteEditKey(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onNoteChange(line.key, (e.target as HTMLInputElement).value.trim());
                          onNoteEditKey(null);
                        }
                      }}
                    />
                  ) : line.note ? (
                    <button
                      type="button"
                      className="pos-cart-note-btn has-note"
                      onClick={() => onNoteEditKey(line.key)}
                    >
                      {"↳"} {line.note}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pos-cart-note-btn"
                      onClick={() => onNoteEditKey(line.key)}
                    >
                      + {t("addNote")}
                    </button>
                  )}
                  <div className="pos-cart-line-foot">
                    <span className="pos-cart-line-price" dir="ltr">
                      {formatPkr(line.unitPrice * line.qty)}
                    </span>
                    <div className="pos-qty" dir="ltr">
                      <button
                        type="button"
                        className="pos-qty-btn"
                        onClick={() => onQty(line.key, line.qty - 1)}
                        aria-label="−"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
                      </button>
                      <span className="pos-qty-value">{line.qty}</span>
                      <button
                        type="button"
                        className="pos-qty-btn is-plus"
                        onClick={() => onQty(line.key, line.qty + 1)}
                        aria-label="+"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="pos-cart-foot">
        {hasCharges && cart.length > 0 ? (
          <div className="pos-cart-sums">
            <div>
              <span>{t("subtotal")}</span>
              <span className="tabular-nums" dir="ltr">{formatPkr(subtotal)}</span>
            </div>
            {taxAmount > 0 ? (
              <div>
                <span>{t("tax")} ({taxPercent}%)</span>
                <span className="tabular-nums" dir="ltr">{formatPkr(taxAmount)}</span>
              </div>
            ) : null}
            {dlvCharges > 0 ? (
              <div>
                <span>{t("deliveryCharges")}</span>
                <span className="tabular-nums" dir="ltr">{formatPkr(dlvCharges)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="pos-cart-total">
          <span>{t("total")}</span>
          <span className="pos-cart-total-amount" dir="ltr">
            {formatPkr(total)}
          </span>
        </div>
        <button
          type="button"
          className="btn pos-cta w-full"
          disabled={busy || isCartEmpty(cart)}
          onClick={onReview}
        >
          {t("reviewBill")}
        </button>
      </div>
    </div>
  );
}

/** Stroke icons for the checkout option cards (no emoji — docs/DESIGN.md §3). */
function OptIcon({ kind }: { kind: OrderType | PaymentMethod }) {
  const common = {
    width: "1em",
    height: "1em",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "dine-in":
      return (
        <svg {...common}>
          <path d="M4 3v7a3 3 0 0 0 3 3v8M10 3v7a3 3 0 0 1-3 3M7 3v6" />
          <path d="M20 15V3a5 5 0 0 0-4 5v6a1 1 0 0 0 1 1h3Zm0 0v6" />
        </svg>
      );
    case "takeaway":
      return (
        <svg {...common}>
          <path d="M5 8h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9L5 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "delivery":
      return (
        <svg {...common}>
          <circle cx="6" cy="17" r="3" />
          <circle cx="18" cy="17" r="3" />
          <path d="M9 17h6l-2-7h-3M15 6h2l3.5 8.5M13 10h4" />
          <path d="M3 10h5v4" />
        </svg>
      );
    case "cash":
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="19" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.6" />
          <path d="M6 9.5v.01M18 14.5v.01" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
          <path d="M2.5 10h19M6.5 15h4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" />
          <path d="M11 18.5h2" />
          <path d="m9.5 10 2 2 3.5-3.5" />
        </svg>
      );
  }
}

/** Category photo; on a missing file it tries the next source, then shows the initial. */
function CategoryThumb({ srcs, name }: { srcs: string[]; name: string }) {
  const [idx, setIdx] = useState(0);
  const src = srcs[idx];
  if (!src) {
    return (
      <span className="pos-cat-img pos-cat-fallback" aria-hidden>
        {name.trim().charAt(0)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="pos-cat-img" onError={() => setIdx((i) => i + 1)} />
  );
}

function PosApp() {
  const { profile, logout, activeBranchId } = useAuth();
  const { t, dir } = useLocale();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = false;
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [checkoutPreviewOpen, setCheckoutPreviewOpen] = useState(false);
  const [checkoutModalError, setCheckoutModalError] = useState<string | null>(null);
  const [previewOrderNumber, setPreviewOrderNumber] = useState<number | null>(null);
  const [previewAt, setPreviewAt] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutBlocked, setLogoutBlocked] = useState<LogoutBlock | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(0);
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  /** Bumped on every open — late responses from an older open are dropped. */
  const recentReqRef = useRef(0);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  // Keep the branch's stock rows in this PC's cache, so the Inventory sheet
  // and the day's stock still open (and count local sales) with the net gone.
  useEffect(() => {
    if (!branchId) return;
    return onInventorySnapshot(branchId, () => {}, () => {});
  }, [branchId]);
  const [reportOpen, setReportOpen] = useState(false);
  const [orderLogsOpen, setOrderLogsOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [lockedTaxPercent, setLockedTaxPercent] = useState<number | null>(null);
  const [lockedDlvCharges, setLockedDlvCharges] = useState<number | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [noteEditKey, setNoteEditKey] = useState<string | null>(null);
  const checkoutLockRef = useRef(false);
  const [imgEpoch, setImgEpoch] = useState(0);
  const [queueSnap, setQueueSnap] = useState<QueueSnapshot>({
    pendingCount: 0,
    failedCount: 0,
    expensePendingCount: 0,
    syncing: false,
    lastError: null,
    counterReady: false,
    notReadyReason: "loading",
  });
  const [localPendingOrders, setLocalPendingOrders] = useState<Order[]>([]);
  const [mutationOrderIds, setMutationOrderIds] = useState<Set<string>>(new Set());
  const [deletedOrderIds, setDeletedOrderIds] = useState<Set<string>>(new Set());
  const catalogRefreshRef = useRef<(() => void) | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);
  const [clockNow, setClockNow] = useState(() => shopNow());

  const [clockWrong, setClockWrong] = useState(false);

  const [clockBlocked, setClockBlocked] = useState(false);

  useEffect(() => {
    const tick = () => {
      const d = shopNow();
      setClockNow(d);
      setClockWrong(isPcClockWrong());
      setClockBlocked(pcClockBlocksSales());
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    const unsubClock = subscribeShopClock(tick);
    return () => {
      window.clearInterval(id);
      unsubClock();
    };
  }, []);

  useEffect(() => {
    const on = () => {
      catalogRefreshRef.current?.();
      setImgEpoch((n) => n + 1);
    };
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("online", on);
    };
  }, []);

  const prevPendingRef = useRef(0);
  useEffect(() => {
    if (!profile) return;
    return subscribeQueue((snap) => {
      setQueueSnap(snap);
      // When pending count drops (sync completed), refresh pending + mutation lists.
      if (snap.pendingCount < prevPendingRef.current && recentOpen && branchId) {
        void Promise.all([
          listActiveQueuedOrders(),
          listActiveQueuedMutations(),
          fetchOrders(branchId, null, { sinceIso: todayStartIso(settings) }),
        ]).then(([pending, activeMuts, freshOrders]) => {
          const mutByOrder = new Map(
            activeMuts.map((m) => [m.orderId, m.orderAfter]),
          );
          const since = todayStartIso(settings);
          setLocalPendingOrders(
            pending
              // Today only, like the cloud list (older unsynced sales show in Report).
              .filter((q) => q.branchId === branchId && q.createdAt >= since)
              .map((q) => mutByOrder.get(q.clientId) ?? queuedToOrder(q)),
          );
          setRecentOrders(
            freshOrders.map((o) => mutByOrder.get(o.id) ?? o),
          );
          setMutationOrderIds(new Set(activeMuts.map((m) => m.orderId)));
          setDeletedOrderIds(new Set(
            activeMuts.filter((m) => m.kind === "delete").map((m) => m.orderId),
          ));
        });
      }
      prevPendingRef.current = snap.pendingCount;
    });
  }, [profile, branchId, recentOpen, settings]);

  // When network returns, retry all broken images (catalog, cart, receipt).
  useEffect(() => {
    if (imgEpoch === 0) return;
    const timer = setTimeout(() => {
      document.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        if (!img.complete || img.naturalWidth === 0) {
          const { src } = img;
          img.src = "";
          img.src = src;
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [imgEpoch]);

  // The check asks the login server (a few seconds when the line is down):
  // extra clicks meanwhile don't start more checks / dialogs.
  const logoutCheck = useRef(false);
  async function tryLogout() {
    if (logoutCheck.current) return;
    logoutCheck.current = true;
    try {
      const { block, unsynced } = await checkLogout();
      setLogoutFailed(unsynced);
      if (block) setLogoutBlocked(block);
      else setConfirmLogout(true);
    } finally {
      logoutCheck.current = false;
    }
  }

  async function doLogout() {
    setLoggingOut(true);
    try {
      // Re-check: a sale may have been queued while the dialog was open.
      const { block } = await checkLogout();
      if (block) {
        setConfirmLogout(false);
        setLogoutBlocked(block);
        return;
      }
      // Upload this person's waiting work under their name first.
      const left = await syncBeforeLogout();
      // That took a while and work is left: the line may have dropped
      // meanwhile — check again, nobody could log back in without it.
      if (left > 0) {
        const again = await checkLogout();
        if (again.block) {
          setConfirmLogout(false);
          setLogoutBlocked(again.block);
          return;
        }
      }
      // Stock changes go up only while their author is signed in: never leave them behind.
      if (!(await stockChangesUploaded())) {
        setConfirmLogout(false);
        setLogoutBlocked({ kind: "stock" });
        return;
      }
      await logout();
      reloadToLogin();
    } finally {
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  }

  // The catalog depends on who / which branch only: a new profile object (every
  // users-doc snapshot) or a language switch must not reload it.
  const tRef = useRef(t);
  tRef.current = t;
  const profileBranchKey = profile?.branchIds.join(",");

  useEffect(() => {
    if (!profile) return;

    let cancelled = false;
    let liveUnsubs: Unsubscribe[] = [];
    const catalogRef = {
      branches: [] as Branch[],
      categories: [] as Category[],
      products: [] as Product[],
      settings: null as ShopSettings | null,
    };
    let persistTimer: ReturnType<typeof setTimeout> | null = null;

    function filterBranches(all: Branch[]): Branch[] {
      return profile!.role === "owner"
        ? all.filter((x) => x.isActive)
        : all.filter(
            (x) => profile!.branchIds.includes(x.id) && x.isActive,
          );
    }

    function applyBranches(all: Branch[]) {
      catalogRef.branches = all;
      const allowed = filterBranches(all);
      setBranches(allowed);
      setBranchId((prev) => {
        if (prev && allowed.some((x) => x.id === prev)) return prev;
        if (
          profile!.role !== "owner" &&
          activeBranchId &&
          allowed.some((x) => x.id === activeBranchId)
        ) {
          return activeBranchId;
        }
        return allowed[0]?.id ?? "";
      });
    }

    function applyCatalog(snap: PosCatalogSnapshot) {
      applyBranches(snap.branches);
      catalogRef.settings = snap.settings;
      catalogRef.categories = snap.categories.filter((c) => c.isActive);
      catalogRef.products = snap.products.filter((p) => p.isActive);
      setSettings(snap.settings);
      setCategories(catalogRef.categories);
      setProducts(catalogRef.products);
      setError(null);
    }

    function schedulePersist() {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        if (!catalogRef.settings) return;
        void writeCachedPosCatalog({
          branches: catalogRef.branches,
          categories: catalogRef.categories,
          products: catalogRef.products,
          settings: catalogRef.settings,
          savedAt: new Date().toISOString(),
        });
      }, 600);
    }

    function stopLive() {
      liveUnsubs.forEach((u) => u());
      liveUnsubs = [];
    }

    function startLive() {
      stopLive();
      liveUnsubs.push(
        onBranchesSnapshot(
          (all) => {
            if (cancelled) return;
            applyBranches(all);
            schedulePersist();
          },
          () => {
            /* keep cache */
          },
        ),
      );
      liveUnsubs.push(
        onCategoriesSnapshot(
          SHARED_MENU_ID,
          (cats) => {
            if (cancelled) return;
            catalogRef.categories = cats.filter((c) => c.isActive);
            setCategories(catalogRef.categories);
            schedulePersist();
          },
          () => {},
        ),
      );
      liveUnsubs.push(
        onProductsSnapshot(
          SHARED_MENU_ID,
          (prods) => {
            if (cancelled) return;
            catalogRef.products = prods.filter((p) => p.isActive);
            setProducts(catalogRef.products);
            schedulePersist();
          },
          () => {},
        ),
      );
      liveUnsubs.push(
        onSettingsSnapshot(
          (s) => {
            if (cancelled) return;
            catalogRef.settings = s;
            setSettings(s);
            schedulePersist();
          },
          () => {},
        ),
      );
    }

    async function loadCatalog(opts?: { soft?: boolean }) {
      const soft = opts?.soft === true;
      if (!soft) setLoadingMenu(true);
      try {
        const { snapshot } = await bootstrapPosCatalog();
        if (cancelled) return;
        applyCatalog(snapshot);
        setLoadingMenu(false);
        if (typeof navigator === "undefined" || navigator.onLine) {
          startLive();
        }
      } catch (e) {
        if (cancelled) return;
        if (soft) return;
        const raw = e instanceof Error ? e.message : "";
        setError(
          raw.includes("Connect once")
            ? tRef.current("posCatalogNeedNet")
            : mapFirebaseError(e),
        );
        setLoadingMenu(false);
      }
    }

    catalogRefreshRef.current = () => {
      // Firestore listeners survive offline/online transitions automatically.
      // Only bootstrap if no listeners exist yet (first load or after unmount).
      if (liveUnsubs.length === 0) {
        if (typeof navigator !== "undefined" && navigator.onLine) {
          startLive();
        } else {
          void loadCatalog({ soft: true });
        }
      }
    };
    void loadCatalog({ soft: false });

    return () => {
      cancelled = true;
      catalogRefreshRef.current = null;
      stopLive();
      if (persistTimer) clearTimeout(persistTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, profile?.role, profileBranchKey, activeBranchId]);

  // Switching between branches clears cart; first assign from empty does not
  const prevBranchRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevBranchRef.current;
    prevBranchRef.current = branchId;
    if (prev === null || prev === branchId) return;
    if (!prev || !branchId) return;
    setCart([]);
    setLastOrder(null);
    setMobileCartOpen(false);
    setCheckoutPreviewOpen(false);
    setPreviewOrderNumber(null);
    setPreviewAt("");
    setCategoryId("all");
    setMenuQuery("");
    setError(null);
  }, [branchId]);

  useEffect(() => {
    if (!mobileCartOpen && !checkoutPreviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (checkoutPreviewOpen) {
        setCheckoutPreviewOpen(false);
        setPreviewOrderNumber(null);
        setPreviewAt("");
        return;
      }
      setMobileCartOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileCartOpen, checkoutPreviewOpen, busy]);

  const visibleProducts = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    // Menu order: category sortOrder, then product sortOrder, then name — so
    // "All" lists Burgers…Drinks in the rail's order instead of interleaving
    // every category's #1, #2, … (products only carry a per-category sortOrder).
    const catRank = new Map<string, [number, number]>();
    categories.forEach((c, i) => catRank.set(c.id, [c.sortOrder ?? 0, i]));
    const missing: [number, number] = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    return products
      .filter((p) => {
        if (categoryId !== "all" && p.categoryId !== categoryId) return false;
        if (!q) return true;
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.variations.some((v) => v.label.toLowerCase().includes(q))) return true;
        if (p.dealItems.some((d) => d.label.toLowerCase().includes(q))) return true;
        return false;
      })
      .sort((a, b) => {
        const ca = catRank.get(a.categoryId) ?? missing;
        const cb = catRank.get(b.categoryId) ?? missing;
        return (
          ca[0] - cb[0] ||
          ca[1] - cb[1] ||
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          a.name.localeCompare(b.name)
        );
      });
  }, [products, categories, categoryId, menuQuery]);

  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    return counts;
  }, [products]);

  const liveTaxPercent = settings?.taxPercent ?? 0;
  const liveDlvCharges = settings?.deliveryCharges ?? 0;

  useEffect(() => {
    if (cart.length > 0 && lockedTaxPercent === null) {
      setLockedTaxPercent(liveTaxPercent);
      setLockedDlvCharges(liveDlvCharges);
    } else if (cart.length === 0 && lockedTaxPercent !== null) {
      setLockedTaxPercent(null);
      setLockedDlvCharges(null);
    }
  }, [cart.length, liveTaxPercent, liveDlvCharges, lockedTaxPercent]);

  const subtotal = cartSubtotal(cart);
  const taxPercent = lockedTaxPercent ?? liveTaxPercent;
  const dlvChargesBase = lockedDlvCharges ?? liveDlvCharges;
  const dlvCharges = orderType === "delivery" ? dlvChargesBase : 0;
  const taxAmount = taxPercent > 0 ? money(subtotal * taxPercent / 100) : 0;
  const discountAmount = discountValue > 0
    ? money(discountType === "percent" ? subtotal * discountValue / 100 : Math.min(discountValue, subtotal))
    : 0;
  const total = money(subtotal + taxAmount + dlvCharges - discountAmount);
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const discountAllowed = !profile || canApplyDiscount(profile.role, discountType, discountValue, profile.permissions);
  const activeBranchName = branches.find((b) => b.id === branchId)?.name;
  const softwareCompanyName = (
    settings?.softwareCompanyName ?? DEFAULT_SETTINGS.softwareCompanyName
  ).trim();
  const softwareCompanyPhone = (
    settings?.softwareCompanyPhone ?? DEFAULT_SETTINGS.softwareCompanyPhone
  ).trim();

  // Draft of the order checkout() will save — same fields enqueueCheckout
  // stores — rendered by the same builder as the printed receipt.
  const previewReceiptHtml = useMemo(() => {
    if (!checkoutPreviewOpen) return "";
    return buildReceiptHtml({
      order: {
        orderNumber: previewOrderNumber,
        createdAt: previewAt,
        orderType,
        items: toOrderItems(cart),
        subtotal,
        ...(taxAmount > 0 ? { taxAmount, taxPercent } : {}),
        ...(dlvCharges > 0 ? { deliveryCharges: dlvCharges } : {}),
        ...(discountAmount > 0 ? { discountType, discountValue, discountAmount } : {}),
        total,
        paymentMethod,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        ...(orderType === "delivery" ? { deliveryAddress: deliveryAddress.trim() } : {}),
        ...(orderType === "dine-in" ? { tableNumber: tableNumber.trim() } : {}),
        createdByName: profile ? profile.displayName || profile.email : "",
      },
      shopName: settings?.shopName ?? "Brovo Bites",
      branchName: activeBranchName?.trim() || undefined,
      softwareCompanyName,
      softwareCompanyPhone,
      labels: receiptLabels(t),
      reviewUrl: reviewUrlOf(settings),
      dir,
      paper: settings?.receiptPaper,
      paperWidthMm: settings?.receiptPrintWidthMm,
    });
  }, [
    checkoutPreviewOpen,
    previewOrderNumber,
    previewAt,
    orderType,
    cart,
    subtotal,
    taxAmount,
    taxPercent,
    dlvCharges,
    discountType,
    discountValue,
    discountAmount,
    total,
    paymentMethod,
    customerName,
    customerPhone,
    deliveryAddress,
    tableNumber,
    profile,
    settings?.shopName,
    settings?.receiptPaper,
    settings?.receiptPrintWidthMm,
    settings?.googleReviewUrl,
    activeBranchName,
    softwareCompanyName,
    softwareCompanyPhone,
    t,
    dir,
  ]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  function getCartItemImage(line: CartLine): string {
    const product = products.find((p) => p.id === line.productId);
    const cat = product ? categoryMap.get(product.categoryId) : undefined;
    return resolveProductImage(product?.imageUrl, line.productName, cat?.name);
  }

  function closeCheckoutPreview() {
    if (busy) return;
    setCheckoutPreviewOpen(false);
    setCheckoutModalError(null);
    setPreviewOrderNumber(null);
    setPreviewAt("");
    setOrderType("dine-in");
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setTableNumber("");
    setPaymentMethod("cash");
    setDiscountType("percent");
    setDiscountValue(0);
  }

  function openCheckoutPreview() {
    if (isCartEmpty(cart) || busy) return;
    if (pcClockBlocksSales()) {
      setClockBlocked(true);
      setError(t("pcClockBlocked"));
      return;
    }
    if (!queueSnap.counterReady) {
      setError(
        queueSnap.notReadyReason === "need_net_once"
          ? t("posNeedNetOnce")
          : t("posPreparing"),
      );
      return;
    }
    if (!branchId) {
      setError(t("noActiveBranchCheckout"));
      return;
    }
    setError(null);
    setCheckoutModalError(null);
    setMobileCartOpen(false);
    setPreviewAt(shopNowIso());
    setPreviewOrderNumber(null);
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setTableNumber("");
    setCheckoutPreviewOpen(true);
    void (async () => {
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          await reconcileFromServer(() =>
            getCloudLastOrderNumber({ fromServer: true }),
          );
        }
      } catch {
        // offline — local counter only
      }
      try {
        const n = await peekLocalNextOrderNumber();
        setPreviewOrderNumber(n);
      } catch {
        setPreviewOrderNumber(null);
      }
    })();
  }

  function printOrderTicket(order: Order): boolean {
    return printReceipt({
      order,
      shopName: settings?.shopName ?? "Brovo Bites",
      branchName:
        order.branchName ||
        branches.find((b) => b.id === order.branchId)?.name,
      softwareCompanyName:
        settings?.softwareCompanyName ?? DEFAULT_SETTINGS.softwareCompanyName,
      softwareCompanyPhone:
        settings?.softwareCompanyPhone ?? DEFAULT_SETTINGS.softwareCompanyPhone,
      labels: receiptLabels(t),
      reviewUrl: reviewUrlOf(settings),
      showReprint: Boolean(order.updatedAt),
      dir,
      paper: settings?.receiptPaper,
      paperWidthMm: settings?.receiptPrintWidthMm,
    });
  }

  function checkoutFailMessage(err: unknown): string {
    const mapped = mapFirebaseError(err);
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code: string }).code)
        : "";
    const lower = mapped.toLowerCase();
    const networkish =
      code.includes("unavailable") ||
      code.includes("network") ||
      code.includes("timeout") ||
      lower.includes("network") ||
      lower.includes("offline") ||
      lower.includes("internet") ||
      lower.includes("connection");
    if (networkish || (typeof navigator !== "undefined" && !navigator.onLine)) {
      return t("checkoutNetworkAmbiguous");
    }
    return `${mapped}\n\n${t("checkoutFailHint")}`;
  }

  function onPickProduct(p: Product) {
    setError(null);
    if (p.type === "sized") {
      setPendingProduct(p);
      return;
    }
    try {
      setCart((c) => addToCart(c, p, 1));
    } catch (e) {
      setError(mapFirebaseError(e));
    }
  }

  function confirmVariation(variationId: string) {
    if (!pendingProduct) return;
    try {
      setCart((c) => addToCart(c, pendingProduct, 1, variationId));
      setPendingProduct(null);
    } catch (e) {
      setError(mapFirebaseError(e));
    }
  }

  async function checkout() {
    if (!profile || isCartEmpty(cart)) return;
    if (!queueSnap.counterReady) {
      setCheckoutModalError(
        queueSnap.notReadyReason === "need_net_once"
          ? t("posNeedNetOnce")
          : t("posPreparing"),
      );
      return;
    }
    if (!branchId) {
      setCheckoutModalError(t("noActiveBranchCheckout"));
      return;
    }
    // Ref lock only — no "Saving…" UI. Fast double-tap must not mint two numbers.
    if (checkoutLockRef.current) return;
    if (!discountAllowed) return;
    checkoutLockRef.current = true;
    setError(null);
    setCheckoutModalError(null);
    try {
      const branchName =
        branches.find((b) => b.id === branchId)?.name?.trim() || undefined;
      const order = await enqueueCheckout({
        branchId,
        branchName,
        lines: cart,
        paymentMethod,
        orderType,
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
        ...(orderType === "delivery" && deliveryAddress.trim()
          ? { deliveryAddress: deliveryAddress.trim() }
          : {}),
        ...(orderType === "dine-in" && tableNumber.trim()
          ? { tableNumber: tableNumber.trim() }
          : {}),
        taxAmount,
        taxPercent,
        deliveryCharges: dlvCharges,
        ...(discountAmount > 0 ? { discountType, discountValue, discountAmount } : {}),
        user: profile,
      });

      // Local save done — clear cart + close modal, then print (no success popup).
      setLastOrder(order);
      setCart([]);
      setMobileCartOpen(false);
      setCheckoutPreviewOpen(false);
      setCheckoutModalError(null);
      setPreviewOrderNumber(null);
      setPreviewAt("");
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setTableNumber("");
      setDiscountType("percent");
      setDiscountValue(0);
      setOrderType("dine-in");
      setPaymentMethod("cash");

      void kickSync();
      if (autoPrint) printOrderTicket(order);
    } catch (e) {
      setCheckoutModalError(
        e instanceof PcClockWrongError ? t("pcClockBlocked") : checkoutFailMessage(e),
      );
    } finally {
      checkoutLockRef.current = false;
    }
  }

  const cartHandlers = {
    onQty: (key: string, qty: number) => setCart((c) => updateCartQty(c, key, qty)),
    onRemove: (key: string) => setCart((c) => removeFromCart(c, key)),
    onClear: () => setConfirmClearCart(true),
    onReview: openCheckoutPreview,
    noteEditKey,
    onNoteEditKey: setNoteEditKey,
    onNoteChange: (key: string, note: string) => setCart((c) => c.map((l) => l.key === key ? { ...l, note: note || undefined } : l)),
  };

  async function openRecentOrders() {
    if (!branchId) {
      setError(t("noActiveBranchCheckout"));
      return;
    }
    setRecentOpen(true);
    setRecentLoading(true);
    setError(null);
    const reqId = ++recentReqRef.current;
    try {
      const [pending, activeMuts] = await Promise.all([
        listActiveQueuedOrders(),
        listActiveQueuedMutations(),
      ]);
      const mutByOrder = new Map(
        activeMuts.map((m) => [m.orderId, m.orderAfter]),
      );
      const mutIds = new Set(activeMuts.map((m) => m.orderId));
      const delIds = new Set(
        activeMuts.filter((m) => m.kind === "delete").map((m) => m.orderId),
      );
      setMutationOrderIds(mutIds);
      setDeletedOrderIds(delIds);
      // Today only, like the cloud list (older unsynced sales show in Report).
      const since = todayStartIso(settings);
      const branchPending = pending.filter(
        (q) => q.branchId === branchId && q.createdAt >= since,
      );
      setLocalPendingOrders(
        branchPending.map((q) => mutByOrder.get(q.clientId) ?? queuedToOrder(q)),
      );
      const apply = (list: Order[]) =>
        setRecentOrders(list.map((o) => mutByOrder.get(o.id) ?? o));

      // 1) Local Firestore cache — instant, same as offline.
      let shown = false;
      try {
        const cached = await fetchOrders(branchId, null, { source: "cache", sinceIso: todayStartIso(settings) });
        if (reqId !== recentReqRef.current) return;
        apply(cached);
        shown = cached.length > 0 || branchPending.length > 0;
      } catch {
        // cache miss — fall through to the server read
      }
      if (shown) setRecentLoading(false);

      // 2) Server refresh in the background — swaps in fresh data when it lands.
      try {
        const fresh = await fetchOrders(branchId, null, { sinceIso: todayStartIso(settings) });
        if (reqId !== recentReqRef.current) return;
        apply(fresh);
      } catch {
        if (!shown && reqId === recentReqRef.current) setRecentOrders([]);
      }
    } catch (e) {
      if (reqId !== recentReqRef.current) return;
      setError(mapFirebaseError(e));
      setRecentOpen(false);
    } finally {
      if (reqId === recentReqRef.current) setRecentLoading(false);
    }
  }

  return (
    <div className="pos-shell app-shell-bg flex h-dvh max-h-dvh flex-col">
      {/* Counter / sync work runs silently in the background. Checkout itself
          explains if this PC has never been online (first-time setup). */}
      <AppUpdateBanner pos cartHasItems={cart.length > 0} />
      {clockWrong || clockBlocked ? (
        <div className="shrink-0 bg-red-600 px-3 py-1 text-center text-xs font-semibold text-white">
          {t(clockBlocked ? "pcClockBlocked" : "pcClockWrong")}
        </div>
      ) : null}
      <header className="pos-header shrink-0">
        <div className="pos-bar">
          {/* Brand + active branch */}
          <div className="pos-brand flex min-w-0 items-center gap-2.5">
            <span className="pos-brand-badge">
              <BrandLogo size="sm" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="pos-brand-name truncate">Brovo Bites</p>
              <div className="pos-branch">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                {profile?.role === "owner" && branches.length > 1 ? (
                  <select
                    className="pos-branch-select"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    dir="ltr"
                    aria-label={t("branch")}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : branches.length === 1 ? (
                  <span className="truncate">{branches[0]!.name}</span>
                ) : (
                  <span className="pos-branch-missing truncate">{t("branch")}</span>
                )}
              </div>
            </div>
          </div>

          {/* Shop clock — sits beside the brand, two lines like it; wrapper is the flexible spacer */}
          <div className="pos-clock" dir="ltr">
            <div className="pos-clock-chip">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9.25" fill="currentColor" fillOpacity="0.12"/><path d="M12 6.75V12l3.5 2.25"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>
              <span className="pos-clock-time">
                {clockNow.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" }).toUpperCase()}
              </span>
              <span className="pos-clock-date">
                {clockNow.toLocaleDateString("en-PK", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Karachi" })}
              </span>
            </div>
          </div>

          {(liveTaxPercent > 0 || liveDlvCharges > 0) ? (
            <div className="pos-rates" dir="ltr">
              {liveTaxPercent > 0 ? (
                <span>
                  {t("tax")} <b>{liveTaxPercent}%</b>
                </span>
              ) : null}
              {liveDlvCharges > 0 ? (
                <span>
                  {t("delivery")} <b>{formatPkr(liveDlvCharges)}</b>
                </span>
              ) : null}
            </div>
          ) : null}

          <nav className="pos-toolbar">
            <Link className="pos-tool" href="/admin">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>
              {t("dashboard")}
            </Link>
            <button className="pos-tool" type="button" onClick={() => void openRecentOrders()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
              {t("recentOrders")}
            </button>
            {profile && canAddExpenses(profile) ? (
              <button
                className="pos-tool"
                type="button"
                onClick={() => {
                  if (!branchId) {
                    setError(t("noActiveBranchCheckout"));
                    return;
                  }
                  setExpensesOpen(true);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
                {t("expenses")}
                {queueSnap.expensePendingCount > 0 ? (
                  <span
                    className="absolute end-1 top-1 h-2 w-2 rounded-full bg-amber-400"
                    aria-label={t("recentPendingLocal")}
                  />
                ) : null}
              </button>
            ) : null}
            {profile && canManageInventory(profile) ? (
              <button
                className="pos-tool"
                type="button"
                onClick={() => {
                  if (!branchId) {
                    setError(t("noActiveBranchCheckout"));
                    return;
                  }
                  setInventoryOpen(true);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>
                {t("inventory")}
              </button>
            ) : null}
            <button
              className="pos-tool"
              type="button"
              onClick={() => {
                if (!branchId) {
                  setError(t("noActiveBranchCheckout"));
                  return;
                }
                setReportOpen(true);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>
              {t("report")}
              {/* Failed needs the cashier (red + count); pending only waits (amber). */}
              {queueSnap.failedCount > 0 ? (
                <span
                  className="absolute end-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
                  title={t("syncFailedBanner").replace("{n}", String(queueSnap.failedCount))}
                  aria-label={t("syncFailedBanner").replace("{n}", String(queueSnap.failedCount))}
                  dir="ltr"
                >
                  {queueSnap.failedCount}
                </span>
              ) : queueSnap.pendingCount > 0 ? (
                <span
                  className="absolute end-1 top-1 h-2 w-2 rounded-full bg-amber-400"
                  aria-label={t("recentPendingLocal")}
                />
              ) : null}
            </button>
          </nav>

          <span className="pos-bar-sep" aria-hidden />

          {/* Preferences + signed-in user */}
          <div className="flex shrink-0 items-center gap-1">
            <LanguageToggle iconOnly />
            <PosThemeToggle />
          </div>

          <span className="pos-bar-sep" aria-hidden />

          <div className="pos-user">
            <span className="pos-user-avatar" aria-hidden>
              {(profile?.displayName || profile?.email || "?").trim().charAt(0).toUpperCase()}
            </span>
            <div className="pos-user-text min-w-0 leading-tight">
              <p className="pos-user-name truncate capitalize">
                {profile?.displayName || profile?.email?.split("@")[0] || "—"}
                <span className="pos-user-role">
                  {profile?.role === "owner" ? t("roleOwner") : t("counter")}
                </span>
              </p>
              {profile?.email ? (
                <p className="pos-user-email truncate" dir="ltr">
                  {profile.email}
                </p>
              ) : null}
            </div>
            <button
              className="pos-icon-btn is-danger"
              type="button"
              onClick={() => void tryLogout()}
              title={t("logout")}
              aria-label={t("logout")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
            </button>
          </div>
        </div>
      </header>

      {branches.length === 0 ? (
        <div className="m-3 flex flex-col gap-2 rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="min-w-0 leading-snug">
            {profile?.role === "owner" ? t("noActiveBranchPos") : t("noBranchAssigned")}
          </p>
          {profile?.role === "owner" ? (
            <a className="btn btn-primary btn-sm shrink-0" href="/admin/branches">
              {t("createBranchCta")}
            </a>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="toast-error m-3 shrink-0">{error}</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[208px_minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_360px]">
        <aside className="pos-cats shrink-0 p-2 lg:overflow-auto lg:p-3" aria-label={t("menu")}>
          <p className="pos-cats-title">{t("menu")}</p>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-2 lg:overflow-visible lg:pb-0">
            <button
              type="button"
              className={`pos-cat-btn ${categoryId === "all" ? "is-active" : ""}`}
              aria-pressed={categoryId === "all"}
              onClick={() => setCategoryId("all")}
            >
              <span className="pos-cat-icon-all" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
              </span>
              <span className="pos-cat-text">
                <span className="pos-cat-label">{t("all")}</span>
                <span className="pos-cat-count">
                  {products.length} {t("itemsCount")}
                </span>
              </span>
            </button>
            {categories.map((c) => {
              const firstProduct = products.find((p) => p.categoryId === c.id);
              const thumbs = [resolveCategoryImage(c.imageUrl, c.name)];
              if (firstProduct) {
                thumbs.push(resolveProductImage(firstProduct.imageUrl, firstProduct.name, c.name));
              }
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`pos-cat-btn ${categoryId === c.id ? "is-active" : ""}`}
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                >
                  <CategoryThumb key={`${thumbs.join("|")}-${imgEpoch}`} srcs={thumbs} name={c.name} />
                  <span className="pos-cat-text">
                    <span className="pos-cat-label">{c.name}</span>
                    <span className="pos-cat-count">
                      {productCountByCategory.get(c.id) ?? 0} {t("itemsCount")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col p-3 pb-24 sm:px-4 sm:pt-4 lg:p-4">
          <div className="pos-menu-search-bar shrink-0 pb-3">
            <label className="relative block">
              <span className="sr-only">{t("searchMenu")}</span>
              <svg
                className="pos-menu-search-icon pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3-3" />
              </svg>
              <input
                type="search"
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                placeholder={t("searchMenu")}
                autoComplete="off"
                enterKeyHint="search"
                className="input pos-menu-search w-full text-base sm:text-sm"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loadingMenu ? (
              <p className="pos-menu-note">{t("menuLoading")}</p>
            ) : visibleProducts.length === 0 ? (
              <p className="pos-menu-note">
                {menuQuery.trim() ? t("noSearchResults") : t("emptyMenu")}
              </p>
            ) : (
              <>
                <div className="pos-grid-head">
                  <h2 className="pos-grid-title">
                    {categoryId === "all" ? t("all") : categoryMap.get(categoryId)?.name ?? t("all")}
                  </h2>
                  <span className="pos-grid-count">
                    {visibleProducts.length} {t("itemsCount")}
                  </span>
                </div>
                <div className="pos-product-grid">
                  {visibleProducts.map((p) => {
                    const cat = categoryMap.get(p.categoryId);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onPickProduct(p)}
                        className="pos-product-card"
                      >
                        <div className="pos-product-media">
                          <img
                            src={resolveProductImage(p.imageUrl, p.name, cat?.name)}
                            alt=""
                            loading="lazy"
                          />
                        </div>
                        <div className="pos-product-info">
                          <p className="pos-product-name">{p.name}</p>
                          {p.type === "bundle" && p.dealItems.length > 0 ? (
                            <p className="pos-product-deal">
                              {p.dealItems.map((d) => `${d.qty}× ${d.label}`).join(", ")}
                            </p>
                          ) : null}
                          <div className="pos-product-foot">
                            <p className="pos-product-price">
                              {p.type === "sized" ? (
                                <span className="pos-product-from">{t("from")}</span>
                              ) : null}
                              <span className="pos-product-amount" dir="ltr">
                                {formatPkr(
                                  p.type === "sized"
                                    ? Math.min(...p.variations.map((v) => v.price))
                                    : p.basePrice,
                                )}
                              </span>
                            </p>
                            <span className="pos-product-add" aria-hidden="true">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="pos-cart-aside hidden min-h-0 flex-col lg:flex">
          <CartPanel
            cart={cart}
            subtotal={subtotal}
            taxAmount={taxAmount}
            taxPercent={taxPercent}
            dlvCharges={dlvCharges}
            total={total}
            busy={busy}
            getItemImage={getCartItemImage}
            {...cartHandlers}
          />
        </aside>
      </div>

      {/* Mobile sticky cart bar */}
      <div className="pos-cart-bar fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <button
          type="button"
          className="btn pos-cta flex w-full items-center justify-between gap-3 px-4"
          onClick={() => setMobileCartOpen(true)}
        >
          <span className="inline-flex items-center">
            {t("viewOrder")}
            {cartCount > 0 ? (
              <span className="pos-cta-count" dir="ltr">
                {cartCount}
              </span>
            ) : null}
          </span>
          <span dir="ltr">{formatPkr(total)}</span>
        </button>
      </div>

      {/* Mobile cart sheet */}
      {mobileCartOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="pos-scrim absolute inset-0"
            aria-label={t("close")}
            onClick={() => setMobileCartOpen(false)}
          />
          <div className="pos-cart-sheet relative z-10 flex h-[min(85dvh,40rem)] max-h-[85dvh] flex-col rounded-t-2xl shadow-xl">
            <span className="pos-sheet-grip" aria-hidden />
            <div className="pos-sheet-head pt-4">
              <h2 className="pos-cart-title">
                {t("currentOrder")}
                {cartCount > 0 ? (
                  <span className="pos-cart-count" dir="ltr">
                    {cartCount}
                  </span>
                ) : null}
              </h2>
              <div className="flex items-center gap-1">
                {cart.length > 0 ? (
                  <button
                    type="button"
                    className="pos-cart-clear"
                    onClick={() => setConfirmClearCart(true)}
                    aria-label={t("clearCart")}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    {t("clearCart")}
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMobileCartOpen(false)}>
                  {t("close")}
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <CartPanel
                cart={cart}
                subtotal={subtotal}
                taxAmount={taxAmount}
                taxPercent={taxPercent}
                dlvCharges={dlvCharges}
                total={total}
                busy={busy}
                hideTitle
                getItemImage={getCartItemImage}
                {...cartHandlers}
              />
            </div>
          </div>
        </div>
      ) : null}

      {pendingProduct ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 pb-[max(0px,env(safe-area-inset-bottom,0px))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="choose-size-title"
        >
          <button
            type="button"
            className="pos-scrim absolute inset-0"
            aria-label={t("close")}
            onClick={() => setPendingProduct(null)}
          />
          <div className="pos-size-sheet relative z-10 w-full max-w-[22rem] overflow-hidden rounded-t-2xl shadow-2xl sm:rounded-2xl">
            <div className="pos-size-head flex items-center gap-3 px-3.5 py-3 sm:px-4">
              <div className="pos-size-thumb shrink-0 overflow-hidden">
                <img
                  src={resolveProductImage(
                    pendingProduct.imageUrl,
                    pendingProduct.name,
                    categoryMap.get(pendingProduct.categoryId)?.name,
                  )}
                  alt=""
                  className="size-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="pos-size-eyebrow">
                  {t("chooseSize")}
                </p>
                <h3
                  id="choose-size-title"
                  className="truncate text-base font-bold leading-snug text-[var(--ink)]"
                >
                  {pendingProduct.name}
                </h3>
              </div>
              <button
                type="button"
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
                aria-label={t("close")}
                onClick={() => setPendingProduct(null)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 p-3.5 sm:gap-3 sm:p-4">
              {pendingProduct.variations.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="pos-size-opt"
                  onClick={() => confirmVariation(v.id)}
                >
                  <span className="pos-size-label">
                    {v.label}
                  </span>
                  <span className="pos-size-price" dir="ltr">
                    {formatPkr(v.price)}
                  </span>
                </button>
              ))}
            </div>

            <div className="px-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-0 sm:px-4 sm:pb-4">
              <button
                type="button"
                className="btn btn-ghost min-h-11 w-full"
                onClick={() => setPendingProduct(null)}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {checkoutPreviewOpen ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-preview-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-stone-950/65 backdrop-blur-[3px]"
            aria-label={t("close")}
            disabled={busy}
            onClick={() => closeCheckoutPreview()}
          />
          <div className="pos-dialog relative z-10 flex max-h-[min(95dvh,42rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl shadow-[0_25px_80px_rgba(0,0,0,0.45)] sm:rounded-2xl">
            {/* Header — title + customer + discount */}
            <div className="modal-dark-head shrink-0 px-4 pb-3.5 pt-4 sm:px-5 sm:pt-[1.125rem]">
              <h2
                id="checkout-preview-title"
                className="pos-dialog-title text-xl sm:text-[1.375rem]"
              >
                {t("receiptPreview")}
              </h2>
              <p className="modal-dark-muted mt-0.5 text-[11px] leading-snug sm:text-xs">
                {t("receiptPreviewHint")}
              </p>
              <div
                className={`mt-3 grid grid-cols-1 gap-2.5 sm:gap-3 ${
                  orderType === "dine-in" || orderType === "delivery"
                    ? "sm:grid-cols-2 lg:grid-cols-4"
                    : "sm:grid-cols-3"
                }`}
              >
                <section>
                  <label
                    htmlFor="checkout-customer-name"
                    className="modal-dark-label mb-1.5 block text-xs font-semibold"
                  >
                    {t("customerNameLabel")}{" "}
                    <span className="modal-dark-muted font-normal">
                      ({t("fieldOptional")})
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      id="checkout-customer-name"
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="h-11 w-full modal-dark-input rounded-xl pe-11 ps-3 text-base outline-none transition sm:text-sm"
                      autoComplete="name"
                      maxLength={80}
                    />
                    {customerName ? (
                      <button
                        type="button"
                        className="pos-field-clear absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl"
                        aria-label={t("clear")}
                        onClick={() => setCustomerName("")}
                      >
                        <span className="modal-dark-clear flex size-7 items-center justify-center rounded-full" aria-hidden>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </span>
                      </button>
                    ) : null}
                  </div>
                </section>

                <section>
                  <label
                    htmlFor="checkout-customer-phone"
                    className="modal-dark-label mb-1.5 block text-xs font-semibold"
                  >
                    {t("customerPhoneLabel")}{" "}
                    <span className="modal-dark-muted font-normal">
                      ({t("fieldOptional")})
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      id="checkout-customer-phone"
                      type="tel"
                      inputMode="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="h-11 w-full modal-dark-input rounded-xl pe-11 ps-3 text-base tabular-nums outline-none transition sm:text-sm"
                      autoComplete="tel"
                      maxLength={20}
                      dir="ltr"
                    />
                    {customerPhone ? (
                      <button
                        type="button"
                        className="pos-field-clear absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl"
                        aria-label={t("clear")}
                        onClick={() => setCustomerPhone("")}
                      >
                        <span className="modal-dark-clear flex size-7 items-center justify-center rounded-full" aria-hidden>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </span>
                      </button>
                    ) : null}
                  </div>
                </section>

                {orderType === "dine-in" ? (
                  <section>
                    <label
                      htmlFor="checkout-table-number"
                      className="modal-dark-label mb-1.5 block text-xs font-semibold"
                    >
                      {t("tableNumberLabel")}{" "}
                      <span className="modal-dark-muted font-normal">
                        ({t("fieldOptional")})
                      </span>
                    </label>
                    <div className="relative">
                      <input
                        id="checkout-table-number"
                        type="text"
                        inputMode="numeric"
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                        className="h-11 w-full modal-dark-input rounded-xl pe-11 ps-3 text-base tabular-nums outline-none transition sm:text-sm"
                        autoComplete="off"
                        maxLength={12}
                        dir="ltr"
                      />
                      {tableNumber ? (
                        <button
                          type="button"
                          className="pos-field-clear absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl"
                          aria-label={t("clear")}
                          onClick={() => setTableNumber("")}
                        >
                          <span className="modal-dark-clear flex size-7 items-center justify-center rounded-full" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {orderType === "delivery" ? (
                  <section>
                    <label
                      htmlFor="checkout-delivery-address"
                      className="modal-dark-label mb-1.5 block text-xs font-semibold"
                    >
                      {t("deliveryAddressLabel")}{" "}
                      <span className="modal-dark-muted font-normal">
                        ({t("fieldOptional")})
                      </span>
                    </label>
                    <div className="relative">
                      <input
                        id="checkout-delivery-address"
                        type="text"
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        className="h-11 w-full modal-dark-input rounded-xl pe-11 ps-3 text-base outline-none transition sm:text-sm"
                        autoComplete="street-address"
                        maxLength={160}
                        placeholder={t("deliveryAddressPlaceholder")}
                      />
                      {deliveryAddress ? (
                        <button
                          type="button"
                          className="pos-field-clear absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl"
                          aria-label={t("clear")}
                          onClick={() => setDeliveryAddress("")}
                        >
                          <span className="modal-dark-clear flex size-7 items-center justify-center rounded-full" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <section>
                  <p className="modal-dark-label mb-1.5 text-xs font-semibold">
                    {t("discount")}
                  </p>
                  <div className="flex gap-1.5">
                    <div className="modal-dark-seg grid shrink-0 grid-cols-2 gap-0.5 rounded-lg p-0.5">
                      {(["percent", "fixed"] as const).map((dt) => (
                        <button
                          key={dt}
                          type="button"
                          className={`modal-dark-seg-btn h-11 min-w-11 rounded-md px-2 text-sm font-extrabold transition ${
                            discountType === dt ? "is-active" : ""
                          }`}
                          onClick={() => {
                            setDiscountType(dt);
                            setDiscountValue(0);
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
                        value={discountValue || ""}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^\d.]/g, "");
                          const n = Math.max(0, Number(raw) || 0);
                          const capped =
                            discountType === "percent"
                              ? Math.min(100, n)
                              : Math.min(subtotal, n);
                          setDiscountValue(capped);
                        }}
                        className="h-full min-h-11 w-full modal-dark-input rounded-xl pe-11 ps-3 text-base tabular-nums outline-none transition sm:text-sm"
                        dir="ltr"
                        aria-label={t("discount")}
                      />
                      {discountValue ? (
                        <button
                          type="button"
                          className="pos-field-clear absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl"
                          aria-label={t("clear")}
                          onClick={() => setDiscountValue(0)}
                        >
                          <span className="modal-dark-clear flex size-7 items-center justify-center rounded-full" aria-hidden>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {discountAmount > 0 ? (
                    <p className="modal-dark-gold mt-1 text-xs font-bold" dir="ltr">
                      {"−"}
                      {formatPkr(discountAmount)}
                    </p>
                  ) : null}
                  {!discountAllowed ? (
                    <p className="mt-1 text-[10px] leading-snug text-red-400">
                      {t("staffDiscountLimit")}
                    </p>
                  ) : null}
                </section>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
                {/* Left — order type (espresso rail, tall option cards) */}
                <div className="pos-rail flex shrink-0 flex-col border-b px-3 py-3 sm:px-3.5 lg:w-[11rem] lg:border-b-0 lg:border-e lg:py-4">
                  <p className="pos-rail-title mb-3 shrink-0 text-center">{t("orderType")}</p>
                  <div className="grid grid-cols-3 gap-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-2.5">
                    {(["dine-in", "takeaway", "delivery"] as const).map((ot) => {
                      const selected = orderType === ot;
                      const label =
                        ot === "dine-in" ? t("dineIn") : ot === "takeaway" ? t("takeaway") : t("delivery");
                      return (
                        <button
                          key={ot}
                          type="button"
                          aria-pressed={selected}
                          className={`pos-opt min-h-14 gap-2 px-2 py-2.5 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-2.5 lg:py-3 ${
                            selected ? "is-active" : ""
                          }`}
                          onClick={() => {
                            setOrderType(ot);
                            if (ot !== "dine-in") setTableNumber("");
                            if (ot !== "delivery") setDeliveryAddress("");
                          }}
                        >
                          {selected ? (
                            <span className="pos-opt-check" aria-hidden>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                          ) : null}
                          <span
                            className="pos-opt-icon size-9 text-[1.25rem] leading-none lg:size-16 lg:text-[2rem]"
                            aria-hidden
                          >
                            <OptIcon kind={ot} />
                          </span>
                          <span className="text-xs font-bold tracking-wide lg:text-sm">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Center — receipt preview: the exact document that prints (only this scrolls) */}
                <div className="pos-receipt-stage order-last min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-3 lg:order-none sm:px-3">
                  <ReceiptPreview html={previewReceiptHtml} title={t("receiptPreview")} />
                </div>

                {/* Right — payment (espresso rail, matches order type) */}
                <div className="pos-rail flex shrink-0 flex-col border-b px-3 py-3 sm:px-3.5 lg:w-[11.5rem] lg:border-b-0 lg:border-s lg:py-4">
                  <p className="pos-rail-title mb-3 shrink-0 text-center">{t("paymentMethod")}</p>
                  <div className="grid grid-cols-3 gap-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-2.5">
                    {(["cash", "card", "digital"] as const).map((pm) => {
                      const selected = paymentMethod === pm;
                      const label = pm === "cash" ? t("cash") : pm === "card" ? t("card") : t("digital");
                      return (
                        <button
                          key={pm}
                          type="button"
                          aria-pressed={selected}
                          title={pm === "digital" ? t("digitalHint") : label}
                          className={`pos-opt min-h-14 gap-2 px-2 py-2.5 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-2.5 lg:py-3 ${
                            selected ? "is-active" : ""
                          }`}
                          onClick={() => setPaymentMethod(pm)}
                        >
                          {selected ? (
                            <span className="pos-opt-check" aria-hidden>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                          ) : null}
                          <span
                            className="pos-opt-icon size-9 text-[1.25rem] leading-none lg:size-16 lg:text-[2rem]"
                            aria-hidden
                          >
                            <OptIcon kind={pm} />
                          </span>
                          <span className="text-xs font-bold tracking-wide lg:text-sm">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
            </div>

            {/* Footer — print toggle · total · actions (espresso, bookends the header) */}
            <div className="pos-foot shrink-0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-5 sm:py-3.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <label className="me-auto flex cursor-pointer items-center gap-2.5 select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoPrint}
                    onClick={() => setAutoPrint((v) => !v)}
                    className={`pos-switch relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${autoPrint ? "is-on" : ""}`}
                  >
                    <span className={`inline-block size-[1.125rem] rounded-full bg-white shadow transition-transform ${autoPrint ? "translate-x-[1.375rem] rtl:-translate-x-[1.375rem]" : "translate-x-[0.1875rem] rtl:-translate-x-[0.1875rem]"}`} />
                  </button>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500" aria-hidden><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                  <span className="text-sm font-medium text-stone-700">{t("printBill")}</span>
                </label>
                <div className="text-end">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {t("total")}
                  </p>
                  <p className="pos-foot-total text-2xl leading-tight sm:text-[1.75rem]" dir="ltr">
                    {formatPkr(total)}
                  </p>
                </div>
                <div className="grid w-full grid-cols-[2fr_3fr] gap-2 sm:flex sm:w-auto sm:gap-3">
                  <button
                    type="button"
                    className="btn btn-ghost min-h-12 sm:min-w-[7.5rem] sm:px-6"
                    disabled={busy}
                    onClick={() => closeCheckoutPreview()}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn pos-cta min-h-12 text-base sm:min-w-[10rem] sm:px-8"
                    disabled={
                      isCartEmpty(cart) ||
                      !discountAllowed ||
                      !queueSnap.counterReady
                    }
                    onClick={() => void checkout()}
                  >
                    {t("checkout")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(checkoutModalError)}
        error
        focusConfirm
        title={t("checkoutFailTitle")}
        message={checkoutModalError ?? ""}
        confirmLabel={t("ok")}
        cancelLabel={t("recentOrders")}
        onDismiss={() => setCheckoutModalError(null)}
        onCancel={() => {
          setCheckoutModalError(null);
          void openRecentOrders();
        }}
        onConfirm={() => setCheckoutModalError(null)}
      />

      <ConfirmDialog
        open={confirmClearCart}
        title={t("clearCartTitle")}
        message={t("confirmClearCart")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        danger
        focusConfirm
        onCancel={() => setConfirmClearCart(false)}
        onConfirm={() => {
          setCart([]);
          setNoteEditKey(null);
          setDiscountValue(0);
          setConfirmClearCart(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(logoutBlocked)}
        title={t(logoutBlocked?.kind === "stock" ? "logoutStockTitle" : "logoutOfflineTitle")}
        message={t(logoutBlocked?.kind === "stock" ? "logoutStockBody" : "logoutOfflineBody")}
        confirmLabel={t("ok")}
        cancelLabel={t("ok")}
        hideCancel
        focusConfirm
        onCancel={() => setLogoutBlocked(null)}
        onConfirm={() => setLogoutBlocked(null)}
      />

      <ConfirmDialog
        open={confirmLogout}
        title={t("confirmLogoutTitle")}
        message={
          logoutFailed > 0
            ? t("logoutFailedWarning").replace("{n}", String(logoutFailed))
            : t("confirmLogout")
        }
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={loggingOut}
        danger
        onCancel={() => {
          if (!loggingOut) setConfirmLogout(false);
        }}
        onConfirm={() => void doLogout()}
      />

      {recentOpen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recent-orders-title"
        >
          <button
            type="button"
            className="pos-scrim absolute inset-0"
            aria-label={t("close")}
            onClick={() => setRecentOpen(false)}
          />
          <div className="pos-dialog relative z-10 flex max-h-[min(90dvh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:rounded-2xl">
            <div className="modal-dark-head flex shrink-0 items-center justify-between gap-3 px-4 pb-3.5 pt-4 sm:px-5">
              <div>
                <p className="modal-dark-gold text-[11px] font-bold uppercase tracking-[0.14em]">
                  {t("orders")}
                </p>
                <h2 id="recent-orders-title" className="pos-dialog-title text-xl">{t("recentOrders")}</h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRecentOpen(false)}
              >
                {t("close")}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {recentLoading ? (
                <p className="py-8 text-center text-sm text-[var(--muted)]">{t("loading")}</p>
              ) : recentOrders.length === 0 && localPendingOrders.length === 0 ? (
                <p className="pos-menu-note">
                  {t("noOrders")}
                </p>
              ) : (
                <ul className="space-y-2 sm:space-y-2.5">
                  {(() => {
                    const pendingIds = new Set(localPendingOrders.map((o) => o.id));
                    const merged = [
                      ...localPendingOrders,
                      ...recentOrders.filter((o) => !pendingIds.has(o.id)),
                    ]
                      .filter((o) => !deletedOrderIds.has(o.id))
                      .sort((a, b) => (b.orderNumber ?? 0) - (a.orderNumber ?? 0));
                    return merged.map((o) => {
                      const needsSync = pendingIds.has(o.id) || mutationOrderIds.has(o.id);
                      return (
                        <li key={o.id}>
                          <OrderListCard
                            order={o}
                            dense
                            onClick={() => {
                              setSelectedOrder(o);
                              setRecentOpen(false);
                            }}
                            badge={needsSync ? (
                              <span
                                className="block h-2 w-2 rounded-full bg-amber-400"
                                title={t("recentPendingLocal")}
                                aria-label={t("recentPendingLocal")}
                              />
                            ) : undefined}
                          />
                        </li>
                      );
                    });
                  })()}
                </ul>
              )}
              {!recentLoading ? (
                <PosLogsLink entityType="order" onClick={() => setOrderLogsOpen(true)} className="mt-4" />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {orderLogsOpen && branchId && profile ? (
        <PosActivityLog
          entityType="order"
          branchId={branchId}
          branchName={branches.find((b) => b.id === branchId)?.name}
          user={profile}
          settings={settings}
          onClose={() => setOrderLogsOpen(false)}
        />
      ) : null}

      {expensesOpen && profile && branchId ? (
        <PosExpensesSheet
          branchId={branchId}
          user={profile}
          settings={settings}
          onClose={() => setExpensesOpen(false)}
        />
      ) : null}

      {inventoryOpen && profile && branchId ? (
        <PosInventorySheet
          branchId={branchId}
          branchName={branches.find((b) => b.id === branchId)?.name}
          user={profile}
          settings={settings}
          onClose={() => setInventoryOpen(false)}
        />
      ) : null}

      {reportOpen && branchId && profile ? (
        <PosDayReport
          branchId={branchId}
          user={profile}
          branchName={branches.find((b) => b.id === branchId)?.name}
          settings={settings}
          onClose={() => setReportOpen(false)}
          onOpenOrder={(o) => setSelectedOrder(o)}
          itemImage={(productId, name) => {
            const product = products.find((p) => p.id === productId);
            const cat = product ? categoryMap.get(product.categoryId) : undefined;
            return resolveProductImage(product?.imageUrl, name, cat?.name);
          }}
        />
      ) : null}

      {selectedOrder && profile ? (
        <OrderDetailSheet
          order={selectedOrder}
          user={profile}
          settings={settings}
          catalogProducts={products}
          branchName={
            selectedOrder.branchName ||
            branches.find((b) => b.id === selectedOrder.branchId)?.name
          }
          onClose={() => setSelectedOrder(null)}
          onSaved={(o) => {
            if (o.status === "cancelled") {
              setLocalPendingOrders((list) => list.filter((x) => x.id !== o.id));
            } else {
              setLocalPendingOrders((list) => list.map((x) => (x.id === o.id ? o : x)));
            }
            setRecentOrders((list) => list.map((x) => (x.id === o.id ? o : x)));
            setMutationOrderIds((s) => new Set(s).add(o.id));
            if (lastOrder?.id === o.id) setLastOrder(o);
          }}
          onDeleted={(id) => {
            setLocalPendingOrders((list) => list.filter((x) => x.id !== id));
            setRecentOrders((list) => list.filter((x) => x.id !== id));
            setDeletedOrderIds((s) => new Set(s).add(id));
            if (lastOrder?.id === id) setLastOrder(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default function PosPage() {
  usePosThemeScope();
  return (
    <RequireAuth roles={["owner", "counter"]}>
      <BranchGate>
        <PosApp />
      </BranchGate>
    </RequireAuth>
  );
}

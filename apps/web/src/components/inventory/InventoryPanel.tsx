"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AppUser, Category, InventoryItem, Product, StockMovement, StockUnit } from "@bravobites/domain";
import {
  STOCK_UNITS,
  canManageInventory,
  formatOrderDateTime,
  inventoryItemName,
  movementDelta,
  stockKey,
  stockLevel,
  suggestedStockUnits,
  type StockLevel,
} from "@bravobites/domain";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { MessageKey } from "@/i18n/dictionaries";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { unitLabelKey } from "@/lib/stock-labels";
import { usePendingStock, withPendingStock } from "@/lib/use-pending-stock";
import {
  deleteInventoryItem,
  onCategoriesSnapshot,
  onInventorySnapshot,
  onProductsSnapshot,
  onStockMovementsSnapshot,
  recordStockChange,
  saveInventoryItem,
} from "@/lib/firestore";


type Filter = "all" | StockLevel;
type ChangeType = "purchase" | "waste" | "adjustment";

const LEVEL_ORDER: Record<StockLevel, number> = { out: 0, low: 1, ok: 2 };

const LEVEL_STYLE: Record<StockLevel, { tile: string; pill: string; bar: string }> = {
  ok: { tile: "bg-emerald-50 text-emerald-700", pill: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-500" },
  low: { tile: "bg-amber-50 text-amber-700", pill: "bg-amber-100 text-amber-800 dark:bg-[rgba(245,158,11,0.2)]", bar: "bg-amber-500" },
  out: { tile: "bg-red-50 text-red-700", pill: "bg-red-100 text-red-800", bar: "bg-red-500" },
};

const NUM = { fontFamily: "var(--font-en), system-ui, sans-serif" } as const;

function Icon({ d, size = 18 }: { d: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

const ICONS = {
  box: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  recount: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  edit: <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  trash: <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>,
  more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
};

/**
 * Stock of a branch's menu items — the admin Inventory page and the POS
 * Inventory sheet show this same panel. Every write is local first (works
 * offline, syncs itself); rows not on the server yet carry a yellow dot.
 */
export function InventoryPanel({
  branchId,
  user,
  toolbarStart,
  footer,
}: {
  branchId: string;
  user: AppUser;
  /** Extra control before the search (e.g. the owner's branch picker). */
  toolbarStart?: ReactNode;
  /** Under the list (activity-log link). */
  footer?: ReactNode;
}) {
  const { t } = useLocale();
  const canManage = canManageInventory(user);

  const [cloudItems, setItems] = useState<InventoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [queryText, setQueryText] = useState("");
  // This PC's sales / cancels not on the cloud yet count at once ("Waiting to sync").
  const pending = usePendingStock({ branchIds: [branchId], inventory: cloudItems });
  const items = useMemo(() => withPendingStock(cloudItems, pending.byItem), [cloudItems, pending.byItem]);

  const [change, setChange] = useState<{ item: InventoryItem; type: ChangeType } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [historyOf, setHistoryOf] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setItems([]);
    return onInventorySnapshot(
      branchId,
      (inv) => {
        setItems(inv.filter((i) => !i.productId.startsWith("manual_") || canManage));
        setLoaded(true);
        setError(null);
      },
      (err) => {
        setError(mapFirebaseError(err));
        setLoaded(true);
      },
    );
  }, [branchId, canManage]);

  // Menu stays live — a drink added on the Menu page shows in the picker at once.
  useEffect(() => {
    const unsubs = [
      onProductsSnapshot("", (p) => setProducts(p.filter((x) => x.isActive))),
      onCategoriesSnapshot("", (c) =>
        setCategories([...c].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const counts = useMemo(() => {
    const c = { all: items.length, ok: 0, low: 0, out: 0 };
    for (const i of items) c[stockLevel(i)] += 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return items
      .filter((i) => filter === "all" || stockLevel(i) === filter)
      .filter((i) => !q || inventoryItemName(i).toLowerCase().includes(q))
      .sort(
        (a, b) =>
          LEVEL_ORDER[stockLevel(a)] - LEVEL_ORDER[stockLevel(b)] ||
          inventoryItemName(a).localeCompare(inventoryItemName(b)),
      );
  }, [items, filter, queryText]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteInventoryItem({ item: deleting, user });
      setDeleting(null);
    } catch (e) {
      setError(mapFirebaseError(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  const tiles: { key: Filter; label: string; count: number; tone: string }[] = [
    { key: "all", label: t("invTracked"), count: counts.all, tone: "text-[var(--ink)]" },
    { key: "ok", label: t("invHealthy"), count: counts.ok, tone: "text-emerald-700" },
    { key: "low", label: t("lowStock"), count: counts.low, tone: "text-amber-700" },
    { key: "out", label: t("outOfStock"), count: counts.out, tone: "text-red-700" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary — each tile is also the filter */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" role="group" aria-label={t("inventory")}>
        {tiles.map((tile) => {
          const active = filter === tile.key;
          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(active && tile.key !== "all" ? "all" : tile.key)}
              className={`min-h-[4.5rem] rounded-2xl border px-4 py-3 text-start transition ${
                active
                  ? "border-[var(--gold)] bg-[#fffaf2] dark:bg-[rgba(240,176,40,0.12)] shadow-[0_0_0_3px_rgba(197,138,14,0.14)]"
                  : "border-[var(--border)] bg-white hover:border-[var(--gold)]/40"
              }`}
            >
              <span className={`block text-2xl font-extrabold tabular-nums leading-none ${tile.tone}`} style={NUM}>
                {tile.count}
              </span>
              <span className="mt-1.5 block text-xs font-semibold text-stone-600">{tile.label}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {toolbarStart}
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">{t("invSearch")}</span>
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-stone-400">
            <Icon d={ICONS.search} size={16} />
          </span>
          <input
            className="input input-with-icon min-h-11 text-[15px]"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder={t("invSearch")}
            autoComplete="off"
          />
        </label>
        {canManage ? (
          <button type="button" className="btn min-h-11 gap-2 px-4 text-sm" onClick={() => setAdding(true)}>
            <Icon d={ICONS.plus} size={16} />
            {t("addInventoryItem")}
          </button>
        ) : null}
      </div>

      {error ? <div className="toast-error">{error}</div> : null}

      {/* List */}
      {!loaded ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-[4.75rem] animate-pulse rounded-2xl bg-stone-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f6e6d4] text-[var(--gold-deep)]">
            <Icon d={ICONS.box} size={22} />
          </span>
          <p className="mt-3 text-base font-bold text-[var(--ink)]">{t("invEmptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{t("invEmptyHint")}</p>
          {canManage ? (
            <button type="button" className="btn mt-4 min-h-11 gap-2 px-5 text-sm" onClick={() => setAdding(true)}>
              <Icon d={ICONS.plus} size={16} />
              {t("addInventoryItem")}
            </button>
          ) : null}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-8 text-center text-sm text-stone-600">
          {t("invNoMatch")}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <StockRow
              key={item.id}
              item={item}
              canManage={canManage}
              onChange={(type) => setChange({ item, type })}
              onHistory={() => setHistoryOf(item)}
              onEdit={() => setEditing(item)}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </ul>
      )}

      {footer}

      {change ? (
        <StockChangeDialog
          // Live row: a sale syncing while the dialog is open updates "Now".
          item={items.find((i) => i.id === change.item.id) ?? change.item}
          initialType={change.type}
          user={user}
          onClose={() => setChange(null)}
        />
      ) : null}

      {adding ? (
        <AddItemsDialog
          branchId={branchId}
          user={user}
          products={products}
          categories={categories}
          tracked={new Set(items.map((i) => stockKey(i.productId, i.variationId)))}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {editing ? <EditItemDialog item={editing} user={user} onClose={() => setEditing(null)} /> : null}

      {historyOf ? <HistoryDialog item={historyOf} onClose={() => setHistoryOf(null)} /> : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`${t("confirmDeleteInventory")}${deleting ? ` — ${inventoryItemName(deleting)}` : ""}`}
        message={t("invDeleteBody")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        busy={deleteBusy}
        danger
        onCancel={() => !deleteBusy && setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

/* ── One stock row ── */

function StockRow({
  item,
  canManage,
  onChange,
  onHistory,
  onEdit,
  onDelete,
}: {
  item: InventoryItem;
  canManage: boolean;
  onChange: (type: ChangeType) => void;
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const level = stockLevel(item);
  const style = LEVEL_STYLE[level];
  const levelLabel = level === "out" ? t("outOfStock") : level === "low" ? t("lowStock") : t("invHealthy");

  return (
    <li className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-white py-3 pe-2 ps-4 shadow-[0_1px_2px_rgba(42,20,14,0.04)] sm:pe-3">
      <span className={`absolute inset-y-0 start-0 w-1 ${style.bar}`} aria-hidden />
      <span className={`relative hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:flex ${style.tile}`}>
        <Icon d={ICONS.box} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[15px] font-bold text-[var(--ink)]">{item.productName}</span>
          {item.variationLabel ? (
            <span className="rounded-md bg-[#f6e6d4] px-1.5 py-0.5 text-[11px] font-bold text-[var(--gold-deep)]">
              {item.variationLabel}
            </span>
          ) : null}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${style.pill}`}>{levelLabel}</span>
          <span>
            {t("invAlertAt")} ≤ <span className="tabular-nums" style={NUM}>{item.lowStockThreshold}</span>
          </span>
          {item.description ? <span className="truncate">· {item.description}</span> : null}
          {item.pendingSync ? (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
              {t("invPending")}
            </span>
          ) : null}
        </p>
      </div>
      <div className="shrink-0 text-end">
        <p
          className={`text-2xl font-extrabold leading-none tabular-nums ${level === "out" ? "text-red-700" : "text-[var(--ink)]"}`}
          style={NUM}
          dir="ltr"
        >
          {item.currentStock}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-stone-500">{t(unitLabelKey[item.unit])}</p>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 px-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100 sm:px-3"
            onClick={() => onChange("purchase")}
            aria-label={`${t("invReceive")} — ${inventoryItemName(item)}`}
            title={t("invReceive")}
          >
            <Icon d={ICONS.plus} size={16} />
            <span className="hidden md:inline">{t("invReceive")}</span>
          </button>
          <button
            type="button"
            className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 sm:px-3"
            onClick={() => onChange("waste")}
            aria-label={`${t("wasteStock")} — ${inventoryItemName(item)}`}
            title={t("wasteStock")}
          >
            <Icon d={ICONS.minus} size={16} />
            <span className="hidden md:inline">{t("wasteStock")}</span>
          </button>
          <RowMenu
            label={inventoryItemName(item)}
            actions={[
              { key: "recount", label: t("invRecount"), icon: ICONS.recount, onClick: () => onChange("adjustment") },
              { key: "history", label: t("stockMovements"), icon: ICONS.history, onClick: onHistory },
              { key: "edit", label: t("edit"), icon: ICONS.edit, onClick: onEdit },
              { key: "delete", label: t("delete"), icon: ICONS.trash, onClick: onDelete, danger: true },
            ]}
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-500 transition hover:bg-stone-100"
          onClick={onHistory}
          aria-label={t("stockMovements")}
          title={t("stockMovements")}
        >
          <Icon d={ICONS.history} />
        </button>
      )}
    </li>
  );
}

const MENU_W = 192;

/**
 * Row actions. The menu opens on a layer above the page (fixed position), so
 * no list / sheet scroll area can cut it off; it opens upward near the bottom.
 */
function RowMenu({
  label,
  actions,
}: {
  label: string;
  actions: { key: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean }[];
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  function toggle() {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const height = actions.length * 44 + 8;
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - 6 - height) : below;
    const rtl = document.documentElement.dir === "rtl";
    const left = Math.min(Math.max(8, rtl ? r.left : r.right - MENU_W), window.innerWidth - MENU_W - 8);
    setPos({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const close = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`flex h-11 w-10 items-center justify-center rounded-xl transition hover:bg-stone-100 ${open ? "bg-stone-100 text-[var(--ink)]" : "text-stone-500"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
      >
        <Icon d={ICONS.more} />
      </button>
      {pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, left: pos.left, width: MENU_W }}
              className="fixed z-[80] overflow-hidden rounded-xl border border-[var(--border)] bg-white py-1 shadow-[0_12px_32px_rgba(42,20,14,0.18)]"
            >
              {actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  className={`flex min-h-11 w-full items-center gap-3 px-3.5 text-start text-sm font-semibold transition focus:outline-none ${
                    a.danger ? "text-red-700 hover:bg-red-50 focus:bg-red-50" : "text-[var(--ink)] hover:bg-stone-50 focus:bg-stone-50"
                  }`}
                  onClick={() => {
                    setPos(null);
                    a.onClick();
                  }}
                >
                  <Icon d={a.icon} size={16} />
                  {a.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ── Dialog shell ── */

function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useLocale();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]" aria-label={t("close")} onClick={onClose} />
      <div
        className={`relative z-10 flex w-full flex-col overflow-hidden rounded-t-3xl bg-[#fff4e8] shadow-[0_25px_80px_rgba(0,0,0,0.4)] sm:rounded-3xl ${
          // Wide (the picker): one fixed size, so it doesn't jump as you filter or pick.
          wide ? "h-[min(94dvh,44rem)] sm:max-w-2xl" : "max-h-[min(94dvh,46rem)] sm:max-w-md"
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] bg-white px-5 pb-3.5 pt-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-[var(--ink)]">{title}</h3>
            {subtitle ? <div className="mt-0.5 text-sm text-stone-600">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            className="-me-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100"
            onClick={onClose}
            aria-label={t("close")}
          >
            <Icon d={ICONS.close} size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 gap-2 border-t border-[var(--border)] bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold uppercase tracking-[0.08em] text-stone-600">
      {children}
    </label>
  );
}

/* ── Receive / waste / recount ── */

function StockChangeDialog({
  item,
  initialType,
  user,
  onClose,
}: {
  item: InventoryItem;
  initialType: ChangeType;
  user: AppUser;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [type, setType] = useState<ChangeType>(initialType);
  const [qty, setQty] = useState(initialType === "adjustment" ? String(Math.max(0, item.currentStock)) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [type]);

  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const after = type === "purchase" ? item.currentStock + n : type === "waste" ? item.currentStock - n : n;
  const valid = qty !== "" && (type === "adjustment" ? after !== item.currentStock : n > 0);
  const unit = t(unitLabelKey[item.unit]);

  const tabs: { key: ChangeType; label: string }[] = [
    { key: "purchase", label: t("invReceive") },
    { key: "waste", label: t("wasteStock") },
    { key: "adjustment", label: t("invRecount") },
  ];

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await recordStockChange({ item, movementType: type, quantity: n, notes, user });
      onClose();
    } catch (e) {
      setError(mapFirebaseError(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={item.productName}
      subtitle={item.variationLabel}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost min-h-12 flex-1" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="button" className="btn min-h-12 flex-[2]" onClick={() => void save()} disabled={!valid || busy}>
            {busy ? t("saving") : t("save")}
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={type === tab.key}
              className={`min-h-10 rounded-lg text-sm font-bold transition ${
                type === tab.key ? "bg-white text-[var(--ink)] shadow-sm" : "text-stone-600 hover:text-[var(--ink)]"
              }`}
              onClick={() => {
                setType(tab.key);
                setQty(tab.key === "adjustment" ? String(Math.max(0, item.currentStock)) : "");
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="text-sm text-stone-600">
          {type === "purchase" ? t("invReceiveHint") : type === "waste" ? t("invWasteHint") : t("invRecountHint")}
        </p>

        <div className="flex items-stretch gap-2">
          <button
            type="button"
            className="flex w-14 items-center justify-center rounded-xl border border-[var(--border)] bg-white text-[var(--ink)] transition hover:bg-stone-50 disabled:opacity-40"
            onClick={() => setQty(String(Math.max(0, n - 1)))}
            disabled={n <= 0}
            aria-label="−1"
          >
            <Icon d={ICONS.minus} />
          </button>
          <input
            ref={inputRef}
            className="input min-h-14 flex-1 text-center text-2xl font-extrabold tabular-nums"
            style={NUM}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label={type === "adjustment" ? t("targetStock") : t("stockQuantity")}
            dir="ltr"
          />
          <button
            type="button"
            className="flex w-14 items-center justify-center rounded-xl border border-[var(--border)] bg-white text-[var(--ink)] transition hover:bg-stone-50"
            onClick={() => setQty(String(n + 1))}
            aria-label="+1"
          >
            <Icon d={ICONS.plus} />
          </button>
        </div>

        {type !== "adjustment" ? (
          <div className="flex flex-wrap gap-2">
            {[6, 12, 24, 48].map((step) => (
              <button
                key={step}
                type="button"
                className="min-h-10 rounded-full border border-[var(--border)] bg-white px-4 text-sm font-bold tabular-nums text-[var(--ink)] transition hover:border-[var(--gold)]/50"
                style={NUM}
                onClick={() => setQty(String(n + step))}
              >
                +{step}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white px-4 py-3" role="status" aria-live="polite">
          <span className="text-sm text-stone-600">
            {t("invNow")}{" "}
            <b className="tabular-nums text-[var(--ink)]" style={NUM}>{item.currentStock}</b>
          </span>
          <span className="text-stone-400" aria-hidden>→</span>
          <span className="text-sm text-stone-600">
            {t("invAfter")}{" "}
            <b className={`text-lg tabular-nums ${after < 0 ? "text-red-700" : "text-[var(--ink)]"}`} style={NUM}>
              {after}
            </b>{" "}
            {unit}
          </span>
        </div>

        <div>
          <FieldLabel htmlFor="inv-notes">{t("stockNotes")}</FieldLabel>
          <input
            id="inv-notes"
            className="input min-h-11 w-full"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("invNotesPlaceholder")}
          />
        </div>
        {error ? <div className="toast-error">{error}</div> : null}
      </form>
    </Sheet>
  );
}

/* ── Add items from the menu ── */

type PickedItem = {
  key: string;
  productId: string;
  productName: string;
  variationId?: string;
  variationLabel?: string;
  categoryName: string;
  opening: string;
  unit: StockUnit;
};

function AddItemsDialog({
  branchId,
  user,
  products,
  categories,
  tracked,
  onClose,
}: {
  branchId: string;
  user: AppUser;
  products: Product[];
  categories: Category[];
  tracked: Set<string>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  /** 1: pick items · 2: their opening count, unit, alert. */
  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [picks, setPicks] = useState<PickedItem[]>([]);
  const [threshold, setThreshold] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  // Deals are left out — a deal's sale takes stock off the items inside it.
  const menu = useMemo(() => products.filter((p) => p.type !== "bundle"), [products]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (p: Product) =>
      !q || p.name.toLowerCase().includes(q) || p.variations.some((v) => v.label.toLowerCase().includes(q));
    const byCat = new Map<string, Product[]>();
    for (const p of menu) {
      if (cat !== "all" && p.categoryId !== cat) continue;
      if (!match(p)) continue;
      const list = byCat.get(p.categoryId) ?? [];
      list.push(p);
      byCat.set(p.categoryId, list);
    }
    const out: { id: string; name: string; products: Product[] }[] = [];
    for (const c of categories) {
      const list = byCat.get(c.id);
      if (list?.length) out.push({ id: c.id, name: c.name, products: list });
      byCat.delete(c.id);
    }
    const rest = [...byCat.values()].flat();
    if (rest.length) out.push({ id: "_other", name: t("other"), products: rest });
    return out;
  }, [menu, categories, cat, search, t]);

  const picked = new Set(picks.map((p) => p.key));

  function toggle(p: Product, v?: { id: string; label: string }) {
    const key = stockKey(p.id, v?.id);
    if (tracked.has(key)) return;
    if (picked.has(key)) {
      setPicks((list) => list.filter((x) => x.key !== key));
      return;
    }
    const categoryName = catName.get(p.categoryId) ?? "";
    const unit = suggestedStockUnits({ name: p.name, categoryName, variationLabel: v?.label })[0] ?? "pcs";
    setPicks((list) => [
      ...list,
      { key, productId: p.id, productName: p.name, variationId: v?.id, variationLabel: v?.label, categoryName, opening: "", unit },
    ]);
  }

  function setPick(key: string, patch: Partial<PickedItem>) {
    setPicks((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function save() {
    if (busy || picks.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const alertAt = Math.max(0, Math.floor(Number(threshold) || 0));
      for (const p of picks) {
        await saveInventoryItem({
          branchId,
          productId: p.productId,
          productName: p.productName,
          variationId: p.variationId,
          variationLabel: p.variationLabel,
          openingStock: Math.max(0, Math.floor(Number(p.opening) || 0)),
          lowStockThreshold: alertAt,
          unit: p.unit,
          user,
        });
      }
      onClose();
    } catch (e) {
      setError(mapFirebaseError(e));
      setBusy(false);
    }
  }

  const chip = (on: boolean, disabled: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-[15px] font-semibold transition ${
      disabled
        ? "cursor-not-allowed border-dashed border-[var(--border)] bg-stone-50 dark:bg-stone-800 text-stone-400 dark:text-stone-500"
        : on
          ? "border-[var(--gold)] bg-[#fff3d6] dark:bg-[rgba(240,176,40,0.16)] text-[var(--ink)] shadow-[0_0_0_2px_rgba(197,138,14,0.18)]"
          : "border-[var(--border)] bg-white dark:bg-stone-800 text-[var(--ink)] hover:border-[var(--gold)]/50"
    }`;

  const n = picks.length;
  const footer =
    step === 1 ? (
      <>
        <button type="button" className="btn btn-ghost min-h-12 flex-1" onClick={onClose}>
          {t("cancel")}
        </button>
        <button type="button" className="btn min-h-12 flex-[2] gap-2" onClick={() => setStep(2)} disabled={n === 0}>
          {n === 0 ? t("invPickFirst") : t("invNextN").replace("{n}", String(n))}
          {n > 0 ? <span aria-hidden>→</span> : null}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="btn btn-ghost min-h-12 flex-1" onClick={() => setStep(1)} disabled={busy}>
          ← {t("invBack")}
        </button>
        <button type="button" className="btn min-h-12 flex-[2]" onClick={() => void save()} disabled={busy || n === 0}>
          {busy ? t("saving") : t("invAddN").replace("{n}", String(n))}
        </button>
      </>
    );

  return (
    <Sheet
      wide
      title={step === 1 ? t("invPickTitle") : t("invSetCountsTitle")}
      subtitle={
        <span className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#f6e6d4] dark:bg-[rgba(240,176,40,0.16)] px-2 py-0.5 text-[11px] font-bold text-[var(--gold-deep)]">
            {t("invStepOf").replace("{n}", String(step))}
          </span>
          {step === 1 ? t("invPickHint") : t("invSetCountsHint")}
        </span>
      }
      onClose={onClose}
      footer={footer}
    >
      {step === 1 ? (
        <div className="space-y-4">
          <div className="space-y-2.5">
            <label className="relative block">
              <span className="sr-only">{t("searchProductPlaceholder")}</span>
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-stone-400">
                <Icon d={ICONS.search} size={16} />
              </span>
              <input
                className="input input-with-icon min-h-11 text-[15px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchProductPlaceholder")}
                autoComplete="off"
                autoFocus
              />
            </label>
            {/* Every category in view — wraps instead of scrolling off the edge. */}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("category")}>
              {[{ id: "all", name: t("invAllCategories") }, ...categories.filter((c) => menu.some((p) => p.categoryId === c.id))].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={cat === c.id}
                  className={`inv-cat-chip min-h-9 rounded-full px-3 text-[13px] font-bold transition ${
                    cat === c.id ? "bg-[#2a140e] text-[#fff4e8] dark:bg-[var(--gold)] dark:text-[#2a140e]" : "bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 ring-1 ring-[var(--border)] hover:ring-[var(--gold)]/50"
                  }`}
                  onClick={() => setCat(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-600 dark:text-stone-400">{t("invNoMatch")}</p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => {
                const sized = g.products.filter((p) => p.variations.length > 0);
                const plain = g.products.filter((p) => p.variations.length === 0);
                return (
                  <section key={g.id}>
                    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-500">{g.name}</h4>
                    <div className="space-y-2">
                      {sized.map((p) => (
                        <div key={p.id} className="rounded-xl border border-[var(--border)] bg-white dark:bg-stone-800/60 p-3">
                          <p className="mb-2 text-sm font-bold text-[var(--ink)]">
                            {p.name}
                            <span className="ms-2 text-xs font-medium text-stone-500">· {t("invSizes")}</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {p.variations.map((v) => {
                              const key = stockKey(p.id, v.id);
                              const isTracked = tracked.has(key);
                              const on = picked.has(key);
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  aria-pressed={on}
                                  disabled={isTracked}
                                  className={chip(on, isTracked)}
                                  onClick={() => toggle(p, v)}
                                >
                                  {on ? <Icon d={ICONS.check} size={14} /> : null}
                                  {v.label}
                                  {isTracked ? <span className="text-[11px] font-medium">· {t("invTrackedTag")}</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {plain.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {plain.map((p) => {
                            const key = stockKey(p.id);
                            const isTracked = tracked.has(key);
                            const on = picked.has(key);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                aria-pressed={on}
                                disabled={isTracked}
                                className={chip(on, isTracked)}
                                onClick={() => toggle(p)}
                              >
                                {on ? <Icon d={ICONS.check} size={14} /> : null}
                                {p.name}
                                {isTracked ? <span className="text-[11px] font-medium">· {t("invTrackedTag")}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2">
            {picks.map((p) => {
              const suggested = suggestedStockUnits({ name: p.productName, categoryName: p.categoryName, variationLabel: p.variationLabel });
              const others = STOCK_UNITS.filter((u) => !suggested.includes(u));
              const label = `${p.productName}${p.variationLabel ? ` · ${p.variationLabel}` : ""}`;
              return (
                <li key={p.key} className="rounded-2xl border border-[var(--border)] bg-white dark:bg-stone-800/60 p-3.5">
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <p className="text-[15px] font-bold text-[var(--ink)]">
                      {p.productName}
                      {p.variationLabel ? (
                        <span className="ms-2 rounded-md bg-[#f6e6d4] dark:bg-[rgba(240,176,40,0.16)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--gold-deep)]">{p.variationLabel}</span>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      className="-me-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 dark:hover:bg-stone-700 hover:text-[var(--ink)]"
                      onClick={() => setPicks((list) => list.filter((x) => x.key !== p.key))}
                      aria-label={`${t("delete")} — ${label}`}
                    >
                      <Icon d={ICONS.close} size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">{t("invOpeningStock")}</span>
                      <input
                        className="input min-h-11 text-center text-lg font-bold tabular-nums"
                        style={NUM}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        placeholder="0"
                        value={p.opening}
                        onChange={(e) => setPick(p.key, { opening: e.target.value })}
                        aria-label={`${t("invOpeningStock")} — ${p.productName} ${p.variationLabel ?? ""}`}
                        dir="ltr"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600">{t("unit")}</span>
                      <select
                        className="input min-h-11 text-[15px]"
                        value={p.unit}
                        onChange={(e) => setPick(p.key, { unit: e.target.value as StockUnit })}
                      >
                        <optgroup label={t("invSuggested")}>
                          {suggested.map((u) => (
                            <option key={u} value={u}>{t(unitLabelKey[u])}</option>
                          ))}
                        </optgroup>
                        <optgroup label={t("invMoreUnits")}>
                          {others.map((u) => (
                            <option key={u} value={u}>{t(unitLabelKey[u])}</option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white dark:bg-stone-800/60 p-3.5">
            <span>
              <span className="block text-sm font-bold text-[var(--ink)]">{t("lowStockThreshold")}</span>
              <span className="block text-xs text-stone-600 dark:text-stone-400">{t("invAlertHint")}</span>
            </span>
            <span className="w-24 shrink-0">
              <input
                className="input min-h-11 text-center text-lg font-bold tabular-nums"
                style={NUM}
                type="number"
                inputMode="numeric"
                min="0"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                dir="ltr"
              />
            </span>
          </label>
          {error ? <div className="toast-error">{error}</div> : null}
        </div>
      )}
    </Sheet>
  );
}

/* ── Edit details ── */

function EditItemDialog({ item, user, onClose }: { item: InventoryItem; user: AppUser; onClose: () => void }) {
  const { t } = useLocale();
  const [threshold, setThreshold] = useState(String(item.lowStockThreshold));
  const [unit, setUnit] = useState<StockUnit>(item.unit);
  const [note, setNote] = useState(item.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = suggestedStockUnits({ name: item.productName, variationLabel: item.variationLabel });

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveInventoryItem({
        previous: item,
        branchId: item.branchId,
        productId: item.productId,
        productName: item.productName,
        variationId: item.variationId,
        variationLabel: item.variationLabel,
        description: note,
        lowStockThreshold: Math.max(0, Math.floor(Number(threshold) || 0)),
        unit,
        user,
      });
      onClose();
    } catch (e) {
      setError(mapFirebaseError(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("editInventoryItem")}
      subtitle={inventoryItemName(item)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost min-h-12 flex-1" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="button" className="btn min-h-12 flex-[2]" onClick={() => void save()} disabled={busy}>
            {busy ? t("saving") : t("save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel>{t("unit")}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {[...suggested, ...STOCK_UNITS.filter((u) => !suggested.includes(u))].map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${
                  unit === u
                    ? "border-[var(--gold)] bg-[#fff3d6] dark:bg-[rgba(240,176,40,0.16)] text-[var(--ink)]"
                    : "border-[var(--border)] bg-white text-stone-700 hover:border-[var(--gold)]/50"
                }`}
                onClick={() => setUnit(u)}
              >
                {t(unitLabelKey[u])}
              </button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="inv-threshold">{t("lowStockThreshold")}</FieldLabel>
          <div className="w-32">
          <input
            id="inv-threshold"
            className="input min-h-11 tabular-nums"
            style={NUM}
            type="number"
            inputMode="numeric"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            dir="ltr"
          />
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="inv-desc">{t("description")}</FieldLabel>
          <input
            id="inv-desc"
            className="input min-h-11 w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
          />
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-stone-100 px-3 py-2.5 text-xs text-stone-600">
          <span className="mt-0.5 shrink-0 text-stone-500"><Icon d={ICONS.alert} size={14} /></span>
          {t("invEditHint")}
        </p>
        {error ? <div className="toast-error">{error}</div> : null}
      </div>
    </Sheet>
  );
}

/* ── History ── */

const MOVE_LABEL: Record<StockMovement["movementType"], MessageKey> = {
  purchase: "purchase",
  sale: "sale",
  waste: "waste",
  restock: "restock",
  adjustment: "adjustment",
};

function HistoryDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { t } = useLocale();
  const [rows, setRows] = useState<StockMovement[] | null>(null);

  useEffect(
    () =>
      onStockMovementsSnapshot(
        item.branchId,
        item.id,
        (m) => setRows(m),
        () => setRows([]),
      ),
    [item.branchId, item.id],
  );

  return (
    <Sheet title={t("stockMovements")} subtitle={inventoryItemName(item)} onClose={onClose}>
      {rows === null ? (
        <p className="py-8 text-center text-sm text-stone-600">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-600">{t("noOrders")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => {
            const d = movementDelta(m);
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white p-3">
                <span
                  className={`flex h-10 min-w-12 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-extrabold tabular-nums ${
                    d > 0 ? "bg-emerald-100 text-emerald-800" : d < 0 ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-700"
                  }`}
                  style={NUM}
                  dir="ltr"
                >
                  {d > 0 ? `+${d}` : d}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--ink)]">
                    {t(MOVE_LABEL[m.movementType])}
                    <span className="font-medium text-stone-500">
                      {" "}· <span className="tabular-nums" style={NUM} dir="ltr">{m.previousStock} → {m.newStock}</span>
                    </span>
                  </p>
                  <p className="truncate text-xs text-stone-600">
                    <span className="capitalize">{m.createdByName}</span>
                    {m.notes && !m.notes.startsWith("queue:") ? ` · ${m.notes}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-stone-500" dir="ltr">{formatOrderDateTime(m.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

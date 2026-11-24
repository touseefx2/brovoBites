"use client";

import { useMemo, useState } from "react";
import type { CartLine, Category, OrderItemPart, Product } from "@bravobites/domain";
import { CUSTOM_DEAL_ID, dealParts, formatPkr, money, packOfSize, splitPack } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";

/** What the editor hands back: the line's new deal fields. */
export type DealEditResult = {
  productId: string;
  productName: string;
  unitPrice: number;
  parts: OrderItemPart[];
  /** false = the deal as it was before (menu deal / the order's snapshot) — parts and price are that. */
  changed: boolean;
};

/** A cart line or a saved order line — what the editor reopens. */
export type DealLine = Pick<CartLine, "productId" | "productName" | "unitPrice" | "parts" | "changed">;

/** A size counted in pieces ("6 pcs" → n 6). */
type PackSize = { id: string; n: number; price: number };

type Row = {
  id: string;
  productId?: string;
  variationId?: string;
  /** Name without the pieces / size suffix (that is added by rowLabel). */
  label: string;
  qty: number;
  noStock?: boolean;
  /** null = part of the deal (paid by the deal price); else this row's price (all its qty). */
  priceText: string | null;
  /** Menu price of one (of a full pack for pack rows) — the row's price follows it until typed. */
  menuPrice?: number;
  priceTouched?: boolean;
  /**
   * Pack item ("Nuggets (6 pcs)" or "6 pcs" / "12 pcs" sizes): pieces in a
   * full pack. Then `qty` is loose pieces and the printed name says "(3 pcs)".
   */
  pack?: number;
  /** Pack item sold by sizes: its sizes, so stock and price use the right one. */
  packSizes?: PackSize[];
  /** Chosen size of a sized item ("Full", "1.5 Litre") — printed after the name. */
  sizeLabel?: string;
  /** Part of the deal: how many the deal comes with (put back to it; staff can't go above). */
  baseQty?: number;
};

/** Name as it shows / prints: pack rows say how many pieces, sized rows their size. */
function rowLabel(r: Row): string {
  const name = r.label.trim() || "Item";
  if (r.pack) return `${name} (${r.qty} pcs)`;
  if (r.sizeLabel) return `${name} (${r.sizeLabel})`;
  return name;
}

/** Row price from the menu: a size of exactly these pieces at its price, else by the piece (whole rupees). */
function autoPriceOf(r: Row, qty: number): number | null {
  if (r.menuPrice == null) return null;
  if (!r.pack) return money(r.menuPrice * qty);
  const exact = r.packSizes?.find((s) => s.n === qty);
  return exact ? money(exact.price) : Math.round((r.menuPrice * qty) / r.pack);
}

const DEFAULT_CUSTOM_NAME = "Custom Deal";

let rowSeq = 0;
const rowId = () => `r${++rowSeq}`;

const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");

/** Digits and one decimal point (same rule as the manual delivery charges box). */
function cleanPriceText(raw: string): string {
  const digits = raw.replace(/[^\d.]/g, "");
  const [int, ...rest] = digits.split(".");
  return rest.length ? `${int}.${rest.join("")}` : int!;
}

function priceOf(text: string | null): number {
  return text == null ? 0 : money(Math.max(0, Number(text) || 0));
}

/** Menu price of one: the item's price, or its cheapest size. */
function menuPriceOf(p: Product, variationId?: string): number {
  const v = variationId ? p.variations.find((x) => x.id === variationId) : undefined;
  if (v) return money(v.price);
  if (p.type === "sized" && p.variations.length > 0) {
    return money(Math.min(...p.variations.map((x) => x.price)));
  }
  return money(p.basePrice);
}

/**
 * How a menu item is counted in a deal: by pieces when its name ("Nuggets
 * (6 pcs)") or every size ("6 pcs" / "12 pcs") says pieces — the smallest
 * pack, at its price — else as whole items.
 */
function packOfProduct(p: Product): { base: string; pack: number; packPrice?: number; sizes?: PackSize[] } {
  const named = splitPack(p.name);
  if (named.pack) return { ...named, packPrice: menuPriceOf(p) };
  if (p.type === "sized" && p.variations.length > 0) {
    const sizes = p.variations.map((v) => ({ id: v.id, n: packOfSize(v.label), price: money(v.price) }));
    if (sizes.every((x) => x.n > 1)) {
      const smallest = sizes.reduce((a, b) => (b.n < a.n ? b : a));
      return { base: p.name, pack: smallest.n, packPrice: smallest.price, sizes };
    }
  }
  return { base: p.name, pack: 0 };
}

/** The menu item a deal part is: its link, or a menu item named exactly like it. */
function linkedProduct(part: OrderItemPart, menu: Product[]): Product | undefined {
  if (part.productId) return menu.find((m) => m.id === part.productId);
  const label = norm(part.label);
  const bare = part.pieces ? norm(splitPack(part.label).base) : label;
  return menu.find((m) => m.type !== "bundle" && (norm(m.name) === label || norm(splitPack(m.name).base) === bare && part.pieces));
}

/**
 * A saved deal part (menu snapshot, changed or custom deal) → an editable row.
 * Pack items count in pieces (2 × "Nuggets (6 pcs)" → 12); sized items keep their size.
 */
function partToRow(part: OrderItemPart, menu: Product[]): Row {
  const product = linkedProduct(part, menu);
  const packed = product ? packOfProduct(product) : { base: part.label, pack: 0 as number };
  const own = splitPack(part.label);
  // Pieces as saved, else from the label ("Nuggets (6 pcs)") or the linked item.
  const pack = part.pieces ? part.pack || packed.pack || part.pieces : own.pack || packed.pack;
  const size = !pack && part.variationId ? product?.variations.find((v) => v.id === part.variationId) : undefined;
  const suffix = size ? ` (${size.label})` : "";
  const label = pack
    ? own.pack || part.pieces
      ? own.base
      : /^\d/.test(part.label)
        ? packed.base
        : part.label
    : suffix && part.label.endsWith(suffix)
      ? part.label.slice(0, -suffix.length)
      : part.label;
  const qty = part.pieces ? part.pieces : pack ? part.qty * pack : part.qty;
  const menuPrice = product
    ? pack
      ? packed.packPrice ?? menuPriceOf(product)
      : menuPriceOf(product, part.variationId)
    : undefined;
  const row: Row = {
    id: rowId(),
    productId: part.productId ?? product?.id,
    variationId: pack ? undefined : part.variationId,
    label,
    qty,
    ...(pack ? { pack } : {}),
    ...(pack && "sizes" in packed && packed.sizes ? { packSizes: packed.sizes } : {}),
    ...(size ? { sizeLabel: size.label } : {}),
    noStock: part.noStock,
    priceText: part.price == null ? null : String(part.price),
    menuPrice,
  };
  // A price still at the menu's keeps following qty / size; a typed one stays.
  const auto = autoPriceOf(row, row.qty);
  return { ...row, priceTouched: part.price != null && (auto == null || part.price !== auto) };
}

/** Same deal item in two lists (to know what the deal came with). */
function sameItem(a: Row, b: Row): boolean {
  if (a.productId && b.productId) return a.productId === b.productId;
  return norm(a.label) === norm(b.label);
}

/** Quick piece counts for a pack row: 1 · 2 · 3 · 4 · full pack (never above `max`). */
function PiecesChips({
  row,
  label,
  max,
  onPick,
}: {
  row: Row;
  label: string;
  max?: number;
  onPick: (n: number) => void;
}) {
  const pack = row.pack!;
  const counts = [...new Set([1, 2, 3, 4, pack])]
    .filter((n) => n <= pack && (max == null || n <= max))
    .sort((a, b) => a - b);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" dir="ltr">
      <span className="pos-deal-section me-1">{label}</span>
      {counts.map((n) => (
        <button
          key={n}
          type="button"
          className={`pos-deal-pcs ${row.qty === n ? "is-active" : ""}`}
          aria-pressed={row.qty === n}
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Big − qty + (touch-size buttons). */
function Stepper({
  qty,
  min,
  max,
  unit,
  onChange,
}: {
  qty: number;
  min: number;
  max?: number;
  /** Shown under the number ("pcs"). */
  unit?: string;
  onChange: (qty: number) => void;
}) {
  return (
    <div className="pos-qty is-big shrink-0" dir="ltr">
      <button
        type="button"
        className="pos-qty-btn"
        aria-label="−"
        disabled={qty <= min}
        onClick={() => onChange(Math.max(min, qty - 1))}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
      </button>
      <span className="pos-qty-value">
        {qty}
        {unit ? <small className="pos-qty-unit">{unit}</small> : null}
      </span>
      <button
        type="button"
        className="pos-qty-btn is-plus"
        aria-label="+"
        disabled={max != null && qty >= max}
        onClick={() => onChange(max != null ? Math.min(max, qty + 1) : qty + 1)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

/** "Rs [ 350 ]" — big money box; selects all on focus so typing replaces. */
function MoneyInput({
  value,
  onChange,
  label,
  invalid,
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
  invalid?: boolean;
}) {
  return (
    <span className={`pos-deal-money ${invalid ? "is-invalid" : ""}`} dir="ltr">
      <span className="pos-deal-money-rs" aria-hidden>
        Rs
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(cleanPriceText(e.target.value))}
        onFocus={(e) => e.target.select()}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder="0"
      />
    </span>
  );
}

/**
 * Change a menu deal at the counter (take things out, add extras at a typed
 * price, count pack items in pieces, pick sizes) or build a custom deal from
 * menu items. Picture-first so it works without reading much: tap a photo to
 * add, − / + for how many, type a price. Nothing here touches the menu: the
 * result lives on the cart line / order only.
 */
export function DealEditorSheet({
  mode,
  product,
  line,
  menu,
  categories,
  imageOf,
  canLowerPrices,
  onSave,
  onClose,
}: {
  mode: "deal" | "custom";
  /** The menu deal (mode "deal"). */
  product?: Product;
  /** Line being edited (absent = new custom deal). */
  line?: DealLine;
  /** Menu to pick items from — already in menu order. */
  menu: Product[];
  categories: Category[];
  /** Photo of a menu item (or of a deal part by its name). */
  imageOf: (productId: string | undefined, name: string) => string;
  /**
   * May give more for less: prices under the menu, more of a deal's own items
   * at the deal price, renaming items (owner, or staff allowed to give discounts).
   */
  canLowerPrices: boolean;
  onSave: (result: DealEditResult) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const isDeal = mode === "deal" && Boolean(product);
  // The deal "as it was": a plain line's own snapshot (an old order keeps what
  // and at what price it was sold), else today's menu deal.
  const [baseline] = useState(() => {
    if (!isDeal) return { parts: [] as OrderItemPart[], price: 0, rows: [] as Row[] };
    const snapshot = line && !line.changed && line.parts?.length ? line : undefined;
    const parts = snapshot ? snapshot.parts! : (dealParts(product!) ?? []);
    const price = snapshot ? money(snapshot.unitPrice) : money(product!.basePrice);
    return { parts, price, rows: parts.map((p) => partToRow(p, menu)) };
  });
  const withBase = (rs: Row[]): Row[] =>
    rs.map((r) => {
      if (r.priceText !== null) return r;
      const b = baseline.rows.find((x) => sameItem(x, r));
      return { ...r, baseQty: b?.qty ?? r.qty, ...(b?.pack && !r.pack ? { pack: b.pack, packSizes: b.packSizes, label: b.label } : {}) };
    });
  const [rows, setRows] = useState<Row[]>(() =>
    withBase(
      line?.changed && line.parts?.length
        ? line.parts.map((p) => partToRow(p, menu))
        : baseline.rows.map((r) => ({ ...r, id: rowId() })),
    ),
  );
  const [baseText, setBaseText] = useState<string>(() => {
    if (!isDeal) return "0";
    if (!line?.changed) return String(baseline.price);
    const extras = (line.parts ?? []).reduce((s, p) => s + (p.price ?? 0), 0);
    return String(money(Math.max(0, line.unitPrice - extras)));
  });
  const [name, setName] = useState(
    mode === "custom" ? (line?.productName ?? DEFAULT_CUSTOM_NAME) : "",
  );
  const [catId, setCatId] = useState("all");
  const [query, setQuery] = useState("");

  const dealRows = rows.filter((r) => r.priceText === null);
  const extraRows = rows.filter((r) => r.priceText !== null);
  const basePrice = isDeal ? priceOf(baseText) : 0;
  const unitPrice = money(basePrice + extraRows.reduce((s, r) => s + priceOf(r.priceText), 0));
  const hasItems = rows.some((r) => r.qty > 0);

  // More for less — only owners / staff allowed to discount may save it:
  // a deal price under what it was, an added item under its menu price, or
  // more of the deal's own items than it comes with (free food).
  const baseTooLow = isDeal && basePrice < baseline.price;
  const lowRows = new Set(
    extraRows
      .filter((r) => {
        const auto = autoPriceOf(r, r.qty);
        return auto != null && priceOf(r.priceText) < auto;
      })
      .map((r) => r.id),
  );
  const overRows = dealRows.some((r) => r.baseQty != null && r.qty > r.baseQty);
  const priceBlocked = !canLowerPrices && (baseTooLow || lowRows.size > 0 || overRows);

  // Deals can't go inside a deal: only single menu items.
  const pickable = useMemo(() => menu.filter((p) => p.type !== "bundle"), [menu]);
  const pickCats = useMemo(
    () => categories.filter((c) => pickable.some((p) => p.categoryId === c.id)),
    [categories, pickable],
  );
  const tiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pickable.filter(
      (p) => (catId === "all" || p.categoryId === catId) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [pickable, catId, query]);
  const addedQty = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of extraRows) if (r.productId) m.set(r.productId, (m.get(r.productId) ?? 0) + r.qty);
    return m;
  }, [extraRows]);

  function setRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /** Re-price a row from the menu unless the cashier typed a price. */
  function repriced(r: Row): Row {
    if (r.priceText === null || r.priceTouched) return r;
    const auto = autoPriceOf(r, r.qty);
    return auto == null ? r : { ...r, priceText: String(auto) };
  }

  function setQty(id: string, qty: number) {
    setRows((rs) => rs.map((r) => (r.id === id ? repriced({ ...r, qty }) : r)));
  }

  /** Sized item: switch its size — the price follows the new size unless typed. */
  function setSize(id: string, p: Product, variationId: string) {
    const v = p.variations.find((x) => x.id === variationId);
    if (!v) return;
    setRows((rs) =>
      rs.map((r) =>
        r.id === id ? repriced({ ...r, variationId, sizeLabel: v.label, menuPrice: money(v.price) }) : r,
      ),
    );
  }

  /**
   * Tap on a photo: add the item, or one more of it. A pack item comes as its
   * full pack, counted in pieces (sell 1, 2, 3…); a sized item at its smallest
   * size, switchable on the row.
   */
  function addItem(p: Product) {
    const { base, pack, packPrice, sizes } = packOfProduct(p);
    const sized = !pack && p.type === "sized" && p.variations.length > 0;
    const cheapest = sized ? p.variations.reduce((a, b) => (b.price < a.price ? b : a)) : undefined;
    setRows((rs) => {
      const same = rs.find((r) => r.priceText !== null && r.productId === p.id);
      if (same) return rs.map((r) => (r === same ? repriced({ ...r, qty: r.qty + 1 }) : r));
      const menuPrice = pack ? (packPrice ?? menuPriceOf(p)) : cheapest ? money(cheapest.price) : menuPriceOf(p);
      return [
        ...rs,
        {
          id: rowId(),
          productId: p.id,
          label: base,
          qty: pack || 1,
          priceText: String(menuPrice),
          menuPrice,
          ...(pack ? { pack } : {}),
          ...(sizes ? { packSizes: sizes } : {}),
          ...(cheapest ? { variationId: cheapest.id, sizeLabel: cheapest.label } : {}),
        },
      ];
    });
  }

  /** A row as an order-line part (pieces, the stocked size, price). */
  function toPart(r: Row): OrderItemPart {
    // A pack row taken out of the deal prints "No Nuggets" and keeps its pack (put back → pieces).
    const pieces = r.pack && r.qty > 0 ? r.qty : 0;
    // Pack sold by sizes: stock comes off the size of exactly these pieces, else the smallest one.
    const exact = pieces ? r.packSizes?.find((s) => s.n === pieces) : undefined;
    const smallest = r.packSizes?.reduce((a, b) => (b.n < a.n ? b : a));
    const stockSize = exact ?? (pieces ? smallest : undefined);
    const variationId = r.pack ? stockSize?.id : r.variationId;
    const qty = pieces ? (exact ? 1 : Math.max(1, Math.round(pieces / (smallest?.n ?? r.pack!)))) : r.qty;
    return {
      label: (r.qty > 0 ? rowLabel(r) : r.label).trim() || "Item",
      // Loose pieces count as packs for stock (3 of 6 → 1 pack, 12 → 2).
      qty,
      ...(pieces ? { pieces, pack: r.pack } : {}),
      ...(r.priceText !== null ? { price: priceOf(r.priceText) } : {}),
      ...(r.productId ? { productId: r.productId } : {}),
      ...(variationId ? { variationId } : {}),
      ...(r.noStock ? { noStock: true } : {}),
    };
  }

  function save() {
    if (priceBlocked) return;
    const kept = rows.filter((r) => r.priceText === null || r.qty > 0);
    if (!kept.some((r) => r.qty > 0)) return;
    const parts = kept.map(toPart);

    if (isDeal) {
      const p = product!;
      const unchanged =
        basePrice === baseline.price &&
        kept.length === baseline.rows.length &&
        kept.every((r, i) => {
          const b = baseline.rows[i]!;
          return r.priceText === null && r.qty === b.qty && r.label === b.label;
        });
      if (unchanged) {
        onSave({ productId: p.id, productName: p.name, unitPrice: baseline.price, parts: baseline.parts, changed: false });
        return;
      }
      onSave({ productId: p.id, productName: p.name, unitPrice, parts, changed: true });
      return;
    }
    onSave({
      productId: CUSTOM_DEAL_ID,
      productName: name.trim() || DEFAULT_CUSTOM_NAME,
      unitPrice,
      parts,
      changed: true,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deal-editor-title"
    >
      <button type="button" className="pos-scrim absolute inset-0" aria-label={t("close")} onClick={onClose} />
      <div className="pos-size-sheet relative z-10 flex h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:h-[min(94dvh,56rem)] sm:rounded-2xl">
        {/* Header — title (+ deal name for a custom deal) and close */}
        <div className="pos-size-head flex shrink-0 items-center gap-3 px-4 py-3">
          <span className="pos-deal-head-icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /><path d="M12 11v5M9.5 13.5h5" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="pos-size-eyebrow">{isDeal ? t("customizeDealTitle") : t("customDealTitle")}</p>
            {isDeal ? (
              <h3 id="deal-editor-title" className="truncate text-lg font-bold leading-snug text-[var(--ink)]">
                {product!.name}
              </h3>
            ) : (
              <input
                id="deal-editor-title"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.target.select()}
                aria-label={t("dealName")}
                placeholder={DEFAULT_CUSTOM_NAME}
                maxLength={60}
                className="pos-deal-name-input"
              />
            )}
          </div>
          <button type="button" className="pos-deal-close" aria-label={t("close")} onClick={onClose}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:overflow-hidden">
          {/* ① Menu photos — tap to add */}
          <section className="pos-deal-menu flex max-h-[46dvh] min-h-0 shrink-0 flex-col lg:max-h-none">
            <div className="shrink-0 space-y-2 p-3 pb-2">
              <p className="pos-deal-step">
                <span className="pos-deal-step-num">1</span>
                {t("tapToAdd")}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[{ id: "all", name: t("all") }, ...pickCats].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`pos-deal-cat ${catId === c.id ? "is-active" : ""}`}
                    aria-pressed={catId === c.id}
                    onClick={() => setCatId(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchMenu")}
                className="pos-cart-note-input"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {tiles.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">{t("noResults")}</p>
              ) : (
                <div className="pos-deal-tiles">
                  {tiles.map((p) => {
                    const n = addedQty.get(p.id) ?? 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`pos-deal-tile ${n > 0 ? "is-picked" : ""}`}
                        onClick={() => addItem(p)}
                      >
                        <span className="pos-deal-tile-media">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageOf(p.id, p.name)} alt="" loading="lazy" />
                          {n > 0 ? (
                            <span className="pos-deal-tile-count" dir="ltr">
                              {n}
                            </span>
                          ) : (
                            <span className="pos-deal-tile-plus" aria-hidden>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                            </span>
                          )}
                        </span>
                        <span className="pos-deal-tile-name">{p.name}</span>
                        <span className="pos-deal-tile-price" dir="ltr">
                          {formatPkr(menuPriceOf(p))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ② The deal — how many, price */}
          <section className="pos-deal-panel flex min-h-0 flex-col lg:overflow-y-auto">
            <div className="space-y-3 p-3">
              <p className="pos-deal-step">
                <span className="pos-deal-step-num">2</span>
                {t("setQtyAndPrice")}
              </p>

              {isDeal ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="pos-deal-section">{t("dealInside")}</p>
                    <button
                      type="button"
                      className="pos-deal-link"
                      onClick={() => {
                        setRows(withBase(baseline.rows.map((r) => ({ ...r, id: rowId() }))));
                        setBaseText(String(baseline.price));
                      }}
                    >
                      ↺ {t("resetDeal")}
                    </button>
                  </div>
                  {dealRows.map((r) => (
                    <div
                      key={r.id}
                      className={`pos-deal-row ${r.qty === 0 ? "is-removed" : ""} ${r.pack && r.qty > 0 ? "is-added" : ""}`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="pos-deal-row-img" src={imageOf(r.productId, r.label)} alt="" />
                        <div className="min-w-0 flex-1">
                          <p className="pos-deal-row-name">{r.label}</p>
                          {r.qty === 0 ? (
                            <span className="pos-deal-removed-tag">✕ {t("removedFromDeal")}</span>
                          ) : r.pack ? (
                            <p className="pos-deal-row-print m-0 px-0" dir="ltr">
                              {rowLabel(r)}
                            </p>
                          ) : null}
                        </div>
                        {r.qty === 0 ? (
                          <button
                            type="button"
                            className="pos-deal-putback"
                            onClick={() => setRow(r.id, { qty: r.baseQty || r.pack || 1 })}
                          >
                            ↺ {t("putBackInDeal")}
                          </button>
                        ) : !r.pack ? (
                          <Stepper
                            qty={r.qty}
                            min={0}
                            max={canLowerPrices ? undefined : r.baseQty}
                            onChange={(q) => setQty(r.id, q)}
                          />
                        ) : null}
                      </div>
                      {r.pack && r.qty > 0 ? (
                        <>
                          <PiecesChips
                            row={r}
                            label={t("pieces")}
                            max={canLowerPrices ? undefined : r.baseQty}
                            onPick={(n) => setQty(r.id, n)}
                          />
                          <div className="mt-2">
                            <Stepper
                              qty={r.qty}
                              min={0}
                              max={canLowerPrices ? undefined : r.baseQty}
                              unit="pcs"
                              onChange={(q) => setQty(r.id, q)}
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                  <div className="pos-deal-row">
                    <p className="pos-deal-row-name min-w-0 flex-1">{t("dealPrice")}</p>
                    <MoneyInput
                      value={baseText}
                      onChange={setBaseText}
                      label={t("dealPrice")}
                      invalid={baseTooLow && !canLowerPrices}
                    />
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                {isDeal ? <p className="pos-deal-section">{t("addedItems")}</p> : null}
                {extraRows.length === 0 ? (
                  <div className="pos-deal-empty">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 11V5a2 2 0 0 1 4 0v6" /><path d="M13 9a2 2 0 0 1 4 0v3" /><path d="M17 11a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L4 14.5a2 2 0 0 1 3.4-2.1L9 15" /></svg>
                    <span>{t("customDealEmpty")}</span>
                  </div>
                ) : null}
                {extraRows.map((r) => (
                  <div key={r.id} className="pos-deal-row is-added">
                    <div className="flex items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="pos-deal-row-img" src={imageOf(r.productId, r.label)} alt="" />
                      <div className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={r.label}
                          onChange={(e) => setRow(r.id, { label: e.target.value })}
                          // Renaming a cheap item to a dear one would give it away: owner / discount staff only.
                          readOnly={!canLowerPrices && Boolean(r.productId)}
                          maxLength={60}
                          aria-label={t("itemNameLabel")}
                          className="pos-deal-row-name-input w-full"
                        />
                        {r.pack || r.sizeLabel ? (
                          <p className="pos-deal-row-print" dir="ltr">
                            {rowLabel(r)}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="pos-cart-delete"
                        aria-label={t("remove")}
                        onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </div>
                    {r.pack ? <PiecesChips row={r} label={t("pieces")} onPick={(n) => setQty(r.id, n)} /> : null}
                    {(() => {
                      const p = !r.pack && r.productId ? menu.find((m) => m.id === r.productId) : undefined;
                      if (!p || p.type !== "sized" || p.variations.length < 2) return null;
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="pos-deal-section me-1">{t("size")}</span>
                          {p.variations.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              className={`pos-deal-pcs is-size ${r.variationId === v.id ? "is-active" : ""}`}
                              aria-pressed={r.variationId === v.id}
                              onClick={() => setSize(r.id, p, v.id)}
                            >
                              {v.label}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="mt-2 flex items-center gap-2">
                      <Stepper qty={r.qty} min={1} unit={r.pack ? "pcs" : undefined} onChange={(q) => setQty(r.id, q)} />
                      <MoneyInput
                        value={r.priceText ?? ""}
                        onChange={(text) => setRow(r.id, { priceText: text, priceTouched: true })}
                        label={`${t("rowPrice")} — ${rowLabel(r)}`}
                        invalid={!canLowerPrices && lowRows.has(r.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Footer — big total, cancel, add */}
        <div className="pos-deal-foot shrink-0 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          {priceBlocked ? (
            <p className="pos-deal-blocked" role="alert">
              {t("dealPriceTooLow")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <div className="me-auto">
              <p className="pos-deal-section">{t("total")}</p>
              <p className="pos-cart-total-amount" dir="ltr">
                {formatPkr(unitPrice)}
              </p>
            </div>
            <div className="grid w-full grid-cols-[2fr_3fr] gap-2 sm:flex sm:w-auto">
              <button type="button" className="btn btn-ghost min-h-14 sm:min-w-[8rem]" onClick={onClose}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn pos-cta min-h-14 text-lg sm:min-w-[13rem]"
                disabled={!hasItems || priceBlocked}
                onClick={save}
              >
                ✓ {line ? t("saveDeal") : t("addDealToOrder")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

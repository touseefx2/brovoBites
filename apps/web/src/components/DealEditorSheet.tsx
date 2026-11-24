"use client";

import { useMemo, useState } from "react";
import type { CartDealEdit, CartLine, Category, OrderItemPart, Product } from "@bravobites/domain";
import { CUSTOM_DEAL_ID, formatPkr, money } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";

/** What the editor hands back: the cart line's new deal fields. */
export type DealEditResult = {
  productId: string;
  productName: string;
  unitPrice: number;
  /** Absent = exactly the menu deal again (no changes). */
  parts?: OrderItemPart[];
  dealEdit?: CartDealEdit;
};

type Row = {
  id: string;
  productId?: string;
  variationId?: string;
  label: string;
  qty: number;
  noStock?: boolean;
  /** null = part of the menu deal (paid by the deal price); else this row's price (all its qty). */
  priceText: string | null;
  /** Menu price of one — the row's price follows it × qty until the cashier types a price. */
  menuPrice?: number;
  priceTouched?: boolean;
  /**
   * Added pack item ("Nuggets (6 pcs)"): pieces in the pack. Then `qty`
   * is loose pieces, `label` the name without "(6 pcs)", and the printed name
   * becomes "Nuggets (3 pcs)" as the count changes.
   */
  pack?: number;
};

/** "Nuggets (6 pcs)" / "Wings 6 Pc" → pieces in the pack and the bare name. */
const PACK_RE = /\s*\(?\s*(\d+)\s*(?:pcs?|pieces?)\.?\s*\)?\s*$/i;
function splitPack(name: string): { base: string; pack: number } {
  const m = name.match(PACK_RE);
  const pack = m ? Number(m[1]) : 0;
  const base = m ? name.replace(PACK_RE, "").trim() : name;
  return pack > 1 && base ? { base, pack } : { base: name, pack: 0 };
}

/** Name as it shows / prints: pack rows say how many pieces. */
function rowLabel(r: Row): string {
  return r.pack ? `${r.label.trim() || "Item"} (${r.qty} pcs)` : r.label;
}

/** Row price from the menu: pack rows by the piece (whole rupees). */
function autoPrice(r: Row, qty: number): string {
  if (r.menuPrice == null) return r.priceText ?? "";
  return r.pack
    ? String(Math.round((r.menuPrice * qty) / r.pack))
    : String(money(r.menuPrice * qty));
}

const DEFAULT_CUSTOM_NAME = "Custom Deal";

let rowSeq = 0;
const rowId = () => `r${++rowSeq}`;

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
 * Pack of a deal part: from its label ("Nuggets (6 pcs)") or its linked menu
 * item's name. 0 = counted in whole items (burgers, drinks, fries…).
 */
function partPack(label: string, linked?: Product): { base: string; pack: number } {
  const own = splitPack(label);
  if (own.pack) return own;
  const fromMenu = linked ? splitPack(linked.name) : { base: label, pack: 0 };
  return fromMenu.pack ? { base: /^\d/.test(label) ? fromMenu.base : label, pack: fromMenu.pack } : own;
}

/** The menu deal's contents as rows — pack items counted in pieces (2 × 6 pcs → 12). */
function menuRows(product: Product, menu: Product[]): Row[] {
  return product.dealItems.map((d) => {
    const linked = d.productId ? menu.find((m) => m.id === d.productId) : undefined;
    const { base, pack } = partPack(d.label, linked);
    return {
      id: rowId(),
      productId: d.productId,
      label: pack ? base : d.label,
      qty: pack ? d.qty * pack : d.qty,
      ...(pack ? { pack } : {}),
      noStock: d.noStock,
      priceText: null,
    };
  });
}

function rowsFromLine(line: CartLine, menu: Product[]): Row[] {
  const prices = line.dealEdit?.partPrices ?? [];
  return (line.parts ?? []).map((p, i) => {
    const price = prices[i];
    const product = p.productId ? menu.find((m) => m.id === p.productId) : undefined;
    // Pack size as the editor saved it (the label now says the pieces sold, not the pack).
    const pack = line.dealEdit?.packs?.[i] ?? (p.pieces || 0);
    return {
      id: rowId(),
      productId: p.productId,
      variationId: p.variationId,
      label: pack ? p.label.replace(PACK_RE, "").trim() : p.label,
      qty: p.pieces || p.qty,
      ...(pack ? { pack } : {}),
      noStock: p.noStock,
      priceText: price == null ? null : String(price),
      menuPrice: product ? menuPriceOf(product, p.variationId) : undefined,
      priceTouched: true,
    };
  });
}

/** Quick piece counts for a pack row: 1 · 2 · 3 · 4 · full pack. */
function PiecesChips({ row, label, onPick }: { row: Row; label: string; onPick: (n: number) => void }) {
  const pack = row.pack!;
  const counts = [...new Set([1, 2, 3, 4, pack])].filter((n) => n <= pack).sort((a, b) => a - b);
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
  unit,
  onChange,
}: {
  qty: number;
  min: number;
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
      <button type="button" className="pos-qty-btn is-plus" aria-label="+" onClick={() => onChange(qty + 1)}>
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
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
}) {
  return (
    <span className="pos-deal-money" dir="ltr">
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
        placeholder="0"
      />
    </span>
  );
}

/**
 * Change a menu deal at the counter (take things out, add extras at a typed
 * price) or build a custom deal from menu items. Picture-first so it works
 * without reading much: tap a photo to add, − / + for how many, type a price.
 * Nothing here touches the menu: the result lives on the cart line / order only.
 */
export function DealEditorSheet({
  mode,
  product,
  line,
  menu,
  categories,
  imageOf,
  onSave,
  onClose,
}: {
  mode: "deal" | "custom";
  /** The menu deal (mode "deal"). */
  product?: Product;
  /** Cart line being edited (absent = new custom deal). */
  line?: CartLine;
  /** Menu to pick items from — already in menu order. */
  menu: Product[];
  categories: Category[];
  /** Photo of a menu item (or of a deal part by its name). */
  imageOf: (productId: string | undefined, name: string) => string;
  onSave: (result: DealEditResult) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const isDeal = mode === "deal" && Boolean(product);
  const [rows, setRows] = useState<Row[]>(() =>
    line?.parts?.length ? rowsFromLine(line, menu) : isDeal ? menuRows(product!, menu) : [],
  );
  const [baseText, setBaseText] = useState<string>(() =>
    String(line?.dealEdit?.basePrice ?? product?.basePrice ?? 0),
  );
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

  /** Qty change; an untyped price follows menu price × qty. */
  function withQty(r: Row, qty: number): Row {
    const next = { ...r, qty };
    if (r.priceText !== null && !r.priceTouched && r.menuPrice != null) {
      next.priceText = autoPrice(r, qty);
    }
    return next;
  }

  function setQty(id: string, qty: number) {
    setRows((rs) => rs.map((r) => (r.id === id ? withQty(r, qty) : r)));
  }

  /**
   * Tap on a photo: add the item, or one more of it. A pack item
   * ("Nuggets (6 pcs)") comes as its full pack, counted in pieces — the
   * cashier can then sell 1, 2, 3… pieces (custom deal or a changed deal alike).
   */
  function addItem(p: Product) {
    const price = menuPriceOf(p);
    const { base, pack } = splitPack(p.name);
    setRows((rs) => {
      const same = rs.find((r) => r.priceText !== null && r.productId === p.id && !r.variationId);
      if (same) return rs.map((r) => (r === same ? withQty(r, r.qty + 1) : r));
      return [
        ...rs,
        {
          id: rowId(),
          productId: p.id,
          label: base,
          qty: pack || 1,
          priceText: String(price),
          menuPrice: price,
          ...(pack ? { pack } : {}),
        },
      ];
    });
  }

  function save() {
    const kept = rows.filter((r) => r.priceText === null || r.qty > 0);
    if (!kept.some((r) => r.qty > 0)) return;
    const parts: OrderItemPart[] = kept.map((r) => {
      // A pack row taken out of the deal prints "No Nuggets", no pieces.
      const pieces = r.pack && r.qty > 0 ? r.qty : 0;
      return {
        label: (pieces ? rowLabel(r) : r.label).trim() || "Item",
        // Loose pieces count as packs for stock (3 of 6 → 1 pack, 12 → 2).
        qty: pieces ? Math.max(1, Math.round(pieces / r.pack!)) : r.qty,
        ...(pieces ? { pieces } : {}),
      ...(r.productId ? { productId: r.productId } : {}),
      ...(r.variationId ? { variationId: r.variationId } : {}),
        ...(r.noStock ? { noStock: true } : {}),
      };
    });
    const partPrices = kept.map((r) => (r.priceText === null ? null : priceOf(r.priceText)));
    const packs = kept.map((r) => r.pack ?? null);

    if (isDeal) {
      const p = product!;
      const menuDeal = menuRows(p, menu);
      const unchanged =
        basePrice === money(p.basePrice) &&
        kept.length === menuDeal.length &&
        kept.every((r, i) => {
          const m = menuDeal[i]!;
          return r.priceText === null && r.qty === m.qty && r.label === m.label;
        });
      if (unchanged) {
        onSave({ productId: p.id, productName: p.name, unitPrice: money(p.basePrice) });
        return;
      }
      onSave({ productId: p.id, productName: p.name, unitPrice, parts, dealEdit: { basePrice, partPrices, packs } });
      return;
    }
    onSave({
      productId: CUSTOM_DEAL_ID,
      productName: name.trim() || DEFAULT_CUSTOM_NAME,
      unitPrice,
      parts,
      dealEdit: { partPrices, packs },
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
                        setRows(menuRows(product!, menu));
                        setBaseText(String(product!.basePrice));
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
                            onClick={() => setRow(r.id, { qty: r.pack ?? 1 })}
                          >
                            ↺ {t("putBackInDeal")}
                          </button>
                        ) : !r.pack ? (
                          <Stepper qty={r.qty} min={0} onChange={(q) => setQty(r.id, q)} />
                        ) : null}
                      </div>
                      {r.pack && r.qty > 0 ? (
                        <>
                          <PiecesChips row={r} label={t("pieces")} onPick={(n) => setQty(r.id, n)} />
                          <div className="mt-2">
                            <Stepper qty={r.qty} min={0} unit="pcs" onChange={(q) => setQty(r.id, q)} />
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                  <div className="pos-deal-row">
                    <p className="pos-deal-row-name min-w-0 flex-1">{t("dealPrice")}</p>
                    <MoneyInput value={baseText} onChange={setBaseText} label={t("dealPrice")} />
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
                          maxLength={60}
                          aria-label={t("itemNameLabel")}
                          className="pos-deal-row-name-input w-full"
                        />
                        {r.pack ? (
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
                    <div className="mt-2 flex items-center gap-2">
                      <Stepper qty={r.qty} min={1} unit={r.pack ? "pcs" : undefined} onChange={(q) => setQty(r.id, q)} />
                      <MoneyInput
                        value={r.priceText ?? ""}
                        onChange={(text) => setRow(r.id, { priceText: text, priceTouched: true })}
                        label={`${t("rowPrice")} — ${rowLabel(r)}`}
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
                disabled={!hasItems}
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

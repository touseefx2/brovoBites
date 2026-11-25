import type { Order, OrderItemPart, Product } from "./types";
import { CUSTOM_DEAL_ID } from "./types";
import { dealParts, packOfSize, splitPack } from "./cart";

/** How many: whole items, and pieces for pack items (nuggets, wings…). */
export interface MadeCount {
  qty: number;
  pieces: number;
}

/**
 * One item the kitchen made over the orders: sold on its own, inside deals
 * (menu, changed and custom deals), and the two together.
 */
export interface ItemMadeRow {
  key: string;
  productId?: string;
  name: string;
  alone: MadeCount;
  inDeals: MadeCount;
  total: MadeCount;
}

/** A menu item as a report has it — deal contents / sizes when the full menu is at hand. */
export type MenuItemLike = Pick<Product, "id" | "name"> &
  Partial<Pick<Product, "type" | "dealItems" | "variations">>;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Pieces in one of this item when it is counted by the piece: from its name
 * ("Nuggets (6 pcs)" → 6), or from the size sold when every size is a piece
 * count ("6 pcs" / "12 pcs"; no size → the smallest). 0 = whole items.
 */
function piecesOf(p: MenuItemLike, variationId?: string): number {
  const named = splitPack(p.name).pack;
  if (named) return named;
  const sizes = (p.type === "sized" ? p.variations ?? [] : []).map((v) => ({ id: v.id, n: packOfSize(v.label) }));
  if (sizes.length === 0 || !sizes.every((s) => s.n > 1)) return 0;
  return sizes.find((s) => s.id === variationId)?.n ?? Math.min(...sizes.map((s) => s.n));
}

/** The size of `p` named in a label: "Large" or "Fries (Large)" → that size's id. */
function sizeByLabel(p: MenuItemLike, label: string | undefined): string | undefined {
  if (!label || !p.variations?.length) return undefined;
  const inBrackets = /\(([^()]+)\)\s*$/.exec(label)?.[1];
  const want = [norm(label), inBrackets ? norm(inBrackets) : ""].filter(Boolean);
  return p.variations.find((v) => want.includes(norm(v.label)))?.id;
}

/** Counted by the piece at all (whatever size was sold). */
const isPackItem = (p: MenuItemLike) => piecesOf(p) > 0;

/**
 * Row of a menu item: pack items one row per bare name, in pieces ("Nuggets
 * (6 pcs)" and "Nuggets (12 pcs)" are both "Nuggets"); other sized items one
 * row per size.
 */
function rowOf(p: MenuItemLike, variationId?: string): { key: string; name: string } {
  if (isPackItem(p)) {
    const base = splitPack(p.name).base;
    return { key: `b:${norm(base)}`, name: base };
  }
  const size = variationId ? p.variations?.find((v) => v.id === variationId) : undefined;
  return size
    ? { key: `p:${p.id}:${size.id}`, name: `${p.name} (${size.label})` }
    : { key: `p:${p.id}`, name: p.name };
}

/**
 * What the kitchen made over `orders` (cancelled ones left out): every menu
 * item sold on its own, plus everything that went out inside deals — so
 * "how many Zinger Burgers today" is one number. A deal's item joins its
 * menu item's row when the deal links it, or names it exactly like the menu;
 * otherwise it gets a row of its own name. Deals sold before order lines
 * carried their contents count from the menu's deal (`products`).
 */
export function computeItemsMade(orders: Order[], products: MenuItemLike[] = []): ItemMadeRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const singles = products.filter((p) => p.type !== "bundle");
  const byName = new Map<string, MenuItemLike>();
  for (const p of singles) byName.set(norm(p.name), p);
  // "Nuggets (3 pcs)" → the pack item whose bare name is "Nuggets".
  const packByBase = new Map<string, MenuItemLike>();
  for (const p of singles) if (isPackItem(p)) packByBase.set(norm(splitPack(p.name).base), p);

  const rows = new Map<string, ItemMadeRow>();
  const add = (where: "alone" | "inDeals", key: string, name: string, productId: string | undefined, qty: number, pieces: number) => {
    let r = rows.get(key);
    if (!r) {
      r = { key, ...(productId ? { productId } : {}), name, alone: { qty: 0, pieces: 0 }, inDeals: { qty: 0, pieces: 0 }, total: { qty: 0, pieces: 0 } };
      rows.set(key, r);
    }
    r[where].qty += qty;
    r[where].pieces += pieces;
    r.total.qty += qty;
    r.total.pieces += pieces;
  };

  /**
   * A deal part's menu item: its link, else a menu item named exactly like it.
   * `byPiece`: the deal names a pack item without its pack ("4× Injected
   * Nuggets" for "Injected Nuggets (6 pcs)") — the deal counts pieces then.
   */
  const partProduct = (part: OrderItemPart): { p?: MenuItemLike; byPiece: boolean } => {
    const linked = part.productId ? byId.get(part.productId) : undefined;
    if (linked) return { p: linked, byPiece: false };
    // No link, or linked to an item missing from the list: go by the name.
    const exact = byName.get(norm(part.label));
    if (exact) return { p: exact, byPiece: false };
    // "Fries (Large)": the sized item "Fries", when it has that size.
    const sized = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(part.label);
    const bySize = sized ? byName.get(norm(sized[1]!)) : undefined;
    if (bySize && sizeByLabel(bySize, part.label)) return { p: bySize, byPiece: false };
    const own = splitPack(part.label);
    if (part.pieces || own.pack) return { p: packByBase.get(norm(own.base)), byPiece: false };
    const bare = packByBase.get(norm(part.label));
    return bare ? { p: bare, byPiece: true } : { byPiece: false };
  };

  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const item of order.items) {
      if (!(item.qty > 0)) continue;
      const product = byId.get(item.productId);
      const isDeal =
        item.productId === CUSTOM_DEAL_ID || product?.type === "bundle" || (!product && Boolean(item.parts?.length));

      if (!isDeal) {
        // Missing from the list (deleted, or a list without it): a menu item of the same name.
        const own = splitPack(item.productName);
        const p = product ?? byName.get(norm(item.productName)) ?? (own.pack ? packByBase.get(norm(own.base)) : undefined);
        if (p) {
          // Matched by name (another id): its size by the size's name.
          const variationId = p === product ? item.variationId : sizeByLabel(p, item.variationLabel);
          const { key, name } = rowOf(p, variationId);
          // Pieces from the item, or from its own name / size label when it isn't the same item.
          const n = piecesOf(p, variationId) || own.pack || packOfSize(item.variationLabel ?? "");
          add("alone", key, name, p.id, n ? 0 : item.qty, n ? item.qty * n : 0);
        } else {
          // Not on the menu at all: its own name, in pieces when the name or size says so.
          const n = own.pack || packOfSize(item.variationLabel ?? "");
          const name = n ? own.base : item.variationLabel ? `${item.productName} (${item.variationLabel})` : item.productName;
          add("alone", `n:${norm(name)}`, name, undefined, n ? 0 : item.qty, n ? item.qty * n : 0);
        }
        continue;
      }

      const parts = item.parts?.length
        ? item.parts
        : product?.type === "bundle" && product.dealItems?.length
          ? dealParts(product as Product)
          : undefined;
      if (!parts) continue;
      for (const part of parts) {
        if (!(part.qty > 0)) continue;
        const { p, byPiece } = partProduct(part);
        // Linked to this very item: its size id; matched by name: the size named on the label.
        const variationId = p && p.id === part.productId ? part.variationId : p ? sizeByLabel(p, part.label) : undefined;
        const ownPack = splitPack(part.label).pack;
        // Pieces: sold loose, counted by the piece in the deal, a full pack
        // named on the label, or the menu item's pack / size.
        const n = part.pieces || byPiece ? 0 : ownPack || (p ? piecesOf(p, variationId) : 0);
        const pieces = part.pieces
          ? part.pieces * item.qty
          : byPiece
            ? part.qty * item.qty
            : n
              ? part.qty * n * item.qty
              : 0;
        const qty = pieces ? 0 : part.qty * item.qty;
        if (p) {
          const { key, name } = rowOf(p, isPackItem(p) ? undefined : variationId);
          add("inDeals", key, name, p.id, qty, pieces);
        } else {
          const name = pieces ? splitPack(part.label).base : part.label;
          add("inDeals", `n:${norm(name)}`, name, undefined, qty, pieces);
        }
      }
    }
  }

  const size = (c: MadeCount) => c.qty + c.pieces;
  return [...rows.values()].sort((a, b) => size(b.total) - size(a.total) || a.name.localeCompare(b.name));
}

/** "3" / "15 pcs" / "2 + 15 pcs" / "—" — whole items, then pieces. */
export function madeCountText(c: MadeCount): string {
  if (c.pieces && c.qty) return `${c.qty} + ${c.pieces} pcs`;
  if (c.pieces) return `${c.pieces} pcs`;
  if (c.qty) return String(c.qty);
  return "—";
}

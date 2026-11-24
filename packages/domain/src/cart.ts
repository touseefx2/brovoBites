import type { CartLine, OrderItem, OrderItemPart, Product, ProductVariation } from "./types";
import { CUSTOM_DEAL_ID } from "./types";
import { money } from "./money";

export function cartLineKey(productId: string, variationId?: string): string {
  return variationId ? `${productId}__${variationId}` : productId;
}

export function getVariation(
  product: Product,
  variationId?: string,
): ProductVariation | undefined {
  if (!variationId) return undefined;
  return product.variations.find((v) => v.id === variationId);
}

export function resolveUnitPrice(
  product: Product,
  variationId?: string,
): number {
  if (product.type === "sized") {
    const v = getVariation(product, variationId);
    if (!v) {
      throw new Error(`Size/variation required for ${product.name}`);
    }
    return money(v.price);
  }
  return money(product.basePrice);
}

export function lineTotal(unitPrice: number, qty: number): number {
  if (qty <= 0) return 0;
  return money(unitPrice * qty);
}

export function cartSubtotal(lines: CartLine[]): number {
  return money(lines.reduce((sum, l) => sum + lineTotal(l.unitPrice, l.qty), 0));
}

export function toOrderItems(lines: CartLine[]): OrderItem[] {
  return lines.map((l) => {
    const item: OrderItem = {
      productId: l.productId,
      productName: l.productName,
      unitPrice: money(l.unitPrice),
      qty: l.qty,
      lineTotal: lineTotal(l.unitPrice, l.qty),
    };
    // Firestore rejects `undefined` — only set size fields when present
    if (l.variationId) item.variationId = l.variationId;
    if (l.variationLabel) item.variationLabel = l.variationLabel;
    if (l.note) item.note = l.note;
    if (l.parts?.length) {
      item.parts = cleanParts(l.parts);
      // Always written on deal lines: a line with parts and no flag is one
      // saved before the flag existed (only changed deals had parts then).
      item.changed = l.changed === true;
    }
    return item;
  });
}

/**
 * Parts without undefined fields (Firestore refuses them), every field coerced
 * — also used to read them back, so a tampered order can't put markup or
 * non-numbers into receipts.
 */
export function cleanParts(parts: unknown[]): OrderItemPart[] {
  return parts.map((raw) => {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const part: OrderItemPart = {
      label: String(p.label ?? ""),
      qty: Math.max(0, Math.floor(Number(p.qty) || 0)),
    };
    if (p.productId) part.productId = String(p.productId);
    if (p.variationId) part.variationId = String(p.variationId);
    if (p.noStock) part.noStock = true;
    const pieces = Math.floor(Number(p.pieces) || 0);
    const pack = Math.floor(Number(p.pack) || 0);
    if (pieces > 0) {
      part.pieces = pieces;
      if (pack > 1) part.pack = pack;
    }
    const price = Number(p.price);
    if (p.price != null && Number.isFinite(price) && price >= 0) part.price = money(price);
    return part;
  });
}

/** A menu deal's contents as order-line parts (snapshot when the deal is sold). */
export function dealParts(product: Product): OrderItemPart[] | undefined {
  if (product.type !== "bundle" || product.dealItems.length === 0) return undefined;
  return cleanParts(
    product.dealItems.map((d) => ({
      label: d.label,
      qty: d.qty,
      ...(d.productId ? { productId: d.productId } : {}),
      ...(d.noStock ? { noStock: true } : {}),
    })),
  );
}

/** "Nuggets (6 pcs)" / "Wings 6 Pc" → the bare name and pieces in the pack (0 = not a pack). */
const PACK_SUFFIX = /\s*\(?\s*(\d+)\s*(?:pcs?|pieces?)\.?\s*\)?\s*$/i;
export function splitPack(name: string): { base: string; pack: number } {
  const m = name.match(PACK_SUFFIX);
  const pack = m ? Number(m[1]) : 0;
  const base = m ? name.replace(PACK_SUFFIX, "").trim() : name;
  return pack > 1 && base ? { base, pack } : { base: name, pack: 0 };
}

/** A size named only by its pieces ("6 pcs", "12 Pc") → that count; else 0. */
export function packOfSize(label: string): number {
  const m = label.match(/^\s*(\d+)\s*(?:pcs?|pieces?)\.?\s*$/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Reading a saved line back: was its deal changed at the counter? Orders saved
 * before `changed` existed only gave parts to changed / custom deals.
 */
export function readChanged(raw: { parts?: unknown; changed?: unknown; productId?: unknown }): boolean {
  if (raw.productId === CUSTOM_DEAL_ID) return true;
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) return false;
  return raw.changed === undefined ? true : raw.changed === true;
}

/** Same contents ↔ same signature ("" for a plain line). */
export function partsSignature(parts: OrderItemPart[] | undefined): string {
  if (!parts?.length) return "";
  return parts
    .map((p) => `${p.productId ?? ""}:${p.variationId ?? ""}:${p.label}:${p.qty}:${p.price ?? ""}`)
    .join("|");
}

/** Identity of an order line: product + size + changed deal contents. */
export function orderItemKey(item: Pick<OrderItem, "productId" | "variationId" | "parts">): string {
  const base = `${item.productId}::${item.variationId ?? ""}`;
  const sig = partsSignature(item.parts);
  return sig ? `${base}::${sig}` : base;
}

/** "1x Fries (Large)" / "Nuggets (3 pcs)" / "No Cold Drink" — what a receipt prints under a changed deal. */
export function partText(p: OrderItemPart): string {
  if (p.qty <= 0) return `No ${p.label}`;
  return p.pieces ? p.label : `${p.qty}x ${p.label}`;
}

export function addToCart(
  lines: CartLine[],
  product: Product,
  qty: number,
  variationId?: string,
): CartLine[] {
  if (qty <= 0) return lines;

  if (product.type === "sized" && !variationId) {
    throw new Error("Please select a size");
  }

  const unitPrice = resolveUnitPrice(product, variationId);
  const variation = getVariation(product, variationId);
  const key = cartLineKey(product.id, variationId);
  const existing = lines.find((l) => l.key === key);

  if (existing) {
    return lines.map((l) =>
      l.key === key ? { ...l, qty: l.qty + qty } : l,
    );
  }

  const parts = dealParts(product);
  const next: CartLine = {
    key,
    productId: product.id,
    productName: product.name,
    variationId,
    variationLabel: variation?.label,
    unitPrice,
    qty,
    ...(parts ? { parts } : {}),
  };
  return [...lines, next];
}

export function updateCartQty(
  lines: CartLine[],
  key: string,
  qty: number,
): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, qty } : l));
}

export function removeFromCart(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key);
}

export function isCartEmpty(lines: CartLine[]): boolean {
  return lines.length === 0 || lines.every((l) => l.qty <= 0);
}

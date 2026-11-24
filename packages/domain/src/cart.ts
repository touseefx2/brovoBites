import type { CartLine, OrderItem, OrderItemPart, Product, ProductVariation } from "./types";
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
    if (l.parts?.length) item.parts = cleanParts(l.parts);
    return item;
  });
}

/** Parts without undefined fields (Firestore refuses them), numbers coerced. */
export function cleanParts(parts: OrderItemPart[]): OrderItemPart[] {
  return parts.map((p) => {
    const part: OrderItemPart = {
      label: String(p.label ?? ""),
      qty: Math.max(0, Math.floor(Number(p.qty) || 0)),
    };
    if (p.productId) part.productId = String(p.productId);
    if (p.variationId) part.variationId = String(p.variationId);
    if (p.noStock) part.noStock = true;
    const pieces = Math.floor(Number(p.pieces) || 0);
    if (pieces > 0) part.pieces = pieces;
    return part;
  });
}

/** Same contents ↔ same signature ("" for a plain line). */
export function partsSignature(parts: OrderItemPart[] | undefined): string {
  if (!parts?.length) return "";
  return parts
    .map((p) => `${p.productId ?? ""}:${p.variationId ?? ""}:${p.label}:${p.qty}`)
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

  const next: CartLine = {
    key,
    productId: product.id,
    productName: product.name,
    variationId,
    variationLabel: variation?.label,
    unitPrice,
    qty,
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

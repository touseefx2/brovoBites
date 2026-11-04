import type { InventoryItem, StockMovement, StockUnit } from "./types";

/**
 * Stock is kept per menu item — or per size of a sized item, so "Soft Drink ·
 * 1.5 Litre" and "Soft Drink · Tin Can" are counted apart. A row with no
 * variationId covers every size of its item (older rows, unsized items).
 */
export function stockKey(productId: string, variationId?: string): string {
  return variationId ? `${productId}::${variationId}` : productId;
}

/**
 * Fixed doc id per branch + item (+ size): adding the same item twice — two
 * tills offline at once — lands on one row instead of two.
 */
export function inventoryDocId(branchId: string, productId: string, variationId?: string): string {
  const raw = [branchId, productId, variationId].filter(Boolean).join("__");
  return raw.replace(/[/\s]+/g, "_");
}

export function inventoryItemName(item: Pick<InventoryItem, "productName" | "variationLabel">): string {
  return item.variationLabel ? `${item.productName} · ${item.variationLabel}` : item.productName;
}

export type StockLevel = "ok" | "low" | "out";

export function stockLevel(item: Pick<InventoryItem, "currentStock" | "lowStockThreshold">): StockLevel {
  if (item.currentStock <= 0) return "out";
  if (item.currentStock <= item.lowStockThreshold) return "low";
  return "ok";
}

/**
 * Units that fit the item, best first — a drink is counted in bottles or
 * cans, a burger in pieces. The rest of STOCK_UNITS stays available after.
 */
export function suggestedStockUnits(o: { name: string; categoryName?: string; variationLabel?: string }): StockUnit[] {
  const text = `${o.name} ${o.categoryName ?? ""} ${o.variationLabel ?? ""}`.toLowerCase();
  if (/\b(tin|can)\b/.test(text)) return ["can", "pcs", "box"];
  if (/bottle|litre|liter|ltr|\bml\b|water|drink|pepsi|coke|cola|sprite|7up|juice|soda/.test(text)) {
    return ["bottle", "can", "pcs", "box"];
  }
  if (/beverage|margarita|shake|lassi|tea|coffee/.test(text)) return ["pcs", "bottle", "ml", "ltr"];
  if (/fries|nugget|wing|sauce|mayo|ketchup/.test(text)) return ["pcs", "pack", "plate", "kg", "g"];
  if (/rice|chawal|biryani|pulao|sajji|karahi|handi/.test(text)) return ["plate", "pcs", "kg"];
  if (/roti|naan|paratha/.test(text)) return ["pcs", "dozen"];
  return ["pcs", "plate", "pack"];
}

/** Signed change a movement made to the stock. */
export function movementDelta(m: Pick<StockMovement, "movementType" | "quantity" | "previousStock" | "newStock" | "delta">): number {
  if (typeof m.delta === "number") return m.delta;
  if (m.movementType === "sale" || m.movementType === "waste") return -Math.abs(m.quantity);
  if (m.movementType === "purchase" || m.movementType === "restock") return Math.abs(m.quantity);
  return m.newStock - m.previousStock;
}

export interface StockDayRow {
  inventoryItemId: string;
  name: string;
  unit: StockUnit;
  /** Stock when the period began. */
  opening: number;
  received: number;
  sold: number;
  /** Given back by cancelled / edited orders. */
  returned: number;
  wasted: number;
  /** Net hand count corrections (+ / −). */
  adjusted: number;
  /** Stock when the period ended (or now, for today). */
  closing: number;
  lowStockThreshold: number;
}

/**
 * What each stocked item had, got, sold and kept in a period. Works back
 * from today's live count: closing = now − everything after the period,
 * opening = closing − everything inside it. `movements` must hold every
 * movement from `fromIso` up to now.
 */
export function summarizeStockDay(params: {
  items: InventoryItem[];
  movements: StockMovement[];
  fromIso: string;
  toIso: string;
}): StockDayRow[] {
  const byItem = new Map<string, StockMovement[]>();
  for (const m of params.movements) {
    const list = byItem.get(m.inventoryItemId) ?? [];
    list.push(m);
    byItem.set(m.inventoryItemId, list);
  }
  const rows: StockDayRow[] = [];
  for (const item of params.items) {
    const list = byItem.get(item.id) ?? [];
    let after = 0;
    const row: StockDayRow = {
      inventoryItemId: item.id,
      name: inventoryItemName(item),
      unit: item.unit,
      opening: 0,
      received: 0,
      sold: 0,
      returned: 0,
      wasted: 0,
      adjusted: 0,
      closing: 0,
      lowStockThreshold: item.lowStockThreshold,
    };
    let inside = 0;
    for (const m of list) {
      if (m.createdAt < params.fromIso) continue;
      const d = movementDelta(m);
      if (m.createdAt >= params.toIso) {
        after += d;
        continue;
      }
      inside += d;
      if (m.movementType === "purchase") row.received += d;
      else if (m.movementType === "sale") row.sold += -d;
      else if (m.movementType === "restock") row.returned += d;
      else if (m.movementType === "waste") row.wasted += -d;
      else row.adjusted += d;
    }
    row.closing = item.currentStock - after;
    row.opening = row.closing - inside;
    rows.push(row);
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

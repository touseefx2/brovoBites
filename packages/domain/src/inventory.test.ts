import { describe, expect, it } from "vitest";
import type { InventoryItem, StockMovement } from "./types";
import { inventoryDocId, movementDelta, stockKey, suggestedStockUnits, summarizeStockDay } from "./inventory";

const item: InventoryItem = {
  id: "inv1",
  branchId: "b1",
  productId: "p1",
  productName: "Soft Drink",
  variationId: "1_5l",
  variationLabel: "1.5 Litre",
  currentStock: 7,
  lowStockThreshold: 3,
  unit: "bottle",
  lastUpdated: "",
};

function mov(type: StockMovement["movementType"], qty: number, at: string, extra: Partial<StockMovement> = {}): StockMovement {
  return {
    id: `${type}-${at}`,
    branchId: "b1",
    inventoryItemId: "inv1",
    productId: "p1",
    productName: "Soft Drink",
    movementType: type,
    quantity: qty,
    previousStock: 0,
    newStock: 0,
    notes: "",
    createdBy: "u",
    createdByName: "U",
    createdAt: at,
    ...extra,
  };
}

describe("inventory keys", () => {
  it("keeps sizes apart", () => {
    expect(stockKey("p1")).toBe("p1");
    expect(stockKey("p1", "can")).toBe("p1::can");
    expect(inventoryDocId("b1", "p1", "1_5l")).toBe("b1__p1__1_5l");
    expect(inventoryDocId("b1", "p1")).toBe("b1__p1");
  });
});

describe("movementDelta", () => {
  it("uses the stored delta, else the type", () => {
    expect(movementDelta(mov("sale", 2, "x"))).toBe(-2);
    expect(movementDelta(mov("purchase", 5, "x"))).toBe(5);
    expect(movementDelta(mov("adjustment", 3, "x", { previousStock: 10, newStock: 7 }))).toBe(-3);
    expect(movementDelta(mov("adjustment", 3, "x", { delta: 4 }))).toBe(4);
  });
});

describe("summarizeStockDay", () => {
  it("works back from the live count", () => {
    const rows = summarizeStockDay({
      items: [item],
      fromIso: "2026-10-26T07:00:00.000Z",
      toIso: "2026-10-26T22:30:00.000Z",
      movements: [
        mov("sale", 9, "2026-10-25T10:00:00.000Z"), // before: ignored
        mov("purchase", 12, "2026-10-26T08:00:00.000Z"),
        mov("sale", 6, "2026-10-26T12:00:00.000Z"),
        mov("restock", 1, "2026-10-26T13:00:00.000Z"),
        mov("waste", 1, "2026-10-26T14:00:00.000Z"),
        mov("sale", 2, "2026-10-27T09:00:00.000Z"), // after the day
      ],
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.name).toBe("Soft Drink · 1.5 Litre");
    expect(r.closing).toBe(9);
    expect(r.opening).toBe(3);
    expect(r).toMatchObject({ received: 12, sold: 6, returned: 1, wasted: 1, adjusted: 0 });
  });
});

describe("suggestedStockUnits", () => {
  it("puts drink units first for drinks", () => {
    expect(suggestedStockUnits({ name: "Soft Drink", variationLabel: "Tin Can" })[0]).toBe("can");
    expect(suggestedStockUnits({ name: "Soft Drink", variationLabel: "1.5 Litre" })[0]).toBe("bottle");
    expect(suggestedStockUnits({ name: "Classic Zinger", categoryName: "Burgers" })[0]).toBe("pcs");
  });
});

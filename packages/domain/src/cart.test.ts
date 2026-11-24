import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartSubtotal,
  isCartEmpty,
  cleanParts,
  orderItemKey,
  partText,
  removeFromCart,
  resolveUnitPrice,
  toOrderItems,
  updateCartQty,
} from "./cart";
import type { Product } from "./types";

const simple: Product = {
  id: "burger-1",
  branchId: "main",
  categoryId: "burgers",
  name: "Classic Zinger",
  type: "simple",
  basePrice: 380,
  variations: [],
  dealItems: [],
  imageUrl: "",
  compareAtPrice: null,
  isActive: true,
  sortOrder: 1,
};

const pizza: Product = {
  id: "pizza-tikka",
  branchId: "main",
  categoryId: "pizza",
  name: "Chicken Tikka",
  type: "sized",
  basePrice: 0,
  variations: [
    { id: "s", label: "S", price: 450 },
    { id: "m", label: "M", price: 850 },
    { id: "l", label: "L", price: 1250 },
    { id: "xl", label: "XL", price: 1650 },
  ],
  dealItems: [],
  imageUrl: "",
  compareAtPrice: null,
  isActive: true,
  sortOrder: 1,
};

const deal: Product = {
  id: "deal-1",
  branchId: "main",
  categoryId: "deals",
  name: "Solo Zinger Deal",
  type: "bundle",
  basePrice: 580,
  variations: [],
  dealItems: [
    { label: "Classic Zinger", qty: 1 },
    { label: "Half Fries", qty: 1 },
    { label: "Regular Bottle", qty: 1 },
  ],
  imageUrl: "",
  compareAtPrice: null,
  isActive: true,
  sortOrder: 1,
};

describe("resolveUnitPrice", () => {
  it("uses basePrice for simple and bundle", () => {
    expect(resolveUnitPrice(simple)).toBe(380);
    expect(resolveUnitPrice(deal)).toBe(580);
  });

  it("uses variation price for sized", () => {
    expect(resolveUnitPrice(pizza, "m")).toBe(850);
  });

  it("throws when sized without variation", () => {
    expect(() => resolveUnitPrice(pizza)).toThrow(/variation/i);
  });
});

describe("cart", () => {
  it("adds simple item and totals", () => {
    const lines = addToCart([], simple, 2);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
    expect(cartSubtotal(lines)).toBe(760);
  });

  it("merges same product lines", () => {
    let lines = addToCart([], simple, 1);
    lines = addToCart(lines, simple, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
  });

  it("keeps sized variations separate", () => {
    let lines = addToCart([], pizza, 1, "s");
    lines = addToCart(lines, pizza, 1, "l");
    expect(lines).toHaveLength(2);
    expect(cartSubtotal(lines)).toBe(450 + 1250);
  });

  it("requires size for pizza", () => {
    expect(() => addToCart([], pizza, 1)).toThrow(/size/i);
  });

  it("updates and removes lines", () => {
    let lines = addToCart([], simple, 1);
    const key = lines[0].key;
    lines = updateCartQty(lines, key, 3);
    expect(cartSubtotal(lines)).toBe(1140);
    lines = updateCartQty(lines, key, 0);
    expect(isCartEmpty(lines)).toBe(true);
    lines = addToCart([], deal, 1);
    lines = removeFromCart(lines, lines[0].key);
    expect(lines).toHaveLength(0);
  });

  it("maps to order items with line totals", () => {
    const lines = addToCart([], deal, 2);
    const items = toOrderItems(lines);
    expect(items[0].lineTotal).toBe(1160);
    expect(items[0].productName).toBe("Solo Zinger Deal");
  });
});

describe("changed / custom deals", () => {
  const parts = [
    { productId: "burger-1", label: "Classic Zinger", qty: 1 },
    { label: "Cold Drink", qty: 0, noStock: true },
    { productId: "juice", variationId: "l", label: "Juice (Large)", qty: 2 },
  ];

  it("toOrderItems keeps the parts, without undefined fields or editor state", () => {
    const [item] = toOrderItems([
      {
        key: "deal-1__xabc",
        productId: "deal-1",
        productName: "Deal 1",
        unitPrice: 950,
        qty: 2,
        parts: [...parts, { label: "x", qty: 1, productId: undefined }],
        dealEdit: { basePrice: 750, partPrices: [null, null, 100, 0] },
      },
    ]);
    expect(item!.lineTotal).toBe(1900);
    expect(item!.parts).toEqual([...parts, { label: "x", qty: 1 }]);
    expect("dealEdit" in item!).toBe(false);
    expect(JSON.stringify(item)).not.toContain("undefined");
  });

  it("plain lines get no parts field", () => {
    const [item] = toOrderItems(addToCart([], simple, 1));
    expect("parts" in item!).toBe(false);
  });

  it("orderItemKey separates a changed deal from the menu deal", () => {
    const plain = { productId: "deal-1" };
    const changed = { productId: "deal-1", parts };
    expect(orderItemKey(plain)).toBe("deal-1::");
    expect(orderItemKey(changed)).not.toBe(orderItemKey(plain));
    expect(orderItemKey(changed)).toBe(orderItemKey({ productId: "deal-1", parts: [...parts] }));
  });

  it("partText prints loose pieces by their label only", () => {
    expect(partText({ productId: "nug", label: "Nuggets (3 pcs)", qty: 1, pieces: 3 })).toBe("Nuggets (3 pcs)");
    expect(cleanParts([{ label: "N", qty: 1, pieces: 0 }])).toEqual([{ label: "N", qty: 1 }]);
  });

  it("partText prints removed parts as No …", () => {
    expect(parts.map(partText)).toEqual(["1x Classic Zinger", "No Cold Drink", "2x Juice (Large)"]);
  });
});

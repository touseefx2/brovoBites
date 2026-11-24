import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartSubtotal,
  isCartEmpty,
  cleanParts,
  orderItemKey,
  packOfSize,
  partText,
  readChanged,
  splitPack,
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
        parts: [...parts, { label: "x", qty: 1, productId: undefined, price: 120.004 }],
        changed: true,
      },
    ]);
    expect(item!.lineTotal).toBe(1900);
    expect(item!.parts).toEqual([...parts, { label: "x", qty: 1, price: 120 }]);
    expect(item!.changed).toBe(true);
    expect(JSON.stringify(item)).not.toContain("undefined");
  });

  it("plain lines get no parts field", () => {
    const [item] = toOrderItems(addToCart([], simple, 1));
    expect("parts" in item!).toBe(false);
    expect("changed" in item!).toBe(false);
  });

  it("a menu deal added to the cart carries a snapshot of its contents", () => {
    const deal = {
      ...simple,
      id: "deal-1",
      name: "Deal 1",
      type: "bundle" as const,
      basePrice: 700,
      dealItems: [
        { productId: "burger-1", label: "Classic Zinger", qty: 1 },
        { label: "Cold Drink", qty: 1, noStock: true },
      ],
    };
    const lines = addToCart(addToCart([], deal, 1), deal, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(2);
    const [item] = toOrderItems(lines);
    expect(item!.parts).toEqual([
      { productId: "burger-1", label: "Classic Zinger", qty: 1 },
      { label: "Cold Drink", qty: 1, noStock: true },
    ]);
    expect(item!.changed).toBe(false);
  });

  it("readChanged: lines saved before the flag (parts, no flag) were changed deals", () => {
    const parts = [{ label: "A", qty: 1 }];
    expect(readChanged({ productId: "d", parts })).toBe(true);
    expect(readChanged({ productId: "d", parts, changed: false })).toBe(false);
    expect(readChanged({ productId: "d", parts, changed: true })).toBe(true);
    expect(readChanged({ productId: "d" })).toBe(false);
    expect(readChanged({ productId: "custom-deal", parts, changed: false })).toBe(true);
  });

  it("cleanParts coerces junk read back from an order", () => {
    expect(
      cleanParts([{ label: 5, qty: "2", price: "-3", pieces: 3, pack: 6 }, null, { label: "<b>", qty: -1, price: 0 }]),
    ).toEqual([
      { label: "5", qty: 2, pieces: 3, pack: 6 },
      { label: "", qty: 0 },
      { label: "<b>", qty: 0, price: 0 },
    ]);
  });

  it("splitPack / packOfSize read pieces from names", () => {
    expect(splitPack("Nuggets (6 pcs)")).toEqual({ base: "Nuggets", pack: 6 });
    expect(splitPack("Injected Nuggets (6 pcs)")).toEqual({ base: "Injected Nuggets", pack: 6 });
    expect(splitPack("Wings 6 Pc")).toEqual({ base: "Wings", pack: 6 });
    expect(splitPack("Pepsi 1.5 Litre")).toEqual({ base: "Pepsi 1.5 Litre", pack: 0 });
    expect(splitPack("6 pcs")).toEqual({ base: "6 pcs", pack: 0 });
    expect(packOfSize("12 pcs")).toBe(12);
    expect(packOfSize("Full")).toBe(0);
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

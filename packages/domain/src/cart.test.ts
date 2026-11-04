import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartSubtotal,
  isCartEmpty,
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

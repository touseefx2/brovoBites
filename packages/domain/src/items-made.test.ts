import { describe, expect, it } from "vitest";
import { computeItemsMade, madeCountText } from "./items-made";
import type { Order, OrderItem, Product } from "./types";

const P = (id: string, name: string, extra: Partial<Product> = {}): Product => ({
  id, branchId: "m", categoryId: "c", name, type: "simple", basePrice: 100, variations: [], dealItems: [],
  imageUrl: "", compareAtPrice: null, isActive: true, sortOrder: 0, ...extra,
});
const zinger = P("z", "Zinger Burger");
const nug = P("n", "Nuggets (6 pcs)");
const wings = P("w", "Wings", { type: "sized", variations: [{ id: "6", label: "6 pcs", price: 400 }, { id: "12", label: "12 pcs", price: 700 }] });
const fries = P("f", "Fries", { type: "sized", variations: [{ id: "reg", label: "Regular", price: 200 }, { id: "lg", label: "Large", price: 300 }] });
const duo = P("duo", "Zinger Duo", { type: "bundle", dealItems: [{ productId: "z", label: "Zinger Burger", qty: 2 }, { label: "Cold Drink", qty: 2, noStock: true }] });
const menu = [zinger, nug, wings, fries, duo];

const line = (o: Partial<OrderItem>): OrderItem => ({ productId: "", productName: "", unitPrice: 0, qty: 1, lineTotal: 0, ...o });
const order = (items: OrderItem[], status: Order["status"] = "completed") => ({ id: Math.random().toString(), status, items }) as unknown as Order;
const row = (rows: ReturnType<typeof computeItemsMade>, name: string) => rows.find((r) => r.name === name);

describe("computeItemsMade", () => {
  it("adds an item sold alone and inside deals into one row", () => {
    const rows = computeItemsMade(
      [
        order([line({ productId: "z", productName: "Zinger Burger", qty: 3 })]),
        // Menu deal ×2 with its snapshot; the text part named like the menu item joins it too.
        order([line({ productId: "duo", productName: "Zinger Duo", qty: 2, changed: false, parts: [{ productId: "z", label: "Zinger Burger", qty: 2 }, { label: "Cold Drink", qty: 2 }] })]),
        // Custom deal naming the burger only by text.
        order([line({ productId: "custom-deal", productName: "Phone", qty: 1, changed: true, parts: [{ label: "zinger  burger", qty: 1, price: 380 }] })]),
      ],
      menu,
    );
    expect(row(rows, "Zinger Burger")).toMatchObject({ alone: { qty: 3, pieces: 0 }, inDeals: { qty: 5, pieces: 0 }, total: { qty: 8, pieces: 0 } });
    expect(row(rows, "Cold Drink")).toMatchObject({ alone: { qty: 0 }, inDeals: { qty: 4 }, total: { qty: 4 } });
    // Deals themselves are not "made" items.
    expect(row(rows, "Zinger Duo")).toBeUndefined();
    expect(row(rows, "Phone")).toBeUndefined();
  });

  it("counts pack items in pieces — named packs, piece sizes, loose pieces", () => {
    const rows = computeItemsMade(
      [
        order([line({ productId: "n", productName: "Nuggets (6 pcs)", qty: 2 })]), // 12 pcs alone
        order([line({ productId: "w", productName: "Wings", variationId: "12", variationLabel: "12 pcs", qty: 1 })]), // 12 pcs alone
        order([
          line({
            productId: "custom-deal", productName: "C", qty: 2, changed: true,
            parts: [
              { productId: "n", label: "Nuggets (3 pcs)", qty: 1, pieces: 3, pack: 6 }, // 6 pcs
              { label: "Wings (6 pcs)", qty: 1 }, // text, full 6 pack ×2 = 12 pcs
              { label: "Nuggets", qty: 0 }, // taken out: nothing
            ],
          }),
        ]),
      ],
      menu,
    );
    expect(row(rows, "Nuggets")).toMatchObject({ alone: { pieces: 12 }, inDeals: { pieces: 6 }, total: { qty: 0, pieces: 18 } });
    expect(row(rows, "Wings")).toMatchObject({ alone: { pieces: 12 }, inDeals: { pieces: 12 }, total: { pieces: 24 } });
  });

  it("a deal naming a pack item without its pack counts pieces (\"4× Injected Nuggets\")", () => {
    const inj = P("inj", "Injected Nuggets (6 pcs)");
    const rows = computeItemsMade(
      [
        order([line({ productId: "inj", productName: "Injected Nuggets (6 pcs)", qty: 1 })]), // 6 pcs alone
        order([line({ productId: "box", productName: "Snack Box", qty: 2, changed: false, parts: [{ label: "Injected Nuggets", qty: 4, noStock: true }, { label: "Crispy Wings", qty: 4, noStock: true }] })]),
      ],
      [...menu, inj, P("box", "Snack Box", { type: "bundle", dealItems: [] })],
    );
    expect(row(rows, "Injected Nuggets")).toMatchObject({ alone: { pieces: 6 }, inDeals: { pieces: 8 }, total: { qty: 0, pieces: 14 } });
    // Named unlike any menu item: a row of its own name (whole count as written).
    expect(row(rows, "Crispy Wings")).toMatchObject({ inDeals: { qty: 8, pieces: 0 } });
  });

  it("keeps sizes of other sized items apart", () => {
    const rows = computeItemsMade(
      [
        order([line({ productId: "f", productName: "Fries", variationId: "lg", variationLabel: "Large", qty: 2 })]),
        order([line({ productId: "custom-deal", productName: "C", qty: 1, changed: true, parts: [{ productId: "f", variationId: "lg", label: "Fries (Large)", qty: 1, price: 300 }, { productId: "f", variationId: "reg", label: "Fries (Regular)", qty: 1, price: 200 }] })]),
      ],
      menu,
    );
    expect(row(rows, "Fries (Large)")?.total.qty).toBe(3);
    expect(row(rows, "Fries (Regular)")?.total.qty).toBe(1);
  });

  it("leaves out cancelled orders; old deal lines count from the menu; off-menu items keep their name", () => {
    const rows = computeItemsMade(
      [
        order([line({ productId: "z", productName: "Zinger Burger", qty: 9 })], "cancelled"),
        order([line({ productId: "duo", productName: "Zinger Duo", qty: 1 })]), // sold before lines had parts
        order([line({ productId: "gone", productName: "Old Wrap", qty: 2 })]),
      ],
      menu,
    );
    expect(row(rows, "Zinger Burger")).toMatchObject({ alone: { qty: 0 }, inDeals: { qty: 2 } });
    expect(row(rows, "Old Wrap")).toMatchObject({ alone: { qty: 2 } });
  });

  it("works without the menu (one row per name)", () => {
    const rows = computeItemsMade([
      order([line({ productId: "z", productName: "Zinger Burger", qty: 1 })]),
      order([line({ productId: "duo", productName: "Zinger Duo", qty: 1, changed: false, parts: [{ label: "Zinger Burger", qty: 2 }] })]),
    ]);
    expect(row(rows, "Zinger Burger")).toMatchObject({ alone: { qty: 1 }, inDeals: { qty: 2 }, total: { qty: 3 } });
  });

  it("one row for a pack item sold alone and in deals, linked or by name (review case)", () => {
    const inj = P("inj", "Injected Nuggets (6 pcs)", { isActive: false }); // hidden from the menu, still in the list
    const box = P("box", "Box", { type: "bundle" });
    const orders = [
      order([line({ productId: "inj", productName: "Injected Nuggets (6 pcs)", qty: 2 })]),
      order([line({ productId: "box", productName: "Box", qty: 1, changed: false, parts: [{ productId: "inj", label: "Injected Nuggets (6 pcs)", qty: 1 }, { label: "Injected Nuggets", qty: 4 }] })]),
    ];
    const rows = computeItemsMade(orders, [...menu, inj, box]);
    expect(rows.filter((r) => r.name.startsWith("Injected"))).toHaveLength(1);
    expect(row(rows, "Injected Nuggets")).toMatchObject({ alone: { qty: 0, pieces: 12 }, inDeals: { qty: 0, pieces: 10 }, total: { qty: 0, pieces: 22 } });
  });

  it("an item missing from the list (re-created under a new id) still joins by name, in pieces", () => {
    const fresh = P("inj2", "Injected Nuggets (6 pcs)");
    const rows = computeItemsMade(
      [
        order([line({ productId: "old-id", productName: "Injected Nuggets (6 pcs)", qty: 1 })]),
        order([line({ productId: "custom-deal", productName: "C", qty: 1, changed: true, parts: [{ productId: "old-id", label: "Injected Nuggets (6 pcs)", qty: 1 }] })]),
      ],
      [...menu, fresh],
    );
    expect(row(rows, "Injected Nuggets")).toMatchObject({ productId: "inj2", total: { qty: 0, pieces: 12 } });
  });

  it("packs of the same item (6 pcs, 12 pcs) are one row in pieces", () => {
    const n12 = P("n12", "Nuggets (12 pcs)");
    const rows = computeItemsMade(
      [
        order([line({ productId: "n", productName: "Nuggets (6 pcs)", qty: 1 })]),
        order([line({ productId: "n12", productName: "Nuggets (12 pcs)", qty: 1 })]),
        order([line({ productId: "custom-deal", productName: "C", qty: 1, changed: true, parts: [{ label: "Nuggets (3 pcs)", qty: 1, pieces: 3, pack: 6 }] })]),
      ],
      [...menu, n12],
    );
    expect(rows.filter((r) => r.name === "Nuggets")).toHaveLength(1);
    expect(row(rows, "Nuggets")).toMatchObject({ alone: { pieces: 18 }, inDeals: { pieces: 3 }, total: { qty: 0, pieces: 21 } });
  });

  it("an item matched by name keeps its size (by the size's name)", () => {
    const rows = computeItemsMade(
      [
        order([line({ productId: "f", productName: "Fries", variationId: "lg", variationLabel: "Large", qty: 2 })]),
        order([line({ productId: "old", productName: "Fries", variationId: "x", variationLabel: "Large", qty: 1 })]),
        order([line({ productId: "custom-deal", productName: "C", qty: 1, changed: true, parts: [{ productId: "old", variationId: "x", label: "Fries (Large)", qty: 1 }] })]),
      ],
      menu,
    );
    expect(rows.filter((r) => r.name.startsWith("Fries"))).toHaveLength(1);
    expect(row(rows, "Fries (Large)")).toMatchObject({ alone: { qty: 3 }, inDeals: { qty: 1 }, total: { qty: 4 } });
  });

  it("madeCountText", () => {
    expect(madeCountText({ qty: 3, pieces: 0 })).toBe("3");
    expect(madeCountText({ qty: 0, pieces: 15 })).toBe("15 pcs");
    expect(madeCountText({ qty: 2, pieces: 15 })).toBe("2 + 15 pcs");
    expect(madeCountText({ qty: 0, pieces: 0 })).toBe("—");
  });
});

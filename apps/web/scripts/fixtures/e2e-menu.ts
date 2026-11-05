/**
 * TEST FIXTURE ONLY — the menu the browser (e2e) tests run against on the local
 * Firebase emulator (project "demo-…"). It is NOT the Bravo Bites menu: the
 * tests are written around these dishes / sizes / prices (e.g. "Classic Zinger",
 * a sized "Soft Drink"). scripts/seed.ts uses it only for demo-* projects.
 * The real shop menu is src/lib/seed-data.ts.
 */
import {
  SHARED_MENU_ID,
  type Category,
  type Product,
} from "@bravobites/domain";
import { placeholderImageForProduct } from "../../src/lib/menu-images";

type SeedCategory = Omit<Category, "id"> & { key: string };
type SeedProduct = Omit<Product, "id" | "categoryId"> & { categoryKey: string };

const pizzaSizes = (
  prices: [number, number, number, number],
): Product["variations"] => [
  { id: "s", label: "S", price: prices[0] },
  { id: "m", label: "M", price: prices[1] },
  { id: "l", label: "L", price: prices[2] },
  { id: "xl", label: "XL", price: prices[3] },
];

function withImage(
  product: Omit<SeedProduct, "imageUrl" | "compareAtPrice"> & {
    imageUrl?: string;
    compareAtPrice?: number | null;
  },
  categoryName: string,
): SeedProduct {
  return {
    ...product,
    imageUrl: product.imageUrl ?? placeholderImageForProduct(product.name, categoryName),
    compareAtPrice: product.compareAtPrice ?? null,
  };
}

export const E2E_SEED_CATEGORIES: SeedCategory[] = [
  { key: "sajji", branchId: SHARED_MENU_ID, name: "Sajji Rice", imageUrl: "/menu/categories/sajji-rice.jpg", sortOrder: 1, isActive: true },
  { key: "pizza", branchId: SHARED_MENU_ID, name: "Pizza", imageUrl: "/menu/categories/pizza.jpg", sortOrder: 2, isActive: true },
  { key: "sandwiches", branchId: SHARED_MENU_ID, name: "Sandwiches", imageUrl: "/menu/categories/sandwiches.jpg", sortOrder: 3, isActive: true },
  { key: "burgers", branchId: SHARED_MENU_ID, name: "Burgers", imageUrl: "/menu/categories/burgers.jpg", sortOrder: 4, isActive: true },
  { key: "rolls", branchId: SHARED_MENU_ID, name: "Spring Rolls", imageUrl: "/menu/categories/spring-rolls.jpg", sortOrder: 5, isActive: true },
  { key: "pasta", branchId: SHARED_MENU_ID, name: "Pasta", imageUrl: "/menu/categories/pasta.jpg", sortOrder: 6, isActive: true },
  { key: "sides", branchId: SHARED_MENU_ID, name: "Sides", imageUrl: "/menu/categories/sides.jpg", sortOrder: 7, isActive: true },
  { key: "beverages", branchId: SHARED_MENU_ID, name: "Beverages", imageUrl: "/menu/categories/beverages.jpg", sortOrder: 8, isActive: true },
  { key: "deals", branchId: SHARED_MENU_ID, name: "Combo Deals", imageUrl: "/menu/categories/combo-deals.jpg", sortOrder: 9, isActive: true },
];

const SEED_PRODUCTS_RAW: Array<Omit<SeedProduct, "imageUrl" | "compareAtPrice"> & {
  imageUrl?: string;
  compareAtPrice?: number | null;
}> = [
  // Sajji
  {
    categoryKey: "sajji",
    branchId: SHARED_MENU_ID,
    name: "Sajji with Rice",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "full", label: "Full", price: 1950 },
      { id: "half", label: "Half", price: 1050 },
      { id: "quarter", label: "Quarter", price: 600 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 1,
  },
  {
    categoryKey: "sajji",
    branchId: SHARED_MENU_ID,
    name: "Sajji without Rice",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "full", label: "Full", price: 1200 },
      { id: "half", label: "Half", price: 650 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 2,
  },
  {
    categoryKey: "sajji",
    branchId: SHARED_MENU_ID,
    name: "Only Rice",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "full", label: "Full Plate", price: 500 },
      { id: "half", label: "Half Plate", price: 250 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 3,
  },
  // Pizza (menu board — some flavors have no Small)
  ...[
    ["Chicken Tikka", pizzaSizes([550, 1050, 1650, 1950])] as const,
    ["Chicken Fajita", pizzaSizes([550, 1050, 1650, 1950])] as const,
    ["Chicken Hot & Spicy", pizzaSizes([550, 1050, 1650, 1950])] as const,
    ["Chicken Supreme", pizzaSizes([550, 1050, 1650, 1950])] as const,
    [
      "Bihari Kebab",
      [
        { id: "m", label: "M", price: 1150 },
        { id: "l", label: "L", price: 1750 },
        { id: "xl", label: "XL", price: 2050 },
      ],
    ] as const,
    [
      "Kebab Stuffed",
      [
        { id: "m", label: "M", price: 1150 },
        { id: "l", label: "L", price: 1750 },
        { id: "xl", label: "XL", price: 2050 },
      ],
    ] as const,
    ["Vegetable Pizza", pizzaSizes([450, 950, 1500, 1800])] as const,
    [
      "Crown Crust Pizza",
      [
        { id: "m", label: "M", price: 1150 },
        { id: "l", label: "L", price: 1750 },
        { id: "xl", label: "XL", price: 2050 },
      ],
    ] as const,
    ["Special SD", pizzaSizes([600, 1200, 1800, 2100])] as const,
    ["BBQ Pizza", pizzaSizes([550, 1050, 1650, 1950])] as const,
  ].map(([name, variations], i) => ({
    categoryKey: "pizza",
    branchId: SHARED_MENU_ID,
    name,
    type: "sized" as const,
    basePrice: 0,
    variations: [...variations],
    dealItems: [],
    isActive: true,
    sortOrder: i + 1,
  })),
  // Sandwiches
  { categoryKey: "sandwiches", branchId: SHARED_MENU_ID, name: "Chicken Club", type: "simple", basePrice: 250, variations: [], dealItems: [], isActive: true, sortOrder: 1 },
  { categoryKey: "sandwiches", branchId: SHARED_MENU_ID, name: "Mexican Sandwich", type: "simple", basePrice: 400, variations: [], dealItems: [], isActive: true, sortOrder: 2 },
  { categoryKey: "sandwiches", branchId: SHARED_MENU_ID, name: "Special Sandwich", type: "simple", basePrice: 500, variations: [], dealItems: [], isActive: true, sortOrder: 3 },
  // Burgers
  { categoryKey: "burgers", branchId: SHARED_MENU_ID, name: "Classic Zinger", type: "simple", basePrice: 380, variations: [], dealItems: [], isActive: true, sortOrder: 1 },
  { categoryKey: "burgers", branchId: SHARED_MENU_ID, name: "Cheese Zinger", type: "simple", basePrice: 480, variations: [], dealItems: [], isActive: true, sortOrder: 2 },
  { categoryKey: "burgers", branchId: SHARED_MENU_ID, name: "Double Zinger", type: "simple", basePrice: 550, variations: [], dealItems: [], isActive: true, sortOrder: 3 },
  { categoryKey: "burgers", branchId: SHARED_MENU_ID, name: "Double Zinger with Cheese", type: "simple", basePrice: 580, variations: [], dealItems: [], isActive: true, sortOrder: 4 },
  // Spring rolls
  { categoryKey: "rolls", branchId: SHARED_MENU_ID, name: "Chicken Tikka Spring Roll", type: "simple", basePrice: 410, variations: [], dealItems: [], isActive: true, sortOrder: 1 },
  { categoryKey: "rolls", branchId: SHARED_MENU_ID, name: "Kebab Spring Roll", type: "simple", basePrice: 450, variations: [], dealItems: [], isActive: true, sortOrder: 2 },
  { categoryKey: "rolls", branchId: SHARED_MENU_ID, name: "Special Spring Roll", type: "simple", basePrice: 480, variations: [], dealItems: [], isActive: true, sortOrder: 3 },
  // Pasta
  {
    categoryKey: "pasta",
    branchId: SHARED_MENU_ID,
    name: "Crunchy Pasta",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "m", label: "M", price: 400 },
      { id: "l", label: "L", price: 700 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 1,
  },
  {
    categoryKey: "pasta",
    branchId: SHARED_MENU_ID,
    name: "SDF Special Pasta",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "m", label: "M", price: 450 },
      { id: "l", label: "L", price: 750 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 2,
  },
  // Sides
  {
    categoryKey: "sides",
    branchId: SHARED_MENU_ID,
    name: "Nuggets",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "6", label: "6 pcs", price: 450 },
      { id: "12", label: "12 pcs", price: 900 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 1,
  },
  {
    categoryKey: "sides",
    branchId: SHARED_MENU_ID,
    name: "Fries",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "half", label: "Half", price: 180 },
      { id: "full", label: "Full", price: 250 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 2,
  },
  {
    categoryKey: "sides",
    branchId: SHARED_MENU_ID,
    name: "Loaded Fries",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "half", label: "Half", price: 350 },
      { id: "full", label: "Full", price: 500 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 3,
  },
  {
    categoryKey: "sides",
    branchId: SHARED_MENU_ID,
    name: "Fried Wings",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "6", label: "6 pcs", price: 400 },
      { id: "12", label: "12 pcs", price: 600 },
      { id: "24", label: "24 pcs", price: 1200 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 4,
  },
  {
    categoryKey: "sides",
    branchId: SHARED_MENU_ID,
    name: "Chicken Tempura",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "5", label: "5 pcs", price: 400 },
      { id: "10", label: "10 pcs", price: 750 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 5,
  },
  // Beverages — Soft Drink is sized (glass / half / 1L / 1.5L)
  {
    categoryKey: "beverages",
    branchId: SHARED_MENU_ID,
    name: "Soft Drink",
    type: "sized",
    basePrice: 0,
    variations: [
      { id: "glass", label: "Glass Bottle", price: 70 },
      { id: "can", label: "Tin Can", price: 100 },
      { id: "half", label: "Half Litre", price: 120 },
      { id: "1l", label: "1 Litre", price: 180 },
      { id: "1_5l", label: "1.5 Litre", price: 200 },
      { id: "2_25l", label: "2.25 Litre", price: 250 },
    ],
    dealItems: [],
    isActive: true,
    sortOrder: 1,
    imageUrl: "/menu/items/soft-drink.jpg",
  },
  { categoryKey: "beverages", branchId: SHARED_MENU_ID, name: "Mineral Water 500ml", type: "simple", basePrice: 80, variations: [], dealItems: [], isActive: true, sortOrder: 2 },
  { categoryKey: "beverages", branchId: SHARED_MENU_ID, name: "Mint Margarita", type: "simple", basePrice: 200, variations: [], dealItems: [], isActive: true, sortOrder: 3 },
  { categoryKey: "beverages", branchId: SHARED_MENU_ID, name: "Extra Mayo", type: "simple", basePrice: 50, variations: [], dealItems: [], isActive: true, sortOrder: 4 },
  { categoryKey: "beverages", branchId: SHARED_MENU_ID, name: "Roti", type: "simple", basePrice: 25, variations: [], dealItems: [], isActive: true, sortOrder: 5, imageUrl: "/menu/items/roti.jpg" },
  { categoryKey: "beverages", branchId: SHARED_MENU_ID, name: "Naan", type: "simple", basePrice: 30, variations: [], dealItems: [], isActive: true, sortOrder: 6, imageUrl: "/menu/items/naan.jpg" },
  // Deals
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "1. Solo Zinger Deal",
    type: "bundle",
    basePrice: 580,
    variations: [],
    dealItems: [
      { label: "Classic Zinger", qty: 1 },
      { label: "Half Fries", qty: 1 },
      { label: "Regular Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 1,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "2. Solo Pizza Deal",
    type: "bundle",
    basePrice: 570,
    variations: [],
    dealItems: [
      { label: "1 Small Pizza (any flavor)", qty: 1 },
      { label: "Regular Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 2,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "3. Solo Sandwich Deal",
    type: "bundle",
    basePrice: 700,
    variations: [],
    dealItems: [
      { label: "Special Sandwich", qty: 1 },
      { label: "Half Fries", qty: 1 },
      { label: "Regular Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 3,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "4. Duo Zinger Deal",
    type: "bundle",
    basePrice: 1430,
    variations: [],
    dealItems: [
      { label: "Double Zinger", qty: 2 },
      { label: "Full Fries", qty: 1 },
      { label: "Half Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 4,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "5. Duo Pizza Deal",
    type: "bundle",
    basePrice: 1380,
    variations: [],
    dealItems: [
      { label: "1 Medium Pizza (any flavor)", qty: 1 },
      { label: "Full Fries", qty: 1 },
      { label: "Half Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 5,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "6. Trio Wings & Rolls Deal",
    type: "bundle",
    basePrice: 1880,
    variations: [],
    dealItems: [
      { label: "12pc Fried Wings", qty: 1 },
      { label: "Spring Rolls", qty: 2 },
      { label: "Full Fries", qty: 1 },
      { label: "1 Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 6,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "7. Small Family Deal",
    type: "bundle",
    basePrice: 2400,
    variations: [],
    dealItems: [
      { label: "1 Large Pizza", qty: 1 },
      { label: "6pc Wings", qty: 1 },
      { label: "Full Fries", qty: 1 },
      { label: "1 Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 7,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "8. Medium Family Deal",
    type: "bundle",
    basePrice: 3050,
    variations: [],
    dealItems: [
      { label: "1 Large Special SD Pizza", qty: 1 },
      { label: "12pc Wings", qty: 1 },
      { label: "Loaded Fries Full", qty: 1 },
      { label: "1.5 Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 8,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "9. Large Family Deal",
    type: "bundle",
    basePrice: 5500,
    variations: [],
    dealItems: [
      { label: "Large Chicken Tikka Pizza", qty: 1 },
      { label: "Large BBQ Pizza", qty: 1 },
      { label: "12pc Wings", qty: 1 },
      { label: "Spring Rolls", qty: 2 },
      { label: "Loaded Fries Full", qty: 1 },
      { label: "1.5 Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 9,
  },
  {
    categoryKey: "deals",
    branchId: SHARED_MENU_ID,
    name: "10. Mega Family Deal",
    type: "bundle",
    basePrice: 7400,
    variations: [],
    dealItems: [
      { label: "Large Crown Crust Pizza", qty: 1 },
      { label: "Large Special SD Pizza", qty: 1 },
      { label: "24pc Wings", qty: 1 },
      { label: "Classic Zinger", qty: 4 },
      { label: "Loaded Fries Full", qty: 2 },
      { label: "1.5 Litre Bottle", qty: 1 },
    ],
    isActive: true,
    sortOrder: 10,
  },
];

const categoryNameByKey = new Map(E2E_SEED_CATEGORIES.map((c) => [c.key, c.name]));

export const E2E_SEED_PRODUCTS: SeedProduct[] = SEED_PRODUCTS_RAW.map((p) =>
  withImage(p, categoryNameByKey.get(p.categoryKey) ?? p.categoryKey),
);

import {
  DEFAULT_BRANCH_ID,
  DEFAULT_SETTINGS,
  SHARED_MENU_ID,
  type Category,
  type Product,
} from "@bravobites/domain";
import { placeholderImageForProduct } from "./menu-images";

type SeedCategory = Omit<Category, "id"> & { key: string };
type SeedProduct = Omit<Product, "id" | "categoryId"> & { categoryKey: string };

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

export const SEED_BRANCH = {
  id: DEFAULT_BRANCH_ID,
  name: "Brovo Bites — Main",
  phone: DEFAULT_SETTINGS.phone,
  address: "Main Branch",
  latitude: null as number | null,
  longitude: null as number | null,
  isActive: true,
};

/** Brovo Bites menu (owner's handwritten list, Nov 2026). Prices in Rs. */
export const SEED_CATEGORIES: SeedCategory[] = [
  { key: "burgers", branchId: SHARED_MENU_ID, name: "Burgers & Wraps", imageUrl: "", sortOrder: 1, isActive: true },
  { key: "wings", branchId: SHARED_MENU_ID, name: "Wings & Nuggets", imageUrl: "", sortOrder: 2, isActive: true },
  { key: "fries", branchId: SHARED_MENU_ID, name: "Fries", imageUrl: "", sortOrder: 3, isActive: true },
  { key: "salads", branchId: SHARED_MENU_ID, name: "Salads", imageUrl: "", sortOrder: 4, isActive: true },
  { key: "dips", branchId: SHARED_MENU_ID, name: "Dip Sauces", imageUrl: "", sortOrder: 5, isActive: true },
  { key: "extras", branchId: SHARED_MENU_ID, name: "Extras", imageUrl: "", sortOrder: 6, isActive: true },
  { key: "drinks", branchId: SHARED_MENU_ID, name: "Drinks", imageUrl: "", sortOrder: 7, isActive: true },
];

/** [category key, name, price] — every item is a single-price ("simple") product. */
const MENU: Array<[string, string, number]> = [
  ["burgers", "Zinger Burger", 400],
  ["burgers", "Patty Burger", 250],
  ["burgers", "Beef Burger", 650],
  ["burgers", "Beef Double Patty", 950],
  ["burgers", "Grilled Wrap", 450],

  ["wings", "Wings (6 pcs)", 400],
  ["wings", "BBQ Wings (6 pcs)", 450],
  ["wings", "Buffalo Wings (6 pcs)", 450],
  ["wings", "Nuggets (6 pcs)", 350],
  ["wings", "Injected Nuggets (6 pcs)", 480],

  ["fries", "Large Fries", 350],
  ["fries", "Loaded Fries (Large)", 600],
  ["fries", "Fries Bucket", 500],

  ["salads", "Russian Salad", 250],
  ["salads", "Apple Cabbage Salad", 200],
  ["salads", "Macaroni Salad", 200],

  ["dips", "Smoky BBQ Dip", 50],
  ["dips", "Creamy Ranch Dip", 50],
  ["dips", "Spicy Mayo Dip", 50],
  ["dips", "Chilli Garlic Dip", 50],
  ["dips", "Creamy Garlic Dip", 50],
  ["dips", "Spicy Buffalo Dip", 50],

  ["extras", "Extra Cheese", 50],
  ["extras", "Masala Sprinkle", 20],

  ["drinks", "Cola Next 350ml", 80],
  ["drinks", "Fizzup 350ml", 80],
];

const SEED_PRODUCTS_RAW: Array<Omit<SeedProduct, "imageUrl" | "compareAtPrice"> & {
  imageUrl?: string;
  compareAtPrice?: number | null;
}> = MENU.map(([categoryKey, name, price]) => ({
  categoryKey,
  branchId: SHARED_MENU_ID,
  name,
  type: "simple" as const,
  basePrice: price,
  variations: [],
  dealItems: [],
  isActive: true,
  sortOrder: MENU.filter((m) => m[0] === categoryKey).findIndex((m) => m[1] === name) + 1,
}));

const categoryNameByKey = new Map(SEED_CATEGORIES.map((c) => [c.key, c.name]));

export const SEED_PRODUCTS: SeedProduct[] = SEED_PRODUCTS_RAW.map((p) =>
  withImage(p, categoryNameByKey.get(p.categoryKey) ?? p.categoryKey),
);

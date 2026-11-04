/** Local menu images — unique HD assets per category/product. */

const BASE = "/menu";
const CAT = `${BASE}/categories`;
const ITEM = `${BASE}/items`;

export const MENU_IMAGE = {
  hero: `${BASE}/hero.jpg`,
  sajji: `${CAT}/sajji-rice.jpg`,
  rice: `${ITEM}/only-rice.jpg`,
  pizza: `${CAT}/pizza.jpg`,
  pizzaVeg: `${ITEM}/vegetable-pizza.jpg`,
  burger: `${CAT}/burgers.jpg`,
  sandwich: `${CAT}/sandwiches.jpg`,
  springRolls: `${CAT}/spring-rolls.jpg`,
  pasta: `${CAT}/pasta.jpg`,
  fries: `${ITEM}/fries.jpg`,
  loadedFries: `${ITEM}/loaded-fries.jpg`,
  wings: `${ITEM}/fried-wings.jpg`,
  nuggets: `${ITEM}/nuggets.jpg`,
  tempura: `${ITEM}/chicken-tempura.jpg`,
  drink: `${ITEM}/soft-drink.jpg`,
  water: `${ITEM}/mineral-water.jpg`,
  mint: `${ITEM}/mint-margarita.jpg`,
  combo: `${CAT}/combo-deals.jpg`,
} as const;

/** Exact product display name → unique image path */
const PRODUCT_IMAGE_BY_NAME: Record<string, string> = {
  "Sajji with Rice": `${ITEM}/sajji-with-rice.jpg`,
  "Sajji without Rice": `${ITEM}/sajji-without-rice.jpg`,
  "Only Rice": `${ITEM}/only-rice.jpg`,
  "Chicken Tikka": `${ITEM}/chicken-tikka-pizza.jpg`,
  "Chicken Fajita": `${ITEM}/chicken-fajita-pizza.jpg`,
  "Chicken Hot & Spicy": `${ITEM}/chicken-hot-spicy-pizza.jpg`,
  "Chicken Supreme": `${ITEM}/chicken-supreme-pizza.jpg`,
  "Bihari Kebab": `${ITEM}/bihari-kebab-pizza.jpg`,
  "Kebab Stuffed": `${ITEM}/kebab-stuffed-pizza.jpg`,
  "Vegetable Pizza": `${ITEM}/vegetable-pizza.jpg`,
  "Crown Crust Pizza": `${ITEM}/crown-crust-pizza.jpg`,
  "Special SD": `${ITEM}/special-sd-pizza.jpg`,
  "BBQ Pizza": `${ITEM}/bbq-pizza.jpg`,
  "Chicken Club": `${ITEM}/chicken-club.jpg`,
  "Mexican Sandwich": `${ITEM}/mexican-sandwich.jpg`,
  "Special Sandwich": `${ITEM}/special-sandwich.jpg`,
  "Classic Zinger": `${ITEM}/classic-zinger.jpg`,
  "Cheese Zinger": `${ITEM}/cheese-zinger.jpg`,
  "Double Zinger": `${ITEM}/double-zinger.jpg`,
  "Double Zinger with Cheese": `${ITEM}/double-zinger-cheese.jpg`,
  "Chicken Tikka Spring Roll": `${ITEM}/chicken-tikka-spring-roll.jpg`,
  "Kebab Spring Roll": `${ITEM}/kebab-spring-roll.jpg`,
  "Special Spring Roll": `${ITEM}/special-spring-roll.jpg`,
  "Crunchy Pasta": `${ITEM}/crunchy-pasta.jpg`,
  "SDF Special Pasta": `${ITEM}/sdf-special-pasta.jpg`,
  Nuggets: `${ITEM}/nuggets.jpg`,
  Fries: `${ITEM}/fries.jpg`,
  "Loaded Fries": `${ITEM}/loaded-fries.jpg`,
  "Fried Wings": `${ITEM}/fried-wings.jpg`,
  "Chicken Tempura": `${ITEM}/chicken-tempura.jpg`,
  "Soft Drink": `${ITEM}/soft-drink.jpg`,
  "Soft Drink 340ml": `${ITEM}/soft-drink.jpg`,
  "Mineral Water 500ml": `${ITEM}/mineral-water.jpg`,
  "Mint Margarita": `${ITEM}/mint-margarita.jpg`,
  "Extra Mayo": `${ITEM}/extra-mayo.jpg`,
  Roti: `${ITEM}/roti.jpg`,
  Naan: `${ITEM}/naan.jpg`,
  "1. Solo Zinger Deal": `${ITEM}/solo-zinger-deal.jpg`,
  "2. Solo Pizza Deal": `${ITEM}/solo-pizza-deal.jpg`,
  "3. Solo Sandwich Deal": `${ITEM}/solo-sandwich-deal.jpg`,
  "4. Duo Zinger Deal": `${ITEM}/duo-zinger-deal.jpg`,
  "5. Duo Pizza Deal": `${ITEM}/duo-pizza-deal.jpg`,
  "6. Trio Wings & Rolls Deal": `${ITEM}/trio-wings-rolls-deal.jpg`,
  "7. Small Family Deal": `${ITEM}/small-family-deal.jpg`,
  "8. Medium Family Deal": `${ITEM}/medium-family-deal.jpg`,
  "9. Large Family Deal": `${ITEM}/large-family-deal.jpg`,
  "10. Mega Family Deal": `${ITEM}/mega-family-deal.jpg`,
};

const CATEGORY_IMAGE_BY_NAME: Record<string, string> = {
  "Sajji Rice": `${CAT}/sajji-rice.jpg`,
  Pizza: `${CAT}/pizza.jpg`,
  Sandwiches: `${CAT}/sandwiches.jpg`,
  Burgers: `${CAT}/burgers.jpg`,
  "Spring Rolls": `${CAT}/spring-rolls.jpg`,
  Pasta: `${CAT}/pasta.jpg`,
  Sides: `${CAT}/sides.jpg`,
  Beverages: `${CAT}/beverages.jpg`,
  "Combo Deals": `${CAT}/combo-deals.jpg`,
};

/** Map product display name → unique image path */
export function placeholderImageForProduct(name: string, categoryName?: string): string {
  const exact = PRODUCT_IMAGE_BY_NAME[name.trim()];
  if (exact) return exact;

  const n = name.toLowerCase();
  const cat = (categoryName ?? "").toLowerCase();

  const catExact = CATEGORY_IMAGE_BY_NAME[name.trim()];
  if (catExact) return catExact;

  if (n.includes("without rice") || (n.includes("sajji") && n.includes("without"))) {
    return `${ITEM}/sajji-without-rice.jpg`;
  }
  if (n.includes("only rice") || n === "only rice") return `${ITEM}/only-rice.jpg`;
  if (n.includes("sajji") || cat.includes("sajji")) return `${ITEM}/sajji-with-rice.jpg`;

  if (n.includes("vegetable") || n.includes("veg")) return `${ITEM}/vegetable-pizza.jpg`;
  if (n.includes("tikka") && n.includes("pizza")) return `${ITEM}/chicken-tikka-pizza.jpg`;
  if (n.includes("fajita")) return `${ITEM}/chicken-fajita-pizza.jpg`;
  if (n.includes("hot") && n.includes("spicy")) return `${ITEM}/chicken-hot-spicy-pizza.jpg`;
  if (n.includes("supreme")) return `${ITEM}/chicken-supreme-pizza.jpg`;
  if (n.includes("bihari")) return `${ITEM}/bihari-kebab-pizza.jpg`;
  if (n.includes("stuffed")) return `${ITEM}/kebab-stuffed-pizza.jpg`;
  if (n.includes("crown")) return `${ITEM}/crown-crust-pizza.jpg`;
  if (n.includes("special sd") || n === "special sd") return `${ITEM}/special-sd-pizza.jpg`;
  if (n.includes("bbq")) return `${ITEM}/bbq-pizza.jpg`;
  if (n.includes("pizza") || cat.includes("pizza")) return MENU_IMAGE.pizza;

  if (n.includes("mexican")) return `${ITEM}/mexican-sandwich.jpg`;
  if (n.includes("club")) return `${ITEM}/chicken-club.jpg`;
  if (n.includes("sandwich") || cat.includes("sandwich")) return MENU_IMAGE.sandwich;

  if (n.includes("double") && n.includes("cheese")) return `${ITEM}/double-zinger-cheese.jpg`;
  if (n.includes("double")) return `${ITEM}/double-zinger.jpg`;
  if (n.includes("cheese") && n.includes("zinger")) return `${ITEM}/cheese-zinger.jpg`;
  if (n.includes("zinger") || n.includes("burger") || cat.includes("burger")) {
    return `${ITEM}/classic-zinger.jpg`;
  }

  if (n.includes("tikka") && n.includes("roll")) return `${ITEM}/chicken-tikka-spring-roll.jpg`;
  if (n.includes("kebab") && n.includes("roll")) return `${ITEM}/kebab-spring-roll.jpg`;
  if (n.includes("spring roll") || n.includes("roll") || cat.includes("roll")) {
    return `${ITEM}/special-spring-roll.jpg`;
  }

  if (n.includes("crunchy")) return `${ITEM}/crunchy-pasta.jpg`;
  if (n.includes("pasta") || cat.includes("pasta")) return `${ITEM}/sdf-special-pasta.jpg`;

  if (n.includes("loaded")) return `${ITEM}/loaded-fries.jpg`;
  if (n.includes("fries")) return `${ITEM}/fries.jpg`;
  if (n.includes("wing")) return `${ITEM}/fried-wings.jpg`;
  if (n.includes("nugget")) return `${ITEM}/nuggets.jpg`;
  if (n.includes("tempura")) return `${ITEM}/chicken-tempura.jpg`;
  if (cat.includes("side")) return `${ITEM}/fries.jpg`;

  if (n.includes("water")) return `${ITEM}/mineral-water.jpg`;
  if (n.includes("mint") || n.includes("margarita")) return `${ITEM}/mint-margarita.jpg`;
  if (n.includes("mayo")) return `${ITEM}/extra-mayo.jpg`;
  if (n.includes("drink") || n.includes("soft") || cat.includes("beverage")) {
    return `${ITEM}/soft-drink.jpg`;
  }

  if (n.includes("solo zinger")) return `${ITEM}/solo-zinger-deal.jpg`;
  if (n.includes("solo pizza")) return `${ITEM}/solo-pizza-deal.jpg`;
  if (n.includes("solo sandwich")) return `${ITEM}/solo-sandwich-deal.jpg`;
  if (n.includes("duo zinger")) return `${ITEM}/duo-zinger-deal.jpg`;
  if (n.includes("duo pizza")) return `${ITEM}/duo-pizza-deal.jpg`;
  if (n.includes("trio") || n.includes("wings & rolls")) return `${ITEM}/trio-wings-rolls-deal.jpg`;
  if (n.includes("small family")) return `${ITEM}/small-family-deal.jpg`;
  if (n.includes("medium family")) return `${ITEM}/medium-family-deal.jpg`;
  if (n.includes("large family")) return `${ITEM}/large-family-deal.jpg`;
  if (n.includes("mega family")) return `${ITEM}/mega-family-deal.jpg`;
  if (n.includes("deal") || cat.includes("deal") || cat.includes("combo")) {
    return MENU_IMAGE.combo;
  }

  return MENU_IMAGE.combo;
}

export function resolveCategoryImage(
  imageUrl: string | undefined | null,
  categoryName: string,
): string {
  const url = (imageUrl ?? "").trim();
  if (url) return url;
  return (
    CATEGORY_IMAGE_BY_NAME[categoryName.trim()] ??
    placeholderImageForProduct(categoryName, categoryName)
  );
}

export function resolveProductImage(
  imageUrl: string | undefined | null,
  name: string,
  categoryName?: string,
): string {
  const url = (imageUrl ?? "").trim();
  if (url) return url;
  return placeholderImageForProduct(name, categoryName);
}

/**
 * Bundled menu photos for Brovo Bites (free-license real food photography,
 * see public/menu/brovo/CREDITS.md). Real dish photos the owner uploads in
 * Admin → Menu (ImageKit) always win over these.
 */

const BASE = "/menu/brovo";
const ITEM = `${BASE}/items`;
const CAT = `${BASE}/categories`;

const HERO = `${BASE}/hero`;

/** Food-only atmosphere slides (2400×1600, dark & moody) — login / branch picker backdrop. */
export const HERO_SLIDES = [
  `${HERO}/hero-1.jpg`,
  `${HERO}/hero-2.jpg`,
  `${HERO}/hero-3.jpg`,
  `${HERO}/hero-4.jpg`,
] as const;

/**
 * One hero photo with optional art direction: `src` is the wide crop (2400×1600, shown
 * from 768px up), `tall` the portrait crop phones download instead (1200×1600). Without
 * `tall` every screen gets `src` (object-fit: cover, centred).
 */
export type HeroSlide = {
  src: string;
  tall?: string;
};

/**
 * The food shots with their phone crops (hero-N-tall.jpg, 1200×1600, framed on the dish;
 * hero-4-tall is the flat-lay turned 180° so the burger sits above the hero copy).
 */
export const FOOD_HERO_SLIDES: readonly HeroSlide[] = HERO_SLIDES.map((src) => ({
  src,
  tall: src.replace(/\.jpg$/, "-tall.jpg"),
}));

/**
 * Lifestyle shots (free Unsplash License), each a `<name>-wide.jpg` 2400×1600 + `<name>-tall.jpg`
 * 1200×1600 pair: a woman biting a burger (people-1, Allan Lainez), friends sharing burgers
 * and fries (friends-1, Cailin Grant-Jansen), a wrap at a friends' table (wrap-1, Eugene
 * Chystiakov), a family laughing over nuggets (family-1, Tyson; wide crop mirrored).
 */
const LIFESTYLE_HERO = ["people-1", "friends-1", "wrap-1", "family-1"] as const;

/** Website hero: lifestyle and food shots, alternating (people-1, hero-1, friends-1, hero-2, …). */
export const LANDING_HERO_SLIDES: readonly HeroSlide[] = FOOD_HERO_SLIDES.flatMap((food, i) => [
  { src: `${HERO}/${LIFESTYLE_HERO[i]}-wide.jpg`, tall: `${HERO}/${LIFESTYLE_HERO[i]}-tall.jpg` },
  food,
]);

export const MENU_IMAGE = {
  zinger: `${ITEM}/zinger-burger.jpg`,
  pattyBurger: `${ITEM}/patty-burger.jpg`,
  beefBurger: `${ITEM}/beef-burger.jpg`,
  beefDouble: `${ITEM}/beef-double-patty.jpg`,
  wrap: `${ITEM}/grilled-wrap.jpg`,
  wings: `${ITEM}/wings.jpg`,
  bbqWings: `${ITEM}/bbq-wings.jpg`,
  buffaloWings: `${ITEM}/buffalo-wings.jpg`,
  nuggets: `${ITEM}/nuggets.jpg`,
  injectedNuggets: `${ITEM}/injected-nuggets.jpg`,
  fries: `${ITEM}/large-fries.jpg`,
  loadedFries: `${ITEM}/loaded-fries.jpg`,
  friesBucket: `${ITEM}/fries-bucket.jpg`,
  russianSalad: `${ITEM}/russian-salad.jpg`,
  appleCabbageSalad: `${ITEM}/apple-cabbage-salad.jpg`,
  macaroniSalad: `${ITEM}/macaroni-salad.jpg`,
  dipBbq: `${ITEM}/dip-smoky-bbq.jpg`,
  dipRanch: `${ITEM}/dip-creamy-ranch.jpg`,
  dipSpicyMayo: `${ITEM}/dip-spicy-mayo.jpg`,
  dipChilliGarlic: `${ITEM}/dip-chilli-garlic.jpg`,
  dipCreamyGarlic: `${ITEM}/dip-creamy-garlic.jpg`,
  dipBuffalo: `${ITEM}/dip-spicy-buffalo.jpg`,
  cheese: `${ITEM}/extra-cheese.jpg`,
  masala: `${ITEM}/masala-sprinkle.jpg`,
  cola: `${ITEM}/cola-next.jpg`,
  lemonLime: `${ITEM}/fizzup.jpg`,
  catBurgers: `${CAT}/burgers-wraps.jpg`,
  catWings: `${CAT}/wings-nuggets.jpg`,
  catFries: `${CAT}/fries.jpg`,
  catSalads: `${CAT}/salads.jpg`,
  catDips: `${CAT}/dip-sauces.jpg`,
  catExtras: `${CAT}/extras.jpg`,
  catDrinks: `${CAT}/drinks.jpg`,
  /** Unknown dish — brand badge until a real photo is uploaded */
  brand: "/logo.png",
} as const;

/** Exact product display name → image path */
const PRODUCT_IMAGE_BY_NAME: Record<string, string> = {
  "Zinger Burger": MENU_IMAGE.zinger,
  "Patty Burger": MENU_IMAGE.pattyBurger,
  "Beef Burger": MENU_IMAGE.beefBurger,
  "Beef Double Patty": MENU_IMAGE.beefDouble,
  "Grilled Wrap": MENU_IMAGE.wrap,
  "Wings (6 pcs)": MENU_IMAGE.wings,
  "BBQ Wings (6 pcs)": MENU_IMAGE.bbqWings,
  "Buffalo Wings (6 pcs)": MENU_IMAGE.buffaloWings,
  "Nuggets (6 pcs)": MENU_IMAGE.nuggets,
  "Injected Nuggets (6 pcs)": MENU_IMAGE.injectedNuggets,
  "Large Fries": MENU_IMAGE.fries,
  "Loaded Fries (Large)": MENU_IMAGE.loadedFries,
  "Fries Bucket": MENU_IMAGE.friesBucket,
  "Russian Salad": MENU_IMAGE.russianSalad,
  "Apple Cabbage Salad": MENU_IMAGE.appleCabbageSalad,
  "Macaroni Salad": MENU_IMAGE.macaroniSalad,
  "Smoky BBQ Dip": MENU_IMAGE.dipBbq,
  "Creamy Ranch Dip": MENU_IMAGE.dipRanch,
  "Spicy Mayo Dip": MENU_IMAGE.dipSpicyMayo,
  "Chilli Garlic Dip": MENU_IMAGE.dipChilliGarlic,
  "Creamy Garlic Dip": MENU_IMAGE.dipCreamyGarlic,
  "Spicy Buffalo Dip": MENU_IMAGE.dipBuffalo,
  "Extra Cheese": MENU_IMAGE.cheese,
  "Masala Sprinkle": MENU_IMAGE.masala,
  "Cola Next 350ml": MENU_IMAGE.cola,
  "Fizzup 350ml": MENU_IMAGE.lemonLime,
};

const CATEGORY_IMAGE_BY_NAME: Record<string, string> = {
  "Burgers & Wraps": MENU_IMAGE.catBurgers,
  "Wings & Nuggets": MENU_IMAGE.catWings,
  Fries: MENU_IMAGE.catFries,
  Salads: MENU_IMAGE.catSalads,
  "Dip Sauces": MENU_IMAGE.catDips,
  Extras: MENU_IMAGE.catExtras,
  Drinks: MENU_IMAGE.catDrinks,
  Beverages: MENU_IMAGE.catDrinks,
};

/** Map product display name (+ category) → placeholder image path */
export function placeholderImageForProduct(name: string, categoryName?: string): string {
  const exact = PRODUCT_IMAGE_BY_NAME[name.trim()];
  if (exact) return exact;

  const catExact = CATEGORY_IMAGE_BY_NAME[name.trim()];
  if (catExact) return catExact;

  const n = name.toLowerCase();
  const cat = (categoryName ?? "").toLowerCase();

  if (n.includes("beef") && n.includes("double")) return MENU_IMAGE.beefDouble;
  if (n.includes("beef")) return MENU_IMAGE.beefBurger;
  if (n.includes("zinger")) return MENU_IMAGE.zinger;
  if (n.includes("burger") || n.includes("patty")) return MENU_IMAGE.pattyBurger;
  if (n.includes("wrap") || cat.includes("wrap")) return MENU_IMAGE.wrap;

  if (n.includes("bbq wing")) return MENU_IMAGE.bbqWings;
  if (n.includes("buffalo wing") || n.includes("hot wing")) return MENU_IMAGE.buffaloWings;
  if (n.includes("wing")) return MENU_IMAGE.wings;
  if (n.includes("injected")) return MENU_IMAGE.injectedNuggets;
  if (n.includes("nugget")) return MENU_IMAGE.nuggets;

  if (n.includes("loaded")) return MENU_IMAGE.loadedFries;
  if (n.includes("bucket")) return MENU_IMAGE.friesBucket;
  if (n.includes("fries") || cat.includes("fries")) return MENU_IMAGE.fries;

  if (n.includes("russian")) return MENU_IMAGE.russianSalad;
  if (n.includes("macaroni")) return MENU_IMAGE.macaroniSalad;
  if (n.includes("cabbage") || n.includes("coleslaw")) return MENU_IMAGE.appleCabbageSalad;
  if (n.includes("salad") || cat.includes("salad")) return MENU_IMAGE.catSalads;

  if (n.includes("ranch")) return MENU_IMAGE.dipRanch;
  if (n.includes("buffalo")) return MENU_IMAGE.dipBuffalo;
  if (n.includes("chilli") || n.includes("chili")) return MENU_IMAGE.dipChilliGarlic;
  if (n.includes("garlic")) return MENU_IMAGE.dipCreamyGarlic;
  if (n.includes("mayo")) return MENU_IMAGE.dipSpicyMayo;
  if (n.includes("bbq") && (n.includes("dip") || n.includes("sauce"))) return MENU_IMAGE.dipBbq;
  if (cat.includes("dip") || n.includes("sauce") || n.includes("dip")) return MENU_IMAGE.catDips;
  if (n.includes("cheese")) return MENU_IMAGE.cheese;
  if (n.includes("masala") || n.includes("spice")) return MENU_IMAGE.masala;
  if (n.includes("fizz") || n.includes("lemon") || n.includes("sprite") || n.includes("7up")) {
    return MENU_IMAGE.lemonLime;
  }
  if (n.includes("cola")) return MENU_IMAGE.cola;
  if (
    cat.includes("drink") ||
    cat.includes("beverage") ||
    n.includes("drink") ||
    /\d+\s?ml\b/.test(n)
  ) {
    return MENU_IMAGE.catDrinks;
  }
  if (cat.includes("burger")) return MENU_IMAGE.pattyBurger;

  return MENU_IMAGE.brand;
}

/**
 * Bundled placeholder photos (paths under /menu/ or the logo, written by the
 * seed) belong to the code, not the data: the current mapping above always
 * wins for them. So shipping new / renamed photos needs no Firestore write,
 * and an old path can never 404. Photos the owner uploads (https://… on
 * ImageKit) always win over the mapping.
 */
export function isBundledPlaceholder(url: string | undefined | null): boolean {
  const u = (url ?? "").trim();
  return u.startsWith("/menu/") || u === "/logo.png";
}

export function resolveCategoryImage(
  imageUrl: string | undefined | null,
  categoryName: string,
): string {
  const url = (imageUrl ?? "").trim();
  if (url && !isBundledPlaceholder(url)) return url;
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
  if (url && !isBundledPlaceholder(url)) return url;
  return placeholderImageForProduct(name, categoryName);
}

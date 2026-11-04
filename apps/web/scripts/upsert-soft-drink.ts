/**
 * Convert Soft Drink into sized product with bottle options (Beverages).
 *
 * Options:
 *   Glass Bottle  — Rs 70
 *   Half Litre    — Rs 120
 *   1 Litre       — Rs 180
 *   1.5 Litre     — Rs 200
 *
 *   pnpm --filter web upsert-soft-drink
 *   SEED_ENV=production pnpm --filter web upsert-soft-drink -- --confirm=bravobites-live
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";
import { SHARED_MENU_ID } from "@bravobites/domain";

const webRoot = resolve(__dirname, "..");
const seedEnv =
  process.env.SEED_ENV === "production" ? "production" : "development";
config({ path: resolve(webRoot, `.env.${seedEnv}.local`) });
config({ path: resolve(webRoot, `.env.${seedEnv}`) });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

function privateKey() {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_ADMIN_PRIVATE_KEY missing");
  return key.replace(/\\n/g, "\n");
}

const PRODUCT_NAME = "Soft Drink";
const LEGACY_NAMES = ["Soft Drink 340ml", "Soft Drink"];

const VARIATIONS = [
  { id: "glass", label: "Glass Bottle", price: 70 },
  { id: "can", label: "Tin Can", price: 100 },
  { id: "half", label: "Half Litre", price: 120 },
  { id: "1l", label: "1 Litre", price: 180 },
  { id: "1_5l", label: "1.5 Litre", price: 200 },
  { id: "2_25l", label: "2.25 Litre", price: 250 },
] as const;

async function main() {
  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  console.log("=".repeat(60));
  console.log(`  UPSERT SOFT DRINK (sized)  |  .env.${seedEnv}.local`);
  console.log(`  Firebase: ${projectId || "(MISSING)"}`);
  console.log("=".repeat(60));

  if (!projectId) throw new Error("FIREBASE_ADMIN_PROJECT_ID missing");

  if (seedEnv === "production") {
    const confirm = arg("confirm");
    if (confirm !== projectId) {
      throw new Error(
        `LIVE blocked. Pass --confirm=${projectId} to write production.`,
      );
    }
  } else if (!/-dev$|^demo-/.test(projectId)) {
    throw new Error(
      `SEED_ENV=development but project "${projectId}" is not a DEV (-dev) project. Fix env.`,
    );
  }

  assertShopFirebaseProject(process.env.FIREBASE_ADMIN_PROJECT_ID);
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: privateKey(),
      }),
    });
  }

  const db = getFirestore();
  const cats = await db.collection("categories").get();
  const beverages = cats.docs.find(
    (d) => String(d.data().name ?? "").trim().toLowerCase() === "beverages",
  );
  if (!beverages) {
    throw new Error('Category "Beverages" not found in Firestore.');
  }

  const categoryId = beverages.id;
  console.log(`Beverages categoryId: ${categoryId}`);

  const products = await db.collection("products").get();
  const matches = products.docs.filter((d) => {
    const name = String(d.data().name ?? "").trim();
    return LEGACY_NAMES.some((n) => n.toLowerCase() === name.toLowerCase());
  });

  const payload = {
    branchId: SHARED_MENU_ID,
    categoryId,
    name: PRODUCT_NAME,
    type: "sized" as const,
    basePrice: 0,
    variations: VARIATIONS.map((v) => ({ ...v })),
    dealItems: [],
    imageUrl: "/menu/items/soft-drink.jpg",
    compareAtPrice: null,
    isActive: true,
    sortOrder: 1,
  };

  if (matches.length === 0) {
    const ref = db.collection("products").doc();
    await ref.set(payload);
    console.log(`Created: ${PRODUCT_NAME} (${ref.id})`);
  } else {
    // Keep the first doc, update it; deactivate any duplicates.
    const [primary, ...dupes] = matches;
    await primary!.ref.set(payload, { merge: true });
    console.log(
      `Updated: ${PRODUCT_NAME} (${primary!.id}) — was "${primary!.data().name}"`,
    );
    for (const d of dupes) {
      await d.ref.set({ isActive: false, name: `${d.data().name} (old)` }, { merge: true });
      console.log(`Deactivated duplicate: ${d.id} (${d.data().name})`);
    }
  }

  console.log("Variations:");
  for (const v of VARIATIONS) {
    console.log(`  - ${v.label}: Rs ${v.price}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

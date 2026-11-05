/**
 * Seed Firestore with main branch + full menu (+ optional owner profile doc).
 *
 * Prefer `pnpm create-owner` for Auth+owner only (safer on LIVE).
 *
 * DEV:
 *   pnpm seed -- --ownerUid=<AUTH_UID> --ownerEmail=you@mail.com --ownerName=Owner
 *
 * LIVE (writes menu to production — dangerous if already live):
 *   SEED_ENV=production pnpm seed -- \
 *     --ownerUid=<UID> --ownerEmail=... --ownerName=... --confirm=borovo-ffc56
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";
import { DEFAULT_SETTINGS } from "@bravobites/domain";
import {
  SEED_BRANCH,
  SEED_CATEGORIES as SHOP_CATEGORIES,
  SEED_PRODUCTS as SHOP_PRODUCTS,
} from "../src/lib/seed-data";
import { E2E_SEED_CATEGORIES, E2E_SEED_PRODUCTS } from "./fixtures/e2e-menu";

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

async function main() {
  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  // Local emulator (e2e tests) gets the fixed test menu; DEV / LIVE get the real Brovo Bites menu.
  const isEmulator = /^demo-/.test(projectId);
  const SEED_CATEGORIES = isEmulator ? E2E_SEED_CATEGORIES : SHOP_CATEGORIES;
  const SEED_PRODUCTS = isEmulator ? E2E_SEED_PRODUCTS : SHOP_PRODUCTS;
  const line = "=".repeat(60);
  console.log(line);
  console.log(`  SEED MENU+BRANCH  |  .env.${seedEnv}.local`);
  console.log(`  Firebase project: ${projectId || "(MISSING)"}`);
  console.log(`  Menu: ${isEmulator ? "e2e test fixture (emulator)" : "Brovo Bites shop menu"}`);
  console.log(line);

  if (!projectId) {
    throw new Error("FIREBASE_ADMIN_PROJECT_ID missing");
  }

  if (seedEnv === "production") {
    const confirm = arg("confirm");
    if (confirm !== projectId) {
      throw new Error(
        [
          "LIVE seed blocked.",
          `Pass --confirm=${projectId} to seed production.`,
          "This writes branch + full menu. Prefer create-owner if you only need the admin user.",
        ].join("\n"),
      );
    }
  } else if (!/dev$|^demo-/.test(projectId)) {
    throw new Error(
      `SEED_ENV=development but project "${projectId}" is not a DEV (…dev) project. Fix .env.development.local.`,
    );
  }

  const ownerUid = arg("ownerUid");
  const ownerEmail = arg("ownerEmail") || "owner@bravobites.local";
  const ownerName = arg("ownerName") || "Owner";

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
  const batch = db.batch();

  batch.set(db.collection("branches").doc(SEED_BRANCH.id), {
    name: SEED_BRANCH.name,
    phone: SEED_BRANCH.phone,
    address: SEED_BRANCH.address,
    latitude: SEED_BRANCH.latitude,
    longitude: SEED_BRANCH.longitude,
    isActive: SEED_BRANCH.isActive,
    createdAt: new Date().toISOString(),
  });

  batch.set(db.collection("settings").doc("shop"), {
    ...DEFAULT_SETTINGS,
  });

  batch.set(db.collection("counters").doc(SEED_BRANCH.id), {
    branchId: SEED_BRANCH.id,
    lastOrderNumber: 0,
  });

  const categoryIds = new Map<string, string>();
  for (const cat of SEED_CATEGORIES) {
    const ref = db.collection("categories").doc();
    categoryIds.set(cat.key, ref.id);
    batch.set(ref, {
      branchId: cat.branchId,
      name: cat.name,
      imageUrl: cat.imageUrl ?? "",
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
    });
  }

  for (const prod of SEED_PRODUCTS) {
    const categoryId = categoryIds.get(prod.categoryKey);
    if (!categoryId) continue;
    const ref = db.collection("products").doc();
    batch.set(ref, {
      branchId: prod.branchId,
      categoryId,
      name: prod.name,
      type: prod.type,
      basePrice: prod.basePrice,
      variations: prod.variations,
      dealItems: prod.dealItems,
      imageUrl: prod.imageUrl ?? "",
      compareAtPrice: prod.compareAtPrice ?? null,
      isActive: prod.isActive,
      sortOrder: prod.sortOrder,
    });
  }

  if (ownerUid) {
    batch.set(db.collection("users").doc(ownerUid), {
      email: ownerEmail,
      displayName: ownerName,
      role: "owner",
      branchIds: [SEED_BRANCH.id],
      isActive: true,
      createdAt: new Date().toISOString(),
    });
  }

  await batch.commit();
  console.log("Seed complete.");
  console.log(`Branch: ${SEED_BRANCH.id}`);
  console.log(`Categories: ${SEED_CATEGORIES.length}`);
  console.log(`Products: ${SEED_PRODUCTS.length}`);
  if (ownerUid) {
    console.log(`Owner user doc: ${ownerUid}`);
  } else {
    console.log(
      "NOTE: Pass --ownerUid=... to create owner profile after Auth user exists.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

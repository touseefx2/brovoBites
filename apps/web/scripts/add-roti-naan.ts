/**
 * Upsert Roti (Rs 25) + Naan (Rs 30) under Beverages on DEV or LIVE.
 *
 *   pnpm --filter web add-roti-naan
 *   SEED_ENV=production pnpm --filter web add-roti-naan -- --confirm=bravobites-live
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

const ITEMS = [
  {
    name: "Roti",
    basePrice: 25,
    sortOrder: 5,
    imageUrl: "/menu/items/roti.jpg",
  },
  {
    name: "Naan",
    basePrice: 30,
    sortOrder: 6,
    imageUrl: "/menu/items/naan.jpg",
  },
] as const;

async function main() {
  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  console.log("=".repeat(60));
  console.log(`  ADD ROTI + NAAN  |  .env.${seedEnv}.local`);
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

  for (const item of ITEMS) {
    const existing = await db
      .collection("products")
      .where("name", "==", item.name)
      .get();

    const payload = {
      branchId: SHARED_MENU_ID,
      categoryId,
      name: item.name,
      type: "simple" as const,
      basePrice: item.basePrice,
      variations: [],
      dealItems: [],
      imageUrl: item.imageUrl,
      compareAtPrice: null,
      isActive: true,
      sortOrder: item.sortOrder,
    };

    if (!existing.empty) {
      const doc = existing.docs[0]!;
      await doc.ref.set(payload, { merge: true });
      console.log(`Updated: ${item.name} (${doc.id}) Rs ${item.basePrice}`);
    } else {
      const ref = db.collection("products").doc();
      await ref.set(payload);
      console.log(`Created: ${item.name} (${ref.id}) Rs ${item.basePrice}`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

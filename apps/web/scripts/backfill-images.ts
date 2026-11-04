/**
 * Backfill placeholder menu images onto existing Firestore products/categories.
 *
 * Usage:
 *   pnpm --filter web backfill-images
 *   SEED_ENV=production pnpm --filter web backfill-images
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";
import { placeholderImageForProduct } from "../src/lib/menu-images";

const webRoot = resolve(__dirname, "..");
const seedEnv = process.env.SEED_ENV === "production" ? "production" : "development";
config({ path: resolve(webRoot, `.env.${seedEnv}.local`) });
config({ path: resolve(webRoot, `.env.${seedEnv}`) });

function privateKey() {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_ADMIN_PRIVATE_KEY missing");
  return key.replace(/\\n/g, "\n");
}

async function main() {
  assertShopFirebaseProject(process.env.FIREBASE_ADMIN_PROJECT_ID);
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: privateKey(),
      }),
    });
  }

  const db = getFirestore();
  const catsSnap = await db.collection("categories").get();
  const catNames = new Map<string, string>();
  let catUpdated = 0;

  for (const doc of catsSnap.docs) {
    const data = doc.data();
    catNames.set(doc.id, String(data.name ?? ""));
    const existing = String(data.imageUrl ?? "").trim();
    if (existing) continue;
    const name = String(data.name ?? "");
    const imageUrl = placeholderImageForProduct(name, name);
    await doc.ref.set({ imageUrl }, { merge: true });
    catUpdated += 1;
  }

  const prodsSnap = await db.collection("products").get();
  let prodUpdated = 0;
  for (const doc of prodsSnap.docs) {
    const data = doc.data();
    const existing = String(data.imageUrl ?? "").trim();
    if (existing) continue;
    const name = String(data.name ?? "");
    const categoryName = catNames.get(String(data.categoryId ?? "")) ?? "";
    const imageUrl = placeholderImageForProduct(name, categoryName);
    await doc.ref.set(
      {
        imageUrl,
        compareAtPrice: data.compareAtPrice ?? null,
      },
      { merge: true },
    );
    prodUpdated += 1;
  }

  console.log(`Backfill complete (${seedEnv}).`);
  console.log(`Categories updated: ${catUpdated}/${catsSnap.size}`);
  console.log(`Products updated: ${prodUpdated}/${prodsSnap.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

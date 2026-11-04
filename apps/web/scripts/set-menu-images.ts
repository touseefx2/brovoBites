/**
 * Force-update every category/product imageUrl to the unique local HD path.
 *
 * Usage:
 *   pnpm --filter web set-menu-images
 *   SEED_ENV=production pnpm --filter web set-menu-images
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
    const name = String(data.name ?? "");
    catNames.set(doc.id, name);
    const imageUrl = placeholderImageForProduct(name, name);
    const prev = String(data.imageUrl ?? "");
    if (prev === imageUrl) continue;
    await doc.ref.set({ imageUrl }, { merge: true });
    catUpdated += 1;
    console.log(`cat  ${name} → ${imageUrl}`);
  }

  const prodsSnap = await db.collection("products").get();
  let prodUpdated = 0;
  for (const doc of prodsSnap.docs) {
    const data = doc.data();
    const name = String(data.name ?? "");
    const categoryName = catNames.get(String(data.categoryId ?? "")) ?? "";
    const imageUrl = placeholderImageForProduct(name, categoryName);
    const prev = String(data.imageUrl ?? "");
    if (prev === imageUrl) continue;
    await doc.ref.set({ imageUrl }, { merge: true });
    prodUpdated += 1;
    console.log(`item ${name} → ${imageUrl}`);
  }

  console.log(`\nDone (${seedEnv}). Categories: ${catUpdated}/${catsSnap.size}, Products: ${prodUpdated}/${prodsSnap.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

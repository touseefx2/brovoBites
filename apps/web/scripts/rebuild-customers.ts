/**
 * Build / rebuild the customers list from all orders (also gives older orders
 * their customerKey). Same code as the owner's "Recount from orders".
 *
 *   pnpm --filter web customers:rebuild                         DEV, dry run (counts only)
 *   pnpm --filter web customers:rebuild --confirm=brovodev      DEV, writes
 *   SEED_ENV=production pnpm --filter web customers:rebuild --confirm=borovo-ffc56   LIVE (only when asked)
 *
 * Safe to run again: numbers are rebuilt from the orders, never added up.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";
import { rebuildAllCustomers } from "../src/lib/server/customers";

const webRoot = resolve(__dirname, "..");
const env = process.env.SEED_ENV === "production" ? "production" : "development";
config({ path: resolve(webRoot, `.env.${env}.local`) });
config({ path: resolve(webRoot, `.env.${env}`) });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

async function main() {
  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("FIREBASE_ADMIN_PROJECT_ID missing");
  assertShopFirebaseProject(projectId);
  if (env === "development" && !/dev$|^demo-/.test(projectId)) {
    throw new Error(`.env.development.local points at "${projectId}", not a DEV project.`);
  }
  const confirm = arg("confirm");
  const write = confirm === projectId;
  if (confirm && !write) throw new Error(`--confirm must be the project id (${projectId}).`);

  const db = getFirestore(
    initializeApp({
      credential: cert({
        projectId,
        clientEmail: String(process.env.FIREBASE_ADMIN_CLIENT_EMAIL || ""),
        privateKey: String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    }),
  );
  console.log(`Customers rebuild — project ${projectId} — ${write ? "WRITING" : "dry run (pass --confirm=" + projectId + " to write)"}`);
  const res = await rebuildAllCustomers(db, { dryRun: !write });
  console.log(
    `orders: ${res.orders} | orders given a customerKey: ${res.keyed} | customers: ${res.customers} | customer docs written: ${res.updated} | stale removed: ${res.removed}`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

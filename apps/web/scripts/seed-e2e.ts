/**
 * Creates deterministic owner + staff Auth users for Playwright.
 *
 *   pnpm --filter web seed:e2e
 *
 * Override with env: E2E_OWNER_EMAIL, E2E_STAFF_EMAIL, E2E_PASSWORD
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";
import { DEFAULT_STAFF_PERMISSIONS } from "@bravobites/domain";

const webRoot = resolve(__dirname, "..");
config({ path: resolve(webRoot, ".env.development.local") });
config({ path: resolve(webRoot, ".env.local") });

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || "e2e.owner@bravobites.test";
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || "e2e.staff@bravobites.test";
const PASSWORD = process.env.E2E_PASSWORD || "E2ePass123!";
const BRANCH_ID = process.env.E2E_BRANCH_ID || "main";

function privateKey() {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_ADMIN_PRIVATE_KEY missing");
  return key.replace(/\\n/g, "\n");
}

async function upsertAuthUser(email: string, displayName: string) {
  const auth = getAuth();
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password: PASSWORD, displayName });
    return existing.uid;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "auth/user-not-found") throw e;
    const created = await auth.createUser({
      email,
      password: PASSWORD,
      displayName,
    });
    return created.uid;
  }
}

async function main() {
  // Test owner with a known password — must never exist on the real shop:
  // only a DEV project (…dev) or a local demo emulator project (demo-…).
  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  if (!/dev$|^demo-/.test(projectId)) {
    throw new Error(`seed:e2e refuses to run on "${projectId || "(missing project)"}" — DEV only.`);
  }

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
  const ownerUid = await upsertAuthUser(OWNER_EMAIL, "E2E Owner");
  const staffUid = await upsertAuthUser(STAFF_EMAIL, "E2E Staff");

  await db.collection("users").doc(ownerUid).set(
    {
      email: OWNER_EMAIL,
      displayName: "E2E Owner",
      phone: "",
      role: "owner",
      branchIds: [BRANCH_ID],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await db.collection("users").doc(staffUid).set(
    {
      email: STAFF_EMAIL,
      displayName: "E2E Staff",
      phone: "",
      role: "counter",
      branchIds: [BRANCH_ID],
      isActive: true,
      permissions: DEFAULT_STAFF_PERMISSIONS,
      createdAt: new Date().toISOString(),
    },
    { merge: true },
  );

  console.log("E2E users ready:");
  console.log(`  owner ${OWNER_EMAIL}  uid=${ownerUid}`);
  console.log(`  staff ${STAFF_EMAIL}  uid=${staffUid}`);
  console.log(`  password ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

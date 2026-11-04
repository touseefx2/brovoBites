/**
 * Create (or update) the main owner Auth user + Firestore profile.
 * Does NOT seed menu/branch/products — use `pnpm seed` for that (separately, with care).
 *
 * DEV (default — bravobites-dev via .env.development.local):
 *   pnpm create-owner -- --email=you@mail.com --password='YourPass123' --name='Owner'
 *
 * LIVE (bravobites-live via .env.production.local) — MUST pass --confirm=bravobites-live:
 *   SEED_ENV=production pnpm create-owner -- \
 *     --email=you@mail.com --password='YourPass123' --name='Owner' \
 *     --confirm=bravobites-live --primary
 *
 * Safety: production refuses to run unless --confirm matches FIREBASE_ADMIN_PROJECT_ID.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";

const webRoot = resolve(__dirname, "..");
const seedEnv =
  process.env.SEED_ENV === "production" ? "production" : "development";
config({ path: resolve(webRoot, `.env.${seedEnv}.local`) });
config({ path: resolve(webRoot, `.env.${seedEnv}`) });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.some((a) => a === `--${name}`);
}

function privateKey() {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_ADMIN_PRIVATE_KEY missing");
  return key.replace(/\\n/g, "\n");
}

function banner(projectId: string) {
  const line = "=".repeat(60);
  console.log(line);
  console.log(`  CREATE OWNER  |  env file: .env.${seedEnv}.local`);
  console.log(`  Firebase project: ${projectId || "(MISSING)"}`);
  console.log(`  SEED_ENV=${seedEnv}`);
  console.log(line);
}

async function main() {
  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  banner(projectId);

  if (!projectId) {
    throw new Error("FIREBASE_ADMIN_PROJECT_ID missing in env file");
  }

  if (seedEnv === "production") {
    const confirm = arg("confirm");
    if (confirm !== projectId) {
      throw new Error(
        [
          "LIVE blocked for safety.",
          `Pass --confirm=${projectId} to write to production Firebase.`,
          "Example:",
          `  SEED_ENV=production pnpm create-owner -- --email=... --password=... --name=... --confirm=${projectId} --primary`,
        ].join("\n"),
      );
    }
    if (projectId.includes("dev")) {
      throw new Error(
        `SEED_ENV=production but projectId looks like dev ("${projectId}"). Aborting.`,
      );
    }
  } else if (!/-dev$|^demo-/.test(projectId) && !hasFlag("force-dev-on-live-keys")) {
    throw new Error(
      [
        `You are on SEED_ENV=development but FIREBASE_ADMIN_PROJECT_ID is "${projectId}" (not a -dev project).`,
        "Check apps/web/.env.development.local — it must point at bravobites-dev.",
        "If intentional, pass --force-dev-on-live-keys (not recommended).",
      ].join("\n"),
    );
  }

  const email = String(arg("email") || "").trim();
  const password = String(arg("password") || "");
  const name = String(arg("name") || "Owner").trim();
  const branchId = String(arg("branchId") || "main").trim();
  const primary = hasFlag("primary");

  if (!email || !email.includes("@")) {
    throw new Error("Pass --email=you@mail.com");
  }
  if (password.length < 6) {
    throw new Error("Pass --password=... (min 6 chars)");
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

  const auth = getAuth();
  const db = getFirestore();

  let uid: string;
  let created = false;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, { password, displayName: name });
    console.log(`Auth user exists — updated password/name. uid=${uid}`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "auth/user-not-found") throw e;
    const user = await auth.createUser({
      email,
      password,
      displayName: name,
    });
    uid = user.uid;
    created = true;
    console.log(`Auth user created. uid=${uid}`);
  }

  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        email,
        displayName: name,
        phone: "",
        role: "owner",
        branchIds: [branchId],
        isActive: true,
        ...(primary ? { isPrimaryOwner: true } : {}),
        createdAt: new Date().toISOString(),
      },
      { merge: true },
    );

  console.log(`Firestore users/${uid} upserted (role=owner).`);
  if (primary) {
    console.log("Flagged isPrimaryOwner=true.");
    console.log(
      `Optional: set PRIMARY_OWNER_UID=${uid} in Vercel + .env.production.local`,
    );
  }
  console.log(created ? "Done (new owner)." : "Done (existing owner updated).");
  console.log(`Login email: ${email}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

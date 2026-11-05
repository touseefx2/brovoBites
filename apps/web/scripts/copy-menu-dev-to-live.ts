/**
 * Copy menu from DEV → LIVE Firebase.
 * Default: categories + products only.
 * Optional: --with-branches --with-settings (includes counters)
 *
 * Dry-run:
 *   pnpm copy-menu -- --dry-run
 * Write:
 *   pnpm copy-menu -- --confirm=borovo-ffc56
 *   pnpm copy-menu -- --confirm=borovo-ffc56 --replace
 *   pnpm copy-menu -- --confirm=borovo-ffc56 --with-branches
 */
import { resolve } from "path";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "../src/lib/firebase/allowed-projects";
import { readFileSync } from "fs";

const webRoot = resolve(__dirname, "..");

const BASE_COLLECTIONS = ["categories", "products"] as const;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.some((a) => a === `--${name}`);
}

function parseEnvFile(filePath: string): Record<string, string> {
  const text = readFileSync(filePath, "utf8");
  const vals: Record<string, string> = {};
  let key: string | null = null;
  let buf: string[] = [];
  let quote: string | null = null;

  for (const raw of text.split("\n")) {
    if (key === null) {
      const s = raw.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const [k, ...rest] = s.split("=");
      const name = k!.trim();
      let v = rest.join("=").trim();
      if (
        (v.startsWith('"') && !v.endsWith('"')) ||
        (v.startsWith("'") && !v.endsWith("'"))
      ) {
        quote = v[0]!;
        key = name;
        buf = [v.slice(1)];
      } else {
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        vals[name] = v.replace(/\\n/g, "\n");
      }
    } else if (quote && raw.endsWith(quote)) {
      buf.push(raw.slice(0, -1));
      vals[key] = buf.join("\n").replace(/\\n/g, "\n");
      key = null;
      buf = [];
      quote = null;
    } else {
      buf.push(raw);
    }
  }
  return vals;
}

function initFromEnv(
  name: string,
  env: Record<string, string>,
): { app: App; db: Firestore; projectId: string } {
  const projectId = String(env.FIREBASE_ADMIN_PROJECT_ID || "").trim();
  const clientEmail = String(env.FIREBASE_ADMIN_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.FIREBASE_ADMIN_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`Missing admin credentials in ${name}`);
  }
  assertShopFirebaseProject(projectId);
  const app = initializeApp(
    {
      credential: cert({ projectId, clientEmail, privateKey }),
    },
    name,
  );
  return { app, db: getFirestore(app), projectId };
}

async function countDocs(db: Firestore, col: string): Promise<number> {
  const snap = await db.collection(col).get();
  return snap.size;
}

async function deleteAll(db: Firestore, col: string): Promise<number> {
  const snap = await db.collection(col).get();
  if (snap.empty) return 0;
  let n = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    inBatch++;
    n++;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return n;
}

async function copyCollection(
  from: Firestore,
  to: Firestore,
  col: string,
): Promise<number> {
  const snap = await from.collection(col).get();
  if (snap.empty) return 0;
  let n = 0;
  let batch = to.batch();
  let inBatch = 0;
  for (const doc of snap.docs) {
    batch.set(to.collection(col).doc(doc.id), doc.data(), { merge: false });
    inBatch++;
    n++;
    if (inBatch >= 400) {
      await batch.commit();
      batch = to.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return n;
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const replace = hasFlag("replace");
  const confirm = arg("confirm");
  const cols: string[] = [...BASE_COLLECTIONS];
  if (hasFlag("with-branches")) cols.push("branches");
  if (hasFlag("with-settings")) {
    cols.push("settings", "counters");
  }

  const devEnv = parseEnvFile(resolve(webRoot, ".env.development.local"));
  const liveEnv = parseEnvFile(resolve(webRoot, ".env.production.local"));

  const dev = initFromEnv("dev-copy", devEnv);
  const live = initFromEnv("live-copy", liveEnv);

  const line = "=".repeat(60);
  console.log(line);
  console.log("  COPY MENU  DEV → LIVE");
  console.log(`  FROM: ${dev.projectId}`);
  console.log(`  TO:   ${live.projectId}`);
  console.log(`  collections: ${cols.join(", ")}`);
  console.log(`  mode: ${dryRun ? "DRY-RUN" : replace ? "REPLACE+COPY" : "COPY (merge overwrite by id)"}`);
  console.log(line);

  if (dev.projectId !== "brovodev") {
    throw new Error(`Expected DEV project brovodev, got ${dev.projectId}`);
  }
  if (live.projectId !== "borovo-ffc56") {
    throw new Error(`Expected LIVE project borovo-ffc56, got ${live.projectId}`);
  }

  console.log("\nCounts BEFORE:");
  for (const col of cols) {
    const d = await countDocs(dev.db, col);
    const l = await countDocs(live.db, col);
    console.log(`  ${col.padEnd(12)} DEV=${d}  LIVE=${l}`);
  }

  if (dryRun) {
    console.log("\nDry-run only — no writes. Re-run with --confirm=borovo-ffc56 [--replace]");
    await deleteApp(dev.app);
    await deleteApp(live.app);
    return;
  }

  if (confirm !== live.projectId) {
    throw new Error(
      `Blocked. Pass --confirm=${live.projectId} to write menu to LIVE.`,
    );
  }

  if (replace) {
    console.log("\nReplacing LIVE menu collections...");
    for (const col of cols) {
      const deleted = await deleteAll(live.db, col);
      console.log(`  deleted ${col}: ${deleted}`);
    }
  }

  console.log("\nCopying DEV → LIVE...");
  for (const col of cols) {
    const n = await copyCollection(dev.db, live.db, col);
    console.log(`  copied ${col}: ${n}`);
  }

  console.log("\nCounts AFTER:");
  for (const col of cols) {
    const d = await countDocs(dev.db, col);
    const l = await countDocs(live.db, col);
    console.log(`  ${col.padEnd(12)} DEV=${d}  LIVE=${l}`);
  }

  console.log("\nDone. Owner/users were NOT touched.");
  console.log("Image URLs still point at whatever CDN DEV used (usually fine).");

  await deleteApp(dev.app);
  await deleteApp(live.app);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

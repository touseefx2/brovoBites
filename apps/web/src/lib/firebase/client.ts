import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { assertShopFirebaseProject } from "./allowed-projects";

export function getFirebaseConfig() {
  // IMPORTANT: Next.js only inlines NEXT_PUBLIC_* with direct access
  // (process.env.NEXT_PUBLIC_FOO) — not process.env[name].
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  if (!config.apiKey || !config.projectId) {
    throw new Error(
      "Firebase configuration is missing. Check apps/web/.env.local and restart the app.",
    );
  }
  assertShopFirebaseProject(config.projectId);
  return config;
}

/**
 * Local test runs only (`NEXT_PUBLIC_USE_EMULATORS=1` with a `demo-…` project):
 * talk to the Firebase emulators on this machine, never a real project.
 */
const useEmulators =
  process.env.NEXT_PUBLIC_USE_EMULATORS === "1" &&
  (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").startsWith("demo-");

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps().length ? getApp() : initializeApp(getFirebaseConfig());
  return app;
}

export function getClientAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  if (useEmulators) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  return auth;
}

export function getClientDb(): Firestore {
  if (db) return db;
  db = initializeFirestore(getFirebaseApp(), {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
  if (useEmulators) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  requestPersistentStorage();
  return db;
}

// Offline orders live in IndexedDB until synced. Without persistent storage,
// Chrome may evict them under disk pressure — ask it to keep them.
function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  navigator.storage
    .persisted()
    .then((already) => (already ? true : navigator.storage.persist()))
    .catch(() => {});
}

export function getClientStorage(): FirebaseStorage {
  if (storage) return storage;
  storage = getStorage(getFirebaseApp());
  return storage;
}

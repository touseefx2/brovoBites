import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertShopFirebaseProject } from "./allowed-projects";

function getPrivateKey(): string {
  const key = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!key) {
    throw new Error("Missing FIREBASE_ADMIN_PRIVATE_KEY");
  }
  return key.replace(/\\n/g, "\n");
}

export function getAdminApp(): App {
  if (getApps().length) return getApps()[0]!;
  assertShopFirebaseProject(process.env.FIREBASE_ADMIN_PROJECT_ID);
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    }),
  });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

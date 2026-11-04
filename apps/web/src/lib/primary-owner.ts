import type { DocumentData, DocumentReference } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Resolve the main (primary) owner UID.
 * Prefer PRIMARY_OWNER_UID env; else the user flagged isPrimaryOwner;
 * else the oldest owner (and stamp them as primary once).
 */
export async function resolvePrimaryOwnerUid(): Promise<string | null> {
  const fromEnv = String(process.env.PRIMARY_OWNER_UID || "").trim();
  if (fromEnv) return fromEnv;

  const db = getAdminDb();
  const flagged = await db
    .collection("users")
    .where("isPrimaryOwner", "==", true)
    .limit(1)
    .get();
  if (!flagged.empty) return flagged.docs[0].id;

  const owners = await db.collection("users").where("role", "==", "owner").get();
  if (owners.empty) return null;

  const sorted = [...owners.docs].sort((a, b) => {
    const ca = String(a.data().createdAt ?? "");
    const cb = String(b.data().createdAt ?? "");
    return ca.localeCompare(cb);
  });
  const oldest = sorted[0]!;
  await oldest.ref.set({ isPrimaryOwner: true }, { merge: true });
  return oldest.id;
}

export async function ensureCallerPrimaryFlag(
  uid: string,
  ref: DocumentReference,
  data: DocumentData | undefined,
): Promise<boolean> {
  const primaryUid = await resolvePrimaryOwnerUid();
  if (!primaryUid || primaryUid !== uid) {
    return Boolean(data?.isPrimaryOwner === true && data?.role === "owner");
  }
  if (data?.isPrimaryOwner !== true) {
    await ref.set({ isPrimaryOwner: true, role: "owner" }, { merge: true });
  }
  return true;
}

export function isPrimaryOwnerData(data: DocumentData | undefined): boolean {
  return data?.role === "owner" && data?.isPrimaryOwner === true;
}

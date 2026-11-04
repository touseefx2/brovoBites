import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { ensureCallerPrimaryFlag } from "@/lib/primary-owner";

export async function requireOwner(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const decoded = await getAdminAuth().verifyIdToken(token);
  const callerRef = getAdminDb().collection("users").doc(decoded.uid);
  const callerSnap = await callerRef.get();
  if (!callerSnap.exists || callerSnap.data()?.role !== "owner") {
    return { error: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  }
  if (callerSnap.data()?.isActive === false) {
    return { error: NextResponse.json({ error: "Account disabled" }, { status: 403 }) };
  }

  const isPrimary = await ensureCallerPrimaryFlag(
    decoded.uid,
    callerRef,
    callerSnap.data(),
  );

  return { uid: decoded.uid, isPrimary };
}

/** Any signed-in, active owner or counter user. */
export async function requireActiveUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const decoded = await getAdminAuth().verifyIdToken(token);
  const snap = await getAdminDb().collection("users").doc(decoded.uid).get();
  const data = snap.data();
  if (!snap.exists || (data?.role !== "owner" && data?.role !== "counter")) {
    return { error: NextResponse.json({ error: "Staff only" }, { status: 403 }) };
  }
  if (data?.isActive === false) {
    return { error: NextResponse.json({ error: "Account disabled" }, { status: 403 }) };
  }
  return {
    uid: decoded.uid,
    role: data.role as "owner" | "counter",
    name: String(data.displayName || data.email || decoded.uid),
  };
}

export async function requirePrimaryOwner(req: NextRequest) {
  const gate = await requireOwner(req);
  if ("error" in gate && gate.error) return gate;
  if (!gate.isPrimary) {
    return {
      error: NextResponse.json(
        { error: "Only the main owner can manage other owners" },
        { status: 403 },
      ),
    };
  }
  return gate;
}

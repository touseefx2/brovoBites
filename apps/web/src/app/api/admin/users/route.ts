import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireOwner, requirePrimaryOwner } from "@/lib/require-owner";
import { isPrimaryOwnerData, resolvePrimaryOwnerUid } from "@/lib/primary-owner";

/** Boots primary-owner flag for the oldest / env-locked owner. */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireOwner(req);
    if ("error" in gate && gate.error) return gate.error;
    return NextResponse.json({ uid: gate.uid, isPrimary: gate.isPrimary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const role = body.role === "owner" ? "owner" : "counter";

    const gate =
      role === "owner" ? await requirePrimaryOwner(req) : await requireOwner(req);
    if ("error" in gate && gate.error) return gate.error;

    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim();
    const phone = String(body.phone || "").trim();
    const branchIds = Array.isArray(body.branchIds)
      ? body.branchIds.map(String)
      : [];
    const permissions =
      role === "counter" && body.permissions && typeof body.permissions === "object"
        ? {
            canAddExpenses: body.permissions.canAddExpenses !== false,
            canDeleteExpenses: body.permissions.canDeleteExpenses !== false,
            canApplyDiscount: body.permissions.canApplyDiscount !== false,
            canEditOrders: body.permissions.canEditOrders !== false,
            canCancelOrders: body.permissions.canCancelOrders !== false,
            canManageInventory: body.permissions.canManageInventory !== false,
          }
        : undefined;

    if (!email || password.length < 6) {
      return NextResponse.json(
        { error: "Valid email + password (6+) required" },
        { status: 400 },
      );
    }

    if (role === "owner" && branchIds.length === 0) {
      // Owners can access all branches; keep array empty or copy caller's — empty is fine.
    }

    const userRecord = await getAdminAuth().createUser({
      email,
      password,
      displayName,
    });

    await getAdminDb()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        email,
        displayName,
        phone,
        role,
        branchIds: role === "owner" ? [] : branchIds,
        isActive: true,
        isPrimaryOwner: false,
        createdAt: new Date().toISOString(),
        ...(permissions ? { permissions } : {}),
      });

    return NextResponse.json({ uid: userRecord.uid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const gate = await requireOwner(req);
    if ("error" in gate && gate.error) return gate.error;

    const body = await req.json();
    const uid = String(body.uid || "").trim();
    if (!uid) {
      return NextResponse.json({ error: "uid required" }, { status: 400 });
    }

    const userRef = getAdminDb().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = snap.data()!;
    const primaryUid = await resolvePrimaryOwnerUid();
    const targetIsPrimary =
      isPrimaryOwnerData(existing) || (primaryUid != null && uid === primaryUid);

    if (targetIsPrimary && gate.uid !== uid) {
      return NextResponse.json(
        { error: "Main owner account cannot be edited by others" },
        { status: 403 },
      );
    }

    if (existing.role === "owner" && !gate.isPrimary && gate.uid !== uid) {
      return NextResponse.json(
        { error: "Only the main owner can edit other owners" },
        { status: 403 },
      );
    }

    if (body.isActive === false && targetIsPrimary) {
      return NextResponse.json(
        { error: "Main owner cannot be disabled" },
        { status: 403 },
      );
    }

    if (body.role != null && targetIsPrimary && body.role !== "owner") {
      return NextResponse.json(
        { error: "Main owner cannot be demoted" },
        { status: 403 },
      );
    }

    const displayName =
      body.displayName !== undefined
        ? String(body.displayName || "").trim()
        : String(existing.displayName ?? "");
    const phone =
      body.phone !== undefined
        ? String(body.phone || "").trim()
        : String(existing.phone ?? "");
    const branchIds = Array.isArray(body.branchIds)
      ? body.branchIds.map(String)
      : Array.isArray(existing.branchIds)
        ? existing.branchIds.map(String)
        : [];
    const password =
      typeof body.password === "string" && body.password.length > 0
        ? String(body.password)
        : null;
    const permissions =
      body.permissions && typeof body.permissions === "object"
        ? {
            canAddExpenses: body.permissions.canAddExpenses !== false,
            canDeleteExpenses: body.permissions.canDeleteExpenses !== false,
            canApplyDiscount: body.permissions.canApplyDiscount !== false,
            canEditOrders: body.permissions.canEditOrders !== false,
            canCancelOrders: body.permissions.canCancelOrders !== false,
            canManageInventory: body.permissions.canManageInventory !== false,
          }
        : undefined;

    if (password !== null && password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    // Main owner editing self: name/phone only (no password via this screen)
    const allowPassword =
      password !== null && !(targetIsPrimary && gate.uid === uid);

    const nextActive =
      typeof body.isActive === "boolean" && !targetIsPrimary
        ? body.isActive
        : existing.isActive !== false;

    const authUpdate: {
      displayName: string;
      password?: string;
      disabled?: boolean;
    } = { displayName };
    if (allowPassword && password) authUpdate.password = password;
    if (typeof body.isActive === "boolean" && !targetIsPrimary) {
      authUpdate.disabled = !nextActive;
    }
    await getAdminAuth().updateUser(uid, authUpdate);

    const firestoreUpdate: Record<string, unknown> = {
      displayName,
      phone,
      branchIds: existing.role === "owner" ? [] : branchIds,
    };
    if (allowPassword && password) {
      firestoreUpdate.passwordChangedAt = new Date().toISOString();
    }
    if (permissions && existing.role === "counter") {
      firestoreUpdate.permissions = permissions;
    }
    if (typeof body.isActive === "boolean" && !targetIsPrimary) {
      firestoreUpdate.isActive = nextActive;
    }
    await userRef.set(firestoreUpdate, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

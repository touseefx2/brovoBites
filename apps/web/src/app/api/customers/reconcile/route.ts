import { NextRequest, NextResponse } from "next/server";
import { phoneKey } from "@bravobites/domain";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireActiveUser } from "@/lib/require-owner";
import { reconcileCustomers } from "@/lib/server/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A PC asks for its customers to be brought up to date after its sales or
 * order changes reached the cloud (any active owner / counter user). The
 * numbers are rebuilt from the orders, so asking twice is harmless.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireActiveUser(req);
    if ("error" in gate && gate.error) return gate.error;
    const body = (await req.json().catch(() => null)) as { keys?: unknown } | null;
    const keys = (Array.isArray(body?.keys) ? body!.keys : [])
      .map((k) => phoneKey(typeof k === "string" ? k : ""))
      .filter(Boolean)
      .slice(0, 25);
    if (keys.length === 0) return NextResponse.json({ results: [] });
    const results = await reconcileCustomers(getAdminDb(), keys);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[customers] reconcile", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

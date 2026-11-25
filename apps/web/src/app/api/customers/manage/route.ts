import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireOwner } from "@/lib/require-owner";
import { mergeCustomers, rebuildAllCustomers, renameCustomer } from "@/lib/server/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Owner-only customer changes: rename (a name set by hand), merge two
 * customers (two numbers, one person), or recount everyone from the orders.
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireOwner(req);
    if ("error" in gate && gate.error) return gate.error;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const db = getAdminDb();
    switch (body?.action) {
      case "rename":
        return NextResponse.json({ result: await renameCustomer(db, s(body.key), body.name === null ? null : s(body.name)) });
      case "merge":
        return NextResponse.json({ result: await mergeCustomers(db, s(body.from), s(body.into)) });
      case "rebuild":
        return NextResponse.json({ result: await rebuildAllCustomers(db) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[customers] manage", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { getPublicBranches, PUBLIC_DATA_CACHE_CONTROL } from "@/lib/server/public-menu";

export const dynamic = "force-dynamic";

/**
 * Active branches + their active counter staff (name, phone) for the public
 * website (src/lib/branches-data.ts). Same data as /api/public/branches-staff,
 * but from Next's data cache + the CDN (never more than ~2 minutes old, see
 * PUBLIC_DATA_MAX_AGE_MS), so a landing visit costs no Firestore reads.
 */
export async function GET() {
  try {
    const snap = await getPublicBranches();
    return NextResponse.json(snap, {
      headers: { "Cache-Control": PUBLIC_DATA_CACHE_CONTROL },
    });
  } catch (err) {
    console.warn("[api/public/branches] read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Branches unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

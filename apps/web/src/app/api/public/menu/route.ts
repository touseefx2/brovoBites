import { NextResponse, type NextRequest } from "next/server";
import {
  getPublicMenu,
  getPublicMenuFresh,
  PUBLIC_DATA_CACHE_CONTROL,
} from "@/lib/server/public-menu";

export const dynamic = "force-dynamic";

/**
 * Public menu for the website (src/lib/menu-data.ts): settings + active
 * categories + active products.
 *
 * - Default: Next data cache + CDN (s-maxage 60s, then up to 60s more served
 *   stale while it refreshes) — shoppers rarely wait on Firestore. Never more
 *   than ~2 minutes old at the server (PUBLIC_DATA_MAX_AGE_MS), so a quiet
 *   spell or an edit made on the staff deployment can't leave a visitor on an
 *   old menu for the whole visit.
 * - `?fresh=1`: read Firestore now, never cached (no-store). The browser that
 *   just edited the menu asks this way; a changed menu also refreshes the
 *   cache (and "/") for everyone on this deployment.
 */
export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.has("fresh");
  try {
    const menu = fresh ? await getPublicMenuFresh() : await getPublicMenu({ revalidate: true });
    return NextResponse.json(menu, {
      headers: { "Cache-Control": fresh ? "no-store" : PUBLIC_DATA_CACHE_CONTROL },
    });
  } catch (err) {
    console.warn("[api/public/menu] read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Menu unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

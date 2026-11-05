import { preconnect } from "react-dom";
import { LandingPage } from "@/components/LandingPage";
import { imageCdnOrigin } from "@/lib/image-cdn";
import { PublicMenuProvider } from "@/lib/menu-context";
import { getPublicBranchesForPage, getPublicMenuForPage } from "@/lib/server/public-menu";

/**
 * Public website. The menu and branches are read on the server (Admin SDK,
 * cached) and rendered into the HTML, regenerated at most once a minute (ISR).
 * The browser then keeps them fresh through /api/public/menu. If Firestore
 * can't be read at build (or in dev), the page renders without them and the
 * browser loads them; a failed revalidation keeps serving the last good page.
 */
export const revalidate = 60;

function remoteOrigin(url: string | undefined): string | null {
  try {
    const u = new URL((url ?? "").trim());
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [menu, branches] = await Promise.all([getPublicMenuForPage(), getPublicBranchesForPage()]);

  // An uploaded logo is a plain <img> from its CDN, painted in the first screen.
  const logoOrigin = remoteOrigin(menu?.settings.logoUrl);
  if (logoOrigin) preconnect(logoOrigin);
  // Hero + menu photos come from the image CDN as CORS requests (crossOrigin="anonymous"),
  // which use their own connection — warm that one up during the intro.
  const photoOrigin = imageCdnOrigin();
  if (photoOrigin) preconnect(photoOrigin, { crossOrigin: "anonymous" });

  return (
    <PublicMenuProvider initial={menu} initialBranches={branches}>
      <LandingPage />
    </PublicMenuProvider>
  );
}

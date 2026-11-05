"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_SETTINGS, type Category, type Product, type ShopSettings } from "@bravobites/domain";
import { mapFirebaseError } from "@/lib/errors";
import {
  invalidatePublicMenuCache,
  isFreshServerMenu,
  isMenuFresh,
  loadPublicMenu,
  peekPublicMenu,
  primePublicMenu,
  subscribeMenuCacheInvalidation,
  type PublicMenuSnapshot,
} from "@/lib/menu-data";
import { primeBranches, type BranchesSnapshot } from "@/lib/branches-data";

type MenuStatus = "loading" | "ready" | "revalidating" | "error";

type PublicMenuContextValue = {
  settings: ShopSettings;
  categories: Category[];
  products: Product[];
  branchId: string | null;
  status: MenuStatus;
  error: string | null;
  /** True when we have something to render (cache or network). */
  hasData: boolean;
  /** Full-screen boot loader only when first load with no cache. */
  showBootLoader: boolean;
  refresh: (force?: boolean) => Promise<void>;
  invalidate: () => void;
  /** usePublicMenu() screens register here; the menu is fetched only while one is mounted. */
  retain: () => () => void;
};

const PublicMenuContext = createContext<PublicMenuContextValue | null>(null);

function snapshotToState(snap: PublicMenuSnapshot | null) {
  return {
    settings: snap?.settings ?? DEFAULT_SETTINGS,
    categories: snap?.categories ?? [],
    products: snap?.products ?? [],
    branchId: snap?.branchId ?? null,
  };
}

export function PublicMenuProvider({
  children,
  initial = null,
  initialBranches,
}: {
  children: ReactNode;
  /**
   * Menu read on the server ("/" renders it into the HTML). Without it the
   * provider starts empty and loads in the browser (staff routes).
   */
  initial?: PublicMenuSnapshot | null;
  /**
   * Branches read on the server ("/" passes them, null when unreadable),
   * handed to branches-data for the landing. Omitted on staff routes.
   */
  initialBranches?: BranchesSnapshot | null;
}) {
  // Start from the server's menu (or empty) so server HTML === first client
  // paint (no hydration mismatch). A newer localStorage copy is applied in
  // useLayoutEffect, before the hydrated frame paints.
  const [snap, setSnap] = useState<PublicMenuSnapshot | null>(initial);
  const [status, setStatus] = useState<MenuStatus>(initial ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [bootChecked, setBootChecked] = useState(initial != null);
  // Before any child renders or runs effects (the landing reads branches in
  // its own layout effect, which runs before this provider's).
  useState(() => {
    if (initialBranches !== undefined) primeBranches(initialBranches);
    return null;
  });
  /** Mounted menu screens (landing page, menu). None → POS / admin: no menu fetch. */
  const [users, setUsers] = useState(0);
  const active = users > 0;
  /** Settings read for the logo while no menu screen is mounted (newer than snap). */
  const [logoSettings, setLogoSettings] = useState<ShopSettings | null>(null);

  const applySnap = useCallback((next: PublicMenuSnapshot) => {
    setSnap(next);
    setLogoSettings(null);
    setError(null);
    setStatus("ready");
  }, []);

  const retain = useCallback(() => {
    setUsers((n) => n + 1);
    return () => setUsers((n) => n - 1);
  }, []);

  const refresh = useCallback(async (force = false) => {
    const cached = peekPublicMenu();

    if (cached && isMenuFresh(cached) && (!force || isFreshServerMenu(cached))) {
      applySnap(cached);
      return;
    }

    setStatus((prev) => {
      if (prev === "ready" || prev === "revalidating" || cached) {
        return "revalidating";
      }
      return "loading";
    });
    if (!cached) setError(null);

    try {
      const next = await loadPublicMenu({ force });
      applySnap(next);
    } catch (e) {
      const message = mapFirebaseError(e);
      const stillCached = peekPublicMenu();
      if (stillCached) {
        setSnap(stillCached);
        setError(force ? message : null);
        setStatus("ready");
      } else {
        setSnap((current) => {
          if (current) {
            setError(force ? message : null);
            setStatus("ready");
            return current;
          }
          setError(message);
          setStatus("error");
          return current;
        });
      }
    }
  }, [applySnap]);

  const invalidate = useCallback(() => {
    invalidatePublicMenuCache();
    void refresh(true);
  }, [refresh]);

  useLayoutEffect(() => {
    if (initial) primePublicMenu(initial);
    const cached = peekPublicMenu();
    if (cached && cached !== initial) applySnap(cached);
    setBootChecked(true);
    // Mount only: `initial` is the server render's menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySnap]);

  // No menu screen mounted (POS, admin, login): only the logo reads this
  // context — the (CDN-cached) menu once when nothing is cached, and again
  // after a menu save.
  useEffect(() => {
    if (active) return;
    let alive = true;
    const loadLogo = () => {
      void loadPublicMenu({ force: true }).then(
        (s) => {
          if (alive) setLogoSettings(s.settings);
        },
        () => {},
      );
    };
    if (!peekPublicMenu()) loadLogo();
    const unsubMenu = subscribeMenuCacheInvalidation(loadLogo);
    return () => {
      alive = false;
      unsubMenu();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void refresh(true);

    function onFocus() {
      const latest = peekPublicMenu();
      if (!isMenuFresh(latest)) void refresh(true);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") onFocus();
    }
    /** Net back while sitting on landing/cached UI — same APIs as first load, no boot loader. */
    function onOnline() {
      void refresh(true);
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const unsubMenu = subscribeMenuCacheInvalidation(() => {
      void refresh(true);
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      unsubMenu();
    };
  }, [active, refresh]);

  const value = useMemo<PublicMenuContextValue>(() => {
    const base = snapshotToState(snap);
    const hasResolvedSnap = snap != null;
    return {
      ...base,
      settings: logoSettings ?? base.settings,
      status,
      error,
      hasData: hasResolvedSnap,
      showBootLoader: !bootChecked || (status === "loading" && !hasResolvedSnap),
      refresh,
      invalidate,
      retain,
    };
  }, [snap, logoSettings, status, error, refresh, invalidate, retain, bootChecked]);

  return (
    <PublicMenuContext.Provider value={value}>{children}</PublicMenuContext.Provider>
  );
}

/** Full menu (landing / menu screens): while mounted, the provider fetches and keeps it fresh. */
export function usePublicMenu() {
  const ctx = useContext(PublicMenuContext);
  const retain = ctx?.retain;
  useEffect(() => retain?.(), [retain]);
  if (!ctx) {
    throw new Error("usePublicMenu must be used within PublicMenuProvider");
  }
  return ctx;
}

/** Cached menu / logo only — never makes the provider fetch the menu. */
export function usePublicMenuOptional() {
  return useContext(PublicMenuContext);
}

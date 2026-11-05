"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { UserRole } from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { fetchBranches } from "@/lib/firestore";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BrandLogo } from "@/components/Brand";
import { NavigationProgress } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { MessageKey } from "@/i18n/dictionaries";
import { checkLogout, reloadToLogin, stockChangesUploaded, syncBeforeLogout, type LogoutBlock } from "@/lib/logout-guard";

type NavIconName =
  | "dash"
  | "branch"
  | "menu"
  | "staff"
  | "orders"
  | "pos"
  | "landing"
  | "expenses"
  | "inventory"
  | "itemSales"
  | "dayReport"
  | "cashDrawer"
  | "ownerReport";

type NavGroup = "main" | "sales" | "shop" | "manage";

/** Primary nav — POS is rendered separately as a top CTA */
const links: {
  href: string;
  key: MessageKey;
  icon: NavIconName;
  roles: UserRole[];
  group: NavGroup;
}[] = [
  { href: "/admin", key: "dashboard", icon: "dash", roles: ["owner", "counter"], group: "main" },
  { href: "/admin/orders", key: "orders", icon: "orders", roles: ["owner", "counter"], group: "sales" },
  { href: "/admin/item-sales", key: "itemSales", icon: "itemSales", roles: ["owner", "counter"], group: "sales" },
  { href: "/admin/day-report", key: "dayEndReport", icon: "dayReport", roles: ["owner", "counter"], group: "sales" },
  { href: "/admin/owner-report", key: "ownerReport", icon: "ownerReport", roles: ["owner", "counter"], group: "sales" },
  { href: "/admin/menu", key: "menu", icon: "menu", roles: ["owner", "counter"], group: "shop" },
  { href: "/admin/inventory", key: "inventory", icon: "inventory", roles: ["owner", "counter"], group: "shop" },
  { href: "/admin/expenses", key: "expenses", icon: "expenses", roles: ["owner", "counter"], group: "shop" },
  { href: "/admin/cash-drawer", key: "cashDrawer", icon: "cashDrawer", roles: ["owner", "counter"], group: "shop" },
  { href: "/admin/branches", key: "branches", icon: "branch", roles: ["owner"], group: "manage" },
  { href: "/admin/staff", key: "staff", icon: "staff", roles: ["owner"], group: "manage" },
  { href: "/admin/landing", key: "landingPage", icon: "landing", roles: ["owner"], group: "manage" },
];

const GROUPS: { id: NavGroup; label: MessageKey | null }[] = [
  { id: "main", label: null },
  { id: "sales", label: "navGroupSales" },
  { id: "shop", label: "navGroupShop" },
  { id: "manage", label: "navGroupManage" },
];

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "dash":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
        </svg>
      );
    case "branch":
      return (
        <svg {...common}>
          <path d="M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6V3" />
          <path d="M12 15v6" />
          <circle cx="6" cy="3" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="18" cy="3" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="21" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 5h16v14H4z" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case "staff":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M2.5 19c.8-3.2 3-5 6.5-5s5.7 1.8 6.5 5" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M16 19c.4-1.8 1.6-3 3.5-3.5" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path d="M8 3h8l1 3H7l1-3z" />
          <path d="M6 6h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6z" />
          <path d="M10 11h4M10 15h4" />
        </svg>
      );
    case "landing":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M3 9h18" />
          <path d="M8 13h5M8 16h3" />
        </svg>
      );
    case "pos":
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="16" rx="2.5" />
          <path d="M2 9h20" />
          <path d="M6 13h3M11 13h3M16 13h2M6 16h5" />
        </svg>
      );
    case "expenses":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10M15.5 9.5A2.8 2.8 0 0 0 12 8h0a2.8 2.8 0 0 0 0 5.5h0A2.8 2.8 0 0 1 12 19h0a2.8 2.8 0 0 1-3.5-1.5" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...common}>
          <path d="M21 10V8l-9-5-9 5v2l9 5 9-5z" />
          <path d="M3 10v8l9 5 9-5v-8" />
          <path d="M12 15v8" />
        </svg>
      );
    case "itemSales":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 15l3.5-4 3 2.5L19 7" />
          <circle cx="19" cy="7" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "dayReport":
      return (
        <svg {...common}>
          <path d="M8 3h7l5 5v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M15 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case "ownerReport":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "cashDrawer":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 10h18" />
          <circle cx="12" cy="15" r="2" />
          <path d="M12 10v2" />
        </svg>
      );
  }
}

function titleCaseName(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function roleLabel(role: UserRole | undefined, t: (k: MessageKey) => string) {
  if (role === "owner") return t("roleOwner");
  return t("roleStaff");
}

function isActiveHref(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Red sticker CTA to the till — always visible above the nav. */
function OpenPosLink({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLocale();
  return (
    <Link href="/pos" onClick={onNavigate} className="admin-nav-pos">
      <span className="admin-nav-pos-icon" aria-hidden>
        <NavIcon name="pos" />
      </span>
      <span className="min-w-0 flex-1 truncate">{t("openPos")}</span>
      <svg
        className="admin-nav-pos-arrow"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

function NavLinks({
  pathname,
  onNavigate,
  idPrefix,
}: {
  pathname: string;
  onNavigate?: () => void;
  idPrefix: string;
}) {
  const { t } = useLocale();
  const { profile } = useAuth();
  const role = profile?.role ?? "counter";
  const visible = links.filter((l) => l.roles.includes(role));
  const navRef = useRef<HTMLElement>(null);

  // Short screens scroll the nav: keep the current page's link in view.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>(".admin-nav-link.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  return (
    <nav ref={navRef} className="admin-nav">
      {GROUPS.map((g) => {
        const items = visible.filter((l) => l.group === g.id);
        if (!items.length) return null;
        const labelId = `${idPrefix}-nav-${g.id}`;
        return (
          <div
            key={g.id}
            className="admin-nav-group"
            role={g.label ? "group" : undefined}
            aria-labelledby={g.label ? labelId : undefined}
          >
            {g.label ? (
              <p id={labelId} className="admin-nav-group-label">
                {t(g.label)}
              </p>
            ) : null}
            {items.map((l) => {
              const active = isActiveHref(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`admin-nav-link${active ? " is-active" : ""}`}
                >
                  <span className="admin-nav-icon" aria-hidden>
                    <NavIcon name={l.icon} />
                  </span>
                  <span className="min-w-0 truncate">{t(l.key)}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "B";
  const first = Array.from(parts[0]!)[0] ?? "";
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? "") : "";
  return (first + second).toUpperCase();
}

function SidebarBody({
  pathname,
  onNavigate,
  idPrefix,
}: {
  pathname: string;
  onNavigate?: () => void;
  /** Unique per rendered copy (desktop rail / phone drawer) for aria ids. */
  idPrefix: string;
}) {
  const { profile, logout, activeBranchId } = useAuth();
  const { t } = useLocale();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutBlocked, setLogoutBlocked] = useState<LogoutBlock | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const displayName = titleCaseName(
    profile?.displayName || profile?.email?.split("@")[0] || "",
  );
  const email = (profile?.email || "").trim();
  const role = roleLabel(profile?.role, t);

  useEffect(() => {
    if (!activeBranchId || profile?.role === "owner") return;
    fetchBranches()
      .then((branches) => {
        const b = branches.find((x) => x.id === activeBranchId);
        setBranchName(b?.name ?? null);
      })
      .catch(() => {});
  }, [activeBranchId, profile?.role]);

  // The check asks the login server (a few seconds when the line is down):
  // extra clicks meanwhile don't start more checks / dialogs.
  const logoutCheck = useRef(false);
  async function tryLogout() {
    if (logoutCheck.current) return;
    logoutCheck.current = true;
    try {
      const { block, unsynced } = await checkLogout();
      setLogoutFailed(unsynced);
      if (block) setLogoutBlocked(block);
      else setConfirmLogout(true);
    } finally {
      logoutCheck.current = false;
    }
  }

  async function doLogout() {
    setLoggingOut(true);
    try {
      // Re-check: something may have been queued while the dialog was open.
      const { block } = await checkLogout();
      if (block) {
        setConfirmLogout(false);
        setLogoutBlocked(block);
        return;
      }
      // Upload this person's waiting work under their name first.
      const left = await syncBeforeLogout();
      // That took a while and work is left: the line may have dropped
      // meanwhile — check again, nobody could log back in without it.
      if (left > 0) {
        const again = await checkLogout();
        if (again.block) {
          setConfirmLogout(false);
          setLogoutBlocked(again.block);
          return;
        }
      }
      // Stock changes go up only while their author is signed in: never leave them behind.
      if (!(await stockChangesUploaded())) {
        setConfirmLogout(false);
        setLogoutBlocked({ kind: "stock" });
        return;
      }
      await logout();
      reloadToLogin();
    } finally {
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="admin-side-brand">
        <span className="admin-side-badge">
          <BrandLogo size="sm" />
        </span>
        <div className="min-w-0">
          <p className="admin-side-wordmark" id={`${idPrefix}-side-wordmark`}>
            Brovo Bites
          </p>
          <h1 className="admin-side-role" id={`${idPrefix}-side-role`}>
            {profile?.role === "owner" ? t("admin") : t("counter")}
          </h1>
          {profile?.role !== "owner" && branchName ? (
            <p className="admin-side-branch">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate">{branchName}</span>
            </p>
          ) : null}
        </div>
      </div>

      <OpenPosLink onNavigate={onNavigate} />

      <div className="admin-side-scroll">
        <NavLinks pathname={pathname} onNavigate={onNavigate} idPrefix={idPrefix} />
      </div>

      <div className="admin-side-foot">
        <div className="admin-user-card">
          <span className="admin-user-avatar" aria-hidden>
            {initials(displayName || role)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="admin-user-role">{role}</p>
            <p className="admin-user-name">{displayName || "—"}</p>
            {email ? (
              <p className="admin-user-email" dir="ltr" title={email}>
                {email}
              </p>
            ) : null}
          </div>
        </div>

        <div className="admin-side-actions">
          <LanguageToggle className="w-full" menuPlacement="up" />
          <button
            className="admin-logout-btn"
            type="button"
            onClick={() => void tryLogout()}
          >
            <svg
              className="size-4 shrink-0 rtl:-scale-x-100"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>{t("logout")}</span>
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(logoutBlocked)}
        title={t(logoutBlocked?.kind === "stock" ? "logoutStockTitle" : "logoutOfflineTitle")}
        message={t(logoutBlocked?.kind === "stock" ? "logoutStockBody" : "logoutOfflineBody")}
        confirmLabel={t("ok")}
        cancelLabel={t("ok")}
        hideCancel
        focusConfirm
        onCancel={() => setLogoutBlocked(null)}
        onConfirm={() => setLogoutBlocked(null)}
      />

      <ConfirmDialog
        open={confirmLogout}
        title={t("confirmLogoutTitle")}
        message={
          logoutFailed > 0
            ? t("logoutFailedWarning").replace("{n}", String(logoutFailed))
            : t("confirmLogout")
        }
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={loggingOut}
        danger
        onCancel={() => {
          if (!loggingOut) setConfirmLogout(false);
        }}
        onConfirm={() => void doLogout()}
      />
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { profile, activeBranchId } = useAuth();
  const [open, setOpen] = useState(false);
  const [mobileBranchName, setMobileBranchName] = useState<string | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!activeBranchId || profile?.role === "owner") return;
    fetchBranches()
      .then((branches) => {
        const b = branches.find((x) => x.id === activeBranchId);
        setMobileBranchName(b?.name ?? null);
      })
      .catch(() => {});
  }, [activeBranchId, profile?.role]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // The drawer is phone/tablet only: close it if the window grows to the desktop rail,
    // so the (inert) page behind it never stays locked.
    const desktop = window.matchMedia("(min-width: 768px)");
    const onDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    onDesktop();
    desktop.addEventListener("change", onDesktop);
    document.body.style.overflow = "hidden";
    // Start keyboard / screen-reader users inside the drawer.
    closeBtnRef.current?.focus();
    const menuBtn = menuBtnRef.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
      document.body.style.overflow = "";
      // Back to the hamburger, unless something else already took focus.
      const active = document.activeElement;
      if (menuBtn?.isConnected && (!active || active === document.body)) {
        menuBtn.focus({ preventScroll: true });
      }
    };
  }, [open]);

  /** Keep Tab inside the drawer (or inside a dialog opened from it, e.g. "Log out?"). */
  function trapDrawerTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const root = drawerRef.current;
    if (!root) return;
    const scope = root.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]') ?? root;
    const items = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0 && !el.classList.contains("admin-drawer-backdrop"));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !scope.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !scope.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  const fullBleed = pathname === "/admin/menu" || pathname === "/admin/view-menu";

  return (
    <div className="admin-shell app-shell-bg flex h-dvh overflow-hidden">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <aside className="admin-sidebar admin-rail hidden h-dvh shrink-0 flex-col md:flex">
        <SidebarBody pathname={pathname} idPrefix="rail" />
      </aside>

      {open ? (
        <div
          ref={drawerRef}
          className="admin-drawer fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-side-wordmark drawer-side-role"
          onKeyDown={trapDrawerTab}
        >
          <button
            type="button"
            className="admin-drawer-backdrop absolute inset-0"
            aria-label={t("close")}
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <aside className="admin-sidebar admin-drawer-panel absolute inset-y-0 start-0 flex h-dvh flex-col overflow-hidden">
            <div className="mb-1 flex shrink-0 justify-end">
              <button
                ref={closeBtnRef}
                type="button"
                className="admin-side-close"
                onClick={() => setOpen(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
                <span>{t("close")}</span>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarBody
                pathname={pathname}
                idPrefix="drawer"
                onNavigate={() => setOpen(false)}
              />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={open}>
        <header className="admin-topbar shrink-0 md:hidden">
          <button
            ref={menuBtnRef}
            type="button"
            className="admin-topbar-menu"
            aria-label={t("openNav")}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <span className="flex w-5 flex-col gap-1" aria-hidden>
              <span className="h-0.5 w-full rounded bg-current" />
              <span className="h-0.5 w-3/4 rounded bg-current" />
              <span className="h-0.5 w-full rounded bg-current" />
            </span>
          </button>
          <span className="admin-side-badge admin-topbar-badge">
            <BrandLogo size="sm" />
          </span>
          <div className="admin-mobile-brand min-w-0 flex-1">
            <p className="admin-topbar-wordmark">Brovo Bites</p>
            <p className="admin-mobile-role truncate">
              {profile?.role === "owner" ? t("admin") : t("counter")}
              {profile?.role !== "owner" && mobileBranchName
                ? ` · ${mobileBranchName}`
                : ""}
            </p>
          </div>
          <LanguageToggle />
        </header>

        <main
          className={
            fullBleed
              ? "admin-main flex min-h-0 flex-1 flex-col overflow-hidden"
              : "admin-main min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:p-6 lg:p-8"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}

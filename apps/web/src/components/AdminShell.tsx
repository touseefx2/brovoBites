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

/** Primary nav — POS is rendered separately as a top CTA */
const links: {
  href: string;
  key: MessageKey;
  icon: NavIconName;
  roles: UserRole[];
}[] = [
  { href: "/admin", key: "dashboard", icon: "dash", roles: ["owner", "counter"] },
  { href: "/admin/orders", key: "orders", icon: "orders", roles: ["owner", "counter"] },
  { href: "/admin/menu", key: "menu", icon: "menu", roles: ["owner", "counter"] },
  { href: "/admin/item-sales", key: "itemSales", icon: "itemSales", roles: ["owner", "counter"] },
  { href: "/admin/expenses", key: "expenses", icon: "expenses", roles: ["owner", "counter"] },
  { href: "/admin/inventory", key: "inventory", icon: "inventory", roles: ["owner", "counter"] },
  { href: "/admin/day-report", key: "dayEndReport", icon: "dayReport", roles: ["owner", "counter"] },
  { href: "/admin/cash-drawer", key: "cashDrawer", icon: "cashDrawer", roles: ["owner", "counter"] },
  { href: "/admin/owner-report", key: "ownerReport", icon: "ownerReport", roles: ["owner", "counter"] },
  { href: "/admin/branches", key: "branches", icon: "branch", roles: ["owner"] },
  { href: "/admin/staff", key: "staff", icon: "staff", roles: ["owner"] },
  { href: "/admin/landing", key: "landingPage", icon: "landing", roles: ["owner"] },
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

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const { profile } = useAuth();
  const role = profile?.role ?? "counter";
  const visible = links.filter((l) => l.roles.includes(role));
  const showPos = role === "owner" || role === "counter";

  return (
    <nav className="admin-nav flex flex-col gap-1">
      {showPos ? (
        <Link
          href="/pos"
          onClick={onNavigate}
          className="admin-nav-pos mb-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold shadow-md transition hover:brightness-110"
        >
          <NavIcon name="pos" />
          {t("openPos")}
        </Link>
      ) : null}

      {visible.map((l) => {
        const active =
          l.href === "/admin"
            ? pathname === "/admin"
            : pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
            className={`admin-nav-link group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-semibold transition ${
              active ? "is-active" : ""
            }`}
          >
            <span className="admin-nav-icon flex size-8 shrink-0 items-center justify-center rounded-lg">
              <NavIcon name={l.icon} />
            </span>
            <span className="min-w-0 truncate">{t(l.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
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
      <div className="admin-side-brand shrink-0 px-0.5 pb-4">
        <div className="flex items-center gap-3">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="admin-side-eyebrow truncate text-[10px] font-bold uppercase tracking-[0.16em]">
              Bravo Bites
            </p>
            <h1 className="truncate text-base font-bold leading-tight">
              {profile?.role === "owner" ? t("admin") : t("counter")}
            </h1>
            {profile?.role !== "owner" && branchName ? (
              <p className="admin-side-muted truncate text-xs">{branchName}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pe-0.5">
        <NavLinks pathname={pathname} onNavigate={onNavigate} />
      </div>

      <div className="admin-side-foot mt-3 shrink-0 space-y-2.5 border-t pt-3">
        <div className="admin-user-strip px-1">
          <p className="admin-side-eyebrow text-[10px] font-bold uppercase tracking-[0.16em]">
            {role}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold capitalize leading-tight">
            {displayName || "—"}
          </p>
          {email ? (
            <p
              className="admin-side-muted mt-0.5 truncate text-[12px] leading-snug"
              dir="ltr"
              title={email}
            >
              {email}
            </p>
          ) : null}
        </div>

        <LanguageToggle className="w-full" menuPlacement="up" />
        <button
          className="admin-logout-btn inline-flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition"
          type="button"
          onClick={() => void tryLogout()}
        >
          <svg
            className="size-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="min-w-0 flex-1 text-start">{t("logout")}</span>
        </button>
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
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="app-shell-bg flex h-dvh overflow-hidden">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <aside className="admin-sidebar hidden h-dvh w-[16.5rem] shrink-0 flex-col p-3.5 md:flex">
        <SidebarBody pathname={pathname} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label={t("close")}
            onClick={() => setOpen(false)}
          />
          <aside className="admin-sidebar absolute inset-y-0 start-0 flex h-dvh w-[min(18.5rem,88vw)] flex-col overflow-hidden p-3.5 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] shadow-2xl">
            <div className="mb-1 flex shrink-0 justify-end">
              <button
                type="button"
                className="admin-side-close rounded-lg px-2.5 py-1.5 text-sm font-semibold"
                onClick={() => setOpen(false)}
              >
                {t("close")}
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarBody pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-white px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:gap-3 sm:px-4 md:hidden">
          <button
            type="button"
            className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white text-[var(--ink)]"
            aria-label={t("openNav")}
            onClick={() => setOpen(true)}
          >
            <span className="flex w-5 flex-col gap-1" aria-hidden>
              <span className="h-0.5 w-full rounded bg-current" />
              <span className="h-0.5 w-full rounded bg-current" />
              <span className="h-0.5 w-full rounded bg-current" />
            </span>
          </button>
          <div className="admin-mobile-brand min-w-0 flex-1 py-0.5">
            <p className="truncate text-sm font-bold leading-snug text-[var(--ink)]">
              Bravo Bites
            </p>
            <p className="admin-mobile-role text-xs text-[var(--muted)]">
              {profile?.role === "owner" ? t("admin") : t("counter")}
              {profile?.role !== "owner" && mobileBranchName
                ? ` · ${mobileBranchName}`
                : ""}
            </p>
          </div>
          <LanguageToggle />
          <BrandLogo size="sm" />
        </header>

        <main
          className={
            pathname === "/admin/menu" || pathname === "/admin/view-menu"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:p-6 md:p-8"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}

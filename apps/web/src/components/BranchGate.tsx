"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Branch } from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchBranches } from "@/lib/firestore";
import { BrandLogo, BrandTitle } from "@/components/Brand";
import { LanguageToggle } from "@/components/LanguageToggle";
import { AtmosphereBg } from "@/components/AtmosphereBg";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function BranchGate({ children }: { children: ReactNode }) {
  const { profile, activeBranchId } = useAuth();

  if (!profile) return null;
  if (profile.role === "owner") return <>{children}</>;
  if (activeBranchId && profile.branchIds.includes(activeBranchId)) {
    return <>{children}</>;
  }

  return <BranchPicker />;
}

function BranchPicker() {
  const { profile, setActiveBranch, logout, error: authError, clearError } = useAuth();
  const { t } = useLocale();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (!profile) return;
    fetchBranches()
      .then((all) => {
        const allowed = all.filter(
          (b) => b.isActive && profile.branchIds.includes(b.id),
        );
        setBranches(allowed);
        if (allowed.length === 1) {
          setSelected(allowed[0].id);
        }
        if (allowed.length === 0) {
          setError(t("noBranchAssigned"));
        }
      })
      .catch((e) => setError(mapFirebaseError(e)))
      .finally(() => setLoading(false));
  }, [profile, t]);

  function onConfirm() {
    if (!selected) return;
    clearError();
    const ok = setActiveBranch(selected);
    if (!ok) {
      setError(t("noBranchAssigned"));
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  }

  const noBranches = !loading && branches.length === 0;

  return (
    <main className="login-page relative flex min-h-svh justify-center overflow-y-auto overscroll-y-contain">
      <div className="login-page-bg" aria-hidden>
        <AtmosphereBg />
        <div className="login-page-scrim" />
      </div>

      <div className="login-panel panel w-full max-w-md">
        <div className="login-panel-lang">
          <LanguageToggle />
        </div>

        <div className="login-panel-brand">
          <BrandLogo size="md" className="login-brand-logo" />
          <BrandTitle />
        </div>

        <div className="login-panel-head">
          <h2 className="login-panel-title">{t("selectYourBranch")}</h2>
          <p className="login-panel-hint">{t("selectBranchHint")}</p>
        </div>

        {authError ? <div className="toast-error mb-2 text-start sm:mb-3">{authError}</div> : null}
        {error && !authError ? <div className="toast-error mb-2 text-start sm:mb-3">{error}</div> : null}

        {loading ? (
          <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
        ) : noBranches ? (
          <div className="space-y-3">
            <button
              className="btn btn-ghost w-full"
              type="button"
              onClick={() => setConfirmLogout(true)}
              disabled={loggingOut}
            >
              {t("logout")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelected(b.id)}
                  className={`min-h-[3rem] rounded-xl border-2 px-4 py-3 text-start text-sm font-semibold transition ${
                    selected === b.id
                      ? "border-[var(--gold-deep)] bg-[var(--gold)]/20 text-[var(--ink)] shadow-sm"
                      : "border-[var(--border)] bg-white/80 text-[var(--ink)] hover:border-[var(--gold)]"
                  }`}
                >
                  {b.name}
                  {b.address ? (
                    <span className="mt-0.5 block text-xs font-normal text-[var(--muted)]">
                      {b.address}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <button
              className="btn w-full py-3"
              type="button"
              disabled={!selected}
              onClick={onConfirm}
            >
              {t("confirmBranch")}
            </button>

            <button
              className="btn btn-ghost w-full"
              type="button"
              onClick={() => setConfirmLogout(true)}
              disabled={loggingOut}
            >
              {t("logout")}
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title={t("confirmLogoutTitle")}
        message={t("confirmLogout")}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={loggingOut}
        danger
        onCancel={() => {
          if (!loggingOut) setConfirmLogout(false);
        }}
        onConfirm={() => void onLogout()}
      />
    </main>
  );
}

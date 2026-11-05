"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Branch } from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchBranches } from "@/lib/firestore";
import { BrandLogo } from "@/components/Brand";
import { LanguageToggle } from "@/components/LanguageToggle";
import { AtmosphereBg } from "@/components/AtmosphereBg";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * Dark brand header of the staff sign-in card (login page + branch picker):
 * language switch, BB badge, Lilita wordmark, and the cheese drip into the form.
 */
export function AuthPanelHero() {
  return (
    <div className="login-panel-hero">
      <div className="login-panel-lang">
        <LanguageToggle />
      </div>
      <div className="login-panel-brand">
        <BrandLogo size="md" className="login-brand-logo" />
        {/* The logo lockup stays Latin in both languages (POS, admin and loader match). */}
        <h1 className="login-wordmark" lang="en" dir="ltr">
          Brovo Bites
        </h1>
      </div>
    </div>
  );
}

/** Full-screen dark backdrop: hero photo slideshow + brand scrim. */
export function AuthBackdrop() {
  return (
    <div className="login-page-bg" aria-hidden>
      <AtmosphereBg />
      <div className="login-page-scrim" />
    </div>
  );
}

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
      <AuthBackdrop />

      <div className="login-panel panel w-full max-w-md">
        <AuthPanelHero />

        <div className="login-panel-body">
          <div className="login-drip" aria-hidden />
          <div className="login-panel-head">
            <h2 className="login-panel-title">{t("selectYourBranch")}</h2>
            <p className="login-panel-hint">{t("selectBranchHint")}</p>
          </div>

          {authError ? <div className="toast-error login-alert">{authError}</div> : null}
          {error && !authError ? <div className="toast-error login-alert">{error}</div> : null}

          {loading ? (
            <p className="login-panel-status" role="status">
              {t("loading")}
            </p>
          ) : noBranches ? (
            <div className="login-actions">
              <button
                className="btn btn-ghost login-ghost"
                type="button"
                onClick={() => setConfirmLogout(true)}
                disabled={loggingOut}
              >
                {t("logout")}
              </button>
            </div>
          ) : (
            <div className="login-actions">
              <div className="login-branch-list">
                {branches.map((b) => {
                  const isSelected = selected === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelected(b.id)}
                      aria-pressed={isSelected}
                      className={`login-branch-option ${isSelected ? "is-selected" : ""}`}
                    >
                      <span className="login-branch-check" aria-hidden>
                        {isSelected ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12l5 5L20 7" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="login-branch-text">
                        <span className="login-branch-name">{b.name}</span>
                        {b.address ? (
                          <span className="login-branch-address">{b.address}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                className="btn login-submit"
                type="button"
                disabled={!selected}
                onClick={onConfirm}
              >
                {t("confirmBranch")}
              </button>

              <button
                className="btn btn-ghost login-ghost"
                type="button"
                onClick={() => setConfirmLogout(true)}
                disabled={loggingOut}
              >
                {t("logout")}
              </button>
            </div>
          )}
        </div>
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

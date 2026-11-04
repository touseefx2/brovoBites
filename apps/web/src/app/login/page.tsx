"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { defaultLandingPath } from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BrandLogo, BrandTitle } from "@/components/Brand";
import { AtmosphereBg } from "@/components/AtmosphereBg";

const EMAIL_KEY = "bravobites.login.email";
/** Old "save password" keys — the password sat in plain text on the shared shop PC. */
const LEGACY_PASSWORD_KEYS = ["bravobites.login.password", "bravobites.login.savePassword"];

/** Only the email is remembered; passwords are never stored by the app. */
function readStoredEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    for (const key of LEGACY_PASSWORD_KEYS) localStorage.removeItem(key);
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email.trim());
  } catch {
    // private mode / quota
  }
}

export default function LoginPage() {
  const { login, profile, loading, error, clearError, firebaseUser } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmail(readStoredEmail());
  }, []);

  useEffect(() => {
    if (!loading && profile && !busy) {
      router.replace(defaultLandingPath(profile.role));
    }
  }, [loading, profile, router, busy]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setBusy(true);
    try {
      await login(email, password);
      persistEmail(email);
    } catch {
      // shown via context
    } finally {
      setBusy(false);
    }
  }

  if (!loading && firebaseUser && profile && !busy) {
    return (
      <main className="login-page relative flex min-h-svh justify-center overflow-y-auto text-white">
        <div className="login-page-bg" aria-hidden>
          <AtmosphereBg />
          <div className="login-page-scrim" />
        </div>
        <p className="relative z-10 py-10">{t("redirecting")}</p>
      </main>
    );
  }

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
          <h2 className="login-panel-title">{t("posLogin")}</h2>
          <p className="login-panel-hint">{t("loginHint")}</p>
        </div>

        {error ? <div className="toast-error mb-2 text-start sm:mb-3">{error}</div> : null}

        <form onSubmit={onSubmit} className="login-form">
          <label className="login-field">
            {t("email")}
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              dir="ltr"
              suppressHydrationWarning
              name="email"
            />
          </label>

          <label className="login-field">
            {t("password")}
            <div className="login-password-wrap">
              <input
                className="input login-password-input"
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                dir="ltr"
                suppressHydrationWarning
                name="password"
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                title={showPassword ? t("hidePassword") : t("showPassword")}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </label>

          <button
            className="btn login-submit"
            type="submit"
            disabled={busy || loading}
          >
            {busy ? t("signingIn") : t("login")}
          </button>
        </form>

        <p className="login-panel-footer">
          <Link
            href="/#menu"
            className="font-semibold text-[var(--gold-deep)] underline-offset-2 hover:underline"
          >
            ← {t("viewMenu")}
          </Link>
        </p>
      </div>
    </main>
  );
}

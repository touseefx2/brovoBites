"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { BranchGate } from "@/components/BranchGate";
import { ActionProvider } from "@/components/ActionProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BrandLogo } from "@/components/Brand";
import { useLocale } from "@/i18n/locale-context";

/** Standalone audit view — no admin sidebar / menu. */
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLocale();

  return (
    <RequireAuth roles={["owner", "counter"]}>
      <BranchGate>
        <ActionProvider>
          <div className="min-h-dvh bg-[var(--bg)]">
            <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[#fff7ee]/95 backdrop-blur-sm">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <BrandLogo size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--ink)]">
                      {t("activityLog")}
                    </p>
                    <p className="truncate text-[11px] text-[var(--muted)]">
                      {t("activityLogHint")}
                    </p>
                  </div>
                </div>
                <LanguageToggle />
              </div>
            </header>
            <main className="mx-auto w-full max-w-3xl px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-6">
              {children}
            </main>
          </div>
        </ActionProvider>
      </BranchGate>
    </RequireAuth>
  );
}

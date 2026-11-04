"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocale } from "@/i18n/locale-context";
import {
  notifyActionFailed,
  runGuardedAction,
  type ActionWorkContext,
} from "@/lib/action";

interface ActionContextValue {
  busy: boolean;
  label: string | null;
  /** Run a CTA: online check, loader, abort on offline, safety timeout (no stuck loader). */
  runAction: <T>(
    work: (ctx: ActionWorkContext) => Promise<T>,
    options?: { label?: string; silentFail?: boolean },
  ) => Promise<{ ok: true; data: T } | { ok: false; message: string }>;
}

const ActionContext = createContext<ActionContextValue | null>(null);

export function ActionProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const inFlight = useRef(false);

  const runAction = useCallback(
    async <T,>(
      work: (ctx: ActionWorkContext) => Promise<T>,
      options?: { label?: string; silentFail?: boolean },
    ) => {
      if (inFlight.current) {
        return { ok: false as const, message: t("pleaseWait") };
      }
      inFlight.current = true;
      setBusy(true);
      setLabel(options?.label ?? t("pleaseWait"));
      try {
        const result = await runGuardedAction(work, {
          locale,
          offlineMessage: t("errOffline"),
          timeoutMessage: t("errTimeout"),
        });
        if (!result.ok && !options?.silentFail) {
          if (result.message !== t("errOffline")) {
            notifyActionFailed(result.message);
          }
        }
        return result;
      } finally {
        inFlight.current = false;
        setBusy(false);
        setLabel(null);
      }
    },
    [locale, t],
  );

  const value = useMemo(
    () => ({ busy, label, runAction }),
    [busy, label, runAction],
  );

  return (
    <ActionContext.Provider value={value}>
      {children}
      {busy ? (
        <div className="action-overlay" role="status" aria-live="polite">
          <div className="action-overlay-card">
            <span className="spinner" aria-hidden />
            <p className="text-sm font-semibold text-[var(--ink)]">
              {label ?? t("pleaseWait")}
            </p>
          </div>
        </div>
      ) : null}
    </ActionContext.Provider>
  );
}

export function useAction() {
  const ctx = useContext(ActionContext);
  if (!ctx) {
    throw new Error("useAction must be used within ActionProvider");
  }
  return ctx;
}

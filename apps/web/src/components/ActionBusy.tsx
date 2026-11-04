"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocale } from "@/i18n/locale-context";

interface ActionBusyValue {
  busy: boolean;
  runBusy: <T>(fn: () => Promise<T>, label?: string) => Promise<T>;
}

const ActionBusyContext = createContext<ActionBusyValue | null>(null);

export function ActionBusyProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const [depth, setDepth] = useState(0);
  const [label, setLabel] = useState<string | null>(null);

  const runBusy = useCallback(async <T,>(fn: () => Promise<T>, msg?: string) => {
    setLabel(msg ?? null);
    setDepth((d) => d + 1);
    try {
      return await fn();
    } finally {
      setDepth((d) => Math.max(0, d - 1));
      setLabel(null);
    }
  }, []);

  const value = useMemo(
    () => ({ busy: depth > 0, runBusy }),
    [depth, runBusy],
  );

  return (
    <ActionBusyContext.Provider value={value}>
      {children}
      {depth > 0 ? (
        <div className="action-overlay" role="alert" aria-busy="true" aria-live="assertive">
          <div className="action-overlay-card">
            <span className="spinner" aria-hidden />
            <p className="text-sm font-semibold text-[var(--ink)]">
              {label || t("pleaseWait")}
            </p>
            <p className="text-xs text-[var(--muted)]">{t("doNotClose")}</p>
          </div>
        </div>
      ) : null}
    </ActionBusyContext.Provider>
  );
}

export function useActionBusy() {
  const ctx = useContext(ActionBusyContext);
  if (!ctx) {
    return {
      busy: false,
      runBusy: async <T,>(fn: () => Promise<T>) => fn(),
    } satisfies ActionBusyValue;
  }
  return ctx;
}

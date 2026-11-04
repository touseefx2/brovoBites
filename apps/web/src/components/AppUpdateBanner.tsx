"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  applyAppUpdate,
  holdAppUpdate,
  noteAppNavigation,
  useAppUpdatePhase,
} from "@/lib/app-update";
import { useLocale } from "@/i18n/locale-context";
import type { MessageKey } from "@/i18n/dictionaries";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const DIALOGS = {
  cart: ["appUpdateCartTitle", "appUpdateCartBody"],
  offline: ["appUpdateOfflineTitle", "appUpdateOfflineBody"],
  stuck: ["appUpdateStuckTitle", "appUpdateStuckBody"],
} as const satisfies Record<string, readonly [MessageKey, MessageKey]>;

/**
 * Thin strip at the very top while a downloaded version waits for a quiet
 * moment to install itself (app-update.ts); tapping it updates at once. After
 * the reload it briefly says the new version is installed. The POS passes
 * `cartHasItems`: a cart holds the automatic update, and a tap asks the
 * cashier to finish or clear the order first.
 */
export function AppUpdateBanner({
  cartHasItems = false,
  pos = false,
}: {
  cartHasItems?: boolean;
  /** Rendered by the POS page itself (it knows the cart). */
  pos?: boolean;
}) {
  const phase = useAppUpdatePhase();
  const pathname = usePathname();
  const { t } = useLocale();
  const [starting, setStarting] = useState(false);
  const [dialog, setDialog] = useState<keyof typeof DIALOGS | null>(null);

  useEffect(() => (cartHasItems ? holdAppUpdate() : undefined), [cartHasItems]);

  // Opening another page is a natural moment to switch (the global copy only —
  // it is mounted on every page).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pos || lastPath.current === pathname) return;
    lastPath.current = pathname;
    noteAppNavigation();
  }, [pos, pathname]);

  // The global copy stays off the POS, which renders its own with cart state.
  if (!pos && pathname?.startsWith("/pos")) return null;
  if (phase === "none") return null;
  if (phase === "done") {
    // Laid over the page, not in its flow: nothing moves under a finger when
    // it goes, and taps pass through to the header beneath.
    return (
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex h-4 items-center justify-center gap-1 bg-emerald-50 px-2 text-[10px] font-medium leading-none text-emerald-800"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span className="truncate">{t("appUpdated")}</span>
      </div>
    );
  }

  const updating = starting || phase === "applying";

  return (
    <>
      <button
        type="button"
        className="relative z-40 flex h-4 w-full shrink-0 items-center justify-center gap-1 bg-emerald-50 px-2 text-[10px] font-medium leading-none text-emerald-800 hover:bg-emerald-100 disabled:opacity-80"
        disabled={updating}
        onClick={() => {
          if (cartHasItems) {
            setDialog("cart");
            return;
          }
          setStarting(true);
          void applyAppUpdate().then((result) => {
            if (result === "reloading") return;
            setStarting(false);
            setDialog(result);
          });
        }}
      >
        <span className="inline-block h-1 w-1 rounded-full bg-current opacity-70" aria-hidden />
        <span className="truncate">
          {updating ? t("appUpdating") : t("appUpdateAvailable")}
        </span>
        {updating ? null : (
          <span className="font-semibold underline underline-offset-2">{t("appUpdateNow")}</span>
        )}
      </button>
      <ConfirmDialog
        open={dialog !== null}
        title={dialog ? t(DIALOGS[dialog][0]) : ""}
        message={dialog ? t(DIALOGS[dialog][1]) : ""}
        confirmLabel={t("ok")}
        cancelLabel={t("ok")}
        hideCancel
        focusConfirm
        onCancel={() => setDialog(null)}
        onConfirm={() => setDialog(null)}
      />
    </>
  );
}

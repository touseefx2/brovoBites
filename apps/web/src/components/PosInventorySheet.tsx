"use client";

import { useState } from "react";
import type { AppUser, ShopSettings } from "@bravobites/domain";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import { PosActivityLog, PosLogsLink } from "@/components/PosActivityLog";
import { useLocale } from "@/i18n/locale-context";

/**
 * POS Inventory — the admin Inventory panel for the till's branch, in the
 * same sheet as POS Expenses. Works offline: changes save on this PC and sync
 * when the net is back.
 */
export function PosInventorySheet({
  branchId,
  branchName,
  user,
  settings,
  onClose,
}: {
  branchId: string;
  branchName?: string;
  user: AppUser;
  settings: ShopSettings | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-inventory-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-950/60 backdrop-blur-[3px]"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(94dvh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-[#faf7f2] shadow-[0_25px_80px_rgba(0,0,0,0.45)] sm:rounded-3xl">
        <div className="modal-dark-head is-flush flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id="pos-inventory-title" className="modal-dark-gold text-[11px] font-bold uppercase tracking-[0.18em]">
              {t("inventory")}
            </h2>
            {branchName ? <p className="mt-2 truncate text-lg font-bold text-[#f5efe6]">{branchName}</p> : null}
            <p className="modal-dark-muted mt-1 text-xs font-medium">{t("inventoryHintStaff")}</p>
          </div>
          <button
            type="button"
            className="modal-dark-clear -me-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition"
            onClick={onClose}
            aria-label={t("close")}
            title={t("close")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 sm:px-5">
          <InventoryPanel
            branchId={branchId}
            user={user}
            footer={<PosLogsLink entityType="inventory" onClick={() => setLogsOpen(true)} className="mt-2" />}
          />
        </div>
      </div>

      {logsOpen ? (
        <PosActivityLog
          entityType="inventory"
          branchId={branchId}
          branchName={branchName}
          user={user}
          settings={settings}
          onClose={() => setLogsOpen(false)}
        />
      ) : null}
    </div>
  );
}

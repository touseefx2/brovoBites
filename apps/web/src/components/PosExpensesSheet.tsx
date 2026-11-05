"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppUser, BusinessDayHours, Expense, ExpenseCategory, ShopSettings } from "@bravobites/domain";
import {
  EXPENSE_CATEGORIES,
  businessDateKey,
  businessDayHoursFromSettings,
  canDateExpense,
  canDeleteExpense,
  canEditExpense,
  formatOrderDateTime,
  formatPkr,
  money,
  shiftBusinessDateKey,
} from "@bravobites/domain";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PosActivityLog, PosLogsLink } from "@/components/PosActivityLog";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { expenseCategoryLabelKey } from "@/lib/expense-labels";
import { onExpensesSnapshot } from "@/lib/firestore";
import { useSyncedExpenseFill } from "@/lib/use-synced-expense-fill";
import { openDatePicker } from "@/lib/open-date-picker";
import {
  applyPendingExpenseOps,
  enqueueExpense,
  enqueueExpenseDelete,
  enqueueExpenseEdit,
  kickSync,
  listActiveQueuedExpenses,
  subscribeQueue,
  type QueuedExpense,
} from "@/lib/pos-queue";
import { PcClockWrongError, pcClockBlocksSales, shopNow } from "@/lib/shop-clock";

/**
 * POS expense add / edit / delete — saved to IndexedDB first (works offline),
 * then the queue worker writes it to Firestore when the network is back.
 * Staff may edit / delete only their own entries (delete has its own
 * permission); owner any.
 */
export function PosExpensesSheet({
  branchId,
  user,
  settings,
  onClose,
}: {
  branchId: string;
  user: AppUser;
  settings: ShopSettings | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [cloud, setCloud] = useState<Expense[]>([]);
  const [ops, setOps] = useState<QueuedExpense[]>([]);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Re-render now and then so "today" rolls over while the sheet stays open.
  const [, setTick] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  /** Business day picked by hand; null = today (follows the clock). */
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  /** Business day shown in the list; null = today (follows the clock). */
  const [listPicked, setListPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayHours = useMemo(() => businessDayHoursFromSettings(settings), [settings]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const refreshOps = useCallback(() => {
    void listActiveQueuedExpenses().then((list) => {
      setOps(list.filter((q) => q.branchId === branchId));
    });
  }, [branchId]);

  // Re-read the local queue whenever it changes (add / synced / failed).
  useEffect(() => subscribeQueue(refreshOps), [refreshOps]);

  const todayKey = businessDateKey(shopNow(), dayHours);
  const yesterdayKey = shiftBusinessDateKey(todayKey, -1);
  const formDate = pickedDate ?? todayKey;
  // List shows one business day (today by default), by expense date — not entry time.
  const listDate = listPicked ?? todayKey;
  const shownDays = listDate === todayKey ? [todayKey] : [todayKey, listDate];

  // Firestore serves from the local cache when offline. Only the days on
  // screen: today (header total) and the day picked for the list.
  const [cloudFromCache, setCloudFromCache] = useState(false);
  useEffect(() => {
    const days = listDate === todayKey ? [todayKey] : [todayKey, listDate];
    const byDay = new Map<string, Expense[]>();
    const cachedDays = new Set<string>();
    const publish = () => {
      const byId = new Map<string, Expense>();
      for (const list of byDay.values()) for (const e of list) byId.set(e.id, e);
      setCloud([...byId.values()]);
      setCloudFromCache(cachedDays.size > 0);
    };
    const unsubs = days.map((day) =>
      onExpensesSnapshot(
        branchId,
        (e, fromCache) => {
          byDay.set(day, e);
          if (fromCache) cachedDays.add(day);
          else cachedDays.delete(day);
          publish();
        },
        () => {
          byDay.set(day, []);
          publish();
        },
        { fromKey: day, toKey: day, serverConfirm: true },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [branchId, todayKey, listDate]);

  // Offline: expenses this PC already uploaded that the cache never got.
  const fill = useSyncedExpenseFill({ branchId, days: shownDays, cloud, fromCache: cloudFromCache });

  /** Cloud list with pending local add / edit / delete applied, newest first. */
  const { list: all, pendingIds: localIds } = useMemo(
    () => applyPendingExpenseOps(cloudFromCache ? [...fill, ...cloud] : cloud, ops),
    [cloudFromCache, fill, cloud, ops],
  );
  const { todayTotal, todayCount } = useMemo(() => {
    const today = all.filter((e) => e.date === todayKey);
    return { todayTotal: today.reduce((s, e) => s + e.amount, 0), todayCount: today.length };
  }, [all, todayKey]);

  const listMode = listDate === todayKey ? "today" : listDate === yesterdayKey ? "yesterday" : "custom";
  const { dayItems, dayTotal } = useMemo(() => {
    const items = all.filter((e) => e.date === listDate);
    return { dayItems: items, dayTotal: items.reduce((s, e) => s + e.amount, 0) };
  }, [all, listDate]);
  const dayLabel =
    listMode === "today"
      ? t("today")
      : listMode === "yesterday"
        ? t("dateYesterday")
        : formatOrderDateTime(`${listDate}T12:00:00+05:00`).split(" · ")[0];

  const isOwner = user.role === "owner";
  // A PC clock set back (e.g. offline) could reopen a closed day for staff.
  const staffClockBlocked = !isOwner && pcClockBlocksSales();

  /** Edit opens its own popup; the form at the top is only for new expenses. */
  function startEdit(e: Expense) {
    setEditing(e);
    setError(null);
  }

  function stopEdit() {
    setEditing(null);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await enqueueExpenseDelete({ expense: confirmDelete, user, hours: dayHours });
      if (editing?.id === confirmDelete.id) stopEdit();
      setConfirmDelete(null);
      refreshOps();
      void kickSync();
    } catch (e) {
      setConfirmDelete(null);
      setError(mapFirebaseError(e));
    } finally {
      setDeleting(false);
    }
  }

  async function handleAdd() {
    const amt = Number(amount);
    // Without settings we'd fall back to default hours and stamp the wrong business day.
    if (!amt || amt <= 0 || busy || !settings) return;
    // Owner: any day up to today; staff: today only.
    if (!canDateExpense(user, formDate, shopNow().getTime(), dayHours)) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueExpense({
        branchId,
        category,
        description,
        amount: money(amt),
        date: formDate,
        user,
        hours: dayHours,
      });
      refreshOps();
      setAmount("");
      setDescription("");
      // Show the day it was saved to, so a back-dated entry doesn't look lost.
      setListPicked(formDate === todayKey ? null : formDate);
      // Next entry starts on today again — no accidental back-dating.
      setPickedDate(null);
      void kickSync();
    } catch (e) {
      setError(e instanceof PcClockWrongError ? t("pcClockBlocked") : mapFirebaseError(e));
    } finally {
      setBusy(false);
    }
  }

  const amountValue = Number(amount);
  const canAdd =
    !busy &&
    !!settings &&
    amountValue > 0 &&
    canDateExpense(user, formDate, shopNow().getTime(), dayHours);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-expenses-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-950/60 backdrop-blur-[3px]"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(94dvh,50rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-[#fff4e8] shadow-[0_25px_80px_rgba(0,0,0,0.45)] sm:rounded-3xl">
        {/* Header — title + today's total (always visible) */}
        <div className="modal-dark-head is-flush flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id="pos-expenses-title" className="modal-dark-gold text-[11px] font-bold uppercase tracking-[0.18em]">
              {t("expenses")}
            </h2>
            <p className="pos-kpi mt-2 text-[2.125rem] leading-none text-[var(--bb-cream-100)]" dir="ltr">
              {formatPkr(todayTotal)}
            </p>
            <p className="modal-dark-muted mt-2 text-xs font-medium">
              {t("todayExpenses")} · <span className="tabular-nums" dir="ltr">{todayCount}</span>{" "}
              {t("expenseEntries")}
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Entry form — continues the dark header */}
          <form
            className="modal-dark-zone space-y-4 px-5 pb-10 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-t border-[rgba(240,176,40,0.14)] pt-4">
              <p className="text-sm font-bold text-[#fff4e8]">{t("expenseNewEntry")}</p>
              <div className="flex items-center gap-2">
                <input
                  className="modal-dark-input h-9 rounded-lg px-2.5 text-sm tabular-nums outline-none transition [color-scheme:dark] pointer-coarse:h-11 pointer-coarse:text-base"
                  type="date"
                  dir="ltr"
                  aria-label={t("expenseDate")}
                  title={t("expenseDate")}
                  min={isOwner ? undefined : todayKey}
                  max={todayKey}
                  value={formDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPickedDate(v && v !== todayKey ? v : null);
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[13rem_10rem_1fr]">
              <div>
                <span className="modal-dark-muted mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em]">
                  {t("expenseCategory")}
                </span>
                <CategorySelect value={category} onChange={setCategory} dark />
              </div>
              <label className="block">
                <span className="modal-dark-muted mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em]">
                  {t("expenseAmount")}
                </span>
                <div className="relative" dir="ltr">
                  <span className="modal-dark-gold pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-bold">
                    Rs
                  </span>
                  <input
                    className="modal-dark-input h-12 w-full rounded-xl pl-11 pr-3 text-lg font-bold tabular-nums outline-none transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </label>
              <label className="block">
                <span className="modal-dark-muted mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em]">
                  {t("expenseDescription")}
                </span>
                <input
                  className="modal-dark-input h-12 w-full rounded-xl px-3.5 text-base outline-none transition"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t(expenseCategoryLabelKey[category])}
                />
              </label>
            </div>

            {!settings ? (
              <p className="text-xs font-medium text-amber-300">{t("posCatalogNeedNet")}</p>
            ) : null}
            {error ? (
              <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn exp-submit w-full text-base" disabled={!canAdd}>
              {busy
                ? t("saving")
                : amountValue > 0
                  ? <>{t("addExpense")} · <span dir="ltr">{formatPkr(amountValue)}</span></>
                  : t("expenseAmountRequired")}
            </button>
            {!isOwner ? (
              <p className="modal-dark-muted text-center text-[11px]">{t("expenseOwnOnlyHint")}</p>
            ) : null}
          </form>

          {/* List — light sheet tucked over the dark zone */}
          <div className="relative -mt-5 rounded-t-3xl bg-[#fff4e8] px-4 pb-5 pt-5 sm:px-5 dark:shadow-[0_-1px_0_rgba(240,176,40,0.22)]">
            {/* Day filter — today by default; yesterday / any past day on demand. */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex shrink-0 rounded-xl bg-stone-100 p-0.5 text-xs font-semibold">
                {(["today", "yesterday"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={listMode === m}
                    onClick={() => setListPicked(m === "today" ? null : yesterdayKey)}
                    className={`inline-flex min-h-9 min-w-11 items-center justify-center rounded-lg px-3.5 transition pointer-coarse:min-h-11 ${
                      listMode === m ? "bg-white text-[var(--ink)] shadow-sm" : "text-stone-600 hover:text-stone-800"
                    }`}
                  >
                    {m === "today" ? t("dateToday") : t("dateYesterday")}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={listDate}
                max={todayKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= todayKey) setListPicked(v === todayKey ? null : v);
                }}
                onClick={(e) => openDatePicker(e.currentTarget)}
                className={`h-9 rounded-xl border bg-white px-3 text-xs font-semibold tabular-nums outline-none transition focus:border-[var(--gold)] pointer-coarse:h-11 pointer-coarse:text-base ${
                  listMode === "custom" ? "border-[var(--ink)] text-[var(--ink)]" : "border-[var(--border)] text-stone-600"
                }`}
                dir="ltr"
                aria-label={t("expenseDate")}
                title={t("expenseDate")}
              />
            </div>
            {dayItems.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-10 text-center text-sm text-[var(--muted)]">
                {t("noExpensesOnDay")}
              </p>
            ) : (
              <section>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-500">
                    {dayLabel} · <span className="tabular-nums" dir="ltr">{dayItems.length}</span>
                  </span>
                  <span className="text-xs font-bold tabular-nums text-stone-600" dir="ltr">
                    {formatPkr(dayTotal)}
                  </span>
                </div>
                <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(42,20,14,0.04)]">
                  {dayItems.map((e) => {
                    const pending = localIds.has(e.id);
                    const isEditing = editing?.id === e.id;
                    const time = formatOrderDateTime(e.createdAt).split(" · ")[1] ?? "";
                    // Staff: own entries, until that day ends (and a sane PC clock); owner: any.
                    const mayEdit = !staffClockBlocked && canEditExpense(user, e, shopNow().getTime(), dayHours);
                    const mayDelete = !staffClockBlocked && canDeleteExpense(user, e, shopNow().getTime(), dayHours);
                    return (
                      <li
                        key={e.id}
                        className={`flex items-center gap-3 py-3 pe-2 ps-3.5 transition ${
                          isEditing ? "bg-amber-50/70 shadow-[inset_3px_0_0_var(--gold)]" : ""
                        }`}
                      >
                        <span
                          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${CATEGORY_TILE[e.category]}`}
                        >
                          <CategoryIcon category={e.category} size={18} />
                          {pending ? (
                            <span
                              className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white"
                              title={t("recentPendingLocal")}
                              aria-label={t("recentPendingLocal")}
                            />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold leading-snug text-[var(--ink)]">
                            {e.description || t(expenseCategoryLabelKey[e.category])}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-stone-500">
                            <span>{t(expenseCategoryLabelKey[e.category])}</span>
                            <span aria-hidden className="text-stone-300">•</span>
                            <span dir="ltr">{time}</span>
                            <span aria-hidden className="text-stone-300">•</span>
                            <span className="capitalize">{e.createdByName}</span>
                          </p>
                        </div>
                        <p className="shrink-0 text-[15px] font-bold tabular-nums text-red-600" dir="ltr">
                          −{formatPkr(e.amount)}
                        </p>
                        {mayEdit || mayDelete ? (
                          <div className="flex shrink-0 items-center">
                            {mayEdit ? (
                              <button
                                type="button"
                                className={`flex size-10 items-center justify-center rounded-lg transition hover:bg-stone-100 hover:text-[var(--ink)] pointer-coarse:size-11 ${
                                  isEditing ? "text-[var(--gold-deep)]" : "text-stone-400"
                                }`}
                                onClick={() => startEdit(e)}
                                aria-label={t("edit")}
                                title={t("edit")}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                              </button>
                            ) : null}
                            {mayDelete ? (
                              <button
                                type="button"
                                className="flex size-10 items-center justify-center rounded-lg text-stone-400 transition hover:bg-red-50 hover:text-red-600 pointer-coarse:size-11"
                                onClick={() => setConfirmDelete(e)}
                                aria-label={t("delete")}
                                title={t("delete")}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <PosLogsLink entityType="expense" onClick={() => setLogsOpen(true)} className="mt-4" />
          </div>
        </div>
      </div>

      {logsOpen ? (
        <PosActivityLog
          entityType="expense"
          branchId={branchId}
          user={user}
          settings={settings}
          onClose={() => setLogsOpen(false)}
        />
      ) : null}

      {editing ? (
        <EditExpenseDialog
          key={editing.id}
          expense={editing}
          todayKey={todayKey}
          dayHours={dayHours}
          user={user}
          onClose={stopEdit}
          onSaved={() => {
            stopEdit();
            refreshOps();
            void kickSync();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={t("confirmDeleteExpense")}
        message={t("confirmDeleteExpenseBody")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        busy={deleting}
        danger
        onCancel={() => !deleting && setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

/** Category tile on the dark picker. */
const CATEGORY_CHIP: Record<ExpenseCategory, string> = {
  rent: "bg-violet-400/15 text-violet-300",
  salaries: "bg-sky-400/15 text-sky-300",
  utilities: "bg-yellow-400/15 text-yellow-300",
  supplies: "bg-emerald-400/15 text-emerald-300",
  maintenance: "bg-orange-400/15 text-orange-300",
  transport: "bg-blue-400/15 text-blue-300",
  marketing: "bg-pink-400/15 text-pink-300",
  other: "bg-stone-400/15 text-stone-300",
};

/** Category tile on the light list. */
export const CATEGORY_TILE: Record<ExpenseCategory, string> = {
  rent: "bg-violet-50 text-violet-600",
  salaries: "bg-sky-50 text-sky-600",
  utilities: "bg-yellow-50 text-yellow-600",
  supplies: "bg-emerald-50 text-emerald-600",
  maintenance: "bg-orange-50 text-orange-600",
  transport: "bg-blue-50 text-blue-600",
  marketing: "bg-pink-50 text-pink-600",
  other: "bg-stone-100 text-stone-500",
};

export function CategoryIcon({ category, size }: { category: ExpenseCategory; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {CATEGORY_ICON[category]}
    </svg>
  );
}

const CATEGORY_ICON: Record<ExpenseCategory, ReactNode> = {
  rent: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  salaries: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  utilities: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  supplies: (
    <>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  maintenance: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  transport: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
  marketing: (
    <>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  other: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
};

/** Category picker: icon + name on the button, icon list in the dropdown. */
function CategorySelect({
  value,
  onChange,
  dark = false,
}: {
  value: ExpenseCategory;
  onChange: (c: ExpenseCategory) => void;
  dark?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-12 w-full items-center gap-2.5 rounded-xl px-2 text-start text-sm font-semibold outline-none transition ${
          dark ? "modal-dark-input" : "border border-[var(--border)] bg-white text-[var(--ink)] focus-visible:border-[var(--gold)]"
        }`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${dark ? CATEGORY_CHIP[value] : CATEGORY_TILE[value]}`}
          aria-hidden
        >
          <CategoryIcon category={value} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate">{t(expenseCategoryLabelKey[value])}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`me-1 shrink-0 opacity-60 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute start-0 z-30 mt-1.5 grid w-[min(24rem,calc(100vw-3rem))] grid-cols-2 gap-0.5 rounded-xl border border-[var(--border)] bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]"
        >
          {EXPENSE_CATEGORIES.map((c) => {
            const selected = c === value;
            return (
              <li key={c}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm font-medium text-[var(--ink)] transition hover:bg-stone-100 ${
                    selected ? "bg-amber-50" : ""
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${CATEGORY_TILE[c]}`} aria-hidden>
                    <CategoryIcon category={c} size={16} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(expenseCategoryLabelKey[c])}</span>
                  {selected ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--gold-deep)]" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Edit an expense in its own popup (category, amount, date, description). */
export function EditExpenseDialog({
  expense,
  todayKey,
  dayHours,
  user,
  onClose,
  onSaved,
}: {
  expense: Expense;
  todayKey: string;
  dayHours: BusinessDayHours;
  user: AppUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [description, setDescription] = useState(expense.description);
  const [date, setDate] = useState(expense.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount);
  const dirty =
    category !== expense.category ||
    money(amt) !== expense.amount ||
    description.trim() !== expense.description ||
    date !== expense.date;
  // Owner: any day up to today; staff keep the expense's own day.
  const dateOk =
    date === expense.date ||
    (user.role === "owner" && canDateExpense(user, date, shopNow().getTime(), dayHours));
  const canSave = !busy && amt > 0 && dateOk && dirty;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await enqueueExpenseEdit({
        expense,
        changes: { category, description, amount: money(amt), date },
        user,
        hours: dayHours,
      });
      onSaved();
    } catch (e) {
      setError(mapFirebaseError(e));
    } finally {
      setBusy(false);
    }
  }

  const label = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-expense-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-950/55 backdrop-blur-[2px]"
        aria-label={t("close")}
        onClick={() => !busy && onClose()}
      />
      <form
        className="relative z-10 w-full max-w-md rounded-t-3xl bg-[#fff4e8] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.45)] sm:rounded-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--gold-deep)]">{t("expenses")}</p>
            <h3 id="edit-expense-title" className="mt-1 text-lg font-bold text-[var(--ink)]">
              {t("editExpense")}
            </h3>
          </div>
          <button
            type="button"
            className="-me-1.5 flex size-10 shrink-0 items-center justify-center rounded-full pointer-coarse:size-11 text-stone-500 transition hover:bg-stone-200/60 hover:text-[var(--ink)]"
            onClick={() => !busy && onClose()}
            aria-label={t("close")}
            title={t("close")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          <div>
            <span className={label}>{t("expenseCategory")}</span>
            <CategorySelect value={category} onChange={setCategory} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>{t("expenseAmount")}</span>
              <div className="relative" dir="ltr">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-bold text-[var(--gold-deep)]">
                  Rs
                </span>
                <input
                  className="input h-12 w-full text-lg font-bold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  style={{ paddingLeft: "2.75rem" }}
                  type="number"
                  inputMode="decimal"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
              </div>
            </label>
            <label className="block">
              <span className={label}>{t("expenseDate")}</span>
              <input
                className="input h-12 w-full tabular-nums"
                type="date"
                dir="ltr"
                max={todayKey}
                // Staff keep the day it was filed under; the owner may move it.
                disabled={user.role !== "owner"}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className={label}>{t("expenseDescription")}</span>
            <input
              className="input h-12 w-full"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(expenseCategoryLabelKey[category])}
            />
          </label>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn" disabled={!canSave}>
            {busy ? t("saving") : t("saveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}

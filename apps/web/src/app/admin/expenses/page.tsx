"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, Expense, ExpenseCategory } from "@bravobites/domain";
import {
  EXPENSE_CATEGORIES,
  businessDateKey,
  businessDayHoursFromSettings,
  formatPkr,
  money,
  canAddExpenses,
  canDateExpense,
  canEditExpense,
  canDeleteExpense,
  shiftBusinessDateKey,
  startOfBusinessMonthKey,
  type ShopSettings,
} from "@bravobites/domain";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/i18n/locale-context";
import { expenseCategoryLabelKey } from "@/lib/expense-labels";
import { mapFirebaseError } from "@/lib/errors";
import { pcClockBlocksSales, shopNow } from "@/lib/shop-clock";
import { LoadError, PageSpinner } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { SeeActivityLogLink } from "@/components/SeeActivityLogLink";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import {
  createExpense,
  deleteExpense,
  updateExpense,
  fetchBranches,
  onExpensesSnapshot,
  onSettingsSnapshot,
} from "@/lib/firestore";
import { openDatePicker } from "@/lib/open-date-picker";
import {
  applyPendingExpenseOps,
  listActiveQueuedExpenses,
  subscribeQueue,
  type QueuedExpense,
} from "@/lib/pos-queue";
import type { Unsubscribe } from "firebase/firestore";

type DatePreset = "today" | "last7" | "month" | "all" | "custom";

function toInputDate(d: Date, hours?: Parameters<typeof businessDateKey>[1]) {
  return businessDateKey(d, hours);
}

const categoryLabelKey = expenseCategoryLabelKey;

export default function ExpensesPage() {
  const { t, locale } = useLocale();
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const canAdd = profile ? canAddExpenses(profile) : false;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [cloudExpenses, setExpenses] = useState<Expense[]>([]);
  /** POS add/edit/delete on this PC not yet on Firestore. */
  const [pendingOps, setPendingOps] = useState<QueuedExpense[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formCategory, setFormCategory] = useState<ExpenseCategory>("supplies");
  const [formDesc, setFormDesc] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formBranchId, setFormBranchId] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editExpense, setEditExpense] = useState<Expense | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const expenseDatesSyncedRef = useRef(false);

  const dayHours = useMemo(
    () => businessDayHoursFromSettings(settings),
    [settings],
  );

  const todayKey = businessDateKey(shopNow(), dayHours);
  // Staff: own entries until that day ends (edit = add permission, delete =
  // delete permission), filed under today only; owner: any. Staff wait for the
  // shop hours, and for a sane PC clock (set back, it could reopen a closed day).
  const staffBlocked = !isOwner && (!settings || pcClockBlocksSales());
  const canEditRow = (e: Expense) =>
    profile && !staffBlocked ? canEditExpense(profile, e, shopNow().getTime(), dayHours) : false;
  const canDeleteRow = (e: Expense) =>
    profile && !staffBlocked ? canDeleteExpense(profile, e, shopNow().getTime(), dayHours) : false;
  // Branch for a new expense, worked out when saving — the list may still have
  // been loading when the form opened.
  const addBranchId =
    branchId && branchId !== "all"
      ? branchId
      : formBranchId || (branches.length === 1 ? branches[0]!.id : "");
  // Business days the list shows (null = open end) — also all we listen to.
  const rangeKeys = useMemo(() => {
    let fromKey: string | null = null;
    let toKey: string | null = null;
    if (datePreset === "today") {
      fromKey = todayKey;
      toKey = todayKey;
    } else if (datePreset === "last7") {
      fromKey = shiftBusinessDateKey(todayKey, -6);
      toKey = todayKey;
    } else if (datePreset === "month") {
      fromKey = startOfBusinessMonthKey(todayKey);
      toKey = todayKey;
    } else if (datePreset === "custom") {
      fromKey = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : null;
      toKey = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : null;
    }
    return { fromKey, toKey };
  }, [datePreset, dateFrom, dateTo, todayKey]);
  const listFromKey = rangeKeys.fromKey ?? undefined;
  const listToKey = rangeKeys.toKey ?? undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await fetchBranches();
      const allowed = isOwner
        ? b.filter((x) => x.isActive)
        : b.filter((x) => x.isActive && (profile?.branchIds ?? []).includes(x.id));
      setBranches(allowed);
      const nextBranch =
        branchId && (branchId === "all" || allowed.some((x) => x.id === branchId))
          ? branchId
          : isOwner
            ? "all"
            : allowed[0]?.id ?? "";
      setBranchId(nextBranch);
    } catch (e) {
      setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [locale, t, isOwner, profile?.branchIds, branchId]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return onSettingsSnapshot((s) => {
      setSettings(s);
      const hours = businessDayHoursFromSettings(s);
      const today = toInputDate(shopNow(), hours);
      setFormDate(today);
      if (!expenseDatesSyncedRef.current) {
        setDateFrom(today);
        setDateTo(today);
        expenseDatesSyncedRef.current = true;
      }
    });
  }, []);

  // Only the shown dates' expenses ("All" = every expense, as before).
  useEffect(() => {
    if (!branchId || branches.length === 0) return;
    setLoadError(null);
    setLoading(true);
    const unsubs: Unsubscribe[] = [];
    unsubs.push(
      onExpensesSnapshot(
        branchId,
        (items) => {
          setExpenses(items);
          setLoading(false);
        },
        (err) => {
          setLoadError(mapFirebaseError(err, locale) || t("loadFailed"));
          setLoading(false);
        },
        { fromKey: listFromKey, toKey: listToKey },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [branchId, branches, locale, t, listFromKey, listToKey]);

  useRetryOnReconnect(Boolean(loadError) && !loading, () => void load());

  useEffect(() => {
    let alive = true;
    const unsub = subscribeQueue(() => {
      void listActiveQueuedExpenses().then((ops) => {
        if (alive) setPendingOps(ops);
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // Same view as POS on this PC: cloud rows + pending local ops, newest first.
  const { list: expenses, pendingIds } = useMemo(() => {
    const ops =
      branchId === "all"
        ? pendingOps.filter((o) => branches.some((b) => b.id === o.branchId))
        : pendingOps.filter((o) => o.branchId === branchId);
    return applyPendingExpenseOps(cloudExpenses, ops);
  }, [cloudExpenses, pendingOps, branchId, branches]);

  const filtered = useMemo(() => {
    const { fromKey, toKey } = rangeKeys;
    return expenses.filter((e) => {
      if (!fromKey && !toKey) return true;
      // Prefer expense.date (business day) so filters match dashboard / day-end.
      const day = (e.date || e.createdAt || "").slice(0, 10);
      if (fromKey && day < fromKey) return false;
      if (toKey && day > toKey) return false;
      return true;
    });
  }, [expenses, rangeKeys]);

  const filtersActive = datePreset !== "today";

  function resetFilters() {
    setDatePreset("today");
    setDateFrom(toInputDate(shopNow(), dayHours));
    setDateTo(toInputDate(shopNow(), dayHours));
  }

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const e of filtered) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function openEditForm(expense: Expense) {
    setEditExpense(expense);
    setFormCategory(expense.category);
    setFormDesc(expense.description);
    setFormAmount(String(expense.amount));
    setFormDate(expense.date);
    setFormError(null);
    setFormOpen(true);
  }

  function openAddForm() {
    setEditExpense(null);
    setFormCategory("supplies");
    setFormDesc("");
    setFormAmount("");
    setFormDate(toInputDate(shopNow(), dayHours));
    // Branch is required — never leave empty when adding
    setFormBranchId(
      branchId && branchId !== "all"
        ? branchId
        : branches.length === 1
          ? branches[0]!.id
          : "",
    );
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSaveExpense() {
    if (!profile) return;
    const amt = Number(formAmount);
    if (!amt || amt <= 0) return;
    const now = shopNow().getTime();
    // Staff: their own entries until that day ends — new ones filed under
    // today, edits keep their day. The owner may use any day up to today.
    const dateOk =
      editExpense && formDate === editExpense.date
        ? true
        : (isOwner || !editExpense) && canDateExpense(profile, formDate, now, dayHours);
    if (
      staffBlocked ||
      !dateOk ||
      (editExpense && !canEditExpense(profile, editExpense, now, dayHours))
    ) {
      setFormError(t("expenseStaffTodayOnly"));
      return;
    }
    setFormBusy(true);
    setFormError(null);
    try {
      if (editExpense) {
        await updateExpense(editExpense.id, {
          category: formCategory,
          description: formDesc.trim(),
          amount: money(amt),
          date: formDate,
          user: profile,
          previous: editExpense,
        });
      } else {
        const targetBranch = addBranchId;
        if (!targetBranch) {
          setFormError(t("selectBranchRequired"));
          setFormBusy(false);
          return;
        }
        await createExpense({
          branchId: targetBranch,
          category: formCategory,
          description: formDesc.trim(),
          amount: money(amt),
          date: formDate,
          user: profile,
        });
      }
      setFormOpen(false);
      setEditExpense(null);
      setFormDesc("");
      setFormAmount("");
      setFormCategory("supplies");
      setFormBranchId("");
    } catch (e) {
      setFormError(mapFirebaseError(e));
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteId || !profile) return;
    const previous = expenses.find((e) => e.id === deleteId);
    if (!previous) return;
    // The day may have ended while the confirm dialog was open.
    if (!canDeleteRow(previous)) {
      setDeleteId(null);
      setLoadError(t("expenseStaffTodayOnly"));
      return;
    }
    setDeleting(true);
    try {
      await deleteExpense(deleteId, { user: profile, previous });
      setDeleteId(null);
    } catch (e) {
      setLoadError(mapFirebaseError(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="admin-page-title">{t("expenses")}</h1>
          <p className="admin-page-sub">
            {isOwner ? t("expensesHint") : t("expensesHintStaff")}
          </p>
        </div>
        {canAdd && (
          <button className="btn min-h-11 px-4 py-2.5 text-sm" onClick={openAddForm}>
            {t("addExpense")}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="admin-filter-panel mb-4 p-3 sm:p-4">
        <p className="admin-filter-muted mb-2.5 text-[11px] leading-snug">
          {t("filtersApplyToList")}
        </p>
        <div className="flex flex-wrap gap-2">
          {isOwner && branches.length > 0 && (
            <select
              className="input min-w-[10rem] flex-1 text-sm sm:max-w-xs sm:flex-none"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              dir="ltr"
            >
              <option value="all">{t("allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {(["today", "last7", "month", "all", "custom"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`admin-filter-chip ${datePreset === p ? "is-active" : ""}`}
              onClick={() => setDatePreset(p)}
            >
              {p === "today"
                ? t("dateToday")
                : p === "last7"
                  ? t("dateLast7")
                  : p === "month"
                    ? t("dateThisMonth")
                    : p === "all"
                      ? t("dateAll")
                      : t("dateCustom")}
            </button>
          ))}
          <button
            type="button"
            className={`admin-filter-chip ms-auto min-h-9 py-1.5 text-xs ${
              filtersActive ? "is-active" : "opacity-60"
            }`}
            disabled={!filtersActive}
            onClick={resetFilters}
          >
            {t("resetFilters")}
          </button>
        </div>
        {datePreset === "custom" ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              onClick={(e) => openDatePicker(e.currentTarget)}
              className="input w-full text-sm"
              dir="ltr"
              aria-label={t("dateFrom")}
            />
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              onClick={(e) => openDatePicker(e.currentTarget)}
              className="input w-full text-sm"
              dir="ltr"
              aria-label={t("dateTo")}
            />
          </div>
        ) : null}
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-[var(--muted)]">{t("totalExpenses")}</p>
          <p className="mt-1 text-xl font-bold text-red-600" dir="ltr">{formatPkr(totalFiltered)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{filtered.length} {t("expenses").toLowerCase()}</p>
        </div>
        {categoryBreakdown.slice(0, 2).map(([cat, amt]) => (
          <div key={cat} className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-[var(--muted)]">{t(categoryLabelKey[cat])}</p>
            <p className="mt-1 text-lg font-bold text-[var(--ink)]" dir="ltr">{formatPkr(amt)}</p>
          </div>
        ))}
      </div>

      {loading ? <PageSpinner label={t("loading")} /> : null}
      {!loading && loadError ? <LoadError message={loadError} onRetry={() => void load()} retryLabel={t("retry")} /> : null}

      {!loading && !loadError && (
        <CollapsibleSection
          title={t("expenses")}
          count={filtered.length}
        >
          <div className="space-y-3 p-3 sm:p-4">
            {filtered.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/70 px-4 py-8 text-center text-sm text-[var(--muted)]">
                {t("noExpenses")}
              </p>
            ) : (
              filtered.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white p-3 shadow-sm sm:p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-600">
                        {t(categoryLabelKey[e.category])}
                      </span>
                      {e.description && (
                        <span className="truncate text-sm text-[var(--ink)]">{e.description}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {pendingIds.has(e.id) ? (
                        <span
                          className="me-1.5 inline-block h-2 w-2 rounded-full bg-amber-400 align-middle"
                          title={t("recentPendingLocal")}
                          aria-label={t("recentPendingLocal")}
                        />
                      ) : null}
                      {e.date} · {t("addedBy")} {e.createdByName}
                      {e.updatedByName && e.updatedAt
                        ? ` · ${t("editedBy")} ${e.updatedByName}`
                        : ""}
                      {branchId === "all" ? ` · ${branches.find((b) => b.id === e.branchId)?.name ?? ""}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-red-600" dir="ltr">−{formatPkr(e.amount)}</p>
                  {canEditRow(e) && !pendingIds.has(e.id) && (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg p-2 text-[var(--muted)] transition hover:bg-stone-100 hover:text-[var(--ink)]"
                      onClick={() => openEditForm(e)}
                      aria-label={t("edit")}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                  )}
                  {canDeleteRow(e) && !pendingIds.has(e.id) && (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg p-2 text-[var(--muted)] transition hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleteId(e.id)}
                      aria-label={t("delete")}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>
      )}

      {!loading && !loadError ? (
        <div className="mt-4">
          <SeeActivityLogLink entityType="expense" />
        </div>
      ) : null}

      {/* Add expense modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm">
          <div className="panel w-full max-w-md p-5">
            <h3 className="mb-4 text-lg font-bold text-[var(--ink)]">{editExpense ? t("editExpense") : t("addExpense")}</h3>
            {formError && <div className="toast-error mb-3">{formError}</div>}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("expenseCategory")}</label>
                <select className="input w-full" value={formCategory} onChange={(e) => setFormCategory(e.target.value as ExpenseCategory)}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{t(categoryLabelKey[c])}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("expenseDescription")}</label>
                <input className="input w-full" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder={t("expenseDescription")} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("expenseAmount")}</label>
                <input className="input w-full" type="number" min="1" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0" dir="ltr" />
              </div>
              {!editExpense && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("branch")}</label>
                  {branches.length <= 1 ? (
                    <p className="rounded-lg border border-[var(--border)] bg-stone-50 px-3 py-2.5 text-sm text-[var(--ink)]">
                      {branches[0]?.name ?? "—"}
                    </p>
                  ) : (
                    <select
                      className="input w-full"
                      value={formBranchId}
                      onChange={(e) => setFormBranchId(e.target.value)}
                      dir="ltr"
                      required
                    >
                      <option value="">{t("selectBranch")}</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">{t("expenseDate")}</label>
                <input
                  className="input w-full"
                  type="date"
                  min={isOwner ? undefined : todayKey}
                  max={todayKey}
                  // Staff keep an expense's day when editing; the owner may move it.
                  disabled={!isOwner && Boolean(editExpense)}
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => { setFormOpen(false); setEditExpense(null); }} disabled={formBusy}>{t("cancel")}</button>
              <button
                className="btn flex-1"
                onClick={() => void handleSaveExpense()}
                disabled={
                  formBusy
                  || !formAmount
                  || (!editExpense && !addBranchId)
                }
              >
                {formBusy ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteId)}
        title={t("confirmDeleteExpense")}
        message={t("confirmDeleteExpenseBody")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        busy={deleting}
        danger
        onCancel={() => !deleting && setDeleteId(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

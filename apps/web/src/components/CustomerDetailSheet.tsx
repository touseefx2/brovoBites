"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CUSTOMER_NOTE_MAX,
  formatPhone,
  formatPkr,
  searchCustomers,
  type AppUser,
  type Customer,
  type Order,
  type ShopSettings,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { mapFirebaseError } from "@/lib/errors";
import { fetchCustomerOrders, manageCustomer, saveCustomerNote } from "@/lib/customers";
import { OrderListCard } from "@/components/OrderListCard";
import { OrderDetailSheet } from "@/components/OrderDetailSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";

/** "25 Nov 2026" in shop time. */
export function shopDate(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "ur" ? "ur-PK" : "en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

/**
 * One customer: numbers, note (anyone), addresses, other names, their orders;
 * the owner also renames and merges. Numbers come from the orders (server).
 */
export function CustomerDetailSheet({
  customer,
  all,
  user,
  settings,
  onClose,
}: {
  customer: Customer;
  /** Every customer (to pick the one to merge into). */
  all: Customer[];
  user: AppUser;
  settings: ShopSettings | null;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const isOwner = user.role === "owner";
  const [note, setNote] = useState(customer.note);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [name, setName] = useState(customer.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeInto, setMergeInto] = useState<Customer | null>(null);

  // A newer note from someone else shows unless this one is being edited.
  useEffect(() => {
    if (noteState === "idle") setNote(customer.note);
  }, [customer.note, noteState]);

  useEffect(() => {
    let alive = true;
    setOrdersError(null);
    fetchCustomerOrders(customer, user)
      .then((list) => alive && setOrders(list))
      .catch((e) => alive && setOrdersError(mapFirebaseError(e)));
    return () => {
      alive = false;
    };
  }, [customer, user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openOrder && !mergeInto) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, openOrder, mergeInto]);

  async function saveNote() {
    setNoteState("saving");
    setError(null);
    try {
      // Offline it waits in Firestore's queue: shown as saved, it goes up with the net.
      void saveCustomerNote(customer.id, note, user).catch((e) => setError(mapFirebaseError(e)));
      setNoteState("saved");
    } catch (e) {
      setError(mapFirebaseError(e));
      setNoteState("idle");
    }
  }

  async function run(body: Parameters<typeof manageCustomer>[0], after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await manageCustomer(body);
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const mergeChoices = useMemo(
    () => (mergeQuery.trim() ? searchCustomers(all, mergeQuery, 6).filter((c) => c.id !== customer.id) : []),
    [all, mergeQuery, customer.id],
  );

  const stat = (label: string, value: React.ReactNode) => (
    <div className="rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-200">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-0.5 text-base font-bold text-stone-900">{value}</p>
    </div>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-sheet-title"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-[#fffaf3] shadow-2xl sm:rounded-2xl">
          <header className="modal-dark-head flex shrink-0 items-start justify-between gap-3 px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h2 id="customer-sheet-title" className="truncate text-xl font-bold text-[#fff4e8]">
                <bdi>{customer.name || t("customerNoName")}</bdi>
              </h2>
              <a href={`tel:${customer.id}`} className="mt-0.5 inline-block text-sm font-semibold tabular-nums text-[#f0b028]" dir="ltr">
                {formatPhone(customer.id)}
              </a>
              {customer.altPhones?.length ? (
                <p className="text-xs text-[#d9bfa6]" dir="ltr">
                  + {customer.altPhones.map(formatPhone).join(", ")}
                </p>
              ) : null}
            </div>
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose}>
              {t("close")}
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {error ? <p className="toast-error">{error}</p> : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stat(t("customerOrderHistory"), <span style={{ fontVariantNumeric: "tabular-nums" }}>{customer.orderCount}</span>)}
              {stat(t("customerSpent"), <bdi dir="ltr">{formatPkr(customer.totalSpent)}</bdi>)}
              {stat(t("customerFirstOrder"), shopDate(customer.firstOrderAt, locale))}
              {stat(t("customerLastOrder"), shopDate(customer.lastOrderAt, locale))}
            </div>

            {/* Note — anyone signed in */}
            <section>
              <label htmlFor="customer-note" className="mb-1 block text-sm font-bold text-stone-800">
                {t("customerNoteLabel")}
              </label>
              <textarea
                id="customer-note"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteState("idle");
                }}
                maxLength={CUSTOMER_NOTE_MAX}
                rows={2}
                placeholder={t("customerNotePlaceholder")}
                className="input w-full text-sm"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-stone-500">
                  {noteState === "saved"
                    ? t("customerNoteSaved")
                    : customer.noteUpdatedByName && customer.note
                      ? t("customerNoteBy").replace("{name}", customer.noteUpdatedByName)
                      : ""}
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={note.trim() === customer.note.trim() || noteState === "saving"}
                  onClick={() => void saveNote()}
                >
                  {t("customerSave")}
                </button>
              </div>
            </section>

            {customer.addresses.length > 0 ? (
              <section>
                <p className="mb-1 text-sm font-bold text-stone-800">{t("customerAddresses")}</p>
                <ul className="space-y-1 text-sm text-stone-700">
                  {customer.addresses.map((a) => (
                    <li key={a} className="rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">
                      <bdi>{a}</bdi>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {customer.otherNames.length > 0 ? (
              <p className="text-sm text-stone-700">
                <span className="font-bold text-stone-800">{t("customerOtherNames")}: </span>
                <bdi>{customer.otherNames.join(", ")}</bdi>
              </p>
            ) : null}

            {/* Owner: name by hand, merge */}
            {isOwner ? (
              <section className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                <div>
                  <label htmlFor="customer-name" className="mb-1 block text-sm font-bold text-stone-800">
                    {t("customerRename")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="customer-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      className="input min-w-0 flex-1 text-sm"
                    />
                    <button
                      type="button"
                      className="btn btn-sm shrink-0"
                      disabled={busy || !name.trim() || name.trim() === customer.name}
                      onClick={() => void run({ action: "rename", key: customer.id, name: name.trim() })}
                    >
                      {t("customerSave")}
                    </button>
                  </div>
                  {customer.nameLocked ? (
                    <p className="mt-1 text-xs text-stone-500">
                      {t("customerNameLocked")} ·{" "}
                      <button
                        type="button"
                        className="font-semibold text-[var(--gold-deep)] underline"
                        disabled={busy}
                        onClick={() => void run({ action: "rename", key: customer.id, name: null })}
                      >
                        {t("customerUseOrderName")}
                      </button>
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="text-sm font-bold text-stone-800">{t("customerMerge")}</p>
                  <p className="mb-1.5 text-xs text-stone-500">{t("customerMergeHint")}</p>
                  <input
                    type="search"
                    value={mergeQuery}
                    onChange={(e) => setMergeQuery(e.target.value)}
                    placeholder={t("customersSearch")}
                    className="input w-full text-sm"
                    autoComplete="off"
                  />
                  {mergeChoices.length > 0 ? (
                    <ul className="mt-1.5 divide-y divide-stone-100 rounded-xl ring-1 ring-stone-200">
                      {mergeChoices.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-stone-50"
                            onClick={() => setMergeInto(c)}
                          >
                            <bdi className="truncate font-semibold">{c.name || t("customerNoName")}</bdi>
                            <span className="shrink-0 tabular-nums text-stone-600" dir="ltr">
                              {formatPhone(c.id)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Their orders */}
            <section>
              <p className="mb-2 text-sm font-bold text-stone-800">{t("customerOrderHistory")}</p>
              {ordersError ? (
                <p className="toast-error">{ordersError}</p>
              ) : orders === null ? (
                <p className="py-4 text-center text-sm text-stone-500">{t("loading")}</p>
              ) : orders.length === 0 ? (
                <p className="py-4 text-center text-sm text-stone-500">{t("noOrders")}</p>
              ) : (
                <div className="space-y-2" data-testid="customer-orders">
                  {orders.map((o) => (
                    <OrderListCard key={o.id} order={o} dense showBranch={isOwner} onClick={() => setOpenOrder(o)} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {openOrder ? (
        <OrderDetailSheet
          order={openOrder}
          user={user}
          settings={settings}
          onClose={() => setOpenOrder(null)}
          onSaved={(o) => {
            setOrders((list) => list?.map((x) => (x.id === o.id ? o : x)) ?? list);
            setOpenOrder(o);
          }}
          onDeleted={(id) => {
            setOrders((list) => list?.filter((x) => x.id !== id) ?? list);
            setOpenOrder(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(mergeInto)}
        title={t("customerMerge")}
        message={t("customerMergeConfirm")
          .replace("{from}", `${customer.name || ""} ${formatPhone(customer.id)}`.trim())
          .replace("{into}", `${mergeInto?.name || ""} ${mergeInto ? formatPhone(mergeInto.id) : ""}`.trim())}
        confirmLabel={t("yes")}
        cancelLabel={t("no")}
        busy={busy}
        onCancel={() => setMergeInto(null)}
        onConfirm={() =>
          void run({ action: "merge", from: customer.id, into: mergeInto!.id }, () => {
            setMergeInto(null);
            onClose();
          })
        }
      />
    </>
  );
}

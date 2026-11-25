"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPhone, formatPkr, searchCustomers, type Customer } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";

const MAX_ROWS = 50;

/**
 * Checkout's saved-customer picker: a small arrow button (placed by the page
 * inside the name field) opens a panel with its own search box — by name or
 * number — and the customers with their number, address, orders and note.
 * Nothing opens while the cashier types a name or phone in the fields.
 * Works from whatever list it is given (this PC's copy: also offline).
 */
export function CustomerPicker({
  customers,
  onPick,
  selectedId,
  className = "",
}: {
  customers: readonly Customer[];
  onPick: (c: Customer) => void;
  selectedId?: string | null;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    if (!open) return [];
    const q = query.trim();
    if (q) return searchCustomers(customers, q, MAX_ROWS);
    // No search yet: the most recent customers first.
    return [...customers]
      .filter((c) => c.orderCount > 0 || c.note)
      .sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt))
      .slice(0, MAX_ROWS);
  }, [open, query, customers]);

  // Close on a click / tap outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function toggle() {
    setOpen((o) => !o);
    setQuery("");
    setActive(0);
  }

  function pick(c: Customer) {
    onPick(c);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length) setActive((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = rows[Math.min(active, rows.length - 1)];
      if (c) pick(c);
    } else if (e.key === "Escape") {
      // Closes the panel, not the whole checkout.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className={className}>
      <button
        ref={buttonRef}
        type="button"
        className={`pos-cust-trigger ${open ? "is-open" : ""}`}
        aria-label={t("customerPickerOpen")}
        title={t("customerPickerOpen")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="customer-picker-button"
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="pos-cust-panel" role="dialog" aria-label={t("customerPickerOpen")} data-testid="customer-picker">
          <div className="pos-cust-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder={t("customerPickerSearch")}
              aria-label={t("customerPickerSearch")}
              aria-controls="customer-picker-list"
              aria-activedescendant={rows.length ? `customer-picker-${active}` : undefined}
              autoComplete="off"
              autoFocus
              enterKeyHint="search"
            />
          </div>
          <p className="pos-cust-panel-title">
            {query.trim() ? t("customerPickerResults").replace("{n}", String(rows.length)) : t("customerRecent")}
          </p>
          {rows.length === 0 ? (
            <p className="pos-cust-empty">{query.trim() ? t("customerNoMatch") : t("noCustomers")}</p>
          ) : (
            <ul ref={listRef} id="customer-picker-list" role="listbox" aria-label={t("customerSuggestions")} className="pos-cust-rows">
              {rows.map((c, i) => (
                <li
                  key={c.id}
                  id={`customer-picker-${i}`}
                  data-index={i}
                  data-customer={c.id}
                  role="option"
                  aria-selected={i === active}
                  className={`pos-cust-option ${i === active ? "is-active" : ""} ${c.id === selectedId ? "is-picked" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c)}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <bdi className="truncate font-bold">{c.name || t("customerNoName")}</bdi>
                    <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                      {formatPhone(c.id)}
                    </span>
                  </div>
                  {c.addresses[0] ? (
                    <p className="pos-cust-addr">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                      <bdi className="truncate">{c.addresses[0]}</bdi>
                    </p>
                  ) : null}
                  <div className="pos-cust-meta">
                    {c.orderCount > 0 ? (
                      <span>
                        {t(c.orderCount === 1 ? "customerOrdersOne" : "customerOrders").replace("{n}", String(c.orderCount))} ·{" "}
                        <bdi dir="ltr">{formatPkr(c.totalSpent)}</bdi>
                      </span>
                    ) : null}
                    {c.orderCount >= 3 ? <span className="pos-cust-tag">{t("customerRegular")}</span> : null}
                  </div>
                  {c.note ? <p className="pos-cust-note">✎ {c.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/locale-context";
import type { Locale } from "@/i18n/dictionaries";

function GlobeIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`size-4 shrink-0 ${className}`}
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`size-3.5 shrink-0 opacity-55 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Both labels in English so layout stays LTR and aligned. */
const OPTIONS: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ur", label: "Urdu" },
];

export function LanguageToggle({
  className = "",
  menuPlacement = "down",
  iconOnly = false,
}: {
  className?: string;
  menuPlacement?: "up" | "down";
  /** Square globe button (POS header) — the menu still shows the language names. */
  iconOnly?: boolean;
}) {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fullWidth = /\bw-full\b/.test(className);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(next: Locale) {
    setLocale(next);
    setOpen(false);
  }

  const current = OPTIONS.find((o) => o.id === locale) ?? OPTIONS[0];

  return (
    <div
      ref={rootRef}
      className={`lang-toggle-root relative z-30 inline-block ${className}`}
      dir="ltr"
      lang="en"
    >
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="pos-icon-btn"
          title={`${t("switchLang")} · ${current.label}`}
          aria-label={t("switchLang")}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
          </svg>
        </button>
      ) : (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`lang-toggle-btn inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold leading-none text-[var(--ink)] shadow-sm transition hover:border-[var(--gold)] hover:bg-[#fff4e8] ${
          fullWidth ? "w-full" : ""
        }`}
        title={t("switchLang")}
        aria-label={t("switchLang")}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <GlobeIcon className="lang-toggle-icon text-[var(--gold-deep)]" />
        <span className="lang-toggle-label whitespace-nowrap">
          <span className="lang-toggle-label-full">{current.label}</span>
          <span className="lang-toggle-label-short" aria-hidden>
            {current.id === "en" ? "EN" : "UR"}
          </span>
        </span>
        <ChevronIcon open={open} />
      </button>
      )}

      {open ? (
        <ul
          role="listbox"
          dir="ltr"
          className={`absolute z-50 overflow-visible ${iconOnly ? "min-w-[9rem]" : "min-w-full"} rounded-xl border border-[var(--border)] bg-white p-1 shadow-[0_12px_40px_-12px_rgba(42,20,14,0.35)] ring-1 ring-black/5 ${
            menuPlacement === "up"
              ? "bottom-full start-0 mb-1.5"
              : "top-full start-0 mt-1.5"
          }`}
        >
          {OPTIONS.map((opt) => {
            const selected = locale === opt.id;
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`lang-toggle-option flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm transition ${
                    selected
                      ? "bg-[var(--gold)]/20 font-semibold text-[var(--gold-deep)]"
                      : "font-medium text-[var(--ink)] hover:bg-[#fff4e8]"
                  }`}
                  onClick={() => pick(opt.id)}
                >
                  <span className="whitespace-nowrap">{opt.label}</span>
                  {selected ? (
                    <svg
                      className="ms-auto size-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      width={14}
                      height={14}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  ) : (
                    <span className="ms-auto size-3.5 shrink-0" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

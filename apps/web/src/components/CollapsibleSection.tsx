"use client";

import { useState, type ReactNode } from "react";

/** Activity-log style expand/collapse panel. Open by default. */
export function CollapsibleSection({
  title,
  subtitle,
  count,
  defaultOpen = true,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={`admin-section-card ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="collapsible-head flex w-full items-start justify-between gap-3 px-4 py-3.5 text-start sm:px-5"
      >
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-[var(--ink)] sm:text-lg">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {typeof count === "number" && count > 0 ? (
            <span className="collapsible-count rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums">
              {count}
            </span>
          ) : null}
          <span
            className="collapsible-chevron inline-flex size-8 items-center justify-center rounded-full"
            aria-hidden
          >
            <svg
              className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </div>
      </button>

      {open ? <div className="border-t border-[var(--border)]">{children}</div> : null}
    </section>
  );
}

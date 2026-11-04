"use client";

import Link from "next/link";
import type { ActivityEntityType } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";

/** Opens the dedicated Activity page — no Firestore reads until clicked. */
export function SeeActivityLogLink({
  entityType,
  className = "",
}: {
  entityType: ActivityEntityType;
  className?: string;
}) {
  const { t } = useLocale();
  const href = `/activity?type=${entityType}`;

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3.5 py-3 text-start shadow-sm transition hover:border-[var(--gold)]/40 hover:bg-[#faf8f5] sm:px-4 ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[var(--ink)]">
          {t("seeActivityLog")}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)] sm:text-xs">
          {t("seeActivityLogHint")}
        </span>
      </span>
      <span
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f3eee6] text-[var(--gold-deep)] ring-1 ring-[rgba(184,134,11,0.2)]"
        aria-hidden
      >
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 5h11M9 12h11M9 19h11" />
          <path d="M4 5h.01M4 12h.01M4 19h.01" />
        </svg>
      </span>
    </Link>
  );
}

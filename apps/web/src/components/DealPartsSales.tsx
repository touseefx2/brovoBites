"use client";

import { dealPartCount, type DealPartStat } from "@/lib/day-report";
import { useLocale } from "@/i18n/locale-context";

/**
 * Items that went out inside deals (menu, changed and custom deals) — so the
 * kitchen / stock count of burgers, nuggets, drinks… includes what deals used.
 */
export function DealPartsSales({
  rows,
  itemImage,
}: {
  rows: DealPartStat[];
  itemImage?: (productId: string, name: string) => string;
}) {
  const { t } = useLocale();
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="px-4 pb-2 text-xs leading-relaxed text-stone-600 sm:px-5">{t("reportInsideDealsHint")}</p>
      <ul className="divide-y divide-[#f3e2cf]" aria-label={t("reportInsideDeals")}>
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            {itemImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={itemImage(r.productId ?? "", r.name)}
                alt=""
                className="size-9 shrink-0 rounded-lg bg-stone-100 object-cover"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{r.name}</span>
            <span className="shrink-0 text-base font-bold tabular-nums text-[var(--ink)]" dir="ltr">
              {dealPartCount(r)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

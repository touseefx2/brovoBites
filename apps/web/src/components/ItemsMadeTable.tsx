"use client";

import { madeCountText, type ItemMadeRow } from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";

/**
 * Items Made: every item that went out — on its own, inside deals, and the
 * two together (kitchen / stock count). Prices stay in Menu Sales: a deal's
 * price can't be split fairly over what is in it.
 */
export function ItemsMadeTable({
  rows,
  itemImage,
}: {
  rows: ItemMadeRow[];
  itemImage?: (productId: string, name: string) => string;
}) {
  const { t } = useLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={t("itemsMade")} data-testid="items-made">
        <thead className="border-b border-[#f0dcc6] bg-[#fff6ea] text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">
          <tr>
            <th className="px-4 py-3 text-start">{t("itemName")}</th>
            <th className="px-3 py-3 text-end">{t("madeAlone")}</th>
            <th className="px-3 py-3 text-end">{t("madeInDeals")}</th>
            <th className="px-4 py-3 text-end">{t("madeTotal")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f3e2cf]">
          {rows.map((r) => (
            <tr key={r.key} data-item={r.name} className="transition hover:bg-[#fff6ea]">
              <td className="px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  {itemImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={itemImage(r.productId ?? "", r.name)}
                      alt=""
                      className="size-9 shrink-0 rounded-lg bg-stone-100 object-cover"
                    />
                  ) : null}
                  <span className="truncate font-semibold text-[var(--ink)]">{r.name}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums text-stone-700" data-col="alone">
                {/* Cell keeps the table's side (RTL in Urdu); the number reads left to right. */}
                <bdi dir="ltr">{madeCountText(r.alone)}</bdi>
              </td>
              <td className="px-3 py-2.5 text-end tabular-nums text-stone-700" data-col="deals">
                {/* Cell keeps the table's side (RTL in Urdu); the number reads left to right. */}
                <bdi dir="ltr">{madeCountText(r.inDeals)}</bdi>
              </td>
              <td className="px-4 py-2.5 text-end text-base font-bold tabular-nums text-[var(--ink)]" data-col="total">
                {/* Cell keeps the table's side (RTL in Urdu); the number reads left to right. */}
                <bdi dir="ltr">{madeCountText(r.total)}</bdi>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

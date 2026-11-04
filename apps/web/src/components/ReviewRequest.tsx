"use client";

import type { Order } from "@bravobites/domain";
import { formatOrderDateTime } from "@bravobites/domain";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocale } from "@/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { answerReviewAsk, askReviewSent, subscribeReviewOutbox } from "@/lib/review-outbox";
import { hasReviewContent, openReviewWhatsapp, whatsappNumber } from "@/lib/review-request";
import { useReviewSetup } from "@/lib/use-review-setup";

/**
 * Thank-you + Google review link on WhatsApp. WhatsApp can't tell us whether
 * the message went, so after opening it staff answer "sent?" — only a yes
 * counts. Asking again is allowed; the count and last send stay on the order.
 */
function useReviewRequest(order: Order) {
  const { profile } = useAuth();
  const setup = useReviewSetup();
  // "Yes" answers kept on this PC until counted on the order, and the open
  // "sent?" question — both survive a reload (review-outbox).
  const [waiting, setWaiting] = useState(0);
  const [asking, setAsking] = useState(false);
  // Between the press and the question being saved, a refresh from another
  // card or tab must not bring the button back.
  const opening = useRef(false);
  useEffect(
    () =>
      subscribeReviewOutbox((s) => {
        setWaiting(s.pending.get(order.id) ?? 0);
        setAsking(s.asks.has(order.id) || opening.current);
      }),
    [order.id],
  );
  // This "yes", shown at once — a list that isn't live still has the old count.
  const [sent, setSent] = useState<{ count: number; at: string; by: string } | null>(null);
  const known = (order.reviewSentCount ?? 0) + waiting;
  const count = Math.max(known, sent?.count ?? 0);
  const at = sent && sent.count >= known ? sent.at : order.reviewSentAt;
  // Email: unique, so two staff with the same name can't be mixed up.
  const by =
    sent && sent.count >= known ? sent.by : order.reviewSentByEmail || order.reviewSentByName;
  const [busy, setBusy] = useState(false);

  const open = () => {
    if (busy || !profile || !openReviewWhatsapp(order, setup)) return;
    opening.current = true;
    setAsking(true); // the button is gone at once — a double tap opens nothing
    void askReviewSent(order.id, profile).finally(() => {
      opening.current = false;
    });
  };

  const reopen = () => openReviewWhatsapp(order, setup);

  const answer = async (yes: boolean) => {
    if (busy || !profile) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const counted = await answerReviewAsk(order.id, yes, profile);
      if (counted && yes) setSent({ count: count + 1, at: now, by: profile.email || profile.displayName });
      setAsking(false);
    } finally {
      setBusy(false);
    }
  };

  return {
    ready: Boolean(profile),
    hasContent: hasReviewContent(setup),
    asking,
    waiting,
    count,
    at,
    by,
    busy,
    open,
    reopen,
    answer,
  };
}

function WhatsAppIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-.9.2-3.1-.7-2.6-1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.7s.7-1.9.9-2.2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z" />
    </svg>
  );
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

const BTN_SOLID =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1ebe5b] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-emerald-600/40 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50";
const BTN_NO =
  "shrink-0 cursor-pointer rounded-full border border-stone-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50";

/** Row clicks open the order — the review controls must not. */
const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * Google review request for one order: a strip under an order card, or
 * (`compact`) a small block inside a table cell. Nothing without a phone.
 */
export function ReviewRequest({
  order,
  compact = false,
  dense = false,
}: {
  order: Order;
  compact?: boolean;
  dense?: boolean;
}) {
  const { t } = useLocale();
  const r = useReviewRequest(order);
  if (!whatsappNumber(order.customerPhone)) return null;
  // No review link and no menu link set (admin → Landing): nothing to send.
  // An open "sent?" question or an earlier count still shows.
  if (!r.hasContent && !r.asking && r.count === 0) return null;

  const title =
    r.count > 0 ? t("reviewSentTimes").replace("{n}", String(r.count)) : t("reviewNotSent");
  const last =
    r.count > 0 && (r.at || r.by)
      ? t("reviewLast").replace(
          "{who}",
          [r.at ? formatOrderDateTime(r.at) : "", r.by ?? ""].filter(Boolean).join(" · "),
        )
      : "";

  const askButtons = (
    <span className="flex shrink-0 gap-1.5">
      <button type="button" onClick={() => void r.answer(false)} disabled={r.busy} className={BTN_NO}>
        {t("reviewAskNo")}
      </button>
      <button type="button" onClick={() => void r.answer(true)} disabled={r.busy} className={BTN_SOLID}>
        {t("reviewAskYes")}
      </button>
    </span>
  );
  const sendButton = (
    <button
      type="button"
      onClick={r.open}
      disabled={!r.ready || !r.hasContent}
      className={r.count > 0 ? BTN_OUTLINE : BTN_SOLID}
    >
      <WhatsAppIcon className="size-3.5" />
      {r.count > 0 ? t("reviewSendAgain") : t("reviewSend")}
    </button>
  );

  if (compact) {
    // One small box in a table cell: icon · status (+ when / who) · button.
    const box = "mt-2 flex w-full max-w-[17rem] items-center gap-2 rounded-xl border px-2.5 py-2";
    if (r.asking) {
      return (
        <div className={`${box} border-amber-200 bg-amber-50`} onClick={stop}>
          <span className="min-w-0 flex-1 text-[12px] font-semibold text-amber-900">
            {t("reviewAskShort")}
          </span>
          {askButtons}
        </div>
      );
    }
    return (
      <div className={`${box} border-stone-200 bg-white`} onClick={stop}>
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
            r.count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-400"
          }`}
        >
          {r.count > 0 ? <CheckIcon className="size-3.5" /> : <WhatsAppIcon className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span
            className={`block text-[12px] font-semibold ${
              r.count > 0 ? "text-emerald-700" : "text-stone-500"
            }`}
          >
            {r.count > 0
              ? t("reviewSentShort").replace("{n}", String(r.count))
              : t("reviewNotSentShort")}
          </span>
          {r.count > 0 && r.at ? (
            <span className="block text-[11px] text-stone-500" dir="ltr">
              {formatOrderDateTime(r.at)}
            </span>
          ) : null}
          {r.count > 0 && r.by ? (
            <span className="block truncate text-[11px] text-stone-500" title={r.by} dir="ltr">
              {r.by}
            </span>
          ) : null}
          {r.waiting > 0 ? (
            <span className="block text-[11px] text-amber-700">{t("reviewWaitingSync")}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={r.open}
          disabled={!r.ready || !r.hasContent}
          aria-label={r.count > 0 ? t("reviewSendAgain") : t("reviewSend")}
          title={r.count > 0 ? t("reviewSendAgain") : t("reviewSend")}
          className={`${r.count > 0 ? BTN_OUTLINE : BTN_SOLID} !px-2.5 !py-1`}
        >
          <WhatsAppIcon className="size-3.5" />
          {r.count > 0 ? t("reviewSendAgainShort") : t("reviewSendShort")}
        </button>
      </div>
    );
  }

  const pad = dense ? "px-3 py-2 ps-3.5" : "px-3.5 py-2.5 ps-4 sm:px-4";

  if (r.asking) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-amber-200 bg-amber-50 ${pad}`}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#25D366]/15 text-[#128C7E]">
          <WhatsAppIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-amber-900">{t("reviewAskSent")}</span>
          <span className="block text-[11px] text-amber-800/80 dark:text-amber-100/70">
            {t("reviewAskHint")}{" "}
            <button type="button" onClick={r.reopen} className="cursor-pointer font-semibold underline">
              {t("reviewReopen")}
            </button>
          </span>
        </span>
        {askButtons}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 border-t border-stone-100 ${pad}`}>
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          r.count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-400"
        }`}
      >
        {r.count > 0 ? (
          <CheckIcon className="size-4" />
        ) : (
          <WhatsAppIcon className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] font-semibold ${
            r.count > 0 ? "text-emerald-800" : "text-stone-600"
          }`}
        >
          {title}
        </span>
        {last || r.waiting > 0 ? (
          <span className="block truncate text-[11px] text-[var(--muted)]">
            {last}
            {r.waiting > 0 ? (
              <span className="text-amber-700">
                {last ? " · " : ""}
                {t("reviewWaitingSync")}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      {sendButton}
    </div>
  );
}

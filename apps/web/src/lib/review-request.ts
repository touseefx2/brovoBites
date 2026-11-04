import type { Order, ReviewMessageLang, ShopSettings } from "@bravobites/domain";
import { formatOrderNumber } from "@bravobites/domain";

/**
 * Plain helpers — no React, no Firestore: print-receipt imports this and the
 * server's report routes import print-receipt. The hook is in use-review-setup.
 */

/**
 * Where the receipt QR and the WhatsApp review message lead (admin → Landing).
 * "" until the owner sets it: no QR, no review part — never a guessed link.
 */
export function reviewUrlOf(settings: Pick<ShopSettings, "googleReviewUrl"> | null | undefined): string {
  const url = settings?.googleReviewUrl;
  return typeof url === "string" ? url.trim() : "";
}

/** Online menu link for the WhatsApp message (admin → Landing); "" → no menu part. */
export function menuUrlOf(settings: Pick<ShopSettings, "menuUrl"> | null | undefined): string {
  const url = settings?.menuUrl;
  return typeof url === "string" ? url.trim() : "";
}

/** menuUrl "" → the message leaves the menu part out. */
export type ReviewSetup = {
  url: string;
  lang: ReviewMessageLang;
  shopName: string;
  menuUrl: string;
};

/**
 * Customer phone → WhatsApp number (country code, digits only). Pakistani
 * local forms ("0300-1234567", "3001234567") get 92; null when too short.
 */
export function whatsappNumber(phone: string | undefined): string | null {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith("3")) digits = `92${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/** Anything to send? Neither link set → no WhatsApp button. */
export function hasReviewContent(setup: Pick<ReviewSetup, "url" | "menuUrl">): boolean {
  return Boolean(setup.url || setup.menuUrl);
}

/**
 * Short thank-you with the review link and the menu link — each only when
 * the owner set it. Both languages: English with the links first, then a
 * short Urdu part pointing to them — links go once. Urdu lines carry no
 * Latin text or "#" (they flip around inside right-to-left text); the shop
 * name signs off on its own line.
 * No emoji: the wa.me → api.whatsapp.com hop turns some into "�".
 */
export function reviewMessage(
  { url, lang, shopName: shop, menuUrl }: ReviewSetup,
  order: Order,
): string {
  const name = order.customerName?.trim();
  const no = formatOrderNumber(order.orderNumber);
  const english = [
    `${name ? `Hi ${name}! Thank you` : "Thank you"} for your order *#${no}*.`,
    ...(url ? ["", "Enjoyed your meal? Rate us on Google:", url] : []),
    ...(menuUrl ? ["", "View our menu and order again:", menuUrl] : []),
  ];
  const urdu =
    lang === "ur"
      ? [
          "السلام علیکم!",
          `آرڈر نمبر *${no}* کا شکریہ۔`,
          ...(url ? ["", "کھانا پسند آیا؟ گوگل پر ریویو دیں:", url] : []),
          ...(menuUrl ? ["", "دوبارہ آرڈر کے لیے مینو دیکھیں:", menuUrl] : []),
        ]
      : [
          `السلام علیکم! آرڈر نمبر *${no}* کا شکریہ۔`,
          ...(url && menuUrl
            ? ["کھانا پسند آیا؟ اوپر دیے گئے لنکس سے ریویو دیں اور مینو دیکھیں۔"]
            : url
              ? ["کھانا پسند آیا؟ اوپر والے لنک سے ریویو دیں۔"]
              : menuUrl
                ? ["دوبارہ آرڈر کے لیے اوپر والے لنک سے مینو دیکھیں۔"]
                : []),
        ];
  const body =
    lang === "en" ? english : lang === "ur" ? urdu : [...english, "", "──────────", "", ...urdu];
  return [...body, "", `*${shop}*`].join("\n");
}

/** Opens WhatsApp (app or web) with the thank-you message ready to send. */
export function openReviewWhatsapp(order: Order, setup: ReviewSetup): boolean {
  const number = whatsappNumber(order.customerPhone);
  if (!number || !hasReviewContent(setup)) return false;
  const url = `https://wa.me/${number}?text=${encodeURIComponent(reviewMessage(setup, order))}`;
  window.open(url, "_blank", "noopener");
  return true;
}

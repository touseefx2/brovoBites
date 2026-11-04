import type { PaymentMethod } from "@bravobites/domain";
import type { ReactNode } from "react";

/** One look for cash / card / online in every report and the dashboard. */
export const PAYMENT_TONE: Record<PaymentMethod, { tile: string; bar: string }> = {
  cash: {
    tile: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70",
    bar: "bg-gradient-to-r from-emerald-400 to-emerald-600",
  },
  card: {
    tile: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/70",
    bar: "bg-gradient-to-r from-sky-400 to-sky-600",
  },
  digital: {
    tile: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200/70",
    bar: "bg-gradient-to-r from-violet-400 to-violet-600",
  },
};

const PATHS: Record<PaymentMethod, ReactNode> = {
  // Banknote
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  // Bank card
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </>
  ),
  // Phone (online / wallet transfer)
  digital: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
};

export function PaymentMethodIcon({ method, size = 16 }: { method: PaymentMethod; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[method]}
    </svg>
  );
}

/** Rounded colour tile with the method icon. */
export function PaymentTile({ method, size = 40 }: { method: PaymentMethod; size?: number }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl ${PAYMENT_TONE[method].tile}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <PaymentMethodIcon method={method} size={Math.round(size * 0.45)} />
    </span>
  );
}

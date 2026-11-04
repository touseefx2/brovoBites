"use client";

import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onDismiss,
  busy = false,
  danger = false,
  success = false,
  error = false,
  focusConfirm = false,
  hideCancel = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Backdrop / Escape — defaults to onCancel */
  onDismiss?: () => void;
  busy?: boolean;
  danger?: boolean;
  success?: boolean;
  error?: boolean;
  /** Focus the primary (right) button instead of cancel */
  focusConfirm?: boolean;
  hideCancel?: boolean;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dismiss = onDismiss ?? onCancel;
  const featured = success || error;

  useEffect(() => {
    if (!open) return;
    (focusConfirm || hideCancel ? confirmRef : cancelRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, dismiss, focusConfirm, hideCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!busy) dismiss();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`panel w-full p-5 shadow-lg sm:p-6 ${featured ? "max-w-md" : "max-w-sm"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {success ? (
          <div
            className="mx-auto mb-3.5 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 sm:mb-4 sm:size-[4.25rem]"
            aria-hidden
          >
            <svg
              className="size-9 sm:size-10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
        ) : null}
        {error ? (
          <div
            className="mx-auto mb-3.5 flex size-16 items-center justify-center rounded-full bg-red-100 text-red-600 sm:mb-4 sm:size-[4.25rem]"
            aria-hidden
          >
            <svg
              className="size-9 sm:size-10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </div>
        ) : null}
        <h3
          id={titleId}
          className={`font-bold text-[var(--ink)] ${
            featured ? "text-center text-xl sm:text-2xl" : "text-lg"
          }`}
        >
          {title}
        </h3>
        <p
          className={`mt-2 whitespace-pre-line leading-relaxed text-[var(--muted)] ${
            featured
              ? "text-center text-base sm:text-[1.05rem] sm:leading-relaxed"
              : "text-sm"
          }`}
        >
          {message}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:mt-6 sm:flex-row sm:justify-end sm:gap-3">
          {!hideCancel ? (
            <button
              ref={cancelRef}
              type="button"
              className={`btn btn-ghost min-h-11 w-full sm:w-auto ${featured ? "sm:min-h-12 sm:px-5 text-[15px]" : ""}`}
              disabled={busy}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            className={`btn min-h-11 w-full sm:w-auto ${danger || error ? "border-red-600 bg-red-600 text-white hover:bg-red-700" : ""} ${featured ? "sm:min-h-12 sm:px-6 text-[15px]" : ""}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

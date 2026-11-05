"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/locale-context";
import { getImageUploadProvider } from "@/lib/storage";

/**
 * Local image picker — preview only. Upload happens on form Save.
 */
export function ImageUploadField({
  label,
  remoteUrl,
  pendingFile,
  onPendingFile,
  onClearRemote,
  disabled,
  hint,
}: {
  label: string;
  /** Already-saved URL from Firestore (https://…) */
  remoteUrl: string;
  /** Newly chosen file, not uploaded yet */
  pendingFile: File | null;
  onPendingFile: (file: File | null) => void;
  onClearRemote: () => void;
  disabled?: boolean;
  /** Extra requirement line shown below the label (e.g. dimensions, size) */
  hint?: string;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadReady = getImageUploadProvider() !== "none";

  useEffect(() => {
    if (!pendingFile) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const preview = localPreview || remoteUrl;

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(t("imageInvalidType"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t("imageTooLarge"));
      return;
    }
    onPendingFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onRemove() {
    setError(null);
    onPendingFile(null);
    onClearRemote();
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="md:col-span-2 space-y-2">
      <p className="text-sm font-semibold text-[var(--ink)]">{label}</p>
      {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
      <div className="flex flex-wrap items-start gap-3">
        <div className={`image-upload-preview h-24 w-24 overflow-hidden rounded-xl ${preview ? "has-image" : ""}`}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[11px] font-medium text-[var(--muted)]">
              <svg
                className="size-6 text-[var(--gold-deep)] opacity-70"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <circle cx="9" cy="10" r="1.75" />
                <path d="m21 16-5-5-8 9" />
              </svg>
              {t("imageNone")}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              {preview ? t("replaceImage") : t("chooseImage")}
            </button>
            {preview ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={onRemove}
              >
                {t("removeImage")}
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={disabled}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <p className="text-xs text-[var(--muted)]">{t("imageUploadHint")}</p>
          {!uploadReady ? (
            <p className="text-xs text-[var(--danger)]">{t("imageUploadNotConfigured")}</p>
          ) : null}
          {pendingFile && uploadReady ? (
            <p className="text-xs font-medium text-[var(--gold-deep)]">
              {t("imagePendingSave")}
            </p>
          ) : null}
          {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Thin top bar while admin routes change — so clicks feel responsive. */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    setVisible(true);
    setWidth(18);
    const ramp = setTimeout(() => setWidth(72), 80);
    const done = setTimeout(() => {
      setWidth(100);
      hideTimer.current = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 220);
    }, 280);
    return () => {
      clearTimeout(ramp);
      clearTimeout(done);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [key]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement | null)?.closest("a");
      if (!el) return;
      const href = el.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || el.target === "_blank") {
        return;
      }
      if (href.startsWith("/") || href.startsWith("?")) {
        setVisible(true);
        setWidth(28);
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!visible) return null;

  return (
    <div className="nav-progress" aria-hidden>
      <div className="nav-progress-bar" style={{ width: `${width}%` }} />
    </div>
  );
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-[var(--muted)]">
      <span className="spinner" aria-hidden />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}

export function ButtonSpinner() {
  return <span className="spinner spinner-sm" aria-hidden />;
}

/** List/page fetch failed — show message + Retry (not a full browser refresh). */
export function LoadError({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="card flex min-h-[28vh] flex-col items-center justify-center gap-3 text-center">
      <p className="max-w-md text-sm text-[var(--danger)]">{message}</p>
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

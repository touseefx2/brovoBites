"use client";

import { useEffect, useRef } from "react";

/**
 * When a list/page load failed, retry once automatically when the browser
 * comes back online (recommended UX — no full page refresh).
 */
export function useRetryOnReconnect(enabled: boolean, retry: () => void) {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!enabled) return;
    function onOnline() {
      retryRef.current();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [enabled]);
}

"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { POS_THEME_ATTR, POS_THEME_STORAGE_KEY } from "@/lib/pos-theme-script";

/**
 * POS-only light / dark theme, saved per device. Light is the default and the
 * admin never goes dark: the attribute on <html> exists only while the POS page
 * is mounted (usePosThemeScope).
 */
export type PosTheme = "light" | "dark";

/** Set for a frame while flipping, so CSS transitions don't fade cards one by one. */
const SWITCHING_ATTR = "data-pos-theme-switching";
const listeners = new Set<() => void>();
/** Survives a blocked localStorage (private window) for this session. */
let current: PosTheme | null = null;

function readStored(): PosTheme {
  try {
    return window.localStorage.getItem(POS_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function getSnapshot(): PosTheme {
  if (current === null) current = readStored();
  return current;
}

function getServerSnapshot(): PosTheme {
  return "light";
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab of the POS flipped it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== POS_THEME_STORAGE_KEY) return;
    current = readStored();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setPosTheme(theme: PosTheme) {
  current = theme;
  try {
    window.localStorage.setItem(POS_THEME_STORAGE_KEY, theme);
  } catch {
    // storage blocked — still switch for this session
  }
  emit();
}

export function usePosTheme(): [PosTheme, (theme: PosTheme) => void] {
  return [useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), setPosTheme];
}

/**
 * Call once at the top of the POS page. Puts the theme on <html> while mounted
 * and removes it on the way out, so the dashboard opens light. Reads the store
 * directly (not React state) so hydration can't flash light over the boot
 * script's dark.
 */
export function usePosThemeScope() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      if (getSnapshot() === "dark") root.setAttribute(POS_THEME_ATTR, "dark");
      else root.removeAttribute(POS_THEME_ATTR);
    };
    apply();
    const unsubscribe = subscribe(() => {
      root.setAttribute(SWITCHING_ATTR, "");
      apply();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => root.removeAttribute(SWITCHING_ATTR));
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      root.removeAttribute(SWITCHING_ATTR);
      root.removeAttribute(POS_THEME_ATTR);
    };
  }, []);
}

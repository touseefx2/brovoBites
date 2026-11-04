"use client";

import { useEffect, useState } from "react";
import { isCustomerMode } from "@/lib/customer-mode";
import { isQueueSyncing } from "@/lib/pos-queue";

/**
 * New-version detection for the installed app.
 *
 * A fresh deploy's service worker downloads in the background and then waits
 * (skipWaiting is off in next.config). It is applied by itself — the new
 * worker activates and the page reloads once — at the first quiet moment:
 *  - the app was just opened and nobody has touched it yet,
 *  - the user opens another page of the app,
 *  - the window is in the background, or nobody touched it for IDLE_MS,
 * and only while a reload loses nothing: no cart, no open dialog / sheet, no
 * edited field, no receipt printing, no sales uploading. The top strip shows
 * meanwhile; tapping it updates right away.
 * The public customer menu skips all that: its new version takes over quietly.
 */

const CHECK_EVERY_MS = 15 * 60 * 1000;
/** Back in front after this long → ask the server for a new version again. */
const CHECK_ON_SHOW_AFTER_MS = 5 * 60 * 1000;
/** No tap / key / scroll for this long counts as "nobody is using it". */
const IDLE_MS = 30 * 1000;
/** How often a waiting update looks for its quiet moment. */
const TICK_MS = 5000;
/** Pause after the server did not answer. */
const RETRY_MS = 60 * 1000;
/** Pause after the old worker would not let go (see applyAppUpdate). */
const STUCK_RETRY_MS = 10 * 60 * 1000;
/** Activation normally takes well under a second. */
const ACTIVATE_TIMEOUT_MS = 8000;
const SERVER_CHECK_TIMEOUT_MS = 10_000;
/** Set just before the reload, so the new version can say it is installed. */
const UPDATED_KEY = "bravobites.app-updated";
const UPDATED_NOTICE_MS = 4000;

/**
 * Pages whose HTML ships inside the service worker (additionalManifestEntries
 * in next.config): they open from the new version even offline. Any other
 * page's offline copy still points at the old build's chunks, which the new
 * version deletes — those reload into it only while the server answers.
 */
const OFFLINE_SAFE_PATHS = ["/pos", "/login"];

/** Inputs that never hold work worth keeping (search boxes included). */
const NOT_FIELDS = new Set(["button", "submit", "reset", "image", "hidden", "search"]);

/**
 * none → ready (downloaded, waiting) → applying (switching + reloading);
 * after the reload, done (installed notice) → none.
 */
export type AppUpdatePhase = "none" | "ready" | "applying" | "done";
type Trigger = "check" | "nav" | "hidden";

let phase: AppUpdatePhase = "none";
let started = false;
let registration: ServiceWorkerRegistration | null = null;
/** 0 = nobody has touched the page since it loaded. */
let lastInputAt = 0;
let lastCheckAt = 0;
let retryAt = 0;
let attempting = false;
const holds = new Set<symbol>();
/** Fields the user touched → their value before that (null: not seen). */
const fieldStart = new Map<HTMLElement, string | null>();
const listeners = new Set<(phase: AppUpdatePhase) => void>();

function setPhase(next: AppUpdatePhase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((l) => l(next));
}

function markReady() {
  if (phase === "ready" || phase === "applying") return;
  setPhase("ready");
  void tryAutoApply("check");
}

/** First load after our own reload into a new version: say so in the strip. */
function announceIfJustUpdated() {
  let at = 0;
  try {
    at = Number(sessionStorage.getItem(UPDATED_KEY)) || 0;
    sessionStorage.removeItem(UPDATED_KEY);
  } catch {
    return;
  }
  if (Date.now() - at > 2 * 60 * 1000) return;
  const show = () => {
    if (phase !== "none") return;
    setPhase("done");
    window.setTimeout(() => {
      if (phase === "done") setPhase("none");
    }, UPDATED_NOTICE_MS);
  };
  // Reloaded in the background: show it once someone looks.
  if (document.visibilityState === "visible") show();
  else document.addEventListener("visibilitychange", show, { once: true });
}

function checkForUpdate() {
  if (!registration || !navigator.onLine) return;
  lastCheckAt = Date.now();
  registration.update().catch(() => {});
}

/**
 * Fields whose changes a reload would lose. Pickers and filters count too: the
 * POS branch picker isn't saved, so a reload would quietly switch the next sale
 * back to the first branch; a report would drop the dates chosen for it.
 */
function asField(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLInputElement) return NOT_FIELDS.has(target.type) ? null : target;
  if (
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return target;
  }
  return null;
}

function fieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    return el.type === "checkbox" || el.type === "radio" ? String(el.checked) : el.value;
  }
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.selectedOptions, (o) => o.value).join("\n");
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  return el.textContent ?? "";
}

function rememberField(target: EventTarget | null, changed: boolean) {
  const el = asField(target);
  if (!el || fieldStart.has(el)) return;
  // Forget fields no longer on screen (they never count, see hasEditedField):
  // a POS tab open for days would otherwise keep every input it ever showed,
  // and their detached DOM, alive.
  for (const old of fieldStart.keys()) {
    if (!old.isConnected) fieldStart.delete(old);
  }
  // Changed before it was ever focused (Safari doesn't focus tapped
  // checkboxes): no "before" value, so it counts as edited while on screen.
  fieldStart.set(el, changed ? null : fieldValue(el));
}

/** A field still on screen differs from what it held before the user came. */
function hasEditedField(): boolean {
  let edited = false;
  for (const [el, before] of fieldStart) {
    if (!el.isConnected) fieldStart.delete(el);
    else if (before === null || fieldValue(el) !== before) edited = true;
  }
  return edited;
}

function trackActivity() {
  const touched = () => {
    lastInputAt = Date.now();
  };
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(type, touched, { capture: true, passive: true });
  }
  document.addEventListener("focusin", (e) => rememberField(e.target, false), true);
  document.addEventListener(
    "input",
    (e) => {
      touched();
      rememberField(e.target, true);
    },
    true,
  );
  document.addEventListener("change", (e) => rememberField(e.target, true), true);
}

/** Something on screen a reload would throw away or cut short. */
function pageBusy(): boolean {
  return (
    holds.size > 0 ||
    isQueueSyncing() ||
    // Open dialog / sheet, or a receipt still printing (print-receipt.ts).
    document.querySelector('[aria-modal="true"], iframe[data-print-job]') !== null ||
    hasEditedField()
  );
}

function nobodyUsingIt(trigger: Trigger): boolean {
  // nav: the page they were on is gone anyway; hidden: nobody is looking.
  if (trigger !== "check") return true;
  return (
    document.visibilityState === "hidden" ||
    lastInputAt === 0 ||
    Date.now() - lastInputAt >= IDLE_MS
  );
}

function settle<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    void promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    });
  });
}

/** The new version can load on this page right now. */
async function canReloadHere(): Promise<boolean> {
  if (OFFLINE_SAFE_PATHS.includes(window.location.pathname) && !window.location.search) {
    return true;
  }
  if (!navigator.onLine || !registration) return false;
  // update() fetches sw.js from the server itself — it fails on a dead line
  // that the browser still reports as "online".
  return settle(
    registration.update().then(
      () => true,
      () => false,
    ),
    SERVER_CHECK_TIMEOUT_MS,
    false,
  );
}

/** Switch to the downloaded worker. False when Chrome will not swap yet. */
function activateWaiting(): Promise<boolean> {
  const waiting = registration?.waiting;
  // Another tab already switched; this page only needs the reload.
  if (!waiting) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), ACTIVATE_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
}

/**
 * Activate and reload. `recheck`: work may have started during the switch (a
 * tap, a barcode scan) — then "busy": the page keeps running and reloads at
 * the next quiet moment instead.
 */
async function switchAndReload(recheck: boolean): Promise<"reloading" | "busy" | "stuck"> {
  setPhase("applying");
  const activated = await activateWaiting();
  if (!activated) {
    setPhase("ready");
    return "stuck";
  }
  if (recheck && pageBusy()) {
    setPhase("ready");
    return "busy";
  }
  try {
    sessionStorage.setItem(UPDATED_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the update still happens, just without the notice.
  }
  window.location.reload();
  return "reloading";
}

async function tryAutoApply(trigger: Trigger) {
  if (phase !== "ready" || attempting || Date.now() < retryAt) return;
  if (!nobodyUsingIt(trigger) || pageBusy()) return;
  attempting = true;
  try {
    if (!(await canReloadHere())) {
      retryAt = Date.now() + RETRY_MS;
      return;
    }
    // Someone may have started working while the server answered.
    if (phase !== "ready" || !nobodyUsingIt(trigger) || pageBusy()) return;
    // A stuck worker keeps its "skip waiting" and swaps by itself once the old
    // one is free — controllerchange (in watch) then retries at once.
    if ((await switchAndReload(true)) === "stuck") retryAt = Date.now() + STUCK_RETRY_MS;
  } finally {
    attempting = false;
  }
}

function watch(reg: ServiceWorkerRegistration) {
  const sw = navigator.serviceWorker;
  registration = reg;
  // The very first install (nothing controlled this page yet) is not an update.
  const hadController = Boolean(sw.controller);
  const silent = isCustomerMode(window.location.host);

  const found = () => {
    if (!reg.waiting || !sw.controller) return;
    if (silent) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    else markReady();
  };
  found();
  reg.addEventListener("updatefound", () => {
    reg.installing?.addEventListener("statechange", found);
  });
  // Another tab applied the update (or a stuck one finished) — this page still
  // runs the old build, whose cached chunks are gone now. It needs a reload too.
  sw.addEventListener("controllerchange", () => {
    if (!hadController || silent || phase === "applying") return;
    retryAt = 0;
    if (phase === "ready") void tryAutoApply("check");
    else markReady();
  });

  window.setInterval(checkForUpdate, CHECK_EVERY_MS);
  window.addEventListener("online", () => {
    checkForUpdate();
    retryAt = 0;
    void tryAutoApply("check");
  });
  if (silent) return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void tryAutoApply("hidden");
    else if (Date.now() - lastCheckAt > CHECK_ON_SHOW_AFTER_MS) checkForUpdate();
  });
  window.setInterval(() => void tryAutoApply("check"), TICK_MS);
}

function start() {
  if (started || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;
  if (!isCustomerMode(window.location.host)) {
    trackActivity();
    announceIfJustUpdated();
  }
  // Resolves once next-pwa's registration is active (never in dev — PWA off).
  void navigator.serviceWorker.ready.then(watch, () => {});
}

/**
 * "Update now": activate the downloaded version and reload into it. Unsaved
 * UI state is lost. "offline": this page can't load the new version without
 * the server. "stuck": Chrome will not swap versions while this window is
 * open (the old version is still busy) — closing every window finishes it.
 */
export async function applyAppUpdate(): Promise<"reloading" | "offline" | "stuck"> {
  if (phase === "applying") return "reloading";
  if (!(await canReloadHere())) return "offline";
  return (await switchAndReload(false)) === "stuck" ? "stuck" : "reloading";
}

/** Keeps the automatic update from reloading the page until released. */
export function holdAppUpdate(): () => void {
  const hold = Symbol("app-update-hold");
  holds.add(hold);
  return () => {
    holds.delete(hold);
    void tryAutoApply("check");
  };
}

/** The user opened another page of the app — a natural moment to switch. */
export function noteAppNavigation() {
  void tryAutoApply("nav");
}

export function useAppUpdatePhase(): AppUpdatePhase {
  const [current, setCurrent] = useState(phase);
  useEffect(() => {
    start();
    setCurrent(phase);
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}

import type { Locale } from "@/i18n/dictionaries";
import { mapFirebaseError } from "@/lib/errors";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  raceAbort,
  RequestOfflineError,
  RequestTimeoutError,
  isAbortError,
} from "@/lib/http";

export const ACTION_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

export class ActionTimeoutError extends RequestTimeoutError {
  constructor(ms = ACTION_TIMEOUT_MS) {
    super(ms);
    this.name = "ActionTimeoutError";
  }
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof RequestTimeoutError || error instanceof ActionTimeoutError) return true;
  if (error instanceof RequestOfflineError) return true;
  if (isBrowserOffline()) return true;
  if (isAbortError(error)) return true;
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code: string }).code);
    if (
      code === "unavailable" ||
      code === "network-request-failed" ||
      code === "auth/network-request-failed"
    ) {
      return true;
    }
  }
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    if (
      m.includes("network") ||
      m.includes("offline") ||
      m.includes("failed to fetch") ||
      m.includes("internet") ||
      m.includes("timed out") ||
      m.includes("timeout") ||
      m.includes("aborted")
    ) {
      return true;
    }
  }
  return false;
}

/** Alert + return false when offline. */
export function requireOnline(offlineMessage: string): boolean {
  if (!isBrowserOffline()) return true;
  window.alert(offlineMessage);
  return false;
}

export function actionErrorMessage(
  error: unknown,
  locale: Locale,
  messages: { offline: string; timeout: string },
): string {
  if (error instanceof RequestTimeoutError || error instanceof ActionTimeoutError) {
    return messages.timeout;
  }
  if (error instanceof RequestOfflineError) return messages.offline;
  if (isNetworkFailure(error)) return messages.offline;
  return mapFirebaseError(error, locale);
}

/** Show banner + alert so user always notices failed actions. */
export function notifyActionFailed(message: string, setError?: (msg: string) => void) {
  setError?.(message);
  window.alert(message);
}

export type ActionWorkContext = { signal: AbortSignal };

/**
 * Guarded CTA runner (recommended):
 * 1) online check before start
 * 2) abort if net drops mid-request
 * 3) safety timeout (internal) so loader never sticks forever
 * 4) late responses after abort are ignored
 */
export async function runGuardedAction<T>(
  work: (ctx: ActionWorkContext) => Promise<T>,
  opts: {
    offlineMessage: string;
    timeoutMessage: string;
    locale: Locale;
    timeoutMs?: number;
  },
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  if (!requireOnline(opts.offlineMessage)) {
    return { ok: false, message: opts.offlineMessage };
  }

  const timeoutMs = opts.timeoutMs ?? ACTION_TIMEOUT_MS;
  const ctrl = new AbortController();

  const onOffline = () => {
    if (!ctrl.signal.aborted) {
      ctrl.abort(new RequestOfflineError());
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("offline", onOffline);
  }

  const timer = setTimeout(() => {
    if (!ctrl.signal.aborted) {
      ctrl.abort(new ActionTimeoutError(timeoutMs));
    }
  }, timeoutMs);

  try {
    const data = await raceAbort(work({ signal: ctrl.signal }), ctrl.signal);
    return { ok: true, data };
  } catch (error) {
    const message = actionErrorMessage(error, opts.locale, {
      offline: opts.offlineMessage,
      timeout: opts.timeoutMessage,
    });
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", onOffline);
    }
  }
}

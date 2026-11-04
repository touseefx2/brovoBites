/** Shared HTTP helpers — timeout + AbortController (professional API layer). */

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class RequestTimeoutError extends Error {
  /** Same code Firestore uses for a deadline — kept on queue rows that timed out. */
  readonly code = "deadline-exceeded";
  constructor(ms = DEFAULT_REQUEST_TIMEOUT_MS) {
    super(`Request timed out after ${ms}ms`);
    this.name = "RequestTimeoutError";
  }
}

export class RequestOfflineError extends Error {
  constructor() {
    super("Network connection lost");
    this.name = "RequestOfflineError";
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: string }).name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * fetch with AbortController:
 * - aborts on timeout
 * - aborts if parent signal aborts (e.g. offline mid-request)
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const ctrl = new AbortController();

  const onParentAbort = () => {
    if (!ctrl.signal.aborted) {
      ctrl.abort(options?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
  };

  if (options?.signal) {
    if (options.signal.aborted) onParentAbort();
    else options.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    ctrl.abort(new RequestTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw error;
    if (isAbortError(error) || (typeof error === "object" && error && "name" in error && (error as { name: string }).name === "AbortError")) {
      const reason = ctrl.signal.reason;
      if (reason instanceof RequestTimeoutError) throw reason;
      if (reason instanceof RequestOfflineError) throw reason;
      if (reason instanceof Error) throw reason;
      throw new RequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Give up waiting on `promise` after `ms` (RequestTimeoutError) and abort
 * `ctrl`, so the work behind it can stop before its next write. The work itself
 * is not cancelled — whatever it already sent may still land.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  ctrl?: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new RequestTimeoutError(ms);
      ctrl?.abort(err);
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Race a promise against an AbortSignal; ignores late success after abort. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        } else {
          resolve(value);
        }
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

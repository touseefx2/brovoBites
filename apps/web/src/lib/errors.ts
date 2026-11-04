import { dictionaries, type Locale, type MessageKey } from "@/i18n/dictionaries";
import { RequestTimeoutError } from "@/lib/http";

function message(locale: Locale, key: MessageKey): string {
  return dictionaries[locale][key] ?? dictionaries.en[key];
}

export function mapFirebaseError(
  error: unknown,
  locale: Locale = "en",
): string {
  if (error instanceof RequestTimeoutError) return message(locale, "errTimeout");
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code: string }).code)
      : "";

  switch (code) {
    case "auth/user-disabled":
      return message(locale, "errAccountDisabled");
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return message(locale, "errInvalidLogin");
    case "auth/too-many-requests":
      return message(locale, "errTooManyRequests");
    case "permission-denied":
    case "firestore/permission-denied":
      return message(locale, "errPermissionDenied");
    case "unavailable":
    case "network-request-failed":
    case "auth/network-request-failed":
      return message(locale, "errUnavailable");
    case "resource-exhausted":
      return message(locale, "errQuota");
    default: {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return message(locale, "errOffline");
      }
      if (error instanceof Error) {
        const m = error.message.toLowerCase();
        if (m.includes("unsupported field value") || m.includes("undefined (")) {
          return message(locale, "errGeneric");
        }
        if (m.includes("permission") || m.includes("insufficient")) {
          return message(locale, "errPermissionDenied");
        }
        if (m.includes("network") || m.includes("offline") || m.includes("failed to fetch")) {
          return message(locale, "errOffline");
        }
        if (error.message.includes("profile") || error.message.includes("Profile")) {
          return message(locale, "errProfileMissing");
        }
        if (error.message.includes("disabled") || error.message.includes("Disabled")) {
          return message(locale, "errAccountDisabled");
        }
        if (error.message.includes("Firebase env missing") || error.message.includes("Firebase configuration")) {
          return message(locale, "errEnvMissing");
        }
        // Prefer known English messages; avoid leaking Roman Urdu leftovers
        if (/^[A-Za-z0-9 .,'!?:\-_/]+$/.test(error.message)) {
          return error.message;
        }
      }
      return message(locale, "errGeneric");
    }
  }
}

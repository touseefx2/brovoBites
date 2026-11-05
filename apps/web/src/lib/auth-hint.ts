/**
 * Last-known staff role on this browser (localStorage), written by AuthProvider.
 *
 * Deliberately free of Firebase / React imports: the public website reads it to
 * pick its Login / Dashboard button without loading Firebase Auth.
 */
import type { UserRole } from "@bravobites/domain";

const AUTH_ROLE_HINT_KEY = "bravobites.auth.role";

/** Last known role for the landing's Login / Dashboard button. null on the server. */
export function getAuthRoleHint(): UserRole | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(AUTH_ROLE_HINT_KEY);
    return v === "owner" || v === "counter" ? v : null;
  } catch {
    return null;
  }
}

export function writeAuthRoleHint(role: UserRole | null) {
  if (typeof window === "undefined") return;
  try {
    if (role) localStorage.setItem(AUTH_ROLE_HINT_KEY, role);
    else localStorage.removeItem(AUTH_ROLE_HINT_KEY);
  } catch {
    // private mode / quota
  }
}

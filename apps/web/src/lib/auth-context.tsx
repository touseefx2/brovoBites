"use client";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AppUser } from "@bravobites/domain";
import { getClientAuth, getClientDb } from "@/lib/firebase/client";
import { mapFirebaseError } from "@/lib/errors";
import { syncShopClock } from "@/lib/shop-clock";
import { clearPosCatalogCache } from "@/lib/pos-catalog";
import { clearDashboardCache } from "@/lib/admin-dashboard-cache";
import { startPosQueueSync, stopPosQueueSync } from "@/lib/pos-queue";
import { startReportOutbox, stopReportOutbox } from "@/lib/report-outbox";
import { startReviewOutbox, stopReviewOutbox } from "@/lib/review-outbox";
import { useLocale } from "@/i18n/locale-context";
import { dictionaries, type MessageKey } from "@/i18n/dictionaries";

const AUTH_ROLE_HINT_KEY = "bravobites.auth.role";
const AUTH_BRANCH_KEY = "bravobites.auth.activeBranch";
/** Last known users/{uid} for offline session restore (same Chrome profile). */
const AUTH_PROFILE_KEY = "bravobites.auth.profile";

function readAuthRoleHint(): AppUser["role"] | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(AUTH_ROLE_HINT_KEY);
    return v === "owner" || v === "counter" ? v : null;
  } catch {
    return null;
  }
}

function writeAuthRoleHint(role: AppUser["role"] | null) {
  if (typeof window === "undefined") return;
  try {
    if (role) localStorage.setItem(AUTH_ROLE_HINT_KEY, role);
    else localStorage.removeItem(AUTH_ROLE_HINT_KEY);
  } catch {
    // private mode / quota
  }
}

/** Last known role for instant landing CTA while Firebase auth restores. */
export function getAuthRoleHint(): AppUser["role"] | null {
  return readAuthRoleHint();
}

function readActiveBranch(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(AUTH_BRANCH_KEY) || null;
  } catch {
    return null;
  }
}

function writeActiveBranch(branchId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (branchId) localStorage.setItem(AUTH_BRANCH_KEY, branchId);
    else localStorage.removeItem(AUTH_BRANCH_KEY);
  } catch {
    // private mode / quota
  }
}

function readCachedProfile(uid: string): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUser;
    if (!parsed || parsed.uid !== uid) return null;
    if (parsed.isActive === false) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(user: AppUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user && user.isActive !== false) {
      localStorage.setItem(AUTH_PROFILE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_PROFILE_KEY);
    }
  } catch {
    // private mode / quota
  }
}

/**
 * Clear session hints + profile cache only.
 * Never touch POS queue / catalog / dashboard IDB — unsynced sales must survive logout.
 */
function clearAuthLocalOnly() {
  writeAuthRoleHint(null);
  writeActiveBranch(null);
  writeCachedProfile(null);
}

function applyCachedProfile(
  uid: string,
  setProfile: (u: AppUser | null) => void,
): boolean {
  const cached = readCachedProfile(uid);
  if (!cached) return false;
  writeAuthRoleHint(cached.role);
  setProfile(cached);
  return true;
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: AppUser | null;
  loading: boolean;
  error: string | null;
  activeBranchId: string | null;
  setActiveBranch: (branchId: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUserDoc(uid: string, data: Record<string, unknown>): AppUser {
  return {
    uid,
    email: String(data.email ?? ""),
    displayName: String(data.displayName ?? ""),
    phone: String(data.phone ?? ""),
    role: data.role === "owner" ? "owner" : "counter",
    branchIds: Array.isArray(data.branchIds)
      ? data.branchIds.map(String)
      : [],
    isActive: data.isActive !== false,
    createdAt: String(data.createdAt ?? ""),
    isPrimaryOwner: data.isPrimaryOwner === true,
    permissions: data.permissions && typeof data.permissions === "object"
      ? {
          canAddExpenses: (data.permissions as Record<string, unknown>).canAddExpenses !== false,
          canDeleteExpenses: (data.permissions as Record<string, unknown>).canDeleteExpenses !== false,
          canApplyDiscount: (data.permissions as Record<string, unknown>).canApplyDiscount !== false,
          canEditOrders: (data.permissions as Record<string, unknown>).canEditOrders !== false,
          canCancelOrders: (data.permissions as Record<string, unknown>).canCancelOrders !== false,
          canManageInventory: (data.permissions as Record<string, unknown>).canManageInventory !== false,
        }
      : undefined,
  };
}

function isOfflineFirestoreError(err: unknown): boolean {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code: string }).code)
      : "";
  return (
    code === "unavailable" ||
    code === "network-request-failed" ||
    code.includes("unavailable")
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { locale, t } = useLocale();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(readActiveBranch);
  const knownPasswordChangedAt = useRef<string | null>(null);
  const passwordBaselineSet = useRef(false);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  // Re-translate stored error key when language changes
  useEffect(() => {
    if (errorKey) {
      setError(t(errorKey));
    }
  }, [locale, errorKey, t]);

  // Align "today" / reports with real server time (POS PC clock may be wrong).
  useEffect(() => {
    void syncShopClock();
    const id = window.setInterval(() => void syncShopClock(), 15 * 60_000);
    // Net back → re-check the clock right away (offline it couldn't).
    const onOnline = () => void syncShopClock();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Ask browser to protect IndexedDB from eviction (offline queue safety).
  useEffect(() => {
    void navigator.storage?.persist?.();
  }, []);

  // Old app versions could save the login password in plain text on this PC —
  // remove it even if nobody logs out or opens the login page again.
  useEffect(() => {
    try {
      localStorage.removeItem("bravobites.login.password");
      localStorage.removeItem("bravobites.login.savePassword");
    } catch { /* private mode */ }
  }, []);

  // Global POS queue sync — runs on every page so orders sync even on dashboard.
  // Signed out (incl. forced: disabled / password changed) → stop, so it never
  // retries with no login and marks the queue failed.
  useEffect(() => {
    if (!profile) {
      stopPosQueueSync();
      stopReportOutbox();
      stopReviewOutbox();
      return;
    }
    startPosQueueSync(profile);
    // Owner-report emails pressed while offline go out once the net is back.
    startReportOutbox();
    // WhatsApp review presses are counted once the order is in the cloud.
    startReviewOutbox();
  }, [profile]);

  useEffect(() => {
    let unsubProfile: Unsubscribe | undefined;
    let unsubAuth: (() => void) | undefined;
    try {
      const auth = getClientAuth();
      unsubAuth = onAuthStateChanged(auth, async (user) => {
        setFirebaseUser(user);
        unsubProfile?.();
        unsubProfile = undefined;

        if (!user) {
          clearAuthLocalOnly();
          setActiveBranchId(null);
          setProfile(null);
          knownPasswordChangedAt.current = null;
          passwordBaselineSet.current = false;
          setLoading(false);
          return;
        }

        // Instant offline restore while Firestore catches up.
        if (applyCachedProfile(user.uid, setProfile)) {
          setError(null);
          setErrorKey(null);
          setLoading(false);
        }

        const ref = doc(getClientDb(), "users", user.uid);
        unsubProfile = onSnapshot(
          ref,
          (snap) => {
            const loc = localeRef.current;
            if (!snap.exists()) {
              // Empty cache while offline ≠ missing account.
              if (snap.metadata.fromCache) {
                if (applyCachedProfile(user.uid, setProfile)) {
                  setError(null);
                  setErrorKey(null);
                } else {
                  setErrorKey("errProfileNeedNetOnce");
                  setError(dictionaries[loc].errProfileNeedNetOnce);
                }
                setLoading(false);
                return;
              }
              writeAuthRoleHint(null);
              writeCachedProfile(null);
              setProfile(null);
              setErrorKey("errProfileMissing");
              setError(dictionaries[loc].errProfileMissing);
              setLoading(false);
              return;
            }

            const mapped = mapUserDoc(
              snap.id,
              snap.data() as Record<string, unknown>,
            );
            if (!mapped.isActive) {
              // Only force logout when server confirms (not stale offline cache).
              if (snap.metadata.fromCache) {
                if (applyCachedProfile(user.uid, setProfile)) {
                  setError(null);
                  setErrorKey(null);
                }
                setLoading(false);
                return;
              }
              clearAuthLocalOnly();
              setActiveBranchId(null);
              setProfile(null);
              knownPasswordChangedAt.current = null;
              passwordBaselineSet.current = false;
              setErrorKey("errAccountDisabled");
              setError(dictionaries[loc].errAccountDisabled);
              void signOut(getClientAuth());
              setLoading(false);
              return;
            }
            const rawData = snap.data() as Record<string, unknown>;
            const pwdChanged = typeof rawData.passwordChangedAt === "string"
              ? rawData.passwordChangedAt
              : null;
            if (!snap.metadata.fromCache) {
              if (passwordBaselineSet.current && pwdChanged !== knownPasswordChangedAt.current) {
                clearAuthLocalOnly();
                setActiveBranchId(null);
                setProfile(null);
                knownPasswordChangedAt.current = null;
                passwordBaselineSet.current = false;
                setErrorKey("errPasswordChanged");
                setError(dictionaries[loc].errPasswordChanged);
                void signOut(getClientAuth());
                setLoading(false);
                return;
              }
              knownPasswordChangedAt.current = pwdChanged;
              passwordBaselineSet.current = true;
            }
            writeAuthRoleHint(mapped.role);
            writeCachedProfile(mapped);
            setProfile(mapped);
            setError(null);
            setErrorKey(null);
            setLoading(false);
          },
          (err) => {
            const loc = localeRef.current;
            if (applyCachedProfile(user.uid, setProfile)) {
              setError(null);
              setErrorKey(null);
              setLoading(false);
              return;
            }
            if (isOfflineFirestoreError(err)) {
              setErrorKey("errProfileNeedNetOnce");
              setError(dictionaries[loc].errProfileNeedNetOnce);
            } else {
              setErrorKey(null);
              setError(mapFirebaseError(err, loc));
            }
            setLoading(false);
          },
        );
      });
    } catch (err) {
      setErrorKey(null);
      setError(mapFirebaseError(err, locale));
      setLoading(false);
    }

    return () => {
      unsubAuth?.();
      unsubProfile?.();
    };
    // locale only used for initial error text; login remaps with current locale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setErrorKey(null);
      setLoading(true);
      try {
        await signInWithEmailAndPassword(
          getClientAuth(),
          email.trim(),
          password,
        );
        const uid = getClientAuth().currentUser?.uid;
        if (uid) {
          let snap;
          try {
            snap = await getDocFromServer(doc(getClientDb(), "users", uid));
          } catch (err) {
            // Offline after auth: use Firestore cache or last local profile.
            if (isOfflineFirestoreError(err)) {
              const cachedSnap = await getDoc(doc(getClientDb(), "users", uid));
              if (cachedSnap.exists()) {
                snap = cachedSnap;
              } else {
                const local = readCachedProfile(uid);
                if (local) {
                  writeAuthRoleHint(local.role);
                  setProfile(local);
                  setLoading(false);
                  return;
                }
                setErrorKey("errProfileNeedNetOnce");
                setError(dictionaries[locale].errProfileNeedNetOnce);
                setLoading(false);
                throw new Error("PROFILE_NEED_NET");
              }
            } else {
              throw err;
            }
          }
          if (!snap.exists()) {
            await signOut(getClientAuth());
            writeCachedProfile(null);
            setErrorKey("errProfileMissing");
            setError(dictionaries[locale].errProfileMissing);
            setLoading(false);
            throw new Error("PROFILE_MISSING");
          }
          if (snap.data()?.isActive === false) {
            await signOut(getClientAuth());
            writeCachedProfile(null);
            setErrorKey("errAccountDisabled");
            setError(dictionaries[locale].errAccountDisabled);
            setLoading(false);
            throw new Error("ACCOUNT_DISABLED");
          }
          const userData = snap.data();
          const mapped = mapUserDoc(uid, userData as Record<string, unknown>);
          writeCachedProfile(mapped);
          writeAuthRoleHint(mapped.role);
          setProfile(mapped);

          if (userData?.role === "counter") {
            const branchIds: string[] = Array.isArray(userData.branchIds) ? userData.branchIds : [];
            if (branchIds.length === 0) {
              await signOut(getClientAuth());
              writeCachedProfile(null);
              setErrorKey("noBranchAssigned");
              setError(dictionaries[locale].noBranchAssigned);
              setLoading(false);
              throw new Error("NO_BRANCH");
            }
            try {
              const branchSnaps = await Promise.all(
                branchIds.map((id) => getDocFromServer(doc(getClientDb(), "branches", id))),
              );
              const hasActive = branchSnaps.some((s) => s.exists() && s.data()?.isActive !== false);
              if (!hasActive) {
                await signOut(getClientAuth());
                writeCachedProfile(null);
                setErrorKey("errBranchDeactivated");
                setError(dictionaries[locale].errBranchDeactivated);
                setLoading(false);
                throw new Error("BRANCH_DEACTIVATED");
              }
            } catch (err) {
              if (
                err instanceof Error &&
                err.message === "BRANCH_DEACTIVATED"
              ) {
                throw err;
              }
              // Offline: skip live branch check; BranchGate / POS catalog handle later.
              if (!isOfflineFirestoreError(err)) throw err;
            }
          }
          setLoading(false);
        }
      } catch (err) {
        setLoading(false);
        if (err instanceof Error) {
          if (err.message === "ACCOUNT_DISABLED") {
            setErrorKey("errAccountDisabled");
            setError(dictionaries[locale].errAccountDisabled);
            throw err;
          }
          if (err.message === "PROFILE_MISSING") {
            setErrorKey("errProfileMissing");
            setError(dictionaries[locale].errProfileMissing);
            throw err;
          }
          if (err.message === "PROFILE_NEED_NET") {
            setErrorKey("errProfileNeedNetOnce");
            setError(dictionaries[locale].errProfileNeedNetOnce);
            throw err;
          }
          if (err.message === "NO_BRANCH") {
            setErrorKey("noBranchAssigned");
            setError(dictionaries[locale].noBranchAssigned);
            throw err;
          }
          if (err.message === "BRANCH_DEACTIVATED") {
            setErrorKey("errBranchDeactivated");
            setError(dictionaries[locale].errBranchDeactivated);
            throw err;
          }
        }
        const msg = mapFirebaseError(err, locale);
        setErrorKey(null);
        setError(msg);
        throw err;
      }
    },
    [locale],
  );

  const setActiveBranch = useCallback(
    (branchId: string): boolean => {
      if (!profile) return false;
      if (profile.role === "owner" || profile.branchIds.includes(branchId)) {
        setActiveBranchId(branchId);
        writeActiveBranch(branchId);
        return true;
      }
      return false;
    },
    [profile],
  );

  // Auto-select branch for counter users with exactly 1 branch
  useEffect(() => {
    if (!profile || profile.role === "owner") return;
    if (profile.branchIds.length === 1) {
      setActiveBranchId(profile.branchIds[0]);
      writeActiveBranch(profile.branchIds[0]);
    } else if (
      activeBranchId &&
      !profile.branchIds.includes(activeBranchId)
    ) {
      setActiveBranchId(null);
      writeActiveBranch(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Real-time: kick staff when their active branch is deactivated (server confirm).
  // Auth local only — POS unsynced queue stays on this PC.
  useEffect(() => {
    if (!profile || profile.role === "owner" || !activeBranchId) return;
    const ref = doc(getClientDb(), "branches", activeBranchId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.metadata.fromCache) return;
        if (!snap.exists() || snap.data()?.isActive === false) {
          clearAuthLocalOnly();
          setActiveBranchId(null);
          setProfile(null);
          setErrorKey("errBranchDeactivated");
          setError(dictionaries[locale].errBranchDeactivated);
          void signOut(getClientAuth());
        }
      },
      () => {
        // Ignore errors — branch might not exist / offline
      },
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, activeBranchId]);

  const logout = useCallback(async () => {
    const uid = profile?.uid;
    stopPosQueueSync();
    clearAuthLocalOnly();
    setActiveBranchId(null);
    await signOut(getClientAuth());
    setProfile(null);
    // Clear per-session caches so next user doesn't see stale data.
    // POS queue is kept — unsynced orders must survive for background sync.
    void clearPosCatalogCache();
    void clearDashboardCache(uid);
    try {
      localStorage.removeItem("bravobites.public-menu.v1");
      localStorage.removeItem("bravobites.public-branches.v1");
    } catch { /* private mode */ }
  }, [profile?.uid]);

  const value = useMemo(
    () => ({
      firebaseUser,
      profile,
      loading,
      error,
      activeBranchId,
      setActiveBranch,
      login,
      logout,
      clearError: () => {
        setError(null);
        setErrorKey(null);
      },
    }),
    [firebaseUser, profile, loading, error, activeBranchId, setActiveBranch, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

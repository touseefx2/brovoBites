"use client";

/**
 * The auth context object, split from auth-context.tsx so screens shown on both
 * the public website and staff routes can read the session when there is one
 * without importing Firebase Auth. Only staff routes mount <AuthProvider>.
 */
import { createContext, useContext } from "react";
import type { User } from "firebase/auth";
import type { AppUser } from "@bravobites/domain";

export interface AuthContextValue {
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

export const AuthContext = createContext<AuthContextValue | null>(null);

/** The session when an AuthProvider is mounted (staff routes), else null (public website). */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}

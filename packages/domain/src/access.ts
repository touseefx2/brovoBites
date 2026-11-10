import type { AppUser, DiscountType, StaffPermissions, UserRole } from "./types";
import { businessDateKey, DEFAULT_BUSINESS_DAY_HOURS, type BusinessDayHours } from "./time";

export function canAccessBranch(user: AppUser, branchId: string): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  return user.branchIds.includes(branchId);
}

export function canManageMenu(role: UserRole): boolean {
  return role === "owner";
}

export function canManageStaff(role: UserRole): boolean {
  return role === "owner";
}

/** Main (primary) owner — only this account can add/remove co-owners. */
export function isPrimaryOwner(user: Pick<AppUser, "role" | "isPrimaryOwner" | "isActive">): boolean {
  return user.isActive !== false && user.role === "owner" && user.isPrimaryOwner === true;
}

/** Only the primary owner may create or disable other owners. */
export function canManageOwners(user: AppUser): boolean {
  return isPrimaryOwner(user);
}

/**
 * Primary may edit own profile (name / phone).
 * Primary may edit a co-owner (name / phone / password).
 * Any owner may edit staff. Co-owners cannot edit the primary.
 */
export function canEditManagedUser(actor: AppUser, target: AppUser): boolean {
  if (!actor.isActive || actor.role !== "owner") return false;
  if (isPrimaryOwner(target)) {
    return isPrimaryOwner(actor) && actor.uid === target.uid;
  }
  if (target.role === "owner") return isPrimaryOwner(actor);
  return true;
}

/** Primary account cannot be disabled or demoted by anyone. */
export function canDeactivateUser(actor: AppUser, target: AppUser): boolean {
  if (!actor.isActive || actor.role !== "owner") return false;
  if (isPrimaryOwner(target)) return false;
  if (target.role === "owner" && !isPrimaryOwner(actor)) return false;
  return true;
}

export function canManageBranches(role: UserRole): boolean {
  return role === "owner";
}

/**
 * Staff always get at least this long after a sale — a sale just before close
 * (e.g. 3:58 AM with a 4 AM close) can still be fixed.
 */
export const STAFF_EDIT_GRACE_MS = 30 * 60 * 1000;

/**
 * Staff may change their own order until the business day it was sold in ends
 * (e.g. 12 PM → 4 AM). After that the day's report and cash count are final —
 * only the owner can change it (every change is in the activity log).
 */
export function isInOrderBusinessDay(
  order: { createdAt: string },
  nowMs: number,
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  const created = new Date(order.createdAt);
  if (!Number.isFinite(created.getTime())) return false;
  return businessDateKey(created, hours) === businessDateKey(new Date(nowMs), hours);
}

/** Staff window for their own order: its business day, and never under STAFF_EDIT_GRACE_MS. */
function inStaffOrderWindow(
  order: { createdAt: string },
  nowMs: number,
  hours: BusinessDayHours,
): boolean {
  const elapsed = nowMs - new Date(order.createdAt).getTime();
  return isInOrderBusinessDay(order, nowMs, hours) || (elapsed >= 0 && elapsed <= STAFF_EDIT_GRACE_MS);
}

/**
 * Owner can edit any order. Staff can edit only their own order, until its
 * business day ends (at least 30 minutes after the sale).
 */
export function canEditOrder(
  user: AppUser,
  order: { createdBy: string; createdAt: string },
  /** Pass the server-corrected clock (shopNow) — the PC clock may be off. */
  nowMs: number = Date.now(),
  /** Shop hours from settings — the business day the order belongs to. */
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  if (user.permissions?.canEditOrders === false) return false;
  if (order.createdBy !== user.uid) return false;
  return inStaffOrderWindow(order, nowMs, hours);
}

/**
 * Owner can cancel any order. Staff can cancel only their own order, until
 * its business day ends (at least 30 minutes after the sale).
 */
export function canCancelOrder(
  user: AppUser,
  order: { createdBy: string; createdAt: string },
  /** Pass the server-corrected clock (shopNow) — the PC clock may be off. */
  nowMs: number = Date.now(),
  /** Shop hours from settings — the business day the order belongs to. */
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  if (user.permissions?.canCancelOrders === false) return false;
  if (order.createdBy !== user.uid) return false;
  return inStaffOrderWindow(order, nowMs, hours);
}

/** Only owner can permanently delete an order. */
export function canDeleteOrder(user: AppUser): boolean {
  return user.isActive && user.role === "owner";
}

export function defaultLandingPath(role: UserRole): string {
  return "/admin";
}

export function formatOrderNumber(n: number): string {
  if (!Number.isFinite(n) || n < 1) return "0001";
  return String(Math.floor(n)).padStart(4, "0");
}

/** Order list / detail / receipt timestamps — always Asia/Karachi. */
export function formatOrderDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const datePart = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
  const timePart = d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Karachi",
    })
    .toUpperCase();
  return `${datePart} · ${timePart}`;
}

/** Google Maps link when both coords are valid numbers. Optional label shows as place title. */
export function googleMapsUrl(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  label?: string | null,
): string | null {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  const title = label?.trim().replace(/[\/?#]/g, " ").replace(/\s+/g, " ");
  if (title) {
    // Search by name, biased to our coords. Google matches the Business Profile place
    // (name + pin). Raw lat/lng URLs only show coordinates; /place/CustomName/@lat
    // is stripped unless that exact name is already a Google place.
    return `https://www.google.com/maps?q=${encodeURIComponent(title)}&ll=${latitude},${longitude}&z=17`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/** Maps link for a branch — prefers name + pin; falls back to name/address search. */
export function branchMapsUrl(branch: {
  name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string | null {
  const name = (branch.name ?? "").trim();
  const address = (branch.address ?? "").trim();
  const searchLabel = [name, address].filter(Boolean).join(", ");
  const withPin = googleMapsUrl(
    branch.latitude,
    branch.longitude,
    searchLabel || null,
  );
  if (withPin) return withPin;
  if (!searchLabel) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchLabel)}`;
}

/** Only owner can manage expenses. */
export function canManageExpenses(role: UserRole): boolean {
  return role === "owner";
}

/** Owner always; staff with permission can receive stock (purchase only). */
export function canManageInventory(user: AppUser): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  return user.permissions?.canManageInventory !== false;
}

/** Staff may only receive / purchase stock into existing items. */
export function canReceiveStock(user: AppUser): boolean {
  return canManageInventory(user);
}

/** Owner always; staff with inventory permission can add/edit catalog items. */
export function canEditInventoryCatalog(user: AppUser): boolean {
  return canManageInventory(user);
}

/** Owner always; staff with inventory permission can waste / adjust (audited). */
export function canWasteOrAdjustStock(user: AppUser): boolean {
  return canManageInventory(user);
}

/** Owner, or staff with inventory permission (their branches only — rules check that). */
export function canDeleteInventory(user: AppUser): boolean {
  return canManageInventory(user);
}

/** Owner can view all sales reports. Counter sees only their own. */
export function canViewFullReports(role: UserRole): boolean {
  return role === "owner";
}

/** Staff can apply discounts when permission is on. Owner always; no amount cap. */
export function canApplyDiscount(
  role: UserRole,
  _discountType: DiscountType,
  discountValue: number,
  permissions?: StaffPermissions,
): boolean {
  if (role === "owner") return true;
  // A zero discount is "no discount" — staff must still be able to check out.
  if (!(discountValue > 0)) return true;
  if (permissions?.canApplyDiscount === false) return false;
  return true;
}

/** Staff can add/edit expenses if permission is granted. Owner always can. */
export function canAddExpenses(user: AppUser): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  return user.permissions?.canAddExpenses !== false;
}

type ExpenseRef = { createdBy: string; createdAt?: string; date?: string };

/**
 * Staff window for their own expense — same as for their orders: until the
 * business day it is dated ends, and at least 30 minutes after it was added.
 * After that the day's report and cash count are final (owner only).
 */
function inStaffExpenseWindow(
  expense: ExpenseRef,
  nowMs: number,
  hours: BusinessDayHours,
): boolean {
  const created = expense.createdAt ? new Date(expense.createdAt).getTime() : NaN;
  const dayKey =
    expense.date?.trim() ||
    (Number.isFinite(created) ? businessDateKey(new Date(created), hours) : "");
  if (dayKey && dayKey === businessDateKey(new Date(nowMs), hours)) return true;
  const elapsed = nowMs - created;
  return elapsed >= 0 && elapsed <= STAFF_EDIT_GRACE_MS;
}

/** Date an expense may be filed under: owner any day up to today, staff only today. */
export function canDateExpense(
  user: AppUser,
  dateKey: string,
  nowMs: number = Date.now(),
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  const todayKey = businessDateKey(new Date(nowMs), hours);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > todayKey) return false;
  return user.role === "owner" || dateKey === todayKey;
}

/**
 * Same gate as add. Owner: any expense. Staff: only expenses they entered,
 * until that day ends (at least 30 minutes after adding) — audited.
 * Without `expense`, answers "can this user edit any expense at all".
 */
export function canEditExpense(
  user: AppUser,
  expense?: ExpenseRef | null,
  /** Pass the server-corrected clock (shopNow) — the PC clock may be off. */
  nowMs: number = Date.now(),
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  if (!canAddExpenses(user)) return false;
  if (user.role === "owner" || !expense) return true;
  return expense.createdBy === user.uid && inStaffExpenseWindow(expense, nowMs, hours);
}

/**
 * Owner: any expense. Staff (with delete permission): only expenses they
 * entered, until that day ends (at least 30 minutes after adding) — audited.
 * Without `expense`, answers "can this user delete any expense at all".
 */
export function canDeleteExpense(
  user: AppUser,
  expense?: ExpenseRef | null,
  /** Pass the server-corrected clock (shopNow) — the PC clock may be off. */
  nowMs: number = Date.now(),
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  if (user.permissions?.canDeleteExpenses === false) return false;
  if (!expense) return true;
  return expense.createdBy === user.uid && inStaffExpenseWindow(expense, nowMs, hours);
}

/**
 * Owner can refund any order. Staff can refund their own order — a refund is
 * a partial cancel, so it follows the cancel permission and window (until its
 * business day ends, at least 30 minutes after the sale).
 */
export function canRefundOrder(
  user: AppUser,
  order?: { createdBy: string; createdAt: string } | null,
  /** Pass the server-corrected clock (shopNow) — the PC clock may be off. */
  nowMs: number = Date.now(),
  hours: BusinessDayHours = DEFAULT_BUSINESS_DAY_HOURS,
): boolean {
  if (!user.isActive) return false;
  if (user.role === "owner") return true;
  if (!order) return false;
  return canCancelOrder(user, order, nowMs, hours);
}

export function hasMapLocation(branch: {
  name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return branchMapsUrl(branch) != null;
}

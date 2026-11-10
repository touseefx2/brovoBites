import { describe, expect, it } from "vitest";
import type { AppUser, StaffPermissions } from "./types";
import { DEFAULT_STAFF_PERMISSIONS } from "./types";
import {
  branchMapsUrl,
  canAccessBranch,
  canAddExpenses,
  canApplyDiscount,
  canCancelOrder,
  canDeleteExpense,
  canDeleteInventory,
  canDeleteOrder,
  canDateExpense,
  canEditExpense,
  canEditInventoryCatalog,
  canEditOrder,
  canManageBranches,
  canManageExpenses,
  canManageInventory,
  canManageMenu,
  canManageStaff,
  canReceiveStock,
  canRefundOrder,
  canEditManagedUser,
  canDeactivateUser,
  canManageOwners,
  canWasteOrAdjustStock,
  isPrimaryOwner,
  canViewFullReports,
  defaultLandingPath,
  formatOrderDateTime,
  formatOrderNumber,
  googleMapsUrl,
  hasMapLocation,
} from "./access";

function user(partial: Partial<AppUser> & Pick<AppUser, "role">): AppUser {
  return {
    uid: partial.uid ?? "u1",
    email: "a@b.com",
    displayName: "Test",
    phone: "",
    role: partial.role,
    branchIds: partial.branchIds ?? ["main"],
    isActive: partial.isActive ?? true,
    createdAt: "",
    isPrimaryOwner: partial.isPrimaryOwner,
    permissions: partial.permissions,
  };
}

const allOn: StaffPermissions = { ...DEFAULT_STAFF_PERMISSIONS };
const allOff: StaffPermissions = {
  canAddExpenses: false,
  canDeleteExpenses: false,
  canApplyDiscount: false,
  canEditOrders: false,
  canCancelOrders: false,
  canManageInventory: false,
};

describe("googleMapsUrl", () => {
  it("builds named search biased to coords", () => {
    expect(googleMapsUrl(31.5204, 74.3587, "Brovo Bites")).toBe(
      "https://www.google.com/maps?q=Brovo%20Bites&ll=31.5204,74.3587&z=17",
    );
  });

  it("builds coords-only search without label", () => {
    expect(googleMapsUrl(31.5204, 74.3587)).toBe(
      "https://www.google.com/maps/search/?api=1&query=31.5204,74.3587",
    );
  });

  it("returns null when incomplete", () => {
    expect(googleMapsUrl(null, 74.35)).toBeNull();
    expect(googleMapsUrl(31.52, null)).toBeNull();
    expect(googleMapsUrl(Number.NaN, 1)).toBeNull();
  });
});

describe("branchMapsUrl", () => {
  it("uses branch name search biased to coords when coords exist", () => {
    expect(
      branchMapsUrl({
        name: "Brovo Bites Main Branch",
        address: "Main Road",
        latitude: 33.69,
        longitude: 73.01,
      }),
    ).toBe(
      "https://www.google.com/maps?q=Brovo%20Bites%20Main%20Branch%2C%20Main%20Road&ll=33.69,73.01&z=17",
    );
  });

  it("falls back to name/address search", () => {
    expect(
      branchMapsUrl({
        name: "Brovo Bites",
        address: "Main Road",
        latitude: null,
        longitude: null,
      }),
    ).toBe(
      "https://www.google.com/maps/search/?api=1&query=Brovo%20Bites%2C%20Main%20Road",
    );
  });

  it("hasMapLocation true with address only", () => {
    expect(
      hasMapLocation({ name: "Shop", address: "Lahore", latitude: null, longitude: null }),
    ).toBe(true);
    expect(hasMapLocation({ name: "", address: "", latitude: null, longitude: null })).toBe(false);
  });
});

describe("role helpers", () => {
  it("gates owner-only managers", () => {
    expect(canManageMenu("owner")).toBe(true);
    expect(canManageMenu("counter")).toBe(false);
    expect(canManageStaff("owner")).toBe(true);
    expect(canManageStaff("counter")).toBe(false);
    expect(canManageBranches("owner")).toBe(true);
    expect(canManageBranches("counter")).toBe(false);
    expect(canManageExpenses("owner")).toBe(true);
    expect(canManageExpenses("counter")).toBe(false);
    expect(canViewFullReports("owner")).toBe(true);
    expect(canViewFullReports("counter")).toBe(false);
    expect(defaultLandingPath("counter")).toBe("/admin");
  });
});

describe("canAccessBranch", () => {
  it("owner any branch; staff only assigned; inactive never", () => {
    expect(canAccessBranch(user({ role: "owner" }), "other")).toBe(true);
    expect(canAccessBranch(user({ role: "counter", branchIds: ["main"] }), "main")).toBe(true);
    expect(canAccessBranch(user({ role: "counter", branchIds: ["main"] }), "other")).toBe(false);
    expect(canAccessBranch(user({ role: "owner", isActive: false }), "main")).toBe(false);
  });
});

describe("order window", () => {
  // Shop day 12 PM → 4 AM (Karachi). Sold 1 PM on the 9th.
  const hours = { start: "12:00", end: "04:00" };
  const order = { createdBy: "staff", createdAt: "2026-10-09T08:00:00.000Z" };
  const lateSameDay = Date.parse("2026-10-10T03:30:00+05:00");
  const afterClose = Date.parse("2026-10-10T04:30:00+05:00");

  it("owner can always edit/cancel/delete/refund", () => {
    const owner = user({ role: "owner" });
    expect(canEditOrder(owner, order, afterClose, hours)).toBe(true);
    expect(canCancelOrder(owner, order, afterClose, hours)).toBe(true);
    expect(canDeleteOrder(owner)).toBe(true);
    expect(canRefundOrder(owner)).toBe(true);
  });

  it("staff edit only own order until its business day ends", () => {
    const staff = user({ role: "counter", uid: "staff", permissions: allOn });
    expect(canEditOrder(staff, order, lateSameDay, hours)).toBe(true);
    expect(canEditOrder(staff, order, afterClose, hours)).toBe(false);
    expect(canEditOrder(staff, { ...order, createdBy: "other" }, lateSameDay, hours)).toBe(false);
    expect(
      canEditOrder(user({ role: "counter", uid: "staff", permissions: allOff }), order, lateSameDay, hours),
    ).toBe(false);
  });

  it("staff cancel only own order until its business day ends", () => {
    const staff = user({ role: "counter", uid: "staff", permissions: allOn });
    expect(canCancelOrder(staff, order, lateSameDay, hours)).toBe(true);
    expect(canCancelOrder(staff, order, afterClose, hours)).toBe(false);
    expect(
      canCancelOrder(user({ role: "counter", uid: "staff", permissions: allOff }), order, lateSameDay, hours),
    ).toBe(false);
  });

  it("a sale just before close still gets 30 minutes", () => {
    const staff = user({ role: "counter", uid: "staff", permissions: allOn });
    const lateSale = { createdBy: "staff", createdAt: "2026-10-09T22:50:00.000Z" }; // 3:50 AM
    expect(canEditOrder(staff, lateSale, Date.parse("2026-10-10T04:10:00+05:00"), hours)).toBe(true);
    expect(canCancelOrder(staff, lateSale, Date.parse("2026-10-10T04:10:00+05:00"), hours)).toBe(true);
    expect(canEditOrder(staff, lateSale, Date.parse("2026-10-10T04:30:00+05:00"), hours)).toBe(false);
  });

  it("a sale after close belongs to the next business day", () => {
    const staff = user({ role: "counter", uid: "staff", permissions: allOn });
    const gapSale = { createdBy: "staff", createdAt: "2026-10-10T05:00:00.000Z" }; // 10 AM
    expect(canEditOrder(staff, gapSale, Date.parse("2026-10-11T02:00:00+05:00"), hours)).toBe(true);
    expect(canEditOrder(staff, gapSale, Date.parse("2026-10-11T04:30:00+05:00"), hours)).toBe(false);
  });

  it("staff never delete; refund only their own order, like cancel", () => {
    const staff = user({ role: "counter", uid: "staff", permissions: allOn });
    expect(canDeleteOrder(staff)).toBe(false);
    expect(canRefundOrder(staff)).toBe(false);
    expect(canRefundOrder(staff, order, lateSameDay, hours)).toBe(true);
    expect(canRefundOrder(staff, order, afterClose, hours)).toBe(false);
    expect(canRefundOrder(staff, { ...order, createdBy: "other" }, lateSameDay, hours)).toBe(false);
    expect(
      canRefundOrder(user({ role: "counter", uid: "staff", permissions: allOff }), order, lateSameDay, hours),
    ).toBe(false);
  });
});

describe("canApplyDiscount", () => {
  it("owner unlimited; zero discount always allowed for staff", () => {
    expect(canApplyDiscount("owner", "percent", 90)).toBe(true);
    expect(canApplyDiscount("counter", "percent", 0, allOff)).toBe(true);
    expect(canApplyDiscount("counter", "fixed", 0, allOff)).toBe(true);
  });

  it("staff unlimited when permission on; blocked when permission off", () => {
    expect(canApplyDiscount("counter", "percent", 10, allOn)).toBe(true);
    expect(canApplyDiscount("counter", "percent", 25, allOn)).toBe(true);
    expect(canApplyDiscount("counter", "percent", 90, allOn)).toBe(true);
    expect(canApplyDiscount("counter", "fixed", 200, allOn)).toBe(true);
    expect(canApplyDiscount("counter", "fixed", 5000, allOn)).toBe(true);
    expect(canApplyDiscount("counter", "percent", 5, allOff)).toBe(false);
  });
});

// Shop day 12 PM → 4 AM; "now" is 2 AM — still the 9th's business day.
const expHours = { start: "12:00", end: "04:00" };
const expNow = Date.parse("2026-10-10T02:00:00+05:00");
const expAfterClose = Date.parse("2026-10-10T04:40:00+05:00");
const mineToday = { createdBy: "s1", date: "2026-10-09", createdAt: "2026-10-09T10:00:00.000Z" };
const mineYesterday = { createdBy: "s1", date: "2026-10-08", createdAt: "2026-10-08T10:00:00.000Z" };

describe("expense delete", () => {
  const owner = user({ role: "owner", uid: "boss" });
  const staff = user({ role: "counter", uid: "s1", permissions: allOn });
  const locked = user({ role: "counter", uid: "s1", permissions: allOff });
  const mine = mineToday;
  const theirs = { ...mineToday, createdBy: "s2" };
  const del = (u: AppUser, e: typeof mine, now = expNow) => canDeleteExpense(u, e, now, expHours);

  it("owner can delete anyone's expense, any day", () => {
    expect(del(owner, theirs)).toBe(true);
    expect(del(owner, { ...mineYesterday, createdBy: "s2" })).toBe(true);
  });

  it("staff delete only their own expenses, until that day ends", () => {
    expect(del(staff, mine)).toBe(true);
    expect(del(staff, theirs)).toBe(false);
    expect(del(staff, mineYesterday)).toBe(false);
    expect(del(staff, mine, expAfterClose)).toBe(false);
  });

  it("missing delete permission (old staff docs) counts as allowed", () => {
    const legacy = user({ role: "counter", uid: "s1" });
    expect(del(legacy, mine)).toBe(true);
  });

  it("staff without delete permission or inactive cannot delete", () => {
    expect(del(locked, mine)).toBe(false);
    expect(del(user({ role: "counter", uid: "s1", isActive: false }), mine)).toBe(false);
  });

  it("delete is its own toggle, separate from add", () => {
    const deleteOnly = user({
      role: "counter",
      uid: "s1",
      permissions: { ...allOn, canAddExpenses: false },
    });
    const addOnly = user({
      role: "counter",
      uid: "s1",
      permissions: { ...allOn, canDeleteExpenses: false },
    });
    expect(del(deleteOnly, mine)).toBe(true);
    expect(del(addOnly, mine)).toBe(false);
  });
});

describe("expense edit", () => {
  const owner = user({ role: "owner", uid: "boss" });
  const staff = user({ role: "counter", uid: "s1", permissions: allOn });
  const locked = user({ role: "counter", uid: "s1", permissions: allOff });
  const theirs = { ...mineToday, createdBy: "s2" };
  const edit = (u: AppUser, e: typeof mineToday, now = expNow) => canEditExpense(u, e, now, expHours);

  it("owner can edit anyone's expense, any day", () => {
    expect(edit(owner, theirs)).toBe(true);
    expect(edit(owner, mineYesterday)).toBe(true);
  });

  it("staff edit only their own expenses, until that day ends", () => {
    expect(edit(staff, mineToday)).toBe(true);
    expect(edit(staff, theirs)).toBe(false);
    expect(edit(staff, mineYesterday)).toBe(false);
    expect(edit(staff, mineToday, expAfterClose)).toBe(false);
  });

  it("an expense added just before close still gets 30 minutes", () => {
    const late = { createdBy: "s1", date: "2026-10-09", createdAt: "2026-10-09T22:55:00.000Z" }; // 3:55 AM
    expect(edit(staff, late, Date.parse("2026-10-10T04:20:00+05:00"))).toBe(true);
    expect(edit(staff, late, Date.parse("2026-10-10T04:30:00+05:00"))).toBe(false);
  });

  it("edit follows the add permission", () => {
    expect(edit(locked, mineToday)).toBe(false);
  });

  it("staff file expenses under today only; owner any day up to today", () => {
    expect(canDateExpense(staff, "2026-10-09", expNow, expHours)).toBe(true);
    expect(canDateExpense(staff, "2026-10-08", expNow, expHours)).toBe(false);
    expect(canDateExpense(owner, "2026-10-01", expNow, expHours)).toBe(true);
    expect(canDateExpense(owner, "2026-10-10", expNow, expHours)).toBe(false);
  });
});

describe("expenses and inventory permissions", () => {
  it("owner always; staff honour flags; staff can edit catalog/expenses", () => {
    const owner = user({ role: "owner" });
    const staff = user({ role: "counter", permissions: allOn });
    const locked = user({ role: "counter", permissions: allOff });
    expect(canAddExpenses(owner)).toBe(true);
    expect(canAddExpenses(staff)).toBe(true);
    expect(canAddExpenses(locked)).toBe(false);
    expect(canEditExpense(staff)).toBe(true);
    expect(canEditExpense(locked)).toBe(false);
    expect(canDeleteExpense(owner)).toBe(true);
    expect(canDeleteExpense(staff)).toBe(true);
    expect(canDeleteExpense(locked)).toBe(false);
    expect(canManageInventory(owner)).toBe(true);
    expect(canManageInventory(staff)).toBe(true);
    expect(canManageInventory(locked)).toBe(false);
    expect(canReceiveStock(owner)).toBe(true);
    expect(canReceiveStock(staff)).toBe(true);
    expect(canReceiveStock(locked)).toBe(false);
    expect(canEditInventoryCatalog(owner)).toBe(true);
    expect(canEditInventoryCatalog(staff)).toBe(true);
    expect(canEditInventoryCatalog(locked)).toBe(false);
    expect(canWasteOrAdjustStock(owner)).toBe(true);
    expect(canWasteOrAdjustStock(staff)).toBe(true);
    expect(canWasteOrAdjustStock(locked)).toBe(false);
    expect(canDeleteInventory(owner)).toBe(true);
    expect(canDeleteInventory(staff)).toBe(true);
    expect(canDeleteInventory(locked)).toBe(false);
  });
});

describe("primary owner vs co-owner", () => {
  it("only primary can manage/edit/disable co-owners; primary is protected", () => {
    const primary = user({ role: "owner", isPrimaryOwner: true });
    const co = user({ role: "owner", uid: "co", isPrimaryOwner: false });
    const staff = user({ role: "counter", uid: "s1" });

    expect(isPrimaryOwner(primary)).toBe(true);
    expect(isPrimaryOwner(co)).toBe(false);
    expect(canManageOwners(primary)).toBe(true);
    expect(canManageOwners(co)).toBe(false);

    expect(canEditManagedUser(primary, co)).toBe(true);
    expect(canEditManagedUser(co, primary)).toBe(false);
    expect(canEditManagedUser(primary, primary)).toBe(true);
    expect(canEditManagedUser(co, staff)).toBe(true);
    expect(canEditManagedUser(primary, staff)).toBe(true);

    expect(canDeactivateUser(primary, co)).toBe(true);
    expect(canDeactivateUser(co, primary)).toBe(false);
    expect(canDeactivateUser(primary, primary)).toBe(false);
    expect(canDeactivateUser(co, staff)).toBe(true);
    expect(canDeactivateUser(primary, staff)).toBe(true);
  });
});

describe("format helpers", () => {
  it("pads order numbers and formats datetime in Asia/Karachi", () => {
    expect(formatOrderNumber(25)).toBe("0025");
    expect(formatOrderNumber(0)).toBe("0001");
    expect(formatOrderDateTime("not-a-date")).toBe("not-a-date");
    // 10:00 UTC = 15:00 Pakistan
    expect(formatOrderDateTime("2026-09-27T10:00:00.000Z")).toBe(
      "27 Sept 2026 · 3:00 PM",
    );
  });
});

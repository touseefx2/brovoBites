/**
 * Customers: one record per phone number. Phones arrive in every shape
 * ("+92 300 1234567", "0300-1234567", "923001234567", WhatsApp's invisible
 * direction marks…) — they are reduced to one key ("03001234567") so the same
 * person is one customer.
 */

/** Saved addresses kept per customer (most recent first). */
export const CUSTOMER_MAX_ADDRESSES = 5;
/** Other names seen with the same phone (family members, spellings). */
export const CUSTOMER_MAX_OTHER_NAMES = 5;
export const CUSTOMER_NOTE_MAX = 300;

export interface Customer {
  /** = phone key ("03001234567"). */
  id: string;
  phone: string;
  name: string;
  /** Other names used with this phone, newest first. */
  otherNames: string[];
  /** Delivery addresses, newest first. */
  addresses: string[];
  /** Counter note ("extra spicy", "gate 2"). */
  note: string;
  orderCount: number;
  totalSpent: number;
  firstOrderAt: string;
  lastOrderAt: string;
  lastOrderId?: string;
  lastBranchId?: string;
  /** Who last wrote the note. */
  noteUpdatedByName?: string;
  /** Owner set the name by hand: the orders' names don't replace it. */
  nameLocked?: boolean;
  /** Other numbers merged into this customer by the owner. */
  altPhones?: string[];
  /** This number was merged into another customer (that key). */
  mergedInto?: string;
}

// Invisible marks a copy from WhatsApp / contacts leaves around a number.
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;

/** Urdu / Arabic-Indic digits (۰۳۰۰…, ٠٣٠٠…) as ASCII 0–9. */
export function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) & 0xf));
}

/**
 * A phone as its key: digits only, Pakistani numbers with their trunk 0
 * (03XXXXXXXXX for mobiles; +92 / 0092 / 92 / missing 0 fixed), foreign
 * numbers without the "00" / "+". "" when there is no usable number.
 * A key is its own key: phoneKey(phoneKey(x)) === phoneKey(x).
 */
export function phoneKey(raw: string | null | undefined): string {
  let d = asciiDigits(String(raw ?? "")).replace(INVISIBLE, "").replace(/\D/g, "");
  // Country code, in any order and even typed twice ("+92 0092 300…"): "00" is the same as
  // "+" (0092… = +92…, 00971… = +971…); 92 is Pakistan (no local number starts with 92);
  // "092 300 1234567" is +92 written with a 0 (local 092x numbers are only 10–11 digits).
  let stripped = false;
  for (;;) {
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("092") && (d.length === 12 || d.length === 13)) d = d.slice(1);
    else if (d.startsWith("92") && d.length >= 11) {
      d = d.slice(2);
      stripped = true;
    } else break;
  }
  // Put the trunk 0 back: after a country code any national number ("21 111 123 456" → 021…);
  // without one, a mobile / landline typed without its 0 ("3001234567", "511234567").
  if (!d.startsWith("0") && d.length >= 9 && d.length <= (stripped ? 11 : 10)) d = `0${d}`;
  // Two numbers typed in one box, or junk: no key (the rules accept 7–15 digits).
  return d.length >= 7 && d.length <= 15 ? d : "";
}

/** A Pakistani mobile key: 03XXXXXXXXX. */
export function isMobileKey(key: string): boolean {
  return /^03\d{9}$/.test(key);
}

/** "0300 1234567" for a mobile key; other numbers as they are. */
export function formatPhone(key: string): string {
  return isMobileKey(key) ? `${key.slice(0, 4)} ${key.slice(4)}` : key;
}

const norm = (s: string) => s.replace(INVISIBLE, "").trim().replace(/\s+/g, " ");
const lower = (s: string) => norm(s).toLowerCase();

/** Without repeats (case-insensitive), first kept. */
function dedupe(list: readonly string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = lower(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `value` first, then the rest without it (case-insensitive), at most `max`. */
export function pushRecent(list: readonly string[], value: string, max: number): string[] {
  const v = norm(value);
  if (!v) return list.slice(0, max);
  return [v, ...list.filter((x) => lower(x) !== lower(v))].slice(0, max);
}

export type CustomerMatch = { customer: Customer; rank: number };

/**
 * Customers for a search box: by phone (any part of the number, typed in any
 * shape) or by name (start of a word first, then anywhere; other names too).
 * Best first; recent customers win ties.
 */
export function searchCustomers(customers: readonly Customer[], query: string, limit = 8): Customer[] {
  const q = lower(asciiDigits(query));
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  // "300 123…" without the 0, or a partly typed "+92 300…" / "0092 300…" / "92300…":
  // compare against the key's form too.
  const qKey = digits.length >= 7 ? phoneKey(digits) : "";
  const intl = /^(\+|00)92/.test(q.replace(/[^\d+]/g, "")) || (digits.startsWith("92") && digits.length >= 5);
  const tail = (intl ? digits.replace(/^(00)?92/, "") : digits).replace(/^0+/, "");
  // A foreign number typed with "00" ("00971 50…") is kept without it ("971…").
  const plain = digits.startsWith("00") ? digits.slice(2) : "";
  const words = q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

  const matches: CustomerMatch[] = [];
  for (const c of customers) {
    let rank = 0;
    if (digits.length >= 3) {
      if (qKey && c.id === qKey) rank = 100;
      else if (c.id.startsWith(digits) || (tail && c.id.startsWith(`0${tail}`)) || (plain && c.id.startsWith(plain))) rank = 80;
      // Middle digits as typed ("4445"); a typed leading 0 means the start, handled above.
      else if (c.id.includes(digits)) rank = 60;
    }
    if (rank === 0 && words.length > 0) {
      const names = [c.name, ...c.otherNames].map(lower);
      const all = (fn: (n: string, w: string) => boolean) => names.some((n) => words.every((w) => fn(n, w)));
      if (names.some((n) => n === q)) rank = 70;
      else if (all((n, w) => n.split(" ").some((part) => part.startsWith(w)))) rank = 50;
      else if (all((n, w) => n.includes(w))) rank = 30;
    }
    if (rank > 0) matches.push({ customer: c, rank });
  }
  matches.sort(
    (a, b) =>
      b.rank - a.rank ||
      b.customer.lastOrderAt.localeCompare(a.customer.lastOrderAt) ||
      a.customer.name.localeCompare(b.customer.name),
  );
  return matches.slice(0, limit).map((m) => m.customer);
}

/** What one order adds to its customer (before it reaches the cloud, or for a rebuild). */
export interface CustomerVisit {
  key: string;
  name: string;
  address?: string;
  total: number;
  at: string;
}

/**
 * A customer after one more order. The name on the newest order becomes the
 * name; the old one moves to otherNames. Pure — the caller decides once-only.
 */
export function applyVisit(prev: Customer | null, v: CustomerVisit): Customer {
  const name = norm(v.name);
  const base: Customer = prev ?? {
    id: v.key,
    phone: v.key,
    name: name,
    otherNames: [],
    addresses: [],
    note: "",
    orderCount: 0,
    totalSpent: 0,
    firstOrderAt: v.at,
    lastOrderAt: v.at,
  };
  const newer = !prev || v.at >= prev.lastOrderAt;
  let displayName = base.name;
  let otherNames = base.otherNames;
  if (name && lower(name) !== lower(base.name)) {
    if (newer || !base.name) {
      // The newest order's name leads; the old one is kept among the others.
      displayName = name;
      const others = base.name ? [base.name, ...otherNames] : otherNames;
      otherNames = dedupe(others.filter((n) => lower(n) !== lower(name))).slice(0, CUSTOMER_MAX_OTHER_NAMES);
    } else if (!otherNames.some((n) => lower(n) === lower(name))) {
      otherNames = [...otherNames, name].slice(0, CUSTOMER_MAX_OTHER_NAMES);
    }
  }
  const addr = v.address ? norm(v.address) : "";
  const addresses = addr
    ? newer
      ? pushRecent(base.addresses, addr, CUSTOMER_MAX_ADDRESSES)
      : base.addresses.some((a) => lower(a) === lower(addr))
        ? base.addresses
        : [...base.addresses, addr].slice(0, CUSTOMER_MAX_ADDRESSES)
    : base.addresses;
  return {
    ...base,
    name: displayName,
    otherNames,
    addresses,
    orderCount: base.orderCount + 1,
    totalSpent: Math.round((base.totalSpent + (Number(v.total) || 0)) * 100) / 100,
    // A customer with only a note so far has no first order yet.
    firstOrderAt: !base.firstOrderAt || v.at < base.firstOrderAt ? v.at : base.firstOrderAt,
    lastOrderAt: newer ? v.at : base.lastOrderAt,
  };
}

/** What a customer's stats are built from: their orders. */
export interface CustomerOrderLike {
  id: string;
  createdAt: string;
  status?: string;
  total: number;
  refundAmount?: number;
  customerName?: string;
  deliveryAddress?: string;
  branchId?: string;
}

/** A customer's numbers, from their orders (the source of truth; see statsFromOrders). */
export interface CustomerStats {
  name: string;
  otherNames: string[];
  addresses: string[];
  orderCount: number;
  totalSpent: number;
  firstOrderAt: string;
  lastOrderAt: string;
  lastOrderId: string;
  lastBranchId: string;
}

/**
 * A customer's stats rebuilt from all their orders — so cancels, refunds,
 * edits, a phone changed later or a sale uploaded twice can never leave the
 * numbers wrong. Cancelled orders don't count; refunds come off the spend.
 * Names and addresses newest first. null when no order counts.
 */
export function statsFromOrders(orders: readonly CustomerOrderLike[]): CustomerStats | null {
  const counted = orders
    .filter((o) => o.status !== "cancelled")
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  if (counted.length === 0) return null;
  const names = dedupe(counted.map((o) => norm(o.customerName ?? "")));
  const addresses = dedupe(counted.map((o) => norm(o.deliveryAddress ?? ""))).slice(0, CUSTOMER_MAX_ADDRESSES);
  const spent = counted.reduce((s, o) => s + Math.max(0, (Number(o.total) || 0) - (Number(o.refundAmount) || 0)), 0);
  const newest = counted[0]!;
  return {
    name: names[0] ?? "",
    otherNames: names.slice(1, 1 + CUSTOMER_MAX_OTHER_NAMES),
    addresses,
    orderCount: counted.length,
    totalSpent: Math.round(spent * 100) / 100,
    firstOrderAt: counted[counted.length - 1]!.createdAt,
    lastOrderAt: newest.createdAt,
    lastOrderId: newest.id,
    lastBranchId: newest.branchId ?? "",
  };
}

/** Dashboard numbers over the customer list. `sinceIso`: start of "new" (e.g. this month). */
export function customerKpis(customers: readonly Customer[], sinceIso: string) {
  const active = customers.filter((c) => c.orderCount > 0);
  const repeat = active.filter((c) => c.orderCount >= 2).length;
  return {
    total: active.length,
    repeat,
    repeatPct: active.length ? Math.round((repeat / active.length) * 100) : 0,
    newSince: active.filter((c) => c.firstOrderAt >= sinceIso).length,
  };
}

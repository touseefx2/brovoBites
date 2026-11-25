import { describe, expect, it } from "vitest";
import { applyVisit, customerKpis, formatPhone, isMobileKey, phoneKey, pushRecent, searchCustomers, statsFromOrders, type Customer } from "./customers";

describe("phoneKey", () => {
  it("reduces every shape seen on the live orders to one key", () => {
    const key = "03001234567";
    for (const raw of [
      "03001234567",
      "0300 1234567",
      "0300-1234567",
      "+92 300 1234567",
      "923001234567",
      "00923001234567",
      "3001234567",
      "‪+92 300 1234567‬", // WhatsApp copy: LRE … PDF marks
      "03001234567‬",
      " 0300‎1234567 ",
    ]) {
      expect(phoneKey(raw)).toBe(key);
    }
  });
  it("+92 with the trunk 0 typed too, and landlines with a country code, match the local form", () => {
    expect(phoneKey("+92 0300 1234567")).toBe("03001234567");
    expect(phoneKey("+92 51 1234567")).toBe("0511234567");
    expect(phoneKey("051 1234567")).toBe("0511234567");
    expect(phoneKey("0092 51 1234567")).toBe("0511234567");
  });
  it("two numbers in one box or too long: no key (rules accept 7–15 digits)", () => {
    expect(phoneKey("0300 1234567 / 0321 7654321")).toBe("");
    expect(phoneKey("1234567890123456")).toBe("");
  });
  it("keeps other numbers as digits; nothing usable → empty", () => {
    expect(phoneKey("051-1234567")).toBe("0511234567");
    expect(phoneKey("")).toBe("");
    expect(phoneKey("12")).toBe("");
    expect(phoneKey(undefined)).toBe("");
  });
  it("a key is its own key, also for a doubled country code", () => {
    for (const raw of [
      "+92 92 300 1234567",
      "0092 92 300 1234567",
      "923001234567",
      "+92 21 111 123 456",
      "+971 50 123 4567",
      "00971501234567",
      "+1 212 555 1234",
      "511234567",
      "0300 1234567",
      "+92 0092 300 1234567",
      "+920092 3001234567",
      "092 300 1234567",
      "0922 123456",
    ]) {
      const k = phoneKey(raw);
      expect(k, raw).not.toBe("");
      expect(phoneKey(k), raw).toBe(k);
    }
    expect(phoneKey("+92 92 300 1234567")).toBe("03001234567");
    expect(phoneKey("+92 0092 300 1234567")).toBe("03001234567");
  });
  it("+92 written as 092 matches the local form; a local 092x number stays as it is", () => {
    expect(phoneKey("092 300 1234567")).toBe("03001234567");
    expect(phoneKey("092-51-1234567")).toBe("0511234567");
    expect(phoneKey("0922 123456")).toBe("0922123456");
  });
  it("12-digit national numbers and foreign numbers get one key whatever the prefix", () => {
    expect(phoneKey("+92 21 111 123 456")).toBe(phoneKey("021-111-123-456"));
    expect(phoneKey("021-111-123-456")).toBe("021111123456");
    expect(phoneKey("+971 50 123 4567")).toBe(phoneKey("00971 50 123 4567"));
    expect(phoneKey("+44 20 1234 5678")).toBe(phoneKey("0044 20 1234 5678"));
  });
  it("Urdu / Arabic-Indic digits", () => {
    expect(phoneKey("۰۳۰۰۱۲۳۴۵۶۷")).toBe("03001234567");
    expect(phoneKey("٠٣٠٠١٢٣٤٥٦٧")).toBe("03001234567");
  });
  it("formatPhone / isMobileKey", () => {
    expect(formatPhone("03001234567")).toBe("0300 1234567");
    expect(isMobileKey("03001234567")).toBe(true);
    expect(isMobileKey("0511234567")).toBe(false);
    expect(formatPhone("0511234567")).toBe("0511234567");
  });
});

const C = (id: string, name: string, extra: Partial<Customer> = {}): Customer => ({
  id, phone: id, name, otherNames: [], addresses: [], note: "", orderCount: 1, totalSpent: 0,
  firstOrderAt: "2026-11-01T00:00:00Z", lastOrderAt: "2026-11-01T00:00:00Z", ...extra,
});

describe("searchCustomers", () => {
  const list = [
    C("03001234567", "Ali Khan", { lastOrderAt: "2026-11-20T00:00:00Z" }),
    C("03211234567", "Alina Shah", { lastOrderAt: "2026-11-24T00:00:00Z" }),
    C("03334445556", "Umar Farooq", { otherNames: ["Umar Bhai"] }),
    C("03123004567", "Sara"),
  ];
  const ids = (q: string) => searchCustomers(list, q).map((c) => c.id);

  it("finds by phone in any shape and by any part", () => {
    expect(ids("+92 300 1234567")[0]).toBe("03001234567");
    expect(ids("0300")).toEqual(["03001234567"]);
    expect(ids("300 12")[0]).toBe("03001234567"); // no leading 0, with a space
    expect(ids("4445")).toEqual(["03334445556"]); // middle digits
  });
  it("a partly typed +92 / 0092 / 92 number, and Urdu digits, still match", () => {
    for (const q of ["+92 300", "+92 300 12", "+92 300 1234", "0092 300 12", "923001234", "+92 0300 12"]) {
      expect(ids(q)[0], q).toBe("03001234567");
    }
    expect(ids("۰۳۰۰۱۲")[0]).toBe("03001234567");
    expect(ids("092 300 1234567")[0]).toBe("03001234567");
    expect(ids("٠٣٣٣")).toEqual(["03334445556"]);
  });
  it("finds by name: word start before anywhere; other names too; case-insensitive", () => {
    expect(ids("ali")).toContain("03001234567");
    expect(ids("ali")).toContain("03211234567");
    expect(ids("KHAN")).toEqual(["03001234567"]);
    expect(ids("bhai")).toEqual(["03334445556"]);
    expect(ids("ina")).toEqual(["03211234567"]); // anywhere in a word
    expect(ids("ali khan")).toEqual(["03001234567"]);
  });
  it("a partly typed foreign number with 00 matches its key", () => {
    const foreign = [C("971501234567", "Ahmed")];
    for (const q of ["00971 50", "0097150123", "+971 50", "971 50"]) {
      expect(searchCustomers(foreign, q).map((c) => c.id), q).toEqual(["971501234567"]);
    }
  });
  it("empty / no match", () => {
    expect(ids("")).toEqual([]);
    expect(ids("zzz")).toEqual([]);
  });
});

describe("applyVisit", () => {
  const key = "03001234567";
  it("creates, then counts, keeps the newest name and addresses first", () => {
    let c = applyVisit(null, { key, name: "Ali", address: "House 1", total: 500, at: "2026-11-21T10:00:00Z" });
    expect(c).toMatchObject({ id: key, name: "Ali", orderCount: 1, totalSpent: 500, addresses: ["House 1"], otherNames: [] });
    c = applyVisit(c, { key, name: "Ali Khan", address: "House 2", total: 300.5, at: "2026-11-22T10:00:00Z" });
    expect(c).toMatchObject({ name: "Ali Khan", otherNames: ["Ali"], addresses: ["House 2", "House 1"], orderCount: 2, totalSpent: 800.5 });
    expect(c.firstOrderAt).toBe("2026-11-21T10:00:00Z");
    expect(c.lastOrderAt).toBe("2026-11-22T10:00:00Z");
    // Same address again (other case/spaces): moves to the front, no repeat.
    c = applyVisit(c, { key, name: "ali khan", address: " house  1 ", total: 0, at: "2026-11-23T10:00:00Z" });
    expect(c.addresses).toEqual(["house 1", "House 2"]);
    expect(c.name).toBe("Ali Khan");
  });
  it("an older order synced late doesn't take over the name / first address", () => {
    let c = applyVisit(null, { key, name: "Ali Khan", address: "New St", total: 100, at: "2026-11-25T10:00:00Z" });
    c = applyVisit(c, { key, name: "Ali", address: "Old St", total: 100, at: "2026-11-20T10:00:00Z" });
    expect(c).toMatchObject({ name: "Ali Khan", otherNames: ["Ali"], addresses: ["New St", "Old St"], firstOrderAt: "2026-11-20T10:00:00Z", lastOrderAt: "2026-11-25T10:00:00Z" });
  });
  it("a customer with only a note gets their first order date from the first visit", () => {
    const noteOnly = C(key, "", { orderCount: 0, firstOrderAt: "", lastOrderAt: "", note: "gate 2" });
    const c = applyVisit(noteOnly, { key, name: "Ali", total: 200, at: "2026-11-25T10:00:00Z" });
    expect(c).toMatchObject({ name: "Ali", orderCount: 1, firstOrderAt: "2026-11-25T10:00:00Z", lastOrderAt: "2026-11-25T10:00:00Z", note: "gate 2" });
  });
  it("pushRecent caps the list", () => {
    expect(pushRecent(["a", "b", "c"], "B", 2)).toEqual(["B", "a"]);
  });
});

describe("statsFromOrders", () => {
  const o = (id: string, at: string, extra: Record<string, unknown> = {}) => ({ id, createdAt: at, total: 100, status: "completed", ...extra });
  it("counts completed orders, takes refunds off, newest name/address first", () => {
    const s = statsFromOrders([
      o("a", "2026-11-21T10:00:00Z", { customerName: "Ali", deliveryAddress: "House 1", total: 500, branchId: "main" }),
      o("b", "2026-11-23T10:00:00Z", { customerName: "Ali Khan", deliveryAddress: "House 2", total: 300, refundAmount: 100, branchId: "b2" }),
      o("c", "2026-11-22T10:00:00Z", { customerName: "ali", deliveryAddress: "house 1", status: "cancelled", total: 999 }),
      o("d", "2026-11-22T12:00:00Z", { customerName: " ali ", deliveryAddress: "" }),
    ]);
    expect(s).toEqual({
      name: "Ali Khan",
      otherNames: ["ali"],
      addresses: ["House 2", "House 1"],
      orderCount: 3,
      totalSpent: 800,
      firstOrderAt: "2026-11-21T10:00:00Z",
      lastOrderAt: "2026-11-23T10:00:00Z",
      lastOrderId: "b",
      lastBranchId: "b2",
    });
  });
  it("nothing counted → null", () => {
    expect(statsFromOrders([o("x", "2026-11-21T10:00:00Z", { status: "cancelled" })])).toBeNull();
    expect(statsFromOrders([])).toBeNull();
  });
});

describe("customerKpis", () => {
  it("total, repeat %, new since", () => {
    const k = customerKpis(
      [
        C("1", "a", { orderCount: 3, firstOrderAt: "2026-10-01T00:00:00Z" }),
        C("2", "b", { orderCount: 1, firstOrderAt: "2026-11-10T00:00:00Z" }),
        C("3", "c", { orderCount: 2, firstOrderAt: "2026-11-12T00:00:00Z" }),
        C("4", "d", { orderCount: 0 }), // note only, no orders yet
      ],
      "2026-11-01T00:00:00Z",
    );
    expect(k).toEqual({ total: 3, repeat: 2, repeatPct: 67, newSince: 2 });
  });
});

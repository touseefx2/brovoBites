/**
 * Receipt payment lines — paper (escpos.ts) and preview (print-receipt.ts)
 * must say the same thing. Run: (cd apps/web && npx tsx --test src/lib/print-receipt.test.ts)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOrderDateTime } from "@bravobites/domain";
import { buildReceiptEscPos } from "./escpos";
import {
  buildReceiptHtml,
  receiptPayment,
  type PrintReceiptLabels,
  type ReceiptCopy,
  type ReceiptOrder,
} from "./print-receipt";

const LABEL_KEYS: (keyof PrintReceiptLabels)[] = [
  "order", "total", "thankYou", "reviewUs", "reprint", "subtotal", "tax", "deliveryCharges",
  "dineIn", "takeaway", "delivery", "paymentMethod", "branchCopy", "customerCopy",
  "kitchenCopy", "customerName", "customerPhone", "deliveryAddress", "tableNumber", "cashier",
  "discount", "note", "qty", "item", "amount",
];
const EN: PrintReceiptLabels = {
  ...(Object.fromEntries(LABEL_KEYS.map((k) => [k, k])) as PrintReceiptLabels),
  paymentMethod: "Payment",
  cash: "Cash",
  card: "Card",
  digital: "Online",
};
/** Urdu UI: the status words must still be ASCII English. */
const UR: PrintReceiptLabels = { ...EN, paymentMethod: "ادائیگی", cash: "نقد", card: "کارڈ", digital: "آن لائن" };

const BASE: ReceiptOrder = {
  orderNumber: 42,
  orderType: "takeaway",
  items: [
    { productId: "p1", productName: "Zinger Burger", qty: 2, unitPrice: 500, lineTotal: 1000 },
  ] as ReceiptOrder["items"],
  subtotal: 1000,
  total: 1000,
  paymentMethod: "cash",
  customerName: "Ali",
  customerPhone: "03001234567",
  createdByName: "Cashier A",
  createdAt: "2026-11-20T10:15:00.000Z",
};

function html(order: ReceiptOrder, copies?: ReceiptCopy[], labels = EN, show = true) {
  return buildReceiptHtml({ order, shopName: "Brovo Bites", labels, copies, reviewUrl: "", showPaymentStatus: show });
}
/** ESC/POS bytes as one latin1 string (text is ASCII; commands stay searchable). */
function paper(order: ReceiptOrder, copies?: ReceiptCopy[], labels = EN, show = true) {
  const bytes = buildReceiptEscPos({ order, shopName: "Brovo Bites", labels, copies, showPaymentStatus: show });
  return Buffer.from(bytes).toString("latin1");
}
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("receiptPayment", () => {
  it("setting off (default): the method only, whatever the status", () => {
    assert.deepEqual(receiptPayment(BASE, EN), { value: "Cash", paidOn: null });
    assert.deepEqual(receiptPayment({ ...BASE, paymentStatus: "pending" }, EN), { value: "Cash", paidOn: null });
    assert.deepEqual(receiptPayment({ ...BASE, paidAt: "2026-11-22T09:00:00.000Z" }, EN), { value: "Cash", paidOn: null });
  });
  it("on, paid (also every order from before payment status): method - PAID", () => {
    assert.deepEqual(receiptPayment(BASE, EN, true), { value: "Cash - PAID", paidOn: null });
    assert.equal(receiptPayment({ ...BASE, paymentMethod: "card", status: "completed" }, EN, true).value, "Card - PAID");
  });
  it("on, pending: PENDING, never the expected method", () => {
    assert.deepEqual(receiptPayment({ ...BASE, paymentStatus: "pending" }, EN, true), { value: "PENDING", paidOn: null });
  });
  it("on, pending ignores a leftover paidAt", () => {
    const p = receiptPayment({ ...BASE, paymentStatus: "pending", paidAt: "2026-11-22T09:00:00.000Z" }, EN, true);
    assert.equal(p.paidOn, null);
  });
  it("on, paid later: Paid on <date>", () => {
    const p = receiptPayment({ ...BASE, paidAt: "2026-11-22T09:00:00.000Z" }, EN, true);
    assert.equal(p.value, "Cash - PAID");
    assert.equal(p.paidOn, formatOrderDateTime("2026-11-22T09:00:00.000Z"));
  });
  it("on, cancelled: the method only, as before", () => {
    assert.deepEqual(receiptPayment({ ...BASE, status: "cancelled", paymentStatus: "pending" }, EN, true), {
      value: "Cash",
      paidOn: null,
    });
  });
});

describe("receipt builders", () => {
  it("setting off: exactly the old payment line, no status anywhere", () => {
    for (const order of [BASE, { ...BASE, paymentStatus: "pending" as const }, { ...BASE, paidAt: "2026-11-22T09:00:00.000Z" }]) {
      const h = html(order, undefined, EN, false);
      const p = paper(order, undefined, EN, false);
      assert.ok(p.includes(`Payment${" ".repeat(48 - 7 - 4)}Cash\n`));
      for (const s of [h, p]) {
        assert.ok(!s.includes("PENDING") && !s.includes("PAID") && !s.includes("Paid on"));
      }
    }
  });

  it("on, paid order: Cash - PAID on customer + branch, nothing else new", () => {
    const h = html(BASE);
    const p = paper(BASE);
    assert.equal(count(h, "Cash - PAID"), 2);
    assert.equal(count(p, "Cash - PAID"), 2);
    for (const s of [h, p]) {
      assert.ok(!s.includes("PENDING"));
      assert.ok(!s.includes("Paid on"));
    }
    // ESC/POS line unchanged in shape: label left, value right, 48 columns.
    assert.ok(p.includes(`Payment${" ".repeat(48 - 7 - 11)}Cash - PAID\n`));
  });

  it("on, pending order: one small PENDING line on both builders (no banner), never on the kitchen copy", () => {
    const order = { ...BASE, paymentStatus: "pending" as const };
    const h = html(order);
    const p = paper(order);
    assert.ok(p.includes(`Payment${" ".repeat(48 - 7 - 7)}PENDING\n`));
    assert.equal(count(p, "PENDING"), 2);
    assert.equal(count(h, "PENDING"), 2);
    assert.ok(!h.includes("PAYMENT PENDING") && !p.includes("PAYMENT PENDING"));
    // No double-size / bold banner commands near it.
    assert.ok(!p.includes("\x1d!\x11PENDING"));
    assert.ok(!h.includes("Cash - PAID") && !p.includes("Cash - PAID"));
    assert.ok(!html(order, ["kitchen"]).includes("PENDING") && !paper(order, ["kitchen"]).includes("PENDING"));
  });

  it("on, paid later: Paid on <date> on both builders", () => {
    const order = { ...BASE, paymentMethod: "card" as const, paidAt: "2026-11-22T09:00:00.000Z" };
    const date = formatOrderDateTime(order.paidAt);
    const h = html(order, ["customer"]);
    const p = paper(order, ["customer"]);
    assert.ok(h.includes("Card - PAID") && p.includes("Card - PAID"));
    assert.ok(h.includes(date));
    // Paper: the same date through toPrinterAscii ("·" → "-", like the header date).
    assert.ok(p.includes(`Paid on`) && p.includes(date.normalize("NFKD").replace("·", "-")));
    assert.equal(count(h, "Paid on"), 1);
    assert.equal(count(p, "Paid on"), 1);
  });

  it("Urdu UI: the status words stay ASCII on paper", () => {
    const p = paper({ ...BASE, paymentStatus: "pending" }, ["customer"], UR);
    assert.ok(p.includes("PENDING\n"));
    const paid = paper(BASE, ["customer"], UR);
    assert.ok(paid.includes(" - PAID\n"));
  });

  it("cancelled order: same payment line as before the feature", () => {
    const order = { ...BASE, status: "cancelled" as const, paymentStatus: "pending" as const };
    const p = paper(order);
    assert.ok(p.includes(`Payment${" ".repeat(48 - 7 - 4)}Cash\n`));
    assert.ok(!p.includes("PENDING") && !p.includes("PAID"));
    assert.ok(html(order).includes("<span>Payment</span><span>Cash</span></p>\n"));
  });
});

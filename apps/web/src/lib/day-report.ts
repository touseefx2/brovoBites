import type { DayReport, ItemMadeRow, MenuItemLike, Order } from "@bravobites/domain";
import { computeItemsMade, money, ordersInRange } from "@bravobites/domain";

/**
 * Day-end math shared by admin Day report, Item sales and the POS report
 * popup — one formula everywhere, so offline POS numbers match the cloud ones.
 * computeDayReport lives in @bravobites/domain (unit tested there: payment
 * buckets, "Payment pending", old bills collected); re-exported here.
 */
export {
  collectedBills,
  computeDayReport,
  ordersInRange,
  paymentBucket,
  type CollectedBills,
  type DayReport,
  type DayReportStaffRow,
} from "@bravobites/domain";

export interface ItemStat {
  key: string;
  productId: string;
  productName: string;
  variationLabel?: string;
  qty: number;
  revenue: number;
}

/** Qty + line revenue per item (variation-aware) over non-cancelled orders. Sorted by qty. */
export function computeItemSales(
  orders: Order[],
  from: Date | null,
  to: Date | null,
): ItemStat[] {
  const active = ordersInRange(orders, from, to).filter(
    (o) => o.status !== "cancelled",
  );
  const map = new Map<string, ItemStat>();
  for (const order of active) {
    for (const item of order.items) {
      const key = item.variationId
        ? `${item.productId}__${item.variationId}`
        : item.productId;
      const existing = map.get(key);
      if (existing) {
        existing.qty += item.qty;
        existing.revenue += item.lineTotal;
      } else {
        map.set(key, {
          key,
          productId: item.productId,
          productName: item.productName,
          variationLabel: item.variationLabel,
          qty: item.qty,
          revenue: item.lineTotal,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
}

/** What the kitchen made in the window — items alone + inside deals (see computeItemsMade). */
export function computeItemsMadeInRange(
  orders: Order[],
  from: Date | null,
  to: Date | null,
  products?: MenuItemLike[],
): ItemMadeRow[] {
  return computeItemsMade(ordersInRange(orders, from, to), products);
}

export type SalesBridgeKey =
  | "items"
  | "discount"
  | "tax"
  | "delivery"
  | "other"
  | "gross"
  | "refunds"
  | "net";

export type SalesBridgeRow = {
  key: SalesBridgeKey;
  value: number;
  sign?: "+" | "−";
  /** Subtotal row (gross / net). */
  total?: boolean;
};

/**
 * Why item sales ≠ total sale: items total − discount + tax + delivery =
 * gross sale; − refunds = net sale. Cancelled orders are in neither. Any
 * leftover (rounding, legacy data) gets its own "other" row so the steps
 * always add up exactly.
 */
export function computeSalesBridge(report: DayReport, itemRevenue: number): SalesBridgeRow[] {
  const rows: SalesBridgeRow[] = [{ key: "items", value: itemRevenue }];
  if (report.totalDiscounts > 0) rows.push({ key: "discount", value: report.totalDiscounts, sign: "−" });
  if (report.totalTax > 0) rows.push({ key: "tax", value: report.totalTax, sign: "+" });
  if (report.totalDelivery > 0) rows.push({ key: "delivery", value: report.totalDelivery, sign: "+" });
  const expected =
    itemRevenue - report.totalDiscounts + report.totalTax + report.totalDelivery;
  const residual = money(report.totalSales - expected);
  if (Math.abs(residual) >= 1) {
    rows.push({ key: "other", value: Math.abs(residual), sign: residual > 0 ? "+" : "−" });
  }
  rows.push({ key: "gross", value: report.totalSales, total: true });
  if (report.totalRefunds > 0) rows.push({ key: "refunds", value: report.totalRefunds, sign: "−" });
  rows.push({ key: "net", value: report.totalSales - report.totalRefunds, total: true });
  return rows;
}

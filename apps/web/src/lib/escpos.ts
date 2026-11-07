/**
 * ESC/POS binary receipt builder for 80mm thermal printers (48 chars/line,
 * Font A 12×24). Generates a Uint8Array that is sent to the printer as raw
 * bytes via `lp -o raw`.
 */

import type { ReceiptOrder, ReceiptCopy, ReceiptOptions, PrintReceiptLabels } from "./print-receipt";
import { formatOrderDateTime, formatOrderNumber, formatPkr } from "@bravobites/domain";

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

const COLS = 48;

const CMD = {
  init:           [ESC, 0x40],
  centerAlign:    [ESC, 0x61, 0x01],
  leftAlign:      [ESC, 0x61, 0x00],
  rightAlign:     [ESC, 0x61, 0x02],
  boldOn:         [ESC, 0x45, 0x01],
  boldOff:        [ESC, 0x45, 0x00],
  doubleSize:     [GS,  0x21, 0x11],
  doubleWidth:    [GS,  0x21, 0x10],
  normalSize:     [GS,  0x21, 0x00],
  partialCut:     [GS,  0x56, 0x42, 0x03],
} as const;

class EscPosBuffer {
  private parts: (Uint8Array | number[])[] = [];

  raw(bytes: readonly number[]): this {
    this.parts.push(new Uint8Array(bytes));
    return this;
  }

  text(s: string): this {
    this.parts.push(new TextEncoder().encode(s));
    return this;
  }

  lf(n = 1): this {
    for (let i = 0; i < n; i++) this.parts.push(new Uint8Array([LF]));
    return this;
  }

  line(s: string): this { return this.text(s).lf(); }

  init(): this { return this.raw(CMD.init); }
  center(): this { return this.raw(CMD.centerAlign); }
  left(): this { return this.raw(CMD.leftAlign); }
  boldOn(): this { return this.raw(CMD.boldOn); }
  boldOff(): this { return this.raw(CMD.boldOff); }
  doubleSize(): this { return this.raw(CMD.doubleSize); }
  doubleWidth(): this { return this.raw(CMD.doubleWidth); }
  normalSize(): this { return this.raw(CMD.normalSize); }

  cut(): this { return this.lf(4).raw(CMD.partialCut); }

  separator(ch = "-"): this {
    return this.line(ch.repeat(COLS));
  }

  /** Left-right justified on one line: "Label          Value" */
  lr(l: string, r: string): this {
    const pad = COLS - l.length - r.length;
    if (pad > 0) return this.line(l + " ".repeat(pad) + r);
    return this.line(l + " " + r);
  }

  /** Three-column row: qty(4) + name(fill) + amount(right) */
  itemRow(qty: string, name: string, amt: string): this {
    const qCol = 4;
    const aCol = Math.max(amt.length, 10);
    const nCol = COLS - qCol - aCol;
    const q = qty.padStart(qCol - 1) + " ";
    const a = amt.padStart(aCol);
    let n = name;
    if (n.length > nCol) n = n.slice(0, nCol - 1) + "…";
    else n = n.padEnd(nCol);
    return this.line(q + n + a);
  }

  /** Kitchen row: qty + name only (no amount) */
  kitchenRow(qty: string, name: string): this {
    const qCol = 4;
    const q = qty.padStart(qCol - 1) + " ";
    return this.line(q + name);
  }

  /** QR code using GS ( k commands — most ESC/POS printers ≥2012 support this. */
  qrCode(data: string): this {
    const bytes = new TextEncoder().encode(data);
    const len = bytes.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;
    return this
      .raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]) // model 2
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06])       // module size 6
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31])       // error correction M
      .raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30])           // store data
      .raw([...bytes])
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);      // print QR
  }

  toBytes(): Uint8Array {
    let total = 0;
    for (const p of this.parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of this.parts) {
      if (p instanceof Uint8Array) out.set(p, off);
      else out.set(new Uint8Array(p), off);
      off += p.length;
    }
    return out;
  }
}

function orderTypeLabel(labels: PrintReceiptLabels, type?: string): string {
  if (type === "takeaway") return labels.takeaway;
  if (type === "delivery") return labels.delivery;
  return labels.dineIn;
}

function paymentLabel(labels: PrintReceiptLabels, method: string): string {
  if (method === "card") return labels.card;
  if (method === "digital") return labels.digital;
  return labels.cash;
}

function buildCopyEscPos(
  buf: EscPosBuffer,
  opts: {
    order: ReceiptOrder;
    shopName: string;
    branchName?: string;
    labels: PrintReceiptLabels;
    showReprint?: boolean;
    copyLabel: string;
    kitchen?: boolean;
    reviewUrl?: string;
    softwareCompanyName?: string;
    softwareCompanyPhone?: string;
  },
): void {
  const { order, shopName, branchName, labels, showReprint, copyLabel, kitchen, reviewUrl } = opts;

  const orderNumber = order.orderNumber != null
    ? `#${formatOrderNumber(order.orderNumber)}`
    : "#…";
  const dateTime = order.createdAt ? formatOrderDateTime(order.createdAt) : "";
  const cashierName = order.createdByName || order.createdByEmail || "";
  const customerName = (order.customerName || "").trim();
  const customerPhone = (order.customerPhone || "").trim();
  const deliveryAddress = (order.deliveryAddress || "").trim();
  const tableNumber = (order.tableNumber || "").trim();

  // Header
  buf.center();
  buf.line(copyLabel);
  buf.boldOn().doubleSize();
  buf.line(shopName);
  buf.normalSize().boldOff();
  if (branchName) buf.line(branchName);
  buf.lf();

  // Order meta
  buf.left();
  const typeStr = orderTypeLabel(labels, order.orderType);
  buf.lr(
    `${labels.order} ${orderNumber}${showReprint ? ` · ${labels.reprint}` : ""}`,
    typeStr,
  );
  if (dateTime) buf.line(dateTime);
  if (tableNumber) buf.line(`${labels.tableNumber}: ${tableNumber}`);
  if (customerName) buf.line(`${labels.customerName}: ${customerName}`);
  if (customerPhone) buf.line(`${labels.customerPhone}: ${customerPhone}`);
  if (deliveryAddress) buf.line(`${labels.deliveryAddress}: ${deliveryAddress}`);
  if (cashierName) buf.line(`${labels.cashier}: ${cashierName}`);

  // Items header
  buf.separator();
  if (kitchen) {
    buf.lr(labels.qty + " " + labels.item, "");
  } else {
    const hdr = (labels.qty + " " + labels.item);
    buf.lr(hdr, labels.amount);
  }
  buf.separator();

  // Items
  for (const item of order.items) {
    const name = item.variationLabel
      ? `${item.productName} (${item.variationLabel})`
      : item.productName;
    if (kitchen) {
      buf.kitchenRow(String(item.qty), name);
    } else {
      buf.itemRow(String(item.qty), name, formatPkr(item.lineTotal));
    }
    if (item.note) {
      buf.line(`     » ${item.note}`);
    }
  }

  if (kitchen) return;

  // Charges (tax, delivery)
  const hasTaxOrDlv = (order.taxAmount ?? 0) > 0 || (order.deliveryCharges ?? 0) > 0;
  if (hasTaxOrDlv) {
    buf.separator();
    buf.lr(labels.subtotal, formatPkr(order.subtotal));
    if ((order.taxAmount ?? 0) > 0) {
      const taxLabel = (order.taxPercent ?? 0) > 0
        ? `${labels.tax} (${order.taxPercent}%)`
        : labels.tax;
      buf.lr(taxLabel, formatPkr(order.taxAmount!));
    }
    if ((order.deliveryCharges ?? 0) > 0) {
      buf.lr(labels.deliveryCharges, formatPkr(order.deliveryCharges!));
    }
  }

  // Discount
  if ((order.discountAmount ?? 0) > 0) {
    buf.separator();
    const dlabel = order.discountType === "percent"
      ? `${labels.discount} (${order.discountValue}%)`
      : labels.discount;
    buf.lr(dlabel, `−${formatPkr(order.discountAmount!)}`);
  }

  // Total
  buf.separator("=");
  buf.boldOn();
  buf.lr(labels.total, formatPkr(order.total));
  buf.boldOff();
  buf.lr(labels.paymentMethod, paymentLabel(labels, order.paymentMethod));
  buf.lf();

  // Thank you + QR
  buf.center();
  buf.line(labels.thankYou);
  buf.lf();

  if (reviewUrl) {
    buf.qrCode(reviewUrl);
    buf.lf();
    buf.line(labels.reviewUs);
    buf.lf();
  }

  const vendorName = (opts.softwareCompanyName || "").trim();
  const vendorPhone = (opts.softwareCompanyPhone || "").trim();
  if (vendorName || vendorPhone) {
    const vendorLine = [vendorName ? `Software by ${vendorName}` : "", vendorPhone]
      .filter(Boolean).join(" ");
    buf.line(vendorLine);
  }
}

/**
 * Builds a complete ESC/POS byte buffer for the receipt — the same copies
 * (customer, branch, kitchen) that the HTML builder produces, each followed
 * by a partial-cut command so the thermal cutter separates them.
 */
export function buildReceiptEscPos(opts: ReceiptOptions): Uint8Array {
  const {
    order, shopName, branchName, labels, showReprint,
    softwareCompanyName, softwareCompanyPhone,
    copies = ["customer", "branch", "kitchen"],
    reviewUrl,
  } = opts;

  const copyLabels: Record<ReceiptCopy, string> = {
    customer: labels.customerCopy,
    branch: labels.branchCopy,
    kitchen: labels.kitchenCopy,
  };

  const buf = new EscPosBuffer();
  buf.init();

  for (const copy of copies) {
    buildCopyEscPos(buf, {
      order, shopName, branchName, labels, showReprint,
      copyLabel: copyLabels[copy],
      kitchen: copy === "kitchen",
      reviewUrl: copy === "customer" ? reviewUrl : undefined,
      softwareCompanyName, softwareCompanyPhone,
    });
    buf.cut();
  }

  return buf.toBytes();
}

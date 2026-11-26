/**
 * ESC/POS binary receipt builder for 80mm thermal printers (48 chars/line,
 * Font A 12×24). Generates a Uint8Array that is sent to the printer as raw
 * bytes via `lp -o raw`.
 */

import type { ReceiptOrder, ReceiptCopy, ReceiptOptions, PrintReceiptLabels } from "./print-receipt";
import { CUSTOM_DEAL_ID, formatOrderDateTime, formatOrderNumber, formatPkr, partText } from "@bravobites/domain";
import { RECEIPT_PAID_ON, RECEIPT_SITE, receiptPayment } from "./print-receipt";
import { RECEIPT_LOGO } from "./receipt-logo";

/** Most rows per GS v 0 command — keeps the height in one byte (see image()). */
const MAX_IMAGE_ROWS = 255;
/** Blank primer band before the logo (≈3 mm if printed; not a multiple of 48 — an Xprinter firmware bug). */
const PRIMER_ROWS = 24;

let logoBitsCache: Uint8Array | null = null;
function logoBits(): Uint8Array {
  if (!logoBitsCache) {
    const bin = atob(RECEIPT_LOGO.bitsBase64);
    logoBitsCache = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return logoBitsCache;
}

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

const COLS = 48;
/** Columns in font B (9-dot cells) on the same 576-dot line — the smaller payment lines. */
const COLS_SMALL = 64;

const CMD = {
  // ESC @ reset, FS . leave Chinese (Kanji) mode, ESC t 0 code page PC437.
  init:           [ESC, 0x40, 0x1c, 0x2e, ESC, 0x74, 0x00],
  centerAlign:    [ESC, 0x61, 0x01],
  leftAlign:      [ESC, 0x61, 0x00],
  rightAlign:     [ESC, 0x61, 0x02],
  boldOn:         [ESC, 0x45, 0x01],
  boldOff:        [ESC, 0x45, 0x00],
  doubleSize:     [GS,  0x21, 0x11],
  doubleWidth:    [GS,  0x21, 0x10],
  normalSize:     [GS,  0x21, 0x00],
  // ESC M n: font A (12x24, normal) / font B (9x17, smaller) — footer line only.
  fontSmall:      [ESC, 0x4d, 0x01],
  fontNormal:     [ESC, 0x4d, 0x00],
  partialCut:     [GS,  0x56, 0x42, 0x03],
} as const;

/*
 * The counter printer (POS80 / Xprinter family) starts in Chinese double-byte
 * mode: any byte ≥ 0x80 pairs with the next one into a Chinese glyph — the
 * UTF-8 of "—" or "·" printed as strange characters and swallowed the space
 * after it. Receipt text is sent as plain ASCII.
 */
const ASCII_SUBSTITUTES: Record<string, string> = {
  "—": "-", "–": "-", "−": "-", "‐": "-", "·": "-", "•": "*",
  "…": "...", "»": ">>", "«": "<<",
  "‘": "'", "’": "'", "“": '"', "”": '"', " ": " ",
};

function toPrinterAscii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .replace(/[^\x20-\x7e\n]/g, (ch) => ASCII_SUBSTITUTES[ch] ?? "?");
}

class EscPosBuffer {
  private parts: (Uint8Array | number[])[] = [];

  raw(bytes: readonly number[]): this {
    this.parts.push(new Uint8Array(bytes));
    return this;
  }

  text(s: string): this {
    this.parts.push(new TextEncoder().encode(toPrinterAscii(s)));
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
  fontSmall(): this { return this.raw(CMD.fontSmall); }
  fontNormal(): this { return this.raw(CMD.fontNormal); }

  /**
   * Partial cut (GS V 66 n). The POS80 / Xprinter family has no full cut —
   * GS V 65 is out of range on it — so every copy ends with this.
   */
  cut(): this { return this.lf(4).raw(CMD.partialCut); }

  /** All-white GS v 0 (the primer before the logo — see the customer header). */
  blankRaster(rowBytes: number, rows: number): this {
    this.raw([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows, 0]);
    this.parts.push(new Uint8Array(rowBytes * rows));
    return this;
  }

  /**
   * 1-bit bitmap (GS v 0), no padding: call it at the start of a line under
   * ESC a 1 and the POS80 centres it itself.
   *
   * POS80 quirk (paper tests, Nov 2026): a GS v 0 whose data STARTS with blank
   * rows is not taken as an image — its data prints as lines of garbage text.
   * Every command whose first row had ink printed perfectly. So blank rows are
   * never sent at the start of a command: top/bottom blank rows are dropped,
   * and a command never begins on a blank row (blank rows are fed with ESC J).
   * At most MAX_IMAGE_ROWS rows per command, so the height fits one byte.
   */
  image(bits: Uint8Array, widthDots: number, height: number): this {
    const rowBytes = widthDots / 8;
    const inked = (y: number) => bits.subarray(y * rowBytes, (y + 1) * rowBytes).some((b) => b !== 0);
    let y = 0;
    while (y < height && !inked(y)) y++;
    let end = height;
    while (end > y && !inked(end - 1)) end--;
    while (y < end) {
      if (!inked(y)) {
        let gap = 0;
        while (y < end && !inked(y) && gap < 255) { y++; gap++; }
        this.raw([ESC, 0x4a, gap]); // ESC J n: feed n dots
        continue;
      }
      const rows = Math.min(MAX_IMAGE_ROWS, end - y);
      this.raw([GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows, 0]);
      this.parts.push(bits.slice(y * rowBytes, (y + rows) * rowBytes));
      y += rows;
    }
    return this;
  }

  separator(ch = "-"): this {
    return this.line(ch.repeat(COLS));
  }

  /** Left-right justified on one line: "Label          Value" */
  lr(l: string, r: string): this {
    const pad = COLS - l.length - r.length;
    if (pad > 0) return this.line(l + " ".repeat(pad) + r);
    return this.line(l + " " + r);
  }

  /** lr() in the smaller font B (64 columns), then back to font A. */
  lrSmall(l: string, r: string): this {
    const pad = COLS_SMALL - l.length - r.length;
    this.fontSmall();
    if (pad > 0) this.line(l + " ".repeat(pad) + r);
    else this.line(l + " " + r);
    return this.fontNormal();
  }

  /** Three-column row: qty(4) + name(fill) + amount(right) */
  itemRow(qty: string, name: string, amt: string): this {
    const qCol = 4;
    const aCol = Math.max(amt.length, 10);
    const nCol = COLS - qCol - aCol;
    const q = qty.padStart(qCol - 1) + " ";
    const a = amt.padStart(aCol);
    let n = name;
    if (n.length > nCol) n = n.slice(0, nCol - 3) + "...";
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
    /** Customer copy: the logo in place of the shop name, website under the branch. */
    logo?: boolean;
    /** "Paid" / "Pending" on the payment line (owner setting). */
    showPaymentStatus?: boolean;
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
  if (opts.logo) {
    // Blank primer raster in place of a line feed: if the POS80 skips the first
    // image of a job, it skips this one — its zero bytes then print nothing —
    // and the logo, which starts on an inked row, prints from a clean state.
    buf.blankRaster(RECEIPT_LOGO.width / 8, PRIMER_ROWS);
    buf.image(logoBits(), RECEIPT_LOGO.width, RECEIPT_LOGO.height); // centred by ESC a 1 above
    buf.lf();
    if (branchName) buf.line(branchName);
    buf.line(RECEIPT_SITE);
  } else {
    buf.boldOn().doubleSize();
    buf.line(shopName);
    buf.normalSize().boldOff();
    if (branchName) buf.line(branchName);
  }
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
    const sized = item.variationLabel
      ? `${item.productName} (${item.variationLabel})`
      : item.productName;
    // Same mark as print-receipt.ts: the cook must not make it from habit.
    const name = kitchen && item.changed && item.productId !== CUSTOM_DEAL_ID ? `${sized} (CHANGED)` : sized;
    if (kitchen) {
      buf.kitchenRow(String(item.qty), name);
    } else {
      buf.itemRow(String(item.qty), name, formatPkr(item.lineTotal));
    }
    // Deal: what is inside, as sold (same lines as print-receipt.ts).
    for (const part of item.parts ?? []) {
      buf.line(`     - ${partText(part)}`);
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
  // Same lines as print-receipt.ts (receiptPayment): plain text, fixed ASCII status words.
  const payment = receiptPayment(order, labels, opts.showPaymentStatus);
  // A size smaller than the rest (font B, 64 columns), like the preview.
  buf.lrSmall(labels.paymentMethod, payment.value);
  if (payment.paidOn) buf.lrSmall(RECEIPT_PAID_ON, payment.paidOn);
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
    // Smaller font (B) for the software credit, then straight back to font A.
    buf.fontSmall().line(vendorLine).fontNormal();
  }
}

/**
 * Builds a complete ESC/POS byte buffer for the receipt — the same copies
 * (customer, branch, kitchen) that the HTML builder produces, each followed
 * by a cut: partial between copies, full after the last.
 */
const COPY_ORDER: ReceiptCopy[] = ["customer", "branch", "kitchen"];
function canonicalCopies(copies: ReceiptCopy[]): ReceiptCopy[] {
  return COPY_ORDER.filter((c) => copies.includes(c));
}

export function buildReceiptEscPos(opts: ReceiptOptions): Uint8Array {
  const {
    order, shopName, branchName, labels, showReprint,
    softwareCompanyName, softwareCompanyPhone,
    copies = ["customer", "branch", "kitchen"],
    reviewUrl,
    showPaymentStatus,
  } = opts;

  const copyLabels: Record<ReceiptCopy, string> = {
    customer: labels.customerCopy,
    branch: labels.branchCopy,
    kitchen: labels.kitchenCopy,
  };

  const sorted = canonicalCopies(copies);
  const buf = new EscPosBuffer();
  buf.init();

  // When the first copy is not the customer copy (which has its own blank-raster
  // primer), feed a few blank lines so the POS80 doesn't swallow the first text
  // line of the job (same firmware quirk that skips the first image).
  if (sorted.length > 0 && sorted[0] !== "customer") {
    buf.lf(3);
  }

  sorted.forEach((copy) => {
    buildCopyEscPos(buf, {
      order, shopName, branchName, labels, showReprint,
      copyLabel: copyLabels[copy],
      kitchen: copy === "kitchen",
      reviewUrl: copy === "customer" ? reviewUrl : undefined,
      softwareCompanyName, softwareCompanyPhone,
      logo: copy === "customer",
      showPaymentStatus,
    });
    buf.cut();
  });

  return buf.toBytes();
}

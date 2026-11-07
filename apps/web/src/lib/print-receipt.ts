import type { Order, ReceiptPaper } from "@bravobites/domain";
import { formatOrderDateTime, formatOrderNumber, formatPkr } from "@bravobites/domain";
import qrcode from "qrcode-generator";

// Links with Urdu text (e.g. a Maps place name) encode as UTF-8, not one byte per char.
if (qrcode.stringToBytesFuncs?.["UTF-8"]) qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
import type { MessageKey } from "@/i18n/dictionaries";
import { reviewUrlOf } from "@/lib/review-request";

export type PrintReceiptLabels = {
  order: string;
  total: string;
  thankYou: string;
  reviewUs: string;
  reprint: string;
  subtotal: string;
  tax: string;
  deliveryCharges: string;
  dineIn: string;
  takeaway: string;
  delivery: string;
  cash: string;
  card: string;
  digital: string;
  paymentMethod: string;
  branchCopy: string;
  customerCopy: string;
  kitchenCopy: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  tableNumber: string;
  cashier: string;
  discount: string;
  note: string;
  qty: string;
  item: string;
  amount: string;
};

/** One label set for checkout print, reprint and the on-screen preview. */
export function receiptLabels(t: (key: MessageKey) => string): PrintReceiptLabels {
  return {
    order: t("order"),
    total: t("total"),
    thankYou: t("thankYou"),
    reviewUs: t("receiptReviewUs"),
    reprint: t("reprint"),
    subtotal: t("subtotal"),
    tax: t("tax"),
    deliveryCharges: t("deliveryCharges"),
    dineIn: t("dineIn"),
    takeaway: t("takeaway"),
    delivery: t("delivery"),
    cash: t("cash"),
    card: t("card"),
    digital: t("digital"),
    paymentMethod: t("paymentMethod"),
    branchCopy: t("branchCopy"),
    customerCopy: t("customerCopy"),
    kitchenCopy: t("kitchenCopy"),
    customerName: t("customerName"),
    customerPhone: t("customerPhone"),
    deliveryAddress: t("deliveryAddress"),
    tableNumber: t("tableNumber"),
    cashier: t("cashier"),
    discount: t("discount"),
    note: t("note"),
    qty: t("qty"),
    item: t("receiptItem"),
    amount: t("receiptAmount"),
  };
}

/**
 * What a receipt prints. A saved Order fits as-is; the checkout preview passes
 * a draft whose number is still null (it is allocated at checkout).
 */
export type ReceiptOrder = Pick<
  Order,
  | "orderType"
  | "items"
  | "subtotal"
  | "taxAmount"
  | "taxPercent"
  | "deliveryCharges"
  | "discountType"
  | "discountValue"
  | "discountAmount"
  | "total"
  | "paymentMethod"
  | "customerName"
  | "customerPhone"
  | "deliveryAddress"
  | "tableNumber"
  | "createdByName"
  | "createdByEmail"
  | "createdAt"
> & { orderNumber: number | null };

export type ReceiptOptions = {
  order: ReceiptOrder;
  shopName: string;
  branchName?: string;
  labels: PrintReceiptLabels;
  showReprint?: boolean;
  softwareCompanyName?: string;
  softwareCompanyPhone?: string;
  /** App language direction — the preview and the paper use the same one. */
  dir?: "ltr" | "rtl";
  /** Roll in the counter printer (admin setting); 80mm when unset. */
  paper?: ReceiptPaper;
  /** Printable width for paper "custom". */
  paperWidthMm?: number;
  /** Slips to print, in this order — all three unless set (test print: customer only). */
  copies?: ReceiptCopy[];
  /** Customer-copy QR target — settings.googleReviewUrl via reviewUrlOf(). */
  reviewUrl?: string;
};

export type ReceiptCopy = "customer" | "branch" | "kitchen";

/** Screen-only gutter around the slips in the preview frame (see @media screen). */
export const PREVIEW_GUTTER_PX = 12;

/**
 * Printable width of the roll (203 dpi heads): 80mm → 72mm (576 dots, the
 * driver's "RECEIPT 72mm" paper), 58mm → 48mm (384 dots). The receipt must not
 * be wider than the driver's paper, or Chrome shrinks everything to fit
 * (80mm on 72mm paper → 90%) and the paper no longer matches the preview.
 */
export function receiptPrintWidthMm(paper?: ReceiptPaper, customWidthMm?: number): number {
  if (paper === "58mm") return 48;
  if (paper === "custom" && customWidthMm && customWidthMm > 0) {
    return Math.min(104, Math.max(40, customWidthMm));
  }
  return 72;
}

/** Physical paper-roll width for @page size (includes unprintable margins). */
export function receiptPaperMm(paper?: ReceiptPaper, customWidthMm?: number): number {
  if (paper === "58mm") return 58;
  if (paper === "custom" && customWidthMm && customWidthMm > 0) {
    return Math.min(112, Math.max(48, customWidthMm + 8));
  }
  return 80;
}

/** Below this print width the receipt switches to the narrow (58mm) sizes. */
const NARROW_BELOW_MM = 60;

/** Preview iframe width until it has measured the document: 80mm paper + gutter. */
export const RECEIPT_PREVIEW_WIDTH = `calc(72mm + ${PREVIEW_GUTTER_PX * 2}px)`;

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

function buildReceiptSection(opts: {
  order: ReceiptOrder;
  shopName: string;
  branchName?: string;
  labels: PrintReceiptLabels;
  showReprint?: boolean;
  copyLabel: string;
  /** Kitchen KOT: items + notes only — no money lines */
  kitchen?: boolean;
  /** Customer copy: Google review QR under the thanks line */
  reviewUrl?: string;
  softwareCompanyName?: string;
  softwareCompanyPhone?: string;
}): string {
  const {
    order,
    shopName,
    branchName,
    labels,
    showReprint,
    copyLabel,
    kitchen,
    reviewUrl,
    softwareCompanyName,
    softwareCompanyPhone,
  } = opts;

  const itemRows = order.items
    .map((item) => {
      // <bdi>: English menu names keep their own order (and brackets) inside an
      // Urdu slip, while still aligning to the slip's start next to the qty.
      const name = `${escapeHtml(item.productName)}${
        item.variationLabel ? ` (${escapeHtml(item.variationLabel)})` : ""
      }`;
      let html = `<span class="qty" dir="ltr">${escapeHtml(String(item.qty))}</span><span class="item-name"><bdi>${name}</bdi></span>${
        kitchen ? "" : `<span class="amt" dir="ltr">${escapeHtml(formatPkr(item.lineTotal))}</span>`
      }`;
      if (item.note) {
        html += `<span class="note">» <bdi>${escapeHtml(item.note)}</bdi></span>`;
      }
      return html;
    })
    .join("");

  const items = `
    <div class="items${kitchen ? " kitchen" : ""}">
      <span class="th qty">${escapeHtml(labels.qty)}</span>
      <span class="th">${escapeHtml(labels.item)}</span>
      ${kitchen ? "" : `<span class="th amt">${escapeHtml(labels.amount)}</span>`}
      <span class="th-rule"></span>
      ${itemRows}
    </div>`;

  const cashierName = order.createdByName || order.createdByEmail || "";
  const customerName = (order.customerName || "").trim();
  const customerPhone = (order.customerPhone || "").trim();
  const deliveryAddress = (order.deliveryAddress || "").trim();
  const tableNumber = (order.tableNumber || "").trim();
  const dateTime = order.createdAt ? formatOrderDateTime(order.createdAt) : "";
  // The preview runs before checkout allocates the number.
  const orderNumber =
    order.orderNumber != null ? `#${formatOrderNumber(order.orderNumber)}` : "#…";

  const header = `
    <div class="copy-label">${escapeHtml(copyLabel)}</div>
    <h1>${escapeHtml(shopName)}</h1>
    ${branchName ? `<p class="branch">${escapeHtml(branchName)}</p>` : ""}
    <div class="order-meta">
      <span>${escapeHtml(labels.order)} <span dir="ltr">${orderNumber}</span>${
    showReprint ? ` · ${escapeHtml(labels.reprint)}` : ""
  }</span>
      <span class="type">${escapeHtml(orderTypeLabel(labels, order.orderType))}</span>
    </div>
    ${dateTime ? `<p class="line"><span dir="ltr">${escapeHtml(dateTime)}</span></p>` : ""}
    ${tableNumber ? `<p class="line">${escapeHtml(labels.tableNumber)}: <span dir="ltr">${escapeHtml(tableNumber)}</span></p>` : ""}
    ${customerName ? `<p class="line">${escapeHtml(labels.customerName)}: <bdi>${escapeHtml(customerName)}</bdi></p>` : ""}
    ${customerPhone ? `<p class="line">${escapeHtml(labels.customerPhone)}: <span dir="ltr">${escapeHtml(customerPhone)}</span></p>` : ""}
    ${deliveryAddress ? `<p class="line">${escapeHtml(labels.deliveryAddress)}: <bdi>${escapeHtml(deliveryAddress)}</bdi></p>` : ""}
    ${cashierName ? `<p class="line">${escapeHtml(labels.cashier)}: <bdi>${escapeHtml(cashierName)}</bdi></p>` : ""}
    <hr />
    ${items}`;

  if (kitchen) {
    return `
  <section class="receipt">
    ${header}
  </section>`;
  }

  const hasTaxOrDlv = (order.taxAmount ?? 0) > 0 || (order.deliveryCharges ?? 0) > 0;

  let chargesHtml = "";
  if (hasTaxOrDlv) {
    chargesHtml += `<div class="row"><span>${escapeHtml(labels.subtotal)}</span><span dir="ltr">${escapeHtml(formatPkr(order.subtotal))}</span></div>`;
    if ((order.taxAmount ?? 0) > 0) {
      const taxLabel = (order.taxPercent ?? 0) > 0
        ? `${escapeHtml(labels.tax)} <span dir="ltr">(${order.taxPercent}%)</span>`
        : escapeHtml(labels.tax);
      chargesHtml += `<div class="row"><span>${taxLabel}</span><span dir="ltr">${escapeHtml(formatPkr(order.taxAmount!))}</span></div>`;
    }
    if ((order.deliveryCharges ?? 0) > 0) {
      chargesHtml += `<div class="row"><span>${escapeHtml(labels.deliveryCharges)}</span><span dir="ltr">${escapeHtml(formatPkr(order.deliveryCharges!))}</span></div>`;
    }
    chargesHtml += "<hr />";
  }

  let discountHtml = "";
  if ((order.discountAmount ?? 0) > 0) {
    const dlabel = order.discountType === "percent"
      ? `${escapeHtml(labels.discount)} <span dir="ltr">(${order.discountValue}%)</span>`
      : escapeHtml(labels.discount);
    discountHtml = `<div class="row"><span>${dlabel}</span><span dir="ltr">−${escapeHtml(formatPkr(order.discountAmount!))}</span></div><hr />`;
  }

  const reviewQr = reviewUrl ? qrSvg(reviewUrl) : "";
  const vendorName = (softwareCompanyName || "").trim();
  const vendorPhone = (softwareCompanyPhone || "").trim();
  const vendorHtml =
    vendorName || vendorPhone
      ? `<p class="vendor" dir="ltr">${
          vendorName ? `Software by ${escapeHtml(vendorName)}` : ""
        }${vendorName && vendorPhone ? " " : ""}${
          vendorPhone ? `<span class="nowrap">${escapeHtml(vendorPhone)}</span>` : ""
        }</p>`
      : "";

  return `
  <section class="receipt">
    ${header}
    <hr />
    ${chargesHtml}
    ${discountHtml}
    <p class="total"><span class="total-label">${escapeHtml(labels.total)}</span><span class="total-value" dir="ltr">${escapeHtml(formatPkr(order.total))}</span></p>
    <p class="row payment"><span>${escapeHtml(labels.paymentMethod)}</span><span>${escapeHtml(paymentLabel(labels, order.paymentMethod))}</span></p>
    <p class="thanks">${escapeHtml(labels.thankYou)}</p>
    ${
      reviewQr
        ? `<div class="review">${reviewQr}<p>${escapeHtml(labels.reviewUs)}</p></div>`
        : ""
    }
    ${vendorHtml}
  </section>`;
}

/**
 * QR as one black path — generated locally so it prints offline. Crisp edges
 * keep modules from blurring on the 203 dpi head; the quiet zone is the margin.
 * Never throws: whatever goes wrong, the receipt (and checkout preview) still
 * renders, just without the QR.
 */
function qrSvg(text: string): string {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    const size = n + 8;
    return `<svg class="qr" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#000"/></svg>`;
  } catch {
    return "";
  }
}

/*
 * Thermal-safe type, checked in a 203 dpi simulation with 1-dot heat bleed
 * (high density): Verdana's open digits keep the 9/6/8 counters and digit gaps
 * where Arial's merge ("09" → one blob). Regular weight everywhere; bold only
 * at 16px (shop name, total amount) — smaller bold fills in. Pure black, no
 * grey (it dithers away). Slight tracking keeps neighbouring digits apart.
 */
function receiptCss(widthMm: number, paperMm: number): string {
  return `
    @page {
      size: ${paperMm}mm auto;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
    }
    body {
      width: ${widthMm}mm;
      margin: 0 auto;
      font-family: Verdana, Tahoma, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 400;
      letter-spacing: 0.5px;
      /* A long unbroken email/name would widen the page and shrink every copy. */
      overflow-wrap: anywhere;
    }
    /* Each copy is its own page so the cutter cuts between them. */
    .receipt {
      padding: 3mm 2mm 8mm;
      break-after: page;
      page-break-after: always;
    }
    /* Last copy (kitchen): the cutter sits above the print head, so extra
       feed keeps its final lines clear of the cut. Thermal drivers trim
       trailing blank space, so a tiny dot ends the feed and holds it. */
    .receipt:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .receipt:last-child::after {
      content: ".";
      display: block;
      padding-top: 16mm;
      text-align: center;
      font-size: 8px;
      line-height: 1;
      letter-spacing: 0;
    }
    p { margin: 0; }
    .copy-label {
      text-align: center;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      padding-bottom: 3px;
      border-bottom: 1px solid #000;
      margin-bottom: 6px;
    }
    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.25;
      text-align: center;
    }
    .branch {
      margin-top: 2px;
      text-align: center;
      text-transform: capitalize;
    }
    .order-meta {
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .order-meta .type {
      text-transform: uppercase;
      letter-spacing: 1px;
      white-space: nowrap;
    }
    .line {
      margin-top: 2px;
    }
    hr {
      border: 0;
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 3px;
    }
    .row > :first-child { min-width: 0; }
    .row > :last-child { flex-shrink: 0; white-space: nowrap; }
    /* Qty | Item | Amount — long item names wrap inside their own column. */
    .items {
      display: grid;
      grid-template-columns: 2.4em minmax(0, 1fr) auto;
      column-gap: 6px;
      row-gap: 3px;
      align-items: baseline;
    }
    /* Kitchen reads the slip from a distance: bigger, still regular weight. */
    .items.kitchen {
      grid-template-columns: 2.4em minmax(0, 1fr);
      font-size: 14px;
    }
    .items .th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .items .th-rule {
      grid-column: 1 / -1;
      border-top: 1px solid #000;
      margin-top: -1px;
    }
    .items .qty { text-align: center; }
    .items .amt { text-align: right; white-space: nowrap; }
    .items .th.amt { text-align: end; }
    .items .note {
      grid-column: 2 / -1;
      margin-top: -2px;
      font-size: 11px;
    }
    .items.kitchen .note { font-size: 13px; }
    .total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin-top: 2px;
    }
    .total-label {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .total-value {
      font-size: 16px;
      font-weight: 700;
      white-space: nowrap;
    }
    .payment { margin: 4px 0 0; }
    .thanks {
      margin-top: 10px;
      text-align: center;
    }
    .review {
      margin-top: 8px;
      text-align: center;
      font-size: 11px;
    }
    .review .qr {
      display: block;
      width: 30mm;
      height: 30mm;
      margin: 0 auto 2px;
    }
    .vendor {
      margin-top: 4px;
      text-align: center;
      font-size: 11px;
    }
    .nowrap { white-space: nowrap; }
    /* Preview only — paper slips on a stage with a cut line between copies.
       None of this reaches the printer. */
    @media screen {
      html {
        background: #efe2d3;
        padding: 0 ${PREVIEW_GUTTER_PX}px;
        overflow: hidden;
      }
      body {
        padding: 2px 0 6px;
        background: transparent;
      }
      .receipt {
        background: #fff;
        box-shadow: 0 1px 2px rgba(42, 20, 14, 0.16), 0 6px 18px rgba(42, 20, 14, 0.08);
      }
      .receipt + .receipt {
        position: relative;
        margin-top: 30px;
      }
      .receipt + .receipt::before {
        content: "";
        position: absolute;
        inset-inline: -${PREVIEW_GUTTER_PX}px;
        top: -16px;
        border-top: 2px dashed #57534e;
      }
      .receipt + .receipt::after {
        content: "✂";
        position: absolute;
        top: -27px;
        left: 50%;
        transform: translateX(-50%);
        padding: 0 6px;
        background: #efe2d3;
        color: #44403c;
        font-size: 14px;
        line-height: 20px;
        letter-spacing: 0;
      }
    }${widthMm < NARROW_BELOW_MM ? NARROW_CSS : ""}`;
}

/*
 * Narrow roll (58mm, 48mm print): one size down — Verdana 11px with the same
 * tracking still keeps digits apart at high density — and the amount moves
 * under the item name so names keep the full width.
 */
const NARROW_CSS = `
    body { font-size: 11px; }
    .receipt { padding-left: 1mm; padding-right: 1mm; }
    .copy-label, .items .th, .vendor, .review { font-size: 10px; }
    .review .qr { width: 26mm; height: 26mm; }
    h1, .total-value { font-size: 14px; }
    .total-label { font-size: 12px; }
    .items .note { font-size: 10px; }
    .items.kitchen { font-size: 13px; }
    .items.kitchen .note { font-size: 12px; }
    .items:not(.kitchen) .item-name,
    .items:not(.kitchen) .amt:not(.th),
    .items:not(.kitchen) .note { grid-column: 2 / -1; }`;

/**
 * The complete receipt document — customer, branch and kitchen copies — exactly
 * as printReceipt() prints it. The checkout preview renders this same string.
 */
export function buildReceiptHtml(opts: ReceiptOptions): string {
  const {
    order,
    shopName,
    branchName,
    labels,
    showReprint,
    softwareCompanyName,
    softwareCompanyPhone,
    dir = "ltr",
    paper,
    paperWidthMm,
    copies = ["customer", "branch", "kitchen"],
    reviewUrl = reviewUrlOf(null),
  } = opts;
  const title =
    order.orderNumber != null
      ? `${labels.order} #${formatOrderNumber(order.orderNumber)}`
      : labels.order;

  const shared = {
    order,
    shopName,
    branchName,
    labels,
    showReprint,
    softwareCompanyName,
    softwareCompanyPhone,
  };

  const copyLabels: Record<ReceiptCopy, string> = {
    customer: labels.customerCopy,
    branch: labels.branchCopy,
    kitchen: labels.kitchenCopy,
  };
  const sections = copies
    .map((copy) =>
      buildReceiptSection({
        ...shared,
        copyLabel: copyLabels[copy],
        kitchen: copy === "kitchen",
        reviewUrl: copy === "customer" ? reviewUrl : undefined,
      }),
    )
    .join("");

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${dir === "rtl" ? "ur" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${receiptCss(receiptPrintWidthMm(paper, paperWidthMm), receiptPaperMm(paper, paperWidthMm))}
  </style>
</head>
<body>
  ${sections}
</body>
</html>`;
}

/**
 * Prints the receipt — by default THREE pages (customer + branch + kitchen).
 * Each copy is a separate print page so thermal cutters can cut between them.
 */
export function printReceipt(opts: ReceiptOptions): boolean {
  return printHtmlDocument(buildReceiptHtml(opts));
}

/**
 * Prints a complete HTML document through a hidden iframe (the browser's
 * print dialog: receipt printer, A4 printer or "Save as PDF").
 */
export function printHtmlDocument(html: string): boolean {
  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    // The automatic app update waits while this is on the page (app-update.ts).
    iframe.setAttribute("data-print-job", "");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      return false;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 500);
    };

    win.addEventListener("afterprint", cleanup);
    window.setTimeout(cleanup, 60_000);

    // Call print directly from parent — avoids "callback no longer runnable" in modern Chrome.
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // printer unavailable
      }
    }, 100);

    return true;
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

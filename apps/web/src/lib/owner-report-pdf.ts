import { buildOwnerReportHtml } from "@/lib/print-owner-report";

/**
 * The owner report as a real PDF file, made in the browser — no internet, no
 * print window. The A4 report page is drawn to an image (Urdu text renders
 * exactly as on screen) and cut into A4 pages between rows, never through one.
 * The browser saves it to its download folder.
 */

/** A4 at 96 dpi, ~12 mm margins. */
const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN = 45;
const PX_TO_MM = 210 / PAGE_W;

/**
 * Elements a page may end after — only ones with space under their text:
 * html2canvas draws text a few px lower than the layout, so a cut right under
 * a bare line of text would clip it. Inside a two-column grid only blocks
 * whose row ends level on both sides (grid items stretch): never a bar row of
 * one of the two "ordered | paid" cards, a line inside a staff card or the
 * end of one of the before / after bills.
 */
const CUT_AFTER = [
  "header",
  "section",
  ".status, .eq, .facts",
  ".figs, .res, .cash-meta, .dsum, .dtotal, .day",
  ".split",
  ".top, .ifam, .irow, .igroup",
  ".person",
  ".chk-box, .flag, .ld, .bills, .ld-chg li",
  ".ev",
].join(", ");

/** Report height drawn per html2canvas pass (× scale stays well under the canvas limit). */
const CHUNK_H = 5000;

/** Pixels per CSS px and JPEG quality, sharpest first. */
const QUALITY = [
  { scale: 2, jpeg: 0.85 },
  { scale: 1.5, jpeg: 0.7 },
  { scale: 1.25, jpeg: 0.55 },
];

/**
 * Part of the laid-out report page (`from`…`from + height`, CSS px) drawn by
 * the browser itself — an SVG image of the page — so text, boxes and lines
 * land exactly as on screen and Urdu is shaped. Throws when the browser
 * won't draw it or won't let the canvas be read.
 */
async function drawWithBrowser(markup: string, from: number, height: number, totalH: number, scale: number): Promise<HTMLCanvasElement> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W * scale}" height="${height * scale}" viewBox="0 ${from} ${PAGE_W} ${height}">` +
    `<foreignObject x="0" y="0" width="${PAGE_W}" height="${totalH}">${markup}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_W * scale);
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF: no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.getImageData(0, 0, 1, 1); // throws if the browser locked the canvas
  return canvas;
}

type BuildOpts = Omit<Parameters<typeof buildOwnerReportHtml>[0], "format">;

/**
 * The report as a PDF file (Blob), made on this PC — no internet needed.
 * `maxBytes`: made less sharp until it fits (the email's size limit).
 */
export async function makeOwnerReportPdf(opts: BuildOpts & { maxBytes?: number }): Promise<Blob> {
  // Loaded on demand; the PWA keeps these chunks, so this works offline too.
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const html = buildOwnerReportHtml({ ...opts, format: "a4" });

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Very tall from the start: no scrollbar, so the page never re-wraps
  // between measuring it and drawing it.
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;height:30000px;border:0;pointer-events:none`;
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("PDF: no document");
    doc.open();
    doc.write(html);
    doc.close();
    // Screen layout of one A4 column: margins as padding (no @page here).
    const style = doc.createElement("style");
    style.textContent = `html{overflow:hidden}html,body{width:${PAGE_W}px;margin:0}body{padding:0 ${MARGIN}px 8px}.sheet{padding:0}section{padding-bottom:8px}`;
    doc.head.appendChild(style);
    await doc.fonts?.ready;
    await new Promise((r) => setTimeout(r, 60));

    const body = doc.body;
    const totalH = Math.ceil(body.getBoundingClientRect().height);
    const top = body.getBoundingClientRect().top;
    const cuts = [
      ...new Set(
        Array.from(body.querySelectorAll(CUT_AFTER)).map((el) => Math.round(el.getBoundingClientRect().bottom - top)),
      ),
    ].sort((a, b) => a - b);

    // Page slices: as much as fits, ending after a whole row / card.
    const usable = PAGE_H - MARGIN * 2;
    const slices: [number, number][] = [];
    for (let start = 0; start < totalH - 1; ) {
      const limit = start + usable;
      if (limit >= totalH) {
        slices.push([start, totalH]);
        break;
      }
      let end = 0;
      for (const c of cuts) if (c > start + usable * 0.4 && c <= limit) end = c;
      if (!end) end = limit;
      slices.push([start, end]);
      start = end;
    }

    // A few pages per drawing: one canvas of a long report (details open)
    // passes the browser's canvas size limit and comes out blank.
    const chunks: [number, number][][] = [];
    for (const s of slices) {
      const last = chunks[chunks.length - 1];
      if (last && s[1] - last[0][0] <= CHUNK_H) last.push(s);
      else chunks.push([s]);
    }

    // The browser's own drawing first; html2canvas only where the browser
    // won't hand that back (it guesses text positions — boxes and lines drift).
    const markup = new XMLSerializer().serializeToString(doc.documentElement);
    let useBrowser = true;
    const draw = async (from: number, height: number, scale: number): Promise<HTMLCanvasElement> => {
      if (useBrowser) {
        try {
          return await drawWithBrowser(markup, from, height, totalH, scale);
        } catch (err) {
          console.warn("[owner-report] pdf: browser drawing unavailable, using html2canvas", err);
          useBrowser = false;
        }
      }
      return html2canvas(body, {
        scale,
        backgroundColor: "#ffffff",
        y: top + from,
        width: PAGE_W,
        height,
        windowWidth: PAGE_W,
        windowHeight: totalH,
        logging: false,
      });
    };

    const render = async ({ scale, jpeg }: (typeof QUALITY)[number]): Promise<Blob> => {
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      let i = 0;
      for (const chunk of chunks) {
        const from0 = chunk[0][0];
        const canvas = await draw(from0, chunk[chunk.length - 1][1] - from0, scale);
        for (const [from, to] of chunk) {
          const part = document.createElement("canvas");
          part.width = canvas.width;
          part.height = Math.max(1, Math.round((to - from) * scale));
          const ctx = part.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, part.width, part.height);
          ctx.drawImage(canvas, 0, Math.round((from - from0) * scale), canvas.width, part.height, 0, 0, part.width, part.height);
          if (i > 0) pdf.addPage();
          pdf.addImage(part.toDataURL("image/jpeg", jpeg), "JPEG", 0, MARGIN * PX_TO_MM, 210, (to - from) * PX_TO_MM);
          if (slices.length > 1) {
            pdf.setFontSize(8);
            pdf.setTextColor(150);
            pdf.text(`${i + 1} / ${slices.length}`, 210 - MARGIN * PX_TO_MM, 297 - 6, { align: "right" });
          }
          i++;
        }
      }
      return pdf.output("blob");
    };

    // Sharpest that fits: a long day steps down so the email still goes.
    let blob = await render(QUALITY[0]);
    for (const q of QUALITY.slice(1)) {
      if (!opts.maxBytes || blob.size <= opts.maxBytes) break;
      blob = await render(q);
    }
    return blob;
  } finally {
    frame.remove();
  }
}

/** Hands a file to the browser's download (its download folder). */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadOwnerReportPdf(opts: BuildOpts & { fileName: string }): Promise<void> {
  saveFile(await makeOwnerReportPdf(opts), opts.fileName);
}

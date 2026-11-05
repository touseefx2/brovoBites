import { existsSync } from "node:fs";

/**
 * The A4 owner report page (print-owner-report) → a PDF, on the server, for
 * the daily email (no browser is open at 4 am). Headless Chromium prints it
 * like the browser's "Save as PDF": real, selectable text.
 *
 * On Vercel the Chromium build comes from @sparticuz/chromium-min (downloaded
 * once per cold start, ~70 MB). Elsewhere it uses a local Chrome
 * (CHROME_EXECUTABLE_PATH, or the usual install places).
 */

const CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

const LOCAL_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

/** Web fonts: the server has no Urdu font of its own. */
const FONTS = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Naskh+Arabic:wght@400;600;700&display=block" rel="stylesheet">
<style>body{font-family:Inter,"Noto Naskh Arabic",Arial,sans-serif !important}</style>`;

async function launchBrowser() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    return puppeteer.launch({
      executablePath: await chromium.executablePath(CHROMIUM_PACK),
      args: chromium.args,
      headless: true,
    });
  }
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || LOCAL_CHROME.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chrome found for the PDF (set CHROME_EXECUTABLE_PATH)");
  return puppeteer.launch({ executablePath, args: ["--no-sandbox", "--disable-gpu"], headless: true });
}

/** Each page → its PDF, one browser for all (a cold start costs seconds). */
export async function htmlsToPdf(htmls: string[]): Promise<Buffer[]> {
  const browser = await launchBrowser();
  try {
    const out: Buffer[] = [];
    for (const html of htmls) {
      const page = await browser.newPage();
      await page.setContent(html.replace("</head>", `${FONTS}</head>`), { waitUntil: "load", timeout: 25_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#b39a8a;text-align:center;font-family:Arial"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" },
      });
      out.push(Buffer.from(pdf));
      await page.close().catch(() => {});
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

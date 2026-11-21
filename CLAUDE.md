# Brovo Bites — rules for Claude

## Images (Vercel Hobby: only 5K image transformations / month)

**Rule: every image the site shows is served and resized by ImageKit — Vercel never resizes images.** This covers photos, logos, icons shown as images, and anything new (a new page, section or image type). The one place that builds image URLs is `apps/web/src/lib/image-cdn.ts`.

Only exception, keep as is: the plain `<img>` of the logo used for first paint / offline (`LogoLoader`, `Loading`, `~offline` page, landing intro badge). They load the file unchanged, which costs no transformations.

- A new kind of bundled image (a new folder or file in `apps/web/public/`) → add it to `SOURCE_DIRS` / `SOURCE_FILES` in `apps/web/scripts/sync-static-images.ts`, run the sync, and render it through `cdnImageLoader`.
- Uploads (admin, owner, staff) go through `/api/upload-menu-image` to ImageKit. Don't add another storage (no Firebase Storage, no Vercel Blob, no files saved into `public/` at runtime).
- **After adding, replacing or editing any photo in `apps/web/public/menu/` or `public/logo.png` / `public/logo-full.png`**, always run, in the same task:

  ```bash
  pnpm --filter web images:sync
  ```

  It uploads the photos to ImageKit (DEV and LIVE share one account) and updates `apps/web/src/lib/static-images.imagekit.json`. That file is part of the change — commit it together with the photos. Then confirm with `pnpm --filter web images:sync --check`.
- New menu / food / hero photos go under `apps/web/public/menu/` (only that folder is synced), not elsewhere in `public/`.
- Render photos and logos through `MenuMediaImage`, `AtmosphereBg` or `BrandLogo`, or pass `loader={cdnImageLoader}` (+ `crossOrigin={cdnCrossOrigin(src)}`) to next/image — never plain `next/image` with the default loader (that uses Vercel's quota).
- Any `quality` given to next/image must be in `images.qualities` in `apps/web/next.config.ts` (use 75 or 80).
- Photos the owner uploads in Admin go straight to ImageKit — they need no sync.
- Stay on ImageKit's free plan: `f-auto` serves WebP. Don't hard-code `f-avif` (AVIF auto is a paid ImageKit feature; the owner chose not to pay).

## Receipt printing (thermal POS80, ESC/POS)

- **The receipt logo is generated from `apps/web/public/logo.png`.** After changing that logo, always run, in the same task, and commit the result:

  ```bash
  pnpm --filter web receipt-logo
  ```

  It rebuilds `apps/web/src/lib/receipt-logo.ts` (the customer-copy logo, 1-bit, as ESC/POS raster + PNG data URI). Never edit that file by hand. It is embedded on purpose (prints offline, no image request) — the one image not served by ImageKit.
- The printer gets raw ESC/POS from `apps/web/src/lib/escpos.ts`; the preview / browser print uses `buildReceiptHtml` in `print-receipt.ts`. Change both together so paper and preview match.
- Printer text is plain ASCII only (`toPrinterAscii`): the POS80 prints UTF-8 (—, ·, Urdu) as garbage.
- **POS80 image rule:** a `GS v 0` whose data *starts with blank rows* prints its data as lines of garbage text (paper tests, Nov 2026). The logo must start on an inked row — `build-receipt-logo.ts` crops blank rows and refuses a bitmap that starts blank; `image()` in `escpos.ts` never starts a command on a blank row. Keep at most 255 rows per command (height in one byte), no padding, under centre alignment (`ESC a 1`) — the POS80 centres images itself. A blank 24-row primer raster goes before the logo (if the printer skips the first image of a job, it skips that one invisibly).
- No ring / rotated text in the logo: tiny rotated text prints badly and adds blank rows. The website is printer text under the branch.
- The POS80 (Xprinter family) has **no full cut** — use partial cut `GS V 66 n` only.
- Changing printer bytes? Test on paper before shipping — a wrong command prints a long strip of garbage at the counter.
- The deployed POS prints through the counter-Mac helper on `http://127.0.0.1:17800` (`apps/web/public/print-helper/install.sh`, served at `/print-helper/install.sh`). Changes to the helper reach a Mac only when the installer is run there again.

## Deploys

Never deploy / ship unless the user asks for it in that message.

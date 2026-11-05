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

## Deploys

Never deploy / ship unless the user asks for it in that message.

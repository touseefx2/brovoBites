# Brovo Bites — rules for Claude

## Images (Vercel Hobby: only 5K image transformations / month)

Website photos are resized by **ImageKit**, not Vercel — see `apps/web/src/lib/image-cdn.ts`.

- **After adding, replacing or editing any photo in `apps/web/public/menu/`**, always run, in the same task:

  ```bash
  pnpm --filter web images:sync
  ```

  It uploads the photos to ImageKit (DEV and LIVE share one account) and updates `apps/web/src/lib/static-images.imagekit.json`. That file is part of the change — commit it together with the photos. Then confirm with `pnpm --filter web images:sync --check`.
- New menu / food / hero photos go under `apps/web/public/menu/` (only that folder is synced), not elsewhere in `public/`.
- Render photos through `MenuMediaImage` or `AtmosphereBg`, or pass `loader={cdnImageLoader}` to next/image — never plain `next/image` with the default loader for photos (that uses Vercel's quota). Plain next/image is fine only for the small logos.
- Any `quality` given to next/image must be in `images.qualities` in `apps/web/next.config.ts` (use 75 or 80).
- Photos the owner uploads in Admin go straight to ImageKit — they need no sync.
- Stay on ImageKit's free plan: `f-auto` serves WebP. Don't hard-code `f-avif` (AVIF auto is a paid ImageKit feature; the owner chose not to pay).

## Deploys

Never deploy / ship unless the user asks for it in that message.

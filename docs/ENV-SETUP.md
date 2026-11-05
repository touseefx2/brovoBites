# Dev vs Live env (Brovo Bites)

## Files (secrets never in git)

| File | Git? | Purpose |
|---|---|---|
| `apps/web/.env.example` | template, no secrets (see note) | Template only — copy into the `.local` files below |
| `apps/web/.env.local` | no | **DEV** — what `pnpm --filter web dev` uses |
| `apps/web/.env.development.local` | no | **DEV** Firebase `brovodev` (+ seed/create-owner default) |
| `apps/web/.env.production.local` | no | **LIVE** Firebase `borovo-ffc56` (+ LIVE ImageKit) |
| `deploy/targets.local.env` | no | Vercel org/project IDs + tokens for `pnpm deploy:*` |

> Keep `.env.local` = same world as `.env.development.local` (dev). Never paste live keys into `.env.local`.

Note: the `.env.example` templates are committed (placeholders only); every real `.env*.local` file stays gitignored.

---

## Worlds

Brovo Bites' own accounts — nothing shared with any other shop/project.

| | DEV | LIVE |
|---|---|---|
| Firebase | `brovodev` | `borovo-ffc56` |
| ImageKit | Brovo Bites DEV keys (`https://ik.imagekit.io/<dev_id>`) | Brovo Bites LIVE keys (`https://ik.imagekit.io/<live_id>`) |
| Vercel | Brovo Bites DEV account (admin + menu projects) | Brovo Bites LIVE account (admin + menu projects) |
| Local commands | `pnpm --filter web dev` | `SEED_ENV=production` scripts only |
| Deploy | `pnpm deploy:dev` | `pnpm deploy:live` (type LIVE) |

Firebase project ids ship as placeholders. Once the two Firebase projects exist, set the real ids everywhere in one go:

```bash
bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>   # DEV id must end in -dev
```

DEV and LIVE ImageKit: separate accounts are safest (a delete on DEV then can never remove a LIVE image). One Vercel account for both worlds is fine — same token/org in both slots of `deploy/targets.local.env`.

---

## Fill the local env files

```bash
cp apps/web/.env.example apps/web/.env.development.local   # DEV keys (Firebase brovodev, DEV ImageKit)
cp apps/web/.env.example apps/web/.env.local               # same DEV values
cp apps/web/.env.example apps/web/.env.production.local    # LIVE keys (Firebase borovo-ffc56, LIVE ImageKit)
```

In `.env.production.local` also set `NEXT_PUBLIC_APP_ENV=production` and `NEXT_PUBLIC_APP_URL=https://<your live admin>.vercel.app`.
Where each value comes from (Firebase console, ImageKit Developer options): [DEPLOYMENT.md](../DEPLOYMENT.md) → One-time setup.

---

## Customer mode

| Vercel project | `NEXT_PUBLIC_CUSTOMER_MODE` |
|---|---|
| Admin / staff | `false` or unset |
| Customer menu | **`true`** |

Local test: set `NEXT_PUBLIC_CUSTOMER_MODE=true` in `.env.local`, restart dev server.

---

## Owner + seed (do not mix DBs)

### Create owner only (recommended for LIVE first user)

```bash
# DEV
pnpm create-owner -- --email=dev@mail.com --password='...' --name='Owner' --primary

# LIVE — must match project id
SEED_ENV=production pnpm create-owner -- \
  --email=you@mail.com --password='...' --name='Owner' \
  --confirm=borovo-ffc56 --primary
```

### Full menu seed

```bash
# DEV
pnpm seed -- --ownerUid=UID --ownerEmail=... --ownerName=Owner

# LIVE (dangerous if data already exists)
SEED_ENV=production pnpm seed -- --ownerUid=UID ... --confirm=borovo-ffc56
```

Scripts print the Firebase project id before writing. Read that line every time.

---

## Deploy

See [DEPLOYMENT.md](../DEPLOYMENT.md) for Brovo Bites' Vercel projects + `deploy/targets.local.env`.

```bash
pnpm deploy:dev
pnpm deploy:dev:customer
pnpm deploy:live          # prompts: type LIVE
pnpm deploy:live:customer
```

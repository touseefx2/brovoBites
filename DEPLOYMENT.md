# Deployment Guide — Brovo Bites: Dev vs Live (safe)

Git push **does not** deploy. You choose **dev** or **live** with `pnpm ship:*` / `pnpm deploy:*`.

Brovo Bites has its **own** Firebase projects, Vercel account(s) and ImageKit account(s). Nothing here is shared with any other shop or project.

| World | Firebase project | ImageKit | Vercel | Local env file |
|---|---|---|---|---|
| **DEV** | `brovodev` | Brovo Bites DEV ImageKit keys | Brovo Bites DEV Vercel account (2 projects) | `.env.development.local` (+ `.env.local`) |
| **LIVE** | `borovo-ffc56` | Brovo Bites LIVE ImageKit keys | Brovo Bites LIVE Vercel account (2 projects) | `.env.production.local` |

**Firebase project ids:** a fresh clone ships with placeholder ids (they live in `.firebaserc`, the deploy scripts, the safety guards in `apps/web/scripts` and these docs). After you create the two Firebase projects, set the real ids once:

```bash
bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>
```

DEV id **must** end in `dev` (e.g. `brovodev`); LIVE id must not. The script refuses the same id for both.

**Rule:** never put live Firebase keys in `.env.local` / `.env.development.local`. Local `pnpm dev` must always hit **dev**.

---

## One-time setup (Brovo Bites' own accounts)

### 1) Firebase — 2 projects (DEV + LIVE)

[console.firebase.google.com](https://console.firebase.google.com) → **Add project**, twice:

| | DEV | LIVE |
|---|---|---|
| Project id (example) | `brovodev` | `borovo-ffc56` |
| Use | tests, seed, safe mistakes | real shop, real orders/money |

In **each** project:

1. **Build → Firestore Database → Create database** (production mode; region near the shop — it cannot be changed later).
2. **Build → Authentication → Get started → Email/Password → Enable**.
3. **⚙️ Project settings → General → Your apps → Web app** → copy the config into `NEXT_PUBLIC_FIREBASE_*`.
4. **⚙️ Project settings → Service accounts → Generate new private key** → from that JSON fill `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`. Never commit the JSON file.

DEV values → `apps/web/.env.development.local` (+ `.env.local`). LIVE values → `apps/web/.env.production.local`. Template: `apps/web/.env.example`, guide: [docs/ENV-SETUP.md](docs/ENV-SETUP.md).

If Firebase gave other ids than the placeholders, run `scripts/set-firebase-ids.sh` now (see top).

### 2) ImageKit — menu images (free)

[imagekit.io](https://imagekit.io) → sign up with the Brovo Bites account → **Developer options**:

| ImageKit value | Env variable |
|---|---|
| Public key | `NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY` |
| URL endpoint (`https://ik.imagekit.io/<your_id>`) | `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` |
| Private key (server only, Secret) | `IMAGEKIT_PRIVATE_KEY` |

Best: one ImageKit account for DEV and a separate one for LIVE (like Firebase). Deleting a menu image deletes the file from ImageKit by its URL, so with one shared account a delete on DEV can remove an image LIVE still uses. One account for both works, but then be careful.

### 3) Vercel — create 2 projects per world

Brovo Bites LIVE Vercel account is required. DEV can be a second Brovo Bites Vercel account, or the **same** account with 2 more projects (then the same token + org id go in both the DEV and LIVE slots of `deploy/targets.local.env`).

Settings for every project:

| Setting | Value |
|---|---|
| Framework | Next.js |
| Root Directory | `apps/web` |
| Build Command | `cd ../.. && npx turbo build --filter=web` |
| Install Command | `cd ../.. && pnpm install` (or Vercel default with pnpm) |
| Node | 22.x or 24.x (the emailed owner report PDF needs 22+) |
| Git auto-deploy | **OFF** (`apps/web/vercel.json` already has `deploymentEnabled: false`; also Ignored Build Step `exit 0` if you use Git) |

Suggested names:

| | DEV | LIVE |
|---|---|---|
| Staff/admin POS | `brovobites-pos-dev` | `brovobites-pos` |
| Customer menu (landing only) | `brovobites-dev` (brovobites-dev.vercel.app) | `brovobites` (brovobites.vercel.app) |

Do not name a Vercel project exactly like a Firebase project id — `scripts/set-firebase-ids.sh` would rewrite that name in the docs too.

Import the Brovo Bites GitHub repo (or deploy from CLI only — CLI works without a Git link).

### 4) Paste env vars into each Vercel project

DEV projects get values from `apps/web/.env.development.local`, LIVE projects from `apps/web/.env.production.local`. Never mix.

| Variable | Admin project | Customer project |
|---|---|---|
| All `NEXT_PUBLIC_FIREBASE_*` | same world | same world |
| `FIREBASE_ADMIN_*` | same world | same world |
| ImageKit keys | same world | same world |
| `NEXT_PUBLIC_APP_ENV` | `development` (DEV) / `production` (LIVE) | same |
| `NEXT_PUBLIC_APP_URL` | your admin `*.vercel.app` | your menu `*.vercel.app` |
| `NEXT_PUBLIC_CUSTOMER_MODE` | `false` / unset | **`true`** |
| `PRIMARY_OWNER_UID` | set after create-owner | optional |
| `SMTP_USER` / `SMTP_PASS` / `CRON_SECRET` | see Owner report below | — |

**Multiline `FIREBASE_ADMIN_PRIVATE_KEY`:** paste with real newlines in Vercel → type Secret.

Update `NEXT_PUBLIC_APP_URL` in `.env.production.local` once you know the live URLs.

### 5) Fill `deploy/targets.local.env`

```bash
cp deploy/targets.example.env deploy/targets.local.env
```

For **each** Brovo Bites Vercel account (DEV + LIVE):

1. [Create token](https://vercel.com/account/tokens) → paste into `DEV_VERCEL_TOKEN` / `LIVE_VERCEL_TOKEN` (or use `scripts/save-vercel-token.sh`, below)
2. Project → Settings → General → **Project ID**
3. Team/account **Org ID** (Team Settings → General → Team ID)

Example shape (fake IDs):

```bash
DEV_VERCEL_TOKEN=...
DEV_VERCEL_ORG_ID=team_xxx
DEV_VERCEL_PROJECT_ID_ADMIN=prj_dev_admin
DEV_VERCEL_PROJECT_ID_CUSTOMER=prj_dev_menu
DEV_FIREBASE_PROJECT=brovodev

LIVE_VERCEL_TOKEN=...
LIVE_VERCEL_ORG_ID=team_yyy
LIVE_VERCEL_PROJECT_ID_ADMIN=prj_live_admin
LIVE_VERCEL_PROJECT_ID_CUSTOMER=prj_live_menu
LIVE_FIREBASE_PROJECT=borovo-ffc56
```

Two tokens = no logout dance between accounts.

### 6) Firebase Auth authorized domains (both projects)

Firebase Console → `brovodev` → Authentication → Settings → Authorized domains → add both DEV `*.vercel.app` hosts.  
Firebase Console → `borovo-ffc56` → same → add both LIVE `*.vercel.app` hosts (+ custom domain later).

### 7) Deploy Firestore rules + indexes to the right project

```bash
npx firebase-tools login                     # Google account that owns the Brovo Bites Firebase projects
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project dev    # brovodev
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project live   # borovo-ffc56
```

Aliases `dev` / `live` come from `.firebaserc` (default = dev). `pnpm ship:dev` / `pnpm ship:live` do this for you.

---

## Owner report by email (Gmail) — one-time per world

The owner report is emailed — 2 PDFs, English and Urdu, with the email text in
both — to the addresses an owner adds in
**Admin → Landing Page → Owner report email**: whenever someone presses
**Email report** on the report, and by itself once a day, within about an hour
after the shop day closes (the Business day end time on the same page).

Easiest: make the Gmail app password (below), then run **`pnpm report-email:setup`**
— it asks for the Gmail + app password and puts all three values into the
admin project (DEV, LIVE or both) for you. By hand instead: set these on the
**admin/staff** Vercel project only (DEV and LIVE each), not the customer menu
project:

| Variable | Value |
|---|---|
| `SMTP_USER` | the shop Gmail address that sends the report, e.g. `yourshop.reports@gmail.com` |
| `SMTP_PASS` | that Gmail's **app password** (16 letters — not the normal password) |
| `CRON_SECRET` | any random text, 32+ characters (Vercel sends it to the daily job) |

Gmail app password: sign in to that Gmail → [myaccount.google.com/security](https://myaccount.google.com/security) →
turn on **2-Step Verification** → [App passwords](https://myaccount.google.com/apppasswords) → create one
(name it "Brovo Bites POS") → copy the 16 letters into `SMTP_PASS` (Secret).

Also check **Settings → Build and Deployment → Node.js Version = 22.x or 24.x**
(the server PDF needs Node 22+), and **Settings → Functions → Fluid Compute = On**
(on by default for new projects): the daily job may take up to 300 s to make
its PDFs, and the free plan allows that only with Fluid Compute (60 s without).

Deploy the Firestore rules before the web app when the report email settings
change (`firebase deploy --only firestore:rules --project <world>`): the
Landing Page saves them in the shape the rules check.

Then deploy (`pnpm ship:dev` / `pnpm ship:live`) — the daily job comes from the
`crons` list in `apps/web/vercel.json` (one entry per hour: Vercel's free plan
allows only once-a-day crons, so 24 of them = a check every hour; each check
sends the newest closed day once, never twice). Open Landing Page → Owner
report email → add the owner's Gmail → **Save emails** → **Send last day's
report now** and check that inbox (and Spam).

Without `SMTP_USER` / `SMTP_PASS` nothing is sent (the page says so); without
`CRON_SECRET` only the daily email is off.

Offline POS: the daily email only has what reached the cloud. A day with
nothing there says so in the email; when the POS uploads that day later (or it
changes afterwards), the hourly check sends it again marked **(updated)** — at
most 3 times per day. **Email report** pressed without internet waits on that
PC and goes by itself once the internet is back (sent once, never twice).

---

## Daily: deploy latest code

```bash
# optional: commit + push GitHub only (does NOT go live)
git push origin main

# DEV — Firestore rules/indexes + both Vercel domains
pnpm ship:dev

# LIVE — Firestore rules/indexes + both Vercel domains
pnpm ship:live
```

Vercel-only (no Firestore):

```bash
pnpm deploy:dev:all
CONFIRM_LIVE=1 pnpm deploy:live:all
```

Single project (if needed):

```bash
pnpm deploy:dev
pnpm deploy:dev:customer
CONFIRM_LIVE=1 pnpm deploy:live
CONFIRM_LIVE=1 pnpm deploy:live:customer
```

### Save tokens (one-time per account)

```bash
vercel login --future -Q .tools/vercel-dev-auth     # Brovo Bites DEV Vercel account
bash scripts/save-vercel-token.sh dev  .tools/vercel-dev-auth

vercel login --future -Q .tools/vercel-live-auth    # Brovo Bites LIVE Vercel account
bash scripts/save-vercel-token.sh live .tools/vercel-live-auth
```

Same Vercel account for both worlds → log in to both folders with that account.
The auth folder is required: the script never reads the machine-wide `vercel login`.

> **Never run a bare `vercel`, `vercel link` or `vercel env pull` in this repo.** This Mac's global Vercel login belongs to another shop's team. Always use a repo-local login (`-Q .tools/vercel-<world>-auth`) or `--token`.


Tokens land in `deploy/targets.local.env` (gitignored). After that, deploy never needs logout/login.

Vercel project **env vars** stay on the dashboard (deploy does not upload them):
- DEV projects → Firebase `brovodev` + DEV ImageKit (from `.env.development.local`)
- LIVE projects → Firebase `borovo-ffc56` + LIVE ImageKit (from `.env.production.local`)

Non-interactive live (CI / agent):

```bash
CONFIRM_LIVE=1 pnpm deploy:live:all
```

---

## Create LIVE main owner (Auth + Firestore) — careful

**Do this once on empty live Firebase.** Does **not** seed menu.

```bash
SEED_ENV=production pnpm create-owner -- \
  --email='YOUR_REAL_EMAIL@example.com' \
  --password='ChooseAStrongPassword' \
  --name='Owner' \
  --confirm=borovo-ffc56 \
  --primary
```

What it does:
1. Loads **only** `apps/web/.env.production.local`
2. Prints Firebase project id — must be `borovo-ffc56`
3. Refuses without `--confirm=borovo-ffc56`
4. Creates/updates Auth user + `users/{uid}` with `role: owner` + `isPrimaryOwner`

Then copy printed `PRIMARY_OWNER_UID=...` into Vercel + `.env.production.local` and redeploy live.

### DEV owner (safe default)

```bash
pnpm create-owner -- \
  --email='dev@example.com' \
  --password='DevPass123' \
  --name='Dev Owner' \
  --primary
```

Uses `.env.development.local` → `brovodev`.

---

## Seed menu (separate from owner) — mix-up risks

| Command | DB |
|---|---|
| `pnpm seed -- ...` | **DEV** only |
| `SEED_ENV=production pnpm seed -- ... --confirm=borovo-ffc56` | **LIVE** (menu + branch) |

Production seed **requires** `--confirm=borovo-ffc56`.  
If live already has real menu/orders, **do not** re-seed — it can duplicate categories/products.

The seed menu is only a starter menu — Brovo Bites' real menu is not in the code yet. Don't seed LIVE until it is (or add the menu by hand on the LIVE admin).

Owner-only → always prefer `pnpm create-owner`.

---

## Customer hosts (middleware)

`apps/web/src/middleware.ts` uses `CUSTOMER_HOSTS` in `apps/web/src/lib/customer-mode.ts` **or** `NEXT_PUBLIC_CUSTOMER_MODE=true` on the customer Vercel project (preferred).

`CUSTOMER_HOSTS` ships with placeholder hosts (`brovobites-customer.vercel.app`, `menu.your-domain.com`). When you create the live menu URL, either:
- set `NEXT_PUBLIC_CUSTOMER_MODE=true` on that Vercel project, **or**
- put the real hostname in `CUSTOMER_HOSTS` and redeploy.

---

## Sanity checklist before any LIVE write

1. Banner / script prints `borovo-ffc56` (not `brovodev`)  
2. `SEED_ENV=production` only when you mean live  
3. Vercel project env shows live `NEXT_PUBLIC_FIREBASE_PROJECT_ID=borovo-ffc56`  
4. You typed `LIVE` / `--confirm=borovo-ffc56`  
5. Deploy banner shows the Brovo Bites LIVE Vercel Org + Project  

---

## Troubleshooting

### Deploy goes to wrong account
- Check `deploy/targets.local.env` tokens/org/project IDs  
- Script prints Org + Project before deploy — verify them  

### create-owner / seed says LIVE blocked
- You forgot `--confirm=borovo-ffc56`  
- Or `SEED_ENV` unset (defaults to development)  

### Firebase says project not found
- Project ids are still the placeholders → run `bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>`  
- Or `firebase-tools login` is on a Google account that does not own the Brovo Bites projects  

### Login fails on live site
- Auth user exists in **borovo-ffc56** (not dev)  
- `users/{uid}` doc exists with `role: owner`, `isActive: true`  
- Authorized domains include the Vercel host  

### Build fails on Vercel
- Missing env (especially multiline private key)  
- Root Directory / turbo build command wrong

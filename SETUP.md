# Brovo Bites — naye accounts pe setup

Yeh repo **Brovo Bites** ka hai. Isay Brovo Bites ke **apne** Firebase, ImageKit aur Vercel accounts chahiye, do alag worlds me:
**DEV** (test data, safe mistakes) aur **LIVE** (asal dukaan, asal orders). Upar se neeche order me karo.

Roz ka deploy + detail: [DEPLOYMENT.md](DEPLOYMENT.md) · env files: [docs/ENV-SETUP.md](docs/ENV-SETUP.md) · pehle [8. Safety](#8-safety) parh lo.

---

## 0. Tools (is machine pe)

- [ ] Node 22+ (`package.json` engines `>=20`, lekin Vercel pe owner-report PDF ko 22+ chahiye)
- [ ] pnpm 9 (`packageManager: pnpm@9.15.0` → `corepack enable`)
- [ ] Firebase CLI `firebase` (`scripts/ship.sh` isi ko chalata hai) — ya `npx firebase-tools`
- [ ] Vercel CLI — `scripts/deploy.sh` pehle `~/.local/vercel-cli/node_modules/.bin/vercel`, phir PATH wala `vercel`, warna `npx vercel@41` use karta hai. `scripts/report-email-setup.sh` me npx fallback **nahi** — installed CLI chahiye.
- [ ] Repo root se: `pnpm install`
- Local dev server port **3001** hai (3000 nahi) — taake isi Mac pe doosri shop ka local app / service worker Brovo Bites ke tab me kabhi load na ho.
- Tests sab offline hain (emulator, `demo-bravobites`): `pnpm test`, `pnpm test:rules`, `pnpm test:e2e:local`.

---

## 1. Firebase — 2 projects (DEV + LIVE)

### 1.1 Projects banao

- [ ] [console.firebase.google.com](https://console.firebase.google.com) → Add project → **DEV**. Project id **`dev` pe khatam** ho (e.g. `brovodev`) (DEV emails isi suffix se tag hoti hain; scripts bhi check karte hain).
- [ ] Phir **LIVE** — bilkul alag project, id me `dev` kahin **na** ho.
- Project id baad me change nahi hoti. Dono ek hi Google account ke under rakho to CLI me aasani.

### 1.2 Ids code me set karo

Code me placeholder ids hain — `.firebaserc`: `dev` = `brovodev`, `live` = `borovo-ffc56`. Firebase ne kuch aur diya (id globally unique hoti hai, aksar milta hai) to **ek dafa**:

```bash
bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>
cat .firebaserc && git diff --stat      # check karo, phir commit
```

Yeh `.firebaserc`, project allowlist (`apps/web/src/lib/firebase/allowed-projects.ts`), `scripts/deploy.sh` defaults, `deploy/targets.example.env`, `apps/web/scripts/*` ke safety guards aur docs — **yeh file bhi** — me ids badal deta hai. Refuse karta hai agar id galat format ho, DEV id `-dev` pe khatam na ho, LIVE id me `dev` ho, ya dono same hon.

**Allowlist:** app (browser + server) aur har `apps/web/scripts/*` sirf in do projects (ya emulator `demo-*`) se baat karte hain — koi aur project id env me ho to foran error. Is liye yeh step **zaroori** hai agar ids `brovodev`/`borovo-ffc56` nahi mili.

> Neeche ke commands `brovodev` / `borovo-ffc56` likhte hain — script ke baad yahan bhi asal ids aa jayengi.

### 1.3 Authentication (dono projects)

- [ ] Build → Authentication → Get started → Sign-in method → **Email/Password → Enable**.
  App sirf `signInWithEmailAndPassword` use karti hai (`apps/web/src/lib/auth-context.tsx`) — Google/Phone sign-in ki zaroorat nahi.
- Authorized domains me `localhost` pehle se hota hai; Vercel hosts step 4.6 me.

### 1.4 Firestore (dono projects)

- [ ] Build → Firestore Database → Create database
  - Database ID: **`(default)`** hi rehne do (client + admin dono default DB use karte hain)
  - Location: shop ke qareeb (e.g. `asia-south1` Mumbai). **Permanent — baad me change nahi hoti.** DEV aur LIVE same region rakho.
  - Production mode (asal rules 1.7 me deploy honge)
- Firebase Storage on karne ki zaroorat nahi — images ImageKit pe hain (step 2). Isi liye **bare `firebase deploy` kabhi nahi** (`firebase.json` me storage rules bhi hain) — hamesha `--only firestore:...`.

### 1.5 Web app → `NEXT_PUBLIC_FIREBASE_*`

- [ ] Project settings → General → Your apps → Web (`</>`) → nickname "Brovo Bites POS" (Hosting tick nahi) → `firebaseConfig`:

| `firebaseConfig` | Env variable |
|---|---|
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
| `storageBucket` | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

DEV app → `apps/web/.env.development.local`, LIVE app → `apps/web/.env.production.local` (step 3).

### 1.6 Service account → `FIREBASE_ADMIN_*`

- [ ] Project settings → Service accounts → Firebase Admin SDK → **Generate new private key** (JSON)

| JSON field | Env variable |
|---|---|
| `project_id` | `FIREBASE_ADMIN_PROJECT_ID` |
| `client_email` | `FIREBASE_ADMIN_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_ADMIN_PRIVATE_KEY` |

- `.env` file me private key **ek line, double quotes me**, `\n` jaise JSON me hain waise — code khud `\n` → newline karta hai (`apps/web/src/lib/firebase/admin.ts`).
- JSON file repo folder me mat rakho — values copy karke delete / safe jagah. Repo **public** hai.

### 1.7 Rules + indexes deploy — hamesha `--project`

Is machine ka Firebase CLI doosri shop ke projects me bhi logged in hai. `firebase use` / default project pe **bharosa mat karo** — har command me `--project <id>` khud likho.

```bash
firebase login:list        # kaun se Google accounts logged in hain
firebase projects:list     # dono Brovo Bites projects yahan nazar aane chahiye
```

Brovo Bites projects kisi aur Google account ke hain to:

```bash
firebase login:add                          # Brovo Bites wala Google account add karo (browser)
firebase login:use <bravobites-google-email>    # is repo folder ka default account
# ya har command me: --account <bravobites-google-email>
```

```bash
firebase deploy --only firestore:rules,firestore:indexes --project brovodev  --non-interactive
firebase deploy --only firestore:rules,firestore:indexes --project borovo-ffc56 --non-interactive
```

- Indexes banne me kuch minute lagte hain (Console → Firestore → Indexes).
- Baad me `pnpm ship:dev` / `pnpm ship:live` yahi kaam `firebase use dev|live` (aliases `.firebaserc` se) ke zariye karte hain — tab chalao jab `.firebaserc` me Brovo Bites ids hon aur `firebase projects:list` sahi account dikhaye.

### 1.8 DEV: seed + owner

Pehle step 3 se `apps/web/.env.development.local` bharo. Phir repo root se:

```bash
pnpm seed
pnpm create-owner -- --email=owner@example.com --password='StrongPass123' --name='Owner' --primary
```

- Dono scripts banner me `Firebase project: ...` print karte hain — DEV id honi chahiye. Har dafa parho.
- `seed` = branch `main` + `settings/shop` (`DEFAULT_SETTINGS`) + counters + starter menu. **Har project pe sirf ek dafa** — dobara chalaya to categories/products duplicate (random ids) aur `settings/shop` overwrite.
- `seed` ko `--ownerUid` **mat do** — woh `users/{uid}` bina merge likhta hai (`isPrimaryOwner` ur jata hai). Owner hamesha `create-owner` se (merge, branch `main`, `--primary`).
- Password kam az kam 6 characters.
- Check: `pnpm --filter web dev` → http://localhost:3001/login → owner login.

### 1.9 LIVE: owner (menu baad me)

`apps/web/.env.production.local` bharne ke baad:

```bash
SEED_ENV=production pnpm create-owner -- \
  --email='owner@example.com' --password='...' --name='Owner' \
  --confirm=borovo-ffc56 --primary
```

- Sirf `.env.production.local` load hoti hai; `--confirm=<live id>` ke bina refuse; project id me `dev` ho to refuse.
- Print hua uid → optional `PRIMARY_OWNER_UID` (LIVE admin Vercel + `.env.production.local`).
- LIVE branch + settings + menu: **naya menu aane ke baad** (step 7), khali LIVE pe ek dafa:

  ```bash
  SEED_ENV=production pnpm seed -- --confirm=borovo-ffc56
  ```

  Ya DEV admin me menu bana ke DEV → LIVE copy:

  ```bash
  pnpm copy-menu -- --dry-run
  pnpm copy-menu -- --confirm=borovo-ffc56 --with-branches
  ```

  `--with-settings` mat do fresh dukaan pe — woh `counters` bhi copy karta hai (DEV ke test order numbers LIVE pe chale jayenge). `settings/shop` na ho to app `DEFAULT_SETTINGS` dikhati hai jab tak owner Landing Page save na kare.

---

## 2. ImageKit (menu / logo / hero images)

- [ ] [imagekit.io](https://imagekit.io) → Brovo Bites ke email se naya account → **Developer options**:

| ImageKit | Env variable | Note |
|---|---|---|
| Public key | `NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY` | browser me bhi jata hai |
| URL endpoint `https://ik.imagekit.io/<your_id>` | `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` | |
| Private key | `IMAGEKIT_PRIVATE_KEY` | **server-only** — kabhi `NEXT_PUBLIC_` nahi; Vercel pe Sensitive |

- Teeno chahiye. Private key missing → `/api/upload-menu-image` 503 "ImageKit is not configured". Public key/endpoint missing → admin me upload hi band.
- DEV aur LIVE ke liye **alag** ImageKit accounts best: image delete (`/api/delete-image`) ImageKit se file hata deta hai, to shared account me DEV ka delete LIVE ki image ura sakta hai. Ek account bhi chalega — bas dhyan.
- `IMAGEKIT_FOLDER` optional. Unset → `brovobites/menu/branding`, `brovobites/menu/hero-slides`, `brovobites/menu/categories/<branch>`, `brovobites/menu/products/<branch>`. Set kiya to **har** upload usi ek folder me. Normally unset rakho.
- [ ] **Bundled photos ImageKit pe** (`public/menu/**` — hero, category, item placeholders). Har ImageKit account ke liye ek dafa, aur jab bhi `public/menu` me koi photo add / change ho:

  ```bash
  pnpm --filter web images:sync                        # DEV account (.env.development.local)
  SEED_ENV=production pnpm --filter web images:sync    # LIVE account (.env.production.local)
  pnpm --filter web images:sync --check                # bina network: map up to date hai?
  ```

  Phir `apps/web/src/lib/static-images.imagekit.json` commit karo. Kyun: Vercel Hobby pe sirf 5K image transformations/mahina hain — website ki saari photos aur logo ImageKit resize karta hai (`src/lib/image-cdn.ts`), Vercel koi image resize nahi karta. Sync nahi kiya → kuch nahi tootta: nayi / badli hui photo Vercel se resize hoti hai (build me `[images] … changed since the last ImageKit sync` warning aati hai), aur jis ImageKit account pe sync hi nahi hua wahan saari bundled photos Vercel se. Bundled photos git me hi rehti hain, to kal ko CDN badalna ho to unke liye `image-cdn.ts` + naya upload step kaafi hai. Owner ki upload ki hui photos Firestore me poore ImageKit URL ke saath save hain — unhe move karne ke liye files copy + Firestore URLs badalne honge (tab tak ImageKit pe chalti rahengi).

---

## 3. Env files (local, gitignored)

| File | World | Kaun use karta hai |
|---|---|---|
| `apps/web/.env.development.local` | DEV | `pnpm --filter web dev`, `pnpm seed`, `pnpm create-owner`, `copy-menu` (source) |
| `apps/web/.env.local` | DEV (same values) | Next.js — dev **aur** local prod build dono me load hoti hai → LIVE keys yahan kabhi nahi |
| `apps/web/.env.production.local` | LIVE | `SEED_ENV=production` scripts, `copy-menu` (target), local `next build`/`start`, LIVE Vercel pe paste ka source |
| `deploy/targets.local.env` | — | Vercel ids + tokens (step 4.4) |

```bash
cp apps/web/.env.example apps/web/.env.development.local   # DEV Firebase + DEV ImageKit
cp apps/web/.env.example apps/web/.env.local               # same DEV values
cp apps/web/.env.example apps/web/.env.production.local    # LIVE Firebase + LIVE ImageKit
```

> `apps/web/.env.example` repo me hai (sirf placeholders). Asli values wali `.env*.local` files gitignored hain — kabhi commit nahi.

**Required** (har file): sab `NEXT_PUBLIC_FIREBASE_*` (1.5), `FIREBASE_ADMIN_*` (1.6), teeno ImageKit (2).

**Optional:**

| Variable | Kab / kya |
|---|---|
| `NEXT_PUBLIC_CUSTOMER_MODE` | `true` sirf customer menu project pe (ya local test). Admin pe `false`/unset |
| `PRIMARY_OWNER_UID` | main owner lock (co-owners isay delete nahi kar sakte). Unset → `isPrimaryOwner` flag / sab se purana owner |
| `SMTP_USER`, `SMTP_PASS` | owner-report email — admin project only (step 5) |
| `CRON_SECRET` | hourly report cron ki auth — admin project only (step 5) |
| `SMTP_HOST`, `SMTP_PORT` | default `smtp.gmail.com` / `465` — sirf non-Gmail ke liye |
| `IMAGEKIT_FOLDER` | step 2 |
| `NEXT_PUBLIC_IMAGE_UPLOAD_PROVIDER` | `firebase` sirf agar kabhi Firebase Storage pe shift karo — abhi nahi |
| `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_APP_URL` | template me hain (`development`/`production`, site URL) — abhi koi code inhein read nahi karta, label ke taur pe sahi bhar do |

> Local `pnpm build` / `pnpm --filter web start` = `.env.production.local` = **LIVE Firebase**. Local testing sirf `pnpm --filter web dev` se.

---

## 4. Vercel

### 4.1 Account + 4 projects

- [ ] Brovo Bites ka **naya** Vercel account (LIVE). DEV ke liye alag Brovo Bites account, ya **same** account me 2 aur projects — tab same token + org id dono slots (DEV + LIVE) me.
- [ ] 4 projects (deploy targets `dev`, `dev-customer`, `live`, `live-customer`):

| | DEV | LIVE |
|---|---|---|
| Staff/admin POS | e.g. `brovobites-pos-dev` | e.g. `brovobites-pos` |
| Customer menu (landing only) | `brovobites-dev` | `brovobites` |

- Kisi Vercel project ka naam bilkul Firebase project id jaisa mat rakho — `set-firebase-ids.sh` docs me woh naam bhi badal dega.
- Banane ka tareeqa: Brovo Bites GitHub repo import karo (git deploy waise bhi off hai), ya sirf CLI deploy (Git link ke bina bhi chalta hai).

### 4.2 Har project ki settings

| Setting | Value |
|---|---|
| Framework | Next.js |
| Root Directory | `apps/web` |
| Build Command | `cd ../.. && npx turbo build --filter=web` |
| Install Command | `cd ../.. && pnpm install` |
| Node.js Version | **22.x ya 24.x** (owner-report PDF ko 22+) |
| Functions → Fluid Compute | **On** (cron route `maxDuration = 300`; bina Fluid free plan pe 60 s) |
| Git auto-deploy | off — `apps/web/vercel.json` → `git.deploymentEnabled: false` |

### 4.3 Env vars (Settings → Environment Variables → **Production**)

DEV projects ← `.env.development.local`, LIVE projects ← `.env.production.local`. **Kabhi mix nahi.**
Deploy scripts env upload **nahi** karte — dashboard pe khud paste karo.

| Variable | Admin project | Customer project |
|---|---|---|
| sab `NEXT_PUBLIC_FIREBASE_*` | yes | yes |
| `FIREBASE_ADMIN_*` | yes | yes (public `/api/public/branches-staff` Admin SDK use karta hai) |
| teeno ImageKit | yes | yes |
| `NEXT_PUBLIC_CUSTOMER_MODE` | `false` / unset | **`true`** (zaroori — `next.config.ts` build me bhi isay parhta hai) |
| `NEXT_PUBLIC_APP_ENV` / `NEXT_PUBLIC_APP_URL` | world / admin URL | world / menu URL |
| `PRIMARY_OWNER_UID` | optional (1.9) | — |
| `SMTP_USER` / `SMTP_PASS` / `CRON_SECRET` | step 5 | — |

- Secrets (`FIREBASE_ADMIN_PRIVATE_KEY`, `IMAGEKIT_PRIVATE_KEY`, `SMTP_PASS`, `CRON_SECRET`) → Sensitive. Private key real newlines ke saath ya `\n` wali ek line — dono chalte hain.
- `NEXT_PUBLIC_*` build me bake hote hain → badlo to **redeploy**.

### 4.4 `deploy/targets.local.env` + tokens

```bash
cp deploy/targets.example.env deploy/targets.local.env
```

Bharo: `DEV_VERCEL_ORG_ID`, `DEV_VERCEL_PROJECT_ID_ADMIN`, `DEV_VERCEL_PROJECT_ID_CUSTOMER`, `LIVE_VERCEL_ORG_ID`, `LIVE_VERCEL_PROJECT_ID_ADMIN`, `LIVE_VERCEL_PROJECT_ID_CUSTOMER` (`*_FIREBASE_PROJECT` pehle se set).

- Project ID: Project → Settings → General → Project ID
- Org ID: Team Settings → General → Team ID

**Tokens — dhyan:** is Mac ka global `vercel` login **doosri shop ki team** ka hai. Is repo me **kabhi bare `vercel`, `vercel link` ya `vercel env pull` mat chalao.** `save-vercel-token.sh` ab auth folder ke bina chalta hi nahi — hamesha alag auth folders (gitignored `.tools/`, `report-email:setup` bhi inhi ko use karta hai):

```bash
vercel login --future -Q .tools/vercel-dev-auth      # Brovo Bites DEV Vercel account
bash scripts/save-vercel-token.sh dev  .tools/vercel-dev-auth
vercel login --future -Q .tools/vercel-live-auth     # Brovo Bites LIVE Vercel account
bash scripts/save-vercel-token.sh live .tools/vercel-live-auth
```

Script `Token account: ...` print karta hai — Brovo Bites ka hona chahiye. Ya Brovo Bites account se [vercel.com/account/tokens](https://vercel.com/account/tokens) pe token bana ke `DEV_VERCEL_TOKEN` / `LIVE_VERCEL_TOKEN` me paste.
`vercel logout` saved token ko invalid kar sakta hai.

### 4.5 Deploy

`git push` deploy **nahi** karta. Repo root se:

```bash
pnpm deploy:dev:all                    # DEV admin + menu (Vercel only)
pnpm ship:dev                          # DEV: Firestore rules/indexes + dono Vercel projects
CONFIRM_LIVE=1 pnpm deploy:live:all    # LIVE dono (CONFIRM_LIVE ke bina "LIVE" type karwata hai)
pnpm ship:live                         # LIVE: rules/indexes + dono — yeh LIVE confirm NAHI poochta
```

- Upload se pehle banner `Firebase` / `Org` / `Project` print karta hai — check karo. LIVE target pe Firebase naam me `dev` ho to refuse.

### 4.6 Pehle deploy ke baad

- [ ] Firebase → Authentication → Settings → **Authorized domains**: DEV project me dono DEV `*.vercel.app` hosts, LIVE project me dono LIVE hosts (+ custom domain baad me).
- [ ] `apps/web/src/lib/customer-mode.ts` → `CUSTOMER_HOSTS` me placeholders (`brovobites-customer.vercel.app`, `menu.your-domain.com`, `menu.dev.your-domain.com`) ko asal customer hostnames se badlo → commit → redeploy. (Backup hai; asal switch `NEXT_PUBLIC_CUSTOMER_MODE=true` hai.)
- [ ] `NEXT_PUBLIC_APP_URL` asal URLs se (`.env.production.local` + Vercel).
- [ ] Admin → Landing Page → "Online menu link (WhatsApp message)" = customer menu URL.
- Cron: `apps/web/vercel.json` me 24 hourly entries → `/api/admin/cron/owner-report`. Vercel `Authorization: Bearer $CRON_SECRET` bhejta hai; `CRON_SECRET` na ho to route 401 — kuch nahi jata. Same `vercel.json` customer project pe bhi crons banata hai — harmless (customer mode `/api/admin/*` block karta hai, wahan secret bhi nahi).

---

## 5. Owner report email (Gmail)

1. [ ] Shop ka Gmail → [2-Step Verification](https://myaccount.google.com/security) on → [App passwords](https://myaccount.google.com/apppasswords) → "Brovo Bites POS" → 16 letters.
2. [ ] `pnpm report-email:setup` → Gmail + app password (hidden) + `dev`/`live`/`both` poochta hai → **admin** project (Production) pe `SMTP_USER`, `SMTP_PASS` aur random `CRON_SECRET` set. Customer project ko nahi chhoota. Chahiye: `deploy/targets.local.env` (org + admin project id + token, ya `.tools/vercel-*-auth`) aur installed Vercel CLI.
3. [ ] `pnpm ship:dev` / `pnpm ship:live`.
4. [ ] Admin → Landing Page → Owner report email → owner ka Gmail → Save emails → "Send last day's report now" → inbox (aur Spam) check.

Node 22.x/24.x + Fluid Compute (4.2) zaroori. Poori detail: [DEPLOYMENT.md](DEPLOYMENT.md) → Owner report by email.

---

## 6. Branding

| Kya | Kahan | Abhi |
|---|---|---|
| Logo (gol badge) | `apps/web/public/logo.png` — sirf BB circle (header, login, footer, loader). Admin → Landing Page → Logo upload isay override karta hai: wahan bhi **circle** wala logo daalna, naam wala nahi (gol frame me kat jata hai) | ✅ asli logo |
| Full logo (naam ke saath) | `apps/web/public/logo-full.png` — landing hero + offline page. Halke (cream) letters → sirf dark background pe | ✅ asli logo |
| POS / PWA icons | `apps/web/public/icon-192.png`, `icon-512.png`, `src/app/apple-icon.png` (iPhone) | ✅ asli logo |
| Favicon | `apps/web/src/app/favicon.ico` (16/32/48) | ✅ asli logo |
| Shop phone | Admin → Branches → Main → Phone (landing page branch phone dikhata hai). Seed se pehle chaho to `packages/domain/src/types.ts` `DEFAULT_SETTINGS.phone` bhi bhar do (seed branch me copy karta hai) | khali (phone chip chhupa rehta hai) |
| Shop name, tagline, eyebrow, copyright, WhatsApp, Google review link | Admin → Landing Page (`settings/shop`); code defaults `DEFAULT_SETTINGS` | "Brovo Bites", "Authentic Taste, Royal Experience", eyebrow purane menu wala |
| Meta description | `apps/web/src/app/layout.tsx` → `metadata.description` (tagline + dish list) — code | purana |
| Hero slides | Admin → Landing Page (ImageKit) | default `public/menu/hero.jpg` |
| Customer hosts | 4.6 | placeholders |
| Software company credit | Admin → Landing Page (receipt footer) | Nexora — rehne do |

---

## 7. Menu — Brovo Bites menu (owner ki list, Nov 2026)

`seed-data.ts` me ab Brovo Bites ka asal menu hai: Burgers & Wraps, Wings & Nuggets, Fries, Salads, Dip Sauces, Extras, Drinks (26 items, sab single price). Photos abhi generic stock / logo hain — asal photos Admin → Menu se upload karo (ImageKit).

Purana starter (Sajji/pizza) menu sirf e2e tests ke liye bacha hai: `apps/web/scripts/fixtures/e2e-menu.ts` — `pnpm seed` usay **sirf** emulator (`demo-*`) pe use karta hai, DEV/LIVE pe kabhi nahi.

| Kya | Kahan |
|---|---|
| Categories / products / prices / variations / deals (sirf `pnpm seed` use karta hai) | `apps/web/src/lib/seed-data.ts` (`SEED_CATEGORIES`, `SEED_PRODUCTS`) |
| Local image paths map | `apps/web/src/lib/menu-images.ts` |
| Bundled photos | `apps/web/public/menu/categories/*`, `items/*`, `atmosphere/*`, `hero.jpg` |
| Landing background / loader images | `apps/web/src/components/AtmosphereBg.tsx`, `MenuFoodLoader.tsx` |
| Eyebrow default + hint | `DEFAULT_SETTINGS.eyebrow` (`packages/domain/src/types.ts`), `eyebrowHint` (`apps/web/src/i18n/dictionaries.ts`) |
| Inventory unit guess (dish words regex) | `packages/domain/src/inventory.ts` |
| Asal data (deploy ke baad) | Firestore `categories` / `products` → Admin → Menu (owner); photos ImageKit pe |

Do raste: (a) `seed-data.ts` me naya menu → khali project pe `pnpm seed` (DEV) / `SEED_ENV=production pnpm seed -- --confirm=borovo-ffc56` (LIVE), ya (b) DEV admin me haath se → `pnpm copy-menu` (1.9).

---

## 8. Safety

> - Yeh repo **sirf Brovo Bites** ke Firebase / Vercel / ImageKit se judega. Kisi aur shop ke project id, Vercel token/org/project id ya ImageKit key yahan kabhi nahi.
> - Kisi aur project se `.env*`, `deploy/targets.local.env`, `.tools/` ya service-account JSON **copy mat karo** — har value Brovo Bites ke console se nayi lo.
> - Firebase CLI: har command me `--project <bravobites id>`. Vercel: kabhi bare `vercel` nahi — sirf `-Q .tools/vercel-<world>-auth` / `--token`; banner me Org/Project + `Token account` check.
> - Allowlist (`apps/web/src/lib/firebase/allowed-projects.ts`) ko kabhi kisi aur shop ke project id se mat bharo.
> - LIVE likhne se pehle: banner me LIVE id, `SEED_ENV=production` sirf jaan boojh ke, `--confirm=<live id>`.
> - Repo **public** hai: push se pehle `git status` — `.env*`, `deploy/targets.local.env`, `.tools/`, `*-firebase-adminsdk-*.json` kabhi staged na hon (`git check-ignore -v <file>` se confirm).

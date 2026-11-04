#!/usr/bin/env bash
# Browser (e2e) tests on THIS machine only: Firebase emulators for the demo
# project "demo-bravobites" (new firestore.rules included) + the Next dev server
# pointed at them on port 3100. Never touches DEV or LIVE.
#
#   pnpm test:e2e:local                 # all specs
#   pnpm test:e2e:local tests/staff-orders.spec.ts
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3100 is already in use — stop that server first." >&2
  exit 1
fi

export NEXT_PUBLIC_USE_EMULATORS=1
export NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bravobites
export NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-bravobites.firebaseapp.com
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-bravobites.appspot.com
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIREBASE_ADMIN_PROJECT_ID=demo-bravobites
export GCLOUD_PROJECT=demo-bravobites
# The seed scripts need *some* service-account key, but the emulators never
# check it: use a throwaway key made for this run, never a real one.
export FIREBASE_ADMIN_CLIENT_EMAIL=e2e@demo-bravobites.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)"
export FIREBASE_ADMIN_PRIVATE_KEY
# No real image CDN or mail in tests, even if a local .env file has keys.
export NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY= NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT= IMAGEKIT_PRIVATE_KEY=
export SMTP_USER= SMTP_PASS=
export PORT=3100
export E2E_BASE_URL=http://localhost:3100
# Owner-report emails are written here instead of going to Gmail; the hourly
# cron route needs its secret.
export REPORT_EMAIL_OUTBOX="$ROOT/apps/e2e/.email-outbox"
export CRON_SECRET=e2e-cron-secret
rm -rf "$REPORT_EMAIL_OUTBOX"

npx firebase-tools emulators:exec --only firestore,auth --project demo-bravobites \
  "pnpm --filter web exec tsx scripts/seed-e2e.ts \
   && pnpm --filter web exec tsx scripts/seed.ts \
   && pnpm --filter @bravobites/e2e exec playwright test --project=desktop --workers=1 $*"

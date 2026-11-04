#!/usr/bin/env bash
# One-shot: Firestore rules+indexes + both Vercel domains for a world.
#
#   pnpm ship:dev     → firebase DEV + Vercel DEV (admin + menu)
#   pnpm ship:live    → firebase LIVE + Vercel LIVE (admin + menu)
#
# Does NOT push Vercel env vars. If Firebase/ImageKit keys change, paste them
# into Vercel project settings from:
#   DEV  → apps/web/.env.development.local
#   LIVE → apps/web/.env.production.local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORLD="${1:-}"
if [[ "$WORLD" != "dev" && "$WORLD" != "live" ]]; then
  echo "Usage: $0 <dev|live>"
  exit 1
fi

echo "======== Firestore ($WORLD) ========"
firebase use "$WORLD"
# Whatever happens next (a failed Vercel step included), leave the local
# firebase CLI on DEV — a later bare "firebase deploy" must never hit LIVE.
if [[ "$WORLD" == "live" ]]; then
  trap 'firebase use dev >/dev/null 2>&1 || true' EXIT
fi
firebase deploy --only firestore:rules,firestore:indexes --non-interactive

echo ""
echo "======== Vercel ($WORLD both domains) ========"
if [[ "$WORLD" == "dev" ]]; then
  bash scripts/deploy.sh dev-all
else
  CONFIRM_LIVE=1 bash scripts/deploy.sh live-all
fi

echo ""
echo "Ship $WORLD complete."
echo "Note: Vercel env vars are not uploaded. Update dashboard if keys changed."

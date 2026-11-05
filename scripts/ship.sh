#!/usr/bin/env bash
# One command per world: Firestore rules + indexes, then the code to BOTH Vercel
# domains of that world (admin/POS + customer menu).
#
#   pnpm ship:dev     → Firebase DEV  (rules + indexes) + Vercel DEV  admin + menu
#   pnpm ship:live    → Firebase LIVE (rules + indexes) + Vercel LIVE admin + menu
#                       (asks you to type LIVE first; CONFIRM_LIVE=1 skips the prompt)
#
# Ids + tokens come from deploy/targets.local.env (gitignored). The Firebase
# project is always passed explicitly (--project) — the CLI's "current project"
# is never used or changed.
#
# Does NOT copy any data and does NOT upload env vars. If Firebase / ImageKit
# keys change, update them in the Vercel project settings (DEV ← .env.development.local,
# LIVE ← .env.production.local).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORLD="${1:-}"
if [[ "$WORLD" != "dev" && "$WORLD" != "live" ]]; then
  echo "Usage: $0 <dev|live>"
  exit 1
fi

WORLD_UP="$(printf '%s' "$WORLD" | tr '[:lower:]' '[:upper:]')"

TARGETS_FILE="$ROOT/deploy/targets.local.env"
if [[ ! -f "$TARGETS_FILE" ]]; then
  echo "Missing $TARGETS_FILE — copy deploy/targets.example.env and fill ids/tokens."
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$TARGETS_FILE"
set +a

if [[ "$WORLD" == "dev" ]]; then
  FIREBASE_PROJECT="${DEV_FIREBASE_PROJECT:-}"
  ADMIN_ID="${DEV_VERCEL_PROJECT_ID_ADMIN:-}"
  MENU_ID="${DEV_VERCEL_PROJECT_ID_CUSTOMER:-}"
  TOKEN="${DEV_VERCEL_TOKEN:-}"
else
  FIREBASE_PROJECT="${LIVE_FIREBASE_PROJECT:-}"
  ADMIN_ID="${LIVE_VERCEL_PROJECT_ID_ADMIN:-}"
  MENU_ID="${LIVE_VERCEL_PROJECT_ID_CUSTOMER:-}"
  TOKEN="${LIVE_VERCEL_TOKEN:-}"
fi

missing=()
[[ -n "$FIREBASE_PROJECT" ]] || missing+=("${WORLD_UP}_FIREBASE_PROJECT")
[[ -n "$ADMIN_ID" ]] || missing+=("${WORLD_UP}_VERCEL_PROJECT_ID_ADMIN")
[[ -n "$MENU_ID" ]] || missing+=("${WORLD_UP}_VERCEL_PROJECT_ID_CUSTOMER")
[[ -n "$TOKEN" ]] || missing+=("${WORLD_UP}_VERCEL_TOKEN")
if (( ${#missing[@]} )); then
  echo "deploy/targets.local.env is missing: ${missing[*]}"
  exit 1
fi

# DEV and LIVE must never be confused.
if [[ "$WORLD" == "dev" && "$FIREBASE_PROJECT" != *dev ]]; then
  echo "Refusing: DEV ship but Firebase project '$FIREBASE_PROJECT' does not end in 'dev'."
  exit 1
fi
if [[ "$WORLD" == "live" && "$FIREBASE_PROJECT" == *dev* ]]; then
  echo "Refusing: LIVE ship but Firebase project '$FIREBASE_PROJECT' contains 'dev'."
  exit 1
fi

FIREBASE_ACCOUNT="$(firebase login:list 2>/dev/null | sed -n 's/.*Logged in as //p' | head -1)"

echo "============================================================"
echo "  SHIP $WORLD_UP"
echo "  Firebase project : $FIREBASE_PROJECT   (CLI account: ${FIREBASE_ACCOUNT:-not logged in})"
echo "  Vercel admin/POS : $ADMIN_ID"
echo "  Vercel menu      : $MENU_ID"
echo "  Steps            : 1) Firestore rules + indexes  2) Vercel admin  3) Vercel menu"
echo "============================================================"

if [[ -z "$FIREBASE_ACCOUNT" ]]; then
  echo "Firebase CLI is not logged in. Run: firebase login   (Brovo Bites Google account)"
  exit 1
fi

if [[ "$WORLD" == "live" && "${CONFIRM_LIVE:-}" != "1" ]]; then
  echo ""
  echo "This is the REAL shop. Type LIVE and press Enter to continue:"
  read -r answer
  if [[ "$answer" != "LIVE" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""
echo "======== 1/3 Firestore rules + indexes ($FIREBASE_PROJECT) ========"
firebase deploy --only firestore:rules,firestore:indexes --project "$FIREBASE_PROJECT" --non-interactive

echo ""
echo "======== 2-3/3 Vercel ($WORLD: admin + menu) ========"
if [[ "$WORLD" == "dev" ]]; then
  bash scripts/deploy.sh dev-all
else
  CONFIRM_LIVE=1 bash scripts/deploy.sh live-all
fi

echo ""
echo "Ship $WORLD complete (Firebase: $FIREBASE_PROJECT)."
echo "Note: Vercel env vars are not uploaded by this script."

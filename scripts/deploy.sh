#!/usr/bin/env bash
# Deploy this repo to a named Vercel target (dev or live admin/customer).
#
# Usage (from repo root):
#   pnpm deploy:dev:all          # BOTH DEV domains (admin + menu)
#   pnpm deploy:live:all         # BOTH LIVE domains (admin + menu)
#   pnpm deploy:dev              # DEV admin only
#   pnpm deploy:dev:customer     # DEV menu only
#   pnpm deploy:live             # LIVE admin only (asks confirm)
#   pnpm deploy:live:customer    # LIVE menu only (asks confirm)
#
# Tokens: deploy/targets.local.env  (DEV_VERCEL_TOKEN + LIVE_VERCEL_TOKEN)
# Save a Brovo Bites Vercel login → token (repo-local auth dirs, never the global login):
#   bash scripts/save-vercel-token.sh live .tools/vercel-live-auth
#   bash scripts/save-vercel-token.sh dev  .tools/vercel-dev-auth
#
# Env on Vercel (already set per project — not uploaded by this script):
#   LIVE projects → production Firebase + live ImageKit (.env.production.local values)
#   DEV  projects → brovodev Firebase + dev ImageKit (.env.development.local)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <dev|dev-customer|dev-all|live|live-customer|live-all>"
  exit 1
fi

TARGETS_FILE="$ROOT/deploy/targets.local.env"
if [[ ! -f "$TARGETS_FILE" ]]; then
  echo "Missing $TARGETS_FILE"
  echo "Copy deploy/targets.example.env → deploy/targets.local.env and fill IDs/tokens."
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$TARGETS_FILE"
set +a

deploy_one() {
  local target="$1"
  local TOKEN="" ORG="" PROJECT="" FIREBASE="" LABEL="" TOKEN_KEY=""

  case "$target" in
    dev)
      TOKEN="${DEV_VERCEL_TOKEN:-}"
      TOKEN_KEY="DEV_VERCEL_TOKEN"
      ORG="${DEV_VERCEL_ORG_ID:-}"
      PROJECT="${DEV_VERCEL_PROJECT_ID_ADMIN:-}"
      FIREBASE="${DEV_FIREBASE_PROJECT:-brovodev}"
      LABEL="DEV admin/staff"
      ;;
    dev-customer)
      TOKEN="${DEV_VERCEL_TOKEN:-}"
      TOKEN_KEY="DEV_VERCEL_TOKEN"
      ORG="${DEV_VERCEL_ORG_ID:-}"
      PROJECT="${DEV_VERCEL_PROJECT_ID_CUSTOMER:-}"
      FIREBASE="${DEV_FIREBASE_PROJECT:-brovodev}"
      LABEL="DEV customer landing"
      ;;
    live)
      TOKEN="${LIVE_VERCEL_TOKEN:-}"
      TOKEN_KEY="LIVE_VERCEL_TOKEN"
      ORG="${LIVE_VERCEL_ORG_ID:-}"
      PROJECT="${LIVE_VERCEL_PROJECT_ID_ADMIN:-}"
      FIREBASE="${LIVE_FIREBASE_PROJECT:-borovo-ffc56}"
      LABEL="LIVE admin/staff"
      ;;
    live-customer)
      TOKEN="${LIVE_VERCEL_TOKEN:-}"
      TOKEN_KEY="LIVE_VERCEL_TOKEN"
      ORG="${LIVE_VERCEL_ORG_ID:-}"
      PROJECT="${LIVE_VERCEL_PROJECT_ID_CUSTOMER:-}"
      FIREBASE="${LIVE_FIREBASE_PROJECT:-borovo-ffc56}"
      LABEL="LIVE customer landing"
      ;;
    *)
      echo "Unknown target: $target"
      exit 1
      ;;
  esac

  if [[ -z "$ORG" || -z "$PROJECT" ]]; then
    echo "Missing ORG/PROJECT for target '$target' in deploy/targets.local.env"
    exit 1
  fi

  if [[ -z "$TOKEN" ]]; then
    echo "Missing $TOKEN_KEY in deploy/targets.local.env"
    echo "Log in to that Brovo Bites Vercel account into a repo-local auth dir, then:"
    if [[ "$target" == live* ]]; then
      echo "  bash scripts/save-vercel-token.sh live .tools/vercel-live-auth"
    else
      echo "  bash scripts/save-vercel-token.sh dev .tools/vercel-dev-auth"
    fi
    exit 1
  fi

  echo "============================================================"
  echo "  Deploy:   $LABEL"
  echo "  Target:   $target"
  echo "  Firebase: $FIREBASE   ← Vercel project env must match"
  echo "  Org:      $ORG"
  echo "  Project:  $PROJECT"
  echo "  Token:    $TOKEN_KEY (set)"
  echo "============================================================"

  if [[ "$target" == live* ]]; then
    if [[ "${CONFIRM_LIVE:-}" != "1" ]]; then
      echo ""
      echo "You are deploying to LIVE. Type LIVE and press Enter to continue:"
      read -r answer
      if [[ "$answer" != "LIVE" ]]; then
        echo "Aborted."
        exit 1
      fi
    fi
    if [[ "$FIREBASE" == *dev* ]]; then
      echo "Refusing: LIVE target but FIREBASE project name contains 'dev'."
      exit 1
    fi
  fi

  export VERCEL_ORG_ID="$ORG"
  export VERCEL_PROJECT_ID="$PROJECT"

  # Prefer local CLI if present (faster / no npx surprise); else npx.
  local VERCEL_BIN=""
  if [[ -x "$HOME/.local/vercel-cli/node_modules/.bin/vercel" ]]; then
    VERCEL_BIN="$HOME/.local/vercel-cli/node_modules/.bin/vercel"
  elif command -v vercel >/dev/null 2>&1; then
    VERCEL_BIN="$(command -v vercel)"
  fi

  local ARGS=(deploy --prod --yes --token "$TOKEN")
  # Never echo ARGS: the last element is the account token.
  echo "Running: vercel deploy --prod --yes --token ***"
  if [[ -n "$VERCEL_BIN" ]]; then
    "$VERCEL_BIN" "${ARGS[@]}"
  else
    npx --yes vercel@41 "${ARGS[@]}"
  fi

  echo ""
  echo "Done → $LABEL (Firebase expected: $FIREBASE)"
}

case "$TARGET" in
  dev-all)
    deploy_one dev
    deploy_one dev-customer
    echo ""
    echo "All DEV domains deployed (Firebase: ${DEV_FIREBASE_PROJECT:-brovodev})."
    ;;
  live-all)
    if [[ "${CONFIRM_LIVE:-}" != "1" ]]; then
      echo "You are deploying BOTH LIVE domains. Type LIVE and press Enter:"
      read -r answer
      if [[ "$answer" != "LIVE" ]]; then
        echo "Aborted."
        exit 1
      fi
      export CONFIRM_LIVE=1
    fi
    deploy_one live
    deploy_one live-customer
    echo ""
    echo "All LIVE domains deployed (Firebase: ${LIVE_FIREBASE_PROJECT:-borovo-ffc56})."
    ;;
  dev|dev-customer|live|live-customer)
    deploy_one "$TARGET"
    ;;
  *)
    echo "Unknown target: $TARGET (use dev|dev-customer|dev-all|live|live-customer|live-all)"
    exit 1
    ;;
esac

echo "Remember: git push does NOT deploy (auto-deploy is off)."

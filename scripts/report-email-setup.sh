#!/usr/bin/env bash
# One-time: switch on the owner-report email for the admin/staff website.
# Puts the shop Gmail + its app password (and a random CRON_SECRET for the
# daily email) into the ADMIN Vercel project's env — DEV, LIVE or both.
# The customer menu project is never touched.
#
#   pnpm report-email:setup
#
# Asks for the Gmail and its 16-letter app password (typed hidden, never
# printed or saved in this repo). Then deploy (pnpm ship:dev / ship:live) so
# the site picks them up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGETS_FILE="$ROOT/deploy/targets.local.env"
if [[ ! -f "$TARGETS_FILE" ]]; then
  echo "Missing $TARGETS_FILE (see DEPLOYMENT.md)."
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$TARGETS_FILE"
set +a

VERCEL_BIN=""
if [[ -x "$HOME/.local/vercel-cli/node_modules/.bin/vercel" ]]; then
  VERCEL_BIN="$HOME/.local/vercel-cli/node_modules/.bin/vercel"
elif command -v vercel >/dev/null 2>&1; then
  VERCEL_BIN="$(command -v vercel)"
else
  echo "Vercel CLI not found (the one pnpm deploy uses)."
  exit 1
fi

echo "Owner report email — setup"
echo "--------------------------"
read -r -p "Gmail that sends the report (e.g. yourshop.reports@gmail.com): " SMTP_USER
SMTP_USER="$(echo "$SMTP_USER" | tr -d '[:space:]')"
if [[ ! "$SMTP_USER" =~ ^[^@]+@[^@]+\.[a-z]{2,}$ ]]; then
  echo "That doesn't look like an email address."
  exit 1
fi
read -r -s -p "Its 16-letter app password (hidden while typing): " SMTP_PASS
echo ""
SMTP_PASS="$(echo "$SMTP_PASS" | tr -d '[:space:]')"
if [[ ${#SMTP_PASS} -ne 16 ]]; then
  echo "An app password has 16 letters (got ${#SMTP_PASS}). Make one at https://myaccount.google.com/apppasswords"
  exit 1
fi
read -r -p "Set it on which website? [dev / live / both]: " WHICH
case "$WHICH" in
  dev) WORLDS=(dev) ;;
  live) WORLDS=(live) ;;
  both) WORLDS=(dev live) ;;
  *) echo "Type dev, live or both."; exit 1 ;;
esac
if [[ " ${WORLDS[*]} " == *" live "* ]]; then
  read -r -p "This changes the LIVE website settings. Type LIVE to continue: " answer
  [[ "$answer" == "LIVE" ]] || { echo "Aborted."; exit 1; }
fi

CRON_SECRET="$(openssl rand -hex 24)"

set_env() {
  local name="$1" value="$2"
  local out
  # --force replaces it if it's already there.
  if ! out="$(printf '%s' "$value" | "$VERCEL_BIN" env add "$name" production --force --sensitive --yes "${AUTH[@]}" 2>&1)"; then
    echo "$out"
    echo "  ✗ $name — not saved"
    exit 1
  fi
  echo "  ✓ $name"
}

for world in "${WORLDS[@]}"; do
  WORLD_UP="$(echo "$world" | tr '[:lower:]' '[:upper:]')"
  if [[ "$world" == "dev" ]]; then
    export VERCEL_ORG_ID="${DEV_VERCEL_ORG_ID:-}" VERCEL_PROJECT_ID="${DEV_VERCEL_PROJECT_ID_ADMIN:-}"
    AUTH_DIR="$ROOT/.tools/vercel-dev-auth"
    TOKEN="${DEV_VERCEL_TOKEN:-}"
  else
    export VERCEL_ORG_ID="${LIVE_VERCEL_ORG_ID:-}" VERCEL_PROJECT_ID="${LIVE_VERCEL_PROJECT_ID_ADMIN:-}"
    AUTH_DIR="$ROOT/.tools/vercel-live-auth"
    TOKEN="${LIVE_VERCEL_TOKEN:-}"
  fi
  if [[ -z "$VERCEL_ORG_ID" || -z "$VERCEL_PROJECT_ID" ]]; then
    echo "Missing $WORLD_UP org / admin project id in deploy/targets.local.env"
    exit 1
  fi
  # The saved CLI login (refreshes itself) if there is one, else the token.
  # Never fall back to the machine-wide `vercel login` (may be another shop's team).
  if [[ -d "$AUTH_DIR" ]]; then AUTH=(-Q "$AUTH_DIR");
  elif [[ -n "$TOKEN" ]]; then AUTH=(--token "$TOKEN");
  else echo "No $WORLD_UP Vercel login: run bash scripts/save-vercel-token.sh $world .tools/vercel-$world-auth" >&2; exit 1; fi
  echo "$WORLD_UP admin website:"
  set_env SMTP_USER "$SMTP_USER"
  set_env SMTP_PASS "$SMTP_PASS"
  set_env CRON_SECRET "$CRON_SECRET"
done

echo ""
echo "Done. Now deploy so the website uses them:"
for world in "${WORLDS[@]}"; do echo "  pnpm ship:$world"; done
echo "Then: Admin → Landing Page → Owner report email → add the owner's Gmail → Save → \"Send last day's report now\"."

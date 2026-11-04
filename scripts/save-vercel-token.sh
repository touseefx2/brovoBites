#!/usr/bin/env bash
# Save the currently logged-in Vercel CLI token into deploy/targets.local.env
# so DEV and LIVE tokens stay separate (no logout dance on deploy).
#
# Usage (from repo root):
#   Log in to Bravo Bites' Vercel account(s) into repo-local auth dirs, then save:
#     vercel login --future -Q .tools/vercel-dev-auth    # Bravo Bites DEV Vercel account
#     vercel login --future -Q .tools/vercel-live-auth   # Bravo Bites LIVE Vercel account
#     bash scripts/save-vercel-token.sh dev  .tools/vercel-dev-auth
#     bash scripts/save-vercel-token.sh live .tools/vercel-live-auth
#
#   The auth dir is REQUIRED. This script never reads the machine-wide
#   `vercel login`, because on a shared Mac that login can belong to another
#   shop's Vercel team.
#
# Never prints the token. Never commit deploy/targets.local.env.
# Warning: `vercel logout` can invalidate the CLI session token you just saved.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLOT="${1:-}"
CFG_REL="${2:-}"
TARGETS="$ROOT/deploy/targets.local.env"

if [[ "$SLOT" != "dev" && "$SLOT" != "live" || -z "$CFG_REL" ]]; then
  echo "Usage: $0 <dev|live> <auth-config-dir>   e.g. $0 $SLOT .tools/vercel-${SLOT:-dev}-auth" >&2
  echo "(The global vercel login is never used — it may belong to another shop.)" >&2
  exit 1
fi

if [[ ! -f "$TARGETS" ]]; then
  cp "$ROOT/deploy/targets.example.env" "$TARGETS"
  echo "Created $TARGETS from example."
fi

if [[ "$CFG_REL" = /* ]]; then
  AUTH_JSON="$CFG_REL/auth.json"
else
  AUTH_JSON="$ROOT/$CFG_REL/auth.json"
fi

if [[ ! -f "$AUTH_JSON" ]]; then
  echo "No Vercel auth at: $AUTH_JSON"
  echo "Run: vercel login --future -Q $CFG_REL   (Bravo Bites $SLOT Vercel account)"
  exit 1
fi

TOKEN="$(
  python3 - "$AUTH_JSON" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
token = (data.get("token") or "").strip()
if not token:
    sys.exit(2)
print(token)
PY
)" || {
  echo "Vercel auth.json has no token. Run: vercel login"
  exit 1
}

KEY="DEV_VERCEL_TOKEN"
[[ "$SLOT" == "live" ]] && KEY="LIVE_VERCEL_TOKEN"

python3 - "$TARGETS" "$KEY" "$TOKEN" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
token = sys.argv[3]
text = path.read_text()
pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
line = f"{key}={token}"
if pattern.search(text):
    text = pattern.sub(line, text)
else:
    text = text.rstrip() + "\n" + line + "\n"
path.write_text(text)
print(f"Saved {key} ({len(token)} chars) → {path}")
print("File is gitignored. Do not commit it.")
PY

WHOAMI="$(npx --yes vercel@41 whoami --token "$TOKEN" 2>/dev/null || true)"
if [[ -n "$WHOAMI" ]]; then
  echo "Token account: $WHOAMI"
fi
echo "Next: pnpm deploy:${SLOT}:all"

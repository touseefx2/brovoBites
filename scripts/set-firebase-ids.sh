#!/usr/bin/env bash
# Point this repo at YOUR Firebase projects in one go.
#
# The code ships with placeholder project ids:
#   bravobites-dev   (DEV  / test data)
#   bravobites-live  (LIVE / real shop)
# They appear in .firebaserc, the project allowlist
# (apps/web/src/lib/firebase/allowed-projects.ts), deploy scripts, safety
# guards in apps/web/scripts and the docs. If Firebase gave your projects
# other ids, run ONCE (right after creating the projects):
#
#   bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>
#
# Rules: DEV id must end in "-dev" (DEV emails are tagged by that suffix and the
# dev-only scripts check it); LIVE id must not contain "dev" (create-owner
# refuses LIVE ids that look like dev).
set -euo pipefail
cd "$(dirname "$0")/.."

DEV_ID="${1:-}"
LIVE_ID="${2:-}"
die() { echo "$*" >&2; exit 1; }

[[ -n "$DEV_ID" && -n "$LIVE_ID" ]] || die "Usage: bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>"
# Firebase project ids: 6-30 chars, lowercase letters / digits / hyphens, start with a letter.
re='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
[[ "$DEV_ID" =~ $re ]] || die "Not a valid Firebase project id: $DEV_ID"
[[ "$LIVE_ID" =~ $re ]] || die "Not a valid Firebase project id: $LIVE_ID"
[[ "$DEV_ID" != "$LIVE_ID" ]] || die "DEV and LIVE must be two different Firebase projects."
[[ "$DEV_ID" == *-dev ]] || die "DEV project id must end in -dev (got: $DEV_ID)."
[[ "$LIVE_ID" != *dev* ]] || die "LIVE project id must not contain 'dev' (got: $LIVE_ID)."
# This codebase was cloned from another shop's POS — never point it back there.
case "$DEV_ID $LIVE_ID" in
  *sajji*|*darbar*) die "Refusing: those look like another shop's Firebase projects. Use Bravo Bites' own ids." ;;
esac

FOUND=0
# A placeholder is "bravobites-dev"/"bravobites-live" NOT followed by a letter, digit or
# "-", so real ids such as "bravobites-live-8a1b2" are never touched on a re-run.
while IFS= read -r -d '' f; do
  # One pass, so a new DEV id that happens to contain "bravobites-live" is not rewritten again.
  if DEV_ID="$DEV_ID" LIVE_ID="$LIVE_ID" perl -i -pe '
      BEGIN { $n = 0 }
      $n += s/(?<![\w.])bravobites-(dev|live)(?![\w-])/$1 eq "dev" ? $ENV{DEV_ID} : $ENV{LIVE_ID}/ge;
      END { exit($n ? 0 : 3) }' "$f"; then
    FOUND=1
    echo "updated $f"
  fi
done < <(grep -rlE --null 'bravobites-(dev|live)' . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=.turbo \
  --exclude='set-firebase-ids.sh' || true)

if [[ "$FOUND" == 0 ]]; then
  echo "No bravobites-dev / bravobites-live placeholders left — ids were already set."
  echo "To change them again, edit .firebaserc and apps/web/src/lib/firebase/allowed-projects.ts first."
  exit 0
fi

echo
echo "Done. DEV = $DEV_ID, LIVE = $LIVE_ID"
cat .firebaserc
echo "Review with: git diff --stat   then commit."

#!/usr/bin/env bash
# Deploys the no-AI lab build (#92) to its own Hosting site, https://paper-trail-lab.web.app, in the
# same Firebase project (paper-trail-bw). It never deploys the live site (hosting:live) and, unless
# asked, nothing the live app shares.
#   bash tools/deploy-lab.sh            the lab site only (hosting:lab)
#   bash tools/deploy-lab.sh --oauth    also the oauthCallback function, which must know lab_ nonces
#                                       before sign-in on the lab site works (once, see below)
#   bash tools/deploy-lab.sh --rules    also firebase/firestore.rules
# Shared with the live app, so both flags are opt-in and ask first:
#   --oauth  replaces the one oauthCallback function the live web app and the iPhone app also use.
#            The change is backward compatible (functions/test/oauth.test.mjs), but it is this
#            branch's copy of functions/oauth.js. Prefer landing that change on main and deploying it
#            from there; use this only when main's oauth.js matches this branch's.
#   --rules  replaces the project's Firestore rules. users/{uid}/lab/** is already covered by the
#            rules on main, so this is only needed if this branch changed them on purpose.
# Before anything deploys: the function unit tests, the contract check and the rules check pass.
# Needs the Firebase CLI, logged in (firebase login), and Node 20 or later.
set -euo pipefail
cd "${DEPLOY_ROOT:-$(dirname "$0")/..}"
PROJECT=paper-trail-bw
LAB_URL=https://paper-trail-lab.web.app
OAUTH=no RULES=no
for arg in "$@"; do
  case "$arg" in
    --oauth) OAUTH=yes ;;
    --rules) RULES=yes ;;
    *) echo "Unknown option $arg. Use --oauth, --rules or nothing."; exit 2 ;;
  esac
done

# The lab target must map to the lab site, and only to it, or this would publish somewhere else.
# .firebaserc has no .json extension, so require() would parse it as JavaScript: read it as JSON.
SITES=$(node -e 'const t=JSON.parse(require("fs").readFileSync(".firebaserc","utf8")).targets["paper-trail-bw"].hosting; console.log(JSON.stringify(t.lab||[]))')
if [ "$SITES" != '["paper-trail-lab"]' ]; then
  echo "The lab hosting target maps to $SITES, not [\"paper-trail-lab\"]. Fix .firebaserc first."
  exit 2
fi

confirm() {
  [ "${LAB_DEPLOY_YES:-}" = 1 ] && return 0
  read -r -p "$1 Type yes to go on: " a
  [ "$a" = yes ]
}

[ -d functions/node_modules ] || npm ci --prefix functions
node --test functions/test/*.test.mjs
node tools/contract_check.mjs

if [ "$RULES" = yes ]; then
  node tools/rules-check.mjs
  confirm "This replaces the Firestore rules the live app uses." || { echo "Stopped."; exit 1; }
  firebase deploy --only firestore:rules --project "$PROJECT" --non-interactive
fi

if [ "$OAUTH" = yes ]; then
  confirm "This replaces oauthCallback, which the live web app and the iPhone app also use." || { echo "Stopped."; exit 1; }
  export FUNCTIONS_DISCOVERY_TIMEOUT="${FUNCTIONS_DISCOVERY_TIMEOUT:-120}"
  firebase deploy --only functions:oauthCallback --project "$PROJECT" --non-interactive
fi

firebase deploy --only hosting:lab --project "$PROJECT" --non-interactive
echo "Lab is up at $LAB_URL"

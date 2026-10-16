#!/usr/bin/env bash
# Deploys Paper Trail to Firebase project paper-trail-bw. Same shape as the Hair Growth Tracker's.
#   bash tools/deploy.sh          everything: Firestore rules, the classify function, and the site
#   bash tools/deploy.sh --site   Firestore rules and the site only (works on the free Spark plan)
#   bash tools/deploy.sh --warm-only   only the functions warm-up below, then exit
# What goes where:
#   firestore  firebase/firestore.rules and firebase/firestore.indexes.json
#   functions  functions/: the `classify` callable. Needs the Blaze plan and the ANTHROPIC_API_KEY
#              secret (set once: firebase functions:secrets:set ANTHROPIC_API_KEY --project paper-trail-bw)
#   hosting    public/: the app, at https://paper-trail-bw.web.app (the "live" hosting target; the
#              no-AI lab build has its own site and its own script, tools/deploy-lab.sh, #92)
# Only from main: the experiment branches (exp/*, feat/lab-*) must never reach the live site.
# Before anything deploys: the function unit tests pass and the rules give the verdicts the page
# needs in the real rules engine (tools/rules-check.mjs, a dry run through the Rules test API).
# The project lives in iCloud Drive, where a cold functions/node_modules can take over a minute to
# load and the CLI gives function discovery 10 s; the warm-up pays that first, and
# FUNCTIONS_DISCOVERY_TIMEOUT raises the CLI's own limit as a backstop.
# Needs the Firebase CLI, logged in (firebase login), and Node 20 or later.
set -euo pipefail
cd "${DEPLOY_ROOT:-$(dirname "$0")/..}"
PROJECT=paper-trail-bw
MODE=all
WARM_LIMIT_SECONDS=300
export FUNCTIONS_DISCOVERY_TIMEOUT="${FUNCTIONS_DISCOVERY_TIMEOUT:-120}"

warm_functions() {
  [ -d functions/node_modules ] || { echo "functions/node_modules is missing; run: npm ci --prefix functions"; return 1; }
  WARM_MS=$((WARM_LIMIT_SECONDS * 1000)) node -e '
    const { spawnSync } = require("node:child_process");
    const start = Date.now();
    const r = spawnSync(process.execPath, ["-e", "process.env.GCLOUD_PROJECT=\"paper-trail-bw\"; require(\"./functions/index.js\")"],
      { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit"], timeout: +process.env.WARM_MS });
    const sec = ((Date.now() - start) / 1000).toFixed(1);
    if (r.error || r.status !== 0) { console.error("Functions warm-up failed after " + sec + " s"); process.exit(1); }
    console.log("Functions warm-up: loaded functions/index.js in " + sec + " s");
  '
}

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "${1:-}" != "--warm-only" ] && [ "$BRANCH" != "main" ]; then
  echo "deploy.sh deploys the live app and runs only on main (this is $BRANCH)."
  echo "For the lab site use: bash tools/deploy-lab.sh"
  exit 2
fi

case "${1:-}" in
  --warm-only) warm_functions; exit $? ;;
  --site) MODE=site ;;
  "") ;;
  *) echo "Unknown option $1. Use --site, --warm-only or nothing."; exit 2 ;;
esac

[ -d functions/node_modules ] || npm ci --prefix functions
node --test functions/test/*.test.mjs
node tools/rules-check.mjs
firebase deploy --only firestore --project "$PROJECT" --non-interactive

if [ "$MODE" = all ]; then
  if ! firebase functions:secrets:get ANTHROPIC_API_KEY --project "$PROJECT" >/dev/null 2>&1; then
    echo
    echo "The ANTHROPIC_API_KEY secret isn't set (or the project isn't on the Blaze plan yet)."
    echo "Upgrade to Blaze in the Firebase console, then run:"
    echo "  firebase functions:secrets:set ANTHROPIC_API_KEY --project $PROJECT"
    echo "and run this script again. Deploying the site only for now."
  else
    warm_functions
    firebase deploy --only functions --project "$PROJECT" --non-interactive --force
  fi
fi

firebase deploy --only hosting:live --project "$PROJECT" --non-interactive
echo "Live at https://$PROJECT.web.app"

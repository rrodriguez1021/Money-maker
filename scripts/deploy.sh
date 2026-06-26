#!/usr/bin/env bash
# DynaQR — one-command deploy to Fly.io.
# Prereqs (yours, one-time): a Fly.io account + `flyctl` installed and logged in.
#   https://fly.io/docs/flyctl/install/   then  `fly auth login`
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }

command -v flyctl >/dev/null 2>&1 || { echo "flyctl not found. Install: https://fly.io/docs/flyctl/install/"; exit 1; }

say "1/5  Running tests"
npm test

say "2/5  Provisioning the Fly app (first run only)"
if [ ! -f fly.toml ]; then
  cp deploy/fly.toml fly.toml
  # Pick a unique app name; Fly will append if taken.
  flyctl launch --copy-config --no-deploy --yes || true
fi

say "3/5  Setting the public URL"
APP="$(flyctl status --json 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).Name' 2>/dev/null || echo dynaqr)"
PUBLIC_URL="https://${APP}.fly.dev"
flyctl secrets set "PUBLIC_URL=${PUBLIC_URL}" >/dev/null
echo "PUBLIC_URL=${PUBLIC_URL}"

say "4/5  Stripe (optional — press enter to skip and stay in demo mode)"
read -r -p "STRIPE_SECRET_KEY: " SK || true
if [ -n "${SK:-}" ]; then
  read -r -p "STRIPE_PRICE_ID (Pro): " PR || true
  read -r -p "STRIPE_WEBHOOK_SECRET: " WH || true
  read -r -p "STRIPE_PRICE_ID_BUSINESS (optional): " BIZ || true
  flyctl secrets set "STRIPE_SECRET_KEY=${SK}" "STRIPE_PRICE_ID=${PR}" "STRIPE_WEBHOOK_SECRET=${WH}" \
    ${BIZ:+STRIPE_PRICE_ID_BUSINESS=$BIZ} >/dev/null
  echo "Stripe secrets set. Add the webhook endpoint in Stripe: ${PUBLIC_URL}/webhook/stripe"
fi

say "5/5  Deploying"
flyctl deploy
echo
echo "Deployed → ${PUBLIC_URL}"
echo "Health:   ${PUBLIC_URL}/healthz"
echo "Open the app and create your first QR code: ${PUBLIC_URL}/app"

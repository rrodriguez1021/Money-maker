# Qrysm — Project Handoff (start here)

A complete, tested, deploy-ready dynamic-QR SaaS. This page is the single source of
truth for what exists and what's left. The build is done; the remaining steps are the
human ones only an owner with a bank account, identity, and customers can take.

## What's built (and verified)

| Area | Status |
|---|---|
| Dynamic QR codes + editable destinations | ✅ |
| Scan tracking (time, referrer, device) | ✅ |
| Analytics: totals, daily, device/OS/browser/referrer breakdowns | ✅ |
| Hosted landing pages (no website needed), fully editable | ✅ |
| Branded QR colors + center logo (Business) | ✅ |
| Bulk generation + CSV export (formula-injection-safe) | ✅ |
| 3-tier pricing: Free / Pro $9 / Business $29, monthly + annual | ✅ |
| Stripe subscription billing + webhooks | ✅ |
| Developer REST API + revocable, hashed API keys | ✅ |
| Referral growth loop ("powered by" on every hosted page) | ✅ |
| Legal: Terms, Privacy, consent, GDPR erasure | ✅ |
| Premium UI (verified via screenshots) | ✅ |
| Deploy: Dockerfile, Fly/Render configs, one-command `deploy.sh` | ✅ |
| Preflight readiness check, launch runbook, go-to-market kit | ✅ |
| Automated tests | ✅ 34 passing |

## Run / test / check
```bash
npm install && npm start     # http://localhost:3000
npm test                     # 34 tests
npm run preflight            # production-readiness check
```

## What's left — the human steps (≈30 min + outreach)
These are the *only* things between this repo and real money. An AI can't do them for
you; they require your identity, your bank, your domain, and real customers.

1. **Deploy** — `./scripts/deploy.sh` (Fly.io) or `deploy/render.yaml`. → live URL.
2. **Stripe** — create a $9 (and optional $29) recurring Price, add the
   `/webhook/stripe` endpoint, set the secrets. `npm run preflight` must show no ✗.
3. **Legal** — fill `[Company]`/`[Jurisdiction]`/`[contact email]` in the legal pages.
4. **First customers** — work **[GO-TO-MARKET.md](GO-TO-MARKET.md)**: pick one niche,
   message 20 prospects with the templates, offer a 14-day trial. First yes = first $9.

Full step-by-step: **[LAUNCH.md](LAUNCH.md)**.

## Map of the repo
- `src/` — server, db, billing, page renderer, QR+logo, analytics, preflight
- `public/` — landing, dashboard, legal pages, styles
- `test/` — 34 tests across api/page/insights/qrlogo/preflight
- `README.md` · `API.md` · `LEGAL.md` · `LAUNCH.md` · `GO-TO-MARKET.md`

The honest bottom line: the asset is finished and maximized. Revenue now depends on
launching it and doing outreach — that's step 4, and it's where the money is.

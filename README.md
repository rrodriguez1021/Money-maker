# ◧ DynaQR — Dynamic QR Codes & Link Tracking (a launch-ready micro-SaaS)

Print a QR code **once**, change where it points **forever**, and track every scan.
Static QR codes die the moment they're printed — DynaQR codes are *dynamic*: the
short link behind the QR is editable any time, so a menu, flyer, business card or
product label never goes stale. Scan analytics show what's actually working.

This is a complete, self-contained product you can deploy and charge money for.

---

## Why this makes money

Dynamic QR codes are a **proven recurring-revenue niche** — businesses happily pay
monthly because reprinting physical materials costs far more than a subscription.

The monetization is built in:

| | Free | **Pro ($9/mo)** | **Business ($29/mo)** |
|---|---|---|---|
| Dynamic QR codes | 3 | **Unlimited** | **Unlimited** |
| Editable destinations | ✅ | ✅ | ✅ |
| PNG / SVG export | ✅ | ✅ | ✅ |
| Scan analytics | — | ✅ | ✅ |
| Branded QR colors | — | — | ✅ |
| Center logo in QR | — | — | ✅ |

The free tier drives signups; the code limit + analytics gate drive Pro upgrades; branded
colors (the #1 upsell in this market) drive Business upgrades and lift revenue per customer.
**Annual billing** ($90/yr Pro, $290/yr Business — 2 months free) is supported too, which
pulls a year of cash forward and reduces churn; add the annual Price IDs to enable it.
Billing runs through **Stripe Checkout** (subscriptions) with webhook-driven plan
sync. Change the price, limits, and tiers in `src/db.js` (`PLAN_LIMITS`) — it's your product.

---

## Run it (zero config)

```bash
npm install
npm start
# → http://localhost:3000   (billing disabled = demo mode, everything else works)
```

Open the landing page at `/`, the dashboard at `/app`. No database server, no API
keys, no accounts to create — it uses Node's built-in SQLite and a single data file.

Run the tests:

```bash
npm test
```

## Turn on real billing

1. In the [Stripe dashboard](https://dashboard.stripe.com), create a Product with a
   **recurring Price** (e.g. $9/month).
2. Copy `.env.example` → `.env` and set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`.
3. Add a webhook endpoint → `https://yourdomain.com/webhook/stripe`, subscribe to
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, and paste the signing secret into
   `STRIPE_WEBHOOK_SECRET`.
4. Restart. The **Upgrade to Pro** button now opens Stripe Checkout; successful
   payments flip the account to Pro automatically.

Test with Stripe's `4242 4242 4242 4242` test card before going live.

## Protect yourself legally (read before launch)

Ships with a real legal layer: **Terms of Service** (`/terms.html`), **Privacy Policy**
(`/privacy.html`) covering scan-tracking, a cookie/tracking consent banner, and a
GDPR/CCPA **right-to-erasure** endpoint (`DELETE /api/account`). See **[LEGAL.md](LEGAL.md)**
for what to fill in and why each clause matters. These are solid templates — **not legal
advice**; have an attorney review them before you take paying customers.

## Get your first paying customer

The product is done — revenue is now a sales problem. **[GO-TO-MARKET.md](GO-TO-MARKET.md)**
is a complete kit: who pays for dynamic QR codes, cold-email/DM templates, a pricing
playbook, and a 7-day launch checklist to the first dollar.

## Deploy

**Fastest path:** follow the **[LAUNCH.md](LAUNCH.md)** runbook (deploy → Stripe → first
customer). One command: `./scripts/deploy.sh` (Fly.io). Run `npm run preflight` first to
catch config gaps (e.g. a missing Stripe webhook secret that would stop upgrades working).

One-click configs are in [`deploy/`](deploy/): `fly.toml` (Fly.io) and `render.yaml`
(Render Blueprint). Or use **Docker** directly (works on Fly.io, Render, Railway, a VPS, etc.):

```bash
docker build -t dynaqr .
docker run -p 3000:3000 -v dynaqr-data:/data \
  -e PUBLIC_URL=https://qr.yourdomain.com \
  -e STRIPE_SECRET_KEY=sk_live_... -e STRIPE_PRICE_ID=price_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... dynaqr
```

Set `PUBLIC_URL` to your real domain so QR codes encode the correct address.
Mount a volume for `/data` so links and scans persist across restarts.

## How it works

```
src/
  server.js   Express app: auth, links CRUD, QR rendering, redirect+scan logging, billing
  db.js       Node built-in SQLite — accounts, links, scans; plan limits
  billing.js  Stripe checkout + webhook verification (no-ops without keys)
public/
  index.html  marketing landing page
  app.html / app.js   the dashboard (token auth, create/edit/track codes)
  style.css   shared styling
test/
  api.test.js end-to-end API tests (no external services)
```

- A QR encodes a **stable** short URL: `https://yourdomain/r/<code>`.
- Hitting `/r/<code>` logs a scan (timestamp, referrer, user-agent) and 302-redirects
  to the current `target` — which the owner can change at any time.
- Accounts use a bearer token issued at signup (passwordless MVP). For production,
  swap the token issuance in `POST /api/signup` for emailed magic links.

## Developer API

DynaQR has a REST API so customers can manage codes from their own systems — a common
reason teams pay for a higher tier. Auth uses a Bearer **account token** or a hashed,
revocable **API key** (`dqr_live_…`, created in the dashboard). Full reference:
**[API.md](API.md)**.

## API quick reference

```
POST   /api/signup            {email} → {token}
GET    /api/me                account + plan + usage
GET    /api/links             list your codes (+scan counts)
POST   /api/links             {target,title,colorDark?,colorBg?} → new dynamic QR
                              or {page:{headline,subtitle,buttons[]}} → hosted-page QR
POST   /api/links/bulk        {items:[{target,title?}]} → create many at once
PUT    /api/links/:id         {target?,title?,active?,colorDark?,colorBg?} → repoint / rename
DELETE /api/links/:id
GET    /api/links/export.csv  all your links + scan counts as CSV
GET    /api/links/:id/qr.png  | qr.svg     QR image (branded colors on Business)
GET    /api/links/:id/stats   scan analytics (Pro)
GET    /api/links/:id/stats.csv  scan rows as CSV (Pro)
POST   /api/billing/checkout  → Stripe Checkout URL (Pro upgrade)
GET    /r/:id                 public redirect (what a scan hits)
```

## License

MIT — it's yours to run, modify, and sell.

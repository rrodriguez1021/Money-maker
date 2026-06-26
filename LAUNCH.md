# 🚀 DynaQR Launch Runbook — zero to first paying customer

The product is built, tested, and revenue-ready. This is the exact ordered path to
real money. Realistic time: **~30 minutes of setup**, then outreach. Everything here
is a step only *you* can do (it needs your accounts, identity, and bank) — the code
is done.

---

## Step 0 — Run it locally (2 min, optional sanity check)
```bash
npm install
npm start        # → http://localhost:3000
npm run preflight   # shows what's configured vs missing
```

## Step 1 — Deploy it live (~10 min)
You need a [Fly.io](https://fly.io) account + `flyctl` (or use `deploy/render.yaml` on Render).
```bash
./scripts/deploy.sh
```
The script runs tests, provisions the app, sets `PUBLIC_URL`, optionally takes your
Stripe secrets, and deploys. When it finishes you have a live `https://…fly.dev` URL.

> Point a real domain at it if you have one (nicer for QR codes and trust). Set
> `PUBLIC_URL` to that domain so codes encode the right address.

## Step 2 — Turn on payments (~15 min)
1. In the [Stripe Dashboard](https://dashboard.stripe.com): create a **Product** with a
   recurring **Price** — Pro at **$9/mo**. (Optional: Business **$29/mo**, annual prices.)
2. Add a **webhook** → endpoint `https://YOUR_URL/webhook/stripe`, events:
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy its **signing secret**.
3. Set the secrets (the deploy script can do this, or):
   ```bash
   fly secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_PRICE_ID=price_… STRIPE_WEBHOOK_SECRET=whsec_…
   ```
4. Run `npm run preflight` (or check `/healthz`) — **it must show no blocking ✗**.
   The #1 mistake is a missing webhook secret: payments succeed but accounts never
   upgrade. Preflight catches exactly that.
5. Test with Stripe card `4242 4242 4242 4242` before going live.

## Step 3 — Cover yourself legally (~5 min)
Fill in `[Company]`, `[Jurisdiction]`, `[contact email]` in `public/terms.html` and
`public/privacy.html`. See **[LEGAL.md](LEGAL.md)**. Have a lawyer skim it before scale.

## Step 4 — Get your first customer (the actual money)
Open **[GO-TO-MARKET.md](GO-TO-MARKET.md)** — target niches, cold-email/DM templates,
and a 7-day plan. The short version:
- Pick one niche you have any connection to (restaurants, real-estate agents, Etsy sellers).
- Message 20 of them today using the templates. Offer a 14-day free trial.
- First **yes** → first **$9/mo**. 30 customers ≈ **$270 MRR**.

---

## The honest part
An AI can build, test, deploy-script, and document all of this — but it cannot verify a
Stripe account against your identity, can't put your domain on the line, and can't be
the human who decides to pay. Those three steps are yours. They're small, and everything
leading up to them is done. Step 4 is where the money is.

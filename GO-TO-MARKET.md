# Qrysm — Go-To-Market Kit (your path to the first dollar)

The product is built and tested. **Revenue is now a sales problem, not a code problem.**
This kit is the exact motion to get your first paying customer. Honest expectation:
first dollar is realistic within days if you actually send the outreach below.

---

## The fastest path to $1 (do this in order)

1. **Deploy** (~10 min). `cd deploy && fly launch --copy-config` or use Render's blueprint.
   You now have a live `https://` URL.
2. **Turn on Stripe** (~15 min). Create a $9/mo recurring Price, set the three
   `STRIPE_*` secrets, add the `/webhook/stripe` endpoint. Test with card `4242…`.
3. **Pick ONE niche** from the list below and message 20 of them today.
4. **First yes → first $9/mo.** Repeat. 30 paying customers = ~$270 MRR.

You don't need a logo, a company, or a perfect site to get the first customer.
You need 20 conversations.

---

## Who pays for dynamic QR codes (highest intent first)

| Niche | Why they pay | Where to find them |
|---|---|---|
| **Restaurants / cafés / bars** | Menus change; reprinting is costly. Repoint one QR instead. | Google Maps, walk in, local FB groups |
| **Real-estate agents** | One QR on a yard sign → repoint per listing; track interest. | Zillow, local agent directories |
| **Event organizers / venues** | Schedules change; need scan counts for sponsors. | Eventbrite, Meetup |
| **Etsy / Amazon sellers** | QR on packaging → reviews/upsell page they can change. | Etsy shops, r/ecommerce |
| **Gyms / salons / clinics** | Promo posters; track which location/flyer converts. | Instagram local, Google Maps |
| **Churches / nonprofits** | Bulletins + donation links that change weekly. | Local listings |

Pick the niche you have *any* connection to. Warm beats cold.

---

## Cold email template (restaurants)

> **Subject:** quick idea for your menu QR
>
> Hi {name},
>
> I noticed {restaurant} uses a QR menu. When your menu changes, do you have to
> reprint the code? With Qrysm you print the QR once and update where it points
> from your phone — plus you see how many people scan it each day.
>
> It's $9/mo, set up in 5 minutes, first 14 days free. Want me to set yours up?
>
> {your name} · {your-url}

## Instagram / DM template (sellers, gyms, agents)

> Hey {name}! Love what you're doing with {brand}. Quick one — if you use QR codes
> on {packaging / signs / flyers}, Qrysm lets you change the destination after
> they're printed and tracks scans. $9/mo, free trial. Want a link?

## The 30-second pitch (in person)

> "You know how a printed QR code is stuck pointing at one page forever? Mine lets
> you change where it goes anytime without reprinting, and shows you how many people
> scanned it. Nine bucks a month. Want me to set one up for your {menu/sign}?"

---

## Pricing playbook

- Launch at **$9/mo** (anchored on the landing page). Easy yes.
- Offer **annual at $90** (2 months free) to pull cash forward.
- Add a **$29/mo "Business"** tier later: 5 team seats, custom-branded codes,
  CSV export. (Branded codes = the #1 paid upsell in this market.)
- Tiers/limits live in `src/db.js` → `PLAN_LIMITS`. Add a new Stripe Price per tier.

## Conversion levers already in the product

- Free tier (3 codes) → friction-free signup, no card.
- Code limit + analytics gate → the natural upgrade trigger.
- Scan analytics → the retention hook (they check it, they stay subscribed).

---

## 7-day launch checklist

- [ ] Day 1: Deploy + Stripe live. Buy a cheap domain ($1–12) and point it.
- [ ] Day 2: Post the product on r/SideProject, r/smallbusiness, Indie Hackers.
- [ ] Day 3: Email/DM 20 restaurants in your town.
- [ ] Day 4: DM 20 Etsy/Amazon sellers.
- [ ] Day 5: Walk into 5 local businesses, offer to set it up free for 14 days.
- [ ] Day 6: Follow up with everyone who didn't reply.
- [ ] Day 7: Tally signups → convert trials to paid. **First revenue.**

The honest truth: the code can't send these messages or sign a Stripe agreement for
you — those require a real human and a real bank account. Everything up to that line
is done. The next move is yours, and it's small.

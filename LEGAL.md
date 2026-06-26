# Legal & Compliance — protecting yourself before launch

This project ships with a real legal layer so you're not exposed when you take on
users. **Read this before going live.**

> ⚠️ **Not legal advice.** These documents are solid starting templates generated for
> the DynaQR software as built. They are *not* a substitute for a lawyer. Laws differ by
> country and state. Have a qualified attorney in your jurisdiction review them before you
> accept a paying customer — it's cheap insurance compared to a dispute.

## What's included

| File | Purpose |
|---|---|
| `public/terms.html` | Terms of Service — acceptable use, billing, **liability cap & disclaimers**, indemnification, governing law |
| `public/privacy.html` | Privacy Policy — what data is collected, **scan tracking disclosure**, GDPR legal bases, data-subject rights |
| `public/consent.js` | Cookie/tracking notice banner shown to visitors |
| `DELETE /api/account` | GDPR/CCPA **right-to-erasure** endpoint (wired to "Delete my account & data" in the dashboard) |

The Terms and Privacy pages are linked from the landing page, dashboard, and each other.

## Fill these in (search & replace across `public/terms.html` and `public/privacy.html`)

- `[Company]` → your legal entity or your name
- `[Jurisdiction]` → your country/state (e.g. "the State of Texas, USA")
- `[contact email]` → a real address you monitor
- Confirm the "Last updated" date reflects when you actually publish.

## Why these specifically reduce your risk

- **Liability limitation + "AS IS" disclaimer** (Terms §8–9): caps your financial exposure
  and disclaims warranties — the single most important clause for a solo operator.
- **Acceptable-use policy** (Terms §4): lets you lawfully kill links used for phishing/spam/
  illegal content, which is the main way a redirect service gets abused and dragged into others' problems.
- **Indemnification** (Terms §10): shifts responsibility for a customer's own content/destinations back to them.
- **Scan-tracking disclosure** (Privacy §3) + **consent banner**: you log referrer/user-agent on
  every scan; disclosing it is required under GDPR/ePrivacy and CCPA. Note the build intentionally
  does **not** store scanner IPs or use ad trackers, which lowers your compliance burden.
- **Right to erasure** (`DELETE /api/account`): a concrete GDPR/CCPA obligation, implemented and tested.

## Before you flip on real payments

1. **Stripe** requires its own merchant terms — your customers also agree to Stripe's terms at checkout.
2. **Sales tax / VAT** on digital subscriptions varies by region. Consider a tax tool
   (Stripe Tax) or threshold-based registration. This template does not handle tax for you.
3. **Refund policy:** Terms §5 says non-refundable except where law requires; some jurisdictions
   (e.g. EU consumer law) grant withdrawal rights. Confirm what applies to you.
4. **Business entity:** an LLC (or local equivalent) is the strongest lawsuit protection —
   it separates personal assets from the business. Worth doing before meaningful revenue.

## What I deliberately did *not* do

- I did not invent a company name, address, or claim you're incorporated — those must be true.
- I did not assert GDPR/CCPA "compliance" as a finished state; compliance depends on how *you* operate.
- I am not a lawyer and this is not legal advice. The attorney review step is real, not boilerplate.

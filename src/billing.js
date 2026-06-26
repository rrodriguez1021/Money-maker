// Stripe billing — gated behind env vars so the app runs fully without a Stripe
// account (great for local demos). When keys are present, real subscription
// checkout + webhooks take over.
import Stripe from 'stripe';

const KEY = process.env.STRIPE_SECRET_KEY;
const PRICE_ID = process.env.STRIPE_PRICE_ID;                   // recurring Price for Pro
const PRICE_ID_BUSINESS = process.env.STRIPE_PRICE_ID_BUSINESS; // recurring Price for Business (optional)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export const billingEnabled = Boolean(KEY && PRICE_ID);
const stripe = billingEnabled ? new Stripe(KEY) : null;

// Map a plan name to its configured Stripe Price. Business falls back to Pro's
// price if a dedicated Business price isn't configured.
const PRICE_FOR = () => ({
  pro: PRICE_ID,
  business: PRICE_ID_BUSINESS || PRICE_ID,
});

export const businessBillingEnabled = Boolean(KEY && PRICE_ID_BUSINESS);

export async function createCheckoutSession(account, baseUrl, plan = 'pro') {
  if (!billingEnabled) throw new Error('billing_disabled');
  const price = PRICE_FOR()[plan];
  if (!price) throw new Error('unknown_plan');
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    customer_email: account.email,
    client_reference_id: account.id,
    metadata: { plan },
    success_url: `${baseUrl}/app?upgraded=1`,
    cancel_url: `${baseUrl}/app?canceled=1`,
    allow_promotion_codes: true,
  });
}

// Verify and parse a Stripe webhook. Returns the event or null if invalid.
export function constructEvent(rawBody, signature) {
  if (!billingEnabled || !WEBHOOK_SECRET) return null;
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch {
    return null;
  }
}

export async function customerIdFromEvent(event) {
  const obj = event.data.object;
  return obj.customer || null;
}

// Given a Stripe subscription object, work out which app plan it represents from
// its line-item price, so an "updated" event doesn't downgrade Business to Pro.
export function planForSubscription(sub) {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  if (PRICE_ID_BUSINESS && priceId === PRICE_ID_BUSINESS) return 'business';
  return 'pro';
}

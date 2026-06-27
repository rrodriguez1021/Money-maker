# Qrysm API

A small REST API over JSON. Use it to create and manage dynamic QR codes and hosted
pages from your own systems — point-of-sale, a CMS, batch jobs, etc.

Base URL: your deployment, e.g. `https://qr.example.com`.

## Authentication

Every request needs a Bearer token. Two kinds work:

- **Account token** — issued at signup (`POST /api/signup`), used by the dashboard.
- **API key** — `dqr_live_…`, created in the dashboard (Developer API keys) or via
  `POST /api/keys`. Keys are stored hashed and shown only once; revoke anytime.

```bash
curl https://qr.example.com/api/links \
  -H "Authorization: Bearer dqr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Key management

```
POST   /api/keys          { name? }              → { key, prefix, note }   # full key shown once
GET    /api/keys                                 → { keys: [{ id, name, prefix, created_at, last_used, revoked }] }
DELETE /api/keys/:id                             → { revoked: true }
```

## Links

```
GET    /api/links                                → { links: [...] }
POST   /api/links         { target, title?, colorDark?, colorBg?, logo? }     → new redirect QR
                          + rules:{type:'device',ios,android,default} | {type:'split',urls[]}  → smart routing (Pro)
POST   /api/links         { page: { headline, subtitle?, buttons:[{label,url}] } }  → hosted-page QR
PUT    /api/links/:id     { target?, title?, active?, page?, colorDark?, colorBg?, logo? }
DELETE /api/links/:id
GET    /api/links/export.csv                     → CSV of all links + scan counts
```

Create a dynamic QR code:

```bash
curl -X POST https://qr.example.com/api/links \
  -H "Authorization: Bearer $DYNAQR_KEY" -H "Content-Type: application/json" \
  -d '{"target":"https://example.com/menu","title":"Spring menu"}'
# → { "id":"abc1234", "shortUrl":"https://qr.example.com/r/abc1234", ... }
```

Repoint it later (the printed QR is unchanged):

```bash
curl -X PUT https://qr.example.com/api/links/abc1234 \
  -H "Authorization: Bearer $DYNAQR_KEY" -H "Content-Type: application/json" \
  -d '{"target":"https://example.com/summer"}'
```

## QR images & analytics

```
GET /api/links/:id/qr.png         PNG (branded colors + center logo on Business)
GET /api/links/:id/qr.svg         SVG (vector — best for print)
GET /api/links/:id/stats          { total, daily[], recent[], devices[], browsers[], referrers[] }   # Pro
GET /api/links/:id/stats.csv      scan rows as CSV                                                    # Pro
```

## Notes

- Plan limits apply to API calls too (Free = 3 codes; Pro/Business = unlimited).
- Branded colors, center logos, and page accent colors require the Business plan.
- `402` means a plan limit or paid feature; `401` an auth problem; `400` invalid input.
- The public scan endpoint `GET /r/:id` (what a QR encodes) needs no auth — it logs the
  scan and redirects, or renders the hosted page.

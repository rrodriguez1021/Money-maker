// Hosted landing pages — validation + server-side rendering. A "page" link serves
// a small hosted page (headline, subtitle, link buttons) instead of redirecting,
// so customers without their own website can still use a dynamic QR.

const HEX = /^#[0-9a-fA-F]{6}$/;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^(tel:|mailto:)/i.test(s)) return s; // allow contact links on hosted pages
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch { return null; }
}

// Returns a sanitized page object, or null if there isn't enough valid content.
// `allowAccent` gates the custom accent color to branding-enabled plans.
export function sanitizePage(input, allowAccent = false) {
  if (!input || typeof input !== 'object') return null;
  const headline = String(input.headline || '').trim().slice(0, 120);
  const subtitle = String(input.subtitle || '').trim().slice(0, 240);
  const buttons = Array.isArray(input.buttons) ? input.buttons.slice(0, 8) : [];
  const cleanButtons = [];
  for (const b of buttons) {
    const url = safeUrl(b && b.url);
    const label = String((b && b.label) || '').trim().slice(0, 60);
    if (url && label) cleanButtons.push({ label, url });
  }
  if (!headline && !cleanButtons.length) return null; // nothing meaningful to show
  const page = { headline, subtitle, buttons: cleanButtons };
  if (allowAccent && typeof input.accent === 'string' && HEX.test(input.accent)) {
    page.accent = input.accent;
  }
  return page;
}

export function renderPage(page, opts = {}) {
  const accent = page.accent && HEX.test(page.accent) ? page.accent : '#7c8cff';
  const title = page.headline || opts.title || 'Qrysm page';
  const buttons = (page.buttons || []).map((b) =>
    `<a class="lnk" href="${escapeHtml(b.url)}" rel="noopener nofollow">${escapeHtml(b.label)}</a>`).join('\n');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #fff; padding: 28px;
    background: radial-gradient(900px 600px at 50% -10%, var(--accent), #0b0d17 60%); }
  .card { width: 100%; max-width: 460px; text-align: center; }
  h1 { font-size: 30px; margin: 0 0 10px; letter-spacing: -.5px; }
  p.sub { color: rgba(255,255,255,.82); margin: 0 0 26px; }
  .lnk { display: block; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22);
    color: #fff; text-decoration: none; padding: 15px 18px; border-radius: 12px; margin: 11px 0;
    font-weight: 600; transition: transform .12s, background .12s; }
  .lnk:hover { transform: translateY(-2px); background: rgba(255,255,255,.2); }
  footer { margin-top: 30px; font-size: 12px; color: rgba(255,255,255,.5); }
  footer a { color: rgba(255,255,255,.7); }
</style>
</head><body>
<div class="card">
  ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
  ${page.subtitle ? `<p class="sub">${escapeHtml(page.subtitle)}</p>` : ''}
  ${buttons}
  <footer>Made with <a href="${escapeHtml(opts.homeUrl || '/')}" rel="noopener">Qrysm</a></footer>
</div>
</body></html>`;
}

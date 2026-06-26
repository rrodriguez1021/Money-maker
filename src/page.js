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
  const avatar = String(input.avatar || '').trim().slice(0, 8);
  if (avatar) page.avatar = avatar;
  if (allowAccent && typeof input.accent === 'string' && HEX.test(input.accent)) {
    page.accent = input.accent;
  }
  return page;
}

// Safe to embed a string inside a <script> block (neutralize </script> and U+2028/9).
function jsonForScript(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderPage(page, opts = {}) {
  const accent = page.accent && HEX.test(page.accent) ? page.accent : '#7c8cff';
  const title = page.headline || opts.title || 'Qrysm page';
  const desc = page.subtitle || 'Tap to view links';
  const initial = escapeHtml((page.avatar || title.trim().charAt(0) || 'Q').toUpperCase());
  const buttons = (page.buttons || []).map((b) =>
    `<a class="lnk" href="${escapeHtml(b.url)}" rel="noopener nofollow">` +
    `<span class="lnk-label">${escapeHtml(b.label)}</span><span class="chev">›</span></a>`).join('\n');
  const pageUrl = escapeHtml(opts.pageUrl || '');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta name="theme-color" content="${accent}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:type" content="website" />
${pageUrl ? `<meta property="og:url" content="${pageUrl}" />` : ''}
<meta name="twitter:card" content="summary" />
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; min-height: 100svh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 40px 22px calc(28px + env(safe-area-inset-bottom));
    color: #fff; font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(120% 80% at 50% -10%, var(--accent), transparent 55%),
      radial-gradient(100% 70% at 50% 120%, color-mix(in srgb, var(--accent) 40%, #0b0d17), transparent 60%),
      #07080f; }
  .wrap { width: 100%; max-width: 440px; text-align: center; animation: rise .5s cubic-bezier(.2,.7,.2,1); }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .avatar { width: 84px; height: 84px; border-radius: 24px; margin: 0 auto 16px; display: grid; place-items: center;
    font-size: 38px; font-weight: 800; color: #fff;
    background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 85%, #fff), var(--accent));
    box-shadow: 0 18px 40px -16px var(--accent), inset 0 0 0 1px rgba(255,255,255,.25); }
  h1 { font-size: 27px; margin: 0 0 8px; letter-spacing: -.4px; }
  p.sub { color: rgba(255,255,255,.78); margin: 0 0 26px; font-size: 15px; }
  .lnk { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.16); color: #fff; text-decoration: none; padding: 16px 18px;
    border-radius: 14px; margin: 12px 0; font-weight: 600; backdrop-filter: blur(8px);
    transition: transform .12s ease, background .15s, border-color .15s; }
  .lnk-label { flex: 1; text-align: center; }
  .chev { opacity: .5; font-size: 22px; line-height: 1; }
  .lnk:hover { background: rgba(255,255,255,.15); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
  .lnk:active { transform: scale(.98); }
  .share { margin: 4px auto 22px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
    background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.18); color: #fff;
    padding: 8px 16px; border-radius: 999px; font: inherit; font-size: 13px; font-weight: 600; }
  .share:active { transform: scale(.96); }
  footer { margin-top: 30px; font-size: 12px; color: rgba(255,255,255,.45); }
  footer a { color: rgba(255,255,255,.7); }
  .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(10px);
    background: rgba(20,22,40,.95); border: 1px solid rgba(255,255,255,.18); padding: 10px 16px;
    border-radius: 10px; font-size: 13px; opacity: 0; transition: .25s; pointer-events: none; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  @media (prefers-reduced-motion: reduce) { .wrap { animation: none; } * { transition: none !important; } }
</style>
</head><body>
<div class="wrap">
  <div class="avatar">${initial}</div>
  ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
  ${page.subtitle ? `<p class="sub">${escapeHtml(page.subtitle)}</p>` : ''}
  <button class="share" id="share">⇪ Share</button>
  ${buttons}
  <footer>Made with <a href="${escapeHtml(opts.homeUrl || '/')}" rel="noopener">Qrysm</a></footer>
</div>
<div class="toast" id="t">Link copied ✓</div>
<script>
  (function () {
    var url = ${jsonForScript(opts.pageUrl || '')} || location.href;
    var title = ${jsonForScript(title)};
    var t = document.getElementById('t');
    function toast(m){ t.textContent = m; t.className='toast show'; setTimeout(function(){ t.className='toast'; }, 2000); }
    document.getElementById('share').onclick = function () {
      if (navigator.share) { navigator.share({ title: title, url: url }).catch(function(){}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(url).then(function(){ toast('Link copied ✓'); }); }
      else { toast(url); }
    };
  })();
</script>
</body></html>`;
}

// Qrysm dashboard — talks to the JSON API using a token kept in localStorage.
const $ = (s) => document.querySelector(s);
const TOKEN_KEY = 'dynaqr_token';
// A magic sign-in link drops the token in the URL fragment (#t=…), which browsers
// never send to servers. Capture it, persist it, then scrub it from the address bar.
(function captureMagicToken() {
  const m = location.hash.match(/[#&]t=([^&]+)/);
  if (m) {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }
})();
let token = localStorage.getItem(TOKEN_KEY);
let me = null;

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => (t.className = 'toast'), 2600);
}

// Run an async action with a busy/disabled state on its trigger button.
async function withBusy(el, fn) {
  if (!el) return fn();
  const label = el.textContent;
  el.disabled = true; el.classList.add('busy'); el.textContent = '…';
  try { return await fn(); }
  finally { el.disabled = false; el.classList.remove('busy'); el.textContent = label; }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { data, status: res.status });
  return data;
}

// --- Auth ---
$('#signupBtn').onclick = async () => {
  const email = $('#email').value.trim();
  $('#authErr').textContent = '';
  $('#authMsg').classList.add('hidden');
  try {
    const ref = localStorage.getItem('dynaqr_ref') || undefined;
    const r = await api('/api/signup', { method: 'POST', body: JSON.stringify({ email, ref }) });
    if (r.token) {
      // Brand-new account.
      token = r.token;
      localStorage.setItem(TOKEN_KEY, token);
      await boot();
    } else if (r.returning) {
      // Existing account — we never hand back the token; a sign-in link was sent.
      const msg = r.emailed
        ? `You already have an account. We've emailed a secure sign-in link to ${email}.`
        : `You already have an account. A sign-in link was generated — check the server logs, or use your access key below.`;
      $('#authMsg').textContent = msg;
      $('#authMsg').classList.remove('hidden');
      $('#keySignin').open = !r.emailed;
    }
  } catch (e) {
    $('#authErr').textContent = e.data?.error === 'invalid_email' ? 'Please enter a valid email.'
      : e.data?.error === 'email_failed' ? "Couldn't send the sign-in email. Try your access key below."
      : 'Something went wrong.';
  }
};
$('#email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#signupBtn').click(); });

// Sign in by pasting a saved access key (works with no email provider configured).
$('#accessKeyBtn').onclick = async () => {
  const key = $('#accessKey').value.trim();
  if (!key) return;
  $('#authErr').textContent = '';
  token = key;
  try {
    me = await api('/api/me'); // validate before persisting
    localStorage.setItem(TOKEN_KEY, token);
    await boot();
  } catch {
    token = null;
    $('#authErr').textContent = 'That access key is not valid.';
  }
};
$('#accessKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#accessKeyBtn').click(); });

$('#logout').onclick = (e) => {
  e.preventDefault();
  localStorage.removeItem(TOKEN_KEY);
  token = null; me = null;
  location.reload();
};

// --- Boot ---
async function boot() {
  try {
    me = await api('/api/me');
  } catch {
    $('#authPanel').classList.remove('hidden');
    $('#mainApp').classList.add('hidden');
    return;
  }
  $('#authPanel').classList.add('hidden');
  $('#mainApp').classList.remove('hidden');
  $('#emailLabel').textContent = me.email;
  const isPaid = me.plan !== 'free';
  $('#planPill').textContent = me.plan.toUpperCase();
  $('#planPill').className = 'pill' + (isPaid ? ' pro' : '');
  const max = me.limits.maxLinks;
  $('#usage').textContent = max ? `· ${me.used}/${max} codes used` : `· ${me.used} codes`;

  // Show brand color pickers only when the plan includes branding.
  $('#brandRow').classList.toggle('hidden', !me.limits.branding);
  document.getElementById('pageAccentWrap')?.classList.toggle('hidden', !me.limits.branding);
  document.getElementById('routingDetails')?.classList.toggle('hidden', !me.limits.analytics);
  document.getElementById('trackRow')?.classList.toggle('hidden', !me.limits.analytics);
  if (me.limits.branding) refreshPreview();

  // Upgrade buttons: offer Pro if on Free, and Business unless already on Business.
  const upBtn = $('#upgradeBtn');
  const bizBtn = $('#businessBtn');
  const showPro = me.plan === 'free';
  const showBiz = me.plan !== 'business';
  upBtn.classList.toggle('hidden', !showPro);
  bizBtn.classList.toggle('hidden', !showBiz);
  // The annual/monthly toggle is only useful when an upgrade is offered and annual is configured.
  $('#period').classList.toggle('hidden', !(showPro || showBiz) || !me.annualBillingEnabled);
  upBtn.onclick = (e) => withBusy(e.currentTarget, () => upgrade('pro'));
  bizBtn.onclick = (e) => withBusy(e.currentTarget, () => upgrade('business'));

  // Paid users get a "Manage billing" link to the Stripe customer portal.
  const manageBtn = $('#manageBtn');
  if (manageBtn) {
    manageBtn.classList.toggle('hidden', !(me.plan !== 'free' && me.billingEnabled));
    manageBtn.onclick = (e) => withBusy(e.currentTarget, manageBilling);
  }

  await loadLinks();
  loadKeys().catch(() => {});
  loadReferral().catch(() => {});
  startRadar();
}

// Real-time scan radar via Server-Sent Events.
let radarES = null, liveCount = 0;
function startRadar() {
  if (!token || radarES) return;
  try {
    radarES = new EventSource('/api/events?token=' + encodeURIComponent(token));
    radarES.addEventListener('scan', () => { radarPing(); liveCount++; const el = $('#liveCount'); if (el) el.textContent = liveCount; });
  } catch { /* SSE unsupported */ }
}
function radarPing() {
  const r = document.getElementById('radar');
  if (!r) return;
  const p = document.createElement('span');
  p.className = 'radar-ping';
  r.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

async function loadReferral() {
  const r = await api('/api/referrals');
  const a = document.getElementById('refLink');
  if (a) { a.textContent = r.link; a.href = r.link; }
  const c = document.getElementById('refCount');
  if (c) c.textContent = r.count;
}

async function manageBilling() {
  try {
    const r = await api('/api/billing/portal', { method: 'POST' });
    location.href = r.url;
  } catch (e) {
    toast('Billing portal unavailable: ' + (e.data?.error || 'error'), true);
  }
}

async function upgrade(plan) {
  if (!me.billingEnabled) {
    return toast('Set STRIPE_SECRET_KEY + STRIPE_PRICE_ID' + (plan === 'business' ? '_BUSINESS' : '') + ' to enable billing.', true);
  }
  if (plan === 'business' && !me.businessBillingEnabled) {
    return toast('Set STRIPE_PRICE_ID_BUSINESS to sell the Business tier.', true);
  }
  const period = $('#period').value || 'monthly';
  try {
    const r = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, period }) });
    location.href = r.url;
  } catch (e) {
    toast('Checkout unavailable: ' + (e.data?.error || 'error'), true);
  }
}

// --- Links ---
$('#createBtn').onclick = (e) => withBusy(e.currentTarget, async () => {
  const target = $('#target').value.trim();
  const title = $('#title').value.trim();
  if (!target) return toast('Enter a destination URL', true);
  const body = { target, title };
  if (me && me.limits.branding) {
    body.colorDark = $('#colorDark').value;
    body.colorBg = $('#colorBg').value;
    body.logoShape = $('#logoShape')?.value || 'square';
    const st = currentStyle(); if (st) body.style = st;
    const logo = await readLogoFile();
    if (logo) body.logo = logo;
  }
  const rules = currentRules(); if (rules) body.rules = rules;
  if (document.getElementById('trackOn')?.checked) body.track = true;
  try {
    await api('/api/links', { method: 'POST', body: JSON.stringify(body) });
    $('#target').value = ''; $('#title').value = '';
    toast('QR code created ✓');
    me = await api('/api/me');
    await boot();
  } catch (err) {
    if (err.data?.error === 'limit_reached') toast('Free limit reached — upgrade to Pro for unlimited.', true);
    else toast('Could not create: ' + (err.data?.error || 'error'), true);
  }
});
// Enter in the URL or title field creates the code.
['#target', '#title'].forEach((s) => $(s)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#createBtn').click(); }));

// Create a hosted-page QR (no destination website needed).
$('#pageCreateBtn').onclick = async () => {
  const headline = $('#pageHeadline').value.trim();
  const subtitle = $('#pageSubtitle').value.trim();
  const buttons = [...document.querySelectorAll('#pageButtons .row')].map((r) => ({
    label: r.querySelector('.pb-label').value.trim(),
    url: r.querySelector('.pb-url').value.trim(),
  })).filter((b) => b.label && b.url);
  if (!headline && !buttons.length) return toast('Add a headline or at least one button', true);
  const title = $('#title').value.trim() || headline;
  const page = { headline, subtitle, buttons };
  const av = $('#pageAvatar')?.value.trim(); if (av) page.avatar = av;
  if (me?.limits.branding) page.accent = $('#pageAccent')?.value;
  await withBusy($('#pageCreateBtn'), async () => {
    try {
      await api('/api/links', { method: 'POST', body: JSON.stringify({ title, page }) });
      $('#pageHeadline').value = ''; $('#pageSubtitle').value = '';
      document.querySelectorAll('#pageButtons input').forEach((i) => (i.value = ''));
      toast('Hosted page QR created ✓');
      me = await api('/api/me');
      await boot();
    } catch (e) {
      if (e.data?.error === 'limit_reached') toast('Free limit reached — upgrade to Pro.', true);
      else toast('Could not create page: ' + (e.data?.error || 'error'), true);
    }
  });
};

// ===== ⌘K command palette =====
const cmdk = { open: false, items: [], filtered: [], sel: 0 };

function cmdkCommands() {
  const base = [
    { icon: '✦', label: 'Create dynamic code', hint: 'new redirect QR', run: () => focusEl('#target') },
    { icon: '📄', label: 'Create hosted page', hint: 'no website needed', run: () => openDetailsNear('#pageHeadline') },
    { icon: '⬚', label: 'Bulk create codes', hint: 'paste many URLs', run: () => openDetailsNear('#bulkInput') },
    { icon: '⬇', label: 'Export all codes (CSV)', run: () => window.open(`/api/links/export.csv?token=${encodeURIComponent(token)}`, '_blank') },
    { icon: '🔑', label: 'Developer API keys', run: () => openDetailsNear('#keyName') },
    { icon: '◢', label: 'Pricing', run: () => window.open('/#pricing', '_blank') },
    { icon: '⎋', label: 'Sign out', run: () => $('#logout').click() },
  ];
  if (me && me.plan === 'free') base.splice(4, 0, { icon: '▲', label: 'Upgrade to Pro', hint: '$9/mo', run: () => upgrade('pro') });
  if (me && me.plan !== 'business') base.splice(5, 0, { icon: '◈', label: 'Go Business', hint: 'branded codes', run: () => upgrade('business') });
  return base;
}

async function openCmdk() {
  cmdk.open = true; cmdk.sel = 0;
  $('#cmdk').classList.remove('hidden');
  const input = $('#cmdk-input'); input.value = ''; input.focus();
  let links = [];
  try { links = (await api('/api/links')).links; } catch {}
  const linkItems = links.map((l) => ({
    icon: l.page_json ? '📄' : '◫', label: l.title || '(untitled)', hint: l.page_json ? 'hosted page' : l.target,
    run: () => window.open(l.shortUrl, '_blank'),
  }));
  cmdk.items = [...cmdkCommands(), ...linkItems];
  renderCmdk('');
}
function closeCmdk() { cmdk.open = false; $('#cmdk').classList.add('hidden'); }

function renderCmdk(q) {
  const query = q.trim().toLowerCase();
  cmdk.filtered = !query ? cmdk.items
    : cmdk.items.filter((i) => (i.label + ' ' + (i.hint || '')).toLowerCase().includes(query));
  if (cmdk.sel >= cmdk.filtered.length) cmdk.sel = Math.max(0, cmdk.filtered.length - 1);
  const list = $('#cmdk-list');
  list.innerHTML = cmdk.filtered.length
    ? cmdk.filtered.map((i, n) => `<div class="cmdk-item${n === cmdk.sel ? ' on' : ''}" data-n="${n}">
        <span class="cmdk-ic">${i.icon || '›'}</span><span class="cmdk-label">${escapeHtml(i.label)}</span>
        ${i.hint ? `<span class="cmdk-hint">${escapeHtml(i.hint)}</span>` : ''}</div>`).join('')
    : '<div class="cmdk-empty">No matches</div>';
  list.querySelectorAll('.cmdk-item').forEach((el) => {
    el.onmouseenter = () => { cmdk.sel = +el.dataset.n; paintCmdkSel(); };
    el.onclick = () => runCmdk(+el.dataset.n);
  });
}
function paintCmdkSel() {
  $('#cmdk-list').querySelectorAll('.cmdk-item').forEach((el, n) => el.classList.toggle('on', n === cmdk.sel));
}
function runCmdk(n) {
  const item = cmdk.filtered[n]; if (!item) return;
  closeCmdk(); setTimeout(() => item.run(), 60);
}
function focusEl(sel) { const el = $(sel); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); } }
function openDetailsNear(sel) { const el = $(sel); if (!el) return; const d = el.closest('details'); if (d) d.open = true; focusEl(sel); }

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdk.open ? closeCmdk() : openCmdk(); return; }
  if (!cmdk.open) return;
  if (e.key === 'Escape') { closeCmdk(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); cmdk.sel = Math.min(cmdk.filtered.length - 1, cmdk.sel + 1); paintCmdkSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdk.sel = Math.max(0, cmdk.sel - 1); paintCmdkSel(); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmdk(cmdk.sel); }
});
document.getElementById('cmdk-input')?.addEventListener('input', (e) => { cmdk.sel = 0; renderCmdk(e.target.value); });
document.getElementById('cmdkBtn')?.addEventListener('click', openCmdk);
$('#cmdk')?.addEventListener('click', (e) => { if (e.target.id === 'cmdk') closeCmdk(); });

// Developer API keys.
async function loadKeys() {
  const wrap = document.getElementById('keysList');
  if (!wrap) return;
  const { keys } = await api('/api/keys');
  if (!keys.length) { wrap.innerHTML = '<div class="muted" style="font-size:13px">No keys yet.</div>'; return; }
  wrap.innerHTML = keys.map((k) => `
    <div class="bd-row">
      <span>${escapeHtml(k.name || '(unnamed)')} · <span class="short">${escapeHtml(k.prefix)}</span>${k.revoked ? ' <span class="muted">(revoked)</span>' : ''}</span>
      ${k.revoked ? '' : `<button class="btn btn-sm" data-revoke="${k.id}">Revoke</button>`}
    </div>`).join('');
  wrap.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Revoke this key? Apps using it will stop working immediately.')) return;
    await api('/api/keys/' + b.dataset.revoke, { method: 'DELETE' });
    toast('Key revoked');
    loadKeys();
  }));
}

document.getElementById('createKeyBtn').onclick = async () => {
  const name = document.getElementById('keyName').value.trim();
  try {
    const r = await api('/api/keys', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('keyName').value = '';
    window.prompt('Copy your API key now — it will NOT be shown again:', r.key);
    loadKeys();
  } catch (e) {
    toast('Could not create key: ' + (e.data?.error || 'error'), true);
  }
};

// Bulk create from pasted lines ("url" or "url, title" per line).
$('#bulkBtn').onclick = async () => {
  const lines = $('#bulkInput').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return toast('Paste at least one URL', true);
  const items = lines.map((line) => {
    const i = line.indexOf(',');
    return i === -1 ? { target: line } : { target: line.slice(0, i).trim(), title: line.slice(i + 1).trim() };
  });
  try {
    const r = await api('/api/links/bulk', { method: 'POST', body: JSON.stringify({ items }) });
    $('#bulkInput').value = '';
    toast(`Created ${r.createdCount}${r.skippedCount ? `, skipped ${r.skippedCount}` : ''} ✓`,
      r.createdCount === 0);
    me = await api('/api/me');
    await boot();
  } catch (e) {
    toast('Bulk create failed: ' + (e.data?.error || 'error'), true);
  }
};

// Export all links as CSV (token in query so the browser can download directly).
$('#exportAll').onclick = (e) => {
  e.preventDefault();
  window.open(`/api/links/export.csv?token=${encodeURIComponent(token)}`, '_blank');
};

async function loadLinks() {
  const wrap = $('#links');
  const { links } = await api('/api/links');
  // Show the search box once there are enough codes to be worth filtering.
  document.getElementById('linkFilter')?.classList.toggle('hidden', links.length < 4);
  if (!links.length) {
    wrap.innerHTML = `<div class="onboard">
      <div class="onboard-badge">◈</div>
      <h3>Welcome to Qrysm</h3>
      <p>Create your first dynamic QR code — print it once, change where it points forever, and track every scan.</p>
      <ol class="onboard-steps">
        <li><b>Paste a destination URL</b> in the box above</li>
        <li><b>Download</b> the QR (PNG / SVG) or a “SCAN ME” poster</li>
        <li><b>Repoint or track</b> it anytime — the printed code never changes</li>
      </ol>
      <button class="btn btn-primary" id="emptyCreate">Create your first code →</button>
      <p class="muted" style="font-size:12px;margin-top:12px">No website? <a href="#" id="emptyPage">Build a hosted page</a> instead.</p>
    </div>`;
    wrap.querySelector('#emptyCreate').onclick = () => focusEl('#target');
    wrap.querySelector('#emptyPage').onclick = (e) => { e.preventDefault(); openDetailsNear('#pageHeadline'); };
    return;
  }
  wrap.innerHTML = '';
  for (const l of links) {
    const isPage = !!l.page_json;
    const destLine = isPage
      ? `<div class="small">📄 Hosted landing page · <a href="${l.shortUrl}" target="_blank">open</a></div>`
      : `<div class="small">now points to: ${escapeHtml(l.target)}</div>`;
    const editAction = isPage
      ? `<button class="btn btn-sm" data-act="editpage">Edit page</button><a class="btn btn-sm" href="${l.shortUrl}" target="_blank">Open</a>`
      : `<button class="btn btn-sm" data-act="edit">Edit dest</button>`;
    const el = document.createElement('div');
    el.className = 'link-item' + (l.active ? '' : ' paused');
    el.dataset.search = `${l.title || ''} ${l.target || ''} ${l.shortUrl}`.toLowerCase();
    el.innerHTML = `
      <input type="checkbox" class="sel" data-id="${l.id}" title="Select" />
      <div class="qr-wrap"><img class="link-qr" alt="QR" src="/api/links/${l.id}/qr.png?token=${encodeURIComponent(token)}" /><span class="qr-sheen"></span></div>
      <div class="link-main">
        <h4>${escapeHtml(l.title || '(untitled)')}${l.rules ? ' <span class="pill smart-pill">⚡ smart</span>' : ''}${l.track ? ' <span class="pill smart-pill">🎯 tracking</span>' : ''}${l.active ? '' : ' <span class="pill paused-pill">paused</span>'}</h4>
        <div class="small">QR → <span class="short">${l.shortUrl.replace(/^https?:\/\//, '')}</span></div>
        ${destLine}
      </div>
      <div style="text-align:center">
        <div class="scan-count">${l.scans}</div>
        <div class="small">scans</div>
        <div class="small" style="margin-top:2px">${l.scans ? timeAgo(l.lastScan) : '—'}</div>
      </div>
      <div class="link-actions">
        ${editAction}
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.png?token=${encodeURIComponent(token)}" download="qr-${l.id}.png">PNG</a>
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.png?size=1024&token=${encodeURIComponent(token)}" download="qr-${l.id}-hd.png">HD</a>
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.svg?token=${encodeURIComponent(token)}" download="qr-${l.id}.svg">SVG</a>
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.svg?frame=scanme&token=${encodeURIComponent(token)}" target="_blank">Poster</a>
        <button class="btn btn-sm" data-act="toggle">${l.active ? 'Pause' : 'Resume'}</button>
        ${l.track ? '<button class="btn btn-sm" data-act="pixel">Pixel</button>' : ''}
        <button class="btn btn-sm" data-act="dup">Dup</button>
        <button class="btn btn-sm" data-act="stats">Stats</button>
        <button class="btn btn-sm" data-act="del">✕</button>
      </div>`;
    const pixelBtn = el.querySelector('[data-act=pixel]');
    if (pixelBtn) pixelBtn.onclick = () => showPixel(l, el);
    el.querySelector('[data-act=toggle]').onclick = (e) => withBusy(e.currentTarget, async () => {
      await api('/api/links/' + l.id, { method: 'PUT', body: JSON.stringify({ active: !l.active }) });
      toast(l.active ? 'Paused — the code now shows a 404' : 'Resumed');
      await loadLinks();
    });
    // Click the short URL to copy it.
    const shortEl = el.querySelector('.short');
    if (shortEl) {
      shortEl.style.cursor = 'pointer'; shortEl.title = 'Click to copy';
      shortEl.onclick = () => { navigator.clipboard?.writeText(l.shortUrl).then(() => toast('Link copied ✓')).catch(() => {}); };
    }
    el.querySelector('[data-act=dup]').onclick = (e) => withBusy(e.currentTarget, () => dupLink(l));
    const editBtn = el.querySelector('[data-act=edit]');
    if (editBtn) editBtn.onclick = () => editDest(l);
    const editPageBtn = el.querySelector('[data-act=editpage]');
    if (editPageBtn) editPageBtn.onclick = () => editPage(l, el);
    // Holographic 3D tilt on the QR thumbnail.
    const qrWrap = el.querySelector('.qr-wrap');
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      qrWrap.style.transform = `perspective(520px) rotateY(${px * 22}deg) rotateX(${-py * 22}deg) scale(1.07)`;
    });
    el.addEventListener('pointerleave', () => { qrWrap.style.transform = ''; });
    el.querySelector('[data-act=del]').onclick = () => delLink(l);
    el.querySelector('[data-act=stats]').onclick = () => showStats(l, el);
    wrap.appendChild(el);
  }
  updateBulkBar();
}

// Show the install snippet for conversion tracking on a code.
function showPixel(l, el) {
  let box = el.nextElementSibling;
  if (box && box.classList.contains('pixel-box')) { box.remove(); return; }
  const origin = location.origin;
  const snippet = `<!-- 1) Add once, site-wide (e.g. in <head>) -->\n<script src="${origin}/pixel.js"></script>\n\n<!-- 2) On your success / thank-you page, after the sale or install -->\n<script>qrysm('conversion')</script>`;
  const imgPixel = `<img src="${origin}/c/${l.id}" width="1" height="1" alt="" />`;
  box = document.createElement('div');
  box.className = 'panel pixel-box';
  box.innerHTML = `
    <strong>Conversion tracking — installs/sales for this code</strong>
    <p class="muted" style="font-size:13px;margin:8px 0">The redirect tags visitors with an attribution token; the snippet credits the conversion back to this exact code (and routing variant). No cookies, no IPs.</p>
    <label>JS snippet (most accurate — only counts visitors who scanned)</label>
    <textarea readonly rows="5" class="pixel-code">${escapeHtml(snippet)}</textarea>
    <label style="margin-top:8px">Or a no-code image pixel (counts every load of your success page)</label>
    <textarea readonly rows="2" class="pixel-code">${escapeHtml(imgPixel)}</textarea>
    <button class="btn btn-sm pixel-copy" style="margin-top:8px">Copy JS snippet</button>`;
  el.after(box);
  box.querySelector('.pixel-copy').onclick = () => { navigator.clipboard?.writeText(snippet).then(() => toast('Snippet copied ✓')); };
}

// Inline editor for a hosted page's content (headline, subtitle, buttons).
function editPage(l, el) {
  let box = el.nextElementSibling;
  if (box && box.classList.contains('pageedit-box')) { box.remove(); return; }
  const page = JSON.parse(l.page_json || '{}');
  const buttons = page.buttons || [];
  let rowsHtml = '';
  for (let i = 0; i < 6; i++) {
    const b = buttons[i] || { label: '', url: '' };
    rowsHtml += `<div class="row" style="margin-bottom:6px">
      <input class="pe-label" placeholder="Button label" value="${escapeHtml(b.label)}" />
      <input class="pe-url" placeholder="https://… or tel:…" value="${escapeHtml(b.url)}" /></div>`;
  }
  box = document.createElement('div');
  box.className = 'panel pageedit-box';
  const accentField = me?.limits.branding
    ? `<div><label>Accent</label><input class="pe-accent" type="color" value="${escapeHtml(page.accent || '#7c8cff')}" style="width:54px;height:42px;padding:4px" /></div>` : '';
  box.innerHTML = `
    <label>Headline</label><input class="pe-headline" value="${escapeHtml(page.headline || '')}" />
    <label style="margin-top:8px">Subtitle</label><input class="pe-subtitle" value="${escapeHtml(page.subtitle || '')}" />
    <div class="row" style="margin-top:8px;align-items:flex-end">
      <div><label>Avatar</label><input class="pe-avatar" maxlength="8" value="${escapeHtml(page.avatar || '')}" style="width:110px" /></div>
      ${accentField}
    </div>
    <label style="margin-top:8px">Buttons</label>${rowsHtml}
    <button class="btn btn-primary pe-save" style="margin-top:8px">Save page</button>`;
  el.after(box);
  box.querySelector('.pe-save').onclick = async () => {
    const headline = box.querySelector('.pe-headline').value.trim();
    const subtitle = box.querySelector('.pe-subtitle').value.trim();
    const newButtons = [...box.querySelectorAll('.row')].map((r) => ({
      label: r.querySelector('.pe-label').value.trim(),
      url: r.querySelector('.pe-url').value.trim(),
    })).filter((b) => b.label && b.url);
    if (!headline && !newButtons.length) return toast('Add a headline or at least one button', true);
    const pg = { headline, subtitle, buttons: newButtons };
    const av = box.querySelector('.pe-avatar')?.value.trim(); if (av) pg.avatar = av;
    const ac = box.querySelector('.pe-accent')?.value; if (ac) pg.accent = ac;
    try {
      await api('/api/links/' + l.id, { method: 'PUT', body: JSON.stringify({ page: pg }) });
      toast('Page updated ✓');
      await loadLinks();
    } catch (e) {
      toast('Update failed: ' + (e.data?.error || 'error'), true);
    }
  };
}

async function editDest(l) {
  const next = prompt('New destination URL for this QR code:', l.target);
  if (next === null) return;
  try {
    await api('/api/links/' + l.id, { method: 'PUT', body: JSON.stringify({ target: next }) });
    toast('Destination updated — the printed QR now points there ✓');
    await loadLinks();
  } catch (e) {
    toast('Update failed: ' + (e.data?.error || 'error'), true);
  }
}

async function delLink(l) {
  if (!confirm('Delete this QR code? Scans of the printed code will stop working.')) return;
  await api('/api/links/' + l.id, { method: 'DELETE' });
  toast('Deleted');
  me = await api('/api/me');
  await boot();
}

async function dupLink(l) {
  try {
    await api('/api/links/' + l.id + '/duplicate', { method: 'POST' });
    toast('Duplicated ✓');
    me = await api('/api/me');
    await boot();
  } catch (e) {
    if (e.data?.error === 'limit_reached') toast('Limit reached — upgrade to Pro.', true);
    else toast('Could not duplicate', true);
  }
}

// Filter the rendered code list by title / destination / short URL.
document.getElementById('linkFilter')?.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#links .link-item').forEach((it) => {
    it.style.display = !q || (it.dataset.search || '').includes(q) ? '' : 'none';
  });
});

// --- Bulk select + delete ---
function selectedIds() { return [...document.querySelectorAll('#links .sel:checked')].map((c) => c.dataset.id); }
function updateBulkBar() {
  const n = selectedIds().length;
  const bar = document.getElementById('bulkBar');
  if (!bar) return;
  bar.classList.toggle('hidden', n === 0);
  const c = document.getElementById('bulkCount'); if (c) c.textContent = `${n} selected`;
}
document.getElementById('links')?.addEventListener('change', (e) => { if (e.target.classList.contains('sel')) updateBulkBar(); });
document.getElementById('bulkClearBtn')?.addEventListener('click', () => {
  document.querySelectorAll('#links .sel:checked').forEach((c) => (c.checked = false));
  updateBulkBar();
});
document.getElementById('bulkDelBtn')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
  const ids = selectedIds();
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} code(s)? Printed versions will stop working.`)) return;
  await api('/api/links/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
  toast(`Deleted ${ids.length} ✓`);
  me = await api('/api/me');
  await boot();
}));

async function showStats(l, el) {
  try {
    const s = await api('/api/links/' + l.id + '/stats');
    const max = Math.max(1, ...s.daily.map((d) => d.scans));
    const bars = s.daily.map((d) => `<div class="bar" style="height:${(d.scans / max) * 100}%" title="${d.date}: ${d.scans}"></div>`).join('');
    let box = el.nextElementSibling;
    if (box && box.classList.contains('stats-box')) { box.remove(); return; }
    const breakdown = (title, items) => items && items.length
      ? `<div class="bd"><div class="bd-h">${title}</div>${items.slice(0, 5).map((i) =>
          `<div class="bd-row"><span>${escapeHtml(i.name)}</span><span>${i.scans}</span></div>`).join('')}</div>`
      : '';
    box = document.createElement('div');
    box.className = 'panel stats-box';
    const convLine = (s.track || s.conversions)
      ? `<div class="conv-line">🎯 <b>${s.conversions}</b> conversions · <b>${s.conversionRate}%</b> rate</div>` : '';
    box.innerHTML = `<strong>${s.total} total scans</strong> · last 30 days
      <a class="btn btn-sm" style="float:right" target="_blank"
         href="/api/links/${l.id}/stats.csv?token=${encodeURIComponent(token)}">Export scans CSV</a>
      ${convLine}
      <div class="bars">${bars || '<span class="muted">no scans yet</span>'}</div>
      <div class="breakdowns">
        ${breakdown('Devices', s.devices)}
        ${breakdown('Browsers', s.browsers)}
        ${breakdown('Top referrers', s.referrers)}
        ${s.routing && s.routing.length ? breakdown('Smart routing', s.routing) : ''}
        ${s.buttonClicks && s.buttonClicks.length ? breakdown('Button clicks', s.buttonClicks.map((b) => ({ name: b.label, scans: b.clicks }))) : ''}
      </div>`;
    el.after(box);
  } catch (e) {
    if (e.status === 402) toast('Analytics is a Pro feature — upgrade to unlock.', true);
    else toast('Could not load stats', true);
  }
}

// --- Back up the access key: copy the token so a user can sign in on another device ---
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'copyKey') {
    e.preventDefault();
    const key = localStorage.getItem(TOKEN_KEY) || '';
    if (!key) return toast('No access key found in this browser', true);
    try {
      await navigator.clipboard.writeText(key);
      toast('Access key copied — store it somewhere safe to sign in elsewhere.');
    } catch {
      // Clipboard blocked (e.g. insecure context): show it so the user can copy manually.
      prompt('Your access key — copy and store it safely:', key);
    }
  }
});

// --- GDPR: delete account and all associated data ---
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'deleteAccount') {
    e.preventDefault();
    if (!confirm('Permanently delete your account, all your QR codes, and all scan data? This cannot be undone, and any printed codes will stop working.')) return;
    api('/api/account', { method: 'DELETE' })
      .then(() => {
        localStorage.removeItem(TOKEN_KEY);
        alert('Your account and all associated data have been deleted.');
        location.href = '/';
      })
      .catch(() => toast('Could not delete account', true));
  }
});

// Smart-routing rules from the create form (Pro). default = the main destination.
function currentRules() {
  const mode = document.getElementById('routeMode')?.value;
  if (mode === 'device') {
    const ios = $('#routeIos').value.trim(), android = $('#routeAndroid').value.trim();
    if (!ios && !android) return null;
    return { type: 'device', ios, android, default: $('#target').value.trim() };
  }
  if (mode === 'split') {
    const urls = $('#routeUrls').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length < 2) return null;
    return { type: 'split', urls };
  }
  if (mode === 'time') {
    const tzHours = parseFloat($('#routeTz').value) || 0;
    const windows = [...document.querySelectorAll('#routeWindows .tw-row')].map((r) => ({
      start: r.querySelector('.tw-start').value.trim(),
      end: r.querySelector('.tw-end').value.trim(),
      url: r.querySelector('.tw-url').value.trim(),
      label: r.querySelector('.tw-label').value.trim(),
    })).filter((w) => w.start && w.end && w.url);
    if (!windows.length) return null;
    return { type: 'time', tz: Math.round(tzHours * 60), windows, default: $('#target').value.trim() };
  }
  return null;
}
document.getElementById('routeMode')?.addEventListener('change', (e) => {
  document.getElementById('routeDevice').classList.toggle('hidden', e.target.value !== 'device');
  document.getElementById('routeSplit').classList.toggle('hidden', e.target.value !== 'split');
  document.getElementById('routeTime').classList.toggle('hidden', e.target.value !== 'time');
});

// Live branded-QR preview (Business): re-renders as colors/logo/shape change.
let previewLogo = null, previewDeb;
async function refreshPreview() {
  if (!me || !me.limits.branding) return;
  const body = {
    text: $('#target').value.trim() || 'https://qrysm.app/preview',
    colorDark: $('#colorDark').value, colorBg: $('#colorBg').value,
    logoShape: $('#logoShape')?.value || 'square',
  };
  const st = currentStyle(); if (st) body.style = st;
  if (previewLogo) body.logo = previewLogo;
  try {
    const res = await fetch('/api/qr/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    // Surface the scannability verdict from response headers.
    const note = $('#scanNote');
    if (note) {
      const lvl = res.headers.get('X-Scan-Level') || 'ok';
      const msg = decodeURIComponent(res.headers.get('X-Scan-Msg') || '');
      note.className = 'scan-note ' + lvl;
      note.textContent = lvl === 'ok' ? '✓ Scannable' : (lvl === 'warn' ? '⚠ ' + msg : '✗ ' + msg);
    }
    const blob = await res.blob();
    const img = $('#qrPreview'); if (!img) return;
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    const u = URL.createObjectURL(blob); img.src = u; img.dataset.url = u;
  } catch { /* ignore */ }
}
function currentStyle() {
  const style = {};
  if (document.getElementById('gradOn')?.checked) style.gradient = { from: $('#gradFrom').value, to: $('#gradTo').value, type: $('#gradType').value, angle: 45 };
  const mod = $('#modStyle')?.value, eye = $('#eyeStyle')?.value;
  if (mod && mod !== 'square') style.module = mod;
  if (eye && eye !== 'square') style.eye = eye;
  return Object.keys(style).length ? style : null;
}
function queuePreview() { clearTimeout(previewDeb); previewDeb = setTimeout(refreshPreview, 180); }
['#colorDark', '#colorBg', '#target', '#gradFrom', '#gradTo'].forEach((s) => document.querySelector(s)?.addEventListener('input', queuePreview));
['#logoShape', '#gradType', '#gradOn', '#modStyle', '#eyeStyle'].forEach((s) => document.querySelector(s)?.addEventListener('change', refreshPreview));
document.getElementById('logoInput')?.addEventListener('change', async () => { previewLogo = await readLogoFile(); refreshPreview(); });

// Read the selected logo PNG as a data URL (or null if none / too big).
function readLogoFile() {
  const input = document.getElementById('logoInput');
  const file = input && input.files && input.files[0];
  if (!file) return Promise.resolve(null);
  if (file.size > 300 * 1024) { toast('Logo must be under 300KB', true); return Promise.resolve(null); }
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
  return Math.floor(d / 30) + 'mo ago';
}

// Esc closes any open inline editor (stats / page editor) when the palette isn't open.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cmdk.open) {
    document.querySelectorAll('.stats-box, .pageedit-box').forEach((b) => b.remove());
  }
});

boot();

// Qrysm dashboard — talks to the JSON API using a token kept in localStorage.
const $ = (s) => document.querySelector(s);
const TOKEN_KEY = 'dynaqr_token';
let token = localStorage.getItem(TOKEN_KEY);
let me = null;

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => (t.className = 'toast'), 2600);
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
  try {
    const ref = localStorage.getItem('dynaqr_ref') || undefined;
    const r = await api('/api/signup', { method: 'POST', body: JSON.stringify({ email, ref }) });
    token = r.token;
    localStorage.setItem(TOKEN_KEY, token);
    await boot();
  } catch (e) {
    $('#authErr').textContent = e.data?.error === 'invalid_email' ? 'Please enter a valid email.' : 'Something went wrong.';
  }
};
$('#email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#signupBtn').click(); });

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
  upBtn.onclick = () => upgrade('pro');
  bizBtn.onclick = () => upgrade('business');

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
$('#createBtn').onclick = async () => {
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
  try {
    await api('/api/links', { method: 'POST', body: JSON.stringify(body) });
    $('#target').value = ''; $('#title').value = '';
    toast('QR code created ✓');
    me = await api('/api/me');
    await boot();
  } catch (e) {
    if (e.data?.error === 'limit_reached') toast('Free limit reached — upgrade to Pro for unlimited.', true);
    else toast('Could not create: ' + (e.data?.error || 'error'), true);
  }
};

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
  try {
    await api('/api/links', { method: 'POST', body: JSON.stringify({ title, page: { headline, subtitle, buttons } }) });
    $('#pageHeadline').value = ''; $('#pageSubtitle').value = '';
    document.querySelectorAll('#pageButtons input').forEach((i) => (i.value = ''));
    toast('Hosted page QR created ✓');
    me = await api('/api/me');
    await boot();
  } catch (e) {
    if (e.data?.error === 'limit_reached') toast('Free limit reached — upgrade to Pro.', true);
    else toast('Could not create page: ' + (e.data?.error || 'error'), true);
  }
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
  if (!links.length) {
    wrap.innerHTML = '<div class="empty">No QR codes yet. Create your first one above ☝️</div>';
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
    el.className = 'link-item';
    el.innerHTML = `
      <div class="qr-wrap"><img class="link-qr" alt="QR" src="/api/links/${l.id}/qr.png?token=${encodeURIComponent(token)}" /><span class="qr-sheen"></span></div>
      <div class="link-main">
        <h4>${escapeHtml(l.title || '(untitled)')}</h4>
        <div class="small">QR → <span class="short">${l.shortUrl.replace(/^https?:\/\//, '')}</span></div>
        ${destLine}
      </div>
      <div style="text-align:center">
        <div class="scan-count">${l.scans}</div>
        <div class="small">scans</div>
      </div>
      <div class="link-actions">
        ${editAction}
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.png?token=${encodeURIComponent(token)}" download="qr-${l.id}.png">PNG</a>
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.svg?token=${encodeURIComponent(token)}" download="qr-${l.id}.svg">SVG</a>
        <button class="btn btn-sm" data-act="stats">Stats</button>
        <button class="btn btn-sm" data-act="del">✕</button>
      </div>`;
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
  box.innerHTML = `
    <label>Headline</label><input class="pe-headline" value="${escapeHtml(page.headline || '')}" />
    <label style="margin-top:8px">Subtitle</label><input class="pe-subtitle" value="${escapeHtml(page.subtitle || '')}" />
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
    try {
      await api('/api/links/' + l.id, { method: 'PUT', body: JSON.stringify({ page: { headline, subtitle, buttons: newButtons } }) });
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
    box.innerHTML = `<strong>${s.total} total scans</strong> · last 30 days
      <a class="btn btn-sm" style="float:right" target="_blank"
         href="/api/links/${l.id}/stats.csv?token=${encodeURIComponent(token)}">Export scans CSV</a>
      <div class="bars">${bars || '<span class="muted">no scans yet</span>'}</div>
      <div class="breakdowns">
        ${breakdown('Devices', s.devices)}
        ${breakdown('Browsers', s.browsers)}
        ${breakdown('Top referrers', s.referrers)}
      </div>`;
    el.after(box);
  } catch (e) {
    if (e.status === 402) toast('Analytics is a Pro feature — upgrade to unlock.', true);
    else toast('Could not load stats', true);
  }
}

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
    const blob = await res.blob();
    const img = $('#qrPreview'); if (!img) return;
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    const u = URL.createObjectURL(blob); img.src = u; img.dataset.url = u;
  } catch { /* ignore */ }
}
function currentStyle() {
  if (!document.getElementById('gradOn')?.checked) return null;
  return { gradient: { from: $('#gradFrom').value, to: $('#gradTo').value, type: $('#gradType').value, angle: 45 } };
}
function queuePreview() { clearTimeout(previewDeb); previewDeb = setTimeout(refreshPreview, 180); }
['#colorDark', '#colorBg', '#target', '#gradFrom', '#gradTo'].forEach((s) => document.querySelector(s)?.addEventListener('input', queuePreview));
['#logoShape', '#gradType', '#gradOn'].forEach((s) => document.querySelector(s)?.addEventListener('change', refreshPreview));
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

boot();

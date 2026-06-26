// DynaQR dashboard — talks to the JSON API using a token kept in localStorage.
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
    const r = await api('/api/signup', { method: 'POST', body: JSON.stringify({ email }) });
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
    const el = document.createElement('div');
    el.className = 'link-item';
    el.innerHTML = `
      <img class="link-qr" alt="QR" src="/api/links/${l.id}/qr.png?token=${encodeURIComponent(token)}" />
      <div class="link-main">
        <h4>${escapeHtml(l.title || '(untitled)')}</h4>
        <div class="small">QR → <span class="short">${l.shortUrl.replace(/^https?:\/\//, '')}</span></div>
        <div class="small">now points to: ${escapeHtml(l.target)}</div>
      </div>
      <div style="text-align:center">
        <div class="scan-count">${l.scans}</div>
        <div class="small">scans</div>
      </div>
      <div class="link-actions">
        <button class="btn btn-sm" data-act="edit">Edit dest</button>
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.png?token=${encodeURIComponent(token)}" download="qr-${l.id}.png">PNG</a>
        <a class="btn btn-sm" href="/api/links/${l.id}/qr.svg?token=${encodeURIComponent(token)}" download="qr-${l.id}.svg">SVG</a>
        <button class="btn btn-sm" data-act="stats">Stats</button>
        <button class="btn btn-sm" data-act="del">✕</button>
      </div>`;
    el.querySelector('[data-act=edit]').onclick = () => editDest(l);
    el.querySelector('[data-act=del]').onclick = () => delLink(l);
    el.querySelector('[data-act=stats]').onclick = () => showStats(l, el);
    wrap.appendChild(el);
  }
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot();

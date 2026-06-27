// Smart routing — one QR, context-aware destinations. Pure functions: sanitize the
// owner-supplied rules, and pick a destination per scan from the scanner's device
// or a round-robin A/B split. No external services.

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch { return null; }
}

function hhmmToMin(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function minLabel(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

export function sanitizeRules(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.type === 'device') {
    const ios = normalizeUrl(input.ios), android = normalizeUrl(input.android), def = normalizeUrl(input.default);
    if (!ios && !android) return null; // need at least one device target to be meaningful
    return { type: 'device', ios: ios || null, android: android || null, default: def || null };
  }
  if (input.type === 'split') {
    const urls = (Array.isArray(input.urls) ? input.urls : []).map(normalizeUrl).filter(Boolean).slice(0, 8);
    if (urls.length < 2) return null;
    return { type: 'split', urls };
  }
  if (input.type === 'time') {
    const tz = Number.isFinite(+input.tz) ? Math.max(-720, Math.min(840, Math.trunc(+input.tz))) : 0;
    const windows = (Array.isArray(input.windows) ? input.windows : []).map((w) => {
      const start = hhmmToMin(w && w.start), end = hhmmToMin(w && w.end), url = normalizeUrl(w && w.url);
      if (start == null || end == null || end <= start || !url) return null;
      return { start, end, url, label: String((w && w.label) || '').slice(0, 24) };
    }).filter(Boolean).slice(0, 6);
    if (!windows.length) return null;
    return { type: 'time', tz, windows, default: normalizeUrl(input.default) || null };
  }
  return null;
}

export function deviceOf(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

// minute-of-day (0..1439) for a timestamp shifted by a UTC offset (minutes).
function minuteOfDay(ts, tzOffsetMin = 0) {
  const d = new Date(ts || 0);
  let m = d.getUTCHours() * 60 + d.getUTCMinutes() + tzOffsetMin;
  return ((m % 1440) + 1440) % 1440;
}

// Returns { dest, variant } for a scan, or null to fall back to the base target.
// ctx: { ua, scanIndex, now }
export function evalRules(rules, ctx = {}) {
  const { ua = '', scanIndex = 0, now = 0 } = ctx;
  if (!rules) return null;
  if (rules.type === 'device') {
    const d = deviceOf(ua);
    const dest = d === 'ios' ? (rules.ios || rules.default) : d === 'android' ? (rules.android || rules.default) : rules.default;
    return { dest: dest || null, variant: d };
  }
  if (rules.type === 'split') {
    const n = rules.urls.length;
    if (!n) return null;
    const i = (((scanIndex % n) + n) % n);
    return { dest: rules.urls[i], variant: 'V' + (i + 1) };
  }
  if (rules.type === 'time') {
    const m = minuteOfDay(now, rules.tz || 0);
    for (const w of rules.windows) {
      if (m >= w.start && m < w.end) return { dest: w.url, variant: w.label || `${minLabel(w.start)}–${minLabel(w.end)}` };
    }
    return { dest: rules.default || null, variant: 'default' };
  }
  return null;
}

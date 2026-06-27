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
  return null;
}

export function deviceOf(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

// Returns the chosen destination, or null to fall back to the link's base target.
export function evalRules(rules, ua, scanIndex = 0) {
  if (!rules) return null;
  if (rules.type === 'device') {
    const d = deviceOf(ua);
    if (d === 'ios') return rules.ios || rules.default;
    if (d === 'android') return rules.android || rules.default;
    return rules.default;
  }
  if (rules.type === 'split') {
    const n = rules.urls.length;
    if (!n) return null;
    return rules.urls[(((scanIndex % n) + n) % n)];
  }
  return null;
}

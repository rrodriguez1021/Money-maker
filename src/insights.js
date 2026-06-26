// Derive human-readable breakdowns from raw scan rows. Pure functions, no deps —
// deliberately coarse heuristics (good enough for marketing analytics, not
// fingerprinting). Powers the device/OS/browser/referrer charts in the dashboard.

export function deviceType(ua = '') {
  if (/\b(iPad|Tablet)\b/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'Tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'Mobile';
  if (!ua) return 'Unknown';
  return 'Desktop';
}

export function osName(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

export function browserName(ua = '') {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return 'Other';
}

export function referrerHost(ref) {
  if (!ref) return 'Direct / scan';
  try {
    return new URL(ref).hostname.replace(/^www\./, '') || 'Direct / scan';
  } catch {
    return 'Other';
  }
}

// Count occurrences of a key function over scans, return sorted [{name, scans}].
function tally(scans, keyFn) {
  const counts = new Map();
  for (const s of scans) {
    const k = keyFn(s);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, scans: count }))
    .sort((a, b) => b.scans - a.scans);
}

export function summarizeScans(scans) {
  return {
    devices: tally(scans, (s) => deviceType(s.user_agent)),
    os: tally(scans, (s) => osName(s.user_agent)),
    browsers: tally(scans, (s) => browserName(s.user_agent)),
    referrers: tally(scans, (s) => referrerHost(s.referrer)).slice(0, 10),
  };
}

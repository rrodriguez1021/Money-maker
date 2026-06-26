// Scannability guard — estimates whether a styled QR will actually scan, so users
// get a warning before printing. Pure functions; WCAG-style contrast on the fill
// vs. background, plus checks for inverted (light-on-dark) and risky combos.

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// { level: 'ok'|'warn'|'risk', contrast, messages[] }
export function assessScannability({ colorDark, colorBg, gradient, hasLogo, module } = {}) {
  const bg = colorBg || '#ffffff';
  const fgs = gradient ? [gradient.from, gradient.to] : [colorDark || '#000000'];
  const minC = Math.min(...fgs.map((f) => contrast(f, bg)));
  const messages = [];
  let level = 'ok';
  if (minC < 1.6) { level = 'risk'; messages.push('Very low contrast — this code likely will not scan.'); }
  else if (minC < 3) { level = 'warn'; messages.push('Low contrast — test on a phone before printing.'); }
  if (lum(bg) < Math.min(...fgs.map(lum))) {
    if (level === 'ok') level = 'warn';
    messages.push('Light-on-dark codes do not scan on every reader.');
  }
  if (module === 'dot' && hasLogo && level === 'ok') {
    messages.push('Dots + a center logo is bold but tighter on error budget — keep the logo small and test it.');
  }
  return { level, contrast: Math.round(minC * 10) / 10, messages };
}

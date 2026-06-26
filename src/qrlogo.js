// QR rendering with an optional center logo (Business tier). Pure-JS: pngjs for
// raster compositing, string injection for SVG. When a logo is present we force
// error-correction level H so the obscured center still scans reliably.
import { PNG } from 'pngjs';
import QRCode from 'qrcode';

const DATA_PNG = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
export const LOGO_MAX_BYTES = 300 * 1024;

// Validate a logo data URL: must be a base64 PNG within the size cap and decodable.
export function isValidLogo(dataUrl) {
  const m = DATA_PNG.exec(dataUrl || '');
  if (!m) return false;
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) return false;
  try { PNG.sync.read(bytes); return true; } catch { return false; }
}

function decodeLogo(dataUrl) {
  const m = DATA_PNG.exec(dataUrl || '');
  if (!m) return null;
  try { return PNG.sync.read(Buffer.from(m[1], 'base64')); } catch { return null; }
}

// Nearest-neighbor scale (no native deps). Fine for small center logos.
function scale(src, tw, th) {
  const dst = new PNG({ width: tw, height: th });
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, (y * src.height / th) | 0);
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, (x * src.width / tw) | 0);
      const si = (src.width * sy + sx) << 2;
      const di = (tw * y + x) << 2;
      dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

// Return the raw module grid (1 = dark) for building a QR in the client (e.g. the
// 3D hero "forge"). No image — just the matrix.
export function qrMatrix(text, ecc = 'M') {
  const qr = QRCode.create(String(text || ''), { errorCorrectionLevel: ecc });
  return { size: qr.modules.size, data: Array.from(qr.modules.data) };
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [11, 13, 23];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Is (x,y) inside a rounded rectangle [rx,ry,w,h] with corner radius r?
function inRoundedRect(x, y, rx, ry, w, h, r) {
  const x0 = rx + r, x1 = rx + w - r, y0 = ry + r, y1 = ry + h - r;
  if (x >= x0 && x <= x1) return y >= ry && y <= ry + h;
  if (y >= y0 && y <= y1) return x >= rx && x <= rx + w;
  const cxp = x < x0 ? x0 : x1, cyp = y < y0 ? y0 : y1;
  return (x - cxp) ** 2 + (y - cyp) ** 2 <= r * r;
}

// A pixel-color function for a fill across a W×W image.
function pixelFill(gradient, W) {
  const from = hexToRgb(gradient.from), to = hexToRgb(gradient.to);
  const mix = (t) => { t = Math.max(0, Math.min(1, t)); return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t)]; };
  if (gradient.type === 'radial') {
    const cx = W / 2, cy = W / 2, R = W * 0.72;
    return (x, y) => mix(Math.hypot(x - cx, y - cy) / R);
  }
  const a = ((gradient.angle ?? 45) * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  const span = W * (Math.abs(dx) + Math.abs(dy));
  return (x, y) => mix((x * dx + y * dy) / span + (dx < 0 || dy < 0 ? 1 : 0));
}
// Recolor the dark modules of a solid black/white QR with a gradient.
function applyGradient(png, gradient) {
  const fn = pixelFill(gradient, png.width);
  const d = png.data;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      if (d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110) {
        const c = fn(x, y); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      }
    }
  }
}
function gradientDefs(id, g) {
  const stops = `<stop offset="0%" stop-color="${g.from}"/><stop offset="100%" stop-color="${g.to}"/>`;
  if (g.type === 'radial') return `<defs><radialGradient id="${id}">${stops}</radialGradient></defs>`;
  const a = ((g.angle ?? 45) * Math.PI) / 180;
  const x1 = (0.5 - Math.cos(a) / 2).toFixed(3), y1 = (0.5 - Math.sin(a) / 2).toFixed(3);
  const x2 = (0.5 + Math.cos(a) / 2).toFixed(3), y2 = (0.5 + Math.sin(a) / 2).toFixed(3);
  return `<defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient></defs>`;
}

// ---- Custom matrix renderer (for rounded/dot modules + styled eyes) ----
const QZ = 4; // quiet-zone modules
function paint(png, x0, y0, w, h, kind, radius, fn) {
  const W = png.width, cx = x0 + w / 2, cy = y0 + h / 2, rx = w / 2, ry = h / 2;
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
    if (y < 0 || y >= png.height) continue;
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
      if (x < 0 || x >= W) continue;
      if (kind === 'disc') { const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry; if (nx * nx + ny * ny > 1) continue; }
      else if (kind === 'round') { if (!inRoundedRect(x, y, x0, y0, w, h, radius)) continue; }
      const c = fn(x, y), i = (W * y + x) << 2;
      png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
    }
  }
}
function eyePng(png, x0, y0, S, cell, eye, fn, lc) {
  const lcFn = () => lc;
  if (eye === 'dot') {
    paint(png, x0, y0, S, S, 'disc', 0, fn);
    paint(png, x0 + cell, y0 + cell, S - 2 * cell, S - 2 * cell, 'disc', 0, lcFn);
    paint(png, x0 + 2 * cell, y0 + 2 * cell, S - 4 * cell, S - 4 * cell, 'disc', 0, fn);
  } else { // rounded
    paint(png, x0, y0, S, S, 'round', S * 0.28, fn);
    paint(png, x0 + cell, y0 + cell, S - 2 * cell, S - 2 * cell, 'round', (S - 2 * cell) * 0.22, lcFn);
    paint(png, x0 + 2 * cell, y0 + 2 * cell, S - 4 * cell, S - 4 * cell, 'round', (S - 4 * cell) * 0.3, fn);
  }
}
function renderModulesPng(text, { width, ecc, light, dark, gradient, module, eye }) {
  const { size: n, data } = qrMatrix(text, ecc);
  const total = n + 2 * QZ, cell = Math.max(2, Math.floor(width / total)), W = cell * total;
  const png = new PNG({ width: W, height: W });
  const lc = hexToRgb(light);
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = lc[0]; png.data[i + 1] = lc[1]; png.data[i + 2] = lc[2]; png.data[i + 3] = 255; }
  const fn = gradient ? pixelFill(gradient, W) : () => hexToRgb(dark);
  const finder = (mx, my) => (mx < 7 && my < 7) || (mx >= n - 7 && my < 7) || (mx < 7 && my >= n - 7);
  for (let my = 0; my < n; my++) {
    for (let mx = 0; mx < n; mx++) {
      if (!data[my * n + mx] || finder(mx, my)) continue;
      const x0 = (mx + QZ) * cell, y0 = (my + QZ) * cell;
      if (module === 'dot') paint(png, x0, y0, cell, cell, 'disc', 0, fn);
      else if (module === 'rounded') paint(png, x0, y0, cell, cell, 'round', cell * 0.34, fn);
      else paint(png, x0, y0, cell, cell, 'rect', 0, fn);
    }
  }
  const eyeStyle = eye === 'square' ? (module === 'dot' ? 'dot' : 'rounded') : eye;
  for (const [ex, ey] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    eyePng(png, (ex + QZ) * cell, (ey + QZ) * cell, 7 * cell, cell, eyeStyle, fn, lc);
  }
  return png;
}

function overlayLogoPng(base, decoded, { logoShape, color, gradient }) {
  const Wd = base.width;
  const size = Math.round(Wd * 0.22), pad = Math.round(size * 0.16), box = size + pad * 2, off = (Wd - box) >> 1;
  const circle = logoShape === 'circle';
  const cx = off + box / 2, cy = off + box / 2, R = box / 2, corner = Math.round(box * 0.2);
  const ring = hexToRgb((color && color.dark) || (gradient && gradient.to) || '#0b0d17');
  const ringW = Math.max(2, box * 0.045);
  const setPx = (x, y, r, g, b) => { const i = (Wd * y + x) << 2; base.data[i] = r; base.data[i + 1] = g; base.data[i + 2] = b; base.data[i + 3] = 255; };
  for (let y = off; y < off + box; y++) {
    for (let x = off; x < off + box; x++) {
      if (circle) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > R) continue;
        if (d > R - ringW) setPx(x, y, ring[0], ring[1], ring[2]); else setPx(x, y, 255, 255, 255);
      } else {
        if (!inRoundedRect(x, y, off, off, box, box, corner)) continue;
        setPx(x, y, 255, 255, 255);
      }
    }
  }
  const small = scale(decoded, size, size);
  const lo = off + pad, lcx = size / 2, lcy = size / 2, lR = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (circle && (x - lcx) ** 2 + (y - lcy) ** 2 > lR * lR) continue;
      const si = (size * y + x) << 2, a = small.data[si + 3] / 255;
      if (a === 0) continue;
      const di = (Wd * (lo + y) + (lo + x)) << 2;
      base.data[di] = Math.round(small.data[si] * a + 255 * (1 - a));
      base.data[di + 1] = Math.round(small.data[si + 1] * a + 255 * (1 - a));
      base.data[di + 2] = Math.round(small.data[si + 2] * a + 255 * (1 - a));
      base.data[di + 3] = 255;
    }
  }
}

export async function qrPng(text, { width = 512, color, logo, logoShape = 'square', gradient, module = 'square', eye = 'square' } = {}) {
  const ecc = logo ? 'H' : 'M';
  const custom = module !== 'square' || eye !== 'square';
  let base;
  if (custom) {
    base = renderModulesPng(text, { width, ecc, light: (color && color.light) || '#ffffff', dark: (color && color.dark) || '#000000', gradient, module, eye });
  } else if (gradient) {
    base = PNG.sync.read(await QRCode.toBuffer(text, { width, margin: 1, errorCorrectionLevel: ecc, color: { dark: '#000000', light: (color && color.light) || '#ffffff' } }));
    applyGradient(base, gradient);
  } else {
    const buf = await QRCode.toBuffer(text, { width, margin: 1, errorCorrectionLevel: ecc, color });
    if (!logo) return buf;
    base = PNG.sync.read(buf);
  }
  const decoded = logo ? decodeLogo(logo) : null;
  if (decoded) overlayLogoPng(base, decoded, { logoShape, color, gradient });
  return PNG.sync.write(base);
}

// SVG fragments for custom module/eye shapes.
function moduleSvg(x, y, module, fill) {
  if (module === 'dot') return `<circle cx="${(x + 0.5).toFixed(2)}" cy="${(y + 0.5).toFixed(2)}" r="0.46" fill="${fill}"/>`;
  if (module === 'rounded') return `<rect x="${x}" y="${y}" width="1" height="1" rx="0.34" fill="${fill}"/>`;
  return `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`;
}
function eyeSvg(x, y, eye, fill, light) {
  if (eye === 'dot') {
    return `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="3.5" fill="${fill}"/>` +
      `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="2.5" fill="${light}"/>` +
      `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${fill}"/>`;
  }
  return `<rect x="${x}" y="${y}" width="7" height="7" rx="2" fill="${fill}"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.4" fill="${light}"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${fill}"/>`;
}
function renderModulesSvg(text, { width, ecc, light, dark, gradient, module, eye }) {
  const { size: n, data } = qrMatrix(text, ecc);
  const total = n + 2 * QZ;
  const fill = gradient ? 'url(#qg)' : dark;
  const defs = gradient ? gradientDefs('qg', gradient) : '';
  const finder = (mx, my) => (mx < 7 && my < 7) || (mx >= n - 7 && my < 7) || (mx < 7 && my >= n - 7);
  let body = `<rect width="${total}" height="${total}" fill="${light}"/>`;
  for (let my = 0; my < n; my++) {
    for (let mx = 0; mx < n; mx++) {
      if (!data[my * n + mx] || finder(mx, my)) continue;
      body += moduleSvg(mx + QZ, my + QZ, module, fill);
    }
  }
  const eyeStyle = eye === 'square' ? (module === 'dot' ? 'dot' : 'rounded') : eye;
  for (const [ex, ey] of [[0, 0], [n - 7, 0], [0, n - 7]]) body += eyeSvg(ex + QZ, ey + QZ, eyeStyle, fill, light);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${total} ${total}">${defs}${body}</svg>`;
}

function overlayLogoSvg(svg, { logo, logoShape, color, gradient }) {
  if (!logo || !DATA_PNG.test(logo)) return svg;
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg);
  const N = vb ? Number(vb[1]) : 33;
  const size = N * 0.22, pad = size * 0.16, box = size + pad * 2, off = (N - box) / 2, lo = off + pad;
  const ring = (color && color.dark) || (gradient && gradient.to) || '#0b0d17';
  let overlay;
  if (logoShape === 'circle') {
    const cx = off + box / 2, cy = off + box / 2, r = box / 2, lr = size / 2, id = `qc${Math.round(off * 100)}`;
    overlay =
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="#ffffff"/>` +
      `<defs><clipPath id="${id}"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${lr.toFixed(2)}"/></clipPath></defs>` +
      `<image x="${lo.toFixed(2)}" y="${lo.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice" href="${logo}"/>` +
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="${ring}" stroke-width="${(box * 0.045).toFixed(2)}"/>`;
  } else {
    overlay =
      `<rect x="${off.toFixed(2)}" y="${off.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}" rx="${(box * 0.2).toFixed(2)}" fill="#ffffff"/>` +
      `<image x="${lo.toFixed(2)}" y="${lo.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" preserveAspectRatio="xMidYMid meet" href="${logo}"/>`;
  }
  return svg.replace('</svg>', overlay + '</svg>');
}

export async function qrSvg(text, { width = 512, color, logo, logoShape = 'square', gradient, module = 'square', eye = 'square' } = {}) {
  const ecc = logo ? 'H' : 'M';
  const custom = module !== 'square' || eye !== 'square';
  let svg;
  if (custom) {
    svg = renderModulesSvg(text, { width, ecc, light: (color && color.light) || '#ffffff', dark: (color && color.dark) || '#000000', gradient, module, eye });
  } else if (gradient) {
    svg = await QRCode.toString(text, { type: 'svg', width, margin: 1, errorCorrectionLevel: ecc, color: { dark: '#000000', light: (color && color.light) || '#ffffff' } });
    svg = svg.replace(/(<svg[^>]*>)/, `$1${gradientDefs('qg', gradient)}`).replace('stroke="#000000"', 'stroke="url(#qg)"');
  } else {
    svg = await QRCode.toString(text, { type: 'svg', width, margin: 1, errorCorrectionLevel: ecc, color });
  }
  return overlayLogoSvg(svg, { logo, logoShape, color, gradient });
}

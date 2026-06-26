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

export async function qrPng(text, { width = 512, color, logo, logoShape = 'square' } = {}) {
  const ecc = logo ? 'H' : 'M';
  const buf = await QRCode.toBuffer(text, { width, margin: 1, errorCorrectionLevel: ecc, color });
  const decoded = logo && decodeLogo(logo);
  if (!decoded) return buf;
  const base = PNG.sync.read(buf);
  const size = Math.round(width * 0.22);
  const pad = Math.round(size * 0.16);
  const box = size + pad * 2;
  const off = (width - box) >> 1;
  const circle = logoShape === 'circle';
  const cx = off + box / 2, cy = off + box / 2, R = box / 2;
  const corner = Math.round(box * 0.2);
  const ring = hexToRgb((color && color.dark) || '#0b0d17');
  const ringW = Math.max(2, box * 0.045);
  const setPx = (x, y, r, g, b) => { const i = (width * y + x) << 2; base.data[i] = r; base.data[i + 1] = g; base.data[i + 2] = b; base.data[i + 3] = 255; };
  // Knockout + ring.
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
  // Composite logo (circle-masked when round).
  const small = scale(decoded, size, size);
  const lo = off + pad, lcx = size / 2, lcy = size / 2, lR = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (circle && (x - lcx) ** 2 + (y - lcy) ** 2 > lR * lR) continue;
      const si = (size * y + x) << 2;
      const a = small.data[si + 3] / 255;
      if (a === 0) continue;
      const di = (width * (lo + y) + (lo + x)) << 2;
      base.data[di] = Math.round(small.data[si] * a + 255 * (1 - a));
      base.data[di + 1] = Math.round(small.data[si + 1] * a + 255 * (1 - a));
      base.data[di + 2] = Math.round(small.data[si + 2] * a + 255 * (1 - a));
      base.data[di + 3] = 255;
    }
  }
  return PNG.sync.write(base);
}

export async function qrSvg(text, { width = 512, color, logo, logoShape = 'square' } = {}) {
  const ecc = logo ? 'H' : 'M';
  const svg = await QRCode.toString(text, { type: 'svg', width, margin: 1, errorCorrectionLevel: ecc, color });
  if (!logo || !DATA_PNG.test(logo)) return svg;
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const N = vb ? Number(vb[1]) : width;       // QR coordinate system is in module units
  const size = N * 0.22, pad = size * 0.16, box = size + pad * 2;
  const off = (N - box) / 2, lo = off + pad;
  const ring = (color && color.dark) || '#0b0d17';
  let overlay;
  if (logoShape === 'circle') {
    const cx = off + box / 2, cy = off + box / 2, r = box / 2, lr = size / 2;
    const id = `qc${Math.round(off * 100)}`;
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

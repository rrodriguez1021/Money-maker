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

export async function qrPng(text, { width = 512, color, logo } = {}) {
  const ecc = logo ? 'H' : 'M';
  const buf = await QRCode.toBuffer(text, { width, margin: 1, errorCorrectionLevel: ecc, color });
  const decoded = logo && decodeLogo(logo);
  if (!decoded) return buf;
  const base = PNG.sync.read(buf);
  const size = Math.round(width * 0.22);
  const pad = Math.round(size * 0.16);
  const box = size + pad * 2;
  const off = (width - box) >> 1;
  // White rounded-ish backing (square is fine for scannability).
  for (let y = off; y < off + box; y++) {
    for (let x = off; x < off + box; x++) {
      const i = (width * y + x) << 2;
      base.data[i] = 255; base.data[i + 1] = 255; base.data[i + 2] = 255; base.data[i + 3] = 255;
    }
  }
  const small = scale(decoded, size, size);
  const lo = off + pad;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
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

export async function qrSvg(text, { width = 512, color, logo } = {}) {
  const ecc = logo ? 'H' : 'M';
  const svg = await QRCode.toString(text, { type: 'svg', width, margin: 1, errorCorrectionLevel: ecc, color });
  if (!logo || !DATA_PNG.test(logo)) return svg;
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const N = vb ? Number(vb[1]) : width;       // QR coordinate system is in module units
  const size = N * 0.22, pad = size * 0.16, box = size + pad * 2;
  const off = (N - box) / 2, lo = off + pad;
  const overlay =
    `<rect x="${off.toFixed(2)}" y="${off.toFixed(2)}" width="${box.toFixed(2)}" height="${box.toFixed(2)}" rx="${(box * 0.14).toFixed(2)}" fill="#ffffff"/>` +
    `<image x="${lo.toFixed(2)}" y="${lo.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" preserveAspectRatio="xMidYMid meet" href="${logo}"/>`;
  return svg.replace('</svg>', overlay + '</svg>');
}

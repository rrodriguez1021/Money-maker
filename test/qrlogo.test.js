import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { qrPng, qrSvg, isValidLogo, LOGO_MAX_BYTES } from '../src/qrlogo.js';

// Build a tiny solid PNG data URL for use as a logo.
function logoDataUrl(w = 48, h = 48, rgb = [255, 0, 0]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = 255;
  }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

test('isValidLogo accepts a real PNG data URL and rejects junk', () => {
  assert.equal(isValidLogo(logoDataUrl()), true);
  assert.equal(isValidLogo('data:image/png;base64,not-base64!!'), false);
  assert.equal(isValidLogo('data:image/gif;base64,AAAA'), false);
  assert.equal(isValidLogo(''), false);
  assert.equal(isValidLogo(null), false);
});

test('isValidLogo enforces the size cap', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil(LOGO_MAX_BYTES * 1.4));
  assert.equal(isValidLogo(big), false);
});

test('qrPng without a logo returns a valid PNG; with a logo it still decodes', async () => {
  const plain = await qrPng('https://example.com/x', { width: 300 });
  assert.ok(PNG.sync.read(plain).width === 300);
  const withLogo = await qrPng('https://example.com/x', { width: 300, logo: logoDataUrl() });
  const decoded = PNG.sync.read(withLogo);
  assert.equal(decoded.width, 300);
  // Center pixel should now be the logo color (red), not black/white QR.
  const c = (decoded.width * 150 + 150) << 2;
  assert.ok(decoded.data[c] > 200 && decoded.data[c + 1] < 60, 'center is the logo color');
});

test('qrSvg injects an <image> overlay only when a logo is provided', async () => {
  const plain = await qrSvg('https://example.com/x', { width: 300 });
  assert.ok(!plain.includes('<image'));
  const withLogo = await qrSvg('https://example.com/x', { width: 300, logo: logoDataUrl() });
  assert.match(withLogo, /<image[^>]+href="data:image\/png;base64,/);
  assert.match(withLogo, /<\/svg>\s*$/);
  // The overlay must come before the closing tag, not after it.
  assert.ok(withLogo.indexOf('<image') < withLogo.indexOf('</svg>'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePage, renderPage, escapeHtml } from '../src/page.js';

test('sanitizePage keeps valid content and drops bad buttons', () => {
  const p = sanitizePage({
    headline: 'Joe\'s Coffee',
    subtitle: 'Order online',
    buttons: [
      { label: 'Menu', url: 'example.com/menu' },     // gets https:// prefix
      { label: 'Call', url: 'tel:+15551234567' },      // contact link allowed
      { label: 'Bad', url: 'javascript:alert(1)' },    // dropped
      { label: '', url: 'example.com' },               // dropped (no label)
    ],
  });
  assert.equal(p.headline, "Joe's Coffee");
  assert.equal(p.buttons.length, 2);
  assert.equal(p.buttons[0].url, 'https://example.com/menu');
  assert.equal(p.buttons[1].url, 'tel:+15551234567');
});

test('sanitizePage returns null when there is nothing to show', () => {
  assert.equal(sanitizePage({ buttons: [] }), null);
  assert.equal(sanitizePage(null), null);
  assert.equal(sanitizePage({ headline: '   ' }), null);
});

test('accent color gated by branding flag', () => {
  assert.equal(sanitizePage({ headline: 'X', accent: '#112233' }, false).accent, undefined);
  assert.equal(sanitizePage({ headline: 'X', accent: '#112233' }, true).accent, '#112233');
  assert.equal(sanitizePage({ headline: 'X', accent: 'red' }, true).accent, undefined);
});

test('renderPage escapes user content (no XSS)', () => {
  const html = renderPage({ headline: '<script>alert(1)</script>', subtitle: '"hi"', buttons: [
    { label: '<b>x</b>', url: 'https://example.com/"><script>' },
  ] });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('escapeHtml basics', () => {
  assert.equal(escapeHtml('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUICSS } from '../toolsuite/src/uiCode.js';

const ASSETS = ['/assets/logo.png', 'assets/hud.woff2', 'fonts/custom.ttf'];

test('clean project CSS reports no problems', () => {
  const css = `
    [data-screen="hud"] [data-element="ammo"] { color: #9af2d8; }
    .ui-bar .fill { box-shadow: inset 0 0 6px #000; }
    .ui-button:hover { filter: brightness(1.2); }
    @keyframes pulse { 50% { opacity: .7; } }
    @media (min-width: 800px) { .ui-text { font-size: 18px; } }
    @font-face { font-family: Custom; src: url("assets/hud.woff2"); }
  `;
  assert.deepEqual(validateUICSS(css, { assets: ASSETS }), []);
});

test('@import, script URLs and expression() are refused with plain errors', () => {
  for (const [snippet, needle] of [
    ['@import url("theme.css");', '@import'],
    ['background: url(javascript:alert(1));', 'Script URLs'],
    ['width: expression(document.body.clientWidth);', 'expression()']
  ]) {
    const problems = validateUICSS(snippet, { assets: ASSETS });
    assert.ok(problems.some(p => p.level === 'error' && p.message.includes(needle)), snippet);
  }
});

test('brace and bracket structure errors are reported once, plainly', () => {
  const unclosed = validateUICSS('.ui-text { color: red;', { assets: ASSETS });
  assert.ok(unclosed.some(p => p.level === 'error' && p.message.includes('never closed')));
  const stray = validateUICSS('.ui-text } color: red; {', { assets: ASSETS });
  assert.ok(stray.some(p => p.level === 'error' && p.message.includes('without a matching')));
  const parens = validateUICSS('.ui-text { color: rgb(255, 0, 0; }', { assets: ASSETS });
  assert.ok(parens.some(p => p.level === 'error' && p.message.includes('Round brackets')));
});

test('unterminated comments are caught', () => {
  const problems = validateUICSS('/* a comment that never ends .ui-text { color: red; }', { assets: ASSETS });
  assert.ok(problems.some(p => p.level === 'error' && p.message.includes('never closed')));
});

test('braces inside strings and comments do not break structure checks', () => {
  const css = `.ui-text::after { content: "{"; } /* decorative { { { */ .ui-bar { color: #fff; }`;
  assert.deepEqual(validateUICSS(css, { assets: ASSETS }), []);
});

test('unknown at-rules warn, known ones stay silent', () => {
  const unknown = validateUICSS('@foo { color: red; }', { assets: ASSETS });
  assert.ok(unknown.some(p => p.level === 'warn' && p.message.includes('@foo')));
  assert.deepEqual(validateUICSS('@font-face { src: url(assets/hud.woff2); }', { assets: ASSETS }), []);
});

test('url() targets must be project assets, data or web URLs', () => {
  assert.deepEqual(validateUICSS('background:url(/assets/logo.png)', { assets: ASSETS }), []);
  assert.deepEqual(validateUICSS('background:url("https://example.com/i.png")', { assets: ASSETS }), []);
  const missing = validateUICSS('background:url(images/gone.png)', { assets: ASSETS });
  assert.ok(missing.some(p => p.level === 'warn' && p.message.includes('images/gone.png')));
});

'use strict';
// Guards the read-only promise: the extension may only send GET requests, only
// to ESPN's read API, and may not touch forms or click anything on ESPN pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHIPPED = ['background.js', 'src/content.js', 'src/engine.js', 'src/espn.js', 'src/ui.js'];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('only espn.js and background.js make network calls, one fetch each', () => {
  for (const f of SHIPPED) {
    const n = (read(f).match(/\bfetch\s*\(/g) || []).length;
    const expected = f === 'src/espn.js' || f === 'background.js' ? 1 : 0;
    assert.equal(n, expected, `${f} has ${n} fetch() calls`);
  }
});

test('every request method is GET', () => {
  for (const f of SHIPPED) {
    const src = read(f);
    for (const m of src.matchAll(/method\s*:\s*['"`](\w+)['"`]/g)) assert.equal(m[1], 'GET', `${f} uses ${m[1]}`);
    assert.ok(!/\b(POST|PUT|PATCH|DELETE)\b/.test(src), `${f} mentions a write method`);
  }
});

test('no other ways to send data or act on the page', () => {
  const banned = [/XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /\.submit\s*\(/, /\.click\s*\(\s*\)/, /dispatchEvent/, /document\.forms/, /chrome\.cookies/];
  for (const f of SHIPPED) {
    const src = read(f);
    for (const re of banned) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
});

test('the only hosts referenced are ESPN read API and the ESPN fantasy site', () => {
  const allowed = new Set(['lm-api-reads.fantasy.espn.com', 'fantasy.espn.com']);
  for (const f of SHIPPED) {
    for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.ok(allowed.has(m[1]), `${f} references ${m[1]}`);
  }
});

test('manifest asks for the minimum: storage + ESPN read API', () => {
  const mf = JSON.parse(read('manifest.json'));
  assert.deepEqual(mf.permissions, ['storage']);
  assert.deepEqual(mf.host_permissions, ['https://lm-api-reads.fantasy.espn.com/*']);
  assert.deepEqual(mf.content_scripts[0].matches, ['https://fantasy.espn.com/football/*']);
});

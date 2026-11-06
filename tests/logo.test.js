'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Logo = require('../src/logo.js');

test('logo: a football on a field at every icon size, with less detail when small', () => {
  for (const size of [16, 28, 48, 128]) {
    const svg = Logo.svg({ size });
    assert.match(svg, new RegExp(`width="${size}" height="${size}"`));
    assert.match(svg, /class="th-field"/);
    assert.match(svg, /class="th-ball"/);
    assert.match(svg, /class="th-laces"/);
    assert.doesNotMatch(svg, /th-moving/, 'still unless asked');
  }
  assert.doesNotMatch(Logo.svg({ size: 16 }), /th-trail/, 'no speed lines at 16px');
  assert.match(Logo.svg({ size: 128 }), /th-trail/);
  // each copy clips with its own id, so two logos on one page can't share a clip by accident
  const ids = [Logo.svg({}), Logo.svg({})].map((s) => /clipPath id="([^"]+)"/.exec(s)[1]);
  assert.notEqual(ids[0], ids[1]);
  assert.match(Logo.svg({ round: true }), /rx="64"/);
});

test('logo: moves only when asked, keeps its phase across redraws, holds still for reduced motion', () => {
  const svg = Logo.svg({ size: 28, motion: true });
  assert.match(svg, /th-moving/);
  assert.match(svg, /--th-t:-\d+ms/);
  assert.match(Logo.CSS, /prefers-reduced-motion: reduce\) \{ \.th-logo \* \{ animation: none !important; \} \}/);
  for (const name of ['th-field-0', 'th-field-1', 'th-field-2', 'th-bob', 'th-shadow', 'th-spin', 'th-whoosh']) {
    assert.match(Logo.CSS, new RegExp(`@keyframes ${name} `));
  }
});

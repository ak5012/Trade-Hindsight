/*
 * Trade Hindsight - the logo: a football in flight over a striped field.
 *
 * One drawing for every place the logo appears. svg() returns SVG markup;
 * with motion on, the field scrolls under the ball, the ball bobs and spins,
 * and yellow speed lines trail it. CSS holds the animation, and holds still
 * for anyone who has asked their system for reduced motion.
 * tools/make-icons.js renders the still version into the toolbar icons.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.THLogo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELD = '#277d3f', STRIPE = '#2f9149', EDGE = '#1a5a2c';
  const BALL = '#8a4520', BALL_EDGE = '#3b1d0c', LACE = '#f6f1e7', MARK = '#ffe066';

  // Less detail at small sizes, so the ball stays readable at 16px.
  const DETAIL = [
    { bands: 3, line: 7, stroke: 7, lace: 7, stitches: [-10, 0, 10], scale: 0.95, hashes: false, tips: false, trail: false },
    { bands: 4, line: 5, stroke: 5, lace: 5, stitches: [-8, 0, 8], scale: 0.86, hashes: false, tips: true, trail: true },
    { bands: 6, line: 2.5, stroke: 3.5, lace: 3.4, stitches: [-10, -5, 0, 5, 10], scale: 0.84, hashes: true, tips: true, trail: true },
  ];
  const CYCLE = 1600; // ms; every animation below divides it

  let uid = 0;
  const n = (v) => +v.toFixed(2);

  /**
   * svg({ size, motion, round }): the logo as an SVG string.
   * round clips it to a circle instead of the icon's rounded square.
   */
  function svg(opts) {
    const o = opts || {};
    const size = o.size || 128;
    const level = size < 20 ? 0 : size < 40 ? 1 : 2;
    const d = DETAIL[level];
    const band = 128 / d.bands;
    const rx = o.round ? 64 : 28;
    const clip = `th-logo-clip-${++uid}`;

    // The field is drawn two bands wider than the icon so it can scroll by two bands and loop.
    let field = '';
    const count = d.bands + 3;
    for (let i = 0; i < count; i++) field += `<rect x="${n(i * band)}" width="${n(band + 0.5)}" height="128" fill="${i % 2 ? STRIPE : FIELD}"/>`;
    for (let i = 1; i < count; i++) field += `<path d="M${n(i * band)} 0V128" stroke="#fff" stroke-opacity=".82" stroke-width="${d.line}"/>`;
    if (d.hashes) {
      for (let i = 0; i < count; i++) {
        for (let k = 1; k < 5; k++) {
          const x = n(i * band + (k * band) / 5);
          field += `<path d="M${x} 20v7M${x} 101v7" stroke="#fff" stroke-opacity=".6" stroke-width="1.6"/>`;
        }
      }
    }

    const trail = d.trail
      ? [[-11, -54, -68], [0, -56, -78], [11, -54, -66]].map(([y, x1, x2], i) =>
        `<path class="th-trail th-trail-${i}" d="M${x1} ${y}H${x2}" stroke="${MARK}" stroke-width="${level === 2 ? 5 : 8}" stroke-linecap="round"/>`).join('')
      : '';
    const tips = d.tips
      ? `<path d="M30 -18Q26 0 30 18M-30 -18Q-26 0 -30 18" fill="none" stroke="${LACE}" stroke-width="${d.lace + 0.6}"/>`
      : '';
    const highlight = level === 2
      ? '<path d="M-36 -8C-22 -26 22 -26 36 -8C22 -18 -22 -18 -36 -8Z" fill="#fff" fill-opacity=".16"/>'
      : '';
    const laces = `<path d="M-15 -1H15${d.stitches.map((x) => `M${x} -6V4`).join('')}" fill="none" stroke="${LACE}" stroke-width="${d.lace}" stroke-linecap="round"/>`;

    const style = o.motion ? ` style="--th-t:-${Math.round(now() % CYCLE)}ms"` : '';
    return `<svg class="th-logo th-d${level}${o.motion ? ' th-moving' : ''}" viewBox="0 0 128 128" width="${size}" height="${size}"${style} aria-hidden="true" focusable="false">`
      + `<defs><clipPath id="${clip}"><rect width="128" height="128" rx="${rx}"/></clipPath></defs>`
      + `<g clip-path="url(#${clip})">`
      + `<rect width="128" height="128" fill="${FIELD}"/>`
      + `<g class="th-field">${field}</g>`
      + `<ellipse class="th-shadow" cx="66" cy="109" rx="30" ry="5.5" fill="#0b2a15" fill-opacity=".38"/>`
      + `<g class="th-ball"><g transform="translate(64 60) rotate(-30) scale(${d.scale})">`
      + trail
      + `<path d="M-46 0C-30 -36 30 -36 46 0C30 36 -30 36 -46 0Z" fill="${BALL}" stroke="${BALL_EDGE}" stroke-width="${d.stroke}" stroke-linejoin="round"/>`
      + highlight + tips
      + `<g class="th-laces">${laces}</g>`
      + '</g></g></g>'
      + `<rect x="1.5" y="1.5" width="125" height="125" rx="${rx - 1.5}" fill="none" stroke="${EDGE}" stroke-width="3"/>`
      + '</svg>';
  }

  // Keeps the animation's phase when the panel redraws, so the ball doesn't jump back to its start.
  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // Scoped to whichever shadow root shows the logo.
  const CSS = `
    .th-logo { display: block; flex: none; }
    .th-moving .th-field, .th-moving .th-ball, .th-moving .th-shadow, .th-moving .th-laces, .th-moving .th-trail {
      animation-duration: ${CYCLE}ms; animation-iteration-count: infinite; animation-delay: var(--th-t, 0ms);
    }
    .th-moving .th-field { animation-name: th-field-2; animation-timing-function: linear; }
    .th-moving.th-d0 .th-field { animation-name: th-field-0; }
    .th-moving.th-d1 .th-field { animation-name: th-field-1; }
    .th-moving .th-ball { animation-name: th-bob; animation-timing-function: ease-in-out; transform-box: fill-box; transform-origin: center; }
    .th-moving .th-shadow { animation-name: th-shadow; animation-timing-function: ease-in-out; transform-box: fill-box; transform-origin: center; }
    .th-moving .th-laces { animation-name: th-spin; animation-duration: ${CYCLE / 2}ms; animation-timing-function: ease-in-out; transform-box: fill-box; transform-origin: center; }
    .th-moving .th-trail { animation-name: th-whoosh; animation-duration: ${CYCLE / 2}ms; animation-timing-function: ease-out; }
    .th-moving .th-trail-1 { animation-delay: calc(var(--th-t, 0ms) - ${CYCLE / 6}ms); }
    .th-moving .th-trail-2 { animation-delay: calc(var(--th-t, 0ms) - ${CYCLE / 3}ms); }
    @keyframes th-field-0 { to { transform: translateX(${n(-256 / 3)}px); } }
    @keyframes th-field-1 { to { transform: translateX(-64px); } }
    @keyframes th-field-2 { to { transform: translateX(${n(-128 / 3)}px); } }
    @keyframes th-bob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-5px) rotate(-3deg); } }
    @keyframes th-shadow { 0%, 100% { transform: scaleX(1); opacity: 1; } 50% { transform: scaleX(.78); opacity: .6; } }
    @keyframes th-spin { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(.45); } }
    @keyframes th-whoosh { 0% { transform: translateX(6px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(-10px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .th-logo * { animation: none !important; } }
  `;

  return { svg, CSS };
});

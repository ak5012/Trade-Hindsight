// Draws the toolbar icons (icons/icon16.png ... icon128.png) from the logo in src/logo.js.
// Chrome toolbar icons can't move, so these are the still version of the animated logo.
// Run: npm run icons   (needs Playwright)
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const Logo = require('../src/logo.js');

const OUT = path.resolve(__dirname, '..', 'icons');

(async () => {
  const browser = await chromium.launch();
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!doctype html><style>html, body { margin: 0; background: transparent; } svg { display: block; }</style>${Logo.svg({ size })}`);
    const file = path.join(OUT, `icon${size}.png`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

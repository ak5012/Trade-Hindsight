// Browser smoke test: loads the real extension into Chromium, serves a fake ESPN
// league page + API, builds a trade, replays it and saves screenshots.
// Run: node tests/ui-smoke.js <screenshot-dir>
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const mock = require('./mock-espn.js').build();

const EXT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'th-shots');
fs.mkdirSync(OUT, { recursive: true });

const CORS = {
  'access-control-allow-origin': 'https://fantasy.espn.com',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'accept, x-fantasy-filter',
  'access-control-allow-methods': 'GET',
};

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-profile-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: true,
    channel: 'chromium', // new headless mode: needed for extensions
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1440, height: 900 },
  });
  const apiCalls = [];
  await ctx.route('https://fantasy.espn.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><title>Fake ESPN league page</title></head><body style="font-family:sans-serif;padding:40px"><h1>ESPN Fantasy (test page)</h1><p>League home</p></body></html>',
  }));
  await ctx.route('https://lm-api-reads.fantasy.espn.com/**', async (route) => {
    const req = route.request();
    apiCalls.push({ method: req.method(), url: req.url() });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = mock.respond(req.url(), req.headers()['x-fantasy-filter']);
    if (!body) return route.fulfill({ status: 404, headers: CORS, body: '{}' });
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify(body) });
  });
  // Stand-in pictures for ESPN's image hosts. One headshot 404s, as missing ones do on ESPN.
  const imageCalls = [];
  const missingHeadshot = mock.rosters[1][1];
  const svg = (hue, text, round) => `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="${round ? 48 : 18}" fill="hsl(${hue} 45% 45%)"/><text x="48" y="60" font-family="Arial" font-weight="700" font-size="34" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  const headshot = (hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="70"><rect width="96" height="70" fill="#d9dee5"/><circle cx="48" cy="28" r="15" fill="hsl(${hue} 25% 55%)"/><rect x="22" y="46" width="52" height="30" rx="20" fill="hsl(${hue} 25% 55%)"/></svg>`;
  await ctx.route(/^https?:\/\/(a\.espncdn\.com|g\.espncdn\.com|insecure\.example\.com)\//, (route) => {
    const req = route.request();
    const url = req.url();
    imageCalls.push({ method: req.method(), url });
    let m = /headshots\/nfl\/players\/full\/(\d+)\.png/.exec(url);
    if (m && Number(m[1]) === missingHeadshot) return route.fulfill({ status: 404, body: '' });
    if (m) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: headshot((Number(m[1]) * 37) % 360) });
    m = /teamlogos\/nfl\/500\/([a-z]+)\.png/.exec(url);
    if (m) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg((m[1].charCodeAt(0) * 29) % 360, m[1].toUpperCase().slice(0, 3), true) });
    m = /team-(\d+)\.svg/.exec(url);
    if (m) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg((Number(m[1]) * 61) % 360, `T${m[1]}`) });
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.addCookies([{ name: 'SWID', value: encodeURIComponent(mock.SWID), domain: '.espn.com', path: '/', secure: true }]);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2026');

  const launcher = page.locator('#trade-hindsight-launcher button');
  await launcher.waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, '0-launcher.png') });
  await launcher.click();
  await page.getByText('Build a trade').waitFor({ timeout: 20000 });
  // before any trade, the real season is shown
  await page.locator('.headline[data-scenario="baseline"]').waitFor({ timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, '1-builder.png') });

  const send = mock.players[mock.rosters[1][2]];      // one of my RBs
  const get = mock.players[mock.trade.fromA[0]];       // the player team 3 really traded away in week 5
  await page.getByLabel('Trade with').selectOption({ label: 'Barton Springs Bats' });
  await page.locator('fieldset', { hasText: 'You send' }).locator('label', { hasText: send.name }).first().locator('input').check();
  await page.locator('fieldset', { hasText: 'You get' }).locator('label', { hasText: get.name }).first().locator('input').check();
  // the replay runs on its own as soon as the trade is complete
  await page.locator('.headline[data-scenario="trade"]').waitFor({ timeout: 20000 });

  // ticking a player low in the list must not scroll the rail back to the top
  const builderTop = () => page.locator('.builder').evaluate((el) => el.scrollTop);
  const lastGet = page.locator('fieldset', { hasText: 'You get' }).locator('input[type=checkbox]').last();
  await lastGet.scrollIntoViewIfNeeded();
  // click with the mouse at a fixed spot: Playwright's check() could scroll on its own
  const box = await lastGet.boundingBox();
  const clickIt = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const scroll = { before: await builderTop() };
  await clickIt();
  scroll.checked = await lastGet.isChecked();
  scroll.afterCheck = await builderTop();
  await page.screenshot({ path: path.join(OUT, '1a-scrolled-pick.png') });
  await clickIt();
  scroll.unchecked = !(await lastGet.isChecked());
  scroll.afterUncheck = await builderTop();

  // make it uneven (2 for 1): also send my top WR, a starter
  const send2 = mock.players[mock.rosters[1][7]];
  await page.locator('fieldset', { hasText: 'You send' }).locator('label', { hasText: send2.name }).first().locator('input').check();
  await page.locator('.note').waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, '1b-uneven.png') });
  await page.locator('.flip').waitFor({ timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, '2-results.png') });

  // expand the first changed week
  const changedRow = page.locator('tr.clickable').first();
  if (await changedRow.count()) {
    await changedRow.click();
    await page.locator('.changes').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '3-week-detail.png') });
  }
  await page.locator('.notes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '4-notes.png') });

  await page.setViewportSize({ width: 400, height: 860 });
  await page.locator('.flip').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '5-mobile.png') });

  await page.setViewportSize({ width: 1440, height: 900 });
  const pictures = await page.evaluate(() => {
    const root = document.getElementById('trade-hindsight-root').shadowRoot;
    const imgs = [...root.querySelectorAll('img')];
    return {
      shown: imgs.length,
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      badges: root.querySelectorAll('.badge').length,
      noReferrer: imgs.every((i) => i.referrerPolicy === 'no-referrer'),
    };
  });

  // the animated logo is in the launcher and the panel header, and it is moving
  const logo = await page.evaluate(() => {
    const moving = (svg) => !!svg && getComputedStyle(svg.querySelector('.th-field')).animationName !== 'none';
    const launcher = document.getElementById('trade-hindsight-launcher').shadowRoot.querySelector('button svg.th-logo');
    const header = document.getElementById('trade-hindsight-root').shadowRoot.querySelector('.bar .mark svg.th-logo');
    return { launcher: moving(launcher), header: moving(header) };
  });

  const methods = [...new Set(apiCalls.map((c) => c.method))];
  const summary = {
    trade: `${send.name} for ${get.name}`,
    apiCalls: apiCalls.length,
    methods,
    nonGet: apiCalls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS'),
    erasedText: await page.locator('.erased').innerText().catch(() => null),
    headline: await page.locator('.lede').innerText(),
    liveBar: await page.locator('.live').innerText(),
    scroll,
    scrollKept: scroll.before > 0 && scroll.checked && scroll.unchecked && scroll.afterCheck === scroll.before && scroll.afterUncheck === scroll.before,
    pictures,
    logo,
    imageRequests: imageCalls.length,
    imageNonGet: imageCalls.filter((c) => c.method !== 'GET'),
    insecureRequests: imageCalls.filter((c) => c.url.startsWith('http:')),
    errors: errors.filter((e) => !/Failed to load resource.*404/.test(e)), // the planted missing headshot
  };
  console.log(JSON.stringify(summary, null, 2));
  await ctx.close();
  const picturesOk = pictures.shown > 0 && pictures.broken === 0 && pictures.badges > 0 && pictures.noReferrer;
  if (summary.nonGet.length || summary.errors.length || !summary.scrollKept || !picturesOk || !logo.launcher || !logo.header
    || summary.imageNonGet.length || summary.insecureRequests.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

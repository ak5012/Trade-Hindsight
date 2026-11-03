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
  await page.screenshot({ path: path.join(OUT, '1-builder.png') });

  const send = mock.players[mock.rosters[1][2]];      // one of my RBs
  const get = mock.players[mock.trade.fromA[0]];       // the player team 3 really traded away in week 5
  await page.getByLabel('Trade with').selectOption({ label: 'Barton Springs Bats' });
  await page.locator('fieldset', { hasText: 'You send' }).locator('label', { hasText: send.name }).first().locator('input').check();
  await page.locator('fieldset', { hasText: 'You get' }).locator('label', { hasText: get.name }).first().locator('input').check();
  // make it uneven (2 for 1): also send my top WR, a starter
  const send2 = mock.players[mock.rosters[1][7]];
  await page.locator('fieldset', { hasText: 'You send' }).locator('label', { hasText: send2.name }).first().locator('input').check();
  await page.locator('.note').waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, '1b-uneven.png') });
  await page.getByRole('button', { name: 'Replay the season' }).click();
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

  const methods = [...new Set(apiCalls.map((c) => c.method))];
  const summary = {
    trade: `${send.name} for ${get.name}`,
    apiCalls: apiCalls.length,
    methods,
    nonGet: apiCalls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS'),
    erasedText: await page.locator('.erased').innerText().catch(() => null),
    headline: await page.locator('.lede').innerText(),
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  await ctx.close();
  if (summary.nonGet.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

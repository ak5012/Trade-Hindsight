/*
 * Trade Hindsight - background service worker.
 *  - Toolbar click: open the panel on an ESPN fantasy football page, or open ESPN.
 *  - Fallback reader: if the page context can't call ESPN's read API, the panel
 *    asks this worker to do it. GET only, ESPN's read API host only.
 */
const API_HOST = 'lm-api-reads.fantasy.espn.com';
const ALLOWED_HEADERS = new Set(['accept', 'x-fantasy-filter']);

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'th-toggle' });
  } catch (e) {
    // No panel on this tab (not an ESPN fantasy football page): open ESPN.
    chrome.tabs.create({ url: 'https://fantasy.espn.com/football/' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'th-espn-get') return false;

  let url;
  try {
    url = new URL(msg.url);
  } catch (e) {
    sendResponse({ error: 'Bad URL.' });
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== API_HOST) {
    sendResponse({ error: `Blocked: Trade Hindsight only reads from ${API_HOST}.` });
    return false;
  }

  const headers = {};
  for (const [k, v] of Object.entries(msg.headers || {})) {
    if (ALLOWED_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }

  fetch(url.toString(), { method: 'GET', credentials: 'include', headers, cache: 'no-store' })
    .then(async (res) => {
      const json = res.ok ? await res.json() : null;
      sendResponse({ ok: res.ok, status: res.status, json });
    })
    .catch((err) => sendResponse({ error: `Could not reach ESPN: ${err.message}` }));
  return true; // async response
});

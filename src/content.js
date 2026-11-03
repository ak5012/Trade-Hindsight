/*
 * Trade Hindsight - content script entry.
 * Adds a small launcher button on ESPN fantasy football league pages and
 * opens the panel from it or from the toolbar icon. Never touches ESPN's own
 * page elements: the launcher lives in its own shadow root.
 */
(function () {
  'use strict';
  if (window.__tradeHindsightLoaded) return;
  window.__tradeHindsightLoaded = true;

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'th-toggle') window.THUI.toggle();
    });
  }

  let launcher = null;

  function makeLauncher() {
    const host = document.createElement('div');
    host.id = 'trade-hindsight-launcher';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      button {
        position: fixed; left: 20px; bottom: 20px; z-index: 2147483645; /* left: ESPN's Fantasy Chat bar sits bottom right */
        font: 600 14px/1 "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
        background: #17202c; color: #fff; border: 0; border-radius: 999px;
        padding: 12px 18px; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      }
      button:hover { background: #253144; }
      button:focus-visible { outline: 2px solid #2f6fde; outline-offset: 3px; }
      span { display: inline-block; width: 9px; height: 9px; border-radius: 2px; background: #ffe066; margin-right: 8px; }
    `;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<span aria-hidden="true"></span>Trade Hindsight';
    btn.addEventListener('click', () => window.THUI.open());
    root.append(style, btn);
    return host;
  }

  // ESPN is a single-page app, so the URL can change without a reload.
  function syncLauncher() {
    const onLeague = /[?&]leagueId=\d+/.test(window.location.search);
    if (onLeague && !launcher) {
      launcher = makeLauncher();
      document.documentElement.appendChild(launcher);
    } else if (!onLeague && launcher) {
      launcher.remove();
      launcher = null;
    }
  }

  syncLauncher();
  setInterval(syncLauncher, 1000);
})();

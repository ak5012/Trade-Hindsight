# Trade Hindsight

A Chrome extension that replays your ESPN fantasy football season as if a trade you never made had gone through. You get re-scored weeks, records and league standings, shown next to what really happened.

**It's read-only.** It only sends GET requests to ESPN's read API (`lm-api-reads.fantasy.espn.com`). It never proposes or accepts trades, changes lineups or touches rosters. `tests/readonly.test.js` fails if that ever changes.

Player headshots and NFL logos are shown as plain images from ESPN's image server (`a.espncdn.com`). Fantasy team logos load from wherever each manager's logo is hosted, as they do on ESPN's own pages; only `https` logos are shown, and no image request carries a referrer.

Not affiliated with ESPN.

## Install (about 1 minute)

1. Unzip `trade-hindsight.zip`.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `trade-hindsight` folder (the one that contains `manifest.json`).
4. Open any page of your league on fantasy.espn.com (the address has `leagueId=` in it), making sure you're logged in.
5. Click the **Trade Hindsight** button at the bottom left of the page, or the extension's toolbar icon.

## Using it

1. Check **Your team** (it's detected from your ESPN login when possible) and pick the week the trade happens before.
2. Pick the team to **Trade with**, then tick the players you send and the players you get. Uneven trades are fine. You can add trades with other teams too.

There's no button to press: the season replays every time you tick or untick a player, change a partner or change the week. Players show their headshot, position and NFL team; fantasy teams show their league logo, or their initials if they have none. Before you build a trade, the panel shows how the season really went. The bar at the bottom of the trade builder keeps your record, seed and points change in view while you scroll through rosters.

The results show your record, points, seed and playoff status (real vs replay), the full league standings, and a week-by-week table. Click a changed week to see who came in, who went out and why.

## How the replay works

- **The trade stands from its week onward.** Players you send go to the partner, players you get come to you, and they stay there for the rest of the season.
- **Real trades involving those players are erased.** If a player in your trade (either side) was really traded later, that real trade never happens in the replay: its players stay with their pre-trade teams. This chains to later trades of those players too.
- **Lineups change only where the trade forces it.** Real starters stay. A starter who left opens a slot, filled by the best ESPN-projected eligible player on that roster (bench or incoming). An incoming player starts only if his projection for that week beats a current starter. Bench players never replace a starter unless a slot opened up. IR players are never used.
- **No hindsight in lineups.** Start decisions use ESPN's pre-game projection for the week. Points scored are only used for the score.
- **Scores.** Replay score = real ESPN score − real points of starters lost + real points of the new starters. Teams the trade doesn't touch keep their real score exactly.
- **Standings.** Re-decided on the real schedule. Seeds use win percentage, then points for. The league's median-win bonus is recomputed if your league uses one.

## Known limits (v1)

- **Not yet run against a live ESPN league.** The ESPN parsing is built from the field names the open-source [espn-api](https://github.com/cwendt94/espn-api) library uses and tested against fake responses of the same shape. The first real run is the real test. The **Data checks** section at the bottom of the results tells you if the replay with no changes doesn't match ESPN's records.
- Head-to-head points leagues only (no category leagues), 2019 season or later, regular season only.
- Seeds ignore division winners and ESPN's head-to-head tiebreakers.
- An exact tie in a replayed matchup counts as a tie, even if the league breaks ties (by bench points, say). The Data checks section says when your league has a tiebreak setting.
- Roster size limits aren't enforced for uneven trades.
- ESPN's API is unofficial and can change without notice. All ESPN code lives in `src/espn.js`.

## Files

| File | What it does |
|---|---|
| `manifest.json` | Chrome extension manifest (MV3) |
| `background.js` | Toolbar button; GET-only fallback reader |
| `src/espn.js` | All ESPN reads and parsing (GET only, one host) |
| `src/engine.js` | The simulation: ownership, erased trades, lineup solver, scoring, standings |
| `src/ui.js` | The panel (draws in its own shadow DOM) |
| `src/content.js` | Adds the launcher button on league pages |
| `src/logo.js` | The logo (football over a field), still or animated |
| `tools/make-icons.js` | Draws the toolbar icons in `icons/` from the logo |
| `tests/` | Unit tests, read-only guard, browser smoke test with a fake league |

## Development

```
npm test          # 40 unit tests: engine, ESPN parsing, read-only guard, logo (Node 18+)
npm run smoke     # needs Playwright: loads the extension in Chromium against a fake league
npm run icons     # needs Playwright: redraws icons/icon16.png ... icon128.png from src/logo.js
```

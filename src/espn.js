/*
 * Trade Hindsight - ESPN data layer (READ-ONLY).
 *
 * Every network call in the extension goes through espnGet(), which:
 *   - only ever sends HTTP GET,
 *   - only talks to ESPN's read API host (lm-api-reads.fantasy.espn.com).
 * There is no code anywhere in this extension that proposes, accepts or
 * changes anything in an ESPN league.
 *
 * Parsing functions are pure and are unit-tested in Node (tests/parse.test.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.THEspn = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_HOST = 'lm-api-reads.fantasy.espn.com';
  const API_BASE = `https://${API_HOST}/apis/v3/games/ffl`;
  const CACHE_PREFIX = 'th:v1:';
  const TRADE_MESSAGE_TYPE = 244;

  // ESPN defaultPositionId -> label
  const POSITION = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 7: 'P', 9: 'DT', 10: 'DE', 11: 'LB', 12: 'CB', 13: 'S', 14: 'HC', 16: 'D/ST' };

  // ESPN proTeamId -> NFL team abbreviation (as ESPN's logo paths spell it)
  const PRO_TEAM = {
    1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND',
    12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI',
    23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
  };

  // Pictures are shown as <img> only (never fetched by code), from ESPN's image server.
  const IMAGE_BASE = 'https://a.espncdn.com/combiner/i?img=';

  class EspnError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  // ---------------------------------------------------------------------------
  // The only network function. GET only, one host only.
  // ---------------------------------------------------------------------------

  function assertReadOnlyUrl(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== API_HOST) {
      throw new EspnError(`Blocked: Trade Hindsight only reads from ${API_HOST}.`);
    }
    return u;
  }

  async function espnGet(url, filter) {
    const u = assertReadOnlyUrl(url);
    const headers = { Accept: 'application/json' };
    if (filter) headers['x-fantasy-filter'] = JSON.stringify(filter);

    let res;
    try {
      res = await fetch(u.toString(), { method: 'GET', credentials: 'include', headers, cache: 'no-store' });
    } catch (pageErr) {
      // The page context could not make the call (e.g. CORS). Retry through the
      // extension's background worker, which is also GET-only.
      return viaBackground(u.toString(), headers, pageErr);
    }
    return readResponse(res.status, res.ok, () => res.json());
  }

  async function readResponse(status, ok, getJson) {
    if (status === 401 || status === 403) {
      throw new EspnError('ESPN refused access. This is a private league: make sure you are logged in to ESPN in this browser.', status);
    }
    if (status === 404) throw new EspnError('ESPN could not find this league and season.', status);
    if (!ok) throw new EspnError(`ESPN returned an error (HTTP ${status}).`, status);
    return getJson();
  }

  function viaBackground(url, headers, originalErr) {
    const rt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime : null;
    if (!rt) return Promise.reject(new EspnError(`Could not reach ESPN: ${originalErr && originalErr.message}`));
    return new Promise((resolve, reject) => {
      rt.sendMessage({ type: 'th-espn-get', url, headers }, (reply) => {
        if (chrome.runtime.lastError) return reject(new EspnError(`Could not reach ESPN: ${chrome.runtime.lastError.message}`));
        if (!reply) return reject(new EspnError('Could not reach ESPN.'));
        if (reply.error) return reject(new EspnError(reply.error, reply.status));
        readResponse(reply.status, reply.ok, () => reply.json).then(resolve, reject);
      });
    });
  }

  function leagueUrl(leagueId, season, views, extraParams, subPath) {
    const u = new URL(`${API_BASE}/seasons/${season}/segments/0/leagues/${leagueId}${subPath || ''}`);
    for (const v of views || []) u.searchParams.append('view', v);
    for (const [k, v] of Object.entries(extraParams || {})) u.searchParams.set(k, String(v));
    return u.toString();
  }

  // ---------------------------------------------------------------------------
  // Pure parsers
  // ---------------------------------------------------------------------------

  function weekStat(player, sp, sourceId) {
    const stats = (player && player.stats) || [];
    const s = stats.find((x) => x.scoringPeriodId === sp && x.statSourceId === sourceId && x.statSplitTypeId !== 2);
    return s && typeof s.appliedTotal === 'number' ? s.appliedTotal : null;
  }

  function parsePlayer(entry, sp) {
    const pool = entry.playerPoolEntry || {};
    const player = pool.player || entry.player || {};
    let pts = weekStat(player, sp, 0);
    if (pts === null && typeof pool.appliedStatTotal === 'number') pts = pool.appliedStatTotal;
    return {
      id: entry.playerId != null ? entry.playerId : (player.id != null ? player.id : entry.id),
      name: player.fullName || `Player ${entry.playerId}`,
      pos: POSITION[player.defaultPositionId] || '',
      eligible: player.eligibleSlots || [],
      proTeamId: player.proTeamId,
      injuryStatus: player.injuryStatus || pool.injuryStatus || null,
      pts,
      proj: weekStat(player, sp, 1),
    };
  }

  function parseLeague(raw, leagueId, season) {
    const settings = raw.settings || {};
    const sched = settings.scheduleSettings || {};
    const scoring = settings.scoringSettings || {};
    const roster = settings.rosterSettings || {};

    const matchupPeriods = {};
    for (const [mp, sps] of Object.entries(sched.matchupPeriods || {})) matchupPeriods[Number(mp)] = (sps || []).map(Number);

    const lineupSlotCounts = {};
    for (const [slot, count] of Object.entries(roster.lineupSlotCounts || {})) {
      const id = Number(slot);
      if (count > 0 && id !== 20 && id !== 21) lineupSlotCounts[id] = count;
    }

    const teams = (raw.teams || []).map((t) => {
      const overall = (t.record && t.record.overall) || {};
      return {
        id: t.id,
        name: t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`,
        abbrev: t.abbrev || '',
        logo: safeImageUrl(t.logo),
        ownerIds: t.owners || [],
        divisionId: t.divisionId,
        espn: {
          wins: overall.wins, losses: overall.losses, ties: overall.ties,
          pf: overall.pointsFor, pa: overall.pointsAgainst, seed: t.playoffSeed,
        },
      };
    });

    const schedule = (raw.schedule || []).map((g) => ({
      id: g.id,
      mp: g.matchupPeriodId,
      homeId: g.home ? g.home.teamId : null,
      awayId: g.away ? g.away.teamId : null,
      homeTotal: g.home ? g.home.totalPoints : null,
      awayTotal: g.away ? g.away.totalPoints : null,
      homeByPeriod: (g.home && g.home.pointsByScoringPeriod) || null,
      awayByPeriod: (g.away && g.away.pointsByScoringPeriod) || null,
      winner: g.winner,
      playoffTier: g.playoffTierType || 'NONE',
    }));

    const status = raw.status || {};
    return {
      leagueId: Number(leagueId),
      season: Number(season),
      name: settings.name || `League ${leagueId}`,
      scoringType: scoring.scoringType || null,
      medianScoring: scoring.scoringEnhancementType === 'WIN_BONUS_TOP_HALF',
      tieRule: scoring.matchupTieRule || 'NONE',
      playoffTeamCount: sched.playoffTeamCount || 4,
      regularSeasonMatchups: sched.matchupPeriodCount || 14,
      hasDivisions: ((sched.divisions || []).length || 0) > 1,
      matchupPeriods,
      lineupSlotCounts,
      teams,
      members: (raw.members || []).map((m) => ({ id: m.id, displayName: m.displayName })),
      schedule,
      status: {
        currentMatchupPeriod: status.currentMatchupPeriod,
        scoringPeriodId: raw.scoringPeriodId,
        finalScoringPeriod: status.finalScoringPeriod,
        isActive: status.isActive,
      },
      weeks: {},
      players: {},
      realTrades: [],
      tradeSource: null,
      warnings: [],
    };
  }

  /** Box-score response (mMatchupScore + mScoreboard) for one scoring period. */
  function parseWeek(raw, sp, mp) {
    const out = { sp, teams: {}, players: {} };
    for (const g of raw.schedule || []) {
      if (mp && g.matchupPeriodId !== mp) continue;
      for (const side of ['home', 'away']) {
        const s = g[side];
        if (!s) continue;
        const roster = s.rosterForCurrentScoringPeriod || s.rosterForMatchupPeriod;
        if (!roster || !Array.isArray(roster.entries)) continue;
        let score = null;
        if (s.pointsByScoringPeriod && typeof s.pointsByScoringPeriod[sp] === 'number') score = s.pointsByScoringPeriod[sp];
        else if (typeof roster.appliedStatTotal === 'number') score = roster.appliedStatTotal;
        addTeam(out, s.teamId, score, roster.entries, sp);
      }
    }
    return out;
  }

  /** mRoster response for one scoring period (fallback when box scores have no rosters). */
  function parseRosterWeek(raw, sp) {
    const out = { sp, teams: {}, players: {} };
    for (const t of raw.teams || []) {
      if (!t.roster || !Array.isArray(t.roster.entries)) continue;
      addTeam(out, t.id, null, t.roster.entries, sp);
    }
    return out;
  }

  function addTeam(out, teamId, score, entries, sp) {
    out.teams[teamId] = {
      score,
      entries: entries.map((e) => ({ playerId: e.playerId, slotId: e.lineupSlotId })),
    };
    for (const e of entries) {
      const p = parsePlayer(e, sp);
      out.players[p.id] = p;
    }
  }

  /** Fill missing team scores: schedule's per-period points, single-week totals, or the starters' sum. */
  function fillWeekScores(league, week) {
    const sp = week.sp;
    let mp = null;
    for (const [k, sps] of Object.entries(league.matchupPeriods)) if (sps.includes(sp)) { mp = Number(k); break; }
    for (const tid of Object.keys(week.teams)) {
      const t = week.teams[tid];
      if (typeof t.score === 'number') continue;
      const id = Number(tid);
      const g = league.schedule.find((x) => x.mp === mp && (x.homeId === id || x.awayId === id));
      const isHome = g && g.homeId === id;
      const byPeriod = g ? (isHome ? g.homeByPeriod : g.awayByPeriod) : null;
      if (byPeriod && typeof byPeriod[sp] === 'number') { t.score = byPeriod[sp]; continue; }
      if (g && mp && (league.matchupPeriods[mp] || []).length === 1) {
        const total = isHome ? g.homeTotal : g.awayTotal;
        if (typeof total === 'number') { t.score = total; continue; }
      }
      t.score = t.entries
        .filter((e) => e.slotId !== 20 && e.slotId !== 21)
        .reduce((s, e) => s + ((week.players[e.playerId] && week.players[e.playerId].pts) || 0), 0);
      t.scoreFromStarters = true;
    }
  }

  function mergeWeek(league, week) {
    league.weeks[week.sp] = { teams: week.teams };
    for (const p of Object.values(week.players)) {
      const cur = league.players[p.id] || { name: p.name, pos: p.pos, eligible: p.eligible, proTeamId: p.proTeamId, weekly: {} };
      cur.name = p.name || cur.name;
      cur.pos = p.pos || cur.pos;
      if (p.proTeamId) cur.proTeamId = p.proTeamId;
      if (p.eligible && p.eligible.length) cur.eligible = p.eligible;
      cur.weekly[week.sp] = { pts: p.pts, proj: p.proj };
      league.players[p.id] = cur;
    }
  }

  /** League activity feed -> [{id, date, moves:[{playerId, fromTeamId, toTeamId}]}] */
  function parseTradeFeed(raw) {
    const trades = [];
    for (const topic of raw.topics || []) {
      const seen = new Set();
      const moves = [];
      for (const m of topic.messages || []) {
        if (m.messageTypeId !== TRADE_MESSAGE_TYPE || m.targetId == null) continue;
        const key = `${m.targetId}:${m.from}:${m.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        moves.push({ playerId: m.targetId, fromTeamId: m.from, toTeamId: m.to });
      }
      if (moves.length) trades.push({ id: String(topic.id), date: topic.date, moves });
    }
    return trades;
  }

  function ownerMaps(league) {
    const owner = {};
    for (const sp of Object.keys(league.weeks)) {
      const m = new Map();
      for (const tid of Object.keys(league.weeks[sp].teams)) {
        for (const e of league.weeks[sp].teams[tid].entries) m.set(e.playerId, Number(tid));
      }
      owner[sp] = m;
    }
    return owner;
  }

  /** Give each feed trade the first loaded week in which its players show up on their new teams. */
  function assignTradeWeeks(league, feedTrades) {
    const weeks = Object.keys(league.weeks).map(Number).sort((a, b) => a - b);
    const owner = ownerMaps(league);
    const lastWeekFor = new Map();
    const placed = [];
    const unplaced = [];
    const ordered = [...feedTrades].sort((a, b) => (a.date || 0) - (b.date || 0));
    for (const t of ordered) {
      let week = null;
      for (const m of t.moves) {
        const after = lastWeekFor.get(m.playerId) || 0;
        for (let i = 1; i < weeks.length; i++) {
          if (weeks[i] <= after) continue;
          const a = owner[weeks[i - 1]].get(m.playerId);
          const b = owner[weeks[i]].get(m.playerId);
          if (a === m.fromTeamId && b === m.toTeamId) {
            week = week === null ? weeks[i] : Math.min(week, weeks[i]);
            break;
          }
        }
      }
      if (week === null) { unplaced.push(t); continue; }
      for (const m of t.moves) lastWeekFor.set(m.playerId, week);
      placed.push({ id: t.id, week, date: t.date, moves: t.moves, source: 'activity' });
    }
    return { placed, unplaced };
  }

  /** Fallback: a player moving straight from one team to another between weeks. */
  function inferTradesFromRosters(league) {
    const weeks = Object.keys(league.weeks).map(Number).sort((a, b) => a - b);
    const owner = ownerMaps(league);
    const groups = new Map();
    for (let i = 1; i < weeks.length; i++) {
      const prev = owner[weeks[i - 1]], cur = owner[weeks[i]];
      for (const [pid, to] of cur) {
        const from = prev.get(pid);
        if (from === undefined || from === to) continue;
        const pair = [from, to].sort((a, b) => a - b).join('-');
        const key = `${weeks[i]}:${pair}`;
        if (!groups.has(key)) groups.set(key, { id: `inferred-${key}`, week: weeks[i], moves: [], source: 'roster-diff' });
        groups.get(key).moves.push({ playerId: pid, fromTeamId: from, toTeamId: to });
      }
    }
    return [...groups.values()];
  }

  function parsePlayerCards(raw, weeksByPlayer) {
    const out = {};
    for (const item of raw.players || []) {
      const player = item.player || (item.playerPoolEntry && item.playerPoolEntry.player) || {};
      const id = item.id != null ? item.id : player.id;
      if (id == null) continue;
      const weekly = {};
      for (const sp of weeksByPlayer.get(id) || []) {
        const pts = weekStat(player, sp, 0);
        weekly[sp] = { pts: pts === null ? 0 : pts, proj: weekStat(player, sp, 1), source: 'card' };
      }
      out[id] = {
        name: player.fullName || `Player ${id}`,
        pos: POSITION[player.defaultPositionId] || '',
        eligible: player.eligibleSlots || [],
        proTeamId: player.proTeamId,
        weekly,
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Pictures: player headshots, NFL logos, fantasy team logos
  // ---------------------------------------------------------------------------

  /** Team logos are set by each manager and can live on any site: https only. */
  function safeImageUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' ? u.toString() : null;
    } catch (e) {
      return null;
    }
  }

  function proTeamAbbrev(proTeamId) {
    return PRO_TEAM[proTeamId] || null;
  }

  function nflLogoUrl(proTeamId) {
    const abbr = proTeamAbbrev(proTeamId);
    return abbr ? `${IMAGE_BASE}/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png&w=64&h=64` : null;
  }

  /** Headshot for a player; a D/ST gets its NFL team's logo. ESPN D/ST ids are -16000 - proTeamId. */
  function headshotUrl(playerId, player) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;
    if (id < 0 || (player && player.pos === 'D/ST')) {
      return nflLogoUrl((player && player.proTeamId) || (id < 0 ? -16000 - id : null));
    }
    return `${IMAGE_BASE}/i/headshots/nfl/players/full/${id}.png&w=96&h=70&cb=1`;
  }

  function readSwid(cookieString) {
    const m = /(?:^|;\s*)SWID=([^;]+)/.exec(cookieString || '');
    return m ? decodeURIComponent(m[1]).toUpperCase() : null;
  }

  function findMyTeam(league, swid) {
    if (!swid) return null;
    const t = league.teams.find((x) => (x.ownerIds || []).some((o) => String(o).toUpperCase() === swid));
    return t ? t.id : null;
  }

  function pageContext(loc) {
    const params = new URLSearchParams(loc.search || '');
    const now = new Date();
    const defaultSeason = now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
    return {
      leagueId: params.get('leagueId'),
      season: Number(params.get('seasonId')) || defaultSeason,
      teamId: params.get('teamId') ? Number(params.get('teamId')) : null,
    };
  }

  /** Scoring periods of regular-season matchup periods ESPN has finished. */
  function weeksToLoad(league) {
    const sps = [];
    for (let mp = 1; mp <= league.regularSeasonMatchups; mp++) {
      const games = league.schedule.filter((g) => g.mp === mp);
      if (!games.length || !games.every((g) => g.winner && g.winner !== 'UNDECIDED')) continue;
      for (const sp of league.matchupPeriods[mp] || [mp]) sps.push({ sp, mp });
    }
    return sps;
  }

  // ---------------------------------------------------------------------------
  // Loaders (browser only)
  // ---------------------------------------------------------------------------

  const storage = {
    async get(key) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
        const r = await chrome.storage.local.get(key);
        return r[key] || null;
      } catch (e) { return null; }
    },
    async set(key, value) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        await chrome.storage.local.set({ [key]: value });
      } catch (e) { /* cache is optional */ }
    },
    async clear(prefix) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
        if (keys.length) await chrome.storage.local.remove(keys);
      } catch (e) { /* ignore */ }
    },
  };

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loadLeague(leagueId, season) {
    const raw = await espnGet(leagueUrl(leagueId, season, ['mSettings', 'mTeam', 'mMatchup', 'mStandings']));
    return parseLeague(raw, leagueId, season);
  }

  async function loadWeeks(league, onProgress, opts) {
    const list = weeksToLoad(league);
    const cachePrefix = `${CACHE_PREFIX}${league.leagueId}:${league.season}:`;
    if (opts && opts.refresh) await storage.clear(cachePrefix);
    let i = 0;
    for (const { sp, mp } of list) {
      i++;
      if (onProgress) onProgress(`Loading week ${sp} (${i} of ${list.length})`);
      const key = `${cachePrefix}w${sp}`;
      let week = await storage.get(key);
      if (!week) {
        const filter = { schedule: { filterMatchupPeriodIds: { value: [mp] } } };
        const raw = await espnGet(leagueUrl(league.leagueId, league.season, ['mMatchupScore', 'mScoreboard'], { scoringPeriodId: sp }), filter);
        week = parseWeek(raw, sp, mp);
        if (!Object.keys(week.teams).length) {
          const rawRoster = await espnGet(leagueUrl(league.leagueId, league.season, ['mRoster'], { scoringPeriodId: sp }));
          week = parseRosterWeek(rawRoster, sp);
        }
        if (!Object.keys(week.teams).length) throw new EspnError(`ESPN returned no lineups for week ${sp}.`);
        fillWeekScores(league, week);
        await storage.set(key, week);
        await pause(150);
      }
      mergeWeek(league, week);
    }
    return list.map((x) => x.sp);
  }

  async function loadRealTrades(league) {
    try {
      const feed = [];
      const limit = 50;
      for (let offset = 0; offset < 2000; offset += limit) {
        const filter = {
          topics: {
            filterType: { value: ['ACTIVITY_TRANSACTIONS'] },
            limit,
            limitPerMessageSet: { value: 25 },
            offset,
            sortMessageDate: { sortPriority: 1, sortAsc: false },
            sortFor: { sortPriority: 2, sortAsc: false },
            filterIncludeMessageTypeIds: { value: [TRADE_MESSAGE_TYPE] },
          },
        };
        const url = leagueUrl(league.leagueId, league.season, ['kona_league_communication'], null, '/communication/');
        const raw = await espnGet(url, filter);
        const topics = raw.topics || [];
        feed.push(...parseTradeFeed({ topics }));
        if (topics.length < limit) break;
      }
      const { placed, unplaced } = assignTradeWeeks(league, feed);
      league.realTrades = placed;
      league.tradeSource = 'activity';
      if (unplaced.length) {
        league.warnings.push(`${unplaced.length} real trade(s) from the league activity feed could not be matched to a completed week (before week 1, or in the current week). They are treated as part of the real rosters.`);
      }
    } catch (err) {
      league.realTrades = inferTradesFromRosters(league);
      league.tradeSource = 'roster-diff';
      league.warnings.push('Could not read the league activity feed, so real trades were inferred from week-to-week roster changes. A same-week drop and pickup by another team may be misread as a trade.');
    }
    return league.realTrades;
  }

  async function fetchPlayerCards(league, missing) {
    const ids = [...missing.keys()];
    if (!ids.length) return 0;
    const filter = {
      players: {
        filterIds: { value: ids },
        filterStatsForTopScoringPeriodIds: {
          value: league.status.finalScoringPeriod || 18,
          additionalValue: [`00${league.season}`, `10${league.season}`],
        },
      },
    };
    const raw = await espnGet(leagueUrl(league.leagueId, league.season, ['kona_playercard']), filter);
    const cards = parsePlayerCards(raw, missing);
    for (const [id, card] of Object.entries(cards)) {
      const cur = league.players[id] || { name: card.name, pos: card.pos, eligible: card.eligible, proTeamId: card.proTeamId, weekly: {} };
      if (!cur.eligible || !cur.eligible.length) cur.eligible = card.eligible;
      for (const [sp, w] of Object.entries(card.weekly)) if (!cur.weekly[sp]) cur.weekly[sp] = w;
      league.players[id] = cur;
    }
    return Object.keys(cards).length;
  }

  return {
    API_HOST, POSITION, EspnError,
    assertReadOnlyUrl, espnGet, leagueUrl,
    weekStat, parsePlayer, parseLeague, parseWeek, parseRosterWeek, fillWeekScores, mergeWeek,
    parseTradeFeed, assignTradeWeeks, inferTradesFromRosters, parsePlayerCards,
    PRO_TEAM, safeImageUrl, proTeamAbbrev, nflLogoUrl, headshotUrl,
    readSwid, findMyTeam, pageContext, weeksToLoad,
    loadLeague, loadWeeks, loadRealTrades, fetchPlayerCards,
  };
});

// Builds small normalized leagues (the shape espn.js produces) for engine tests.
'use strict';

const ELIG = {
  QB: [0, 7, 20, 21],
  RB: [2, 3, 23, 7, 20, 21],
  WR: [4, 3, 5, 23, 7, 20, 21],
  TE: [6, 5, 23, 7, 20, 21],
};
const SLOT = { QB: 0, RB: 2, WR: 4, FLEX: 23, BE: 20, IR: 21 };

/**
 * spec = {
 *   weeks: 4,
 *   teams: { 1: [ {id, pos, slot, pts, proj}, ... ], ... }   // week-1 rosters
 *   rosterChanges: [{ week, playerId, toTeam (null = free agent), slot }]  // real moves from that week on
 *   points: { [playerId]: { [week]: {pts, proj} } }   // per-week overrides
 *   baseScores: { [teamId]: number }  // optional: real score = starters' sum unless given
 *   realTrades: [...], medianScoring, playoffTeamCount
 *   schedule: [[home, away], ...] per week, repeated
 * }
 */
function makeLeague(spec) {
  const weeks = spec.weeks || 4;
  const players = {};
  const teamIds = Object.keys(spec.teams).map(Number);

  for (const tid of teamIds) {
    for (const p of spec.teams[tid]) {
      players[p.id] = { name: p.name || `P${p.id}`, pos: p.pos, eligible: ELIG[p.pos], weekly: {} };
      for (let w = 1; w <= weeks; w++) {
        const o = (spec.points && spec.points[p.id] && spec.points[p.id][w]) || {};
        players[p.id].weekly[w] = {
          pts: o.pts !== undefined ? o.pts : p.pts,
          proj: o.proj !== undefined ? o.proj : p.proj,
        };
      }
    }
  }
  for (const extra of spec.freeAgents || []) {
    players[extra.id] = { name: extra.name || `P${extra.id}`, pos: extra.pos, eligible: ELIG[extra.pos], weekly: {} };
    for (let w = 1; w <= weeks; w++) players[extra.id].weekly[w] = { pts: extra.pts, proj: extra.proj };
  }

  // rosters per week: start from week-1 rosters, apply changes
  const current = {};
  for (const tid of teamIds) current[tid] = spec.teams[tid].map((p) => ({ playerId: p.id, slotId: SLOT[p.slot] }));
  const leagueWeeks = {};
  for (let w = 1; w <= weeks; w++) {
    for (const ch of (spec.rosterChanges || []).filter((c) => c.week === w)) {
      for (const tid of teamIds) current[tid] = current[tid].filter((e) => e.playerId !== ch.playerId);
      if (ch.toTeam) current[ch.toTeam].push({ playerId: ch.playerId, slotId: SLOT[ch.slot || 'BE'] });
    }
    for (const sw of (spec.slotChanges || []).filter((c) => c.week === w)) {
      for (const tid of teamIds) for (const e of current[tid]) if (e.playerId === sw.playerId) e.slotId = SLOT[sw.slot];
    }
    const teams = {};
    for (const tid of teamIds) {
      const entries = current[tid].map((e) => ({ ...e }));
      const starterSum = entries
        .filter((e) => e.slotId !== 20 && e.slotId !== 21)
        .reduce((s, e) => s + (players[e.playerId].weekly[w].pts || 0), 0);
      teams[tid] = { score: Math.round(starterSum * 100) / 100, entries };
    }
    leagueWeeks[w] = { teams };
  }

  const pairs = spec.pairs || [[teamIds[0], teamIds[1]], [teamIds[2], teamIds[3]]];
  const schedule = [];
  for (let w = 1; w <= weeks; w++) {
    const weekPairs = typeof pairs === 'function' ? pairs(w) : pairs;
    for (const [h, a] of weekPairs) {
      const hs = leagueWeeks[w].teams[h].score, as = leagueWeeks[w].teams[a].score;
      schedule.push({ mp: w, homeId: h, awayId: a, homeTotal: hs, awayTotal: as, winner: hs > as ? 'HOME' : as > hs ? 'AWAY' : 'TIE' });
    }
  }

  const matchupPeriods = {};
  for (let w = 1; w <= weeks; w++) matchupPeriods[w] = [w];

  return {
    leagueId: 1, season: 2026, name: 'Test League',
    medianScoring: !!spec.medianScoring,
    playoffTeamCount: spec.playoffTeamCount || 2,
    regularSeasonMatchups: weeks,
    matchupPeriods,
    lineupSlotCounts: spec.lineupSlotCounts || { 0: 1, 2: 2, 4: 2, 23: 1 },
    teams: teamIds.map((id) => ({ id, name: `Team ${id}`, ownerIds: [] })),
    schedule,
    weeks: leagueWeeks,
    players,
    realTrades: spec.realTrades || [],
    warnings: [],
  };
}

// A standard 4-team roster. ids: team*100 + n
function roster(t, overrides) {
  const base = [
    { id: t * 100 + 1, pos: 'QB', slot: 'QB', pts: 18, proj: 17 },
    { id: t * 100 + 2, pos: 'RB', slot: 'RB', pts: 12, proj: 13 },
    { id: t * 100 + 3, pos: 'RB', slot: 'RB', pts: 10, proj: 10 },
    { id: t * 100 + 4, pos: 'WR', slot: 'WR', pts: 11, proj: 12 },
    { id: t * 100 + 5, pos: 'WR', slot: 'WR', pts: 9, proj: 9 },
    { id: t * 100 + 6, pos: 'RB', slot: 'FLEX', pts: 8, proj: 8 },
    { id: t * 100 + 7, pos: 'RB', slot: 'BE', pts: 5, proj: 5 },
    { id: t * 100 + 8, pos: 'WR', slot: 'BE', pts: 4, proj: 4 },
    { id: t * 100 + 9, pos: 'QB', slot: 'BE', pts: 14, proj: 11 },
  ];
  return base.map((p) => Object.assign({}, p, (overrides && overrides[p.id]) || {}));
}

module.exports = { makeLeague, roster, ELIG, SLOT };

'use strict';
// Parsers are tested against JSON shaped like ESPN's lm-api-reads responses
// (field names cross-checked with the open-source cwendt94/espn-api library).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/espn.js');
const E = require('../src/engine.js');

const SWID = '{ABCDEF12-3456-7890-ABCD-EF1234567890}';

function rawLeague() {
  return {
    scoringPeriodId: 3,
    status: { currentMatchupPeriod: 3, finalScoringPeriod: 17, isActive: true },
    settings: {
      name: 'Hook em League',
      rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 4: 1, 20: 5, 21: 1, 23: 1, 16: 0 } },
      scheduleSettings: { matchupPeriodCount: 2, playoffTeamCount: 1, matchupPeriods: { 1: [1], 2: [2], 3: [3] }, divisions: [{ id: 0 }] },
      scoringSettings: { scoringType: 'H2H_POINTS', matchupTieRule: 'NONE', scoringEnhancementType: 'NONE' },
    },
    members: [{ id: SWID, displayName: 'akshay' }],
    teams: [
      { id: 1, location: 'Austin', nickname: 'Longhorns', abbrev: 'ATX', owners: [SWID], divisionId: 0, playoffSeed: 1, record: { overall: { wins: 2, losses: 0, ties: 0, pointsFor: 41, pointsAgainst: 30 } } },
      { id: 2, name: 'Dallas Dashers', abbrev: 'DAL', owners: ['{OTHER}'], divisionId: 0, playoffSeed: 2, record: { overall: { wins: 0, losses: 2, ties: 0, pointsFor: 30, pointsAgainst: 41 } } },
    ],
    schedule: [
      { id: 1, matchupPeriodId: 1, winner: 'HOME', home: { teamId: 1, totalPoints: 21 }, away: { teamId: 2, totalPoints: 15 } },
      { id: 2, matchupPeriodId: 2, winner: 'AWAY', home: { teamId: 2, totalPoints: 15 }, away: { teamId: 1, totalPoints: 20 } },
      { id: 3, matchupPeriodId: 3, winner: 'UNDECIDED', home: { teamId: 1, totalPoints: 4 }, away: { teamId: 2, totalPoints: 2 } },
    ],
  };
}

function entry(playerId, slot, name, posId, elig, sp, pts, proj) {
  return {
    playerId,
    lineupSlotId: slot,
    playerPoolEntry: {
      appliedStatTotal: pts,
      player: {
        id: playerId, fullName: name, defaultPositionId: posId, eligibleSlots: elig, proTeamId: 1,
        stats: [
          { seasonId: 2026, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 999 },
          { seasonId: 2026, scoringPeriodId: sp, statSourceId: 0, statSplitTypeId: 1, appliedTotal: pts },
          { seasonId: 2026, scoringPeriodId: sp, statSourceId: 1, statSplitTypeId: 1, appliedTotal: proj },
        ],
      },
    },
  };
}

const RB = [2, 23, 20, 21], WR = [4, 23, 20, 21], QB = [0, 20, 21];

function rawWeek(sp, rosters) {
  // rosters: {teamId: [[pid, slot, name, posId, elig, pts, proj], ...]}
  const side = (tid) => ({
    teamId: tid,
    totalPoints: 0,
    pointsByScoringPeriod: { [sp]: rosters[tid].filter((r) => r[1] !== 20 && r[1] !== 21).reduce((s, r) => s + r[5], 0) },
    rosterForCurrentScoringPeriod: { entries: rosters[tid].map((r) => entry(r[0], r[1], r[2], r[3], r[4], sp, r[5], r[6])) },
  });
  return { schedule: [{ matchupPeriodId: sp, home: side(1), away: side(2) }] };
}

const W1 = {
  1: [[11, 0, 'Q One', 1, QB, 6, 7], [12, 2, 'R One', 2, RB, 8, 9], [13, 4, 'W One', 3, WR, 4, 5], [14, 23, 'R Flex', 2, RB, 3, 4], [15, 20, 'R Bench', 2, RB, 1, 2]],
  2: [[21, 0, 'Q Two', 1, QB, 5, 6], [22, 2, 'R Two', 2, RB, 4, 6], [23, 4, 'W Two', 3, WR, 3, 5], [24, 23, 'W Flex', 3, WR, 3, 3], [25, 20, 'W Bench', 3, WR, 9, 2]],
};
// week 2: team 2 traded 24 to team 1 for 15 (real trade)
const W2 = {
  1: [[11, 0, 'Q One', 1, QB, 7, 7], [12, 2, 'R One', 2, RB, 6, 9], [13, 4, 'W One', 3, WR, 4, 5], [24, 23, 'W Flex', 3, WR, 3, 3], [14, 20, 'R Flex', 2, RB, 5, 4]],
  2: [[21, 0, 'Q Two', 1, QB, 5, 6], [22, 2, 'R Two', 2, RB, 4, 6], [23, 4, 'W Two', 3, WR, 3, 5], [15, 23, 'R Bench', 2, RB, 3, 2], [25, 20, 'W Bench', 3, WR, 2, 2]],
};

function loadedLeague() {
  const league = S.parseLeague(rawLeague(), 123, 2026);
  for (const [sp, r] of [[1, W1], [2, W2]]) {
    const wk = S.parseWeek(rawWeek(sp, r), sp, sp);
    S.fillWeekScores(league, wk);
    S.mergeWeek(league, wk);
  }
  return league;
}

test('parseLeague normalizes settings, teams and schedule', () => {
  const l = S.parseLeague(rawLeague(), '123', '2026');
  assert.equal(l.leagueId, 123);
  assert.equal(l.name, 'Hook em League');
  assert.deepEqual(l.lineupSlotCounts, { 0: 1, 2: 1, 4: 1, 23: 1 });
  assert.equal(l.teams[0].name, 'Austin Longhorns');
  assert.equal(l.teams[1].name, 'Dallas Dashers');
  assert.deepEqual(l.matchupPeriods[2], [2]);
  assert.equal(l.regularSeasonMatchups, 2);
  assert.equal(l.hasDivisions, false);
  assert.equal(l.teams[0].espn.wins, 2);
});

test('weeksToLoad returns only finished regular-season weeks', () => {
  assert.deepEqual(S.weeksToLoad(S.parseLeague(rawLeague(), 1, 2026)).map((x) => x.sp), [1, 2]);
});

test('parseWeek reads lineups, real points and projections', () => {
  const wk = S.parseWeek(rawWeek(1, W1), 1, 1);
  assert.equal(wk.teams[1].score, 21);
  assert.deepEqual(wk.teams[1].entries[0], { playerId: 11, slotId: 0 });
  assert.equal(wk.players[12].pts, 8);
  assert.equal(wk.players[12].proj, 9);
  assert.equal(wk.players[12].pos, 'RB');
  assert.deepEqual(wk.players[12].eligible, RB);
});

test('fillWeekScores falls back to the starters when ESPN gives no score', () => {
  const league = S.parseLeague(rawLeague(), 1, 2026);
  const raw = { teams: [{ id: 1, roster: { entries: W1[1].map((r) => entry(r[0], r[1], r[2], r[3], r[4], 1, r[5], r[6])) } }] };
  const wk = S.parseRosterWeek(raw, 1);
  S.fillWeekScores(league, wk);
  assert.equal(wk.teams[1].score, 21, 'single-week matchup total from the schedule');
});

test('trade feed: parsed, then matched to the week the players changed teams', () => {
  const league = loadedLeague();
  const feed = S.parseTradeFeed({ topics: [{ id: 'T1', date: 1000, messages: [
    { messageTypeId: 244, targetId: 24, from: 2, to: 1 },
    { messageTypeId: 244, targetId: 15, from: 1, to: 2 },
    { messageTypeId: 178, targetId: 99, to: 1 },
  ] }] });
  assert.equal(feed.length, 1);
  assert.equal(feed[0].moves.length, 2);
  const { placed, unplaced } = S.assignTradeWeeks(league, feed);
  assert.equal(unplaced.length, 0);
  assert.equal(placed[0].week, 2);
});

test('roster-diff fallback infers the same trade', () => {
  const trades = S.inferTradesFromRosters(loadedLeague());
  assert.equal(trades.length, 1);
  assert.equal(trades[0].week, 2);
  assert.deepEqual(trades[0].moves.map((m) => m.playerId).sort(), [15, 24]);
});

test('player cards fill weeks a player spent off every roster', () => {
  const raw = { players: [{ id: 77, player: { id: 77, fullName: 'Free Agent', defaultPositionId: 3, eligibleSlots: WR, stats: [
    { scoringPeriodId: 2, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 12.5 },
    { scoringPeriodId: 2, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 8 },
  ] } }] };
  const cards = S.parsePlayerCards(raw, new Map([[77, [2, 3]]]));
  assert.deepEqual(cards[77].weekly[2], { pts: 12.5, proj: 8, source: 'card' });
  assert.equal(cards[77].weekly[3].pts, 0, 'no game that week');
  assert.equal(cards[77].weekly[3].proj, null);
});

test('SWID cookie finds the user team; page URL gives league and season', () => {
  const league = S.parseLeague(rawLeague(), 1, 2026);
  const swid = S.readSwid(`foo=1; SWID=${encodeURIComponent(SWID.toLowerCase())}; espn_s2=abc`);
  assert.equal(S.findMyTeam(league, swid), 1);
  assert.equal(S.findMyTeam(league, null), null);
  const ctx = S.pageContext({ search: '?leagueId=555&seasonId=2025&teamId=4' });
  assert.deepEqual(ctx, { leagueId: '555', season: 2025, teamId: 4 });
});

test('URLs only ever point at the ESPN read API', () => {
  const url = S.leagueUrl(5, 2026, ['mTeam', 'mSettings'], { scoringPeriodId: 3 });
  assert.equal(url, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/5?view=mTeam&view=mSettings&scoringPeriodId=3');
  assert.ok(S.leagueUrl(5, 2026, ['kona_league_communication'], null, '/communication/').includes('/leagues/5/communication/?view='));
  assert.throws(() => S.assertReadOnlyUrl('https://fantasy.espn.com/apis/v3/games/ffl'), /only reads/);
  assert.throws(() => S.assertReadOnlyUrl('http://lm-api-reads.fantasy.espn.com/x'), /only reads/);
  assert.throws(() => S.assertReadOnlyUrl('https://evil.example.com/'), /only reads/);
});

test('end to end: parsed ESPN data -> simulation; real trade erased by the hypothetical one', () => {
  const league = loadedLeague();
  league.realTrades = S.inferTradesFromRosters(league);
  // I (team 1) hypothetically trade bench RB 15 for team 2's bench WR 25 in week 1.
  // 15 was also in the real week-2 trade (15 for 24), so that real trade is erased:
  // 24 stays on team 2 and 14 is never benched for him.
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [15], receive: [25] }] });
  assert.deepEqual(res.errors, []);
  assert.equal(res.erased.length, 1);
  const own = E.resolveOwnership(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [15], receive: [25] }] });
  assert.ok(E.simRosterIds(league, own, 2, 2).has(24));
  assert.ok(!E.simRosterIds(league, own, 2, 1).has(24));
  // Week 2, team 1: real FLEX 24 (3 pts) is gone; best eligible fill = bench RB 14 (proj 4) vs incoming WR 25 (proj 2)
  const t1w2 = res.teamWeeks.find((x) => x.sp === 2 && x.teamId === 1);
  assert.ok(t1w2.in.some((x) => x.playerId === 14));
  assert.equal(t1w2.delta, 2); // +5 (14) - 3 (24)
  // Data check: our real records match ESPN's
  assert.deepEqual(res.checks.recordMismatches, []);
});

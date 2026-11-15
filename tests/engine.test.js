'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const { makeLeague, roster } = require('./fixtures.js');

function fourTeams(extra) {
  return makeLeague(Object.assign({
    weeks: 4,
    teams: {
      1: roster(1),
      2: roster(2, { 201: { pts: 20 } }),
      3: roster(3, { 301: { pts: 22 } }),
      4: roster(4, { 401: { pts: 15 } }),
    },
  }, extra || {}));
}

const tw = (res, sp, teamId) => res.teamWeeks.find((x) => x.sp === sp && x.teamId === teamId);
const ids = (arr) => arr.map((x) => x.playerId).sort((a, b) => a - b);

test('a trade that changes no lineup leaves every score and record unchanged', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [107], receive: [207] }] });
  assert.deepEqual(res.errors, []);
  for (const m of res.matchups) {
    assert.equal(m.sim.home, m.real.home);
    assert.equal(m.sim.away, m.real.away);
  }
  for (const t of [1, 2, 3, 4]) {
    assert.equal(res.standings.sim[t].w, res.standings.real[t].w);
    assert.equal(res.standings.sim[t].pf, res.standings.real[t].pf);
  }
});

test('hole is filled by shifting the FLEX RB; incoming WR takes FLEX (worked example)', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 2, trades: [{ partnerId: 2, send: [102], receive: [204] }] });
  assert.deepEqual(res.errors, []);
  assert.equal(tw(res, 1, 1), undefined, 'week 1 is before the trade');
  const mine = tw(res, 2, 1);
  assert.deepEqual(ids(mine.out), [102]);
  assert.deepEqual(ids(mine.in), [204]);
  assert.deepEqual(mine.moved.map((m) => [m.playerId, m.from, m.to]), [[106, 'FLEX', 'RB']]);
  assert.equal(mine.delta, -1); // +11 (204) - 12 (102)
  assert.equal(mine.out[0].reason, 'Traded away');
  assert.equal(mine.in[0].reason, 'Arrives in your trade');
});

test('partner: incoming RB out-projects their FLEX, bench WR fills the WR hole', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 2, trades: [{ partnerId: 2, send: [102], receive: [204] }] });
  const p = tw(res, 2, 2);
  assert.deepEqual(ids(p.out), [204, 206]);
  assert.deepEqual(ids(p.in), [102, 208]);
  assert.equal(p.out.find((x) => x.playerId === 206).reason, 'Benched: an incoming player out-projected him');
  assert.equal(p.in.find((x) => x.playerId === 208).reason, 'Off the bench to fill a hole');
  assert.equal(p.delta, -3); // +12 +4 -11 -8
});

test('teams the trade does not touch keep their real scores exactly', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 2, trades: [{ partnerId: 2, send: [102], receive: [204] }] });
  assert.deepEqual(res.touchedTeams.sort(), [1, 2]);
  for (const m of res.matchups.filter((x) => x.homeId === 3)) {
    assert.equal(m.sim.home, m.real.home);
    assert.equal(m.sim.away, m.real.away);
  }
});

test('incoming star replaces the lowest-projected eligible starter', () => {
  const league = fourTeams({});
  league.players[304].weekly[1] = { pts: 30, proj: 25 };
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 3, send: [108], receive: [304] }] });
  const mine = tw(res, 1, 1);
  assert.deepEqual(ids(mine.in), [304]);
  assert.deepEqual(ids(mine.out), [106]); // FLEX RB proj 8 is the weakest eligible starter
  assert.equal(mine.delta, 22);
  assert.equal(mine.moved.length, 0, 'real starters keep their slots when possible');
});

test('uneven 3-for-1 trade: the short side fills every lost starter with its best eligible bench player', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [102, 104, 106], receive: [204] }] });
  assert.deepEqual(res.errors, []);
  const mine = tw(res, 1, 1);
  // 3 starters left (RB 102, WR 104, FLEX 106); 1 arrived (WR 204, proj 12)
  // holes: WR -> 204; RB -> bench RB 107 (proj 5); FLEX -> bench WR 108 (proj 4); bench QB 109 is not eligible
  assert.deepEqual(ids(mine.out), [102, 104, 106]);
  assert.deepEqual(ids(mine.in), [107, 108, 204]);
  assert.equal(mine.lineup.length, 6, 'every starting slot is still filled');
  assert.ok(mine.in.filter((x) => x.playerId !== 204).every((x) => x.reason === 'Off the bench to fill a hole'));

  // The long side: lost 1 starter (WR 204), got 3. WR hole -> 104; RB 102 (13) also beats their FLEX 206 (8).
  const partner = tw(res, 1, 2);
  assert.deepEqual(ids(partner.out), [204, 206]);
  assert.deepEqual(ids(partner.in), [102, 104]);
  assert.ok(!partner.lineup.some((l) => l.playerId === 106), '106 (proj 8) does not out-project any starter, so he sits');
});

test('if no eligible player is left, the lost starter slot stays empty and scores 0', () => {
  const league = makeLeague({
    weeks: 1,
    teams: {
      1: roster(1).filter((p) => p.id !== 109), // no backup QB
      2: roster(2), 3: roster(3), 4: roster(4),
    },
  });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [101], receive: [207] }] });
  const mine = tw(res, 1, 1);
  assert.equal(mine.lineup.length, 5);
  assert.equal(mine.delta, -18);
});

test('bench players never jump the line when there is no hole', () => {
  const league = makeLeague({
    weeks: 2,
    teams: { 1: roster(1, { 108: { proj: 15, pts: 20 } }), 2: roster(2), 3: roster(3), 4: roster(4) },
  });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [107], receive: [207] }] });
  const mine = tw(res, 1, 1);
  assert.equal(mine.lineupChanged, false);
  assert.deepEqual([mine.in.length, mine.out.length, mine.delta], [0, 0, 0]);
  assert.ok(!mine.lineup.some((l) => l.playerId === 108), 'the better bench WR stays benched');
  assert.ok(res.matchups.every((m) => m.sim.home === m.real.home));
});

test('players in a real IR slot are never used to fill a hole', () => {
  const t1 = roster(1);
  t1.push({ id: 110, pos: 'RB', slot: 'IR', pts: 25, proj: 20 });
  const league = makeLeague({ weeks: 2, teams: { 1: t1, 2: roster(2), 3: roster(3), 4: roster(4) } });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [102], receive: [208] }] });
  const mine = tw(res, 1, 1);
  assert.ok(!mine.lineup.some((l) => l.playerId === 110));
  // RB hole: FLEX RB 106 moves to RB, bench RB 107 (5) beats incoming WR 208 (4) for FLEX
  assert.deepEqual(ids(mine.in), [107]);
});

test('a real trade involving a hypothetical player is erased; its players stay with their old teams', () => {
  const league = fourTeams({
    rosterChanges: [
      { week: 3, playerId: 204, toTeam: 3, slot: 'WR' },
      { week: 3, playerId: 205, toTeam: 3, slot: 'BE' },
      { week: 3, playerId: 303, toTeam: 2, slot: 'RB' },
    ],
    realTrades: [{ id: 'rt1', week: 3, moves: [
      { playerId: 204, fromTeamId: 2, toTeamId: 3 },
      { playerId: 205, fromTeamId: 2, toTeamId: 3 },
      { playerId: 303, fromTeamId: 3, toTeamId: 2 },
    ] }],
  });
  const scenario = { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [104], receive: [204] }] };
  const own = E.resolveOwnership(league, scenario);
  assert.equal(own.erased.length, 1);
  assert.equal(own.erased[0].causedBy, 204);
  assert.deepEqual(own.overrides.get(205), { teamId: 2, fromTeamId: 3, fromWeek: 3, kind: 'erased-trade', realTradeId: 'rt1' });
  assert.equal(own.overrides.get(303).teamId, 3);
  assert.equal(own.overrides.get(204).teamId, 1, 'the hypothetical trade always stands');

  const t3 = E.simRosterIds(league, own, 3, 3);
  assert.ok(t3.has(303) && !t3.has(204) && !t3.has(205));
  const t2 = E.simRosterIds(league, own, 3, 2);
  assert.ok(t2.has(205) && t2.has(104) && !t2.has(303) && !t2.has(204));

  const res = E.simulate(league, scenario);
  const team3 = tw(res, 3, 3);
  assert.ok(team3.in.some((x) => x.playerId === 303 && x.reason === 'Stays: the real trade that moved him was erased'));
  assert.ok(team3.out.some((x) => x.playerId === 204));
  assert.equal(res.erased[0].causedByName, 'P204');
});

test('erasing chains: a later trade of a player from an erased trade is erased too', () => {
  const league = fourTeams({
    rosterChanges: [
      { week: 3, playerId: 204, toTeam: 3, slot: 'WR' },
      { week: 3, playerId: 303, toTeam: 2, slot: 'RB' },
      { week: 4, playerId: 303, toTeam: 4, slot: 'RB' },
      { week: 4, playerId: 404, toTeam: 2, slot: 'WR' },
    ],
    realTrades: [
      { id: 'rt1', week: 3, moves: [{ playerId: 204, fromTeamId: 2, toTeamId: 3 }, { playerId: 303, fromTeamId: 3, toTeamId: 2 }] },
      { id: 'rt2', week: 4, moves: [{ playerId: 303, fromTeamId: 2, toTeamId: 4 }, { playerId: 404, fromTeamId: 4, toTeamId: 2 }] },
    ],
  });
  const own = E.resolveOwnership(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [104], receive: [204] }] });
  assert.deepEqual(own.erased.map((t) => t.id), ['rt1', 'rt2']);
  assert.equal(own.overrides.get(303).teamId, 3, '303 never leaves team 3');
  assert.equal(own.overrides.get(404).teamId, 4, '404 never leaves team 4');
  assert.ok(E.simRosterIds(league, own, 4, 4).has(404));
  assert.ok(!E.simRosterIds(league, own, 4, 4).has(303));
});

test('real trades that do not involve touched players are kept', () => {
  const league = fourTeams({
    rosterChanges: [{ week: 3, playerId: 301, toTeam: 4, slot: 'QB' }, { week: 3, playerId: 401, toTeam: 3, slot: 'QB' }],
    realTrades: [{ id: 'rt9', week: 3, moves: [{ playerId: 301, fromTeamId: 3, toTeamId: 4 }, { playerId: 401, fromTeamId: 4, toTeamId: 3 }] }],
  });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [104], receive: [204] }] });
  assert.equal(res.erased.length, 0);
  assert.ok(!res.touchedTeams.includes(3) && !res.touchedTeams.includes(4));
});

test('real trades on or before the effective week are part of the baseline', () => {
  const league = fourTeams({
    rosterChanges: [{ week: 2, playerId: 304, toTeam: 2, slot: 'BE' }, { week: 2, playerId: 208, toTeam: 3, slot: 'BE' }],
    realTrades: [{ id: 'rt0', week: 2, moves: [{ playerId: 304, fromTeamId: 3, toTeamId: 2 }, { playerId: 208, fromTeamId: 2, toTeamId: 3 }] }],
  });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 2, trades: [{ partnerId: 2, send: [108], receive: [304] }] });
  assert.deepEqual(res.errors, []);
  assert.equal(res.erased.length, 0);
});

test('a traded player later picked up by a third team stays with his hypothetical team', () => {
  const league = fourTeams({
    rosterChanges: [{ week: 3, playerId: 106, toTeam: 4, slot: 'FLEX' }],
    slotChanges: [{ week: 3, playerId: 406, slot: 'BE' }],
  });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [106], receive: [207] }] });
  const t4 = tw(res, 3, 4);
  assert.ok(t4, 'team 4 loses 106 in the simulation');
  assert.equal(t4.out[0].playerId, 106);
  assert.equal(t4.out[0].reason, 'Gone: he stays with the team that got him in your trade');
  assert.ok(t4.in.some((x) => x.playerId === 406), 'their own bench RB fills the hole');
  const own = E.resolveOwnership(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [106], receive: [207] }] });
  assert.ok(E.simRosterIds(league, own, 4, 2).has(106));
});

test('players with no real roster that week are reported as missing data', () => {
  const league = fourTeams({ rosterChanges: [{ week: 3, playerId: 106, toTeam: null }] });
  delete league.players[106].weekly[3];
  delete league.players[106].weekly[4];
  const own = E.resolveOwnership(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [106], receive: [207] }] });
  const missing = E.missingPlayerWeeks(league, own, [1, 2, 3, 4]);
  assert.deepEqual(missing.get(106), [3, 4]);
});

test('no trades replays reality exactly (the baseline shown before a trade is built)', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [] });
  assert.deepEqual(res.errors, []);
  assert.equal(res.overrides.length, 0);
  assert.equal(res.teamWeeks.length, 0);
  for (const m of res.matchups) assert.deepEqual(m.sim, m.real);
  assert.deepEqual(res.standings.sim, res.standings.real);
});

test('invalid trades are rejected with a clear error', () => {
  const league = fourTeams();
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [304], receive: [204] }] });
  assert.ok(res.errors.some((e) => e.includes('is not on your roster')));
  const res2 = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [], receive: [] }] });
  assert.ok(res2.errors.some((e) => e.includes('pick at least one player')));
});

test('standings: win percentage, then points for; median bonus adds a win to the top half', () => {
  const league = fourTeams({ medianScoring: true });
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 1, trades: [{ partnerId: 2, send: [107], receive: [207] }] });
  const r = res.standings.real;
  // weekly scores: t1 68, t2 70, t3 72, t4 65 -> t3 & t2 get median wins
  assert.equal(r[3].w, 8); // 4 H2H wins + 4 median wins
  assert.equal(r[2].w, 8);
  assert.equal(r[1].w, 0);
  assert.equal(r[3].rank, 1);
  assert.equal(r[2].rank, 2, 'tie on record broken by points for');
  assert.ok(r[2].inPlayoffs && !r[4].inPlayoffs);
  assert.equal(r[3].highs, 4);
  assert.deepEqual([r[3].apW, r[3].apL], [12, 0]);
});

test('missing projections fall back to the earlier real average, never the week itself', () => {
  const league = fourTeams();
  for (const pid of Object.keys(league.players)) league.players[pid].weekly[2].proj = undefined;
  league.players[204].weekly[1].pts = 30; // earlier average for 204 = 30
  league.players[204].weekly[2].pts = 1;  // must not be used for the decision
  const res = E.simulate(league, { myTeamId: 1, effectiveWeek: 2, trades: [{ partnerId: 2, send: [108], receive: [204] }] });
  const mine = tw(res, 2, 1);
  assert.deepEqual(ids(mine.in), [204]);
  assert.equal(mine.in[0].proj, 30);
  assert.ok(mine.flags.some((f) => f.includes('No ESPN projection')));
  assert.ok(res.checks.fallbackWeeks >= 1);
});

test('solver respects slot eligibility and the bench budget', () => {
  const slots = E.slotInstances({ 0: 1, 2: 1, 23: 1 });
  const elig = (arr) => new Set(arr);
  const kept = [{ playerId: 1, slotId: 0, proj: 15, eligible: elig([0]) }, { playerId: 2, slotId: 2, proj: 10, eligible: elig([2, 23]) }];
  const bench = [{ playerId: 3, proj: 9, eligible: elig([2, 23]) }, { playerId: 4, proj: 7, eligible: elig([2, 23]) }];
  const lineup = E.solveLineup(slots, kept, bench, [], 1);
  assert.equal(lineup.length, 3);
  assert.ok(lineup.some((l) => l.playerId === 3), 'best bench player fills the one hole');
  assert.ok(!lineup.some((l) => l.playerId === 4), 'only one bench player may enter');
});

test('completed weeks exclude a matchup period that is still undecided', () => {
  const league = fourTeams();
  league.schedule.filter((g) => g.mp === 4).forEach((g) => { g.winner = 'UNDECIDED'; });
  assert.deepEqual(E.completedWeeks(league), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Undoing a real trade ("what if I hadn't made it")
// ---------------------------------------------------------------------------

// Real week-3 trade: team 1 sends bench RB 107 to team 2 for WR 204. Team 1 starts 204 at WR
// (105 goes to the bench); team 2 moves bench WR 208 into the WR hole.
const REAL_TRADE = {
  rosterChanges: [
    { week: 3, playerId: 107, toTeam: 2, slot: 'BE' },
    { week: 3, playerId: 204, toTeam: 1, slot: 'WR' },
  ],
  slotChanges: [{ week: 3, playerId: 105, slot: 'BE' }, { week: 3, playerId: 208, slot: 'WR' }],
  realTrades: [{ id: 'rt1', week: 3, moves: [{ playerId: 107, fromTeamId: 1, toTeamId: 2 }, { playerId: 204, fromTeamId: 2, toTeamId: 1 }] }],
};

test('undoing a real trade puts its players back from the week it went through', () => {
  const league = fourTeams(REAL_TRADE);
  const res = E.simulate(league, { myTeamId: 1, undoTradeId: 'rt1' });
  assert.deepEqual(res.errors, []);
  assert.equal(res.mode, 'undo');
  assert.equal(res.effectiveWeek, 3, 'counts from the first week the players were on their new teams');
  assert.equal(res.undone.id, 'rt1');
  assert.deepEqual(res.undone.moves.map((m) => m.name), ['P107', 'P204']);

  // weeks 1-2 are untouched
  assert.equal(tw(res, 1, 1), undefined);
  assert.equal(tw(res, 2, 2), undefined);
  for (const m of res.matchups.filter((x) => x.mp < 3)) assert.deepEqual(m.sim, m.real);

  // team 1 loses 204 (WR, 11) and bench WR 105 (9) fills the hole: back to its week-1 lineup
  const mine = tw(res, 3, 1);
  assert.deepEqual(ids(mine.out), [204]);
  assert.equal(mine.out[0].reason, 'Gone: the trade that brought him here is undone');
  assert.deepEqual(ids(mine.in), [105]);
  assert.equal(mine.in[0].reason, 'Off the bench to fill a hole');
  assert.equal(mine.delta, -2);
  assert.ok(E.simRosterIds(league, E.resolveOwnership(league, { myTeamId: 1, undoTradeId: 'rt1' }), 4, 1).has(107), '107 stays home');

  // team 2 keeps 204 (proj 12), who out-projects 208 (proj 4) at WR
  const partner = tw(res, 3, 2);
  assert.deepEqual(ids(partner.in), [204]);
  assert.equal(partner.in[0].reason, 'Stays: the trade is undone');
  assert.deepEqual(ids(partner.out), [208]);
  assert.equal(partner.delta, 7);

  // team 1 really scored 68, 68, 70, 70; without the trade it scores 68 every week
  assert.equal(res.standings.real[1].pf, 276);
  assert.equal(res.standings.sim[1].pf, 272);
  assert.deepEqual(res.touchedTeams.sort(), [1, 2]);
});

test('undoing a trade erases a later real trade of one of its players (chains)', () => {
  const league = fourTeams({
    rosterChanges: [...REAL_TRADE.rosterChanges, { week: 4, playerId: 107, toTeam: 3, slot: 'BE' }, { week: 4, playerId: 307, toTeam: 2, slot: 'BE' }],
    slotChanges: REAL_TRADE.slotChanges,
    realTrades: [
      ...REAL_TRADE.realTrades,
      { id: 'rt2', week: 4, moves: [{ playerId: 107, fromTeamId: 2, toTeamId: 3 }, { playerId: 307, fromTeamId: 3, toTeamId: 2 }] },
    ],
  });
  const own = E.resolveOwnership(league, { myTeamId: 1, undoTradeId: 'rt1' });
  assert.deepEqual(own.erased.map((t) => t.id), ['rt2']);
  assert.equal(own.erased[0].causedBy, 107);
  assert.equal(own.overrides.get(107).teamId, 1, '107 never leaves team 1');
  assert.equal(own.overrides.get(107).kind, 'undone');
  assert.equal(own.overrides.get(307).teamId, 3, '307 never leaves team 3');
  assert.ok(E.simRosterIds(league, own, 4, 1).has(107));
  assert.ok(E.simRosterIds(league, own, 4, 3).has(307) && !E.simRosterIds(league, own, 4, 3).has(107));
});

test('undoing a trade keeps unrelated real trades, including ones from the same week', () => {
  const league = fourTeams({
    rosterChanges: [...REAL_TRADE.rosterChanges, { week: 3, playerId: 301, toTeam: 4, slot: 'QB' }, { week: 3, playerId: 401, toTeam: 3, slot: 'QB' }],
    slotChanges: REAL_TRADE.slotChanges,
    realTrades: [
      ...REAL_TRADE.realTrades,
      { id: 'rt3', week: 3, moves: [{ playerId: 301, fromTeamId: 3, toTeamId: 4 }, { playerId: 401, fromTeamId: 4, toTeamId: 3 }] },
    ],
  });
  const res = E.simulate(league, { myTeamId: 1, undoTradeId: 'rt1' });
  assert.equal(res.erased.length, 0);
  assert.ok(!res.touchedTeams.includes(3) && !res.touchedTeams.includes(4));
});

test('a trade that went through between weeks counts from the next week', () => {
  // players first show up on their new teams in week 4, so the trade is placed in week 4
  const league = fourTeams({
    rosterChanges: [{ week: 4, playerId: 107, toTeam: 2, slot: 'BE' }, { week: 4, playerId: 207, toTeam: 1, slot: 'BE' }],
    realTrades: [{ id: 'rt4', week: 4, moves: [{ playerId: 107, fromTeamId: 1, toTeamId: 2 }, { playerId: 207, fromTeamId: 2, toTeamId: 1 }] }],
  });
  const res = E.simulate(league, { myTeamId: 1, undoTradeId: 'rt4' });
  assert.equal(res.effectiveWeek, 4);
  assert.ok(res.teamWeeks.every((w) => w.sp >= 4));
  assert.ok(res.matchups.every((m) => m.sim.home === m.real.home), 'bench-for-bench: no score changes');
});

test('undoing someone else\'s trade changes only their teams\' scores', () => {
  const league = fourTeams({
    rosterChanges: [{ week: 2, playerId: 304, toTeam: 4, slot: 'WR' }, { week: 2, playerId: 404, toTeam: 3, slot: 'WR' }],
    realTrades: [{ id: 'rt5', week: 2, moves: [{ playerId: 304, fromTeamId: 3, toTeamId: 4 }, { playerId: 404, fromTeamId: 4, toTeamId: 3 }] }],
  });
  league.players[304].weekly[3].pts = 25;
  const res = E.simulate(league, { myTeamId: 1, undoTradeId: 'rt5' });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.touchedTeams.sort(), [3, 4]);
  assert.equal(tw(res, 3, 3).in[0].playerId, 304, '304 (25 pts in week 3) stays with team 3');
  assert.ok(!res.touchedTeams.includes(1));
  for (const m of res.matchups.filter((x) => x.homeId === 1)) assert.equal(m.sim.home, m.real.home);
});

test('undoing a trade that is not in the list is a clear error', () => {
  const league = fourTeams(REAL_TRADE);
  const res = E.simulate(league, { myTeamId: 1, undoTradeId: 'nope' });
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /no longer in this season/);
});

// A fake ESPN league served to the browser smoke test. Responses follow the
// shape of lm-api-reads.fantasy.espn.com (all players and numbers are invented).
'use strict';

const SWID = '{11111111-2222-3333-4444-555555555555}';
const TEAMS = ['Forty Acres FC', 'Lamar Blvd Bombers', 'Barton Springs Bats', 'Red River Rivals', 'Sixth Street Stallions',
  'Zilker Zebras', 'South Congress Kings', 'Rainey Street Ravens', 'Mopac Mayhem', 'Bevo Ballers'];
const FIRST = ['Jalen', 'Marcus', 'Tyler', 'Devon', 'Chris', 'Andre', 'Kyle', 'Isaiah', 'Brandon', 'Malik', 'Trey', 'Jordan', 'Caleb', 'Darius', 'Evan', 'Nate'];
const LAST = ['Hollis', 'Pruitt', 'Vance', 'Okafor', 'Marsh', 'Delgado', 'Whitfield', 'Barrow', 'Kessler', 'Ndiaye', 'Fontaine', 'Rourke', 'Sato', 'Lindqvist', 'Ambrose', 'Tate'];
const ELIG = { 1: [0, 7, 20, 21], 2: [2, 3, 23, 7, 20, 21], 3: [4, 3, 5, 23, 7, 20, 21], 4: [6, 5, 23, 7, 20, 21], 16: [16, 20, 21], 5: [17, 20, 21] };
const BASE = { 1: 18, 2: 11, 3: 11, 4: 8, 16: 7, 5: 8 };
const SLOTS = { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 6, 21: 1 };
const COMPLETED = 8, SEASON_WEEKS = 14;
const PRO_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34];
// Team logos: most on ESPN's logo host, one team with none, one with an http logo (must be ignored)
const logoFor = (i) => (i === 8 ? undefined : i === 9 ? 'http://insecure.example.com/logo.png' : `https://g.espncdn.com/lm-static/logo-packs/test/team-${i + 1}.svg`);

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function build() {
  const rand = rng(42);
  const players = {};
  const rosters = {}; // teamId -> [pid]
  let pid = 1000;
  const layout = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 16, 5];
  for (let t = 1; t <= 10; t++) {
    rosters[t] = [];
    for (const pos of layout) {
      const id = pid++;
      const tier = 0.55 + rand() * 0.9;
      players[id] = {
        id, pos,
        name: pos === 16 ? `${TEAMS[(t + 3) % 10].split(' ')[0]} D/ST` : `${FIRST[Math.floor(rand() * 16)]} ${LAST[Math.floor(rand() * 16)]}`,
        base: BASE[pos] * tier,
        pro: PRO_IDS[(id * 7) % PRO_IDS.length],
        weeks: {},
      };
      for (let w = 1; w <= SEASON_WEEKS; w++) {
        const proj = Math.round(players[id].base * (0.85 + rand() * 0.3) * 10) / 10;
        const pts = Math.max(0, Math.round((players[id].base + (rand() - 0.5) * players[id].base * 1.4) * 100) / 100);
        players[id].weeks[w] = { proj, pts };
      }
      rosters[t].push(id);
    }
  }

  // real moves: week 5 trade between teams 3 and 6; week 4 drop by team 2 picked up by team 7
  const t3 = rosters[3], t6 = rosters[6];
  const trade = { week: 5, a: 3, b: 6, fromA: [t3[3]], fromB: [t6[8]] };
  const dropped = rosters[2][11];

  const weekRosters = {};
  for (let w = 1; w <= COMPLETED; w++) {
    const r = {};
    for (let t = 1; t <= 10; t++) r[t] = [...rosters[t]];
    if (w >= trade.week) {
      r[3] = r[3].filter((x) => !trade.fromA.includes(x)).concat(trade.fromB);
      r[6] = r[6].filter((x) => !trade.fromB.includes(x)).concat(trade.fromA);
    }
    if (w >= 4) {
      r[2] = r[2].filter((x) => x !== dropped);
      r[7] = r[7].filter((x) => x !== rosters[7][15]).concat([dropped]);
    }
    weekRosters[w] = r;
  }

  // lineup by projection (what a decent manager would do)
  function lineup(ids, w) {
    const left = [...ids].sort((a, b) => players[b].weeks[w].proj - players[a].weeks[w].proj);
    const take = (slotId, n) => {
      const out = [];
      for (const id of [...left]) {
        if (out.length === n) break;
        if (ELIG[players[id].pos].includes(slotId)) { out.push(id); left.splice(left.indexOf(id), 1); }
      }
      return out.map((id) => ({ playerId: id, lineupSlotId: slotId }));
    };
    const entries = [...take(0, 1), ...take(2, 2), ...take(4, 2), ...take(6, 1), ...take(16, 1), ...take(17, 1), ...take(23, 1)];
    return entries.concat(left.map((id) => ({ playerId: id, lineupSlotId: 20 })));
  }

  const weekLineups = {};
  const teamScore = {};
  for (let w = 1; w <= COMPLETED; w++) {
    weekLineups[w] = {}; teamScore[w] = {};
    for (let t = 1; t <= 10; t++) {
      const entries = lineup(weekRosters[w][t], w);
      weekLineups[w][t] = entries;
      teamScore[w][t] = Math.round(entries.filter((e) => e.lineupSlotId !== 20).reduce((s, e) => s + players[e.playerId].weeks[w].pts, 0) * 100) / 100;
    }
  }

  // round-robin schedule
  const schedule = [];
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let gid = 1;
  for (let w = 1; w <= SEASON_WEEKS; w++) {
    const rot = [ids[0], ...ids.slice(1).map((_, i) => ids.slice(1)[(i + w - 1) % 9])];
    for (let i = 0; i < 5; i++) {
      const home = rot[i], away = rot[9 - i];
      const done = w <= COMPLETED;
      const hs = done ? teamScore[w][home] : 0, as = done ? teamScore[w][away] : 0;
      schedule.push({ id: gid++, matchupPeriodId: w, home, away, hs, as, winner: !done ? 'UNDECIDED' : hs > as ? 'HOME' : as > hs ? 'AWAY' : 'TIE' });
    }
  }

  function stat(p, w) {
    return [
      { seasonId: 2026, scoringPeriodId: w, statSourceId: 0, statSplitTypeId: 1, appliedTotal: p.weeks[w].pts },
      { seasonId: 2026, scoringPeriodId: w, statSourceId: 1, statSplitTypeId: 1, appliedTotal: p.weeks[w].proj },
    ];
  }
  function entryJson(e, w) {
    const p = players[e.playerId];
    return {
      playerId: p.id, lineupSlotId: e.lineupSlotId,
      playerPoolEntry: { appliedStatTotal: p.weeks[w].pts, player: { id: p.id, fullName: p.name, defaultPositionId: p.pos, eligibleSlots: ELIG[p.pos], proTeamId: p.pro, stats: stat(p, w) } },
    };
  }

  const record = {};
  for (let t = 1; t <= 10; t++) record[t] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
  for (const g of schedule.filter((x) => x.winner !== 'UNDECIDED')) {
    record[g.home].pointsFor += g.hs; record[g.away].pointsFor += g.as;
    record[g.home].pointsAgainst += g.as; record[g.away].pointsAgainst += g.hs;
    if (g.winner === 'HOME') { record[g.home].wins++; record[g.away].losses++; } else if (g.winner === 'AWAY') { record[g.away].wins++; record[g.home].losses++; } else { record[g.home].ties++; record[g.away].ties++; }
  }
  const seeds = Object.keys(record).map(Number).sort((a, b) => (record[b].wins - record[a].wins) || (record[b].pointsFor - record[a].pointsFor));

  function leagueJson() {
    return {
      id: 123456, seasonId: 2026, scoringPeriodId: COMPLETED + 1,
      status: { currentMatchupPeriod: COMPLETED + 1, finalScoringPeriod: 17, isActive: true },
      settings: {
        name: 'Hook Em Fantasy League',
        rosterSettings: { lineupSlotCounts: SLOTS },
        scheduleSettings: {
          matchupPeriodCount: SEASON_WEEKS, playoffTeamCount: 4, divisions: [{ id: 0 }],
          matchupPeriods: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i + 1, [i + 1]])),
        },
        scoringSettings: { scoringType: 'H2H_POINTS', matchupTieRule: 'NONE', scoringEnhancementType: 'NONE' },
      },
      members: [{ id: SWID, displayName: 'akshay' }],
      teams: TEAMS.map((name, i) => ({
        id: i + 1, name, abbrev: name.slice(0, 3).toUpperCase(), owners: i === 0 ? [SWID] : [`{OWNER-${i + 1}}`], divisionId: 0,
        playoffSeed: seeds.indexOf(i + 1) + 1, record: { overall: record[i + 1] }, logo: logoFor(i),
      })),
      schedule: schedule.map((g) => ({ id: g.id, matchupPeriodId: g.matchupPeriodId, winner: g.winner, home: { teamId: g.home, totalPoints: g.hs }, away: { teamId: g.away, totalPoints: g.as } })),
    };
  }

  function weekJson(w) {
    const side = (t) => ({ teamId: t, totalPoints: teamScore[w][t], pointsByScoringPeriod: { [w]: teamScore[w][t] }, rosterForCurrentScoringPeriod: { entries: weekLineups[w][t].map((e) => entryJson(e, w)) } });
    return { schedule: schedule.filter((g) => g.matchupPeriodId === w).map((g) => ({ id: g.id, matchupPeriodId: w, winner: g.winner, home: side(g.home), away: side(g.away) })) };
  }

  function feedJson() {
    return { topics: [{ id: 'T-1', date: Date.UTC(2026, 9, 1), messages: [
      ...trade.fromA.map((id) => ({ messageTypeId: 244, targetId: id, from: trade.a, to: trade.b })),
      ...trade.fromB.map((id) => ({ messageTypeId: 244, targetId: id, from: trade.b, to: trade.a })),
    ] }] };
  }

  function cardsJson(ids) {
    return { players: ids.filter((id) => players[id]).map((id) => {
      const p = players[id];
      const stats = [];
      for (let w = 1; w <= COMPLETED; w++) stats.push(...stat(p, w));
      return { id, player: { id, fullName: p.name, defaultPositionId: p.pos, eligibleSlots: ELIG[p.pos], proTeamId: p.pro, stats } };
    }) };
  }

  function respond(url, filterHeader) {
    const u = new URL(url);
    const views = u.searchParams.getAll('view');
    const filter = filterHeader ? JSON.parse(filterHeader) : null;
    if (u.pathname.includes('/communication')) return feedJson();
    if (views.includes('kona_playercard')) return cardsJson(filter.players.filterIds.value);
    if (views.includes('mMatchupScore')) return weekJson(Number(u.searchParams.get('scoringPeriodId')));
    if (views.includes('mSettings')) return leagueJson();
    return null;
  }

  return { respond, SWID, players, rosters, trade };
}

module.exports = { build };

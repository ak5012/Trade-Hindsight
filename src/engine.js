/*
 * Trade Hindsight - simulation engine.
 *
 * Pure functions only: no network, no DOM, no ESPN writes. Takes the
 * normalized league built by espn.js plus a hypothetical trade scenario and
 * returns re-scored matchups, standings and per-week lineup changes.
 *
 * Rules (see the PRD):
 *  1. From the effective week, hypothetically traded players switch teams and
 *     stay there for the rest of the season.
 *  2. Any later REAL trade that involves one of those players is erased: its
 *     players stay with their pre-trade teams. Chains to later trades too.
 *  3. Teams whose roster changed in a week get their lineup rebuilt:
 *     real starters stay, holes are filled by the best projected eligible
 *     player, incoming players start only if they out-project a starter,
 *     bench players only enter to fill holes.
 *  4. Score = real score - real points of starters lost + real points of
 *     new starters. Untouched teams keep their real score exactly.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.THEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SLOT_LABEL = {
    0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP',
    8: 'DT', 9: 'DE', 10: 'LB', 11: 'DL', 12: 'CB', 13: 'S', 14: 'DB', 15: 'DP',
    16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BE', 21: 'IR', 23: 'FLEX',
  };
  const BENCH = 20;
  const IR = 21;

  const round2 = (x) => Math.round(x * 100) / 100;
  const isStarterSlot = (slotId) => slotId !== BENCH && slotId !== IR && slotId !== undefined && slotId !== null;
  const slotLabel = (id) => SLOT_LABEL[id] || String(id);

  // ---------------------------------------------------------------------------
  // Weeks and indexes
  // ---------------------------------------------------------------------------

  /** Scoring periods of every completed regular-season matchup period, sorted. */
  function completedWeeks(league) {
    const out = [];
    for (const mp of regularSeasonPeriods(league)) {
      if (!isPeriodComplete(league, mp)) continue;
      for (const sp of league.matchupPeriods[mp] || [mp]) {
        if (league.weeks[sp]) out.push(sp);
      }
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }

  function regularSeasonPeriods(league) {
    const out = [];
    for (let mp = 1; mp <= league.regularSeasonMatchups; mp++) out.push(mp);
    return out;
  }

  function isPeriodComplete(league, mp) {
    const games = league.schedule.filter((g) => g.mp === mp);
    if (!games.length) return false;
    if (!games.every((g) => g.winner && g.winner !== 'UNDECIDED')) return false;
    return (league.matchupPeriods[mp] || [mp]).every((sp) => !!league.weeks[sp]);
  }

  /** ownerOf[sp] = Map(playerId -> teamId), from the real weekly rosters. */
  function buildOwnerIndex(league) {
    const ownerOf = {};
    for (const sp of Object.keys(league.weeks)) {
      const m = new Map();
      const wk = league.weeks[sp];
      for (const tid of Object.keys(wk.teams)) {
        for (const e of wk.teams[tid].entries) m.set(e.playerId, Number(tid));
      }
      ownerOf[sp] = m;
    }
    return ownerOf;
  }

  function realOwner(league, ownerOf, sp, playerId) {
    const m = ownerOf[sp];
    return m ? m.get(playerId) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Ownership: hypothetical trades + erased real trades
  // ---------------------------------------------------------------------------

  /**
   * Returns { overrides: Map(playerId -> {teamId, fromWeek, kind, ...}),
   *           erased: [realTrade + causedBy], errors: [] }
   */
  function resolveOwnership(league, scenario) {
    const errors = [];
    const E = Number(scenario.effectiveWeek);
    const me = Number(scenario.myTeamId);
    const ownerOf = buildOwnerIndex(league);
    const overrides = new Map();

    // No trades is allowed: the replay is then reality, which the panel shows before a trade is built.
    if (!league.weeks[E]) errors.push(`No roster data for week ${E}.`);

    const partnersSeen = new Set();
    (scenario.trades || []).forEach((t, i) => {
      const partner = Number(t.partnerId);
      const label = `Trade ${i + 1}`;
      if (!partner || partner === me) errors.push(`${label}: pick a trade partner.`);
      if (partnersSeen.has(partner)) errors.push(`${label}: only one trade per partner team.`);
      partnersSeen.add(partner);
      if (!t.send.length && !t.receive.length) errors.push(`${label}: pick at least one player.`);

      for (const pid of t.send) {
        const owner = realOwner(league, ownerOf, E, pid);
        if (owner !== me) errors.push(`${label}: ${playerName(league, pid)} is not on your roster in week ${E}.`);
        if (overrides.has(pid)) errors.push(`${playerName(league, pid)} is in more than one trade.`);
        overrides.set(pid, { teamId: partner, fromTeamId: me, fromWeek: E, kind: 'hypothetical', tradeIndex: i });
      }
      for (const pid of t.receive) {
        const owner = realOwner(league, ownerOf, E, pid);
        if (owner !== partner) errors.push(`${label}: ${playerName(league, pid)} is not on that team's roster in week ${E}.`);
        if (overrides.has(pid)) errors.push(`${playerName(league, pid)} is in more than one trade.`);
        overrides.set(pid, { teamId: me, fromTeamId: partner, fromWeek: E, kind: 'hypothetical', tradeIndex: i });
      }
    });

    // Erase real trades (after the effective week) that touch a player whose
    // ownership the simulation has already changed. Processed in order, so a
    // later trade involving a player from an erased trade is erased too.
    const touched = new Set(overrides.keys());
    const erased = [];
    const realTrades = [...(league.realTrades || [])].sort((a, b) => a.week - b.week);
    for (const rt of realTrades) {
      if (rt.week <= E) continue; // already part of the rosters the trade was built from
      const hit = rt.moves.find((m) => touched.has(m.playerId));
      if (!hit) continue;
      erased.push(Object.assign({}, rt, { causedBy: hit.playerId }));
      for (const m of rt.moves) {
        if (!overrides.has(m.playerId)) {
          overrides.set(m.playerId, {
            teamId: m.fromTeamId, fromTeamId: m.toTeamId, fromWeek: rt.week,
            kind: 'erased-trade', realTradeId: rt.id,
          });
        }
        touched.add(m.playerId);
      }
    }

    return { overrides, erased, errors, ownerOf };
  }

  /** Player IDs on a team's simulated roster for a scoring period. */
  function simRosterIds(league, ownership, sp, teamId) {
    const wk = league.weeks[sp];
    const realEntries = (wk && wk.teams[teamId] && wk.teams[teamId].entries) || [];
    const ids = new Set();
    for (const e of realEntries) {
      const ov = ownership.overrides.get(e.playerId);
      if (ov && ov.fromWeek <= sp && ov.teamId !== teamId) continue; // gone in the simulation
      ids.add(e.playerId);
    }
    for (const [pid, ov] of ownership.overrides) {
      if (ov.fromWeek <= sp && ov.teamId === teamId) ids.add(pid);
    }
    return ids;
  }

  /** Player/weeks the simulation needs but no real roster had (e.g. dropped to free agency). */
  function missingPlayerWeeks(league, ownership, weeks) {
    const missing = new Map();
    for (const [pid, ov] of ownership.overrides) {
      for (const sp of weeks) {
        if (sp < ov.fromWeek) continue;
        const p = league.players[pid];
        if (!p || !p.weekly || !p.weekly[sp]) {
          if (!missing.has(pid)) missing.set(pid, []);
          missing.get(pid).push(sp);
        }
      }
    }
    return missing;
  }

  // ---------------------------------------------------------------------------
  // Points and projections
  // ---------------------------------------------------------------------------

  function playerName(league, pid) {
    const p = league.players[pid];
    return p && p.name ? p.name : `Player ${pid}`;
  }

  function weekHasProjections(league, sp) {
    if (!league._projCache) league._projCache = {};
    if (sp in league._projCache) return league._projCache[sp];
    let found = false;
    for (const pid of Object.keys(league.players)) {
      const w = league.players[pid].weekly && league.players[pid].weekly[sp];
      if (w && typeof w.proj === 'number') { found = true; break; }
    }
    league._projCache[sp] = found;
    return found;
  }

  /** Average real points over earlier weeks only (no hindsight). */
  function priorAverage(league, pid, sp) {
    const p = league.players[pid];
    if (!p || !p.weekly) return 0;
    let sum = 0, n = 0;
    for (const k of Object.keys(p.weekly)) {
      const w = Number(k);
      if (w < sp && typeof p.weekly[k].pts === 'number') { sum += p.weekly[k].pts; n++; }
    }
    return n ? sum / n : 0;
  }

  /** Returns { proj, fallback } for decisions. Never uses the week's own points. */
  function projectionFor(league, pid, sp) {
    const p = league.players[pid];
    const w = p && p.weekly && p.weekly[sp];
    if (w && typeof w.proj === 'number') return { proj: w.proj, fallback: false };
    if (weekHasProjections(league, sp) && !(w && w.pts > 0)) return { proj: 0, fallback: false };
    return { proj: priorAverage(league, pid, sp), fallback: true };
  }

  function pointsFor(league, pid, sp) {
    const p = league.players[pid];
    const w = p && p.weekly && p.weekly[sp];
    if (w && typeof w.pts === 'number') return { pts: w.pts, missing: false };
    return { pts: 0, missing: true };
  }

  function eligibleSlots(league, pid) {
    const p = league.players[pid];
    return new Set((p && p.eligible) || []);
  }

  // ---------------------------------------------------------------------------
  // Lineup solver (min-cost max-flow on a tiny graph)
  // ---------------------------------------------------------------------------

  function slotInstances(lineupSlotCounts) {
    const out = [];
    Object.keys(lineupSlotCounts)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((slotId) => {
        if (!isStarterSlot(slotId)) return;
        for (let i = 0; i < lineupSlotCounts[slotId]; i++) out.push({ key: `${slotId}#${i}`, slotId });
      });
    return out;
  }

  function minCostMaxFlow(nodeCount, s, t, edgeList) {
    const graph = Array.from({ length: nodeCount }, () => []);
    const edges = [];
    for (const [u, v, cap, cost] of edgeList) {
      graph[u].push(edges.length); edges.push({ to: v, cap, cost, flow: 0 });
      graph[v].push(edges.length); edges.push({ to: u, cap: 0, cost: -cost, flow: 0 });
    }
    for (;;) {
      const dist = new Array(nodeCount).fill(Infinity);
      const inQ = new Array(nodeCount).fill(false);
      const prevEdge = new Array(nodeCount).fill(-1);
      dist[s] = 0;
      const queue = [s];
      inQ[s] = true;
      while (queue.length) {
        const u = queue.shift();
        inQ[u] = false;
        for (const ei of graph[u]) {
          const e = edges[ei];
          if (e.cap - e.flow > 0 && dist[u] + e.cost < dist[e.to]) {
            dist[e.to] = dist[u] + e.cost;
            prevEdge[e.to] = ei;
            if (!inQ[e.to]) { queue.push(e.to); inQ[e.to] = true; }
          }
        }
      }
      if (dist[t] === Infinity || dist[t] >= 0) break;
      // bottleneck is always 1 here, but compute it properly
      let push = Infinity;
      for (let v = t; v !== s; v = edges[prevEdge[v] ^ 1].to) {
        const e = edges[prevEdge[v]];
        push = Math.min(push, e.cap - e.flow);
      }
      for (let v = t; v !== s; v = edges[prevEdge[v] ^ 1].to) {
        edges[prevEdge[v]].flow += push;
        edges[prevEdge[v] ^ 1].flow -= push;
      }
    }
    return { graph, edges };
  }

  /**
   * kept:     [{playerId, slotId, proj}]  real starters still on the team
   * bench:    [{playerId, proj, eligible:Set}]  real bench players still on the team (no IR)
   * incoming: [{playerId, proj, eligible:Set}]  players the simulation added
   * holes:    number of real starters the team lost
   * Returns   [{playerId, slotId}]
   */
  function solveLineup(slots, kept, bench, incoming, holes) {
    const BIG = 10000000;
    const players = [
      ...kept.map((p) => Object.assign({ group: 0 }, p)),
      ...bench.map((p) => Object.assign({ group: 1 }, p)),
      ...incoming.map((p) => Object.assign({ group: 2 }, p)),
    ];
    // node ids: 0 = source, 1..3 = groups, then players, then slots, then sink
    const S = 0, G = [1, 2, 3];
    const P0 = 4;
    const L0 = P0 + players.length;
    const T = L0 + slots.length;
    const edgeList = [
      [S, G[0], kept.length, 0],
      [S, G[1], Math.max(0, holes), 0],
      [S, G[2], incoming.length, 0],
    ];
    players.forEach((p, i) => {
      edgeList.push([G[p.group], P0 + i, 1, 0]);
      slots.forEach((slot, j) => {
        const sameSlot = p.group === 0 && p.slotId === slot.slotId;
        const eligible = sameSlot || (p.eligible && p.eligible.has(slot.slotId));
        if (!eligible) return;
        const weight = BIG + Math.round(p.proj * 100) * 10 + (p.group === 0 ? 6 : 0) + (sameSlot ? 3 : 0);
        edgeList.push([P0 + i, L0 + j, 1, -weight]);
      });
    });
    slots.forEach((_, j) => edgeList.push([L0 + j, T, 1, 0]));

    const { graph, edges } = minCostMaxFlow(T + 1, S, T, edgeList);
    const lineup = [];
    players.forEach((p, i) => {
      for (const ei of graph[P0 + i]) {
        const e = edges[ei];
        if (e.flow > 0 && e.to >= L0 && e.to < T) lineup.push({ playerId: p.playerId, slotId: slots[e.to - L0].slotId });
      }
    });
    return lineup;
  }

  // ---------------------------------------------------------------------------
  // Team-week rebuild
  // ---------------------------------------------------------------------------

  function rebuildTeamWeek(league, ownership, sp, teamId, slots) {
    const wk = league.weeks[sp];
    const realTeam = (wk && wk.teams[teamId]) || { score: 0, entries: [] };
    const realEntries = realTeam.entries;
    const realIds = new Set(realEntries.map((e) => e.playerId));
    const simIds = simRosterIds(league, ownership, sp, teamId);

    const same = realIds.size === simIds.size && [...realIds].every((id) => simIds.has(id));
    if (same) return null;

    const flags = [];
    const proj = (pid) => {
      const r = projectionFor(league, pid, sp);
      if (r.fallback) flags.push(`No ESPN projection for ${playerName(league, pid)}; used his earlier average.`);
      return r.proj;
    };

    const realStarters = realEntries.filter((e) => isStarterSlot(e.slotId));
    const kept = realStarters
      .filter((e) => simIds.has(e.playerId))
      .map((e) => ({ playerId: e.playerId, slotId: e.slotId, proj: proj(e.playerId), eligible: eligibleSlots(league, e.playerId) }));
    const departedStarters = realStarters.filter((e) => !simIds.has(e.playerId));
    const bench = realEntries
      .filter((e) => e.slotId === BENCH && simIds.has(e.playerId))
      .map((e) => ({ playerId: e.playerId, proj: proj(e.playerId), eligible: eligibleSlots(league, e.playerId) }));
    const incomingIds = [...simIds].filter((id) => !realIds.has(id));
    const incoming = incomingIds.map((id) => ({ playerId: id, proj: proj(id), eligible: eligibleSlots(league, id) }));

    const lineup = solveLineup(slots, kept, bench, incoming, departedStarters.length);
    const simStarterIds = new Set(lineup.map((l) => l.playerId));
    const realStarterIds = new Set(realStarters.map((e) => e.playerId));

    const describe = (pid, slotId) => {
      const pr = projectionFor(league, pid, sp);
      const pt = pointsFor(league, pid, sp);
      if (pt.missing && simStarterIds.has(pid)) flags.push(`No points found for ${playerName(league, pid)} in week ${sp}; counted as 0.`);
      return { playerId: pid, name: playerName(league, pid), slot: slotLabel(slotId), proj: round2(pr.proj), pts: round2(pt.pts) };
    };

    const out = [];
    for (const e of realStarters) {
      if (simStarterIds.has(e.playerId)) continue;
      const d = describe(e.playerId, e.slotId);
      if (!simIds.has(e.playerId)) {
        const ov = ownership.overrides.get(e.playerId);
        if (ov && ov.kind === 'erased-trade') d.reason = 'Gone: the real trade that brought him here was erased';
        else if (ov && ov.fromTeamId === teamId) d.reason = 'Traded away';
        else d.reason = 'Gone: he stays with the team that got him in your trade';
      } else {
        d.reason = 'Benched: an incoming player out-projected him';
      }
      out.push(d);
    }
    const inn = [];
    for (const l of lineup) {
      if (realStarterIds.has(l.playerId)) continue;
      const d = describe(l.playerId, l.slotId);
      if (incomingIds.includes(l.playerId)) {
        const ov = ownership.overrides.get(l.playerId);
        d.reason = ov && ov.kind === 'erased-trade' ? 'Stays: the real trade that moved him was erased' : 'Arrives in your trade';
      } else {
        d.reason = 'Off the bench to fill a hole';
      }
      inn.push(d);
    }
    const moved = [];
    for (const l of lineup) {
      const realEntry = realStarters.find((e) => e.playerId === l.playerId);
      if (realEntry && realEntry.slotId !== l.slotId) {
        moved.push({ playerId: l.playerId, name: playerName(league, l.playerId), from: slotLabel(realEntry.slotId), to: slotLabel(l.slotId) });
      }
    }

    const lost = out.reduce((s, d) => s + d.pts, 0);
    const gained = inn.reduce((s, d) => s + d.pts, 0);
    const delta = round2(gained - lost);

    // Data check: do the real starters add up to ESPN's score?
    const starterSum = realStarters.reduce((s, e) => s + pointsFor(league, e.playerId, sp).pts, 0);
    const scoreCheck = typeof realTeam.score === 'number' ? round2(realTeam.score - starterSum) : null;

    return {
      sp, teamId,
      realScore: realTeam.score,
      simScore: typeof realTeam.score === 'number' ? round2(realTeam.score + delta) : null,
      delta,
      lineupChanged: out.length + inn.length + moved.length > 0,
      out, in: inn, moved,
      lineup: lineup.map((l) => ({ slot: slotLabel(l.slotId), playerId: l.playerId, name: playerName(league, l.playerId) })),
      scoreCheck,
      flags: [...new Set(flags)],
    };
  }

  // ---------------------------------------------------------------------------
  // Matchups, standings, stats
  // ---------------------------------------------------------------------------

  function decide(a, b) {
    if (a === null || b === null || a === undefined || b === undefined) return 'UNDECIDED';
    if (Math.abs(a - b) < 0.005) return 'TIE';
    return a > b ? 'HOME' : 'AWAY';
  }

  function computeStandings(league, games, periods) {
    const teams = {};
    for (const t of league.teams) {
      teams[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, apW: 0, apL: 0, apT: 0, highs: 0, games: 0 };
    }
    for (const mp of periods) {
      const g = games.filter((x) => x.mp === mp);
      const scores = [];
      for (const x of g) {
        const h = teams[x.homeId];
        if (!h) continue;
        h.pf += x.home; h.games++;
        scores.push({ id: x.homeId, s: x.home });
        if (x.awayId === null || x.awayId === undefined) continue;
        const a = teams[x.awayId];
        a.pf += x.away; a.games++;
        h.pa += x.away; a.pa += x.home;
        scores.push({ id: x.awayId, s: x.away });
        if (x.winner === 'HOME') { h.w++; a.l++; } else if (x.winner === 'AWAY') { a.w++; h.l++; } else if (x.winner === 'TIE') { h.t++; a.t++; }
      }
      // all-play and weekly high score
      for (const me of scores) {
        for (const other of scores) {
          if (other.id === me.id) continue;
          if (Math.abs(me.s - other.s) < 0.005) teams[me.id].apT++;
          else if (me.s > other.s) teams[me.id].apW++;
          else teams[me.id].apL++;
        }
      }
      if (scores.length) {
        const max = Math.max(...scores.map((x) => x.s));
        scores.filter((x) => Math.abs(x.s - max) < 0.005).forEach((x) => teams[x.id].highs++);
      }
      // median bonus: top half of the league gets an extra win
      if (league.medianScoring && scores.length > 1) {
        const sorted = [...scores].sort((a, b) => b.s - a.s);
        const half = Math.floor(sorted.length / 2);
        sorted.forEach((x, i) => { if (i < half) teams[x.id].w++; else teams[x.id].l++; });
      }
    }
    const order = Object.keys(teams).map(Number).sort((a, b) => {
      const A = teams[a], B = teams[b];
      const pa = (A.w + 0.5 * A.t) / Math.max(1, A.w + A.l + A.t);
      const pb = (B.w + 0.5 * B.t) / Math.max(1, B.w + B.l + B.t);
      if (pb !== pa) return pb - pa;
      return B.pf - A.pf;
    });
    order.forEach((id, i) => {
      teams[id].rank = i + 1;
      teams[id].inPlayoffs = i < league.playoffTeamCount;
      teams[id].pf = round2(teams[id].pf);
      teams[id].pa = round2(teams[id].pa);
    });
    return teams;
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  function simulate(league, scenario) {
    delete league._projCache;
    const ownership = resolveOwnership(league, scenario);
    if (ownership.errors.length) return { errors: ownership.errors };

    const E = Number(scenario.effectiveWeek);
    const weeks = completedWeeks(league);
    const periods = regularSeasonPeriods(league).filter((mp) => isPeriodComplete(league, mp));
    const slots = slotInstances(league.lineupSlotCounts);

    const teamWeeks = [];
    const delta = {}; // delta[teamId][sp]
    for (const t of league.teams) delta[t.id] = {};
    for (const sp of weeks) {
      if (sp < E) continue;
      for (const t of league.teams) {
        const tw = rebuildTeamWeek(league, ownership, sp, t.id, slots);
        if (!tw) continue;
        teamWeeks.push(tw);
        delta[t.id][sp] = tw.delta;
      }
    }

    const realGames = [];
    const simGames = [];
    const matchups = [];
    for (const g of league.schedule) {
      if (!periods.includes(g.mp)) continue;
      const sps = league.matchupPeriods[g.mp] || [g.mp];
      const d = (tid) => sps.reduce((s, sp) => s + ((delta[tid] && delta[tid][sp]) || 0), 0);
      const hasAway = g.awayId !== null && g.awayId !== undefined;
      const rh = g.homeTotal, ra = hasAway ? g.awayTotal : null;
      const sh = round2(rh + d(g.homeId));
      const sa = hasAway ? round2(ra + d(g.awayId)) : null;
      const realWinner = hasAway ? decide(rh, ra) : 'BYE';
      const simWinner = hasAway ? decide(sh, sa) : 'BYE';
      realGames.push({ mp: g.mp, homeId: g.homeId, awayId: hasAway ? g.awayId : null, home: rh, away: ra, winner: realWinner });
      simGames.push({ mp: g.mp, homeId: g.homeId, awayId: hasAway ? g.awayId : null, home: sh, away: sa, winner: simWinner });
      matchups.push({
        mp: g.mp, homeId: g.homeId, awayId: hasAway ? g.awayId : null,
        real: { home: rh, away: ra, winner: realWinner },
        sim: { home: sh, away: sa, winner: simWinner },
        espnWinner: g.winner,
      });
    }

    const real = computeStandings(league, realGames, periods);
    const sim = computeStandings(league, simGames, periods);

    // Data checks against ESPN's own numbers
    const checks = { winnerMismatches: [], recordMismatches: [], seedMismatches: [], scoreMismatches: [], fallbackWeeks: 0 };
    for (const m of matchups) {
      if (m.awayId !== null && m.espnWinner && m.espnWinner !== m.real.winner) checks.winnerMismatches.push(m);
    }
    for (const t of league.teams) {
      const r = real[t.id];
      if (t.espn && (t.espn.wins !== r.w || t.espn.losses !== r.l || t.espn.ties !== r.t)) {
        checks.recordMismatches.push({ teamId: t.id, espn: `${t.espn.wins}-${t.espn.losses}-${t.espn.ties}`, ours: `${r.w}-${r.l}-${r.t}` });
      }
      if (t.espn && t.espn.seed && t.espn.seed !== r.rank) checks.seedMismatches.push({ teamId: t.id, espn: t.espn.seed, ours: r.rank });
    }
    for (const tw of teamWeeks) {
      if (tw.scoreCheck !== null && Math.abs(tw.scoreCheck) > 0.05) checks.scoreMismatches.push({ sp: tw.sp, teamId: tw.teamId, diff: tw.scoreCheck });
      if (tw.flags.some((f) => f.startsWith('No ESPN projection'))) checks.fallbackWeeks++;
    }

    const touchedTeams = [...new Set(teamWeeks.map((tw) => tw.teamId))];
    return {
      errors: [],
      effectiveWeek: E,
      weeks,
      periods,
      overrides: [...ownership.overrides].map(([playerId, ov]) => Object.assign({ playerId, name: playerName(league, playerId) }, ov)),
      erased: ownership.erased.map((rt) => Object.assign({}, rt, {
        causedByName: playerName(league, rt.causedBy),
        moves: rt.moves.map((m) => Object.assign({ name: playerName(league, m.playerId) }, m)),
      })),
      teamWeeks,
      touchedTeams,
      matchups,
      standings: { real, sim },
      checks,
    };
  }

  return {
    SLOT_LABEL, slotLabel, isStarterSlot, round2,
    completedWeeks, regularSeasonPeriods, isPeriodComplete,
    buildOwnerIndex, resolveOwnership, simRosterIds, missingPlayerWeeks,
    projectionFor, pointsFor, slotInstances, solveLineup, rebuildTeamWeek,
    computeStandings, simulate, playerName,
  };
});

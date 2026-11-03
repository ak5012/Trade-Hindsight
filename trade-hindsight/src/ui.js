/*
 * Trade Hindsight - the panel shown over fantasy.espn.com.
 * Draws inside its own shadow root, so ESPN's page and styles are untouched.
 * Reads data through THEspn (GET only) and runs THEngine locally.
 */
(function () {
  'use strict';
  const Espn = window.THEspn;
  const Engine = window.THEngine;

  const SLOT_ORDER = [0, 1, 2, 3, 4, 5, 6, 23, 7, 16, 17, 18, 8, 9, 10, 11, 12, 13, 14, 15, 19, 20, 21];

  const state = {
    host: null, root: null, open: false,
    ctx: null, league: null,
    phase: 'idle', progress: '', error: null,
    myTeamId: null, effectiveWeek: null,
    trades: [],
    result: null, runErrors: [], running: false,
    detailTeamId: null, expanded: new Set(),
  };

  // ---------------------------------------------------------------------------
  // tiny DOM helper
  // ---------------------------------------------------------------------------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  const teamName = (id) => {
    const t = state.league && state.league.teams.find((x) => x.id === Number(id));
    return t ? t.name : `Team ${id}`;
  };
  const rec = (s) => `${s.w}–${s.l}${s.t ? `–${s.t}` : ''}`;
  const pts = (n) => (typeof n === 'number' ? n.toFixed(2) : '–');
  const pts1 = (n) => (typeof n === 'number' ? n.toFixed(1) : '–');
  const signed = (n, d = 2) => (n > 0 ? `+${n.toFixed(d)}` : n < 0 ? `−${Math.abs(n).toFixed(d)}` : (0).toFixed(d));
  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  // ---------------------------------------------------------------------------
  // mount / open / close
  // ---------------------------------------------------------------------------
  function mount() {
    if (state.host) return;
    state.host = document.createElement('div');
    state.host.id = 'trade-hindsight-root';
    state.root = state.host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(state.host);
    document.addEventListener('keydown', (e) => {
      if (state.open && e.key === 'Escape') close();
    });
  }

  function setLauncherVisible(visible) {
    const l = document.getElementById('trade-hindsight-launcher');
    if (l) l.style.display = visible ? '' : 'none';
  }

  function open() {
    mount();
    state.open = true;
    state.host.style.display = '';
    setLauncherVisible(false);
    if (state.phase === 'idle') start();
    render();
  }

  function close() {
    state.open = false;
    if (state.host) state.host.style.display = 'none';
    setLauncherVisible(true);
  }

  function toggle() { state.open ? close() : open(); }

  // ---------------------------------------------------------------------------
  // loading
  // ---------------------------------------------------------------------------
  async function start(opts) {
    state.ctx = Espn.pageContext(window.location);
    state.result = null;
    state.runErrors = [];
    if (!state.ctx.leagueId) {
      state.phase = 'no-league';
      render();
      return;
    }
    await loadSeason(state.ctx.season, opts);
  }

  async function loadSeason(season, opts) {
    state.phase = 'loading';
    state.error = null;
    state.result = null;
    state.progress = 'Reading league settings';
    render();
    try {
      const league = await Espn.loadLeague(state.ctx.leagueId, season);
      if (league.scoringType && !/POINTS/.test(league.scoringType)) {
        throw new Error('This league uses category scoring. Trade Hindsight only supports head-to-head points leagues for now.');
      }
      if (season < 2019) throw new Error('ESPN does not serve weekly lineups before 2019, so seasons before 2019 cannot be replayed.');
      state.league = league;
      const weeks = await Espn.loadWeeks(league, (msg) => { state.progress = msg; render(); }, opts);
      state.progress = 'Reading real trades';
      render();
      await Espn.loadRealTrades(league);
      if (!weeks.length) {
        state.phase = 'no-weeks';
        render();
        return;
      }
      const completed = Engine.completedWeeks(league);
      const swidTeam = Espn.findMyTeam(league, Espn.readSwid(document.cookie));
      const urlTeam = league.teams.some((t) => t.id === state.ctx.teamId) ? state.ctx.teamId : null;
      state.myTeamId = swidTeam || urlTeam || league.teams[0].id;
      state.effectiveWeek = completed[0];
      state.trades = [{ partnerId: null, send: [], receive: [] }];
      state.detailTeamId = state.myTeamId;
      state.phase = 'ready';
    } catch (err) {
      state.phase = 'error';
      state.error = err && err.message ? err.message : String(err);
    }
    render();
  }

  async function run() {
    const league = state.league;
    const scenario = {
      myTeamId: state.myTeamId,
      effectiveWeek: state.effectiveWeek,
      trades: state.trades.map((t) => ({ partnerId: t.partnerId, send: [...t.send], receive: [...t.receive] })),
    };
    state.running = true;
    state.runErrors = [];
    render();
    try {
      const own = Engine.resolveOwnership(league, scenario);
      if (own.errors.length) {
        state.runErrors = own.errors;
        state.result = null;
      } else {
        const missing = Engine.missingPlayerWeeks(league, own, Engine.completedWeeks(league));
        if (missing.size) await Espn.fetchPlayerCards(league, missing);
        const res = Engine.simulate(league, scenario);
        if (res.errors.length) state.runErrors = res.errors;
        else {
          state.result = res;
          state.scrollToResults = true;
          state.detailTeamId = state.myTeamId;
          state.expanded = new Set();
        }
      }
    } catch (err) {
      state.runErrors = [err && err.message ? err.message : String(err)];
    }
    state.running = false;
    render();
  }

  // ---------------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------------
  function render() {
    if (!state.root) return;
    state.root.innerHTML = '';
    state.root.appendChild(h('style', { text: CSS }));
    if (!state.open) return;
    const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Trade Hindsight' },
      header(),
      body());
    state.root.appendChild(h('div', { class: 'scrim', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, panel));
    if (state.scrollToResults) {
      state.scrollToResults = false;
      const target = state.root.querySelector('.results');
      if (target && window.innerWidth <= 900) target.scrollIntoView({ block: 'start' });
    }
  }

  function header() {
    const l = state.league;
    return h('header', { class: 'bar' },
      h('div', { class: 'brand' },
        h('span', { class: 'wordmark' }, 'Trade Hindsight'),
        l ? h('span', { class: 'league' }, `${l.name}, ${l.season} season`) : null),
      h('div', { class: 'bar-right' },
        h('span', { class: 'readonly', title: 'Trade Hindsight only reads league data. Nothing here is sent to ESPN.' }, 'Read-only: your real league is never changed'),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '×')));
  }

  function body() {
    if (state.phase === 'no-league') {
      return h('div', { class: 'message' },
        h('h2', {}, 'Open your league first'),
        h('p', {}, 'Go to any page of your ESPN fantasy football league (its address contains leagueId=), then open Trade Hindsight again.'));
    }
    if (state.phase === 'loading') {
      return h('div', { class: 'message' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'progress', role: 'status' }, state.progress));
    }
    if (state.phase === 'error') {
      return h('div', { class: 'message' },
        h('h2', {}, 'Could not load this league'),
        h('p', {}, state.error),
        seasonPicker(),
        h('button', { class: 'btn', onclick: () => start() }, 'Try again'));
    }
    if (state.phase === 'no-weeks') {
      return h('div', { class: 'message' },
        h('h2', {}, 'No finished weeks yet'),
        h('p', {}, 'Trade Hindsight replays weeks ESPN has already scored. Come back after week 1 is final, or pick an earlier season.'),
        seasonPicker());
    }
    if (state.phase !== 'ready') return h('div', { class: 'message' });
    return h('div', { class: 'layout' }, builder(), results());
  }

  function seasonPicker() {
    const input = h('input', { type: 'number', min: '2019', max: '2100', value: String(state.ctx ? state.ctx.season : ''), 'aria-label': 'Season' });
    return h('div', { class: 'season-row' },
      h('label', {}, 'Season ', input),
      h('button', { class: 'btn ghost', onclick: () => { state.ctx.season = Number(input.value); loadSeason(state.ctx.season); } }, 'Load season'));
  }

  // ---------------------------------------------------------------------------
  // trade builder (left rail)
  // ---------------------------------------------------------------------------
  function rosterAt(teamId, sp) {
    const wk = state.league.weeks[sp];
    const entries = (wk && wk.teams[teamId] && wk.teams[teamId].entries) || [];
    return [...entries].sort((a, b) => SLOT_ORDER.indexOf(a.slotId) - SLOT_ORDER.indexOf(b.slotId));
  }

  function seasonAverage(pid) {
    const p = state.league.players[pid];
    if (!p) return null;
    const vals = Engine.completedWeeks(state.league)
      .map((sp) => p.weekly[sp] && p.weekly[sp].pts)
      .filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  function playerPicker(teamId, selectedIds, legend) {
    const list = rosterAt(teamId, state.effectiveWeek);
    const isOn = (pid) => selectedIds.includes(pid);
    return h('fieldset', { class: 'picker' },
      h('legend', {}, legend),
      list.length ? list.map((e) => {
        const p = state.league.players[e.playerId] || {};
        const avg = seasonAverage(e.playerId);
        const slot = Engine.slotLabel(e.slotId);
        return h('label', { class: `pick ${isOn(e.playerId) ? 'on' : ''}` },
          h('input', {
            type: 'checkbox', checked: isOn(e.playerId),
            onchange: (ev) => {
              const i = selectedIds.indexOf(e.playerId);
              if (ev.target.checked && i < 0) selectedIds.push(e.playerId);
              if (!ev.target.checked && i >= 0) selectedIds.splice(i, 1);
              state.result = null;
              render();
            },
          }),
          h('span', { class: 'pname' }, p.name || `Player ${e.playerId}`),
          h('span', { class: 'pmeta' }, `${p.pos || ''}${slot === 'BE' ? ', bench' : slot === 'IR' ? ', IR' : ''}`),
          h('span', { class: 'pavg', title: 'Average real points per week this season' }, avg === null ? '' : avg.toFixed(1)));
      }) : h('p', { class: 'muted' }, 'No roster found for this week.'));
  }

  function unevenNotes() {
    return state.trades
      .filter((t) => t.partnerId && (t.send.length || t.receive.length) && t.send.length !== t.receive.length)
      .map((t) => {
        const short = t.send.length > t.receive.length ? 'You end up' : `${teamName(t.partnerId)} ends up`;
        const n = Math.abs(t.send.length - t.receive.length);
        return `Uneven trade (${t.send.length} for ${t.receive.length}). ${short} with ${n} fewer player${n > 1 ? 's' : ''}; any starting spot lost is filled by that team's best projected eligible player. Roster size limits aren't enforced.`;
      });
  }

  function builder() {
    const l = state.league;
    const completed = Engine.completedWeeks(l);
    const used = new Set(state.trades.map((t) => t.partnerId).filter(Boolean));

    const resetSelections = () => {
      state.trades.forEach((t) => { t.send = []; t.receive = []; });
      state.result = null;
      render();
    };

    return h('aside', { class: 'builder' },
      h('h2', {}, 'Build a trade'),
      h('label', { class: 'field' }, h('span', {}, 'Your team'),
        h('select', { onchange: (e) => { state.myTeamId = Number(e.target.value); state.trades = [{ partnerId: null, send: [], receive: [] }]; resetSelections(); } },
          l.teams.map((t) => h('option', { value: String(t.id), selected: t.id === state.myTeamId }, t.name)))),
      h('label', { class: 'field' }, h('span', {}, 'Trade happens before week'),
        h('select', { onchange: (e) => { state.effectiveWeek = Number(e.target.value); resetSelections(); } },
          completed.map((w) => h('option', { value: String(w), selected: w === state.effectiveWeek }, `Week ${w}`)))),
      state.trades.map((t, i) => h('section', { class: 'trade' },
        h('div', { class: 'trade-head' },
          h('h3', {}, state.trades.length > 1 ? `Trade ${i + 1}` : 'Trade'),
          state.trades.length > 1 ? h('button', { class: 'link', onclick: () => { state.trades.splice(i, 1); state.result = null; render(); } }, 'Remove') : null),
        h('label', { class: 'field' }, h('span', {}, 'Trade with'),
          h('select', { onchange: (e) => { t.partnerId = Number(e.target.value) || null; t.receive = []; state.result = null; render(); } },
            h('option', { value: '' }, 'Pick a team'),
            l.teams.filter((x) => x.id !== state.myTeamId && (!used.has(x.id) || x.id === t.partnerId))
              .map((x) => h('option', { value: String(x.id), selected: x.id === t.partnerId }, x.name)))),
        playerPicker(state.myTeamId, t.send, 'You send'),
        t.partnerId ? playerPicker(t.partnerId, t.receive, 'You get') : null)),
      state.trades.length < l.teams.length - 1
        ? h('button', { class: 'btn ghost wide', onclick: () => { state.trades.push({ partnerId: null, send: [], receive: [] }); render(); } }, 'Add a trade with another team')
        : null,
      unevenNotes().length ? h('div', { class: 'note' }, unevenNotes().map((n) => h('p', {}, n))) : null,
      state.runErrors.length ? h('div', { class: 'errors', role: 'alert' }, state.runErrors.map((e) => h('p', {}, e))) : null,
      h('button', { class: 'btn wide', disabled: state.running, onclick: run }, state.running ? 'Replaying…' : 'Replay the season'),
      h('div', { class: 'rail-foot' },
        h('button', { class: 'link', onclick: () => start({ refresh: true }) }, 'Reload data from ESPN'),
        seasonPicker()));
  }

  // ---------------------------------------------------------------------------
  // results (right side)
  // ---------------------------------------------------------------------------
  function results() {
    const r = state.result;
    if (!r) {
      return h('main', { class: 'results empty' },
        h('div', { class: 'empty-copy' },
          h('h2', {}, 'What if you had made that trade?'),
          h('p', {}, 'Pick a team, tick the players on each side and replay the season. Every finished week is re-scored with the real points your new players scored, and lineups are set from ESPN’s projections for that week, so there’s no picking starters with hindsight.'),
          h('p', { class: 'muted' }, 'If a player in your trade was really traded later, that real trade is erased and its players stay where they were.')));
    }
    return h('main', { class: 'results' },
      headline(r),
      standingsTable(r),
      teamDetail(r),
      erasedTrades(r),
      checks(r));
  }

  function headline(r) {
    const me = state.myTeamId;
    const real = r.standings.real[me], sim = r.standings.sim[me];
    const last = r.weeks[r.weeks.length - 1];
    const sentence = [];
    if (rec(sim) !== rec(real)) sentence.push(`Through week ${last}, you’d be ${rec(sim)} instead of ${rec(real)}`);
    else sentence.push(`Through week ${last}, your record stays ${rec(sim)}`);
    if (sim.rank !== real.rank) sentence.push(`, seeded ${ordinal(sim.rank)} instead of ${ordinal(real.rank)}`);
    else sentence.push(`, still seeded ${ordinal(sim.rank)}`);
    sentence.push('.');
    const net = Engine.round2(sim.pf - real.pf);
    if (net !== 0) sentence.push(` The trade ${net > 0 ? 'adds' : 'costs'} ${Math.abs(net).toFixed(1)} points over the weeks it was in effect.`);
    if (sim.inPlayoffs && !real.inPlayoffs) sentence.push(' That moves you into a playoff spot.');
    if (!sim.inPlayoffs && real.inPlayoffs) sentence.push(' That drops you out of a playoff spot.');

    const pfDelta = Engine.round2(sim.pf - real.pf);
    const recordChanged = rec(sim) !== rec(real);
    const stat = (label, realV, simV, changed, note) =>
      h('div', { class: 'stat' },
        h('div', { class: 'stat-label' }, label),
        h('div', { class: 'stat-val' }, h('span', { class: 'was' }, realV), h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'), h('span', { class: changed ? 'now hl' : 'now' }, simV)),
        note ? h('div', { class: 'stat-note' }, note) : null);

    return h('section', { class: 'headline' },
      recordChanged
        ? h('div', { class: 'flip', 'aria-label': `Record ${rec(real)} becomes ${rec(sim)}` },
          h('span', { class: 'flip-real' }, rec(real)),
          h('span', { class: 'flip-arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'flip-sim hl' }, rec(sim)))
        : h('div', { class: 'flip', 'aria-label': `Record unchanged at ${rec(sim)}` },
          h('span', { class: 'flip-sim' }, rec(sim)),
          h('span', { class: 'flip-same' }, 'Same record as real life')),
      h('p', { class: 'lede' }, sentence.join('')),
      h('div', { class: 'stats' },
        stat('Points for', pts1(real.pf), pts1(sim.pf), pfDelta !== 0, pfDelta !== 0 ? `${signed(pfDelta, 1)} from the trade` : 'No change'),
        stat('Points against', pts1(real.pa), pts1(sim.pa), Math.abs(sim.pa - real.pa) > 0.004),
        stat('Seed', ordinal(real.rank), ordinal(sim.rank), sim.rank !== real.rank),
        stat('All-play record', `${real.apW}–${real.apL}`, `${sim.apW}–${sim.apL}`, sim.apW !== real.apW, 'Record if you played every team every week'),
        stat('Weekly high scores', String(real.highs), String(sim.highs), sim.highs !== real.highs)));
  }

  function standingsTable(r) {
    const { real, sim } = r.standings;
    const partners = new Set(state.trades.map((t) => t.partnerId));
    const order = Object.keys(sim).map(Number).sort((a, b) => sim[a].rank - sim[b].rank);
    const cell = (a, b, changed) => h('td', { class: 'num' },
      changed ? h('span', {}, h('span', { class: 'was' }, a), ' ', h('span', { class: 'hl' }, b)) : b);
    return h('section', { class: 'block' },
      h('h2', {}, 'League standings after the replay'),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'grid' },
          h('thead', {}, h('tr', {},
            h('th', { class: 'num' }, 'Seed'), h('th', {}, 'Team'), h('th', { class: 'num' }, 'Record'),
            h('th', { class: 'num' }, 'Points for'), h('th', { class: 'num' }, 'Points against'),
            h('th', { class: 'num' }, 'All-play'), h('th', {}, 'Playoffs'))),
          h('tbody', {}, order.map((id) => {
            const a = real[id], b = sim[id];
            const move = a.rank - b.rank;
            const tag = id === state.myTeamId ? 'You' : partners.has(id) ? 'Trade partner' : r.touchedTeams.includes(id) ? 'Affected' : null;
            return h('tr', { class: id === state.myTeamId ? 'mine' : '' },
              h('td', { class: 'num' }, String(b.rank), move ? h('span', { class: move > 0 ? 'up' : 'down', title: `Was ${ordinal(a.rank)}` }, move > 0 ? ` ▲${move}` : ` ▼${-move}`) : null),
              h('td', {}, teamName(id), tag ? h('span', { class: 'tag' }, tag) : null),
              cell(rec(a), rec(b), rec(a) !== rec(b)),
              cell(pts1(a.pf), pts1(b.pf), Math.abs(a.pf - b.pf) > 0.004),
              cell(pts1(a.pa), pts1(b.pa), Math.abs(a.pa - b.pa) > 0.004),
              cell(`${a.apW}–${a.apL}`, `${b.apW}–${b.apL}`, a.apW !== b.apW),
              h('td', {}, b.inPlayoffs ? (a.inPlayoffs ? 'In' : h('span', { class: 'hl' }, 'In (was out)')) : (a.inPlayoffs ? h('span', { class: 'hl' }, 'Out (was in)') : 'Out')));
          })))),
      h('p', { class: 'muted small' }, `Seeds use win percentage, then points for. The top ${state.league.playoffTeamCount} make the playoffs.`));
  }

  function teamDetail(r) {
    const partners = state.trades.map((t) => t.partnerId);
    const tabs = [state.myTeamId, ...partners, ...r.touchedTeams].filter((id, i, arr) => id && arr.indexOf(id) === i);
    const tid = tabs.includes(state.detailTeamId) ? state.detailTeamId : state.myTeamId;
    const games = r.matchups.filter((m) => m.homeId === tid || m.awayId === tid).sort((a, b) => a.mp - b.mp);

    const rows = [];
    for (const m of games) {
      const home = m.homeId === tid;
      const opp = home ? m.awayId : m.homeId;
      const mine = (s) => (home ? s.home : s.away);
      const theirs = (s) => (home ? s.away : s.home);
      const res = (s) => (s.winner === 'TIE' ? 'T' : s.winner === 'BYE' ? '–' : (s.winner === 'HOME') === home ? 'W' : 'L');
      const sps = state.league.matchupPeriods[m.mp] || [m.mp];
      const weeks = r.teamWeeks.filter((w) => w.teamId === tid && sps.includes(w.sp));
      const oppWeeks = r.teamWeeks.filter((w) => w.teamId === opp && sps.includes(w.sp));
      const changed = weeks.some((w) => w.lineupChanged);
      const key = `${tid}:${m.mp}`;
      const isOpen = state.expanded.has(key);
      const resultChanged = res(m.real) !== res(m.sim);
      const before = sps.every((sp) => sp < r.effectiveWeek);
      rows.push(h('tr', { class: `${changed ? 'clickable' : ''} ${before ? 'before' : ''}`, onclick: changed ? () => { isOpen ? state.expanded.delete(key) : state.expanded.add(key); render(); } : null },
        h('td', { class: 'num' }, `Week ${m.mp}`),
        h('td', {}, opp === null || opp === undefined ? 'Bye' : teamName(opp), oppWeeks.some((w) => w.lineupChanged) ? h('span', { class: 'tag' }, 'Also changed') : null),
        h('td', { class: 'num' }, pts(mine(m.real))),
        h('td', { class: 'num' }, Math.abs(mine(m.sim) - mine(m.real)) > 0.004 ? h('span', { class: 'hl' }, pts(mine(m.sim))) : pts(mine(m.sim))),
        h('td', { class: 'num' }, opp === null ? '–' : Math.abs(theirs(m.sim) - theirs(m.real)) > 0.004 ? h('span', {}, h('span', { class: 'was' }, pts(theirs(m.real))), ' ', h('span', { class: 'hl' }, pts(theirs(m.sim)))) : pts(theirs(m.real))),
        h('td', { class: 'num' }, resultChanged ? h('span', {}, h('span', { class: 'was' }, res(m.real)), ' ', h('span', { class: 'hl' }, res(m.sim))) : res(m.sim)),
        h('td', { class: 'num' }, changed ? h('button', { class: 'link', 'aria-expanded': String(isOpen) }, isOpen ? 'Hide' : 'Lineup') : before ? 'Before trade' : 'No change')));
      if (isOpen) rows.push(h('tr', { class: 'detail' }, h('td', { colspan: '7' }, weeks.map(lineupChanges))));
    }

    return h('section', { class: 'block' },
      h('h2', {}, 'Week by week'),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map((id) =>
        h('button', { role: 'tab', 'aria-selected': String(id === tid), class: id === tid ? 'tab on' : 'tab', onclick: () => { state.detailTeamId = id; render(); } },
          id === state.myTeamId ? `${teamName(id)} (you)` : teamName(id)))),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'grid weeks' },
          h('thead', {}, h('tr', {},
            h('th', { class: 'num' }, 'Week'), h('th', {}, 'Opponent'), h('th', { class: 'num' }, 'Real score'), h('th', { class: 'num' }, 'Replay score'),
            h('th', { class: 'num' }, 'Opponent'), h('th', { class: 'num' }, 'Result'), h('th', { class: 'num' }, 'Lineup'))),
          h('tbody', {}, rows))),
      h('p', { class: 'muted small' }, 'Click a changed week to see who came in, who went out and why. Highlighted values differ from what really happened.'));
  }

  function lineupChanges(w) {
    const row = (d, dir) => h('tr', {},
      h('td', { class: dir === 'in' ? 'in' : 'out' }, dir === 'in' ? 'In' : 'Out'),
      h('td', {}, d.name), h('td', {}, d.slot),
      h('td', { class: 'num' }, pts1(d.proj)), h('td', { class: 'num' }, pts(d.pts)), h('td', {}, d.reason));
    return h('div', { class: 'changes' },
      h('p', { class: 'changes-title' }, `Week ${w.sp}: ${signed(w.delta)} points (${pts(w.realScore)} became ${pts(w.simScore)})`),
      h('table', { class: 'mini' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Player'), h('th', {}, 'Slot'), h('th', { class: 'num' }, 'Projected'), h('th', { class: 'num' }, 'Scored'), h('th', {}, 'Why'))),
        h('tbody', {}, w.in.map((d) => row(d, 'in')), w.out.map((d) => row(d, 'out')))),
      w.moved.length ? h('p', { class: 'muted small' }, `Slot moves: ${w.moved.map((m) => `${m.name} from ${m.from} to ${m.to}`).join('; ')}.`) : null,
      !w.lineupChanged ? h('p', { class: 'muted small' }, 'The roster changed but the projections kept the same starters.') : null,
      w.flags.length ? h('ul', { class: 'flags' }, w.flags.map((f) => h('li', {}, f))) : null);
  }

  function erasedTrades(r) {
    if (!r.erased.length) return null;
    return h('section', { class: 'block' },
      h('h2', {}, `Real trades erased (${r.erased.length})`),
      h('p', { class: 'muted' }, 'These trades happened in your league, but they involved a player from your hypothetical trade (or from an earlier erased trade), so the replay pretends they never happened.'),
      h('ul', { class: 'erased' }, r.erased.map((t) => {
        const byTeam = {};
        for (const m of t.moves) (byTeam[m.fromTeamId] = byTeam[m.fromTeamId] || []).push(m.name);
        const parts = Object.entries(byTeam).map(([from, names]) => `${teamName(from)} sent ${names.join(', ')}`);
        return h('li', {}, h('strong', {}, `Week ${t.week}: `), parts.join('; '), `. Erased because of ${t.causedByName}.`);
      })));
  }

  function checks(r) {
    const l = state.league;
    const c = r.checks;
    const items = [];
    if (!c.recordMismatches.length && !c.winnerMismatches.length) {
      items.push(`Replay check passed: with nothing changed, the recomputed records match ESPN for all ${l.teams.length} teams.`);
    } else {
      items.push(`Replay check: ${c.recordMismatches.length} team record(s) and ${c.winnerMismatches.length} matchup result(s) differ from ESPN before any trade is applied. Treat these results with caution.`);
    }
    if (c.seedMismatches.length) items.push(`ESPN's seeds use tiebreakers this tool does not copy; ${c.seedMismatches.length} team(s) are seeded differently even without the trade.`);
    if (c.scoreMismatches.length) items.push(`${c.scoreMismatches.length} team-week(s) where the starters' points don't add up to ESPN's score (often commissioner adjustments). The replay keeps ESPN's score and only adds or removes the changed players.`);
    if (c.fallbackWeeks) items.push(`${c.fallbackWeeks} team-week(s) had players with no ESPN projection; their earlier average was used instead.`);
    if (l.hasDivisions) items.push('Your league has divisions. Seeds here ignore division winners.');
    if (l.tradeSource === 'activity') items.push(`Real trades come from the league activity feed (${l.realTrades.length} found in finished weeks).`);
    for (const w of l.warnings) items.push(w);
    return h('section', { class: 'block notes' },
      h('h2', {}, 'Data checks and notes'),
      h('ul', {}, items.map((t) => h('li', {}, t))));
  }

  // ---------------------------------------------------------------------------
  // styles (scoped to the shadow root)
  // ---------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .scrim {
      --ink: #17202c; --ink-2: #3c4757; --muted: #6b7686; --line: #dfe3e9; --paper: #f6f7f9; --card: #ffffff;
      --mark: #ffe066; --mark-ink: #3a2f00; --up: #1d7f47; --down: #b8322a; --focus: #2f6fde;
      position: fixed; inset: 0; z-index: 2147483646; background: rgba(15, 22, 32, 0.55);
      display: flex; align-items: stretch; justify-content: center; padding: 2vh 2vw;
      font: 14px/1.45 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink);
    }
    .panel { background: var(--paper); width: min(1240px, 100%); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    .bar { background: var(--ink); color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 10px 18px; gap: 16px; }
    .brand { display: flex; align-items: baseline; gap: 14px; min-width: 0; }
    .wordmark { font-family: "Bahnschrift", "DIN Condensed", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif; font-stretch: condensed; font-weight: 700; font-size: 22px; letter-spacing: .01em; white-space: nowrap; }
    .league { color: #b9c3d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar-right { display: flex; align-items: center; gap: 12px; }
    .readonly { font-size: 12px; color: #d8dee7; border: 1px solid #4a5667; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
    .icon-btn { background: none; border: 0; color: #fff; font-size: 26px; line-height: 1; cursor: pointer; padding: 0 4px; }
    .layout { display: grid; grid-template-columns: 340px minmax(0, 1fr); flex: 1; min-height: 0; }
    .builder { background: var(--card); border-right: 1px solid var(--line); padding: 18px; overflow: auto; }
    .results { padding: 22px 26px 40px; overflow: auto; min-width: 0; }
    h2 { font-size: 17px; margin: 0 0 12px; }
    h3 { font-size: 15px; margin: 0; }
    p { margin: 0 0 10px; }
    .muted { color: var(--muted); }
    .small { font-size: 12.5px; }
    .field { display: grid; gap: 4px; margin-bottom: 12px; font-weight: 600; font-size: 13px; }
    select, input[type=number] { font: inherit; font-weight: 400; padding: 7px 9px; border: 1px solid #c5ccd6; border-radius: 6px; background: #fff; color: var(--ink); width: 100%; }
    .trade { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 4px; margin-bottom: 8px; }
    .trade-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .picker { border: 0; padding: 0; margin: 0 0 12px; }
    .picker legend { font-weight: 600; font-size: 13px; margin-bottom: 4px; padding: 0; }
    .pick { display: grid; grid-template-columns: 18px 1fr auto 36px; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 5px; cursor: pointer; }
    .pick:hover { background: var(--paper); }
    .pick.on { background: #fff6c7; }
    .pname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pmeta { color: var(--muted); font-size: 12px; }
    .pavg { color: var(--ink-2); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    .btn { font: inherit; font-weight: 600; background: var(--ink); color: #fff; border: 0; border-radius: 6px; padding: 10px 14px; cursor: pointer; }
    .btn[disabled] { opacity: .6; cursor: progress; }
    .btn.ghost { background: transparent; color: var(--ink); border: 1px solid #c5ccd6; }
    .btn.wide { width: 100%; margin-top: 8px; }
    .link { font: inherit; background: none; border: 0; padding: 0; color: var(--focus); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    button:focus-visible, select:focus-visible, input:focus-visible, .pick:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
    .errors { background: #fdecea; border: 1px solid #f3b9b3; color: #7a1d16; border-radius: 6px; padding: 8px 10px; margin-top: 10px; }
    .errors p { margin: 0 0 4px; }
    .note { background: #fff8d6; border: 1px solid #f0dd8a; color: #4a3d00; border-radius: 6px; padding: 8px 10px; margin-top: 10px; font-size: 13px; }
    .note p { margin: 0 0 4px; }
    .rail-foot { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); display: grid; gap: 10px; font-size: 13px; }
    .season-row { display: flex; gap: 8px; align-items: center; }
    .season-row label { display: flex; gap: 6px; align-items: center; }
    .season-row input { width: 90px; }
    .message { padding: 60px 30px; max-width: 560px; margin: 0 auto; text-align: center; display: grid; gap: 12px; justify-items: center; }
    .spinner { width: 28px; height: 28px; border: 3px solid var(--line); border-top-color: var(--ink); border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    .progress { font-variant-numeric: tabular-nums; }
    .empty { display: flex; align-items: center; }
    .empty-copy { max-width: 520px; }
    .empty-copy h2 { font-family: "Bahnschrift", "DIN Condensed", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif; font-stretch: condensed; font-size: 34px; line-height: 1.1; margin-bottom: 14px; }
    .headline { margin-bottom: 26px; }
    .flip { font-family: "Bahnschrift", "DIN Condensed", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif; font-stretch: condensed; font-weight: 700; font-size: 64px; line-height: 1; display: flex; align-items: center; gap: 18px; font-variant-numeric: tabular-nums; margin-bottom: 10px; }
    .flip-real { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: rgba(107,118,134,.6); }
    .flip-arrow { font-size: 34px; color: var(--muted); }
    .flip-sim { padding: 0 8px; }
    .flip-same { font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif; font-size: 15px; font-weight: 400; color: var(--muted); }
    .hl { background: linear-gradient(transparent 12%, var(--mark) 12%, var(--mark) 88%, transparent 88%); color: var(--mark-ink); padding: 0 3px; border-radius: 2px; }
    .lede { font-size: 16px; max-width: 70ch; margin-bottom: 16px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line); }
    .stat { padding: 10px 12px 12px; border-left: 1px solid var(--line); }
    .stat-label { font-size: 12.5px; color: var(--muted); }
    .stat-val { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .stat-note { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .was { color: var(--muted); font-weight: 400; }
    .arrow { color: var(--muted); font-size: 13px; }
    .block { margin-top: 28px; }
    .table-wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
    table { border-collapse: collapse; width: 100%; }
    .grid th, .grid td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
    .grid thead th { font-size: 12.5px; color: var(--muted); font-weight: 600; background: #fbfbfc; }
    .grid tbody tr:last-child td { border-bottom: 0; }
    .num { text-align: right !important; font-variant-numeric: tabular-nums; }
    tr.mine td { font-weight: 600; background: #fffbe6; }
    tr.before td { color: var(--muted); }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: #f3f6fa; }
    tr.detail td { background: #fbfbfc; white-space: normal; }
    .tag { margin-left: 8px; font-size: 11.5px; font-weight: 600; color: var(--ink-2); background: #e9edf2; border-radius: 999px; padding: 1px 8px; }
    .up { color: var(--up); font-size: 12px; }
    .down { color: var(--down); font-size: 12px; }
    .tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
    .tab { font: inherit; font-size: 13px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
    .tab.on { background: var(--ink); color: #fff; border-color: var(--ink); }
    .changes { padding: 6px 4px 10px; }
    .changes-title { font-weight: 600; margin-bottom: 6px; }
    .mini th, .mini td { padding: 4px 8px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--line); white-space: normal; }
    .mini th { color: var(--muted); font-weight: 600; font-size: 12px; }
    td.in { color: var(--up); font-weight: 700; }
    td.out { color: var(--down); font-weight: 700; }
    .flags { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; }
    .erased { padding-left: 18px; margin: 0; }
    .erased li { margin-bottom: 6px; }
    .notes ul { padding-left: 18px; margin: 0; color: var(--ink-2); }
    .notes li { margin-bottom: 6px; }
    @media (max-width: 900px) {
      .scrim { padding: 0; }
      .panel { border-radius: 0; }
      .layout { grid-template-columns: minmax(0, 1fr); overflow: auto; }
      .league { display: none; }
      .builder { border-right: 0; border-bottom: 1px solid var(--line); overflow: visible; }
      .results { overflow: visible; padding: 18px 16px 32px; }
      .flip { font-size: 48px; }
      .readonly { display: none; }
    }
  `;

  window.THUI = { open, close, toggle };
})();

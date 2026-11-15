# Changelog

## 0.3.0 (2026-11-14): Undo a real trade

- **New mode: Undo a real trade.** A switch at the top of the panel picks between **Add a trade** (the old builder) and **Undo a real trade**. Pick a trade that really happened and the season replays as if it never went through, shown next to what really happened.
- **It starts from the trade's week.** A trade counts from the first week its players were on their new teams: one made during week 4 is undone from week 4, one made between weeks 5 and 6 from week 6. Earlier weeks stay exactly as they were.
- **Your trades first.** The list shows each trade's week, date, the other team, and who went each way (with headshots). Trades between other teams are listed under them, so you can see what someone else's trade did to your season.
- **Follow-on trades are erased too.** If a player in the undone trade was traded again later, that later trade can't have happened either; the card says how many, and the results list them.
- The results open with a "Replaying the season without" summary of the trade, and the lineup notes say why each player is in or out ("Stays: the trade is undone").

## 0.2.1 (2026-11-04): New logo

- **New logo:** a football in flight over a striped field, with yellow speed lines.
- **It moves.** On the launcher button, the panel header and the loading screen, the field scrolls under the ball, the ball bobs and spins and the speed lines flicker. It holds still if your system is set to reduce motion.
- New toolbar icons at every size. Chrome toolbar icons can't animate, so they show the still version.
- The loading screen shows the moving logo instead of the old spinner.

## 0.2.0 (2026-11-03): UI update

- **Live replay.** The season replays every time a player is ticked or unticked, or the partner or week changes. The "Replay the season" button is gone.
- **Real season first.** Before a trade is built, the panel shows the league's real standings and your real record.
- **Live summary bar.** A bar pinned to the bottom of the trade builder shows your record, seed and points change while you scroll through rosters.
- **No more jumping to the top.** Ticking a player keeps the trade builder and results where they were, and keeps keyboard focus on the checkbox.
- **Headshots and logos.** Players show ESPN headshots (NFL logo for D/ST), position and NFL team. Fantasy teams show their league logo in the standings, week-by-week tabs, opponent column and trade builder. Initials replace any picture that won't load.
- **Player rows on two lines**, so long names aren't cut off.
- The build version is shown at the bottom of the trade builder.
- The Trade Hindsight button moved to the bottom left, clear of ESPN's Fantasy Chat bar.
- Data checks note when a league breaks tied matchups, which the replay doesn't copy yet.

## 0.1.0

- First build: trade builder, season replay, erased real trades, lineup rules, standings, week-by-week detail, data checks, read-only guard.

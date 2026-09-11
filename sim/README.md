# sim — the headless player

A player that isn't a person. It builds a complex, registers it, bids on
events, hosts them, reinvests and expands — through the same `Game` methods the
UI calls, never by reaching into state. Anything it trips over is something a
real player could trip over too.

```bash
npm run sim                          # 5 seeds x 360 days, with charts
node sim/longrun.mjs --days 720 --seeds 3 --verbose
npm run sim:land                     # what each plot size is actually worth
```

## Files

| file | what it is |
| --- | --- |
| `player.mjs` | the hands: prices and commits plans, lays prefabs, grows the bowl ring by ring, finds free ground |
| `strategy.mjs` | the head: what to bid, what to build next, when to buy land, whom to hire |
| `longrun.mjs` | the run loop, the day-by-day trace, and `diagnose()` — which reads a run and says what is wrong with it |
| `landcurve.mjs` | gives the player each plot size with money no object, to find what the land can hold |

## Reading a run

`diagnose()` separates **problems** (the game is broken: insolvency, no events
hosted, runaway wealth) from **notes** (worth a look: a stalled reputation, a
lopsided win rate, builds skipped for want of room). `tests/balance.test.js`
asserts on the problems and on a few loose bounds — that a year of competent
play stays solvent and reaches regional tier — rather than on exact figures,
which would break on every balance tweak and teach us nothing.

## Its limits

It is not a good player. It builds to a formula: one pitch, rings of seating
around it, facilities in whatever gap is nearest, one sport. That is enough to
prove the economy works and to surface the kind of bug where a cost scales off
the wrong quantity. It is not enough to tell you what a skilled player could
reach, and conclusions from it should be read that way.

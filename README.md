# Sports Complex Tycoon 3D

A mobile-first 3D sports complex construction and management game. You build a
venue **block by block**, the game works out what you actually built, and then
you run it as a business: bid against rival operators for events, host them,
and reinvest.

The whole point is that the two halves are wired together. Nothing here is a
"Build Stadium" button — capacity, ratings and event eligibility are all read
back out of the voxels you placed.

```
BUILD → ZONE → the game recognises a venue → BID → HOST → EARN → EXPAND
```

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm run preview    # serve the built bundle
npm test           # 92 headless simulation tests
npm run test:balance  # plays 360 in-game days headlessly and checks the economy
npm run sim        # the same playthrough, with charts (--days 720 --seeds 5)
npm run sim:land   # what each plot size is actually worth
npm run e2e        # Playwright: drives the real UI (needs `npm run preview` running)
```

The build is a plain static site. It installs as a PWA and works offline once
loaded.

## The loop, concretely

1. **Build.** Press **1ST** and you are standing on your plot with a crosshair,
   a block in your hand and a nine-slot hotbar. Look at a face, tap to place
   against it, hold to sweep out a run, right-click to break, middle-click to
   eyedropper whatever you are looking at. Number keys and the scroll wheel
   change slots; long-press a slot to swap what lives there. Reach is an arm's
   length, so you build where you stand.

   From the overview camera the same hotbar drives bulk tools: single-block,
   line, wall, floor, rectangle, room, flood-fill, replace, copy and paste.
   Undo/redo throughout. Planning mode lets you design an entire stand and see
   the price before committing a penny.

   Three **procedural structures** handle the parts that are pure repetition:
   *Stand* works out which way the pitch is and lays a raked seating tier with
   its own supports and vomitories; *Garage* builds a multi-level car park with
   decks, columns and a ramp bay; *Retain* builds a retaining wall that matches
   the ground behind it. A separate **TERRAIN** mode raises, lowers, flattens
   and ramps the ground while preserving each column's surface material.

   The **prefab library** goes further: fourteen finished facilities — soccer
   pitch, Australian Rules oval, cricket ground, basketball court, tennis
   court, small and main grandstands, gym, performance centre, locker rooms,
   stadium entrance, food court, car park and fan plaza — each laid out
   correctly, fitted with its own equipment, and rotatable in 90° steps before
   you commit. They stamp through the same pricing, staging and undo path as
   anything you build by hand, so a prefab is a starting point you can then
   take apart, not a black box.

   Anything substantial becomes a **construction project** that rises out of
   the ground over several days, lowest blocks first. You cannot throw up a
   12,000-seat tier the day before an event you have already won — though you
   can pay overtime to rush it.
2. **Fit it out.** A pitch is not a pitch without goals. **Sports equipment**
   lives beside the blocks in the same hotbar and the same palette: soccer,
   rugby and Australian Rules goal posts (with behind posts), basketball hoops
   and backboards, tennis and volleyball nets, cricket stumps and sight
   screens, pool starting blocks and lane ropes, track lane markings and
   hurdles, dugouts, coaches boxes, corner flags, scoreboards and a broadcast
   big screen.

   Equipment is the one thing in the game that has a **facing**. A voxel is one
   flat colour, so rotating a block would be invisible; a goal has a front and a
   back, so rotation lives on equipment and prefabs, in 90° steps, with the
   preview turning under the crosshair before you place. Each piece snaps to
   the grid, claims its whole footprint, refuses to float, and comes down with
   the ground it stands on — undo puts both back.

   The analyser counts what each venue has and tells you what it is missing
   ("2 more goal posts, 4 more corner flags"). A fully fitted venue is worth up
   to six points of functionality; an unfitted one is never penalised, so a
   complex built before the fittings existed keeps every rating it had.
3. **Zone.** The hotbar holds zones too, so painting what an area is *for* is
   the same motion as building it — walk along a stand holding "seating" and
   paint it in. Areas can be: pitch, seating, concourse, entrance,
   emergency exit, locker room, medical, media, broadcast, restrooms,
   concessions, retail, hospitality, security, parking, roads. Placing an
   unambiguous surface (turf, hardwood, ice, asphalt…) auto-zones it; you can
   always repaint by hand, and a hand-painted zone is never clobbered.
4. **Recognition.** The analyser scans the world, finds connected components
   per zone, fits the largest rectangle inside each sport surface to check it
   against regulation dimensions (oval sports are measured by their length and
   width instead, since a circle contains no regulation square), counts seating
   volumetrically, measures roof coverage, checks roof spans against their
   supports, counts the equipment inside each venue's reach, and assigns nearby
   facilities to the nearest venue. It then produces a type, a capacity, seven
   ratings and a list of *specific* things to fix.
5. **Bid.** Event requirements are checked line by line against that real
   venue. Bidding is a set of decisions — offer amount, venue packages,
   contract terms, ticket pricing — scored against rival venues. You will lose
   bids.

   Once a bid for a serious event is credible the organiser stops filling in
   forms and starts **negotiating**: extra days, exclusive hospitality, a
   ticket allocation, a relaid pitch, accredited screening on every gate. Each
   answer moves their goodwill and changes the deal itself. Promising
   something your venue cannot back up is discounted, and risks an
   embarrassment on the day.
6. **Host.** Fans walk from the gates to their seats in the 3D world, cars fill
   the parking, then you get a full revenue/cost breakdown, a satisfaction
   score and reputation movement.
7. **Expand.** Bigger events need more seats *and* more provision. Doubling
   capacity without adding restrooms, exits and parking will break requirements
   that used to pass. Five **utility networks** — power, water, wastewater,
   data and climate — read their demand from what you built and degrade what
   they serve when they fall behind.

   Eventually you buy land in **another city** entirely. Each has its own land
   prices, audience size, weather and climate, and venues on every site
   compete for the same event board.

## Scale

**1 block = 2 metres.** A regulation football pitch is 53 × 34 blocks, which is
one drag of the Floor tool. This keeps hand-building a stadium practical while
still giving enough resolution for stands, concourses and rooms.

## Architecture

```
src/
  core/        game hub, state, seeded RNG, economy, community, construction,
               audio, constants
  data/        blocks, zones, sports equipment, events, negotiations, sponsors,
               staff, research, utilities, cities, achievements, endgame goals,
               random events, rivals   (all pure data)
  voxel/       chunked world, greedy mesher, renderer, DDA raycast,
               reversible edit batches, build tools, procedural structures,
               prop layer, prefab library, build controller
  venues/      world scan, connected components, largest-rectangle fitting,
               rating model, venue classification
  events/      generator, requirement checking, bidding, negotiation,
               event simulation
  world/       day/night sky, event-day crowd, equipment rendering,
               held-item viewmodel, construction particles
  input/       camera rig (4 modes), unified touch + mouse + keyboard
  ui/          HUD shell, build dock, screens, events UI, tutorial
  save/        RLE serialisation, IndexedDB + localStorage manager
tests/         node:test simulation tests
e2e/           Playwright scripts that drive the real UI
```

Game content is data, not code: adding a sport, a block, an event or a sponsor
is a new row in `src/data/`.

### Performance notes

- **Greedy meshing.** A flat 16×16 slab meshes to ≤ 6 quads, not 512. A built
  stadium renders in under 30 draw calls.
- **Custom shader, not textures.** Flat architectural colour, a
  hemisphere + sun lighting model, and a fine panel seam drawn once per metre
  (faded out by `fwidth` at distance). It reads as a building rather than a
  stack of cubes, and there is not a single texture to download.
- **Instanced crowds.** Up to 1,600 spectators and 420 cars in two draw calls,
  positions lerped along an arrival path.
- **Instanced equipment.** Every piece of a given type — all the corner flags,
  all the goal posts — draws in one call, sharing the chunk shader so it is lit,
  fogged and seamed like the stadium around it. Geometry for each type is baked
  once from its box kit and cached.
- **Construction particles are two draw calls total**, from a fixed pool, and
  switch off entirely under the reduced-motion setting.
- **Chunk remeshing is budgeted** per frame so a 20,000-block fill never stalls.
- **Saves are RLE-compressed.** A complete stadium is about 28KB.

## Controls

|                    | Touch                                    | Desktop                            |
| ------------------ | ---------------------------------------- | ---------------------------------- |
| Look / orbit       | one-finger drag                          | left-drag (mouse look when locked) |
| Pan                | two-finger drag                          | right-drag                         |
| Zoom               | pinch                                    | scroll wheel (overview only)       |
| Place              | tap, or hold ■ to sweep                  | left click, hold to sweep          |
| Remove             | Break mode, or hold ✕                    | right click, hold to sweep         |
| Pick block         | ⌘ button                                 | middle click, or Z                 |
| Hotbar slot        | tap a slot; long-press to change it      | 1–9, or the scroll wheel           |
| Rotate 90°         | ↻ button (appears when it applies)       | R, or Q/E                          |
| Move (1st/3rd)     | on-screen stick, ↑ to jump               | WASD, Shift to run, Space to jump  |
| Undo / redo        | rail buttons                             | Ctrl+Z / Ctrl+Shift+Z              |
| Camera             | FREE / 1ST / 3RD / MAP rail              | C to cycle, B for first person, F to fly |
| Release the cursor | —                                        | Escape                             |

## Accessibility

Reduced motion, high contrast, large text, adjustable look sensitivity,
invert-Y, left-handed control layout, full keyboard operation, ARIA roles and
labels on every control, and a minimum 44px touch target throughout. The game
is fully playable with sound off.

## Content

Every team, league, organiser, sponsor, athlete and event is fictional. There
are no third-party trademarks, logos or likenesses anywhere in the project, and
all art is generated at runtime from the block data — there are no image assets
to license.

## Systems at a glance

| System | What it reads | What happens when it is wrong |
| --- | --- | --- |
| Event board | which sports you have registered venues for | organisers stop offering you events you could never host |
| Venue analysis | zones, block geometry, roof coverage, supports | events you cannot bid for, with a named reason |
| Equipment | which fittings sit inside each venue's reach | a named shortfall, and up to six points of functionality left on the table |
| Utility networks | pitch area, fixtures, broadcast feeds, enclosed volume | degraded ratings and specific failures on event day |
| Transport | road types, parking, garages, transit, bus and taxi bays | queues, turned-away fans, angry neighbours |
| Community | jobs, visitors, facilities, traffic, noise, branding | standing drifts toward what you have earned |
| Rivals | their reinvestment vs yours | they outbid you and say so |
| Weather | the city's own climate table | worn pitches, slowed building sites, thinner crowds |

## Deliberate design calls

- **Reputation replaces XP.** Rather than a separate experience bar, venue
  reputation is the single progression axis: it gates which event tiers appear,
  which research projects unlock, which sponsors will talk to you, and it moves
  based on how well you actually deliver events. One number the player can
  reason about beats two.
- **First person is the tactile way to build; the overview is the efficient
  one.** Both use the same hotbar and the same modes. Walking around you get
  reach, a crosshair and a block in hand; from above you get tools that lay a
  thousand blocks at once. Neither is a lesser mode.
- **Zones can be painted on open ground.** A "locker room" does not have to be
  an enclosed box. Enclosure would be more realistic but adds friction without
  adding a decision; provision is measured by area against capacity instead.
- **Every site builds on its own.** A project ordered in one city keeps rising
  while you are standing in another, into that city's world rather than the one
  in front of you.
- **No structural collapse.** Roofs that outrun their supports are flagged and
  can cause an inspector incident on event day, but nothing ever falls down.
  The goal is creativity, not punishment.
- **Rotation belongs to equipment, not blocks.** Turning a flat-coloured cube
  would change nothing on screen, so the rotate control only appears when
  something in your hand actually has a front: a goal, a dugout, a scoreboard,
  a prefab, a copied structure.
- **Equipment is a bonus, never a tax.** Fitting a venue out raises its
  functionality; leaving it bare produces a note in the venue report and
  nothing worse. Adding the system could not retroactively downgrade a complex
  that was already finished.
- **Australian Rules is a real sport here, not a prop.** Adding AFL goal posts
  and an oval prefab meant adding the zone, the venue type and three event
  templates to bid for, because a fitting with nothing to host would be a dead
  end.
- **Ovals are measured as ovals.** Cricket and Australian Rules grounds are
  sized by their length and width rather than by the largest rectangle you
  could inscribe in them — a circle can never contain a regulation square. A
  rectangular ground measures identically either way, so no existing venue
  changed.

## Balance, measured

`sim/` is a headless player. It builds a complex, registers it, bids, hosts,
reinvests and expands using the same `Game` methods the UI calls, for hundreds
of in-game days. It exists because "the economy feels about right" is not a
claim anyone should ship.

Running it found five things that were wrong, all of which are now fixed:

| What it found | Why it mattered |
| --- | --- |
| The event board ignored what you had built | A football-only complex spent whole months looking at tennis and basketball it could never bid on. Organisers now approach venues that could plausibly host them; a quarter of the board still shows other sports, as the argument for building a second one. |
| Event setup cost scaled with the venue's *capacity* | Every stand you built made small events less affordable, so growing punished you. It now scales with the crowd that actually turns up. |
| A flat $20,000 marketing charge on every event | More than the entire gate of a community fixture. Marketing is now the organiser's ambition, which is what the tier measures. |
| Incident costs were flat sums | The same $120,000 roof closure was a rounding error at an international final and fatal at a community ground. Costs now scale with the tier and are capped at a share of what the event was worth. |
| Upkeep was charged on the plot's own grass | 15% of an early complex's entire bill was for the lawn it was given. Natural ground is now free to keep. |

It also caught three prefabs — the stadium entrance, the food court and the
performance centre — shipping with roofs that the game's own structural
inspector flagged, which caused event-day incidents. They have columns now, and
a test holds every prefab to the game's own rule.

What a competently played year looks like now:

```
day  11  first local event hosted
day  44  regional tier
day 191  national tier
day 360  ~20,000 capacity, rating 78, reputation 100, $8M in hand, never insolvent
day 720  $36M in hand, 53 events hosted
```

`tests/balance.test.js` asserts the shape of that rather than the figures —
solvent, events to bid on, regional tier inside a year — because tight
assertions here would break on every balance tweak and teach us nothing. It
takes 27 seconds, so it is `npm run test:balance` rather than part of the fast
suite; `npm run test:all` runs both.

## What is deliberately not here yet

- **The top two tiers are reachable but not demonstrated.** A dense bowl gets
  to 68,000 seats on the starting plot and 173,000 on a large one, so capacity
  is not the constraint, and by day 720 the simulated player is sitting on
  $36M. But that player builds in rings around one pitch and plateaus around
  20,000 seats, so the run to an international or world final has not been
  played end to end.
- **Ice, aquatic, cricket, Australian Rules, combat, baseball and esports
  venues** have zones, blocks, equipment, venue types and event templates, but
  far less balancing than football and basketball.
- **Prefab prices are derived, not tuned.** A prefab costs exactly what its
  blocks and fittings cost, with no discount for convenience and no premium for
  it. Whether that is the right economic call is unproven.
- **The simulated player is not a good player.** It builds to a formula: one
  pitch, rings of seating around it, facilities in the nearest gap, one sport.
  That is enough to prove the economy works and to surface a cost scaling off
  the wrong quantity. It says nothing about what a skilled player could reach.
- **Real-device performance is unmeasured.** Everything here was profiled under
  software rendering, which tells you nothing about a phone.

Nothing in that list is exposed in the UI as a dead button.

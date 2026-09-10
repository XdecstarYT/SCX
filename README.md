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
npm test           # 72 headless simulation tests
npm run e2e        # Playwright: drives the real UI (needs `npm run preview` running)
```

The build is a plain static site. It installs as a PWA and works offline once
loaded.

## The loop, concretely

1. **Build.** Place blocks from a palette of ~70 materials with single-block,
   line, wall, floor, rectangle, room, flood-fill, replace, copy and paste
   tools. Undo/redo throughout. Planning mode lets you design an entire stand
   and see the price before committing a penny.

   Three **procedural structures** handle the parts that are pure repetition:
   *Stand* works out which way the pitch is and lays a raked seating tier with
   its own supports and vomitories; *Garage* builds a multi-level car park with
   decks, columns and a ramp bay; *Retain* builds a retaining wall that matches
   the ground behind it. A separate **TERRAIN** mode raises, lowers, flattens
   and ramps the ground while preserving each column's surface material.

   Anything substantial becomes a **construction project** that rises out of
   the ground over several days, lowest blocks first. You cannot throw up a
   12,000-seat tier the day before an event you have already won — though you
   can pay overtime to rush it.
2. **Zone.** Paint what areas are *for*: pitch, seating, concourse, entrance,
   emergency exit, locker room, medical, media, broadcast, restrooms,
   concessions, retail, hospitality, security, parking, roads. Placing an
   unambiguous surface (turf, hardwood, ice, asphalt…) auto-zones it; you can
   always repaint by hand, and a hand-painted zone is never clobbered.
3. **Recognition.** The analyser scans the world, finds connected components
   per zone, fits the largest rectangle inside each sport surface to check it
   against regulation dimensions, counts seating volumetrically, measures roof
   coverage, checks roof spans against their supports, and assigns nearby
   facilities to the nearest venue. It then produces a type, a capacity, seven
   ratings and a list of *specific* things to fix.
4. **Bid.** Event requirements are checked line by line against that real
   venue. Bidding is a set of decisions — offer amount, venue packages,
   contract terms, ticket pricing — scored against rival venues. You will lose
   bids.

   Once a bid for a serious event is credible the organiser stops filling in
   forms and starts **negotiating**: extra days, exclusive hospitality, a
   ticket allocation, a relaid pitch, accredited screening on every gate. Each
   answer moves their goodwill and changes the deal itself. Promising
   something your venue cannot back up is discounted, and risks an
   embarrassment on the day.
5. **Host.** Fans walk from the gates to their seats in the 3D world, cars fill
   the parking, then you get a full revenue/cost breakdown, a satisfaction
   score and reputation movement.
6. **Expand.** Bigger events need more seats *and* more provision. Doubling
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
  data/        blocks, zones, events, negotiations, sponsors, staff, research,
               utilities, cities, achievements, endgame goals, random events,
               rivals   (all pure data)
  voxel/       chunked world, greedy mesher, renderer, DDA raycast,
               reversible edit batches, build tools, procedural structures,
               build controller
  venues/      world scan, connected components, largest-rectangle fitting,
               rating model, venue classification
  events/      generator, requirement checking, bidding, negotiation,
               event simulation
  world/       day/night sky, event-day crowd
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
- **Chunk remeshing is budgeted** per frame so a 20,000-block fill never stalls.
- **Saves are RLE-compressed.** A complete stadium is about 28KB.

## Controls

|                | Touch                                   | Desktop                          |
| -------------- | --------------------------------------- | -------------------------------- |
| Look / orbit   | one-finger drag                         | left-drag (mouse look when locked) |
| Pan            | two-finger drag                         | right-drag                       |
| Zoom           | pinch                                   | scroll wheel                     |
| Place          | tap, or the ■ button (aims at crosshair) | left click                       |
| Remove         | tap in Demolish mode, or the ✕ button   | right click                      |
| Move (1st/3rd) | on-screen stick                         | WASD, Shift to run, Space to jump |
| Materials      | hotbar                                  | 1–9                              |
| Undo / redo    | rail buttons                            | Ctrl+Z / Ctrl+Shift+Z            |
| Camera         | FREE / 1ST / 3RD / MAP rail             | C to cycle, F to fly             |

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
| Venue analysis | zones, block geometry, roof coverage, supports | events you cannot bid for, with a named reason |
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
- **Zones can be painted on open ground.** A "locker room" does not have to be
  an enclosed box. Enclosure would be more realistic but adds friction without
  adding a decision; provision is measured by area against capacity instead.
- **No structural collapse.** Roofs that outrun their supports are flagged and
  can cause an inspector incident on event day, but nothing ever falls down.
  The goal is creativity, not punishment.

## What is deliberately not here yet

- **Long-run balance is unproven.** The systems are tested individually and the
  loop is tested end to end, but nobody has played 300 in-game days. The
  progression from a community ground to a world championship host is designed
  rather than demonstrated.
- **Ice, aquatic, cricket, combat, baseball and esports venues** have zones,
  blocks, venue types and event templates, but far less balancing than football
  and basketball.
- **Real-device performance is unmeasured.** Everything here was profiled under
  software rendering, which tells you nothing about a phone.

Nothing in that list is exposed in the UI as a dead button.

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
npm test              # 109 headless simulation tests
npm run test:balance  # plays whole seasons headlessly and checks the economy
npm run sim           # a playthrough with charts (--days 720 --seeds 5)
npm run sim:sports    # builds every sport and puts it to its own events
npm run sim:land      # what each plot size is actually worth
npm run sim:end       # plays a game to all thirteen long-term goals
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

   Seventy materials across eight categories — structure, exterior, surfaces,
   roads and parking, seating, roofing, decor and terrain — twelve of them
   behind research. Every one is priced, placeable and reversible, and a test
   sweeps the whole palette to keep it that way.

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

### The registries are a file format

A block, zone or equipment type's numeric id is its index in its registry
array, and the world is saved as raw ids. That makes `BLOCKS`, `ZONES` and
`PROPS` a file format rather than three lists: insert a row in the middle and
every id after it shifts by one, so every existing save quietly reinterprets
its seating as roofing. Nothing catches that at runtime — the save loads, it is
just wrong.

New content goes on the end of its array. `tests/systems.test.js` holds a
manifest of every id that has shipped and fails if one moves, which is how that
rule gets enforced rather than remembered.

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

Some materials are not decoration. A **Doorway** is a hole you can walk
through, and it zones itself as an entrance; the analyser counts each separate
run of entrance zone as a gate, and gates are most of what crowd flow and
safety are scored on. Cutting four doors into a facade is a decision about
crowd flow, not a cosmetic one.

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

Running it found nine things that were wrong, all of which are now fixed:

| What it found | Why it mattered |
| --- | --- |
| The event board ignored what you had built | A football-only complex spent whole months looking at tennis and basketball it could never bid on. Organisers now approach venues that could plausibly host them; a quarter of the board still shows other sports, as the argument for building a second one. |
| Event setup cost scaled with the venue's *capacity* | Every stand you built made small events less affordable, so growing punished you. It now scales with the crowd that actually turns up. |
| A flat $20,000 marketing charge on every event | More than the entire gate of a community fixture. Marketing is now the organiser's ambition, which is what the tier measures. |
| Incident costs were flat sums | The same $120,000 roof closure was a rounding error at an international final and fatal at a community ground. Costs now scale with the tier and are capped at a share of what the event was worth. |
| Upkeep was charged on the plot's own grass | 15% of an early complex's entire bill was for the lawn it was given. Natural ground is now free to keep. |
| Five sports had venues but no events | Rugby, cricket, swimming, ice and soccer shipped zones, blocks, equipment and venue types with nothing ever scheduled on them. You could build a cricket ground, register it, and discover the dead end only after paying for it. Every sport now has a local → regional → national ladder, and soccer is a second name for football rather than a separate sport with nowhere to go. |
| A venue's "reach" was measured from the playing surface alone | A basketball floor is 30m across; a 16,000-seat arena around it is 120m across. Its own concourses, media centre and restrooms fell outside the venue and counted for nothing, so small-floor sports could never pass a national requirement. Reach now follows the stands. |
| Requirements could read "have 50%, need 50%" and still fail | The comparison used raw values and the display rounded them. It now compares at the precision the player is shown. |
| The Mega Sports District goal could never complete | It read `state.landTier`, which moved onto sites when the game gained more than one city. Its progress had read NaN ever since. A test now sweeps every goal and every achievement for this. |

It also caught three prefabs — the stadium entrance, the food court and the
performance centre — shipping with roofs that the game's own structural
inspector flagged, which caused event-day incidents. They have columns now, and
a test holds every prefab to the game's own rule.

`npm run sim:sports` is the other half: it builds every one of the thirteen
sports to championship size, fits it out, buys it the land it needs, and puts
it to every event that sport offers. That is what turned up the dead ends
above, and it is a test now — a sport cannot ship with a venue type and nothing
to host.

What a played complex looks like now — the whole arc, from a starting plot and
$3.5M to the ceremony the endgame is named after:

```
day   22  first local event hosted
day   36  regional tier
day  198  national tier
day  398  international tier
day  542  the largest plot is full; a second complex begins in the second city
day  572  world tier - the Games Opening Ceremony
day 1080  194,940 seats across two cities, rating 88, reputation 100,
          77 events hosted, never once insolvent, and $55M in the bank
          rather than half a billion with nothing to buy
```

Getting there turned up one thing that was the game's fault rather than the
simulated player's, and it is the kind a player would never diagnose:

| What was wrong | Why it mattered |
| --- | --- |
| Buying land only added ground on two sides | A complex built in the middle of the starting plot — the obvious place — ended up jammed in a corner of the largest one, with half of every later parcel out of its venue's reach and its bowl able to grow only half as far as the plot suggested. There was no warning and no way to move a stadium, so the trap was permanent and cost real money to discover. New land now wraps the plot on every side, and everything already standing moves with it: blocks, equipment, work under construction, the venue's registration and name, and the camera. |

`tests/balance.test.js` asserts the shape of that rather than the figures —
solvent, events to bid on, every rung of the ladder climbed in order — because
tight assertions here would break on every balance tweak and teach us nothing.
It takes about four minutes, so it is `npm run test:balance` rather than part
of the fast suite; `npm run test:all` runs both.

## The ending, played

Thirteen long-term goals are the closest thing this game has to an ending:
a 90,000-seat ground, a rating of 95, four venues on one plot, six sports,
three cities, a million spectators, $250M banked, the World Championship, the
Opening Ceremony. They had never been played to. Each was known to *read*
sanely — a test checks that — but nothing had ever driven one game to tick all
thirteen, and a goal that cannot be finished is worse than no goal, because
the player spends real time on it.

`npm run sim:end` does that now. It reaches 13/13 on day 542, and getting
there found two bugs. Neither threw an error. Both meant something the player
had built counted for nothing, which is the worst kind: you pay for it, you
can see it standing there, and the rating does not move.

| What was wrong | Why it mattered |
| --- | --- |
| Roofed seating read as open to the sky | Cover was measured upward from the top of each column — and a canopy *is* the top of the column it covers, so the check looked for a roof above the roof and found nothing. Seat roof coverage was always zero, which meant the entire roofing category had no effect on the comfort and appearance it is supposed to drive. A rating of 95 was unreachable for anyone. |
| Building a second ground cost the first one its rating | A facility went to the nearest venue *centre*, and was then thrown away if that venue could not reach it — instead of falling back to one that could. A media centre one step closer to the new arena than to the stadium it was built for counted for neither. Putting a second venue on your plot silently stripped the first. |
| Expanding made the neighbours angrier | Community standing mixed its scopes: one venue's parking shortfall multiplied by the *whole empire's* capacity, and noise from every city's attendance. Opening a well-parked ground in another city raised the traffic pressure on the one you already had, so "Part Of The Furniture" became unreachable for exactly the players who had earned it. Each complex is now judged on its own crowd, and the single standing figure drifts toward all of them weighted by size. |

Finishing the list is now acknowledged. Each goal announces itself as it
completes — they used to fill a progress bar in silence — and the thirteenth
opens a summary of what was actually built, read back off the save rather than
tallied along the way: cities, venues, total capacity, the largest ground,
events, spectators, profit, blocks placed. It is not a game over. The complex
is still there, and the last line says so.

## How it looks

No textures and no image assets: every surface is flat architectural colour
from the block table, lit at runtime. Four things do the work of making that
read as a building rather than a stack of cubes.

- **Corner occlusion.** Every face corner is darkened by how much is tucked
  around it, the standard three-neighbour voxel rule, computed in the mesher.
  Faces only merge when their occlusion matches and is even across the face,
  so the contact darkening is exact rather than smeared along a wall — a flat
  slab still meshes into a handful of quads, and a test holds it to that.
  Without this a bowl of seating, the underside of a canopy and the inside of
  a vomitory are all the same flat tone, and nothing looks like it is touching
  anything else.
- **Sun shadows.** One orthographic depth pass, fitted around whatever the
  camera is looking at and snapped to whole texels so the edge does not crawl.
  The world's material is a custom shader that knows nothing about Three's
  lights, so this is hand-rolled rather than the built-in one. It is the most
  expensive thing the renderer does, so it is a setting — Auto leaves it off
  on a phone — and it fades out at night and under overcast weather, where a
  hard shadow would look wrong.
- **Surface finish.** Blocks declare how they catch light. `turf` gets the
  mown bands a groundsman cuts into a pitch, and no panel seams, because the
  per-metre grid is the one thing that reads as tiling on grass. `gloss` —
  glass, metal, ice, water, canopies — gets a real specular highlight with a
  Fresnel edge. `seat` gets heavy per-voxel variation, because a deck of seats
  is thousands of separate mouldings and never one flat colour. Everything
  else gets a little grain so a fifty-metre concrete wall is not dead flat.
- **A horizon.** The plot is a finite square of voxels, so the world used to
  stop at the fence with sky underneath it. A ground plane, lit by the same
  terms as the voxels and fading into the same fog, closes it.

The cost of all that, at the worst case the game can produce: triangles rise
from 4k to 19k in first person and 7k to 56k across the whole site, draw calls
are unchanged, and a 1,600-block fill takes 30ms to remesh rather than 22.

## Performance, measured

`npm run e2e` ends with a stress build: the largest plot, a 46-ring bowl, a
championship pitch, a canopy and fitted equipment — 852,000 blocks and 79,752
seats, far past anything the game leads you toward.

| | draw calls | triangles | median frame |
| --- | --- | --- | --- |
| First person, inside the bowl | 80 | 19k | 0.6ms |
| Zone overlay | 106 | 19k | 0.6ms |
| Overview, whole site on screen | 249 | 56k | 0.6ms |

A 1,600-block fill takes under a millisecond to place and 30ms to remesh.
Shadows add a second pass over whatever falls inside the sun's frustum. An
ordinary stadium — the one the tutorial walks you to — renders in under 30
calls; 248 is the worst case the game can produce, with one mesh per built
chunk and nothing to cull when the entire site is on screen. The frame times
are from software rendering and mean nothing; the call and triangle counts do.

## What is deliberately not here yet

- **The two harnesses meet in the middle, not at the end.** `sim:end` proves
  every goal is *reachable*, granting the money to build; `sim:longrun` proves
  the economy *affords* a climb to the world tier by playing it. Nothing yet
  plays one game, paying its own way, all the way to thirteen out of thirteen.
  Both halves are demonstrated; the join is not.
- **The non-football sports are proven, not tuned.** `npm run sim:sports`
  builds every one of the thirteen to championship size and shows it winning
  and hosting at every tier it offers, which is why the dead ends above were
  found. What it does not show is whether their economics are *interesting* —
  whether a cricket ground is a different business from a football stadium
  rather than the same one with a rounder pitch.
- **Prefab prices are derived, not tuned.** A prefab costs exactly what its
  blocks and fittings cost, with no discount for convenience and no premium for
  it. Whether that is the right economic call is unproven.
- **The simulated player is not a good player.** It builds to a formula: a
  pitch, rings of seating around it, facilities at spread bearings outside the
  bowl, a canopy over the top rings, and a second complex of the same shape
  once the first plot is full. That is enough to climb every tier and to
  surface a cost scaling off the wrong quantity. It says nothing about what a
  skilled player could reach, and it only ever builds football.
- **Real-device performance is still unmeasured.** The draw-call and triangle
  counts above are real and hold up; the frame times are from software
  rendering and tell you nothing about a phone's thermal behaviour, fill rate
  or memory pressure.

Nothing in that list is exposed in the UI as a dead button.

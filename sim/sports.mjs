/**
 * Can you actually play every sport?
 *
 * For each sport zone: build a regulation surface, ring it with seating and
 * facilities, fit the equipment the analyser asks for, register it, and then
 * try to win and host that sport's events at every tier. A sport that ships a
 * zone, blocks and a venue type but cannot get to an event is a dead end.
 *
 *   node sim/sports.mjs [--verbose]
 */
import { Game } from '../src/core/game.js';
import { SPORT_ZONES, zoneId } from '../src/data/zones.js';
import { blockId } from '../src/data/blocks.js';
import { PROPS, propId, SPORT_EQUIPMENT } from '../src/data/props.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { instantiate } from '../src/events/eventGenerator.js';
import { makeRng } from '../src/core/rng.js';
import { checkRequirements } from '../src/events/eventRequirements.js';
import { simulateEvent } from '../src/events/eventSimulation.js';
import { GROUND_Y, LAND_TIERS, SEATS_PER_VOXEL } from '../src/core/constants.js';
import { fmt } from './strategy.mjs';

globalThis.performance ??= { now: () => Date.now() };
const VERBOSE = process.argv.includes('--verbose');

/**
 * Build a complex good enough to bid with: the sport's own surface at
 * championship size, a deep bowl of seating, every support facility, lighting,
 * parking and roads.
 */
export function buildFor(sz, opts = {}) {
  const game = new Game();
  game.newGame({ complexName: `${sz.name} Complex`, seed: opts.seed ?? 11 });
  game.notify = () => {};
  buildComplex(game, sz, opts);
  game.state.cash = opts.cash ?? 60_000_000;
  game.state.reputation.venue = opts.rep ?? 90;
  game.state.reputation.organiser = opts.rep ?? 90;
  game.markWorldDirty();
  game.analyze(true);
  const v = game.analysis.venues.find((x) => x.sport === sz.sport) || game.primaryVenue;
  if (v) game.registerVenue(v.key, `${sz.name} Arena`);
  game.analyze(true);
  return { game, venue: game.allVenues().find((x) => x.sport === sz.sport) || null };
}

/**
 * Lay a championship complex into whichever site the game is standing on.
 *
 * Split out of `buildFor` so the endgame harness can put one of these on each
 * of several sites in the same game. Everything here goes straight into the
 * world: this is a fixture generator, not a player, and it says nothing about
 * whether a human could afford to build it.
 *
 * @param opts.roof    cover the outer rings, for the comfort and appearance
 *                     that the very top of the rating scale needs
 * @param opts.screens big screens, which appearance counts up to three of
 * @param opts.seats   override the seat target (the goals want one 90,000 bowl)
 */
export function buildComplex(game, sz, opts = {}) {
  const G = GROUND_Y;
  const B = blockId, Z = zoneId;

  // How many seats does this sport's biggest event actually want?
  const biggest = EVENT_TEMPLATES
    .filter((t) => t.sport === sz.sport)
    .reduce((m, t) => Math.max(m, (t.req.find((r) => r.key === 'capacity') || { min: 0 }).min), 0);
  const targetSeats = opts.seats || Math.max(3_000, Math.round(biggest * 1.25));

  // Enough rings to hold that, and enough land to hold the rings plus the
  // facilities and parking that have to sit within the venue's reach.
  const idealDims = sz.regulation.ideal || sz.regulation;
  const ipw = Math.max(idealDims.w, idealDims.d), ipd = Math.min(idealDims.w, idealDims.d);
  let rings = 0, seats = 0;
  while (seats < targetSeats && rings < 60) {
    rings++;
    const perim = 2 * (ipw + 2 * rings) + 2 * (ipd + 2 * rings) - 4;
    if (rings % 6 !== 0) seats += perim * SEATS_PER_VOXEL;
  }
  const wantedSize = Math.max(ipw, ipd) + 2 * (rings + 34);
  const tierIndex = LAND_TIERS.findIndex((t) => t.size >= wantedSize);
  const want = opts.landTier ?? (tierIndex < 0 ? LAND_TIERS.length - 1 : tierIndex);
  // Never shrink a plot that is already bigger: a second complex on a site
  // must not undo the land the first one needed.
  const tier = Math.max(want, game.site.landTier || 0);
  game.site.landTier = tier;
  game.world.expandTo(LAND_TIERS[tier].size);

  const w = game.world;
  const size = w.size;

  // ------------------------------------------------------------ the surface
  const ideal = sz.regulation.ideal || sz.regulation;
  const pw = Math.max(ideal.w, ideal.d), pd = Math.min(ideal.w, ideal.d);
  // Centred on the plot unless the caller places it, which is how several
  // complexes fit on one site instead of being built on top of each other.
  const px0 = opts.at ? Math.round(opts.at.x - pw / 2) : Math.floor((size - pw) / 2);
  const pz0 = opts.at ? Math.round(opts.at.z - pd / 2) : Math.floor((size - pd) / 2);
  const surface = B(sz.surfaces[0]);
  for (let z = pz0; z < pz0 + pd; z++) {
    for (let x = px0; x < px0 + pw; x++) w.setBlock(x, G - 1, z, surface, sz.id);
  }

  // ------------------------------------------------------------- the seating
  // Rings of raked seats, deep enough for the tier being tested.
  for (let r = 2; r < 2 + rings; r++) {
    const y = G + Math.floor((r - 2) * 0.8);
    const x0 = px0 - r, x1 = px0 + pw - 1 + r;
    const z0 = pz0 - r, z1 = pz0 + pd - 1 + r;
    if (x0 < 2 || z0 < 2 || x1 >= size - 2 || z1 >= size - 2 || y >= 58) break;
    const concourse = r % 6 === 0;
    const col = (x, z) => {
      for (let yy = G - 1; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'));
      w.setBlock(x, y, z, concourse ? B('pavement') : B('seat'),
        concourse ? Z('concourse') : Z('seating'));
    };
    for (let x = x0; x <= x1; x++) { col(x, z0); col(x, z1); }
    for (let z = z0 + 1; z < z1; z++) { col(x0, z); col(x1, z); }
  }

  // ---------------------------------------------------------- the facilities
  // Facilities only count toward a venue when they sit inside its reach, so
  // they ring the bowl rather than going wherever there is room. This is the
  // same constraint a player works under.
  const cx = px0 + pw / 2, cz = pz0 + pd / 2;
  const bowlOut = Math.max(pw, pd) / 2 + rings + 2;
  // The game grows a venue's reach to cover its stands, so facilities may sit
  // out to roughly the bowl's outer edge plus a margin.
  const reach = Math.max(46, Math.hypot(pw, pd) * 1.9, bowlOut * 1.3 + 10);
  const natural = (x, z) => w.heightAt(x, z) <= G - 1
    && [B('grass'), B('dirt')].includes(w.getBlock(x, G - 1, z));
  const patch = (fw, fd, zk, block = 'tile') => {
    for (let r = Math.ceil(bowlOut); r < reach * 0.95; r += 2) {
      for (let a = 0; a < 48; a++) {
        const ang = (a / 48) * Math.PI * 2;
        const x0 = Math.round(cx + Math.cos(ang) * r) - Math.floor(fw / 2);
        const z0 = Math.round(cz + Math.sin(ang) * r) - Math.floor(fd / 2);
        if (x0 < 2 || z0 < 2 || x0 + fw >= size - 2 || z0 + fd >= size - 2) continue;
        let ok = true;
        for (let z = z0; z < z0 + fd && ok; z++) {
          for (let x = x0; x < x0 + fw; x++) if (!natural(x, z)) { ok = false; break; }
        }
        if (!ok) continue;
        for (let z = z0; z < z0 + fd; z++) {
          for (let x = x0; x < x0 + fw; x++) w.setBlock(x, G - 1, z, B(block), Z(zk));
        }
        return true;
      }
    }
    return false;
  };

  // Sized against the capacity the bowl actually produced, with headroom.
  const area = (n) => Math.max(6, Math.ceil(Math.sqrt(n)));
  const provision = [
    ['restroom', seats / 90], ['concession', seats / 150], ['concourse', seats / 14],
    ['entrance', seats / 700], ['exit', seats / 450], ['stairs', seats / 550],
    ['security', Math.max(40, seats / 1800)], ['medical', Math.max(40, seats / 3000)],
    ['locker', 140], ['media', Math.max(40, seats / 900)], ['broadcast', Math.max(40, seats / 1500)],
    ['hospitality', seats / 700], ['retail', seats / 700], ['fanzone', seats / 400],
    ['training', 60], ['staff', 60], ['storage', 60], ['office', 60],
  ];
  for (const [zk, want] of provision) {
    let placed = 0;
    // Several separate blocks, so gate counts and spread read properly.
    const pieces = zk === 'entrance' || zk === 'exit' ? 6 : 3;
    const each = Math.ceil(want / pieces);
    for (let i = 0; i < pieces && placed < want; i++) {
      const sq = area(each);
      if (patch(sq, sq, zk)) placed += sq * sq; else break;
    }
  }

  // Parking. A crowd this size cannot be parked flat on one plot, which is
  // what the multi-level garage exists for.
  const cars = Math.ceil(targetSeats / 1.2);
  let parked = 0;
  // Stacked as high as the world allows. A 90,000-seat ground needs tens of
  // thousands of spaces and a six-deck garage does not get close, which left
  // the biggest venues permanently short and their neighbours permanently
  // cross about the traffic.
  const sq = 20, levels = 15;
  for (let z0 = 2; z0 + sq < size - 2 && parked < cars; z0 += sq + 2) {
    for (let x0 = 2; x0 + sq < size - 2 && parked < cars; x0 += sq + 2) {
      let ok = true;
      for (let z = z0; z < z0 + sq && ok; z += 2) {
        for (let x = x0; x < x0 + sq; x += 2) if (!natural(x, z)) { ok = false; break; }
      }
      if (!ok) continue;
      for (let lvl = 0; lvl < levels; lvl++) {
        const y = G - 1 + lvl * 3;
        if (y + 2 >= 58) break;
        for (let z = z0; z < z0 + sq; z++) {
          for (let x = x0; x < x0 + sq; x++) {
            w.setBlock(x, y, z, B('asphalt'), Z('parking'));
            if (lvl > 0 && (x - x0) % 6 === 0 && (z - z0) % 6 === 0) {
              for (let yy = y - 2; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'));
            }
          }
        }
        parked += Math.floor(sq * sq / 5);
      }
    }
  }

  // Transit, buses and taxis take the rest of the crowd off the roads.
  for (let i = 0; i < 6; i++) patch(20, 10, 'transit', 'pavement');
  for (let i = 0; i < 4; i++) patch(16, 8, 'parking_bus', 'bus_lane');
  for (let i = 0; i < 3; i++) patch(16, 8, 'parking_taxi', 'park_taxi');
  // Roads have to feed the parking or none of it is usable: the service ratio
  // wants roughly a quarter of a lane voxel per car, weighted by road type.
  const mainRoads = Math.max(6, Math.ceil((cars * 0.25) / (30 * 4 * 2.4)) + 2);
  for (let i = 0; i < mainRoads; i++) patch(30, 4, 'road_main', 'road_main');
  for (let i = 0; i < 2; i++) patch(24, 4, 'road_emergency', 'road_emerg');
  for (let i = 0; i < 2; i++) patch(24, 4, 'road_bus', 'bus_lane');

  // Floodlights around the bowl.
  // Floodlight masts ringing the bowl on free ground, near enough to count.
  // The rating asks for up to 24 at a big ground.
  let lit = 0;
  for (let rr = Math.ceil(bowlOut) + 1; rr < reach && lit < 24; rr += 2) {
    for (let i = 0; i < 32 && lit < 24; i++) {
      const ang = (i / 32) * Math.PI * 2;
      const lx = Math.round(cx + Math.cos(ang) * rr);
      const lz = Math.round(cz + Math.sin(ang) * rr);
      if (lx < 1 || lz < 1 || lx >= size - 1 || lz >= size - 1) continue;
      if (!natural(lx, lz)) continue;
      for (let y = G; y < G + 14; y++) w.setBlock(lx, y, lz, B('steel'));
      w.setBlock(lx, G + 14, lz, B('floodlight'));
      lit++;
    }
  }

  // ------------------------------------------------------------- the fittings
  // Everything the analyser says this sport wants, placed on the run-off.
  const wanted = SPORT_EQUIPMENT[sz.sport] || [];
  const byProvides = {};
  for (const p of PROPS) (byProvides[p.provides] = byProvides[p.provides] || []).push(p);
  let ex = px0, ez = pz0 - 2;
  for (const req of [...wanted, { provides: 'scoreboard', need: 1 }]) {
    const type = (byProvides[req.provides] || [])[0];
    if (!type) continue;
    for (let i = 0; i < req.need; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 400 && !placed; attempt++) {
        if (w.props.canPlace(w, propId(type.key), ex, G, ez, 0).ok) {
          w.props.add(propId(type.key), ex, G, ez, 0);
          placed = true;
        }
        ex += 3;
        if (ex >= px0 + pw) { ex = px0; ez -= 1; if (ez < 2) ez = pz0 + pd + 1; }
      }
    }
  }

  // A canopy over the outer rings, and big screens. Neither matters until the
  // very top of the rating scale, where comfort and appearance are what is
  // left to win: an uncovered bowl cannot pass 90 however good the rest is.
  if (opts.roof) {
    const top = G + Math.floor((rings - 1) * 0.8);
    const y = Math.min(61, top + 3);
    const canopy = B('roof_stadium');
    for (let k = 0; k < 14; k++) {
      const r = rings + 1 - k;
      if (r < 2) break;
      const x0 = px0 - r, x1 = px0 + pw - 1 + r;
      const z0 = pz0 - r, z1 = pz0 + pd - 1 + r;
      const panel = (x, z) => {
        if (x < 2 || z < 2 || x >= size - 2 || z >= size - 2) return;
        w.setBlock(x, y, z, canopy);
        if (k === 0) for (let yy = top + 1; yy < y; yy++) w.setBlock(x, yy, z, B('steel'));
      };
      for (let x = x0; x <= x1; x++) { panel(x, z0); panel(x, z1); }
      for (let z = z0 + 1; z < z1; z++) { panel(x0, z); panel(x1, z); }
    }
  }
  for (let i = 0; i < (opts.screens || 0); i++) {
    const ang = (i / Math.max(1, opts.screens)) * Math.PI * 2;
    const sx = Math.round(cx + Math.cos(ang) * (bowlOut - 1));
    const sz2 = Math.round(cz + Math.sin(ang) * (bowlOut - 1));
    for (let dx = 0; dx < 14; dx++) {
      for (let dy = 0; dy < 8; dy++) w.setBlock(sx + dx, G + 16 + dy, sz2, B('screen'));
    }
  }

  // Utilities up to whatever the complex draws.
  for (const key of ['power', 'water', 'sewer', 'data', 'climate']) {
    for (let i = 0; i < 4; i++) {
      game.state.cash = 1e9;
      if (game.upgradeUtility(key)?.error) break;
    }
  }
  return { rings, seats, size };
}

/** Try every event of a sport against a venue built for it. */
export function auditSport(sz) {
  const { game, venue } = buildFor(sz);
  const result = {
    sport: sz.sport, zone: sz.key, name: sz.name,
    built: !!venue,
    capacity: venue?.capacity.total || 0,
    rating: venue?.ratings.overall || 0,
    tier: venue?.tier || 'none',
    equipment: venue ? venue.equipmentScore : 0,
    events: [],
    problems: [],
  };
  if (!venue) { result.problems.push('no venue detected on its own regulation surface'); return result; }
  if (venue.field.regulation < 1) result.problems.push('the championship-size surface is not regulation');
  if (!venue.field.surfaceOk) result.problems.push('its own first-listed surface is rejected');

  const templates = EVENT_TEMPLATES.filter((t) => t.sport === sz.sport);
  if (!templates.length) { result.problems.push('no events exist for this sport'); return result; }

  for (const tpl of templates) {
    const ev = instantiate(tpl, game.state, makeRng(4242));
    const check = checkRequirements(ev, venue, game.state);
    const bid = { amount: Math.round((ev.bidRange[0] + ev.bidRange[1]) / 2),
      venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
    const sim = check.ok
      ? simulateEvent(ev, venue, { ...game.state, weather: 'sunny', complex: game.analysis.complex }, bid)
      : null;
    const row = {
      id: tpl.id, name: tpl.name, tier: tpl.tier,
      ok: check.ok,
      failed: check.lines.filter((l) => !l.ok).map((l) => `${l.label} (have ${l.have}, need ${l.need})`),
      attendance: sim?.attendance ?? 0,
      profit: sim ? sim.profit - bid.amount : 0,
    };
    result.events.push(row);
    if (!check.ok) {
      result.problems.push(`${tpl.tier} "${tpl.name}" is unwinnable even here: ${row.failed.join('; ')}`);
    } else if (row.profit <= 0) {
      result.problems.push(`${tpl.tier} "${tpl.name}" loses ${fmt(-row.profit)} at a mid bid`);
    }
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Every sport, built to championship size and put to its own events\n');
  let bad = 0;
  const seen = new Set();
  for (const sz of SPORT_ZONES) {
    if (seen.has(sz.sport)) continue;          // soccer and football are one sport
    seen.add(sz.sport);
    const r = auditSport(sz);
    const head = `${r.sport.padEnd(11)} cap ${r.capacity.toLocaleString().padStart(7)}  `
      + `rating ${String(r.rating).padStart(3)}  tier ${r.tier.padEnd(13)} equip ${(r.equipment * 100).toFixed(0)}%`;
    console.log(head);
    for (const e of r.events) {
      const money = e.ok ? fmt(e.profit).padStart(9) : '        -';
      console.log(`   ${e.ok ? '✓' : '✗'} ${e.tier.padEnd(14)} ${e.name.padEnd(34)} ${money}`
        + (e.ok ? `  ${e.attendance.toLocaleString()} in` : `  ${e.failed[0]}`));
    }
    for (const p of r.problems) { console.log(`   PROBLEM ${p}`); bad++; }
    if (VERBOSE) console.log('');
  }
  console.log(bad ? `\n${bad} problem(s) across the catalogue` : '\nevery sport can be built, staffed and hosted');
  process.exit(bad ? 1 : 0);
}

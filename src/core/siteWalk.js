import { BLOCK_SIZE, CHUNK_X, CHUNK_Y, CHUNK_Z } from './constants.js';
import { AIR, block } from '../data/blocks.js';
import { ZONE_BY_ID, zoneId } from '../data/zones.js';
import { Chunk } from '../voxel/world.js';
import { raycastVoxel } from '../voxel/raycast.js';
import { PROP_BY_ID } from '../data/props.js';
import { scanWorld, components } from '../venues/analysis.js';

/**
 * ---------------------------------------------------------------------------
 * THE SITE WALK
 * ---------------------------------------------------------------------------
 * Play mode is the complex from head height, and this is what it knows.
 *
 * Every number the management screens show is an aggregate: a crowd-flow
 * rating of 61, four thousand square metres of concourse. None of that tells
 * you that the only route from the north stand to the toilets is a two-metre
 * gap behind a pillar, or that row 3 of the west tier is looking at the back
 * of a roof truss. Walking finds those, because standing somewhere and asking
 * "what can I see and how far is the nearest loo" is a different question from
 * the one the analyser asks.
 *
 * So this module answers exactly two things about a *place*:
 *
 *   spotReport   what it is like to stand here
 *   seatReport   what you can see from this seat
 *
 * and assembles the list of places worth standing (`siteStops`). Nothing here
 * invents data: it reads the same voxels the analyser reads, one point at a
 * time instead of all at once.
 */

/** How long a completed inspection stays in date. */
export const CERTIFICATE_DAYS = 40;
/** A stop counts as visited from this far away, in blocks. */
export const STOP_RADIUS = 5;
/** A seat seeing less than this much of the field counts as restricted. */
const RESTRICTED_BELOW = 0.5;

export function createSiteWalkState() {
  return {
    visited: [],          // stop ids reached on the current walk
    completedDay: -1,     // day the last full walk finished
    walks: 0,
    seatsChecked: 0,
    restricted: [],       // [{ x, y, z, quality, blockedBy }] seats that cannot see
    best: null,           // the best seat found so far
  };
}

// ===========================================================================
// WHAT IS WORTH WALKING TO
// ===========================================================================

/**
 * The zones a visitor would notice, in the order a visit happens: you park,
 * you come in, you find your seat, you go for a pie at half time.
 */
const STOP_ZONES = [
  { key: 'transit',     name: 'Transit stop',    ask: 'Can people arrive without a car?' },
  { key: 'parking',     name: 'Car park',        ask: 'How far is the walk in from the furthest bay?' },
  { key: 'box_office',  name: 'Box office',      ask: 'Is it before the turnstiles, where it needs to be?' },
  { key: 'entrance',    name: 'Entrance',        ask: 'How wide is the approach, and where does the queue go?' },
  { key: 'concourse',   name: 'Concourse',       ask: 'Two people abreast, or four?' },
  { key: 'stairs',      name: 'Vomitory',        ask: 'Does the stand empty through here without a crush?' },
  { key: 'seating',     name: 'Seating bowl',    ask: 'What does an ordinary ticket actually see?' },
  { key: 'concession',  name: 'Concessions',     ask: 'Can you get served and back before the restart?' },
  { key: 'restroom',    name: 'Restrooms',       ask: 'How far from the furthest seat?' },
  { key: 'medical',     name: 'Medical room',    ask: 'Can a stretcher reach the pitch from here?' },
  { key: 'exit',        name: 'Emergency exit',  ask: 'Is the route out of the building obvious?' },
  { key: 'fanzone',     name: 'Fan zone',        ask: 'Is there anywhere to be an hour before kick-off?' },
  { key: 'hospitality', name: 'Hospitality',     ask: 'Does the premium product feel premium?' },
  { key: 'media',       name: 'Media centre',    ask: 'Is there a working position with a view of the field?' },
];

/**
 * The stops for a walk of this complex: the pitch itself, plus the largest
 * cluster of each notable zone. One stop per zone, not one per voxel - a walk
 * with sixty identical "concourse" markers is a chore, not an inspection.
 */
export function siteStops(world, venues = []) {
  const { zoneInfo, size } = scanWorld(world);
  const stops = [];

  for (const v of venues) {
    stops.push({
      id: `pitch:${v.key}`,
      kind: 'pitch',
      name: `${v.name || v.suggestedName || v.sportName} — the field`,
      ask: 'Stand where the players stand. Is the place intimidating or empty?',
      x: Math.round(v.centre.x), y: Math.max(0, v.field.y) + 1, z: Math.round(v.centre.z),
      venueKey: v.key,
    });
  }

  for (const def of STOP_ZONES) {
    const zid = zoneId(def.key);
    const info = zid && zoneInfo.get(zid);
    if (!info || info.count < 4) continue;
    const comps = components(info.foot, size, 4);
    if (!comps.length) continue;
    comps.sort((a, b) => b.area - a.area);
    const c = comps[0];
    const cx = Math.round((c.minX + c.maxX) / 2);
    const cz = Math.round((c.minZ + c.maxZ) / 2);
    const y = topZoned(world, cx, cz, zid);
    stops.push({
      id: `zone:${def.key}`,
      kind: def.key,
      name: def.name,
      ask: def.ask,
      x: cx, y: y >= 0 ? y + 1 : world.heightAt(cx, cz) + 1, z: cz,
      area: info.count,
      clusters: comps.length,
      // Kept so a spawn can pick the corner of the cluster facing the pitch
      // rather than its middle, which is often inside the gatehouse.
      bounds: { minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ },
      zoneKey: def.key,
    });
  }

  return stops;
}

function topZoned(world, x, z, zid) {
  for (let y = CHUNK_Y - 1; y >= 0; y--) if (world.getZone(x, y, z) === zid) return y;
  return -1;
}

// ===========================================================================
// WHAT IT IS LIKE TO STAND HERE
// ===========================================================================

/** Zones a visitor wants to be near, and how far is still comfortable (blocks). */
const AMENITIES = [
  { key: 'restroom',   label: 'Restrooms',   good: 18, bad: 45 },
  { key: 'concession', label: 'Food',        good: 18, bad: 45 },
  { key: 'exit',       label: 'Way out',     good: 22, bad: 55 },
  { key: 'medical',    label: 'Medical',     good: 40, bad: 90 },
];

/**
 * Standing here: what is overhead, how much room there is, what is within
 * reach and whether you can see the game.
 *
 * `pos` is in voxels. Everything is measured from the voxel the player's feet
 * are in, because that is where they are - not from the venue centre, which is
 * the whole point of walking.
 */
export function spotReport(world, pos, venues = [], fields = null) {
  const x = Math.round(pos.x), y = Math.round(pos.y), z = Math.round(pos.z);
  const here = world.getZone(x, y, z) || world.getZone(x, y - 1, z);
  const under = world.getBlock(x, y - 1, z);
  const zdef = here ? ZONE_BY_ID[here] : null;

  // ------------------------------------------------------------ shelter
  let cover = 0, coverAt = 0;
  for (let up = y + 1; up < Math.min(CHUNK_Y, y + 30); up++) {
    if (world.isSolid(x, up, z)) { cover = 1; coverAt = up - y; break; }
  }

  // ----------------------------------------------------------- elbow room
  // How far you can walk in each compass direction before something stops
  // you. The narrowest of the two axes is what a crowd actually feels.
  const runs = [];
  const layer = world.props;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let n = 0;
    while (n < 24) {
      const cx = x + dx * n, cz = z + dz * n;
      const nx = x + dx * (n + 1), nz = z + dz * (n + 1);
      if (!world.inBounds(nx, y, nz)) break;
      if (world.isSolid(nx, y, nz)) break;
      if (!world.isSolid(nx, y - 1, nz)) break;   // nothing to walk on
      // A wall on the edge between here and there stops you just as a block
      // would. Without this a walled room measures as open ground, which is
      // exactly the sort of thing walking the place is supposed to catch.
      const wall = layer?.size ? layer.wallBetween(cx, y, cz, nx, nz) : null;
      if (wall && !isDoorway(wall)) break;
      n++;
    }
    runs.push(n);
  }
  const widthX = runs[0] + runs[1] + 1;
  const widthZ = runs[2] + runs[3] + 1;
  const width = Math.min(widthX, widthZ);

  // ------------------------------------------------------------ amenities
  const amenities = AMENITIES.map((a) => {
    const d = fieldAt(fields, a.key, x, z, world.size);
    return {
      ...a,
      distance: d,
      metres: d === null ? null : Math.round(d * BLOCK_SIZE),
      unknown: d === null && !fields,
      ok: d !== null && d <= a.good,
      poor: d === null || d > a.bad,
    };
  });

  // -------------------------------------------------------------- the view
  const venue = nearestVenue(venues, x, z);
  const view = venue ? sightline(world, { x, y, z }, venue) : null;

  // ------------------------------------------------------------ the verdict
  // Weighted the way a spectator would weight it: being able to see and being
  // able to move matter more than whether there is a roof.
  let score = 55;
  if (view) score += (view.quality - 0.5) * 46;
  score += Math.max(-16, Math.min(14, (width - 3) * 3.2));
  if (cover) score += 7;
  for (const a of amenities) {
    if (a.ok) score += 4;
    else if (a.poor) score -= 5;
  }
  if (zdef?.vip) score += 6;
  if (under !== AIR && block(under).category === 'ground' && !zdef) score -= 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    x, y, z,
    zone: zdef ? { key: zdef.key, name: zdef.name, color: zdef.color } : null,
    surface: under === AIR ? null : block(under).name,
    covered: !!cover,
    coverHeight: cover ? coverAt * BLOCK_SIZE : null,
    width, widthMetres: width * BLOCK_SIZE,
    // Both axes, because "three metres one way and twenty the other" is a
    // corridor and "twelve by twelve" is a room, and the narrower number
    // alone cannot tell them apart.
    widthX, widthZ,
    amenities,
    venue: venue ? { key: venue.key, name: venue.name || venue.suggestedName || venue.sportName } : null,
    view,
    score,
    verdict: verdictFor(score),
    notes: spotNotes({ zdef, cover, width, amenities, view }),
  };
}

/** "a, b and c" - the way a person would say a list. */
function list(items) {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/** A gateway is a wall you can walk through, so it does not close a route. */
function isDoorway(rec) {
  const t = PROP_BY_ID[rec.typeId];
  return t?.key === 'wall_gate';
}

function verdictFor(score) {
  if (score >= 82) return 'Excellent';
  if (score >= 68) return 'Good';
  if (score >= 52) return 'Adequate';
  if (score >= 36) return 'Poor';
  return 'Unacceptable';
}

/** The one or two things actually wrong with this spot, in plain words. */
function spotNotes({ zdef, cover, width, amenities, view }) {
  const out = [];
  if (view && view.quality < RESTRICTED_BELOW) {
    out.push(view.blockedBy
      ? `Restricted view — ${view.blockedBy} is in the way.`
      : 'Restricted view of the field from here.');
  }
  if (width <= 2) out.push(`Only ${width * BLOCK_SIZE}m of clear width. A crowd would not pass here.`);
  else if (width <= 3) out.push(`${width * BLOCK_SIZE}m wide — tight once it is busy.`);
  const missing = amenities.filter((a) => a.poor && a.distance === null);
  const distant = amenities.filter((a) => a.poor && a.distance !== null);
  if (distant.length) {
    out.push('A long way from ' + list(distant.map((a) => `${a.label.toLowerCase()} (${a.metres}m)`)) + '.');
  }
  if (missing.length) {
    out.push('Nothing on the plot for ' + list(missing.map((a) => a.label.toLowerCase())) + '.');
  }
  if (!cover && zdef && (zdef.group === 'spectator' || zdef.group === 'facility')) {
    out.push('Open to the weather.');
  }
  if (!out.length) out.push('Nothing wrong with this spot.');
  return out;
}

/**
 * How far every point on the plot is from the nearest restroom, food stand,
 * exit and medical room - one array per amenity, in blocks.
 *
 * The report runs every time the player takes a step, so this cannot be a
 * search: a spiral outward from the player would touch a hundred thousand
 * columns for the "no medical room anywhere" answer, sixty times a second. A
 * chamfer distance transform does the whole plot in two passes over the
 * footprint and then every lookup is one array read.
 *
 * Chamfer weights 3/4 approximate euclidean distance to within about 6%,
 * which is well inside the precision of "the loos are forty metres away".
 */
export function amenityFields(world) {
  const size = world.size;
  const keys = AMENITIES.map((a) => a.key);
  const ids = keys.map((k) => zoneId(k));
  const fields = keys.map(() => new Float32Array(size * size).fill(INF));

  // Sources: any column carrying that zone at any height.
  world.forEachChunk((chunk) => {
    const ox = chunk.cx * CHUNK_X, oz = chunk.cz * CHUNK_Z;
    for (let y = 0; y < CHUNK_Y; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        for (let x = 0; x < CHUNK_X; x++) {
          const zid = chunk.zones[Chunk.index(x, y, z)];
          if (zid === 0) continue;
          const k = ids.indexOf(zid);
          if (k < 0) continue;
          const wx = ox + x, wz = oz + z;
          if (wx >= size || wz >= size) continue;
          fields[k][wz * size + wx] = 0;
        }
      }
    }
  });

  for (const f of fields) chamfer(f, size);
  const out = new Map();
  keys.forEach((k, i) => out.set(k, fields[i]));
  return out;
}

const INF = 1e9;

function chamfer(f, size) {
  const D = 3, DD = 4;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = z * size + x;
      let v = f[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, f[i - 1] + D);
      if (z > 0) v = Math.min(v, f[i - size] + D);
      if (x > 0 && z > 0) v = Math.min(v, f[i - size - 1] + DD);
      if (x < size - 1 && z > 0) v = Math.min(v, f[i - size + 1] + DD);
      f[i] = v;
    }
  }
  for (let z = size - 1; z >= 0; z--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = z * size + x;
      let v = f[i];
      if (v === 0) continue;
      if (x < size - 1) v = Math.min(v, f[i + 1] + D);
      if (z < size - 1) v = Math.min(v, f[i + size] + D);
      if (x < size - 1 && z < size - 1) v = Math.min(v, f[i + size + 1] + DD);
      if (x > 0 && z < size - 1) v = Math.min(v, f[i + size - 1] + DD);
      f[i] = v;
    }
  }
  for (let i = 0; i < f.length; i++) f[i] = f[i] >= INF ? INF : f[i] / D;
}

function fieldAt(fields, key, x, z, size) {
  const f = fields?.get(key);
  if (!f) return null;
  if (x < 0 || z < 0 || x >= size || z >= size) return null;
  const v = f[z * size + x];
  return v >= INF ? null : v;
}

function nearestVenue(venues, x, z) {
  let best = null, bestD = Infinity;
  for (const v of venues) {
    const d = Math.hypot(x - v.centre.x, z - v.centre.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best && bestD <= (best.reach || 60) * 1.6 ? best : null;
}

// ===========================================================================
// WHAT YOU CAN SEE
// ===========================================================================

/** Points across the playing surface to test against, as fractions of the field. */
const TARGETS = [
  [0, 0], [-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8],
  [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7],
];

/**
 * Can you see the game from here?
 *
 * Nine points across the field, a clear line to each or not. This is the
 * honest version of the sightline number: the analyser estimates it from the
 * geometry of the bowl, and this walks the actual voxels between an eye and
 * the grass, so a pillar in the wrong place shows up as what it is.
 */
export function sightline(world, pos, venue) {
  // The eye goes in the first clear voxel at or above the one asked about, so
  // this answers the same question whether it is handed the seat itself or the
  // space a person standing on it occupies. Starting inside a solid voxel
  // would have the ray hit that voxel at zero distance and report every seat
  // in the ground as blind.
  let eye = pos.y;
  while (eye < pos.y + 3 && world.isSolid(pos.x, eye, pos.z)) eye++;
  const origin = {
    x: (pos.x + 0.5) * BLOCK_SIZE,
    y: (eye + 0.75) * BLOCK_SIZE,
    z: (pos.z + 0.5) * BLOCK_SIZE,
  };
  const fieldY = (Math.max(0, venue.field.y) + 1.2) * BLOCK_SIZE;
  const halfW = Math.max(4, (venue.field.w || 20) / 2);
  const halfD = Math.max(4, (venue.field.d || 20) / 2);

  let clear = 0;
  const blockers = new Map();
  for (const [fx, fz] of TARGETS) {
    const tx = (venue.centre.x + fx * halfW + 0.5) * BLOCK_SIZE;
    const tz = (venue.centre.z + fz * halfD + 0.5) * BLOCK_SIZE;
    const dx = tx - origin.x, dy = fieldY - origin.y, dz = tz - origin.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) { clear++; continue; }
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    // Stop a hair short of the grass, or the pitch surface itself counts as
    // an obstruction and every seat in the ground reads as blind.
    const hit = raycastVoxel(world, origin, dir, len - BLOCK_SIZE * 0.9);
    if (!hit || hit.dist >= len - BLOCK_SIZE) { clear++; continue; }
    const name = block(hit.block).name;
    blockers.set(name, (blockers.get(name) || 0) + 1);
  }

  const quality = clear / TARGETS.length;
  let worst = null, worstN = 0;
  for (const [name, n] of blockers) if (n > worstN) { worstN = n; worst = name; }
  const distance = Math.hypot(
    (pos.x - venue.centre.x) * BLOCK_SIZE,
    (pos.y - Math.max(0, venue.field.y)) * BLOCK_SIZE,
    (pos.z - venue.centre.z) * BLOCK_SIZE);

  return {
    quality,
    clear,
    total: TARGETS.length,
    blockedBy: worst,
    distance: Math.round(distance),
    // Too far away is its own problem: a clear view of a postage stamp is
    // still a bad seat.
    grade: gradeSeat(quality, distance),
    restricted: quality < RESTRICTED_BELOW,
  };
}

function gradeSeat(quality, metres) {
  if (quality < 0.34) return 'Restricted';
  if (quality < RESTRICTED_BELOW) return 'Partially blocked';
  if (metres > 190) return 'Distant';
  if (quality < 0.8) return 'Slightly obstructed';
  if (metres < 45) return 'Premium';
  if (metres < 110) return 'Very good';
  return 'Good';
}

/**
 * A seat, examined. Reads from the seat's own eye height rather than the
 * player's, so the answer is the same whoever is standing there.
 */
export function seatReport(world, seat, venue) {
  if (!venue) return null;
  const view = sightline(world, { x: seat.x, y: seat.y, z: seat.z }, venue);
  const zid = world.getZone(seat.x, seat.y, seat.z);
  const zdef = zid ? ZONE_BY_ID[zid] : null;
  const id = world.getBlock(seat.x, seat.y, seat.z);
  return {
    ...view,
    x: seat.x, y: seat.y, z: seat.z,
    zone: zdef ? zdef.name : null,
    vip: !!zdef?.vip,
    material: id === AIR ? null : block(id).name,
    height: Math.round((seat.y - Math.max(0, venue.field.y)) * BLOCK_SIZE),
  };
}

// ===========================================================================
// PROGRESS AND REWARD
// ===========================================================================

/** Where the walk stands right now. */
export function walkProgress(state, stops) {
  const w = state.siteWalk;
  if (!w) return { visited: 0, total: stops.length, pct: 0, done: false, next: stops[0] || null };
  const seen = new Set(w.visited);
  const remaining = stops.filter((s) => !seen.has(s.id));
  return {
    visited: stops.length - remaining.length,
    total: stops.length,
    pct: stops.length ? (stops.length - remaining.length) / stops.length : 0,
    done: stops.length > 0 && remaining.length === 0,
    next: remaining[0] || null,
    remaining,
  };
}

/** Reaching a stop. Returns null if it was already ticked off. */
export function reachStop(state, stop) {
  const w = state.siteWalk;
  if (!w || w.visited.includes(stop.id)) return null;
  w.visited.push(stop.id);
  return stop;
}

/** Record a seat the player looked at, so a bad one can be found again. */
export function recordSeat(state, report) {
  const w = state.siteWalk;
  if (!w || !report) return;
  w.seatsChecked++;
  const key = `${report.x},${report.y},${report.z}`;
  if (report.restricted) {
    if (!w.restricted.some((r) => `${r.x},${r.y},${r.z}` === key)) {
      w.restricted.push({ x: report.x, y: report.y, z: report.z, quality: report.quality, blockedBy: report.blockedBy });
      if (w.restricted.length > 80) w.restricted.shift();
    }
  } else {
    // A seat that used to be blocked and now is not has been fixed.
    w.restricted = w.restricted.filter((r) => `${r.x},${r.y},${r.z}` !== key);
    if (!w.best || report.quality > w.best.quality
        || (report.quality === w.best.quality && report.distance < w.best.distance)) {
      w.best = { x: report.x, y: report.y, z: report.z, quality: report.quality, distance: report.distance, grade: report.grade };
    }
  }
}

/**
 * Finish a walk. The certificate is what a real inspection produces: it is
 * worth something, it runs out, and it cannot be had twice in a row without
 * doing the rounds again.
 */
export function completeWalk(state, stops) {
  const w = state.siteWalk;
  if (!w) return null;
  const p = walkProgress(state, stops);
  if (!p.done || stops.length < 3) return null;

  const fresh = w.completedDay >= 0 && state.day - w.completedDay < CERTIFICATE_DAYS;
  w.completedDay = state.day;
  w.walks++;
  w.visited = [];   // the next walk starts again

  // Scaled by how much there was to inspect, so a two-hut complex does not
  // earn what a forty-stop stadium does.
  //
  // The ceiling is deliberately just under the reputation a complex loses to
  // drift over the same forty days. Keeping the place inspected slows the
  // slide; it is maintenance, not growth. Growth is hosting events, which is
  // the thing that should be worth doing.
  const scale = Math.min(1, stops.length / 12);
  const reputation = fresh ? 0 : +(0.6 + scale * 1.6).toFixed(2);
  return {
    stops: stops.length,
    reputation,
    repeat: fresh,
    expires: state.day + CERTIFICATE_DAYS,
    restricted: w.restricted.length,
  };
}

/** True while the last inspection is still in date. */
export function certificateActive(state) {
  const w = state.siteWalk;
  return !!w && w.completedDay >= 0 && state.day - w.completedDay < CERTIFICATE_DAYS;
}

/**
 * What an in-date inspection is worth to the venue, in the same shape the
 * programme effects use so the analyser needs no new channel. Staff who know
 * an inspector has just been round keep the place tidier; that is all this is.
 */
export function inspectionLift(state) {
  if (!certificateActive(state)) return null;
  return { rating: { safety: 2, comfort: 1 } };
}

/** Merge rating lifts without mutating either side. */
export function combineLift(base, extra) {
  if (!extra) return base || null;
  const out = { ...(base || {}), rating: { ...((base && base.rating) || {}) } };
  for (const [k, v] of Object.entries(extra.rating || {})) {
    out.rating[k] = (out.rating[k] || 0) + v;
  }
  return out;
}

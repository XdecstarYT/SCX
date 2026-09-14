import { VoxelWorld, Chunk } from '../voxel/world.js';
import { createLeagueState } from '../core/league.js';
import { createHostingState } from '../core/hosting.js';
import { createProgrammeState } from '../core/programmes.js';
import { createSiteWalkState } from '../core/siteWalk.js';
import { createPitchState } from '../core/groundskeeping.js';
import { createSafetyState } from '../core/safety.js';
import { createTicketState } from '../core/ticketing.js';
import { PropLayer } from '../voxel/props.js';
import { SAVE_VERSION } from '../core/gameState.js';
import { createHotbarState } from '../ui/hotbar.js';

/**
 * Chunks are stored run-length encoded, not as raw geometry. A 16x64x16 chunk
 * of mostly-air is a few dozen bytes; a fully built one still compresses hard
 * because voxel worlds are enormously repetitive.
 *
 * Wire format per run: [value, countLow, countHigh] -> base64.
 */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    out.push(v, n & 255, (n >> 8) & 255);
    i += n;
  }
  return bytesToB64(Uint8Array.from(out));
}

export function rleDecode(b64, length) {
  const bytes = b64ToBytes(b64);
  const out = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const v = bytes[i];
    const n = bytes[i + 1] | (bytes[i + 2] << 8);
    if (v !== 0) out.fill(v, p, Math.min(length, p + n));
    p += n;
    if (p >= length) break;
  }
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Fields that are recomputed from the world and must never be persisted. */
const DERIVED_KEYS = [
  'derived', 'complex', 'empire', 'utilityStatus', 'utilityFactors', 'utilityUpkeep',
  'powerCapacity', 'powerDemand', 'powerDeficit',
  'staffBonus', 'sponsorPerEvent', 'sponsorBonuses',
  'buildCostMult', 'salaryMult', 'wearFactor', 'capacityPenalty', 'tempSeats',
  'sponsorLocked', 'transitShare', 'bestCapacityHint',
];

export function serializeState(state) {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (DERIVED_KEYS.includes(k)) continue;
    out[k] = v;
  }
  out.version = SAVE_VERSION;
  out.lastPlayed = Date.now();
  return out;
}

export function serializeWorld(world) {
  const chunks = [];
  world.forEachChunk((c) => {
    if (c.nonEmpty === 0) return;
    chunks.push({
      cx: c.cx, cz: c.cz,
      b: rleEncode(c.blocks),
      z: rleEncode(c.zones),
    });
  });
  return { size: world.size, chunks, props: world.props.serialize() };
}

export function deserializeWorld(data) {
  const world = new VoxelWorld(data.size);
  const volume = 16 * 64 * 16;
  for (const rec of data.chunks) {
    const chunk = world.getChunk(rec.cx, rec.cz, true);
    chunk.blocks.set(rleDecode(rec.b, volume));
    chunk.zones.set(rleDecode(rec.z, volume));
    let n = 0, maxY = 0;
    for (let i = 0; i < volume; i++) {
      const id = chunk.blocks[i];
      if (id) {
        n++;
        world.blockCounts.set(id, (world.blockCounts.get(id) || 0) + 1);
        const y = Math.floor(i / (16 * 16));
        if (y > maxY) maxY = y;
      }
      const z = chunk.zones[i];
      if (z) world.zoneCounts.set(z, (world.zoneCounts.get(z) || 0) + 1);
    }
    chunk.nonEmpty = n;
    chunk.maxY = maxY;
    chunk.dirty = true;
    chunk.zoneDirty = true;
    world.dirtyChunks.add(chunk);
  }
  world.props = PropLayer.deserialize(data.props);
  world.version++;
  return world;
}

/**
 * @param worlds a single VoxelWorld, or a Map of siteId -> VoxelWorld.
 * Single-world saves keep the old `world` field so older saves stay readable
 * and newer ones stay small when there is only one site.
 */
export function makeSave(state, worlds, meta = {}) {
  const map = worlds instanceof Map ? worlds : new Map([[state.activeSite || 'site1', worlds]]);
  const sites = {};
  for (const [id, w] of map) sites[id] = serializeWorld(w);

  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    meta: {
      complexName: state.complexName,
      day: state.day,
      cash: Math.round(state.cash),
      reputation: Math.round(state.reputation.venue),
      capacity: state.derived?.bestCapacity || 0,
      sites: map.size,
      ...meta,
    },
    state: serializeState(state),
    // Kept for single-site saves and for anything that only reads `world`.
    world: sites[state.activeSite || 'site1'] || Object.values(sites)[0],
    sites,
  };
}

/** Rebuild every site's world from a save. */
export function deserializeWorlds(save) {
  const out = new Map();
  if (save.sites) {
    for (const [id, data] of Object.entries(save.sites)) out.set(id, deserializeWorld(data));
  } else if (save.world) {
    out.set(save.state?.activeSite || 'site1', deserializeWorld(save.world));
  }
  return out;
}

/** Migrate older saves forward. Never throw on an old save. */
export function migrate(save) {
  if (!save || !save.state) throw new Error('Save file is not readable.');
  const s = save.state;
  s.settings = { sound: true, music: false, reducedMotion: false, highContrast: false,
    largeText: false, sensitivity: 1, invertY: false, showFps: false, autosave: true,
    handedness: 'right', shadows: 'auto', ...(s.settings || {}) };
  s.modifiers = s.modifiers || [];
  s.venues = s.venues || { registered: [] };
  s.events = { board: [], scheduled: [], history: [], lastGeneratedDay: 0, ...(s.events || {}) };
  s.finance = { ledger: [], months: [], monthAccum: {}, lastMonth: 0, ...(s.finance || {}) };
  s.tutorial = { step: 0, dismissed: false, seen: {}, ...(s.tutorial || {}) };
  s.organiserHistory = s.organiserHistory || {};
  // Goal tracking postdates the first saves. An older save re-earns whatever
  // it has already achieved on the next tick rather than being told it has
  // lost anything, which is why this starts empty rather than being inferred.
  s.goalsDone = Array.isArray(s.goalsDone) ? s.goalsDone : [];
  // Leagues postdate the first saves. An older complex simply has no tenants
  // yet and starts its first season on the day it is loaded.
  if (!s.league || !s.league.standings) {
    s.league = createLeagueState(s.seed ?? 1);
    s.league.startedDay = s.day || 1;
  }
  s.league.tenants = s.league.tenants || [];
  s.league.honours = s.league.honours || [];
  s.league.results = s.league.results || [];
  // Hosting rights postdate leagues. An older complex has simply never staged
  // anything: its honours board starts empty rather than being invented, and
  // the offers it can see are computed from the calendar on the next tick.
  if (!s.hosting || !Array.isArray(s.hosting.active)) s.hosting = createHostingState();
  s.hosting.history = s.hosting.history || [];
  s.hosting.records = s.hosting.records || {};
  s.hosting.declined = s.hosting.declined || [];
  // Matchday settings postdate the first saves. An older complex keeps
  // resolving its days the way it always has until the player says otherwise.
  s.settings = s.settings || {};
  if (s.settings.liveMatchday === undefined) s.settings.liveMatchday = false;
  if (s.settings.matchdayFrom === undefined) s.settings.matchdayFrom = 2;
  // Pitches too: an older complex simply has surfaces in perfect condition
  // that nothing has been installed under yet.
  if (!s.pitches || !s.pitches.byVenue) s.pitches = createPitchState();
  if (!s.tickets || !s.tickets.season) s.tickets = createTicketState();
  // An older complex has no certificates. Rather than shut every existing
  // ground overnight, a save that predates the system is grandfathered: each
  // venue is treated as certified until its first renewal falls due.
  if (!s.safety || !s.safety.byVenue) {
    s.safety = createSafetyState();
    s.safety.grandfatherUntil = s.day + 90;
  }
  // The site walk postdates the first saves too. An older complex has simply
  // never been walked, so it starts with no stops visited and no certificate.
  if (!s.siteWalk || !Array.isArray(s.siteWalk.visited)) s.siteWalk = createSiteWalkState();
  s.siteWalk.restricted = s.siteWalk.restricted || [];
  // Programmes postdate the first saves. An older complex has simply never
  // run one; nothing it has already earned is affected.
  if (!s.programmes || !Array.isArray(s.programmes.active)) s.programmes = createProgrammeState();
  s.programmes.completed = s.programmes.completed || [];
  s.programmes.effects = { ...createProgrammeState().effects, ...(s.programmes.effects || {}) };
  s.scenario = s.scenario || null;
  s.landLocked = !!s.landLocked;
  s.legacyShown = !!s.legacyShown;
  s.construction = s.construction || [];
  // Projects predate multi-site building; anything without a site belongs to
  // the site the save was written on.
  for (const p of s.construction) p.siteId = p.siteId || s.activeSite || 'site1';
  if (!s.hotbar || !Array.isArray(s.hotbar.blocks)) s.hotbar = createHotbarState();
  s.hotbar.zones = Array.isArray(s.hotbar.zones) ? s.hotbar.zones : createHotbarState().zones;
  s.hotbar.active = s.hotbar.active ?? 0;
  // Saves written before the multi-site update carry land and utilities at the
  // top level; fold them into a single starting site.
  if (!Array.isArray(s.sites) || s.sites.length === 0) {
    s.sites = [{
      id: 'site1',
      name: s.complexName || 'Riverside',
      cityId: 'meridian',
      landTier: s.landTier || 0,
      boughtDay: 1,
      utilities: s.utilities || { power: -1, water: -1, sewer: -1, data: -1, climate: -1 },
    }];
  }
  s.activeSite = s.activeSite || s.sites[0].id;
  for (const site of s.sites) {
    site.utilities = site.utilities || { power: -1, water: -1, sewer: -1, data: -1, climate: -1 };
    site.landTier = site.landTier ?? 0;
    site.cityId = site.cityId || 'meridian';
  }
  for (const r of s.venues.registered) r.siteId = r.siteId || s.sites[0].id;
  delete s.landTier;
  delete s.utilities;
  s.achievements = s.achievements || [];
  s.version = SAVE_VERSION;
  return save;
}

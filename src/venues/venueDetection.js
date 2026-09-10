import { CHUNK_Y, SEATS_PER_VOXEL, VIP_SEATS_PER_VOXEL, VOXELS_PER_CAR } from '../core/constants.js';
import { zone, zoneId, ZONE_BY_ID, SPORT_ZONES } from '../data/zones.js';
import { block, blockId } from '../data/blocks.js';
import { scanWorld, components, largestRectangle, roofCoverage, lightsNear } from './analysis.js';
import { rateVenue, eventTier } from './ratings.js';

const VENUE_TYPES = {
  football:   'Football Stadium',
  soccer:     'Soccer Stadium',
  rugby:      'Rugby Stadium',
  cricket:    'Cricket Ground',
  basketball: 'Basketball Arena',
  tennis:     'Tennis Centre',
  athletics:  'Athletics Stadium',
  swimming:   'Aquatic Centre',
  ice:        'Ice Arena',
  combat:     'Combat Sports Arena',
};

const SCALE_PREFIX = [
  { max: 1500,   name: 'Community' },
  { max: 7000,   name: 'Local' },
  { max: 20000,  name: 'Regional' },
  { max: 45000,  name: 'National' },
  { max: Infinity, name: 'International' },
];

/** Zones counted as "support facilities" and attached to the nearest venue. */
const FACILITY_ZONES = [
  'restroom', 'concession', 'restaurant', 'retail', 'hospitality', 'locker',
  'medical', 'media', 'broadcast', 'office', 'security', 'storage', 'staff',
  'training', 'concourse', 'stairs', 'entrance', 'exit', 'fanzone',
];

const emptyFacilities = () => {
  const f = {};
  for (const k of FACILITY_ZONES) f[k] = 0;
  f.entranceGates = 0;
  f.exitGates = 0;
  return f;
};

/**
 * Read the world and return every venue the geometry implies, plus
 * complex-wide infrastructure figures.
 */
export function detectVenues(world, opts = {}) {
  const powerCapacity = opts.powerCapacity ?? Infinity;
  const { zoneInfo, stats, size } = scanWorld(world);
  const get = (key) => zoneInfo.get(zoneId(key)) || null;
  const countOf = (key) => (get(key)?.count ?? 0);

  // ------------------------------------------------------ complex-wide infra
  const parkingVox = countOf('parking');
  const vipParkVox = countOf('parking_vip');
  const busVox = countOf('parking_bus');
  const transitVox = countOf('transit');
  const roadVox = countOf('road');

  const complex = {
    parkingCars: Math.floor(parkingVox / VOXELS_PER_CAR),
    vipParkingCars: Math.floor(vipParkVox / VOXELS_PER_CAR),
    busBays: Math.floor(busVox / 8),
    roadVoxels: roadVox,
    transitVoxels: transitVox,
    // A transit stop that moves half a 60,000 crowd is a station, not a bus
    // shelter, so it has to be built at a believable size.
    transitShare: Math.min(0.45, transitVox * 0.004 + Math.floor(busVox / 8) * 0.01),
    powerDemand: stats.power,
    totalBlocks: stats.blocks,
    maintenance: stats.maintenance,
    passiveRevenue: stats.revenue,
    screens: stats.screens,
    adverts: stats.adverts,
    floodlights: stats.floodlights.length,
    maxHeight: stats.maxY,
    landSize: size,
  };
  complex.powerCapacity = powerCapacity;
  complex.powerDeficit = Math.max(0, complex.powerDemand - powerCapacity);

  // Roads must actually reach the parking for it to be usable. Without any
  // road network some drivers still find their way in, so the floor is 0.3
  // rather than nothing.
  complex.roadServiceRatio = complex.parkingCars > 0
    ? Math.max(0.3, Math.min(1, roadVox / Math.max(60, complex.parkingCars * 0.25)))
    : 1;

  // --------------------------------------------------------- find the fields
  const fields = [];
  for (const sz of SPORT_ZONES) {
    const info = zoneInfo.get(sz.id);
    if (!info || info.count < 12) continue;
    for (const comp of components(info.foot, size, 12)) {
      const rect = largestRectangle(comp, size);
      const reg = sz.regulation;
      const w = Math.max(rect.w, rect.h);
      const d = Math.min(rect.w, rect.h);
      const minW = Math.max(reg.w, reg.d), minD = Math.min(reg.w, reg.d);
      const idealW = Math.max(reg.ideal.w, reg.ideal.d), idealD = Math.min(reg.ideal.w, reg.ideal.d);
      const regulation = Math.min(1, Math.min(w / minW, d / minD)) >= 1
        ? Math.min(1, 0.85 + 0.15 * Math.min(1, Math.min(w / idealW, d / idealD)))
        : Math.min(w / minW, d / minD);

      // Is the rectangle actually laid on an approved surface material?
      let surfaceOk = false;
      const probe = [];
      for (let i = 0; i < comp.cells.length; i += Math.max(1, Math.floor(comp.cells.length / 40))) probe.push(comp.cells[i]);
      let okCount = 0;
      const okIds = new Set(sz.surfaces.map(blockId));
      for (const c of probe) {
        const x = c % size, z = (c / size) | 0;
        const y = topZonedY(world, x, z, sz.id);
        if (y >= 0 && okIds.has(world.getBlock(x, y, z))) okCount++;
      }
      surfaceOk = probe.length > 0 && okCount / probe.length >= 0.7;

      fields.push({
        sport: sz.sport, sportName: sz.name, zoneKey: sz.key,
        comp, rect, w, d, minW, minD, regulation: Math.min(1, regulation),
        surfaceOk, area: comp.area,
        cx: comp.cx, cz: comp.cz,
        y: topZonedY(world, Math.round(comp.cx), Math.round(comp.cz), sz.id),
      });
    }
  }
  fields.sort((a, b) => b.area - a.area);

  // ------------------------------------------------- allocate zones to fields
  const venues = fields.map((f, i) => ({
    index: i,
    sport: f.sport,
    sportName: f.sportName,
    field: {
      w: f.w, d: f.d, minW: f.minW, minD: f.minD,
      regulation: f.regulation, surfaceOk: f.surfaceOk,
      area: f.area, y: f.y,
    },
    centre: { x: f.cx, z: f.cz },
    reach: Math.max(46, Math.hypot(f.w, f.d) * 1.9),
    capacity: { seated: 0, vip: 0, standing: 0, total: 0 },
    seatVoxels: 0, vipVoxels: 0, standVoxels: 0,
    facilities: emptyFacilities(),
    footprintVoxels: f.area,
    appearance: 0, screens: 0,
    lighting: 0,
    seatRoofCoverage: 0,
    heightAboveField: 0,
    structuralWarnings: 0,
    _fieldComp: f.comp,
  }));

  if (venues.length === 0) {
    return { venues: [], complex, orphan: orphanSummary(zoneInfo), stats };
  }

  const nearest = (cx, cz) => {
    let best = null, bestD = Infinity;
    for (const v of venues) {
      const d = Math.hypot(cx - v.centre.x, cz - v.centre.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return bestD <= best.reach ? best : null;
  };

  const assign = (zoneKey, fn) => {
    const info = get(zoneKey);
    if (!info) return;
    for (const comp of components(info.foot, size, 1)) {
      const v = nearest(comp.cx, comp.cz);
      if (v) fn(v, comp);
    }
  };

  // Seating -> capacity
  assign('seating', (v, c) => { v.seatVoxels += c.area; v.footprintVoxels += c.area; });
  assign('seating_vip', (v, c) => { v.vipVoxels += c.area; v.footprintVoxels += c.area; });
  assign('seating_standing', (v, c) => { v.standVoxels += c.area; v.footprintVoxels += c.area; });

  // Facilities -> counted voxels, and gate counts for entrances/exits
  for (const key of FACILITY_ZONES) {
    assign(key, (v, c) => {
      v.facilities[key] += c.area;
      v.footprintVoxels += c.area;
      if (key === 'entrance') v.facilities.entranceGates++;
      if (key === 'exit') v.facilities.exitGates++;
    });
  }

  // Multi-level seating counts the full 3D voxel count, not just the footprint,
  // because a two-tier stand occupies the same ground plan twice.
  applyVolumetricSeating(zoneInfo, venues, size);

  // --------------------------------------------------------- derived numbers
  const totalCap = venues.reduce((s, v) => s + v.seatVoxels * SEATS_PER_VOXEL, 0) || 1;

  for (const v of venues) {
    v.capacity.seated = Math.round(v.seatVoxels * SEATS_PER_VOXEL);
    v.capacity.vip = Math.round(v.vipVoxels * VIP_SEATS_PER_VOXEL);
    v.capacity.standing = Math.round(v.standVoxels * 9);
    v.capacity.total = v.capacity.seated + v.capacity.vip + v.capacity.standing;

    v.lighting = lightsNear(stats.floodlights, v.centre.x, v.centre.z, v.reach);
    v.screens = countNear(world, stats, v, 'screen');
    v.appearance = appearanceNear(world, v, size);
    v.roofCoverage = roofCoverage(world, v._fieldComp, size, Math.max(0, v.field.y));
    v.seatRoofCoverage = seatingRoofCoverage(world, zoneInfo, v, size);
    v.indoor = v.roofCoverage > 0.7;
    v.heightAboveField = Math.max(0, maxHeightNear(world, v, size) - Math.max(0, v.field.y));
    v.structuralWarnings = structuralCheck(world, v, size);

    // Parking is a complex asset shared in proportion to demand.
    const share = (v.seatVoxels * SEATS_PER_VOXEL) / totalCap;
    v.parkingCars = Math.round(complex.parkingCars * share * complex.roadServiceRatio);
    v.vipParkingCars = Math.round(complex.vipParkingCars * share);

    v.ratings = rateVenue(v, complex);
    v.tier = eventTier(v);
    v.type = classify(v);
    v.suggestedName = suggestName(v, opts.complexName);
    v.key = `${v.sport}:${Math.round(v.centre.x / 8)}:${Math.round(v.centre.z / 8)}`;
    delete v._fieldComp;
  }

  venues.sort((a, b) => b.capacity.total - a.capacity.total || b.ratings.overall - a.ratings.overall);
  return { venues, complex, orphan: orphanSummary(zoneInfo), stats };
}

// ---------------------------------------------------------------- helpers

function topZonedY(world, x, z, zid) {
  for (let y = CHUNK_Y - 1; y >= 0; y--) if (world.getZone(x, y, z) === zid) return y;
  return -1;
}

/**
 * A stand built four voxels high is four times the seats of its footprint.
 * Re-count seating zones volumetrically and fold that into each venue.
 */
function applyVolumetricSeating(zoneInfo, venues, size) {
  const keys = [
    ['seating', 'seatVoxels'],
    ['seating_vip', 'vipVoxels'],
    ['seating_standing', 'standVoxels'],
  ];
  for (const [zk, prop] of keys) {
    const info = zoneInfo.get(zoneId(zk));
    if (!info) continue;
    const footArea = info.foot.reduce((s, v) => s + v, 0);
    if (footArea === 0) continue;
    const multiplier = info.count / footArea; // average stack height
    for (const v of venues) v[prop] = Math.round(v[prop] * multiplier);
  }
}

function countNear(world, stats, v, key) {
  const id = blockId(key);
  if (!id) return 0;
  let n = 0;
  const r = v.reach;
  const x0 = Math.max(0, Math.floor(v.centre.x - r)), x1 = Math.min(world.size - 1, Math.ceil(v.centre.x + r));
  const z0 = Math.max(0, Math.floor(v.centre.z - r)), z1 = Math.min(world.size - 1, Math.ceil(v.centre.z + r));
  for (let x = x0; x <= x1; x += 2) {
    for (let z = z0; z <= z1; z += 2) {
      const top = world.heightAt(x, z);
      for (let y = Math.max(0, top - 24); y <= top; y++) if (world.getBlock(x, y, z) === id) n++;
    }
  }
  return n * 4; // sampled every other voxel in x and z
}

function appearanceNear(world, v, size) {
  let score = 0;
  const r = v.reach;
  const x0 = Math.max(0, Math.floor(v.centre.x - r)), x1 = Math.min(size - 1, Math.ceil(v.centre.x + r));
  const z0 = Math.max(0, Math.floor(v.centre.z - r)), z1 = Math.min(size - 1, Math.ceil(v.centre.z + r));
  const step = Math.max(1, Math.floor((x1 - x0) / 64));
  let sampled = 0;
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      const top = world.heightAt(x, z);
      if (top < 0) continue;
      sampled++;
      for (let y = Math.max(0, top - 30); y <= top; y++) {
        const id = world.getBlock(x, y, z);
        if (id) score += block(id).appearance;
      }
    }
  }
  return score * step * step;
}

function maxHeightNear(world, v, size) {
  let max = 0;
  const r = v.reach;
  const step = Math.max(1, Math.floor(r / 24));
  for (let x = Math.max(0, Math.floor(v.centre.x - r)); x < Math.min(size, v.centre.x + r); x += step) {
    for (let z = Math.max(0, Math.floor(v.centre.z - r)); z < Math.min(size, v.centre.z + r); z += step) {
      const h = world.heightAt(x, z);
      if (h > max) max = h;
    }
  }
  return max;
}

function seatingRoofCoverage(world, zoneInfo, v, size) {
  const info = zoneInfo.get(zoneId('seating'));
  if (!info) return 0;
  let sampled = 0, covered = 0;
  const r = v.reach;
  for (let x = Math.max(0, Math.floor(v.centre.x - r)); x < Math.min(size, v.centre.x + r); x += 2) {
    for (let z = Math.max(0, Math.floor(v.centre.z - r)); z < Math.min(size, v.centre.z + r); z += 2) {
      if (!info.foot[z * size + x]) continue;
      const top = world.heightAt(x, z);
      sampled++;
      for (let y = top + 1; y < CHUNK_Y; y++) {
        if (world.isSolid(x, y, z)) { covered++; break; }
      }
    }
  }
  return sampled ? covered / sampled : 0;
}

/**
 * Simplified structural rule: a roof voxel must find support (a solid block
 * with real support strength) within its material's span, measured
 * horizontally at any level below. No collapse - just a flagged warning.
 */
function structuralCheck(world, v, size) {
  let warnings = 0;
  const r = v.reach;
  const step = 3;
  for (let x = Math.max(0, Math.floor(v.centre.x - r)); x < Math.min(size, v.centre.x + r); x += step) {
    for (let z = Math.max(0, Math.floor(v.centre.z - r)); z < Math.min(size, v.centre.z + r); z += step) {
      const top = world.heightAt(x, z);
      if (top < 2) continue;
      const b = block(world.getBlock(x, top, z));
      if (b.category !== 'roof') continue;
      if (!hasSupport(world, x, top, z, b.spans)) warnings++;
    }
  }
  return warnings;
}

function hasSupport(world, x, y, z, span) {
  for (let dx = -span; dx <= span; dx++) {
    for (let dz = -span; dz <= span; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > span) continue;
      for (let dy = 1; dy <= 4; dy++) {
        const id = world.getBlock(x + dx, y - dy, z + dz);
        if (id && block(id).support >= 8) return true;
      }
    }
  }
  return false;
}

function classify(v) {
  const base = VENUE_TYPES[v.sport] || 'Sports Venue';
  if (v.capacity.total < 300) {
    return v.facilities.training > 20 ? 'Training Centre' : 'Community Sports Ground';
  }
  if (v.indoor && v.capacity.total >= 3000) {
    if (['basketball', 'ice', 'combat'].includes(v.sport)) return base;
    return `Indoor ${base}`;
  }
  const prefix = SCALE_PREFIX.find((p) => v.capacity.total < p.max).name;
  return `${prefix} ${base}`;
}

function suggestName(v, complexName) {
  const stem = complexName || 'Riverside';
  const base = VENUE_TYPES[v.sport] || 'Sports Venue';
  if (v.capacity.total < 300) return `${stem} ${v.sportName}`;
  return `${stem} ${base}`;
}

/** Zones the player painted that no venue claimed - useful feedback. */
function orphanSummary(zoneInfo) {
  const out = [];
  for (const [zid, info] of zoneInfo) {
    const z = ZONE_BY_ID[zid];
    if (!z) continue;
    out.push({ key: z.key, name: z.name, group: z.group, count: info.count });
  }
  return out;
}

export { VENUE_TYPES };

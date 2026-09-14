import * as THREE from 'three';
import { BLOCK_SIZE, CHUNK_Y } from '../core/constants.js';
import { zoneId, ZONE_BY_ID } from '../data/zones.js';
import { AIR, block } from '../data/blocks.js';
import { makeRng } from '../core/rng.js';

/**
 * ---------------------------------------------------------------------------
 * THE COMPLEX, WITH PEOPLE IN IT
 * ---------------------------------------------------------------------------
 * A sports complex with nobody in it is a model, not a game. Crowds used to
 * exist for the twenty-six seconds of the event-day cinematic and then vanish,
 * which meant that for essentially the whole of play you were looking at an
 * empty car park with a stadium on it.
 *
 * So this runs all the time. People walk the concourse, cars come and go from
 * the car park, athletes train on the pitch when nothing else is happening,
 * and on a matchday the stands fill up. It is deliberately not an agent
 * simulation with pathfinding: everyone walks cell to cell across the surfaces
 * you actually zoned, biased toward somewhere they want to be, which at a
 * distance is indistinguishable from purpose and costs almost nothing.
 *
 * Everything is instanced - three draw calls for the whole population.
 */

const MAX_PEOPLE = 900;
const MAX_CARS = 260;
const MAX_CROWD = 2600;

/** Surfaces a person will walk on. */
const WALK_ZONES = [
  'concourse', 'entrance', 'exit', 'fanzone', 'stairs', 'concession', 'restaurant',
  'retail', 'restroom', 'box_office', 'medical', 'media', 'office', 'staff',
  'security', 'hospitality', 'creche', 'gym_public', 'physio', 'transit',
];
/** ...and surfaces they will walk on even without a zone painted on them. */
const WALK_BLOCKS = new Set([
  'floor_conc', 'paving', 'paving_light', 'paving_dark', 'tile', 'boardwalk',
  'concourse', 'asphalt', 'gravel',
]);
/** Walkable, but also where you queue - jobs care about these separately. */
const GATE_ZONES = ['entrance', 'exit', 'box_office'];
const ROAD_ZONES = ['road', 'road_main', 'road_service', 'road_bus', 'road_vip', 'road_emergency'];
const PARK_ZONES = ['parking', 'parking_vip', 'parking_bus', 'parking_staff', 'parking_taxi'];
const SEAT_ZONES = ['seating', 'seating_vip', 'seating_standing', 'luxury_box'];
/** How many standable decks to take from one column - seats, tier two, concourse. */
const DECKS_PER_COLUMN = 3;
/** Levels a walker may step up or down in one cell. One step, like stairs. */
const CLIMB = 1;

/** Clothes. Enough variety that a crowd does not read as one object repeated. */
const SHIRTS = [
  0xd8443f, 0x2c6fd8, 0xf0f2f4, 0x2fd08a, 0xd8b13a, 0x9a6bf0,
  0x3a4048, 0xe8a93f, 0x49c5c9, 0xd85f9a, 0x6c7783, 0x8a6a44,
];
const CAR_COLOURS = [
  0xb8bdc4, 0x2a323c, 0xd8443f, 0x24407a, 0xe8e2d0, 0x4a525c, 0x2f6b39, 0x8a6a44,
];

export class WorldLife {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.enabled = true;
    this.stamp = -1;

    this.walk = [];        // packed walkable cells: [x, y, z] triples
    this.walkSet = new Set();
    this.roads = [];
    this.parks = [];
    this.seats = [];
    this.bays = [];
    this.gates = [];
    this.seatOrder = new Uint32Array(0);
    this.pitches = [];     // [{ x, y, z, w, d }] sport surfaces, for training

    this.people = makeInstanced(scene, personGeometry(), MAX_PEOPLE);
    this.cars = makeInstanced(scene, carGeometry(), MAX_CARS);
    this.crowd = makeInstanced(scene, crowdGeometry(), MAX_CROWD);

    this.peopleData = [];
    this.carData = [];
    this.crowdData = [];

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this.rng = makeRng(1234);
    this.t = 0;
  }

  setWorld(world) { this.world = world; this.stamp = -1; }

  setEnabled(on) {
    this.enabled = on;
    for (const m of [this.people, this.cars, this.crowd]) m.visible = on;
  }

  /**
   * Re-read the world. Only done when the build actually changed: this is a
   * full scan, and it is what tells everybody where they are allowed to be.
   */
  rebuild(analysis) {
    const w = this.world;
    if (!w) return;
    const walkIds = new Set(WALK_ZONES.map(zoneId).filter(Boolean));
    const roadIds = new Set(ROAD_ZONES.map(zoneId).filter(Boolean));
    const parkIds = new Set(PARK_ZONES.map(zoneId).filter(Boolean));
    const seatIds = new Set(SEAT_ZONES.map(zoneId).filter(Boolean));
    const gateIds = new Set(GATE_ZONES.map(zoneId).filter(Boolean));

    this.walk = []; this.roads = []; this.parks = []; this.seats = []; this.bays = []; this.gates = [];
    this.walkSet = new Set();

    // Walk every column, not just the top of it. The obvious version of this
    // took `heightAt` and classified that one voxel - which is wrong the
    // moment anything has a roof on it. A covered stand's top voxel is the
    // canopy, so the seats underneath it were invisible and the ground was
    // still empty on a matchday; a sheltered concourse had the same problem.
    // So collect every standable deck in the column instead: solid, with air
    // directly above it. A raked stand has one per column, a two-tier stand
    // has two, and the concourse beneath them is the third.
    for (let x = 0; x < w.size; x++) {
      for (let z = 0; z < w.size; z++) {
        const top = w.heightAt(x, z);
        if (top < 0) continue;
        let above = AIR;           // what sits directly over the voxel at y
        let found = 0;
        for (let y = top; y >= 0 && found < DECKS_PER_COLUMN; y--) {
          const id = w.getBlock(x, y, z);
          const standable = id !== AIR && above === AIR;
          above = id;
          if (!standable) continue;
          found++;
          const zid = w.getZone(x, y, z);
          if (seatIds.has(zid)) { this.seats.push(x, y + 1, z); continue; }
          if (roadIds.has(zid)) { this.roads.push(x, y + 1, z); continue; }
          if (parkIds.has(zid)) { this.parks.push(x, y + 1, z); continue; }
          if (walkIds.has(zid) || (zid === 0 && WALK_BLOCKS.has(block(id).key))) {
            this.walk.push(x, y + 1, z);
            this.walkSet.add(key(x, z));
            // A turnstile is walkable and is also the one place a queue can
            // form, so it goes in both lists rather than getting its own scan.
            if (gateIds.has(zid)) this.gates.push(x, y + 1, z);
          }
        }
      }
    }

    // Playing surfaces, so somebody can be training on them.
    this.pitches = (analysis?.venues || []).map((v) => ({
      x: v.centre.x, y: Math.max(0, v.field?.y ?? 0) + 1, z: v.centre.z,
      w: Math.max(6, (v.field?.w || 20) * 0.42), d: Math.max(4, (v.field?.d || 14) * 0.42),
    }));

    // A shuffled seat order, so partial crowds scatter through the ground
    // instead of clustering, and no seat is ever handed out twice.
    const seatCount = this.seats.length / 3;
    this.seatOrder = new Uint32Array(seatCount);
    for (let i = 0; i < seatCount; i++) this.seatOrder[i] = i;
    for (let i = seatCount - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const t = this.seatOrder[i]; this.seatOrder[i] = this.seatOrder[j]; this.seatOrder[j] = t;
    }

    // Parking bays, thinned into rows with an aisle between them. Filling
    // every single bay reads as a scrapyard; leaving a gap every third row
    // reads as a car park.
    this.bays = [];
    for (let i = 0; i < this.parks.length; i += 3) {
      const px = this.parks[i], pz = this.parks[i + 2];
      if ((px % 3 === 2) || (pz % 3 === 2)) continue;
      this.bays.push(px, this.parks[i + 1], pz);
    }

    this._index = null;
    this.peopleData.length = 0;
    this.carData.length = 0;
    this.crowdData.length = 0;
  }

  /** A random walkable cell, as an index into `walk`. */
  randomWalk() {
    if (!this.walk.length) return -1;
    return (this.rng.int(0, this.walk.length / 3 - 1)) * 3;
  }

  /**
   * One frame.
   *
   * `ctx.population` is 0..1 - how busy the place should look. That is what
   * ties the crowd to the game rather than to the clock: a complex with
   * nothing on and nothing built is quiet, and a cup tie is heaving.
   */
  update(dt, ctx = {}) {
    if (!this.enabled || !this.world) return;
    this.t += dt;

    const daylight = 1 - (ctx.night ?? 0);
    // Nobody is about at four in the morning, and a shut ground is quiet.
    const activity = Math.max(0.05, (ctx.population ?? 0.25) * (0.25 + daylight * 0.75));

    this.updatePeople(dt, activity, ctx);
    this.updateCars(dt, activity, ctx);
    this.updateCrowd(dt, ctx);

    // People are unlit impostors, so they have to be dimmed by hand or they
    // glow in the dark like a row of lightbulbs.
    const dim = 0.28 + daylight * 0.72;
    for (const mesh of [this.people, this.cars, this.crowd]) {
      mesh.material.color.setScalar(dim);
    }
  }

  // ---------------------------------------------------------------- walkers
  updatePeople(dt, activity, ctx) {
    const want = Math.min(MAX_PEOPLE, Math.round(
      Math.min(this.walk.length / 3, 420) * activity));
    const arr = this.peopleData;

    while (arr.length < want) {
      const at = this.randomWalk();
      if (at < 0) break;
      arr.push({
        from: at, to: at, t: 1, speed: 0.8 + this.rng.range(0, 0.7),
        goal: this.randomWalk(), colour: this.rng.pick(SHIRTS),
        phase: this.rng.range(0, 6.28), height: 0.9 + this.rng.range(0, 0.22),
      });
    }
    if (arr.length > want) arr.length = want;

    const W = this.walk;
    let n = 0;
    for (const a of arr) {
      a.t += dt * a.speed * 0.55;
      while (a.t >= 1) {
        a.t -= 1;
        a.from = a.to;
        a.to = this.stepToward(a.from, a.goal);
        if (a.from === a.goal || a.to === a.from) a.goal = this.randomWalk();
      }
      const fx = W[a.from], fy = W[a.from + 1], fz = W[a.from + 2];
      const tx = W[a.to], ty = W[a.to + 1], tz = W[a.to + 2];
      const k = a.t;
      const x = (fx + (tx - fx) * k + 0.5) * BLOCK_SIZE;
      const y = (fy + (ty - fy) * k) * BLOCK_SIZE;
      const z = (fz + (fz === tz ? 0 : (tz - fz) * k) + 0.5) * BLOCK_SIZE;
      // A slight bob, which is most of what makes a box read as walking.
      const bob = Math.abs(Math.sin(this.t * 5.5 * a.speed + a.phase)) * 0.07;
      this._p.set(x, y + bob, z);
      this._q.setFromAxisAngle(UP, Math.atan2(tx - fx, tz - fz));
      this._s.set(1, a.height, 1);
      this._m.compose(this._p, this._q, this._s);
      this.people.setMatrixAt(n, this._m);
      this.people.setColorAt(n, this._c.setHex(a.colour));
      n++;
    }
    this.people.count = n;
    this.people.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
  }

  /** One step from `at` toward `goal`, staying on walkable ground. */
  stepToward(at, goal) {
    const W = this.walk;
    if (goal < 0 || at < 0) return at;
    const x = W[at], y = W[at + 1], z = W[at + 2];
    const gx = W[goal], gz = W[goal + 2];
    const dx = Math.sign(gx - x), dz = Math.sign(gz - z);
    // Try the axis with the most ground to cover first, then the other, then
    // give up and stand still - which is also a thing people do.
    const tries = Math.abs(gx - x) > Math.abs(gz - z)
      ? [[dx, 0], [0, dz], [0, dz ? -dz : 1]]
      : [[0, dz], [dx, 0], [dx ? -dx : 1, 0]];
    for (const [sx, sz] of tries) {
      if (!sx && !sz) continue;
      const idx = this.walkIndex(x + sx, z + sz, y);
      if (idx >= 0) return idx;
    }
    return at;
  }

  /**
   * The walkable cell at this column nearest the height you are standing at.
   * A column can hold several decks now, so "is this walkable" is not enough
   * on its own - stepping off a concourse roof into the concourse below it
   * would look like falling through the floor. One level of climb is allowed
   * so that a flight of steps still works.
   */
  walkIndex(x, z, y = null) {
    if (!this.walkSet.has(key(x, z))) return -1;
    // The set answers "is this walkable"; the array answers "where". A map
    // from one to the other is built lazily the first time it is needed.
    if (!this._index) {
      this._index = new Map();
      for (let i = 0; i < this.walk.length; i += 3) {
        const k = key(this.walk[i], this.walk[i + 2]);
        const at = this._index.get(k);
        if (at === undefined) this._index.set(k, i);
        else if (Array.isArray(at)) at.push(i);
        else this._index.set(k, [at, i]);
      }
    }
    const v = this._index.get(key(x, z));
    if (v === undefined) return -1;
    if (!Array.isArray(v)) {
      return (y === null || Math.abs(this.walk[v + 1] - y) <= CLIMB) ? v : -1;
    }
    let best = -1, gap = Infinity;
    for (const i of v) {
      const d = y === null ? 0 : Math.abs(this.walk[i + 1] - y);
      if (d < gap) { gap = d; best = i; }
    }
    return gap <= CLIMB ? best : -1;
  }

  // ------------------------------------------------------------------- cars
  updateCars(dt, activity, ctx) {
    const lanes = this.roads.length / 3;
    const bays = this.bays.length / 3;
    const want = Math.min(MAX_CARS, Math.round(Math.min(lanes, 140) * activity * 0.7));
    const arr = this.carData;

    while (arr.length < want && lanes > 0) {
      const at = this.rng.int(0, lanes - 1) * 3;
      arr.push({
        at, t: this.rng.range(0, 1), speed: 1.4 + this.rng.range(0, 1.1),
        colour: this.rng.pick(CAR_COLOURS), dir: this.rng.chance(0.5) ? 1 : -1,
      });
    }
    if (arr.length > want) arr.length = want;

    const R = this.roads;
    let n = 0;
    for (const c of arr) {
      c.t += dt * c.speed * 0.4;
      while (c.t >= 1) {
        c.t -= 1;
        // Roads are a list, not a graph. Driving to the numerically adjacent
        // cell follows the lane most of the time because the scan emits them
        // in column order, and a jump reads as a different car.
        c.at = (c.at + c.dir * 3 + R.length) % R.length;
      }
      const x = R[c.at], y = R[c.at + 1], z = R[c.at + 2];
      const nx = R[(c.at + c.dir * 3 + R.length) % R.length];
      const nz = R[(c.at + c.dir * 3 + R.length) % R.length + 2];
      const far = Math.abs(nx - x) > 2 || Math.abs(nz - z) > 2;
      const k = far ? 0 : c.t;
      this._p.set((x + (far ? 0 : (nx - x) * k) + 0.5) * BLOCK_SIZE, y * BLOCK_SIZE,
        (z + (far ? 0 : (nz - z) * k) + 0.5) * BLOCK_SIZE);
      this._q.setFromAxisAngle(UP, far ? 0 : Math.atan2(nx - x, nz - z));
      this._s.set(1, 1, 1);
      this._m.compose(this._p, this._q, this._s);
      this.cars.setMatrixAt(n, this._m);
      this.cars.setColorAt(n, this._c.setHex(c.colour));
      n++;
    }

    // Parked cars: static, and they make a car park look used. Colour comes
    // from the bay rather than the loop counter - cycling the palette in
    // order laid down stripes of red, blue, white across the tarmac.
    const B = this.bays;
    const parked = Math.min(MAX_CARS - n, Math.round(Math.min(bays, 180) * activity));
    const step = Math.max(3, Math.floor(B.length / 3 / Math.max(1, parked)) * 3);
    for (let i = 0, at = 0; i < parked && at < B.length; i++, at += step) {
      const px = B[at], pz = B[at + 2];
      this._p.set((px + 0.5) * BLOCK_SIZE, B[at + 1] * BLOCK_SIZE, (pz + 0.5) * BLOCK_SIZE);
      // Rows face each other, nose to nose, the way a car park actually fills.
      this._q.setFromAxisAngle(UP, (Math.floor(pz / 3) % 2) * Math.PI);
      this._m.compose(this._p, this._q, this._s.set(1, 1, 1));
      this.cars.setMatrixAt(n, this._m);
      this.cars.setColorAt(n, this._c.setHex(CAR_COLOURS[hash2(px, pz) % CAR_COLOURS.length]));
      n++;
    }
    this.cars.count = n;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
  }

  // -------------------------------------------------------------- the stand
  updateCrowd(dt, ctx) {
    const fill = ctx.stands ?? 0;
    const seats = this.seats.length / 3;
    const want = Math.min(MAX_CROWD, Math.round(Math.min(seats, MAX_CROWD) * fill));
    let n = 0;
    const order = this.seatOrder;
    for (let i = 0; i < want; i++) {
      // Spread the occupied seats through the stand rather than filling one
      // end of it, so a half-full ground looks half full everywhere. A
      // shuffle rather than a stride: striding lands every nth seat, which
      // from the touchline is a visible lattice of gaps, and it is only
      // guaranteed not to seat two people in one seat while the stride and
      // the seat count stay coprime. A permutation owes nothing to either.
      const at = order[i] * 3;
      const x = this.seats[at], y = this.seats[at + 1], z = this.seats[at + 2];
      // Everyone sways a little, and the stand ripples rather than pulsing.
      const sway = Math.sin(this.t * 2.1 + x * 0.7 + z * 0.4) * 0.06;
      this._p.set((x + 0.5) * BLOCK_SIZE, y * BLOCK_SIZE + sway, (z + 0.5) * BLOCK_SIZE);
      this._q.identity();
      this._m.compose(this._p, this._q, this._s.set(1, 1, 1));
      this.crowd.setMatrixAt(n, this._m);
      this.crowd.setColorAt(n, this._c.setHex(SHIRTS[(x * 7 + z * 13) % SHIRTS.length]));
      n++;
    }
    this.crowd.count = n;
    this.crowd.instanceMatrix.needsUpdate = true;
    if (this.crowd.instanceColor) this.crowd.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.people, this.cars, this.crowd]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const key = (x, z) => x * 1024 + z;
/** A stable scatter from a grid position - same cell, same answer, always. */
const hash2 = (x, z) => { let h = (x * 374761393 + z * 668265263) ^ 0x5bf03635; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };

function makeInstanced(scene, geo, max) {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** A person: a body, a head and a hint of shoulders. Three boxes, one draw. */
function personGeometry() {
  const parts = [
    [0, 0.62, 0, 0.44, 0.86, 0.28, 1],      // torso, takes the instance colour
    [0, 1.22, 0, 0.26, 0.26, 0.26, 0.72],   // head, a shade darker
    [0, 0.2, 0, 0.34, 0.44, 0.24, 0.45],    // legs
  ];
  return boxKit(parts);
}

function carGeometry() {
  return boxKit([
    [0, 0.42, 0, 1.86, 0.72, 4.2, 1],
    [0, 0.95, -0.2, 1.6, 0.62, 2.1, 0.8],
    [0, 0.16, 1.5, 1.7, 0.24, 0.3, 0.35],
  ]);
}

/** A seated spectator: head and shoulders, which is all you see in a stand. */
function crowdGeometry() {
  return boxKit([
    [0, 0.3, 0, 0.5, 0.6, 0.42, 1],
    [0, 0.72, 0, 0.28, 0.28, 0.28, 0.74],
  ]);
}

/**
 * Merge a list of boxes into one geometry, with a per-part brightness baked
 * into the vertex colours so one instance colour still gives a figure with
 * darker legs and a slightly darker head.
 */
function boxKit(parts) {
  const geos = [];
  for (const [x, y, z, w, h, d, shade] of parts) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  // Merge by hand: mergeGeometries lives in an addon this project does not pull in.
  const total = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const idx = [];
  let v = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, v * 3);
    col.set(g.attributes.color.array, v * 3);
    for (const i of g.index.array) idx.push(i + v);
    v += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

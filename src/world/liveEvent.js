import * as THREE from 'three';
import { BLOCK_SIZE, CHUNK_Y } from '../core/constants.js';
import { zoneId } from '../data/zones.js';
import { makeRng } from '../core/rng.js';

const MAX_FANS = 1600;
const MAX_CARS = 420;

/**
 * Event-day visuals.
 *
 * Crowds are instanced impostors, not characters: one box per instance, all in
 * a single draw call, positions lerped along an arrival path. 1,600 of them
 * read as a full stadium at any sane camera distance and cost almost nothing.
 */
export class LiveEventShow {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.active = false;
    this.t = 0;
    this.duration = 26;
    this.report = null;
    this.onPhase = null;
    this.phase = 'idle';

    const fanGeo = new THREE.BoxGeometry(0.62, 1.7, 0.62);
    fanGeo.translate(0, 0.85, 0);
    whiteVertexColors(fanGeo);
    this.fans = new THREE.InstancedMesh(
      fanGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      MAX_FANS);
    this.fans.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fans.count = 0;
    this.fans.frustumCulled = false;
    this.fans.visible = false;
    scene.add(this.fans);

    const carGeo = new THREE.BoxGeometry(1.9, 1.4, 4.3);
    carGeo.translate(0, 0.7, 0);
    whiteVertexColors(carGeo);
    this.cars = new THREE.InstancedMesh(
      carGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      MAX_CARS);
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cars.count = 0;
    this.cars.frustumCulled = false;
    this.cars.visible = false;
    scene.add(this.cars);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.fanData = [];
    this.carData = [];
  }

  /** Sample positions of voxels carrying one of `zoneKeys`, capped at `max`. */
  sampleZone(zoneKeys, max, rng, near = null, radius = Infinity) {
    const ids = new Set(zoneKeys.map(zoneId));
    const found = [];
    const w = this.world;
    const step = Math.max(1, Math.floor(w.size / 190));
    for (let x = 0; x < w.size; x += step) {
      for (let z = 0; z < w.size; z += step) {
        if (near && Math.hypot(x - near.x, z - near.z) > radius) continue;
        const top = w.heightAt(x, z);
        if (top < 0) continue;
        for (let y = top; y >= Math.max(0, top - 26); y--) {
          const zid = w.getZone(x, y, z);
          if (ids.has(zid)) { found.push(x, y, z); break; }
        }
      }
    }
    if (found.length / 3 <= max) return found;
    // Even thinning keeps the crowd spread across the whole stand.
    const out = [];
    const total = found.length / 3;
    const stride = total / max;
    for (let i = 0; i < max; i++) {
      const j = Math.floor(i * stride) * 3;
      out.push(found[j], found[j + 1], found[j + 2]);
    }
    return out;
  }

  /**
   * Build the show for one event report against one venue.
   * @returns {boolean} false when there is nothing to show
   */
  begin(report, venue, seed = 1) {
    const rng = makeRng(seed);
    const near = venue ? venue.centre : null;
    const radius = venue ? venue.reach * 1.4 : Infinity;

    const seats = this.sampleZone(['seating', 'seating_vip', 'seating_standing'], MAX_FANS, rng, near, radius);
    if (seats.length === 0) return false;

    const gates = this.sampleZone(['entrance'], 40, rng, near, radius);
    const lots = this.sampleZone(['parking', 'parking_vip', 'parking_bus'], MAX_CARS, rng);

    // How full the stand looks is the actual simulated fill rate.
    const fill = Math.max(0.05, Math.min(1, report ? report.fill : 0.8));
    const seatCount = Math.floor((seats.length / 3) * fill);

    this.fanData.length = 0;
    const colour = new THREE.Color();
    for (let i = 0; i < seatCount; i++) {
      const j = i * 3;
      const sx = (seats[j] + 0.5) * BLOCK_SIZE + (rng() - 0.5) * 1.2;
      const sy = (seats[j + 1] + 1) * BLOCK_SIZE;
      const sz = (seats[j + 2] + 0.5) * BLOCK_SIZE + (rng() - 0.5) * 1.2;

      let gx = sx, gz = sz;
      if (gates.length) {
        const g = Math.floor(rng() * (gates.length / 3)) * 3;
        gx = (gates[g] + 0.5) * BLOCK_SIZE;
        gz = (gates[g + 2] + 0.5) * BLOCK_SIZE;
      }
      const gy = (this.world.heightAt(seats[j], seats[j + 2]) + 1) * BLOCK_SIZE;

      this.fanData.push({
        sx, sy, sz, gx, gy: gy, gz,
        delay: rng() * 0.42,
        bob: rng() * Math.PI * 2,
      });
      // Two team colours plus neutrals, so the crowd reads as a crowd.
      const roll = rng();
      if (roll < 0.34) colour.setHSL(0.6, 0.55, 0.45 + rng() * 0.2);
      else if (roll < 0.62) colour.setHSL(0.02, 0.6, 0.42 + rng() * 0.2);
      else colour.setHSL(rng(), 0.18, 0.45 + rng() * 0.28);
      this.fans.setColorAt(i, colour);
    }
    this.fans.count = seatCount;
    if (this.fans.instanceColor) this.fans.instanceColor.needsUpdate = true;

    this.carData.length = 0;
    const carCount = Math.min(MAX_CARS, Math.floor((lots.length / 3) * Math.min(1, fill * 1.05)));
    for (let i = 0; i < carCount; i++) {
      const j = i * 3;
      this.carData.push({
        x: (lots[j] + 0.5) * BLOCK_SIZE,
        y: (lots[j + 1] + 1) * BLOCK_SIZE,
        z: (lots[j + 2] + 0.5) * BLOCK_SIZE,
        rot: rng() < 0.5 ? 0 : Math.PI / 2,
        delay: rng() * 0.3,
      });
      colour.setHSL(rng(), 0.12, 0.25 + rng() * 0.5);
      this.cars.setColorAt(i, colour);
    }
    this.cars.count = carCount;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;

    this.report = report;
    this.venue = venue;
    this.active = true;
    this.t = 0;
    this.fans.visible = true;
    this.cars.visible = true;
    this.setPhase('arriving');
    return true;
  }

  setPhase(p) {
    if (this.phase === p) return;
    this.phase = p;
    this.onPhase?.(p);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const p = Math.min(1, this.t / this.duration);

    if (p < 0.34) this.setPhase('arriving');
    else if (p < 0.82) this.setPhase('underway');
    else if (p < 1) this.setPhase('leaving');
    else { this.setPhase('done'); this.stop(); return; }

    // Fans: gate -> seat during arrival, seated (with a bob) during play,
    // seat -> gate during departure.
    for (let i = 0; i < this.fans.count; i++) {
      const f = this.fanData[i];
      let k;
      if (p < 0.34) {
        k = clamp01((p / 0.34 - f.delay) / (1 - f.delay));
      } else if (p < 0.82) {
        k = 1;
      } else {
        k = 1 - clamp01(((p - 0.82) / 0.18 - f.delay) / (1 - f.delay));
      }
      const ease = k * k * (3 - 2 * k);
      const x = f.gx + (f.sx - f.gx) * ease;
      const z = f.gz + (f.sz - f.gz) * ease;
      const baseY = f.gy + (f.sy - f.gy) * ease;
      const bob = p >= 0.34 && p < 0.82
        ? Math.sin(this.t * 2.4 + f.bob) * 0.12 * (this.report?.satisfaction ?? 60) / 100
        : Math.abs(Math.sin(this.t * 7 + f.bob)) * 0.16 * (1 - Math.abs(ease - 0.5) * 2);
      this._v.set(x, baseY + bob, z);
      this._m.compose(this._v, IDENT, this._s);
      this.fans.setMatrixAt(i, this._m);
    }
    this.fans.instanceMatrix.needsUpdate = true;

    // Cars fill the lots during arrival and empty at the end.
    let visibleCars = 0;
    for (let i = 0; i < this.carData.length; i++) {
      const c = this.carData[i];
      const arrived = p > c.delay * 0.9 && p < 0.94;
      if (!arrived) {
        this._v.set(0, -9999, 0);
      } else {
        this._v.set(c.x, c.y, c.z);
        visibleCars++;
      }
      this._q.setFromAxisAngle(UP, c.rot);
      this._m.compose(this._v, this._q, this._s);
      this.cars.setMatrixAt(i, this._m);
    }
    this.cars.instanceMatrix.needsUpdate = true;
  }

  get progress() { return this.active ? Math.min(1, this.t / this.duration) : 0; }

  skip() { this.t = this.duration; }

  stop() {
    this.active = false;
    this.fans.visible = false;
    this.cars.visible = false;
    this.fans.count = 0;
    this.cars.count = 0;
    this.setPhase('idle');
  }
}

/**
 * Three only multiplies `instanceColor` into an existing vertex colour, so a
 * geometry used with `vertexColors: true` needs a white base attribute -
 * without it every instance renders black.
 */
function whiteVertexColors(geo) {
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
}

const IDENT = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

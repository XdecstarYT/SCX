import * as THREE from 'three';
import { BLOCK_SIZE } from '../core/constants.js';

/**
 * Construction feedback: the dust and spark of a block landing, and the flash
 * of the cube that just appeared.
 *
 * One instanced mesh for every particle in flight and one for every flash, so
 * a fifty-block sweep costs two draw calls rather than fifty objects. The
 * whole system switches off under the reduced-motion setting.
 */
const MAX_PARTICLES = 360;
const MAX_FLASHES = 48;
const GRAVITY = -22;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;

    const pgeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    this.pMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    this.particles = new THREE.InstancedMesh(pgeo, this.pMat, MAX_PARTICLES);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.frustumCulled = false;
    this.particles.count = 0;
    this.particles.renderOrder = 5;
    scene.add(this.particles);

    const fgeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    // Flashes share one opacity: a per-instance alpha would mean a custom
    // shader for something a quarter-second pop does not need.
    this.fMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    this.flashes = new THREE.InstancedMesh(fgeo, this.fMat, MAX_FLASHES);
    this.flashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flashes.frustumCulled = false;
    this.flashes.count = 0;
    this.flashes.renderOrder = 5;
    scene.add(this.flashes);

    // Fixed pools: allocating during a build sweep is exactly the wrong time.
    this.pool = Array.from({ length: MAX_PARTICLES }, () => ({
      live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1,
      col: new THREE.Color(),
    }));
    this.flashPool = Array.from({ length: MAX_FLASHES }, () => ({
      live: false, x: 0, y: 0, z: 0, life: 0, max: 1, grow: 1, col: new THREE.Color(),
    }));
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      for (const p of this.pool) p.live = false;
      for (const f of this.flashPool) f.live = false;
      this.particles.count = 0;
      this.flashes.count = 0;
    }
  }

  /** Chips of debris thrown off a placement or a demolition. */
  burst(vx, vy, vz, colour, count = 8, opts = {}) {
    if (!this.enabled) return;
    const cx = (vx + 0.5) * BLOCK_SIZE, cy = (vy + 0.5) * BLOCK_SIZE, cz = (vz + 0.5) * BLOCK_SIZE;
    const spread = opts.spread ?? 4.2;
    const up = opts.up ?? 5.2;
    let made = 0;
    for (const p of this.pool) {
      if (p.live) continue;
      p.live = true;
      p.x = cx + (Math.random() - 0.5) * BLOCK_SIZE * 0.8;
      p.y = cy + (Math.random() - 0.5) * BLOCK_SIZE * 0.8;
      p.z = cz + (Math.random() - 0.5) * BLOCK_SIZE * 0.8;
      p.vx = (Math.random() - 0.5) * spread;
      p.vz = (Math.random() - 0.5) * spread;
      p.vy = Math.random() * up + 1;
      p.max = 0.45 + Math.random() * 0.4;
      p.life = p.max;
      p.size = (opts.size ?? 1) * (0.6 + Math.random() * 0.8);
      p.col.setHex(colour);
      if (++made >= count) break;
    }
  }

  /** A brief bright cube where something just appeared or vanished. */
  flash(vx, vy, vz, colour, opts = {}) {
    if (!this.enabled) return;
    for (const f of this.flashPool) {
      if (f.live) continue;
      f.live = true;
      f.x = (vx + 0.5) * BLOCK_SIZE;
      f.y = (vy + 0.5) * BLOCK_SIZE;
      f.z = (vz + 0.5) * BLOCK_SIZE;
      f.max = opts.duration ?? 0.26;
      f.life = f.max;
      f.grow = opts.grow ?? 0.55;
      f.scale = opts.scale ?? 1;
      f.col.setHex(colour);
      return;
    }
  }

  /** Everything that happens when one block goes down. */
  placed(vx, vy, vz, colour) {
    this.flash(vx, vy, vz, 0xffffff, { duration: 0.2, grow: 0.4 });
    this.burst(vx, vy, vz, colour, 5, { spread: 2.6, up: 3.4, size: 0.8 });
  }

  removed(vx, vy, vz, colour) {
    this.flash(vx, vy, vz, colour, { duration: 0.24, grow: 0.8 });
    this.burst(vx, vy, vz, colour, 12, { spread: 5.4, up: 6 });
  }

  /** A prop is bigger than a voxel, so its effect is scaled to match. */
  propPlaced(vx, vy, vz, colour, width = 2) {
    this.flash(vx, vy, vz, 0xffffff, { duration: 0.3, grow: 0.5, scale: Math.max(1, width * 0.7) });
    this.burst(vx, vy, vz, colour, 14, { spread: 3.6 + width, up: 5, size: 1.1 });
  }

  update(dt) {
    if (!this.enabled) return;
    let n = 0;
    for (const p of this.pool) {
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) { p.live = false; continue; }
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.life / p.max;
      this._p.set(p.x, p.y, p.z);
      this._s.setScalar(p.size * (0.3 + t * 0.9));
      this._m.compose(this._p, IDENT, this._s);
      this.particles.setMatrixAt(n, this._m);
      this.particles.setColorAt(n, p.col);
      n++;
    }
    this.particles.count = n;
    if (n > 0) {
      this.particles.instanceMatrix.needsUpdate = true;
      if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
    }

    let m = 0;
    for (const f of this.flashPool) {
      if (!f.live) continue;
      f.life -= dt;
      if (f.life <= 0) { f.live = false; continue; }
      const t = 1 - f.life / f.max;
      this._p.set(f.x, f.y, f.z);
      this._s.setScalar((f.scale || 1) * (1 + t * f.grow));
      this._m.compose(this._p, IDENT, this._s);
      this.flashes.setMatrixAt(m, this._m);
      this.flashes.setColorAt(m, f.col);
      m++;
    }
    this.flashes.count = m;
    if (m > 0) {
      this.flashes.instanceMatrix.needsUpdate = true;
      if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
    }
  }
}

const IDENT = new THREE.Quaternion();

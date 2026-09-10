import * as THREE from 'three';
import { BLOCK_SIZE, GROUND_Y, CHUNK_Y } from '../core/constants.js';

export const CAMERA_MODES = [
  { key: 'free',     name: 'Free',     icon: 'FREE', hint: 'Orbit and build at scale' },
  { key: 'first',    name: 'First',    icon: '1ST',  hint: 'Walk the venue and build up close' },
  { key: 'third',    name: 'Third',    icon: '3RD',  hint: 'Follow your character from behind' },
  { key: 'overview', name: 'Overview', icon: 'MAP',  hint: 'See the whole complex at once' },
];

const PLAYER_HW = 0.42;      // half width in metres
const PLAYER_H = 1.78;
const EYE = 1.62;
const GRAVITY = 26;
const JUMP_V = 8.4;
const WALK = 8.5;
const RUN = 16;
const FLY = 34;

/**
 * One rig, four cameras. Free/Overview orbit a focus point; First/Third share
 * an avatar with gravity and voxel collision so the player can genuinely walk
 * around the complex they built.
 */
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'free';

    const c = (world.size * BLOCK_SIZE) / 2;
    this.focus = new THREE.Vector3(c, GROUND_Y * BLOCK_SIZE, c);
    this.dist = 190;
    this.yaw = -0.6;
    this.pitch = 0.72;

    this.pos = new THREE.Vector3(c, (GROUND_Y + 2) * BLOCK_SIZE, c + 40);
    this.vel = new THREE.Vector3();
    this.fYaw = Math.PI;
    this.fPitch = 0;
    this.onGround = false;
    this.fly = false;

    this.sensitivity = 1;
    this.invertY = false;
    this._tmp = new THREE.Vector3();
  }

  setWorld(world) { this.world = world; }

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if ((mode === 'first' || mode === 'third') && (prev === 'free' || prev === 'overview')) {
      // Drop the avatar onto the ground under the current focus point.
      const vx = Math.floor(this.focus.x / BLOCK_SIZE);
      const vz = Math.floor(this.focus.z / BLOCK_SIZE);
      const h = this.world.heightAt(clampI(vx, 0, this.world.size - 1), clampI(vz, 0, this.world.size - 1));
      this.pos.set(this.focus.x, (h + 2) * BLOCK_SIZE, this.focus.z);
      this.vel.set(0, 0, 0);
      this.fYaw = this.yaw + Math.PI;
      this.fPitch = -0.15;
    }
    if ((mode === 'free' || mode === 'overview') && (prev === 'first' || prev === 'third')) {
      this.focus.copy(this.pos);
      this.yaw = this.fYaw - Math.PI;
      if (mode === 'overview') { this.dist = this.world.size * BLOCK_SIZE * 0.75; this.pitch = 0.95; }
      else this.dist = 90;
    }
    if (mode === 'overview') {
      this.dist = Math.max(this.dist, this.world.size * BLOCK_SIZE * 0.62);
      this.pitch = Math.max(this.pitch, 0.8);
    }
  }

  get isWalking() { return this.mode === 'first' || this.mode === 'third'; }

  // ------------------------------------------------------------- gestures
  orbit(dx, dy) {
    const s = 0.0052 * this.sensitivity;
    if (this.isWalking) {
      this.fYaw -= dx * s;
      this.fPitch = clamp(this.fPitch + (this.invertY ? dy : -dy) * s, -1.5, 1.5);
    } else {
      this.yaw -= dx * s;
      this.pitch = clamp(this.pitch + (this.invertY ? -dy : dy) * s, 0.06, 1.52);
    }
  }

  pan(dx, dy) {
    if (this.isWalking) return;
    const scale = this.dist * 0.0022;
    const right = this._tmp.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-dx * scale);
    this.focus.add(right);
    const fwd = this._tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-dy * scale);
    this.focus.add(fwd);
    this.clampFocus();
  }

  zoom(factor) {
    if (this.isWalking) return;
    this.dist = clamp(this.dist * factor, 12, this.world.size * BLOCK_SIZE * 1.6);
  }

  clampFocus() {
    const max = this.world.size * BLOCK_SIZE;
    this.focus.x = clamp(this.focus.x, -60, max + 60);
    this.focus.z = clamp(this.focus.z, -60, max + 60);
    this.focus.y = clamp(this.focus.y, 0, CHUNK_Y * BLOCK_SIZE);
  }

  focusOn(x, y, z, dist) {
    this.focus.set(x, y, z);
    if (dist) this.dist = dist;
  }

  jump() {
    if (this.fly) { this.vel.y = FLY * 0.5; return; }
    if (this.onGround) { this.vel.y = JUMP_V; this.onGround = false; }
  }

  toggleFly() { this.fly = !this.fly; if (this.fly) this.vel.y = 0; }

  // ---------------------------------------------------------------- update
  /** @param move {x,y} normalised -1..1 from joystick or WASD */
  update(dt, move, run = false) {
    dt = Math.min(dt, 0.05);
    if (this.isWalking) this.updateWalker(dt, move, run);
    else this.updateOrbit(dt, move, run);
    this.applyCamera();
  }

  updateOrbit(dt, move, run) {
    if (move && (move.x || move.y)) {
      const speed = (run ? 150 : 62) * dt * (this.dist / 90);
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.focus.x += (move.x * c + move.y * s) * speed;
      this.focus.z += (-move.x * s + move.y * c) * speed;
      this.clampFocus();
    }
    // Keep the focus point from sinking under the terrain.
    const vx = clampI(Math.floor(this.focus.x / BLOCK_SIZE), 0, this.world.size - 1);
    const vz = clampI(Math.floor(this.focus.z / BLOCK_SIZE), 0, this.world.size - 1);
    const groundY = (this.world.heightAt(vx, vz) + 1) * BLOCK_SIZE;
    this.focus.y += (Math.max(groundY, GROUND_Y * BLOCK_SIZE) - this.focus.y) * Math.min(1, dt * 4);
  }

  updateWalker(dt, move, run) {
    const speed = this.fly ? FLY : (run ? RUN : WALK);
    const s = Math.sin(this.fYaw), c = Math.cos(this.fYaw);
    const wishX = (move.x * c - move.y * s);
    const wishZ = (-move.x * s - move.y * c);

    if (this.fly) {
      this.vel.x = wishX * speed;
      this.vel.z = wishZ * speed;
      this.vel.y *= 0.86;
      this.moveAxis('x', this.vel.x * dt);
      this.moveAxis('z', this.vel.z * dt);
      this.moveAxis('y', this.vel.y * dt);
      this.onGround = false;
      return;
    }

    const accel = this.onGround ? 46 : 14;
    this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * dt);
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -60) this.vel.y = -60;

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    const hitY = this.moveAxis('y', this.vel.y * dt);
    if (hitY) {
      this.onGround = this.vel.y < 0;
      this.vel.y = 0;
    } else if (this.vel.y < -0.2) {
      this.onGround = false;
    }

    // Auto step-up onto a single voxel ledge so stairs and stands are walkable.
    if (this.onGround && (Math.abs(this.vel.x) > 0.3 || Math.abs(this.vel.z) > 0.3)) {
      const ahead = this._tmp.set(this.vel.x, 0, this.vel.z).normalize().multiplyScalar(0.55);
      const test = this.pos.clone().add(ahead);
      if (this.collides(test) ) {
        test.y += BLOCK_SIZE;
        if (!this.collides(test)) { this.pos.y += BLOCK_SIZE * 0.999; }
      }
    }

    // Never fall out of the world.
    if (this.pos.y < -20) {
      const vx = clampI(Math.floor(this.pos.x / BLOCK_SIZE), 0, this.world.size - 1);
      const vz = clampI(Math.floor(this.pos.z / BLOCK_SIZE), 0, this.world.size - 1);
      this.pos.y = (this.world.heightAt(vx, vz) + 3) * BLOCK_SIZE;
      this.vel.set(0, 0, 0);
    }
  }

  /** Move one axis and back out on collision. Returns true if blocked. */
  moveAxis(axis, delta) {
    if (delta === 0) return false;
    const before = this.pos[axis];
    this.pos[axis] += delta;
    if (this.collides(this.pos)) { this.pos[axis] = before; return true; }
    return false;
  }

  collides(p) {
    const w = this.world;
    const x0 = Math.floor((p.x - PLAYER_HW) / BLOCK_SIZE), x1 = Math.floor((p.x + PLAYER_HW) / BLOCK_SIZE);
    const z0 = Math.floor((p.z - PLAYER_HW) / BLOCK_SIZE), z1 = Math.floor((p.z + PLAYER_HW) / BLOCK_SIZE);
    const y0 = Math.floor(p.y / BLOCK_SIZE), y1 = Math.floor((p.y + PLAYER_H) / BLOCK_SIZE);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (w.isSolid(x, y, z)) return true;
    return false;
  }

  applyCamera() {
    const cam = this.camera;
    if (this.mode === 'first') {
      cam.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(this.fYaw);
      cam.rotateX(this.fPitch);
    } else if (this.mode === 'third') {
      const boom = 9;
      const cp = Math.cos(this.fPitch), sp = Math.sin(this.fPitch);
      const target = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
      const off = new THREE.Vector3(
        Math.sin(this.fYaw) * cp * boom,
        -sp * boom + 1.6,
        Math.cos(this.fYaw) * cp * boom
      );
      cam.position.copy(target).add(off);
      cam.lookAt(target);
    } else {
      const cp = Math.cos(this.pitch);
      cam.position.set(
        this.focus.x + Math.sin(this.yaw) * cp * this.dist,
        this.focus.y + Math.sin(this.pitch) * this.dist,
        this.focus.z + Math.cos(this.yaw) * cp * this.dist
      );
      cam.lookAt(this.focus);
    }
  }

  /** Screen point -> world ray. ndc in -1..1. */
  ray(ndcX, ndcY, out = { origin: new THREE.Vector3(), dir: new THREE.Vector3() }) {
    const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera);
    out.origin.copy(this.camera.position);
    out.dir.copy(v).sub(this.camera.position).normalize();
    return out;
  }

  centreRay(out) { return this.ray(0, 0, out); }

  /** Where the player currently is, in metres. */
  get eyePosition() {
    return this.isWalking
      ? this._tmp.set(this.pos.x, this.pos.y + EYE, this.pos.z)
      : this.camera.position;
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));
export { PLAYER_HW, PLAYER_H, EYE };

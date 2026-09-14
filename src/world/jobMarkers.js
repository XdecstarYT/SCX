import * as THREE from 'three';
import { BLOCK_SIZE } from '../core/constants.js';

/**
 * ---------------------------------------------------------------------------
 * WHERE THE WORK IS
 * ---------------------------------------------------------------------------
 * A list of jobs in a menu tells you a bin has gone over. It does not tell you
 * which bin, and hunting for it across a ground you built yourself is not the
 * interesting part. So every live job gets a marker standing over it: colour
 * coded to the job, bobbing so it reads against a static world, and beating
 * faster as the deadline closes.
 *
 * One instanced mesh for the lot, and it is driven straight off the game state
 * rather than keeping its own copy - there is no second list to fall out of
 * step with the first.
 */

const MAX_MARKERS = 24;
/** Height above the ground the marker floats at, in metres. */
const HOVER = 4.5;
/** Seconds left at which a marker starts beating rather than bobbing. */
const URGENT_AT = 20;

export class JobMarkers {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;
    this.t = 0;
    const geo = new THREE.OctahedronGeometry(0.85, 0);
    // Drawn through the world on purpose. A marker whose whole job is "the
    // thing is over here" is no use buried inside the stand it is standing in,
    // and every one of these sits over something you built.
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: false, transparent: true, opacity: 0.92,
      depthWrite: false, depthTest: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_MARKERS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
  }

  setEnabled(on) {
    this.enabled = on;
    this.mesh.visible = on;
  }

  /**
   * `jobs` is the game's own live list - each entry carrying its position, its
   * definition (for the colour) and the hours it has left.
   */
  update(dt, jobs = []) {
    if (!this.enabled) return;
    this.t += dt;
    let n = 0;
    for (const j of jobs) {
      if (n >= MAX_MARKERS) break;
      const def = j.def;
      if (!def) continue;
      // Each marker keeps its own phase so a row of them does not pulse in
      // unison, which reads as a screen effect rather than as things in a place.
      const phase = j.uid * 1.7;
      const urgent = j.secondsLeft <= URGENT_AT;
      const beat = urgent ? 4.2 : 1.6;
      const bob = Math.sin(this.t * beat + phase) * (urgent ? 0.42 : 0.22);
      this._p.set(
        (j.x + 0.5) * BLOCK_SIZE,
        j.y * BLOCK_SIZE + HOVER + bob,
        (j.z + 0.5) * BLOCK_SIZE,
      );
      this._e.set(0, this.t * 1.1 + phase, 0.34);
      this._q.setFromEuler(this._e);
      // Urgent ones swell as they beat, so you can pick them out of a crowd of
      // markers without reading anything.
      const swell = urgent ? 1.15 + Math.sin(this.t * beat + phase) * 0.18 : 1;
      this._s.setScalar(swell);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this._c.setHex(def.colour ?? 0xffffff);
      if (urgent) this._c.lerp(WHITE, 0.25 + Math.sin(this.t * beat + phase) * 0.25);
      this.mesh.setColorAt(n, this._c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const WHITE = new THREE.Color(0xffffff);

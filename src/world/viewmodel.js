import * as THREE from 'three';
import { block } from '../data/blocks.js';
import { zone } from '../data/zones.js';

/**
 * The block in your hand.
 *
 * A small cube parented to the camera and drawn just off the bottom-right of
 * the near plane, the way every first-person builder does it. It is one draw
 * call and it does more for the feel of building than almost anything else on
 * screen: you can see what you are holding without looking away from the
 * world.
 */
export class HeldBlock {
  constructor(camera) {
    this.camera = camera;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.Mesh(geo, this.material);

    // Wireframe edges so a flat-coloured cube still reads as a cube.
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    this.mesh.add(this.edges);

    // Tucked into the bottom-right corner: readable at a glance, never in the
    // way of what you are aiming at.
    this.mesh.position.set(0.52, -0.44, -1.15);
    this.mesh.rotation.set(-0.34, 0.78, 0.14);
    this.mesh.scale.setScalar(0.115);
    this.mesh.renderOrder = 20;
    this.material.depthTest = false;
    this.edges.material.depthTest = false;
    this.mesh.visible = false;
    camera.add(this.mesh);

    this.bob = 0;
    this.swing = 0;
    this.baseY = -0.44;
  }

  /** Show the block (or zone colour) currently held. */
  set(kind, key) {
    const rec = kind === 'zone' ? zone(key) : block(key);
    if (!rec || !rec.color) { this.mesh.visible = false; return; }
    this.material.color.setHex(rec.color);
    this.edges.material.opacity = kind === 'zone' ? 0.6 : 0.35;
    this.mesh.visible = this.enabled !== false;
  }

  setVisible(v) {
    this.enabled = v;
    this.mesh.visible = v;
  }

  /** A small swing when you place or break something. */
  punch() { this.swing = 1; }

  update(dt, moving) {
    if (!this.mesh.visible) return;
    // Walk bob, and a swing that decays after each action.
    this.bob += dt * (moving ? 7 : 1.6);
    this.swing = Math.max(0, this.swing - dt * 5);
    const s = this.swing * this.swing;
    this.mesh.position.y = this.baseY
      + Math.sin(this.bob) * (moving ? 0.012 : 0.004)
      - s * 0.07;
    this.mesh.position.z = -1.15 + s * 0.1;
    this.mesh.rotation.x = -0.32 - s * 0.5;
  }

  dispose() {
    this.camera.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

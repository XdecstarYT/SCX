import * as THREE from 'three';
import { block } from '../data/blocks.js';
import { zone } from '../data/zones.js';
import { prop } from '../data/props.js';
import { propGeometry } from './propRenderer.js';
import { localBounds } from '../voxel/props.js';

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
    this.cubeGeo = geo;
    this.heldKind = null;

    // A second slot for equipment: the real model, shrunk into the hand, so
    // you can see which way the goal you are holding is pointing.
    this.propMesh = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false }));
    this.propMesh.visible = false;
    this.propMesh.renderOrder = 20;
    this.propMesh.position.set(0.5, -0.5, -1.2);
    this.propMesh.rotation.set(0.12, 0.9, 0);
    camera.add(this.propMesh);
    this.propKey = null;
  }

  /** Show the block, zone colour or piece of equipment currently held. */
  set(kind, key) {
    this.heldKind = kind;
    if (kind === 'prop') {
      const type = prop(key);
      if (!type) { this.hideAll(); return; }
      if (this.propKey !== key) {
        this.propKey = key;
        this.propMesh.geometry = propGeometry(type);
        const b = localBounds(type);
        const span = Math.max(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, 0.5);
        this.propMesh.scale.setScalar(0.34 / span);
      }
      this.mesh.visible = false;
      this.propMesh.visible = this.enabled !== false;
      return;
    }
    this.propMesh.visible = false;
    const rec = kind === 'zone' ? zone(key) : block(key);
    if (!rec || !rec.color) { this.mesh.visible = false; return; }
    this.material.color.setHex(rec.color);
    this.edges.material.opacity = kind === 'zone' ? 0.6 : 0.35;
    this.mesh.visible = this.enabled !== false;
  }

  hideAll() { this.mesh.visible = false; this.propMesh.visible = false; }

  setVisible(v) {
    this.enabled = v;
    if (!v) { this.hideAll(); return; }
    if (this.heldKind === 'prop') this.propMesh.visible = true;
    else this.mesh.visible = true;
  }

  /** A small swing when you place or break something. */
  punch() { this.swing = 1; }

  update(dt, moving) {
    if (this.propMesh.visible) {
      this.swing = Math.max(0, this.swing - dt * 5);
      this.bob += dt * (moving ? 7 : 1.6);
      const sp = this.swing * this.swing;
      this.propMesh.position.y = -0.5 + Math.sin(this.bob) * (moving ? 0.012 : 0.004) - sp * 0.07;
      this.propMesh.rotation.x = 0.12 - sp * 0.5;
    }
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

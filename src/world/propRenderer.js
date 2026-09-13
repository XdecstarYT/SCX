import * as THREE from 'three';
import { BLOCK_SIZE } from '../core/constants.js';
import { createVoxelMaterial } from '../voxel/renderer.js';
import { PROP_BY_ID, prop, PART_FINISH } from '../data/props.js';
import { FINISH_ID } from '../voxel/mesher.js';

/**
 * Renders the prop layer.
 *
 * Every prop type is a box kit baked once into a single BufferGeometry with
 * the same attributes the chunk mesher emits (colour, metre-scaled quadUv,
 * emissive), so equipment is lit, fogged and seamed exactly like the stadium
 * it stands in - one shared material, one draw call per type.
 */

const HALF = 0.5;

/** Build a merged, vertex-coloured geometry for one prop type. */
export function buildPropGeometry(type) {
  const pos = [], nor = [], col = [], uv = [], emis = [], ao = [], fin = [], idx = [];
  let v = 0;
  for (const part of type.parts) {
    const [cx, cy, cz, w, h, d, colour, glow = 0, finish] = part;
    // The shader packs corner occlusion as 0-3. Props are freestanding
    // objects, not voxels wedged into a corner, so they are fully open - and
    // leaving the attribute off entirely meant the shader read 0 and drew
    // every piece of equipment in the game at 38% ambient light.
    const aoValue = 3;
    const finValue = FINISH_ID[finish || PART_FINISH[colour]] || 0;
    const r = ((colour >> 16) & 255) / 255;
    const g = ((colour >> 8) & 255) / 255;
    const b = (colour & 255) / 255;
    const x0 = cx - w * HALF, x1 = cx + w * HALF;
    const y0 = cy - h * HALF, y1 = cy + h * HALF;
    const z0 = cz - d * HALF, z1 = cz + d * HALF;

    // [corners, normal, uv extents] per face.
    const faces = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], d, h],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], d, h],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], w, d],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], w, d],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], w, h],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], w, h],
    ];
    for (const [a, bb, c, e, n, su, sv] of faces) {
      for (const p of [a, bb, c, e]) {
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(r, g, b);
        emis.push(glow);
        ao.push(aoValue);
        fin.push(finValue);
      }
      uv.push(0, 0, su, 0, su, sv, 0, sv);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('quadUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('emis', new THREE.Float32BufferAttribute(emis, 1));
  geo.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  geo.setAttribute('fin', new THREE.Float32BufferAttribute(fin, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

const geoCache = new Map();
export function propGeometry(type) {
  let g = geoCache.get(type.id);
  if (!g) { g = buildPropGeometry(type); geoCache.set(type.id, g); }
  return g;
}

export class PropRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.material = createVoxelMaterial({ seam: 0.1 });
    this.meshes = new Map();   // typeId -> InstancedMesh
    this.lastVersion = -1;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  get layer() { return this.world.props; }

  /** Rebuild the instance buffers when the layer has changed. */
  update(force = false) {
    const layer = this.layer;
    if (!layer) return;
    if (!force && layer.version === this.lastVersion) return;
    this.lastVersion = layer.version;

    const byType = new Map();
    for (const rec of layer.values()) {
      let list = byType.get(rec.typeId);
      if (!list) { list = []; byType.set(rec.typeId, list); }
      list.push(rec);
    }

    // Drop meshes for types that no longer have any instances.
    for (const [typeId, mesh] of this.meshes) {
      if (!byType.has(typeId)) { this.group.remove(mesh); mesh.dispose(); this.meshes.delete(typeId); }
    }

    for (const [typeId, list] of byType) {
      const type = PROP_BY_ID[typeId];
      if (!type) continue;
      let mesh = this.meshes.get(typeId);
      // InstancedMesh capacity is fixed at construction, so grow in steps
      // rather than rebuilding on every single placement.
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        const cap = Math.max(8, 1 << Math.ceil(Math.log2(list.length + 1)));
        mesh = new THREE.InstancedMesh(propGeometry(type), this.material, cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.meshes.set(typeId, mesh);
      }
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, matrixFor(list[i], this._m, this._q, this._p, this._s));
      }
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setWorld(world) {
    this.world = world;
    this.lastVersion = -1;
    this.update(true);
  }

  setEnvironment(env) {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(env.sunDir);
    u.uSunColor.value.copy(env.sunColor);
    u.uSkyColor.value.copy(env.skyColor);
    u.uGroundColor.value.copy(env.groundColor);
    u.uFogColor.value.copy(env.fogColor);
    u.uNight.value = env.night;
    u.uFogNear.value = env.fogNear;
    u.uFogFar.value = env.fogFar;
  }

  setShadow(shadows, amount) {
    const u = this.material.uniforms;
    u.uShadowAmt.value = amount;
    if (!shadows || amount <= 0) return;
    u.uShadowMap.value = shadows.target.depthTexture;
    u.uShadowMatrix.value.copy(shadows.matrix);
    u.uShadowTexel.value = 1 / shadows.size;
  }

  setDim(v) { this.material.uniforms.uDim.value = v; }
  setVisible(v) { this.group.visible = v; }
}

/** Placement transform for a prop: anchor cell centre, then a quarter turn. */
export function matrixFor(rec, m = new THREE.Matrix4(), q = new THREE.Quaternion(),
                          p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1)) {
  p.set((rec.x + 0.5) * BLOCK_SIZE, rec.y * BLOCK_SIZE, (rec.z + 0.5) * BLOCK_SIZE);
  q.setFromAxisAngle(UP, rec.rot * Math.PI / 2);
  return m.compose(p, q, s);
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The translucent preview of the prop about to be placed. One mesh, swapped
 * to whichever geometry the player is holding.
 */
export class PropGhost {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0x39e08a, transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.typeId = 0;
  }

  show(typeKey, x, y, z, rot, ok) {
    const type = prop(typeKey);
    if (!type) { this.hide(); return; }
    if (this.typeId !== type.id) { this.mesh.geometry = propGeometry(type); this.typeId = type.id; }
    this.material.color.setHex(ok ? 0x39e08a : 0xff5f6d);
    this.mesh.position.set((x + 0.5) * BLOCK_SIZE, y * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE);
    this.mesh.rotation.set(0, rot * Math.PI / 2, 0);
    this.mesh.visible = true;
  }

  hide() { this.mesh.visible = false; }
}

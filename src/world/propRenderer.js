import * as THREE from 'three';
import { BLOCK_SIZE } from '../core/constants.js';
import { createVoxelMaterial } from '../voxel/renderer.js';
import { PROP_BY_ID, prop, PART_FINISH } from '../data/props.js';
import { partTilt } from '../voxel/props.js';
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

/**
 * A part is
 *   [cx, cy, cz, w, h, d, colour, glow?, finish?, opts?]
 * in metres, and `opts` is what stops everything being a crate:
 *
 *   shape 'box'   the default
 *         'cyl'   an elliptic cylinder, w and d the diameters, h the length
 *         'tube'  the same with no end caps, for rims and open frames
 *   axis  'y' (default), 'x' or 'z' - which way a cylinder runs
 *   seg   sides around a cylinder (default 10; 6 for small, 16 for prominent)
 *   tilt  [rx, ry, rz] radians about the part's own centre
 *
 * A goal post is a 12cm round tube, not a 24cm square column, and a goal net
 * rakes back from the crossbar rather than hanging as a flat plate. Neither is
 * expressible with axis-aligned boxes, which is why every piece of equipment
 * in the game used to read as a stack of blocks.
 */
const DEFAULT_SEG = 10;

/** Build a merged, vertex-coloured geometry for one prop type. */
export function buildPropGeometry(type) {
  const pos = [], nor = [], col = [], uv = [], emis = [], ao = [], fin = [], idx = [];
  let v = 0;

  for (const part of type.parts) {
    const [cx, cy, cz, w, h, d, colour, glow = 0, finish, opts] = part;
    // The shader packs corner occlusion as 0-3. Props are freestanding
    // objects, not voxels wedged into a corner, so they are fully open - and
    // leaving the attribute off entirely meant the shader read 0 and drew
    // every piece of equipment in the game at 38% ambient light.
    const aoValue = 3;
    const finValue = FINISH_ID[finish || PART_FINISH[colour]] || 0;
    const r = ((colour >> 16) & 255) / 255;
    const g = ((colour >> 8) & 255) / 255;
    const b = (colour & 255) / 255;

    const quads = opts?.shape === 'cyl' || opts?.shape === 'tube'
      ? cylinderQuads(w, h, d, opts)
      : boxQuads(w, h, d);

    const rot = opts?.tilt ? partTilt(opts.tilt) : null;

    for (const [corners, n, su, sv] of quads) {
      for (const p of corners) {
        const q = rot ? apply(rot, p) : p;
        pos.push(q[0] + cx, q[1] + cy, q[2] + cz);
        const m = rot ? apply(rot, n) : n;
        nor.push(m[0], m[1], m[2]);
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

/** The six faces of a box, centred on the origin. */
function boxQuads(w, h, d) {
  const x0 = -w * HALF, x1 = w * HALF;
  const y0 = -h * HALF, y1 = h * HALF;
  const z0 = -d * HALF, z1 = d * HALF;
  return [
    [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], d, h],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], d, h],
    [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], w, d],
    [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], w, d],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], w, h],
    [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], w, h],
  ];
}

/**
 * An elliptic cylinder centred on the origin, running along `axis`.
 *
 * w, h and d are the part's size along world x, y and z, exactly as they are
 * for a box - `axis` only says which of the three is the round one's length.
 * Making the length always mean `h` would read fine for an upright post and
 * then quietly turn a crossbar into a seven-metre disc the first time someone
 * wrote the numbers in the order the shape actually has.
 *
 * Caps are quads from the rim to the centre rather than a triangle fan, so
 * the whole kit stays quad-indexed and one index pattern serves every part.
 */
function cylinderQuads(w, h, d, opts) {
  const seg = Math.max(3, opts.seg || DEFAULT_SEG);
  const capped = opts.shape !== 'tube';
  const axis = opts.axis || 'y';
  // Work in a local frame where the length runs along y, then swing it into
  // place. The two radii are whichever axes are left over.
  const length = axis === 'x' ? w : axis === 'z' ? d : h;
  const rx = (axis === 'x' ? d : w) * HALF;
  const rz = (axis === 'z' ? h : d) * HALF;
  const half = length * HALF;
  const swing = axis === 'x' ? ([px, py, pz]) => [py, px, pz]
    : axis === 'z' ? ([px, py, pz]) => [px, pz, py]
    : (p) => p;

  const ring = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push([Math.cos(a) * rx, Math.sin(a) * rz, Math.cos(a), Math.sin(a)]);
  }
  const circumference = Math.PI * (rx + rz);
  const out = [];
  for (let i = 0; i < seg; i++) {
    const [ax, az, anx, anz] = ring[i];
    const [bx, bz, bnx, bnz] = ring[(i + 1) % seg];
    // One outward normal for the face, which is what a flat-shaded voxel look
    // wants: a smoothed cylinder would read as plastic beside the stadium.
    const nx = (anx + bnx) / 2, nz = (anz + bnz) / 2;
    const len = Math.hypot(nx, nz) || 1;
    out.push([
      [swing([ax, -half, az]), swing([bx, -half, bz]), swing([bx, half, bz]), swing([ax, half, az])],
      swing([nx / len, 0, nz / len]),
      circumference / seg, length,
    ]);
  }
  if (capped) {
    for (const [sign, ny] of [[half, 1], [-half, -1]]) {
      for (let i = 0; i < seg; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % seg];
        const face = ny > 0
          ? [[0, sign, 0], [ax, sign, az], [bx, sign, bz], [0, sign, 0]]
          : [[0, sign, 0], [bx, sign, bz], [ax, sign, az], [0, sign, 0]];
        out.push([face.map(swing), swing([0, ny, 0]), rx, rz]);
      }
    }
  }
  return out;
}

function apply(m, [x, y, z]) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
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

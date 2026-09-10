import * as THREE from 'three';
import { BLOCK_SIZE, CHUNK_X, CHUNK_Z } from '../core/constants.js';
import { meshChunk, meshZoneOverlay } from './mesher.js';

/**
 * Custom voxel material.
 *
 * Deliberately NOT a textured cube look. Flat architectural colour + a
 * hemisphere/sun lighting model + fine panel seams every metre, which is what
 * makes a merged 30-voxel concrete wall read as a *building* rather than a
 * stack of cubes.
 */
const VERT = /* glsl */`
  attribute vec3 color;
  attribute vec2 quadUv;
  attribute float emis;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vEmis;
  varying float vDist;
  varying vec3 vWorld;
  void main() {
    vColor = color;
    vUv = quadUv;
    vEmis = emis;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uNight;
  uniform float uOpacity;
  uniform float uSeam;
  uniform vec3 uHighlight;
  uniform float uHighlightAmt;
  uniform float uDim;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vEmis;
  varying float vDist;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    float ndl = max(dot(N, uSunDir), 0.0);
    // Soft wrap term keeps shadowed faces readable instead of pure black.
    float wrap = max(dot(N, uSunDir) * 0.5 + 0.5, 0.0);
    vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
    vec3 lit = vColor * (hemi * 0.78 + uSunColor * (ndl * 0.66 + wrap * 0.22));

    // Panel seams: one line per metre of real surface, faded out by distance
    // via fwidth so it never turns into moire.
    vec2 f = fract(vUv);
    vec2 d = min(f, 1.0 - f);
    vec2 w = fwidth(vUv) * 1.5 + 0.012;
    vec2 g = smoothstep(vec2(0.0), w, d);
    float seam = min(g.x, g.y);
    lit *= mix(1.0 - uSeam, 1.0, seam);

    // Emissive elements (screens, floodlights) glow after dark.
    lit += vColor * vEmis * (0.25 + uNight * 1.9);
    lit = mix(lit, uHighlight, uHighlightAmt);
    // ZONE mode fades the world back so the painted overlay reads clearly.
    lit = mix(lit, vec3(dot(lit, vec3(0.3, 0.59, 0.11))) * 0.55, 1.0 - uDim);

    float fogF = smoothstep(uFogNear, uFogFar, vDist);
    vec3 outc = mix(lit, uFogColor, fogF);
    gl_FragColor = vec4(outc, uOpacity);
  }
`;

export function createVoxelMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0xfff3e0) },
      uSkyColor: { value: new THREE.Color(0x8fb6d8) },
      uGroundColor: { value: new THREE.Color(0x33393f) },
      uFogColor: { value: new THREE.Color(0xa8c4dc) },
      uFogNear: { value: 220 },
      uFogFar: { value: 900 },
      uNight: { value: 0 },
      uOpacity: { value: opts.opacity ?? 1 },
      uSeam: { value: opts.seam ?? 0.16 },
      uHighlight: { value: new THREE.Color(0x39e08a) },
      uHighlightAmt: { value: 0 },
      uDim: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: !!opts.transparent,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

function buildGeometry(mb) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(mb.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(mb.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(mb.col, 3));
  g.setAttribute('quadUv', new THREE.Float32BufferAttribute(mb.uv, 2));
  g.setAttribute('emis', new THREE.Float32BufferAttribute(mb.emis, 1));
  g.setIndex(mb.idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Owns the Three scene graph for the voxel world: one opaque + one transparent
 * mesh per chunk, remeshed on a per-frame budget so a big fill never stalls
 * the frame.
 */
export class WorldRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.zoneGroup = new THREE.Group();
    this.zoneGroup.visible = false;
    scene.add(this.group);
    scene.add(this.zoneGroup);

    this.matOpaque = createVoxelMaterial();
    this.matTransparent = createVoxelMaterial({ transparent: true, opacity: 0.55, seam: 0.1 });
    this.matZone = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.82 } },
      vertexShader: `
        attribute vec3 color; attribute vec2 quadUv;
        varying vec3 vColor; varying vec2 vUv;
        void main(){ vColor=color; vUv=quadUv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; uniform float uOpacity;
        varying vec3 vColor; varying vec2 vUv;
        void main(){
          vec2 f=fract(vUv); vec2 d=min(f,1.0-f);
          vec2 w=fwidth(vUv)*1.5+0.02; vec2 g=smoothstep(vec2(0.0),w,d);
          float seam=min(g.x,g.y);
          vec3 c=mix(vColor*1.9, vColor*1.25, seam);
          gl_FragColor=vec4(c, uOpacity*mix(1.0,0.78,seam));
        }`,
      transparent: true,
      depthWrite: false,
      // The overlay sits flush on top of the block faces it describes, so it
      // needs a depth bias or it z-fights into invisibility at any distance.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      side: THREE.DoubleSide,
    });

    this.meshes = new Map();     // chunkKey -> { opaque, transparent }
    this.zoneMeshes = new Map(); // chunkKey -> mesh
    this.pending = [];
    this.zoneMode = false;
    this.remeshBudget = 3;
    this.stats = { chunks: 0, tris: 0 };
  }

  key(c) { return c.cx + ',' + c.cz; }

  /** Rebuild everything from scratch (after load / land expansion). */
  rebuildAll() {
    for (const rec of this.meshes.values()) this.disposeRec(rec);
    this.meshes.clear();
    for (const m of this.zoneMeshes.values()) { this.zoneGroup.remove(m); m.geometry.dispose(); }
    this.zoneMeshes.clear();
    this.pending.length = 0;
    this.world.forEachChunk((c) => { c.dirty = true; c.zoneDirty = true; this.world.dirtyChunks.add(c); });
  }

  disposeRec(rec) {
    if (rec.opaque) { this.group.remove(rec.opaque); rec.opaque.geometry.dispose(); }
    if (rec.transparent) { this.group.remove(rec.transparent); rec.transparent.geometry.dispose(); }
  }

  /** Remesh up to `budget` dirty chunks. Call once per frame. */
  update(budget = this.remeshBudget) {
    const dirty = this.world.dirtyChunks;
    if (dirty.size === 0) return;
    let n = 0;
    // Large batch edits are worth flushing faster than 3/frame.
    const effective = dirty.size > 24 ? Math.max(budget, 8) : budget;
    for (const chunk of dirty) {
      this.remesh(chunk);
      dirty.delete(chunk);
      if (++n >= effective) break;
    }
  }

  /** Force-remesh every dirty chunk. Used right after load. */
  flush() {
    const dirty = this.world.dirtyChunks;
    for (const chunk of dirty) this.remesh(chunk);
    dirty.clear();
  }

  remesh(chunk) {
    const k = this.key(chunk);
    const built = meshChunk(this.world, chunk);
    let rec = this.meshes.get(k);
    if (!rec) { rec = { opaque: null, transparent: null }; this.meshes.set(k, rec); }

    rec.opaque = this.swap(rec.opaque, built.opaque, this.matOpaque, this.group);
    rec.transparent = this.swap(rec.transparent, built.transparent, this.matTransparent, this.group);
    if (rec.transparent) rec.transparent.renderOrder = 2;

    if (this.zoneMode) this.remeshZone(chunk);
    chunk.dirty = false;
  }

  remeshZone(chunk) {
    const k = this.key(chunk);
    const mb = meshZoneOverlay(this.world, chunk);
    let mesh = this.zoneMeshes.get(k);
    if (mesh) { this.zoneGroup.remove(mesh); mesh.geometry.dispose(); this.zoneMeshes.delete(k); }
    if (mb.isEmpty()) return;
    mesh = new THREE.Mesh(buildGeometry(mb), this.matZone);
    mesh.renderOrder = 4;
    mesh.frustumCulled = true;
    this.zoneGroup.add(mesh);
    this.zoneMeshes.set(k, mesh);
  }

  swap(existing, mb, material, parent) {
    if (existing) { parent.remove(existing); existing.geometry.dispose(); }
    if (mb.isEmpty()) return null;
    const mesh = new THREE.Mesh(buildGeometry(mb), material);
    mesh.frustumCulled = true;
    parent.add(mesh);
    return mesh;
  }

  setZoneMode(on, dim = 0.35) {
    if (this.zoneMode === on) { this.setZoneDim(on ? dim : 1); return; }
    this.zoneMode = on;
    this.zoneGroup.visible = on;
    this.setZoneDim(on ? dim : 1);
    if (on) {
      this.world.forEachChunk((c) => this.remeshZone(c));
    } else {
      for (const m of this.zoneMeshes.values()) { this.zoneGroup.remove(m); m.geometry.dispose(); }
      this.zoneMeshes.clear();
    }
  }

  setZoneDim(v) {
    for (const m of [this.matOpaque, this.matTransparent]) m.uniforms.uDim.value = v;
  }

  /** Push environment uniforms (day/night, weather) to both voxel materials. */
  setEnvironment(env) {
    for (const m of [this.matOpaque, this.matTransparent]) {
      m.uniforms.uSunDir.value.copy(env.sunDir);
      m.uniforms.uSunColor.value.copy(env.sunColor);
      m.uniforms.uSkyColor.value.copy(env.skyColor);
      m.uniforms.uGroundColor.value.copy(env.groundColor);
      m.uniforms.uFogColor.value.copy(env.fogColor);
      m.uniforms.uNight.value = env.night;
      m.uniforms.uFogNear.value = env.fogNear;
      m.uniforms.uFogFar.value = env.fogFar;
    }
  }

  /** Hide chunks beyond `dist` metres of the camera (cheap LOD). */
  cullDistant(cameraPos, dist) {
    const d2 = dist * dist;
    const cs = CHUNK_X * BLOCK_SIZE;
    for (const [k, rec] of this.meshes) {
      const [cx, cz] = k.split(',').map(Number);
      const px = (cx + 0.5) * cs, pz = (cz + 0.5) * CHUNK_Z * BLOCK_SIZE;
      const dx = px - cameraPos.x, dz = pz - cameraPos.z;
      const vis = dx * dx + dz * dz < d2;
      if (rec.opaque) rec.opaque.visible = vis;
      if (rec.transparent) rec.transparent.visible = vis;
    }
  }
}

export { buildGeometry };

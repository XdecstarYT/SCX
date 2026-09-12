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
  attribute float ao;
  attribute float fin;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vEmis;
  varying float vAo;
  varying float vFin;
  varying float vDist;
  varying vec3 vWorld;
  varying vec3 vWNormal;
  void main() {
    vColor = color;
    vAo = ao;
    vFin = fin;
    vUv = quadUv;
    vEmis = emis;
    // Chunk meshes draw one instance; props draw many, so the same material
    // has to handle both rather than forking into a second shader.
    vec4 local = vec4(position, 1.0);
    vec3 ln = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      ln = mat3(instanceMatrix) * ln;
    #endif
    vNormal = normalize(normalMatrix * ln);
    // The sun direction, the camera position and the pitch rectangles are all
    // in world space, so the normal they are compared against has to be too.
    // Lighting used the view-space normal against a world-space sun, which
    // meant the lit side of a building followed the camera as you orbited it.
    vWNormal = normalize(mat3(modelMatrix) * ln);
    vec4 mv = modelViewMatrix * local;
    vWorld = (modelMatrix * local).xyz;
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
  uniform float uAo;
  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowTexel;
  uniform float uShadowAmt;
  uniform int uPitchCount;
  uniform vec4 uPitch[8];          // centre x, centre z, half width, half depth
  uniform float uPitchSport[8];
  uniform vec3 uHighlight;
  uniform float uHighlightAmt;
  uniform float uDim;
  varying vec3 vColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vEmis;
  varying float vAo;
  varying float vFin;
  varying float vDist;
  varying vec3 vWorld;
  varying vec3 vWNormal;

  /**
   * How much sun reaches this fragment. Four taps in a rotated square, which
   * is enough to take the staircase off a shadow edge at this texel density
   * without costing a sixteenth of the frame.
   */
  float sunVisibility(vec3 worldPos, float ndl) {
    if (uShadowAmt <= 0.0) return 1.0;
    vec4 lp = uShadowMatrix * vec4(worldPos, 1.0);
    vec3 sc = lp.xyz / lp.w * 0.5 + 0.5;
    if (sc.x < 0.001 || sc.x > 0.999 || sc.y < 0.001 || sc.y > 0.999 || sc.z > 1.0) return 1.0;
    // Slope-scaled bias: a surface edge-on to the sun needs far more of it.
    float bias = 0.0009 + 0.0045 * (1.0 - ndl);
    float t = uShadowTexel;
    float sum = 0.0;
    sum += step(sc.z - bias, texture2D(uShadowMap, sc.xy + vec2( t,  t)).r);
    sum += step(sc.z - bias, texture2D(uShadowMap, sc.xy + vec2(-t,  t)).r);
    sum += step(sc.z - bias, texture2D(uShadowMap, sc.xy + vec2( t, -t)).r);
    sum += step(sc.z - bias, texture2D(uShadowMap, sc.xy + vec2(-t, -t)).r);
    // Fade the whole thing out at the edge of the map rather than cutting it.
    vec2 e = abs(sc.xy - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.82, 0.99, max(e.x, e.y));
    return mix(1.0, sum * 0.25, uShadowAmt * edge);
  }

  // ------------------------------------------------------------- markings
  // Pitch markings, drawn procedurally rather than placed as blocks.
  //
  // A line is 10cm wide and a voxel is 2m, so these cannot be built out of the
  // world: they have to be painted on it. The analyser already knows where
  // every playing surface is and how big it is, so the rectangles come in as
  // uniforms and each sport draws its own regulation set inside one. Nothing
  // about the world changes, which means markings cost nothing, need no
  // upkeep, and follow the pitch if the player reshapes it.
  //
  // Everything is in metres from the centre of the pitch, scaled so a pitch
  // built under regulation size still gets proportionate markings.

  float lineMask(float d, float w) {
    float aa = fwidth(d) * 0.9 + 0.004;
    // A 10cm line is thinner than a pixel from anywhere but the touchline, so
    // without a floor of about one pixel the markings simply dissolve as you
    // pull the camera back - which is the one view they matter most in.
    float hw = max(w, aa);
    return 1.0 - smoothstep(hw, hw + aa, d);
  }
  // Distance to a rectangle's outline.
  float dRectEdge(vec2 p, vec2 h) {
    vec2 d = abs(p) - h;
    float outside = length(max(d, 0.0));
    float inside = min(max(d.x, d.y), 0.0);
    return abs(outside + inside);
  }
  // Distance to a line segment.
  float dSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * t);
  }
  float dCircle(vec2 p, float r) { return abs(length(p) - r); }
  // An arc, clipped to the half-plane the goal or basket sits on.
  float dArc(vec2 p, vec2 c, float r, float side) {
    return (p.x - c.x) * side > 0.0 ? dCircle(p - c, r) : 1e6;
  }

  /**
   * Markings for one sport, in metres from the pitch centre. h is the pitch
   * half-extent and k scales the regulation dimensions onto whatever size the
   * player actually built.
   */
  float pitchMarks(int sport, vec2 p, vec2 h, float k) {
    float w = 0.06 * max(k, 0.6);      // half-width of a painted line
    float m = 0.0;
    float d = 1e6;

    if (sport == 1 || sport == 2) {
      // Football and rugby: touchlines, halfway, and the boxes at each end.
      d = min(d, dRectEdge(p, h));
      d = min(d, abs(p.x));
      if (sport == 1) {
        d = min(d, dCircle(p, 9.15 * k));
        // Penalty area and goal area, mirrored.
        vec2 q = vec2(abs(p.x), p.y);
        d = min(d, max(dRectEdge(q - vec2(h.x - 8.25 * k, 0.0), vec2(8.25, 20.15) * k), 0.0));
        d = min(d, dRectEdge(q - vec2(h.x - 2.75 * k, 0.0), vec2(2.75, 9.16) * k));
        m = max(m, lineMask(length(p), 0.22 * k));                       // centre spot
        m = max(m, lineMask(length(q - vec2(h.x - 11.0 * k, 0.0)), 0.22 * k));
      } else {
        // Rugby: 22-metre lines and the 10s either side of halfway.
        vec2 q = vec2(abs(p.x), p.y);
        d = min(d, abs(q.x - (h.x - 22.0 * k)));
        d = min(d, abs(q.x - 10.0 * k));
      }
    } else if (sport == 3) {
      // Cricket: the boundary, the inner ring, and the strip in the middle.
      d = min(d, dCircle(p, min(h.x, h.y)));
      d = min(d, dCircle(p, min(h.x, h.y) * 0.62));
      d = min(d, dRectEdge(p, vec2(10.06, 1.52) * k));
      vec2 q = vec2(abs(p.x), p.y);
      d = min(d, max(dSeg(q, vec2(10.06 * k, -1.32 * k), vec2(10.06 * k, 1.32 * k)), 0.0));
    } else if (sport == 4) {
      // Australian Rules: an oval boundary, the centre square and circles,
      // and the 50-metre arcs.
      d = min(d, abs(length(p / h) - 1.0) * min(h.x, h.y));
      d = min(d, dRectEdge(p, vec2(25.0, 25.0) * k));
      d = min(d, dCircle(p, 10.0 * k));
      d = min(d, dCircle(p, 3.0 * k));
      vec2 q = vec2(abs(p.x), p.y);
      d = min(d, dArc(q, vec2(h.x, 0.0), 50.0 * k, -1.0));
    } else if (sport == 5) {
      // Basketball: the key, the free-throw circle and the three-point line.
      d = min(d, dRectEdge(p, h));
      d = min(d, abs(p.x));
      d = min(d, dCircle(p, 1.8 * k));
      vec2 q = vec2(abs(p.x), p.y);
      d = min(d, dRectEdge(q - vec2(h.x - 2.9 * k, 0.0), vec2(2.9, 2.45) * k));
      d = min(d, dCircle(q - vec2(h.x - 5.8 * k, 0.0), 1.8 * k));
      d = min(d, dArc(q, vec2(h.x - 1.575 * k, 0.0), 6.75 * k, -1.0));
    } else if (sport == 6) {
      // Tennis: doubles and singles lines, service boxes, centre marks.
      d = min(d, dRectEdge(p, h));
      d = min(d, abs(p.x));
      d = min(d, abs(abs(p.y) - h.y * 0.815));         // singles sidelines
      vec2 q = vec2(abs(p.x), p.y);
      d = min(d, abs(q.x - 6.4 * k));                  // service lines
      d = min(d, max(dSeg(p, vec2(-6.4 * k, 0.0), vec2(6.4 * k, 0.0)), 0.0));
    } else if (sport == 7) {
      // Athletics: an oval track of lanes around the infield.
      float e = length(p / h);
      for (int i = 0; i <= 8; i++) {
        d = min(d, abs(e - (0.55 + float(i) * 0.05)) * min(h.x, h.y));
      }
      d = min(d, dRectEdge(p, h));
    } else if (sport == 8) {
      // Swimming: lane ropes down the pool and the turn flags across it.
      d = min(d, dRectEdge(p, h));
      for (int i = 1; i <= 7; i++) {
        d = min(d, abs(p.y - (-h.y + 2.0 * h.y * float(i) / 8.0)));
      }
      vec2 q = vec2(abs(p.x), p.y);
      d = min(d, abs(q.x - (h.x - 5.0 * k)));
    } else if (sport == 9) {
      // Ice hockey: centre line, blue lines, face-off circles.
      d = min(d, dRectEdge(p, h));
      d = min(d, abs(p.x));
      vec2 q = vec2(abs(p.x), p.y);
      d = min(d, abs(q.x - 7.3 * k));                  // blue lines
      d = min(d, abs(q.x - (h.x - 4.0 * k)));          // goal lines
      d = min(d, dCircle(p, 4.5 * k));
      d = min(d, dCircle(vec2(q.x - (h.x - 10.0 * k), abs(p.y) - 7.0 * k), 4.5 * k));
    } else if (sport == 10) {
      // Baseball: foul lines out from home, the infield arc and the diamond.
      vec2 home = vec2(-h.x * 0.62, 0.0);
      vec2 r = p - home;
      float ang = atan(r.y, r.x);
      d = min(d, dSeg(p, home, home + vec2(cos(0.7854), sin(0.7854)) * (h.x * 1.9)));
      d = min(d, dSeg(p, home, home + vec2(cos(-0.7854), sin(-0.7854)) * (h.x * 1.9)));
      if (abs(ang) < 0.7854) {
        d = min(d, dCircle(r, 27.4 * k));              // infield arc
        d = min(d, dCircle(r, 57.9 * k));              // warning track
      }
      // The diamond itself: four bases 27.4m apart.
      float b = 19.4 * k;
      vec2 a1 = home + vec2(b, -b), a2 = home + vec2(b * 2.0, 0.0), a3 = home + vec2(b, b);
      d = min(d, dSeg(p, home, a1));
      d = min(d, dSeg(p, a1, a2));
      d = min(d, dSeg(p, a2, a3));
      d = min(d, dSeg(p, a3, home));
    } else if (sport == 11) {
      // Combat: the mat edge and the fighters' marks.
      d = min(d, dRectEdge(p, h));
      d = min(d, dRectEdge(p, h * 0.72));
      d = min(d, dCircle(p, 1.0 * k));
    }
    return max(m, lineMask(d, w));
  }

  // Cheap value noise, used to break up flat colour fields at close range.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vWNormal);
    float ndl = max(dot(N, uSunDir), 0.0);
    // Soft wrap term keeps shadowed faces readable instead of pure black.
    float wrap = max(dot(N, uSunDir) * 0.5 + 0.5, 0.0);
    vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);

    // Corner occlusion, interpolated across the quad. Ambient light is what
    // gets blocked in a corner, so it takes the full weight; direct sun is
    // only slightly dimmed, which keeps a sunlit corner from going muddy.
    float ao = clamp(vAo * 0.3333, 0.0, 1.0);
    ao = mix(1.0 - uAo, 1.0, ao * ao * (3.0 - 2.0 * ao));

    // --------------------------------------------------------- the surface
    // Three finishes, because a mown pitch, a pane of glass and a concrete
    // wall do not catch light the same way, and flat colour for all three is
    // what makes a voxel scene read as plastic.
    vec3 base = vColor;
    float gloss = 0.0;
    float seamMul = 1.0;
    float grain = 0.044;

    // The finish id and the "this is a playing surface" flag share one
    // attribute, so they have to be taken apart before either is read.
    float finish = mod(vFin, 8.0);
    bool playable = vFin >= 8.0;

    if (finish > 2.5) {
      // Seating. A deck of seats is thousands of separate mouldings, and the
      // one thing it never is, is a single flat colour.
      grain = 0.10;
    } else if (finish > 1.5) {
      // Glass, metal, ice, water: a real highlight, so a facade catches the
      // sun and a roof has a sheen along its length.
      gloss = 1.0;
      grain = 0.018;
    } else if (finish > 0.5) {
      // Mown turf. Groundsmen cut in bands and the nap of the grass throws the
      // light differently each way, which is why a pitch on television is
      // striped. Five-metre bands, plus a fine speckle so it is not a gradient.
      // Grass has no panel seams: it is the one surface where the per-metre
      // grid reads as tiling rather than as construction.
      float band = sin(vWorld.x * 0.2094);
      base *= 1.0 + smoothstep(-0.25, 0.25, band) * 0.075 - 0.037;
      seamMul = 0.0;
      grain = 0.034;
    }
    base *= (1.0 - grain * 0.5) + hash21(floor(vWorld.xz * 0.55 + vWorld.y * 0.31)) * grain;

    // Markings go on the top of a playing surface and nowhere else.
    if (playable && N.y > 0.5 && uPitchCount > 0) {
      for (int i = 0; i < 8; i++) {
        if (i >= uPitchCount) break;
        vec4 pit = uPitch[i];
        vec2 h = pit.zw;
        vec2 rel = vWorld.xz - pit.xy;
        if (abs(rel.x) > h.x + 1.0 || abs(rel.y) > h.y + 1.0) continue;
        // Pitches are laid out long-axis-first; markings are written that way
        // too, so a pitch built the other way round is measured, not rotated.
        float k = min(h.x / 52.5, h.y / 34.0);
        float paint = pitchMarks(int(uPitchSport[i]), rel, h, max(k, 0.25));
        // Worn white: paint sits on the grass rather than replacing it.
        base = mix(base, mix(vec3(0.92, 0.93, 0.90), base, 0.12), paint);
        break;
      }
    }

    // Shadow dims the direct sun only. Skylight still reaches a shaded wall,
    // which is why real shade is blue rather than black.
    float sun = sunVisibility(vWorld, ndl);
    vec3 direct = uSunColor * (ndl * 0.66 * sun + wrap * 0.22 * mix(0.55, 1.0, sun));
    vec3 lit = base * (hemi * 0.78 * ao + direct * mix(1.0, ao, 0.45));

    if (gloss > 0.0) {
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 H = normalize(uSunDir + V);
      float spec = pow(max(dot(N, H), 0.0), 48.0);
      // Fresnel: glancing angles catch far more, which is what makes glass
      // read as glass rather than as pale blue paint.
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      lit += uSunColor * (spec * 0.55 * sun + fres * 0.10) * ao * (1.0 - uNight * 0.7);
    }

    // Panel seams: one line per metre of real surface, faded out by distance
    // via fwidth so it never turns into moire.
    vec2 f = fract(vUv);
    vec2 d = min(f, 1.0 - f);
    vec2 w = fwidth(vUv) * 1.5 + 0.012;
    vec2 g = smoothstep(vec2(0.0), w, d);
    float seam = min(g.x, g.y);
    lit *= mix(1.0 - uSeam * seamMul, 1.0, seam);

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
      uAo: { value: opts.ao ?? 0.62 },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 1 / 1024 },
      uShadowAmt: { value: 0 },
      uPitchCount: { value: 0 },
      uPitch: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uPitchSport: { value: new Array(8).fill(0) },
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
  g.setAttribute('ao', new THREE.Float32BufferAttribute(mb.ao, 1));
  g.setAttribute('fin', new THREE.Float32BufferAttribute(mb.fin, 1));
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

  /**
   * Tell the shader where the playing surfaces are, so it can paint their
   * markings. Takes what the analyser already worked out rather than scanning
   * the world again; eight is more pitches than fit on the largest plot.
   */
  setPitches(pitches) {
    const n = Math.min(8, pitches.length);
    for (const m of [this.matOpaque, this.matTransparent]) {
      m.uniforms.uPitchCount.value = n;
      for (let i = 0; i < n; i++) {
        const p = pitches[i];
        m.uniforms.uPitch.value[i].set(p.cx, p.cz, p.halfW, p.halfD);
        m.uniforms.uPitchSport.value[i] = p.sport;
      }
    }
  }

  /** Point both voxel materials at the sun's depth buffer. */
  setShadow(shadows, amount) {
    for (const m of [this.matOpaque, this.matTransparent]) {
      m.uniforms.uShadowAmt.value = amount;
      if (!shadows || amount <= 0) continue;
      m.uniforms.uShadowMap.value = shadows.target.depthTexture;
      m.uniforms.uShadowMatrix.value.copy(shadows.matrix);
      m.uniforms.uShadowTexel.value = 1 / shadows.size;
    }
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

import * as THREE from 'three';
import { GROUND_Y, BLOCK_SIZE } from '../core/constants.js';

/**
 * Sky dome + day/night + weather. Deliberately cheap: one inverted sphere with
 * a gradient shader, one directional light, no shadow maps (they are the first
 * thing that kills a mid-range phone in a voxel scene).
 */
const KEYFRAMES = [
  // hour, sky top, sky horizon, sun colour, ground bounce, fog, night factor
  { h: 0,  top: 0x050a16, hor: 0x0b1526, sun: 0x2a3550, gnd: 0x05080e, fog: 0x0a1424, night: 1.0 },
  { h: 5,  top: 0x101b33, hor: 0x2c3550, sun: 0x4a5470, gnd: 0x0c1018, fog: 0x1b2338, night: 0.88 },
  { h: 6,  top: 0x2b3f66, hor: 0xd08a5a, sun: 0xffb27a, gnd: 0x1a1f2b, fog: 0x6a6a80, night: 0.55 },
  { h: 8,  top: 0x5f92c9, hor: 0xbcd6ea, sun: 0xfff0dc, gnd: 0x39404a, fog: 0xa9c6de, night: 0.1 },
  { h: 13, top: 0x3f86d6, hor: 0xa8cbe8, sun: 0xfffaf0, gnd: 0x424a55, fog: 0xa8c4dc, night: 0 },
  { h: 18, top: 0x4d7fbe, hor: 0xd7b58a, sun: 0xffe0b8, gnd: 0x3a3f4a, fog: 0xb3bcc8, night: 0.08 },
  { h: 20, top: 0x24365c, hor: 0xa8603f, sun: 0xff9a5c, gnd: 0x1e232e, fog: 0x5c5668, night: 0.6 },
  { h: 22, top: 0x090f1e, hor: 0x121c30, sun: 0x33405e, gnd: 0x080b12, fog: 0x101a2c, night: 1.0 },
  { h: 24, top: 0x050a16, hor: 0x0b1526, sun: 0x2a3550, gnd: 0x05080e, fog: 0x0a1424, night: 1.0 },
];

const WEATHER_TINT = {
  sunny:  { sat: 1.0, fogMul: 1.0, sunMul: 1.0 },
  cloudy: { sat: 0.82, fogMul: 0.75, sunMul: 0.72 },
  rain:   { sat: 0.6, fogMul: 0.45, sunMul: 0.5 },
  storm:  { sat: 0.42, fogMul: 0.3, sunMul: 0.34 },
  heat:   { sat: 1.1, fogMul: 1.15, sunMul: 1.12 },
};

const SKY_VERT = `
  varying vec3 vDir;
  void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = `
  precision highp float;
  uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
  uniform float uNight;
  varying vec3 vDir;
  // Cheap hash-based starfield, only visible once uNight rises.
  float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  void main(){
    vec3 d = normalize(vDir);
    float t = clamp(d.y*1.15+0.12, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(t, 0.7));
    float sun = max(dot(d, uSunDir), 0.0);
    col += uSunColor * pow(sun, 220.0) * 2.4;
    col += uSunColor * pow(sun, 8.0) * 0.14 * (1.0 - uNight);
    if (uNight > 0.2 && d.y > 0.0) {
      vec3 g = floor(d * 180.0);
      float s = hash(g);
      float star = smoothstep(0.9975, 1.0, s) * (uNight - 0.2) * 1.25;
      col += vec3(star);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x3f86d6) },
      uHorizon: { value: new THREE.Color(0xa8cbe8) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0xfffaf0) },
      uNight: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(1, 24, 16);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Ground plane.
    //
    // The plot is a finite square of voxels, so without this the world simply
    // stops at the fence and you see sky underneath it - the single clearest
    // sign that you are standing on a game board rather than in a place. This
    // is the land the plot was cut out of: it sits a hair below the terrain
    // surface, takes the same light, and fades into the fog like everything
    // else, so the horizon closes.
    const groundGeo = new THREE.PlaneGeometry(1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uNear: { value: new THREE.Color(0x53733f) },
        uFar: { value: new THREE.Color(0x5c6b4c) },
        uFogColor: { value: new THREE.Color(0xa8c4dc) },
        uFogNear: { value: 200 }, uFogFar: { value: 1500 },
        uCentre: { value: new THREE.Vector2() },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        precision highp float;
        uniform vec3 uNear; uniform vec3 uFar; uniform vec3 uFogColor;
        uniform float uFogNear; uniform float uFogFar; uniform vec2 uCentre;
        varying vec3 vWorld;
        float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
        // Smoothed value noise. The un-smoothed version tiles the countryside
        // into obvious squares, which is worse than leaving it flat.
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main(){
          float d = distance(vWorld.xz, uCentre);
          // Two octaves of very broad variation, so the land beyond the fence
          // has fields in it rather than being one flat sheet of green.
          float blotch = vnoise(vWorld.xz * 0.004) * 0.7 + vnoise(vWorld.xz * 0.017) * 0.3;
          vec3 col = mix(uNear, uFar, smoothstep(60.0, 900.0, d));
          col *= 0.945 + blotch * 0.11;
          float f = smoothstep(uFogNear, uFogFar, distance(vWorld, cameraPosition));
          gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
        }`,
      depthWrite: true,
    });
    // A hair below the terrain surface, so the plot's own grass wins wherever
    // the two meet rather than z-fighting along every edge.
    this.groundY = GROUND_Y * BLOCK_SIZE - 0.06;
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.renderOrder = -1;
    this.ground.frustumCulled = false;
    scene.add(this.ground);

    this.env = {
      sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
      sunColor: new THREE.Color(0xfffaf0),
      skyColor: new THREE.Color(0x8fb6d8),
      groundColor: new THREE.Color(0x424a55),
      fogColor: new THREE.Color(0xa8c4dc),
      night: 0,
      shadowStrength: 1,
      fogNear: 200,
      fogFar: 1100,
    };
    this._a = new THREE.Color();
    this._b = new THREE.Color();
  }

  /**
   * @param dayFraction 0..1 through the in-game day
   * @param weather one of WEATHER_TINT
   */
  /** Centre the surrounding land on the plot, so it reads as land around it. */
  setPlot(sizeVoxels) {
    const c = (sizeVoxels * BLOCK_SIZE) / 2;
    this.groundMat.uniforms.uCentre.value.set(c, c);
  }

  update(dayFraction, weather = 'sunny', cameraPos = null, viewDistance = 900) {
    const hour = ((dayFraction % 1) + 1) % 1 * 24;
    let i = 0;
    while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].h <= hour) i++;
    const a = KEYFRAMES[i], b = KEYFRAMES[i + 1];
    const t = (hour - a.h) / Math.max(0.001, b.h - a.h);
    const w = WEATHER_TINT[weather] || WEATHER_TINT.sunny;

    const lerpCol = (target, ka, kb) => {
      this._a.setHex(ka); this._b.setHex(kb);
      target.copy(this._a).lerp(this._b, t);
    };

    lerpCol(this.uniforms.uTop.value, a.top, b.top);
    lerpCol(this.uniforms.uHorizon.value, a.hor, b.hor);
    lerpCol(this.env.sunColor, a.sun, b.sun);
    lerpCol(this.env.groundColor, a.gnd, b.gnd);
    lerpCol(this.env.fogColor, a.fog, b.fog);
    this.env.night = a.night + (b.night - a.night) * t;

    // Weather desaturates the palette and pulls the fog in.
    const grey = (c) => {
      const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      c.setRGB(l + (c.r - l) * w.sat, l + (c.g - l) * w.sat, l + (c.b - l) * w.sat);
    };
    grey(this.uniforms.uTop.value); grey(this.uniforms.uHorizon.value);
    grey(this.env.fogColor); grey(this.env.sunColor);
    this.env.sunColor.multiplyScalar(w.sunMul);

    // Sun arc: noon overhead, dawn/dusk at the horizon.
    const ang = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    this.env.sunDir.set(Math.cos(ang) * 0.55, Math.sin(ang), 0.42).normalize();
    if (this.env.sunDir.y < 0.02) this.env.sunDir.y = 0.02; // keep some fill at night
    this.uniforms.uSunDir.value.copy(this.env.sunDir);
    this.uniforms.uNight.value = this.env.night;

    // Overcast weather is one big soft light, so a hard shadow under it reads
    // wrong. Sun strength doubles as how crisp a shadow the sun can throw.
    this.env.shadowStrength = Math.min(1, w.sunMul * 1.05);

    this.env.skyColor.copy(this.uniforms.uHorizon.value).lerp(this.uniforms.uTop.value, 0.4);
    this.env.fogFar = viewDistance * w.fogMul;
    this.env.fogNear = this.env.fogFar * 0.32;

    if (cameraPos) this.mesh.position.copy(cameraPos);
    this.mesh.scale.setScalar(Math.max(600, viewDistance * 1.4));

    // The surrounding land takes the same light as everything else, so it greys
    // over in bad weather and goes blue at dusk along with the rest. The terms
    // are the voxel shader's, for an upward-facing surface, or the plot's own
    // grass and the field beyond the fence would not be the same green.
    const gu = this.groundMat.uniforms;
    const ndl = Math.max(0, this.env.sunDir.y);
    const wrap = Math.max(0, this.env.sunDir.y * 0.5 + 0.5);
    const amb = this.env.skyColor.clone().multiplyScalar(0.78)
      .add(this.env.sunColor.clone().multiplyScalar(ndl * 0.66 + wrap * 0.22));
    gu.uNear.value.setHex(0x6d9c56).multiply(amb);
    gu.uFar.value.setHex(0x6f8a5c).multiply(amb);
    gu.uFogColor.value.copy(this.env.fogColor);
    gu.uFogNear.value = this.env.fogNear;
    gu.uFogFar.value = this.env.fogFar;
    if (cameraPos) {
      this.ground.position.set(cameraPos.x, this.groundY, cameraPos.z);
      this.ground.scale.setScalar(Math.max(2000, viewDistance * 3));
    }
    return this.env;
  }
}

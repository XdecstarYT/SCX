import * as THREE from 'three';

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

    this.env = {
      sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
      sunColor: new THREE.Color(0xfffaf0),
      skyColor: new THREE.Color(0x8fb6d8),
      groundColor: new THREE.Color(0x424a55),
      fogColor: new THREE.Color(0xa8c4dc),
      night: 0,
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

    this.env.skyColor.copy(this.uniforms.uHorizon.value).lerp(this.uniforms.uTop.value, 0.4);
    this.env.fogFar = viewDistance * w.fogMul;
    this.env.fogNear = this.env.fogFar * 0.32;

    if (cameraPos) this.mesh.position.copy(cameraPos);
    this.mesh.scale.setScalar(Math.max(600, viewDistance * 1.4));
    return this.env;
  }
}

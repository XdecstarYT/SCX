import * as THREE from 'three';

/**
 * Sun shadows.
 *
 * A voxel scene without them reads as plastic: a canopy over a stand throws
 * nothing on the seats below it, a stadium throws nothing on its own car park,
 * and every surface facing the same way is exactly the same tone no matter
 * what is in front of it. Face shading and corner occlusion give an object its
 * own form; only a shadow puts it in a place.
 *
 * This is a hand-rolled pass rather than Three's built-in one because the
 * world uses a custom ShaderMaterial that knows nothing about Three's light
 * uniforms. One orthographic depth render, fitted around whatever the camera
 * is looking at, sampled back with a four-tap blur. It is the single most
 * expensive thing the renderer does, so it is a setting, and a phone can turn
 * it off and lose nothing else.
 */
const DEPTH_VERT = /* glsl */`
  void main() {
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * local;
  }
`;

const DEPTH_FRAG = /* glsl */`
  void main() { gl_FragColor = vec4(1.0); }
`;

export class SunShadows {
  constructor(size = 1024) {
    this.size = size;
    this.target = new THREE.WebGLRenderTarget(size, size);
    this.target.texture.minFilter = THREE.NearestFilter;
    this.target.texture.magFilter = THREE.NearestFilter;
    this.target.texture.generateMipmaps = false;
    this.target.depthTexture = new THREE.DepthTexture(size, size);
    this.target.depthTexture.type = THREE.UnsignedIntType;
    this.target.depthTexture.minFilter = THREE.NearestFilter;
    this.target.depthTexture.magFilter = THREE.NearestFilter;

    // Fitted per frame; the extents are set in update().
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
    this.matrix = new THREE.Matrix4();
    this.depthMat = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      // Front faces only would leave the classic acne on every lit surface;
      // drawing the back faces instead pushes the recorded depth to the far
      // side of each block, which is a whole voxel of bias for free.
      side: THREE.BackSide,
    });
    this.enabled = true;
  }

  /** Aim the sun camera at what the player is looking at. */
  update(sunDir, focus, radius) {
    const r = Math.max(30, radius);
    const c = this.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.near = 1; c.far = r * 4 + 200;
    // Stand the camera off along the sun direction, far enough back that
    // nothing tall in the scene falls behind its near plane.
    const dist = r * 2 + 100;
    c.position.set(
      focus.x + sunDir.x * dist,
      focus.y + sunDir.y * dist,
      focus.z + sunDir.z * dist);
    c.up.set(0, 1, 0);
    c.lookAt(focus.x, focus.y, focus.z);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    // Snap to whole texels so the shadow edge does not crawl as the camera
    // moves - the single most obvious tell of a badly fitted shadow map.
    const texel = (r * 2) / this.size;
    const view = c.matrixWorldInverse;
    const p = new THREE.Vector3(focus.x, focus.y, focus.z).applyMatrix4(view);
    const dx = Math.round(p.x / texel) * texel - p.x;
    const dy = Math.round(p.y / texel) * texel - p.y;
    c.projectionMatrix.elements[12] += (2 * dx) / (r * 2);
    c.projectionMatrix.elements[13] += (2 * dy) / (r * 2);
    this.matrix.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  }

  /**
   * Draw the casters. `hidden` is everything that must not appear in the
   * shadow map - the sky dome above all, which would otherwise fill it solid.
   */
  render(renderer, scene, hidden) {
    const was = hidden.map((o) => o && o.visible);
    for (const o of hidden) if (o) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false);
    renderer.render(scene, this.camera);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
    hidden.forEach((o, i) => { if (o) o.visible = was[i]; });
  }

  dispose() {
    this.target.dispose();
    this.depthMat.dispose();
  }
}

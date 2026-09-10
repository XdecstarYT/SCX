import { CHUNK_X, CHUNK_Y, CHUNK_Z, BLOCK_SIZE } from '../core/constants.js';
import { block, AIR } from '../data/blocks.js';
import { zone } from '../data/zones.js';
import { Chunk } from './world.js';

const CX = CHUNK_X, CY = CHUNK_Y, CZ = CHUNK_Z;
const PX = CX + 2, PZ = CZ + 2, PY = CY + 2;

/** Per-face brightness so form reads even in flat light. Order: -X +X -Y +Y -Z +Z */
const FACE_SHADE = [0.74, 0.84, 0.52, 1.0, 0.68, 0.92];

const NORMALS = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

const scratchPad = new Uint8Array(PX * PY * PZ);
const scratchZone = new Uint8Array(PX * PY * PZ);
const pidx = (x, y, z) => ((y * PZ) + z) * PX + x;

/**
 * Copy a chunk plus a one-voxel skirt of its neighbours into a flat padded
 * buffer. Face culling then needs no Map lookups at all.
 */
function padChunk(world, chunk) {
  scratchPad.fill(0);
  scratchZone.fill(0);
  const ox = chunk.cx * CX, oz = chunk.cz * CZ;
  for (let y = 0; y < CY; y++) {
    for (let z = -1; z <= CZ; z++) {
      for (let x = -1; x <= CX; x++) {
        let id, zn = 0;
        if (x >= 0 && x < CX && z >= 0 && z < CZ) {
          const i = Chunk.index(x, y, z);
          id = chunk.blocks[i];
          zn = chunk.zones[i];
        } else {
          id = world.getBlock(ox + x, y, oz + z);
        }
        const p = pidx(x + 1, y + 1, z + 1);
        scratchPad[p] = id;
        scratchZone[p] = zn;
      }
    }
  }
}

/** Does a face of `id` survive culling against neighbour `nid` for this pass? */
function faceVisible(id, nid, transparentPass) {
  if (id === AIR) return false;
  const b = block(id);
  if (transparentPass !== !!b.transparent) return false;
  if (nid === AIR) return true;
  const nb = block(nid);
  if (!nb.transparent) return false;      // hidden behind anything opaque
  if (!transparentPass) return true;      // opaque block behind glass: draw it
  return id !== nid;                      // glass/glass interfaces are culled
}

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.emis = [];
    this.idx = [];
    this.count = 0;
  }
  quad(corners, normal, r, g, b, w, h, emis, flip = false) {
    const base = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(corners[i][0], corners[i][1], corners[i][2]);
      this.nor.push(normal[0], normal[1], normal[2]);
      this.col.push(r, g, b);
      this.emis.push(emis);
    }
    // Back faces walk the corners in reverse, so their UVs must follow suit or
    // the panel seams come out stretched.
    if (flip) this.uv.push(0, 0, 0, h, w, h, w, 0);
    else this.uv.push(0, 0, w, 0, w, h, 0, h);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count += 4;
  }
  isEmpty() { return this.count === 0; }
}

/**
 * Greedy-mesh one chunk into merged quads.
 *
 * For every axis and slice we build a mask of visible faces keyed by
 * (blockId, direction), then repeatedly grow the largest possible rectangle of
 * identical entries. A flat concrete wall 20 voxels long becomes 1 quad, not 20.
 *
 * @returns {{opaque: MeshBuilder, transparent: MeshBuilder}}
 */
export function meshChunk(world, chunk) {
  padChunk(world, chunk);
  const out = { opaque: new MeshBuilder(), transparent: new MeshBuilder() };
  for (const pass of [false, true]) {
    greedy(chunk, pass, pass ? out.transparent : out.opaque);
  }
  return out;
}

const DIMS = [CX, CY, CZ];

function greedy(chunk, transparentPass, mb) {
  const ox = chunk.cx * CX * BLOCK_SIZE;
  const oz = chunk.cz * CZ * BLOCK_SIZE;
  const S = BLOCK_SIZE;

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;
    const maskW = DIMS[u], maskH = DIMS[v];
    const mask = new Int32Array(maskW * maskH);

    for (x[d] = -1; x[d] < DIMS[d];) {
      // Build the face mask for this slice.
      let n = 0;
      for (x[v] = 0; x[v] < DIMS[v]; x[v]++) {
        for (x[u] = 0; x[u] < DIMS[u]; x[u]++, n++) {
          const a = scratchPad[pidx(x[0] + 1, x[1] + 1, x[2] + 1)];
          const b = scratchPad[pidx(x[0] + q[0] + 1, x[1] + q[1] + 1, x[2] + q[2] + 1)];
          const aVis = x[d] >= 0 && faceVisible(a, b, transparentPass);
          const bVis = x[d] < DIMS[d] - 1 && faceVisible(b, a, transparentPass);
          // Positive id = face points along +d (owned by a), negative = -d.
          mask[n] = aVis ? a : (bVis ? -b : 0);
        }
      }

      x[d]++;

      // Merge the mask into maximal rectangles.
      n = 0;
      for (let j = 0; j < maskH; j++) {
        for (let i = 0; i < maskW;) {
          const c = mask[n];
          if (c === 0) { i++; n++; continue; }

          let w = 1;
          while (i + w < maskW && mask[n + w] === c) w++;

          let h = 1;
          grow: while (j + h < maskH) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * maskW] !== c) break grow;
            }
            h++;
          }

          const id = Math.abs(c);
          const back = c < 0;
          const dir = d * 2 + (back ? 0 : 1);
          const bl = block(id);
          const shade = FACE_SHADE[dir];
          const col = bl.color;
          const r = (((col >> 16) & 255) / 255) * shade;
          const g = (((col >> 8) & 255) / 255) * shade;
          const bcol = ((col & 255) / 255) * shade;
          const emis = bl.emissive ? 1 : 0;

          x[u] = i; x[v] = j;
          const du = [0, 0, 0]; du[u] = w;
          const dv = [0, 0, 0]; dv[v] = h;

          // Voxel-space corners -> world metres.
          const px = x[0] * S + ox, py = x[1] * S, pz = x[2] * S + oz;
          const c0 = [px, py, pz];
          const c1 = [px + du[0] * S, py + du[1] * S, pz + du[2] * S];
          const c2 = [px + (du[0] + dv[0]) * S, py + (du[1] + dv[1]) * S, pz + (du[2] + dv[2]) * S];
          const c3 = [px + dv[0] * S, py + dv[1] * S, pz + dv[2] * S];

          const nrm = NORMALS[dir];
          const corners = back ? [c0, c3, c2, c1] : [c0, c1, c2, c3];
          mb.quad(corners, nrm, r, g, bcol, w, h, emis, back);

          // Clear the consumed rectangle.
          for (let l = 0; l < h; l++) {
            for (let k = 0; k < w; k++) mask[n + k + l * maskW] = 0;
          }
          i += w; n += w;
        }
      }
    }
  }
}

/**
 * Build the ZONE-mode overlay: the top face of every zoned voxel whose
 * neighbour above is empty, tinted by zone colour. Also greedy-merged.
 */
export function meshZoneOverlay(world, chunk) {
  padChunk(world, chunk);
  const mb = new MeshBuilder();
  const S = BLOCK_SIZE;
  const ox = chunk.cx * CX * BLOCK_SIZE;
  const oz = chunk.cz * CZ * BLOCK_SIZE;
  const mask = new Int32Array(CX * CZ);

  for (let y = 0; y < CY; y++) {
    let n = 0;
    let any = false;
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++, n++) {
        const zn = scratchZone[pidx(x + 1, y + 1, z + 1)];
        const above = scratchPad[pidx(x + 1, y + 2, z + 1)];
        const vis = zn !== 0 && (above === AIR || block(above).transparent);
        mask[n] = vis ? zn : 0;
        if (vis) any = true;
      }
    }
    if (!any) continue;

    n = 0;
    for (let j = 0; j < CZ; j++) {
      for (let i = 0; i < CX;) {
        const c = mask[n];
        if (c === 0) { i++; n++; continue; }
        let w = 1;
        while (i + w < CX && mask[n + w] === c) w++;
        let h = 1;
        grow: while (j + h < CZ) {
          for (let k = 0; k < w; k++) if (mask[n + k + h * CX] !== c) break grow;
          h++;
        }
        const zc = zone(c).color;
        const r = ((zc >> 16) & 255) / 255, g = ((zc >> 8) & 255) / 255, b = (zc & 255) / 255;
        const px = i * S + ox, py = (y + 1) * S + 0.06, pz = j * S + oz;
        mb.quad(
          [[px, py, pz], [px + w * S, py, pz], [px + w * S, py, pz + h * S], [px, py, pz + h * S]],
          [0, 1, 0], r, g, b, w, h, 0
        );
        for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * CX] = 0;
        i += w; n += w;
      }
    }
  }
  return mb;
}

export { MeshBuilder };

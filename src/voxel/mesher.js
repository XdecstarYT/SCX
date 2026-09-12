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

/**
 * Does the voxel at these padded coordinates cast contact shadow on its
 * neighbours? Glass and other see-through blocks do not: a window should let
 * light past rather than darken the wall beside it.
 */
function occludes(px, py, pz) {
  if (px < 0 || py < 0 || pz < 0 || px >= PX || py >= PY || pz >= PZ) return 0;
  const id = scratchPad[pidx(px, py, pz)];
  if (id === AIR) return 0;
  const b = block(id);
  return b.solid && !b.transparent ? 1 : 0;
}

/**
 * Corner ambient occlusion, the standard three-neighbour rule: a corner is
 * darkest when both sides next to it are filled, lighter when one side or the
 * diagonal is, and open otherwise. Returns 0 (darkest) to 3 (open).
 *
 * This is what makes a stack of merged quads read as architecture: without it
 * a bowl of seating, the underside of a canopy and the inside of a vomitory
 * are all the same flat tone, and nothing in the scene looks like it is
 * touching anything else.
 */
function aoCorner(bx, by, bz, uAxis, vAxis, su, sv) {
  const p = [bx, by, bz];
  const a = [0, 0, 0]; a[uAxis] = su;
  const b = [0, 0, 0]; b[vAxis] = sv;
  const s1 = occludes(p[0] + a[0], p[1] + a[1], p[2] + a[2]);
  const s2 = occludes(p[0] + b[0], p[1] + b[1], p[2] + b[2]);
  if (s1 && s2) return 0;
  const c = occludes(p[0] + a[0] + b[0], p[1] + a[1] + b[1], p[2] + a[2] + b[2]);
  return 3 - (s1 + s2 + c);
}

/** All four corners of one face, packed two bits each in c0..c3 order. */
function aoPack(bx, by, bz, uAxis, vAxis) {
  const a0 = aoCorner(bx, by, bz, uAxis, vAxis, -1, -1);
  const a1 = aoCorner(bx, by, bz, uAxis, vAxis, 1, -1);
  const a2 = aoCorner(bx, by, bz, uAxis, vAxis, 1, 1);
  const a3 = aoCorner(bx, by, bz, uAxis, vAxis, -1, 1);
  return a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
}

/** Surface finish -> the shader's numeric id. */
const FINISH_ID = { matte: 0, turf: 1, gloss: 2, seat: 3 };

/** A face whose four corners match can be merged with its neighbours. */
const AO_UNIFORM = new Set([0x00, 0x55, 0xAA, 0xFF]);

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.emis = [];
    this.ao = [];
    this.fin = [];
    this.idx = [];
    this.count = 0;
  }
  quad(corners, normal, r, g, b, w, h, emis, flip = false, ao = null, fin = 0) {
    const base = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(corners[i][0], corners[i][1], corners[i][2]);
      this.nor.push(normal[0], normal[1], normal[2]);
      this.col.push(r, g, b);
      this.emis.push(emis);
      this.ao.push(ao ? ao[i] : 3);
      this.fin.push(fin);
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
    // Corner occlusion for each face in the mask, packed two bits per corner.
    const aoMask = new Int32Array(maskW * maskH);

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
          // Occlusion is sampled from the open side of the face - the voxel the
          // light arrives through - which is `a + q` for a front face and `a`
          // itself for a back one.
          if (mask[n] !== 0) {
            const fx = x[0] + 1 + (aVis ? q[0] : 0);
            const fy = x[1] + 1 + (aVis ? q[1] : 0);
            const fz = x[2] + 1 + (aVis ? q[2] : 0);
            aoMask[n] = aoPack(fx, fy, fz, u, v);
          } else {
            aoMask[n] = 0xFF;
          }
        }
      }

      x[d]++;

      // Merge the mask into maximal rectangles.
      n = 0;
      for (let j = 0; j < maskH; j++) {
        for (let i = 0; i < maskW;) {
          const c = mask[n];
          if (c === 0) { i++; n++; continue; }

          // Faces only merge when their occlusion matches and is even across
          // the face. A corner where the shading varies stays its own quad, so
          // the contact darkening is exact rather than smeared across a wall.
          const ao = aoMask[n];
          const mergeable = AO_UNIFORM.has(ao);

          let w = 1;
          if (mergeable) while (i + w < maskW && mask[n + w] === c && aoMask[n + w] === ao) w++;

          let h = 1;
          if (mergeable) {
            grow: while (j + h < maskH) {
              for (let k = 0; k < w; k++) {
                const m = n + k + h * maskW;
                if (mask[m] !== c || aoMask[m] !== ao) break grow;
              }
              h++;
            }
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
          const fin = FINISH_ID[bl.finish] || 0;

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
          const a0 = ao & 3, a1 = (ao >> 2) & 3, a2 = (ao >> 4) & 3, a3 = (ao >> 6) & 3;
          const aoq = back ? [a0, a3, a2, a1] : [a0, a1, a2, a3];
          mb.quad(corners, nrm, r, g, bcol, w, h, emis, back, aoq, fin);

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
        const px = i * S + ox, py = (y + 1) * S + 0.02, pz = j * S + oz;
        // Wound counter-clockwise seen from above so the +Y face is the front.
        mb.quad(
          [[px, py, pz], [px, py, pz + h * S], [px + w * S, py, pz + h * S], [px + w * S, py, pz]],
          [0, 1, 0], r, g, b, h, w, 0
        );
        for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * CX] = 0;
        i += w; n += w;
      }
    }
  }
  return mb;
}

export { MeshBuilder };

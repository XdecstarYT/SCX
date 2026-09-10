import { BLOCK_SIZE, CHUNK_Y } from '../core/constants.js';
import { AIR } from '../data/blocks.js';

/**
 * Amanatides & Woo voxel DDA. Exact, allocation-free, and independent of
 * mesh geometry, so it works even while chunks are mid-remesh.
 *
 * @returns {{x,y,z, nx,ny,nz, px,py,pz, dist}|null}
 *   hit voxel, face normal, and the empty voxel in front of the face.
 */
export function raycastVoxel(world, origin, dir, maxDist = 260, wantEmpty = false) {
  const S = BLOCK_SIZE;
  let x = Math.floor(origin.x / S);
  let y = Math.floor(origin.y / S);
  let z = Math.floor(origin.z / S);

  const dx = dir.x, dy = dir.y, dz = dir.z;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(S / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(S / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(S / dz) : Infinity;

  const bx = (x + (stepX > 0 ? 1 : 0)) * S;
  const by = (y + (stepY > 0 ? 1 : 0)) * S;
  const bz = (z + (stepZ > 0 ? 1 : 0)) * S;

  let tMaxX = stepX !== 0 ? (bx - origin.x) / dx : Infinity;
  let tMaxY = stepY !== 0 ? (by - origin.y) / dy : Infinity;
  let tMaxZ = stepZ !== 0 ? (bz - origin.z) / dz : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  let guard = 0;

  while (t <= maxDist && guard++ < 4096) {
    if (y >= 0 && y < CHUNK_Y && x >= 0 && z >= 0 && x < world.size && z < world.size) {
      const id = world.getBlock(x, y, z);
      if (id !== AIR) {
        return {
          x, y, z, nx, ny, nz,
          px: x + nx, py: y + ny, pz: z + nz,
          dist: t, block: id,
        };
      }
    } else if (y < 0) {
      return null;
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    } else {
      if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    }
  }
  return null;
}

/** Where a ray meets a horizontal plane, in voxel coords. Used as a fallback
 *  when the player aims at empty sky above their plot. */
export function raycastPlane(origin, dir, planeY) {
  const yWorld = planeY * BLOCK_SIZE;
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (yWorld - origin.y) / dir.y;
  if (t < 0) return null;
  return {
    x: Math.floor((origin.x + dir.x * t) / BLOCK_SIZE),
    y: planeY,
    z: Math.floor((origin.z + dir.z * t) / BLOCK_SIZE),
    dist: t,
  };
}

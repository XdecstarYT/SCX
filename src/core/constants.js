/**
 * Global tuning constants.
 *
 * SCALE: one voxel is 2m x 2m x 2m. This is the sweet spot between
 * "hand-place every block" tedium and having enough detail to shape a
 * recognisable stadium bowl. A regulation football pitch (105m x 68m)
 * lands on ~53 x 34 voxels, which is a single drag with the rect tool.
 */
export const BLOCK_SIZE = 2; // metres per voxel edge

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 64; // world height in voxels (128m)

/** Ground surface sits at this Y. Everything below is bedrock/dirt fill. */
export const GROUND_Y = 8;

/** Land tiers, in voxels per side. Metres = voxels * BLOCK_SIZE. */
export const LAND_TIERS = [
  { size: 128, label: '256m x 256m', cost: 0, name: 'Starter Plot' },
  { size: 160, label: '320m x 320m', cost: 2_500_000, name: 'Extended Grounds' },
  { size: 200, label: '400m x 400m', cost: 12_000_000, name: 'Regional Campus' },
  { size: 256, label: '512m x 512m', cost: 45_000_000, name: 'Mega Sports District' },
];

/** How many spectators one seating voxel represents (2m x 2m of raked seating). */
export const SEATS_PER_VOXEL = 6;
export const VIP_SEATS_PER_VOXEL = 2;
/** Parking voxels required per car (space + aisle at 4m^2 per voxel). */
export const VOXELS_PER_CAR = 5;
export const PEOPLE_PER_CAR = 2.6;

/** Simulation clock: real seconds per in-game day. */
export const SECONDS_PER_DAY = 20;
export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 360;

/**
 * The calendar year a game starts in. A competition is not "the Grand Final",
 * it is "the 2026 Grand Final" - the year is half of what makes hosting one
 * memorable, and the honours board is unreadable without it.
 */
export const START_YEAR = 2026;

export function gameYear(day) {
  return START_YEAR + Math.floor(Math.max(0, day - 1) / DAYS_PER_YEAR);
}

/** Day within the calendar year, 1-based. */
export function dayOfYear(day) {
  return ((Math.max(1, day) - 1) % DAYS_PER_YEAR) + 1;
}

export const MAX_UNDO = 60;

export const START_CASH = 3_500_000;

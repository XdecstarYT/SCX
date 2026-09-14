import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/voxel/world.js';
import { PropLayer, footprintOffsets, rotateOffset, worldBounds } from '../src/voxel/props.js';
import { propId, prop, PROP_BY_KEY, SPORT_EQUIPMENT } from '../src/data/props.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { GROUND_Y, BLOCK_SIZE } from '../src/core/constants.js';
import { applyEdit, priceEdit, applyPlan, pricePlan } from '../src/voxel/buildTools.js';
import { History } from '../src/voxel/history.js';
import { PREFABS, PREFAB_BY_KEY, generatePrefab, transform } from '../src/voxel/prefabs.js';
import { detectVenues } from '../src/venues/venueDetection.js';
import { serializeWorld, deserializeWorld } from '../src/save/serialization.js';

globalThis.performance ??= { now: () => Date.now() };
// The serializer round-trips through base64.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

function pitchWorld(size = 128) {
  const w = new VoxelWorld(size);
  w.generateTerrain();
  for (let x = 20; x < 74; x++) {
    for (let z = 20; z < 55; z++) w.setBlock(x, GROUND_Y - 1, z, blockId('turf'), zoneId('pitch_football'));
  }
  return w;
}

test('rotating a prop four times returns it to where it started', () => {
  for (const key of ['goal_soccer', 'dugout', 'scoreboard_lg', 'lane_rope']) {
    const type = prop(key);
    const a = footprintOffsets(type, 0).map((o) => o.join(',')).sort();
    const b = footprintOffsets(type, 4).map((o) => o.join(',')).sort();
    assert.deepEqual(b, a, `${key} does not come back after four turns`);
  }
});

test('a rotated footprint swaps its width and depth, and stays on the grid', () => {
  const type = prop('goal_soccer');       // 5 x 2
  const flat = footprintOffsets(type, 0);
  const turned = footprintOffsets(type, 1);
  const span = (cells, i) => Math.max(...cells.map((c) => c[i])) - Math.min(...cells.map((c) => c[i])) + 1;
  assert.equal(span(flat, 0), type.foot.w);
  assert.equal(span(flat, 1), type.foot.d);
  assert.equal(span(turned, 0), type.foot.d);
  assert.equal(span(turned, 1), type.foot.w);
  for (const [dx, dz] of turned) {
    assert.ok(Number.isInteger(dx) && Number.isInteger(dz), 'rotation drifted off the grid');
  }
});

test('the geometry turns the same way the footprint does', () => {
  // A soccer goal is wide in x. Turned 90 degrees it must be wide in z.
  const id = propId('goal_soccer');
  const flat = worldBounds({ typeId: id, x: 30, y: GROUND_Y, z: 30, rot: 0 });
  const turned = worldBounds({ typeId: id, x: 30, y: GROUND_Y, z: 30, rot: 1 });
  assert.ok(flat.x1 - flat.x0 > flat.z1 - flat.z0, 'unrotated goal is not wide in x');
  assert.ok(turned.z1 - turned.z0 > turned.x1 - turned.x0, 'rotated goal is not wide in z');
});

test('a tilted part is bounded by where it actually reaches', async () => {
  const { localBounds } = await import('../src/voxel/props.js');
  // A 4 x 1 x 0.2 panel stood on end by a quarter turn about x: its y and z
  // extents swap, and nothing else moves.
  const flat = localBounds({ parts: [[0, 0, 0, 4, 1, 0.2, 0xffffff]] });
  const tipped = localBounds({
    parts: [[0, 0, 0, 4, 1, 0.2, 0xffffff, 0, null, { tilt: [Math.PI / 2, 0, 0] }]],
  });
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);
  near(tipped.x1 - tipped.x0, flat.x1 - flat.x0, 'the tilt changed the width');
  near(tipped.y1 - tipped.y0, flat.z1 - flat.z0, 'height should become the old depth');
  near(tipped.z1 - tipped.z0, flat.y1 - flat.y0, 'depth should become the old height');

  // Half a turn puts it back exactly where it started, which a bounding
  // sphere - the first thing tried here - would not.
  const spun = localBounds({
    parts: [[0, 0, 0, 4, 1, 0.2, 0xffffff, 0, null, { tilt: [Math.PI, 0, 0] }]],
  });
  near(spun.y1 - spun.y0, flat.y1 - flat.y0, 'a half turn changed the height');
  near(spun.z1 - spun.z0, flat.z1 - flat.z0, 'a half turn changed the depth');
});

test('a round part measures the same as the box it replaces', async () => {
  const { localBounds } = await import('../src/voxel/props.js');
  const box = localBounds({ parts: [[0, 1, 0, 0.3, 2, 0.3, 0xffffff]] });
  for (const axis of ['x', 'y', 'z']) {
    const cyl = localBounds({
      parts: [[0, 1, 0, 0.3, 2, 0.3, 0xffffff, 0, null, { shape: 'cyl', axis }]],
    });
    assert.deepEqual(cyl, box, `a ${axis}-axis cylinder should occupy its own w/h/d`);
  }
});

test('a floodlight mast lights the pitch it stands beside', async () => {
  const { detectVenues } = await import('../src/venues/venueDetection.js');
  const w = pitchWorld();
  const before = detectVenues(w, { complexName: 'T' }).venues[0];

  // Four masts round the ground, the way a ground is actually lit.
  for (const [x, z] of [[30, 20], [60, 20], [30, 50], [60, 50]]) {
    w.props.add(propId('floodlight_mast'), x, GROUND_Y, z, 0);
  }
  const after = detectVenues(w, { complexName: 'T' }).venues[0];
  assert.ok(after.lighting > before.lighting,
    `masts should light the ground: ${before.lighting} -> ${after.lighting}`);
  assert.ok(after.ratings.overall >= before.ratings.overall,
    'lighting a ground should not make it worse');
});

test('a first aid point and a row of turnstiles count as the provision they are', async () => {
  const { detectVenues } = await import('../src/venues/venueDetection.js');
  const w = pitchWorld();
  const before = detectVenues(w, { complexName: 'T' }).venues[0];

  w.props.add(propId('medical_post'), 34, GROUND_Y, 24, 0);
  for (let i = 0; i < 4; i++) w.props.add(propId('turnstile'), 30 + i * 2, GROUND_Y, 22, 0);
  const after = detectVenues(w, { complexName: 'T' }).venues[0];

  assert.ok(after.facilities.medical > before.facilities.medical,
    'a staffed first aid point is a medical facility');
  assert.equal(after.facilities.entranceGates, before.facilities.entranceGates + 4,
    'four turnstiles are four more ways in');
  assert.ok(after.ratings.safety >= before.ratings.safety,
    'fitting out a ground should never make it less safe');
});

test('equipment needs solid, empty, unclaimed ground', () => {
  const w = pitchWorld();
  const layer = w.props;
  const id = propId('goal_soccer');

  assert.equal(layer.canPlace(w, id, 40, GROUND_Y, 30, 0).ok, true);
  // Floating: nothing underneath.
  assert.equal(layer.canPlace(w, id, 40, GROUND_Y + 4, 30, 0).ok, false);
  // Occupied: a block in the way.
  w.setBlock(41, GROUND_Y, 30, blockId('concrete'));
  assert.equal(layer.canPlace(w, id, 40, GROUND_Y, 30, 0).ok, false);
  w.setBlock(41, GROUND_Y, 30, 0);
  // Occupied: another prop already there.
  layer.add(id, 40, GROUND_Y, 30, 0);
  assert.equal(layer.canPlace(w, id, 41, GROUND_Y, 30, 0).ok, false);
  // Off the edge of the plot.
  assert.equal(layer.canPlace(w, id, 0, GROUND_Y, 30, 0).ok, false);
});

test('a prop occupies every cell of its footprint, and frees them again', () => {
  const w = pitchWorld();
  const id = propId('dugout');            // 4 x 2
  w.props.add(id, 40, GROUND_Y, 30, 0);
  const cells = w.props.cellsFor(id, 40, GROUND_Y, 30, 0);
  assert.equal(cells.length, 8);
  for (const [x, y, z] of cells) assert.ok(w.props.at(x, y, z), `cell ${x},${z} not claimed`);
  w.props.remove(40, GROUND_Y, 30);
  for (const [x, y, z] of cells) assert.equal(w.props.at(x, y, z), null);
  assert.equal(w.props.size, 0);
});

test('demolishing the ground takes the equipment standing on it, and undo restores both', () => {
  const w = pitchWorld();
  const history = new History(w);
  const id = propId('goal_soccer');
  w.props.add(id, 40, GROUND_Y, 30, 1);
  assert.equal(w.props.size, 1);

  // Remove the turf under the goal's anchor cell.
  const cells = [40, GROUND_Y - 1, 30];
  const price = priceEdit(w, cells, 'demolish', 0);
  assert.equal(price.propsRemoved, 1, 'the goal was not priced into the demolition');
  const batch = applyEdit(w, cells, 'demolish', 0, { label: 'Demolish' });
  history.push(batch);
  assert.equal(w.props.size, 0, 'the goal survived its own pitch being dug up');

  history.undo();
  assert.equal(w.props.size, 1, 'undo did not put the goal back');
  const back = w.props.anchorAt(40, GROUND_Y, 30);
  assert.equal(back.rot, 1, 'undo lost the rotation');
  assert.equal(w.getBlock(40, GROUND_Y - 1, 30), blockId('turf'));

  history.redo();
  assert.equal(w.props.size, 0, 'redo did not take the goal away again');
});

test('every prefab lays down at every rotation without leaving the grid', () => {
  const w = new VoxelWorld(256);
  w.generateTerrain();
  for (const def of PREFABS) {
    for (let rot = 0; rot < 4; rot++) {
      const plan = generatePrefab(w, def.key, { x: 4, y: GROUND_Y, z: 4 }, rot);
      assert.ok(plan.cells.length > 0, `${def.key} rot ${rot} produced nothing`);
      assert.equal(plan.meta.outside, 0, `${def.key} rot ${rot} fell off the plot`);
      const foot = plan.meta.footprint;
      const expect = rot & 1 ? { x: def.size.z, z: def.size.x } : { x: def.size.x, z: def.size.z };
      assert.deepEqual(foot, expect, `${def.key} rot ${rot} reported the wrong footprint`);
      // Nothing may stray outside the reported footprint.
      for (let i = 0; i < plan.cells.length; i += 5) {
        const dx = plan.cells[i] - 4, dz = plan.cells[i + 2] - 4;
        assert.ok(dx >= 0 && dx < foot.x && dz >= 0 && dz < foot.z,
          `${def.key} rot ${rot} placed a block outside its footprint`);
      }
    }
  }
});

test('a prefab pitch is regulation and arrives fully fitted out', () => {
  const w = new VoxelWorld(128);
  w.generateTerrain();
  const plan = generatePrefab(w, 'pitch_soccer', { x: 20, y: GROUND_Y, z: 20 }, 0);
  const price = pricePlan(w, plan.cells, plan.props);
  assert.ok(price.net > 0, 'a full pitch should cost something');
  applyPlan(w, plan.cells, 'Soccer pitch', plan.props);

  const { venues } = detectVenues(w, {});
  assert.equal(venues.length, 1, 'the prefab pitch was not detected as a venue');
  const v = venues[0];
  assert.equal(v.sport, 'football');
  assert.equal(v.field.regulation, 1, 'the prefab pitch is not regulation size');
  assert.ok(v.field.surfaceOk, 'the prefab pitch is not on an approved surface');
  assert.equal(v.equipment.goal, 2, 'the prefab did not fit two goals');
  assert.equal(v.equipment.flag, 4, 'the prefab did not fit four corner flags');
  assert.equal(v.equipment.bench, 2, 'the prefab did not fit two benches');
});

test('a prefab rotated 90 degrees is still regulation', () => {
  const w = new VoxelWorld(128);
  w.generateTerrain();
  const plan = generatePrefab(w, 'pitch_soccer', { x: 20, y: GROUND_Y, z: 20 }, 1);
  applyPlan(w, plan.cells, 'Soccer pitch', plan.props);
  const { venues } = detectVenues(w, {});
  assert.equal(venues.length, 1);
  assert.equal(venues[0].field.regulation, 1, 'a turned pitch lost its regulation size');
  assert.equal(venues[0].equipment.goal, 2, 'a turned pitch lost its goals');
});

test('fitting equipment raises functionality without ever lowering it', () => {
  const bare = new VoxelWorld(128);
  bare.generateTerrain();
  const plan = generatePrefab(bare, 'pitch_soccer', { x: 20, y: GROUND_Y, z: 20 }, 0);
  applyPlan(bare, plan.cells, 'pitch');            // blocks only, no fittings

  const fitted = new VoxelWorld(128);
  fitted.generateTerrain();
  applyPlan(fitted, plan.cells, 'pitch', plan.props);

  const a = detectVenues(bare, {}).venues[0];
  const b = detectVenues(fitted, {}).venues[0];
  assert.ok(b.ratings.functionality > a.ratings.functionality,
    'fitting a pitch out did not improve it');
  assert.ok(a.equipmentMissing.length > 0, 'a bare pitch should list what it is missing');
  assert.ok(a.ratings.issues.some((i) => i.key === 'equipment'),
    'a bare pitch does not say what equipment it needs');
});

test('equipment survives a save and reload, rotation included', () => {
  const w = pitchWorld();
  w.props.add(propId('goal_soccer'), 40, GROUND_Y, 30, 2);
  w.props.add(propId('scoreboard_sm'), 60, GROUND_Y, 44, 3);
  const back = deserializeWorld(serializeWorld(w));
  assert.equal(back.props.size, 2);
  assert.equal(back.props.anchorAt(40, GROUND_Y, 30).rot, 2);
  assert.equal(back.props.anchorAt(60, GROUND_Y, 44).typeId, propId('scoreboard_sm'));
});

test('a world saved before equipment existed still loads', () => {
  const w = pitchWorld();
  const data = serializeWorld(w);
  delete data.props;                       // exactly what an old save looks like
  const back = deserializeWorld(data);
  assert.equal(back.props.size, 0);
  assert.equal(back.getBlock(40, GROUND_Y - 1, 30), blockId('turf'));
});

test('equipment adds its upkeep and power to the complex, not the void', () => {
  const w = pitchWorld();
  const before = detectVenues(w, {}).complex;
  w.props.add(propId('scoreboard_lg'), 40, GROUND_Y, 30, 0);
  const after = detectVenues(w, {}).complex;
  const big = prop('scoreboard_lg');
  assert.ok(Math.abs((after.maintenance - before.maintenance) - big.maintenance) < 1e-6);
  assert.ok(Math.abs((after.powerDemand - before.powerDemand) - big.power) < 1e-9);
  assert.ok(Math.abs((after.passiveRevenue - before.passiveRevenue) - big.revenue) < 1e-6);
});

test('every sport with equipment requirements can actually meet them', () => {
  const provided = new Set([...PROP_BY_KEY.values()].map((p) => p.provides));
  for (const [sport, needs] of Object.entries(SPORT_EQUIPMENT)) {
    for (const n of needs) {
      assert.ok(provided.has(n.provides),
        `${sport} needs "${n.provides}" but nothing in the catalogue provides it`);
    }
  }
});

test('every prop a prefab places, and every zone it paints, exists', () => {
  const w = new VoxelWorld(256);
  w.generateTerrain();
  for (const def of PREFABS) {
    const plan = generatePrefab(w, def.key, { x: 4, y: GROUND_Y, z: 4 }, 0);
    for (const p of plan.props) {
      assert.ok(prop(p.typeId), `${def.key} places an unknown prop`);
    }
    assert.ok(def.hint && def.hint.length > 20, `${def.key} has no useful description`);
    assert.ok(def.size.x > 0 && def.size.z > 0);
  }
});

test('a project builds on the site it was ordered for, not the one you are standing on', async () => {
  const { Game } = await import('../src/core/game.js');
  const { blockId: bid } = await import('../src/data/blocks.js');

  const g = new Game();
  g.newGame({ complexName: 'Test' });
  g.state.cash = 400_000_000;
  g.state.reputation.venue = 90;

  // Order a large project here, then move to a second site before it finishes.
  const plan = [];
  for (let x = 20; x < 60; x++) {
    for (let z = 20; z < 40; z++) plan.push(x, GROUND_Y, z, bid('concrete'), 0);
  }
  const staged = g.stageOrApply({ label: 'Test slab', cells: plan, cost: 1000, count: 800 });
  assert.ok(staged, 'the project should have been staged');
  assert.equal(staged.siteId, 'site1');

  const { CITIES } = await import('../src/data/cities.js');
  const other = CITIES.find((c) => c.id !== g.state.sites[0].cityId);
  const bought = g.buySite(other.id);
  assert.ok(!bought?.error, `could not buy a second site: ${bought?.error}`);
  const second = g.state.sites[1];
  assert.ok(second, 'no second site was created');
  g.switchSite(second.id);
  assert.equal(g.siteId, second.id);

  // Run the clock until the project finishes while standing on the other site.
  for (let i = 0; i < 40 && g.state.construction.length; i++) g.tickConstruction(1);
  assert.equal(g.state.construction.length, 0, 'the project never finished');

  const home = g.worlds.get('site1');
  const away = g.worlds.get(second.id);
  assert.equal(home.getBlock(30, GROUND_Y, 30), bid('concrete'),
    'the slab was not built on the site that ordered it');
  assert.notEqual(away.getBlock(30, GROUND_Y, 30), bid('concrete'),
    'the slab was built into the site the player happened to be visiting');
});

test('a staged prefab installs its equipment when the project completes', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ complexName: 'Test' });
  g.state.cash = 400_000_000;

  const plan = generatePrefab(g.world, 'pitch_soccer', { x: 20, y: GROUND_Y, z: 20 }, 0);
  const staged = g.stageOrApply({
    label: 'Soccer Pitch', cells: plan.cells, props: plan.props,
    cost: 300_000, count: plan.cells.length / 5,
  });
  assert.ok(staged, 'a 2,000-block pitch should be staged, not instant');
  assert.equal(g.world.props.size, 0, 'fittings should wait for the blocks');

  for (let i = 0; i < 40 && g.state.construction.length; i++) g.tickConstruction(1);
  assert.equal(g.state.construction.length, 0, 'the pitch never finished');
  assert.equal(g.world.props.size, plan.props.length,
    'the finished pitch did not get its goals, flags and benches');
});

test('a prefab cannot hand you a material research has not unlocked yet', async () => {
  // The palette greys out locked blocks. A prefab that placed one anyway
  // would be a way round the tech tree, not a shortcut through the tedium,
  // so a prefab built out of locked materials has to be locked itself.
  const { BLOCK_BY_ID } = await import('../src/data/blocks.js');
  const { RESEARCH } = await import('../src/data/research.js');
  const ids = new Set(RESEARCH.map((r) => r.id));
  const w = new VoxelWorld(256);
  w.generateTerrain();

  for (const def of PREFABS) {
    if (def.unlock) {
      assert.ok(ids.has(def.unlock), `${def.key} names an unknown project "${def.unlock}"`);
    }
    const plan = generatePrefab(w, def.key, { x: 4, y: GROUND_Y, z: 4 }, 0);
    for (let i = 3; i < plan.cells.length; i += 5) {
      const b = BLOCK_BY_ID[plan.cells[i]];
      if (!b?.unlock) continue;
      assert.equal(b.unlock, def.unlock,
        `${def.key} places ${b.key}, which needs "${b.unlock}", but the prefab `
        + `${def.unlock ? `is gated on "${def.unlock}"` : 'is not gated at all'}`);
    }
    for (const pr of plan.props) {
      const t = prop(pr.typeId);
      if (!t?.unlock) continue;
      assert.equal(t.unlock, def.unlock, `${def.key} places locked equipment ${t.key}`);
    }
  }
});

test('every sport prefab lays a surface that passes its own regulations', async () => {
  // A prefab is the game telling the player what a court is supposed to look
  // like. One that reads as undersized when the analyser measures it would be
  // the game marking its own homework wrong.
  const { ZONES } = await import('../src/data/zones.js');
  const sportPrefabs = PREFABS.filter((d) => d.group === 'field');
  assert.ok(sportPrefabs.length >= 12, 'the field library got smaller');

  for (const def of sportPrefabs) {
    const w = new VoxelWorld(128);
    w.generateTerrain();
    const plan = generatePrefab(w, def.key, { x: 20, y: GROUND_Y, z: 20 }, 0);
    applyPlan(w, plan.cells, def.key, plan.props);
    const { venues } = detectVenues(w, {});
    const v = venues[0];
    assert.ok(v, `${def.key} produced no venue at all`);
    assert.equal(v.field.regulation, 1,
      `${def.key} lays a ${v.sportName} the analyser calls undersized `
      + `(${v.field.w}x${v.field.d}, needs ${v.field.minW}x${v.field.minD})`);
    assert.equal(v.field.surfaceOk, true, `${def.key} lays the wrong surface for its own sport`);
    const z = ZONES.find((x) => x.name === v.sportName);
    assert.ok(z?.group === 'sport', `${def.key} anchored on something that is not a sport`);
  }
});

test('no prefab ships with a roof the inspector would flag', () => {
  // The game warns about roof sections that outrun their supports, and those
  // warnings cause event-day incidents. A prefab the game itself hands you
  // must not fail its own structural check.
  for (const def of PREFABS) {
    const w = new VoxelWorld(200);
    w.generateTerrain();
    // A pitch nearby, so the prefab is inside a detected venue's reach.
    for (let x = 100; x < 154; x++) {
      for (let z = 150; z < 184; z++) w.setBlock(x, GROUND_Y - 1, z, blockId('turf'), zoneId('pitch_football'));
    }
    const plan = generatePrefab(w, def.key, { x: 100, y: GROUND_Y, z: 110 }, 0);
    applyPlan(w, plan.cells, def.key, plan.props);
    const { venues } = detectVenues(w, {});
    assert.equal(venues[0]?.structuralWarnings ?? 0, 0,
      `${def.key} leaves roof sections without support`);
  }
});

test('equipment is lit like the world it stands in', async () => {
  // The voxel shader reads corner occlusion and a surface finish off vertex
  // attributes. The prop geometry supplied neither, so WebGL handed the shader
  // zero for both: every piece of equipment in the game was drawn at 38%
  // ambient light and in flat colour, beside a stadium that had neither.
  const { buildPropGeometry } = await import('../src/world/propRenderer.js');
  const { PROPS, PART_FINISH } = await import('../src/data/props.js');
  const { FINISH_ID } = await import('../src/voxel/mesher.js');

  for (const type of PROPS) {
    const geo = buildPropGeometry(type);
    const ao = geo.getAttribute('ao');
    const fin = geo.getAttribute('fin');
    assert.ok(ao, `${type.key} has no occlusion attribute; it will render dark`);
    assert.ok(fin, `${type.key} has no finish attribute; it will render flat`);
    assert.equal(ao.count, geo.getAttribute('position').count,
      `${type.key} has occlusion for only some of its vertices`);
    assert.equal(fin.count, geo.getAttribute('position').count);

    // A freestanding object is not wedged into a corner: fully open, which is
    // 3 on the shader's 0-3 scale.
    for (let i = 0; i < ao.count; i++) {
      assert.equal(ao.getX(i), 3, `${type.key} vertex ${i} is occluded for no reason`);
    }
    // And every finish it claims is one the shader can actually draw.
    const valid = new Set(Object.values(FINISH_ID));
    for (let i = 0; i < fin.count; i++) {
      assert.ok(valid.has(fin.getX(i)), `${type.key} uses finish id ${fin.getX(i)}`);
    }
  }

  // The mapping itself points at finishes that exist.
  for (const [colour, name] of Object.entries(PART_FINISH)) {
    assert.ok(FINISH_ID[name] !== undefined,
      `part colour ${colour} maps to unknown finish "${name}"`);
  }

  // Something in the catalogue actually uses each of them, or the table is
  // describing materials nothing is made of.
  const used = new Set();
  for (const type of PROPS) {
    const geo = buildPropGeometry(type);
    const fin = geo.getAttribute('fin');
    for (let i = 0; i < fin.count; i++) used.add(fin.getX(i));
  }
  assert.ok(used.size >= 4, `equipment only ever uses ${used.size} materials`);
});

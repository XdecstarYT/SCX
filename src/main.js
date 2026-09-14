import * as THREE from 'three';
import './styles/main.css';

import { Game } from './core/game.js';
import { BLOCK_SIZE, CHUNK_Y, GROUND_Y, SECONDS_PER_DAY } from './core/constants.js';
import { WorldRenderer } from './voxel/renderer.js';
import { BuildController } from './voxel/buildController.js';
import { CameraRig, CAMERA_MODES } from './input/cameras.js';
import { InputController, bindJoystick } from './input/controls.js';
import { SCENARIOS } from './data/scenarios.js';
import { loadScenarioRecords, recordScenario } from './save/scenarioRecords.js';
import { Sky } from './world/sky.js';
import { SunShadows } from './world/shadows.js';
import { pitchRects } from './world/pitchMarks.js';
import { LiveEventShow } from './world/liveEvent.js';
import { Hud } from './ui/hud.js';
import { BuildDock } from './ui/buildDock.js';
import { Hotbar } from './ui/hotbar.js';
import { HeldBlock } from './world/viewmodel.js';
import { PropRenderer } from './world/propRenderer.js';
import { Effects } from './world/effects.js';
import { Screens } from './ui/screens.js';
import { MatchdayScreen } from './ui/matchdayUi.js';
import { EventsUi } from './ui/eventsUi.js';
import { Tutorial } from './ui/tutorial.js';
import { el, fill, emptyState, pill, meter } from './ui/dom.js';
import { saveManager } from './save/saveManager.js';
import { fmtMoney, fmtNum } from './core/economy.js';
import { audio } from './core/audio.js';
import { blockId, block, BLOCK_BY_KEY, BLOCK_CATEGORIES } from './data/blocks.js';
import { PROPS, PROP_BY_KEY, PROP_GROUPS, PROP_BY_ID, propId } from './data/props.js';
import { propSlotKey } from './ui/hotbar.js';
import { PREFABS, PREFAB_GROUPS, generatePrefab } from './voxel/prefabs.js';
import { RESEARCH } from './data/research.js';
import { applyPlan } from './voxel/buildTools.js';
import { zoneId, zone, ZONE_BY_KEY, ZONE_GROUPS, ZONE_BY_ID } from './data/zones.js';
import { instantiate } from './events/eventGenerator.js';
import { EVENT_TEMPLATES } from './data/events.js';
import { makeRng } from './core/rng.js';
import { applyReputation } from './core/gameState.js';
import { PlayDock } from './ui/playDock.js';
import {
  siteStops, spotReport, seatReport, walkProgress, reachStop, recordSeat,
  completeWalk, amenityFields, certificateActive, STOP_RADIUS, CERTIFICATE_DAYS,
} from './core/siteWalk.js';

const AUTOSAVE_SLOT = 'auto';
/** Seconds between repeated placements while a build button is held. */
const REPEAT_INTERVAL = 0.11;
/**
 * How long the button must be held before the repeat starts. Without this a
 * tap places twice: the press fires one action and the very next frame fires
 * the first "repeat" a sixtieth of a second later.
 */
const REPEAT_DELAY = 0.34;

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.viewport = document.getElementById('viewport');
    this.game = new Game();
    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.tab = 'build';
    // Play mode state: where the walk goes, how far the amenities are from
    // everywhere, and what the player is standing on this instant. Play is a
    // value of `tab` like any other screen, so the nav, the dock host and the
    // sheet all behave without a second mode concept to keep in step.
    this.walkStops = [];
    this.amenityFields = null;
    this.walkStamp = -1;
    this.spot = null;
    this.playTimer = 0;
    this.accum = 0;
    this.fps = 0;
    this.frames = 0;
    this.fpsTime = 0;
    this.pausedByShow = false;
  }

  // =============================================================== BOOTSTRAP
  async boot() {
    this.initThree();
    this.hud = new Hud(this.root, this.game);
    this.screens = new Screens(this);
    this.matchdayScreen = new MatchdayScreen(this);
    this.eventsUi = new EventsUi(this);
    this.tutorial = new Tutorial(this);
    this.hud.tutorialHost.append(this.tutorial.node);
    this.fpsNode = el('div.fps', { style: { display: 'none' } });
    this.root.append(this.fpsNode);

    this.hud.onSheetClose = () => {
      // Play mode has no sheet of its own to return from.
      if (this.tab !== 'build' && this.tab !== 'play') this.setTab('build');
    };
    this.hud.onScenario = () => this.showScenario();
    this.wireBus();
    document.getElementById('loading')?.classList.add('hidden');

    const hasSave = await saveManager.hasSave(AUTOSAVE_SLOT).catch(() => false);
    this.showSplash(hasSave);
    this.startLoop();
    this.registerServiceWorker();
  }

  initThree() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isTouch, powerPreference: 'high-performance', alpha: false,
    });
    // Phones gain far more from headroom than from the last few percent of
    // sharpness, and the flat-colour art style hides the difference.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isTouch ? 1.75 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0a1424);
    this.viewport.append(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 4000);
    this.sky = new Sky(this.scene);

    window.addEventListener('resize', () => this.onResize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ================================================================= SPLASH
  showSplash(hasSave) {
    const nameInput = el('input.input', { type: 'text', value: 'Riverside', maxlength: '22', 'aria-label': 'Complex name' });
    const splash = el('div.splash', {},
      el('div', {},
        el('h1', { text: 'SPORTS COMPLEX' }),
        el('h1', { text: 'TYCOON 3D', style: { color: 'var(--blue)' } })),
      el('p.tag', { text: 'Build a sports complex block by block. The game works out what you built, then you bid for the events it can host.' }),
      el('div.acts', {},
        hasSave ? el('button.btn.primary.full', { onclick: () => { splash.remove(); this.continueGame(); } }, 'Continue') : null,
        el('div.field', { style: { marginBottom: 0 } },
          el('label', { text: 'Complex name' }), nameInput),
        el('button.btn.full' + (hasSave ? '' : '.primary'), {
          onclick: () => { splash.remove(); this.newGame(nameInput.value.trim() || 'Riverside'); },
        }, hasSave ? 'Start a new complex' : 'Start building'),
        el('button.btn.full', { onclick: () => this.showScenarioPicker(splash) }, 'Take on a scenario'),
        el('button.btn.full', { onclick: () => this.importSave(true) }, 'Import a save file')),
      el('p.legal', { text: 'All teams, leagues, organisers, sponsors, athletes and events in this game are fictional.' }));
    splash.dataset.hasSave = hasSave ? '1' : '';
    this.root.append(splash);
    this.splash = splash;
  }

  /**
   * The scenario list. A sandbox run starts from an empty field every time;
   * these are somebody else's problems, each with its own clock, and they are
   * where most of the game's replay lives.
   */
  showScenarioPicker(splash) {
    const done = loadScenarioRecords();
    const card = (def) => {
      const best = done[def.id];
      return el('button.scen' + (best ? '.done' : ''), {
        onclick: () => {
          splash?.remove();
          this.splash?.remove();
          this.startScenario(def.id);
        },
      },
        el('div.rowbetween', {},
          el('div.small', { text: def.name }),
          el('span.tiny.faint', { text: '\u2605'.repeat(def.difficulty) })),
        el('div.tiny.faint', { style: { marginTop: '4px' }, text: def.blurb }),
        el('div.tiny.faint', { style: { marginTop: '6px' },
          text: `${def.years} year${def.years === 1 ? '' : 's'} · $${(def.cash / 1e6)}M to start`
            + (best ? ` · best: ${best.toUpperCase()}` : '') }));
    };
    // The picker replaces the splash rather than opening over it: the splash
    // is a full-screen overlay, so a sheet behind it is unclickable, and a
    // front door with two layers is a front door with a bug in it.
    const host = splash || this.splash;
    const page = el('div.splash', {},
      el('div', {}, el('h1', { text: 'SCENARIOS' })),
      el('p.tag', { text: 'Each one starts you somewhere different, with a brief and a '
        + 'deadline. Running out of time is not the end \u2014 the complex stays yours.' }),
      el('div.acts', {}, ...SCENARIOS.map(card),
        el('button.btn.full', {
          onclick: () => { page.remove(); this.showSplash(!!host?.dataset.hasSave); },
        }, 'Back')));
    if (host) { page.dataset.hasSave = host.dataset.hasSave || ''; host.remove(); }
    this.root.append(page);
    this.splash = page;
  }

  startScenario(id) {
    const r = this.game.startScenario(id);
    if (r?.error) { this.toast('warn', 'Could not start', r.error); return; }
    this.hud.closeSheet();
    this.afterWorldReady(true);
    const def = r.def;
    this.hud.openModal(el('div', {},
      el('div.tiny.faint', { text: 'SCENARIO' }),
      el('h2', { text: def.name }),
      el('p.small.faint', { style: { margin: '8px 0 14px' }, text: def.brief }),
      el('div.card.tight', {}, ...def.objectives.map((o) =>
        el('div.small', { style: { padding: '3px 0' }, text: `\u2022 ${o.desc}` }))),
      el('div.small.faint', { style: { marginTop: '10px' },
        text: `${def.years} year${def.years === 1 ? '' : 's'}. Finish early for a better rank.` }),
      el('div.btnrow', { style: { marginTop: '14px' } },
        el('button.btn.primary', { onclick: () => this.hud.closeModal() }, 'Begin'))));
  }

  /** The brief, the clock and how far along each objective is. */
  showScenario() {
    const p = this.game.scenario();
    if (!p) return;
    const body = el('div', {},
      el('div.card.accent', {},
        el('div.tiny.faint', { text: p.run.finished ? 'FINISHED' : 'SCENARIO' }),
        el('div.big.num', { text: `${p.complete} / ${p.total}` }),
        meter(p.overall * 100, 100, p.run.outcome === 'won' ? 'g' : 'gold'),
        el('div.small.faint', { style: { marginTop: '8px' },
          text: p.run.finished
            ? (p.run.outcome === 'won'
              ? `Complete in ${(p.daysUsed / 360).toFixed(1)} years — ${p.run.rank.toUpperCase()}.`
              : 'The deadline passed. The complex is still yours.')
            : `${p.daysLeft} days left of ${p.def.years * 360}.` })),
      el('p.small.faint', { style: { margin: '0 0 12px' }, text: p.def.brief }),
      el('div.stack', {}, ...p.objectives.map((o) =>
        el('div.card.tight' + (o.complete ? '.good' : ''), {},
          el('div.rowbetween', {},
            el('div.small', { text: o.desc }),
            o.complete ? pill('Done', 'ok')
              : el('span.small.mono', { text: `${Math.round(o.value * 100)}%` })),
          el('div', { style: { marginTop: '7px' } }, meter(o.value * 100, 100, o.complete ? 'g' : '')),
          o.detail ? el('div.tiny.faint', { style: { marginTop: '5px' }, text: o.detail }) : null))));
    this.hud.openSheet(p.def.name, body);
  }

  newGame(name) {
    this.game.newGame({ complexName: name });
    this.afterWorldReady(true);
    this.toast('info', `Welcome to ${name}`, 'You have a plot of land and $3.5M. Start with a playing surface.');
  }

  async continueGame() {
    try {
      const loaded = await saveManager.load(AUTOSAVE_SLOT);
      if (!loaded) return this.newGame('Riverside');
      this.game.adopt(loaded.state, loaded.worlds);
      this.afterWorldReady(false);
      this.offlineCatchUp(loaded.state);
    } catch (e) {
      console.error(e);
      this.toast('warn', 'Could not load that save', 'Starting a fresh complex instead.');
      this.newGame('Riverside');
    }
  }

  /** Wire the systems that need a world. Safe to call again after a load. */
  afterWorldReady(isNew) {
    const world = this.game.world;

    if (this.worldRenderer) {
      this.worldRenderer.rebuildAll();
      this.worldRenderer.world = world;
      this.rig.setWorld(world);
    } else {
      this.worldRenderer = new WorldRenderer(this.scene, world);
      this.sky.setPlot(world.size);
      this.rig = new CameraRig(this.camera, world);
      this.controller = new BuildController(this.game, this.scene, this.rig);
      this.controller.restoreBlueprints();
      this.zoneOverlay = false;
      this.controller.onChange = () => {
        this.dock?.render();
        this.hotbar?.syncFromController();
        this.syncRotateButton();
        this.refreshHeld();
        this.refreshStatus();
        this.syncZoneOverlay();
      };
      this.propRenderer = new PropRenderer(this.scene, world);
      this.effects = new Effects(this.scene);
      this.show = new LiveEventShow(this.scene, world);
      this.held = new HeldBlock(this.camera);
      this.scene.add(this.camera);   // so camera children render

      this.hotbar = new Hotbar(this.game, this.controller);
      this.hotbar.onAssign = (slot) => this.openPalette(slot);
      this.hotbar.onLocked = (b) => this.toast('warn', `${b.name} is locked`, 'Complete the matching research project to unlock it.');

      this.dock = new BuildDock(this.game, this.controller);
      this.dock.onOpenPalette = () => this.openPalette(this.game.state.hotbar.active);
      this.dock.onRotate = () => this.rotateHeld(1);
      this.dock.onPlanAction = (a) => this.planAction(a);
      this.dock.onSaveBlueprint = () => this.promptSaveBlueprint();
      this.dock.onOpenBlueprints = () => this.openBlueprints();
      this.dock.onLocked = (b) => this.toast('warn', `${b.name} is locked`, 'Complete the matching research project to unlock it.');

      this.playDock = new PlayDock();
      this.playDock.onAction = (a) => this.playAction(a);
      this.setupInput();
      this.setupTouchLayer();
    }

    this.worldRenderer.world = world;
    this.show.world = world;
    this.propRenderer.setWorld(world);
    this.sky.setPlot(world.size);
    this.controller.rig = this.rig;
    this.worldRenderer.flush();

    // Frame the plot on first load.
    const c = (world.size * BLOCK_SIZE) / 2;
    this.rig.focus.set(c, GROUND_Y * BLOCK_SIZE, c);
    this.rig.dist = world.size * BLOCK_SIZE * 0.42;
    this.rig.pitch = 0.72;

    this.applySettings();
    this.setTab('build');
    this.refresh();
    if (isNew) this.tutorial.show();
    this.lastSaveDay = this.game.state.day;
  }

  offlineCatchUp(state) {
    const away = Date.now() - (state.lastPlayed || Date.now());
    const hours = away / 3_600_000;
    if (hours < 0.25) return;
    // Capped so leaving the tab open overnight is not an exploit.
    const days = Math.min(12, Math.floor(hours * 2));
    if (days < 1) return;
    const before = { cash: state.cash, rep: state.reputation.venue, events: state.stats.eventsHosted };
    this.game.skipDay(days);
    const gained = state.cash - before.cash;
    const hosted = state.stats.eventsHosted - before.events;
    this.toast('info', 'Welcome back', [
      `${days} day${days > 1 ? 's' : ''} passed.`,
      `${gained >= 0 ? 'Generated' : 'Lost'} ${fmtMoney(Math.abs(gained))}.`,
      hosted ? `${hosted} event${hosted > 1 ? 's' : ''} completed.` : null,
    ].filter(Boolean).join(' '));
  }

  // ================================================================== INPUT
  setupInput() {
    this.input = new InputController(this.canvas, this.rig, {
      onTap: (ndc, button, locked) => this.onTap(ndc, button, locked),
      onLongPress: (ndc) => this.onLongPress(ndc),
      onAim: () => this.controller.updateAim(this.aimNdc()),
      onHotbar: (i) => this.selectHotbar(i),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onRotate: (d) => this.rotateHeld(d),
      onCycleCamera: () => this.cycleCamera(),
      onCycleHotbar: (d) => this.hotbar?.cycle(d),
      onPick: () => this.pickBlock(),
      onToggleFirstPerson: () => this.setCamera(this.rig.isWalking ? 'free' : 'first'),
      onSave: () => this.saveNow(),
      onEscape: () => this.onEscape(),
      onLockChange: (locked) => { this.crosshair.style.display = locked || this.rig.isWalking ? '' : 'none'; },
    });

    this.crosshair = el('div.crosshair', { style: { display: 'none' } });
    this.hud.touchLayer.append(this.crosshair);
  }

  setupTouchLayer() {
    this.joy = el('div.joy', { style: { display: 'none' } }, el('div.knob'));
    this.resetJoy = bindJoystick(this.joy, this.input);

    // Holding these repeats the action, so a wall is one sweep, not forty taps.
    const holdButton = (node, button) => {
      const start = (e) => { e.preventDefault(); this.input.beginHold(button); this.onTap(null, button, true); };
      const stop = () => { if (this.input.heldAction === button) this.input.releaseHold(); };
      node.addEventListener('pointerdown', start);
      node.addEventListener('pointerup', stop);
      node.addEventListener('pointercancel', stop);
      node.addEventListener('pointerleave', stop);
      return node;
    };

    this.placeBtn = holdButton(el('button.abtn.place', { 'aria-label': 'Place block' }, '\u25A0'), 0);
    this.removeBtn = holdButton(el('button.abtn.remove', { 'aria-label': 'Remove block' }, '\u2715'), 2);
    this.pickBtn = el('button.abtn.sm', {
      'aria-label': 'Hold the block you are looking at', title: 'Pick block',
      onclick: () => this.pickBlock(),
    }, '\u2318');
    this.jumpBtn = el('button.abtn.sm', { 'aria-label': 'Jump', onclick: () => this.rig.jump() }, '\u2191');
    this.rotBtn = el('button.abtn.sm.rot', {
      'aria-label': 'Rotate the piece you are holding 90 degrees', title: 'Rotate 90\u00B0',
      onclick: () => this.rotateHeld(1),
    }, '\u21BB');
    this.actionPad = el('div.actionpad', { style: { display: 'none' } },
      this.jumpBtn, this.rotBtn, this.pickBtn, this.removeBtn, this.placeBtn);
    this.hud.touchLayer.append(this.joy, this.actionPad);
  }

  aimNdc() {
    if (this.rig.isWalking || this.input?.pointerLocked) return null; // centre ray
    return this.lastNdc || { x: 0, y: 0 };
  }

  /** Ask before a demolition that would be painful to undo by hand. */
  /**
   * Draw the sun's depth buffer, fitted around what the camera is looking at.
   *
   * Strength fades out at night - there is no sun to cast one - and with the
   * weather, because an overcast sky is one big soft light and a hard shadow
   * under it looks wrong.
   */
  renderShadows(env) {
    const want = this.shadowQuality();
    if (!want) {
      if (this.shadows) { this.worldRenderer.setShadow(null, 0); this.propRenderer.setShadow(null, 0); }
      return;
    }
    if (!this.shadows) this.shadows = new SunShadows(want);
    const amt = Math.max(0, 1 - env.night * 1.35) * (env.shadowStrength ?? 1);
    if (amt <= 0.01) {
      this.worldRenderer.setShadow(null, 0);
      this.propRenderer.setShadow(null, 0);
      return;
    }
    // Fit the map to roughly what is on screen: tight when walking, wide when
    // surveying the whole site.
    const focus = this.rig.isWalking ? this.rig.pos : this.rig.focus;
    const radius = this.rig.isWalking ? 70 : Math.min(360, 40 + this.rig.dist * 0.85);
    this.shadows.update(env.sunDir, focus, radius);
    this.shadows.render(this.renderer, this.scene, [
      this.sky.mesh, this.controller.ghost, this.controller.outline,
      this.controller.bbox, this.controller.propGhost?.group,
      this.effects.particles, this.effects.flashes, this.camera,
    ]);
    this.worldRenderer.setShadow(this.shadows, amt);
    this.propRenderer.setShadow(this.shadows, amt);
  }

  /** Shadow map size for the current setting, or 0 for off. */
  shadowQuality() {
    const q = this.game?.state?.settings?.shadows ?? 'auto';
    if (q === 'off') return 0;
    if (q === 'high') return 2048;
    if (q === 'on') return 1024;
    // Auto: on everywhere but a touch device, which needs the headroom more
    // than it needs the shadow.
    return this.isTouch ? 0 : 1024;
  }

  /**
   * The finale: every long-term goal complete.
   *
   * Not a game over - the complex is still there and still yours - but the
   * thirteen goals are the closest thing this game has to an ending, and
   * finishing all of them had until now produced no acknowledgement at all.
   * It reads back what was actually built rather than congratulating in the
   * abstract.
   */
  showLegacy(l) {
    const row = (k, v) => el('div.rowbetween', { style: { padding: '3px 0' } },
      el('span.small.faint', { text: k }), el('span.small.mono', { text: v }));
    audio.play('achievement');
    this.hud.openModal(el('div', {},
      el('div.tiny.faint', { text: 'EVERY LONG-TERM GOAL COMPLETE' }),
      el('h2', { text: l.complexName }),
      el('p.small.faint', { style: { margin: '8px 0 14px' },
        // Read off the list rather than written out: this said "thirteen out
        // of thirteen" for two releases after the list grew past thirteen.
        text: `All ${l.goals} of them, in ${l.years > 0 ? `${l.years} year${l.years === 1 ? '' : 's'} and ` : ''}`
          + `${l.day % 360} days. There is nothing left on the list - which only means the`
          + ' list has run out, not the plot. Keep building.' }),
      el('div.card.tight', {},
        row('Cities', String(l.cities)),
        row('Registered venues', String(l.venues)),
        row('Total capacity', l.capacity.toLocaleString()),
        l.bestVenue ? row('Largest ground',
          `${l.bestVenue.name} · ${l.bestVenue.capacity.toLocaleString()} · rating ${l.bestVenue.rating}`) : null,
        row('Events hosted', String(l.events)),
        row('Through the gates', l.attendance.toLocaleString()),
        row('Lifetime profit', fmtMoney(l.profit)),
        row('Blocks placed', l.blocks.toLocaleString()),
        row('Reputation', `${l.reputation} / 100`),
        l.honours ? row('Competitions staged', String(l.honours.count)) : null,
        l.honours?.biggest ? row('Biggest occasion',
          `${l.honours.biggest.name} \u00b7 ${l.honours.biggest.attendance.toLocaleString()}`) : null),
      l.honours?.lines?.length ? el('div.tiny.faint', { style: { marginTop: '10px' },
        text: `On the board: ${l.honours.lines.join(', ')}.` }) : null,
      el('div.btnrow', { style: { marginTop: '14px' } },
        el('button.btn.primary', { onclick: () => this.hud.closeModal() }, 'Keep building'))));
  }

  askConfirm(c) {
    this.hud.openModal(el('div', {},
      el('h2', { text: c.title }),
      el('p.small.faint', { style: { margin: '8px 0 14px' }, text: c.body }),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Keep it'),
        el('button.btn.danger', {
          onclick: () => {
            this.hud.closeModal();
            this.controller.updateAim(this.aimNdc());
            this.handleActResult(this.controller.act(c.button ?? 0, true));
          },
        }, 'Remove it'))));
  }

  /**
   * Dust, sparks and a flash for whatever the last edit actually changed.
   * Driven off the history batch so it always matches the world, however the
   * edit was made.
   */
  emitEffects() {
    if (!this.effects?.enabled) return;
    const b = this.game.history.undoStack[this.game.history.undoStack.length - 1];
    if (!b || b === this._lastFxBatch) return;
    this._lastFxBatch = b;

    for (const op of b.props) {
      const t = PROP_BY_ID[op.typeId];
      if (!t) continue;
      const w = Math.max(t.foot.w, t.foot.d);
      if (op.op === 'add') this.effects.propPlaced(op.x, op.y, op.z, t.color, w);
      else this.effects.removed(op.x, op.y, op.z, t.color);
    }

    // Sample rather than spray: a 2,000-block fill needs a hint of dust, not
    // two thousand particle bursts.
    const n = b.pos.length;
    if (n === 0) return;
    const want = Math.min(14, n);
    const step = Math.max(1, Math.floor(n / want));
    for (let i = 0; i < n; i += step) {
      const p = b.pos[i];
      const x = p & 511, z = (p >> 9) & 511, y = (p >> 18) & 127;
      const after = b.newB[i], before = b.prevB[i];
      if (after) this.effects.placed(x, y, z, block(after).color);
      else if (before) this.effects.removed(x, y, z, block(before).color);
    }
  }

  onTap(ndc, button, fromButton) {
    if (this.hud.modalOpen) return;
    if (this.show?.active) { this.show.skip(); return; }
    if (this.tab === 'play') {
      if (ndc) this.lastNdc = ndc;
      else if (fromButton) this.lastNdc = { x: 0, y: 0 };
      if (!this.isTouch && this.rig.isWalking && !this.input.pointerLocked && !fromButton) {
        this.input.requestLock();
        return;
      }
      this.playInteract();
      return;
    }
    if (this.tab !== 'build') { this.setTab('build'); return; }

    // Tapping the world aims where you tapped; the action buttons aim at the
    // crosshair in the middle of the screen.
    if (ndc) this.lastNdc = ndc;
    else if (fromButton) this.lastNdc = { x: 0, y: 0 };
    // In first person on desktop, the first click grabs the pointer.
    if (!this.isTouch && this.rig.isWalking && !this.input.pointerLocked && !fromButton) {
      this.input.requestLock();
      return;
    }
    this.controller.updateAim(this.aimNdc());
    const res = this.controller.act(button);
    this.handleActResult(res);
  }

  handleActResult(res) {
    if (!res) return;
    if (res.confirm) { this.askConfirm(res.confirm); return; }
    if (res.error) { this.toast('warn', 'Cannot build', res.error); audio.play('deny'); return; }
    if (res === 'inspect') { this.showInspector(); return; }
    if (res === 'pick') { this.pickBlock(); return; }
    if (typeof res === 'string') {
      this.held?.punch();
      this.emitEffects();
      audio.play(this.controller.mode === 'demolish' ? 'remove' : 'place');
      this.hud.setStatus(res);
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => this.refreshStatus(), 1800);
    }
    this.refresh();
  }

  onLongPress(ndc) {
    this.lastNdc = ndc;
    this.controller.updateAim(ndc);
    this.controller.doInspect();
    this.showInspector();
  }

  onEscape() {
    if (this.hud.modalOpen) { this.hud.closeModal(); return; }
    if (this.hud.sheetOpen) { this.hud.closeSheet(); return; }
    if (this.controller.anchor) { this.controller.anchor = null; this.controller.refreshPreview(); this.refreshStatus(); return; }
    this.hud.setStatus(null);
  }

  /** Turn whatever is in hand 90 degrees, and say which way it now faces. */
  rotateHeld(dir = 1) {
    if (this.tab !== 'build') return;
    // Re-aim first so the preview turns under the crosshair straight away,
    // rather than waiting for the next time the player moves the camera.
    this.controller.updateAim(this.aimNdc());
    const msg = this.controller.rotate(dir);
    if (msg) {
      this.hud.setStatus(msg);
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => this.refreshStatus(), 1500);
    }
    audio.play('ui');
    this.dock?.render();
  }

  selectHotbar(i) {
    this.hotbar.select(i);
    this.refreshBuildUi();
  }

  cycleCamera() {
    const idx = CAMERA_MODES.findIndex((m) => m.key === this.rig.mode);
    this.setCamera(CAMERA_MODES[(idx + 1) % CAMERA_MODES.length].key);
  }

  setCamera(mode) {
    this.rig.setMode(mode);
    const walking = this.rig.isWalking;
    this.joy.style.display = this.isTouch && walking ? '' : 'none';
    this.jumpBtn.style.display = walking ? '' : 'none';
    this.pickBtn.style.display = walking ? '' : 'none';
    this.crosshair.style.display = (walking || (this.isTouch && this.tab === 'build')) ? '' : 'none';
    if (!walking) this.input.exitLock();
    this.resetJoy();
    if (this.tab === 'build') this.refreshBuildUi();
    this.refresh();
  }

  /**
   * Walking around, the full dock is in the way. Collapse it to a hotbar and
   * a few mode chips - the only chrome you need to build with.
   */
  get immersive() { return this.rig.isWalking && this.tab === 'build'; }

  buildImmersiveBar() {
    const bc = this.controller;
    const chip = (key, label, cls = '') => el('button.imchip' + (cls ? '.' + cls : '') + (bc.mode === key ? '.on' : ''), {
      onclick: () => { bc.setMode(key); this.refreshBuildUi(); },
    }, label);
    return el('div.immersive', {},
      chip('build', 'Build'),
      chip('zone', 'Zone', 'zone'),
      chip('demolish', 'Break', 'demolish'),
      chip('inspect', 'Inspect'),
      bc.holdingProp || bc.holdingPrefab
        ? el('button.imchip.rot', { onclick: () => this.rotateHeld(1) }, '\u21BB Rotate')
        : null,
      el('button.imchip', { onclick: () => this.setCamera('free') }, '\u2191 Overview'),
      el('button.imchip', { onclick: () => this.openPalette(this.game.state.hotbar.active) }, 'Palette'));
  }

  /** The rotate button only appears when something in hand can actually turn. */
  syncRotateButton() {
    if (!this.rotBtn) return;
    const bc = this.controller;
    const rotatable = this.tab === 'build' && (bc.holdingProp || bc.holdingPrefab
      || (bc.mode === 'blueprint' && bc.tool === 'paste' && bc.clipboard));
    this.rotBtn.style.display = rotatable ? '' : 'none';
  }

  /** Rebuild whichever build UI is appropriate for the current camera. */
  refreshBuildUi() {
    if (this.tab !== 'build') { this.hud.setDock(null); return; }
    this.hotbar.render();
    this.syncRotateButton();
    if (this.immersive) {
      this.hud.setDock(el('div', {}, this.buildImmersiveBar(), this.hotbar.wrap));
    } else {
      this.hud.setDock(el('div', {}, this.dock.node, this.hotbar.wrap));
      this.dock.render();
    }
    this.refreshHeld();
    this.syncZoneOverlay();
  }

  /** Show what the player is holding, in-hand and in the hotbar. */
  refreshHeld() {
    if (!this.held) return;
    const bc = this.controller;
    const zoneMode = bc.mode === 'zone';
    const show = this.rig.isWalking && this.tab === 'build'
      && ['build', 'zone'].includes(bc.mode);
    if (show) {
      if (zoneMode) this.held.set('zone', bc.zoneKey);
      else if (bc.propKey) this.held.set('prop', bc.propKey);
      else this.held.set('block', block(bc.material).key);
    }
    this.held.setVisible(show);
  }

  /** Eyedropper: hold whatever is under the crosshair. */
  pickBlock() {
    if (this.tab !== 'build') return;
    this.controller.updateAim(this.aimNdc());
    const picked = this.controller.pickTarget();
    if (!picked) { this.toast('info', 'Nothing to pick', 'Point at a block first.'); return; }
    if (picked.kind === 'zone' && this.controller.mode !== 'zone') this.controller.setMode('zone');
    if (picked.kind !== 'zone' && this.controller.mode === 'zone') this.controller.setMode('build');
    if (picked.kind === 'prop') {
      // Picking a goal also matches how it is turned, so the next one lines up.
      this.controller.rotation = picked.rot || 0;
      this.hotbar.pick(propSlotKey(picked.key));
    } else {
      this.hotbar.pick(picked.key);
    }
    this.refreshBuildUi();
    audio.play('ui');
  }

  /**
   * The full palette, opened from a hotbar slot. Choosing something puts it
   * straight into that slot.
   */
  openPalette(slot) {
    const bc = this.controller;
    const zoneMode = bc.mode === 'zone';
    // Remember where you were last, so picking three roads in a row does not
    // mean three trips back through the categories.
    this.paletteGroup = this.paletteGroup || { block: 'structure', zone: 'sport' };
    const kind = zoneMode ? 'zone' : 'block';
    let group = this.paletteGroup[kind];

    // Equipment sits in the same palette as materials - it is the same motion -
    // but behind a top-level switch, because fourteen category chips in one
    // scrolling row is a phone-width scavenger hunt.
    const propGroupKeys = new Set(PROP_GROUPS.map((g) => g.key));
    let isProps = !zoneMode && propGroupKeys.has(group);
    if (!zoneMode && !isProps && !BLOCK_CATEGORIES.some((c) => c.key === group)) group = 'structure';

    // The search box lives outside the re-rendered part, or typing a second
    // character would tear out the field the player is typing into.
    let query = '';
    const search = el('input.input.search', {
      type: 'search', placeholder: 'Search everything\u2026',
      'aria-label': 'Search materials, fittings, zones and structures',
      oninput: (e) => { query = e.target.value.trim(); render(); },
    });
    const results = el('div');
    const body = el('div', {}, el('div.field', { style: { marginBottom: '10px' } }, search), results);

    const render = () => {
      if (query) { fill(results, this.paletteSearch(query, slot)); return; }
      const groups = zoneMode ? ZONE_GROUPS : isProps ? PROP_GROUPS : BLOCK_CATEGORIES;
      if (!groups.some((g) => g.key === group)) {
        group = groups[0].key;
        this.paletteGroup[kind] = group;
      }
      const items = zoneMode
        ? [...ZONE_BY_KEY.values()].filter((z) => z.group === group)
        : isProps
          ? [...PROP_BY_KEY.values()].filter((p) => p.group === group)
          : [...BLOCK_BY_KEY.values()].filter((b) => b.category === group);

      const kindTab = (label, props, title) => el('button.tab' + (isProps === props ? '.on' : ''), {
        title,
        onclick: () => {
          isProps = props;
          group = props ? PROP_GROUPS[0].key : 'structure';
          this.paletteGroup[kind] = group;
          render();
        },
      }, label);

      fill(results,
        zoneMode ? null : el('div.tabs', { style: { padding: '0 0 8px' } },
          kindTab('Materials', false, 'Blocks you build with'),
          kindTab('Equipment', true, 'Goals, hoops, nets, benches and scoreboards')),
        el('div.small.faint', { style: { marginBottom: '10px' },
          text: isProps
            ? `Equipment goes in slot ${slot + 1} like any block. Rotate it with the \u21BB button before you place it.`
            : `Choose what goes in slot ${slot + 1}. Long-press any slot to change it again later.` }),
        el('div.catrow', { style: { marginBottom: '10px' } }, ...groups.map((g) =>
          el('button.cat' + (group === g.key ? '.on' : '') + (isProps ? '.equip' : ''), {
            onclick: () => { group = g.key; this.paletteGroup[kind] = g.key; render(); },
          }, g.name))),
        el('div.palette', {}, ...items.map((item) => {
          const locked = !zoneMode && item.unlock && !this.game.isUnlocked(item.unlock);
          return el('button.palette-item' + (locked ? '.locked' : ''), {
            'aria-label': `${item.name}${locked ? ' (locked)' : ''}`,
            title: item.hint || item.name,
            onclick: () => {
              if (locked) { this.toast('warn', `${item.name} is locked`, 'Complete the matching research project to unlock it.'); return; }
              this.hotbar.assign(item.isProp ? propSlotKey(item.key) : item.key, slot);
              this.refreshBuildUi();
              // Close on the next frame: tearing the sheet down inside the
              // click handler lets the release land on whatever was behind it.
              requestAnimationFrame(() => this.hud.closeSheet());
            },
          },
            el('span.chipc', { style: { background: '#' + item.color.toString(16).padStart(6, '0') } }),
            el('span.n', { text: item.name }),
            el('span.c', { text: locked ? '\u{1F512}' : zoneMode
              ? (item.regulation ? `${item.regulation.w}\u00D7${item.regulation.d}` : item.capacity ? `${item.capacity}/blk` : '\u2014')
              : '$' + item.cost.toLocaleString() }));
        })));
    };
    render();
    this.hud.openSheet(zoneMode ? 'Choose a zone' : 'Catalogue', body);
  }

  /**
   * One search across the whole catalogue: materials, fittings, zones and
   * prefabricated structures together. Categories are how you browse; this is
   * how you find the thing you already have a name for, and it crosses the
   * Materials/Equipment divide that browsing cannot.
   */
  paletteSearch(query, slot) {
    const q = query.toLowerCase();
    const hit = (...fields) => fields.some((f) => f && String(f).toLowerCase().includes(q));
    const named = (name) => (String(name).toLowerCase().includes(q) ? 0 : 1);
    const g = this.game;

    const rows = [];
    for (const b of BLOCK_BY_KEY.values()) {
      if (b.key === 'air') continue;
      if (!hit(b.name, b.category, b.hint)) continue;
      rows.push({ rank: named(b.name), kind: 'Material', name: b.name, sub: b.category, color: b.color,
        cost: b.cost, locked: b.unlock && !g.isUnlocked(b.unlock),
        pick: () => {
          // A material is equally at home in Arrange, where it is the paint.
          if (this.controller.mode !== 'arrange') this.controller.setMode('build');
          this.hotbar.assign(b.key, slot);
        } });
    }
    for (const p of PROP_BY_KEY.values()) {
      if (!hit(p.name, p.group, p.hint, p.sport)) continue;
      rows.push({ rank: named(p.name), kind: 'Fitting', name: p.name, sub: p.group, color: p.color,
        cost: p.cost, locked: p.unlock && !g.isUnlocked(p.unlock),
        pick: () => { this.controller.setMode('build'); this.hotbar.assign(propSlotKey(p.key), slot); } });
    }
    for (const z of ZONE_BY_KEY.values()) {
      if (!hit(z.name, z.group)) continue;
      rows.push({ rank: named(z.name), kind: 'Zone', name: z.name, sub: z.group, color: z.color, cost: null,
        pick: () => { this.controller.setMode('zone'); this.hotbar.assign(z.key, slot); } });
    }
    for (const def of PREFABS) {
      if (!hit(def.name, def.group, def.hint)) continue;
      rows.push({ rank: named(def.name), kind: 'Structure', name: def.name, sub: `${def.size.x}\u00D7${def.size.z} blocks`,
        color: 0x9aa3ad, cost: this.estimatePrefab(def).cost,
        locked: def.unlock && !g.isUnlocked(def.unlock),
        pick: () => { this.controller.setPrefab(def.key); } });
    }

    if (!rows.length) {
      return el('div.card', {}, emptyState('\u2315', `Nothing in the catalogue matches "${query}".`));
    }
    // Things whose name matches come first, then by kind, then cheapest, so a
    // search for "roof" opens on roof materials rather than on a gym whose
    // description happens to mention one.
    const order = { Material: 0, Fitting: 1, Zone: 2, Structure: 3 };
    rows.sort((a, b) => (a.rank - b.rank)
      || (order[a.kind] - order[b.kind])
      || ((a.cost ?? 0) - (b.cost ?? 0)));

    return el('div.stack', {},
      el('div.tiny.faint', { text: `${rows.length} match${rows.length === 1 ? '' : 'es'}. Choosing one puts it in slot ${slot + 1} and switches to the mode it belongs to.` }),
      ...rows.slice(0, 60).map((r) => el('button.card.tight.tap' + (r.locked ? '.off' : ''), {
        disabled: !!r.locked,
        'aria-label': `${r.name}, ${r.kind}${r.locked ? ', locked' : ''}`,
        onclick: () => {
          r.pick();
          this.refreshBuildUi();
          requestAnimationFrame(() => this.hud.closeSheet());
        },
      },
        el('div.rowbetween', {},
          el('div.palrow', {},
            el('span.chipc', { style: { background: '#' + r.color.toString(16).padStart(6, '0') } }),
            el('div', {},
              el('div.small', { text: r.name }),
              el('div.tiny.faint', { text: `${r.kind} \u00B7 ${r.sub}` }))),
          el('div.small.mono' + (r.locked ? '.faint' : ''), {
            text: r.locked ? 'Locked' : r.cost === null ? '\u2014' : fmtMoney(r.cost) })))),
      rows.length > 60 ? el('div.tiny.faint', { text: `\u2026 and ${rows.length - 60} more. Narrow the search.` }) : null);
  }


  // ============================================================== PLAY MODE
  /**
   * Build mode asks what a thing costs. Play mode asks what it is like. The
   * split is real rather than cosmetic: the ghost and the dock go away, taps
   * stop editing the world, and everything on screen is measured from where
   * the player is standing instead of from the plot as a whole.
   */
  enterPlay() {
    const wasFlying = !this.rig.isWalking;
    if (wasFlying) this.setCamera('first');
    this.controller.setVisible(false);
    this.controller.cancelMove?.();
    this.held?.setVisible(false);
    this.worldRenderer.setZoneMode(false);
    this.actionPad.style.display = 'none';
    this.joy.style.display = this.isTouch ? '' : 'none';
    this.jumpBtn.style.display = '';
    this.pickBtn.style.display = 'none';
    this.crosshair.style.display = '';
    this.refreshWalk(true);
    if (wasFlying) this.spawnAtGate();
    this.playTimer = 0;
    this.updatePlay(true, true);
    if (!this.game.state.siteWalk?.walks && !this._playHint) {
      this._playHint = true;
      this.toast('info', 'You are in your own complex',
        'Walk it. The bar at the bottom reads the spot you are standing on — the view, the clear width, how far the toilets are. Visit every stop on the site walk to file an inspection.');
    }
  }

  /**
   * Arrive the way a spectator would: at the turnstiles if there are any,
   * otherwise at whatever the first stop is. Being dropped in the middle of
   * the pitch is a debug camera, not a visit.
   */
  spawnAtGate() {
    const gate = this.walkStops.find((s) => s.kind === 'entrance')
      || this.walkStops.find((s) => s.kind === 'parking' || s.kind === 'transit')
      || this.walkStops[0];
    if (!gate) return;
    const w = this.game.world;
    const v = (this.game.analysis.venues || [])[0];
    // Stand at the edge of the gate that faces the ground, looking in. The
    // middle of an entrance cluster is usually inside the gatehouse, nose
    // against a panel.
    if (v && gate.bounds && gate.zoneKey) {
      const zid = zoneId(gate.zoneKey);
      let best = null, bestD = Infinity;
      for (let x = gate.bounds.minX; x <= gate.bounds.maxX; x++) {
        for (let z = gate.bounds.minZ; z <= gate.bounds.maxZ; z++) {
          if (!w.inBounds(x, 0, z)) continue;
          let y = -1;
          for (let k = CHUNK_Y - 1; k >= 0; k--) if (w.getZone(x, k, z) === zid) { y = k; break; }
          if (y < 0) continue;
          const d = Math.hypot(x - v.centre.x, z - v.centre.z);
          if (d < bestD) { bestD = d; best = { x, y: y + 1, z }; }
        }
      }
      if (best) { gate.spawn = best; }
    }
    const at = gate.spawn || gate;
    // The stop's own y is the floor of the zone, which is where a person
    // stands. The terrain height would be the roof of the gatehouse.
    let y = at.y;
    while (y < CHUNK_Y - 2 && (w.isSolid(at.x, y, at.z) || w.isSolid(at.x, y + 1, at.z))) y++;
    this.rig.pos.set((at.x + 0.5) * BLOCK_SIZE, y * BLOCK_SIZE + 0.1, (at.z + 0.5) * BLOCK_SIZE);
    this.rig.vel.set(0, 0, 0);
    // Face the nearest playing surface, so the first thing in shot is the thing
    // the complex is for.
    if (v) this.rig.fYaw = Math.atan2(v.centre.x - at.x, v.centre.z - at.z);
    this.rig.fPitch = -0.05;
  }

  /** Play mode is on foot, so the flying cameras are not offered there. */
  get cameraModes() {
    return this.tab === 'play' ? CAMERA_MODES.filter((m) => m.key === 'first' || m.key === 'third') : CAMERA_MODES;
  }

  leavePlay() {
    this.controller.setVisible(this.tab === 'build');
    this.crosshair.style.display = (this.rig.isWalking || (this.isTouch && this.tab === 'build')) ? '' : 'none';
  }

  /**
   * The stops and the amenity distance fields, rebuilt when the world has
   * actually changed. Both are whole-plot passes, so they are not something to
   * do on a frame.
   */
  refreshWalk(force = false) {
    const stamp = this.game.state.stats.blocksPlaced + this.game.state.stats.blocksRemoved
      + (this.game.world.props?.version || 0);
    if (!force && stamp === this.walkStamp && this.walkStops.length) return;
    this.walkStamp = stamp;
    const venues = this.game.analysis.venues || [];
    this.walkStops = siteStops(this.game.world, venues);
    this.amenityFields = amenityFields(this.game.world);
    // Stops that no longer exist should not block an inspection for ever.
    const w = this.game.state.siteWalk;
    if (w) {
      const live = new Set(this.walkStops.map((s) => s.id));
      w.visited = w.visited.filter((id) => live.has(id));
    }
  }

  /** One play-mode sample: where am I, what is here, have I reached a stop. */
  updatePlay(force = false, quiet = false) {
    if (this.tab !== 'play') return;
    this.refreshWalk();
    const p = this.rig.pos;
    const pos = {
      x: Math.floor(p.x / BLOCK_SIZE),
      y: Math.floor(p.y / BLOCK_SIZE),
      z: Math.floor(p.z / BLOCK_SIZE),
    };
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (!force && key === this._spotKey) return;
    this._spotKey = key;

    const venues = this.game.analysis.venues || [];
    this.spot = spotReport(this.game.world, pos, venues, this.amenityFields);

    // Reaching a stop ticks it off. Announced once, because walking past the
    // same marker four times is not four inspections.
    for (const stop of this.walkStops) {
      const d = Math.hypot(stop.x - pos.x, stop.z - pos.z);
      if (d > STOP_RADIUS) continue;
      const got = reachStop(this.game.state, stop);
      if (got && !quiet) {
        audio.play('ui');
        this.toast('info', `Inspected: ${got.name}`, this.stopBriefing(got));
      }
    }
    this.renderPlayDock();
  }

  /**
   * What to say on arriving somewhere. At a playing surface that is the
   * venue's own list of faults, which is the whole reason to stand there;
   * everywhere else it is the question the stop exists to answer.
   */
  stopBriefing(stop) {
    if (stop.kind === 'pitch' && stop.venueKey) {
      const v = (this.game.analysis.venues || []).find((x) => x.key === stop.venueKey);
      const issues = (v?.ratings?.issues || []).filter((i) => i.severity !== 'info').slice(0, 3);
      if (issues.length) {
        return `Standing here, the inspection flags: ${issues.map((i) => i.text).join(' ')}`;
      }
      if (v) return `${stop.ask} Nothing on the snag list for this venue — it rates ${v.ratings.overall}.`;
    }
    return stop.ask;
  }

  renderPlayDock() {
    const progress = walkProgress(this.game.state, this.walkStops);
    const w = this.game.state.siteWalk;
    // Whether filing is actually worth anything right now, so the player is
    // not walking the rounds for a certificate they already hold.
    progress.certificate = certificateActive(this.game.state)
      ? { daysLeft: CERTIFICATE_DAYS - (this.game.state.day - w.completedDay) }
      : null;
    progress.restricted = (w?.restricted || []).length;
    this.playDock.render(this.spot, progress, this.playTarget());
    this.hud.setDock(this.playDock.node);
  }

  /** What the Inspect button would act on, named so the button can say it. */
  playTarget() {
    const bc = this.controller;
    bc.updateAim(this.aimNdc());

    // Standing in the stand is the natural way to ask about a seat: you walk
    // up, you sit down, you look. Only if the player is somewhere else does
    // the crosshair decide.
    const feet = this.spot;
    if (feet) {
      const under = this.game.world.getZone(feet.x, feet.y - 1, feet.z)
        || this.game.world.getZone(feet.x, feet.y, feet.z);
      const zd = under ? ZONE_BY_ID[under] : null;
      if (zd && zd.group === 'spectator' && zd.capacity) {
        return {
          kind: 'seat', label: 'This seat', title: 'What you can see from where you are sitting',
          cell: { x: feet.x, y: feet.y, z: feet.z },
        };
      }
    }
    if (bc.aimProp) {
      const t = PROP_BY_ID[bc.aimProp.typeId];
      return { kind: 'prop', label: 'Fitting', title: `Look at the ${t?.name || 'fitting'}` };
    }
    const f = bc.aimFace;
    if (f) {
      const zid = this.game.world.getZone(f.x, f.y, f.z);
      const zdef = zid ? ZONE_BY_ID[zid] : null;
      if (zdef && zdef.group === 'spectator' && zdef.capacity) {
        return { kind: 'seat', label: 'Seat', title: 'What this seat actually sees', cell: { x: f.x, y: f.y, z: f.z } };
      }
      return { kind: 'block', label: 'Inspect', title: 'Look closely at this', cell: { x: f.x, y: f.y, z: f.z } };
    }
    return { kind: 'spot', label: 'Inspect', title: 'A full report on where you are standing' };
  }

  playAction(id) {
    if (id === 'build') { this.setTab('build'); return; }
    if (id === 'guide') { this.guideToNextStop(); return; }
    if (id === 'file') { this.fileInspection(); return; }
    this.playInteract();
  }

  /** A tap in play mode: read the thing under the crosshair. */
  playInteract() {
    const t = this.playTarget();
    const venues = this.game.analysis.venues || [];

    if (t.kind === 'seat') {
      const venue = nearestVenueTo(venues, t.cell.x, t.cell.z);
      const r = seatReport(this.game.world, t.cell, venue);
      if (!r) { this.toast('info', 'No field in sight', 'This seat is not looking at anything the game recognises as a playing surface.'); return; }
      recordSeat(this.game.state, r);
      const tone = r.restricted ? 'warn' : 'info';
      this.toast(tone, `${r.grade} — ${r.zone || 'seat'}`,
        `${r.clear} of ${r.total} points on the field are visible from here. `
        + `${r.distance}m out, ${r.height}m above the surface.`
        + (r.blockedBy ? ` ${r.blockedBy} is in the way.` : ''));
      audio.play(r.restricted ? 'deny' : 'ui');
      this.renderPlayDock();
      return;
    }

    if (t.kind === 'prop') {
      const rec = this.controller.aimProp;
      const type = PROP_BY_ID[rec.typeId];
      this.toast('info', type?.name || 'Fitting',
        `${type?.hint || 'Equipment.'} Facing ${['north', 'east', 'south', 'west'][rec.rot & 3]}.`);
      audio.play('ui');
      return;
    }

    this.showSpotSheet();
  }

  /** The long form of the spot report, for when the dock line is not enough. */
  showSpotSheet() {
    const r = this.spot;
    if (!r) return;
    const row = (k, v, cls = '') => el('div.rowbetween', {},
      el('span.small.faint', { text: k }), el('span.small' + (cls ? '.' + cls : ''), { text: v }));
    this.hud.openSheet('Standing here', el('div.stack', {},
      el('div.card', {},
        el('div.rowbetween', {},
          el('div.h3', { text: r.zone ? r.zone.name : 'Unzoned ground' }),
          el('div.big' + (r.score >= 68 ? '.good' : r.score >= 45 ? '.gold' : '.bad'), { text: `${r.score}` })),
        el('div.tiny.faint', { text: `${r.verdict} · ${r.surface || 'nothing underfoot'}` })),
      el('div.card', {},
        el('div.section', { text: 'The place' }),
        row('Clear width', `${r.widthMetres}m`, r.width <= 3 ? 'bad' : ''),
        row('Shelter', r.covered ? `Roofed, ${Math.round(r.coverHeight)}m overhead` : 'Open to the sky'),
        r.view ? row('View of the field', `${r.view.grade} — ${r.view.clear}/${r.view.total} clear, ${r.view.distance}m`,
          r.view.restricted ? 'bad' : '') : null,
        r.view?.blockedBy ? row('In the way', r.view.blockedBy, 'bad') : null),
      el('div.card', {},
        el('div.section', { text: 'Nearest of each' }),
        ...r.amenities.map((a) => row(a.label,
          a.metres === null ? 'None on the plot' : `${a.metres}m`,
          a.poor ? 'bad' : a.ok ? 'good' : ''))),
      el('div.card', {},
        el('div.section', { text: 'Verdict' }),
        ...r.notes.map((n) => el('div.small', { text: '• ' + n })))));
  }

  /**
   * Take the player to a seat found on a walk, so a bad one reported in the
   * venue screen is one tap from being looked at rather than hunted for.
   */
  showSeat(seat) {
    this.setTab('play');
    const w = this.game.world;
    let y = seat.y;
    while (y < CHUNK_Y - 2 && (w.isSolid(seat.x, y, seat.z) || w.isSolid(seat.x, y + 1, seat.z))) y++;
    this.rig.pos.set((seat.x + 0.5) * BLOCK_SIZE, y * BLOCK_SIZE + 0.1, (seat.z + 0.5) * BLOCK_SIZE);
    this.rig.vel.set(0, 0, 0);
    const v = nearestVenueTo(this.game.analysis.venues || [], seat.x, seat.z);
    if (v) this.rig.fYaw = Math.atan2(v.centre.x - seat.x, v.centre.z - seat.z);
    this.rig.fPitch = -0.05;
    this.updatePlay(true, true);
    this.toast('info', 'This is the seat', seat.blockedBy
      ? `${seat.blockedBy} is what is in the way. Clear it, then check the seat again.`
      : 'Most of the field is hidden from here.');
  }

  /** Point the player at the next unvisited stop. */
  guideToNextStop() {
    const p = walkProgress(this.game.state, this.walkStops);
    const bad = this.game.state.siteWalk?.restricted || [];
    // With the rounds done, the thing worth walking to is the worst seat the
    // player has actually found, because that is a fault with an address.
    const target = p.next || (bad.length ? {
      x: bad[0].x, z: bad[0].z,
      name: 'a restricted-view seat you found',
      ask: bad[0].blockedBy ? `${bad[0].blockedBy} is in the way of it.` : 'It cannot see most of the field.',
    } : null);
    if (!target) { this.toast('info', 'Nothing left', 'Every stop has been visited and no bad seats are on file.'); return; }
    const dx = (target.x + 0.5) * BLOCK_SIZE - this.rig.pos.x;
    const dz = (target.z + 0.5) * BLOCK_SIZE - this.rig.pos.z;
    this.rig.fYaw = Math.atan2(dx, dz);
    this.rig.fPitch = 0;
    const dist = Math.round(Math.hypot(dx, dz));
    this.toast('info', `Toward ${target.name}`, `${dist}m ahead. ${target.ask}`);
    audio.play('ui');
  }

  /** File a completed walk and take the certificate. */
  fileInspection() {
    const r = completeWalk(this.game.state, this.walkStops);
    if (!r) { this.toast('warn', 'Not finished', 'Visit every stop on the walk first.'); return; }
    if (r.reputation > 0) applyReputation(this.game.state, { venue: r.reputation });
    this.game.markWorldDirty();
    audio.play('cash');
    this.toast('good', 'Inspection filed',
      `${r.stops} stops walked. `
      + (r.reputation > 0
        ? `Reputation +${r.reputation}. `
        : 'Your last certificate was still in date, so no reputation this time. ')
      + `Safety and comfort lift for ${CERTIFICATE_DAYS} days.`
      + (r.restricted ? ` ${r.restricted} restricted-view seat${r.restricted === 1 ? '' : 's'} still on file.` : ''));
    this.renderPlayDock();
    this.refresh();
  }

  // =================================================================== TABS
  setTab(tab) {
    const was = this.tab;
    this.tab = tab;
    this.hud.setTab(tab);
    this.hud.closeSheet();
    if (was === 'play' && tab !== 'play') this.leavePlay();
    const building = tab === 'build';
    this.controller.setVisible(building);
    this.actionPad.style.display = this.isTouch && building ? '' : 'none';
    if (this.crosshair) {
      this.crosshair.style.display = (this.rig.isWalking || (this.isTouch && building)) ? '' : 'none';
    }
    if (building) this.refreshBuildUi();
    else if (tab !== 'play') { this.hud.setDock(null); this.worldRenderer.setZoneMode(false); this.refreshHeld(); }

    if (tab === 'play') this.enterPlay();
    else if (tab === 'home') this.screens.openHome();
    else if (tab === 'events') this.eventsUi.openBoard();
    else if (tab === 'finance') this.screens.openFinance();
    else if (tab === 'more') this.screens.openMore();
    this.refresh();
  }

  /** ZONE mode always shows the overlay; the rail button toggles it elsewhere. */
  syncZoneOverlay() {
    const want = this.tab === 'build' && (this.zoneOverlay || this.controller.mode === 'zone');
    // Fading the world back makes zones readable from above; down at ground
    // level it just makes the place hard to walk around, so ease off.
    const dim = want ? (this.rig.isWalking ? 0.62 : 0.35) : 1;
    this.worldRenderer.setZoneMode(want, this.rig.isWalking ? 0.62 : 0.35);
    this.propRenderer?.setDim(dim);
  }

  // ================================================================= BUS
  wireBus() {
    const bus = this.game.bus;
    bus.on('notify', (n) => {
      const kind = n.kind === 'achievement' || n.kind === 'goal' ? 'achievement'
        : n.kind === 'bid' ? 'bid' : 'info';
      this.toast(kind, n.kind === 'goal' ? `Goal complete: ${n.title}` : n.title, n.body);
      if (n.kind === 'achievement' || n.kind === 'goal') audio.play('achievement');
    });
    bus.on('state', () => this.hud?.refresh());
    bus.on('analysis', () => {
      this.refreshStatus();
      this.tutorial?.refresh();
      // Analysis can fire before the renderer exists, during start-up.
      this.worldRenderer?.setPitches(pitchRects(this.game.analysis));
    });
    bus.on('eventreport', (r) => this.playEvent(r));
    // An event day the player is running themselves takes over the screen.
    bus.on('matchday', (view) => this.matchdayScreen.show(view));
    bus.on('matchdaydone', () => this.matchdayScreen.hide());
    bus.on('randomevent', (d) => this.eventsUi.showRandomEvent(d));
    bus.on('landchange', (off) => {
      // New land wraps the old plot, so the complex moved. Follow it.
      if (off) this.rig.shift(off * BLOCK_SIZE, off * BLOCK_SIZE);
      this.sky.setPlot(this.game.world.size);
      this.worldRenderer.rebuildAll();
      this.worldRenderer.flush();
    });
    bus.on('legacy', (l) => this.showLegacy(l));
    bus.on('scenario', (ev) => {
      if (ev?.kind === 'won') { recordScenario(ev.def.id, ev.rank); this.showScenario(); }
      else if (ev?.kind === 'timeout') this.showScenario();
      this.hud.refresh();
    });
    bus.on('sitechange', () => { this.tutorial?.refresh(); });
    bus.on('day', () => {
      if (this.game.state.settings.autosave && this.game.state.day !== this.lastSaveDay) {
        this.lastSaveDay = this.game.state.day;
        this.saveNow(true);
      }
    });
  }

  // ================================================================= EVENT
  playEvent(report) {
    const venue = this.game.analysis.venues.find((v) => v.key === report.venueKey) || this.game.primaryVenue;
    if (!venue) { this.eventsUi.showReport(report); return; }

    const started = this.show.begin(report, venue, this.game.state.seed + report.day);
    if (!started) { this.eventsUi.showReport(report); return; }

    this.pausedByShow = !this.game.state.paused;
    this.game.state.paused = true;
    this.hud.closeSheet();
    this.setTab('build');
    // Clear the chrome so the player can actually watch their stadium fill.
    this.controller.setVisible(false);
    this.hud.setDock(null);
    this.hud.statusHidden = true;
    this.hud.setStatus(null);
    this.tutorial.setSuppressed(true);
    this.actionPad.style.display = 'none';

    // Frame the venue from the stands.
    this.setCamera('free');
    this.rig.focusOn(
      (venue.centre.x + 0.5) * BLOCK_SIZE,
      (Math.max(venue.field.y, GROUND_Y) + 6) * BLOCK_SIZE,
      (venue.centre.z + 0.5) * BLOCK_SIZE,
      Math.max(90, venue.reach * 2.6));
    this.rig.pitch = 0.45;
    this.showOrbit = true;
    audio.play('crowd');

    const banner = el('div.tutorial.eventday', {},
      el('div.step', { text: 'EVENT DAY' }),
      el('div.t', { text: report.eventName }),
      el('div.b', { id: 'showphase', text: 'Fans are arriving…' }),
      el('button.btn.sm.full', { style: { marginTop: '8px' }, onclick: () => this.show.skip() }, 'Skip to the result'));
    this.hud.tutorialHost.append(banner);
    this.showBanner = banner;

    this.show.onPhase = (p) => {
      const t = banner.querySelector('#showphase');
      if (!t) return;
      if (p === 'arriving') t.textContent = 'Fans are arriving. Parking is filling up…';
      else if (p === 'underway') t.textContent = `${fmtNum(report.attendance)} in the ground. The event is underway.`;
      else if (p === 'leaving') t.textContent = 'Full time. The crowd is heading home.';
      else if (p === 'idle') this.finishEventShow(report);
    };
  }

  finishEventShow(report) {
    this.showBanner?.remove();
    this.showBanner = null;
    this.showOrbit = false;
    this.hud.statusHidden = false;
    this.tutorial.setSuppressed(false);
    this.controller.setVisible(this.tab === 'build');
    this.setTab(this.tab);
    if (this.pausedByShow) { this.game.state.paused = false; this.pausedByShow = false; }
    this.eventsUi.showReport(report);
    audio.play(report.profit > 0 ? 'win' : 'lose');
    this.refresh();
  }

  fastForwardTo(day) {
    const n = Math.max(0, day - this.game.state.day);
    if (n > 0) this.game.skipDay(n);
  }

  // ================================================================ ACTIONS
  undo() {
    const b = this.controller.undo();
    if (b) { this.hud.setStatus(`Undid: ${b.label}`); audio.play('ui'); this.refresh(); }
  }
  redo() {
    const b = this.controller.redo();
    if (b) { this.hud.setStatus(`Redid: ${b.label}`); audio.play('ui'); this.refresh(); }
  }

  planAction(which) {
    const c = this.controller;
    if (which === 'cancel') {
      c.cancelPlan();
      this.toast('info', 'Plan discarded', 'Nothing was built and nothing was charged.');
    } else if (which === 'commit') {
      const r = c.commitPlan();
      if (r?.error) { this.toast('warn', 'Cannot afford this plan', r.error); return; }
      this.toast('bid', 'Construction approved', `${fmtNum(r.count)} blocks for ${fmtMoney(r.cost)}.`);
      audio.play('build');
    } else {
      // Toggle off: ask what to do.
      const node = el('div', {},
        el('h2', { text: 'Planning mode' }),
        el('p.small.faint', { text: `Your plan covers ${fmtNum(c.planning.count)} blocks and would cost ${fmtMoney(c.planning.cost)}.` }),
        el('div.btnrow', { style: { marginTop: '14px' } },
          el('button.btn.go', { onclick: () => { this.hud.closeModal(); this.planAction('commit'); } }, 'Build it'),
          el('button.btn.danger', { onclick: () => { this.hud.closeModal(); this.planAction('cancel'); } }, 'Discard')),
        el('button.btn.full', { style: { marginTop: '8px' }, onclick: () => this.hud.closeModal() }, 'Keep planning'));
      this.hud.openModal(node);
      return;
    }
    this.dock.render();
    this.refresh();
  }

  act(fn, after) {
    const r = fn();
    if (r?.error) this.toast('warn', 'Not possible', r.error);
    else after?.();
    this.refresh();
  }

  // ================================================================ PROMPTS
  promptRegister(venue) {
    const input = el('input.input', { type: 'text', value: venue.suggestedName, maxlength: '34' });
    const node = el('div', {},
      el('h2', { text: 'Register venue' }),
      el('p.small.faint', { style: { margin: '6px 0 12px' },
        text: `The game has classified this as a ${venue.type} holding ${fmtNum(venue.capacity.total)} with a rating of ${venue.ratings.overall}. Registering it opens it up for event bidding.` }),
      el('div.field', {}, el('label', { text: 'Venue name' }), input),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button.btn.go', {
          onclick: () => {
            this.game.registerVenue(venue.key, input.value.trim() || venue.suggestedName);
            this.hud.closeModal();
            this.screens.refreshHome();
            this.refresh();
          },
        }, 'Register')));
    this.hud.openModal(node);
  }

  promptRenameVenue(venue) {
    const input = el('input.input', { type: 'text', value: venue.name, maxlength: '34' });
    this.hud.openModal(el('div', {},
      el('h2', { text: 'Rename venue' }),
      el('div.field', { style: { marginTop: '12px' } }, el('label', { text: 'Venue name' }), input),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button.btn.primary', {
          onclick: () => {
            this.game.renameVenue(venue.key, input.value.trim() || venue.name);
            this.hud.closeModal(); this.screens.refreshHome(); this.refresh();
          },
        }, 'Save'))));
  }

  promptRename() {
    const input = el('input.input', { type: 'text', value: this.game.state.complexName, maxlength: '22' });
    this.hud.openModal(el('div', {},
      el('h2', { text: 'Rename complex' }),
      el('div.field', { style: { marginTop: '12px' } }, el('label', { text: 'Complex name' }), input),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button.btn.primary', {
          onclick: () => {
            this.game.state.complexName = input.value.trim() || 'Riverside';
            this.hud.closeModal(); this.screens.refreshHome(); this.refresh();
          },
        }, 'Save'))));
  }

  promptSaveBlueprint() {
    const input = el('input.input', { type: 'text', value: `Blueprint ${this.controller.blueprints.length + 1}`, maxlength: '28' });
    this.hud.openModal(el('div', {},
      el('h2', { text: 'Save blueprint' }),
      el('p.small.faint', { style: { marginTop: '6px' },
        text: `${fmtNum(this.controller.clipboard?.count || 0)} blocks will be stored on this device and can be stamped into any save.` }),
      el('div.field', { style: { marginTop: '12px' } }, el('label', { text: 'Name' }), input),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button.btn.go', {
          onclick: () => {
            const r = this.controller.saveBlueprint(input.value.trim());
            this.hud.closeModal();
            if (r.error) this.toast('warn', 'Cannot save', r.error);
            else this.toast('info', 'Blueprint saved', r.bp.name);
          },
        }, 'Save'))));
  }

  /**
   * The prefab library: the built-in facilities on one tab, whatever the
   * player has copied on the other. Both stamp through the same code path.
   */
  openBlueprints(tab = 'prefabs') {
    const body = el('div');
    const render = () => {
      fill(body,
        el('div.tabs', {},
          el('button.tab' + (tab === 'prefabs' ? '.on' : ''), { onclick: () => { tab = 'prefabs'; render(); } }, 'Prefabs'),
          el('button.tab' + (tab === 'saved' ? '.on' : ''), { onclick: () => { tab = 'saved'; render(); } }, 'Your blueprints')),
        tab === 'prefabs' ? this.prefabList() : this.savedBlueprintList());
    };
    render();
    this.hud.openSheet('Structure Library', body);
  }

  prefabList() {
    const cash = this.game.state.cash;
    return el('div.stack', {},
      el('div.tiny.faint', { text: 'Tap a prefab to hold it, then tap the ground to place it. Rotate with \u21BB (or R) before you build. Flatten the ground first for the best fit.' }),
      ...PREFAB_GROUPS.map((g) => {
        const items = PREFABS.filter((p) => p.group === g.key);
        if (!items.length) return null;
        return el('div', {},
          el('div.section', { text: g.name }),
          el('div.stack', {}, ...items.map((def) => {
            const est = this.estimatePrefab(def);
            // A prefab built out of locked materials is gated on the project
            // that unlocks them, and says so rather than failing on the tap.
            const project = def.unlock && !this.game.isUnlocked(def.unlock)
              ? RESEARCH.find((r) => r.id === def.unlock) : null;
            return el('button.card.tight.tap' + (project ? '.off' : ''), {
              'aria-label': `${def.name}, ${def.size.x} by ${def.size.z} blocks`
                + (project ? `, locked: needs ${project.name}` : ''),
              disabled: !!project,
              onclick: () => {
                this.controller.setPrefab(def.key);
                this.hud.closeSheet();
                this.setTab('build');
                this.refreshBuildUi();
                this.toast('info', `Holding ${def.name}`, 'Tap the ground to place it. \u21BB rotates it 90\u00B0.');
              },
            },
              el('div.rowbetween', {},
                el('div', {},
                  el('div.small', { text: `${def.icon} ${def.name}` }),
                  el('div.tiny.faint', {
                    text: project ? `Needs ${project.name}. ${def.hint}` : def.hint })),
                el('div.right', { style: { flex: '0 0 auto' } },
                  el('div.small.mono' + (project ? '.faint' : est.cost > cash ? '.bad' : ''), {
                    text: project ? 'Locked' : fmtMoney(est.cost) }),
                  el('div.tiny.faint', { text: `${def.size.x}\u00D7${def.size.z} blocks` }))));
          })));
      }).filter(Boolean));
  }

  /** What a prefab would cost on open ground, for the library listing. */
  estimatePrefab(def) {
    const plan = generatePrefab(this.game.world, def.key,
      { x: 1, y: GROUND_Y, z: 1 }, 0);
    let cost = 0;
    for (let i = 0; i < plan.cells.length; i += 5) cost += block(plan.cells[i + 3]).cost;
    for (const pr of plan.props) cost += PROP_BY_ID[pr.typeId]?.cost || 0;
    return { cost: cost * (this.game.state.buildCostMult || 1), blocks: plan.cells.length / 5 };
  }

  savedBlueprintList() {
    const list = this.controller.blueprints;
    return list.length
      ? el('div.stack', {}, ...list.map((bp) => el('div.card.tight', {},
          el('div.rowbetween', {},
            el('div', {}, el('div.small', { text: bp.name }),
              el('div.tiny.faint', { text: `${fmtNum(bp.count)} blocks · ${bp.size.x}×${bp.size.y}×${bp.size.z}` })),
            el('div.btnrow', { style: { flex: '0 0 auto', gap: '6px' } },
              el('button.btn.sm.primary', { onclick: () => { this.controller.loadBlueprint(bp.id); this.hud.closeSheet(); this.dock.render(); } }, 'Use'),
              el('button.btn.sm.danger', { onclick: () => { this.controller.deleteBlueprint(bp.id); this.openBlueprints('saved'); } }, '✕'))))))
      : el('div.card', {}, emptyState('☷', 'No saved blueprints yet. Use Blueprint → Copy to capture something you built, then Save.'));
  }

  confirmReset() {
    this.hud.openModal(el('div', {},
      el('h2', { text: 'Start a new complex?' }),
      el('p.small.faint', { style: { margin: '8px 0 14px' },
        text: 'Your current complex will be replaced. Export a save first if you want to keep it.' }),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button.btn.danger', {
          onclick: async () => {
            this.hud.closeModal(); this.hud.closeSheet();
            await saveManager.remove(AUTOSAVE_SLOT);
            this.newGame(this.game.state.complexName);
          },
        }, 'Start over'))));
  }

  /** Move the player and the camera to another site. */
  travelTo(siteId) {
    const r = this.game.switchSite(siteId);
    if (r?.error) { this.toast('warn', 'Cannot travel', r.error); return; }
    const world = this.game.world;
    this.worldRenderer.world = world;
    this.show.world = world;
    this.propRenderer.setWorld(world);
    this.sky.setPlot(world.size);
    this.rig.setWorld(world);
    this.controller.anchor = null;
    this.worldRenderer.rebuildAll();
    this.worldRenderer.flush();
    const c = (world.size * BLOCK_SIZE) / 2;
    this.rig.focusOn(c, GROUND_Y * BLOCK_SIZE, c, world.size * BLOCK_SIZE * 0.42);
    this.rig.pitch = 0.72;
    this.hud.closeSheet();
    this.setTab('build');
    this.toast('info', `Now at ${this.game.site.name}`, this.game.site.name);
    this.refresh();
  }

  promptRenameSite(site) {
    const input = el('input.input', { type: 'text', value: site.name, maxlength: '28' });
    this.hud.openModal(el('div', {},
      el('h2', { text: 'Rename site' }),
      el('div.field', { style: { marginTop: '12px' } }, el('label', { text: 'Site name' }), input),
      el('div.btnrow', {},
        el('button.btn', { onclick: () => this.hud.closeModal() }, 'Cancel'),
        el('button.btn.primary', {
          onclick: () => {
            this.game.renameSite(site.id, input.value.trim() || site.name);
            this.hud.closeModal(); this.screens.openMore('Empire'); this.refresh();
          },
        }, 'Save'))));
  }

  /** Jump straight to the infrastructure tab from a Home warning. */
  openInfrastructure() {
    this.hud.closeSheet();
    this.setTab('more');
    this.screens.openMore('Infra');
  }

  // ================================================================== SAVE
  async saveNow(silent = false) {
    try {
      await saveManager.save(this.game, AUTOSAVE_SLOT);
      if (!silent) this.toast('info', 'Saved', `Day ${this.game.state.day} stored on this device.`);
    } catch (e) {
      console.error(e);
      if (!silent) this.toast('warn', 'Save failed', 'Try exporting a save file instead.');
    }
  }

  exportSave() {
    const blob = saveManager.exportBlob(this.game);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = saveManager.exportFilename(this.game);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.toast('info', 'Save exported', a.download);
  }

  importSave(fromSplash = false) {
    const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const loaded = await saveManager.importText(await file.text());
        if (fromSplash) this.splash?.remove();
        this.game.adopt(loaded.state, loaded.worlds);
        this.afterWorldReady(false);
        this.hud.closeSheet();
        this.toast('info', 'Save imported', `${loaded.state.complexName}, day ${loaded.state.day}.`);
      } catch (e) {
        console.error(e);
        this.toast('warn', 'Import failed', 'That file is not a valid save.');
      }
      input.remove();
    });
    document.body.append(input);
    input.click();
  }

  // ============================================================== SETTINGS
  applySettings() {
    const s = this.game.state.settings;
    document.documentElement.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
    document.documentElement.dataset.contrast = s.highContrast ? 'high' : 'normal';
    document.documentElement.dataset.text = s.largeText ? 'large' : 'normal';
    this.rig.sensitivity = s.sensitivity;
    this.rig.invertY = s.invertY;
    audio.enabled = s.sound;
    this.effects?.setEnabled(!s.reducedMotion);
    this.fpsNode.style.display = s.showFps ? '' : 'none';
    // Handedness is a root attribute rather than inline styles: inline styles
    // beat the landscape media query, which is how the action pad used to end
    // up sitting on top of the side dock.
    document.documentElement.dataset.hand = s.handedness === 'left' ? 'left' : 'right';
  }

  // ================================================================= VIEW
  flyToVenue(v) {
    this.hud.closeSheet();
    this.setTab('build');
    this.setCamera('free');
    this.rig.focusOn(
      (v.centre.x + 0.5) * BLOCK_SIZE,
      (Math.max(v.field.y, GROUND_Y) + 4) * BLOCK_SIZE,
      (v.centre.z + 0.5) * BLOCK_SIZE,
      Math.max(70, v.reach * 2.4));
    this.rig.pitch = 0.55;
  }

  showInspector() {
    const r = this.controller.inspectResult;
    if (!r || this.hud.statusHidden) return;
    const v = r.venue;
    fill(this.hud.statusLine,
      el('div.rowbetween', {},
        el('div', {},
          el('div.small', { text: r.prop ? r.prop.name : r.block ? r.block.name : 'Empty' }),
          el('div.tiny.faint', { text: r.prop
            ? `Equipment \u00B7 facing ${['north', 'east', 'south', 'west'][r.propRot]} \u00B7 on ${r.block ? r.block.name : 'open ground'}`
            : r.zone ? `Zoned: ${r.zone.name}` : 'No functional zone' })),
        el('div.right', {},
          el('div.tiny.faint', { text: `${r.pos.x}, ${r.pos.y}, ${r.pos.z}` }),
          el('div.tiny.faint', { text: `${r.metres.x}m · ${r.metres.y}m up` }))),
      v ? el('div', { style: { marginTop: '7px', paddingTop: '7px', borderTop: '1px solid var(--line)' } },
        el('div.rowbetween', {},
          el('span.small', { text: v.name }), pill(v.tier, v.tier)),
        el('div.tiny.faint', { text: `${v.type} · ${fmtNum(v.capacity.total)} capacity · rating ${v.ratings.overall}` }),
        v.ratings.issues[0] ? el('div.tiny', { style: { marginTop: '5px', color: 'var(--gold)' }, text: v.ratings.issues[0].text }) : null)
        : el('div.tiny.faint', { style: { marginTop: '6px' }, text: 'This block is not part of any detected venue.' }));
    this.hud.statusLine.style.display = '';
  }

  refreshStatus() {
    if (this.hud.statusHidden) { this.hud.setStatus(null); return; }
    if (this.controller?.mode === 'inspect' && this.controller.inspectResult) return;
    const v = this.game.primaryVenue;
    if (this.tab !== 'build' || !v) { this.hud.setStatus(null); return; }
    fill(this.hud.statusLine,
      el('div.rowbetween', { style: { gap: '14px' } },
        el('div', {}, el('div.small', { text: v.name }),
          el('div.tiny.faint', { text: `${v.type} · ${fmtNum(v.capacity.total)} capacity` })),
        el('div.right', {},
          el('div.small.mono', { text: `Rating ${v.ratings.overall}` }),
          el('div.tiny.faint', { text: v.registered ? 'Registered' : 'Not registered' }))));
    this.hud.statusLine.style.display = '';
  }

  refresh() {
    this.hud.refresh();
    this.hud.setCameraButtons(this.cameraModes, this.rig.mode, (m) => this.setCamera(m));
    this.hud.setRightRail([
      { icon: '↶', title: 'Undo', disabled: !this.game.history.canUndo, onclick: () => this.undo() },
      { icon: '↷', title: 'Redo', disabled: !this.game.history.canRedo, onclick: () => this.redo() },
      { icon: '✈', title: 'Toggle flight (first person)', on: this.rig.fly, disabled: !this.rig.isWalking, onclick: () => { this.rig.toggleFly(); this.refresh(); } },
      this.tab === 'play' ? null
        : { icon: '▦', title: 'Show functional zones', on: this.worldRenderer.zoneMode, onclick: () => { this.worldRenderer.setZoneMode(!this.worldRenderer.zoneMode); this.refresh(); } },
      { icon: '?', title: 'Show the tutorial', onclick: () => this.tutorial.show() },
    ]);
    this.hud.onTab = (t) => this.setTab(t);
    this.hud.onSpeed = (a) => this.speedAction(a);
    this.dock?.renderInfo();
    this.tutorial?.refresh();
    this.refreshStatus();
  }

  speedAction(a) {
    const s = this.game.state;
    if (a === 'toggle') s.paused = !s.paused;
    else if (a === 'cycle') s.speed = s.speed >= 8 ? 1 : s.speed * 2;
    else if (a === 'skip') { this.game.skipDay(1); audio.play('ui'); }
    this.hud.refresh();
  }

  toast(kind, title, body) {
    this.hud.toast({ kind, title, body });
  }

  // ================================================================== LOOP
  startLoop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        this.fps = Math.round(this.frames / this.fpsTime);
        this.frames = 0; this.fpsTime = 0;
        if (this.game.state?.settings.showFps) {
          this.fpsNode.textContent = `${this.fps} fps · ${this.renderer.info.render.calls} calls · ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k tris`;
        }
      }
      if (this.rig) this.tickFrame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  tickFrame(dt) {
    const g = this.game;

    if (!this.show?.active) g.tick(dt);
    else this.show.update(dt);

    // Slow orbit during the event-day cinematic.
    if (this.showOrbit) this.rig.yaw += dt * 0.06;

    const move = this.input.moveVector;
    this.rig.update(dt, move, this.input.run);

    // Holding place/break sweeps out a run of blocks.
    if (this.input.isHolding && this.tab === 'build' && !this.show?.active
        && this.input.holdSeconds >= REPEAT_DELAY) {
      this.repeatTimer = (this.repeatTimer || 0) - dt;
      if (this.repeatTimer <= 0) {
        this.repeatTimer = REPEAT_INTERVAL;
        this.onTap(null, this.input.heldButton, true);
      }
    } else {
      this.repeatTimer = REPEAT_INTERVAL;
    }

    // Play mode reads the ground under the player a few times a second. Only
    // on a new voxel does it do the work, so standing still costs nothing.
    if (this.tab === 'play') {
      this.playTimer -= dt;
      if (this.playTimer <= 0) { this.playTimer = 0.2; this.updatePlay(); }
    }

    this.held?.update(dt, Math.abs(move.x) + Math.abs(move.y) > 0.1);

    // Aim follows the camera when walking or pointer-locked.
    if (this.rig.isWalking || this.input.pointerLocked) this.controller.updateAim(null);

    this.worldRenderer.update();
    this.propRenderer.update();
    this.effects.update(dt);
    this.worldRenderer.cullDistant(this.camera.position, 1600);

    const state = g.state;
    // Nudge the visible time of day toward evening for events so the lights come on.
    // Map the in-game day onto 08:00-20:00 so most play happens in daylight,
    // with the lights coming on late in the day.
    const dayT = state ? (0.34 + state.dayFraction * 0.5) : 0.5;
    const env = this.sky.update(dayT, state?.weather || 'sunny', this.camera.position, 1500);
    this.worldRenderer.setEnvironment(env);
    this.propRenderer.setEnvironment(env);
    this.renderer.setClearColor(env.fogColor);

    this.renderShadows(env);
    this.renderer.render(this.scene, this.camera);
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !import.meta.env?.PROD) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
  }
}

/** The venue a cell belongs to: the nearest one that can reach it. */
function nearestVenueTo(venues, x, z) {
  let best = null, bestD = Infinity;
  for (const v of venues) {
    const d = Math.hypot(x - v.centre.x, z - v.centre.z);
    if (d > (v.reach || 60) * 1.6) continue;
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

const app = new App();
app.boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) {
    l.classList.remove('hidden');
    l.textContent = 'Something went wrong starting the game. Check the console for details.';
  }
});
window.__sct = app;

/**
 * Small console API. Handy for poking at a save from devtools, and it is what
 * the end-to-end tests drive so they exercise the real systems rather than a
 * parallel mock.
 */
window.__sct.dev = {
  blockId,
  zoneId,
  propId,
  /** Place a prefab straight into the world, bypassing the aim. */
  prefab(key, x, y, z, rot = 0) {
    const w = app.game.world;
    const plan = generatePrefab(w, key, { x, y, z }, rot);
    applyPlan(w, plan.cells, key, plan.props);
    app.game.markWorldDirty();
    return { blocks: plan.cells.length / 5, props: plan.props.length, meta: plan.meta };
  },
  /** Place one piece of equipment, ignoring cost. */
  prop(key, x, y, z, rot = 0) {
    const id = propId(key);
    if (!id) throw new Error('unknown prop: ' + key);
    return app.game.world.props.add(id, x, y, z, rot);
  },
  propKeys: () => PROPS.map((p) => p.key),
  /**
   * Client pixels for the centre of a placed prop. Aiming at a goal post from
   * a voxel coordinate means aiming at the gap between its uprights, so tests
   * and debugging need the object's own centre.
   */
  projectProp(x, y, z) {
    const rec = app.game.world.props.anchorAt(x, y, z);
    if (!rec) return null;
    const b = rec.bounds;
    const v = new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    v.project(app.camera);
    const r = app.canvas.getBoundingClientRect();
    return {
      x: r.left + (v.x * 0.5 + 0.5) * r.width,
      y: r.top + (-v.y * 0.5 + 0.5) * r.height,
      onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1,
    };
  },
  prefabKeys: () => PREFABS.map((p) => p.key),
  researchIds: () => RESEARCH.map((r) => r.id),
  /**
   * Project a voxel's top face to client pixels. Used by the end-to-end tests
   * to aim real taps at known blocks, and handy for debugging aim problems.
   */
  project(vx, vy, vz) {
    const v = new THREE.Vector3(
      (vx + 0.5) * BLOCK_SIZE, (vy + 0.98) * BLOCK_SIZE, (vz + 0.5) * BLOCK_SIZE);
    v.project(app.camera);
    const r = app.canvas.getBoundingClientRect();
    return {
      x: r.left + (v.x * 0.5 + 0.5) * r.width,
      y: r.top + (-v.y * 0.5 + 0.5) * r.height,
      onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1,
    };
  },
  /** Push a specific catalogue event onto the board. */
  makeEvent(templateId, seed = Date.now() & 0xffff) {
    const tpl = EVENT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) throw new Error('unknown event template: ' + templateId);
    return instantiate(tpl, app.game.state, makeRng(seed));
  },
};

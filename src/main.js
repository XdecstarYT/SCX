import * as THREE from 'three';
import './styles/main.css';

import { Game } from './core/game.js';
import { BLOCK_SIZE, GROUND_Y, SECONDS_PER_DAY } from './core/constants.js';
import { WorldRenderer } from './voxel/renderer.js';
import { BuildController } from './voxel/buildController.js';
import { CameraRig, CAMERA_MODES } from './input/cameras.js';
import { InputController, bindJoystick } from './input/controls.js';
import { Sky } from './world/sky.js';
import { LiveEventShow } from './world/liveEvent.js';
import { Hud } from './ui/hud.js';
import { BuildDock } from './ui/buildDock.js';
import { Screens } from './ui/screens.js';
import { EventsUi } from './ui/eventsUi.js';
import { Tutorial } from './ui/tutorial.js';
import { el, fill, emptyState, pill } from './ui/dom.js';
import { saveManager } from './save/saveManager.js';
import { fmtMoney, fmtNum } from './core/economy.js';
import { audio } from './core/audio.js';
import { blockId } from './data/blocks.js';
import { zoneId } from './data/zones.js';
import { instantiate } from './events/eventGenerator.js';
import { EVENT_TEMPLATES } from './data/events.js';
import { makeRng } from './core/rng.js';

const AUTOSAVE_SLOT = 'auto';

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.viewport = document.getElementById('viewport');
    this.game = new Game();
    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.tab = 'build';
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
    this.eventsUi = new EventsUi(this);
    this.tutorial = new Tutorial(this);
    this.hud.tutorialHost.append(this.tutorial.node);
    this.fpsNode = el('div.fps', { style: { display: 'none' } });
    this.root.append(this.fpsNode);

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isTouch ? 2 : 2));
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
        el('button.btn.full', { onclick: () => this.importSave(true) }, 'Import a save file')),
      el('p.legal', { text: 'All teams, leagues, organisers, sponsors, athletes and events in this game are fictional.' }));
    this.root.append(splash);
    this.splash = splash;
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
      this.game.adopt(loaded.state, loaded.world);
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
      this.rig = new CameraRig(this.camera, world);
      this.controller = new BuildController(this.game, this.scene, this.rig);
      this.controller.restoreBlueprints();
      this.controller.onChange = () => { this.dock?.render(); this.refreshStatus(); };
      this.show = new LiveEventShow(this.scene, world);
      this.dock = new BuildDock(this.game, this.controller);
      this.dock.onPlanAction = (a) => this.planAction(a);
      this.dock.onSaveBlueprint = () => this.promptSaveBlueprint();
      this.dock.onOpenBlueprints = () => this.openBlueprints();
      this.dock.onLocked = (b) => this.toast('warn', `${b.name} is locked`, 'Complete the matching research project to unlock it.');
      this.setupInput();
      this.setupTouchLayer();
    }

    this.worldRenderer.world = world;
    this.show.world = world;
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
      onRotate: (d) => this.controller.rotateClipboard(),
      onCycleCamera: () => this.cycleCamera(),
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

    this.placeBtn = el('button.abtn.place', { 'aria-label': 'Place block', onclick: () => this.onTap(null, 0, true) }, '■');
    this.removeBtn = el('button.abtn.remove', { 'aria-label': 'Remove block', onclick: () => this.onTap(null, 2, true) }, '✕');
    this.jumpBtn = el('button.abtn.sm', { 'aria-label': 'Jump', onclick: () => this.rig.jump() }, '↑');
    this.actionPad = el('div.actionpad', { style: { display: 'none' } }, this.jumpBtn, this.removeBtn, this.placeBtn);
    this.hud.touchLayer.append(this.joy, this.actionPad);
  }

  aimNdc() {
    if (this.rig.isWalking || this.input?.pointerLocked) return null; // centre ray
    return this.lastNdc || { x: 0, y: 0 };
  }

  onTap(ndc, button, fromButton) {
    if (this.hud.modalOpen) return;
    if (this.show?.active) { this.show.skip(); return; }
    if (this.tab !== 'build') { this.setTab('build'); return; }

    if (ndc) this.lastNdc = ndc;
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
    if (res.error) { this.toast('warn', 'Cannot build', res.error); audio.play('deny'); return; }
    if (res === 'inspect') { this.showInspector(); return; }
    if (typeof res === 'string') {
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

  selectHotbar(i) {
    const items = this.dock.hotbar.querySelectorAll('.swatch');
    items[i]?.click();
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
    this.crosshair.style.display = walking ? '' : 'none';
    if (!walking) this.input.exitLock();
    this.resetJoy();
    this.refresh();
  }

  // =================================================================== TABS
  setTab(tab) {
    this.tab = tab;
    this.hud.setTab(tab);
    this.hud.closeSheet();
    const building = tab === 'build';
    this.hud.setDock(building ? this.dock.node : null);
    this.controller.setVisible(building);
    this.actionPad.style.display = this.isTouch && building ? '' : 'none';
    if (building) { this.worldRenderer.setZoneMode(this.controller.mode === 'zone'); this.dock.render(); }
    else this.worldRenderer.setZoneMode(false);

    if (tab === 'home') this.screens.openHome();
    else if (tab === 'events') this.eventsUi.openBoard();
    else if (tab === 'finance') this.screens.openFinance();
    else if (tab === 'more') this.screens.openMore();
    this.refresh();
  }

  // ================================================================= BUS
  wireBus() {
    const bus = this.game.bus;
    bus.on('notify', (n) => {
      const kind = n.kind === 'achievement' ? 'achievement' : n.kind === 'bid' ? 'bid' : 'info';
      this.toast(kind, n.title, n.body);
      if (n.kind === 'achievement') audio.play('achievement');
    });
    bus.on('state', () => this.hud?.refresh());
    bus.on('analysis', () => { this.refreshStatus(); this.tutorial?.refresh(); });
    bus.on('eventreport', (r) => this.playEvent(r));
    bus.on('randomevent', (d) => this.eventsUi.showRandomEvent(d));
    bus.on('landchange', () => {
      this.worldRenderer.rebuildAll();
      this.worldRenderer.flush();
    });
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

  openBlueprints() {
    const list = this.controller.blueprints;
    const body = list.length
      ? el('div.stack', {}, ...list.map((bp) => el('div.card.tight', {},
          el('div.rowbetween', {},
            el('div', {}, el('div.small', { text: bp.name }),
              el('div.tiny.faint', { text: `${fmtNum(bp.count)} blocks · ${bp.size.x}×${bp.size.y}×${bp.size.z}` })),
            el('div.btnrow', { style: { flex: '0 0 auto', gap: '6px' } },
              el('button.btn.sm.primary', { onclick: () => { this.controller.loadBlueprint(bp.id); this.hud.closeSheet(); this.dock.render(); } }, 'Use'),
              el('button.btn.sm.danger', { onclick: () => { this.controller.deleteBlueprint(bp.id); this.openBlueprints(); } }, '✕'))))))
      : el('div.card', {}, emptyState('☷', 'No blueprints yet. Use Blueprint → Copy to capture a structure, then Save.'));
    this.hud.openSheet('Blueprint Library', body);
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
        this.game.adopt(loaded.state, loaded.world);
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
    this.fpsNode.style.display = s.showFps ? '' : 'none';
    const left = s.handedness === 'left';
    this.joy.style.left = left ? '' : 'calc(var(--sal) + 22px)';
    this.joy.style.right = left ? 'calc(var(--sar) + 22px)' : '';
    this.actionPad.style.right = left ? '' : 'calc(var(--sar) + 16px)';
    this.actionPad.style.left = left ? 'calc(var(--sal) + 16px)' : '';
    this.actionPad.style.alignItems = left ? 'flex-start' : 'flex-end';
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
          el('div.small', { text: r.block ? r.block.name : 'Empty' }),
          el('div.tiny.faint', { text: r.zone ? `Zoned: ${r.zone.name}` : 'No functional zone' })),
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
    this.hud.setCameraButtons(CAMERA_MODES, this.rig.mode, (m) => this.setCamera(m));
    this.hud.setRightRail([
      { icon: '↶', title: 'Undo', disabled: !this.game.history.canUndo, onclick: () => this.undo() },
      { icon: '↷', title: 'Redo', disabled: !this.game.history.canRedo, onclick: () => this.redo() },
      { icon: '✈', title: 'Toggle flight (first person)', on: this.rig.fly, disabled: !this.rig.isWalking, onclick: () => { this.rig.toggleFly(); this.refresh(); } },
      { icon: '▦', title: 'Show functional zones', on: this.worldRenderer.zoneMode, onclick: () => { this.worldRenderer.setZoneMode(!this.worldRenderer.zoneMode); this.refresh(); } },
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

    // Aim follows the camera when walking or pointer-locked.
    if (this.rig.isWalking || this.input.pointerLocked) this.controller.updateAim(null);

    this.worldRenderer.update();
    this.worldRenderer.cullDistant(this.camera.position, 1600);

    const state = g.state;
    // Nudge the visible time of day toward evening for events so the lights come on.
    // Map the in-game day onto 08:00-20:00 so most play happens in daylight,
    // with the lights coming on late in the day.
    const dayT = state ? (0.34 + state.dayFraction * 0.5) : 0.5;
    const env = this.sky.update(dayT, state?.weather || 'sunny', this.camera.position, 1500);
    this.worldRenderer.setEnvironment(env);
    this.renderer.setClearColor(env.fogColor);

    this.renderer.render(this.scene, this.camera);
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !import.meta.env?.PROD) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
  }
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
  /** Push a specific catalogue event onto the board. */
  makeEvent(templateId, seed = Date.now() & 0xffff) {
    const tpl = EVENT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) throw new Error('unknown event template: ' + templateId);
    return instantiate(tpl, app.game.state, makeRng(seed));
  },
};

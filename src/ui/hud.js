import { el, fill, clear } from './dom.js';
import { scenarioLabel } from '../core/scenario.js';
import { fmtMoney, fmtNum } from '../core/economy.js';
import { audio } from '../core/audio.js';

/** Seconds the cash stat stays marked after it moves. */
const CASH_FLASH = 0.9;
/** Seconds the counter takes to travel whatever distance it is given. */
const CASH_SECONDS = 0.8;
/** Below this, a change is the day ticking over rather than news. */
const CASH_NOTICE = 250;

const NAV = [
  { key: 'home',    name: 'Home',    icon: '⌂' },
  { key: 'build',   name: 'Build',   icon: '▦' },
  { key: 'play',    name: 'Play',    icon: '▶' },
  { key: 'events',  name: 'Events',  icon: '⚑' },
  { key: 'finance', name: 'Finance', icon: '◴' },
  { key: 'more',    name: 'More',    icon: '≡' },
];

const WEATHER_ICON = { sunny: '☀', cloudy: '☁', rain: '☂', storm: '⚡', heat: '☀' };

/**
 * The persistent shell: stat bar, camera rail, tab bar, sheet host, toasts and
 * modals. Screens render into the sheet; nothing else touches the DOM root.
 */
export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.tab = 'home';
    this.onTab = null;
    this.onCamera = null;
    this.onSpeed = null;
    this.toastTimers = new Map();
    this.cashShown = undefined;
    this.cashTarget = undefined;
    this.cashFlash = 0;
    this.cashRate = 0;
    this.reducedMotion = false;
    this.build();
  }

  build() {
    // ------------------------------------------------------------- top bar
    this.cashV = el('div.v.num', { text: '$0' });
    this.cashStat = el('div.stat.cash', {}, el('div.k', { text: 'Cash' }), this.cashV);

    this.repV = el('div.v.num', { text: '0' });
    this.repStat = el('div.stat.rep', {}, el('div.k', { text: 'Rep' }), this.repV);

    this.capV = el('div.v.num', { text: '0' });
    this.capStat = el('div.stat.optional', {}, el('div.k', { text: 'Seats' }), this.capV);

    this.dayV = el('div.v.num', { text: 'Day 1' });
    this.dayStat = el('div.stat.optional-2', {}, el('div.k', { text: 'Date' }), this.dayV);

    this.weatherChip = el('button.chip.icon', {
      title: 'Weather', 'aria-label': 'Weather',
      onclick: () => this.onTab?.('home'),
    }, '☀');

    this.pauseChip = el('button.chip', {
      'aria-label': 'Pause or resume time',
      onclick: () => this.onSpeed?.('toggle'),
    }, '▶');

    this.speedChip = el('button.chip', {
      'aria-label': 'Change game speed',
      onclick: () => this.onSpeed?.('cycle'),
    }, '1x');

    this.skipChip = el('button.chip', {
      'aria-label': 'Skip to the next day', title: 'Skip a day',
      onclick: () => this.onSpeed?.('skip'),
    }, '⏭');

    // On a scenario run, the brief and the clock are the most important thing
    // on the screen, so they live in the top bar rather than three taps away.
    this.scenarioChip = el('button.chip', {
      'aria-label': 'Scenario objectives', title: 'Scenario objectives',
      style: { display: 'none' },
      onclick: () => this.onScenario?.(),
    });
    this.buildChip = el('button.chip', {
      'aria-label': 'Construction in progress', title: 'Construction in progress',
      style: { display: 'none' },
      onclick: () => this.onTab?.('home'),
    }, '\u2692 0%');

    // What the place needs doing right now. Hidden when there is nothing, so
    // an empty plot is not carrying a permanent zero.
    this.jobChip = el('button.chip.jobs', {
      'aria-label': 'Jobs waiting', title: 'Jobs waiting',
      style: { display: 'none' },
      onclick: () => this.onJobs?.(),
    }, '\u{1F4CB} 0');

    this.topbar = el('div.topbar', {},
      this.cashStat, this.repStat, this.capStat, this.dayStat,
      el('div.clockbox', {}, this.scenarioChip, this.jobChip, this.buildChip, this.weatherChip,
        this.pauseChip, this.speedChip, this.skipChip));

    // ---------------------------------------------------------- side rails
    this.cameraRail = el('div.railcol');
    this.rightRail = el('div.railcol');
    this.midrow = el('div.midrow', {}, this.cameraRail, this.rightRail);

    // ------------------------------------------------------------- bottom
    this.dockHost = el('div');
    this.navEls = new Map();
    const nav = el('div.botnav', { role: 'tablist' });
    for (const n of NAV) {
      const badge = el('span.badge', { style: { display: 'none' } });
      const b = el('button.nav', {
        role: 'tab', 'aria-label': n.name,
        onclick: () => this.onTab?.(n.key),
      }, el('span.i', { text: n.icon }), el('span.n', { text: n.name.toUpperCase() }), badge);
      b._badge = badge;
      this.navEls.set(n.key, b);
      nav.append(b);
    }
    this.nav = nav;

    // -------------------------------------------------------------- layers
    this.toasts = el('div.toasts', { 'aria-live': 'polite' });
    this.sheet = el('div.sheet.hidden', { onclick: (e) => { if (e.target === this.sheet) this.closeSheet(); } });
    this.sheetPanel = el('div.sheet-panel');
    this.sheet.append(this.sheetPanel);
    this.modal = el('div.modal.hidden');
    this.modalPanel = el('div.modal-panel');
    this.modal.append(this.modalPanel);
    this.touchLayer = el('div.touchlayer');
    this.statusLine = el('div.inspector', { style: { display: 'none' } });

    // Order matters: everything after `midrow` stacks above the dock in flow,
    // so nothing ever covers the hotbar or the tab bar.
    this.tutorialHost = el('div');
    this.hud = el('div.hud', {},
      this.topbar, this.midrow, this.statusLine, this.tutorialHost, this.dockHost, nav);
    this.root.append(this.hud, this.touchLayer, this.toasts, this.sheet, this.modal);
    this.watchChrome();
  }

  /**
   * Publish the height of the bottom chrome (build dock + tab bar) as
   * --chrome-h, so the floating stick and action pad sit above it instead of
   * on top of the hotbar. The dock changes height with the mode, so this has
   * to be measured rather than hard-coded.
   */
  watchChrome() {
    const measure = () => {
      const h = (this.dockHost?.offsetHeight || 0) + (this.nav?.offsetHeight || 0);
      this.root.style.setProperty('--chrome-h', h + 'px');
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      this.chromeObserver = new ResizeObserver(measure);
      this.chromeObserver.observe(this.dockHost);
      this.chromeObserver.observe(this.nav);
    }
    window.addEventListener('resize', measure);
  }

  // ------------------------------------------------------------------ rails
  setCameraButtons(modes, current, onPick) {
    clear(this.cameraRail);
    for (const m of modes) {
      this.cameraRail.append(el('button.rail-btn' + (m.key === current ? '.on' : ''), {
        title: `${m.name} camera \u2014 ${m.hint}`, 'aria-label': `${m.name} camera`,
        onclick: () => onPick(m.key),
      }, m.icon));
    }
  }

  setRightRail(buttons) {
    clear(this.rightRail);
    for (const b of buttons.filter(Boolean)) {
      this.rightRail.append(el('button.rail-btn' + (b.on ? '.on' : ''), {
        title: b.title, 'aria-label': b.title, disabled: b.disabled, onclick: b.onclick,
      }, el('span.g', { text: b.icon })));
    }
  }

  // ---------------------------------------------------------------- the till
  /**
   * Money arriving should read as something happening rather than a number
   * that was one thing and is now another. `refresh` only runs when something
   * asks it to, so the figure is eased toward its target per frame instead,
   * and the stat is marked for as long as it is moving.
   */
  setCash(value) {
    if (this.cashShown === undefined) {
      this.cashShown = value;
      this.cashTarget = value;
      this.cashV.textContent = fmtMoney(value);
      return;
    }
    if (value === this.cashTarget) return;
    const delta = value - this.cashTarget;
    this.cashTarget = value;
    // Close whatever gap is left in a fixed time, however big it is. Easing
    // by a fraction of the remaining gap never actually arrives: a five
    // million pound jump was still two thousand short a full second later,
    // and the stat sat lit up forever because it had never finished.
    this.cashRate = Math.abs(value - this.cashShown) / CASH_SECONDS;
    // Wages and gate receipts tick over constantly. Marking the stat for
    // those would leave it permanently lit and mean nothing, so only a change
    // that is actually worth looking up for gets the flash.
    if (Math.abs(delta) >= Math.max(CASH_NOTICE, Math.abs(value) * 0.001)) {
      this.cashStat.classList.toggle('up', delta > 0);
      this.cashStat.classList.toggle('down', delta < 0);
      this.cashFlash = CASH_FLASH;
    }
  }

  /** Per frame. Only the parts of the HUD that move on their own live here. */
  tick(dt) {
    if (this.cashTarget === undefined) return;
    if (this.cashFlash > 0 && (this.cashFlash -= dt) <= 0) {
      this.cashStat.classList.remove('up', 'down');
    }
    const gap = this.cashTarget - this.cashShown;
    if (gap === 0) return;
    if (this.reducedMotion || Math.abs(gap) < 1) {
      this.cashShown = this.cashTarget;
    } else {
      const step = Math.max(this.cashRate * dt, Math.abs(gap) * dt);
      this.cashShown += Math.sign(gap) * Math.min(Math.abs(gap), step);
      if (Math.abs(this.cashTarget - this.cashShown) < 1) this.cashShown = this.cashTarget;
    }
    this.cashV.textContent = fmtMoney(this.cashShown);
  }

  // ------------------------------------------------------------------- data
  refresh() {
    const s = this.game.state;
    if (!s) return;
    this.setCash(s.cash);
    this.cashStat.classList.toggle('negative', s.cash < 0);
    this.repV.textContent = Math.round(s.reputation.venue);
    this.capV.textContent = fmtNum(s.derived?.bestCapacity || 0);
    this.dayV.textContent = `Day ${s.day}`;
    this.weatherChip.textContent = WEATHER_ICON[s.weather] || '☀';
    this.weatherChip.title = `Weather: ${s.weather}`;
    this.pauseChip.textContent = s.paused ? '▶' : '⏸';
    this.pauseChip.classList.toggle('on', !s.paused);
    this.speedChip.textContent = `${s.speed}x`;

    const jobs = s.jobs?.live || [];
    if (jobs.length) {
      const urgent = jobs.filter((j) => (j.dueAt - (s.jobs.clock || 0)) <= 20).length;
      this.jobChip.style.display = '';
      this.jobChip.textContent = `\u{1F4CB} ${jobs.length}`;
      this.jobChip.classList.toggle('urgent', urgent > 0);
      this.jobChip.title = urgent
        ? `${jobs.length} jobs waiting, ${urgent} about to lapse`
        : `${jobs.length} job${jobs.length > 1 ? 's' : ''} waiting`;
    } else {
      this.jobChip.style.display = 'none';
      this.jobChip.classList.remove('urgent');
    }

    const projects = s.construction || [];
    if (projects.length) {
      const done = projects.reduce((a, p) => a + p.placed, 0);
      const total = projects.reduce((a, p) => a + p.total, 0) || 1;
      this.buildChip.style.display = '';
      this.buildChip.textContent = `\u2692 ${Math.round((done / total) * 100)}%`;
      this.buildChip.title = `${projects.length} project${projects.length > 1 ? 's' : ''} under construction`;
    } else {
      this.buildChip.style.display = 'none';
    }

    const label = scenarioLabel(s);
    if (label) {
      this.scenarioChip.style.display = '';
      this.scenarioChip.textContent = label;
      this.scenarioChip.classList.toggle('warn', !!s.scenario?.finished && s.scenario.outcome !== 'won');
      this.scenarioChip.classList.toggle('good', s.scenario?.outcome === 'won');
    } else {
      this.scenarioChip.style.display = 'none';
    }

    const openBids = s.events.board.filter((e) => e.status === 'open').length;
    this.setBadge('events', openBids);
  }

  setBadge(tab, n) {
    const b = this.navEls.get(tab);
    if (!b) return;
    b._badge.style.display = n > 0 ? 'flex' : 'none';
    b._badge.textContent = n > 9 ? '9+' : String(n);
  }

  setTab(tab) {
    this.tab = tab;
    for (const [k, b] of this.navEls) b.classList.toggle('on', k === tab);
  }

  setDock(node) {
    fill(this.dockHost, node || []);
  }

  setStatus(text, tone = '') {
    if (!text || this.statusHidden) { this.statusLine.style.display = 'none'; return; }
    this.statusLine.style.display = '';
    this.statusLine.className = 'inspector' + (tone ? ' ' + tone : '');
    if (typeof text === 'string') this.statusLine.textContent = text;
    else fill(this.statusLine, text);
  }

  // ----------------------------------------------------------------- sheets
  openSheet(title, body, opts = {}) {
    if (!this.sheetOpen) audio.play('open');
    // Which sheet is up, so a caller that wants to redraw its own can tell
    // without tracking it separately and drifting out of step.
    this.sheetName = opts.name || title;
    const head = el('div.sheet-head', {},
      el('h2', { text: title }),
      opts.action || null,
      el('button.close-x', { 'aria-label': 'Close', onclick: () => this.closeSheet() }, '✕'));
    const scroll = el('div.sheet-body', {}, body);
    fill(this.sheetPanel, opts.tabs ? [head, opts.tabs, scroll] : [head, scroll]);
    this.sheet.classList.remove('hidden');
    this.sheetBody = scroll;
    return scroll;
  }

  updateSheetBody(body) {
    if (this.sheetBody) fill(this.sheetBody, body);
  }

  closeSheet() {
    // Only a sheet that was actually open counts as closed. Firing the hook
    // unconditionally meant every setTab - which closes the sheet first - told
    // the app the player had just dismissed something and should be returned
    // to the build tab, so the nav highlight never matched the open screen.
    const wasOpen = this.sheetOpen;
    if (wasOpen) audio.play('close');
    this.sheetName = null;
    this.sheet.classList.add('hidden');
    clear(this.sheetPanel);
    this.sheetBody = null;
    if (wasOpen) this.onSheetClose?.();
  }

  get sheetOpen() { return !this.sheet.classList.contains('hidden'); }

  // ----------------------------------------------------------------- modals
  openModal(node, opts = {}) {
    fill(this.modalPanel, node);
    this.modal.classList.remove('hidden');
    this.modalDismissable = opts.dismissable !== false;
    this.modal.onclick = (e) => {
      if (e.target === this.modal && this.modalDismissable) this.closeModal();
    };
  }

  closeModal() {
    this.modal.classList.add('hidden');
    clear(this.modalPanel);
    this.onModalClose?.();
  }

  get modalOpen() { return !this.modal.classList.contains('hidden'); }

  // ----------------------------------------------------------------- toasts
  toast({ kind = 'info', title, body, id = Math.random().toString(36).slice(2) }) {
    const node = el('div.toast.' + kind, { role: 'status' },
      el('div.t', { text: title }),
      body && el('div.b', { text: body }));
    node.addEventListener('click', () => this.dismissToast(id, node));
    this.toasts.append(node);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    const timer = setTimeout(() => this.dismissToast(id, node), kind === 'achievement' ? 5200 : 3600);
    this.toastTimers.set(id, timer);
  }

  dismissToast(id, node) {
    clearTimeout(this.toastTimers.get(id));
    this.toastTimers.delete(id);
    node.remove();
  }
}

export { NAV, WEATHER_ICON };

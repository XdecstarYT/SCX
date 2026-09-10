import { el, fill } from './dom.js';

/**
 * Contextual tutorial. It never blocks input and never scripts the camera -
 * it just watches the real game state and tells the player the next useful
 * thing to do. Completing the list walks the entire core loop.
 */
const STEPS = [
  {
    id: 'place',
    title: 'Place your first blocks',
    body: 'Pick a material from the hotbar and tap the ground. Or press 1ST to walk in and build up close: look at a face, tap to place, hold to sweep out a run.',
    done: (g) => g.state.stats.blocksPlaced >= 1,
  },
  {
    id: 'pitch',
    title: 'Lay a regulation pitch',
    body: 'Choose Surfaces → Natural Turf and the Floor tool, then tap two opposite corners. Football needs at least 45×28 blocks (90m×56m).',
    done: (g) => (g.primaryVenue?.field?.regulation ?? 0) >= 1,
  },
  {
    id: 'seats',
    title: 'Build seating around it',
    body: 'Seating → Seating, then use Floor or Wall to ring the pitch. Stack tiers upward for more capacity. Each seating block holds 6 fans.',
    done: (g) => (g.primaryVenue?.capacity.total ?? 0) >= 600,
  },
  {
    id: 'gates',
    title: 'Add entrances and exits',
    body: 'Switch to ZONE mode and paint Entrance and Emergency Exit areas on the ground outside the stands. Without them the crowd cannot get in.',
    done: (g) => (g.primaryVenue?.facilities.entrance ?? 0) > 0 && (g.primaryVenue?.facilities.exit ?? 0) > 0,
  },
  {
    id: 'rooms',
    title: 'Build the back of house',
    body: 'Build rooms with the Room tool, then zone them as Locker Room, Medical, Restrooms and Concessions. The simulation checks all four.',
    done: (g) => {
      const f = g.primaryVenue?.facilities;
      return !!f && f.locker > 0 && f.medical > 0 && f.restroom > 0 && f.concession > 0;
    },
  },
  {
    id: 'parking',
    title: 'Connect roads and parking',
    body: 'Asphalt for parking, and Roads & Parking \u2192 Main Road to reach it. A big stadium with nowhere to park gets marked down badly. The Garage tool stacks parking upward when you run out of ground.',
    done: (g) => (g.analysis.complex?.parkingCars ?? 0) > 100,
  },
  {
    id: 'register',
    title: 'Register your venue',
    body: 'The game has worked out what you built. Open Home and register the venue so organisers will deal with you.',
    done: (g) => g.state.venues.registered.length > 0,
  },
  {
    id: 'bid',
    title: 'Bid for an event',
    body: 'Open Events. Pick an opportunity your venue qualifies for, set your offer, and submit. You will not win every bid.',
    done: (g) => g.state.stats.bidsPlaced > 0,
  },
  {
    id: 'host',
    title: 'Host it',
    body: 'Let the clock run (or use the skip button) until event day. Fans will arrive in your stadium and you will get a full financial report.',
    done: (g) => g.state.stats.eventsHosted > 0,
  },
  {
    id: 'utilities',
    title: 'Keep the site supplied',
    body: 'Management \u2192 Infra shows power, water, wastewater, data and climate. Demand comes from what you built. A network over capacity fails during events.',
    done: (g) => Object.values(g.state.utilityStatus || {}).every((u) => u.deficit === 0),
  },
  {
    id: 'expand',
    title: 'Now grow it',
    body: 'More seats unlock bigger events; better facilities unlock higher tiers. The venue report says exactly what is holding you back. Later, Management \u2192 Empire lets you buy land in another city entirely.',
    done: (g) => g.state.stats.eventsHosted >= 2,
  },
];

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.node = el('div.tutorial', { style: { display: 'none' } });
    this.lastId = null;
  }

  get state() { return this.app.game.state.tutorial; }

  current() {
    const g = this.app.game;
    for (let i = 0; i < STEPS.length; i++) {
      if (!STEPS[i].done(g)) return { step: STEPS[i], index: i };
    }
    return null;
  }

  /** Temporarily hide the panel (e.g. during the event-day cinematic). */
  setSuppressed(v) { this.suppressed = v; this.refresh(); }

  refresh() {
    const t = this.state;
    if (t.dismissed || this.suppressed) { this.node.style.display = 'none'; return; }
    const cur = this.current();
    if (!cur) {
      if (!t.finished) {
        t.finished = true;
        this.app.toast('achievement', 'Tutorial complete', 'You have run the whole loop: build, register, bid, host, earn.');
      }
      this.node.style.display = 'none';
      return;
    }

    // Celebrate the moment a step ticks over.
    if (this.lastId && this.lastId !== cur.step.id) {
      const prev = STEPS.find((s) => s.id === this.lastId);
      if (prev) this.app.toast('bid', 'Step complete', prev.title);
    }
    this.lastId = cur.step.id;
    t.step = cur.index;

    this.node.style.display = '';
    this.node.classList.toggle('min', !!this.minimised);
    fill(this.node,
      el('div.rowbetween', {},
        el('span.step', { text: `Getting started · ${cur.index + 1} of ${STEPS.length}` }),
        el('button.chip', { 'aria-label': 'Hide the tutorial', onclick: () => this.dismiss() }, '✕')),
      el('div.t', { text: cur.step.title }),
      el('div.b', { text: cur.step.body }));
  }

  dismiss() {
    this.state.dismissed = true;
    this.node.style.display = 'none';
  }

  show() {
    this.state.dismissed = false;
    this.refresh();
  }
}

export { STEPS };

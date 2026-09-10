import { VoxelWorld } from '../voxel/world.js';
import { History } from '../voxel/history.js';
import { EventBus } from './eventBus.js';
import { createState, attachDerived, applyReputation, landInfo, SAVE_VERSION } from './gameState.js';
import { SECONDS_PER_DAY, DAYS_PER_MONTH, LAND_TIERS, GROUND_Y } from './constants.js';
import { detectVenues } from '../venues/venueDetection.js';
import { generateEvent, boardCapacity, resetEventIds } from '../events/eventGenerator.js';
import { evaluateBid, resolveBid, PRICING_TIERS } from '../events/bidding.js';
import { Negotiation, ROUNDS_BY_TIER } from '../events/negotiation.js';
import { simulateEvent } from '../events/eventSimulation.js';
import { bestVenueFor, checkRequirements } from '../events/eventRequirements.js';
import { applyDailyFinance, monthlyFinance, LEDGER_CATEGORIES } from './economy.js';
import { STAFF_ROLES, makeHire } from '../data/staff.js';
import { SPONSORS, availableSponsors } from '../data/sponsors.js';
import { RESEARCH, researchAvailable } from '../data/research.js';
import { RANDOM_EVENTS } from '../data/randomEvents.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { makeRng, hashString } from './rng.js';

const WEATHERS = ['sunny', 'sunny', 'cloudy', 'cloudy', 'rain', 'heat', 'storm'];

/**
 * The game hub. Owns the world, the state, and every system that mutates
 * them. The UI reads from here and calls methods; it never mutates state
 * directly.
 */
export class Game {
  constructor() {
    this.bus = new EventBus();
    this.world = null;
    this.state = null;
    this.history = null;
    this.analysis = { venues: [], complex: {}, stats: {} };
    this.analysisDirty = true;
    this.lastAnalysisVersion = -1;
    this.planning = null;   // { marker, cost }
    this.accumulator = 0;
  }

  // ------------------------------------------------------------- lifecycle
  newGame(opts = {}) {
    this.state = createState(opts);
    this.world = new VoxelWorld(LAND_TIERS[0].size);
    this.world.generateTerrain();
    this.history = new History(this.world);
    resetEventIds(1);
    this.analysisDirty = true;
    this.analyze(true);
    this.refreshBoard(true);
    this.bus.emit('newgame');
    this.bus.emit('state');
    return this;
  }

  adopt(state, world) {
    this.state = state;
    this.world = world;
    this.history = new History(world);
    this.analysisDirty = true;
    this.analyze(true);
    this.bus.emit('state');
    return this;
  }

  // ----------------------------------------------------------------- clock
  /** @param dt seconds of real time */
  tick(dt) {
    const s = this.state;
    if (!s || s.paused) { this.maybeAnalyze(); return; }
    const days = (dt * s.speed) / SECONDS_PER_DAY;
    s.dayFraction += days;
    let guard = 0;
    while (s.dayFraction >= 1 && guard++ < 40) {
      s.dayFraction -= 1;
      this.advanceDay();
    }
    this.maybeAnalyze();
  }

  /** Skip straight to tomorrow. */
  skipDay(n = 1) {
    for (let i = 0; i < n; i++) this.advanceDay();
    this.state.dayFraction = 0;
    this.bus.emit('state');
  }

  advanceDay() {
    const s = this.state;
    s.day++;
    this.analyze();

    // Recurring finance. Per-category amounts feed the monthly rollup; a
    // single aggregated row keeps the ledger readable.
    let opsNet = 0;
    applyDailyFinance(s, this.analysis, (cat, amt) => {
      s.cash += amt;
      opsNet += amt;
      this.record(cat, amt, true);
    });
    if (Math.abs(opsNet) >= 1) {
      s.finance.ledger.unshift({
        day: s.day, category: 'operations', amount: Math.round(opsNet), recurring: true,
      });
      if (s.finance.ledger.length > 200) s.finance.ledger.pop();
    }

    // Loan amortisation
    for (const l of s.loans) {
      const monthlyPay = l.principal / (l.years * 12) + l.balance * l.rate / 12;
      const pay = monthlyPay / DAYS_PER_MONTH;
      if (s.cash >= pay) { s.cash -= pay; l.balance = Math.max(0, l.balance - pay * 0.6); }
    }
    s.loans = s.loans.filter((l) => l.balance > 1);

    // Weather
    if (s.day >= s.weatherUntilDay) {
      const rng = makeRng(hashString(`${s.seed}:weather:${s.day}`));
      s.weather = rng.pick(WEATHERS);
      s.weatherUntilDay = s.day + rng.int(2, 5);
    }

    // Research progress
    if (s.research.active) {
      s.research.active.daysLeft--;
      if (s.research.active.daysLeft <= 0) {
        const done = s.research.active.id;
        s.research.completed.push(done);
        s.research.active = null;
        const node = RESEARCH.find((r) => r.id === done);
        this.notify('research', `Research complete: ${node.name}`, node.desc);
      }
    }

    // Event board upkeep
    this.expireEvents();
    this.refreshBoard();
    this.hostDueEvents();
    this.tickRivals();
    this.maybeRandomEvent();

    // Insolvency: a real pinch, but never an instant loss.
    if (s.cash < 0) {
      applyReputation(s, { venue: -0.06, organiser: -0.08 });
      if (!s._insolventSince) {
        s._insolventSince = s.day;
        this.notify('warn', 'You are running a deficit',
          'Cut costs, host an event, or take a loan from the Finance tab.');
      }
    } else if (s._insolventSince) {
      delete s._insolventSince;
    }

    // Monthly rollup
    const month = Math.floor(s.day / DAYS_PER_MONTH);
    if (month !== s.finance.lastMonth) {
      s.finance.lastMonth = month;
      const fin = monthlyFinance(s, this.analysis);
      s.finance.months.push({ month, day: s.day, ...fin, cash: Math.round(s.cash) });
      if (s.finance.months.length > 36) s.finance.months.shift();
      this.decayStaffMorale();
    }

    this.checkAchievements();
    this.bus.emit('day', s.day);
    this.bus.emit('state');
  }

  // -------------------------------------------------------------- analysis
  markWorldDirty() { this.analysisDirty = true; }

  maybeAnalyze() {
    if (!this.analysisDirty) return;
    if (this.world.version === this.lastAnalysisVersion) { this.analysisDirty = false; return; }
    const now = performance.now();
    if (this._lastAnalysisAt && now - this._lastAnalysisAt < 700) return;
    this.analyze(true);
  }

  analyze(force = false) {
    if (!force && !this.analysisDirty) return this.analysis;
    this._lastAnalysisAt = performance.now();
    this.lastAnalysisVersion = this.world.version;
    this.analysisDirty = false;

    const a = detectVenues(this.world, {
      complexName: this.state.complexName,
      powerCapacity: this.state.powerCapacity ?? 15,
    });

    // Carry player-chosen names and registration across re-analysis.
    for (const v of a.venues) {
      const reg = this.state.venues.registered.find(
        (r) => r.key === v.key || (r.sport === v.sport && Math.hypot(r.cx - v.centre.x, r.cz - v.centre.z) < 26));
      if (reg) {
        v.registered = true;
        v.name = reg.name;
        reg.key = v.key;
        reg.cx = v.centre.x; reg.cz = v.centre.z;
        reg.capacity = v.capacity.total; reg.rating = v.ratings.overall; reg.tier = v.tier;
      } else {
        v.registered = false;
        v.name = v.suggestedName;
      }
      // Temporary seats and closures from random events.
      if (this.state.tempSeats) v.capacity.total += Math.round(this.state.tempSeats * (v === a.venues[0] ? 1 : 0));
      if (this.state.capacityPenalty) v.capacity.total = Math.round(v.capacity.total * (1 - this.state.capacityPenalty));
    }
    // Drop registrations whose venue no longer exists.
    this.state.venues.registered = this.state.venues.registered.filter(
      (r) => a.venues.some((v) => v.key === r.key));

    this.analysis = a;
    attachDerived(this.state, a);

    const st = this.state.stats;
    st.venuesDetected = Math.max(st.venuesDetected, a.venues.length);
    st.regulationFields = a.venues.filter((v) => v.field && v.field.regulation >= 1).length;
    st.bestCapacity = Math.max(st.bestCapacity, this.state.derived.bestCapacity);
    st.bestRating = Math.max(st.bestRating, this.state.derived.bestRating);

    this.bus.emit('analysis', a);
    return a;
  }

  get venues() { return this.analysis.venues; }
  get primaryVenue() { return this.analysis.venues[0] || null; }

  registerVenue(key, name) {
    const v = this.analysis.venues.find((x) => x.key === key);
    if (!v) return false;
    if (this.state.venues.registered.some((r) => r.key === key)) return false;
    this.state.venues.registered.push({
      key, name: name || v.suggestedName, sport: v.sport,
      cx: v.centre.x, cz: v.centre.z, registeredDay: this.state.day,
      capacity: v.capacity.total, rating: v.ratings.overall, tier: v.tier,
    });
    v.registered = true;
    v.name = name || v.suggestedName;
    this.notify('venue', 'Venue registered', `${v.name} is now open for event bidding.`);
    this.checkAchievements();
    this.bus.emit('state');
    return true;
  }

  renameVenue(key, name) {
    const reg = this.state.venues.registered.find((r) => r.key === key);
    if (reg) reg.name = name;
    const v = this.analysis.venues.find((x) => x.key === key);
    if (v) v.name = name;
    this.bus.emit('state');
  }

  registeredVenues() {
    return this.analysis.venues.filter((v) => v.registered);
  }

  // ---------------------------------------------------------------- events
  refreshBoard(initial = false) {
    const s = this.state;
    const cap = boardCapacity(s);
    const openCount = s.events.board.filter((e) => e.status === 'open').length;
    if (openCount >= cap) return;

    const rng = makeRng(hashString(`${s.seed}:board:${s.day}`));
    const wantsNew = initial ? cap : (rng.chance(0.42) ? 1 : 0);
    for (let i = 0; i < wantsNew; i++) {
      const ev = generateEvent(s, s.events.board.length + i + s.day * 7);
      if (!ev) continue;
      if (s.events.board.some((e) => e.templateId === ev.templateId && e.status === 'open')) continue;
      s.events.board.push(ev);
      if (!initial) this.notify('event', 'New event opportunity', `${ev.name} - ${ev.organiser}`);
    }
    s.events.lastGeneratedDay = s.day;
  }

  expireEvents() {
    const s = this.state;
    for (const e of s.events.board) {
      if (e.status === 'open' && s.day > e.bidDeadline) {
        e.status = 'expired';
        this.notify('event', 'Bid window closed', `${e.name} went elsewhere.`);
      }
    }
    s.events.board = s.events.board.filter(
      (e) => !(['expired', 'lost'].includes(e.status) && s.day > e.bidDeadline + 3));
  }

  /** Evaluate a hypothetical bid. Pure - safe to call on every slider move. */
  previewBid(eventUid, bid) {
    const ev = this.findEvent(eventUid);
    if (!ev) return null;
    const venue = bid.venueKey
      ? this.analysis.venues.find((v) => v.key === bid.venueKey)
      : bestVenueFor(ev, this.registeredVenues(), this.state).venue;
    const evaluation = evaluateBid(ev, venue, this.state, bid);
    const projection = this.projectEvent(ev, venue, bid);
    return { ev, venue, evaluation, projection };
  }

  /** Best-guess economics shown before committing to a bid. */
  projectEvent(ev, venue, bid) {
    if (!venue) return null;
    const probe = { ...this.state, weather: 'sunny' };
    const sim = simulateEvent(ev, venue, probe, bid);
    return {
      attendance: sim.attendance,
      revenue: sim.totalRevenue,
      costs: sim.totalCost,
      profit: sim.profit - bid.amount,
      satisfaction: sim.satisfaction,
    };
  }

  /**
   * Does this offer trigger a negotiation? Organisers only bother haggling
   * when the bid is already credible, which makes reaching one feel like
   * progress rather than an obstacle.
   */
  negotiationFor(eventUid, bid) {
    const ev = this.findEvent(eventUid);
    if (!ev || ev.status !== 'open') return null;
    if ((ROUNDS_BY_TIER[ev.tier] || 0) === 0) return null;
    const venue = this.analysis.venues.find((v) => v.key === bid.venueKey);
    if (!venue) return null;
    const evaluation = evaluateBid(ev, venue, this.state, { ...bid, negotiation: null });
    if (!evaluation.check.ok) return null;
    if (evaluation.winChance < 0.18) return null;
    const session = new Negotiation(ev, venue, this.state);
    return session.rounds.length ? session : null;
  }

  submitBid(eventUid, bid) {
    const s = this.state;
    const ev = this.findEvent(eventUid);
    if (!ev || ev.status !== 'open') return { error: 'This event is no longer open.' };
    const venue = this.analysis.venues.find((v) => v.key === bid.venueKey);
    if (!venue) return { error: 'Select a registered venue first.' };
    if (!venue.registered) return { error: 'That venue is not registered yet.' };

    const evaluation = evaluateBid(ev, venue, s, bid);
    if (!evaluation.check.ok) return { error: 'Your venue does not meet the requirements yet.' };
    if (bid.amount > s.cash) return { error: 'You cannot cover this bid.' };

    s.stats.bidsPlaced++;
    const outcome = resolveBid(ev, evaluation, bid);
    ev.bid = { ...bid, venueKey: venue.key, strength: evaluation.strength, winChance: evaluation.winChance };

    if (outcome.won) {
      ev.status = 'scheduled';
      s.cash -= bid.amount;
      this.record('eventCosts', -bid.amount);
      s.stats.bidsWon++;
      s.organiserHistory[ev.organiser] = (s.organiserHistory[ev.organiser] || 0) + 1;
      s.events.scheduled.push(ev);
      s.events.board = s.events.board.filter((e) => e.uid !== ev.uid);
      applyReputation(s, { organiser: 2 });
      this.notify('bid', 'Bid won', `${ev.name} will be held at ${venue.name} on day ${ev.eventDay}.`);
    } else {
      ev.status = 'lost';
      s.stats.bidsLost++;
      applyReputation(s, { organiser: -0.5 });
      if (outcome.winner) {
        const rival = s.rivals.find((r) => r.id === outcome.winner.id);
        if (rival) { rival.eventsWon++; rival.reputation = Math.min(100, rival.reputation + 1.5); }
      }
      this.notify('bid', 'Bid lost', outcome.winner
        ? `${outcome.winner.name} won the rights to ${ev.name}.`
        : `The organiser passed on ${ev.name}.`);
    }
    this.checkAchievements();
    this.bus.emit('bidresult', { ev, outcome, evaluation, venue });
    this.bus.emit('state');
    return { ok: true, outcome, evaluation, ev, venue };
  }

  hostDueEvents() {
    const s = this.state;
    const due = s.events.scheduled.filter((e) => e.eventDay <= s.day);
    for (const ev of due) {
      const venue = this.analysis.venues.find((v) => v.key === ev.bid.venueKey) || this.primaryVenue;
      if (!venue) { ev.status = 'cancelled'; continue; }
      const report = simulateEvent(ev, venue, s, ev.bid);
      this.applyEventReport(ev, report);
    }
    s.events.scheduled = s.events.scheduled.filter((e) => e.eventDay > s.day);
  }

  applyEventReport(ev, report) {
    const s = this.state;
    for (const [k, v] of Object.entries(report.revenue)) if (v) this.record(k, v);
    for (const [k, v] of Object.entries(report.costs)) if (v) this.record(mapCost(k), -v);
    s.cash += report.profit;
    applyReputation(s, report.repDelta);

    ev.status = 'hosted';
    ev.report = report;
    s.events.history.unshift(report);
    if (s.events.history.length > 60) s.events.history.pop();

    const st = s.stats;
    st.eventsHosted++;
    st.totalAttendance += report.attendance;
    st.lifetimeRevenue += report.totalRevenue;
    st.lifetimeCosts += report.totalCost;
    st.lifetimeProfit += report.profit;
    if (report.soldOut) st.sellouts++;
    st.bestSatisfaction = Math.max(st.bestSatisfaction, report.satisfaction);
    if (!st.tiersHosted.includes(ev.tier)) st.tiersHosted.push(ev.tier);
    if (!st.sportsHosted.includes(ev.sport)) st.sportsHosted.push(ev.sport);

    this.checkAchievements();
    this.bus.emit('eventreport', report);
  }

  findEvent(uid) {
    return this.state.events.board.find((e) => e.uid === uid)
      || this.state.events.scheduled.find((e) => e.uid === uid);
  }

  // ---------------------------------------------------------------- rivals
  tickRivals() {
    const s = this.state;
    if (s.day % 24 !== 0) return;
    const rng = makeRng(hashString(`${s.seed}:rivals:${s.day}`));
    for (const r of s.rivals) {
      if (!rng.chance(0.35)) continue;
      const invest = rng.range(0.02, 0.07);
      r.quality = Math.min(98, r.quality + invest * 30);
      r.capacity = Math.round(r.capacity * (1 + invest * 0.4));
      r.reputation = Math.min(98, r.reputation + invest * 12);
      r.lastExpansion = s.day;
    }
  }

  // -------------------------------------------------------- random events
  maybeRandomEvent() {
    const s = this.state;
    if (s.pendingRandomEvent) return;
    if (s.day - s.lastRandomEventDay < 9) return;
    const rng = makeRng(hashString(`${s.seed}:rnd:${s.day}`));
    if (!rng.chance(0.22)) return;
    const pool = RANDOM_EVENTS.filter((e) => s.reputation.venue >= e.minRep);
    if (!pool.length) return;
    const weighted = [];
    for (const e of pool) for (let i = 0; i < e.weight; i++) weighted.push(e);
    const chosen = rng.pick(weighted);
    s.pendingRandomEvent = { id: chosen.id, day: s.day, seed: rng.int(1, 1e9) };
    s.lastRandomEventDay = s.day;
    this.bus.emit('randomevent', this.currentRandomEvent());
  }

  currentRandomEvent() {
    const p = this.state.pendingRandomEvent;
    if (!p) return null;
    const def = RANDOM_EVENTS.find((e) => e.id === p.id);
    return def ? { ...def, seed: p.seed } : null;
  }

  resolveRandomEvent(optionIndex) {
    const s = this.state;
    const def = this.currentRandomEvent();
    if (!def) return null;
    const opt = def.options[optionIndex];
    if (!opt) return null;
    const rng = makeRng(s.pendingRandomEvent.seed);

    let text = opt.result;
    let applied = { ...opt.effects };
    if (opt.risk !== undefined) {
      const lucky = rng() > opt.risk;
      if (lucky && opt.goodResult) { text = opt.goodResult; applied = {}; }
    }
    if (opt.cost) { s.cash -= opt.cost; this.record('misc', -opt.cost); }
    if (applied.cash) { s.cash += applied.cash; this.record('misc', applied.cash); }

    applyReputation(s, {
      venue: applied.repVenue || 0, fans: applied.repFans || 0,
      community: applied.repCommunity || 0, organiser: applied.repOrganiser || 0,
      athletes: applied.repAthletes || 0,
    });
    if (applied.morale) for (const h of s.staff) h.morale = Math.max(5, Math.min(100, h.morale + applied.morale));
    if (applied.rivalBoost) for (const r of s.rivals) { r.quality = Math.min(98, r.quality + 3); r.capacity = Math.round(r.capacity * 1.08); }

    const durable = ['buildCostMult', 'salaryMult', 'capacityPenalty', 'tempSeats', 'sponsorLock', 'wear'];
    if (durable.some((k) => applied[k] !== undefined)) {
      s.modifiers.push({
        source: def.id, untilDay: s.day + (applied.durationDays || 60),
        buildCostMult: applied.buildCostMult, salaryMult: applied.salaryMult,
        capacityPenalty: applied.capacityPenalty, tempSeats: applied.tempSeats,
        sponsorLock: applied.sponsorLock ? true : undefined, wear: applied.hazard ? 0.15 : undefined,
      });
    }
    s.pendingRandomEvent = null;
    this.analysisDirty = true;
    this.analyze(true);
    this.bus.emit('state');
    return { text, title: def.title };
  }

  // ----------------------------------------------------------------- staff
  candidates(count = 4) {
    const rng = makeRng(hashString(`${this.state.seed}:cand:${this.state.day}`));
    const roles = rng.shuffle(STAFF_ROLES).slice(0, count);
    return roles.map((r) => ({ role: r, hire: makeHire(r, rng) }));
  }

  hire(roleId, hireData) {
    const s = this.state;
    const role = STAFF_ROLES.find((r) => r.id === roleId);
    if (!role) return false;
    const cost = hireData.salary * 0.5;
    if (s.cash < cost) return { error: 'Not enough cash for the signing fee.' };
    s.cash -= cost;
    this.record('staff', -cost);
    s.staff.push({ ...hireData, hiredDay: s.day });
    attachDerived(s, this.analysis);
    this.bus.emit('state');
    return { ok: true };
  }

  fire(uid) {
    const s = this.state;
    const h = s.staff.find((x) => x.uid === uid);
    if (!h) return;
    const severance = h.salary;
    s.cash -= severance;
    this.record('staff', -severance);
    s.staff = s.staff.filter((x) => x.uid !== uid);
    for (const o of s.staff) o.morale = Math.max(5, o.morale - 3);
    attachDerived(s, this.analysis);
    this.bus.emit('state');
  }

  decayStaffMorale() {
    const s = this.state;
    const healthy = s.cash > 0;
    for (const h of s.staff) {
      h.morale = Math.max(3, Math.min(100, h.morale + (healthy ? 1.5 : -8)));
      h.experience += 1 / 12;
    }
  }

  // -------------------------------------------------------------- sponsors
  sponsorOffers() {
    if (this.state.sponsorLocked) return [];
    return availableSponsors(this.state, this.state.derived.bestCapacity || 0);
  }

  signSponsor(id) {
    const s = this.state;
    const sp = SPONSORS.find((x) => x.id === id);
    if (!sp) return { error: 'Unknown sponsor.' };
    if (s.sponsors.some((x) => x.id === id)) return { error: 'Already signed.' };
    if (s.sponsorLocked) return { error: 'An exclusivity deal blocks new sponsors.' };
    s.sponsors.push({ ...sp, signedDay: s.day, expiresDay: s.day + sp.years * 360 });
    if (sp.naming) {
      const primary = this.primaryVenue;
      if (primary) this.registerOrRename(primary, `${sp.name} ${primary.type.split(' ').slice(-2).join(' ')}`);
    }
    applyReputation(s, { venue: sp.prestige * 0.4, community: sp.community || 0 });
    attachDerived(s, this.analysis);
    this.notify('sponsor', `${sp.name} signed`, sp.bonus);
    this.checkAchievements();
    this.bus.emit('state');
    return { ok: true };
  }

  registerOrRename(venue, name) {
    if (venue.registered) this.renameVenue(venue.key, name);
    else this.registerVenue(venue.key, name);
  }

  // -------------------------------------------------------------- research
  researchOptions() { return researchAvailable(this.state); }

  startResearch(id) {
    const s = this.state;
    if (s.research.active) return { error: 'Another project is already running.' };
    const node = RESEARCH.find((r) => r.id === id);
    if (!node) return { error: 'Unknown project.' };
    if (s.cash < node.cost) return { error: 'Not enough cash.' };
    s.cash -= node.cost;
    this.record('research', -node.cost);
    s.research.active = { id, daysLeft: node.days, totalDays: node.days };
    this.bus.emit('state');
    return { ok: true };
  }

  isUnlocked(unlockId) {
    if (!unlockId) return true;
    return this.state.research.completed.includes(unlockId);
  }

  // ------------------------------------------------------------------ land
  land() { return landInfo(this.state); }

  buyLand() {
    const s = this.state;
    const { next } = landInfo(s);
    if (!next) return { error: 'You already own the largest plot.' };
    if (s.cash < next.cost) return { error: `You need ${Math.round(next.cost / 1e6)}M to expand.` };
    s.cash -= next.cost;
    this.record('land', -next.cost);
    s.landTier++;
    this.world.expandTo(next.size);
    this.analysisDirty = true;
    this.analyze(true);
    this.notify('land', 'Land acquired', `Your plot is now ${next.label}.`);
    this.checkAchievements();
    this.bus.emit('landchange');
    this.bus.emit('state');
    return { ok: true };
  }

  // --------------------------------------------------------------- finance
  record(category, amount, silent = false) {
    const s = this.state;
    const acc = s.finance.monthAccum;
    acc[category] = (acc[category] || 0) + amount;
    if (!silent && Math.abs(amount) >= 1) {
      s.finance.ledger.unshift({ day: s.day, category, amount: Math.round(amount) });
      if (s.finance.ledger.length > 200) s.finance.ledger.pop();
    }
    if (category !== 'construction') return;
  }

  /** Charge construction. Returns false when the player cannot afford it. */
  spendConstruction(amount, allowDebt = false) {
    const s = this.state;
    const total = amount * s.buildCostMult;
    if (!allowDebt && total > s.cash) return false;
    s.cash -= total;
    s.stats.moneySpentBuilding += total;
    this.record('construction', -total);
    this.bus.emit('state');
    return true;
  }

  refund(amount) {
    this.state.cash += amount;
    this.record('construction', amount);
    this.bus.emit('state');
  }

  // ---------------------------------------------------------- achievements
  checkAchievements() {
    const s = this.state;
    for (const a of ACHIEVEMENTS) {
      if (s.achievements.includes(a.id)) continue;
      let ok = false;
      try { ok = a.check(s); } catch { ok = false; }
      if (ok) {
        s.achievements.push(a.id);
        this.notify('achievement', a.name, a.desc);
      }
    }
  }

  notify(kind, title, body) {
    this.bus.emit('notify', { kind, title, body, day: this.state.day, id: Math.random().toString(36).slice(2) });
  }
}

const COST_MAP = {
  staff: 'staff', security: 'security', cleaning: 'eventCosts', utilities: 'utilities',
  setup: 'eventCosts', insurance: 'insurance', marketing: 'marketing',
  transport: 'eventCosts', packages: 'eventCosts', incidents: 'eventCosts',
};
function mapCost(k) { return COST_MAP[k] || 'eventCosts'; }

export { LEDGER_CATEGORIES, PRICING_TIERS, STAFF_ROLES, SPONSORS, RESEARCH, ACHIEVEMENTS, checkRequirements, bestVenueFor };

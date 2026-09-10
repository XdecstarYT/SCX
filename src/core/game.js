import { VoxelWorld } from '../voxel/world.js';
import { History } from '../voxel/history.js';
import { EventBus } from './eventBus.js';
import { createState, attachDerived, applyReputation, landInfo, activeSite, utilityStatusFor, SAVE_VERSION } from './gameState.js';
import { CITIES, city as cityDef, climateEffects } from '../data/cities.js';
import { SECONDS_PER_DAY, DAYS_PER_MONTH, LAND_TIERS, GROUND_Y } from './constants.js';
import { detectVenues, rescoreVenues } from '../venues/venueDetection.js';
import { generateEvent, boardCapacity, resetEventIds } from '../events/eventGenerator.js';
import { evaluateBid, resolveBid, PRICING_TIERS } from '../events/bidding.js';
import { Negotiation, ROUNDS_BY_TIER } from '../events/negotiation.js';
import { simulateEvent } from '../events/eventSimulation.js';
import { bestVenueFor, checkRequirements } from '../events/eventRequirements.js';
import { applyDailyFinance, monthlyFinance, LEDGER_CATEGORIES } from './economy.js';
import { driftCommunity, communityReport } from './community.js';
import {
  createProject, tickConstruction, rushProject, cancelProject,
  constructionSummary, shouldStage, projectDays,
} from './construction.js';
import { STAFF_ROLES, makeHire } from '../data/staff.js';
import { SPONSORS, ALL_SPONSORS, availableSponsors, blockedSponsors } from '../data/sponsors.js';
import { RESEARCH, researchAvailable } from '../data/research.js';
import { UTILITIES, UTILITY_KEYS, nextTier } from '../data/utilities.js';
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
    // One voxel world and one cached analysis per site. `world` and `analysis`
    // always resolve to whichever site the player is standing on.
    this.worlds = new Map();
    this.analyses = new Map();
    this.state = null;
    this.history = null;
    this.analysisDirty = true;
    this.lastAnalysisVersion = -1;
    this.planning = null;   // { marker, cost }
    this.accumulator = 0;
  }

  get siteId() { return this.state?.activeSite || 'site1'; }
  get world() { return this.worlds.get(this.siteId); }
  set world(w) { this.worlds.set(this.siteId, w); }
  get site() { return activeSite(this.state); }
  get analysis() {
    return this.analyses.get(this.siteId) || { venues: [], complex: {}, stats: {} };
  }
  set analysis(a) { this.analyses.set(this.siteId, a); }

  /**
   * Every detected venue across every site.
   *
   * These are the live venue objects, not copies: registering or renaming one
   * has to stick until the next analysis pass, and analyze() already tags each
   * venue with the site it belongs to.
   */
  allVenues() {
    const out = [];
    for (const site of this.state.sites) {
      const a = this.analyses.get(site.id);
      if (!a) continue;
      for (const v of a.venues) out.push(v);
    }
    return out;
  }

  allRegisteredVenues() { return this.allVenues().filter((v) => v.registered); }

  /** Site-by-site rollup for the empire screen and for finance. */
  empire() {
    const sites = this.state.sites.map((site) => {
      const a = this.analyses.get(site.id) || { venues: [], complex: {} };
      const c = cityDef(site.cityId);
      const capacity = a.venues.reduce((s, v) => s + v.capacity.total, 0);
      const status = utilityStatusFor(this.state, site, a);
      return {
        ...site,
        city: c,
        active: site.id === this.siteId,
        venues: a.venues,
        registered: a.venues.filter((v) => v.registered).length,
        capacity,
        bestRating: a.venues.length ? Math.max(...a.venues.map((v) => v.ratings.overall)) : 0,
        maintenance: (a.complex.maintenance || 0),
        blocks: a.complex.totalBlocks || 0,
        land: landInfo(this.state, site),
        utilityStatus: status,
        utilityShort: Object.values(status).filter((u) => u.deficit > 0).length,
      };
    });
    return {
      sites,
      totalCapacity: sites.reduce((s, x) => s + x.capacity, 0),
      totalVenues: sites.reduce((s, x) => s + x.venues.length, 0),
      totalRegistered: sites.reduce((s, x) => s + x.registered, 0),
      totalBlocks: sites.reduce((s, x) => s + x.blocks, 0),
    };
  }

  // ------------------------------------------------------------- lifecycle
  newGame(opts = {}) {
    this.state = createState(opts);
    this.worlds.clear();
    this.analyses.clear();
    const world = new VoxelWorld(LAND_TIERS[0].size);
    world.generateTerrain();
    this.worlds.set('site1', world);
    this.history = new History(world);
    resetEventIds(1);
    this.analysisDirty = true;
    this.analyze(true);
    this.refreshBoard(true);
    this.bus.emit('newgame');
    this.bus.emit('state');
    return this;
  }

  /**
   * @param worlds either a single VoxelWorld (single-site save) or a
   *               Map/object of siteId -> VoxelWorld.
   */
  adopt(state, worlds) {
    this.state = state;
    this.worlds.clear();
    this.analyses.clear();
    if (worlds instanceof Map) {
      for (const [id, w] of worlds) this.worlds.set(id, w);
    } else if (worlds && worlds.chunks instanceof Map) {
      this.worlds.set(state.activeSite || 'site1', worlds);
    } else {
      for (const [id, w] of Object.entries(worlds || {})) this.worlds.set(id, w);
    }
    // Any site without a world (a corrupt or partial save) gets an empty plot
    // rather than crashing the game.
    for (const site of state.sites) {
      if (!this.worlds.has(site.id)) {
        const w = new VoxelWorld(LAND_TIERS[site.landTier].size);
        w.generateTerrain();
        this.worlds.set(site.id, w);
      }
    }
    this.history = new History(this.world);
    this.analysisDirty = true;
    this.analyzeAll();
    this.bus.emit('state');
    return this;
  }

  /** Re-scan every site. Used on load and when the empire composition changes. */
  analyzeAll() {
    const current = this.siteId;
    for (const site of this.state.sites) {
      this.state.activeSite = site.id;
      this.analysisDirty = true;
      this.lastAnalysisVersion = -1;
      this.analyze(true);
    }
    this.state.activeSite = current;
    attachDerived(this.state, this.analysis);
    return this.analysis;
  }

  /** Move the player to another site. */
  switchSite(id) {
    if (!this.state.sites.some((s) => s.id === id)) return { error: 'Unknown site.' };
    if (id === this.siteId) return { ok: true };
    this.state.activeSite = id;
    this.history = new History(this.world);
    this.analysisDirty = true;
    this.analyze(true);
    this.bus.emit('sitechange', id);
    this.bus.emit('state');
    return { ok: true };
  }

  /** Buy into a new city. */
  buySite(cityId, name) {
    const s = this.state;
    const c = cityDef(cityId);
    if (s.sites.some((x) => x.cityId === cityId)) return { error: `You already operate in ${c.name}.` };
    if (s.reputation.venue < 55) return { error: 'Expanding into a second city needs a reputation of 55.' };
    if (s.cash < c.buyCost) return { error: `Land in ${c.name} costs ${Math.round(c.buyCost / 1e6)}M.` };

    s.cash -= c.buyCost;
    this.record('land', -c.buyCost);
    const id = `site${s.sites.length + 1}`;
    s.sites.push({
      id, cityId, name: name || `${c.name} Complex`,
      landTier: 0, boughtDay: s.day,
      utilities: Object.fromEntries(Object.keys(s.sites[0].utilities).map((k) => [k, -1])),
    });
    const world = new VoxelWorld(LAND_TIERS[0].size);
    world.generateTerrain();
    this.worlds.set(id, world);
    this.analyses.set(id, { venues: [], complex: {}, stats: {} });
    this.notify('land', `Land acquired in ${c.name}`, `${c.desc}`);
    this.checkAchievements();
    this.bus.emit('state');
    return { ok: true, id };
  }

  renameSite(id, name) {
    const site = this.state.sites.find((s) => s.id === id);
    if (site) { site.name = name; this.bus.emit('state'); }
  }

  // ----------------------------------------------------------------- clock
  /** @param dt seconds of real time */
  tick(dt) {
    const s = this.state;
    if (!s || s.paused) { this.maybeAnalyze(); return; }
    const days = (dt * s.speed) / SECONDS_PER_DAY;
    this.tickConstruction(days);
    s.dayFraction += days;
    let guard = 0;
    while (s.dayFraction >= 1 && guard++ < 40) {
      s.dayFraction -= 1;
      this.advanceDay();
    }
    this.maybeAnalyze();
  }

  /** Bad weather slows a building site down; good weather does not speed it up. */
  weatherBuildFactor() {
    const w = this.state.weather;
    if (w === 'storm') return 0.35;
    if (w === 'rain') return 0.7;
    if (w === 'heat') return 0.85;
    return 1;
  }

  tickConstruction(dayFraction) {
    if (!this.state.construction?.length) return;
    const frac = dayFraction * this.weatherBuildFactor();
    // Every site builds at once, each into its own world, so a stand ordered
    // in one city is not quietly erected in another.
    const sites = new Set(this.state.construction.map((p) => p.siteId || this.state.activeSite));
    let completed = [];
    let changedHere = false;
    for (const siteId of sites) {
      const world = this.worlds.get(siteId);
      if (!world) continue;
      const r = tickConstruction(this.state, world, frac, siteId);
      if (r.changed && siteId === this.siteId) changedHere = true;
      completed = completed.concat(r.completed);
    }
    if (changedHere) this.markWorldDirty();
    for (const p of completed) {
      this.notify('construction', 'Construction complete', `${p.label} is finished and operational.`);
    }
    if (completed.length) this.bus.emit('state');
  }

  /** Queue or apply an edit, depending on how big it is. */
  stageOrApply({ label, cells, cost, uniformBlock, uniformZone, count, props }) {
    if (!shouldStage(count)) return false;
    const project = createProject(this.state,
      { label, cells, cost, uniformBlock, uniformZone, props, siteId: this.siteId });
    this.state.construction.push(project);
    this.notify('construction', 'Construction started',
      `${label}: ${project.total.toLocaleString()} blocks over ${project.days} day${project.days > 1 ? 's' : ''}.`);
    this.bus.emit('state');
    return project;
  }

  construction() { return constructionSummary(this.state); }

  rushConstruction(id) {
    const project = (this.state.construction || []).find((p) => p.id === id);
    const world = this.worlds.get(project?.siteId || this.siteId) || this.world;
    const r = rushProject(this.state, world, id);
    if (!r || r.error) return r;
    this.state.cash -= r.surcharge;
    this.record('construction', -r.surcharge);
    this.markWorldDirty();
    this.analyze(true);
    this.notify('construction', 'Construction rushed', `${r.project.label} finished early for ${Math.round(r.surcharge).toLocaleString()} in overtime.`);
    this.bus.emit('state');
    return r;
  }

  cancelConstruction(id) {
    const r = cancelProject(this.state, id);
    if (!r) return null;
    this.state.cash += r.refund;
    this.record('construction', r.refund);
    this.markWorldDirty();
    this.analyze(true);
    this.bus.emit('state');
    return r;
  }

  /** Skip straight to tomorrow. */
  skipDay(n = 1) {
    for (let i = 0; i < n; i++) { this.tickConstruction(1); this.advanceDay(); }
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

    // The neighbourhood forms its own view, gradually.
    driftCommunity(s, this.analysis);
    s.recentConstruction = (s.recentConstruction || 0) * 0.93;

    // Weather works on an open pitch. Groundstaff and a climate that suits the
    // grass both push the wear back down.
    const climate = climateEffects(this.site.cityId);
    const todayWear = { storm: 0.10, rain: 0.05, heat: 0.06, cloudy: 0.005, sunny: 0 }[s.weather] || 0;
    const recovery = 0.02 + s.staffBonus.operations * 0.05;
    s.pitchWear = Math.max(0, Math.min(1,
      (s.pitchWear || 0) + todayWear * climate.pitchWear - recovery));

    // Weather
    if (s.day >= s.weatherUntilDay) {
      const rng = makeRng(hashString(`${s.seed}:weather:${s.day}`));
      // Each city has its own weather table.
      s.weather = rng.pick(cityDef(this.site.cityId).weather || WEATHERS);
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

    const site = this.site;
    const siteStatus = utilityStatusFor(this.state, site, this.analyses.get(site.id));
    const siteFactors = Object.fromEntries(
      Object.entries(siteStatus).map(([k, v]) => [k, v.factor]));

    const a = detectVenues(this.world, {
      complexName: site.name,
      siteId: site.id,
      powerCapacity: siteStatus.power.capacity,
      utilities: siteFactors,
      pitchWear: this.state.pitchWear || 0,
    });

    // Where a venue is changes who turns up and how they get there.
    const cityInfo = cityDef(site.cityId);
    for (const v of a.venues) {
      v.siteId = site.id;
      v.siteName = site.name;
      v.cityId = site.cityId;
      v.cityName = cityInfo.name;
      v.audienceMult = cityInfo.audience;
    }
    a.complex.transitShare = Math.min(0.6, (a.complex.transitShare || 0) + cityInfo.transitBase);

    // Carry player-chosen names and registration across re-analysis, scoped to
    // this site so two cities cannot claim each other's venues.
    const onThisSite = this.state.venues.registered.filter((r) => (r.siteId || 'site1') === site.id);
    for (const v of a.venues) {
      const reg = onThisSite.find(
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
    // Drop registrations on this site whose venue no longer exists. Other
    // sites' registrations are left alone.
    this.state.venues.registered = this.state.venues.registered.filter(
      (r) => (r.siteId || 'site1') !== site.id || a.venues.some((v) => v.key === r.key));

    this.analysis = a;
    // Derive the utility networks from the scan, then rescore the venues now
    // that the service factors are known.
    attachDerived(this.state, a);
    rescoreVenues(a, this.state.utilityFactors, this.state.pitchWear || 0);
    attachDerived(this.state, a);
    this.rollUpEmpire();

    const st = this.state.stats;
    st.venuesDetected = Math.max(st.venuesDetected, a.venues.length);
    st.regulationFields = a.venues.filter((v) => v.field && v.field.regulation >= 1).length;
    st.bestCapacity = Math.max(st.bestCapacity, this.state.derived.bestCapacity);
    st.bestRating = Math.max(st.bestRating, this.state.derived.bestRating);
    st.equipmentFitted = Math.max(st.equipmentFitted || 0,
      a.complex?.equipmentCount || 0);
    st.fullyFittedVenues = Math.max(st.fullyFittedVenues || 0,
      a.venues.filter((v) => (v.equipmentScore ?? 0) >= 0.999).length);

    this.bus.emit('analysis', a);
    return a;
  }

  /** Totals across every site, for finance and the top bar. */
  rollUpEmpire() {
    const s = this.state;
    let maintenance = 0, passiveRevenue = 0, powerDemand = 0, blocks = 0;
    let capacity = 0, bestCapacity = 0, bestRating = 0, venueCount = 0, training = 0;
    for (const site of s.sites) {
      const a = this.analyses.get(site.id);
      if (!a) continue;
      maintenance += a.complex.maintenance || 0;
      passiveRevenue += a.complex.passiveRevenue || 0;
      powerDemand += a.complex.powerDemand || 0;
      blocks += a.complex.totalBlocks || 0;
      for (const v of a.venues) {
        capacity += v.capacity.total;
        venueCount++;
        training += v.facilities.training;
        if (v.capacity.total > bestCapacity) bestCapacity = v.capacity.total;
        if (v.ratings.overall > bestRating) bestRating = v.ratings.overall;
      }
    }
    s.empire = { maintenance, passiveRevenue, powerDemand, blocks, capacity, venueCount };
    // The derived figures the rest of the game reads are empire-wide.
    s.derived.totalCapacity = capacity;
    s.derived.venueCount = venueCount;
    s.derived.trainingVoxels = training;
    s.derived.bestCapacity = Math.max(s.derived.bestCapacity, bestCapacity);
    s.derived.bestRating = Math.max(s.derived.bestRating, bestRating);
    s.bestCapacityHint = bestCapacity || 8000;
  }

  get venues() { return this.analysis.venues; }
  get primaryVenue() { return this.analysis.venues[0] || null; }

  registerVenue(key, name) {
    const v = this.findVenue(key) || this.analysis.venues.find((x) => x.key === key);
    if (!v) return false;
    if (this.state.venues.registered.some((r) => r.key === key)) return false;
    this.state.venues.registered.push({
      key, name: name || v.suggestedName, sport: v.sport,
      siteId: v.siteId || this.siteId,
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
    const v = this.findVenue(key);
    if (v) v.name = name;
    const local = this.analysis.venues.find((x) => x.key === key);
    if (local) local.name = name;
    this.bus.emit('state');
  }

  registeredVenues() {
    return this.allRegisteredVenues();
  }

  /** Find a venue by key across every site. */
  findVenue(key) {
    return this.allVenues().find((v) => v.key === key) || null;
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
      ? this.findVenue(bid.venueKey)
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
    const venue = this.findVenue(bid.venueKey);
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
    const venue = this.findVenue(bid.venueKey);
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
        if (rival) {
          rival.eventsWon++;
          rival.reputation = Math.min(100, rival.reputation + 1.5);
          this.rivalNews(rival, `Won the bid for ${ev.name}, beating you to it.`);
        }
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
      const venue = this.findVenue(ev.bid.venueKey) || this.primaryVenue;
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
    if (ev.sport === 'ceremony') st.ceremonyHosted = true;

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
      const before = r.capacity;
      r.quality = Math.min(98, r.quality + invest * 30);
      r.capacity = Math.round(r.capacity * (1 + invest * 0.4));
      r.reputation = Math.min(98, r.reputation + invest * 12);
      r.lastExpansion = s.day;
      this.rivalNews(r, `Expanded to ${r.capacity.toLocaleString()} seats (from ${before.toLocaleString()}).`);
    }
  }

  rivalNews(rival, text) {
    rival.news = rival.news || [];
    rival.news.unshift({ day: this.state.day, text });
    if (rival.news.length > 6) rival.news.pop();
  }

  /** Rivals ranked against the player, for the standings screen. */
  standings() {
    const s = this.state;
    const you = {
      id: 'you', name: `${s.complexName} Sports Complex`, you: true,
      capacity: s.derived?.bestCapacity || 0,
      reputation: s.reputation.venue,
      quality: s.derived?.bestRating || 0,
      eventsWon: s.stats.bidsWon,
      news: [],
    };
    const all = [you, ...s.rivals.map((r) => ({ ...r, you: false }))];
    all.sort((a, b) => (b.reputation * 2 + b.quality + Math.log10(Math.max(10, b.capacity)) * 8)
      - (a.reputation * 2 + a.quality + Math.log10(Math.max(10, a.capacity)) * 8));
    return all.map((r, i) => ({ ...r, rank: i + 1 }));
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
    return availableSponsors(this.state, this.state.derived.bestCapacity || 0, this.analysis.complex);
  }

  /** Deals the player has earned on reputation but cannot yet host. */
  sponsorsBlocked() {
    return blockedSponsors(this.state, this.state.derived.bestCapacity || 0, this.analysis.complex);
  }

  signSponsor(id) {
    const s = this.state;
    const sp = ALL_SPONSORS.find((x) => x.id === id);
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

  community() { return communityReport(this.state, this.analysis); }

  // ------------------------------------------------------------- utilities
  utilityOptions(siteId = this.siteId) {
    const site = this.state.sites.find((x) => x.id === siteId) || this.site;
    const status = utilityStatusFor(this.state, site, this.analyses.get(site.id));
    return UTILITIES.map((u) => ({
      ...u,
      tier: site.utilities[u.key] ?? -1,
      status: status[u.key] || { demand: 0, capacity: u.base, deficit: 0, factor: 1 },
      next: nextTier(u.key, site.utilities[u.key] ?? -1),
    }));
  }

  upgradeUtility(key, siteId = this.siteId) {
    const s = this.state;
    const site = s.sites.find((x) => x.id === siteId) || this.site;
    const tier = site.utilities[key] ?? -1;
    const next = nextTier(key, tier);
    if (!next) return { error: 'This network is already at maximum capacity.' };
    if (s.cash < next.cost) return { error: `You need ${Math.round(next.cost / 1000)}K for this upgrade.` };
    s.cash -= next.cost;
    this.record('construction', -next.cost);
    site.utilities[key] = next.index;
    this.analysisDirty = true;
    this.analyze(true);
    const u = UTILITIES.find((x) => x.key === key);
    this.notify('infrastructure', `${u.name} upgraded`, `Capacity is now ${next.capacity}${u.unit}.`);
    this.bus.emit('state');
    return { ok: true };
  }

  // ------------------------------------------------------------------ land
  land() { return landInfo(this.state); }

  buyLand() {
    const s = this.state;
    const site = this.site;
    const { next } = landInfo(s, site);
    if (!next) return { error: 'You already own the largest plot here.' };
    // Land costs what the local market charges.
    const cost = Math.round(next.cost * cityDef(site.cityId).landCost);
    if (s.cash < cost) return { error: `You need ${Math.round(cost / 1e6)}M to expand here.` };
    s.cash -= cost;
    this.record('land', -cost);
    site.landTier++;
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
    // Construction disruption fades over the following weeks.
    s.recentConstruction = (s.recentConstruction || 0) + total / 1000;
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

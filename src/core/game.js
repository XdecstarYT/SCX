import { VoxelWorld } from '../voxel/world.js';
import { History } from '../voxel/history.js';
import { combineLift, inspectionLift } from './siteWalk.js';
import { EventBus } from './eventBus.js';
import { createState, attachDerived, applyReputation, landInfo, activeSite, utilityStatusFor, SAVE_VERSION } from './gameState.js';
import { CITIES, city as cityDef, climateEffects } from '../data/cities.js';
import { SECONDS_PER_DAY, DAYS_PER_MONTH, LAND_TIERS, GROUND_Y } from './constants.js';
import { detectVenues, rescoreVenues } from '../venues/venueDetection.js';
import { generateEvent, boardCapacity, resetEventIds, hostableSports } from '../events/eventGenerator.js';
import {
  createHostingState, competitionOffers, awardHosting, hostingsDue, resolvePairing,
  recordMatch, completeHosting, standingLine, championOf, honours as honoursBoard,
  hostingLegacy,
} from './hosting.js';
import { COMPETITION_BY_ID } from '../data/competitions.js';
import { evaluateBid, resolveBid, PRICING_TIERS } from '../events/bidding.js';
import { Negotiation, ROUNDS_BY_TIER } from '../events/negotiation.js';
import { autoMatchday, MatchdaySession } from './matchday.js';
import {
  createProgrammeState, available as programmesAvailable, activeProgrammes,
  tickProgrammes, effectSummary, programmeSlots, PROGRAMME_BY_ID,
} from './programmes.js';
import { simulateEvent } from '../events/eventSimulation.js';
import { bestVenueFor, checkRequirements } from '../events/eventRequirements.js';
import { applyDailyFinance, monthlyFinance, LEDGER_CATEGORIES, takeLoan } from './economy.js';
import { driftCommunity, communityReport } from './community.js';
import {
  createProject, tickConstruction, rushProject, cancelProject,
  constructionSummary, shouldStage, projectDays,
} from './construction.js';
import { PLAN_STRIDE } from '../voxel/structures.js';
import { STAFF_ROLES, makeHire } from '../data/staff.js';
import {
  clubOffers, tenantSummary, table, ensureSeason, seasonDay, fixtureDays,
  opponentFor, playMatch, recordResult, rolloverSeason, clubOf, leagueClubs,
  SEASON_DAYS, DIVISIONS, LEAGUE_SPORTS,
} from './league.js';
import { fixtureEvent, competitionFixture } from '../events/fixtures.js';
import { side as nationSide } from '../data/nations.js';
import {
  createScenarioState, scenarioProgress, tickScenario, SCENARIO_BY_ID,
} from './scenario.js';
import { endgameProgress, ENDGAME_GOALS } from '../data/endgame.js';
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
    driftCommunity(s, this.analysis, [...this.analyses.values()]);
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
    this.tickLeague();
    this.tickHosting();
    this.tickProgrammes();
    this.tickScenario();
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
      // Programmes that have finished are part of what the venue *is*, so the
      // analyser sees them rather than having them added to its answer.
      // A site walk that is still in date counts the same way a finished
      // programme does: the analyser sees the venue as it now is.
      programmeLift: combineLift(this.state.programmes?.effects || null, inspectionLift(this.state)),
    });

    // Where a venue is changes who turns up and how they get there.
    const cityInfo = cityDef(site.cityId);
    // The analysis knows which site it describes, so anything reading it can
    // scope itself to the same complex - community standing in particular.
    a.siteId = site.id;
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
  /**
   * Hosting rights currently open to bid for. They are generated fresh from
   * the calendar rather than stored, so a save never carries a stale offer and
   * the same year always offers the same competitions.
   */
  competitionOffers() {
    const s = this.state;
    if (!s.hosting) s.hosting = createHostingState();
    return competitionOffers(s, hostableSports(s));
  }

  /** Everything currently on this complex's calendar as a staged competition. */
  hostings() {
    const s = this.state;
    if (!s.hosting) s.hosting = createHostingState();
    const tenantIds = new Set((s.league?.tenants || [])
      .filter((t) => t.clubId).map((t) => `${t.venueKey}:${t.clubId}`));
    return s.hosting.active.map((h) => ({
      ...h,
      comp: COMPETITION_BY_ID.get(h.compId),
      standing: standingLine(h),
      remaining: h.matches.filter((m) => !m.played).length,
      next: h.matches.find((m) => !m.played) || null,
      // A resident club contesting something staged at its own ground is the
      // moment the tenancy and the rights systems are both for.
      homeSide: h.sides.find((x) => tenantIds.has(`${h.venueKey}:${x.id}`)) || null,
    }));
  }

  honours() {
    const s = this.state;
    if (!s.hosting) s.hosting = createHostingState();
    return {
      groups: honoursBoard(s),
      history: s.hosting.history,
      records: s.hosting.records,
    };
  }

  /**
   * The best registered venue to stage a given competition at: the one with
   * the right surface and the most room. A ceremony is staged in an athletics
   * stadium, which is the one case where sport and surface differ.
   */
  bestVenueForCompetition(offer) {
    const want = offer.sport === 'ceremony' ? 'athletics' : offer.sport;
    return this.allVenues()
      .filter((v) => v.registered && v.sport === want)
      .sort((a, b) => b.capacity.total - a.capacity.total)[0] || null;
  }

  /**
   * What a hosting bid would look like, without placing it. Same evaluation
   * the bid itself runs, so the number the player is shown is the number the
   * decision is actually made on.
   */
  previewCompetitionBid(uid, bid) {
    const offer = this.competitionOffers().find((o) => o.uid === uid);
    if (!offer) return null;
    const venue = this.findVenue(bid.venueKey);
    if (!venue) return { offer, venue: null, check: null };
    const evaluation = evaluateBid(offer, venue, this.state, bid);
    return { offer, venue, evaluation, check: evaluation.check, clash: this.hostingClash(offer, venue) };
  }

  /**
   * Bid for the rights to stage a competition. It runs through exactly the
   * same evaluation as an event bid - requirements, rivals, organiser
   * confidence - because from the player's side it is the same decision made
   * about a bigger thing.
   */
  bidForCompetition(uid, bid) {
    const s = this.state;
    if (!s.hosting) s.hosting = createHostingState();
    const offer = this.competitionOffers().find((o) => o.uid === uid);
    if (!offer) return { error: 'Those rights are no longer open.' };
    const venue = this.findVenue(bid.venueKey);
    if (!venue) return { error: 'Select a registered venue first.' };
    if (!venue.registered) return { error: 'That venue is not registered yet.' };
    if (venue.sport !== offer.sport && !(offer.sport === 'ceremony' && venue.sport === 'athletics')) {
      return { error: `${venue.name} does not have a surface for this.` };
    }

    const evaluation = evaluateBid(offer, venue, s, bid);
    if (!evaluation.check.ok) return { error: 'Your venue does not meet the requirements yet.' };
    if (bid.amount > s.cash) return { error: 'You cannot cover this bid.' };
    // A schedule that would collide with one you already hold is a schedule
    // you cannot staff, and the game should say so before taking the money.
    const clash = this.hostingClash(offer, venue);
    if (clash) return { error: clash };

    s.stats.bidsPlaced++;
    const outcome = resolveBid(offer, evaluation, bid);
    if (!outcome.won) {
      s.stats.bidsLost++;
      s.hosting.declined.push(`${offer.compId}:${offer.year}`);
      applyReputation(s, { organiser: -0.5 });
      this.notify('bid', 'Rights lost', outcome.winner
        ? `${outcome.winner.name} won the rights to the ${offer.name}.`
        : `The ${offer.organiser} awarded the ${offer.name} elsewhere.`);
      this.bus.emit('state');
      return { ok: true, outcome, evaluation, ev: offer, venue };
    }

    const hosting = awardHosting(s, offer, venue, bid.amount);
    if (!hosting) return { error: 'That competition has no field to contest it.' };
    s.cash -= bid.amount;
    this.record('eventCosts', -bid.amount);
    s.stats.bidsWon++;
    s.organiserHistory[offer.organiser] = (s.organiserHistory[offer.organiser] || 0) + 1;
    s.hosting.active.push(hosting);
    applyReputation(s, { organiser: 4, venue: 1.5 });
    this.notify('club', 'Hosting rights won',
      `${venue.name} will stage the ${offer.name}: ${hosting.matches.length} `
      + `match${hosting.matches.length > 1 ? 'es' : ''} from day ${hosting.matches[0].day}.`);
    this.checkAchievements();
    this.bus.emit('hosting', hosting);
    this.bus.emit('state');
    return { ok: true, outcome, evaluation, ev: offer, venue, hosting };
  }

  /**
   * The days a venue is already committed to: every match of every staged
   * competition, plus the days each one runs over. A Test is four days, and a
   * ground cannot stage anything else on any of them.
   */
  venueCommitments(venueKey) {
    const out = [];
    for (const h of this.state.hosting?.active || []) {
      if (h.venueKey !== venueKey) continue;
      const comp = COMPETITION_BY_ID.get(h.compId);
      const span = comp?.matchDays || 1;
      for (const m of h.matches) {
        if (m.played) continue;
        out.push({ from: m.day, to: m.day + span - 1, label: `${h.name}, ${m.label}` });
      }
    }
    return out;
  }

  /**
   * Is this venue free for something running `days` days from `day`? Returns
   * the clash, so the caller can say which competition is in the way.
   */
  venueBusy(venueKey, day, days = 1) {
    const to = day + Math.max(1, days) - 1;
    return this.venueCommitments(venueKey)
      .find((c) => day <= c.to && to >= c.from) || null;
  }

  /** Whether a schedule would land on top of one this venue already holds. */
  hostingClash(offer, venue) {
    const comp = COMPETITION_BY_ID.get(offer.compId);
    if (!comp) return null;
    const span = comp.matches * Math.max(1, comp.spacing || 1) * (comp.matchDays || 1);
    const from = offer.eventDay, to = offer.eventDay + span;
    for (const h of this.state.hosting.active) {
      if (h.venueKey !== venue.key) continue;
      const last = h.matches[h.matches.length - 1];
      if (from <= last.day && to >= h.matches[0].day) {
        return `${venue.name} is already staging the ${h.name} over those dates.`;
      }
    }
    // A competition also has to clear the events already booked into it.
    for (const ev of this.state.events.scheduled) {
      if (ev.bid?.venueKey !== venue.key) continue;
      const evTo = ev.eventDay + Math.max(1, ev.days || 1) - 1;
      if (from <= evTo && to >= ev.eventDay) {
        return `${venue.name} is booked for ${ev.name} on day ${ev.eventDay}.`;
      }
    }
    return null;
  }

  /**
   * Run the calendar: play any competition match due today, keep the running
   * scoreline, and close out a competition when its last match is done.
   */
  tickHosting() {
    const s = this.state;
    if (!s.hosting) s.hosting = createHostingState();
    for (const { hosting, match } of hostingsDue(s, s.day)) {
      this.hostCompetitionMatch(hosting, match);
    }
    for (const h of [...s.hosting.active]) {
      if (h.matches.some((m) => !m.played)) continue;
      const entry = completeHosting(s, h);
      s.hosting.active = s.hosting.active.filter((x) => x.id !== h.id);
      const comp = COMPETITION_BY_ID.get(h.compId);
      applyReputation(s, { venue: comp ? comp.prestige / 4 : 4, organiser: 3, fans: 2 });
      this.notify('club', `${h.name} complete`,
        entry.shared
          ? `${entry.scoreline}. ${(comp?.trophy || 'The trophy')} is shared. `
            + `${entry.attendance.toLocaleString()} through the gates.`
          : `${entry.champion} lifted ${comp?.trophy || 'the trophy'} at ${h.venueName}. `
            + `${entry.attendance.toLocaleString()} through the gates.`);
      this.checkAchievements();
      this.bus.emit('hostingcomplete', entry);
    }
  }

  /**
   * One match of a staged competition. It is an event: the same crowd model,
   * the same weather, the same wear, the same staff. What is different is that
   * the result goes on a scoreline rather than into a league table.
   */
  hostCompetitionMatch(hosting, match) {
    const s = this.state;
    const comp = COMPETITION_BY_ID.get(hosting.compId);
    const venue = this.findVenue(hosting.venueKey);
    if (!comp || !venue) {
      // The venue that won the rights no longer exists. The competition goes
      // elsewhere, and the player is told rather than left wondering.
      match.played = true;
      match.forfeit = true;
      this.notify('warn', `${hosting.name} moved`,
        `${hosting.venueName} could not stage ${match.label}; the rights were withdrawn.`);
      applyReputation(s, { organiser: -6, venue: -3 });
      return;
    }
    resolvePairing(hosting, match);
    const home = this.sideOf(hosting, match.homeId);
    const away = this.sideOf(hosting, match.awayId);
    const ev = competitionFixture(s, comp, hosting, match, home, away);
    const contract = { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
    const report = simulateEvent(ev, venue, s, contract);
    report.competition = { hostingId: hosting.id, label: match.label, name: hosting.name };
    this.applyEventReport(ev, report);

    hosting.totalRevenue += report.totalRevenue;
    hosting.totalProfit += report.profit;

    // A ceremony is staged, not won. Everything else is played out.
    const m = hosting.contested === false
      ? { homeScore: 0, awayScore: 0 }
      : playMatch(s.league, home, away, `comp:${hosting.id}:${match.index}`);
    recordMatch(hosting, match, m.homeScore, m.awayScore, report.attendance);
    if (hosting.contested !== false) {
      s.league.results.unshift({
        day: s.day, sport: comp.sport, level: null,
        home: home.name, away: away.name,
        homeScore: m.homeScore, awayScore: m.awayScore,
        ours: true, attendance: report.attendance,
        competition: `${hosting.name} \u00B7 ${match.label}`,
      });
      if (s.league.results.length > 40) s.league.results.pop();
    }
    this.bus.emit('hostingmatch', { hosting, match, report });
  }

  /** A contesting side, whether it is a nation or one of the league's clubs. */
  sideOf(hosting, id) {
    const listed = hosting.sides.find((x) => x.id === id);
    if (listed?.isClub) {
      const c = clubOf(this.state.league, id);
      if (c) return c;
    }
    const nation = nationSide(id, hosting.sport);
    if (nation) return nation;
    return { id, name: listed?.name || 'TBC', sport: hosting.sport, strength: 0.6, support: 0.6 };
  }

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
    // A ground staging a competition is not available for anything else. Five
    // Tests is fifty days of the calendar, and that cost is most of what makes
    // the rights a decision rather than free money.
    const busy = this.venueBusy(venue.key, ev.eventDay, ev.days || 1);
    if (busy) {
      return { error: `${venue.name} is staging ${busy.label} on day ${busy.from}.` };
    }

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
      // The biggest event on the board is worth being present for. If the
      // player has asked to run their own matchdays and this one qualifies,
      // the day is held open and they take the calls; otherwise the relevant
      // department heads take them, which is what they are paid for.
      if (this.shouldOpenMatchday(ev, venue)) {
        this.openMatchday(ev, venue);
        continue;
      }
      const report = simulateEvent(ev, venue, s, ev.bid, autoMatchday(ev, venue, s));
      this.applyEventReport(ev, report);
    }
    s.events.scheduled = s.events.scheduled.filter(
      (e) => e.eventDay > s.day || e.status === 'live');
  }

  // ============================================================ PROGRAMMES
  /**
   * What the complex could start running, and what is stopping it.
   *
   * A programme is not an upgrade you buy. It takes weeks, costs money every
   * one of them, occupies one of a handful of slots, and leaves something
   * behind for good - so running the safety overhaul is a decision not to run
   * the season-ticket drive, and that is the whole point of the system.
   */
  programmes() {
    const s = this.state;
    if (!s.programmes) s.programmes = createProgrammeState();
    return {
      available: programmesAvailable(s, this.primaryVenue),
      active: activeProgrammes(s),
      slots: programmeSlots(s),
      used: s.programmes.active.length,
      effects: effectSummary(s),
      completed: s.programmes.completed,
    };
  }

  startProgramme(id) {
    const s = this.state;
    if (!s.programmes) s.programmes = createProgrammeState();
    const row = programmesAvailable(s, this.primaryVenue).find((r) => r.def.id === id);
    if (!row) return { error: 'No such programme.' };
    if (row.blocked) return { error: row.blocked };

    s.cash -= row.def.cost;
    this.record('eventCosts', -row.def.cost);
    s.programmes.active.push({
      id, startedDay: s.day, endsDay: s.day + row.def.days, paid: row.def.cost,
    });
    this.notify('research', `${row.def.name} under way`,
      `${row.def.days} days, ${Math.round(row.def.upkeep).toLocaleString()} a day.`);
    this.bus.emit('state');
    return { ok: true, programme: row.def };
  }

  /** Stop one early. The money already spent is spent; nothing is left behind. */
  cancelProgramme(id) {
    const s = this.state;
    const at = (s.programmes?.active || []).findIndex((a) => a.id === id);
    if (at < 0) return { error: 'That is not running.' };
    const def = PROGRAMME_BY_ID.get(id);
    s.programmes.active.splice(at, 1);
    this.notify('warn', `${def?.name || 'Programme'} stopped`,
      'Nothing it had not already finished carries over.');
    this.bus.emit('state');
    return { ok: true };
  }

  /** A day of every running programme: the upkeep, and anything that finishes. */
  tickProgrammes() {
    const s = this.state;
    if (!s.programmes) s.programmes = createProgrammeState();
    const { finished, upkeep } = tickProgrammes(s);
    if (upkeep > 0) {
      s.cash -= upkeep;
      this.record('maintenance', -upkeep, true);
    }
    for (const def of finished) {
      this.notify('research', `${def.name} complete`, def.detail || def.desc);
      this.bus.emit('programme', def);
    }
    if (finished.length) {
      this.markWorldDirty();
      this.analyze(true);
      this.checkAchievements();
    }
    return finished;
  }

  // ============================================================== MATCHDAY
  /**
   * Whether to stop the clock and hand this day to the player.
   *
   * Never for a league fixture or a competition match - a club playing every
   * other weekend would turn the game into a queue of forms - and never when
   * something is already live. The setting is the player's; the default is to
   * run the days that were bid for and won.
   */
  shouldOpenMatchday(ev, venue) {
    const s = this.state;
    if (!s.settings?.liveMatchday) return false;
    if (this.matchday) return false;
    if (ev.kind === 'fixture' || ev.kind === 'competition-match') return false;
    const TIER_RANK = { local: 0, regional: 1, national: 2, international: 3, world: 4 };
    return (TIER_RANK[ev.tier] ?? 0) >= (s.settings.matchdayFrom ?? 0) && !!venue;
  }

  /** Hold the day open. The clock stops until it is resolved. */
  openMatchday(ev, venue) {
    const s = this.state;
    ev.status = 'live';
    this.matchday = new MatchdaySession(ev, venue, s, ev.bid);
    this._pausedForMatchday = s.paused;
    s.paused = true;
    // A day with nothing to decide is not a day; resolve it and move on.
    if (this.matchday.done) return this.closeMatchday();
    this.notify('event', `${ev.name} is under way`,
      `${venue.name}. You are running this one yourself.`);
    this.bus.emit('matchday', this.matchdayView());
    this.bus.emit('state');
    return this.matchday;
  }

  /** Everything the matchday screen needs, and nothing it does not. */
  matchdayView() {
    const md = this.matchday;
    if (!md) return null;
    return {
      event: {
        name: md.ev.name, tier: md.ev.tier, organiser: md.ev.organiser,
        sport: md.ev.sport, days: md.ev.days,
      },
      venue: { name: md.venue.name || md.venue.type, capacity: md.venue.capacity.total },
      phase: md.phase ? { name: md.phase.name, desc: md.phase.desc } : null,
      call: md.call,
      progress: md.progress,
      summary: md.summary(),
      history: md.history,
      risks: md.risks.filter((r) => !r.good)
        .map((r) => ({ key: r.key, chance: r.chance, text: r.text,
          guarded: md.ops.guard[r.key] || 0 }))
        .sort((a, b) => b.chance * (1 - b.guarded) - a.chance * (1 - a.guarded)),
      done: md.done,
    };
  }

  /** Take a call. */
  matchdayChoose(optionIndex) {
    if (!this.matchday) return { error: 'No matchday is running.' };
    const r = this.matchday.choose(optionIndex);
    if (r.error) return r;
    if (this.matchday.done) return this.closeMatchday();
    this.bus.emit('matchday', this.matchdayView());
    this.bus.emit('state');
    return { ok: true, view: this.matchdayView() };
  }

  /** Hand one call, or the rest of the day, to the staff. */
  matchdayDelegate(rest = false) {
    if (!this.matchday) return { error: 'No matchday is running.' };
    if (rest) { this.matchday.delegateRest(); return this.closeMatchday(); }
    const r = this.matchday.delegate();
    if (r.error) return r;
    if (this.matchday.done) return this.closeMatchday();
    this.bus.emit('matchday', this.matchdayView());
    this.bus.emit('state');
    return { ok: true, view: this.matchdayView() };
  }

  /** Run the simulation with the day the player actually had. */
  closeMatchday() {
    const md = this.matchday;
    if (!md) return { error: 'No matchday is running.' };
    const ops = md.finish();
    const report = simulateEvent(md.ev, md.venue, this.state, md.contract, ops);
    this.matchday = null;
    this.state.paused = this._pausedForMatchday ?? false;
    this.applyEventReport(md.ev, report);
    this.state.events.scheduled = this.state.events.scheduled.filter((e) => e.uid !== md.ev.uid);
    this.bus.emit('matchdaydone', report);
    this.bus.emit('state');
    return { ok: true, report };
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
    // Some sites are hemmed in: whatever you want has to fit on what you have.
    if (s.landLocked) return { error: 'There is no more land to buy on this site.' };
    // Land costs what the local market charges.
    const cost = Math.round(next.cost * cityDef(site.cityId).landCost);
    if (s.cash < cost) return { error: `You need ${Math.round(cost / 1e6)}M to expand here.` };
    s.cash -= cost;
    this.record('land', -cost);
    site.landTier++;
    // The new land wraps the old plot rather than arriving on two sides, so
    // everything already standing moves to stay where it was relative to the
    // land. Coordinates held outside the world have to move with it.
    const off = this.world.expandTo(next.size);
    if (off) this.onPlotShift(off);
    this.analysisDirty = true;
    this.analyze(true);
    this.notify('land', 'Land acquired', `Your plot is now ${next.label}.`);
    this.checkAchievements();
    this.bus.emit('landchange', off);
    this.bus.emit('state');
    return { ok: true };
  }

  /**
   * The plot grew around the complex: bring everything that stores voxel
   * coordinates outside the world along with it.
   */
  onPlotShift(off) {
    const s = this.state;
    for (const p of s.construction || []) {
      if ((p.siteId || s.activeSite) !== this.siteId) continue;
      for (let i = 0; i < p.cells.length; i += PLAN_STRIDE) {
        p.cells[i] += off;
        p.cells[i + 2] += off;
      }
      for (const q of p.props || []) { q[1] += off; q[3] += off; }
      if (p.bbox) {
        p.bbox.minX += off; p.bbox.maxX += off;
        p.bbox.minZ += off; p.bbox.maxZ += off;
      }
    }
    // Registrations are re-linked to detected venues by position, so moving
    // the remembered centre is enough to keep a venue registered through a
    // land purchase.
    for (const r of s.venues.registered) {
      if ((r.siteId || 'site1') !== this.siteId) continue;
      r.cx += off;
      r.cz += off;
    }
    // Undo would put blocks back where they no longer are.
    this.history = new History(this.world);
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
    const total = amount * s.buildCostMult * (s.programmes?.effects?.buildMult ?? 1);
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
    this.checkGoals();
  }

  /**
   * Long-term goals, which until now were only ever *read*: the screen showed
   * a progress bar and nothing ever told you when one filled. A goal that
   * takes four hundred days to finish and then says nothing is not an ending.
   */
  checkGoals() {
    const s = this.state;
    s.goalsDone = s.goalsDone || [];
    const p = endgameProgress(s);
    for (const g of p.goals) {
      if (!g.complete || s.goalsDone.includes(g.id)) continue;
      s.goalsDone.push(g.id);
      this.notify('goal', g.name, g.desc);
    }
    if (!s.legacyShown && p.complete === p.total && p.total > 0) {
      s.legacyShown = true;
      this.bus.emit('legacy', this.legacy());
    }
  }

  /**
   * What the player actually built, for the finale. Everything here is read
   * back off the save rather than tallied along the way, so it is true even
   * for a game that was finished across several sittings.
   */
  legacy() {
    const s = this.state;
    const venues = this.allRegisteredVenues();
    const best = venues.reduce((a, v) => (!a || v.capacity.total > a.capacity.total ? v : a), null);
    return {
      day: s.day,
      years: Math.floor(s.day / 360),
      complexName: s.complexName,
      cities: new Set(s.sites.map((x) => x.cityId)).size,
      venues: venues.length,
      bestVenue: best ? { name: best.name, capacity: best.capacity.total, rating: best.ratings.overall } : null,
      capacity: venues.reduce((n, v) => n + v.capacity.total, 0),
      events: s.stats.eventsHosted,
      attendance: s.stats.totalAttendance,
      profit: s.stats.lifetimeProfit,
      blocks: s.stats.blocksPlaced,
      achievements: s.achievements.length,
      reputation: Math.round(s.reputation.venue),
      goals: ENDGAME_GOALS.length,
      // What the ground will be remembered for, which is the only line on
      // this summary that names a day rather than a total.
      honours: hostingLegacy(s),
    };
  }

  // =============================================================== SCENARIO
  /**
   * Start an authored scenario: somebody else's starting position, a list of
   * objectives and a clock. It is the same game underneath - the world is a
   * normal world, the economy is the normal economy - so anything the player
   * learns here transfers straight to the sandbox.
   */
  startScenario(id, opts = {}) {
    const def = SCENARIO_BY_ID.get(id);
    if (!def) return { error: 'No such scenario.' };

    this.newGame({
      complexName: opts.complexName || def.name,
      seed: opts.seed ?? 1,
      cash: def.cash,
    });
    const s = this.state;
    s.scenario = createScenarioState(def);

    // The site: its city, its plot, and whatever is standing on it.
    const site = s.sites[0];
    if (def.cityId) site.cityId = def.cityId;
    if (def.landTier) {
      site.landTier = def.landTier;
      this.world.expandTo(LAND_TIERS[def.landTier].size);
    }
    if (def.noLand) s.landLocked = true;
    Object.assign(s.reputation, def.reputation || {});
    if (def.debt) takeLoan(s, def.debt, 8);
    if (def.rivalBoost) {
      for (const r of s.rivals) {
        r.reputation = Math.min(100, r.reputation * def.rivalBoost);
        r.funds = Math.round(r.funds * def.rivalBoost);
      }
    }

    const ctx = { register: false };
    try { def.build?.(this.world, ctx); } catch (e) { console.error('scenario build failed', e); }
    this.markWorldDirty();
    this.analyze(true);
    // A ground somebody else built is already a ground: it does not need the
    // player to discover it before it counts.
    if (ctx.register) {
      for (const v of this.analysis.venues) {
        if (v.tier !== 'none') this.registerVenue(v.key, v.suggestedName);
      }
      this.analyze(true);
    }
    this.bus.emit('scenario', { kind: 'start', def });
    this.bus.emit('state');
    return { ok: true, def };
  }

  scenario() { return scenarioProgress(this.state); }

  /** Objectives, the clock, and the one day either of them resolves. */
  tickScenario() {
    const ev = tickScenario(this.state);
    if (!ev) return;
    if (ev.kind === 'objective') {
      this.notify('goal', `Objective complete: ${ev.objective.desc}`,
        `${ev.left} left on the brief.`);
    } else if (ev.kind === 'won') {
      this.notify('achievement', `${ev.def.name} — ${ev.rank.toUpperCase()}`,
        `Everything on the brief, in ${Math.round(ev.days / 360 * 10) / 10} years. `
        + 'The complex is yours; keep building.');
    } else if (ev.kind === 'timeout') {
      this.notify('warn', `${ev.def.name} — out of time`,
        `${ev.complete} of ${ev.total} objectives. The complex is still yours.`);
    }
    this.bus.emit('scenario', ev);
    this.bus.emit('state');
  }

  // ================================================================= LEAGUE
  /**
   * Clubs that would move into one of your grounds, and on what terms.
   * A club only looks at venues of its own sport that can hold its support and
   * are good enough for its division.
   */
  clubOffers() { return clubOffers(this.state, this.allRegisteredVenues()); }

  /** Every tenancy, with its club's league position. */
  tenants() {
    return this.state.league.tenants
      .map((t) => tenantSummary(this.state, t))
      .filter(Boolean);
  }

  leagueTable(sport, level) { return table(this.state.league, sport, level); }

  /**
   * Sign a club as a resident. Rent is paid up front for the first season,
   * which is the deal's risk: you are buying a fixture list before you have
   * taken a penny at the gate.
   */
  signTenant(clubId, venueKey, seasons = 3) {
    const s = this.state;
    const offer = this.clubOffers().find((o) => o.club.id === clubId
      && (!venueKey || o.venue.key === venueKey));
    if (!offer) return { error: 'That club will not move to one of your grounds.' };
    if (s.league.tenants.some((t) => t.venueKey === offer.venue.key)) {
      return { error: `${offer.venue.name} already has a resident club.` };
    }
    const t = {
      clubId, venueKey: offer.venue.key, siteId: offer.venue.siteId,
      rent: offer.terms.rentPerSeason,
      gateShare: offer.terms.gateShare,
      homeFixtures: offer.terms.homeFixtures,
      seasonsLeft: seasons, signedDay: s.day, fixtures: [],
    };
    s.league.tenants.push(t);
    this.scheduleFixtures(t);
    // The first season's rent lands now; after that it arrives each rollover.
    this.record('venueFee', t.rent);
    s.cash += t.rent;
    applyReputation(s, { venue: 1.5, community: 2 });
    this.notify('club', `${offer.club.name} have signed`,
      `${offer.venue.name} is their home ground for ${seasons} season${seasons === 1 ? '' : 's'}. `
      + `${t.homeFixtures} home fixtures a season.`);
    this.checkAchievements();
    this.bus.emit('state');
    return { ok: true, tenant: t };
  }

  /** Let a club go early. The fixtures stop and so does the rent. */
  releaseTenant(clubId) {
    const s = this.state;
    const i = s.league.tenants.findIndex((t) => t.clubId === clubId);
    if (i < 0) return { error: 'They are not one of your tenants.' };
    const club = clubOf(s.league, clubId);
    const t = s.league.tenants[i];
    // Breaking a contract costs a season's rent and some goodwill.
    const penalty = Math.round(t.rent * 0.5);
    s.cash -= penalty;
    this.record('venueFee', -penalty);
    s.league.tenants.splice(i, 1);
    applyReputation(s, { venue: -2, community: -4 });
    this.notify('club', `${club?.name || clubId} have left`,
      `Breaking the tenancy cost ${Math.round(penalty / 1000)}K and some goodwill.`);
    this.bus.emit('state');
    return { ok: true };
  }

  /** Lay out one tenancy's home fixtures for the season that is running. */
  scheduleFixtures(t) {
    const league = this.state.league;
    const club = clubOf(league, t.clubId);
    if (!club) return;
    const days = fixtureDays(league, t.clubId, t.homeFixtures);
    t.fixtures = days.map((d, i) => {
      const opp = opponentFor(league, club, i);
      return {
        day: league.startedDay + d,
        opponentId: opp ? opp.id : null,
        played: false,
      };
    }).filter((f) => f.opponentId && f.day > this.state.day);
  }

  /**
   * Advance the league by a day: play out the division's own fixtures, and
   * host any of the player's tenants that are at home today.
   */
  tickLeague() {
    const s = this.state;
    const league = s.league;
    ensureSeason(league);

    for (const t of league.tenants) {
      const club = clubOf(league, t.clubId);
      if (!club) continue;
      for (const f of t.fixtures || []) {
        if (f.played || f.day !== s.day) continue;
        f.played = true;
        this.hostFixture(t, club, clubOf(league, f.opponentId));
      }
    }

    // The rest of the league plays too, or the table never moves. One round
    // per week keeps the season's arithmetic close to the fixture lists.
    if ((s.day - league.startedDay) % 7 === 0 && seasonDay(s) < 240) {
      this.playLeagueRound();
    }

    if (seasonDay(s) >= SEASON_DAYS) this.endSeason();
  }

  /** One round of fixtures for every club the player is not hosting. */
  playLeagueRound() {
    const league = this.state.league;
    const rng = makeRng(hashString(`${league.seed}:round:${league.season}:${this.state.day}`));
    // A club the player is hosting today has already played; pairing it again
    // in the same round would give it two results on one afternoon.
    const busy = new Set();
    for (const t of league.tenants) {
      for (const f of t.fixtures || []) {
        if (f.day === this.state.day) { busy.add(t.clubId); busy.add(f.opponentId); }
      }
    }
    for (const sport of LEAGUE_SPORTS) {
      for (const d of DIVISIONS) {
        const clubs = rng.shuffle(leagueClubs(league, sport, d.level).filter((c) => !busy.has(c.id)));
        for (let i = 0; i + 1 < clubs.length; i += 2) {
          const home = clubs[i], away = clubs[i + 1];
          const r = playMatch(league, home, away, `${this.state.day}:${home.id}`);
          recordResult(league, sport, d.level, home.id, away.id, r.homeScore, r.awayScore);
        }
      }
    }
  }

  /**
   * A home fixture. It runs through exactly the same event simulation a bid
   * event does - same crowd, same weather, same wear, same staff - so a club
   * playing at a ground with no restrooms has the day a club would.
   */
  hostFixture(tenant, club, opponent) {
    const s = this.state;
    const venue = this.findVenue(tenant.venueKey);
    if (!venue || !opponent) return;
    const ev = fixtureEvent(s, club, opponent, venue);
    const contract = { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
    const report = simulateEvent(ev, venue, s, contract);

    // The club keeps its share of the gate; that is what a tenancy costs.
    const share = Math.round(report.revenue.tickets * tenant.gateShare);
    report.revenue.tickets -= share;
    report.costs.revenueShare = (report.costs.revenueShare || 0) + share;
    report.totalRevenue -= share;
    report.totalCost += share;
    report.profit -= share;
    report.fixture = { clubId: club.id, opponentId: opponent.id };

    this.applyEventReport(ev, report);

    // The result, and the table.
    const m = playMatch(s.league, club, opponent, `home:${s.day}:${club.id}`);
    recordResult(s.league, club.sport, club.level, club.id, opponent.id, m.homeScore, m.awayScore);
    s.league.results.unshift({
      day: s.day, sport: club.sport, level: club.level,
      home: club.name, away: opponent.name,
      homeScore: m.homeScore, awayScore: m.awayScore,
      ours: true, attendance: report.attendance,
    });
    if (s.league.results.length > 40) s.league.results.pop();
  }

  /** Season rollover: prizes, promotion, relegation, new fixture lists. */
  endSeason() {
    const s = this.state;
    const report = rolloverSeason(s);
    if (report.prize > 0) {
      s.cash += report.prize;
      this.record('venueFee', report.prize);
    }
    // Next season's rent, up front, for everyone still under contract.
    for (const t of s.league.tenants) {
      s.cash += t.rent;
      this.record('venueFee', t.rent);
      this.scheduleFixtures(t);
    }
    const ours = report.champions.filter((c) => s.league.tenants.some((t) => t.clubId === c.clubId));
    this.notify('club', `Season ${report.season} is over`,
      (ours.length ? `${ours[0].name} won their division. ` : '')
      + (report.prize ? `Prize money and rent: ${Math.round(report.prize / 1000)}K. ` : '')
      + (report.expired.length ? `${report.expired.join(', ')} are out of contract.` : ''));
    this.bus.emit('season', report);
    this.bus.emit('state');
    return report;
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

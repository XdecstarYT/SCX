/**
 * What the headless player does with its day: bid, reinvest, staff up, and
 * expand. Every decision goes through the same Game methods the UI calls.
 */
import { BID_PACKAGES } from '../src/data/events.js';
import { CITIES } from '../src/data/cities.js';
import { monthlyFinance } from '../src/core/economy.js';

/** Keep this many months of upkeep in hand before spending on anything. */
const RESERVE_MONTHS = 2;

export class Strategy {
  constructor(game, builder, opts = {}) {
    this.game = game;
    this.b = builder;
    this.log = opts.log || (() => {});
    this.aggression = opts.aggression ?? 1;   // >1 bids higher and builds sooner
    this.noBidDays = 0;
    this.lastBidDay = 0;
    this.actions = { bids: 0, builds: 0, hires: 0, sponsors: 0, research: 0, upgrades: 0, land: 0, sites: 0 };
  }

  get s() { return this.game.state; }

  get reserve() {
    let monthly = 0;
    try { monthly = monthlyFinance(this.s, this.game.analysis).totalExpense; } catch { monthly = 0; }
    return Math.max(150_000, monthly * RESERVE_MONTHS);
  }

  get spendable() { return this.s.cash - this.reserve; }

  // ------------------------------------------------------------------ turn
  day() {
    this.register();
    this.bid();
    this.reinvest();
  }

  /** Anything the game says is event-ready gets registered. */
  register() {
    for (const v of this.game.allVenues()) {
      if (!v.registered && v.tier !== 'none') {
        this.game.registerVenue(v.key, v.suggestedName);
        this.log(`day ${this.s.day}: registered ${v.suggestedName} (${v.type}, ${v.capacity.total} cap, rating ${v.ratings.overall})`);
      }
    }
  }

  /**
   * Bid on whatever is worth bidding on. Tries three price points and takes
   * the one with the best expected profit, which is roughly how a player
   * works the slider.
   */
  bid() {
    const g = this.game;
    const open = this.s.events.board.filter((e) => e.status === 'open');
    if (!open.length) { this.noBidDays++; return; }
    const venues = g.registeredVenues();
    if (!venues.length) { this.noBidDays++; return; }

    let bidToday = 0;
    for (const ev of open) {
      if (bidToday >= 2) break;                       // a player does not bid on everything at once
      const best = this.bestOffer(ev, venues);
      if (!best) continue;
      if (best.amount > this.s.cash) continue;
      const r = g.submitBid(ev.uid, best.bid);
      if (r?.ok) {
        this.actions.bids++;
        bidToday++;
        this.lastBidDay = this.s.day;
        this.log(`day ${this.s.day}: bid ${fmt(best.amount)} on ${ev.name} (${ev.tier}) `
          + `win ${(best.winChance * 100).toFixed(0)}% -> ${r.outcome.won ? 'WON' : 'lost'}`);
      }
    }
    if (bidToday === 0) this.noBidDays++; else this.noBidDays = 0;
  }

  /** Try a few offers on an event and return the best expected value. */
  bestOffer(ev, venues) {
    const g = this.game;
    const [lo, hi] = ev.bidRange;
    let best = null;
    for (const venue of venues) {
      // Packages the venue can genuinely back up are near-free strength.
      const packages = [];
      const m = venue.ratings.measures;
      for (const p of BID_PACKAGES) {
        if (!p.need || (m[p.need] ?? 0) >= 0.55) packages.push(p.key);
        if (packages.length >= 3) break;
      }
      for (const f of [0.15, 0.3, 0.45, 0.6, 0.8]) {
        const amount = Math.round(lo + (hi - lo) * f * this.aggression);
        if (amount > this.s.cash) continue;
        const bid = { amount, venueKey: venue.key, packages, terms: [], pricing: 'standard' };
        const pv = g.previewBid(ev.uid, bid);
        if (!pv?.evaluation.check.ok || !pv.projection) continue;
        // The projection assumes a sunny day. Weather costs about 5% of the
        // gate on an uncovered ground, so discount it before deciding.
        const expected = pv.projection.profit - pv.projection.revenue * 0.05;
        if (expected <= 0) continue;
        if (pv.evaluation.winChance < 0.12) continue;
        // Do not hand the organiser most of the value: a bid that costs more
        // than two thirds of what the event is worth is not worth winning.
        if (amount > expected * 1.5) continue;
        const score = pv.evaluation.winChance * expected;
        if (!best || score > best.score) {
          best = { score, bid, amount, winChance: pv.evaluation.winChance, profit: expected };
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------- spending
  reinvest() {
    if (this.spendable <= 0) return;
    // Utilities first: a network over capacity drags every rating down.
    this.fixUtilities();

    // Once the plot is full, land comes first: a player who keeps squeezing
    // sheds into the gaps instead of buying the next parcel never gets the
    // room for the stands that unlock the next tier. If the land is not yet
    // affordable, save rather than spend.
    if (this.b.spaceTight && this.game.land().next && !this.buyLandWhenAffordable()) {
      this.people();
      return;
    }

    // Space pressure is re-judged from today's attempts, not remembered.
    this.b.spaceTight = false;
    this.fixRatings();
    this.grow();
    this.people();
  }

  buyLandWhenAffordable() {
    const g = this.game;
    const { next } = g.land();
    if (!next) return false;
    const cost = next.cost * 1.15;   // buy with a little left over, not all-in
    if (this.spendable < cost) return false;
    const r = g.buyLand();
    if (r?.ok) {
      this.actions.land++;
      this.b.spaceTight = false;      // there is room again; resume building
      this.log(`day ${this.s.day}: bought land -> ${next.label}`);
      return true;
    }
    return false;
  }

  fixUtilities() {
    const g = this.game;
    for (const u of g.utilityOptions()) {
      if (u.status.deficit <= 0 || !u.next) continue;
      if (u.next.cost > this.spendable) continue;
      const r = g.upgradeUtility(u.key);
      if (r?.ok) { this.actions.upgrades++; this.log(`day ${this.s.day}: upgraded ${u.name}`); }
    }
  }

  /** Build whatever the primary venue's issue list is asking for. */
  fixRatings() {
    const v = this.game.primaryVenue;
    if (!v) return;
    const m = v.ratings.measures;
    const want = [];
    const need = (key, zone) => { if ((m[key] ?? 1) < 0.75) want.push(zone); };
    need('restroom', 'restroom');
    need('concession', 'concession');
    need('medical', 'medical');
    need('security', 'security');
    need('locker', 'locker');
    need('concourse', 'concourse');
    need('exit', 'exit');
    need('media', 'media');
    need('broadcast', 'broadcast');
    need('hospitality', 'hospitality');
    need('retail', 'retail');
    need('fanzone', 'fanzone');
    if (want.length && this.spendable > 400_000) {
      this.b.rooms(want.slice(0, 3));
      this.actions.builds++;
    }
    if ((m.lighting ?? 1) < 0.7 && this.spendable > 900_000) {
      this.b.floodlights(4);
      this.actions.builds++;
    }
    if ((m.parking ?? 1) < 0.7) {
      // Flat asphalt first while there is cheap ground; once the plot is busy
      // or the crowd is big, stack it instead.
      const big = (this.game.primaryVenue?.capacity.total || 0) > 12_000;
      if (big && this.spendable > 3_500_000) {
        if (this.b.addGarage(6)) this.actions.builds++;
      } else if (this.spendable > 400_000) {
        if (this.b.addParking()) this.actions.builds++;
      }
    }
    // Transport is more than parking: a big crowd needs a way in that is not
    // a car, and the ratio requirement grows with every seat you add.
    if ((m.parking ?? 1) < 0.8 && this.spendable > 900_000) {
      this.b.addTransit();
      this.actions.builds++;
    }
  }

  /** Capacity is what unlocks the next tier of events, so it gets the surplus. */
  grow() {
    const g = this.game;
    const v = g.primaryVenue;
    if (!v) return;
    // Plenty spare and a bigger plot available? Take it early.
    const land = g.land();
    if (land.next && this.spendable > land.next.cost * 2.5) {
      if (this.buyLandWhenAffordable()) return;
    }
    // Grow the bowl: rings around the pitch are the seat-efficient way up,
    // and every ring stays inside the venue's reach.
    if (this.spendable > 900_000) {
      const r = this.b.expandBowl() || this.b.addStand();
      if (r) { this.actions.builds++; this.log(`day ${this.s.day}: extended the bowl (${r.staged ? 'staged' : 'instant'}, ${fmt(r.cost)})`); }
    }
    // A second city, once the game says it is allowed.
    if (this.s.reputation.venue >= 55 && this.s.sites.length < 2) {
      const city = this.otherCity();
      if (city) {
        const r = g.buySite(city);
        if (r?.ok) { this.actions.sites++; this.log(`day ${this.s.day}: bought land in a second city`); }
      }
    }
  }

  otherCity() {
    const owned = new Set(this.s.sites.map((x) => x.cityId));
    const affordable = CITIES
      .filter((c) => !owned.has(c.id) && c.buyCost <= this.spendable)
      .sort((a, b) => a.buyCost - b.buyCost);
    return affordable[0]?.id || null;
  }

  people() {
    const g = this.game;
    if (this.s.staff.length < 6 && this.spendable > 900_000) {
      const c = g.candidates(3)[0];
      if (c && g.hire(c.role.id, c.hire)?.ok) {
        this.actions.hires++;
        this.log(`day ${this.s.day}: hired a ${c.role.name}`);
      }
    }
    const offers = g.sponsorOffers();
    if (offers.length) {
      const pick = offers.slice().sort((a, b) => (b.perEvent || 0) - (a.perEvent || 0))[0];
      if (g.signSponsor(pick.id)?.ok) {
        this.actions.sponsors++;
        this.log(`day ${this.s.day}: signed ${pick.name}`);
      }
    }
    // Research is a long payback, so only fund it out of genuine surplus.
    if (!this.s.research.active) {
      const opts = g.researchOptions()
        .filter((r) => r.cost * 4 <= this.spendable)
        .sort((a, b) => a.cost - b.cost);
      if (opts.length && g.startResearch(opts[0].id)?.ok) {
        this.actions.research++;
        this.log(`day ${this.s.day}: started research ${opts[0].name}`);
      }
    }
  }
}

export const fmt = (v) => {
  const a = Math.abs(Math.round(v));
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${a}`;
};

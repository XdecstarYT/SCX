import { makeRng, hashString } from '../core/rng.js';
import { conditionEffect } from '../core/groundskeeping.js';
import { PRICING_TIERS, bidCostMultiplier, contractEffects, clamp } from './bidding.js';

const TIER_BROADCAST = { local: 0, regional: 120_000, national: 900_000, international: 3_400_000, world: 9_500_000 };
const TIER_STAFF_RATE = { local: 0.9, regional: 1.2, national: 1.7, international: 2.3, world: 3.1 };

/**
 * What an organiser spends promoting each tier. The floor is the campaign they
 * would run regardless; perHead scales the rest with the crowd they expect.
 */
const TIER_MARKETING = {
  local:         { floor: 2_000,   perHead: 1.0 },
  regional:      { floor: 14_000,  perHead: 1.2 },
  national:      { floor: 45_000,  perHead: 1.5 },
  international: { floor: 95_000,  perHead: 1.8 },
  world:         { floor: 160_000, perHead: 2.0 },
};

/** What an incident actually costs, relative to the national-tier figures. */
const TIER_INCIDENT = {
  local: 0.14, regional: 0.45, national: 1, international: 1.7, world: 2.4,
};

/**
 * A day with nothing done to it. Matchday operations replace this; every other
 * caller gets the behaviour the simulation always had.
 */
export const NO_OPS = Object.freeze({
  guard: Object.freeze({}),
  incidents: Object.freeze([]),
  gate: 1, fill: 1, spend: 1, price: 1,
  satisfaction: 0, cost: 0, revenue: 0,
  rep: Object.freeze({}),
});

/**
 * Every way this particular day can go wrong, with the odds, before any of it
 * has happened.
 *
 * Read by the simulation to roll them, and by matchday operations to decide
 * what is worth putting a steward on. Both read the same table, which is the
 * point: an operations screen that listed different risks from the ones the
 * simulation rolls would be a lie told in a nice font.
 */
export function incidentRisks(ev, venue, state, ctx = {}) {
  const m = venue.ratings.measures;
  const uf = state.utilityFactors || {};
  const congestion = ctx.congestion ?? 0;
  const out = [];
  const add = (key, chance, text, effect) => {
    if (chance > 0) out.push({ key, chance: Math.min(0.95, chance), text, ...effect });
  };

  add('congestion', congestion > 0.42 ? 0.55 + congestion * 0.4 : 0,
    'Serious congestion at the gates delayed kick-off.',
    { satisfaction: -18, reputation: -2, dept: 'security' });
  add('sewer', (uf.sewer ?? 1) < 0.85 ? 0.5 : 0,
    'Wastewater capacity was overwhelmed and several restroom blocks were closed.',
    { satisfaction: -12, community: -5, cost: 30_000, dept: 'operations' });
  add('water', (uf.water ?? 1) < 0.8 ? 0.4 : 0,
    'Water pressure failed at the concession stands during the interval.',
    { satisfaction: -8, cost: 20_000, dept: 'operations' });
  add('data', (uf.data ?? 1) < 0.75 ? 0.5 : 0,
    'The broadcast feed dropped out. The rights holder was not impressed.',
    { satisfaction: -4, reputation: -4, cost: 80_000, dept: 'events' });
  add('climate', (uf.climate ?? 1) < 0.75 ? 0.35 : 0,
    'Enclosed areas were stifling and hospitality guests complained.',
    { satisfaction: -7, dept: 'hospitality' });
  const deficit = state.powerDeficit || 0;
  add('power', deficit > 0 ? 0.45 + Math.min(0.4, deficit / 20) : 0,
    'The site drew more power than the grid could supply. Screens and lighting cut out mid-event.',
    { satisfaction: -14, reputation: -3, cost: 60_000, dept: 'operations' });
  add('lighting', m.lighting < 0.5 ? 0.25 : 0,
    'A floodlight bank failed and play was briefly suspended.',
    { satisfaction: -10, reputation: -2, cost: 40_000, dept: 'operations' });
  add('restroom', m.restroom < 0.45 ? 0.5 : 0,
    'Restroom queues drew complaints across social media.',
    { satisfaction: -9, dept: 'operations' });
  add('parking', m.parking < 0.5 ? 0.5 : 0,
    'Overspill parking clogged local streets. The council noticed.',
    { satisfaction: -6, community: -6, dept: 'operations' });
  add('security', m.security < 0.45 ? 0.3 + ev.risk * 0.4 : 0,
    'A security incident in the away end required police support.',
    { satisfaction: -12, reputation: -3, cost: 90_000, dept: 'security' });
  add('structure', venue.structuralWarnings > 0 ? 0.3 : 0,
    'A safety inspector flagged unsupported roof sections. A section was closed.',
    { satisfaction: -8, reputation: -4, cost: 120_000, dept: 'operations' });
  const promiseRisk = ctx.extraRisk || 0;
  add('promise', promiseRisk > 0 ? Math.min(0.7, promiseRisk * 2) : 0,
    'The organiser found the venue fell short of what was agreed in negotiation.',
    { satisfaction: -8, reputation: -4, dept: 'events' });
  // Not everything that can happen is a failure.
  add('atmosphere', ctx.soldOut && venue.ratings.overall > 70 ? 0.3 : 0,
    'A sell-out crowd and a great atmosphere made the highlight reels.',
    { satisfaction: 8, reputation: 3, good: true, dept: 'events' });
  return out;
}

/**
 * Simulate a hosted event against the player's real venue.
 *
 * Nothing here is a flat multiplier on "stadium level" - attendance, spend and
 * satisfaction all trace back to specific things the player built (or didn't).
 */
export function simulateEvent(ev, venue, state, contract, ops = NO_OPS) {
  const rng = makeRng(hashString(`${ev.uid}:sim:${ev.seed}`));
  const m = venue.ratings.measures;
  const pricing = PRICING_TIERS.find((p) => p.key === contract.pricing) || PRICING_TIERS[1];
  const eff = contractEffects(contract);

  // ------------------------------------------------------------- attendance
  // Where the venue is matters: the capital fills a stadium the coast cannot.
  const audience = venue.audienceMult ?? 1;
  const demandPool = ev.popularity * audience
    * (0.55 + state.reputation.venue / 220 + state.reputation.fans / 300);
  const comfortPull = (venue.ratings.comfort / 100) * 0.18 + (venue.ratings.accessibility / 100) * 0.14;
  const marketing = 1 + state.staffBonus.marketing * 0.22;
  let fill = clamp(
    (demandPool + comfortPull) * pricing.elasticity * marketing * rng.jitter(0.12) * ops.fill,
    0.05, 1.0);

  // Weather bites outdoor venues.
  const weather = state.weather;
  const outdoor = !venue.indoor;
  let weatherPenalty = 0;
  if (outdoor) {
    if (weather === 'rain') weatherPenalty = 0.08 * (1 - venue.seatRoofCoverage);
    if (weather === 'storm') weatherPenalty = 0.22 * (1 - venue.seatRoofCoverage);
    if (weather === 'heat') weatherPenalty = 0.06;
    fill = clamp(fill - weatherPenalty, 0.03, 1);
  }

  // People will not queue for an hour. Gate capacity caps real attendance.
  // Programme lifts are permanent and the day's decisions are not, but they
  // land on the same numbers, so they multiply together rather than one of
  // them quietly winning.
  const prog = state.programmes?.effects || {};
  const gateThroughput = venue.facilities.entrance * 400 * 2.2 * ops.gate * (prog.gate || 1);
  const gateCapped = gateThroughput > 0 ? Math.min(venue.capacity.total, gateThroughput) : venue.capacity.total * 0.35;
  const soldOut = fill >= 0.985;
  let attendance = Math.round(Math.min(venue.capacity.total * fill, gateCapped));
  const turnedAway = Math.max(0, Math.round(venue.capacity.total * fill) - attendance);

  // ---------------------------------------------------------------- incidents
  //
  // Every way a day can go wrong, as a table rather than a chain of rolls.
  // Written this way because matchday operations need to *read* the risks
  // before they happen - a steward deployment is only a decision if the game
  // can say what it is a decision about - and to suppress the ones the player
  // actually acted on. Rolling them inline made that impossible to do without
  // a second, divergent copy of the same conditions.
  // Congestion is about the crowd that wanted in, not the crowd that got in.
  // Measuring it on admitted attendance meant a ground whose gates were so
  // narrow they capped the crowd came out *less* congested than one that let
  // everybody through - the queue round the block, which is the congestion,
  // counted as an improvement.
  //
  // `fill` is already the share of capacity that wanted to come, so it is the
  // whole of the demand term. Adding the turned-away on top of it double
  // counted, because the turned-away are computed from that same figure: a
  // gate-capped ground came out at 1.4 and every event in the game got harder.
  // They are worse than merely queueing, so they aggravate it - by a quarter.
  const turnedFraction = turnedAway / Math.max(1, venue.capacity.total);
  const wanted = clamp(fill + turnedFraction * 0.25, 0, 1.15);
  const congestion = clamp(1 - venue.ratings.crowdFlow / 100, 0, 1) * wanted;
  const uf = state.utilityFactors || {};
  const risks = incidentRisks(ev, venue, state, { congestion, soldOut, extraRisk: eff.extraRisk || 0 });

  const incidents = [];
  for (const r of risks) {
    // Operations can damp a risk right down, but never to nothing: a plan is
    // not a guarantee, and one that made a failure impossible would make the
    // building it stands in irrelevant.
    const guard = clamp(ops.guard?.[r.key] ?? 0, 0, 0.85);
    const chance = r.chance * (1 - guard);
    if (!rng.chance(chance)) continue;
    const damp = 1 - guard * 0.6;
    incidents.push({
      key: r.key, text: r.text,
      satisfaction: Math.round((r.satisfaction || 0) * (r.good ? 1 : damp)),
      reputation: +((r.reputation || 0) * (r.good ? 1 : damp)).toFixed(2),
      community: +((r.community || 0) * (r.good ? 1 : damp)).toFixed(2),
      cost: Math.round((r.cost || 0) * damp),
      good: !!r.good,
    });
  }
  for (const extra of ops.incidents || []) incidents.push({ ...extra });

  // ------------------------------------------------------------------ revenue
  const q = 0.65 + (venue.ratings.overall / 100) * 0.5;
  const priceMult = pricing.mult;
  const days = ev.days + (eff.extraDays || 0);
  const perDay = Math.max(1, ev.days * 0.55 + 0.45);

  const tickets = Math.round(attendance * ev.base * priceMult * ops.price * q * perDay);
  const vipAttend = Math.min(venue.capacity.vip, Math.round(venue.capacity.vip * clamp(fill + 0.15, 0, 1)));
  const boxes = venue.capacity.boxes || 0;
  const vip = Math.round(vipAttend * ev.base * 5.4 * priceMult * perDay
    + boxes * ev.base * 34 * priceMult * perDay
    + m.hospitality * venue.capacity.total * 0.9 * perDay);

  const spendBase = ev.audience === 'premium' ? 16 : ev.audience === 'family' ? 12 : 9;
  const sponsorBonus = state.sponsorBonuses || { food: 0, merch: 0, sponsor: 0, broadcast: 0, athlete: 0 };
  const food = Math.round(attendance * spendBase * Math.min(1.25, 0.3 + m.concession * 0.95)
    * perDay * (1 + sponsorBonus.food) * ops.spend * (prog.spend || 1));
  const merch = Math.round(attendance * (spendBase * 0.55) * Math.min(1.2, 0.15 + m.retail * 1.1)
    * perDay * (1 + sponsorBonus.merch) * ops.spend * (prog.spend || 1));
  const carsUsed = Math.min(venue.parkingCars, Math.round(attendance / 2.6 * (1 - state.transitShare)));
  const parking = Math.round(carsUsed * 14 * perDay);

  const sponsorship = Math.round((
    state.sponsorPerEvent * (1 - eff.sponsorPenalty) * (0.6 + ev.popularity * 0.7)
    + venue.screens * 2400 + state.complex.adverts * 90
  ) * (1 + sponsorBonus.sponsor));

  const broadcastBase = (TIER_BROADCAST[ev.tier] || 0) * (0.4 + m.broadcast * 0.9);
  const researchBroadcast = state.research.completed.includes('broadcast') ? 0.12 : 0;
  const broadcast = Math.round(broadcastBase
    * (1 + eff.broadcastBonus + sponsorBonus.broadcast + researchBroadcast));

  const venueFee = Math.round(ev.fee * (1 + (eff.feeUplift || 0)));

  const grossRevenue = tickets + vip + food + merch + parking + sponsorship + broadcast + venueFee;
  const revenueShareLoss = Math.round(grossRevenue * Math.max(0, -eff.revenueShare));
  const revenueShareGain = Math.round(grossRevenue * Math.max(0, eff.revenueShare));

  const revenue = {
    tickets, vip, food, merch, parking, sponsorship, broadcast,
    venueFee, revenueShare: revenueShareGain - revenueShareLoss,
  };
  if (ops.revenue) revenue.operations = Math.round(ops.revenue);
  const totalRevenue = grossRevenue + revenue.revenueShare + (revenue.operations || 0);

  // -------------------------------------------------------------------- costs
  const staffRate = TIER_STAFF_RATE[ev.tier] || 1;
  const eventStaff = Math.round((attendance / 240 + 26) * staffRate);
  const staffCost = Math.round(eventStaff * 320 * days * (1 - state.staffBonus.operations * 0.12));
  const securityCost = Math.round(attendance * 3.1 * staffRate * days);
  const cleaning = Math.round(attendance * 1.4 * days);
  const utilities = Math.round((state.complex.powerDemand * 42 + 5_000) * days);
  // Setup scales with the part of the ground actually opened, not with how
  // big the ground is. Charging by total capacity meant every stand you built
  // made small events *less* affordable, which is backwards: a club hires the
  // stadium and opens one stand, it does not pay to prepare all four.
  const setup = Math.round((6_000 + attendance * 3.4 + venue.capacity.total * 0.5) * days * ev.wear);
  const insurance = Math.round(totalRevenue * (0.018 + ev.risk * 0.03));
  // Marketing is the organiser's commercial ambition, which is what the tier
  // measures. A community open day does not run a national campaign.
  const mk = TIER_MARKETING[ev.tier] || TIER_MARKETING.local;
  const marketingCost = Math.round(mk.floor + attendance * 1.9 * mk.perHead);
  const transport = Math.round(carsUsed * 2.4 + attendance * 0.6);
  const packageCost = Math.round(totalRevenue * bidCostMultiplier(contract));
  // Incident costs are quoted at national scale. The same failure costs a
  // community ground community-ground money, and is capped at a share of what
  // the event was worth - a bad day should hurt, not be unsurvivable.
  const incidentScale = TIER_INCIDENT[ev.tier] ?? 1;
  const rawIncidents = incidents.reduce((s, i) => s + (i.cost || 0), 0) * incidentScale;
  const incidentCost = Math.round(Math.min(rawIncidents, totalRevenue * 0.35));

  const costs = {
    staff: staffCost, security: securityCost, cleaning, utilities,
    setup, insurance, marketing: marketingCost, transport,
    packages: packageCost, incidents: incidentCost,
    // Everything the day's own decisions cost: overtime, extra stewards,
    // buses laid on, a pitch cover rolled out at four in the morning.
    operations: Math.round(ops.cost || 0),
  };
  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = totalRevenue - totalCost;

  // The surface everyone came to watch something happen on. A worn pitch is a
  // worse spectacle and a more dangerous one, and it is the one thing at an
  // event that a camera is pointed at for the whole ninety minutes.
  const pitch = state.pitches?.byVenue?.[venue.key]?.condition;
  const pitchEffect = pitch === undefined ? null : conditionEffect(pitch);
  if (pitchEffect && pitchEffect.injuryRisk > 0 && rng.chance(pitchEffect.injuryRisk)) {
    incidents.push({
      key: 'pitch_injury', text: 'A player went down badly on a rutted surface.',
      satisfaction: -9, reputation: -1.5, cost: 12_000, dept: 'operations', good: false,
    });
  }

  // ------------------------------------------------------------- reputation
  let satisfaction = 52
    + (venue.ratings.comfort - 50) * 0.42
    + (venue.ratings.crowdFlow - 50) * 0.34
    + (venue.ratings.appearance - 50) * 0.16
    + pricing.satisfaction
    + (soldOut ? 6 : 0)
    - (turnedAway > 0 ? 8 : 0)
    - weatherPenalty * 40;
  for (const i of incidents) satisfaction += i.satisfaction || 0;
  satisfaction += ops.satisfaction || 0;
  if (pitchEffect) satisfaction += pitchEffect.satisfaction;
  satisfaction = Math.round(clamp(satisfaction, 3, 99));

  const delivery = clamp((satisfaction / 100) * 0.6 + (venue.ratings.overall / 100) * 0.4, 0, 1);
  const prestigeGain = ev.prestige * (0.45 + delivery * 0.85);

  const repDelta = {
    venue: +(prestigeGain * 0.5 + (delivery - 0.55) * 6).toFixed(2),
    fans: +((satisfaction - 55) * 0.16).toFixed(2),
    athletes: +((((m.locker + m.medical + (venue.field?.regulation ?? 0)) / 3 - 0.55) * 9)
      + (contract.negotiation?.athleteBonus || 0) + (sponsorBonus.athlete || 0)).toFixed(2),
    organiser: +((delivery - 0.5) * 11).toFixed(2),
    community: +((ev.community || 0) * 0.4 + (m.parking - 0.6) * 5 + (contract.negotiation?.communityBonus || 0) * 0.5).toFixed(2),
  };
  for (const i of incidents) {
    if (i.reputation) repDelta.venue += i.reputation;
    if (i.community) repDelta.community += i.community;
  }
  for (const [k, v] of Object.entries(ops.rep || {})) {
    if (repDelta[k] !== undefined) repDelta[k] = +(repDelta[k] + v).toFixed(2);
  }

  return {
    eventUid: ev.uid,
    eventName: ev.name,
    tier: ev.tier,
    organiser: ev.organiser,
    venueName: venue.name || venue.type,
    venueKey: venue.key,
    day: state.day,
    days,
    attendance,
    capacity: venue.capacity.total,
    fill: attendance / Math.max(1, venue.capacity.total),
    soldOut,
    turnedAway,
    weather,
    revenue,
    totalRevenue,
    costs,
    totalCost,
    profit,
    satisfaction,
    prestigeGain: +prestigeGain.toFixed(1),
    repDelta,
    incidents,
    pricing: pricing.key,
    // What was decided on the day, so the report reads as an account of it
    // rather than as a number that arrived from nowhere.
    ops: ops === NO_OPS ? null : {
      calls: ops.log || [],
      cost: Math.round(ops.cost || 0),
      revenue: Math.round(ops.revenue || 0),
      guarded: Object.keys(ops.guard || {}),
    },
  };
}

export { TIER_BROADCAST };

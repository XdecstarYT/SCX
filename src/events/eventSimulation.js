import { makeRng, hashString } from '../core/rng.js';
import { PRICING_TIERS, bidCostMultiplier, contractEffects, clamp } from './bidding.js';

const TIER_BROADCAST = { local: 0, regional: 120_000, national: 900_000, international: 3_400_000, world: 9_500_000 };
const TIER_STAFF_RATE = { local: 0.9, regional: 1.2, national: 1.7, international: 2.3, world: 3.1 };

/**
 * Simulate a hosted event against the player's real venue.
 *
 * Nothing here is a flat multiplier on "stadium level" - attendance, spend and
 * satisfaction all trace back to specific things the player built (or didn't).
 */
export function simulateEvent(ev, venue, state, contract) {
  const rng = makeRng(hashString(`${ev.uid}:sim:${ev.seed}`));
  const m = venue.ratings.measures;
  const pricing = PRICING_TIERS.find((p) => p.key === contract.pricing) || PRICING_TIERS[1];
  const eff = contractEffects(contract);

  // ------------------------------------------------------------- attendance
  const demandPool = ev.popularity * (0.55 + state.reputation.venue / 220 + state.reputation.fans / 300);
  const comfortPull = (venue.ratings.comfort / 100) * 0.18 + (venue.ratings.accessibility / 100) * 0.14;
  const marketing = 1 + state.staffBonus.marketing * 0.22;
  let fill = clamp(
    (demandPool + comfortPull) * pricing.elasticity * marketing * rng.jitter(0.12),
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
  const gateThroughput = venue.facilities.entrance * 400 * 2.2;
  const gateCapped = gateThroughput > 0 ? Math.min(venue.capacity.total, gateThroughput) : venue.capacity.total * 0.35;
  const soldOut = fill >= 0.985;
  let attendance = Math.round(Math.min(venue.capacity.total * fill, gateCapped));
  const turnedAway = Math.max(0, Math.round(venue.capacity.total * fill) - attendance);

  // ---------------------------------------------------------------- incidents
  const incidents = [];
  const congestion = clamp(1 - venue.ratings.crowdFlow / 100, 0, 1) * (attendance / Math.max(1, venue.capacity.total));
  if (congestion > 0.42 && rng.chance(0.55 + congestion * 0.4)) {
    incidents.push({ key: 'congestion', text: 'Serious congestion at the gates delayed kick-off.', satisfaction: -18, reputation: -2 });
  }
  const overloaded = (state.powerDeficit || 0) > 0;
  if (overloaded && rng.chance(0.45 + Math.min(0.4, state.powerDeficit / 20))) {
    incidents.push({
      key: 'power',
      text: 'The site drew more power than the grid could supply. Screens and lighting cut out mid-event.',
      satisfaction: -14, reputation: -3, cost: 60_000,
    });
  }
  if (m.lighting < 0.5 && rng.chance(0.25)) {
    incidents.push({ key: 'lighting', text: 'A floodlight bank failed and play was briefly suspended.', satisfaction: -10, reputation: -2, cost: 40_000 });
  }
  if (m.restroom < 0.45 && rng.chance(0.5)) {
    incidents.push({ key: 'restroom', text: 'Restroom queues drew complaints across social media.', satisfaction: -9 });
  }
  if (m.parking < 0.5 && rng.chance(0.5)) {
    incidents.push({ key: 'parking', text: 'Overspill parking clogged local streets. The council noticed.', satisfaction: -6, community: -6 });
  }
  if (m.security < 0.45 && rng.chance(0.3 + ev.risk * 0.4)) {
    incidents.push({ key: 'security', text: 'A security incident in the away end required police support.', satisfaction: -12, reputation: -3, cost: 90_000 });
  }
  if (venue.structuralWarnings > 0 && rng.chance(0.3)) {
    incidents.push({ key: 'structure', text: 'A safety inspector flagged unsupported roof sections. A section was closed.', satisfaction: -8, reputation: -4, cost: 120_000 });
  }
  const promiseRisk = eff.extraRisk || 0;
  if (promiseRisk > 0 && rng.chance(Math.min(0.7, promiseRisk * 2))) {
    incidents.push({
      key: 'promise',
      text: 'The organiser found the venue fell short of what was agreed in negotiation.',
      satisfaction: -8, reputation: -4,
    });
  }
  if (soldOut && venue.ratings.overall > 70 && rng.chance(0.3)) {
    incidents.push({ key: 'atmosphere', text: 'A sell-out crowd and a great atmosphere made the highlight reels.', satisfaction: 8, reputation: 3 });
  }

  // ------------------------------------------------------------------ revenue
  const q = 0.65 + (venue.ratings.overall / 100) * 0.5;
  const priceMult = pricing.mult;
  const days = ev.days + (eff.extraDays || 0);
  const perDay = Math.max(1, ev.days * 0.55 + 0.45);

  const tickets = Math.round(attendance * ev.base * priceMult * q * perDay);
  const vipAttend = Math.min(venue.capacity.vip, Math.round(venue.capacity.vip * clamp(fill + 0.15, 0, 1)));
  const vip = Math.round(vipAttend * ev.base * 5.4 * priceMult * perDay
    + m.hospitality * venue.capacity.total * 0.9 * perDay);

  const spendBase = ev.audience === 'premium' ? 16 : ev.audience === 'family' ? 12 : 9;
  const food = Math.round(attendance * spendBase * Math.min(1.25, 0.3 + m.concession * 0.95) * perDay);
  const merch = Math.round(attendance * (spendBase * 0.55) * Math.min(1.2, 0.15 + m.retail * 1.1) * perDay);
  const carsUsed = Math.min(venue.parkingCars, Math.round(attendance / 2.6 * (1 - state.transitShare)));
  const parking = Math.round(carsUsed * 14 * perDay);

  const sponsorship = Math.round(
    state.sponsorPerEvent * (1 - eff.sponsorPenalty) * (0.6 + ev.popularity * 0.7)
    + venue.screens * 2400 + state.complex.adverts * 90);

  const broadcastBase = (TIER_BROADCAST[ev.tier] || 0) * (0.4 + m.broadcast * 0.9);
  const broadcast = Math.round(broadcastBase * (1 + eff.broadcastBonus));

  const venueFee = Math.round(ev.fee * (1 + (eff.feeUplift || 0)));

  const grossRevenue = tickets + vip + food + merch + parking + sponsorship + broadcast + venueFee;
  const revenueShareLoss = Math.round(grossRevenue * Math.max(0, -eff.revenueShare));
  const revenueShareGain = Math.round(grossRevenue * Math.max(0, eff.revenueShare));

  const revenue = {
    tickets, vip, food, merch, parking, sponsorship, broadcast,
    venueFee, revenueShare: revenueShareGain - revenueShareLoss,
  };
  const totalRevenue = grossRevenue + revenue.revenueShare;

  // -------------------------------------------------------------------- costs
  const staffRate = TIER_STAFF_RATE[ev.tier] || 1;
  const eventStaff = Math.round((attendance / 240 + 26) * staffRate);
  const staffCost = Math.round(eventStaff * 320 * days * (1 - state.staffBonus.operations * 0.12));
  const securityCost = Math.round(attendance * 3.1 * staffRate * days);
  const cleaning = Math.round(attendance * 1.4 * days);
  const utilities = Math.round((state.complex.powerDemand * 42 + 5_000) * days);
  const setup = Math.round((18_000 + venue.capacity.total * 2.4) * days * ev.wear);
  const insurance = Math.round(totalRevenue * (0.018 + ev.risk * 0.03));
  const marketingCost = Math.round(20_000 + attendance * 1.9);
  const transport = Math.round(carsUsed * 2.4 + attendance * 0.6);
  const packageCost = Math.round(totalRevenue * bidCostMultiplier(contract));
  const incidentCost = incidents.reduce((s, i) => s + (i.cost || 0), 0);

  const costs = {
    staff: staffCost, security: securityCost, cleaning, utilities,
    setup, insurance, marketing: marketingCost, transport,
    packages: packageCost, incidents: incidentCost,
  };
  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = totalRevenue - totalCost;

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
  satisfaction = Math.round(clamp(satisfaction, 3, 99));

  const delivery = clamp((satisfaction / 100) * 0.6 + (venue.ratings.overall / 100) * 0.4, 0, 1);
  const prestigeGain = ev.prestige * (0.45 + delivery * 0.85);

  const repDelta = {
    venue: +(prestigeGain * 0.5 + (delivery - 0.55) * 6).toFixed(2),
    fans: +((satisfaction - 55) * 0.16).toFixed(2),
    athletes: +((((m.locker + m.medical + (venue.field?.regulation ?? 0)) / 3 - 0.55) * 9)
      + (contract.negotiation?.athleteBonus || 0)).toFixed(2),
    organiser: +((delivery - 0.5) * 11).toFixed(2),
    community: +((ev.community || 0) * 0.4 + (m.parking - 0.6) * 5 + (contract.negotiation?.communityBonus || 0) * 0.5).toFixed(2),
  };
  for (const i of incidents) {
    if (i.reputation) repDelta.venue += i.reputation;
    if (i.community) repDelta.community += i.community;
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
  };
}

export { TIER_BROADCAST };

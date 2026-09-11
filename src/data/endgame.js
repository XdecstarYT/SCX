/**
 * Long-horizon objectives.
 *
 * The brief is clear that the game should not simply end when the player gets
 * rich, so these are things that take deliberate building rather than time:
 * a venue for every sport, a genuinely world-class rating, hosting the
 * ceremony everyone watches.
 */
export const ENDGAME_GOALS = [
  {
    id: 'largest', name: 'The Largest Stadium', tier: 'build',
    desc: 'Build a single venue holding 90,000.',
    progress: (s) => Math.min(1, s.stats.bestCapacity / 90_000),
    detail: (s) => `${Math.round(s.stats.bestCapacity).toLocaleString()} / 90,000 seats`,
  },
  {
    id: 'perfect_venue', name: 'World-Class Venue', tier: 'build',
    desc: 'Reach a venue rating of 95.',
    progress: (s) => Math.min(1, s.stats.bestRating / 95),
    detail: (s) => `rating ${s.stats.bestRating} / 95`,
  },
  {
    id: 'district', name: 'Mega Sports District', tier: 'build',
    desc: 'Own the largest plot and operate four registered venues on it.',
    // Land moved onto sites when the game gained more than one city; reading
    // it off the top-level state made this goal read NaN and never complete.
    progress: (s) => Math.min(1, (maxLandTier(s) / 3) * 0.5
      + Math.min(1, s.venues.registered.length / 4) * 0.5),
    detail: (s) => `plot tier ${maxLandTier(s) + 1}/4 · ${s.venues.registered.length}/4 venues`,
  },
  {
    id: 'every_sport', name: 'Every Sport Under One Roof', tier: 'build',
    desc: 'Host events in six different sports.',
    progress: (s) => Math.min(1, s.stats.sportsHosted.length / 6),
    detail: (s) => `${s.stats.sportsHosted.length} / 6 sports`,
  },
  {
    id: 'empire', name: 'A Group, Not A Ground', tier: 'build',
    desc: 'Operate venues in three different cities.',
    progress: (s) => Math.min(1, (s.sites || []).filter(
      (site) => s.venues.registered.some((r) => r.siteId === site.id)).length / 3),
    detail: (s) => {
      const live = (s.sites || []).filter((site) => s.venues.registered.some((r) => r.siteId === site.id));
      return `${live.length} / 3 cities with a live venue`;
    },
  },
  {
    id: 'reputation', name: 'Untouchable Reputation', tier: 'operate',
    desc: 'Reach 100 venue reputation.',
    progress: (s) => s.reputation.venue / 100,
    detail: (s) => `${Math.round(s.reputation.venue)} / 100`,
  },
  {
    id: 'beloved', name: 'Part Of The Furniture', tier: 'operate',
    desc: 'Hold 90 community standing and 90 fan satisfaction at once.',
    progress: (s) => Math.min(1, (Math.min(s.reputation.community, 90) / 90) * 0.5
      + (Math.min(s.reputation.fans, 90) / 90) * 0.5),
    detail: (s) => `community ${Math.round(s.reputation.community)} · fans ${Math.round(s.reputation.fans)}`,
  },
  {
    id: 'million_fans', name: 'A Million Through The Gates', tier: 'operate',
    desc: 'Welcome 1,000,000 spectators.',
    progress: (s) => Math.min(1, s.stats.totalAttendance / 1_000_000),
    detail: (s) => `${s.stats.totalAttendance.toLocaleString()} / 1,000,000`,
  },
  {
    id: 'profit', name: 'Most Profitable Operator', tier: 'operate',
    desc: 'Bank $250M in lifetime profit.',
    progress: (s) => Math.min(1, s.stats.lifetimeProfit / 250_000_000),
    detail: (s) => `$${(s.stats.lifetimeProfit / 1_000_000).toFixed(1)}M / $250M`,
  },
  {
    id: 'world_host', name: 'Host Of The World Championship', tier: 'compete',
    desc: 'Host a world-tier event.',
    progress: (s) => (s.stats.tiersHosted.includes('world') ? 1 : 0),
    detail: (s) => (s.stats.tiersHosted.includes('world') ? 'Hosted' : 'Not yet hosted'),
  },
  {
    id: 'ceremony', name: 'The Opening Ceremony', tier: 'compete',
    desc: 'Win the bid for a Games Opening Ceremony.',
    progress: (s) => (s.stats.ceremonyHosted ? 1 : 0),
    detail: (s) => (s.stats.ceremonyHosted ? 'Hosted' : 'Not yet hosted'),
  },
  {
    id: 'bid_king', name: 'Nobody Outbids You', tier: 'compete',
    desc: 'Win 40 event bids.',
    progress: (s) => Math.min(1, s.stats.bidsWon / 40),
    detail: (s) => `${s.stats.bidsWon} / 40 bids won`,
  },
  {
    id: 'dominant', name: 'The Rivals Are Beaten', tier: 'compete',
    desc: 'Hold a higher reputation than every rival operator.',
    progress: (s) => {
      const best = Math.max(0, ...s.rivals.map((r) => r.reputation));
      return best === 0 ? 0 : Math.min(1, s.reputation.venue / Math.max(1, best));
    },
    detail: (s) => {
      const top = s.rivals.slice().sort((a, b) => b.reputation - a.reputation)[0];
      return top ? `you ${Math.round(s.reputation.venue)} · ${top.name} ${Math.round(top.reputation)}` : '-';
    },
  },
];

/** The best plot the player owns anywhere. */
function maxLandTier(s) {
  return Math.max(0, ...(s.sites || []).map((site) => site.landTier ?? 0));
}

export const GOAL_GROUPS = [
  { key: 'build', name: 'Build' },
  { key: 'operate', name: 'Operate' },
  { key: 'compete', name: 'Compete' },
];

export function endgameProgress(state) {
  const goals = ENDGAME_GOALS.map((g) => {
    let p = 0;
    try { p = Math.max(0, Math.min(1, g.progress(state) || 0)); } catch { p = 0; }
    let detail = '';
    try { detail = g.detail(state); } catch { detail = ''; }
    return { ...g, value: p, detail, complete: p >= 1 };
  });
  return {
    goals,
    complete: goals.filter((g) => g.complete).length,
    total: goals.length,
    overall: goals.reduce((s, g) => s + g.value, 0) / goals.length,
  };
}

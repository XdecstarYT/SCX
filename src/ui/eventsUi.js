import { el, fill, section, pill, meter, requirementRow, emptyState, animateNumber } from './dom.js';
import { fmtMoney, fmtNum, LEDGER_CATEGORIES } from '../core/economy.js';
import { TIER_LABEL } from '../venues/ratings.js';
import { BID_PACKAGES, CONTRACT_TERMS, EVENT_TEMPLATES } from '../data/events.js';
import { PRICING_TIERS } from '../events/bidding.js';
import { checkRequirements, bestVenueFor } from '../events/eventRequirements.js';
import { instantiate } from '../events/eventGenerator.js';
import { makeRng } from '../core/rng.js';

/**
 * Everything to do with events: the opportunity board, the bidding screen
 * (amount, packages, contract terms, ticket pricing) and the results report.
 */
export class EventsUi {
  constructor(app) { this.app = app; }
  get game() { return this.app.game; }
  get hud() { return this.app.hud; }
  get state() { return this.app.game.state; }

  // ================================================================= BOARD
  openBoard() {
    const tabs = ['Opportunities', 'Scheduled', 'History'];
    let active = 'Opportunities';
    const tabBar = el('div.tabs');
    const render = () => {
      fill(tabBar, ...tabs.map((t) => el('button.tab' + (t === active ? '.on' : ''), {
        onclick: () => { active = t; render(); },
      }, t)));
      const body = active === 'Opportunities' ? this.boardBody(render)
        : active === 'Scheduled' ? this.scheduledBody()
        : this.historyBody();
      if (this.hud.sheetOpen) this.hud.updateSheetBody(body);
      else this.hud.openSheet('Events', body, { tabs: tabBar });
    };
    this._rerenderBoard = render;
    render();
  }

  boardBody(rerender) {
    const s = this.state;
    const open = s.events.board.filter((e) => ['open', 'lost', 'expired'].includes(e.status));
    const venues = this.game.registeredVenues();

    if (!venues.length) {
      return el('div', {}, el('div.card', {},
        emptyState('⚑', 'Organisers will only deal with a registered venue.'),
        el('div.small.faint', { style: { textAlign: 'center' },
          text: 'Build a sport surface with seating and facilities, then register it from the Home tab.' })));
    }
    if (!open.length) return el('div.card', {}, emptyState('…', 'No open opportunities right now. New ones arrive as days pass.'));

    return el('div.stack', {}, ...open.map((ev) => this.eventCard(ev, venues, rerender)));
  }

  eventCard(ev, venues, rerender) {
    const s = this.state;
    const { venue, check } = bestVenueFor(ev, venues, s);
    const daysLeft = ev.bidDeadline - s.day;
    const dead = ev.status !== 'open';

    return el('div.card' + (check?.ok && !dead ? '.accent' : ''), { style: dead ? { opacity: '.55' } : {} },
      el('div.rowbetween', {},
        el('div', {}, el('h3', { text: ev.name }), el('div.sub', { text: ev.organiser })),
        pill(TIER_LABEL[ev.tier] || ev.tier, ev.tier)),
      el('div.small.faint', { style: { marginTop: '7px' }, text: ev.blurb }),

      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', margin: '11px 0' } },
        this.mini('Bid range', `${fmtMoney(ev.bidRange[0])}–${fmtMoney(ev.bidRange[1])}`),
        this.mini('Est. revenue', fmtMoney(ev.estRevenue)),
        this.mini('Prestige', `+${ev.prestige}`)),

      el('div.rowbetween', {},
        el('span.tiny.faint', { text: `Event on day ${ev.eventDay} · ${ev.days} day${ev.days > 1 ? 's' : ''}` }),
        dead ? pill(ev.status === 'lost' ? 'Lost' : 'Closed', 'no')
             : el('span.tiny', { class: daysLeft <= 2 ? 'tiny neg' : 'tiny faint', text: `Bids close in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` })),

      !dead && check ? el('div', { style: { marginTop: '10px' } },
        check.ok
          ? el('div.issue.good', {}, el('span.ic', { text: '✓' }), el('span', { text: `${venue.name} meets every requirement.` }))
          : el('div.issue.warn', {}, el('span.ic', { text: '⚠' }),
              el('span', { text: `${check.blocking} requirement${check.blocking > 1 ? 's' : ''} not met by ${venue?.name || 'your venue'}.` }))) : null,

      !dead ? el('button.btn.sm.full' + (check?.ok ? '.primary' : ''), {
        style: { marginTop: '10px' },
        onclick: () => this.openBid(ev.uid),
      }, check?.ok ? 'Prepare a bid' : 'View requirements') : null);
  }

  mini(k, v) {
    return el('div', {}, el('div.tiny.faint', { text: k.toUpperCase() }), el('div.small.mono', { text: v }));
  }

  scheduledBody() {
    const s = this.state;
    if (!s.events.scheduled.length) return el('div.card', {}, emptyState('◷', 'Nothing scheduled. Win a bid to fill the calendar.'));
    return el('div.stack', {}, ...s.events.scheduled
      .slice().sort((a, b) => a.eventDay - b.eventDay)
      .map((ev) => {
        const away = ev.eventDay - s.day;
        const venue = this.game.analysis.venues.find((v) => v.key === ev.bid.venueKey);
        return el('div.card.good', {},
          el('div.rowbetween', {},
            el('div', {}, el('h3', { text: ev.name }), el('div.sub', { text: `${venue?.name || 'Venue'} · ${ev.organiser}` })),
            pill(TIER_LABEL[ev.tier], ev.tier)),
          el('div.rowbetween', { style: { marginTop: '9px' } },
            el('span.small', { text: away <= 0 ? 'Today' : `In ${away} day${away === 1 ? '' : 's'} (day ${ev.eventDay})` }),
            el('span.tiny.faint', { text: `${PRICING_TIERS.find((p) => p.key === ev.bid.pricing)?.name} pricing` })),
          el('div.tiny.faint', { style: { marginTop: '6px' },
            text: `Hosting fee paid: ${fmtMoney(ev.bid.amount)}${ev.bid.packages.length ? ' · ' + ev.bid.packages.length + ' package(s) promised' : ''}` }),
          away > 0 ? el('button.btn.sm.full', { style: { marginTop: '9px' },
            onclick: () => { this.hud.closeSheet(); this.app.fastForwardTo(ev.eventDay); } }, `Advance to event day`) : null);
      }));
  }

  historyBody() {
    const h = this.state.events.history;
    if (!h.length) return el('div.card', {}, emptyState('◴', 'No events hosted yet.'));
    return el('div.stack', {}, ...h.map((r) => el('div.card.tight', {},
      el('div.rowbetween', {},
        el('div', {}, el('div.small', { text: r.eventName }),
          el('div.tiny.faint', { text: `Day ${r.day} · ${fmtNum(r.attendance)} / ${fmtNum(r.capacity)}${r.soldOut ? ' · SELL-OUT' : ''}` })),
        el('span', { class: 'small mono ' + (r.profit >= 0 ? 'pos' : 'neg'), text: fmtMoney(r.profit, { sign: true }) })),
      el('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => this.showReport(r, false) }, 'Full report'))));
  }

  // ================================================================== BID
  openBid(uid) {
    const ev = this.game.findEvent(uid);
    if (!ev) return;
    const venues = this.game.registeredVenues();
    const initial = bestVenueFor(ev, venues, this.state);

    const bid = {
      amount: Math.round((ev.bidRange[0] + ev.bidRange[1]) / 2),
      packages: [],
      terms: [],
      pricing: 'standard',
      venueKey: initial.venue?.key,
    };

    const body = el('div');
    const render = () => {
      const preview = this.game.previewBid(uid, bid);
      fill(body, this.bidBody(ev, bid, preview, venues, render));
    };
    render();
    this.hud.openSheet(ev.name, body);
  }

  bidBody(ev, bid, preview, venues, rerender) {
    const s = this.state;
    const { venue, evaluation, projection } = preview || {};
    const check = evaluation?.check;
    const ok = !!check?.ok;
    const strengthPct = Math.round((evaluation?.strength || 0) * 100);
    const winPct = Math.round((evaluation?.winChance || 0) * 100);

    return el('div', {},
      // ------------------------------------------------------------ header
      el('div.card.accent', {},
        el('div.rowbetween', {},
          el('div', {}, el('h3', { text: ev.organiser }), el('div.sub', { text: `Event on day ${ev.eventDay} · ${ev.days} day${ev.days > 1 ? 's' : ''}` })),
          pill(TIER_LABEL[ev.tier], ev.tier)),
        el('div.small.faint', { style: { marginTop: '7px' }, text: ev.blurb })),

      // ------------------------------------------------------------- venue
      venues.length > 1 ? section('Venue',
        el('div.optlist', {}, ...venues.map((v) => el('button.opt' + (bid.venueKey === v.key ? '.on' : ''), {
          onclick: () => { bid.venueKey = v.key; rerender(); },
        },
          el('span.box', { text: bid.venueKey === v.key ? '✓' : '' }),
          el('span', {}, el('span.t', { text: v.name }),
            el('span.d', { text: `${v.type} · ${fmtNum(v.capacity.total)} · rating ${v.ratings.overall}` })))))) : null,

      // ------------------------------------------------------ requirements
      section('Requirements checked against your venue',
        el('div.card', {},
          el('div.reqlist', {}, ...(check?.lines || []).map(requirementRow)),
          !ok ? el('div.issue.warn', { style: { marginTop: '9px' } },
            el('span.ic', { text: '⚠' }),
            el('span', { text: 'You cannot bid until every requirement is met. Build what is missing and come back.' })) : null)),

      // ------------------------------------------------------- bid amount
      section('Your offer',
        el('div.card', {},
          el('div.rowbetween', {},
            el('span.tiny.faint', { text: 'HOSTING RIGHTS FEE YOU PAY' }),
            el('span.small.mono.gold', { text: fmtMoney(bid.amount) })),
          el('input.input', {
            type: 'range', min: ev.bidRange[0], max: ev.bidRange[1],
            value: bid.amount, step: Math.max(1000, Math.round((ev.bidRange[1] - ev.bidRange[0]) / 120)),
            style: { padding: 0, background: 'none', border: 0, minHeight: 'auto' },
            'aria-label': 'Bid amount',
            oninput: (e) => { bid.amount = +e.target.value; rerender(); },
          }),
          el('div.rowbetween', {},
            el('span.tiny.faint', { text: fmtMoney(ev.bidRange[0]) }),
            el('span.tiny.faint', { text: fmtMoney(ev.bidRange[1]) })))),

      // --------------------------------------------------------- pricing
      section('Ticket pricing',
        el('div.optlist', {}, ...PRICING_TIERS.map((p) => el('button.opt' + (bid.pricing === p.key ? '.on' : ''), {
          onclick: () => { bid.pricing = p.key; rerender(); },
        },
          el('span.box', { text: bid.pricing === p.key ? '✓' : '' }),
          el('span', {}, el('span.t', { text: p.name }),
            el('span.d', { text: p.key === 'value' ? 'Cheaper seats, fuller stadium, happier fans.'
              : p.key === 'premium' ? 'Higher yield per seat, emptier stands, grumpier fans.'
              : 'Standard face value.' })),
          el('span.x', { text: `×${p.mult}` })))),

      // -------------------------------------------------------- packages
      section('Venue package',
        el('div.optlist', {}, ...BID_PACKAGES.map((p) => {
          const on = bid.packages.includes(p.key);
          const backing = p.need && venue ? (venue.ratings.measures[p.need] ?? 0) : 1;
          return el('button.opt' + (on ? '.on' : ''), {
            onclick: () => {
              bid.packages = on ? bid.packages.filter((k) => k !== p.key) : [...bid.packages, p.key];
              rerender();
            },
          },
            el('span.box', { text: on ? '✓' : '' }),
            el('span', {}, el('span.t', { text: p.name }),
              el('span.d', { text: p.desc + (backing < 0.5 ? ' — your venue barely supports this.' : '') })),
            el('span.x', { text: `-${Math.round(p.cost * 100)}% rev` }));
        }))),

      // ----------------------------------------------------------- terms
      section('Contract terms',
        el('div.optlist', {}, ...CONTRACT_TERMS.map((t) => {
          const on = bid.terms.includes(t.key);
          return el('button.opt' + (on ? '.on' : ''), {
            onclick: () => {
              bid.terms = on ? bid.terms.filter((k) => k !== t.key) : [...bid.terms, t.key];
              rerender();
            },
          },
            el('span.box', { text: on ? '✓' : '' }),
            el('span', {}, el('span.t', { text: t.name }), el('span.d', { text: t.desc })),
            el('span.x', { class: t.strength >= 0 ? 'x pos' : 'x neg', text: `${t.strength >= 0 ? '+' : ''}${Math.round(t.strength * 100)}%` }));
        }))),

      // -------------------------------------------------------- strength
      section('Bid strength',
        el('div.card', {},
          el('div.rowbetween', {},
            el('span.big.num', { text: strengthPct + '%' }),
            el('div.right', {},
              el('div.small', { text: `${winPct}% chance to win` }),
              el('div.tiny.faint', { text: `${evaluation?.rivals.length || 0} rival venue${(evaluation?.rivals.length || 0) === 1 ? '' : 's'} bidding` }))),
          meter(strengthPct, 100, strengthPct >= 65 ? 'g' : strengthPct >= 40 ? 'gold' : 'r'),
          el('div', { style: { marginTop: '10px' } },
            ...(evaluation?.components || []).map((c) => el('div.rowbetween', { style: { padding: '2px 0' } },
              el('span.tiny.faint', { text: c.label }),
              el('span', { class: 'tiny mono ' + (c.value >= 0 ? 'pos' : 'neg'), text: `${c.value >= 0 ? '+' : ''}${Math.round(c.value * 100)}` })))),
          (evaluation?.rivals || []).length ? el('div', { style: { marginTop: '10px' } },
            el('div.tiny.faint', { text: 'BIDDING AGAINST' }),
            ...evaluation.rivals.map((r) => el('div.rowbetween', { style: { padding: '2px 0' } },
              el('span.tiny', { text: r.name }),
              el('span.tiny.faint', { text: `${fmtNum(r.capacity)} seats · rep ${Math.round(r.reputation)}` })))) : null)),

      // ------------------------------------------------------ projection
      projection ? section('If you win',
        el('div.card', {},
          el('div.resultline', {}, el('span', { text: 'Projected attendance' }), el('span.v', { text: fmtNum(projection.attendance) })),
          el('div.resultline', {}, el('span', { text: 'Projected revenue' }), el('span.v.pos', { text: fmtMoney(projection.revenue) })),
          el('div.resultline', {}, el('span', { text: 'Projected costs' }), el('span.v.neg', { text: fmtMoney(-projection.costs) })),
          el('div.resultline', {}, el('span', { text: 'Hosting fee' }), el('span.v.neg', { text: fmtMoney(-bid.amount) })),
          el('div.resulttotal', {},
            el('span', { text: 'Projected profit' }),
            el('span', { class: projection.profit >= 0 ? 'pos' : 'neg', text: fmtMoney(projection.profit, { sign: true }) })),
          el('div.tiny.faint', { style: { marginTop: '6px' },
            text: 'A projection in fair weather. Real attendance depends on the day and on how your venue performs.' }))) : null,

      // ---------------------------------------------------------- submit
      el('button.btn.full.primary', {
        style: { marginTop: '6px' },
        disabled: !ok || bid.amount > s.cash || ev.status !== 'open',
        onclick: () => this.submit(ev, bid),
      }, ev.status !== 'open' ? 'This event is closed'
        : !ok ? 'Requirements not met'
        : bid.amount > s.cash ? 'You cannot cover this bid'
        : `Submit bid · ${fmtMoney(bid.amount)}`),
      el('div.tiny.faint', { style: { textAlign: 'center', marginTop: '8px' },
        text: 'The fee is only paid if you win. A stronger bid is never a guarantee.' })));
  }

  submit(ev, bid) {
    // Serious organisers negotiate before they decide.
    const session = this.game.negotiationFor(ev.uid, bid);
    if (session) { this.hud.closeSheet(); this.runNegotiation(ev, bid, session); return; }
    this.finishSubmit(ev, bid);
  }

  finishSubmit(ev, bid) {
    const res = this.game.submitBid(ev.uid, bid);
    if (res.error) { this.app.toast('warn', 'Bid rejected', res.error); return; }
    this.hud.closeSheet();
    this.showBidOutcome(res);
  }

  /**
   * Walk the player through the organiser's demands one round at a time, then
   * submit the bid with whatever was agreed folded into it.
   */
  runNegotiation(ev, bid, session) {
    const step = () => {
      if (!session.active) {
        const outcome = session.result();
        this.showNegotiationSummary(ev, bid, outcome, () => {
          this.finishSubmit(ev, { ...bid, negotiation: outcome });
        });
        return;
      }
      const round = session.current;
      const { round: n, total } = session.progress;
      const options = session.currentOptions();

      this.hud.openModal(el('div', {},
        el('div.hero', { style: { paddingBottom: '6px' } },
          el('div.k', { text: `NEGOTIATION \u00B7 ROUND ${n} OF ${total}` }),
          el('h2', { text: ev.name, style: { fontSize: '19px', marginTop: '4px' } })),
        el('div.card.tight', { style: { marginBottom: '12px' } },
          el('div.tiny.faint', { text: `${ev.organiser} \u00B7 ${round.speaker}`.toUpperCase() }),
          el('div.small', { style: { marginTop: '5px', fontStyle: 'italic' }, text: `\u201C${round.demand}\u201D` })),
        el('div.optlist', {}, ...options.map((o) => el('button.opt', {
          onclick: () => { session.answer(o.key); step(); },
        },
          el('span.box', { text: o.strength >= 0.1 ? '\u2713' : o.strength > 0 ? '\u00B7' : '\u2715' }),
          el('span', {},
            el('span.t', { text: o.label }),
            el('span.d', { text: o.desc }),
            o.warning ? el('span.d', { style: { color: 'var(--red)' }, text: '\u26A0 ' + o.warning }) : null),
          el('span.x', {
            class: 'x ' + (o.strength >= 0 ? 'pos' : 'neg'),
            text: `${o.strength >= 0 ? '+' : ''}${Math.round(o.strength * 100)}`,
          })))),
        el('div.tiny.faint', { style: { marginTop: '10px', textAlign: 'center' },
          text: 'The number is the shift in organiser goodwill. Costs land on event day.' })),
        { dismissable: false });
    };
    step();
  }

  showNegotiationSummary(ev, bid, outcome, onContinue) {
    const line = (label, value, cls) => value
      ? el('div.resultline', {}, el('span', { text: label }), el('span', { class: 'v ' + (cls || ''), text: value }))
      : null;
    this.hud.openModal(el('div', {},
      el('div.hero', { style: { paddingBottom: '6px' } },
        el('div.k', { text: 'TERMS AGREED' }),
        el('h2', { text: ev.name, style: { fontSize: '19px', marginTop: '4px' } })),
      el('div.card.tight', {}, ...outcome.commitments.map((c) =>
        el('div', { style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
          el('div.tiny.faint', { text: c.demand }),
          el('div.small', { text: '\u2192 ' + c.answer })))),
      el('div', { style: { marginTop: '12px' } },
        line('Organiser goodwill', `${outcome.strength >= 0 ? '+' : ''}${Math.round(outcome.strength * 100)}%`,
          outcome.strength >= 0 ? 'pos' : 'neg'),
        line('Extra running cost', outcome.cost ? `${Math.round(outcome.cost * 100)}% of revenue` : '', 'neg'),
        line('Venue fee', outcome.fee ? `${outcome.fee > 0 ? '+' : ''}${Math.round(outcome.fee * 100)}%` : '',
          outcome.fee >= 0 ? 'pos' : 'neg'),
        line('Revenue share', outcome.revenueShare ? `${outcome.revenueShare > 0 ? '+' : ''}${Math.round(outcome.revenueShare * 100)}%` : '',
          outcome.revenueShare >= 0 ? 'pos' : 'neg'),
        line('Extra days', outcome.extraDays ? `+${outcome.extraDays}` : '', 'neg'),
        line('Multi-year deal', outcome.multiYear ? `${outcome.multiYear} years` : '', 'pos'),
        line('Delivery risk', outcome.risk ? `+${Math.round(outcome.risk * 100)}%` : '', 'neg')),
      el('button.btn.full.primary', { style: { marginTop: '14px' }, onclick: onContinue },
        'Submit the bid')), { dismissable: false });
  }

  showBidOutcome(res) {
    const { outcome, evaluation, ev, venue } = res;
    const won = outcome.won;
    const node = el('div', {},
      el('div.hero', {},
        el('div.k', { text: won ? 'BID ACCEPTED' : 'BID UNSUCCESSFUL' }),
        el('div.v', { class: won ? 'v pos' : 'v neg', text: won ? 'WON' : 'LOST' }),
        el('div.s', { text: ev.name })),
      el('div.card.tight', {},
        won
          ? el('div.small', { text: `${ev.organiser} has awarded the event to ${venue.name}. It takes place on day ${ev.eventDay}.` })
          : el('div.small', { text: outcome.winner
              ? `${outcome.winner.name} outbid you${outcome.close ? ' by a narrow margin' : ''}. ${ev.organiser} thanked you for the submission.`
              : `${ev.organiser} decided not to award the event to any of the bidders.` }),
        el('div.tiny.faint', { style: { marginTop: '8px' },
          text: `Your bid strength was ${Math.round(evaluation.strength * 100)}% with a ${Math.round(evaluation.winChance * 100)}% chance of success.` })),
      !won && outcome.close ? el('div.issue.info', {}, el('span.ic', { text: 'ℹ' }),
        el('span', { text: 'That was close. A slightly higher offer or a stronger venue package might have swung it.' })) : null,
      el('button.btn.full.primary', { style: { marginTop: '12px' }, onclick: () => this.hud.closeModal() },
        won ? 'Prepare the venue' : 'Back to the board'));
    this.hud.openModal(node);
  }

  // =============================================================== REPORT
  showReport(report, animate = true) {
    const s = this.state;
    const reduced = s.settings.reducedMotion || !animate;
    const rev = report.revenue;
    const costs = report.costs;

    const attendanceNode = el('div.v.num', { text: '0' });
    const profitNode = el('span', { class: report.profit >= 0 ? 'pos' : 'neg', text: '' });

    const revLines = Object.entries(rev).filter(([, v]) => v)
      .map(([k, v]) => this.animatedLine(LEDGER_CATEGORIES[k] || k, v, reduced, 'pos'));
    const costLines = Object.entries(costs).filter(([, v]) => v)
      .map(([k, v]) => this.animatedLine(COST_LABEL[k] || k, -v, reduced, 'neg'));

    const node = el('div', {},
      el('div.hero', {},
        el('div.k', { text: report.soldOut ? 'SELL-OUT · EVENT COMPLETE' : 'EVENT COMPLETE' }),
        el('h2', { text: report.eventName, style: { fontSize: '20px', margin: '4px 0 10px' } }),
        el('div.k', { text: 'ATTENDANCE' }),
        attendanceNode,
        el('div.s', { text: `of ${fmtNum(report.capacity)} · ${Math.round(report.fill * 100)}% full` }),
        report.turnedAway > 0
          ? el('div.tiny.neg', { style: { marginTop: '4px' }, text: `${fmtNum(report.turnedAway)} fans could not get through the gates in time.` })
          : null),

      el('div', { style: { marginTop: '4px' } },
        el('div.tiny.faint', { text: 'REVENUE' }), ...revLines,
        el('div.resulttotal', {}, el('span', { text: 'Total revenue' }),
          el('span.pos', { text: fmtMoney(report.totalRevenue, { sign: true }) }))),

      el('div', { style: { marginTop: '14px' } },
        el('div.tiny.faint', { text: 'COSTS' }), ...costLines,
        el('div.resulttotal', {}, el('span', { text: 'Total costs' }),
          el('span.neg', { text: fmtMoney(-report.totalCost, { sign: true }) }))),

      el('div.resulttotal', { style: { marginTop: '10px', fontSize: '19px' } },
        el('span', { text: 'PROFIT' }), profitNode),

      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' } },
        el('div.ratingcell', {},
          el('div.k', { text: 'FAN SATISFACTION' }),
          el('div.v.num', { text: report.satisfaction + '%' }),
          meter(report.satisfaction, 100, report.satisfaction >= 75 ? 'g' : report.satisfaction >= 50 ? 'gold' : 'r')),
        el('div.ratingcell', {},
          el('div.k', { text: 'VENUE REPUTATION' }),
          el('div.v.num', { class: report.repDelta.venue >= 0 ? 'v num pos' : 'v num neg',
            text: `${report.repDelta.venue >= 0 ? '+' : ''}${report.repDelta.venue.toFixed(1)}` }),
          el('div.tiny.faint', { text: `now ${Math.round(s.reputation.venue)}` }))),

      report.incidents.length ? el('div', { style: { marginTop: '12px' } },
        el('div.tiny.faint', { text: 'ON THE DAY' }),
        ...report.incidents.map((i) => el('div.issue.' + (i.satisfaction > 0 ? 'good' : 'warn'), {},
          el('span.ic', { text: i.satisfaction > 0 ? '★' : '⚠' }), el('span', { text: i.text })))) : null,

      el('button.btn.full.primary', { style: { marginTop: '14px' }, onclick: () => this.hud.closeModal() }, 'Continue'));

    this.hud.openModal(node);
    animateNumber(attendanceNode, report.attendance, (v) => fmtNum(v), 1100, reduced);
    animateNumber(profitNode, report.profit, (v) => fmtMoney(v, { sign: true }), 1400, reduced);
  }

  animatedLine(label, value, reduced, cls) {
    const v = el('span', { class: 'v ' + cls, text: reduced ? fmtMoney(value, { sign: true }) : '' });
    if (!reduced) animateNumber(v, value, (x) => fmtMoney(x, { sign: true }), 900, false);
    return el('div.resultline', {}, el('span', { text: label }), v);
  }

  // ======================================================== RANDOM EVENTS
  showRandomEvent(def) {
    if (!def) return;
    const node = el('div', {},
      el('div.hero', { style: { paddingBottom: '8px' } },
        el('div.k', { text: 'SITUATION' }),
        el('h2', { text: def.title, style: { fontSize: '22px', marginTop: '4px' } })),
      el('div.small', { style: { marginBottom: '14px' }, text: def.body }),
      el('div.optlist', {}, ...def.options.map((o, i) => el('button.opt', {
        onclick: () => {
          const res = this.game.resolveRandomEvent(i);
          this.hud.closeModal();
          if (res) this.app.toast('info', res.title, res.text);
          this.app.refresh();
        },
      },
        el('span.box', { text: String.fromCharCode(65 + i) }),
        el('span', {}, el('span.t', { text: o.label }),
          o.risk !== undefined ? el('span.d', { text: `Risky — roughly a ${Math.round((1 - o.risk) * 100)}% chance it goes your way.` }) : null),
        o.cost ? el('span.x', { text: fmtMoney(-o.cost) }) : null))));
    this.hud.openModal(node, { dismissable: false });
  }

  // ============================================================== HELPERS
  /** For the venue report: which catalogue events this venue could host. */
  allTemplatesFor(venue) {
    const s = this.state;
    const rng = makeRng(1);
    return EVENT_TEMPLATES.map((t) => {
      const ev = instantiate(t, s, rng);
      const check = checkRequirements(ev, venue, s);
      return { name: t.name, tier: t.tier, blocking: check.blocking };
    }).sort((a, b) => a.blocking - b.blocking || a.name.localeCompare(b.name));
  }
}

const COST_LABEL = {
  staff: 'Event staff', security: 'Security', cleaning: 'Cleaning', utilities: 'Utilities',
  setup: 'Setup & teardown', insurance: 'Insurance', marketing: 'Marketing',
  transport: 'Transport', packages: 'Package commitments', incidents: 'Incident costs',
};

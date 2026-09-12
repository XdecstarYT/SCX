import { el, fill, section, ratingCell, meter, pill, toggleRow, sliderRow, issueRow, emptyState, animateNumber } from './dom.js';
import { fmtMoney, fmtNum, monthlyFinance, LEDGER_CATEGORIES, takeLoan, loanCapacity, repayLoan, MAINTENANCE_RATE } from '../core/economy.js';
import { TIER_LABEL } from '../venues/ratings.js';
import { PROVIDES_LABEL } from '../data/props.js';
import { STAFF_ROLES } from '../data/staff.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { RESEARCH } from '../data/research.js';
import { UTILITIES } from '../data/utilities.js';
import { CITIES, city as cityDef } from '../data/cities.js';
import { ENDGAME_GOALS, GOAL_GROUPS, endgameProgress } from '../data/endgame.js';
import { MOODS } from '../core/community.js';
import { BLOCK_BY_KEY } from '../data/blocks.js';
import { zone as zoneDef } from '../data/zones.js';

/**
 * All the management sheets. Each `openX` builds a fresh DOM tree and hands it
 * to the HUD; there is no virtual DOM, and nothing here caches nodes across
 * opens, which keeps state bugs impossible by construction.
 */
export class Screens {
  constructor(app) {
    this.app = app;
  }
  get game() { return this.app.game; }
  get hud() { return this.app.hud; }
  get state() { return this.app.game.state; }

  // ================================================================== HOME
  openHome() {
    this.hud.openSheet('Complex Overview', this.homeBody(), {
      action: el('button.btn.sm', { onclick: () => this.app.promptRename() }, 'Rename'),
    });
  }

  homeBody() {
    const s = this.state;
    const a = this.game.analysis;
    const v = this.game.primaryVenue;
    const fin = monthlyFinance(s, a);
    const land = this.game.land();

    const objectives = this.objectives();

    return el('div', {},
      el('div.card.accent', {},
        el('div.rowbetween', {},
          el('div', {},
            el('h3', { text: `${s.complexName} Sports Complex` }),
            el('div.sub', { text: `Day ${s.day} · ${land.tier.name} · ${land.tier.label}` })),
          pill(TIER_LABEL[v?.tier || 'none'], v?.tier || 'local')),
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '12px' } },
          this.kpi('Cash', fmtMoney(s.cash), s.cash < 0 ? 'neg' : 'pos'),
          this.kpi('Net / month', fmtMoney(fin.net, { sign: true }), fin.net >= 0 ? 'pos' : 'neg'),
          this.kpi('Capacity', fmtNum(s.derived.bestCapacity), ''))),

      this.constructionCard(),

      objectives.length ? section('Next Objectives',
        el('div.card.tight', {}, ...objectives.map((o) =>
          el('div.rowbetween', { style: { padding: '5px 0' } },
            el('span.small', { text: o.text }),
            o.done ? pill('Done', 'ok') : el('span.tiny.faint', { text: o.hint || '' }))))) : null,

      section('Reputation',
        el('div.card.tight', {}, ...[
          ['Venue prestige', s.reputation.venue],
          ['Fan satisfaction', s.reputation.fans],
          ['Athlete opinion', s.reputation.athletes],
          ['Organiser confidence', s.reputation.organiser],
          ['Community relations', s.reputation.community],
        ].map(([k, val]) => el('div', { style: { padding: '6px 0' } },
          el('div.rowbetween', {}, el('span.small', { text: k }), el('span.small.mono', { text: Math.round(val) })),
          meter(val, 100, val >= 70 ? 'g' : val >= 40 ? '' : 'r'))))),

      section('Venues',
        a.venues.length
          ? el('div.stack', {}, ...a.venues.map((vv) => this.venueCard(vv)))
          : el('div.card', {}, emptyState('▦',
              'No venue detected yet. Lay a sport surface (turf, hardwood, track...), then build seating around it.'))),

      section('Land',
        el('div.card', {},
          el('div.rowbetween', {},
            el('div', {}, el('h3', { text: land.tier.name }), el('div.sub', { text: land.tier.label })),
            land.next
              ? el('button.btn.sm.primary', {
                  disabled: s.cash < land.next.cost,
                  onclick: () => this.app.act(() => this.game.buyLand(), () => this.refreshHome()),
                }, `Expand · ${fmtMoney(land.next.cost)}`)
              : pill('Maximum', 'ok')),
          land.next && el('div.tiny.faint', { style: { marginTop: '8px' },
            text: `Expanding to ${land.next.label} adds buildable ground on two sides. Everything you have built stays put.` }))),

      section('Site Infrastructure', this.infraCard(a)),
    );
  }

  constructionCard() {
    const c = this.game.construction();
    if (!c.count) return null;
    return section('Under Construction', el('div.stack', {}, ...c.projects.map((p) =>
      el('div.card', {},
        el('div.rowbetween', {},
          el('div', {},
            el('h3', { text: p.label }),
            el('div.sub', { text: `${fmtNum(p.placed)} of ${fmtNum(p.total)} blocks \u00B7 ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left` })),
          el('span.small.mono.gold', { text: `${Math.round(p.progress * 100)}%` })),
        el('div', { style: { marginTop: '8px' } }, meter(p.progress * 100, 100, 'gold')),
        el('div.btnrow', { style: { marginTop: '10px' } },
          el('button.btn.sm.primary', {
            onclick: () => {
              const r = this.game.rushConstruction(p.id);
              if (r?.error) this.app.toast('warn', 'Cannot rush', r.error);
              this.app.refresh(); this.refreshHome();
            },
          }, `Rush \u00B7 ${fmtMoney(p.cost * (1 - p.progress) * 0.6)}`),
          el('button.btn.sm.danger', {
            onclick: () => {
              const r = this.game.cancelConstruction(p.id);
              if (r) this.app.toast('info', 'Construction stopped', `${fmtMoney(r.refund)} refunded for the unbuilt remainder.`);
              this.app.refresh(); this.refreshHome();
            },
          }, 'Stop'))))));
  }

  kpi(label, value, cls) {
    return el('div', {},
      el('div.tiny.faint', { text: label.toUpperCase() }),
      el('div', { class: 'big num ' + cls, text: value, style: { fontSize: '19px' } }));
  }

  infraCard(a) {
    const c = a.complex || {};
    const s = this.state;
    const powerCap = s.powerCapacity ?? 15;
    const demand = s.powerDemand || 0;
    const over = demand > powerCap;
    return el('div.card', {},
      el('div.rowbetween', {}, el('span.small', { text: 'Power grid' }),
        el('span.small.mono' + (over ? '.neg' : ''), { text: `${demand.toFixed(1)} / ${powerCap} MW` })),
      meter(Math.min(demand, powerCap), powerCap, over ? 'r' : 'g'),
      over && el('div.issue.error', { style: { marginTop: '8px' } },
        el('span.ic', { text: '⚠' }),
        el('span', { text: 'Power capacity insufficient. Expect equipment failures on event day until you research a Grid Upgrade.' })),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '10px' } },
        this.infraLine('Parking', `${fmtNum(c.parkingCars || 0)} cars`),
        this.infraLine('VIP parking', `${fmtNum(c.vipParkingCars || 0)} cars`),
        this.infraLine('Bus bays', fmtNum(c.busBays || 0)),
        this.infraLine('Transit share', `${Math.round((s.transitShare || 0) * 100)}%`),
        this.infraLine('Road network', `${fmtNum(c.roadVoxels || 0)} blocks`),
        this.infraLine('Floodlights', fmtNum(c.floodlights || 0)),
        this.infraLine('Blocks placed', fmtNum(c.totalBlocks || 0)),
        this.infraLine('Upkeep', `${fmtMoney((c.maintenance || 0) * MAINTENANCE_RATE)}/mo`)));
  }

  infraLine(k, v) {
    return el('div.rowbetween', {}, el('span.tiny.faint', { text: k }), el('span.tiny.mono', { text: v }));
  }

  objectives() {
    const s = this.state;
    const v = this.game.primaryVenue;
    const list = [];
    list.push({ text: 'Lay a regulation sport surface', done: !!(v && v.field.regulation >= 1), hint: 'Zone: Sport Surfaces' });
    list.push({ text: 'Build seating around it', done: !!(v && v.capacity.total >= 500), hint: 'Seating blocks' });
    list.push({ text: 'Add entrances, restrooms and concessions', done: !!(v && v.facilities.entrance > 0 && v.facilities.restroom > 0 && v.facilities.concession > 0), hint: 'Zone mode' });
    list.push({ text: 'Register your venue', done: s.venues.registered.length > 0, hint: 'Venue card' });
    list.push({ text: 'Win an event bid', done: s.stats.bidsWon > 0, hint: 'Events tab' });
    list.push({ text: 'Host your first event', done: s.stats.eventsHosted > 0, hint: 'Let the clock run' });
    const firstUndone = list.findIndex((x) => !x.done);
    if (firstUndone === -1) return [];
    return list.slice(Math.max(0, firstUndone - 1), firstUndone + 2);
  }

  refreshHome() { if (this.hud.sheetOpen) this.hud.updateSheetBody(this.homeBody()); }

  // ================================================================ VENUES
  venueCard(v) {
    const issues = v.ratings.issues.slice(0, 3);
    return el('div.card' + (v.registered ? '.good' : ''), {},
      el('div.rowbetween', {},
        el('div', {},
          el('h3', { text: v.name }),
          el('div.sub', { text: `${v.type} · ${fmtNum(v.capacity.total)} capacity` })),
        pill(TIER_LABEL[v.tier], v.tier)),

      el('div', { style: { display: 'flex', gap: '14px', margin: '11px 0 9px', alignItems: 'baseline' } },
        el('div', {}, el('div.big.num', { text: String(v.ratings.overall) }), el('div.tiny.faint', { text: 'VENUE RATING' })),
        el('div', { style: { flex: 1 } }, meter(v.ratings.overall, 100, v.ratings.overall >= 70 ? 'g' : v.ratings.overall >= 45 ? 'gold' : 'r'))),

      el('div.ratinggrid', {},
        ratingCell('Functionality', v.ratings.functionality),
        ratingCell('Crowd Flow', v.ratings.crowdFlow),
        ratingCell('Safety', v.ratings.safety),
        ratingCell('Comfort', v.ratings.comfort),
        ratingCell('Accessibility', v.ratings.accessibility),
        ratingCell('Appearance', v.ratings.appearance),
        ratingCell('Prestige', v.ratings.prestige)),

      el('div', { style: { marginTop: '11px' } },
        el('div.tiny.faint', { text: 'PITCH & FACILITIES', style: { marginBottom: '5px' } }),
        el('div.small', { text: v.field
          ? `${v.sportName}: ${v.field.w * 2}m × ${v.field.d * 2}m ${v.field.regulation >= 1 ? '(regulation)' : '(below regulation)'}`
          : 'No sport surface' }),
        el('div.tiny.faint', { text: `Seated ${fmtNum(v.capacity.seated)} · VIP ${fmtNum(v.capacity.vip)} · Standing ${fmtNum(v.capacity.standing)} · Parking ${fmtNum(v.parkingCars)} cars · ${v.indoor ? 'Indoor' : 'Open air'}` }),
        el('div.tiny' + ((v.equipmentScore ?? 0) >= 0.999 ? '.faint' : '.gold'), {
          style: { marginTop: '3px' }, text: equipmentLine(v),
        })),

      issues.length ? el('div', { style: { marginTop: '10px' } }, ...issues.map(issueRow)) : null,

      el('div.btnrow', { style: { marginTop: '11px' } },
        el('button.btn.sm', { onclick: () => this.openVenueDetail(v.key) }, 'Full report'),
        el('button.btn.sm', { onclick: () => this.app.flyToVenue(v) }, 'Show me'),
        v.registered
          ? el('button.btn.sm', { onclick: () => this.app.promptRenameVenue(v) }, 'Rename')
          : el('button.btn.sm.go', {
              disabled: v.tier === 'none',
              title: v.tier === 'none' ? 'Fix the blocking issues first' : 'Open this venue for event bidding',
              onclick: () => this.app.promptRegister(v),
            }, 'Register venue')));
  }

  openVenueDetail(key) {
    const render = () => {
      const v = this.game.analysis.venues.find((x) => x.key === key);
      if (!v) return emptyState('✕', 'That venue no longer exists.');
      const good = v.ratings.strengths.map((s) => issueRow({ severity: 'good', text: s.text }));
      return el('div', {},
        this.venueCard(v),
        section('Design feedback',
          el('div.card', {},
            v.ratings.issues.length
              ? el('div', {}, ...v.ratings.issues.map(issueRow))
              : el('div.small.faint', { text: 'No outstanding issues. This venue is in good shape.' }),
            good.length ? el('div', { style: { marginTop: '8px' } }, ...good) : null)),
        section('What this venue could host', this.suitabilityCard(v)));
    };
    this.hud.openSheet('Venue Report', render());
  }

  suitabilityCard(v) {
    const s = this.state;
    const rows = this.app.eventsUi.allTemplatesFor(v);
    return el('div.card', {}, ...rows.map((r) =>
      el('div.rowbetween', { style: { padding: '6px 0', borderBottom: '1px solid var(--line)' } },
        el('div', {}, el('div.small', { text: r.name }), el('div.tiny.faint', { text: TIER_LABEL[r.tier] })),
        r.blocking === 0 ? pill('Eligible', 'ok') : el('span.tiny.faint', { text: `${r.blocking} requirement${r.blocking > 1 ? 's' : ''} short` }))));
  }

  // =============================================================== FINANCE
  openFinance() {
    const tabs = ['Summary', 'Ledger', 'Loans'];
    let active = 'Summary';
    const tabBar = el('div.tabs');
    const render = () => {
      fill(tabBar, ...tabs.map((t) => el('button.tab' + (t === active ? '.on' : ''), {
        onclick: () => { active = t; render(); },
      }, t)));
      const body = active === 'Summary' ? this.financeSummary()
        : active === 'Ledger' ? this.financeLedger()
        : this.financeLoans(render);
      if (this.hud.sheetOpen) this.hud.updateSheetBody(body);
      else this.hud.openSheet('Finance', body, { tabs: tabBar });
    };
    render();
  }

  financeSummary() {
    const s = this.state;
    const fin = monthlyFinance(s, this.game.analysis);
    const hist = s.events.history.slice(0, 6);
    const line = (k, v, cls) => el('div.resultline', {},
      el('span', { text: LEDGER_CATEGORIES[k] || k }), el('span', { class: 'v ' + cls, text: fmtMoney(v, { sign: true }) }));

    return el('div', {},
      el('div.card.accent', {},
        el('div.tiny.faint', { text: 'CASH ON HAND' }),
        el('div.big.num', { class: s.cash < 0 ? 'big num neg' : 'big num pos', text: fmtMoney(s.cash) }),
        el('div.small.faint', { text: `Lifetime profit ${fmtMoney(s.stats.lifetimeProfit, { sign: true })} across ${s.stats.eventsHosted} events` })),

      section('Recurring monthly',
        el('div.card', {},
          ...Object.entries(fin.income).filter(([, v]) => v).map(([k, v]) => line(k, v, 'pos')),
          ...Object.entries(fin.expense).filter(([, v]) => v).map(([k, v]) => line(k, -v, 'neg')),
          el('div.resulttotal', {},
            el('span', { text: 'Net per month' }),
            el('span', { class: fin.net >= 0 ? 'pos' : 'neg', text: fmtMoney(fin.net, { sign: true }) })))),

      section('Recent events',
        hist.length
          ? el('div.stack', {}, ...hist.map((r) => el('div.card.tight', {},
              el('div.rowbetween', {},
                el('div', {}, el('div.small', { text: r.eventName }),
                  el('div.tiny.faint', { text: `Day ${r.day} · ${fmtNum(r.attendance)} attended · ${r.satisfaction}% satisfied` })),
                el('span', { class: 'small mono ' + (r.profit >= 0 ? 'pos' : 'neg'), text: fmtMoney(r.profit, { sign: true }) })),
              el('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => this.app.eventsUi.showReport(r, false) }, 'View report'))))
          : el('div.card', {}, emptyState('⚑', 'No events hosted yet.'))));
  }

  financeLedger() {
    const s = this.state;
    if (!s.finance.ledger.length) return el('div.card', {}, emptyState('◴', 'No transactions yet.'));
    return el('div.card', {}, ...s.finance.ledger.slice(0, 90).map((t) =>
      el('div.resultline', {},
        el('span', {}, el('span.tiny.faint', { text: `D${t.day} ` }),
          LEDGER_CATEGORIES[t.category] || t.category),
        el('span', { class: 'v ' + (t.amount >= 0 ? 'pos' : 'neg'), text: fmtMoney(t.amount, { sign: true }) }))));
  }

  financeLoans(rerender) {
    const s = this.state;
    const cap = loanCapacity(s, this.game.analysis);
    let amount = Math.min(cap, 2_000_000);
    const amtLabel = el('span.small.mono', { text: fmtMoney(amount) });

    return el('div', {},
      el('div.card', {},
        el('h3', { text: 'Borrowing capacity' }),
        el('div.sub', { text: 'Secured against the assessed value of your complex.' }),
        el('div.big.num.gold', { text: fmtMoney(cap), style: { marginTop: '6px' } }),
        cap > 0 ? el('div', { style: { marginTop: '10px' } },
          el('div.rowbetween', {}, el('span.tiny.faint', { text: 'AMOUNT' }), amtLabel),
          el('input.input', {
            type: 'range', min: 100000, max: cap, value: amount, step: 100000,
            style: { padding: 0, background: 'none', border: 0, minHeight: 'auto' },
            oninput: (e) => { amount = +e.target.value; amtLabel.textContent = fmtMoney(amount); },
          }),
          el('button.btn.full.primary', {
            onclick: () => {
              const rate = takeLoan(s, amount);
              s.cash += amount;
              this.game.record('loan', amount);
              this.app.toast('info', 'Loan approved', `${fmtMoney(amount)} at ${(rate * 100).toFixed(2)}% APR.`);
              this.app.refresh(); rerender();
            },
          }, 'Take loan')) : el('div.small.faint', { style: { marginTop: '8px' }, text: 'Build more to unlock borrowing.' })),

      section('Outstanding loans',
        s.loans.length
          ? el('div.stack', {}, ...s.loans.map((l) => el('div.card.tight', {},
              el('div.rowbetween', {},
                el('div', {}, el('div.small', { text: fmtMoney(l.balance) + ' outstanding' }),
                  el('div.tiny.faint', { text: `${(l.rate * 100).toFixed(2)}% APR · ${l.years}-year term` })),
                el('button.btn.sm', {
                  disabled: s.cash < Math.min(l.balance, 250000),
                  onclick: () => {
                    const pay = Math.min(l.balance, Math.max(250000, l.balance * 0.25), s.cash);
                    repayLoan(s, l.id, pay);
                    s.cash -= pay;
                    this.game.record('loan', -pay);
                    this.app.refresh(); rerender();
                  },
                }, 'Repay')))))
          : el('div.card', {}, emptyState('✓', 'Debt free.'))));
  }

  // ================================================================== MORE
  openMore(initial = 'Staff') {
    const tabs = ['Empire', 'Staff', 'Sponsors', 'Research', 'Infra', 'Rivals', 'Community', 'Goals', 'Awards', 'Settings'];
    let active = tabs.includes(initial) ? initial : 'Empire';
    const tabBar = el('div.tabs');
    const render = () => {
      fill(tabBar, ...tabs.map((t) => el('button.tab' + (t === active ? '.on' : ''), {
        onclick: () => { active = t; render(); },
      }, t)));
      const body = active === 'Empire' ? this.empireBody(render)
        : active === 'Staff' ? this.staffBody(render)
        : active === 'Sponsors' ? this.sponsorsBody(render)
        : active === 'Research' ? this.researchBody(render)
        : active === 'Infra' ? this.infrastructureBody(render)
        : active === 'Rivals' ? this.rivalsBody()
        : active === 'Community' ? this.communityBody()
        : active === 'Goals' ? this.goalsBody()
        : active === 'Awards' ? this.awardsBody()
        : this.settingsBody(render);
      if (this.hud.sheetOpen) this.hud.updateSheetBody(body);
      else this.hud.openSheet('Management', body, { tabs: tabBar });
    };
    render();
  }

  // ================================================================ EMPIRE
  empireBody(rerender) {
    const s = this.state;
    const e = this.game.empire();
    const owned = new Set(s.sites.map((x) => x.cityId));
    const available = CITIES.filter((c) => !owned.has(c.id));

    return el('div', {},
      el('div.card.accent', {},
        el('div.rowbetween', {},
          el('div', {},
            el('h3', { text: `${s.complexName} Group` }),
            el('div.sub', { text: `${e.sites.length} site${e.sites.length > 1 ? 's' : ''} \u00B7 ${e.totalVenues} venue${e.totalVenues === 1 ? '' : 's'} \u00B7 ${fmtNum(e.totalBlocks)} blocks placed` })),
          pill(`${e.totalRegistered} registered`, e.totalRegistered ? 'ok' : '')),
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' } },
          this.kpi('Total capacity', fmtNum(e.totalCapacity), ''),
          this.kpi('Cash', fmtMoney(s.cash), s.cash < 0 ? 'neg' : 'pos'))),

      section('Your sites', el('div.stack', {}, ...e.sites.map((site) => el('div.card' + (site.active ? '.accent' : ''), {},
        el('div.rowbetween', {},
          el('div', {},
            el('h3', { text: site.name }),
            el('div.sub', { text: `${site.city.name} \u00B7 ${site.city.region} \u00B7 ${site.land.tier.label}` })),
          site.active ? pill('You are here', 'ok') : null),

        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '10px' } },
          this.infraLine('Venues', `${site.venues.length} (${site.registered} live)`),
          this.infraLine('Capacity', fmtNum(site.capacity)),
          this.infraLine('Best rating', site.bestRating || '\u2014')),

        site.utilityShort
          ? el('div.issue.warn', { style: { marginTop: '9px' } },
              el('span.ic', { text: '\u26A0' }),
              el('span', { text: `${site.utilityShort} utility network${site.utilityShort > 1 ? 's' : ''} over capacity here.` }))
          : null,

        el('div.tiny.faint', { style: { marginTop: '8px' }, text: site.city.desc }),

        el('div.btnrow', { style: { marginTop: '10px' } },
          site.active
            ? el('button.btn.sm', { disabled: true }, 'Current site')
            : el('button.btn.sm.primary', {
                onclick: () => { this.app.travelTo(site.id); },
              }, 'Travel here'),
          el('button.btn.sm', { onclick: () => this.app.promptRenameSite(site) }, 'Rename')))))),

      section('Expand into a new city',
        s.reputation.venue < 55
          ? el('div.card', {}, emptyState('\u2302',
              `Operators need a reputation of 55 before another city will sell them land. You are on ${Math.round(s.reputation.venue)}.`))
          : el('div.stack', {}, ...available.map((c) => el('div.card', {},
              el('div.rowbetween', {},
                el('div', {}, el('h3', { text: c.name }), el('div.sub', { text: c.region })),
                el('div.right', {},
                  el('div.small.mono.gold', { text: fmtMoney(c.buyCost) }),
                  el('div.tiny.faint', { text: `land \u00D7${c.landCost} \u00B7 crowds \u00D7${c.audience}` }))),
              el('div.small.faint', { style: { marginTop: '7px' }, text: c.desc }),
              el('button.btn.sm.full', {
                style: { marginTop: '9px' },
                disabled: s.cash < c.buyCost,
                onclick: () => {
                  const r = this.game.buySite(c.id);
                  if (r?.error) this.app.toast('warn', 'Cannot expand', r.error);
                  else this.app.toast('info', `Land bought in ${c.name}`, 'Travel there to start building.');
                  this.app.refresh(); rerender();
                },
              }, `Buy land in ${c.name}`))))),

      available.length === 0
        ? el('div.card.good', {}, emptyState('\u2713', 'You operate in every city there is.'))
        : null);
  }

  staffBody(rerender) {
    const s = this.state;
    const payroll = s.staff.reduce((a, h) => a + h.salary, 0);
    const cands = this.game.candidates(4).filter((c) => !s.staff.some((h) => h.roleId === c.role.id));

    return el('div', {},
      el('div.card.accent', {},
        el('div.rowbetween', {},
          el('div', {}, el('h3', { text: `${s.staff.length} on the payroll` }),
            el('div.sub', { text: `${fmtMoney(payroll)} per month` })),
          el('div.right', {},
            ...Object.entries(s.staffBonus).filter(([, v]) => v > 0.01).slice(0, 3).map(([k, v]) =>
              el('div.tiny.faint', { text: `${k} +${Math.round(v * 100)}%` }))))),

      section('Your team',
        s.staff.length
          ? el('div.stack', {}, ...s.staff.map((h) => {
              const role = STAFF_ROLES.find((r) => r.id === h.roleId);
              return el('div.card.tight', {},
                el('div.rowbetween', {},
                  el('div', {}, el('div.small', { text: `${h.name}` }),
                    el('div.tiny.faint', { text: `${role?.name || h.roleId} · skill ${h.skill} · ${Math.round(h.experience)}y exp` })),
                  el('div.right', {}, el('div.small.mono', { text: fmtMoney(h.salary) + '/mo' }),
                    el('button.btn.sm.danger', { style: { marginTop: '4px' }, onclick: () => { this.game.fire(h.uid); this.app.refresh(); rerender(); } }, 'Release'))),
                el('div', { style: { marginTop: '6px' } },
                  el('div.rowbetween', {}, el('span.tiny.faint', { text: 'MORALE' }), el('span.tiny.mono', { text: Math.round(h.morale) + '%' })),
                  meter(h.morale, 100, h.morale > 60 ? 'g' : h.morale > 30 ? 'gold' : 'r')));
            }))
          : el('div.card', {}, emptyState('☷', 'No staff yet. Good staff make every other system better.'))),

      section('Available candidates',
        el('div.stack', {}, ...cands.map(({ role, hire }) =>
          el('div.card.tight', {},
            el('div.rowbetween', {},
              el('div', {}, el('div.small', { text: `${hire.name} — ${role.name}` }),
                el('div.tiny.faint', { text: role.desc })),
              el('div.right', {},
                el('div.small.mono.gold', { text: fmtMoney(hire.salary) + '/mo' }),
                el('div.tiny.faint', { text: `skill ${hire.skill}` }))),
            el('button.btn.sm.full', {
              style: { marginTop: '8px' },
              disabled: this.state.cash < hire.salary * 0.5,
              onclick: () => {
                const r = this.game.hire(role.id, hire);
                if (r?.error) this.app.toast('warn', 'Cannot hire', r.error);
                else this.app.toast('info', 'Hired', `${hire.name} joins as ${role.name}.`);
                this.app.refresh(); rerender();
              },
            }, `Hire · signing fee ${fmtMoney(hire.salary * 0.5)}`))))));
  }

  sponsorsBody(rerender) {
    const s = this.state;
    const offers = this.game.sponsorOffers();
    return el('div', {},
      section('Active deals',
        s.sponsors.length
          ? el('div.stack', {}, ...s.sponsors.map((sp) => el('div.card.tight.good', {},
              el('div.rowbetween', {},
                el('div', {}, el('div.small', { text: sp.name }), el('div.tiny.faint', { text: sp.sector })),
                el('span.small.mono.pos', { text: fmtMoney(sp.annual) + '/yr' })),
              el('div.tiny.faint', { style: { marginTop: '5px' }, text: sp.bonus }))))
          : el('div.card', {}, emptyState('◇', 'No sponsors yet. Raise reputation and capacity to attract them.'))),

      s.sponsorLocked ? el('div.issue.warn', {}, el('span.ic', { text: '⚠' }),
        el('span', { text: 'An exclusivity agreement is blocking new sponsorship deals.' })) : null,

      section('Offers on the table',
        offers.length
          ? el('div.stack', {}, ...offers.map((sp) => el('div.card', {},
              el('div.rowbetween', {},
                el('div', {}, el('h3', { text: sp.name }), el('div.sub', { text: `${sp.sector} · ${sp.years}-year contract` })),
                el('div.right', {}, el('div.small.mono.gold', { text: fmtMoney(sp.annual) + '/yr' }),
                  el('div.tiny.faint', { text: fmtMoney(sp.perEvent) + ' per event' }))),
              sp.scope ? el('div.tiny.faint', { style: { marginTop: '4px' }, text: sp.scope }) : null,
              el('div.small', { style: { marginTop: '8px' }, text: sp.bonus }),
              sp.community ? el('div', {
                class: sp.community > 0 ? 'tiny pos' : 'tiny neg',
                style: { marginTop: '4px' },
                text: `Community reputation ${sp.community > 0 ? '+' : ''}${sp.community}`,
              }) : null,
              el('button.btn.sm.full.gold', {
                style: { marginTop: '9px' },
                onclick: () => {
                  const r = this.game.signSponsor(sp.id);
                  if (r?.error) this.app.toast('warn', 'Cannot sign', r.error);
                  this.app.refresh(); rerender();
                },
              }, 'Sign deal'))))
          : el('div.card', {}, emptyState('…',
              `No offers yet. Sponsors want reputation ${SPONSOR_NEXT(s)} and a bigger venue.`))));
  }

  /** Deals the player has earned but cannot host yet, and what is missing. */
  blockedSponsorsCard() {
    const blocked = this.game.sponsorsBlocked();
    if (!blocked.length) return null;
    return section('Interested, but waiting on you',
      el('div.stack', {}, ...blocked.map((sp) => el('div.card.tight', {},
        el('div.rowbetween', {},
          el('div', {},
            el('div.small', { text: sp.name }),
            el('div.tiny.faint', { text: sp.scope || sp.sector })),
          el('span.small.mono.faint', { text: fmtMoney(sp.annual) + '/yr' })),
        el('div.issue.info', { style: { marginTop: '7px' } },
          el('span.ic', { text: '\u2139' }),
          el('span', {
            text: sp.needsZone
              ? `Wants at least ${sp.needsVoxels} blocks zoned as ${zoneName(sp.needsZone)} before they will put their name on it.`
              : `Wants at least ${sp.needsVoxels} ${sp.needsBlock} blocks on site.`,
          }))))));
  }

  researchBody(rerender) {
    const s = this.state;
    const active = s.research.active;
    const opts = this.game.researchOptions();
    const done = RESEARCH.filter((r) => s.research.completed.includes(r.id));

    return el('div', {},
      active ? el('div.card.accent', {},
        el('h3', { text: RESEARCH.find((r) => r.id === active.id)?.name }),
        el('div.sub', { text: `${active.daysLeft} days remaining` }),
        el('div', { style: { marginTop: '8px' } },
          meter(active.totalDays - active.daysLeft, active.totalDays, 'g'))) : null,

      section('Available projects',
        opts.length
          ? el('div.stack', {}, ...opts.map((r) => el('div.card', {},
              el('div.rowbetween', {},
                el('div', {}, el('h3', { text: r.name }), el('div.sub', { text: r.desc })),
                el('div.right', {}, el('div.small.mono.gold', { text: fmtMoney(r.cost) }),
                  el('div.tiny.faint', { text: `${r.days} days` }))),
              r.unlocks ? el('div.tiny.faint', { style: { marginTop: '6px' },
                text: 'Unlocks: ' + r.unlocks.map((u) => BLOCK_BY_KEY.get(u)?.name || u).join(', ') }) : null,
              el('button.btn.sm.full', {
                style: { marginTop: '9px' },
                disabled: !!active || s.cash < r.cost,
                onclick: () => {
                  const res = this.game.startResearch(r.id);
                  if (res?.error) this.app.toast('warn', 'Cannot start', res.error);
                  this.app.refresh(); rerender();
                },
              }, active ? 'Another project is running' : 'Start project'))))
          : el('div.card', {}, emptyState('⚙', 'Raise your venue reputation to unlock research.'))),

      done.length ? section('Completed',
        el('div.card.tight', {}, ...done.map((r) => el('div.rowbetween', { style: { padding: '4px 0' } },
          el('span.small', { text: r.name }), pill('Done', 'ok'))))) : null);
  }

  // ======================================================== INFRASTRUCTURE
  infrastructureBody(rerender) {
    const s = this.state;
    const site = this.game.site;
    const options = this.game.utilityOptions();
    const short = options.filter((u) => u.status.deficit > 0);

    return el('div', {},
      s.sites.length > 1
        ? el('div.card.tight', {},
            el('div.rowbetween', {},
              el('span.small', { text: `Networks at ${site.name}` }),
              el('span.tiny.faint', { text: cityDef(site.cityId).name })),
            el('div.tiny.faint', { style: { marginTop: '4px' },
              text: 'Each site has its own connections. Travel to another site from the Empire tab to manage its networks.' }))
        : null,
      short.length
        ? el('div.card.bad', {},
            el('h3', { text: `${short.length} network${short.length > 1 ? 's' : ''} over capacity` }),
            el('div.sub', { text: 'Demand is read from what you have built. A shortfall degrades the thing it serves and causes failures on event day.' }))
        : el('div.card.good', {},
            el('h3', { text: 'All networks within capacity' }),
            el('div.sub', { text: 'Nothing here is holding your venues back.' })),

      section('Networks', el('div.stack', {}, ...options.map((u) => {
        const st = u.status;
        const over = st.deficit > 0;
        const pctUsed = st.capacity > 0 ? (st.demand / st.capacity) * 100 : 0;
        return el('div.card' + (over ? '.bad' : ''), {},
          el('div.rowbetween', {},
            el('div', {},
              el('h3', { text: `${u.icon} ${u.name}` }),
              el('div.sub', { text: u.desc })),
            el('div.right', {},
              el('div.small.mono' + (over ? '.neg' : ''), {
                text: `${fmtUnit(st.demand)} / ${fmtUnit(st.capacity)} ${u.unit}`,
              }),
              el('div.tiny.faint', { text: u.tier < 0 ? 'Site connection' : `Tier ${u.tier + 1}` }))),
          el('div', { style: { marginTop: '8px' } },
            meter(Math.min(st.demand, st.capacity), Math.max(st.capacity, st.demand),
              over ? 'r' : pctUsed > 80 ? 'gold' : 'g')),
          over ? el('div.issue.error', { style: { marginTop: '8px' } },
            el('span.ic', { text: '\u26A0' }),
            el('span', { text: `${Math.round((1 - st.factor) * 100)}% short. ${u.shortfall}` })) : null,
          u.next
            ? el('button.btn.sm.full' + (over ? '.primary' : ''), {
                style: { marginTop: '9px' },
                disabled: s.cash < u.next.cost,
                onclick: () => {
                  const r = this.game.upgradeUtility(u.key);
                  if (r?.error) this.app.toast('warn', 'Cannot upgrade', r.error);
                  this.app.refresh(); rerender();
                },
              }, `Upgrade to ${fmtUnit(u.next.capacity)}${u.unit} \u00B7 ${fmtMoney(u.next.cost)} + ${fmtMoney(u.next.upkeep)}/mo`)
            : el('div.tiny.faint', { style: { marginTop: '8px', textAlign: 'center' }, text: 'Maximum capacity reached.' }));
      }))),

      section('Transport network', this.transportCard()));
  }

  transportCard() {
    const c = this.game.analysis.complex || {};
    const roads = c.roads || {};
    const rows = [
      ['Local road', roads.road || 0],
      ['Main road', roads.road_main || 0],
      ['Service road', roads.road_service || 0],
      ['VIP access road', roads.road_vip || 0],
      ['Emergency route', roads.road_emergency || 0],
      ['Bus lane', roads.road_bus || 0],
    ];
    return el('div.card', {},
      el('div.rowbetween', {},
        el('span.small', { text: 'Road service to your parking' }),
        el('span.small.mono', { text: `${Math.round((c.roadServiceRatio ?? 1) * 100)}%` })),
      meter((c.roadServiceRatio ?? 1) * 100, 100, (c.roadServiceRatio ?? 1) > 0.8 ? 'g' : 'gold'),
      el('div.tiny.faint', { style: { marginTop: '6px' },
        text: 'Main roads carry well over twice the traffic of a local road of the same length.' }),
      el('div', { style: { marginTop: '10px' } }, ...rows.map(([k, v]) =>
        el('div.rowbetween', { style: { padding: '3px 0' } },
          el('span.tiny.faint', { text: k }),
          el('span.tiny.mono', { text: v ? `${fmtNum(v)} blocks` : '\u2014' })))),
      el('div', { style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--line)' } },
        ...[
          ['Public transport share', `${Math.round((this.state.transitShare || 0) * 100)}%`],
          ['Coach bays', fmtNum(c.busBays || 0)],
          ['Taxi / rideshare bays', fmtNum(c.taxiBays || 0)],
          ['Staff parking', `${fmtNum(c.staffParkingCars || 0)} cars`],
          ['VIP parking', `${fmtNum(c.vipParkingCars || 0)} cars`],
        ].map(([k, v]) => el('div.rowbetween', { style: { padding: '3px 0' } },
          el('span.tiny.faint', { text: k }), el('span.tiny.mono', { text: v })))));
  }

  // ================================================================ RIVALS
  rivalsBody() {
    const standings = this.game.standings();
    const you = standings.find((r) => r.you);
    return el('div', {},
      el('div.card.accent', {},
        el('div.tiny.faint', { text: 'YOUR POSITION' }),
        el('div.big.num', { text: `#${you.rank} of ${standings.length}` }),
        el('div.small.faint', { text: 'Ranked on reputation, venue quality and capacity. Rivals reinvest over time, so standing still means sliding.' })),

      section('Operators', el('div.stack', {}, ...standings.map((r) => el('div.card' + (r.you ? '.accent' : ''), {},
        el('div.rowbetween', {},
          el('div', {},
            el('h3', { text: `${r.rank}. ${r.name}` }),
            el('div.sub', { text: r.you ? 'You' : `${fmtNum(Math.round(r.capacity))} seats \u00B7 ${r.eventsWon} events won` })),
          el('div.right', {},
            el('div.small.mono', { text: `Rep ${Math.round(r.reputation)}` }),
            el('div.tiny.faint', { text: `Quality ${Math.round(r.quality)}` }))),
        el('div', { style: { marginTop: '8px' } }, meter(r.reputation, 100, r.you ? 'g' : '')),
        !r.you && r.sports?.length
          ? el('div.tiny.faint', { style: { marginTop: '6px' }, text: 'Competes for: ' + r.sports.join(', ') })
          : null,
        r.news?.length
          ? el('div', { style: { marginTop: '8px', paddingTop: '7px', borderTop: '1px solid var(--line)' } },
              ...r.news.slice(0, 3).map((n) => el('div.tiny.faint', { text: `Day ${n.day}: ${n.text}` })))
          : null)))));
  }

  // ============================================================= COMMUNITY
  communityBody() {
    const r = this.game.community();
    const s = this.state;
    const row = (item, positive) => el('div.rowbetween', { style: { padding: '5px 0' } },
      el('div', {},
        el('div.small', { text: item.label }),
        el('div.tiny.faint', { text: item.money ? fmtMoney(item.value) + ' per month' : String(item.value) })),
      el('span', {
        class: 'small mono ' + (positive ? 'pos' : 'neg'),
        text: `${positive ? '+' : ''}${Math.round(item.score)}`,
      }));

    return el('div', {},
      el('div.card.accent', {},
        el('div.rowbetween', {},
          el('div', {},
            el('div.tiny.faint', { text: 'COMMUNITY STANDING' }),
            el('div.big.num', { text: String(r.current) })),
          el('div.right', {},
            pill(r.mood.label, r.mood.tone === 'good' ? 'ok' : r.mood.tone === 'error' ? 'no' : ''),
            el('div.tiny.faint', { style: { marginTop: '4px' },
              text: r.target === r.current ? 'settled'
                : r.target > r.current ? `rising toward ${r.target}` : `falling toward ${r.target}` }))),
        meter(r.current, 100, r.current >= 65 ? 'g' : r.current >= 40 ? 'gold' : 'r'),
        el('div.tiny.faint', { style: { marginTop: '8px' },
          text: 'Standing drifts toward what the complex has earned rather than jumping, so one bad day will not undo years of goodwill.' })),

      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '14px' } },
        this.kpi('Jobs', fmtNum(r.jobs), 'pos'),
        this.kpi('Visitors / mo', fmtNum(r.tourism), 'pos'),
        this.kpi('Local spend', fmtMoney(r.economicBoost), 'pos')),

      section('What is helping',
        r.positives.length
          ? el('div.card.tight', {}, ...r.positives.map((p) => row(p, true)))
          : el('div.card', {}, emptyState('\u2014', 'Nothing yet. Jobs, visitors and public facilities all build goodwill.'))),

      section('What is hurting',
        r.negatives.length
          ? el('div.card.tight', {}, ...r.negatives.map((n) => row(n, false)))
          : el('div.card', {}, emptyState('\u2713', 'No complaints. Traffic, noise and congestion are all under control.'))),

      section('How to improve it', el('div.card', {},
        el('div.small.faint', { text: 'Parking and transport reduce traffic on residential streets. Training areas and fan zones are facilities the public can use. Local and regional events keep the complex part of the community rather than a place things happen to it.' }))));
  }

  // ================================================================= GOALS
  goalsBody() {
    const p = endgameProgress(this.state);
    return el('div', {},
      el('div.card.accent', {},
        el('div.tiny.faint', { text: 'LONG-TERM OBJECTIVES' }),
        el('div.big.num', { text: `${p.complete} / ${p.total}` }),
        meter(p.overall * 100, 100, 'gold'),
        el('div.small.faint', { style: { marginTop: '8px' },
          text: p.complete === p.total
            ? 'All of them. There is nothing left on this list, which only means the list has run out.'
            : 'None of these arrive by waiting. Each one needs something built, operated or won.' })),
      ...GOAL_GROUPS.map((g) => section(g.name,
        el('div.stack', {}, ...p.goals.filter((x) => x.tier === g.key).map((goal) =>
          el('div.card.tight' + (goal.complete ? '.good' : ''), {},
            el('div.rowbetween', {},
              el('div', {},
                el('div.small', { text: goal.name }),
                el('div.tiny.faint', { text: goal.desc })),
              goal.complete ? pill('Done', 'ok') : el('span.small.mono', { text: `${Math.round(goal.value * 100)}%` })),
            el('div', { style: { marginTop: '7px' } },
              meter(goal.value * 100, 100, goal.complete ? 'g' : goal.value > 0.5 ? 'gold' : '')),
            el('div.tiny.faint', { style: { marginTop: '5px' }, text: goal.detail })))))));
  }

  awardsBody() {
    const s = this.state;
    const got = new Set(s.achievements);
    return el('div', {},
      el('div.card.accent', {},
        el('div.tiny.faint', { text: 'ACHIEVEMENTS' }),
        el('div.big.num', { text: `${got.size} / ${ACHIEVEMENTS.length}` }),
        meter(got.size, ACHIEVEMENTS.length, 'gold')),
      section('Statistics', el('div.card.tight', {},
        ...[
          ['Blocks placed', fmtNum(s.stats.blocksPlaced)],
          ['Blocks removed', fmtNum(s.stats.blocksRemoved)],
          ['Spent on construction', fmtMoney(s.stats.moneySpentBuilding)],
          ['Bids placed', `${s.stats.bidsPlaced} (${s.stats.bidsWon} won)`],
          ['Events hosted', fmtNum(s.stats.eventsHosted)],
          ['Total attendance', fmtNum(s.stats.totalAttendance)],
          ['Sell-outs', fmtNum(s.stats.sellouts)],
          ['Lifetime revenue', fmtMoney(s.stats.lifetimeRevenue)],
          ['Best venue rating', String(s.stats.bestRating)],
        ].map(([k, v]) => el('div.rowbetween', { style: { padding: '4px 0' } },
          el('span.small.faint', { text: k }), el('span.small.mono', { text: v }))))),
      section('Awards', el('div.stack', {}, ...ACHIEVEMENTS.map((a) => {
        const has = got.has(a.id);
        return el('div.card.tight' + (has ? '.good' : ''), { style: has ? {} : { opacity: '.55' } },
          el('div.rowbetween', {},
            el('div', {}, el('div.small', { text: a.name }), el('div.tiny.faint', { text: a.desc })),
            has ? pill('Unlocked', 'ok') : el('span.tiny.faint', { text: '—' })));
      }))));
  }

  settingsBody(rerender) {
    const s = this.state;
    const set = (k, v) => { s.settings[k] = v; this.app.applySettings(); };
    return el('div', {},
      section('Game',
        el('div.card', {},
          el('div.rowbetween', {}, el('span.small', { text: 'Complex name' }),
            el('button.btn.sm', { onclick: () => this.app.promptRename() }, s.complexName)),
          el('div.btnrow', { style: { marginTop: '10px' } },
            el('button.btn.sm', { onclick: () => this.app.saveNow() }, 'Save now'),
            el('button.btn.sm', { onclick: () => this.app.exportSave() }, 'Export'),
            el('button.btn.sm', { onclick: () => this.app.importSave() }, 'Import')),
          el('button.btn.sm.danger.full', { style: { marginTop: '8px' }, onclick: () => this.app.confirmReset() }, 'Start a new complex'))),

      section('Display & motion',
        el('div.card', {},
          toggleRow('Reduced motion', 'Disable animated counters and transitions', s.settings.reducedMotion, (v) => { set('reducedMotion', v); }),
          toggleRow('High contrast', 'Stronger borders and brighter text', s.settings.highContrast, (v) => set('highContrast', v)),
          toggleRow('Large text', 'Increase UI text size', s.settings.largeText, (v) => set('largeText', v)),
          toggleRow('Show FPS', 'Display a frame-rate counter', s.settings.showFps, (v) => set('showFps', v)))),

      section('Controls',
        el('div.card', {},
          sliderRow('Camera sensitivity', 0.4, 2, s.settings.sensitivity, 0.1,
            (v) => set('sensitivity', v), (v) => v.toFixed(1) + '×'),
          toggleRow('Invert vertical look', null, s.settings.invertY, (v) => set('invertY', v)),
          toggleRow('Left-handed controls', 'Mirror the on-screen joystick and buttons',
            s.settings.handedness === 'left', (v) => set('handedness', v ? 'left' : 'right')))),

      section('Audio',
        el('div.card', {},
          toggleRow('Sound effects', 'Block placement, UI and crowd', s.settings.sound, (v) => set('sound', v)),
          toggleRow('Autosave', 'Save automatically every in-game day', s.settings.autosave, (v) => set('autosave', v)))),

      section('About',
        el('div.card', {},
          el('div.small', { text: 'Sports Complex Tycoon 3D' }),
          el('div.tiny.faint', { style: { marginTop: '6px' },
            text: 'All teams, leagues, organisers, sponsors and events in this game are fictional. Any resemblance to real organisations is coincidental.' }),
          el('div.tiny.faint', { style: { marginTop: '6px' },
            text: '1 block = 2 metres. Desktop: WASD to move, mouse to look, left click place, right click remove, 1-9 materials, Q/E rotate, C camera, Ctrl+Z undo.' }))),
    );
  }
}

/** Utility figures span 1.5 to 400, so pick the sensible precision. */
function fmtUnit(v) {
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

function zoneName(key) { return zoneDef(key).name; }

function SPONSOR_NEXT(s) {
  const next = [12, 20, 34, 45, 60, 72, 84].find((r) => r > s.reputation.venue);
  return next ? `${next}+` : 'more';
}

/** One line summarising a venue's fittings, and what it is still short of. */
function equipmentLine(v) {
  const missing = v.equipmentMissing || [];
  const fitted = v.equipmentCount || 0;
  if (!missing.length) {
    return `Equipment: ${fitted} piece${fitted === 1 ? '' : 's'} fitted \u2014 competition standard`;
  }
  const short = missing
    .slice()
    .sort((a, b) => (b.need - b.have) - (a.need - a.have))
    .slice(0, 3)
    .map((e) => `${e.need - e.have} ${PROVIDES_LABEL[e.provides] || e.provides}`);
  return `Equipment: ${fitted} fitted \u00B7 still needs ${short.join(', ')}`;
}

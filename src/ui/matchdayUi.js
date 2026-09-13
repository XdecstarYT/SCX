import { el, fill, clear, meter, pill } from './dom.js';
import { fmtMoney, fmtNum } from '../core/economy.js';
import { TIER_LABEL } from '../venues/ratings.js';

/** Who takes the call if you do not. "Let events decide" read as nonsense. */
const DEPT = {
  events: 'the event team', security: 'security', operations: 'operations',
  hospitality: 'hospitality', marketing: 'marketing', finance: 'finance',
  management: 'the GM', sports: 'the sports team',
};

/**
 * The matchday screen.
 *
 * Full-screen on purpose. Everything else in this game is a sheet you slide
 * over the world because the world is what you are working on; on an event day
 * the world is finished and the day is the thing. It is also the one screen
 * where the clock has stopped and nothing is waiting on you, so it can afford
 * to be read rather than skimmed.
 *
 * Three bands: what is at stake up top, the decision in the middle, what the
 * day has cost so far along the bottom. The risk list is the honest part -
 * these are the exact failures the simulation is going to roll, with the exact
 * odds, and a bar showing how far your decisions have damped each one.
 */
export class MatchdayScreen {
  constructor(app) {
    this.app = app;
    this.root = el('div.matchday.hidden');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Event day');
    document.body.appendChild(this.root);
    this.view = null;
  }

  get open() { return !this.root.classList.contains('hidden'); }

  show(view) {
    this.view = view;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.root.classList.add('hidden');
    clear(this.root);
    this.view = null;
  }

  choose(index) {
    const r = this.app.game.matchdayChoose(index);
    this.afterCall(r);
  }

  delegate(rest) {
    const r = this.app.game.matchdayDelegate(rest);
    this.afterCall(r);
  }

  afterCall(r) {
    if (r?.error) { this.app.toast('warn', 'Matchday', r.error); return; }
    // applyEventReport fires 'eventreport', which the app already plays; the
    // screen's only job here is to get out of the way first.
    if (r?.report) { this.hide(); this.app.refresh(); return; }
    if (r?.view) { this.show(r.view); this.app.refresh(); }
  }

  render() {
    const v = this.view;
    if (!v) return;
    const s = v.summary;

    // ---------------------------------------------------------- what is at stake
    const head = el('div.md-head', {},
      el('div.rowbetween', {},
        el('div', {},
          el('div.tiny.faint', { text: 'EVENT DAY' }),
          el('h2', { style: { margin: '2px 0 0' }, text: v.event.name }),
          el('div.small.faint', {
            text: `${v.venue.name} · ${fmtNum(v.venue.capacity)} capacity · ${v.event.organiser}` })),
        pill(TIER_LABEL[v.event.tier] || v.event.tier, v.event.tier === 'world' ? 'gold' : '')),
      el('div', { style: { marginTop: '10px' } }, meter(v.progress * 100, 100, 'gold')),
      v.phase ? el('div.small', { style: { marginTop: '8px' } },
        el('strong', { text: v.phase.name }),
        el('span.faint', { text: ` — ${v.phase.desc}` })) : null);

    // -------------------------------------------------------------- the decision
    const call = v.call;
    const body = call
      ? el('div.md-call', {},
        el('div.tiny.faint', { text: `${(DEPT[call.dept] || call.dept).toUpperCase()} \u00B7 DECISION` }),
        el('h3', { style: { margin: '4px 0 6px' }, text: call.title }),
        el('p.small.faint', { style: { margin: '0 0 14px' }, text: call.text }),
        el('div.stack', {}, ...call.options.map((o) => el('button.card.tight.tap.md-opt', {
          'aria-label': `${o.label}. ${o.desc}`,
          onclick: () => this.choose(o.index),
        },
          el('div.small', { text: o.label }),
          el('div.tiny.faint', { text: o.desc }),
          this.effectLine(o.effect)))),
        el('div.btnrow', { style: { marginTop: '12px' } },
          el('button.btn.sm', { onclick: () => this.delegate(false) },
            `Let ${DEPT[call.dept] || call.dept} decide`),
          el('button.btn.sm', { onclick: () => this.delegate(true) },
            'Delegate the rest of the day')))
      : el('div.md-call', {}, el('p.small.faint', { text: 'The day is over.' }));

    // ------------------------------------------------------------- what it costs
    const stat = (label, value, tone) => el('div.md-stat' + (tone ? `.${tone}` : ''), {},
      el('div.tiny.faint', { text: label }),
      el('div.small.mono', { text: value }));

    const foot = el('div.md-foot', {},
      el('div.md-stats', {},
        stat('Spent today', fmtMoney(s.cost), s.cost > 0 ? 'bad' : ''),
        stat('Taken today', fmtMoney(s.revenue), s.revenue > 0 ? 'good' : ''),
        stat('Satisfaction', `${s.satisfaction >= 0 ? '+' : ''}${s.satisfaction}`,
          s.satisfaction >= 0 ? 'good' : 'bad'),
        stat('Gate flow', `${Math.round(s.gate * 100)}%`, s.gate > 1 ? 'good' : s.gate < 1 ? 'bad' : ''),
        stat('Decisions', String(s.decisions))),
      v.risks.length ? el('div', { style: { marginTop: '12px' } },
        el('div.tiny.faint', { text: 'WHAT COULD STILL GO WRONG' }),
        el('div.stack', { style: { marginTop: '6px' } },
          ...v.risks.slice(0, 5).map((r) => {
            const live = r.chance * (1 - r.guarded);
            return el('div.md-risk', {},
              el('div.rowbetween', {},
                el('span.tiny', { text: r.text }),
                el('span.tiny.mono' + (r.guarded > 0 ? '.good' : ''), {
                  text: `${Math.round(live * 100)}%` })),
              meter(live * 100, 100, live > 0.4 ? 'r' : live > 0.18 ? 'gold' : 'g'));
          }))) : null,
      v.history.length ? el('div', { style: { marginTop: '12px' } },
        el('div.tiny.faint', { text: 'WHAT YOU HAVE DONE' }),
        el('div.card.tight', { style: { marginTop: '6px' } },
          ...v.history.slice(-4).map((h) => el('div.rowbetween', { style: { padding: '2px 0' } },
            el('span.tiny.faint', { text: h.call }),
            el('span.tiny', { text: h.option }))))) : null);

    fill(this.root, el('div.md-wrap', {}, head, body, foot));
  }

  /** The numbers on an option, so a choice is a trade rather than a mood. */
  effectLine(effect = {}) {
    const bits = [];
    if (effect.cost > 0) bits.push(`−${fmtMoney(effect.cost)}`);
    if (effect.cost < 0) bits.push(`+${fmtMoney(-effect.cost)} saved`);
    if (effect.revenue) bits.push(`+${fmtMoney(effect.revenue)}`);
    if (effect.sat) bits.push(`${effect.sat > 0 ? '+' : ''}${effect.sat} satisfaction`);
    if (effect.gate && effect.gate !== 1) bits.push(`${Math.round((effect.gate - 1) * 100)}% gate flow`);
    if (effect.fill && effect.fill !== 1) bits.push(`${Math.round((effect.fill - 1) * 100)}% crowd`);
    if (effect.spend && effect.spend !== 1) bits.push(`${Math.round((effect.spend - 1) * 100)}% spend`);
    if (effect.price && effect.price !== 1) bits.push(`${Math.round((effect.price - 1) * 100)}% ticket yield`);
    for (const k of Object.keys(effect.guard || {})) bits.push(`guards ${k}`);
    if (effect.risk) bits.push(`risks ${effect.risk.key}`);
    for (const [k, val] of Object.entries(effect.rep || {})) {
      bits.push(`${val > 0 ? '+' : ''}${val} ${k}`);
    }
    if (!bits.length) return null;
    return el('div.tiny.mono.faint', { style: { marginTop: '5px' }, text: bits.join(' · ') });
  }
}

import { el, fill } from './dom.js';
import { BLOCK_SIZE } from '../core/constants.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * The play-mode dock.
 *
 * Build mode's dock answers "what will this cost". This one answers "what is
 * it like here", because that is the only question worth asking on foot. It is
 * rebuilt from the live spot report as the player walks, so the verdict on the
 * bottom of the screen changes while they move - which is the whole point of
 * getting down there.
 */
export class PlayDock {
  constructor() {
    this.onAction = null;    // (id) => 'inspect' | 'guide' | 'file' | 'build'
    this.node = el('div.builddock.playdock');

    this.where = el('div.playwhere');
    this.notes = el('div.dockhint');
    this.walk = el('div.playwalk');
    this.actions = el('div.toolrow');
    this.node.append(this.where, this.walk, this.actions, this.notes);
  }

  /**
   * @param report   spotReport() for where the player is standing
   * @param progress walkProgress() for the current site walk
   * @param target   what the Inspect button would act on right now
   */
  render(report, progress, target) {
    this.renderWhere(report);
    this.renderWalk(progress, report);
    this.renderActions(target, progress);
    fill(this.notes, el('span', {
      text: (report?.notes || ['Walk around. Anything worth knowing turns up here.']).join(' '),
    }));
  }

  renderWhere(r) {
    if (!r) {
      fill(this.where, el('span.faint', { text: 'Finding your feet…' }));
      return;
    }
    const cls = r.score >= 68 ? 'good' : r.score >= 52 ? '' : r.score >= 36 ? 'gold' : 'bad';
    fill(this.where,
      r.zone
        ? el('span.chipc', { style: { background: '#' + r.zone.color.toString(16).padStart(6, '0') } })
        : null,
      el('span.playzone', { text: r.zone ? r.zone.name : (r.surface ? `Open ${r.surface.toLowerCase()}` : 'Open ground') }),
      el('span.' + (cls || 'faint'), { text: `${r.verdict} · ${r.score}` }),
      r.view ? el('span.faint', { text: `${r.view.grade} · ${r.view.distance}m from the field` }) : null,
      el('span.faint', { text: `${r.widthMetres}m clear${r.covered ? ' · under cover' : ''}` }));
  }

  renderWalk(p, r) {
    if (!p || !p.total) {
      fill(this.walk, el('span.faint', { text: 'Nothing zoned yet, so there is nothing to inspect.' }));
      return;
    }
    const bar = el('div.playbar', {}, el('div.playbar-fill', {
      style: { width: `${Math.round(p.pct * 100)}%` },
    }));
    let toward = null;
    if (p.next && r) {
      const dx = p.next.x - r.x, dz = p.next.z - r.z;
      const dist = Math.round(Math.hypot(dx, dz) * BLOCK_SIZE);
      const dir = COMPASS[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8];
      toward = `${p.next.name} — ${dist}m ${dir}`;
    }
    // What to do next, and whether doing it is worth anything: a certificate
    // that is still in date renews rather than pays, and bad seats already on
    // file are the thing to go and look at once the rounds are done.
    const tail = !p.done ? (toward || '')
      : p.certificate
        ? `All stops visited. Your certificate has ${p.certificate.daysLeft} days left, so filing renews it without the reputation.`
        : 'Every stop visited — file the inspection.';
    fill(this.walk,
      el('span.tiny.faint', { text: `Site walk ${p.visited}/${p.total}` }),
      bar,
      el('span.tiny' + (p.restricted ? '.bad' : ''), {
        text: p.restricted
          ? `${p.restricted} bad seat${p.restricted === 1 ? '' : 's'} on file · ${tail}`
          : tail,
      }));
  }

  renderActions(target, p) {
    // The action id is separate from the label, because the Inspect button
    // renames itself to whatever it is pointing at.
    const btn = (icon, label, id, title, on = false, disabled = false) =>
      el('button.tool' + (on ? '.on' : ''), {
        title, 'aria-label': title, disabled,
        onclick: () => this.onAction?.(id),
      }, el('span.i', { text: icon }), el('span.n', { text: label }));

    const guideTo = p?.next ? `Turn to face ${p.next.name}`
      : p?.restricted ? 'Turn to face the worst seat you have found'
      : 'Nothing left to walk to';

    fill(this.actions,
      btn('⌕', target?.label || 'Inspect', 'inspect',
        target?.title || 'Look closely at whatever is under the crosshair'),
      btn('➤', 'Guide', 'guide', guideTo, false, !(p?.next || p?.restricted)),
      btn('⚑', 'File', 'file',
        p?.done ? 'File the inspection report' : 'Visit every stop first', !!p?.done, !p?.done),
      btn('▦', 'Build', 'build', 'Back to build mode'));
  }
}

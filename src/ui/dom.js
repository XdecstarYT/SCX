/** Tiny DOM helpers. Keeps the UI files readable without a framework. */

export function el(tag, props = {}, ...children) {
  const parts = tag.split(/([.#])/);
  const node = document.createElement(parts[0] || 'div');
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] === '.') node.classList.add(parts[i + 1]);
    else node.id = parts[i + 1];
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

export function fill(node, ...children) { clear(node); node.append(...children.flat(4).filter(Boolean)); return node; }

/** Count a number up to its value. Respects reduced motion. */
export function animateNumber(node, to, format, duration = 700, reduced = false) {
  if (reduced || duration <= 0) { node.textContent = format(to); return; }
  const from = 0;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    node.textContent = format(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function meter(value, max = 100, cls = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = el('span.meter' + (cls ? '.' + cls : ''), {}, el('i', { style: { width: pct + '%' } }));
  return bar;
}

export function ratingCell(label, value) {
  const cls = value >= 75 ? 'g' : value >= 50 ? '' : value >= 30 ? 'gold' : 'r';
  return el('div.ratingcell', {},
    el('div.k', { text: label }),
    el('div.v.num', { text: String(Math.round(value)) }),
    meter(value, 100, cls));
}

export function pill(text, cls = '') {
  return el('span.pill' + (cls ? '.' + cls : ''), { text });
}

/** A titled group of rows. */
export function section(title, ...children) {
  return el('div', { style: { marginBottom: '14px' } },
    title && el('div.tiny.faint', { text: title.toUpperCase(), style: { letterSpacing: '.09em', marginBottom: '7px' } }),
    ...children);
}

export function toggleRow(label, desc, on, onchange) {
  const sw = el('div.switch' + (on ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!on), tabindex: '0' });
  const row = el('div.toggle', {
    onclick: () => {
      const next = !sw.classList.contains('on');
      sw.classList.toggle('on', next);
      sw.setAttribute('aria-checked', String(next));
      onchange(next);
    },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } },
  },
    el('div', {}, el('div.small', { text: label }), desc && el('div.tiny.faint', { text: desc })),
    sw);
  return row;
}

export function sliderRow(label, min, max, value, step, oninput, format = (v) => v) {
  const out = el('span.small.mono', { text: format(value) });
  const input = el('input.input', {
    type: 'range', min, max, value, step,
    style: { padding: 0, background: 'none', border: 0, minHeight: 'auto' },
    oninput: (e) => { const v = +e.target.value; out.textContent = format(v); oninput(v); },
  });
  return el('div.field', {},
    el('div.rowbetween', {}, el('label', { text: label }), out),
    input);
}

export function requirementRow(line) {
  return el('div.req' + (line.ok ? '.ok' : '.no'), {},
    el('span.m', { text: line.ok ? '✓' : '✕' }),
    el('span.l', { text: line.label }),
    el('span.v', { text: line.ok ? line.have : `${line.have} / ${line.need}` }));
}

export function issueRow(issue) {
  const icon = { error: '⚠', warn: '⚠', info: 'ℹ', good: '✓' }[issue.severity] || 'ℹ';
  return el('div.issue.' + (issue.severity || 'info'), {},
    el('span.ic', { text: icon }), el('span', { text: issue.text }));
}

export function emptyState(icon, text) {
  return el('div.emptystate', {}, el('div.ic', { text: icon }), el('div', { text }));
}

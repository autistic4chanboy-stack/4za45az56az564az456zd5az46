/** Mini-outil de construction DOM. */
export type Child = Node | string | number | null | undefined | false | Child[];

export interface Props {
  class?: string;
  id?: string;
  style?: string;
  title?: string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function btn(label: Child, onclick: () => void, cls = '', opts: { disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}`, title: opts.title, disabled: opts.disabled }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onclick();
  });
  return b;
}

export function bar(value: number, max: number, cls = '', label?: string): HTMLDivElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h('div', { class: `bar ${cls}` }, h('div', { class: 'bar-fill', style: `width:${pct}%` }), label ? h('span', { class: 'bar-label' }, label) : null);
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

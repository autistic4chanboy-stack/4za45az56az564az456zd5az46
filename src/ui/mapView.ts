import { h, btn, clear } from './dom';
import { iconInner } from './icons';
import { ARCHETYPES, SERVICE_NAMES, HOSTILITY_NAMES } from '../data/stations';
import { BIOMES, SEASON_NAMES } from '../data/biomes';
import { findEdge } from '../world/map';
import type { Game } from '../game/Game';
import type { UI } from './UI';
import type { MapNode } from '../state/types';

const SVGNS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const HOST_COLORS: Record<string, string> = { sure: '#74cf6c', neutre: '#e3a83c', hostile: '#e45b48' };

let selected: string | null = null;

/** Carte du réseau ferroviaire. En mode départ, propose les trajets possibles. */
export function renderMap(ui: UI, game: Game, departMode: boolean): HTMLElement {
  const st = game.state;
  const map = st.map;
  const cur = map.nodes[map.current];
  const nodes = Object.values(map.nodes).filter((n) => !n.id.startsWith('draisine:') && (st.mode === 'histoire' ? !n.hidden || n.known : n.layer >= cur.layer - 2 && n.layer <= cur.layer + 6));
  const minX = Math.min(...nodes.map((n) => n.x)) - 90;
  const maxX = Math.max(...nodes.map((n) => n.x)) + 90;
  const minY = Math.min(...nodes.map((n) => n.y)) - 90;
  const maxY = Math.max(...nodes.map((n) => n.y)) + 90;
  const width = maxX - minX;
  const height = Math.max(300, maxY - minY);
  const root = svg('svg', { viewBox: `${minX} ${minY} ${width} ${height}`, width: Math.max(600, width), height: Math.max(360, height * 1.0), style: 'display:block' });
  // bandes d'hiver
  const layers = [...new Set(nodes.map((n) => n.layer))];
  for (const l of layers) {
    const any = nodes.find((n) => n.layer === l);
    if (any?.season === 'hiver') root.append(svg('rect', { x: l * 150 - 75, y: minY, width: 150, height, fill: 'rgba(120,170,220,0.07)' }));
  }
  const questStations = new Set<string>();
  for (const q of st.quests) if (q.status === 'active') for (const o of q.objectives) if (!o.done && o.station) questStations.add(o.station);
  // liaisons
  for (const e of map.edges) {
    const a = map.nodes[e.from];
    const b = map.nodes[e.to];
    if (!a || !b || !nodes.includes(a) || !nodes.includes(b)) continue;
    const reachable = e.from === map.current && departMode;
    const line = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: reachable ? '#e3a83c' : b.known ? '#6a5a48' : '#3a3229', 'stroke-width': reachable ? 4 : 2.5, 'stroke-dasharray': b.known ? '' : '6 6' });
    root.append(line);
    if (b.known && e.features.length) {
      const t = svg('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#a99d8a' });
      t.textContent = e.features.map((f) => (f === 'tunnel' ? '⛰' : f === 'aiguillage' ? '⑂' : '≋')).join(' ');
      root.append(t);
    }
  }
  const info = h('div', { class: 'card', style: 'min-height:120px' });
  const showInfo = (n: MapNode) => {
    selected = n.id;
    clear(info);
    const arch = ARCHETYPES[n.archetype];
    const edge = findEdge(map, map.current, n.id);
    const scouted = n.scouted;
    info.append(h('div', { class: 'row between' }, h('h3', null, n.known ? n.name : 'Gare inconnue'), n.known && scouted ? h('span', { class: 'pill', style: `color:${HOST_COLORS[n.hostility]}` }, HOSTILITY_NAMES[n.hostility]) : h('span', { class: 'pill' }, 'Non repérée')));
    if (n.known) {
      info.append(h('div', { class: 'muted small' }, `${arch.name} · ${BIOMES[n.biome].name} · ${SEASON_NAMES[n.season]}${n.visited ? ' · visitée' : ''}`));
      if (n.blurb) info.append(h('div', { class: 'small', style: 'margin-top:4px' }, n.blurb));
      info.append(h('div', { class: 'small', style: 'margin-top:4px' }, arch.desc));
      if (scouted) {
        const tags = h('div', { class: 'row wrap', style: 'margin-top:6px' });
        tags.append(h('span', { class: 'pill' }, `Menace ${n.threat.toFixed(1)}`));
        if (n.radiation > 0.5) tags.append(h('span', { class: 'pill warn' }, '☢ Radiations'));
        if (n.gas) tags.append(h('span', { class: 'pill warn' }, 'Gaz toxiques'));
        if (n.boss) tags.append(h('span', { class: 'pill bad' }, 'Boss'));
        for (const s of n.services) tags.append(h('span', { class: 'pill good' }, SERVICE_NAMES[s]));
        for (const t of arch.tags) tags.append(h('span', { class: 'pill' }, t));
        info.append(tags);
      }
      if (questStations.has(n.id)) info.append(h('div', { class: 'pill warn', style: 'margin-top:6px' }, '★ Objectif de quête'));
    }
    if (edge) {
      info.append(h('div', { class: 'small muted', style: 'margin-top:6px' }, `Trajet : ${(edge.length / 1000).toFixed(1)} km${edge.features.includes('tunnel') ? ' · tunnel' : ''}${edge.features.includes('aiguillage') ? ' · aiguillage manuel' : ''}${edge.features.includes('pont') ? ' · pont' : ''} · danger ${edge.danger > 0.7 ? 'élevé' : edge.danger > 0.45 ? 'moyen' : 'faible'}`));
      if (departMode) {
        info.append(h('div', { style: 'margin-top:8px' }, btn(`Partir vers ${n.known ? n.name : 'l\'inconnu'}`, () => {
          if (game.depart(n.id)) ui.closeAll();
        }, 'primary')));
      }
    } else if (departMode && n.id !== map.current) {
      info.append(h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Pas de voie directe depuis votre gare.'));
    }
  };
  for (const n of nodes) {
    const g = svg('g', { class: 'map-node', transform: `translate(${n.x},${n.y})` });
    const color = n.known && n.scouted ? HOST_COLORS[n.hostility] : '#6a6258';
    if (n.id === map.current) g.append(svg('circle', { r: 30, fill: 'none', stroke: '#86d8ff', 'stroke-width': 3, opacity: 0.8 }));
    g.append(svg('circle', { class: 'ring', r: 24, fill: '#1d1915', stroke: color, 'stroke-width': selected === n.id ? 4 : 2.5 }));
    if (n.known) {
      const ic = svg('g', { transform: 'translate(-12,-12)', style: `color:${color}` });
      ic.innerHTML = iconInner(ARCHETYPES[n.archetype].icon);
      g.append(ic);
      const t = svg('text', { y: 42, 'text-anchor': 'middle', 'font-size': 13, fill: n.visited ? '#ece4d3' : '#c8bca8', 'font-family': 'Oswald, sans-serif' });
      t.textContent = n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name;
      g.append(t);
    } else {
      const t = svg('text', { y: 7, 'text-anchor': 'middle', 'font-size': 20, fill: '#8a8070' });
      t.textContent = '?';
      g.append(t);
    }
    if (questStations.has(n.id)) {
      const star = svg('text', { x: 18, y: -16, 'font-size': 18, fill: '#e3a83c' });
      star.textContent = '★';
      g.append(star);
    }
    if (n.visited && n.id !== map.current) g.append(svg('circle', { r: 5, cx: -18, cy: -18, fill: '#74cf6c' }));
    g.addEventListener('click', () => {
      showInfo(n);
      for (const c of root.querySelectorAll('circle.ring')) c.setAttribute('stroke-width', '2.5');
      g.querySelector('circle.ring')?.setAttribute('stroke-width', '4');
    });
    root.append(g);
  }
  const wrap = h('div', { class: 'mapwrap', style: 'overflow:auto' });
  wrap.append(root);
  // centre sur la gare actuelle
  window.setTimeout(() => {
    wrap.scrollLeft = Math.max(0, ((cur.x - minX) / width) * root.clientWidth - wrap.clientWidth / 2);
  }, 0);
  const firstLink = cur.links.map((l) => map.nodes[l]).find(Boolean);
  showInfo(departMode && firstLink ? firstLink : selected && map.nodes[selected] ? map.nodes[selected] : cur);
  const legend = h('div', { class: 'map-legend' },
    h('span', { style: 'color:#74cf6c' }, '● Sûre'), h('span', { style: 'color:#e3a83c' }, '● Neutre'), h('span', { style: 'color:#e45b48' }, '● Hostile'), h('span', null, '● Inconnue'),
    h('span', null, '⛰ tunnel · ⑂ aiguillage · ≋ pont'), h('span', { style: 'color:#86d8ff' }, '◯ vous êtes ici'), h('span', { style: 'color:#e3a83c' }, '★ quête'),
    h('span', { style: 'color:#9cc4ea' }, '▮ bande bleutée : hiver'),
  );
  return h('div', { class: 'stack' }, wrap, legend, info);
}

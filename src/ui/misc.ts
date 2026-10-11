import { h, btn, clear } from './dom';
import { icon } from './icons';
import { RESOURCES, GEAR, TOOLS, personalItemIcon } from '../data/items';
import { WEAPONS, newWeapon } from '../data/weapons';
import { PERKS } from '../data/perks';
import type { Game } from '../game/Game';
import type { UI } from './UI';
import type { ContainerSpec, Compartment } from '../world/stationBuilder';
import type { LootEntry } from '../world/loot';

function lootIcon(e: LootEntry): HTMLElement {
  switch (e.kind) {
    case 'resource': {
      const r = RESOURCES[e.id];
      return icon(r.icon, 20, r.color === '#3a3a3a' ? '#9a9a9a' : r.color);
    }
    case 'weapon':
      return icon(WEAPONS[e.id]?.icon ?? 'box', 20, '#e3a83c');
    case 'gear':
      return icon(GEAR[e.id]?.icon ?? 'box', 20, '#86d8ff');
    case 'tool':
      return icon(TOOLS[e.id]?.icon ?? 'box', 20, '#c8c0b0');
    case 'item':
      return icon(personalItemIcon(e.id), 20, '#e3a83c');
  }
}

export interface ContainerHooks {
  /** Le compartiment est-il déjà ouvert ? */
  isOpen: (comp: Compartment) => boolean;
  openCompartment: (comp: Compartment) => void;
  onEmptied: (comp: Compartment) => void;
  onClose: () => void;
}

/** Fouille d'un meuble : chaque tiroir, porte ou couvercle s'ouvre séparément. */
export function openContainer(ui: UI, game: Game, c: ContainerSpec, hooks: ContainerHooks): void {
  const body = h('div', { class: 'stack' });
  const single = c.compartments.length === 1;
  if (single && !hooks.isOpen(c.compartments[0])) hooks.openCompartment(c.compartments[0]);
  const take = (comp: Compartment, i: number) => {
    if (game.takeLoot(comp.loot[i])) {
      comp.loot.splice(i, 1);
      if (!comp.loot.length) hooks.onEmptied(comp);
    }
  };
  const render = () => {
    clear(body);
    for (const comp of c.compartments) {
      const open = hooks.isOpen(comp);
      const rows = h('div', { class: 'list' });
      if (open) {
        comp.loot.forEach((e, i) => {
          rows.append(h('div', { class: 'item' }, lootIcon(e), h('span', { class: 'grow' }, game.lootName(e)), btn('Prendre', () => {
            take(comp, i);
            render();
          }, 'small')));
        });
        if (comp.note) {
          const n = comp.note;
          rows.append(h('div', { class: 'item' }, icon('note', 20, '#e8dcc0'), h('span', { class: 'grow' }, n.title), btn('Lire', () => game.ui.openNote(n.title, n.text), 'small')));
        }
        if (!comp.loot.length && !comp.note) rows.append(h('div', { class: 'muted small comp-flavor' }, comp.flavor || 'Vide.'));
      }
      if (single) {
        body.append(rows);
        continue;
      }
      const head = h('div', { class: 'row between comp-head' }, h('span', { class: open ? '' : 'muted' }, comp.name), open ? h('span', { class: 'pill' }, comp.loot.length ? `${comp.loot.length} objet${comp.loot.length > 1 ? 's' : ''}` : 'fouillé') : btn('Ouvrir', () => {
        hooks.openCompartment(comp);
        render();
      }, 'small'));
      body.append(h('div', { class: `comp ${open ? 'open' : ''}` }, head, open ? rows : null));
    }
  };
  render();
  const searchAll = () => {
    for (const comp of c.compartments) if (!hooks.isOpen(comp)) hooks.openCompartment(comp);
    for (const comp of c.compartments) for (let i = comp.loot.length - 1; i >= 0; i--) take(comp, i);
    render();
    if (c.compartments.every((k) => !k.loot.length && !k.note)) window.setTimeout(() => ui.closeModal(), 450);
  };
  const all = btn(single ? 'Tout prendre' : 'Tout fouiller', searchAll, 'primary');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'e' || e.key === 'E' || e.key === ' ') {
      e.preventDefault();
      all.click();
    }
  };
  window.addEventListener('keydown', onKey);
  ui.openModal(body, { title: c.name, className: 'narrow', onClose: () => { window.removeEventListener('keydown', onKey); hooks.onClose(); } }, [h('span', { class: 'small muted', style: 'margin-right:auto' }, single ? 'E / Espace : tout prendre' : 'E / Espace : tout fouiller'), all]);
  game.emit({ type: 'container', id: c.id });
}

/** Écran d'ordinateur : courriels et journaux, parfois un code. */
export function openTerminal(ui: UI, game: Game, title: string, messages: { title: string; text: string; reveals?: { door: string; code: string } }[], station: string): void {
  const screen = h('div', { class: 'terminal' });
  const list = () => {
    clear(screen);
    screen.append(h('div', { class: 'term-line' }, '> CONNEXION LOCALE — RÉSEAU INDISPONIBLE'), h('div', { class: 'term-line' }, `> ${messages.length} message${messages.length > 1 ? 's' : ''} non lu${messages.length > 1 ? 's' : ''}`));
    messages.forEach((m, i) => {
      const el = h('button', { class: 'term-item' }, `[${i + 1}] ${m.title}`);
      el.addEventListener('click', () => read(m));
      screen.append(el);
    });
  };
  const read = (m: (typeof messages)[number]) => {
    clear(screen);
    screen.append(h('div', { class: 'term-line' }, `> ${m.title}`), h('div', { class: 'term-text' }, m.text));
    if (m.reveals) game.notePickup({ id: `terminal:${m.reveals.door}`, title: m.title, text: m.text, reveals: m.reveals }, station);
    const back = h('button', { class: 'term-item' }, '[retour]');
    back.addEventListener('click', list);
    screen.append(back);
    game.audio.play('beep', { volume: 0.4 });
  };
  list();
  ui.openModal(screen, { title, className: 'narrow' }, [btn('Éteindre', () => ui.closeModal(), 'primary')]);
}

export function openNote(ui: UI, title: string, text: string): void {
  ui.openModal(h('div', { class: 'paper' }, h('h3', null, title), h('div', null, text)), { title: 'Document', className: 'narrow' }, [btn('Fermer', () => ui.closeModal(), 'primary')]);
}

export function openStory(ui: UI, title: string, paragraphs: string[], onClose?: () => void): void {
  const body = h('div', { class: 'story' }, paragraphs.map((p) => h('p', null, p)));
  ui.openModal(body, { title, className: 'medium', onClose, locked: false }, [btn('Continuer', () => ui.closeModal(), 'primary')]);
}

export function eventDialog(ui: UI, title: string, text: string, options: { text: string; action: () => void }[]): void {
  let chosen = false;
  const opts = h('div', { class: 'dlg-opts' });
  options.forEach((o, i) => {
    const el = h('button', { class: 'dlg-opt' }, h('span', { class: 'num' }, `${i + 1}.`), o.text);
    el.addEventListener('click', () => {
      if (chosen) return;
      chosen = true;
      ui.closeModal();
      o.action();
    });
    opts.append(el);
  });
  ui.openModal(h('div', null, h('div', { class: 'dlg-text' }, text), opts), {
    title,
    className: 'narrow',
    onClose: () => {
      // fermer sans choisir = dernière option (refus)
      if (!chosen) {
        chosen = true;
        options[options.length - 1]?.action();
      }
    },
  });
}

export function chooseWeaponSwap(ui: UI, game: Game, id: string, level: number): void {
  const st = game.state.player;
  const w = WEAPONS[id];
  const list = h('div', { class: 'list' });
  st.weapons.forEach((cur, i) => {
    if (!cur) return;
    list.append(h('div', { class: 'item' }, h('b', null, String(i + 1)), h('span', { class: 'grow' }, `${WEAPONS[cur.id].name}${cur.level ? ` +${cur.level}` : ''}`), btn('Remplacer', () => {
      st.weapons[i] = newWeapon(id, level);
      if (st.active === i) game.player.model.setWeapon(id);
      ui.closeModal();
      ui.toast(`${w.name} équipé à la place de ${WEAPONS[cur.id].name}.`, 'bon');
    }, 'small', { disabled: cur.id === 'cle' })));
  });
  ui.openModal(h('div', null, h('div', { class: 'muted', style: 'margin-bottom:8px' }, `Vos 4 emplacements sont pleins. Remplacer une arme par ${w.name}${level ? ` +${level}` : ''} ?`), list), { title: 'Nouvelle arme', className: 'narrow' }, [btn('Laisser sur place', () => ui.closeModal())]);
}

export function openPerkChoice(ui: UI, game: Game): void {
  const p = game.state.player;
  if (p.pendingPerks <= 0) return;
  const choices = game.perkChoices();
  const list = h('div', { class: 'grid3' });
  for (const id of choices) {
    const perk = PERKS[id];
    list.append(h('div', { class: 'card stack', style: 'align-items:center;text-align:center' },
      icon(perk.icon, 36, '#b083e8'),
      h('h3', null, perk.name),
      h('div', { class: 'small muted', style: 'min-height:48px' }, perk.desc),
      btn('Choisir', () => {
        p.perks.push(id);
        p.pendingPerks--;
        if (id === 'robuste') game.player.heal(25);
        game.audio.play('success');
        ui.closeModal();
        if (p.pendingPerks > 0) openPerkChoice(ui, game);
      }, 'primary'),
    ));
  }
  ui.openModal(list, { title: `Niveau ${p.level} — choisissez un atout`, className: 'medium' });
}

/** Établi : munitions artisanales et amélioration des armes. */
export function openWorkbench(ui: UI, game: Game): void {
  const st = game.state;
  const body = h('div', { class: 'stack' });
  const render = () => {
    clear(body);
    const r = st.train.resources;
    const recipes: { name: string; desc: string; cost: Partial<Record<keyof typeof r, number>>; gain: Partial<Record<keyof typeof r, number>> }[] = [
      { name: 'Balles (×20)', desc: 'Douilles récupérées et plomb fondu.', cost: { ferraille: 5 }, gain: { balles: 20 } },
      { name: 'Cartouches (×8)', desc: 'Grenaille et poudre.', cost: { ferraille: 6 }, gain: { cartouches: 8 } },
      { name: 'Obus (×2)', desc: 'Lourd, lent à fabriquer.', cost: { ferraille: 14, dynamite: 1 }, gain: { obus: 2 } },
      { name: 'Crochets (×3)', desc: 'Fil d\'acier recourbé.', cost: { ferraille: 3 }, gain: { crochets: 3 } },
      { name: 'Filtre (×1)', desc: 'Charbon actif et toile.', cost: { ferraille: 2, charbon: 4 }, gain: { filtres: 1 } },
      { name: 'Dynamite (×1)', desc: 'Pour les barricades… et le reste.', cost: { ferraille: 6, charbon: 6 }, gain: { dynamite: 1 } },
      { name: 'Cellule d\'énergie (×2)', desc: 'Recharge des batteries sur la dynamo.', cost: { ferraille: 4 }, gain: { cellules: 2 } },
    ];
    body.append(h('h3', null, 'Fabrication'));
    for (const rc of recipes) {
      const ok = Object.entries(rc.cost).every(([k, v]) => (r[k as keyof typeof r] ?? 0) >= (v ?? 0));
      body.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, rc.name), h('div', { class: 'sub' }, `${rc.desc} Coût : ${Object.entries(rc.cost).map(([k, v]) => `${v} ${RESOURCES[k as keyof typeof RESOURCES].short}`).join(', ')}`)), btn('Fabriquer', () => {
        for (const [k, v] of Object.entries(rc.cost)) r[k as keyof typeof r] -= v ?? 0;
        for (const [k, v] of Object.entries(rc.gain)) r[k as keyof typeof r] = (r[k as keyof typeof r] ?? 0) + (v ?? 0);
        game.audio.play('build');
        render();
      }, 'small', { disabled: !ok })));
    }
    body.append(h('h3', { style: 'margin-top:10px' }, 'Améliorer une arme (+15 % dégâts)'));
    st.player.weapons.forEach((w) => {
      if (!w) return;
      const d = WEAPONS[w.id];
      const cost = { ferraille: 15 + w.level * 20, jetons: 20 + w.level * 30 };
      const ok = w.level < 3 && (r.ferraille ?? 0) >= cost.ferraille && (r.jetons ?? 0) >= cost.jetons;
      body.append(h('div', { class: 'item' }, icon(d.icon, 20, '#e3a83c'), h('div', { class: 'grow' }, h('div', { class: 'name' }, `${d.name} +${w.level}`), h('div', { class: 'sub' }, w.level >= 3 ? 'Niveau maximal.' : `${cost.ferraille} ferraille, ${cost.jetons} jetons`)), btn('Améliorer', () => {
        r.ferraille -= cost.ferraille;
        r.jetons -= cost.jetons;
        w.level++;
        game.audio.play('build');
        render();
      }, 'small', { disabled: !ok })));
    });
  };
  render();
  ui.openModal(body, { title: 'Établi', className: 'medium' });
}

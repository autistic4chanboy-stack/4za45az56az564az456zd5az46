import { h, btn, clear } from './dom';
import { icon } from './icons';
import { RESOURCES, RESOURCE_IDS, GEAR, TOOLS, type ResourceId } from '../data/items';
import { WEAPONS } from '../data/weapons';
import { EQUIPMENT, DECOR, WAGON_TYPES } from '../data/train';
import { ARCHETYPES } from '../data/stations';
import { coalCapacity } from '../state/trainState';
import type { Game } from '../game/Game';
import type { UI } from './UI';
import type { MapNode } from '../state/types';

type TradeTab = 'ressources' | 'armes' | 'train' | 'services';

/** Commerce et services d'une gare (ou d'un marchand ambulant). */
export function openTrade(ui: UI, game: Game, node: MapNode, focus: ResourceId | null, onClose?: () => void): void {
  const eco = game.economy;
  const stock = eco.ensureStock(node);
  const services = ARCHETYPES[node.archetype]?.services ?? [];
  const tabsEl = h('div', { class: 'tabs' });
  const content = h('div', { style: 'padding:14px 16px' });
  const jetons = h('span', { class: 'pill warn', style: 'font-size:14px' });
  const wrap = h('div', null, tabsEl, content);
  ui.openModal(wrap, { title: `Commerce — ${node.name}`, className: 'medium', onClose });
  (wrap.parentElement as HTMLElement).style.padding = '0';
  const head = wrap.parentElement?.parentElement?.querySelector('.modal-head');
  head?.insertBefore(jetons, head.lastChild);
  const available: TradeTab[] = [];
  if (stock && Object.keys(stock.resources).length) available.push('ressources');
  if (stock && (stock.weapons.length || stock.gear.length || stock.tools.length)) available.push('armes');
  if (stock && (stock.equipment.length || stock.decor.length || stock.wagons.length)) available.push('train');
  if (services.some((s) => s === 'atelier' || s === 'soins' || s === 'informations' || s === 'repos') && node.hostility !== 'hostile') available.push('services');
  if (!available.length) available.push('services');
  let tab: TradeTab = focus ? 'ressources' : available[0];
  const names: Record<TradeTab, string> = { ressources: 'Ressources', armes: 'Armes & équipement', train: 'Pour le train', services: 'Services' };
  const render = () => {
    jetons.textContent = `${Math.floor(game.state.train.resources.jetons ?? 0)} jetons`;
    clear(tabsEl);
    for (const t of available) {
      const el = h('div', { class: `tab ${t === tab ? 'on' : ''}` }, names[t]);
      el.addEventListener('click', () => {
        tab = t;
        render();
      });
      tabsEl.append(el);
    }
    clear(content);
    const err = (e: string | null) => {
      if (e) ui.toast(e, 'mauvais');
      render();
    };
    if (tab === 'ressources' && stock) {
      const st = game.state;
      if (focus === 'charbon' || stock.resources.charbon) {
        const missing = coalCapacity(st.train) - Math.floor(st.train.resources.charbon ?? 0);
        const price = eco.resourcePrice('charbon', node, true);
        content.append(h('div', { class: 'card row between', style: 'margin-bottom:10px' },
          h('div', null, h('b', null, 'Tender : '), `${Math.floor(st.train.resources.charbon)} / ${coalCapacity(st.train)} — prix ${price} jeton/unité`),
          btn(`Remplir (${Math.ceil(Math.min(missing, stock.resources.charbon ?? 0) * price)} J)`, () => err(eco.buyResource(node, 'charbon', missing)), 'primary small', { disabled: missing <= 0 || (stock.resources.charbon ?? 0) <= 0 }),
        ));
      }
      const table = h('div', { class: 'list' });
      for (const id of RESOURCE_IDS) {
        if (id === 'jetons') continue;
        const avail = Math.floor(stock.resources[id] ?? 0);
        const have = Math.floor(st.train.resources[id] ?? 0);
        if (!avail && !have) continue;
        const r = RESOURCES[id];
        const buy = eco.resourcePrice(id, node, true);
        const sell = eco.resourcePrice(id, node, false);
        table.append(h('div', { class: `item ${focus === id ? 'sel' : ''}` },
          icon(r.icon, 20, r.color === '#3a3a3a' ? '#9a9a9a' : r.color),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, r.name), h('div', { class: 'sub' }, `Stock marchand : ${avail} · vous : ${have}`)),
          h('div', { class: 'stack', style: 'align-items:flex-end' },
            h('div', { class: 'row' }, h('span', { class: 'small muted' }, `achat ${buy} J`),
              btn('+1', () => err(eco.buyResource(node, id, 1)), 'tiny', { disabled: avail <= 0 }),
              btn('+10', () => err(eco.buyResource(node, id, 10)), 'tiny', { disabled: avail <= 0 }),
              btn('max', () => err(eco.buyResource(node, id, Math.min(avail, Math.floor((st.train.resources.jetons ?? 0) / buy)))), 'tiny', { disabled: avail <= 0 })),
            h('div', { class: 'row' }, h('span', { class: 'small muted' }, `vente ${sell} J`),
              btn('-1', () => err(eco.sellResource(node, id, 1)), 'tiny', { disabled: have <= 0 }),
              btn('-10', () => err(eco.sellResource(node, id, 10)), 'tiny', { disabled: have <= 0 }),
              btn('tout', () => err(eco.sellResource(node, id, have)), 'tiny', { disabled: have <= 0 })),
          ),
        ));
      }
      content.append(table);
    } else if (tab === 'armes' && stock) {
      const st = game.state;
      const list = h('div', { class: 'list' });
      for (const id of stock.weapons) {
        const w = WEAPONS[id];
        list.append(h('div', { class: 'item' }, icon(w.icon, 22, '#e3a83c'), h('div', { class: 'grow' }, h('div', { class: 'name' }, w.name), h('div', { class: 'sub' }, `${w.desc} · ${w.damage}${w.pellets ? `×${w.pellets}` : ''} dégâts · ${w.rate}/s`)), btn(`${eco.itemPrice(w.price, true)} J`, () => err(eco.buyWeapon(node, id)), 'small')));
      }
      for (const id of stock.gear) {
        const gdef = GEAR[id];
        const owned = (st.player.items[id] ?? 0) > 0 || st.player.gear.corps === id || st.player.gear.tete === id;
        list.append(h('div', { class: 'item' }, icon(gdef.icon, 22, '#86d8ff'), h('div', { class: 'grow' }, h('div', { class: 'name' }, gdef.name), h('div', { class: 'sub' }, gdef.desc)), owned ? h('span', { class: 'pill good' }, 'Possédé') : btn(`${eco.itemPrice(gdef.price, true)} J`, () => err(eco.buyGear(node, id, 'gear')), 'small')));
      }
      for (const id of stock.tools) {
        const t = TOOLS[id];
        const owned = (st.player.items[id] ?? 0) > 0;
        list.append(h('div', { class: 'item' }, icon(t.icon, 22, '#c8c0b0'), h('div', { class: 'grow' }, h('div', { class: 'name' }, t.name), h('div', { class: 'sub' }, t.desc)), owned ? h('span', { class: 'pill good' }, 'Possédé') : btn(`${eco.itemPrice(t.price, true)} J`, () => err(eco.buyGear(node, id, 'tool')), 'small')));
      }
      const sell = h('div', { class: 'card', style: 'margin-top:10px' }, h('h4', null, 'Vendre vos armes'));
      st.player.weapons.forEach((w, i) => {
        if (!w || w.id === 'cle') return;
        sell.append(h('div', { class: 'row small' }, h('span', { class: 'grow' }, `${WEAPONS[w.id].name}${w.level ? ` +${w.level}` : ''}`), btn(`Vendre ${Math.floor(WEAPONS[w.id].price * (1 + 0.3 * w.level) * eco.priceFactor(false))} J`, () => { eco.sellWeapon(i); render(); }, 'tiny')));
      });
      content.append(list, sell);
    } else if (tab === 'train' && stock) {
      const list = h('div', { class: 'list' });
      for (const id of stock.equipment) {
        const e = EQUIPMENT[id];
        list.append(h('div', { class: 'item' }, icon(e.icon, 22, '#e3a83c'), h('div', { class: 'grow' }, h('div', { class: 'name' }, e.name), h('div', { class: 'sub' }, `${e.desc} · montage ${Math.round(e.scrap * 0.3)} ferraille`)), btn(`${eco.itemPrice(e.price, true)} J`, () => err(eco.buyEquip(node, id)), 'small')));
      }
      for (const id of stock.decor) {
        const d = DECOR[id];
        list.append(h('div', { class: 'item' }, icon('star', 22, '#b083e8'), h('div', { class: 'grow' }, h('div', { class: 'name' }, d.name), h('div', { class: 'sub' }, `${d.desc} · moral +${d.morale}`)), btn(`${eco.itemPrice(d.price, true)} J`, () => err(eco.buyDecor(node, id)), 'small')));
      }
      for (const id of stock.wagons) {
        const w = WAGON_TYPES[id];
        list.append(h('div', { class: 'item' }, icon('train', 22, '#e3a83c'), h('div', { class: 'grow' }, h('div', { class: 'name' }, w.name), h('div', { class: 'sub' }, `${w.desc} · ${w.hp} PV · ${w.roofSlots} empl. toit · ${w.beds} lits · +${w.scrap} ferraille`)), btn(`${eco.itemPrice(w.price, true)} J`, () => err(eco.buyWagon(node, id)), 'small')));
      }
      content.append(list, h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Les équipements et décorations achetés s\'installent depuis le tableau de bord (onglet Train). Les wagons sont attelés en queue de convoi.'));
    } else {
      const list = h('div', { class: 'list' });
      if (services.includes('atelier')) {
        const c = eco.repairCost();
        list.append(h('div', { class: 'item' }, icon('wrench', 22, '#e3a83c'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Réparation complète du convoi'), h('div', { class: 'sub' }, c.hp > 0 ? `${c.hp} points à réparer · ${c.ferraille} ferraille` : 'Tout est en état.')), btn(`${c.jetons} J`, () => err(eco.repairAll()), 'small', { disabled: c.hp <= 0 })));
      }
      if (services.includes('soins') || services.includes('repos')) {
        const c = eco.healCost();
        list.append(h('div', { class: 'item' }, icon('meds', 22, '#e45b48'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Soins pour tout le convoi'), h('div', { class: 'sub' }, 'Blessures, maladies et radiations (vous et l\'équipage).')), btn(`${c} J`, () => err(eco.healAll()), 'small', { disabled: c <= 0 })));
      }
      if (services.includes('informations')) list.append(h('div', { class: 'item' }, icon('map', 22, '#86d8ff'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Acheter des informations'), h('div', { class: 'sub' }, 'Révèle les dangers des gares voisines et au-delà.')), btn(`${eco.itemPrice(20, true)} J`, () => err(eco.buyInfo(node)), 'small')));
      if (services.includes('repos')) list.append(h('div', { class: 'item' }, icon('house', 22, '#e3a83c'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Passer la nuit à l\'abri'), h('div', { class: 'sub' }, 'Jusqu\'au matin : soins, chaleur et moral pour tous.')), btn(`${eco.itemPrice(8, true)} J`, () => err(eco.rest()), 'small')));
      if (!list.children.length) list.append(h('div', { class: 'muted' }, 'Aucun service ici.'));
      content.append(list);
    }
  };
  render();
}

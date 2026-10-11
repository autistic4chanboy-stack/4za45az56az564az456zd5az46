import { h, btn, bar, clear, fmt } from './dom';
import { icon } from './icons';
import { portrait } from './portrait';
import { renderMap } from './mapView';
import { BAL } from '../data/balance';
import { RESOURCES, RESOURCE_IDS, GEAR, TOOLS, QUEST_ITEMS, personalItemName, personalItemIcon, personalItemDesc } from '../data/items';
import { WEAPONS } from '../data/weapons';
import { WAGON_TYPES, EQUIPMENT, DECOR, LOCO_UPGRADES, CHANNEL_NAMES, POWER_CHANNELS, equipUpgradeCost, wagonArmorCost, type PowerChannel } from '../data/train';
import { SKILLS, PERSONALITIES, JOBS, SECRETS, type JobId } from '../data/npcs';
import { PERKS } from '../data/perks';
import { ARCHETYPES } from '../data/stations';
import { formatTime } from '../core/math';
import { coalCapacity, storageCapacity, storageUsed, wagonMaxHp, wagonArmor, crewOnBoard, bedCount, newSlot } from '../state/trainState';
import { coalRate, rangeEstimate } from '../train/sim';
import { diseaseName } from '../game/crewSystem';
import { openPerkChoice } from './misc';
import type { Game } from '../game/Game';
import type { UI } from './UI';
import type { NpcState, WagonState } from '../state/types';

export type DashTab = 'train' | 'energie' | 'equipage' | 'inventaire' | 'journal' | 'carte' | 'personnage';

const TABS: { id: DashTab; label: string; icon: string; key: string }[] = [
  { id: 'train', label: 'Train', icon: 'train', key: 'T' },
  { id: 'energie', label: 'Énergie', icon: 'bolt', key: 'K' },
  { id: 'equipage', label: 'Équipage', icon: 'people', key: 'C' },
  { id: 'inventaire', label: 'Inventaire', icon: 'bag', key: 'I' },
  { id: 'journal', label: 'Journal', icon: 'journal', key: 'J' },
  { id: 'carte', label: 'Carte', icon: 'map', key: 'M' },
  { id: 'personnage', label: 'Personnage', icon: 'person', key: 'P' },
];

let selectedWagon = 0;
let journalSub: 'quetes' | 'notes' | 'enquete' | 'evenements' = 'quetes';

export function openDashboard(ui: UI, game: Game, tab: DashTab): void {
  ui.lastDashTab = tab;
  const tabs = h('div', { class: 'tabs' });
  const content = h('div');
  const wrap = h('div', null, tabs, content);
  ui.openModal(wrap, { title: 'Tableau de bord', className: '' });
  const body = wrap.parentElement as HTMLElement;
  body.style.padding = '0';
  content.style.padding = '14px 16px';
  const render = (t: DashTab) => {
    ui.lastDashTab = t;
    clear(tabs);
    for (const tb of TABS) {
      const pending = tb.id === 'personnage' && game.state.player.pendingPerks > 0;
      const el = h('div', { class: `tab ${t === tb.id ? 'on' : ''}` }, icon(tb.icon, 15), tb.label, h('span', { class: 'dim small' }, tb.key), pending ? h('span', { class: 'badge' }, '!') : null);
      el.addEventListener('click', () => render(tb.id));
      tabs.append(el);
    }
    clear(content);
    const rerender = () => render(t);
    switch (t) {
      case 'train': content.append(trainTab(ui, game, rerender)); break;
      case 'energie': content.append(energyTab(ui, game, rerender)); break;
      case 'equipage': content.append(crewTab(ui, game, rerender)); break;
      case 'inventaire': content.append(inventoryTab(ui, game, rerender)); break;
      case 'journal': content.append(journalTab(ui, game, rerender)); break;
      case 'carte': content.append(renderMap(ui, game, false)); break;
      case 'personnage': content.append(characterTab(ui, game, rerender)); break;
    }
  };
  render(tab);
}

// ================================================================== TRAIN

function workshopAvailable(game: Game): boolean {
  const lv = game.stationLevel();
  const stationWorkshop = !!lv && lv.node.hostility !== 'hostile' && ARCHETYPES[lv.node.archetype].services.includes('atelier');
  return stationWorkshop || game.state.train.wagons.some((w) => w.type === 'atelier' && w.hp > 0);
}

function stationHas(game: Game, service: 'atelier' | 'wagons'): boolean {
  const lv = game.stationLevel();
  return !!lv && lv.node.hostility !== 'hostile' && ARCHETYPES[lv.node.archetype].services.includes(service);
}

function trainTab(ui: UI, game: Game, rerender: () => void): HTMLElement {
  const st = game.state;
  const wagons = st.train.wagons;
  if (selectedWagon >= wagons.length) selectedWagon = 0;
  const crew = crewOnBoard(st);
  const left = h('div', { class: 'list' });
  wagons.forEach((w, i) => {
    const max = wagonMaxHp(st, w);
    const occ = crew.filter((n) => n.wagon === w.uid).length;
    const def = WAGON_TYPES[w.type];
    const item = h('div', { class: `item clickable ${i === selectedWagon ? 'sel' : ''}` },
      h('b', { style: 'width:20px;text-align:center' }, String(i + 1)),
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, def.name),
        bar(w.hp, max, w.hp < max * BAL.criticalHp ? 'hp thin' : 'st thin'),
        h('div', { class: 'sub' }, `${Math.round(w.temp)} °C · ${occ} occupant(s)${def.beds ? ` / ${def.beds} lits` : ''}${w.fire > 0 ? ' · 🔥 INCENDIE' : ''}`),
      ),
      stationHas(game, 'wagons') && i > 0 ? h('div', { class: 'stack' },
        btn('▲', () => { if (i > 1) { swapWagons(game, i, i - 1); selectedWagon = i - 1; rerender(); } }, 'tiny', { disabled: i <= 1, title: 'Avancer' }),
        btn('▼', () => { if (i < wagons.length - 1) { swapWagons(game, i, i + 1); selectedWagon = i + 1; rerender(); } }, 'tiny', { disabled: i >= wagons.length - 1, title: 'Reculer' }),
      ) : null,
    );
    item.addEventListener('click', () => {
      selectedWagon = i;
      rerender();
    });
    left.append(item);
  });
  const summary = h('div', { class: 'card small' },
    h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Couchettes'), h('span', null, `${crew.length} / ${bedCount(st.train)}`),
      h('span', { class: 'k' }, 'Charbon'), h('span', null, `${Math.floor(st.train.resources.charbon)} / ${coalCapacity(st.train)}`),
      h('span', { class: 'k' }, 'Soute'), h('span', null, `${Math.round(storageUsed(st.train))} / ${storageCapacity(st.train)}`),
      h('span', { class: 'k' }, 'Atelier'), h('span', null, workshopAvailable(game) ? 'disponible (installations possibles)' : 'aucun (gare avec atelier ou wagon-atelier requis)'),
    ),
  );
  left.append(summary);
  if (stationHas(game, 'wagons')) left.append(btn([icon('train', 15), 'Acheter des wagons'], () => { const lv = game.stationLevel(); if (lv) ui.openTrade(lv.node); }, 'small'));
  const right = wagonDetail(ui, game, wagons[selectedWagon], selectedWagon, rerender);
  return h('div', { class: 'cols' }, h('div', { class: 'stack' }, left), right);
}

function swapWagons(game: Game, a: number, b: number): void {
  const ws = game.state.train.wagons;
  if (a <= 0 || b <= 0) return;
  [ws[a], ws[b]] = [ws[b], ws[a]];
  game.train.rebuild();
  game.invalidateTrainInteractables();
  game.syncCrewActors(true);
  game.audio.play('build');
}

function wagonDetail(ui: UI, game: Game, w: WagonState, index: number, rerender: () => void): HTMLElement {
  const st = game.state;
  const def = WAGON_TYPES[w.type];
  const max = wagonMaxHp(st, w);
  const workshop = workshopAvailable(game);
  const card = h('div', { class: 'stack' });
  card.append(h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h3', null, `${index + 1}. ${def.name}`), h('span', { class: 'pill' }, `Armure ${Math.round(wagonArmor(st, w) * 100)} %`)),
    h('div', { class: 'muted small' }, def.desc),
    h('div', { style: 'margin-top:6px' }, bar(w.hp, max, 'hp big', `${Math.round(w.hp)} / ${max} PV`)),
    w.shield > 0 ? h('div', { style: 'margin-top:4px' }, bar(w.shield, 170 + 120, 'shield', `Bouclier ${Math.round(w.shield)}`)) : null,
    w.fire > 0 ? h('div', { class: 'pill bad', style: 'margin-top:6px' }, `Incendie ${Math.round(w.fire * 100)} % — maintenez E à l'intérieur pour l'éteindre`) : null,
    w.hp < max ? h('div', { class: 'small muted', style: 'margin-top:6px' }, `Réparation : maintenez E près du panneau de maintenance du wagon (1 ferraille = ${BAL.hpPerScrap} PV), affectez un mécanicien, ou payez l'atelier d'une gare.`) : null,
  ));
  // composants intérieurs
  const comps = h('div', { class: 'card' }, h('h4', null, 'Équipements intérieurs'));
  if (def.insulation > 0) {
    comps.append(compRow('Chauffage / ventilation', w.heater, () => { w.heater.on = !w.heater.on; rerender(); }));
    comps.append(h('div', { class: 'small muted' }, `Température : ${Math.round(w.temp)} °C (dehors ${Math.round(game.extTempCache)} °C)`));
  }
  comps.append(compRow(w.type === 'generateur' ? 'Éclairage' : 'Éclairage', w.lights, () => { w.lights.on = !w.lights.on; rerender(); }));
  if (w.type === 'generateur') comps.append(h('div', { class: 'row' }, h('span', { class: 'grow' }, `Turbine auxiliaire (+${def.power} énergie, consomme du charbon)`), btn(w.heater.on ? 'Arrêter' : 'Démarrer', () => { w.heater.on = !w.heater.on; rerender(); }, 'small')));
  card.append(comps);
  // emplacements de toit
  if (w.slots.length) {
    const slots = h('div', { class: 'card' }, h('h4', null, w.type === 'plateforme' ? 'Emplacements d\'armes (plateforme)' : 'Emplacements de toit'));
    w.slots.forEach((s, si) => {
      if (!s.equip) {
        const spare = st.train.spare.equip;
        const sel = h('select', { disabled: !workshop || spare.length === 0 }) as HTMLSelectElement;
        sel.append(h('option', { value: '' }, spare.length ? 'Installer…' : 'Aucun équipement en stock'));
        spare.forEach((e, k) => sel.append(h('option', { value: String(k) }, `${EQUIPMENT[e.id].name}${e.level ? ` +${e.level}` : ''}`)));
        sel.addEventListener('change', () => {
          const k = Number(sel.value);
          if (!Number.isFinite(k) || sel.value === '') return;
          const e = spare.splice(k, 1)[0];
          w.slots[si] = { ...newSlot(e.id), level: e.level };
          game.train.rebuild();
          game.invalidateTrainInteractables();
          game.audio.play('build');
          rerender();
        });
        slots.append(h('div', { class: 'item' }, h('span', { class: 'grow muted' }, `Emplacement ${si + 1} : vide`), sel));
        return;
      }
      const e = EQUIPMENT[s.equip];
      const gunnerSel = h('select') as HTMLSelectElement;
      if (e.weapon) {
        gunnerSel.append(h('option', { value: '' }, s.gunner === 'joueur' ? 'Vous' : 'Aucun tireur'));
        for (const n of crewOnBoard(st)) {
          if (n.status !== 'equipage') continue;
          const o = h('option', { value: n.id }, `${n.name} (${SKILLS[n.skill].name})`) as HTMLOptionElement;
          if (n.job === 'tireur' && n.jobTarget === `${w.uid}:${si}`) o.selected = true;
          gunnerSel.append(o);
        }
        gunnerSel.addEventListener('change', () => {
          // retire les anciens tireurs de ce poste
          for (const n of crewOnBoard(st)) if (n.job === 'tireur' && n.jobTarget === `${w.uid}:${si}` && n.id !== gunnerSel.value) game.crewSystem.assignJob(n, 'repos');
          const n = st.npcs[gunnerSel.value];
          if (n) game.crewSystem.assignJob(n, 'tireur', `${w.uid}:${si}`);
          window.setTimeout(rerender, 50);
        });
      }
      const up = equipUpgradeCost(e, s.level + 1);
      slots.append(h('div', { class: 'item' },
        icon(e.icon, 20, '#e3a83c'),
        h('div', { class: 'grow' },
          h('div', { class: 'name' }, `${e.name}${s.level ? ` +${s.level}` : ''}`),
          bar(s.hp, e.hp, s.hp < e.hp * 0.3 ? 'hp thin' : 'st thin'),
          h('div', { class: 'sub' }, `${e.operator === 'required' ? 'Tireur requis' : e.operator === 'optional' ? (s.auto ? 'Mode automatique' : 'Manuel uniquement') : 'Automatique'} · ${e.power} énergie (${CHANNEL_NAMES[e.channel]})${s.hp <= 0 ? ' · HORS SERVICE' : ''}`),
        ),
        h('div', { class: 'stack', style: 'align-items:flex-end' },
          h('div', { class: 'row' },
            btn(s.on ? 'Activé' : 'Coupé', () => { s.on = !s.on; rerender(); }, `small ${s.on ? 'active' : ''}`),
            e.operator === 'optional' ? btn(s.auto ? 'Auto' : 'Manuel', () => { s.auto = !s.auto; rerender(); }, 'small') : null,
          ),
          e.weapon ? gunnerSel : null,
          workshop ? h('div', { class: 'row' },
            s.level < 3 ? btn(`Améliorer (${up.jetons} J, ${up.ferraille} F)`, () => {
              if ((st.train.resources.jetons ?? 0) < up.jetons || (st.train.resources.ferraille ?? 0) < up.ferraille) return ui.toast('Ressources insuffisantes.', 'mauvais');
              st.train.resources.jetons -= up.jetons;
              st.train.resources.ferraille -= up.ferraille;
              s.level++;
              s.hp = e.hp;
              game.train.rebuild();
              game.audio.play('build');
              rerender();
            }, 'tiny') : null,
            btn('Retirer', () => {
              for (const n of crewOnBoard(st)) if (n.job === 'tireur' && n.jobTarget === `${w.uid}:${si}`) game.crewSystem.assignJob(n, 'repos');
              st.train.spare.equip.push({ id: s.equip!, level: s.level });
              w.slots[si] = newSlot();
              if (game.player.mounted?.slot === s) game.player.dismount();
              game.train.rebuild();
              game.invalidateTrainInteractables();
              rerender();
            }, 'tiny'),
          ) : null,
        ),
      ));
    });
    if (!workshop) slots.append(h('div', { class: 'small muted' }, 'Installer, retirer ou améliorer un équipement nécessite un atelier (gare ou wagon-atelier).'));
    card.append(slots);
  }
  // décorations
  if (w.decor.length) {
    const deco = h('div', { class: 'card' }, h('h4', null, 'Décoration et confort'));
    w.decor.forEach((d, di) => {
      if (d) {
        deco.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, DECOR[d].name), h('div', { class: 'sub' }, `Moral +${DECOR[d].morale}${DECOR[d].power ? ` · ${DECOR[d].power} énergie` : ''}`)), btn('Ranger', () => {
          st.train.spare.decor.push(d);
          w.decor[di] = null;
          game.train.rebuild();
          game.invalidateTrainInteractables();
          rerender();
        }, 'tiny')));
      } else {
        const sel = h('select', { disabled: st.train.spare.decor.length === 0 }) as HTMLSelectElement;
        sel.append(h('option', { value: '' }, st.train.spare.decor.length ? 'Placer…' : 'Aucune décoration en stock'));
        st.train.spare.decor.forEach((dd, k) => sel.append(h('option', { value: String(k) }, DECOR[dd].name)));
        sel.addEventListener('change', () => {
          if (sel.value === '') return;
          const dd = st.train.spare.decor.splice(Number(sel.value), 1)[0];
          w.decor[di] = dd;
          game.train.rebuild();
          game.invalidateTrainInteractables();
          game.audio.play('build');
          rerender();
        });
        deco.append(h('div', { class: 'item' }, h('span', { class: 'grow muted' }, `Emplacement ${di + 1} : libre`), sel));
      }
    });
    card.append(deco);
  }
  // occupants
  const occ = crewOnBoard(st).filter((n) => n.wagon === w.uid);
  const occCard = h('div', { class: 'card' }, h('h4', null, `Occupants (${occ.length})`));
  for (const n of occ) occCard.append(h('div', { class: 'row small' }, portrait(n), h('span', { class: 'grow' }, n.name), h('span', { class: 'muted' }, JOBS[n.job].name)));
  const actions = h('div', { class: 'row wrap' });
  if (occ.length && index > 0) actions.append(btn('Évacuer vers l\'avant', () => { game.crewSystem.evacuate(index); window.setTimeout(rerender, 100); }, 'small'));
  if (index > 0) actions.append(btn('Dételer à partir d\'ici', () => {
    ui.eventDialog('Dételer', `Détacher le wagon ${index + 1} et tous ceux qui suivent (${st.train.wagons.length - index} wagon(s)) ? Leurs occupants seront perdus.`, [
      { text: 'Dételer', action: () => { game.train.detachFrom(index, 'manuel'); ui.closeAll(); } },
      { text: 'Annuler', action: () => undefined },
    ]);
  }, 'small danger'));
  if (stationHas(game, 'atelier') && w.type !== 'locomotive' && w.armor < 3) {
    const c = wagonArmorCost(w.armor + 1);
    actions.append(btn(`Blinder (+1) : ${c.jetons} J, ${c.ferraille} F`, () => {
      if ((st.train.resources.jetons ?? 0) < c.jetons || (st.train.resources.ferraille ?? 0) < c.ferraille) return ui.toast('Ressources insuffisantes.', 'mauvais');
      st.train.resources.jetons -= c.jetons;
      st.train.resources.ferraille -= c.ferraille;
      w.armor++;
      w.hp = wagonMaxHp(st, w);
      game.audio.play('build');
      rerender();
    }, 'small'));
  }
  if (stationHas(game, 'wagons') && index > 0) actions.append(btn('Vendre ce wagon', () => {
    const err = game.economy.sellWagon(index);
    if (err) ui.toast(err, 'mauvais');
    selectedWagon = 0;
    rerender();
  }, 'small'));
  occCard.append(actions);
  card.append(occCard);
  if (w.type === 'locomotive') {
    const up = h('div', { class: 'card' }, h('h4', null, 'Améliorations de la locomotive'));
    for (const u of Object.values(LOCO_UPGRADES)) {
      const lvl = st.train.upgrades[u.id] ?? 0;
      const c = u.cost(lvl + 1);
      up.append(h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 'name' }, `${u.name} — niv. ${lvl}/${u.max}`), h('div', { class: 'sub' }, u.desc)),
        lvl < u.max ? btn(`${c.jetons} J, ${c.ferraille} F`, () => {
          if ((st.train.resources.jetons ?? 0) < c.jetons || (st.train.resources.ferraille ?? 0) < c.ferraille) return ui.toast('Ressources insuffisantes.', 'mauvais');
          st.train.resources.jetons -= c.jetons;
          st.train.resources.ferraille -= c.ferraille;
          st.train.upgrades[u.id] = lvl + 1;
          if (u.id === 'blindage') w.hp = wagonMaxHp(st, w);
          game.audio.play('build');
          rerender();
        }, 'small', { disabled: !stationHas(game, 'atelier') }) : h('span', { class: 'pill good' }, 'Max'),
      ));
    }
    if (!stationHas(game, 'atelier')) up.append(h('div', { class: 'small muted' }, 'Disponible dans les gares équipées d\'un atelier.'));
    card.append(up);
  }
  return card;
}

function compRow(label: string, c: { hp: number; on: boolean }, toggle: () => void): HTMLElement {
  return h('div', { class: 'row', style: 'margin:3px 0' },
    h('span', { class: 'grow' }, label, c.hp <= 0 ? h('span', { class: 'pill bad', style: 'margin-left:6px' }, 'Cassé') : c.hp < 100 ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, `${Math.round(c.hp)} %`) : null),
    btn(c.on ? 'Allumé' : 'Éteint', toggle, `small ${c.on ? 'active' : ''}`),
  );
}

// ================================================================== ÉNERGIE

function energyTab(ui: UI, game: Game, rerender: () => void): HTMLElement {
  const st = game.state;
  const tr = st.train;
  const pw = game.train.power;
  const wrap = h('div', { class: 'grid2' });
  const left = h('div', { class: 'stack' });
  const prod = pw?.production ?? 0;
  left.append(h('div', { class: 'card' },
    h('h3', null, 'Production'),
    h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Dynamo + générateurs'), h('span', null, `${prod.toFixed(1)} unités`),
      h('span', { class: 'k' }, 'Pression chaudière'), h('span', null, `${Math.round(tr.pressure * 100)} %`),
      h('span', { class: 'k' }, 'Batterie'), h('span', null, pw?.batteryCapacity ? `${Math.round(tr.power.battery)} / ${pw.batteryCapacity}${pw.batteryFlow > 0.05 ? ' (charge)' : pw.batteryFlow < -0.05 ? ' (décharge)' : ''}` : 'aucune'),
    ),
    h('div', { class: 'small muted', style: 'margin-top:6px' }, 'L\'énergie vient de la dynamo de la locomotive (selon la pression) et des wagons-générateurs. Chaque unité consommée brûle un peu plus de charbon.'),
  ));
  const auto = btn(tr.power.auto ? 'Répartition AUTOMATIQUE' : 'Répartition MANUELLE', () => {
    tr.power.auto = !tr.power.auto;
    rerender();
  }, `small ${tr.power.auto ? 'active' : ''}`);
  const alloc = h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, 'Répartition'), auto));
  for (const c of POWER_CHANNELS) {
    const demand = pw?.demand[c] ?? 0;
    const ratio = pw?.ratio[c] ?? 1;
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, value: tr.power.alloc[c], disabled: tr.power.auto }) as HTMLInputElement;
    const val = h('span', { class: 'small', style: 'width:42px;text-align:right' }, `${Math.round(tr.power.alloc[c])} %`);
    slider.addEventListener('input', () => {
      setAlloc(tr.power.alloc, c, Number(slider.value));
      for (const el of alloc.querySelectorAll('input[type=range]')) {
        const ch = (el as HTMLInputElement).dataset.ch as PowerChannel;
        (el as HTMLInputElement).value = String(Math.round(tr.power.alloc[ch]));
      }
      for (const el of alloc.querySelectorAll('[data-val]')) {
        const ch = (el as HTMLElement).dataset.val as PowerChannel;
        el.textContent = `${Math.round(tr.power.alloc[ch])} %`;
      }
    });
    slider.dataset.ch = c;
    val.dataset.val = c;
    alloc.append(h('div', { style: 'margin:8px 0' },
      h('div', { class: 'row between small' }, h('span', null, icon(c === 'lumiere' ? 'light' : c === 'chauffage' ? 'thermo' : c === 'armement' ? 'smg' : 'shield', 14), ' ', CHANNEL_NAMES[c]), h('span', { class: ratio < 0.6 ? '' : 'muted' }, `besoin ${demand.toFixed(1)} · fourni ${Math.round(ratio * 100)} %`)),
      h('div', { class: 'row' }, slider, val),
      bar(ratio, 1, ratio < 0.5 ? 'hp thin' : 'power thin'),
    ));
  }
  alloc.append(h('div', { class: 'small muted' }, 'Le surplus d\'un canal est redistribué aux autres, puis stocké en batterie. Lumière : moral et visibilité la nuit. Chauffage : température des wagons et ventilation (gaz, radiations). Armement : cadence des tourelles (la Tesla en dépend entièrement). Boucliers : régénération des dômes.'));
  left.append(alloc);
  const right = h('div', { class: 'stack' });
  const throttle = Math.max(1, tr.throttle);
  const coalMin = (coalRate(tr, throttle, game.crewSystem.stokerBonus().coalMult) + (pw?.used ?? 0) * BAL.coalPerPower) * 60;
  right.append(h('div', { class: 'card' },
    h('h3', null, 'Charbon'),
    bar(tr.resources.charbon, coalCapacity(tr), 'coal big', `${Math.floor(tr.resources.charbon)} / ${coalCapacity(tr)}`),
    h('div', { class: 'kv', style: 'margin-top:6px' },
      h('span', { class: 'k' }, `Consommation (${BAL.speedNames[throttle]})`), h('span', null, `${coalMin.toFixed(1)} / heure de jeu`),
      h('span', { class: 'k' }, 'Autonomie estimée'), h('span', null, `${(rangeEstimate(st, throttle, game.crewSystem.stokerBonus().coalMult, pw?.used ?? 8) / 1000).toFixed(1)} km`),
      h('span', { class: 'k' }, 'Chauffeur'), h('span', null, game.crewSystem.hasStoker() ? 'à son poste (économie de charbon)' : 'chargeur automatique'),
    ),
  ));
  const temps = h('div', { class: 'card' }, h('h3', null, `Températures (dehors ${Math.round(game.extTempCache)} °C)`));
  tr.wagons.forEach((w, i) => {
    const def = WAGON_TYPES[w.type];
    temps.append(h('div', { class: 'row small' },
      h('span', { style: 'width:20px' }, String(i + 1)),
      h('span', { class: 'grow' }, def.name),
      h('span', { style: `color:${w.temp < BAL.coldMoraleThreshold ? '#86d8ff' : w.temp > 30 ? '#ff9a6a' : '#cfe8b0'}` }, `${Math.round(w.temp)} °C`),
      def.insulation > 0 ? btn(w.heater.on ? 'Chauffage ON' : 'Chauffage OFF', () => { w.heater.on = !w.heater.on; rerender(); }, `tiny ${w.heater.on ? 'active' : ''}`) : h('span', { class: 'dim' }, 'ouvert'),
      btn(w.lights.on ? 'Lumière ON' : 'Lumière OFF', () => { w.lights.on = !w.lights.on; rerender(); }, `tiny ${w.lights.on ? 'active' : ''}`),
    ));
  });
  right.append(temps);
  wrap.append(left, right);
  return wrap;
}

/** Ajuste une part en redistribuant le reste proportionnellement (somme = 100). */
function setAlloc(alloc: Record<PowerChannel, number>, c: PowerChannel, v: number): void {
  const others = POWER_CHANNELS.filter((x) => x !== c);
  const rest = 100 - v;
  const sum = others.reduce((s, x) => s + alloc[x], 0);
  alloc[c] = v;
  for (const x of others) alloc[x] = sum > 0 ? (alloc[x] / sum) * rest : rest / others.length;
}

// ================================================================== ÉQUIPAGE

function crewTab(ui: UI, game: Game, rerender: () => void): HTMLElement {
  const st = game.state;
  const crew = crewOnBoard(st);
  const wrap = h('div', { class: 'stack' });
  const avgMorale = crew.length ? crew.reduce((s, n) => s + n.morale, 0) / crew.length : 0;
  wrap.append(h('div', { class: 'row wrap small' },
    h('span', { class: 'pill' }, `${crew.length} à bord · ${bedCount(st.train)} couchettes`),
    h('span', { class: `pill ${avgMorale < 30 ? 'bad' : avgMorale > 65 ? 'good' : ''}` }, `Moral moyen ${Math.round(avgMorale)}`),
    h('span', { class: 'pill' }, `Vivres : ${Math.floor(st.train.resources.nourriture ?? 0)} (≈ ${((st.train.resources.nourriture ?? 0) / Math.max(1, (crew.length + 1) * BAL.foodPerHour * 24)).toFixed(1)} jours)`),
  ));
  if (!crew.length) wrap.append(h('div', { class: 'muted' }, 'Personne à bord. Recrutez des volontaires dans les gares.'));
  for (const n of crew) wrap.append(crewRow(ui, game, n, rerender));
  return wrap;
}

function crewRow(ui: UI, game: Game, n: NpcState, rerender: () => void): HTMLElement {
  const st = game.state;
  const tags: HTMLElement[] = [];
  if (n.status === 'passager') tags.push(h('span', { class: 'pill info' }, n.fare ? `Passager → ${st.map.nodes[n.fare.destination]?.name ?? '?'} (${n.fare.reward} J)` : 'Passager'));
  if (n.status === 'prisonnier') tags.push(h('span', { class: 'pill bad' }, 'Prisonnier'));
  if (n.disease && (n.disease.known || n.disease.incubation <= 0)) tags.push(h('span', { class: 'pill bad' }, diseaseName(n.disease)));
  if (n.hunger > 2) tags.push(h('span', { class: 'pill warn' }, 'Affamé'));
  if (n.cold > 30) tags.push(h('span', { class: 'pill info' }, 'Gelé'));
  if (n.rads > 250) tags.push(h('span', { class: 'pill warn' }, `${Math.round(n.rads)} rads`));
  if (n.known.secret && n.secret) tags.push(h('span', { class: `pill ${n.secret === 'veteran' ? 'good' : 'bad'}` }, SECRETS[n.secret].name));
  const jobSel = h('select', { disabled: n.status !== 'equipage' }) as HTMLSelectElement;
  for (const j of Object.keys(JOBS) as JobId[]) {
    if (j === 'prisonnier' || j === 'tireur') continue;
    const o = h('option', { value: j }, JOBS[j].name + (JOBS[j].skill?.includes(n.skill) ? ' ★' : '')) as HTMLOptionElement;
    if (n.job === j) o.selected = true;
    jobSel.append(o);
  }
  if (n.job === 'tireur') jobSel.append(h('option', { value: 'tireur', selected: true }, 'Tireur (tourelle)'));
  jobSel.addEventListener('change', () => {
    game.crewSystem.assignJob(n, jobSel.value as JobId);
    window.setTimeout(rerender, 60);
  });
  const wagonSel = h('select', { disabled: n.status === 'prisonnier' }) as HTMLSelectElement;
  st.train.wagons.forEach((w, i) => {
    const o = h('option', { value: w.uid }, `${i + 1}. ${WAGON_TYPES[w.type].name}`) as HTMLOptionElement;
    if (n.wagon === w.uid) o.selected = true;
    wagonSel.append(o);
  });
  wagonSel.addEventListener('change', () => {
    game.crewSystem.moveToWagon(n, wagonSel.value);
    window.setTimeout(rerender, 60);
  });
  const a = game.crew.get(n.id);
  return h('div', { class: 'item' },
    portrait(n),
    h('div', { class: 'grow' },
      h('div', { class: 'row wrap' }, h('span', { class: 'name' }, n.name), h('span', { class: 'pill' }, `${SKILLS[n.skill].name} ${'★'.repeat(n.skillLevel)}`), h('span', { class: 'pill' }, n.known.personality ? PERSONALITIES[n.personality].name : 'Caractère ?'), ...tags),
      h('div', { class: 'row', style: 'margin-top:4px;gap:10px' },
        h('div', { style: 'width:110px' }, bar(n.hp, n.maxHp, 'hp thin')),
        h('div', { style: 'width:110px' }, bar(n.morale, 100, 'morale thin')),
        h('span', { class: 'small muted' }, `PV ${Math.round(n.hp)} · moral ${Math.round(n.morale)} · affinité ${Math.round(n.affinity)}`),
      ),
    ),
    h('div', { class: 'stack', style: 'align-items:flex-end' },
      h('div', { class: 'row' }, jobSel, wagonSel),
      h('div', { class: 'row' }, btn('Parler', () => { if (a) { ui.closeModal(); ui.openDialogue(a); } }, 'small', { disabled: !a })),
    ),
  );
}

// ================================================================== INVENTAIRE

function inventoryTab(ui: UI, game: Game, rerender: () => void): HTMLElement {
  const st = game.state;
  const p = st.player;
  const wrap = h('div', { class: 'grid2' });
  const left = h('div', { class: 'stack' });
  const grid = h('div', { class: 'inv-grid' });
  for (const id of RESOURCE_IDS) {
    const r = RESOURCES[id];
    grid.append(h('div', { class: 'inv-cell', title: r.desc }, icon(r.icon, 18, r.color === '#3a3a3a' ? '#9a9a9a' : r.color), h('span', null, r.short), h('span', { class: 'q' }, String(Math.floor(st.train.resources[id] ?? 0)))));
  }
  left.append(h('div', { class: 'card' }, h('h3', null, 'Réserves du convoi'),
    h('div', { class: 'row small', style: 'margin-bottom:6px' }, h('span', { class: 'muted' }, 'Soute'), h('div', { style: 'flex:1' }, bar(storageUsed(st.train), storageCapacity(st.train), 'power', `${Math.round(storageUsed(st.train))} / ${storageCapacity(st.train)}`))),
    grid,
  ));
  const weapons = h('div', { class: 'card' }, h('h3', null, 'Armes'));
  p.weapons.forEach((w, i) => {
    if (!w) {
      weapons.append(h('div', { class: 'item' }, h('b', null, String(i + 1)), h('span', { class: 'muted' }, 'Emplacement libre')));
      return;
    }
    const d = WEAPONS[w.id];
    weapons.append(h('div', { class: `item ${i === p.active ? 'sel' : ''}` },
      h('b', null, String(i + 1)), icon(d.icon, 20, '#e3a83c'),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, `${d.name}${w.level ? ` +${w.level}` : ''}`), h('div', { class: 'sub' }, `${d.desc} ${Math.round(d.damage * (1 + 0.15 * w.level))} dégâts${d.pellets ? `×${d.pellets}` : ''} · ${d.rate}/s${d.ammo ? ` · ${RESOURCES[d.ammo].short}` : ''}`)),
      btn('Prendre en main', () => { p.active = i; game.player.model.setWeapon(w.id); rerender(); }, 'tiny', { disabled: i === p.active }),
      w.id !== 'cle' ? btn('Jeter', () => {
        ui.eventDialog('Jeter l\'arme', `Abandonner ${d.name} ?`, [{ text: 'Jeter', action: () => { p.weapons[i] = null; if (p.active === i) p.active = 0; rerender(); } }, { text: 'Annuler', action: () => undefined }]);
      }, 'tiny danger') : null,
    ));
  });
  left.append(weapons);
  const right = h('div', { class: 'stack' });
  const gearCard = h('div', { class: 'card' }, h('h3', null, 'Équipement porté'));
  for (const slot of ['corps', 'tete'] as const) {
    const cur = p.gear[slot];
    gearCard.append(h('div', { class: 'item' },
      h('span', { class: 'muted', style: 'width:52px' }, slot === 'corps' ? 'Corps' : 'Tête'),
      h('div', { class: 'grow' }, cur ? h('div', { class: 'name' }, GEAR[cur].name) : h('span', { class: 'dim' }, 'rien'), cur ? h('div', { class: 'sub' }, GEAR[cur].desc) : null),
      cur ? btn('Retirer', () => { p.items[cur] = (p.items[cur] ?? 0) + 1; p.gear[slot] = null; game.player.refreshLook(); rerender(); }, 'tiny') : null,
    ));
  }
  right.append(gearCard);
  const items = h('div', { class: 'card' }, h('h3', null, 'Sac'));
  const ids = Object.keys(p.items).filter((k) => (p.items[k] ?? 0) > 0);
  if (!ids.length) items.append(h('div', { class: 'muted small' }, 'Vide.'));
  for (const id of ids) {
    const gear = GEAR[id];
    const equipable = gear && gear.slot !== 'outil';
    items.append(h('div', { class: 'item', title: personalItemDesc(id) },
      icon(personalItemIcon(id), 18, QUEST_ITEMS[id] ? '#e3a83c' : '#c8c0b0'),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, `${personalItemName(id)}${(p.items[id] ?? 0) > 1 ? ` ×${p.items[id]}` : ''}`), h('div', { class: 'sub' }, personalItemDesc(id))),
      equipable ? btn('Équiper', () => {
        const prev = p.gear[gear.slot as 'corps' | 'tete'];
        if (prev) p.items[prev] = (p.items[prev] ?? 0) + 1;
        p.gear[gear.slot as 'corps' | 'tete'] = id;
        p.items[id]--;
        if (p.items[id] <= 0) delete p.items[id];
        game.player.refreshLook();
        game.audio.play('pickup');
        rerender();
      }, 'tiny') : null,
      TOOLS[id] && id === 'lampe' ? h('span', { class: 'pill' }, 'F') : null,
    ));
  }
  right.append(items);
  const spare = st.train.spare;
  if (spare.equip.length || spare.decor.length) {
    right.append(h('div', { class: 'card' }, h('h3', null, 'En stock (à installer via Train)'),
      ...spare.equip.map((e) => h('div', { class: 'item small' }, icon(EQUIPMENT[e.id].icon, 16), `${EQUIPMENT[e.id].name}${e.level ? ` +${e.level}` : ''}`)),
      ...spare.decor.map((d) => h('div', { class: 'item small' }, icon('star', 16), DECOR[d].name)),
    ));
  }
  wrap.append(left, right);
  return wrap;
}

// ================================================================== JOURNAL

function journalTab(ui: UI, game: Game, rerender: () => void): HTMLElement {
  const st = game.state;
  const j = st.journal;
  const sub = h('div', { class: 'row', style: 'margin-bottom:10px' });
  const unresolved = j.incidents.filter((i) => !i.resolved).length;
  for (const [id, label] of [['quetes', 'Quêtes'], ['notes', `Notes (${j.notes.length})`], ['enquete', `Enquêtes${unresolved ? ` (${unresolved})` : ''}`], ['evenements', 'Événements']] as const) {
    sub.append(btn(label, () => { journalSub = id; rerender(); }, `small ${journalSub === id ? 'active' : ''}`));
  }
  const body = h('div', { class: 'stack' });
  if (journalSub === 'quetes') {
    const quests = [...st.quests].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.kind === 'principale' ? -1 : 1));
    if (!quests.length) body.append(h('div', { class: 'muted' }, 'Aucune quête. Parlez aux habitants des gares.'));
    for (const q of quests) {
      body.append(h('div', { class: `card ${q.kind === 'principale' ? 'sel' : ''}` },
        h('div', { class: 'row between' }, h('h3', null, q.title), h('span', { class: `pill ${q.status === 'active' ? 'warn' : q.status === 'terminee' ? 'good' : 'bad'}` }, q.status === 'active' ? 'En cours' : q.status === 'terminee' ? 'Terminée' : 'Échouée')),
        h('div', { class: 'muted small', style: 'margin:4px 0 6px' }, q.desc),
        ...q.objectives.map((o) => h('div', { class: 'row small', style: o.done ? 'color:var(--dim);text-decoration:line-through' : '' }, o.done ? '✔' : '◆', o.text + (o.count ? ` (${o.progress ?? 0}/${o.count})` : ''))),
        q.reward?.jetons ? h('div', { class: 'small', style: 'margin-top:4px' }, `Récompense : ${q.reward.jetons} jetons`) : null,
      ));
    }
  } else if (journalSub === 'notes') {
    if (!j.notes.length) body.append(h('div', { class: 'muted' }, 'Aucune note. Les documents trouvés en exploration (codes, indices, archives) s\'affichent ici.'));
    for (const n of [...j.notes].reverse()) {
      body.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, n.title), h('span', { class: 'small muted' }, `${st.map.nodes[n.station]?.name ?? ''} · jour ${Math.floor(n.time / 1440) + 1}`)), h('div', { class: 'small', style: 'line-height:1.5' }, n.text)));
    }
  } else if (journalSub === 'enquete') {
    body.append(h('div', { class: 'small muted' }, 'Vols, sabotages et messages radio suspects. Interrogez les témoins (« Avez-vous remarqué quelque chose ? »), recoupez les indices, puis confrontez le suspect ou fouillez ses affaires.'));
    const inc = h('div', { class: 'card' }, h('h3', null, 'Incidents'));
    if (!j.incidents.length) inc.append(h('div', { class: 'muted small' }, 'Rien à signaler.'));
    for (const i of j.incidents) inc.append(h('div', { class: 'item small', style: i.resolved ? 'opacity:.55' : '' }, h('span', { class: `pill ${i.resolved ? 'good' : 'bad'}` }, i.resolved ? 'Résolu' : i.kind), h('span', { class: 'grow' }, i.text), h('span', { class: 'muted' }, `${i.witnesses.length ? `${i.witnesses.length} témoin(s) possible(s)` : ''}`)));
    const clues = h('div', { class: 'card' }, h('h3', null, 'Indices'));
    if (!j.clues.length) clues.append(h('div', { class: 'muted small' }, 'Aucun indice pour l\'instant.'));
    for (const c of j.clues) clues.append(h('div', { class: 'item small' }, h('span', { class: 'muted' }, formatTime(c.time)), h('span', { class: 'grow' }, c.text)));
    const suspects = new Map<string, number>();
    for (const c of j.clues) if (c.npc) suspects.set(c.npc, (suspects.get(c.npc) ?? 0) + 1);
    const sus = h('div', { class: 'card' }, h('h3', null, 'Suspects'));
    if (!suspects.size) sus.append(h('div', { class: 'muted small' }, '—'));
    for (const [id, count] of [...suspects].sort((a, b) => b[1] - a[1])) {
      const n = st.npcs[id];
      if (n) sus.append(h('div', { class: 'item small' }, portrait(n), h('span', { class: 'grow' }, n.name, n.known.secret && n.secret ? h('span', { class: 'pill bad', style: 'margin-left:6px' }, SECRETS[n.secret].name) : null), h('span', { class: 'pill warn' }, `${count} indice(s)`)));
    }
    body.append(inc, clues, sus);
  } else {
    for (const l of j.log.slice(0, 80)) body.append(h('div', { class: 'item small' }, h('span', { class: 'muted', style: 'width:96px' }, `J${Math.floor(l.time / 1440) + 1} ${formatTime(l.time)}`), h('span', { class: 'grow', style: l.kind === 'mauvais' ? 'color:#ffb0a2' : l.kind === 'bon' ? 'color:#b8f0b0' : l.kind === 'quete' ? 'color:var(--amber)' : '' }, l.text)));
  }
  return h('div', null, sub, body);
}

// ================================================================== PERSONNAGE

function characterTab(ui: UI, game: Game, rerender: () => void): HTMLElement {
  const st = game.state;
  const p = st.player;
  const wrap = h('div', { class: 'grid2' });
  wrap.append(h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('h3', null, p.name),
      h('div', { class: 'row' }, h('span', { class: 'pill warn' }, `Niveau ${p.level}`), h('div', { style: 'flex:1' }, bar(p.xp, BAL.xpPerLevel(p.level), 'xp', `${p.xp} / ${BAL.xpPerLevel(p.level)} XP`))),
      p.pendingPerks > 0 ? h('div', { style: 'margin-top:8px' }, btn(`Choisir un atout (${p.pendingPerks})`, () => { ui.closeModal(); openPerkChoice(ui, game); }, 'primary')) : null,
      h('div', { class: 'kv', style: 'margin-top:8px' },
        h('span', { class: 'k' }, 'Santé'), h('span', null, `${Math.ceil(p.hp)} / ${game.player.maxHp}`),
        h('span', { class: 'k' }, 'Radiations'), h('span', null, (p.items.geiger ?? 0) > 0 ? `${Math.round(p.rads)} rads` : 'inconnues (compteur Geiger requis)'),
        h('span', { class: 'k' }, 'Maladie'), h('span', null, p.disease && p.disease.incubation <= 0 ? diseaseName(p.disease) : 'aucune'),
        h('span', { class: 'k' }, 'Gares visitées'), h('span', null, String(st.stats.stations)),
        h('span', { class: 'k' }, 'Distance'), h('span', null, `${fmt(st.stats.distance / 1000, 1)} km`),
        h('span', { class: 'k' }, 'Ennemis abattus'), h('span', null, String(st.stats.kills)),
        h('span', { class: 'k' }, 'Temps de jeu'), h('span', null, `${Math.floor(st.stats.playTime / 60)} min`),
      ),
    ),
  ));
  const perks = h('div', { class: 'card' }, h('h3', null, 'Atouts'));
  if (!p.perks.length) perks.append(h('div', { class: 'muted small' }, 'Aucun atout. Gagnez de l\'expérience (combats, quêtes, exploration) pour en obtenir.'));
  for (const id of p.perks) perks.append(h('div', { class: 'item' }, icon(PERKS[id].icon, 18, '#b083e8'), h('div', { class: 'grow' }, h('div', { class: 'name' }, PERKS[id].name), h('div', { class: 'sub' }, PERKS[id].desc))));
  wrap.append(perks);
  return wrap;
}

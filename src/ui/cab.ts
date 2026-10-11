import { h, btn, bar, clear } from './dom';
import { icon } from './icons';
import { renderMap } from './mapView';
import { BAL } from '../data/balance';
import { coalCapacity } from '../state/trainState';
import type { Game } from '../game/Game';
import type { UI } from './UI';

/** Poste de conduite : choix de destination en gare, régulateur et chaudière en route. */
export function openCab(ui: UI, game: Game): void {
  const body = h('div', { class: 'stack' });
  const st = game.state;
  const render = () => {
    clear(body);
    const tr = st.train;
    const travel = game.travelLevel();
    const controls = h('div', { class: 'card' });
    controls.append(h('div', { class: 'row between' },
      h('h3', null, travel ? `Vers ${travel.to.name} — ${((travel.length - travel.progress) / 1000).toFixed(1)} km` : 'Train à quai'),
      h('span', { class: 'pill' }, `${Math.round(game.train.speed * 3.6)} km/h`),
    ));
    const gauges = h('div', { class: 'grid3', style: 'margin-top:8px' },
      h('div', null, h('div', { class: 'small muted' }, 'Pression'), bar(tr.pressure, 1.15, 'power', `${Math.round(tr.pressure * 100)} %`)),
      h('div', null, h('div', { class: 'small muted' }, 'Surchauffe'), bar(tr.heat, 100, 'heat', `${Math.round(tr.heat)} %`)),
      h('div', null, h('div', { class: 'small muted' }, 'Charbon'), bar(tr.resources.charbon, coalCapacity(tr), 'coal', `${Math.floor(tr.resources.charbon)}`)),
    );
    controls.append(gauges);
    if (travel) {
      const thr = h('div', { class: 'row wrap', style: 'margin-top:10px' });
      BAL.speedNames.forEach((name, i) => thr.append(btn(name, () => { ui.throttle(0, i); render(); }, `small ${tr.throttle === i ? 'active' : ''}`)));
      controls.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Régulateur (raccourcis + / −)'), thr);
    }
    controls.append(h('div', { class: 'row wrap', style: 'margin-top:10px' },
      btn([icon('coal', 15), 'Coup de pelle (3 charbon)'], () => {
        if ((tr.resources.charbon ?? 0) < 3) return ui.toast('Plus assez de charbon.', 'mauvais');
        tr.resources.charbon -= 3;
        tr.pressure = Math.min(1.15, tr.pressure + 0.12);
        game.train.shovelBoost = game.player.hasPerk('chauffeur') ? 14 : 9;
        game.audio.play('shovel');
        render();
      }, 'small'),
      btn([icon('fire', 15), 'Purger la vapeur'], () => {
        tr.heat = Math.max(0, tr.heat - 45);
        tr.pressure = Math.max(0.3, tr.pressure - 0.25);
        game.engine.fx.steam(game.train.frontX - 4, 3, 1.6, game.train.speed, false);
        game.audio.play('chuff', { volume: 1 });
        render();
      }, 'small'),
      btn([icon('whistle', 15), 'Sifflet'], () => game.audio.play('whistle'), 'small'),
    ));
    controls.append(h('div', { class: 'small muted', style: 'margin-top:8px' }, '« Pleine vapeur » permet de distancer la plupart des monstres, mais fait monter la surchauffe et engloutit le charbon. Un chauffeur à la locomotive économise le charbon et permet de régler la vitesse depuis tout le train.'));
    body.append(controls);
    if (!travel) {
      body.append(h('h3', null, 'Choisir la destination'));
      body.append(renderMap(ui, game, true));
    }
  };
  render();
  ui.openModal(body, { title: 'Poste de conduite', className: '' });
}

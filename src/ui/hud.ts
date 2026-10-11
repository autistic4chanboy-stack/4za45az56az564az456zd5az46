import { h, bar, clear } from './dom';
import { icon } from './icons';
import { BAL } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/items';
import { WEAPONS } from '../data/weapons';
import { WAGON_TYPES } from '../data/train';
import { SEASON_NAMES, WEATHER_NAMES } from '../data/biomes';
import { formatTime } from '../core/math';
import { coalCapacity, wagonMaxHp, storageCapacity, storageUsed } from '../state/trainState';
import { diseaseName } from '../game/crewSystem';
import type { Game } from '../game/Game';
import type { UI } from './UI';

const RES_SHOWN: ResourceId[] = ['charbon', 'balles', 'cartouches', 'obus', 'cellules', 'ferraille', 'nourriture', 'medicaments', 'jetons'];

/** Affichage tête haute. Reconstruit partiellement à intervalle régulier pour rester léger. */
export class Hud {
  readonly el: HTMLDivElement;
  private status: HTMLDivElement;
  private top: HTMLDivElement;
  private res: HTMLDivElement;
  private weapon: HTMLDivElement;
  private train: HTMLDivElement;
  private obj: HTMLDivElement;
  private prompt: HTMLDivElement;
  private alert: HTMLDivElement;
  private fps: HTMLDivElement;
  private vHurt: HTMLDivElement;
  private vCold: HTMLDivElement;
  private vGas: HTMLDivElement;
  private vRad: HTMLDivElement;
  private markers: HTMLDivElement;
  private slowT = 0;
  private visible = false;

  constructor(private game: Game, private ui: UI) {
    this.vHurt = h('div', { class: 'vignette hurt' });
    this.vCold = h('div', { class: 'vignette cold' });
    this.vGas = h('div', { class: 'vignette gas' });
    this.vRad = h('div', { class: 'vignette rad' });
    this.status = h('div', { class: 'hud-panel hud-status' });
    this.top = h('div', { class: 'hud-panel hud-top' });
    this.res = h('div', { class: 'hud-panel hud-res' });
    this.weapon = h('div', { class: 'hud-panel hud-weapon' });
    this.train = h('div', { class: 'hud-panel hud-train interactive' });
    this.obj = h('div', { class: 'hud-panel hud-obj' });
    this.prompt = h('div', { class: 'hud-prompt' });
    this.alert = h('div', { class: 'hud-alert' });
    this.fps = h('div', { class: 'fps' });
    this.markers = h('div', { class: 'hud' });
    this.el = h('div', { class: 'hud', style: 'display:none' }, this.vRad, this.vGas, this.vCold, this.vHurt, this.markers, this.status, this.top, this.res, this.weapon, this.train, this.obj, this.prompt, this.alert, this.fps);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  update(dt: number): void {
    const g = this.game;
    if (!g.state || !g.train) {
      if (this.visible) this.setVisible(false);
      return;
    }
    if (!this.visible && !this.ui.menuOpen) this.setVisible(true);
    this.slowT -= dt;
    const st = g.state;
    const p = g.player;
    // vignettes
    this.vHurt.style.opacity = String(Math.min(1, p.hurtFlash + (st.player.hp < p.maxHp * 0.25 ? 0.35 + Math.sin(performance.now() / 300) * 0.15 : 0)));
    this.vCold.style.opacity = String(st.player.warmth < 40 ? (40 - st.player.warmth) / 40 : 0);
    const gas = g.hazardAt('gaz', p.x, p.z);
    this.vGas.style.opacity = gas > 0 ? (st.player.gear.tete === 'masque' && st.player.filter > 0 ? '0.25' : '0.7') : '0';
    const rad = g.radiationAt(p.x, p.z);
    this.vRad.style.opacity = String(Math.min(0.8, rad * 0.12));
    this.updatePrompt();
    if (this.slowT > 0) return;
    this.slowT = 0.2;
    this.renderStatus(rad);
    this.renderTop();
    this.renderRes();
    this.renderWeapon();
    this.renderTrain();
    this.renderObjectives();
    this.renderAlert();
    this.fps.textContent = g.settings.showFps ? `${Math.round(g.fps)} i/s` : '';
  }

  private renderStatus(rad: number): void {
    const g = this.game;
    const st = g.state.player;
    const p = g.player;
    const hasGeiger = (st.items.geiger ?? 0) > 0;
    const temp = g.localTemp();
    clear(this.status);
    const rows: (HTMLElement | null)[] = [
      h('div', { class: 'hud-row' }, icon('heart', 15, '#e5574a'), bar(st.hp, p.maxHp, 'hp', `${Math.ceil(st.hp)} / ${p.maxHp}`)),
      h('div', { class: 'hud-row' }, icon('run', 15, '#9ad06a'), bar(st.stamina, BAL.staminaMax, 'st thin')),
      h('div', { class: 'hud-row' }, icon('thermo', 15, st.warmth < 35 ? '#86d8ff' : '#e0a050'), bar(st.warmth, 100, 'warm', `${Math.round(temp)} °C`)),
      hasGeiger ? h('div', { class: 'hud-row' }, icon('radiation', 15, '#c8f040'), bar(st.rads, BAL.radLethal, 'rad', `${Math.round(st.rads)} rads${rad > 0.05 ? ` · +${rad.toFixed(1)}/s` : ''}`)) : st.rads > 250 ? h('div', { class: 'hud-row' }, h('span', { class: 'hud-tag bad' }, 'Mal des rayons')) : null,
      h('div', { class: 'hud-row' }, h('span', { class: 'hud-tag' }, `Niv. ${st.level}`), bar(st.xp, BAL.xpPerLevel(st.level), 'xp thin'), st.pendingPerks > 0 ? h('span', { class: 'hud-tag good' }, 'Atout ! (P)') : null),
      h('div', { class: 'hud-row' },
        st.disease && st.disease.incubation <= 0 ? h('span', { class: 'hud-tag bad' }, diseaseName(st.disease)) : null,
        st.gear.tete === 'masque' ? h('span', { class: `hud-tag ${st.filter <= 0 ? 'bad' : ''}` }, `Filtre ${Math.ceil(st.filter)} s (${g.state.train.resources.filtres ?? 0})`) : null,
        st.gear.corps ? h('span', { class: 'hud-tag' }, st.gear.corps === 'combinaison' ? 'Combinaison' : st.gear.corps === 'manteau' ? 'Manteau' : st.gear.corps === 'armure' ? 'Gilet' : 'Polaire') : null,
        p.flashlightOn && (st.items.lampe ?? 0) > 0 && (g.isNight() || g.levelDarkness() > 0.3) ? h('span', { class: 'hud-tag' }, 'Lampe (F)') : null,
      ),
    ];
    for (const r of rows) if (r) this.status.append(r);
  }

  private renderTop(): void {
    const g = this.game;
    const st = g.state;
    clear(this.top);
    const day = Math.floor(st.time / 1440) + 1;
    const env = g.level?.env;
    const sub = h('div', { class: 'sub' },
      h('span', null, `Jour ${day} · ${formatTime(st.time)}`),
      h('span', null, SEASON_NAMES[st.season]),
      env ? h('span', null, WEATHER_NAMES[env.weather]) : null,
      h('span', null, `${Math.round(g.extTempCache)} °C dehors`),
    );
    const travel = g.travelLevel();
    if (travel) {
      const remain = Math.max(0, travel.length - travel.progress);
      this.top.append(
        h('div', { class: 'loc' }, `En route vers ${travel.to.name}`),
        h('div', { class: 'route' }, h('span', { class: 'muted' }, travel.from.name), bar(travel.progress, travel.length, 'power'), h('span', null, `${(remain / 1000).toFixed(1)} km`)),
        sub,
      );
    } else {
      const node = st.map.nodes[st.map.current];
      this.top.append(h('div', { class: 'loc' }, node?.name ?? ''), sub);
    }
  }

  private renderRes(): void {
    const g = this.game;
    const r = g.state.train.resources;
    clear(this.res);
    for (const id of RES_SHOWN) {
      const v = Math.floor(r[id] ?? 0);
      const def = RESOURCES[id];
      const low = (id === 'charbon' && v < 30) || (id === 'nourriture' && v < 8) || (id === 'balles' && v < 20);
      const label = id === 'charbon' ? `${v}/${coalCapacity(g.state.train)}` : String(v);
      this.res.append(h('div', { class: `res ${low ? 'low' : ''}`, title: def.name }, icon(def.icon, 15, def.color === '#3a3a3a' ? '#9a9a9a' : def.color), label));
    }
    const used = storageUsed(g.state.train);
    const cap = storageCapacity(g.state.train);
    this.res.append(h('div', { class: `res ${used > cap * 0.95 ? 'low' : ''}`, title: 'Soute' }, icon('crate', 15, '#a08a6a'), `${Math.round((used / cap) * 100)}%`));
  }

  private renderWeapon(): void {
    const g = this.game;
    const st = g.state.player;
    const w = g.player.weaponDef();
    const inst = st.weapons[st.active];
    clear(this.weapon);
    const reserve = w.ammo ? Math.floor((g.state.train.resources[w.ammo] ?? 0) * (w.shotsPerAmmo ?? 1)) : null;
    this.weapon.append(
      h('div', { class: 'row between' }, h('div', { class: 'wname' }, w.name), inst && inst.level ? h('span', { class: 'pill warn' }, `+${inst.level}`) : null),
      h('div', { class: 'ammo' }, w.mag > 0 ? `${inst?.mag ?? 0} / ${reserve}` : w.ammo ? `${reserve}` : '∞'),
    );
    if (g.player.reloadT > 0) this.weapon.append(h('div', { class: 'reload-bar' }, bar(g.player.reloadTotal - g.player.reloadT, g.player.reloadTotal, 'power thin')));
    const slots = h('div', { class: 'slots' });
    st.weapons.forEach((wi, i) => {
      slots.append(h('div', { class: `slot ${i === st.active ? 'on' : ''}`, title: wi ? WEAPONS[wi.id].name : 'Vide' }, h('b', null, String(i + 1)), wi ? icon(WEAPONS[wi.id].icon, 18) : ''));
    });
    this.weapon.append(slots);
    const r = g.state.train.resources;
    this.weapon.append(h('div', { class: 'quick' },
      h('span', null, h('span', { class: 'key' }, 'H'), ` ${r.trousses ?? 0}`),
      h('span', null, h('span', { class: 'key' }, 'X'), ` ${r.antirad ?? 0}`),
      h('span', null, h('span', { class: 'key' }, 'G'), ` ${r.dynamite ?? 0}`),
      h('span', null, h('span', { class: 'key' }, 'Tab'), ' gestion'),
    ));
  }

  private renderTrain(): void {
    const g = this.game;
    const st = g.state;
    const tr = st.train;
    const pw = g.train.power;
    clear(this.train);
    const kmh = Math.round(g.train.speed * 3.6);
    const travelling = g.isTravelling();
    const thr = h('div', { class: 'throttle' });
    BAL.speedNames.forEach((name, i) => {
      const b = h('button', { class: `btn small ${tr.throttle === i ? 'active' : ''}`, title: `Régulateur : ${name}` }, i === 0 ? 'Stop' : '▸'.repeat(i));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ui.throttle(0, i);
      });
      thr.append(b);
    });
    const scaleBtn = h('button', { class: `btn small ${g.timeScale > 1 ? 'active' : ''}`, title: 'Accélérer le temps (V)' }, `×${g.timeScale}`);
    scaleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ui.cycleTimeScale();
    });
    this.train.append(h('div', { class: 'row between' },
      h('div', { class: 'row' }, icon('train', 16, '#e3a83c'), h('b', null, travelling ? `${kmh} km/h` : 'À quai'), h('span', { class: 'muted small' }, BAL.speedNames[tr.throttle])),
      travelling ? scaleBtn : null,
    ));
    if (travelling) this.train.append(thr);
    const coalCap = coalCapacity(tr);
    const gauges = h('div', { class: 'gauges' },
      icon('coal', 13, '#9a9a9a'), bar(tr.resources.charbon ?? 0, coalCap, 'coal thin'), h('span', { class: 'val' }, `${Math.floor(tr.resources.charbon ?? 0)}`),
      icon('fire', 13, '#e07030'), bar(tr.pressure, 1.15, 'power thin'), h('span', { class: 'val' }, `${Math.round(tr.pressure * 100)} %`),
    );
    if (tr.heat > 1) gauges.append(icon('warning', 13, '#ff6a4a'), bar(tr.heat, 100, 'heat thin'), h('span', { class: 'val' }, 'Surchauffe'));
    if (pw) {
      const demand = pw.demand.lumiere + pw.demand.chauffage + pw.demand.armement + pw.demand.bouclier;
      gauges.append(icon('bolt', 13, '#ffe060'), bar(pw.production, Math.max(pw.production, demand), 'power thin'), h('span', { class: 'val' }, `${pw.production.toFixed(1)} / ${demand.toFixed(1)}`));
      if (pw.batteryCapacity > 0) gauges.append(icon('cell', 13, '#5fb3e6'), bar(tr.power.battery, pw.batteryCapacity, 'shield thin'), h('span', { class: 'val' }, `${Math.round(tr.power.battery)}`));
    }
    this.train.append(gauges);
    const wagons = h('div', { class: 'wagons' });
    const playerWagon = g.player.onTrain ? g.train.wagonAt(g.player.x) : -1;
    // affichage de l'avant (gauche) vers l'arrière
    st.train.wagons.forEach((w, i) => {
      const max = wagonMaxHp(st, w);
      const r = w.hp / max;
      const cls = r < BAL.criticalHp ? 'low' : r < 0.6 ? 'mid' : '';
      const alerts = (w.fire > 0 ? '🔥' : '') + (w.slots.some((s) => s.equip && s.hp <= 0) || w.heater.hp <= 0 ? '⚠' : '');
      const chip = h('div', { class: `wagon-chip ${cls} ${i === playerWagon ? 'player' : ''}`, title: `${i + 1}. ${WAGON_TYPES[w.type].name} — ${Math.round(w.hp)}/${max} PV · ${Math.round(w.temp)} °C` },
        h('div', { class: 'fill', style: `height:${Math.max(4, r * 100)}%` }),
        h('div', { class: 'lbl' }, String(i + 1)),
        alerts ? h('div', { class: 'alert' }, alerts) : null,
      );
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ui.lastDashTab = 'train';
        g.ui.openDashboard('train');
      });
      wagons.append(chip);
    });
    this.train.append(wagons);
  }

  private renderObjectives(): void {
    const g = this.game;
    clear(this.obj);
    const quests = g.state.quests.filter((q) => q.status === 'active');
    if (!quests.length) {
      this.obj.style.display = 'none';
      return;
    }
    this.obj.style.display = 'block';
    const main = quests.find((q) => q.kind === 'principale');
    const side = quests.filter((q) => q.kind === 'secondaire').slice(0, 2);
    for (const q of [main, ...side]) {
      if (!q) continue;
      this.obj.append(h('h4', null, q.title));
      for (const o of q.objectives) {
        if (o.done && q.kind === 'secondaire') continue;
        const prog = o.count ? ` (${o.progress ?? 0}/${o.count})` : '';
        this.obj.append(h('div', { class: `obj ${o.done ? 'done' : ''} ${o.optional ? 'opt' : ''}` }, h('span', { class: 'chk' }, o.done ? '✔' : '◆'), h('span', null, o.text + prog)));
      }
    }
  }

  private renderAlert(): void {
    const g = this.game;
    const lv = g.stationLevel();
    this.alert.className = 'hud-alert';
    this.alert.textContent = '';
    if (lv) {
      const timer = g.stationRadTimer(lv.node.id);
      if (timer !== null) {
        const left = timer - lv.delta.dwell;
        this.alert.textContent = left > 0 ? `Irradiation du train dans ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'TRAIN IRRADIÉ — PARTEZ !';
        if (left < 60) this.alert.className = 'hud-alert bad';
      }
    }
    const travel = g.travelLevel();
    if (travel && g.train.speed < 0.2 && !g.inCombat) {
      const block = g.events.canRestart();
      this.alert.textContent = block ?? (g.player.onTrain ? 'Train à l\'arrêt — réglez la vitesse pour repartir (+ / boutons)' : 'Train à l\'arrêt — remontez à bord');
    }
    if (g.inCombat) {
      const crit = g.state.train.wagons.findIndex((w, i) => i > 0 && w.hp <= 0);
      if (crit >= 0) {
        this.alert.textContent = `L'ATTELAGE DU WAGON ${crit + 1} CÈDE !`;
        this.alert.className = 'hud-alert bad';
      }
    }
    if (g.state.train.heat > 75) {
      this.alert.textContent = 'SURCHAUFFE DE LA CHAUDIÈRE — RALENTISSEZ';
      this.alert.className = 'hud-alert bad';
    }
  }

  private lastPrompt = '';

  private updatePrompt(): void {
    const g = this.game;
    const p = g.player;
    let html = '';
    if (p.mounted) {
      html = `<div class="prompt"><span class="key">E</span> Quitter la tourelle · Clic : tirer</div>`;
    } else if (p.focus && !g.ui.blocking) {
      const label = p.focus.label();
      if (label) {
        const hold = p.focus.hold?.() ?? 0;
        const prog = p.holdProgress;
        html = `<div class="prompt"><span class="key">E</span> ${escapeHtml(label)}${hold ? ` <span class="muted small">(maintenir)</span>` : ''}</div>${hold && prog > 0 ? `<div class="bar thin" style="width:200px"><div class="bar-fill" style="width:${Math.round(prog * 100)}%"></div></div>` : ''}`;
      }
    }
    if (html !== this.lastPrompt) {
      this.lastPrompt = html;
      this.prompt.innerHTML = html;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

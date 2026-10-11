import { BAL, DIFFICULTIES } from '../data/balance';
import { PERSONALITIES, SKILLS, INTERRO, RUMORS, BARKS, type JobId, type SkillId } from '../data/npcs';
import { DECOR, WAGON_TYPES, EQUIPMENT } from '../data/train';
import { RESOURCES, type ResourceId } from '../data/items';
import { clamp } from '../core/math';
import { formatTime } from '../core/math';
import { crewOnBoard, bedCount, addResource, wagonMorale } from '../state/trainState';
import type { Game } from './Game';
import type { NpcState, PlayerState, Incident, DiseaseState } from '../state/types';
import type { NpcActor } from './npcActor';

export type InterroApproach = 'amical' | 'direct' | 'menace' | 'fouille' | 'soupcons';

export interface InterroResult {
  text: string;
  revealed: string[];
  confession: boolean;
}

const DISEASES: Record<string, { name: string; rate: number; contagious: boolean; lethal: boolean; dps: number }> = {
  fievre: { name: 'Fièvre Grise', rate: 0.0011, contagious: true, lethal: true, dps: 0.12 },
  grippe: { name: 'Grippe', rate: 0.0012, contagious: true, lethal: false, dps: 0.04 },
  infection: { name: 'Infection', rate: 0.0016, contagious: false, lethal: true, dps: 0.09 },
  rayons: { name: 'Mal des rayons', rate: 0.0008, contagious: false, lethal: true, dps: 0.07 },
};

export function diseaseName(d: DiseaseState | null): string {
  return d ? DISEASES[d.id]?.name ?? d.id : '';
}

export class CrewSystem {
  private foodAcc = 0;
  private combatShock = 0;
  private partyBonus = 0;
  private lastHungerWarn = 0;

  constructor(private game: Game) {}

  private get st() {
    return this.game.state;
  }

  aboard(): NpcState[] {
    return crewOnBoard(this.st);
  }

  hasSkill(skill: SkillId): boolean {
    return this.aboard().some((n) => n.skill === skill && n.status !== 'prisonnier');
  }

  bestSkill(skill: SkillId): number {
    let best = 0;
    for (const n of this.aboard()) if (n.skill === skill && n.status !== 'prisonnier') best = Math.max(best, n.skillLevel);
    return best;
  }

  /** Bonus du chauffeur : économie de charbon et surchauffe réduite. */
  stokerBonus(): { coalMult: number; heatRelief: number } {
    let best: NpcState | null = null;
    for (const n of this.aboard()) {
      if (n.job !== 'chauffeur') continue;
      const a = this.game.crew.get(n.id);
      if (!a || !a.alive) continue;
      if (!best || (n.skill === 'chauffeur' ? n.skillLevel + 1 : 0) > (best.skill === 'chauffeur' ? best.skillLevel + 1 : 0)) best = n;
    }
    if (!best) return { coalMult: 1, heatRelief: 0 };
    const lvl = best.skill === 'chauffeur' ? best.skillLevel : 0;
    const morale = best.morale < 25 ? 0.5 : best.morale > 75 ? 1.1 : 1;
    return { coalMult: 1 - (0.06 + 0.07 * lvl) * morale, heatRelief: 0.4 + lvl * 0.35 };
  }

  hasStoker(): boolean {
    return this.aboard().some((n) => n.job === 'chauffeur' && this.game.crew.get(n.id)?.alive);
  }

  engineerBonus(): number {
    return this.bestSkill('ingenieur') * 0.06;
  }

  wagonWithFreeBed(): number | null {
    const train = this.game.train;
    const counts = new Map<string, number>();
    for (const n of this.aboard()) if (n.wagon) counts.set(n.wagon, (counts.get(n.wagon) ?? 0) + 1);
    for (const w of train.wagons) {
      const beds = WAGON_TYPES[w.state.type].beds;
      if (beds > (counts.get(w.state.uid) ?? 0)) return w.index;
    }
    return null;
  }

  // ------------------------------------------------------------------ boucle 1 Hz

  tick(dt: number): void {
    const st = this.st;
    const g = this.game;
    const crew = this.aboard();
    const diff = DIFFICULTIES[st.difficulty];
    // --- vivres
    const consumers = crew.length + 1;
    const kitchen = st.train.wagons.some((w) => w.type === 'restaurant' && w.hp > 0);
    const cook = crew.find((n) => n.job === 'cuisinier' && n.skill === 'cuisinier');
    let mult = kitchen ? 0.85 : 1;
    if (cook && kitchen) mult -= 0.05 * cook.skillLevel;
    this.foodAcc += (consumers * BAL.foodPerHour / 60) * mult * dt;
    let starving = false;
    while (this.foodAcc >= 1) {
      this.foodAcc -= 1;
      if ((st.train.resources.nourriture ?? 0) >= 1) st.train.resources.nourriture -= 1;
      else starving = true;
    }
    if ((st.train.resources.nourriture ?? 0) < 1) starving = true;
    if (starving && st.time - this.lastHungerWarn > 120) {
      this.lastHungerWarn = st.time;
      g.ui.toast('Les vivres sont épuisés ! L\'équipage a faim.', 'mauvais');
    }
    // --- serre
    for (const w of st.train.wagons) {
      if (w.type !== 'serre' || w.hp <= 0) continue;
      const light = g.train.power?.ratio.lumiere ?? 1;
      const warm = w.temp > 8 ? 1 : 0.2;
      const farmer = crew.find((n) => n.job === 'jardinier');
      const f = farmer ? (farmer.skill === 'agronome' ? 2 + 0.3 * farmer.skillLevel : 1.3) : 1;
      st.train.greenhouse += (dt / 90) * light * warm * f * (w.lights.on ? 1 : 0.2);
      while (st.train.greenhouse >= 1) {
        st.train.greenhouse -= 1;
        addResource(st, 'nourriture', 1);
      }
    }
    // --- moral global
    const artist = crew.filter((n) => n.skill === 'artiste').reduce((s, n) => s + n.skillLevel, 0);
    const hasMusic = st.train.wagons.some((w) => w.decor.some((d) => d === 'jukebox' || d === 'piano'));
    const globalBonus = artist * 3 * (hasMusic ? 1.5 : 1) + (g.player.hasPerk('meneur') ? 8 : 0) + this.partyBonus + (bedCount(st.train) < crew.length ? -10 : 0) + st.train.wagons.filter((w) => w.type === 'salon').length * 2;
    this.combatShock = Math.max(0, this.combatShock - dt * 0.05);
    this.partyBonus = Math.max(0, this.partyBonus - dt * 0.02);
    const night = g.isNight();
    const scientist = crew.find((n) => n.skill === 'scientifique' && n.job === 'medecin');
    for (const n of crew) {
      const p = PERSONALITIES[n.personality];
      const wagon = st.train.wagons.find((w) => w.uid === n.wagon);
      const wi = wagon ? st.train.wagons.indexOf(wagon) : -1;
      const temp = wagon ? wagon.temp : g.extTempCache;
      let target = p.moraleBase + globalBonus + n.affinity * 0.1;
      if (wagon) target += wagonMorale(wagon) * 1.5;
      if (temp < BAL.coldMoraleThreshold) target -= (BAL.coldMoraleThreshold - temp) * 1.5;
      if (temp > 30) target -= temp - 30;
      if (starving) {
        n.hunger += dt / 60;
        target -= Math.min(40, n.hunger * BAL.hungerMorale);
      } else n.hunger = Math.max(0, n.hunger - dt / 30);
      if (night && wi >= 0 && g.train.lightAt(wi) < 0.4) target -= n.personality === 'peureux' ? 15 : 4;
      if (p.bravery < 0.6) target -= this.combatShock * (1 - p.bravery) * 20;
      if (n.disease && n.disease.incubation <= 0) target -= 10;
      if (n.status === 'prisonnier') target -= 20;
      const mates = crew.filter((m) => m !== n && m.wagon === n.wagon);
      for (const m of mates) {
        if (m.personality === 'jovial') target += 3;
        if (m.personality === 'colerique') target -= 2;
      }
      target = clamp(target, 0, 100);
      n.morale += clamp(target - n.morale, -0.6 * dt, 0.5 * dt);
      // froid et faim : santé
      if (temp < BAL.freezeThreshold) {
        n.cold += dt;
        n.hp -= 0.1 * dt;
        if (Math.random() < 0.002 * dt * diff.disease && !n.disease) n.disease = { id: 'grippe', severity: 0, incubation: 30, known: false, treated: 0 };
      } else if (temp < 8) {
        if (Math.random() < 0.0006 * dt * diff.disease && !n.disease) n.disease = { id: 'grippe', severity: 0, incubation: 60, known: false, treated: 0 };
      } else n.cold = Math.max(0, n.cold - dt);
      if (n.hunger > 12) n.hp -= 0.05 * dt;
      // radiations
      if (scientist) n.rads = Math.max(0, n.rads - 0.4 * scientist.skillLevel * dt);
      n.maxHp = n.rads >= 750 ? 50 : n.rads >= 500 ? 75 : n.rads >= 250 ? 90 : 100;
      if (n.rads >= BAL.radLethal) n.hp -= 1 * dt;
      // repos : récupération lente
      if (!g.inCombat && n.hp < n.maxHp && !starving && temp > 10) n.hp = Math.min(n.maxHp, n.hp + 0.02 * dt * (wagon?.type === 'infirmerie' ? 3 : 1));
      if (n.hp > n.maxHp) n.hp = n.maxHp;
      this.progressDisease(n, dt, false);
      if (n.hp <= 0) {
        const a = g.crew.get(n.id);
        if (a && a.alive) a.damage(1, { faction: 'neutre', x: a.x, z: a.z, kind: n.hunger > 12 ? 'faim' : 'maladie' });
        else n.status = 'mort';
      }
      // timers des secrets
      this.secretBehaviour(n, dt);
    }
    this.contagion(dt);
  }

  // ------------------------------------------------------------------ maladies

  progressDisease(who: NpcState | PlayerState, dt: number, isPlayer: boolean): void {
    const d = who.disease;
    if (!d) return;
    const def = DISEASES[d.id];
    if (!def) return;
    if (d.incubation > 0) {
      if (d.incubation > 9000) return;
      d.incubation -= dt;
      if (d.incubation <= 0) {
        d.known = true;
        if (isPlayer) this.game.ui.toast(`Vous êtes malade : ${def.name}. Soignez-vous (médecin, médicaments).`, 'mauvais');
        else if (this.game.crew.has((who as NpcState).id)) this.game.ui.toast(`${(who as NpcState).name} présente des symptômes : ${def.name}.`, 'mauvais');
      }
      return;
    }
    const diff = DIFFICULTIES[this.st.difficulty];
    const treated = d.treated > 0;
    if (treated) d.treated = Math.max(0, d.treated - dt);
    const rate = def.rate * diff.disease * (treated ? -1.2 : 1) * (isPlayer && this.game.player.hasPerk('infirmier') ? 0.7 : 1);
    d.severity = clamp(d.severity + rate * dt, 0, 1);
    if (d.id === 'grippe' && d.severity >= 0.7 && Math.random() < 0.004 * dt) d.treated = 60;
    if (d.severity <= 0 && treated) {
      who.disease = null;
      if (isPlayer) this.game.ui.toast('Vous êtes guéri.', 'bon');
      return;
    }
    if (d.severity > 0.55) {
      const dmg = def.dps * (d.severity - 0.4) * dt * (def.lethal ? 1.6 : 0.6);
      if (isPlayer) {
        if (!def.lethal && this.st.player.hp < 20) return;
        if (def.lethal) this.game.player.damage(dmg, { faction: 'neutre', x: this.game.player.x, z: this.game.player.z, kind: 'maladie' });
        else this.st.player.hp = Math.max(15, this.st.player.hp - dmg);
      } else {
        const n = who as NpcState;
        n.hp -= dmg;
        if (!def.lethal) n.hp = Math.max(10, n.hp);
      }
    }
  }

  private contagion(dt: number): void {
    const st = this.st;
    const crew = this.aboard();
    const diff = DIFFICULTIES[st.difficulty];
    const p = BAL.contagionPerHour / 60 * dt * diff.disease;
    for (const sick of crew) {
      const d = sick.disease;
      if (!d || !DISEASES[d.id]?.contagious) continue;
      if (d.incubation > 0 && d.incubation < 9000) continue;
      const wagon = st.train.wagons.find((w) => w.uid === sick.wagon);
      let anti = 0;
      if (wagon) for (const dec of wagon.decor) if (dec) anti += DECOR[dec].antiDisease ?? 0;
      const quarantine = wagon?.type === 'infirmerie' ? 0.15 : 1;
      const chance = p * (1 - Math.min(0.8, anti)) * quarantine * (d.id === 'grippe' ? 0.7 : 1);
      for (const other of crew) {
        if (other === sick || other.disease || other.wagon !== sick.wagon) continue;
        if (Math.random() < chance) other.disease = { id: d.id, severity: 0, incubation: 90 + Math.random() * 120, known: false, treated: 0 };
      }
      // le joueur dans le même wagon
      const pl = this.game.player;
      if (pl.onTrain && wagon && !st.player.disease) {
        const wi = this.game.train.wagonAt(pl.x);
        if (this.game.train.wagons[wi]?.state.uid === wagon.uid && Math.random() < chance * 0.6) this.game.infectPlayer(d.id);
      }
    }
  }

  /** Patient prioritaire pour un médecin. */
  mostNeedyPatient(medic: NpcActor): NpcActor | null {
    let best: NpcActor | null = null;
    let score = 0;
    for (const a of this.game.crew.values()) {
      if (!a.alive || a === medic) continue;
      const n = a.data;
      let s = 0;
      if (n.disease && (n.disease.known || medic.data.skill === 'medecin')) s += 40 + n.disease.severity * 60;
      if (n.hp < n.maxHp * 0.7) s += (1 - n.hp / n.maxHp) * 60;
      if (n.rads > 150 && medic.data.skill === 'scientifique') s += n.rads / 10;
      if (s > score) {
        score = s;
        best = a;
      }
    }
    return score > 10 ? best : null;
  }

  treat(medic: NpcActor, patient: NpcActor, dt: number): void {
    const g = this.game;
    const n = patient.data;
    const res = g.state.train.resources;
    const skill = medic.data.skill === 'medecin' ? medic.data.skillLevel : medic.data.skill === 'scientifique' ? medic.data.skillLevel * 0.6 : 0.3;
    const medbay = patient.isInWagonType('infirmerie') ? 2 : 1;
    // diagnostic des maladies cachées (porteurs inclus)
    if (n.disease && !n.disease.known && medic.data.skill === 'medecin') {
      n.disease.known = true;
      g.ui.toast(`${medic.data.name} a diagnostiqué ${diseaseName(n.disease)} chez ${n.name}${n.disease.incubation > 9000 ? ' (porteur sain !)' : ''}.`, 'info');
      if (n.secret === 'porteur') n.known.secret = true;
    }
    if (n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + 1.2 * skill * medbay * dt);
    if (n.disease && n.disease.known && n.disease.treated <= 0) {
      if ((res.medicaments ?? 0) >= 1) {
        res.medicaments -= 1;
        n.disease.treated = 40 * skill * medbay;
        if (n.disease.incubation > 9000) {
          // porteur sain : traitement complet
          n.disease = null;
        }
        g.engine.fx.heal(patient.x, patient.y + 1, patient.z);
      } else g.notifyOnce('medocs', 'Le médecin manque de médicaments !', 'mauvais');
    }
    if (medic.data.skill === 'scientifique' && n.rads > 0) n.rads = Math.max(0, n.rads - 2 * skill * dt);
  }

  // ------------------------------------------------------------------ secrets : vols, radio, sabotage

  private secretBehaviour(n: NpcState, dt: number): void {
    const g = this.game;
    const st = this.st;
    if (n.status === 'prisonnier' || !n.secret) return;
    if (n.secret === 'voleur') {
      n.timers.theft -= dt * (n.morale < 30 ? 1.6 : 1);
      if (n.timers.theft <= 0) {
        n.timers.theft = BAL.theftInterval[0] + Math.random() * (BAL.theftInterval[1] - BAL.theftInterval[0]);
        const options: ResourceId[] = ['nourriture', 'jetons', 'medicaments', 'balles', 'ferraille'];
        const id = options[Math.floor(Math.random() * options.length)];
        const have = st.train.resources[id] ?? 0;
        if (have < 3) return;
        const qty = Math.min(have, id === 'jetons' ? 8 + Math.floor(Math.random() * 12) : id === 'balles' ? 10 : 2 + Math.floor(Math.random() * 4));
        st.train.resources[id] -= qty;
        n.stash[id] = (n.stash[id] ?? 0) + qty;
        this.incident('vol', n, `${qty} ${RESOURCES[id].name.toLowerCase()} ont disparu de la soute.`);
        g.ui.toast(`Vol ! ${qty} ${RESOURCES[id].short} ont disparu de la soute. Interrogez l'équipage…`, 'mauvais');
      }
    }
    if (n.secret === 'traitre') {
      n.timers.sabotage -= dt;
      if (n.timers.sabotage <= 0) {
        n.timers.sabotage = 360 + Math.random() * 420;
        if (g.isNight() || Math.random() < 0.3) {
          g.events.ambushBonus = Math.min(0.6, g.events.ambushBonus + 0.25);
          this.incident('radio', n, 'Des grésillements de radio ont été entendus en pleine nuit.');
        }
      }
    }
  }

  /** Crée un incident avec d'éventuels témoins. */
  incident(kind: Incident['kind'], culprit: NpcState, text: string): Incident {
    const st = this.st;
    const witnesses: string[] = [];
    for (const m of this.aboard()) {
      if (m === culprit || m.status === 'prisonnier') continue;
      const sameWagon = m.wagon === culprit.wagon;
      const p = m.personality === 'paranoiaque' ? 0.85 : m.personality === 'curieux' ? 0.5 : 0.22;
      if (sameWagon ? Math.random() < p : Math.random() < p * 0.25) witnesses.push(m.id);
    }
    const wagonIdx = st.train.wagons.findIndex((w) => w.uid === culprit.wagon);
    const inc: Incident = {
      id: `inc${st.nextId++}`,
      kind,
      wagon: culprit.wagon ?? '',
      time: st.time,
      text: `${formatTime(st.time)} — ${text}${wagonIdx >= 0 ? ` (wagon ${wagonIdx + 1})` : ''}`,
      culprit: culprit.id,
      witnesses,
      resolved: false,
    };
    st.journal.incidents.unshift(inc);
    this.game.log(inc.text, 'mauvais');
    return inc;
  }

  /** Sabotage pendant un combat (traîtres). */
  combatSabotage(): void {
    const st = this.st;
    const g = this.game;
    for (const n of this.aboard()) {
      if (n.secret !== 'traitre' || n.status === 'prisonnier') continue;
      if (Math.random() > BAL.sabotageChance) continue;
      const wi = st.train.wagons.findIndex((w) => w.uid === n.wagon);
      const w = st.train.wagons[Math.max(0, wi)];
      const slot = w.slots.find((s) => s.equip && s.on);
      if (slot && slot.equip) {
        slot.on = false;
        this.incident('sabotage', n, `${EQUIPMENT[slot.equip].name} désactivé(e) manuellement pendant l'attaque.`);
        g.ui.toast(`Sabotage ! ${EQUIPMENT[slot.equip].name} du wagon ${wi + 1} a été coupé(e) !`, 'mauvais');
      } else {
        w.heater.hp = Math.max(0, w.heater.hp - 60);
        this.incident('sabotage', n, 'Le chauffage a été endommagé de l\'intérieur.');
        g.ui.toast(`Sabotage dans le wagon ${wi + 1} !`, 'mauvais');
      }
    }
  }

  // ------------------------------------------------------------------ ordres

  obeys(n: NpcState, label: string): boolean {
    const p = PERSONALITIES[n.personality];
    const danger = label === 'tourelle' || label === 'combat' || label === 'escorte';
    if (label === 'evacuer' && (n.personality === 'peureux' || n.personality === 'passif' || n.personality === 'loyal')) return true;
    let chance = danger && this.game.inCombat ? p.bravery * 0.7 + p.obedience * 0.3 : p.obedience;
    chance += n.affinity * 0.004;
    if (this.game.player.hasPerk('meneur')) chance += 0.15;
    if (n.morale < 25) chance -= 0.25;
    if (n.morale > 75) chance += 0.08;
    if (n.personality === 'tetu' && n.affinity > 30) chance += 0.35;
    if (n.personality === 'peureux' && danger && n.affinity > 60) chance += 0.3;
    return Math.random() < clamp(chance, 0.05, 0.98);
  }

  assignJob(n: NpcState, job: JobId, target: string | null = null): boolean {
    const a = this.game.crew.get(n.id);
    const label = job === 'tireur' ? 'tourelle' : job === 'suivre' ? 'escorte' : job;
    const apply = () => {
      // libère l'ancienne tourelle
      if (n.job === 'tireur' && n.jobTarget) {
        const [uid, si] = n.jobTarget.split(':');
        const slot = this.st.train.wagons.find((w) => w.uid === uid)?.slots[Number(si)];
        if (slot && slot.gunner === n.id) slot.gunner = null;
      }
      n.job = job;
      n.jobTarget = target;
      if (job === 'tireur' && target) {
        const [uid] = target.split(':');
        n.wagon = uid;
      }
      a?.resetSpot();
    };
    if (!a) {
      apply();
      return true;
    }
    return a.order(apply, label);
  }

  moveToWagon(n: NpcState, uid: string, urgent = false): boolean {
    const a = this.game.crew.get(n.id);
    const apply = () => {
      n.wagon = uid;
      if (n.job === 'tireur') {
        n.job = 'repos';
        n.jobTarget = null;
      }
      a?.resetSpot();
    };
    if (!a) {
      apply();
      return true;
    }
    return a.order(apply, urgent ? 'evacuer' : 'deplacer');
  }

  /** Évacue un wagon vers l'avant. */
  evacuate(index: number): void {
    const st = this.st;
    const w = st.train.wagons[index];
    if (!w) return;
    const target = st.train.wagons[Math.max(0, index - 1)];
    let moved = 0;
    let refused = 0;
    for (const n of this.aboard()) {
      if (n.wagon !== w.uid) continue;
      if (this.moveToWagon(n, target.uid, true)) moved++;
      else refused++;
    }
    this.game.ui.toast(`Évacuation du wagon ${index + 1} : ${moved} en route${refused ? `, ${refused} refus` : ''}.`, refused ? 'mauvais' : 'info');
  }

  // ------------------------------------------------------------------ recrutement, renvoi, expulsion

  recruit(n: NpcState, asPassenger = false): string | null {
    const g = this.game;
    const st = this.st;
    if (g.freeBeds() <= 0) return 'Pas de couchette libre à bord. Ajoutez une voiture-lits.';
    if (!asPassenger && n.fee > 0) {
      const cost = Math.round(n.fee * (g.player.hasPerk('negociant') ? 0.88 : 1));
      if ((st.train.resources.jetons ?? 0) < cost) return `Il faut ${cost} jetons.`;
      st.train.resources.jetons -= cost;
    }
    n.status = asPassenger ? 'passager' : 'equipage';
    n.stationId = null;
    const wi = this.wagonWithFreeBed() ?? 2;
    n.wagon = st.train.wagons[Math.min(wi, st.train.wagons.length - 1)].uid;
    n.job = asPassenger ? 'repos' : SKILLS[n.skill].job === 'suivre' ? 'repos' : SKILLS[n.skill].job;
    n.affinity += 10;
    const lv = g.stationLevel();
    if (lv) {
      lv.removeResident(n.id);
      lv.delta.residents = lv.delta.residents.filter((r) => r !== n.id);
    }
    g.syncCrewActors(false);
    g.emit({ type: 'recruit', npc: n.id });
    g.log(`${n.name} rejoint ${asPassenger ? 'le convoi comme passager' : 'l\'équipage'}.`, 'bon');
    g.audio.play('success');
    return null;
  }

  /** Fait descendre un PNJ à la gare actuelle. */
  dismiss(n: NpcState): void {
    const g = this.game;
    const lv = g.stationLevel();
    if (!lv) return;
    this.releaseJob(n);
    n.status = 'parti';
    n.stationId = lv.node.id;
    n.wagon = null;
    if (!lv.delta.residents.includes(n.id)) lv.delta.residents.push(n.id);
    const a = g.crew.get(n.id);
    if (a) {
      a.dispose();
      g.crew.delete(n.id);
    }
    lv.addResident(n, g.player.x + 1.5, g.player.z + 1, 0);
    this.reactToRemoval(n);
    g.emit({ type: 'npcLeft', npc: n.id });
    g.log(`${n.name} descend à ${lv.node.name}.`, 'info');
  }

  /** Expulsion du train en marche. */
  expel(n: NpcState): void {
    const g = this.game;
    this.releaseJob(n);
    n.status = 'perdu';
    n.wagon = null;
    const a = g.crew.get(n.id);
    if (a) {
      g.engine.fx.dust(a.x, a.z, 0x9a8a70, false);
      a.dispose();
      g.crew.delete(n.id);
    }
    this.reactToRemoval(n, true);
    g.emit({ type: 'npcLeft', npc: n.id });
    g.log(`${n.name} a été jeté${n.female ? 'e' : ''} du train.`, 'mauvais');
  }

  imprison(n: NpcState): string | null {
    const st = this.st;
    const cell = st.train.wagons.find((w) => w.type === 'cellule' && w.hp > 0);
    if (!cell) return 'Il faut un wagon cellulaire pour enfermer quelqu\'un.';
    const used = this.aboard().filter((m) => m.status === 'prisonnier').length;
    if (used >= 2) return 'Les cellules sont pleines.';
    this.releaseJob(n);
    n.status = 'prisonnier';
    n.job = 'prisonnier';
    n.wagon = cell.uid;
    this.game.crew.get(n.id)?.resetSpot();
    this.reactToRemoval(n);
    this.game.log(`${n.name} est enfermé${n.female ? 'e' : ''} en cellule.`, 'info');
    return null;
  }

  release(n: NpcState): void {
    n.status = 'equipage';
    n.job = 'repos';
    n.affinity -= 10;
    this.game.crew.get(n.id)?.resetSpot();
  }

  private releaseJob(n: NpcState): void {
    if (n.job === 'tireur' && n.jobTarget) {
      const [uid, si] = n.jobTarget.split(':');
      const slot = this.st.train.wagons.find((w) => w.uid === uid)?.slots[Number(si)];
      if (slot && slot.gunner === n.id) slot.gunner = null;
    }
    n.job = 'repos';
    n.jobTarget = null;
  }

  /** Réaction de l'équipage à un renvoi/une expulsion. */
  private reactToRemoval(n: NpcState, harsh = false): void {
    const guilty = n.known.secret && (n.secret === 'traitre' || n.secret === 'voleur');
    for (const m of this.aboard()) {
      if (guilty) {
        m.morale = clamp(m.morale + 5, 0, 100);
      } else if (harsh) {
        m.morale = clamp(m.morale - 12, 0, 100);
        if (m.personality === 'loyal' || m.personality === 'jovial' || m.personality === 'calme') m.affinity -= 15;
      } else {
        m.morale = clamp(m.morale - 2, 0, 100);
      }
    }
    if (guilty) {
      for (const inc of this.st.journal.incidents) if (inc.culprit === n.id) inc.resolved = true;
      this.game.ui.toast('L\'équipage approuve : justice est faite.', 'bon');
    } else if (harsh) this.game.ui.toast('L\'équipage est choqué par votre cruauté.', 'mauvais');
  }

  // ------------------------------------------------------------------ interrogatoire

  interrogate(n: NpcState, approach: InterroApproach): InterroResult {
    const st = this.st;
    const g = this.game;
    const p = PERSONALITIES[n.personality];
    n.interrogations++;
    const revealed: string[] = [];
    const guilty = n.secret === 'voleur' || n.secret === 'traitre';
    const clues = st.journal.clues.filter((c) => c.npc === n.id).length;
    const openIncidents = st.journal.incidents.filter((i) => !i.resolved);
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const confess = (): InterroResult => {
      n.known.secret = true;
      revealed.push('secret');
      for (const inc of st.journal.incidents) if (inc.culprit === n.id) inc.resolved = true;
      const text = n.secret === 'voleur' ? pick(INTERRO.confessThief) : n.secret === 'traitre' ? pick(INTERRO.confessTraitor) : pick(INTERRO.confessFugitive);
      st.journal.clues.unshift({ id: `clue${st.nextId++}`, npc: n.id, text: `${n.name} a avoué : ${n.secret === 'voleur' ? 'voleur' : n.secret === 'traitre' ? 'traître à la solde du Syndicat' : 'fugitif recherché'}.`, time: st.time });
      g.story.onConfession(n);
      return { text, revealed, confession: true };
    };
    switch (approach) {
      case 'amical': {
        n.affinity = clamp(n.affinity + 3, -100, 100);
        if (!n.known.personality && Math.random() < 0.55 + n.affinity / 200) {
          n.known.personality = true;
          revealed.push('personnalite');
        }
        if (n.secret === 'fugitif' && n.affinity > 45 && Math.random() < 0.5) return confess();
        if (n.secret === 'veteran' && n.affinity > 30) {
          n.known.secret = true;
          revealed.push('secret');
          return { text: 'Entre nous… j\'ai porté l\'uniforme, avant. Je sais me battre, si ça tourne mal.', revealed, confession: false };
        }
        const self: Record<string, string> = {
          courageux: 'Moi ? J\'ai jamais reculé devant rien. C\'est peut-être un défaut.',
          peureux: 'Je… je préfère éviter les ennuis. Le noir, les cris… je n\'aime pas ça.',
          passif: 'Je fais ce qu\'on me dit. Pas besoin de plus.',
          tetu: 'Je sais ce que je veux. Et je n\'aime pas qu\'on me dise quoi faire.',
          loyal: 'Vous m\'avez accueilli. Je n\'oublie jamais ce genre de choses.',
          cupide: 'Chacun ses priorités. Les miennes tintent dans une bourse.',
          jovial: 'La vie est trop courte pour faire la tête, pas vrai ?',
          colerique: 'Je m\'emporte vite, je sais. Mais je ne suis pas méchant.',
          paranoiaque: 'Je garde l\'œil ouvert. Quelqu\'un doit bien le faire.',
          curieux: 'J\'aime comprendre comment marchent les choses. Et les gens.',
          calme: 'Je préfère réfléchir avant d\'agir. Ça m\'a sauvé la vie plus d\'une fois.',
        };
        return { text: `${n.bio} ${revealed.includes('personnalite') ? self[n.personality] : ''}`.trim(), revealed, confession: false };
      }
      case 'soupcons': {
        // témoin d'un incident ?
        for (const inc of openIncidents) {
          if (inc.witnesses.includes(n.id) && inc.culprit) {
            const culprit = st.npcs[inc.culprit];
            const wIdx = st.train.wagons.findIndex((w) => w.uid === inc.wagon);
            const text = INTERRO.witness(culprit?.name ?? 'quelqu\'un', wIdx >= 0 ? `dans le wagon ${wIdx + 1}` : 'près de la soute', formatTime(inc.time));
            if (!st.journal.clues.some((c) => c.text === text)) st.journal.clues.unshift({ id: `clue${st.nextId++}`, npc: inc.culprit, text: `${n.name} : « ${text} »`, time: st.time });
            revealed.push('indice');
            return { text, revealed, confession: false };
          }
        }
        if (n.personality === 'paranoiaque') {
          const suspects = this.aboard().filter((m) => m !== n);
          const real = suspects.find((m) => m.secret === 'voleur' || m.secret === 'traitre');
          const target = real && Math.random() < 0.55 ? real : pick(suspects);
          if (target) {
            const text = `Je n'aime pas ${target.name}. Toujours à traîner là où il ne faut pas. Je dis ça…`;
            st.journal.clues.unshift({ id: `clue${st.nextId++}`, npc: target.id, text: `${n.name} soupçonne ${target.name} (paranoïaque : à vérifier).`, time: st.time });
            revealed.push('indice');
            return { text, revealed, confession: false };
          }
        }
        return { text: pick(INTERRO.noInfo), revealed, confession: false };
      }
      case 'direct': {
        if (!guilty) {
          const alibiMate = this.aboard().find((m) => m !== n && m.wagon === n.wagon);
          return { text: `${pick(INTERRO.innocentCalm)}${alibiMate ? ` J'étais avec ${alibiMate.name}, demandez-lui.` : ''}`, revealed, confession: false };
        }
        let chance = 0.12 + clues * 0.25 + (n.personality === 'peureux' || n.personality === 'passif' ? 0.2 : 0) - (n.personality === 'calme' || n.personality === 'tetu' || n.personality === 'courageux' ? 0.15 : 0);
        if (n.storyRole === 'silas') chance -= 0.15;
        if (Math.random() < chance) return confess();
        n.known.personality = true;
        return { text: clues > 0 ? pick(INTERRO.guiltyNervous) : pick(INTERRO.guiltySmooth), revealed: ['personnalite'], confession: false };
      }
      case 'menace': {
        n.affinity = clamp(n.affinity - 15, -100, 100);
        n.morale = clamp(n.morale - 12, 0, 100);
        if (guilty || n.secret === 'fugitif') {
          let chance = 0.25 + clues * 0.3 + (p.bravery < 0.4 ? 0.25 : 0) - (n.personality === 'tetu' || n.personality === 'courageux' ? 0.2 : 0);
          if (n.storyRole === 'silas' && clues === 0) chance = 0.05;
          if (Math.random() < chance) return confess();
          return { text: pick(INTERRO.guiltyNervous), revealed, confession: false };
        }
        for (const m of this.aboard()) if (m !== n && m.wagon === n.wagon) m.morale = clamp(m.morale - 5, 0, 100);
        return { text: pick(INTERRO.innocentHurt), revealed, confession: false };
      }
      case 'fouille': {
        n.affinity = clamp(n.affinity - 20, -100, 100);
        n.morale = clamp(n.morale - 8, 0, 100);
        const stash = Object.entries(n.stash).filter(([, q]) => (q ?? 0) > 0) as [ResourceId, number][];
        if (n.secret === 'voleur' && stash.length) {
          for (const [id, q] of stash) addResource(st, id, q);
          n.stash = {};
          st.journal.clues.unshift({ id: `clue${st.nextId++}`, npc: n.id, text: `Butin retrouvé dans les affaires de ${n.name} : ${stash.map(([id, q]) => `${q} ${RESOURCES[id].short}`).join(', ')}.`, time: st.time });
          const r = confess();
          return { ...r, text: `Vous retrouvez ${stash.map(([id, q]) => `${q} ${RESOURCES[id].short}`).join(', ')} cachés dans son sac. ${r.text}` };
        }
        if (n.secret === 'traitre') {
          g.giveItem('emetteur', 1, true);
          st.journal.clues.unshift({ id: `clue${st.nextId++}`, npc: n.id, text: `Un émetteur radio du Syndicat caché dans les affaires de ${n.name} !`, time: st.time });
          revealed.push('preuve');
          g.story.onEvidence(n);
          return { text: 'Au fond de son sac, enveloppé dans un chiffon : un petit émetteur radio frappé de l\'engrenage rouillé du Syndicat.', revealed, confession: false };
        }
        if (n.secret === 'fugitif') {
          n.known.secret = true;
          revealed.push('secret');
          return { text: 'Vous trouvez un avis de recherche plié en quatre… avec son visage dessus. Une prime de 120 jetons.', revealed, confession: false };
        }
        for (const m of this.aboard()) if (m !== n) m.morale = clamp(m.morale - 3, 0, 100);
        return { text: 'Rien de suspect. Juste quelques affaires personnelles… et un regard blessé.', revealed, confession: false };
      }
    }
  }

  rumor(): string {
    return RUMORS[Math.floor(Math.random() * RUMORS.length)];
  }

  // ------------------------------------------------------------------ réactions

  ambientBark(a: NpcActor): void {
    const n = a.data;
    const g = this.game;
    const wagon = this.st.train.wagons.find((w) => w.uid === n.wagon);
    if (wagon && wagon.temp < 10) return a.bark('cold');
    if (n.hunger > 2) return a.bark('hungry');
    if (g.isNight() && wagon && g.train.lightAt(this.st.train.wagons.indexOf(wagon)) < 0.4 && n.personality === 'peureux') return a.bark('dark');
    if (n.disease && n.disease.incubation <= 0) return a.bark('sick');
    if (n.morale > 75 && Math.random() < 0.4) return a.bark('happy');
    if (Math.random() < 0.35) a.say(PERSONALITIES[n.personality].idle[Math.floor(Math.random() * PERSONALITIES[n.personality].idle.length)], 4);
  }

  wagonCriticalBark(index: number): void {
    const uid = this.st.train.wagons[index]?.uid;
    for (const a of this.game.crew.values()) if (a.data.wagon === uid) a.bark('wagonCritical', 0.8);
  }

  onBoarding(index: number): void {
    this.combatShock = Math.min(1, this.combatShock + 0.4);
    const uid = this.st.train.wagons[index]?.uid;
    for (const a of this.game.crew.values()) if (a.data.wagon === uid) a.bark('combat', 0.7);
    if (Math.random() < 0.5) this.combatSabotage();
  }

  afterBattle(): void {
    this.combatShock = Math.min(1, this.combatShock + 0.3);
    for (const n of this.aboard()) {
      if (n.personality === 'courageux' || n.personality === 'colerique') n.morale = clamp(n.morale + 4, 0, 100);
      if (n.secret === 'veteran' && !n.known.secret && Math.random() < 0.3) {
        n.known.secret = true;
        this.game.ui.toast(`${n.name} s'est battu${n.female ? 'e' : ''} comme un vrai soldat… Un ancien militaire ?`, 'info');
      }
    }
  }

  onDeath(n: NpcState): void {
    for (const m of this.aboard()) {
      if (m === n) continue;
      m.morale = clamp(m.morale - (m.wagon === n.wagon ? 10 : 5), 0, 100);
    }
  }

  party(): void {
    this.partyBonus = 15;
  }

  /** Arrivée en gare : passagers à destination, désertions, primes. */
  onArrive(stationId: string): void {
    const st = this.st;
    const g = this.game;
    for (const n of this.aboard()) {
      if (n.status === 'passager' && n.fare && n.fare.destination === stationId) {
        addResource(st, 'jetons', n.fare.reward);
        g.ui.toast(`${n.name} est arrivé${n.female ? 'e' : ''} à destination et vous paie ${n.fare.reward} jetons.`, 'bon');
        g.gainXp(15);
        n.fare = null;
        this.dismiss(n);
        continue;
      }
      if (n.morale < 12 && n.status === 'equipage' && Math.random() < 0.5 && !n.storyRole) {
        g.ui.toast(`${n.name}, à bout, quitte le convoi.`, 'mauvais');
        this.dismiss(n);
      }
    }
    void BARKS;
  }
}

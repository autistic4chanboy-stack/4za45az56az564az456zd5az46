import * as THREE from 'three';
import { GeoBuilder } from '../render/geo';
import { BAL, DIFFICULTIES } from '../data/balance';
import { BIOMES } from '../data/biomes';
import { RESOURCES, type ResourceId } from '../data/items';
import { WAGON_TYPES, type WagonTypeId } from '../data/train';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { addResource, crewOnBoard, createWagon } from '../state/trainState';
import { generateNpc } from '../world/npcgen';
import * as P from '../render/props';
import type { Game } from './Game';
import type { TravelLevel, TravelEvent } from './travelLevel';
import type { Interactable } from './types';

/** Événements aléatoires et arrêts forcés pendant les trajets. */
export class EventSystem {
  /** Modificateur de température (blizzard…). */
  tempModifier = 0;
  /** Radiation supplémentaire (tempête radioactive). */
  radStorm = 0;
  /** Bonus d'embuscade (traître qui renseigne le Syndicat). */
  ambushBonus = 0;
  private tempT = 0;
  private radT = 0;
  private gasT = 0;
  /** Point d'arrêt imposé (distance) et sa raison. */
  blockAt: number | null = null;
  blockKind: string | null = null;
  private blockMesh: THREE.Group | null = null;
  private blockIt: Interactable | null = null;
  private warnT = 0;

  constructor(private game: Game) {}

  // ------------------------------------------------------------------ planification

  plan(travel: TravelLevel): void {
    const g = this.game;
    const st = g.state;
    const diff = DIFFICULTIES[st.difficulty];
    const rng = new Rng(Math.floor(Math.random() * 1e9));
    this.tempModifier = 0;
    this.radStorm = 0;
    this.clearBlock();
    const events: TravelEvent[] = [];
    const scripted = g.story.plannedEvents(travel.from.id, travel.to.id) ?? g.quests.plannedEvents(travel.from.id, travel.to.id);
    if (scripted) events.push(...scripted);
    const hasScriptedAttack = events.some((e) => e.kind === 'attaque');
    // attaques
    if (!hasScriptedAttack) {
      const danger = travel.edge.danger;
      const layerBoost = st.mode === 'infini' ? Math.min(0.35, travel.to.layer * 0.02) : 0;
      const p = clamp((BAL.attackChanceBase + layerBoost) * (0.5 + danger) * diff.attackRate + this.ambushBonus, 0.08, 0.95);
      const faction = travel.to.faction === 'bandit' ? 'bandit' : travel.to.faction === 'monster' || travel.to.faction === 'infected' ? 'monstre' : rng.chance(BIOMES[travel.to.biome].monsterBias) ? 'monstre' : 'bandit';
      if (rng.chance(p)) events.push({ at: travel.length * rng.range(0.22, 0.55), kind: 'attaque', done: false, data: { faction, strength: 1 } });
      if (rng.chance(p * 0.45)) events.push({ at: travel.length * rng.range(0.6, 0.85), kind: 'attaque', done: false, data: { faction: rng.chance(0.5) ? faction : faction === 'bandit' ? 'monstre' : 'bandit', strength: 0.8 } });
      this.ambushBonus = Math.max(0, this.ambushBonus - 0.25);
    }
    if (travel.edge.features.includes('aiguillage')) events.push({ at: travel.length * rng.range(0.4, 0.6), kind: 'aiguillage', done: false });
    // événements aléatoires
    const pool = this.randomPool(travel);
    const nRandom = rng.chance(0.65) ? (rng.chance(0.3) ? 2 : 1) : 0;
    for (let i = 0; i < nRandom && pool.length; i++) {
      const e = rng.pickWeighted(pool, (x) => x.w);
      pool.splice(pool.indexOf(e), 1);
      events.push({ at: travel.length * rng.range(0.12, 0.85), kind: e.kind, done: false });
    }
    events.sort((a, b) => a.at - b.at);
    // espacer les événements
    for (let i = 1; i < events.length; i++) if (events[i].at - events[i - 1].at < 180) events[i].at = Math.min(travel.length - 120, events[i - 1].at + 180);
    travel.events = events;
  }

  private randomPool(travel: TravelLevel): { kind: string; w: number }[] {
    const g = this.game;
    const st = g.state;
    const crew = crewOnBoard(st);
    const winter = st.season === 'hiver' || travel.to.biome === 'toundra' || travel.to.biome === 'montagnes';
    const pool: { kind: string; w: number }[] = [
      { kind: 'obstacle', w: 1.2 },
      { kind: 'panne', w: 0.8 },
      { kind: 'marchand', w: 1 },
      { kind: 'refugies', w: 0.9 },
      { kind: 'wagon_abandonne', w: 0.7 },
      { kind: 'caisse', w: 0.9 },
      { kind: 'signal', w: 0.6 },
      { kind: 'incendie', w: 0.35 },
    ];
    if (winter) pool.push({ kind: 'blizzard', w: 1.4 });
    if (travel.to.biome === 'irradie' || travel.fromBiome === 'irradie') pool.push({ kind: 'tempete_rad', w: 1.5 });
    if (travel.to.biome === 'marais') pool.push({ kind: 'gaz', w: 1.4 });
    if (crew.length >= 2) pool.push({ kind: 'dispute', w: 0.9 });
    if (crew.length >= 1) pool.push({ kind: 'maladie', w: winter ? 0.9 : 0.5 });
    if (crew.some((n) => n.secret === 'fugitif')) pool.push({ kind: 'chasseurs', w: 1.2 });
    if (crew.some((n) => n.personality === 'cupide' && n.status === 'equipage')) pool.push({ kind: 'prime', w: 0.6 });
    if (st.train.wagons.some((w) => w.decor.some((d) => d === 'jukebox' || d === 'arcade' || d === 'piano'))) pool.push({ kind: 'fete', w: 0.8 });
    return pool;
  }

  // ------------------------------------------------------------------ boucle

  update(dt: number, travel: TravelLevel): void {
    const g = this.game;
    for (const e of travel.events) {
      if (e.done) continue;
      if (e.kind === 'attaque' && g.crewSystem.hasSkill('eclaireur') && travel.progress >= e.at - 120 && !e.data?.warned) {
        e.data = { ...(e.data ?? {}), warned: true };
        g.ui.toast('Votre éclaireur repère des ennemis droit devant ! Préparez les tourelles.', 'mauvais');
      }
      if (travel.progress >= e.at && !g.inCombat) {
        e.done = true;
        this.trigger(e, travel);
        break;
      }
    }
    // arrêt imposé
    if (this.blockAt !== null) {
      const dist = this.blockAt - travel.progress;
      const v = g.train.speed;
      const brakeDist = (v * v) / (2 * BAL.brake) + 12;
      if (dist < brakeDist + 4) {
        g.state.train.throttle = 0;
        if (dist < 12) g.train.speed = Math.min(g.train.speed, Math.max(0, (dist - 8) * 0.8));
      }
      if (this.blockMesh) this.blockMesh.position.x = travel.xOf(this.blockAt);
      if (this.blockIt) {
        this.blockIt.x = travel.xOf(this.blockAt) - 1;
      }
      this.warnT -= dt;
      if (this.warnT <= 0 && dist < 120 && dist > 15) {
        this.warnT = 99;
        g.ui.toast(this.blockKind === 'aiguillage' ? 'Un aiguillage manuel bloque la voie : arrêt, puis descendez l\'actionner.' : 'Obstacle sur la voie ! Le train s\'arrête.', 'mauvais');
        g.audio.play('whistle', { volume: 0.5 });
      }
    }
    // effets temporaires
    if (this.tempT > 0) {
      this.tempT -= dt;
      if (this.tempT <= 0) {
        this.tempModifier = 0;
        g.ui.toast('Le blizzard se calme.', 'info');
      }
    }
    if (this.radT > 0) {
      this.radT -= dt;
      const vent = g.train.power?.ratio.chauffage ?? 0;
      for (const n of crewOnBoard(g.state)) n.rads += (0.6 - vent * 0.5) * dt;
      if (g.player.onTrain) g.state.player.rads += (0.4 - vent * 0.35) * dt;
      if (this.radT <= 0) {
        this.radStorm = 0;
        g.ui.toast('La tempête radioactive s\'éloigne.', 'info');
      }
    }
    if (this.gasT > 0) {
      this.gasT -= dt;
      const vent = g.train.power?.ratio.chauffage ?? 0;
      if (vent < 0.5) {
        for (const a of g.crew.values()) if (a.alive && Math.random() < dt * 0.5) a.damage(2, { faction: 'neutre', x: a.x, z: a.z, kind: 'gaz' });
        if (g.player.onTrain && g.state.player.gear.tete !== 'masque') g.player.damage(1.2 * dt, { faction: 'neutre', x: 0, z: 0, kind: 'gaz' });
      }
      if (this.gasT <= 0) g.ui.toast('Le train sort de la nappe de gaz.', 'info');
    }
  }

  private trigger(e: TravelEvent, travel: TravelLevel): void {
    const g = this.game;
    const st = g.state;
    const rng = new Rng(Math.floor(Math.random() * 1e9));
    switch (e.kind) {
      case 'attaque': {
        const faction = (e.data?.faction as 'bandit' | 'monstre') ?? 'monstre';
        travel.planAttack(faction, (e.data?.strength as number) ?? 1);
        if (crewOnBoard(st).some((n) => n.secret === 'traitre') && Math.random() < 0.4) window.setTimeout(() => g.crewSystem.combatSabotage(), 8000);
        break;
      }
      case 'aiguillage':
        this.setBlock(travel, 'aiguillage');
        break;
      case 'obstacle':
        this.setBlock(travel, 'obstacle');
        break;
      case 'panne': {
        const w = st.train.wagons[rng.int(0, st.train.wagons.length - 1)];
        const comps = [w.heater, w.lights, ...w.slots.filter((s) => s.equip)];
        const c = rng.pick(comps);
        c.hp = Math.max(0, c.hp - 70);
        g.ui.toast(`Panne dans le wagon ${st.train.wagons.indexOf(w) + 1} : un équipement a lâché.`, 'mauvais');
        g.audio.play('hitMetal');
        break;
      }
      case 'blizzard':
        this.tempModifier = -15;
        this.tempT = 110;
        travel.env.weather = 'tempete';
        g.ui.toast('Blizzard ! La température chute de 15 °C : poussez le chauffage !', 'mauvais');
        break;
      case 'tempete_rad':
        this.radStorm = 1.5;
        this.radT = 70;
        g.ui.toast('Tempête radioactive ! La ventilation (canal chauffage) protège l\'équipage.', 'mauvais');
        break;
      case 'gaz':
        this.gasT = 50;
        g.ui.toast('Nappe de gaz toxique ! Assurez la ventilation (canal chauffage ≥ 50 %).', 'mauvais');
        break;
      case 'incendie': {
        const closed = st.train.wagons.filter((w) => !WAGON_TYPES[w.type].open);
        const w = rng.pick(closed);
        w.fire = 0.2;
        g.ui.toast(`Incendie dans le wagon ${st.train.wagons.indexOf(w) + 1} ! Éteignez-le (maintenir E) ou envoyez un mécanicien.`, 'mauvais');
        g.audio.play('alarm');
        break;
      }
      case 'marchand':
        g.ui.eventDialog('Draisine marchande', 'Une draisine chargée de marchandises roule sur la voie parallèle. Le marchand vous fait signe : « On fait affaire en roulant ? »', [
          { text: 'Commercer', action: () => g.economy.openRoadTrader(travel.to) },
          { text: 'Ignorer', action: () => undefined },
        ]);
        break;
      case 'refugies':
        this.refugees(travel, rng);
        break;
      case 'wagon_abandonne':
        g.ui.eventDialog('Wagon abandonné', 'Un wagon abandonné repose sur une voie de garage. Il semble en état de rouler.', [
          { text: 'S\'arrêter et le fouiller', action: () => this.lootDialog(rng, 'wagon') },
          {
            text: 'L\'atteler au convoi (40 ferraille)',
            action: () => {
              if ((st.train.resources.ferraille ?? 0) < 40) return g.ui.toast('Pas assez de ferraille.', 'mauvais');
              const type = rng.pick(['fourgon', 'passagers', 'plateforme', 'blinde'] as WagonTypeId[]);
              st.train.resources.ferraille -= 40;
              const w = createWagon(type, `w${st.nextId++}`);
              w.hp = Math.round(w.hp * 0.5);
              st.train.wagons.push(w);
              g.train.rebuild();
              g.invalidateTrainInteractables();
              g.ui.toast(`Nouveau wagon attelé : ${WAGON_TYPES[type].name} (endommagé).`, 'bon');
            },
          },
          { text: 'Continuer', action: () => undefined },
        ]);
        break;
      case 'caisse':
        g.ui.eventDialog('Largage', 'Une caisse de ravitaillement gît près des rails, parachute déchiré. Un piège ?', [
          { text: 'La récupérer au passage', action: () => this.lootDialog(rng, 'caisse') },
          { text: 'Trop risqué', action: () => undefined },
        ]);
        break;
      case 'signal': {
        const unknown = Object.values(st.map.nodes).filter((n) => !n.scouted && !n.hidden && n.layer > (st.map.nodes[travel.to.id]?.layer ?? 0) - 1);
        const target = unknown.length ? rng.pick(unknown) : null;
        if (target) {
          target.known = true;
          target.scouted = true;
          g.ui.toast(`Signal radio capté : informations sur ${target.name} (${target.hostility}).`, 'info');
        } else {
          g.ui.toast(`Signal radio : « …${g.crewSystem.rumor()}… »`, 'info');
        }
        break;
      }
      case 'dispute':
        this.dispute(rng);
        break;
      case 'maladie': {
        const crew = crewOnBoard(st).filter((n) => !n.disease);
        if (!crew.length) break;
        const n = rng.pick(crew);
        const winter = st.season === 'hiver';
        n.disease = { id: winter || rng.chance(0.6) ? 'grippe' : 'fievre', severity: 0, incubation: 20, known: false, treated: 0 };
        break;
      }
      case 'chasseurs': {
        const fug = crewOnBoard(st).find((n) => n.secret === 'fugitif');
        if (!fug) break;
        g.ui.eventDialog('Chasseurs de primes', `Des cavaliers armés longent le train. « Livrez-nous ${fug.name}, il est recherché ! On paie 120 jetons. Sinon, on se sert. »`, [
          {
            text: `Livrer ${fug.name} (+120 jetons)`,
            action: () => {
              addResource(st, 'jetons', 120);
              fug.known.secret = true;
              g.crewSystem.expel(fug);
              g.ui.toast(`${fug.name} est emmené. +120 jetons.`, 'info');
            },
          },
          { text: 'Refuser : on se bat !', action: () => travel.planAttack('bandit', 0.8) },
        ]);
        break;
      }
      case 'prime': {
        const n = crewOnBoard(st).find((x) => x.personality === 'cupide' && x.status === 'equipage');
        if (!n) break;
        g.ui.eventDialog('Réclamation', `${n.name} vous prend à part : « Je risque ma peau pour ce convoi. Une petite prime de 25 jetons, ce serait juste, non ? »`, [
          {
            text: 'Payer 25 jetons',
            action: () => {
              if ((st.train.resources.jetons ?? 0) < 25) return g.ui.toast('Pas assez de jetons.', 'mauvais');
              st.train.resources.jetons -= 25;
              n.morale = clamp(n.morale + 20, 0, 100);
              n.affinity += 10;
            },
          },
          {
            text: 'Refuser',
            action: () => {
              n.morale = clamp(n.morale - 15, 0, 100);
              n.affinity -= 8;
              if (n.secret === null && Math.random() < 0.15) n.secret = 'voleur';
            },
          },
        ]);
        break;
      }
      case 'fete':
        if (g.isNight() || Math.random() < 0.5) {
          g.crewSystem.party();
          g.ui.toast('Soirée improvisée dans le salon : musique, rires et parties d\'arcade. Le moral remonte !', 'bon');
        }
        break;
      default:
        g.story.triggerTravelEvent(e.kind);
    }
  }

  private refugees(travel: TravelLevel, rng: Rng): void {
    const g = this.game;
    const st = g.state;
    const n = rng.int(1, 3);
    const people = Array.from({ length: n }, (_, i) => {
      const id = `ref${st.nextId++}_${i}`;
      const npc = generateNpc(rng.fork(id), id, { shady: 1.4 });
      npc.recruitable = true;
      npc.fee = 0;
      return npc;
    });
    const names = people.map((p) => p.name).join(', ');
    g.ui.eventDialog('Réfugiés', `Un petit groupe agite les bras au bord de la voie : ${names}. Ils fuient ${rng.pick(['la Fièvre', 'les bandits', 'le froid', 'une meute'])} et supplient de monter.`, [
      {
        text: `Les accueillir (${g.freeBeds()} couchettes libres)`,
        action: () => {
          let taken = 0;
          for (const p of people) {
            if (g.freeBeds() <= 0) break;
            st.npcs[p.id] = p;
            p.status = 'passager';
            p.fare = { destination: travel.to.id, reward: 10 + rng.int(0, 15) };
            if (rng.chance(0.25)) p.disease = { id: 'fievre', severity: 0, incubation: 200, known: false, treated: 0 };
            g.crewSystem.recruit(p, true);
            taken++;
          }
          g.ui.toast(taken ? `${taken} réfugié(s) à bord. Ils paieront à l'arrivée.` : 'Plus de place à bord.', taken ? 'bon' : 'mauvais');
          for (const m of crewOnBoard(st)) if (m.personality === 'loyal' || m.personality === 'jovial' || m.personality === 'calme') m.morale = clamp(m.morale + 4, 0, 100);
        },
      },
      {
        text: 'Leur jeter des vivres (5) et continuer',
        action: () => {
          if ((st.train.resources.nourriture ?? 0) >= 5) {
            st.train.resources.nourriture -= 5;
            for (const m of crewOnBoard(st)) m.morale = clamp(m.morale + 2, 0, 100);
          }
        },
      },
      {
        text: 'Ne pas s\'arrêter',
        action: () => {
          for (const m of crewOnBoard(st)) if (m.personality === 'loyal' || m.personality === 'jovial') m.morale = clamp(m.morale - 6, 0, 100);
        },
      },
    ]);
  }

  private dispute(rng: Rng): void {
    const g = this.game;
    const crew = crewOnBoard(g.state).filter((n) => n.status === 'equipage');
    if (crew.length < 2) return;
    const a = crew.find((n) => n.personality === 'colerique' || n.personality === 'tetu') ?? rng.pick(crew);
    const b = rng.pick(crew.filter((n) => n !== a));
    const topics = ['la dernière ration', 'une couchette près du poêle', 'le partage du butin', 'une vieille dette', 'la façon de tenir une tourelle'];
    g.ui.eventDialog('Dispute', `${a.name} et ${b.name} s'empoignent à propos de ${rng.pick(topics)}. Le ton monte dangereusement.`, [
      { text: `Donner raison à ${a.name}`, action: () => { a.affinity += 10; a.morale += 8; b.affinity -= 12; b.morale -= 10; } },
      { text: `Donner raison à ${b.name}`, action: () => { b.affinity += 10; b.morale += 8; a.affinity -= 12; a.morale -= 10; } },
      { text: 'Calmer tout le monde', action: () => { const ok = Math.random() < 0.6 + (g.player.hasPerk('meneur') ? 0.3 : 0); a.morale += ok ? 3 : -6; b.morale += ok ? 3 : -6; g.ui.toast(ok ? 'Les esprits s\'apaisent.' : 'Ils boudent dans leur coin.', ok ? 'bon' : 'info'); } },
    ]);
  }

  private lootDialog(rng: Rng, kind: 'wagon' | 'caisse'): void {
    const g = this.game;
    const st = g.state;
    const ids: ResourceId[] = kind === 'wagon' ? ['ferraille', 'balles', 'nourriture', 'charbon'] : ['medicaments', 'balles', 'nourriture', 'filtres', 'cartouches'];
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = rng.pick(ids);
      const q = addResource(st, id, Math.round(rng.int(3, 12) * DIFFICULTIES[st.difficulty].loot * (id === 'medicaments' || id === 'filtres' ? 0.3 : 1)) || 1);
      if (q > 0) got.push(`${q} ${RESOURCES[id].short}`);
    }
    g.ui.toast(got.length ? `Récupéré : ${got.join(', ')}.` : 'Rien d\'utile.', got.length ? 'bon' : 'info');
    if (rng.chance(0.3)) {
      const travel = g.travelLevel();
      if (travel) window.setTimeout(() => travel.planAttack('monstre', 0.5), 1500);
      g.ui.toast('C\'était un piège ! Des créatures surgissent !', 'mauvais');
    }
  }

  // ------------------------------------------------------------------ arrêts imposés

  private setBlock(travel: TravelLevel, kind: 'aiguillage' | 'obstacle'): void {
    const g = this.game;
    this.clearBlock();
    this.blockKind = kind;
    this.blockAt = travel.progress + Math.max(90, (g.train.speed * g.train.speed) / (2 * BAL.brake) + 40);
    this.warnT = 0;
    const gb = new GeoBuilder();
    const rng = new Rng(Math.floor(Math.random() * 1e9));
    if (kind === 'obstacle') {
      if (rng.chance(0.5)) {
        P.deadTree(gb, 0, 0, 1.4, rng);
        gb.cyl(0.35, 0.45, 9, 0, 0.6, 0, 0x4a3426, { rx: Math.PI / 2, ry: 0.3, seg: 7 });
      } else for (let i = 0; i < 6; i++) gb.dodeca(0.8 + rng.next() * 0.6, rng.range(-1.5, 1.5), 0.5, rng.range(-2, 2), 0x6a665e);
    } else {
      gb.box(0.8, 0.9, 0.5, 0, 0.45, -3.4, 0x4a4e48);
      gb.box(0.08, 1.1, 0.08, 0, 1.4, -3.4, 0x8a8a8a, { rz: 0.5 });
      gb.layer('glow').box(0.2, 0.2, 0.2, -0.3, 1.9, -3.4, 0xff3020);
    }
    const grp = gb.toGroup();
    travel.root.add(grp);
    this.blockMesh = grp;
    const it: Interactable = {
      id: 'blocage',
      x: travel.xOf(this.blockAt) - 1,
      y: 0,
      z: kind === 'aiguillage' ? -2.6 : 2.4,
      radius: 2.2,
      kind: kind === 'aiguillage' ? 'levier' : 'reparation',
      label: () => (kind === 'aiguillage' ? 'Actionner l\'aiguillage' : 'Dégager la voie (maintenir E)'),
      hold: () => (kind === 'aiguillage' ? 1 : 4),
      interact: () => {
        g.audio.play(kind === 'aiguillage' ? 'lever' : 'shovel');
        g.ui.toast(kind === 'aiguillage' ? 'Aiguillage basculé : la voie est libre. Remontez à bord et repartez.' : 'Voie dégagée ! Remontez à bord et repartez.', 'bon');
        g.gainXp(8);
        this.clearBlock();
      },
      highlight: () => 0xffd040,
    };
    this.blockIt = it;
    travel.interactables.push(it);
    if (Math.random() < 0.4) {
      const t = window.setInterval(() => {
        if (this.blockAt === null || !g.travelLevel()) {
          window.clearInterval(t);
          return;
        }
        if (g.train.speed < 0.1 && !g.player.onTrain) {
          window.clearInterval(t);
          travel.planAttack(Math.random() < 0.6 ? 'monstre' : 'bandit', 0.55);
        }
      }, 2500);
    }
  }

  /** Vrai si un obstacle peut être détruit par une explosion. */
  explodeObstacle(x: number): boolean {
    const travel = this.game.travelLevel();
    if (!travel || this.blockAt === null || this.blockKind !== 'obstacle') return false;
    if (Math.abs(travel.xOf(this.blockAt) - x) < 6) {
      this.game.ui.toast('L\'obstacle vole en éclats !', 'bon');
      this.clearBlock();
      return true;
    }
    return false;
  }

  clearBlock(): void {
    const travel = this.game.travelLevel();
    if (this.blockMesh) {
      this.blockMesh.parent?.remove(this.blockMesh);
      this.blockMesh.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    if (this.blockIt && travel) travel.interactables = travel.interactables.filter((i) => i !== this.blockIt);
    this.blockMesh = null;
    this.blockIt = null;
    this.blockAt = null;
    this.blockKind = null;
  }

  canRestart(): string | null {
    if (this.blockAt !== null) return this.blockKind === 'aiguillage' ? 'L\'aiguillage n\'est pas actionné !' : 'La voie est encore obstruée !';
    return null;
  }
}

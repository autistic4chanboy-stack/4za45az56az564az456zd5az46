import * as THREE from 'three';
import { StationBuilder, PLATFORM_Y, type DoorSpec, type ContainerSpec, type NoteSpec, type PickupSpec, type LeverSpec, type SpecialSpec, type LightSpec, type DeviceSpec, type Compartment } from '../world/stationBuilder';
import { TV_LINES, RADIO_LINES, JUKEBOX_LINES, TERMINAL_MESSAGES } from '../world/searchables';
import { generateStation, type GenCtx } from '../world/archetypes';
import { NavGrid, type CollisionWorld, type Collider } from '../world/collision';
import { BIOMES } from '../data/biomes';
import { DIFFICULTIES } from '../data/balance';
import { Materials, disposeObject } from '../render/geo';
import { toonUniforms } from '../render/toon';
import { rectContains, type Rect } from '../core/math';
import { Rng } from '../core/rng';
import { Enemy } from './enemy';
import { NpcActor } from './npcActor';
import { generateNpc } from '../world/npcgen';
import { emptyStationDelta, migrateDelta } from '../state/newGame';
import { trainLength } from '../state/trainState';
import { FRONT_X } from '../train/Train';
import type { Level } from './level';
import type { Interactable, Hazard, BuildingRuntime, LevelEnv } from './types';
import type { Game } from './Game';
import type { MapNode, StationDelta } from '../state/types';

export class StationLevel implements Level {
  readonly kind = 'station' as const;
  readonly root: THREE.Group;
  readonly colliders: CollisionWorld;
  enemies: Enemy[] = [];
  residents: NpcActor[] = [];
  interactables: Interactable[] = [];
  hazards: Hazard[] = [];
  buildings: BuildingRuntime[];
  env: LevelEnv;
  bounds: Rect;
  collidersActive = true;
  readonly node: MapNode;
  readonly delta: StationDelta;
  readonly ctx: GenCtx;
  readonly builder: StationBuilder;
  nav: NavGrid;
  private darkRects: Rect[];
  private lightSpecs: LightSpec[];
  private chimneyT = 0;
  /** Cheminées qui fument (foyers habités). */
  private smokers: { x: number; y: number; z: number }[] = [];
  doors = new Map<string, { spec: DoorSpec; open: boolean; collider: Collider | null; anim: number }>();
  containers = new Map<string, ContainerSpec>();
  levers = new Map<string, { spec: LeverSpec; state: number }>();
  private notesById = new Map<string, NoteSpec>();
  /** Appareils électriques et leur état. */
  devices: { spec: DeviceSpec; on: boolean; off: number[]; t: number; line: number; talk: number; flicker: number }[] = [];
  /** Bulles des appareils qui parlent (télévision, radio, juke-box). */
  speakers: { id: string; x: number; y: number; z: number; text: string }[] = [];
  /** Bâtiments dont la lumière est allumée (interrupteur + courant). */
  private litBuildings = new Set<string>();
  private pickupsById = new Map<string, PickupSpec>();
  specials: SpecialSpec[] = [];

  constructor(private game: Game, node: MapNode) {
    this.node = node;
    const st = game.state;
    st.stations[node.id] ??= emptyStationDelta();
    this.delta = st.stations[node.id];
    migrateDelta(this.delta, node.id);
    const diff = DIFFICULTIES[st.difficulty];
    const rear = FRONT_X - trainLength(st.train);
    const b = new StationBuilder(node.id, node.seed, node.biome, node.season, node.threat, diff.loot, rear, FRONT_X);
    this.builder = b;
    const budgetMult = st.mode === 'infini' ? 1 + node.layer * 0.02 : 1;
    this.ctx = generateStation(b, node, budgetMult);
    // ajouts scénarisés (histoire) ou génériques (quêtes secondaires)
    game.story.decorateStation(this, b, this.ctx);
    game.quests.decorateStation(this, b, this.ctx);
    b.finalize();
    this.root = b.root;
    this.colliders = b.colliders;
    this.buildings = b.buildings;
    this.bounds = b.bounds;
    this.darkRects = b.darkRects;
    this.lightSpecs = b.lights;
    this.hazards = [...b.hazards];
    this.specials = b.specials;
    const smokeRng = new Rng(`${node.id}:fumees`);
    const lived = node.hostility === 'hostile' ? 0.12 : node.hostility === 'neutre' ? 0.4 : 0.65;
    this.smokers = b.chimneys.filter(() => smokeRng.chance(lived));
    const biome = BIOMES[node.biome];
    let weather = new Rng(node.seed + Math.floor(st.time / 720)).pick(biome.weather[node.season]);
    if (st.mode === 'histoire' && node.id === 'cendrebourg' && this.delta.visits === 0) weather = 'clair';
    this.env = {
      biome: node.biome,
      weather,
      fogColor: node.season === 'hiver' ? biome.fogWinter : biome.fog,
      tint: node.radiation > 1 ? 0x7dff3a : node.gas ? 0xc8d060 : undefined,
      tintAmount: node.radiation > 1 ? 0.12 : node.gas ? 0.1 : 0,
    };
    game.scene.add(this.root);
    this.setupDoors();
    this.setupContainers();
    this.setupNotes();
    this.setupPickups();
    this.setupLevers();
    this.setupSpecials();
    this.setupDevices();
    this.nav = new NavGrid(this.bounds.x0, this.bounds.z0, this.bounds.x1, this.bounds.z1, 1);
    this.nav.build(this.colliders, 0.45, (c) => c.tag === 'door' || c.tag === 'water');
    this.spawnEnemies();
    this.spawnResidents();
  }

  // ------------------------------------------------------------------ portes

  private setupDoors(): void {
    for (const d of this.builder.doors) {
      const open = !d.lock || this.delta.opened.includes(d.id);
      const entry = { spec: d, open: false, collider: null as Collider | null, anim: 0 };
      this.doors.set(d.id, entry);
      if (open && !d.lock) {
        // portes non verrouillées : fermées mais s'ouvrent librement à l'approche
        entry.open = false;
      }
      if (open && d.lock) entry.open = true;
      if (!entry.open) entry.collider = this.colliders.addRect(d.collider.x0, d.collider.z0, d.collider.x1, d.collider.z1, 'door');
      this.applyDoorVisual(entry, true);
      const it: Interactable = {
        id: d.id,
        x: d.x,
        y: 0,
        z: d.z,
        radius: 1.3,
        kind: 'porte',
        label: () => {
          if (entry.open) return d.lock ? null : 'Fermer la porte';
          return this.game.lockLabel(d.lock, d.id, 'Ouvrir la porte');
        },
        hold: () => (!entry.open && d.lock?.kind === 'barricade' && (this.game.state.player.items.pied_de_biche ?? 0) > 0 ? 1.4 : 0),
        interact: () => {
          if (entry.open) {
            this.setDoor(d.id, false);
            return;
          }
          this.game.tryUnlock(d.lock, d.id, 'porte', () => this.setDoor(d.id, true, true));
        },
        highlight: () => (d.lock && !entry.open ? 0xffc040 : null),
      };
      this.interactables.push(it);
    }
  }

  setDoor(id: string, open: boolean, unlocked = false): void {
    const e = this.doors.get(id);
    if (!e) return;
    if (open === e.open) return;
    e.open = open;
    if (open) {
      if (e.collider) {
        this.colliders.remove(e.collider);
        e.collider = null;
      }
      if (unlocked && e.spec.lock && !this.delta.opened.includes(id)) this.delta.opened.push(id);
      this.game.audio.play('door', { x: e.spec.x, z: e.spec.z });
    } else {
      // ne referme pas sur le joueur
      const p = this.game.player;
      const c = e.spec.collider;
      if (p.x > c.x0 - 0.5 && p.x < c.x1 + 0.5 && p.z > c.z0 - 0.5 && p.z < c.z1 + 0.5) {
        e.open = true;
        return;
      }
      e.collider = this.colliders.addRect(c.x0, c.z0, c.x1, c.z1, 'door');
      this.game.audio.play('door', { x: e.spec.x, z: e.spec.z, pitch: 0.8 });
    }
  }

  private applyDoorVisual(e: { spec: DoorSpec; open: boolean; anim: number }, instant = false): void {
    const target = e.open ? 1 : 0;
    e.anim = instant ? target : e.anim + (target - e.anim) * 0.2;
    if (Math.abs(e.anim - target) < 0.003) e.anim = target;
    for (const i of e.spec.parts) this.builder.parts.set(i, e.anim, true);
  }

  // ------------------------------------------------------------------ conteneurs

  private setupContainers(): void {
    const d = this.delta;
    d.drawers ??= [];
    d.emptied ??= [];
    const parts = this.builder.parts;
    for (const c of this.builder.containers) {
      this.containers.set(c.id, c);
      for (const comp of c.compartments) {
        if (d.emptied.includes(comp.id) || d.looted.includes(c.id)) comp.loot = [];
        if (d.drawers.includes(comp.id)) for (const pi of comp.parts) parts.set(pi, 1, true);
      }
      const unlocked = () => !c.lock || d.opened.includes(c.id);
      const searched = () => c.compartments.every((k) => d.drawers!.includes(k.id) && k.loot.length === 0);
      this.interactables.push({
        id: c.id,
        x: c.ix,
        y: c.y,
        z: c.iz,
        radius: 1.1,
        kind: 'conteneur',
        label: () => {
          if (searched()) return null;
          if (!unlocked()) return this.game.lockLabel(c.lock, c.id, `Fouiller : ${c.name}`);
          return `Fouiller : ${c.name}`;
        },
        hold: () => (!unlocked() && c.lock?.kind === 'barricade' ? 1.2 : 0),
        interact: () => {
          const open = () => this.game.ui.openContainer(c, {
            openCompartment: (comp: Compartment) => this.openCompartment(c, comp),
            onEmptied: (comp: Compartment) => {
              if (!d.emptied!.includes(comp.id)) d.emptied!.push(comp.id);
            },
            onClose: () => {
              if (c.compartments.every((k) => k.loot.length === 0) && !d.looted.includes(c.id)) d.looted.push(c.id);
            },
          });
          if (unlocked()) open();
          else
            this.game.tryUnlock(c.lock, c.id, 'conteneur', () => {
              if (!d.opened.includes(c.id)) d.opened.push(c.id);
              open();
            });
        },
        highlight: () => (this.game.player.hasPerk('fouineur') ? 0xffe080 : null),
      });
    }
  }

  /** Ouvre un compartiment : animation, bruit, mémorisation. */
  openCompartment(c: ContainerSpec, comp: Compartment): void {
    const d = this.delta;
    if (!d.drawers!.includes(comp.id)) d.drawers!.push(comp.id);
    for (const pi of comp.parts) this.builder.parts.set(pi, 1);
    const drawer = comp.name.toLowerCase().includes('tiroir');
    this.game.audio.play(drawer ? 'drawer' : 'creak', { x: c.x, z: c.z, volume: 0.55, pitch: 0.9 + Math.random() * 0.2 });
    if (comp.note) this.game.notePickup(comp.note, this.node.id);
  }

  private setupNotes(): void {
    for (const n of this.builder.notes) {
      this.notesById.set(n.id, n);
      this.interactables.push({
        id: n.id,
        x: n.x,
        y: Math.max(0, n.y - 0.8),
        z: n.z,
        radius: 1.0,
        kind: 'note',
        label: () => `Lire : ${n.title}`,
        interact: () => this.game.readNote(n, this.node.id),
      });
    }
  }

  private setupPickups(): void {
    for (const p of this.builder.pickups) {
      if (this.delta.taken.includes(p.id)) {
        p.mesh.visible = false;
        continue;
      }
      this.pickupsById.set(p.id, p);
      const it: Interactable = {
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        radius: 1.0,
        kind: 'objet',
        label: () => (p.mesh.visible ? `Ramasser : ${this.game.lootName(p.entry)}` : null),
        interact: () => {
          if (!p.mesh.visible) return;
          if (this.game.takeLoot(p.entry)) {
            p.mesh.visible = false;
            this.delta.taken.push(p.id);
          }
        },
        highlight: () => 0xfff0a0,
      };
      this.interactables.push(it);
    }
  }

  private setupLevers(): void {
    for (const l of this.builder.levers) {
      const state = this.delta.levers[l.id] ?? l.initial;
      const entry = { spec: l, state };
      this.levers.set(l.id, entry);
      l.pivot.rotation.z = state === 0 ? 0.6 : -0.6;
      this.interactables.push({
        id: l.id,
        x: l.x,
        y: 0,
        z: l.z,
        radius: 1.3,
        kind: 'levier',
        label: () => `${l.label} : ${l.states[entry.state]} → basculer`,
        hold: () => 0.6,
        interact: () => {
          entry.state = (entry.state + 1) % l.states.length;
          this.delta.levers[l.id] = entry.state;
          l.pivot.rotation.z = entry.state === 0 ? 0.6 : -0.6;
          this.game.audio.play('lever', { x: l.x, z: l.z });
          this.game.onLever(l.id, entry.state, l);
        },
        highlight: () => 0xffd040,
      });
    }
  }

  private setupSpecials(): void {
    for (const s of this.builder.specials) {
      this.interactables.push({
        id: s.id,
        x: s.x,
        y: s.y,
        z: s.z,
        radius: s.radius,
        kind: 'machine',
        label: () => this.game.specialLabel(s, this),
        interact: () => this.game.handleSpecial(s, this),
        highlight: () => 0x80d0ff,
      });
    }
  }

  // ------------------------------------------------------------------ électricité et appareils

  /** La gare a-t-elle du courant ? (réseau intact, ou groupe électrogène démarré) */
  get powered(): boolean {
    return this.builder.power === 'reseau' || (this.builder.power === 'groupe' && !!this.delta.power);
  }

  private setupDevices(): void {
    const d = this.delta;
    d.devices ??= {};
    const parts = this.builder.parts;
    const rng = new Rng(this.node.seed).fork('appareils');
    for (const spec of this.builder.devices) {
      const off = spec.screens.map((i) => parts.colorOf(i));
      const on = spec.kind === 'groupe' ? !!d.power : !!d.devices[spec.id];
      const entry = { spec, on, off, t: rng.next() * 3, line: rng.int(0, 20), talk: 0, flicker: 1 };
      this.devices.push(entry);
      this.interactables.push({
        id: spec.id,
        x: spec.x,
        y: spec.y > 0.5 ? 0 : spec.y,
        z: spec.z,
        radius: spec.kind === 'interrupteur' ? 0.9 : 1.0,
        kind: 'machine',
        label: () => this.deviceLabel(entry),
        interact: () => this.useDevice(entry),
        highlight: () => (entry.on ? 0x80ffb0 : null),
      });
    }
    this.refreshDevices();
  }

  private deviceLabel(e: StationLevel['devices'][number]): string | null {
    const on = e.on;
    switch (e.spec.kind) {
      case 'tv':
        return on ? 'Éteindre la télévision' : 'Allumer la télévision';
      case 'radio':
        return on ? 'Éteindre la radio' : 'Allumer la radio';
      case 'ordinateur':
        return e.spec.name === 'Ordinateur' ? 'Utiliser l\'ordinateur' : `Utiliser : ${e.spec.name}`;
      case 'lampe':
        return on ? 'Éteindre la lampe' : 'Allumer la lampe';
      case 'interrupteur':
        return on ? 'Éteindre la lumière' : 'Allumer la lumière';
      case 'jukebox':
        return on ? 'Arrêter le juke-box' : 'Mettre de la musique';
      case 'distributeur':
        return this.powered ? 'Distributeur : acheter (3 jetons)' : 'Secouer le distributeur';
      case 'arcade':
        return 'Jouer à la borne d\'arcade';
      case 'groupe':
        return on ? 'Arrêter le groupe électrogène' : 'Démarrer le groupe électrogène (3 charbon)';
    }
  }

  private useDevice(e: StationLevel['devices'][number]): void {
    const g = this.game;
    const st = g.state;
    const spec = e.spec;
    if (spec.kind === 'groupe') {
      if (e.on) {
        e.on = false;
        this.delta.power = false;
        g.audio.play('switch', { x: spec.x, z: spec.z });
        g.ui.toast('Le groupe électrogène s\'arrête. La gare retombe dans le noir.', 'info');
      } else {
        if ((st.train.resources.charbon ?? 0) < 3) {
          g.audio.play('error');
          g.ui.toast('Il faut 3 charbon (pris dans le tender) pour démarrer le groupe.', 'mauvais');
          return;
        }
        st.train.resources.charbon -= 3;
        e.on = true;
        this.delta.power = true;
        g.audio.play('hum', { x: spec.x, z: spec.z });
        g.ui.toast('Le groupe électrogène tousse, puis ronronne : le courant revient dans la gare.', 'bon');
      }
      this.refreshDevices();
      return;
    }
    if (spec.needsPower && !this.powered) {
      g.audio.play('switch', { x: spec.x, z: spec.z, pitch: 0.8 });
      const hint = this.builder.power === 'groupe' ? ' Un groupe électrogène doit bien tourner quelque part…' : this.builder.power === 'aucun' ? ' Ici, le réseau est mort depuis longtemps.' : '';
      g.ui.toast(`Rien ne se passe : pas de courant.${hint}`, 'info');
      return;
    }
    switch (spec.kind) {
      case 'ordinateur':
        e.on = true;
        this.delta.devices![spec.id] = true;
        this.refreshDevices();
        g.audio.play('beep', { x: spec.x, z: spec.z });
        g.ui.openTerminal(spec.name, this.terminalMessages(spec));
        return;
      case 'arcade':
        g.ui.openArcade();
        return;
      case 'distributeur': {
        if (this.powered) {
          if ((st.train.resources.jetons ?? 0) < 3) {
            g.audio.play('error');
            g.ui.toast('Pas assez de jetons.', 'mauvais');
            return;
          }
          st.train.resources.jetons -= 3;
          st.train.resources.nourriture = (st.train.resources.nourriture ?? 0) + 1;
          g.audio.play('vend', { x: spec.x, z: spec.z });
          g.ui.toast('Clonk ! Une boîte de biscuits tombe. (+1 vivres)', 'bon');
          return;
        }
        const key = `secoue:${spec.id}`;
        if (this.delta.flags[key]) {
          g.ui.toast('Il n\'y a plus rien à en tirer.', 'info');
          return;
        }
        this.delta.flags[key] = 1;
        g.audio.play('hitMetal', { x: spec.x, z: spec.z });
        if (new Rng(this.node.seed + spec.x * 7 + spec.z).chance(0.5)) {
          st.train.resources.nourriture = (st.train.resources.nourriture ?? 0) + 2;
          g.ui.toast('À force de secouer, deux canettes tombent. (+2 vivres)', 'bon');
        } else g.ui.toast('Rien ne tombe. Il est vide.', 'info');
        return;
      }
      default:
        e.on = !e.on;
        this.delta.devices![spec.id] = e.on;
        g.audio.play('switch', { x: spec.x, z: spec.z });
        if (e.on && (spec.kind === 'tv' || spec.kind === 'radio')) g.audio.play(spec.kind === 'tv' ? 'tv' : 'radio', { x: spec.x, z: spec.z });
        this.refreshDevices();
    }
  }

  /** Messages d'un ordinateur : courriels d'ambiance, et parfois un code de porte de la gare. */
  private terminalMessages(spec: DeviceSpec): { title: string; text: string; reveals?: { door: string; code: string } }[] {
    const rng = new Rng(`${this.node.id}:${spec.id}:terminal`);
    const out: { title: string; text: string; reveals?: { door: string; code: string } }[] = [];
    const pool = [...TERMINAL_MESSAGES];
    rng.shuffle(pool);
    out.push(...pool.slice(0, rng.int(2, 3)));
    const coded = this.builder.doors.filter((d) => d.lock?.kind === 'code' && d.lock.code);
    if (coded.length && rng.chance(0.45)) {
      const d = rng.pick(coded);
      out.unshift({ title: 'Codes d\'accès (confidentiel)', text: `Rappel : le digicode du ${this.buildingName(d.building)} est ${d.lock!.code}. Ne pas le noter sur un papier.`, reveals: { door: d.id, code: d.lock!.code! } });
    }
    return out;
  }

  private buildingName(id: string): string {
    const b = this.builder.handles.find((h) => h.id === id);
    return b ? `bâtiment « ${b.spec.name} »` : 'local sécurisé';
  }

  /** Met à jour écrans, voyants et lumières après un changement d'état ou de courant. */
  refreshDevices(): void {
    const parts = this.builder.parts;
    const powered = this.powered;
    this.litBuildings.clear();
    for (const e of this.devices) {
      const live = e.spec.kind === 'groupe' ? true : (powered || !e.spec.needsPower) && (e.on || e.spec.kind === 'distributeur' || e.spec.kind === 'arcade' || (e.spec.kind === 'ordinateur' && e.spec.name !== 'Ordinateur'));
      e.spec.screens.forEach((pi, k) => {
        if (e.spec.kind === 'groupe') parts.setColor(pi, k === 0 ? (e.on ? 0x301010 : 0xff3020) : e.on ? 0x40ff60 : 0x103010);
        else parts.setColor(pi, live ? e.spec.screenColor : e.off[k]);
      });
      if (e.spec.kind === 'interrupteur' && e.on && powered && e.spec.building) this.litBuildings.add(e.spec.building);
    }
  }

  /** Animation des appareils allumés : écrans qui papillotent, sons, bulles. */
  private updateDevices(dt: number): void {
    const parts = this.builder.parts;
    const powered = this.powered;
    const p = this.game.player;
    this.speakers.length = 0;
    for (const e of this.devices) {
      const k = e.spec.kind;
      const live = (powered || !e.spec.needsPower) && e.on;
      if (k === 'groupe' && e.on) {
        e.t -= dt;
        if (e.t <= 0) {
          e.t = 1.4;
          if (Math.hypot(e.spec.x - p.x, e.spec.z - p.z) < 25) this.game.audio.play('hum', { x: e.spec.x, z: e.spec.z, volume: 0.5 });
          this.game.engine.fx.chimney(e.spec.x - 0.6, 1.9, e.spec.z, 0.2, 0.1);
        }
        continue;
      }
      if (!live || (k !== 'tv' && k !== 'radio' && k !== 'jukebox')) continue;
      const near = Math.hypot(e.spec.x - p.x, e.spec.z - p.z);
      e.t -= dt;
      if (k === 'tv' && e.t <= 0) {
        // l'écran change de plan : couleur et intensité nouvelles
        e.t = 0.12 + Math.random() * 0.35;
        const tint = [0xa8d0ff, 0xe0e8ff, 0x80a0d0, 0xffd8a0, 0xa0ffc0, 0xffa0c0][Math.floor(Math.random() * 6)];
        for (const pi of e.spec.screens) parts.setColor(pi, tint);
        e.flicker = 0.6 + Math.random() * 0.5;
        if (near < 14 && Math.random() < 0.25) this.game.audio.play('tv', { x: e.spec.x, z: e.spec.z, volume: 0.4 });
      } else if ((k === 'radio' || k === 'jukebox') && e.t <= 0) {
        e.t = k === 'jukebox' ? 0.9 : 1.6;
        if (near < 16) this.game.audio.play('tune', { x: e.spec.x, z: e.spec.z, volume: k === 'jukebox' ? 0.7 : 0.45, pitch: 0.8 + Math.random() * 0.5 });
        if (k === 'jukebox') for (const pi of e.spec.screens) parts.setColor(pi, [0xffb040, 0xff6080, 0x60c0ff, 0xffe060][Math.floor(Math.random() * 4)]);
      }
      // ce qu'on entend, au-dessus de l'appareil, quand on est à proximité
      if (near < 9) {
        e.talk -= dt;
        if (e.talk <= 0) {
          e.talk = 4.5;
          e.line++;
        }
        const lines = k === 'tv' ? TV_LINES : k === 'radio' ? RADIO_LINES : JUKEBOX_LINES;
        this.speakers.push({ id: e.spec.id, x: e.spec.x, y: e.spec.y + 0.6, z: e.spec.z, text: lines[e.line % lines.length] });
      }
    }
  }

  // ------------------------------------------------------------------ peuplement

  private spawnEnemies(): void {
    for (const e of this.builder.enemies) {
      if (this.delta.killed.includes(e.id)) continue;
      const en = new Enemy(this.game, e.type, e.x, e.z, this.node.threat, 'station', this.node.seed + e.x * 13 + e.z);
      en.persistId = e.id;
      en.group = e.group;
      en.ai = 'patrol';
      this.enemies.push(en);
    }
  }

  private spawnResidents(): void {
    const st = this.game.state;
    const rng = new Rng(this.node.seed).fork('pnj');
    const firstVisit = this.delta.visits === 0;
    let i = 0;
    for (const p of this.builder.npcs) {
      i++;
      let id = p.npcId;
      if (!id) {
        id = `${this.node.id}:pnj:${i}`;
        if (!st.npcs[id] && firstVisit) {
          const shady = st.mode === 'infini' ? 1 + this.node.layer * 0.04 : 1;
          const npc = generateNpc(rng.fork(id), id, { ...(p.gen ?? {}), shady });
          npc.stationId = this.node.id;
          npc.status = 'resident';
          npc.recruitable = p.role === 'recrue';
          npc.trader = p.role === 'marchand';
          if (npc.trader) npc.recruitable = false;
          st.npcs[id] = npc;
          if (!this.delta.residents.includes(id)) this.delta.residents.push(id);
        }
      }
      const data = st.npcs[id];
      if (!data || data.status !== 'resident' || data.stationId !== this.node.id) continue;
      this.addResident(data, p.x, p.z, p.yaw);
    }
    // PNJ laissés ou débarqués ici auparavant
    for (const rid of this.delta.residents) {
      const data = st.npcs[rid];
      if (!data || (data.status !== 'parti' && data.status !== 'resident') || data.stationId !== this.node.id) continue;
      if (this.residents.some((r) => r.id === rid)) continue;
      const spot = this.builder.findSpot(1, 1, { x0: -30, z0: 9, x1: 20, z1: 22 }, 20, 0.2) ?? { x: -5, z: 10 };
      this.addResident(data, spot.x, spot.z, 0);
    }
  }

  addResident(data: import('../state/types').NpcState, x: number, z: number, yaw: number): NpcActor {
    const a = new NpcActor(this.game, data);
    a.homeX = x;
    a.homeZ = z;
    a.teleport(x, z);
    a.yaw = yaw;
    this.residents.push(a);
    const it: Interactable = {
      id: `talk:${data.id}`,
      x,
      y: 0,
      z,
      radius: 1.4,
      kind: 'pnj',
      label: () => (a.alive && (data.status === 'resident' || data.status === 'parti') ? `Parler à ${data.name}` : null),
      interact: () => this.game.talkTo(a),
    };
    // l'interactif suit le PNJ
    Object.defineProperty(it, 'x', { get: () => a.x });
    Object.defineProperty(it, 'z', { get: () => a.z });
    Object.defineProperty(it, 'y', { get: () => a.y });
    this.interactables.push(it);
    return a;
  }

  removeResident(id: string): void {
    const i = this.residents.findIndex((r) => r.id === id);
    if (i >= 0) {
      this.residents[i].dispose();
      this.residents.splice(i, 1);
    }
    this.interactables = this.interactables.filter((it) => it.id !== `talk:${id}`);
  }

  // ------------------------------------------------------------------ requêtes

  groundY(x: number, z: number): number {
    const p = this.builder.platform;
    if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return PLATFORM_Y;
    return 0;
  }

  darknessAt(x: number, z: number): number {
    for (const r of this.darkRects) {
      if (!rectContains(r, x, z)) continue;
      // un bâtiment sombre dont on a rallumé la lumière n'est plus plongé dans le noir
      const lit = this.builder.handles.some((h) => this.litBuildings.has(h.id) && rectContains(h.inner, x, z));
      return lit ? 0.15 : 1;
    }
    return 0;
  }

  findPath(x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] | null {
    return this.nav.findPath(x0, z0, x1, z1);
  }

  requestLights(cx: number, cz: number, night: number): void {
    const lights = this.game.engine.lights;
    for (const l of this.lightSpecs) {
      if (l.night && night < 0.3) continue;
      if (Math.abs(l.x - cx) > 45 || Math.abs(l.z - cz) > 45) continue;
      lights.add(l.x, l.y, l.z, l.color, l.intensity * (l.night ? night : 1), l.distance, 0.5);
    }
    const powered = this.powered;
    for (const e of this.devices) {
      const L = e.spec.light;
      if (!L || !e.on || (e.spec.needsPower && !powered)) continue;
      if (Math.abs(L.x - cx) > 30 || Math.abs(L.z - cz) > 30) continue;
      lights.add(L.x, L.y, L.z, L.color, L.intensity * (e.spec.kind === 'tv' ? e.flicker : 1), L.distance, 0.9);
    }
    // plafonniers des bâtiments éclairés
    for (const id of this.litBuildings) {
      const h = this.builder.handles.find((b) => b.id === id);
      if (!h) continue;
      const x = (h.rect.x0 + h.rect.x1) / 2;
      const z = (h.rect.z0 + h.rect.z1) / 2;
      if (Math.abs(x - cx) > 30 || Math.abs(z - cz) > 30) continue;
      lights.add(x, (h.spec.h ?? 3.4) - 0.4, z, 0xfff0d0, 3.2, Math.max(h.rect.x1 - h.rect.x0, h.rect.z1 - h.rect.z0) + 3, 0.95);
    }
  }

  // ------------------------------------------------------------------ mise à jour

  update(dt: number): void {
    const p = this.game.player;
    // portes non verrouillées : ouverture automatique à l'approche
    for (const e of this.doors.values()) {
      const s = e.spec;
      if (!s.lock || this.delta.opened.includes(s.id)) {
        const near = Math.hypot(p.x - s.x, p.z - s.z) < 1.8 || this.residents.some((r) => Math.hypot(r.x - s.x, r.z - s.z) < 1.4) || this.game.crewFollowersNear(s.x, s.z, 1.4);
        if (near && !e.open) this.setDoor(s.id, true);
      }
      if (e.anim !== (e.open ? 1 : 0)) this.applyDoorVisual(e);
    }
    // toits et murs avant : masqués quand le joueur est dedans ou caché derrière
    for (const b of this.buildings) {
      const inside = rectContains(b.rect, p.x, p.z, -0.1);
      const behind = p.x > b.rect.x0 - 1 && p.x < b.rect.x1 + 1 && p.z < b.rect.z0 && p.z > b.rect.z0 - 6.5;
      const want = inside || behind;
      if (want !== b.inside) {
        b.inside = want;
        b.roof.visible = !want;
        for (const f of b.front) {
          f.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              if (o.name === 'glow' || o.name === 'window') o.visible = !want;
              else {
                o.userData.mat0 ??= o.material;
                o.material = want ? Materials.vcFaded : o.userData.mat0;
              }
              o.castShadow = !want;
            }
          });
        }
        if (inside) this.game.onEnterBuilding(b);
      }
    }
    this.builder.parts.update(dt);
    this.updateDevices(dt);
    // fumée des cheminées proches
    this.chimneyT -= dt;
    if (this.chimneyT <= 0) {
      this.chimneyT = 0.22;
      const wind = toonUniforms.uWind.value;
      // seules les maisons habitées fument, et seulement les plus proches
      let n = 0;
      for (const c of this.smokers) {
        if (n >= 14) break;
        if (Math.abs(c.x - p.x) < 40 && Math.abs(c.z - p.z) < 30) {
          this.game.engine.fx.chimney(c.x, c.y, c.z, wind.x * 2, wind.y * 2);
          n++;
        }
      }
    }
    // aiguillages : rien à faire ; dangers temporaires
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.ttl !== undefined) {
        h.ttl -= dt;
        if (h.ttl <= 0) this.hazards.splice(i, 1);
      }
    }
    // temps passé à quai
    this.delta.dwell += dt;
  }

  dispose(): void {
    this.game.scene.remove(this.root);
    disposeObject(this.root);
    this.builder.parts.dispose();
    for (const e of this.enemies) e.dispose();
    for (const r of this.residents) r.dispose();
    this.enemies = [];
    this.residents = [];
  }

  /** Point d'apparition du joueur : sur le quai, devant la locomotive. */
  spawnPoint(): { x: number; z: number } {
    return { x: FRONT_X - 6, z: 4.2 };
  }
}


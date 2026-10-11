import * as THREE from 'three';
import { StationBuilder, PLATFORM_Y, type DoorSpec, type ContainerSpec, type NoteSpec, type PickupSpec, type LeverSpec, type SpecialSpec, type LightSpec } from '../world/stationBuilder';
import { generateStation, type GenCtx } from '../world/archetypes';
import { NavGrid, type CollisionWorld, type Collider } from '../world/collision';
import { BIOMES } from '../data/biomes';
import { DIFFICULTIES } from '../data/balance';
import { Materials, disposeObject } from '../render/geo';
import { rectContains, type Rect } from '../core/math';
import { Rng } from '../core/rng';
import { Enemy } from './enemy';
import { NpcActor } from './npcActor';
import { generateNpc } from '../world/npcgen';
import { emptyStationDelta } from '../state/newGame';
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
  doors = new Map<string, { spec: DoorSpec; open: boolean; collider: Collider | null; anim: number }>();
  containers = new Map<string, ContainerSpec>();
  levers = new Map<string, { spec: LeverSpec; state: number }>();
  private notesById = new Map<string, NoteSpec>();
  private pickupsById = new Map<string, PickupSpec>();
  specials: SpecialSpec[] = [];

  constructor(private game: Game, node: MapNode) {
    this.node = node;
    const st = game.state;
    st.stations[node.id] ??= emptyStationDelta();
    this.delta = st.stations[node.id];
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
    const dir = e.spec.pivot.userData.openDir as number;
    e.spec.pivot.rotation.y = (e.spec.along === 'x' ? -dir : dir) * e.anim * (Math.PI / 2) * 0.95;
    if (e.spec.lock?.kind === 'barricade' && e.open) e.spec.pivot.visible = false;
  }

  // ------------------------------------------------------------------ conteneurs

  private setupContainers(): void {
    for (const c of this.builder.containers) {
      this.containers.set(c.id, c);
      const looted = this.delta.looted.includes(c.id);
      if (looted) {
        c.loot = [];
        if (c.lid) c.lid.rotation.x = -1.2;
      }
      const unlocked = () => !c.lock || this.delta.opened.includes(c.id);
      this.interactables.push({
        id: c.id,
        x: c.x,
        y: c.y,
        z: c.z,
        radius: 1.1,
        kind: 'conteneur',
        label: () => {
          if (this.delta.looted.includes(c.id) && c.loot.length === 0) return null;
          if (!unlocked()) return this.game.lockLabel(c.lock, c.id, `Fouiller : ${c.name}`);
          return `Fouiller : ${c.name}`;
        },
        hold: () => (!unlocked() && c.lock?.kind === 'barricade' ? 1.2 : 0),
        interact: () => {
          const open = () => {
            if (c.lid) c.lid.rotation.x = c.kind === 'caisse' || c.kind === 'coffre' || c.kind === 'tonneau' ? -1.2 : 0;
            if (c.lid && !(c.kind === 'caisse' || c.kind === 'coffre' || c.kind === 'tonneau')) c.lid.rotation.y = -1.6;
            this.game.audio.play('door', { x: c.x, z: c.z, pitch: 1.6, volume: 0.5 });
            this.game.ui.openContainer(c, () => {
              if (c.loot.length === 0 && !this.delta.looted.includes(c.id)) this.delta.looted.push(c.id);
            });
          };
          if (unlocked()) open();
          else
            this.game.tryUnlock(c.lock, c.id, 'conteneur', () => {
              if (!this.delta.opened.includes(c.id)) this.delta.opened.push(c.id);
              open();
            });
        },
        highlight: () => (this.game.player.hasPerk('fouineur') ? 0xffe080 : null),
      });
    }
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
    for (const r of this.darkRects) if (rectContains(r, x, z)) return 1;
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
      const behind = p.x > b.rect.x0 - 1 && p.x < b.rect.x1 + 1 && p.z < b.rect.z0 && p.z > b.rect.z0 - 5;
      const want = inside || behind;
      if (want !== b.inside) {
        b.inside = want;
        b.roof.visible = !want;
        for (const f of b.front) {
          f.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              if (o.name === 'glow') o.visible = !want;
              else o.material = want ? Materials.vcFaded : Materials.vc;
              o.castShadow = !want;
            }
          });
        }
        if (inside) this.game.onEnterBuilding(b);
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

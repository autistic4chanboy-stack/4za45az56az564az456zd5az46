import * as THREE from 'three';
import { GeoBuilder, Materials } from '../render/geo';
import { CollisionWorld } from '../world/collision';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import * as P from '../render/props';
import { BIOMES, type BiomeId } from '../data/biomes';
import { ENEMIES, TRAVEL_POOLS, type EnemyId } from '../data/enemies';
import { BAL, DIFFICULTIES } from '../data/balance';
import { Enemy } from './enemy';
import type { Level } from './level';
import type { NpcActor } from './npcActor';
import type { Interactable, Hazard, BuildingRuntime, LevelEnv } from './types';
import type { Game } from './Game';
import type { MapEdge, MapNode } from '../state/types';
import type { Rect } from '../core/math';
import type { PropCollider } from '../render/props';

const CHUNK = 60;
const VIEW_AHEAD = 170;
const VIEW_BEHIND = 230;

interface Chunk {
  index: number;
  group: THREE.Group;
  colliders: PropCollider[];
  /** Points de récolte (bois, caisses) disponibles à l'arrêt. */
  loot: { x: number; z: number; kind: 'bois' | 'caisse' }[];
  tunnel: boolean;
}

export interface TravelEvent {
  at: number;
  kind: string;
  done: boolean;
  data?: Record<string, unknown>;
}

export class TravelLevel implements Level {
  readonly kind = 'voyage' as const;
  readonly root = new THREE.Group();
  readonly colliders = new CollisionWorld();
  enemies: Enemy[] = [];
  residents: NpcActor[] = [];
  interactables: Interactable[] = [];
  hazards: Hazard[] = [];
  buildings: BuildingRuntime[] = [];
  env: LevelEnv;
  bounds: Rect = { x0: -400, z0: -120, x1: 400, z1: 120 };
  collidersActive = false;
  private chunks = new Map<number, Chunk>();
  private noise: Noise2D;
  readonly from: MapNode;
  readonly to: MapNode;
  readonly edge: MapEdge;
  /** Distance parcourue (m). */
  progress: number;
  events: TravelEvent[] = [];
  /** Zones de tunnel (en mètres). */
  tunnels: [number, number][] = [];
  bridges: [number, number][] = [];
  private stoppedColliders = false;
  private seed: number;
  /** Vagues en attente : [délai, types]. */
  private pendingWaves: { t: number; types: EnemyId[]; faction: 'bandit' | 'monstre' }[] = [];
  waveActive = false;
  waveKills = 0;
  private waveNo = 0;
  private waveTotal = 0;
  private stopLoot: Interactable[] = [];
  readonly fromBiome: BiomeId;

  constructor(private game: Game, from: MapNode, to: MapNode, edge: MapEdge, progress = 0) {
    this.from = from;
    this.to = to;
    this.edge = edge;
    this.progress = progress;
    this.fromBiome = from.biome;
    this.seed = from.seed ^ (to.seed * 7);
    this.noise = new Noise2D(this.seed);
    const rng = new Rng(this.seed);
    const biome = BIOMES[to.biome];
    const season = game.state.season;
    this.env = {
      biome: to.biome,
      weather: rng.pick(biome.weather[season]),
      fogColor: season === 'hiver' ? biome.fogWinter : biome.fog,
    };
    if (edge.features.includes('tunnel')) {
      const a = edge.length * rng.range(0.35, 0.55);
      this.tunnels.push([a, a + rng.range(180, 320)]);
    }
    if (edge.features.includes('pont')) {
      const a = edge.length * rng.range(0.2, 0.3);
      this.bridges.push([a, a + 120]);
    }
    game.scene.add(this.root);
    this.updateChunks();
  }

  get length(): number {
    return this.edge.length;
  }

  biomeAt(dist: number): BiomeId {
    return dist < this.edge.length * 0.35 ? this.fromBiome : this.to.biome;
  }

  inTunnel(dist = this.progress): boolean {
    return this.tunnels.some(([a, b]) => dist >= a && dist <= b);
  }

  onBridge(dist = this.progress): boolean {
    return this.bridges.some(([a, b]) => dist >= a && dist <= b);
  }

  // ------------------------------------------------------------------ décor

  /** Position x (repère train) d'une distance de parcours. */
  xOf(dist: number): number {
    return dist - this.progress;
  }

  private updateChunks(): void {
    const first = Math.floor((this.progress - VIEW_BEHIND) / CHUNK);
    const last = Math.floor((this.progress + VIEW_AHEAD) / CHUNK);
    for (const [idx, c] of this.chunks) {
      if (idx < first || idx > last) {
        this.root.remove(c.group);
        c.group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.chunks.delete(idx);
      }
    }
    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i)) {
        const c = this.buildChunk(i);
        this.chunks.set(i, c);
        this.root.add(c.group);
      }
    }
    for (const c of this.chunks.values()) c.group.position.x = c.index * CHUNK - this.progress;
  }

  private buildChunk(index: number): Chunk {
    const rng = new Rng(this.seed + index * 977);
    const dist0 = index * CHUNK;
    const biomeId = this.biomeAt(dist0 + CHUNK / 2);
    const bio = BIOMES[biomeId];
    const winter = this.game.state.season === 'hiver' || biomeId === 'toundra';
    const colors = winter && biomeId !== 'desert' ? bio.groundWinter : bio.ground;
    const g = new GeoBuilder();
    const ground = new GeoBuilder();
    const colliders: PropCollider[] = [];
    const loot: Chunk['loot'] = [];
    const tunnel = this.tunnels.some(([a, b]) => dist0 + CHUNK > a && dist0 < b);
    const bridge = this.bridges.some(([a, b]) => dist0 + CHUNK > a && dist0 < b);
    const tile = 5;
    for (let x = 0; x < CHUNK; x += tile) {
      for (let z = -110; z < 110; z += tile) {
        if (bridge && Math.abs(z) > 4) continue;
        const n = this.noise.fbm((dist0 + x) * 0.025, z * 0.025, 3);
        const c = colors[Math.floor(((n + 1) / 2) * colors.length * 0.999)];
        ground.plane(tile, tile, x + tile / 2, 0, z + tile / 2, c, { vary: 0.035 });
      }
    }
    // ballast et voie
    ground.box(CHUNK, 0.06, 3.6, CHUNK / 2, 0.03, 0, 0x5a5048);
    for (let x = 0.5; x < CHUNK; x += 1.1) g.box(0.35, 0.14, 2.6, x, 0.07, 0, 0x4a3a2c, { vary: 0.1 });
    g.box(CHUNK, 0.12, 0.1, CHUNK / 2, 0.2, -0.75, 0x6a6a6a);
    g.box(CHUNK, 0.12, 0.1, CHUNK / 2, 0.2, 0.75, 0x6a6a6a);
    // poteaux télégraphiques
    for (let x = (40 - (dist0 % 40)) % 40; x < CHUNK; x += 40) {
      if (!tunnel) P.pole(g, x, -6.5, 6.5);
    }
    if (bridge) {
      // pont métallique au-dessus d'une rivière
      const water = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK, 220).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: winter ? 0xb8c8d0 : 0x3a5a66 }));
      water.position.set(CHUNK / 2, -3, 0);
      g.box(CHUNK, 0.5, 4.2, CHUNK / 2, -0.25, 0, 0x4a4a4a);
      for (let x = 0; x < CHUNK; x += 6) {
        for (const z of [-2.2, 2.2]) {
          g.box(0.3, 4, 0.3, x, 1.8, z, 0x6a2a1e);
          g.box(6.2, 0.25, 0.25, x + 3, 3.8, z, 0x6a2a1e);
          g.box(6.6, 0.2, 0.2, x + 3, 1.8, z, 0x6a2a1e, { rz: 0.55 });
        }
        g.box(0.4, 6, 0.4, x, -3, 0, 0x5a5a5a);
      }
      const grp = new THREE.Group();
      grp.add(water);
      const tg = g.toGroup();
      grp.add(tg);
      return { index, group: grp, colliders: [], loot: [], tunnel: false };
    }
    if (tunnel) {
      // parois rocheuses et voûte
      for (const s of [-1, 1]) {
        for (let x = 0; x < CHUNK; x += 3) {
          g.box(3.1, 7 + rng.next(), 2.5, x + 1.5, 3.5, s * (5.2 + rng.next() * 0.4), 0x4a4440, { vary: 0.1 });
        }
        colliders.push({ kind: 'rect', x0: 0, z0: s < 0 ? -7 : 4.5, x1: CHUNK, z1: s < 0 ? -4.5 : 7 });
      }
      for (let x = 6; x < CHUNK; x += 12) {
        g.layer('glow').box(0.3, 0.3, 0.3, x, 4.5, -4.2, 0xffb060);
        g.layer('base');
      }
    } else {
      // végétation et rochers hors de l'emprise de la voie
      const density = bio.treeDensity * 22;
      for (let i = 0; i < density; i++) {
        const x = rng.range(0, CHUNK);
        const side = rng.sign();
        const z = side * rng.range(9, 100);
        const s = 0.8 + rng.next() * 0.7;
        const t = rng.pick(bio.trees);
        let c: PropCollider = null;
        switch (t) {
          case 'pin': c = P.pine(g, x, z, s, winter, biomeId === 'foret'); break;
          case 'chene': c = P.oak(g, x, z, s, winter); break;
          case 'bouleau': c = P.birch(g, x, z, s, winter); break;
          case 'cactus': c = P.cactus(g, x, z, s); break;
          case 'mangrove': c = P.mangrove(g, x, z, s, rng); break;
          case 'champignon': c = P.mushroom(g, x, z, s, bio.glow ?? 0xc8ff60); break;
          case 'cristal': c = P.crystal(g, x, z, s, rng, bio.glow ?? 0x7dff3a); break;
          default: c = P.deadTree(g, x, z, s, rng);
        }
        if (Math.abs(z) < 40) colliders.push(c);
      }
      const rocks = bio.rockDensity * 10;
      const rockC = biomeId === 'desert' ? 0xa07a50 : biomeId === 'irradie' ? 0x5a5a48 : 0x6e6a62;
      for (let i = 0; i < rocks; i++) {
        const x = rng.range(0, CHUNK);
        const z = rng.sign() * rng.range(7, 100);
        const c = P.rock(g, x, z, 0.5 + rng.next() * (biomeId === 'montagnes' ? 3 : 1.5), rockC, rng, winter);
        if (Math.abs(z) < 40) colliders.push(c);
      }
      if (!winter && biomeId !== 'desert') for (let i = 0; i < 25; i++) P.grass(g, rng.range(0, CHUNK), rng.sign() * rng.range(4, 40), 1, biomeId === 'marais' ? 0x4a6a32 : 0x6a8a3a);
      if (bio.ruinDensity > 0.2 && rng.chance(bio.ruinDensity * 0.6)) {
        const x = rng.range(5, CHUNK - 5);
        const z = rng.sign() * rng.range(10, 35);
        colliders.push(rng.chance(0.5) ? P.car(g, x, z, rng.next() * 6, rng.pick([0x7a3a2a, 0x3a5a7a, 0x6a6a3a])) : P.ruinWall(g, x, z, 4 + rng.next() * 4, 2 + rng.next() * 3, rng.next() * 3, 0x7a746a, rng));
      }
      if (bio.water > 0 && rng.chance(bio.water * 0.5)) {
        const x = rng.range(10, CHUNK - 10);
        const z = rng.sign() * rng.range(15, 50);
        P.puddle(g, x, z, 4 + rng.next() * 6, winter ? 0xc8d8e0 : 0x3a5a62, false);
      }
      if (bio.glow && rng.chance(0.4)) {
        const x = rng.range(5, CHUNK - 5);
        const z = rng.sign() * rng.range(8, 30);
        P.puddle(g, x, z, 1.5 + rng.next() * 2, bio.glow, true);
      }
      // bois mort et caisses abandonnées près de la voie (récupérables à l'arrêt)
      if (rng.chance(0.35)) {
        const x = rng.range(5, CHUNK - 5);
        const z = rng.sign() * rng.range(6, 14);
        for (let k = 0; k < 4; k++) g.cyl(0.15, 0.18, 1.6, x + (k % 2) * 0.4, 0.2 + Math.floor(k / 2) * 0.3, z, 0x5a4028, { rz: Math.PI / 2, seg: 6 });
        loot.push({ x, z, kind: 'bois' });
      }
      if (rng.chance(0.12)) {
        const x = rng.range(5, CHUNK - 5);
        const z = rng.sign() * rng.range(7, 16);
        colliders.push(P.crate(g, x, z, 1, 0x8a6a42, rng.next()));
        loot.push({ x, z: z + Math.sign(z) * -1.2, kind: 'caisse' });
      }
    }
    const group = new THREE.Group();
    group.add(ground.toGroup({ castShadow: false, receiveShadow: true }));
    if (!g.isEmpty) group.add(g.toGroup());
    return { index, group, colliders, loot, tunnel };
  }

  // ------------------------------------------------------------------ arrêts

  /** Active les collisions et les points de récolte autour du train à l'arrêt. */
  setStopped(stopped: boolean): void {
    if (stopped === this.stoppedColliders) return;
    this.stoppedColliders = stopped;
    this.collidersActive = stopped;
    this.colliders.clear();
    for (const it of this.stopLoot) this.interactables = this.interactables.filter((i) => i !== it);
    this.stopLoot = [];
    if (!stopped) return;
    for (const c of this.chunks.values()) {
      const ox = c.index * CHUNK - this.progress;
      for (const col of c.colliders) {
        if (!col) continue;
        if (col.kind === 'circle') this.colliders.addCircle(col.x + ox, col.z, col.r);
        else this.colliders.addRect(col.x0 + ox, col.z0, col.x1 + ox, col.z1);
      }
      for (const l of c.loot) {
        const key = `${this.edge.from}>${this.edge.to}:${c.index}:${Math.round(l.x)}`;
        if (this.game.state.flags[`recolte:${key}`]) continue;
        const it: Interactable = {
          id: key,
          x: l.x + ox,
          y: 0,
          z: l.z,
          radius: 1.5,
          kind: 'objet',
          label: () => (this.game.state.flags[`recolte:${key}`] ? null : l.kind === 'bois' ? 'Ramasser du bois de chauffe' : 'Fouiller la caisse abandonnée'),
          hold: () => (l.kind === 'bois' ? 1.2 : 0),
          interact: () => {
            this.game.state.flags[`recolte:${key}`] = true;
            this.game.collectRoadside(l.kind);
          },
          highlight: () => 0xffe080,
        };
        this.stopLoot.push(it);
        this.interactables.push(it);
      }
    }
    // murs invisibles : on ne s'éloigne pas trop du train
    const rear = this.game.train.rearX;
    this.colliders.addRect(rear - 40, -46, 60, -44);
    this.colliders.addRect(rear - 40, 44, 60, 46);
    this.colliders.addRect(rear - 42, -46, rear - 40, 46);
    this.colliders.addRect(60, -46, 62, 46);
  }

  // ------------------------------------------------------------------ attaques

  /** Prépare une attaque : budget selon la menace, en 2-3 vagues. */
  planAttack(faction: 'bandit' | 'monstre', strength = 1): void {
    const st = this.game.state;
    const diff = DIFFICULTIES[st.difficulty];
    const threat = this.to.threat;
    const rng = new Rng(Math.random() * 1e9);
    const winter = st.season === 'hiver' || this.to.biome === 'toundra';
    const pool = TRAVEL_POOLS[faction === 'bandit' ? 'bandit' : 'monster'].filter(
      (e) => e.minThreat <= threat + 0.4 && (e.id !== 'givreur' || winter) && (e.id !== 'fouisseur' || ['desert', 'montagnes', 'ruines'].includes(this.to.biome)),
    );
    let budget = (BAL.waveBudgetBase + BAL.waveBudgetPerThreat * threat) * strength * (0.85 + diff.attackRate * 0.15);
    const waves = budget > 18 ? 3 : 2;
    for (let w = 0; w < waves; w++) {
      const types: EnemyId[] = [];
      let wb = budget / (waves - w);
      let guard = 0;
      while (wb > 0.5 && guard++ < 30) {
        const e = rng.pickWeighted(pool, (p) => p.weight);
        types.push(e.id);
        const cost = e.id === 'motard' ? 3 : e.id === 'buggy' ? 7 : e.id === 'camion' ? 18 : e.id === 'mastodonte' ? 9 : e.id === 'nuee' ? 0.6 : e.id === 'rodeur' ? 1.5 : e.id === 'cracheur' ? 2.5 : e.id === 'rampant' ? 2 : e.id === 'givreur' ? 3.5 : 4;
        wb -= cost;
        budget -= cost;
        if (e.id === 'nuee') for (let k = 0; k < 4; k++) types.push('nuee');
      }
      this.pendingWaves.push({ t: w * rng.range(14, 22), types, faction });
    }
    this.waveActive = true;
    this.waveKills = 0;
    this.waveNo = 0;
    this.waveTotal = waves;
  }

  private spawnWave(types: EnemyId[]): void {
    const g = this.game;
    const train = g.train;
    const side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    for (const t of types) {
      const fromBehind = Math.random() < 0.55;
      const s: 1 | -1 = Math.random() < 0.7 ? side : (-side as 1 | -1);
      const x = fromBehind ? train.rearX - 25 - Math.random() * 30 : train.rearX + Math.random() * (train.frontX - train.rearX + 40);
      const z = s * (fromBehind ? 8 + Math.random() * 14 : 32 + Math.random() * 20);
      const e = new Enemy(g, t, x, z, this.to.threat, 'assaut');
      e.side = s;
      if (t === 'motard') e.boardChance = 0.35;
      e.alerted = true;
      e.ai = e.def.burrow ? 'burrowed' : 'approach';
      if (e.def.burrow) e.hiddenFromTurrets = true;
      e.pickTrainTarget();
      this.enemies.push(e);
    }
    this.waveNo++;
    const faction = types.some((t) => ENEMIES[t].faction === 'bandit') ? 'bandit' : 'monstre';
    g.onWaveSpawned(types.length, this.waveNo, Math.max(this.waveNo, this.waveTotal), side, faction);
  }

  // ------------------------------------------------------------------ mise à jour

  update(dt: number): void {
    const speed = this.game.train.speed;
    this.progress += speed * dt;
    this.updateChunks();
    this.setStopped(speed < 0.05);
    // vagues
    if (this.pendingWaves.length) {
      for (const w of this.pendingWaves) w.t -= dt;
      const ready = this.pendingWaves.filter((w) => w.t <= 0);
      this.pendingWaves = this.pendingWaves.filter((w) => w.t > 0);
      for (const w of ready) this.spawnWave(w.types);
    }
    // ennemis distancés ou morts depuis longtemps
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const lost = e.alive && !e.onTrain && (e.x < this.game.train.rearX - 90 || Math.abs(e.z) > 140);
      if ((!e.alive && e.deadT > 5) || lost) {
        if (lost) this.game.onEnemyEscaped(e);
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
    if (this.waveActive && this.pendingWaves.length === 0 && !this.enemies.some((e) => e.alive)) {
      this.waveActive = false;
      this.game.onWaveCleared(this.waveKills);
    }
    // dangers temporaires (flaques) : dérivent avec le sol
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.world) h.x -= speed * dt;
      if (h.ttl !== undefined) {
        h.ttl -= dt;
        if (h.ttl <= 0) this.hazards.splice(i, 1);
      }
    }
  }

  groundY(): number {
    return 0;
  }

  darknessAt(): number {
    return this.inTunnel() ? 0.9 : 0;
  }

  findPath(): null {
    return null;
  }

  requestLights(cx: number, _cz: number, _night: number): void {
    if (this.inTunnel()) {
      for (let x = Math.floor((cx - 40) / 12) * 12; x < cx + 40; x += 12) this.game.engine.lights.add(x, 4.2, -3.8, 0xffb060, 1.8, 10, 0.4);
    }
  }

  dispose(): void {
    this.game.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material;
        if (m !== Materials.vc && m !== Materials.vcFaded && m !== Materials.glow && m !== Materials.glass) m.dispose();
      }
    });
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
  }
}

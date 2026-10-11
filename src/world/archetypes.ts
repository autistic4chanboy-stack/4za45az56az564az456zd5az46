import * as THREE from 'three';
import { StationBuilder, type LockSpec, type BuildingHandle } from './stationBuilder';
import { ARCHETYPES, type ArchetypeDef } from '../data/stations';
import { BIOMES, type BiomeDef } from '../data/biomes';
import { STATION_POOLS, type EnemyId } from '../data/enemies';
import { KEYCARD_COLORS, type KeycardColor } from '../data/items';
import * as P from '../render/props';
import type { MapNode } from '../state/types';
import type { Rect } from '../core/math';
import { waterMaterial, type GeoBuilder } from '../render/geo';
import type { PropCollider } from '../render/props';

/** Contexte de génération d'une gare. */
export interface GenCtx {
  node: MapNode;
  arch: ArchetypeDef;
  biome: BiomeDef;
  hostile: boolean;
  /** Bâtiments nommés (pour les scripts d'histoire). */
  named: Record<string, BuildingHandle>;
  /** Points nommés. */
  spots: Record<string, { x: number; z: number }>;
  /** Budget de menace pour les ennemis. */
  budget: number;
}

const SOUTH: Rect = { x0: -118, z0: 10, x1: 70, z1: 78 };
const NORTH: Rect = { x0: -118, z0: -44, x1: 70, z1: -8 };

export function region(x0: number, z0: number, x1: number, z1: number): Rect {
  return { x0, z0, x1, z1 };
}

// ---------------------------------------------------------------- utilitaires

function code4(b: StationBuilder): string {
  return String(b.rng.int(1000, 9999));
}

/** Verrou aléatoire selon la difficulté. */
export function randomLock(b: StationBuilder, allow: ('code' | 'crochet' | 'carte' | 'barricade')[] = ['code', 'crochet', 'barricade']): LockSpec {
  const kind = b.rng.pick(allow);
  if (kind === 'code') return { kind: 'code', code: code4(b) };
  if (kind === 'carte') return { kind: 'carte', color: b.rng.pick(KEYCARD_COLORS as unknown as KeycardColor[]) };
  if (kind === 'barricade') return { kind: 'barricade' };
  return { kind: 'crochet', difficulty: b.rng.int(1, Math.min(3, 1 + Math.floor(b.tier / 1.5))) };
}

/** Place l'indice (note pour un code, carte d'accès au sol) d'un verrou dans un autre bâtiment. */
export function placeLockHint(b: StationBuilder, lock: LockSpec, doorId: string, exclude: BuildingHandle | null, label: string): void {
  const others = b.handles.filter((h) => h !== exclude && !h.spec.ruined);
  const host = others.length ? b.rng.pick(others) : null;
  const where = host ? { x: b.rng.range(host.inner.x0 + 0.8, host.inner.x1 - 0.8), z: b.rng.range(host.inner.z0 + 0.8, host.inner.z1 - 0.8) } : b.findSpot(1, 1, SOUTH) ?? { x: 0, z: 14 };
  if (lock.kind === 'code' && lock.code) {
    const texts = [
      `Note griffonnée : « ${label} — le code a encore changé : ${lock.code}. Arrêtez de l'oublier ! »`,
      `Mémo du chef de poste : « Accès ${label} : ${lock.code}. À détruire après lecture. »`,
      `Carnet taché : « Si quelqu'un trouve ça… ${label}, code ${lock.code}. Il reste des vivres. »`,
    ];
    b.note(where.x, where.z, `Code : ${label}`, b.rng.pick(texts), { y: 0.05, reveals: { door: doorId, code: lock.code } });
  } else if (lock.kind === 'carte' && lock.color) {
    b.pickup(where.x, where.z, { kind: 'item', id: `carte:${b.stationId}:${lock.color}`, qty: 1 });
  }
}

function enemyPool(ctx: GenCtx, faction: 'bandit' | 'monster' | 'infected'): { id: EnemyId; weight: number }[] {
  const winter = ctx.node.season === 'hiver' || ctx.node.biome === 'toundra';
  return STATION_POOLS[faction].filter((e) => e.minThreat <= ctx.node.threat + 0.5 && (e.id !== 'givreur' || winter) && (e.id !== 'fouisseur' || ['desert', 'montagnes', 'ruines'].includes(ctx.node.biome)));
}

/** Dépense le budget de menace en groupes d'ennemis répartis dans des régions. */
export function populateEnemies(b: StationBuilder, ctx: GenCtx, regions: Rect[], budgetMult = 1, groupSize = [2, 4]): void {
  if (!ctx.hostile && ctx.node.hostility !== 'neutre') return;
  let faction: 'bandit' | 'monster' | 'infected' = ctx.node.faction === 'bandit' ? 'bandit' : ctx.node.faction === 'infected' ? 'infected' : 'monster';
  if (ctx.node.faction === 'machine') faction = 'monster';
  if (ctx.node.faction === 'none') return;
  const pool = enemyPool(ctx, faction);
  if (!pool.length) return;
  let budget = ctx.budget * budgetMult * (ctx.node.hostility === 'neutre' ? 0.45 : 1);
  let guard = 0;
  while (budget > 1.2 && guard++ < 40) {
    const reg = b.rng.pick(regions);
    const spot = b.findSpot(4, 4, reg, 25, 0.5);
    if (!spot) continue;
    const n = b.rng.int(groupSize[0], groupSize[1]);
    const types: EnemyId[] = [];
    for (let i = 0; i < n && budget > 0.8; i++) {
      const e = b.rng.pickWeighted(pool, (p) => p.weight);
      types.push(e.id);
      budget -= e.weight > 0 ? THREAT_COST[e.id] ?? 2 : 2;
    }
    b.enemyGroup(types, spot.x, spot.z, 3.5);
  }
}

const THREAT_COST: Partial<Record<EnemyId, number>> = {
  pillard: 2, brute: 3, tireur: 3, lanceur: 3, rodeur: 1.5, cracheur: 2.5, mastodonte: 9, rampant: 2, givreur: 3.5, fouisseur: 4, infecte: 1.5, sentinelle: 5,
};

/** Décor du biome dans les zones libres. */
export function biomeDressing(b: StationBuilder, ctx: GenCtx, density = 1): void {
  const bio = ctx.biome;
  const rng = b.rng;
  const w = b.winter;
  const treeFn = (g: GeoBuilder, x: number, z: number): PropCollider => {
    const t = rng.pick(bio.trees);
    const s = 0.8 + rng.next() * 0.6;
    switch (t) {
      case 'pin': return P.pine(g, x, z, s, w, bio.id === 'foret');
      case 'chene': return P.oak(g, x, z, s, w, rng.chance(0.2));
      case 'bouleau': return P.birch(g, x, z, s, w);
      case 'cactus': return P.cactus(g, x, z, s);
      case 'mangrove': return P.mangrove(g, x, z, s, rng);
      case 'champignon': return P.mushroom(g, x, z, s, bio.glow ?? 0xc8ff60);
      case 'cristal': return P.crystal(g, x, z, s, rng, bio.glow ?? 0x7dff3a);
      default: return P.deadTree(g, x, z, s, rng);
    }
  };
  const rockC = bio.id === 'desert' ? 0xa07a50 : bio.id === 'irradie' ? 0x5a5a48 : 0x6e6a62;
  const bushC = bio.id === 'desert' ? 0x8a8a4a : bio.id === 'irradie' ? 0x7a7a3a : bio.id === 'marais' ? 0x3e5a30 : w ? 0x6a7a62 : bio.id === 'foret' ? 0x3a6030 : 0x4e7434;
  for (const reg of [SOUTH, NORTH]) {
    const area = ((reg.x1 - reg.x0) * (reg.z1 - reg.z0)) / 1000;
    // bosquets : quelques arbres serrés autour d'un centre, ourlés de buissons
    const groves = Math.round(area * bio.treeDensity * 0.55 * density);
    for (let k = 0; k < groves; k++) {
      const c = b.findSpot(6, 6, reg, 20, 1);
      if (!c) continue;
      const n = 3 + rng.int(0, 5);
      for (let t = 0; t < n; t++) {
        const x = c.x + rng.gauss() * 3.2;
        const z = c.z + rng.gauss() * 3.2;
        const r = { x0: x - 1.1, z0: z - 1.1, x1: x + 1.1, z1: z + 1.1 };
        if (!b.isFree(r, 0.2)) continue;
        b.addCollider(treeFn(b.g, x, z));
        b.reserve(r);
      }
      for (let t = 0; t < 3; t++) {
        const a = rng.next() * Math.PI * 2;
        const x = c.x + Math.cos(a) * rng.range(3.5, 6);
        const z = c.z + Math.sin(a) * rng.range(3.5, 6);
        if (!b.isFree({ x0: x - 0.8, z0: z - 0.8, x1: x + 0.8, z1: z + 0.8 }, 0.1)) continue;
        if (w) P.deadTree(b.g, x, z, 0.3 + rng.next() * 0.2, rng, 0x4a3a30);
        else P.bush(b.g, x, z, 0.7 + rng.next() * 0.6, bushC, rng.chance(0.15) ? 0xc0303a : 0);
      }
    }
    b.scatter(reg, Math.round(area * bio.treeDensity * 1.4 * density), treeFn, 2.2);
    b.scatter(reg, Math.round(area * bio.rockDensity * 2.2 * density), (g, x, z) => P.rock(g, x, z, 0.4 + rng.next() * 1.2, rockC, rng, w), 2);
    // buissons (en hiver : ramures nues qui dépassent de la neige)
    if (w) b.scatter(reg, Math.round(area * 0.9 * density), (g, x, z) => { P.deadTree(g, x, z, 0.28 + rng.next() * 0.2, rng, 0x4a3a30); return null; }, 1.2);
    else b.scatter(reg, Math.round(area * (bio.id === 'desert' ? 1.4 : 2.2) * density), (g, x, z) => P.bush(g, x, z, 0.6 + rng.next() * 0.6, bushC, rng.chance(0.12) ? 0xc0303a : 0), 1.6);
    b.scatter(reg, Math.round(area * 0.6 * density), (g, x, z) => {
      if (bio.id === 'desert') P.bones(g, x, z, rng);
      else P.stump(g, x, z, rng, w);
      return null;
    }, 1);
    if (bio.ruinDensity > 0.2) b.scatter(reg, Math.round(area * bio.ruinDensity * 0.8 * density), (g, x, z) => rng.chance(0.5) ? P.car(g, x, z, rng.next() * 6, rng.pick([0x7a3a2a, 0x3a5a7a, 0x6a6a3a]), true) : P.ruinWall(g, x, z, 3 + rng.next() * 3, 2 + rng.next() * 2, rng.next() * 3, 0x7a746a, rng), 4.5);
  }
  // abords hors limites : la gare s'inscrit dans un paysage (décor seul, sans collisions)
  const bd = b.bounds;
  const ring = 22;
  const outskirts = Math.round(((bd.x1 - bd.x0 + ring * 2) * ring * 2 + (bd.z1 - bd.z0) * ring * 2) / 1000 * (bio.treeDensity * 9 + bio.rockDensity * 2) * density);
  for (let k = 0; k < outskirts; k++) {
    const side = rng.int(0, 3);
    const x = side === 0 ? rng.range(bd.x0 - ring, bd.x0 - 2) : side === 1 ? rng.range(bd.x1 + 2, bd.x1 + ring) : rng.range(bd.x0 - ring, bd.x1 + ring);
    const z = side === 2 ? rng.range(bd.z0 - ring, bd.z0 - 2) : side === 3 ? rng.range(bd.z1 + 2, bd.z1 + ring) : rng.range(bd.z0, bd.z1);
    if (Math.abs(z) < 6) continue;
    if (rng.chance(bio.treeDensity / (bio.treeDensity + bio.rockDensity * 0.4 + 0.01))) treeFn(b.g, x, z);
    else P.rock(b.g, x, z, 0.6 + rng.next() * 1.8, rockC, rng, w);
  }
  // flaques radioactives et poches de gaz du biome
  if (bio.radiation > 0 || ctx.node.radiation > 0) {
    const n = Math.round(4 + ctx.node.radiation * 2);
    for (let i = 0; i < n; i++) {
      const p = b.findSpot(3, 3, rng.chance(0.7) ? SOUTH : NORTH, 10, 0.2);
      if (!p) continue;
      const r = 1.5 + rng.next() * 2.5;
      P.puddle(b.g, p.x, p.z, r, bio.glow ?? 0x7dff3a, true);
      b.hazard({ kind: 'radiation', x: p.x, z: p.z, r: r + 2.5, intensity: 0.8 + rng.next() * 1.5 + ctx.node.radiation * 0.3 });
      if (rng.chance(0.5)) b.addCollider(P.barrel(b.g, p.x + r + 0.5, p.z, 0x6a7a2a, true, bio.glow ?? 0x7dff3a));
    }
  }
  if (bio.gas > 0.3 || ctx.node.gas) {
    const n = Math.round(2 + bio.gas * 4 + (ctx.node.gas ? 3 : 0));
    for (let i = 0; i < n; i++) {
      const p = b.findSpot(6, 6, SOUTH, 10, 0);
      if (!p) continue;
      b.hazard({ kind: 'gaz', x: p.x, z: p.z, r: 4 + rng.next() * 4, intensity: 1 });
    }
  }
}

function sheds(b: StationBuilder, n: number, reg: Rect, interior: 'maison' | 'entrepot' | 'atelier' | 'vide', ruined = false, loot: 'maison' | 'general' | 'industriel' = 'maison'): BuildingHandle[] {
  const out: BuildingHandle[] = [];
  for (let i = 0; i < n; i++) {
    const w = b.rng.int(6, 10);
    const d = b.rng.int(5, 8);
    const p = b.findSpot(w + 2, d + 2, reg);
    if (!p) continue;
    const lock = b.rng.chance(0.25) ? randomLock(b) : undefined;
    const h = b.building({
      x: p.x, z: p.z, w, d, name: interior === 'maison' ? 'Maison' : interior === 'entrepot' ? 'Remise' : 'Atelier',
      wall: b.rng.pick([0x8a7a66, 0x7a6a5a, 0x9a8a72, 0x6a5e52]), roof: b.rng.pick([0x5a3a2e, 0x4a4a52, 0x6a4a3a]),
      roofType: b.rng.chance(0.6) ? 'pignon' : 'plat', interior, loot, ruined,
      doors: [{ side: 's', offset: b.rng.range(-w / 4, w / 4), lock }],
    });
    if (lock) placeLockHint(b, lock, h.doors[0].id, h, 'la remise');
    out.push(h);
  }
  return out;
}

function stationHouse(b: StationBuilder, ctx: GenCtx): BuildingHandle {
  const ruined = ctx.hostile && b.rng.chance(0.6);
  const h = b.building({
    x: -6, z: 13, w: 12, d: 7, name: 'Bâtiment voyageurs', wall: 0xa89a82, roof: 0x5a3a2e, roofType: 'pignon', interior: ruined ? 'vide' : 'bureau', loot: 'general',
    ruined, doors: [{ side: 'n', offset: 0 }, { side: 's', offset: -3 }],
  });
  b.g.box(3, 0.7, 0.1, -6, 3.0, 9.38, 0x2a3a5a);
  ctx.named.gare = h;
  return h;
}

// ---------------------------------------------------------------- archétypes

type Gen = (b: StationBuilder, ctx: GenCtx) => void;

const depot: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const hangar = b.building({ x: -55, z: 30, w: 24, d: 14, h: 6, name: 'Hangar à locomotives', wall: 0x7a5a48, roof: 0x3a3a3e, interior: 'atelier', loot: 'industriel', richness: 1.4, doors: [{ side: 'n', offset: 0, width: 4 }, { side: 's', offset: 6 }] });
  ctx.named.hangar = hangar;
  const atelier = b.building({ x: 20, z: 22, w: 12, d: 9, name: 'Atelier du dépôt', wall: 0x8a6a52, interior: 'atelier', loot: 'industriel', doors: [{ side: 'w', offset: 0 }, { side: 's', offset: 2 }] });
  ctx.named.atelier = atelier;
  // tour à charbon et château d'eau
  const g = b.g;
  P.coalTower(g, -24, 14.6, -1);
  b.colliders.addRect(-26.5, 11.5, -21.5, 16.5);
  b.reserve({ x0: -28, z0: 10, x1: -20, z1: 20 });
  b.special(-24, 10.2, 'tour_charbon', 'Tour à charbon', 2.2);
  ctx.spots.charbon = { x: -24, z: 10 };
  P.waterTower(g, 34, 40, 2.5, 7.5);
  b.colliders.addCircle(34, 40, 2.7);
  b.reserve({ x0: 30, z0: 36, x1: 38, z1: 44 });
  // voie de garage avec wagons abandonnés au nord
  b.track(-110, 60, -12);
  for (let i = 0; i < 3; i++) {
    const x = -80 + i * 16;
    P.oldWagon(g, x, -12, i % 2 ? 0x6a3a2a : 0x4e5048, b.rng);
    b.colliders.addRect(x - 5.5, -13.8, x + 5.5, -10.2);
  }
  b.reserve(region(-112, -16, 62, -8));
  sheds(b, 3, region(-20, 40, 65, 75), 'maison');
  b.npc({ role: 'marchand', gen: { skill: 'marchand' }, x: 20, z: 27.5, yaw: Math.PI });
  b.npc({ role: 'recrue', x: -10, z: 18, yaw: 0 });
  if (b.rng.chance(0.6)) b.npc({ role: 'recrue', x: 6, z: 16, yaw: 0.5 });
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.6);
};

const village: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // place centrale et puits
  g.cyl(1.2, 1.3, 0.9, -10, 0.45, 38, 0x7a746a, { seg: 10 });
  g.box(0.15, 2.2, 0.15, -11, 1.1, 38, 0x4a3524);
  g.box(0.15, 2.2, 0.15, -9, 1.1, 38, 0x4a3524);
  g.box(2.4, 0.4, 1.4, -10, 2.3, 38, 0x6a3a2a, { rz: 0 });
  b.colliders.addCircle(-10, 38, 1.4);
  b.reserve(region(-16, 32, -4, 44));
  ctx.spots.place = { x: -10, z: 34 };
  const houses = sheds(b, b.rng.int(5, 7), region(-70, 18, 50, 72), 'maison');
  const auberge = b.building({ x: 18, z: 34, w: 13, d: 9, name: 'Auberge', wall: 0x8a6a4a, roof: 0x6a3a2a, roofType: 'pignon', interior: 'bar', loot: 'nourriture', doors: [{ side: 'w', offset: 0 }, { side: 's', offset: 3 }] });
  ctx.named.auberge = auberge;
  ctx.named.maison = houses[0] ?? auberge;
  const grange = b.building({ x: -48, z: 52, w: 14, d: 10, h: 5, name: 'Grange', wall: 0x8a3a2a, roof: 0x4a3a32, roofType: 'pignon', interior: 'entrepot', loot: 'nourriture', richness: 1.3, doors: [{ side: 's', offset: 0, width: 3 }] });
  ctx.named.grange = grange;
  // champs
  for (let r = 0; r < 6; r++) for (let c = 0; c < 12; c++) {
    const x = -105 + c * 2.2;
    const z = 20 + r * 3;
    if (!b.winter) g.dodeca(0.5, x, 0.35, z, r % 2 ? 0x7a9a3a : 0x9aaa4a, { sy: 0.6, vary: 0.15 });
    else g.box(1.6, 0.2, 0.6, x, 0.1, z, 0xdde4e8);
  }
  b.reserve(region(-108, 18, -78, 40));
  b.addCollider(P.fence(g, -108, 17, -78, 17));
  // moulin
  g.cyl(2.2, 2.8, 8, -95, 4, 60, 0xd8d0c0, { seg: 8 });
  g.cone(3, 2.5, -95, 9.2, 60, 0x6a3a2a, { seg: 8 });
  for (let i = 0; i < 4; i++) g.box(0.4, 6, 0.15, -95, 7, 62.9, 0x8a6a42, { rz: i * Math.PI / 2 + 0.3 });
  b.colliders.addCircle(-95, 60, 2.9);
  b.reserve(region(-100, 55, -90, 65));
  b.npc({ role: 'marchand', gen: { skill: 'cuisinier' }, x: 18, z: 31, yaw: 0 });
  for (let i = 0; i < b.rng.int(1, 3); i++) b.npc({ role: 'recrue', x: -10 + b.rng.range(-5, 5), z: 30 + b.rng.range(-2, 2), yaw: b.rng.next() * 6 });
  for (const h of houses.slice(0, 3)) b.npc({ role: 'resident', x: (h.rect.x0 + h.rect.x1) / 2, z: h.rect.z1 + 1.5, yaw: 0 });
  b.perimeter('arbres');
  biomeDressing(b, ctx, 0.7);
};

const marche: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  const colors = [0xb94e3a, 0x3a6a8a, 0xc9a040, 0x6a8a3a, 0x8a4a8a, 0xd08030];
  const stalls: { x: number; z: number }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      const x = -60 + c * 14;
      const z = 22 + r * 14;
      if (!b.isFree(region(x - 3, z - 3, x + 3, z + 3), 0.5)) continue;
      b.addCollider(P.tent(g, x, z, b.rng.next() * 0.3, b.rng.pick(colors)));
      g.box(3, 0.9, 0.8, x, 0.45, z + 2.4, 0x6b4e35);
      g.box(3.2, 0.08, 1.0, x, 0.92, z + 2.4, 0x8a6a42);
      b.colliders.addRect(x - 1.6, z + 1.9, x + 1.6, z + 2.9);
      b.reserve(region(x - 2.5, z - 2.5, x + 2.5, z + 3.2));
      stalls.push({ x, z: z + 3.6 });
    }
  }
  b.rng.shuffle(stalls);
  const nTraders = Math.min(stalls.length, 4);
  for (let i = 0; i < nTraders; i++) b.npc({ role: 'marchand', gen: { skill: 'marchand' }, x: stalls[i].x, z: stalls[i].z - 0.2, yaw: 0 });
  ctx.spots.stalls = stalls[0] ?? { x: 0, z: 20 };
  const bazar = b.building({ x: 40, z: 40, w: 14, d: 12, name: 'Grand Bazar', wall: 0x9a7a5a, roof: 0x8a3a2a, interior: 'boutique', loot: 'general', richness: 1.2, doors: [{ side: 'w', offset: 0, width: 2 }, { side: 's', offset: 0 }] });
  ctx.named.bazar = bazar;
  // caravanes
  for (let i = 0; i < 3; i++) {
    const p = b.findSpot(6, 6, region(-110, 50, -70, 78));
    if (p) b.addCollider(P.car(g, p.x, p.z, b.rng.next() * 6, b.rng.pick(colors), false));
  }
  for (let i = 0; i < 4; i++) {
    const p = b.findSpot(2, 2, region(-70, 15, 30, 70), 20, 0.5);
    if (p) {
      b.addCollider(P.campfire(g, p.x, p.z));
      b.lights.push({ x: p.x, y: 1, z: p.z, color: 0xff9a40, intensity: 3, distance: 9 });
      b.hazard({ kind: 'chaleur', x: p.x, z: p.z, r: 3.5, intensity: 1 });
    }
  }
  for (let i = 0; i < b.rng.int(2, 3); i++) b.npc({ role: 'recrue', x: b.rng.range(-50, 20), z: b.rng.range(18, 50), yaw: b.rng.next() * 6 });
  b.npc({ role: 'resident', x: 30, z: 20, yaw: 0 });
  sheds(b, 2, region(-20, 55, 60, 78), 'maison');
  b.perimeter('palissade');
  biomeDressing(b, ctx, 0.5);
};

const avantposte: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // enceinte de sacs de sable
  for (let x = -70; x <= 50; x += 20) b.addCollider(P.sandbags(g, x, 12, 0, 6));
  for (const [x, z] of [[-75, 20], [55, 20], [-75, 65], [55, 65]]) {
    g.box(0.3, 7, 0.3, x - 1.2, 3.5, z - 1.2, 0x5a4a3a);
    g.box(0.3, 7, 0.3, x + 1.2, 3.5, z - 1.2, 0x5a4a3a);
    g.box(0.3, 7, 0.3, x - 1.2, 3.5, z + 1.2, 0x5a4a3a);
    g.box(0.3, 7, 0.3, x + 1.2, 3.5, z + 1.2, 0x5a4a3a);
    g.box(3.2, 1.2, 3.2, x, 7.4, z, 0x6a5a48);
    g.cone(2.4, 1.4, x, 8.7, z, 0x4a3a2a, { seg: 4, ry: Math.PI / 4 });
    b.colliders.addRect(x - 1.4, z - 1.4, x + 1.4, z + 1.4);
    b.reserve(region(x - 2, z - 2, x + 2, z + 2));
    b.lights.push({ x, y: 7, z, color: 0xffe0b0, intensity: 3, distance: 16, night: true });
  }
  const caserne = b.building({ x: -40, z: 34, w: 18, d: 9, name: 'Caserne', wall: 0x6a6a52, roof: 0x4a4a3a, interior: 'dortoir', loot: 'militaire', doors: [{ side: 's', offset: 0 }, { side: 'e', offset: 0 }] });
  const cmd = b.building({ x: 10, z: 34, w: 12, d: 9, name: 'Poste de commandement', wall: 0x7a7a62, roof: 0x4a4a3a, interior: 'bureau', loot: 'militaire', doors: [{ side: 's', offset: 0 }] });
  const lock: LockSpec = b.rng.chance(0.5) ? { kind: 'carte', color: 'rouge' } : { kind: 'code', code: code4(b) };
  const armu = b.building({ x: 40, z: 56, w: 10, d: 8, name: 'Armurerie', wall: 0x5a5e52, roof: 0x3a3a32, interior: 'armurerie', loot: 'militaire', richness: 1.6, doors: [{ side: 'w', offset: 0, lock, id: `${b.stationId}:armurerie` }] });
  placeLockHint(b, lock, `${b.stationId}:armurerie`, armu, 'l\'armurerie');
  const cantine = b.building({ x: -20, z: 60, w: 12, d: 8, name: 'Cantine', wall: 0x7a6a52, roof: 0x4a4a3a, interior: 'cantine', loot: 'nourriture', doors: [{ side: 'n', offset: 0 }] });
  ctx.named.caserne = caserne;
  ctx.named.commandement = cmd;
  ctx.named.armurerie = armu;
  ctx.named.cantine = cantine;
  if (!ctx.hostile) {
    b.npc({ role: 'marchand', gen: { skill: 'garde' }, x: 10, z: 40, yaw: Math.PI });
    for (let i = 0; i < 3; i++) b.npc({ role: 'resident', gen: { skill: 'garde', personality: 'courageux' }, x: -40 + i * 6, z: 41, yaw: 0 });
    b.npc({ role: 'recrue', gen: { skill: b.rng.pick(['garde', 'tireur']) }, x: -30, z: 28, yaw: 0 });
  }
  populateEnemies(b, ctx, [region(-70, 15, 50, 75)], 1);
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.4);
};

/** Galeries de mine / bunker : grand intérieur sombre découpé en couloirs. */
function tunnels(b: StationBuilder, x: number, z: number, w: number, d: number, name: string, wall: number, opts: { lock?: LockSpec; doorId?: string; dark?: boolean; loot?: 'charbon' | 'militaire' | 'industriel'; hazard?: { kind: 'radiation' | 'gaz'; intensity: number } } = {}): BuildingHandle {
  const h = b.building({ x, z, w, d, h: 3.6, name, wall, roof: 0x2a2622, floor: 0x3a342e, windows: false, dark: opts.dark ?? true, doors: [{ side: 's', offset: -w / 2 + 3, lock: opts.lock, id: opts.doorId, width: 2.2 }], hazard: opts.hazard });
  // cloisons internes en labyrinthe simple
  const g = b.g;
  const cols = Math.floor(w / 6);
  const rows = Math.floor(d / 6);
  for (let c = 1; c < cols; c++) {
    const wx = h.inner.x0 + c * (w / cols);
    const gapRow = b.rng.int(0, rows - 1);
    for (let r = 0; r < rows; r++) {
      if (r === gapRow || b.rng.chance(0.25)) continue;
      const z0 = h.inner.z0 + r * (d / rows);
      const z1 = z0 + d / rows;
      g.box(0.8, 3.6, z1 - z0, wx, 1.8, (z0 + z1) / 2, wall, { vary: 0.1 });
      b.colliders.addRect(wx - 0.4, z0, wx + 0.4, z1, 'wall');
    }
  }
  for (let r = 1; r < rows; r++) {
    const wz = h.inner.z0 + r * (d / rows);
    for (let c = 0; c < cols; c++) {
      if (b.rng.chance(0.6)) continue;
      const x0 = h.inner.x0 + c * (w / cols) + 1.6;
      const x1 = x0 + w / cols - 3.2;
      if (x1 <= x0) continue;
      g.box(x1 - x0, 3.6, 0.8, (x0 + x1) / 2, 1.8, wz, wall, { vary: 0.1 });
      b.colliders.addRect(x0, wz - 0.4, x1, wz + 0.4, 'wall');
    }
  }
  // étais et lampes éteintes
  for (let i = 0; i < 8; i++) {
    const px = b.rng.range(h.inner.x0 + 1, h.inner.x1 - 1);
    const pz = b.rng.range(h.inner.z0 + 1, h.inner.z1 - 1);
    if (b.colliders.blocked(px, pz, 0.6)) continue;
    g.box(0.25, 3.4, 0.25, px, 1.7, pz, 0x5a4028);
    b.colliders.addCircle(px, pz, 0.2);
  }
  // conteneurs
  const n = Math.round((w * d) / 70);
  for (let i = 0; i < n; i++) {
    const px = b.rng.range(h.inner.x0 + 1.2, h.inner.x1 - 1.2);
    const pz = b.rng.range(h.inner.z0 + 1.2, h.inner.z1 - 1.2);
    if (b.colliders.blocked(px, pz, 0.9)) continue;
    b.lootContainer(px, pz, opts.loot === 'charbon' ? 'caisse' : b.rng.pick(['caisse', 'casier', 'cadavre']), opts.loot ?? 'general', 1);
  }
  return h;
}

const mine: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // chevalement
  P.headframe(g, 7, 26);
  b.colliders.addRect(3.5, 25.5, 10.5, 26.5);
  b.reserve(region(2, 23, 12, 34));
  const entree = b.building({ x: 7, z: 40, w: 12, d: 9, name: 'Carreau de la mine', wall: 0x5a4a3a, roof: 0x2a2a2a, interior: 'atelier', loot: 'charbon', doors: [{ side: 's', offset: 0 }, { side: 'n', offset: 0 }] });
  ctx.named.carreau = entree;
  const galeries = tunnels(b, -50, 52, 48, 30, 'Galeries de la mine', 0x4a4038, { loot: 'charbon' });
  ctx.named.galeries = galeries;
  ctx.spots.fond = { x: galeries.inner.x0 + 2.5, z: galeries.inner.z0 + 2.5 };
  // terrils de charbon (récolte gratuite)
  for (let i = 0; i < 3; i++) {
    const p = b.findSpot(5, 5, region(-20, 14, 60, 30));
    if (!p) continue;
    g.cone(2.6, 2.2, p.x, 1.1, p.z, 0x151515, { seg: 8 });
    b.colliders.addCircle(p.x, p.z, 2.4);
    b.special(p.x, p.z + 3, 'terril', 'Ramasser du charbon', 2.6);
  }
  sheds(b, 3, region(20, 40, 68, 76), 'maison', ctx.hostile);
  populateEnemies(b, ctx, [galeries.inner], 1.1, [2, 3]);
  populateEnemies(b, ctx, [region(-20, 14, 68, 40)], 0.3);
  b.perimeter('rochers');
  biomeDressing(b, ctx, 0.8);
};

const ville: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // rues
  for (const z of [26, 50]) {
    g.box(190, 0.03, 7, -25, 0.02, z, 0x3a3a3c);
    b.pave({ x0: -120, z0: z - 3.5, x1: 70, z1: z + 3.5 });
  }
  for (const x of [-80, -30, 20]) {
    g.box(7, 0.03, 66, x, 0.02, 45, 0x3a3a3c);
    b.pave({ x0: x - 3.5, z0: 12, x1: x + 3.5, z1: 78 });
  }
  const blocks: Rect[] = [region(-112, 30, -84, 46), region(-76, 30, -34, 46), region(-26, 30, 16, 46), region(24, 30, 66, 46), region(-112, 54, -84, 76), region(-76, 54, -34, 76), region(-26, 54, 16, 76), region(24, 54, 66, 76), region(-76, 9, -34, 22), region(24, 9, 66, 22)];
  const handles: BuildingHandle[] = [];
  for (const bl of blocks) {
    const w = Math.min(bl.x1 - bl.x0 - 2, b.rng.int(10, 18));
    const d = Math.min(bl.z1 - bl.z0 - 2, b.rng.int(8, 13));
    const p = b.findSpot(w, d, bl, 20, 0.5);
    if (!p) continue;
    const ruined = b.rng.chance(0.45);
    const lock = !ruined && b.rng.chance(0.3) ? randomLock(b, ['code', 'crochet', 'barricade']) : undefined;
    const h = b.building({
      x: p.x, z: p.z, w, d, h: b.rng.chance(0.4) ? 6.5 : 3.6, name: b.rng.pick(['Immeuble', 'Boutique', 'Bureaux', 'Garage', 'Pharmacie']),
      wall: b.rng.pick([0x8a8478, 0x9a8a7a, 0x7a7068, 0xa09080]), roof: 0x3a3a3c, interior: b.rng.pick(['maison', 'boutique', 'bureau', 'garage', 'infirmerie']), loot: b.rng.pick(['general', 'maison', 'medical', 'luxe']),
      ruined, richness: 1.2, doors: [{ side: b.rng.chance(0.5) ? 's' : 'n', offset: 0, lock }],
    });
    if (lock) placeLockHint(b, lock, h.doors[0].id, h, h.spec.name);
    handles.push(h);
  }
  ctx.named.immeuble = handles[0];
  for (let i = 0; i < 10; i++) {
    const p = b.findSpot(5, 5, region(-112, 10, 66, 78), 15, 0.3);
    if (p) b.addCollider(P.car(g, p.x, p.z, b.rng.pick([0, Math.PI / 2]) + b.rng.range(-0.3, 0.3), b.rng.pick([0x7a3a2a, 0x3a5a7a, 0x6a6a3a, 0x8a8a8a]), true));
  }
  populateEnemies(b, ctx, [region(-112, 10, 66, 78)], 1.2);
  b.perimeter('ruines');
  biomeDressing(b, ctx, 0.4);
};

const centrale: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  const rad = Math.max(1.5, ctx.node.radiation);
  // tours de refroidissement
  for (const [x, z] of [[-90, 58], [-62, 66]]) {
    g.cyl(6, 8, 16, x, 8, z, 0x9a968e, { seg: 14, grad: 0.2 });
    g.cyl(6.4, 6, 2, x, 16.5, z, 0x8a867e, { seg: 14 });
    b.colliders.addCircle(x, z, 8.2);
    b.reserve(region(x - 9, z - 9, x + 9, z + 9));
  }
  const lockCtrl: LockSpec = { kind: 'code', code: code4(b) };
  const reacteur = b.building({ x: 0, z: 56, w: 22, d: 16, h: 7, name: 'Bâtiment réacteur', wall: 0x7a7a72, roof: 0x5a5a52, interior: 'reacteur', loot: 'tech', dark: true, richness: 1.2, hazard: { kind: 'radiation', intensity: rad * 1.4 }, doors: [{ side: 'w', offset: 3, lock: { kind: 'carte', color: 'rouge' }, id: `${b.stationId}:reacteur` }, { side: 's', offset: 6, lock: { kind: 'barricade' } }] });
  const controle = b.building({ x: 32, z: 34, w: 12, d: 9, name: 'Salle de contrôle', wall: 0x8a8a82, roof: 0x4a4a42, interior: 'salle_controle', loot: 'tech', doors: [{ side: 'w', offset: 0, lock: lockCtrl, id: `${b.stationId}:controle` }] });
  const admin = b.building({ x: -36, z: 28, w: 14, d: 9, name: 'Administration', wall: 0x9a9a8a, roof: 0x4a4a42, interior: 'bureau', loot: 'general', doors: [{ side: 's', offset: 0 }] });
  const turbines = b.building({ x: 40, z: 64, w: 18, d: 12, h: 6, name: 'Salle des turbines', wall: 0x6a6a62, roof: 0x3a3a32, interior: 'atelier', loot: 'industriel', dark: true, doors: [{ side: 'w', offset: 0 }] });
  ctx.named.reacteur = reacteur;
  ctx.named.controle = controle;
  ctx.named.admin = admin;
  ctx.named.turbines = turbines;
  b.note((admin.inner.x0 + admin.inner.x1) / 2, admin.inner.z0 + 1, 'Mémo de sécurité', `Rappel au personnel : le code de la salle de contrôle est ${lockCtrl.code}. La carte rouge du réacteur est rangée dans le casier du chef d'équipe, salle de contrôle.`, { reveals: { door: `${b.stationId}:controle`, code: lockCtrl.code! } });
  b.pickup((controle.inner.x0 + controle.inner.x1) / 2, controle.inner.z0 + 1.2, { kind: 'item', id: `carte:${b.stationId}:rouge`, qty: 1 });
  // zone irradiée extérieure
  b.hazard({ kind: 'radiation', x: 0, z: 56, r: 22, intensity: rad * 0.35 });
  for (let i = 0; i < 8; i++) {
    const p = b.findSpot(2, 2, region(-30, 30, 30, 78), 10, 0.3);
    if (p) b.addCollider(P.barrel(g, p.x, p.z, 0xa8a020, true));
  }
  populateEnemies(b, ctx, [reacteur.inner, turbines.inner, region(-60, 15, 60, 78)], 1);
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.5);
};

const usine: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  for (let i = 0; i < 5; i++) {
    const p = b.findSpot(7, 7, region(-110, 14, 66, 76));
    if (!p) continue;
    const r = 2.5 + b.rng.next() * 1.5;
    b.addCollider(P.tank(g, p.x, p.z, r, 5 + b.rng.next() * 4, b.rng.pick([0x8a8a7a, 0x7a8a6a, 0x9a7a5a])));
    if (b.rng.chance(0.6)) b.hazard({ kind: 'gaz', x: p.x + r + 2, z: p.z, r: 4, intensity: 1 });
  }
  for (let i = 0; i < 6; i++) P.pipe(g, -100 + i * 25, 15, -80 + i * 25, 15 + b.rng.range(0, 30), 3.5, 0.3, 0x6a6a5a);
  const hall = b.building({ x: -30, z: 50, w: 28, d: 16, h: 7, name: 'Hall de production', wall: 0x6a6a5a, roof: 0x3a3a32, interior: 'entrepot', loot: 'industriel', richness: 1.3, dark: true, hazard: { kind: 'gaz', intensity: 1 }, doors: [{ side: 's', offset: -8, width: 3 }, { side: 'e', offset: 0 }] });
  const lockLab: LockSpec = { kind: 'carte', color: 'bleue' };
  const labo = b.building({ x: 30, z: 30, w: 14, d: 10, name: 'Laboratoire chimique', wall: 0xb0b0a8, roof: 0x5a5a52, interior: 'labo', loot: 'medical', richness: 1.5, doors: [{ side: 's', offset: 0, lock: lockLab, id: `${b.stationId}:labo` }] });
  const bureaux = b.building({ x: 34, z: 60, w: 12, d: 9, name: 'Bureaux', wall: 0x9a9a8a, roof: 0x4a4a42, interior: 'bureau', loot: 'general', doors: [{ side: 'w', offset: 0 }] });
  b.pickup((bureaux.inner.x0 + bureaux.inner.x1) / 2, bureaux.inner.z0 + 1, { kind: 'item', id: `carte:${b.stationId}:bleue`, qty: 1 });
  ctx.named.hall = hall;
  ctx.named.labo = labo;
  ctx.named.bureaux = bureaux;
  for (let i = 0; i < 6; i++) {
    const p = b.findSpot(3, 3, region(-110, 14, 66, 76), 10, 0.2);
    if (!p) continue;
    P.puddle(g, p.x, p.z, 1.5, 0xb0d040, true);
    b.hazard({ kind: 'acide', x: p.x, z: p.z, r: 1.5, intensity: 4 });
  }
  populateEnemies(b, ctx, [hall.inner, region(-110, 14, 66, 76)], 1);
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.4);
};

const campbandit: Gen = (b, ctx) => {
  const g = b.g;
  // palissade intérieure avec portail
  for (let x = -90; x <= 50; x += 3.2) {
    if (Math.abs(x + 20) < 4) continue;
    g.box(3.2, 3.2, 0.5, x, 1.6, 12, 0x6b4e35, { vary: 0.1 });
    g.cone(0.25, 0.8, x, 3.5, 12, 0x6b4e35);
  }
  b.colliders.addRect(-92, 11.7, -24, 12.3);
  b.colliders.addRect(-16, 11.7, 52, 12.3);
  const colors = [0x6a3a2a, 0x4a4a3a, 0x8a5a3a];
  for (let i = 0; i < 8; i++) {
    const p = b.findSpot(4, 4, region(-90, 16, 50, 76));
    if (p) b.addCollider(P.tent(g, p.x, p.z, b.rng.next(), b.rng.pick(colors)));
  }
  const qg = b.building({ x: -20, z: 56, w: 16, d: 11, name: 'Quartier général', wall: 0x5a4a3a, roof: 0x3a2a22, interior: 'bureau', loot: 'bandit', richness: 1.5, doors: [{ side: 's', offset: 0 }] });
  const lockDepot: LockSpec = b.rng.chance(0.5) ? { kind: 'crochet', difficulty: 2 } : { kind: 'code', code: code4(b) };
  const depotB = b.building({ x: 30, z: 60, w: 12, d: 9, name: 'Réserve du butin', wall: 0x5a4a3a, roof: 0x3a2a22, interior: 'entrepot', loot: 'bandit', richness: 2, doors: [{ side: 'w', offset: 0, lock: lockDepot, id: `${b.stationId}:butin` }] });
  placeLockHint(b, lockDepot, `${b.stationId}:butin`, depotB, 'la réserve');
  ctx.named.qg = qg;
  ctx.named.butin = depotB;
  // cage de prisonniers
  g.box(5, 0.2, 4, -70, 0.1, 60, 0x4a4a4a);
  for (let i = 0; i < 9; i++) g.box(0.1, 2.6, 0.1, -72.4 + i * 0.6, 1.3, 58, 0x6a6a6a);
  for (let i = 0; i < 9; i++) g.box(0.1, 2.6, 0.1, -72.4 + i * 0.6, 1.3, 62, 0x6a6a6a);
  b.colliders.addRect(-72.6, 57.8, -67.4, 58.2);
  b.colliders.addRect(-72.6, 61.8, -67.4, 62.2);
  b.colliders.addRect(-72.6, 58, -72.4, 62);
  b.colliders.addRect(-67.6, 58, -67.4, 62);
  b.reserve(region(-74, 56, -66, 64));
  b.special(-70, 63, 'cage', 'Libérer les prisonniers', 1.8);
  ctx.spots.cage = { x: -70, z: 60 };
  for (let i = 0; i < 4; i++) {
    const p = b.findSpot(2, 2, region(-80, 20, 40, 70), 20, 0.5);
    if (p) {
      b.addCollider(P.campfire(g, p.x, p.z));
      b.lights.push({ x: p.x, y: 1, z: p.z, color: 0xff9a40, intensity: 3, distance: 9 });
    }
  }
  populateEnemies(b, ctx, [region(-90, 16, 50, 76), qg.inner], 1.3, [3, 5]);
  if (ctx.node.boss || ctx.node.threat > 2.5) b.enemyGroup(['chef'], -20, 52, 1);
  b.perimeter('palissade');
  biomeDressing(b, ctx, 0.5);
};

const nid: Gen = (b, ctx) => {
  const g = b.g;
  const flesh = 0x6a3a4a;
  // parois organiques
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const x = -20 + Math.cos(a) * 26;
    const z = 50 + Math.sin(a) * 20;
    if (Math.abs(a - Math.PI / 2) < 0.25) continue;
    g.dodeca(2 + b.rng.next(), x, 1.2, z, flesh, { vary: 0.15, sy: 1.4 });
    b.colliders.addCircle(x, z, 2);
  }
  b.reserve(region(-48, 28, 8, 72));
  // œufs (conteneurs)
  for (let i = 0; i < 10; i++) {
    const a = b.rng.next() * Math.PI * 2;
    const r = b.rng.range(6, 18);
    const x = -20 + Math.cos(a) * r;
    const z = 50 + Math.sin(a) * r * 0.7;
    g.layer('glow').sphere(0.6, x, 0.6, z, 0xd0e040, { sy: 1.3 });
    g.layer('base');
  }
  for (let i = 0; i < 8; i++) {
    const x = -20 + b.rng.range(-18, 18);
    const z = 50 + b.rng.range(-12, 12);
    if (!b.colliders.blocked(x, z, 0.8)) b.lootContainer(x, z, 'cadavre', b.rng.pick(['general', 'militaire', 'medical']), 1);
  }
  for (let i = 0; i < 20; i++) P.bones(g, b.rng.range(-110, 60), b.rng.range(12, 76), b.rng);
  ctx.spots.coeur = { x: -20, z: 50 };
  ctx.named.nid = b.building({ x: 40, z: 40, w: 10, d: 8, name: 'Cabane abandonnée', wall: 0x6a5a4a, roof: 0x3a2a22, interior: 'vide', loot: 'general', ruined: true });
  populateEnemies(b, ctx, [region(-44, 32, 4, 68), region(-110, 14, 66, 76)], 1.1, [3, 5]);
  b.enemyGroup(['reine'], -20, 56, 1);
  b.perimeter('rochers');
  biomeDressing(b, ctx, 0.6);
};

const monastere: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  const chapelle = b.building({ x: -20, z: 56, w: 12, d: 18, h: 7, name: 'Chapelle', wall: 0xc8c0b0, roof: 0x5a4a52, roofType: 'pignon', interior: 'chapelle', loot: 'luxe', richness: 0.6, doors: [{ side: 's', offset: 0, width: 2 }] });
  g.box(2.2, 7, 2.2, -20, 10, 46, 0xc8c0b0);
  g.cone(1.8, 3, -20, 15, 46, 0x5a4a52, { seg: 4, ry: Math.PI / 4 });
  const infirm = b.building({ x: 14, z: 40, w: 14, d: 9, name: 'Infirmerie des frères', wall: 0xd0c8b8, roof: 0x5a4a52, interior: 'infirmerie', loot: 'medical', doors: [{ side: 's', offset: 0 }] });
  const dortoir = b.building({ x: -52, z: 34, w: 14, d: 9, name: 'Dortoir', wall: 0xc8c0b0, roof: 0x5a4a52, interior: 'dortoir', loot: 'maison', doors: [{ side: 'e', offset: 0 }] });
  const biblio = b.building({ x: 40, z: 62, w: 11, d: 9, name: 'Bibliothèque', wall: 0xb8b0a0, roof: 0x5a4a52, interior: 'bureau', loot: 'general', doors: [{ side: 'w', offset: 0 }] });
  ctx.named.chapelle = chapelle;
  ctx.named.infirmerie = infirm;
  ctx.named.dortoir = dortoir;
  ctx.named.bibliotheque = biblio;
  // jardin
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) if (!b.winter) g.dodeca(0.4, -14 + c * 1.6, 0.3, 24 + r * 1.8, (r + c) % 3 ? 0x5a9a4a : 0xc04a6a, { sy: 0.7 });
  b.reserve(region(-16, 22, 0, 31));
  b.npc({ role: 'marchand', gen: { skill: 'medecin', personality: 'calme' }, x: 14, z: 46, yaw: 0 });
  b.npc({ role: 'resident', gen: { skill: 'scientifique', personality: 'calme' }, x: -20, z: 44, yaw: 0 });
  b.npc({ role: 'recrue', gen: { skill: b.rng.pick(['medecin', 'cuisinier', 'agronome']) }, x: -8, z: 30, yaw: 0 });
  b.special(14, 46, 'soins', 'Recevoir des soins', 1.6);
  b.perimeter('arbres');
  biomeDressing(b, ctx, 0.6);
};

const hopital: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const lockPh: LockSpec = { kind: 'code', code: code4(b) };
  const hosp = b.building({ x: -26, z: 52, w: 34, d: 20, h: 7, name: 'Hôpital', wall: 0xc8c8c0, roof: 0x6a6a62, interior: 'infirmerie', loot: 'medical', richness: 1.6, dark: true, doors: [{ side: 's', offset: -10, width: 2.4 }, { side: 'e', offset: 4 }] });
  // cloisons internes (chambres)
  const g = b.g;
  for (let i = 1; i < 4; i++) {
    const x = hosp.inner.x0 + i * 8;
    g.box(0.25, 7, 8, x, 3.5, hosp.inner.z0 + 4, 0xc8c8c0);
    b.colliders.addRect(x - 0.12, hosp.inner.z0, x + 0.12, hosp.inner.z0 + 8);
  }
  const pharma = b.building({ x: 26, z: 36, w: 10, d: 8, name: 'Pharmacie', wall: 0xd8d8d0, roof: 0x6a6a62, interior: 'infirmerie', loot: 'medical', richness: 2.2, doors: [{ side: 'w', offset: 0, lock: lockPh, id: `${b.stationId}:pharmacie` }] });
  placeLockHint(b, lockPh, `${b.stationId}:pharmacie`, pharma, 'la pharmacie');
  const morgue = b.building({ x: 34, z: 64, w: 12, d: 8, name: 'Morgue', wall: 0x9a9a92, roof: 0x5a5a52, interior: 'vide', loot: 'medical', dark: true, doors: [{ side: 'w', offset: 0, lock: { kind: 'crochet', difficulty: 1 } }] });
  ctx.named.hopital = hosp;
  ctx.named.pharmacie = pharma;
  ctx.named.morgue = morgue;
  for (let i = 0; i < 4; i++) {
    const p = b.findSpot(5, 5, region(-60, 14, 60, 30));
    if (p) b.addCollider(P.car(g, p.x, p.z, Math.PI / 2, 0xe8e8e0, false));
  }
  populateEnemies(b, ctx, [hosp.inner, region(-110, 14, 66, 76)], 1);
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.4);
};

const laboratoire: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const colors: KeycardColor[] = ['bleue', 'verte'];
  const main = b.building({ x: -20, z: 48, w: 26, d: 16, h: 6, name: 'Bâtiment principal', wall: 0xd0d0cc, roof: 0x5a6068, interior: 'labo', loot: 'tech', richness: 1.4, doors: [{ side: 's', offset: -6, width: 2.4 }] });
  const serveurs = b.building({ x: 26, z: 34, w: 12, d: 9, name: 'Salle des serveurs', wall: 0xc0c0bc, roof: 0x5a6068, interior: 'salle_controle', loot: 'tech', richness: 1.4, doors: [{ side: 'w', offset: 0, lock: { kind: 'carte', color: colors[0] }, id: `${b.stationId}:serveurs` }] });
  const lockCode: LockSpec = { kind: 'code', code: code4(b) };
  const coffre = b.building({ x: 30, z: 62, w: 10, d: 8, name: 'Chambre forte', wall: 0x8a8a86, roof: 0x4a4a46, interior: 'armurerie', loot: 'tech', richness: 2, doors: [{ side: 'w', offset: 0, lock: lockCode, id: `${b.stationId}:chambre` }] });
  const bureaux = b.building({ x: -60, z: 28, w: 14, d: 9, name: 'Bureaux de recherche', wall: 0xd0d0cc, roof: 0x5a6068, interior: 'bureau', loot: 'general', doors: [{ side: 'e', offset: 0 }] });
  b.pickup((bureaux.inner.x0 + bureaux.inner.x1) / 2, bureaux.inner.z1 - 1, { kind: 'item', id: `carte:${b.stationId}:${colors[0]}`, qty: 1 });
  placeLockHint(b, lockCode, `${b.stationId}:chambre`, coffre, 'la chambre forte');
  ctx.named.principal = main;
  ctx.named.serveurs = serveurs;
  ctx.named.chambre = coffre;
  ctx.named.bureaux = bureaux;
  if (ctx.node.faction === 'machine') {
    for (let i = 0; i < Math.round(1 + ctx.node.threat * 0.6); i++) {
      const p = b.findSpot(2, 2, region(-60, 14, 50, 76), 15, 1);
      if (p) b.enemyGroup(['sentinelle'], p.x, p.z, 0);
    }
  } else populateEnemies(b, ctx, [main.inner, region(-110, 14, 66, 76)], 1);
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.4);
};

const port: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // plan d'eau au sud
  b.root.add(waterPlane(-120, 70, 62, 82));
  g.box(190, 0.4, 3, -25, 0.6, 60, 0x6b4e35);
  for (let x = -110; x < 70; x += 4) g.box(0.4, 1.4, 0.4, x, 0.3, 61.3, 0x4a3524);
  b.colliders.addRect(-125, 61.6, 75, 85, 'water', false);
  b.reserve(region(-125, 57, 75, 85));
  for (let i = 0; i < 4; i++) {
    const x = -90 + i * 40;
    g.box(3, 1.2, 9, x, 0.4, 68, 0x6a4a32);
    g.box(2.4, 1.6, 2.4, x, 1.5, 67, 0x8a8a7a);
    g.box(0.15, 5, 0.15, x, 3, 69, 0x4a3524);
  }
  const ent1 = b.building({ x: -50, z: 40, w: 18, d: 11, h: 5, name: 'Entrepôt du port', wall: 0x6a5a4a, roof: 0x3a3a42, interior: 'entrepot', loot: 'nourriture', richness: 1.2, doors: [{ side: 's', offset: 0, width: 3 }] });
  const capitainerie = b.building({ x: 24, z: 32, w: 11, d: 8, name: 'Capitainerie', wall: 0x8a9aa0, roof: 0x3a4a5a, interior: 'bureau', loot: 'general', doors: [{ side: 'w', offset: 0 }] });
  ctx.named.entrepot = ent1;
  ctx.named.capitainerie = capitainerie;
  for (let i = 0; i < 3; i++) {
    const p = b.findSpot(4, 3, region(-30, 45, 60, 56));
    if (!p) continue;
    b.addCollider(P.tent(g, p.x, p.z, 0, b.rng.pick([0x3a6a8a, 0xb94e3a])));
    b.npc({ role: 'marchand', gen: { skill: 'marchand' }, x: p.x, z: p.z + 2.5, yaw: 0 });
  }
  sheds(b, 3, region(-110, 14, 60, 52), 'maison');
  b.npc({ role: 'recrue', x: 0, z: 20, yaw: 0 });
  b.npc({ role: 'resident', x: 10, z: 50, yaw: Math.PI });
  b.perimeter('arbres');
  biomeDressing(b, ctx, 0.4);
};

function waterPlane(x0: number, z0: number, x1: number, z1: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, waterMaterial(0x3a6a78));
  m.position.set((x0 + x1) / 2, 0.15, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}

const pompage: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  P.tank(g, 20, 30, 3, 10, 0x7a6a5a);
  g.box(7, 0.4, 7, 20, 10.2, 30, 0x5a4a3a);
  b.colliders.addCircle(20, 30, 3.2);
  b.reserve(region(15, 25, 25, 35));
  const pompes = b.building({ x: -20, z: 40, w: 14, d: 10, name: 'Salle des pompes', wall: 0x7a7a6a, roof: 0x4a4a42, interior: 'atelier', loot: 'industriel', doors: [{ side: 's', offset: 0 }] });
  ctx.named.pompes = pompes;
  b.special((pompes.inner.x0 + pompes.inner.x1) / 2, pompes.inner.z0 + 1.6, 'pompe', 'Réparer la pompe (15 ferraille)', 1.6);
  b.root.add(waterPlane(-110, 55, -60, 75));
  b.colliders.addRect(-110, 55, -60, 75, 'water', false);
  b.reserve(region(-112, 53, -58, 77));
  sheds(b, 3, region(0, 40, 66, 76), 'maison', ctx.hostile);
  if (!ctx.hostile) {
    b.npc({ role: 'resident', x: -14, z: 34, yaw: 0 });
    b.npc({ role: 'recrue', x: 6, z: 20, yaw: 0 });
  }
  populateEnemies(b, ctx, [region(-110, 14, 66, 76)], 0.9);
  b.perimeter('arbres');
  biomeDressing(b, ctx, 0.7);
};

const triage: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // faisceau de voies au nord
  for (const z of [-12, -20, -28]) b.track(-115, 70, z);
  b.reserve(region(-117, -32, 72, -8));
  // aiguillages
  const names = ['A', 'B', 'C'];
  for (let i = 0; i < 3; i++) {
    const x = -70 + i * 45;
    b.lever(x, -16 - i * 0.2, `Aiguillage ${names[i]}`, ['Gauche', 'Droite'], b.rng.int(0, 1), `${b.stationId}:aiguillage:${names[i]}`);
    ctx.spots[`levier${names[i]}`] = { x, z: -16 };
  }
  // wagons abandonnés récupérables
  const wagonTypes = ['fourgon', 'blinde', 'plateforme', 'passagers', 'generateur', 'infirmerie'];
  for (let i = 0; i < 3; i++) {
    const x = -90 + i * 40;
    const z = -24;
    P.oldWagon(g, x, z, b.rng.pick([0x6a3a2a, 0x4e5048, 0x3e5244]), b.rng);
    b.colliders.addRect(x - 5.5, z - 1.8, x + 5.5, z + 1.8);
    if (b.rng.chance(0.55)) b.special(x, z + 2.6, `recup_wagon:${b.rng.pick(wagonTypes)}`, 'Remettre ce wagon en état', 2.4);
  }
  const poste = b.building({ x: 20, z: 24, w: 9, d: 7, h: 6, name: 'Poste d\'aiguillage', wall: 0x8a6a52, roof: 0x4a3a32, interior: 'salle_controle', loot: 'general', doors: [{ side: 'w', offset: 0 }] });
  ctx.named.poste = poste;
  sheds(b, 3, region(-110, 14, 66, 76), 'entrepot', ctx.hostile, 'industriel');
  populateEnemies(b, ctx, [region(-110, 14, 66, 76), region(-110, -44, 66, -34)], 1);
  b.perimeter('grillage');
  biomeDressing(b, ctx, 0.5);
};

const bunker: Gen = (b, ctx) => {
  const g = b.g;
  // tranchées et barbelés
  for (let x = -90; x <= 40; x += 26) b.addCollider(P.sandbags(g, x, 16, 0, 8));
  const lock: LockSpec = { kind: 'code', code: code4(b) };
  const doorId = `${b.stationId}:porte_blindee`;
  const inner = tunnels(b, -20, 54, 44, 28, 'Bunker', 0x5a5e5a, { lock, doorId, loot: 'militaire', hazard: ctx.node.radiation > 0.3 ? { kind: 'radiation', intensity: ctx.node.radiation } : undefined });
  ctx.named.bunker = inner;
  const poste = b.building({ x: 40, z: 30, w: 9, d: 7, name: 'Poste de garde', wall: 0x6a6e66, roof: 0x3a3e36, interior: 'caserne', loot: 'militaire', doors: [{ side: 'w', offset: 0 }] });
  ctx.named.poste = poste;
  b.note((poste.inner.x0 + poste.inner.x1) / 2, poste.inner.z0 + 1, 'Registre de garde', `Relève de 06h00. Code de la porte blindée : ${lock.code}. Les sentinelles reconnaissent les badges, pas les visages.`, { reveals: { door: doorId, code: lock.code! } });
  for (let i = 0; i < Math.round(2 + ctx.node.threat * 0.8); i++) {
    const px = b.rng.range(inner.inner.x0 + 2, inner.inner.x1 - 2);
    const pz = b.rng.range(inner.inner.z0 + 2, inner.inner.z1 - 2);
    if (!b.colliders.blocked(px, pz, 1)) b.enemyGroup(['sentinelle'], px, pz, 0);
  }
  for (let i = 0; i < 2; i++) {
    const p = b.findSpot(3, 3, region(-80, 14, 50, 40));
    if (p) b.enemyGroup(['sentinelle'], p.x, p.z, 0);
  }
  b.perimeter('rochers');
  biomeDressing(b, ctx, 0.6);
};

const antenne: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  // pylône
  for (let i = 0; i < 8; i++) {
    const h = i * 3;
    const s = 3 - i * 0.32;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(0.2, 3.1, 0.2, -30 + dx * s, h + 1.5, 50 + dz * s, 0xb03a2a, { rz: dx * 0.08, rx: -dz * 0.08 });
    g.box(s * 2, 0.15, 0.15, -30, h + 3, 50 - s, 0x8a8a8a);
    g.box(s * 2, 0.15, 0.15, -30, h + 3, 50 + s, 0x8a8a8a);
  }
  g.layer('glow').sphere(0.4, -30, 24.5, 50, 0xff3020);
  g.layer('base');
  b.colliders.addRect(-33.2, 46.8, -26.8, 53.2);
  b.reserve(region(-35, 45, -25, 55));
  const radio = b.building({ x: 12, z: 46, w: 12, d: 9, name: 'Station radio', wall: 0x8a8a7a, roof: 0x4a4a42, interior: 'radio', loot: 'tech', doors: [{ side: 's', offset: 0 }] });
  ctx.named.radio = radio;
  b.special((radio.inner.x0 + radio.inner.x1) / 2, radio.inner.z0 + 1.4, 'radio', 'Relancer l\'émetteur', 1.6);
  sheds(b, 2, region(-110, 14, 66, 76), 'entrepot', ctx.hostile, 'industriel');
  populateEnemies(b, ctx, [region(-110, 14, 66, 76)], 0.9);
  b.perimeter('rochers');
  biomeDressing(b, ctx, 0.7);
};

const cimetiere: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const g = b.g;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const x = -100 + c * 26 + b.rng.range(-3, 3);
      const z = 22 + r * 14;
      if (!b.isFree(region(x - 7, z - 3, x + 7, z + 3), 0.5)) continue;
      const rot = b.rng.range(-0.25, 0.25);
      const len = b.rng.int(9, 13);
      g.box(len, 3 + b.rng.next(), 3.4, x, 1.8, z, b.rng.pick([0x5a3a2a, 0x4a4a42, 0x3a4a3a, 0x6a4a32]), { ry: rot, rz: b.rng.range(-0.1, 0.1), vary: 0.1 });
      if (b.rng.chance(0.4)) g.cyl(1.2, 1.2, len * 0.6, x + 1, 2.6, z, 0x2a2a2a, { rz: Math.PI / 2, ry: rot, seg: 10 });
      const hw = Math.abs(Math.cos(rot)) * len / 2 + 1.7 * Math.abs(Math.sin(rot));
      const hd = Math.abs(Math.sin(rot)) * len / 2 + 1.7 * Math.abs(Math.cos(rot));
      b.colliders.addRect(x - hw, z - hd, x + hw, z + hd);
      b.reserve(region(x - hw - 1, z - hd - 1, x + hw + 1, z + hd + 1));
      if (b.rng.chance(0.45)) b.lootContainer(x + b.rng.range(-3, 3), z + hd + 1.2, b.rng.pick(['caisse', 'tonneau']), 'industriel', 1.2);
      if (b.rng.chance(0.12)) b.special(x, z + hd + 1.6, `recup_wagon:${b.rng.pick(['fourgon', 'blinde', 'plateforme', 'tender', 'atelier'])}`, 'Remettre ce wagon en état', 2.4);
    }
  }
  ctx.named.atelier = b.building({ x: 40, z: 66, w: 12, d: 8, name: 'Baraque du ferrailleur', wall: 0x6a5a4a, roof: 0x3a3a3a, interior: 'atelier', loot: 'industriel', doors: [{ side: 'w', offset: 0 }] });
  if (!ctx.hostile) b.npc({ role: 'marchand', gen: { skill: 'mecanicien' }, x: 33, z: 66, yaw: -Math.PI / 2 });
  populateEnemies(b, ctx, [region(-110, 14, 66, 76)], 1);
  b.perimeter('rochers');
  biomeDressing(b, ctx, 0.3);
};

const serre: Gen = (b, ctx) => {
  stationHouse(b, ctx);
  const handles: BuildingHandle[] = [];
  for (let i = 0; i < 4; i++) {
    const p = b.findSpot(16, 9, region(-110, 16, 60, 70));
    if (!p) continue;
    handles.push(b.building({ x: p.x, z: p.z, w: 16, d: 9, h: 4, name: 'Serre', wall: 0x9ac8b0, roof: 0xa8d8c8, floor: 0x4a3a2a, roofType: 'verre', interior: 'serre', loot: 'nourriture', richness: 1.2, doors: [{ side: 's', offset: -5 }, { side: 'n', offset: 5 }] }));
  }
  ctx.named.serre = handles[0];
  const ferme = b.building({ x: 40, z: 64, w: 12, d: 9, name: 'Ferme', wall: 0x9a7a5a, roof: 0x6a3a2a, roofType: 'pignon', interior: 'maison', loot: 'nourriture', doors: [{ side: 'w', offset: 0 }] });
  ctx.named.ferme = ferme;
  b.npc({ role: 'marchand', gen: { skill: 'agronome' }, x: 34, z: 64, yaw: -Math.PI / 2 });
  b.npc({ role: 'recrue', gen: { skill: 'agronome' }, x: 0, z: 20, yaw: 0 });
  b.npc({ role: 'resident', x: 20, z: 30, yaw: 0 });
  b.perimeter('arbres');
  biomeDressing(b, ctx, 0.5);
};

export const GENERATORS: Record<string, Gen> = {
  depot, village, marche, avantposte, mine, ville, centrale, usine, campbandit, nid,
  monastere, hopital, laboratoire, port, pompage, triage, bunker, antenne, cimetiere, serre,
};

/** Génère la gare complète (sol, voies, quai, contenu de l'archétype). */
export function generateStation(b: StationBuilder, node: MapNode, budgetMult: number): GenCtx {
  const arch = ARCHETYPES[node.archetype];
  const biome = BIOMES[node.biome];
  const ctx: GenCtx = { node, arch, biome, hostile: node.hostility === 'hostile', named: {}, spots: {}, budget: (6 + node.threat * 5.5) * budgetMult };
  const colors = b.winter && node.biome !== 'desert' ? biome.groundWinter : biome.ground;
  b.ground(colors, node.seed);
  b.track(-260, 160, 0);
  b.buildPlatform();
  GENERATORS[node.archetype](b, ctx);
  return ctx;
}

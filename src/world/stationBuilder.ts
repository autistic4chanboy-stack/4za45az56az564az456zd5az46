import * as THREE from 'three';
import { GeoBuilder } from '../render/geo';
import { CollisionWorld } from './collision';
import { Rng } from '../core/rng';
import { rectContains, rectsOverlap, type Rect } from '../core/math';
import { rollLoot, type LootEntry, type LootProfile } from './loot';
import * as P from '../render/props';
import { Noise2D } from '../core/noise';
import { buildTerrain, buildGrass, buildFlowers, groundCoverFor, vegetationDensity } from '../render/terrain';
import type { PropCollider } from '../render/props';
import type { EnemyId } from '../data/enemies';
import type { KeycardColor } from '../data/items';
import type { BiomeId, Season } from '../data/biomes';
import type { Hazard, BuildingRuntime } from '../game/types';
import type { NpcGenOpts } from './npcgen';
import { PAT } from '../render/toon';
import {
  STYLES, wallStyleFor, roofKindFor, roofPatFor, roofColorFor, windowFlags, awningFor, signFor,
  facade, fbox, windowArt, doorArt, cornerArt, roofArt, ruinedWall, shade, enrichRoof, type RoofKind, type WallStyle,
} from './buildingArt';

export type LockKind = 'code' | 'crochet' | 'carte' | 'cle' | 'barricade';

export interface LockSpec {
  kind: LockKind;
  code?: string;
  color?: KeycardColor;
  keyId?: string;
  keyName?: string;
  difficulty?: number;
}

export type ContainerKind = 'caisse' | 'armoire' | 'coffre' | 'etagere' | 'frigo' | 'pharmacie' | 'bureau' | 'cadavre' | 'sac' | 'casier' | 'tonneau';

export interface ContainerSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  kind: ContainerKind;
  loot: LootEntry[];
  lock?: LockSpec;
  mesh: THREE.Object3D;
  lid: THREE.Object3D | null;
  name: string;
}

export interface DoorSpec {
  id: string;
  x: number;
  z: number;
  /** Porte dans un mur orienté le long de X (mur nord/sud) ou de Z (mur est/ouest). */
  along: 'x' | 'z';
  width: number;
  lock?: LockSpec;
  building: string;
  pivot: THREE.Group;
  collider: Rect;
}

export interface NoteSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  title: string;
  text: string;
  /** Révèle un code de porte. */
  reveals?: { door: string; code: string };
  mesh: THREE.Object3D;
}

export interface LeverSpec {
  id: string;
  x: number;
  z: number;
  label: string;
  states: string[];
  initial: number;
  pivot: THREE.Group;
}

export interface NpcPlacement {
  npcId?: string;
  gen?: NpcGenOpts;
  x: number;
  z: number;
  yaw: number;
  role: 'resident' | 'marchand' | 'recrue' | 'quete' | 'passager';
}

export interface EnemyPlacement {
  id: string;
  type: EnemyId;
  x: number;
  z: number;
  group: string;
}

export interface PickupSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  entry: LootEntry;
  mesh: THREE.Object3D;
}

export interface SpecialSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  action: string;
  label: string;
}

export interface LightSpec {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  night?: boolean;
}

export interface BuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h?: number;
  name: string;
  wall?: number;
  roof?: number;
  floor?: number;
  roofType?: RoofKind;
  /** Style des murs (sinon déduit du nom et de l'intérieur). */
  style?: WallStyle;
  doors?: { side: 'n' | 's' | 'e' | 'w'; offset?: number; lock?: LockSpec; id?: string; width?: number }[];
  windows?: boolean;
  interior?: InteriorKind;
  loot?: LootProfile;
  richness?: number;
  dark?: boolean;
  ruined?: boolean;
  hazard?: { kind: Hazard['kind']; intensity: number; hidden?: boolean };
  containerLock?: LockSpec;
  /** Identifiant fixe (scripts). */
  id?: string;
}

export type InteriorKind =
  | 'maison' | 'boutique' | 'bureau' | 'entrepot' | 'caserne' | 'armurerie' | 'infirmerie' | 'labo' | 'atelier'
  | 'chapelle' | 'reacteur' | 'cantine' | 'serre' | 'vide' | 'salle_controle' | 'radio' | 'garage' | 'bar' | 'dortoir';

export interface BuildingHandle {
  id: string;
  rect: Rect;
  inner: Rect;
  doors: DoorSpec[];
  spec: BuildingSpec;
}

export const PLATFORM_Y = 1.0;

export class StationBuilder {
  readonly rng: Rng;
  readonly root = new THREE.Group();
  readonly colliders = new CollisionWorld();
  readonly g = new GeoBuilder();
  readonly buildings: BuildingRuntime[] = [];
  readonly handles: BuildingHandle[] = [];
  readonly doors: DoorSpec[] = [];
  readonly containers: ContainerSpec[] = [];
  readonly notes: NoteSpec[] = [];
  readonly levers: LeverSpec[] = [];
  readonly npcs: NpcPlacement[] = [];
  readonly enemies: EnemyPlacement[] = [];
  readonly pickups: PickupSpec[] = [];
  readonly specials: SpecialSpec[] = [];
  readonly hazards: Hazard[] = [];
  readonly lights: LightSpec[] = [];
  /** Bouches de cheminée (fumée d'ambiance). */
  readonly chimneys: { x: number; y: number; z: number }[] = [];
  readonly darkRects: Rect[] = [];
  readonly occupied: Rect[] = [];
  /** Surfaces pavées ou dallées (routes, places) : pas d'herbe. */
  readonly paved: Rect[] = [];
  private groundSeed = 1;
  private counter = 0;
  bounds: Rect = { x0: -125, z0: -48, x1: 75, z1: 82 };
  platform: Rect = { x0: -100, z0: 2.3, x1: 18, z1: 6.6 };
  spawn = { x: 0, z: 4.5 };
  readonly winter: boolean;

  constructor(
    readonly stationId: string,
    seed: number,
    readonly biome: BiomeId,
    readonly season: Season,
    readonly tier: number,
    readonly lootMult: number,
    readonly trainRearX: number,
    readonly trainFrontX: number,
  ) {
    this.rng = new Rng(seed);
    this.winter = season === 'hiver' || biome === 'toundra';
    this.platform = { x0: Math.min(-40, trainRearX - 6), z0: 2.3, x1: trainFrontX + 6, z1: 6.6 };
    this.occupied.push({ x0: -400, z0: -4, x1: 400, z1: 7.5 });
  }

  nextId(kind: string): string {
    return `${this.stationId}:${kind}:${++this.counter}`;
  }

  // ------------------------------------------------------------------ placement

  /** Marque une zone comme occupée. */
  reserve(r: Rect): void {
    this.occupied.push(r);
  }

  isFree(r: Rect, margin = 1.2): boolean {
    if (r.x0 < this.bounds.x0 + 2 || r.x1 > this.bounds.x1 - 2 || r.z0 < this.bounds.z0 + 2 || r.z1 > this.bounds.z1 - 2) return false;
    return !this.occupied.some((o) => rectsOverlap(o, r, margin));
  }

  /** Cherche un emplacement libre de taille w×d dans une région. */
  findSpot(w: number, d: number, region: Rect, tries = 60, margin = 1.5): { x: number; z: number } | null {
    for (let i = 0; i < tries; i++) {
      const x = this.rng.range(region.x0 + w / 2, region.x1 - w / 2);
      const z = this.rng.range(region.z0 + d / 2, region.z1 - d / 2);
      const r = { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
      if (this.isFree(r, margin)) return { x, z };
    }
    return null;
  }

  addCollider(c: PropCollider, tag: 'prop' | 'wall' = 'prop', blocksShots = true): void {
    if (!c) return;
    if (c.kind === 'circle') this.colliders.addCircle(c.x, c.z, c.r, tag, blocksShots);
    else this.colliders.addRect(c.x0, c.z0, c.x1, c.z1, tag, blocksShots);
  }

  // ------------------------------------------------------------------ sol, voies, quai

  /** Sol continu de la gare (couleurs du biome fondues, ballast sous la voie). */
  ground(colors: number[], seed: number): void {
    const b = this.bounds;
    const ext = 26;
    this.groundSeed = seed;
    const ballast = new THREE.Color(0x5e554c);
    const mesh = buildTerrain({
      x0: b.x0 - ext, x1: b.x1 + ext, z0: b.z0 - ext, z1: b.z1 + ext,
      cell: 2,
      colors,
      seed,
      paint: (x, z, c) => {
        const t = Math.abs(z);
        if (t < 2.6) c.lerp(ballast, t < 1.9 ? 0.85 : 0.45);
      },
    });
    this.root.add(mesh);
  }

  /** Une zone pavée (route, place) : la végétation n'y pousse pas. */
  pave(r: Rect): void {
    this.paved.push(r);
  }

  /** Herbe, roseaux et fleurs semés là où rien n'est construit. */
  private plantGroundCover(): void {
    const cover = groundCoverFor(this.biome, this.winter);
    if (!cover.grass) return;
    const b = this.bounds;
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    const clump = new Noise2D(this.groundSeed + 77);
    const ok = (x: number, z: number): boolean => {
      if (Math.abs(z) < 2.4) return false;
      if (rectContains(this.platform, x, z, 0.4)) return false;
      if (this.occupied.some((r, i) => i > 0 && rectContains(r, x, z, 0.2))) return false;
      if (this.paved.some((r) => rectContains(r, x, z, 0.3))) return false;
      if (this.buildings.some((bd) => rectContains(bd.rect, x, z, 0.4))) return false;
      return !this.colliders.blocked(x, z, 0.25);
    };
    const sample = (threshold: number) => (rng: Rng) => {
      const x = rng.range(b.x0, b.x1);
      const z = rng.range(b.z0, b.z1);
      if (clump.fbm(x * 0.07, z * 0.07, 2) < threshold) return null;
      return ok(x, z) ? { x, z } : null;
    };
    const dens = vegetationDensity();
    const grass = buildGrass({ kind: cover.grass, count: Math.round(area * 0.42 * cover.density * dens), seed: `${this.stationId}:herbe`, sample: sample(-0.45), colors: cover.colors });
    if (grass) this.root.add(grass);
    if (cover.tall > 0) {
      const tall = buildGrass({ kind: cover.grass === 'roseau' ? 'roseau' : 'haute', count: Math.round(area * 0.05 * cover.tall * dens), seed: `${this.stationId}:haute`, sample: sample(0.1), colors: cover.colors, scale: [0.9, 1.4] });
      if (tall) this.root.add(tall);
    }
    if (cover.flowers) {
      const fl = buildFlowers({ count: Math.round(area * 0.03 * cover.density * dens), seed: `${this.stationId}:fleurs`, sample: sample(0.05), colors: cover.flowers });
      if (fl) this.root.add(fl);
    }
  }

  track(x0: number, x1: number, z: number, color = 0x4a3a2c): void {
    const g = this.g;
    for (let x = x0; x < x1; x += 1.1) g.box(0.35, 0.14, 2.6, x, 0.07, z, color, { vary: 0.08 });
    g.box(x1 - x0, 0.12, 0.1, (x0 + x1) / 2, 0.2, z - 0.75, 0x6a6a6a);
    g.box(x1 - x0, 0.12, 0.1, (x0 + x1) / 2, 0.2, z + 0.75, 0x6a6a6a);
    g.box(x1 - x0, 0.05, 3.4, (x0 + x1) / 2, 0.02, z, 0x5a5048, { vary: 0 });
  }

  buildPlatform(): void {
    const p = this.platform;
    const g = this.g;
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    g.box(w, PLATFORM_Y, d, (p.x0 + p.x1) / 2, PLATFORM_Y / 2, (p.z0 + p.z1) / 2, 0x8e887c, { grad: 0.2, pat: PAT.paves });
    g.box(w, 0.08, 0.5, (p.x0 + p.x1) / 2, PLATFORM_Y + 0.02, p.z0 + 0.25, 0xb0aa9c, { pat: PAT.pierre });
    g.box(w, 0.06, 0.22, (p.x0 + p.x1) / 2, PLATFORM_Y + 0.05, p.z0 + 0.62, 0xd8c040);
    // escaliers d'accès
    for (const x of [p.x0 + 1, p.x1 - 1]) {
      for (let i = 0; i < 3; i++) g.box(2, 0.33, 0.6, x, 0.17 + i * 0.33 - 0.17, p.z1 + 0.3 + (2 - i) * 0.6 - 0.6, 0x7a746a);
    }
    // lampadaires du quai
    for (let x = p.x0 + 6; x < p.x1 - 2; x += 18) {
      P.lampPost(g, x, p.z1 - 0.6, true);
      this.colliders.addCircle(x, p.z1 - 0.6, 0.2);
      this.lights.push({ x: x + 0.75, y: 4, z: p.z1 - 0.6, color: 0xffd8a0, intensity: 3, distance: 14, night: true });
    }
    // bancs
    for (let x = p.x0 + 12; x < p.x1 - 6; x += 22) {
      g.box(2.2, 0.1, 0.6, x, PLATFORM_Y + 0.5, p.z1 - 1.2, 0x6b4e35);
      g.box(2.2, 0.5, 0.1, x, PLATFORM_Y + 0.75, p.z1 - 0.95, 0x6b4e35);
      g.box(0.1, 0.5, 0.5, x - 1, PLATFORM_Y + 0.25, p.z1 - 1.2, 0x2a2a2a);
      g.box(0.1, 0.5, 0.5, x + 1, PLATFORM_Y + 0.25, p.z1 - 1.2, 0x2a2a2a);
      this.colliders.addRect(x - 1.1, p.z1 - 1.5, x + 1.1, p.z1 - 0.9, 'prop', false);
    }
  }

  /** Hauteur du sol (quai). */
  groundY(x: number, z: number): number {
    const p = this.platform;
    if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return PLATFORM_Y;
    return 0;
  }

  // ------------------------------------------------------------------ bâtiments

  building(spec: BuildingSpec): BuildingHandle {
    const id = spec.id ?? this.nextId('bat');
    const { x, z, w, d } = spec;
    const h = spec.h ?? 3.4;
    const wall = spec.wall ?? 0x8a7a66;
    const rect = { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
    const inner = { x0: rect.x0 + 0.25, z0: rect.z0 + 0.25, x1: rect.x1 - 0.25, z1: rect.z1 - 0.25 };
    this.reserve({ x0: rect.x0 - 1, z0: rect.z0 - 1, x1: rect.x1 + 1, z1: rect.z1 + 1 });
    // habillage : tirages visuels séparés (n'altèrent pas la génération de la gare)
    const vr = new Rng(`${this.stationId}:${id}:${spec.name}:art`);
    const styleId = wallStyleFor(spec, vr);
    const style = STYLES[styleId];
    const roofKind = spec.ruined ? 'aucun' : roofKindFor(spec, styleId, vr);
    const roofPat = roofPatFor(roofKind, styleId, vr);
    const roofC = spec.roof !== undefined ? enrichRoof(spec.roof, roofKind) : roofColorFor(roofPat, vr);
    const woodFloor = styleId === 'bois' || styleId === 'grange' || (!!spec.interior && ['maison', 'bar', 'dortoir', 'chapelle', 'boutique'].includes(spec.interior));
    const floor = spec.floor ?? (woodFloor ? 0x6a5038 : 0x6a645a);
    const flags = windowFlags(spec, styleId, this.winter, vr);
    const base = new GeoBuilder();
    const front = new GeoBuilder();
    const T = 0.25;
    base.box(w, 0.12, d, x, 0.06, z, floor, { vary: 0.03, pat: woodFloor ? PAT.platelage : PAT.paves });
    const doors = (spec.doors ?? [{ side: 's' as const }]).map((dd) => ({ ...dd, offset: dd.offset ?? 0, width: dd.width ?? 1.6 }));
    const mainDoor = doors.find((dd) => dd.side === 's') ?? doors[0];
    const wallSide = (side: 'n' | 's' | 'e' | 'w', gb: GeoBuilder) => {
      const f = facade(side, rect, T);
      const along = f.along;
      const len = along === 'x' ? w : d;
      const fixed = f.fixed;
      const center = along === 'x' ? x : z;
      const sideDoors = doors.filter((dd) => dd.side === side).sort((a, b) => a.offset - b.offset);
      let cur = -len / 2;
      const segs: [number, number][] = [];
      for (const dd of sideDoors) {
        segs.push([cur, dd.offset - dd.width / 2]);
        cur = dd.offset + dd.width / 2;
      }
      segs.push([cur, len / 2]);
      for (const [a, b] of segs) {
        const sl = b - a;
        if (sl <= 0.05) continue;
        const mid = center + (a + b) / 2;
        if (spec.ruined) {
          // l'ancien tirage de hauteur est conservé pour ne pas décaler la génération
          this.rng.next();
          ruinedWall(gb, f, center + a, center + b, h, T, wall, style.pat, vr);
        } else fbox(gb, f, mid, h / 2, 0, sl, h, T, wall, { grad: 0.18, vary: 0.04, pat: style.pat });
        if (along === 'x') this.colliders.addRect(center + a, fixed - T / 2, center + b, fixed + T / 2, 'wall');
        else this.colliders.addRect(fixed - T / 2, center + a, fixed + T / 2, center + b, 'wall');
        // soubassement
        if (style.plinth !== null) fbox(gb, f, mid, 0.28, 0, sl, 0.56, T + 0.1, style.plinth, { vary: 0.03, pat: style.plinthPat });
        // corniche
        if (!spec.ruined && roofKind !== 'plat') fbox(gb, f, mid, h - 0.1, 0.02, sl + 0.02, 0.22, T + 0.12, shade(style.trim, styleId === 'bois' || styleId === 'tole' ? 1 : 0.92));
        // fenêtres
        if (spec.windows !== false && sl > 2.6 && !spec.ruined) {
          const nWin = Math.floor(sl / 3);
          for (let i = 0; i < nWin; i++) {
            const off = a + (sl * (i + 0.5)) / nWin;
            const lit = !spec.dark && this.rng.chance(0.5);
            windowArt(gb, f, center + off, { style, lit, T, shutter: flags.shutter, flowers: side === 's' ? flags.flowers : null });
          }
        }
      }
      // linteaux, encadrements et portes
      for (const dd of sideDoors) {
        const mid = center + dd.offset;
        if (h > 2.6 && !spec.ruined) fbox(gb, f, mid, 2.5 + (h - 2.5) / 2, 0, dd.width, h - 2.5, T, wall, { pat: style.pat });
        if (!spec.ruined) {
          const isMain = dd === mainDoor;
          const lamp = doorArt(gb, f, mid, {
            style,
            T,
            width: dd.width,
            h,
            awning: isMain ? awningFor(spec, vr) : null,
            sign: isMain && signFor(spec),
            lamp: isMain && !spec.dark,
          });
          if (lamp) this.lights.push({ x: lamp.x, y: lamp.y, z: lamp.z, color: 0xffc070, intensity: 1.4, distance: 7, night: true });
        }
        const doorId = dd.id ?? `${id}:porte:${side}${Math.round(dd.offset)}`;
        const dx = along === 'x' ? mid : fixed;
        const dz = along === 'x' ? fixed : mid;
        this.door(doorId, dx, dz, along, dd.width, dd.lock, id, side === 's' || side === 'e' ? 1 : -1);
      }
    };
    wallSide('n', base);
    wallSide('e', base);
    wallSide('w', base);
    wallSide('s', front);
    if (!spec.ruined) cornerArt(base, front, rect, h, style);
    // descente d'eau pluviale
    if (roofKind === 'pignon') front.box(0.12, h + 0.1, 0.12, rect.x1 - 0.45, h / 2, rect.z1 + 0.1, 0x55595e);
    const group = new THREE.Group();
    const baseGroup = base.toGroup();
    const frontGroup = front.toGroup();
    group.add(baseGroup, frontGroup);
    // toit
    const roof = new GeoBuilder();
    const roofRes = roofArt(roof, { kind: roofKind, x, z, w, d, h, T, wall, wallPat: style.pat, color: roofC, pat: roofPat, trim: style.trim, interior: spec.interior, dark: !!spec.dark, vr });
    if (spec.ruined) {
      for (let i = 0; i < 3; i++) {
        const pw = w * (0.2 + this.rng.next() * 0.3);
        roof.box(pw, 0.2, d * 0.4, x + (this.rng.next() - 0.5) * (w - pw), h * 0.7, z + (this.rng.next() - 0.5) * d * 0.5, roofC, { rx: this.rng.range(-0.3, 0.3), rz: this.rng.range(-0.2, 0.2), pat: roofPat });
      }
      // charpente calcinée
      for (let i = 0; i < 3; i++) roof.box(0.22, 0.22, d + 0.4, x + vr.range(-w * 0.4, w * 0.4), h * vr.range(0.55, 0.85), z, 0x2e2622, { rz: vr.range(-0.25, 0.25), rx: vr.range(-0.12, 0.12) });
      // gravats au pied des murs
      for (let i = 0; i < Math.round((w + d) / 3); i++) {
        const onX = vr.chance(w / (w + d));
        const px = onX ? vr.range(rect.x0, rect.x1) : vr.chance(0.5) ? rect.x0 - 0.5 : rect.x1 + 0.5;
        const pz = onX ? (vr.chance(0.5) ? rect.z0 - 0.5 : rect.z1 + 0.5) : vr.range(rect.z0, rect.z1);
        base.dodeca(vr.range(0.18, 0.4), px, 0.1, pz, shade(wall, vr.range(0.7, 0.95)), { sy: 0.6, ry: vr.next() * 6 });
      }
    }
    for (const c of roofRes.chimneys) this.chimneys.push(c);
    const roofGroup = roof.isEmpty ? new THREE.Group() : roof.toGroup();
    group.add(roofGroup);
    this.root.add(group);
    const handle: BuildingHandle = { id, rect, inner, doors: this.doors.filter((dd) => dd.building === id), spec };
    this.handles.push(handle);
    this.buildings.push({ id, name: spec.name, rect, roof: roofGroup, front: [frontGroup], dark: !!spec.dark, inside: false, fade: 0 });
    if (spec.dark) this.darkRects.push(inner);
    if (spec.hazard) this.hazards.push({ kind: spec.hazard.kind, x, z, r: 0, rect: inner, intensity: spec.hazard.intensity, hidden: spec.hazard.hidden });
    if (spec.interior) this.furnish(handle, spec.interior, spec.loot ?? 'general', spec.richness ?? 1);
    if (!spec.dark && !spec.ruined) this.lights.push({ x, y: h - 0.6, z, color: 0xffd8a0, intensity: 2.2, distance: Math.max(w, d) + 2, night: true });
    return handle;
  }

  door(id: string, x: number, z: number, along: 'x' | 'z', width: number, lock: LockSpec | undefined, building: string, openDir: 1 | -1): DoorSpec {
    const pivot = new THREE.Group();
    const gb = new GeoBuilder();
    const color = lock?.kind === 'barricade' ? 0x6b4e35 : lock?.kind === 'carte' || lock?.kind === 'code' ? 0x5a6066 : 0x6b4a32;
    // la porte pivote sur un bord
    if (along === 'x') {
      gb.box(width - 0.05, 2.4, 0.1, width / 2, 1.2, 0, color);
      if (lock?.kind === 'barricade') {
        gb.box(width + 0.3, 0.25, 0.14, width / 2, 0.8, 0.08 * openDir, 0x8a6a42, { rz: 0.2 });
        gb.box(width + 0.3, 0.25, 0.14, width / 2, 1.8, 0.08 * openDir, 0x8a6a42, { rz: -0.25 });
      }
      pivot.position.set(x - width / 2, 0, z);
    } else {
      gb.box(0.1, 2.4, width - 0.05, 0, 1.2, width / 2, color);
      if (lock?.kind === 'barricade') {
        gb.box(0.14, 0.25, width + 0.3, 0.08 * openDir, 0.8, width / 2, 0x8a6a42, { rx: 0.2 });
        gb.box(0.14, 0.25, width + 0.3, 0.08 * openDir, 1.8, width / 2, 0x8a6a42, { rx: -0.25 });
      }
      pivot.position.set(x, 0, z - width / 2);
    }
    if (lock && lock.kind !== 'barricade') {
      const lc = lock.kind === 'carte' ? (lock.color === 'rouge' ? 0xe74c3c : lock.color === 'bleue' ? 0x3498db : lock.color === 'verte' ? 0x2ecc71 : 0xf1c40f) : lock.kind === 'code' ? 0x40ff80 : 0xd0a040;
      gb.layer('glow');
      if (along === 'x') gb.box(0.18, 0.18, 0.16, width - 0.25, 1.3, 0.04 * openDir, lc);
      else gb.box(0.16, 0.18, 0.18, 0.04 * openDir, 1.3, width - 0.25, lc);
      gb.layer('base');
    }
    pivot.add(gb.toGroup({ castShadow: true }));
    pivot.userData.openDir = openDir;
    pivot.userData.along = along;
    this.root.add(pivot);
    const collider = along === 'x' ? { x0: x - width / 2, z0: z - 0.15, x1: x + width / 2, z1: z + 0.15 } : { x0: x - 0.15, z0: z - width / 2, x1: x + 0.15, z1: z + width / 2 };
    const spec: DoorSpec = { id, x, z, along, width, lock, building, pivot, collider };
    this.doors.push(spec);
    return spec;
  }

  // ------------------------------------------------------------------ conteneurs, notes, objets

  container(x: number, z: number, kind: ContainerKind, loot: LootEntry[], opts: { lock?: LockSpec; ry?: number; y?: number; id?: string; name?: string } = {}): ContainerSpec {
    const id = opts.id ?? this.nextId('cont');
    const y = opts.y ?? 0;
    const g = new GeoBuilder();
    const lidG = new GeoBuilder();
    let name = 'Caisse';
    let colliderR = 0.6;
    switch (kind) {
      case 'caisse':
        g.box(1.0, 0.7, 0.7, 0, 0.35, 0, 0x8a6a42, { vary: 0.06 });
        g.box(1.04, 0.08, 0.74, 0, 0.12, 0, 0x5a4428);
        lidG.box(1.04, 0.12, 0.74, 0, 0.06, 0.37, 0x7a5a38);
        name = 'Caisse';
        break;
      case 'coffre':
        g.box(1.0, 0.55, 0.65, 0, 0.27, 0, 0x5a3a22);
        g.box(1.04, 0.06, 0.68, 0, 0.45, 0, 0xc9a040);
        lidG.box(1.02, 0.2, 0.66, 0, 0.1, 0.33, 0x6a4a2a);
        name = 'Coffre';
        break;
      case 'armoire':
        g.box(1.0, 2.0, 0.55, 0, 1.0, 0, 0x5a4a3a);
        lidG.box(0.95, 1.9, 0.06, 0.48, 0, 0.0, 0x6a5a48);
        name = 'Armoire';
        colliderR = 0.65;
        break;
      case 'casier':
        g.box(0.6, 1.9, 0.5, 0, 0.95, 0, 0x5a6a5a);
        lidG.box(0.56, 1.8, 0.05, 0.28, 0, 0, 0x6a7a6a);
        name = 'Casier';
        colliderR = 0.45;
        break;
      case 'etagere':
        g.box(1.6, 1.9, 0.45, 0, 0.95, 0, 0x6b4e35);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) g.box(0.25, 0.25, 0.25, -0.55 + j * 0.37, 0.35 + i * 0.6, 0.05, [0xb08040, 0x6a8aa0, 0xa04030, 0x8a8a6a][(i + j) % 4], { vary: 0.1 });
        name = 'Étagère';
        colliderR = 0.8;
        break;
      case 'frigo':
        g.box(0.8, 1.8, 0.7, 0, 0.9, 0, 0xd8d8d0);
        lidG.box(0.78, 1.7, 0.06, 0.39, 0, 0, 0xe8e8e0);
        name = 'Réfrigérateur';
        break;
      case 'pharmacie':
        g.box(0.9, 1.4, 0.4, 0, 1.3, 0, 0xe8e8e0);
        g.box(0.4, 0.1, 0.05, 0, 1.5, 0.21, 0xc03030);
        g.box(0.1, 0.4, 0.05, 0, 1.5, 0.21, 0xc03030);
        lidG.box(0.86, 1.3, 0.05, 0.43, 0, 0, 0xf0f0e8);
        name = 'Armoire à pharmacie';
        break;
      case 'bureau':
        g.box(1.5, 0.08, 0.8, 0, 0.78, 0, 0x6b4e35);
        g.box(0.5, 0.74, 0.75, -0.45, 0.37, 0, 0x5a3e28);
        g.box(0.1, 0.74, 0.1, 0.65, 0.37, 0.3, 0x5a3e28);
        g.box(0.1, 0.74, 0.1, 0.65, 0.37, -0.3, 0x5a3e28);
        name = 'Bureau';
        colliderR = 0.75;
        break;
      case 'cadavre':
        g.box(0.5, 0.25, 1.6, 0, 0.13, 0, 0x5a4a3a, { ry: 0.3 });
        g.box(0.3, 0.25, 0.3, 0.2, 0.15, 0.9, 0xc68e62, { ry: 0.3 });
        name = 'Cadavre';
        colliderR = 0;
        break;
      case 'sac':
        g.sphere(0.4, 0, 0.3, 0, 0x6a5a3a, { sy: 0.8 });
        name = 'Sac';
        colliderR = 0;
        break;
      case 'tonneau':
        g.cyl(0.38, 0.38, 1.0, 0, 0.5, 0, 0x6a4a2a, { seg: 9 });
        lidG.cyl(0.38, 0.38, 0.06, 0, 0, 0, 0x5a3a20, { seg: 9 });
        name = 'Tonneau';
        colliderR = 0.4;
        break;
    }
    const mesh = g.toGroup();
    const pivot = new THREE.Group();
    mesh.position.set(x, y, z);
    mesh.rotation.y = opts.ry ?? 0;
    let lid: THREE.Object3D | null = null;
    if (!lidG.isEmpty) {
      lid = lidG.toGroup();
      const top = kind === 'caisse' || kind === 'coffre' ? (kind === 'caisse' ? 0.7 : 0.55) : kind === 'tonneau' ? 1.0 : 0;
      if (kind === 'caisse' || kind === 'coffre' || kind === 'tonneau') {
        pivot.position.set(0, top, -0.33);
        lid.position.set(0, 0, kind === 'tonneau' ? 0.33 : 0);
      } else {
        const zFront = kind === 'pharmacie' ? 0.2 : kind === 'frigo' ? 0.35 : 0.28;
        pivot.position.set(kind === 'casier' ? -0.28 : kind === 'pharmacie' ? -0.43 : kind === 'frigo' ? -0.39 : -0.48, kind === 'pharmacie' ? 1.3 : kind === 'casier' ? 0.95 : 0.9 + (kind === 'frigo' ? 0 : 0.1), zFront);
        lid.position.set(0, 0, 0);
      }
      pivot.add(lid);
      mesh.add(pivot);
    }
    this.root.add(mesh);
    if (colliderR > 0) {
      if (kind === 'armoire' || kind === 'etagere' || kind === 'bureau' || kind === 'caisse' || kind === 'coffre') {
        const hw = kind === 'etagere' ? 0.8 : kind === 'bureau' ? 0.75 : 0.5;
        const hd = kind === 'bureau' ? 0.4 : 0.32;
        const ry = opts.ry ?? 0;
        const rx = Math.abs(Math.cos(ry)) * hw + Math.abs(Math.sin(ry)) * hd;
        const rz = Math.abs(Math.sin(ry)) * hw + Math.abs(Math.cos(ry)) * hd;
        this.colliders.addRect(x - rx, z - rz, x + rx, z + rz, 'prop');
      } else this.colliders.addCircle(x, z, colliderR, 'prop');
    }
    const c: ContainerSpec = { id, x, y, z, kind, loot, lock: opts.lock, mesh, lid: lid ? pivot : null, name: opts.name ?? name };
    this.containers.push(c);
    return c;
  }

  /** Conteneur avec butin tiré selon un profil. */
  lootContainer(x: number, z: number, kind: ContainerKind, profile: LootProfile, richness = 1, opts: { lock?: LockSpec; ry?: number; y?: number; id?: string } = {}): ContainerSpec {
    return this.container(x, z, kind, rollLoot(this.rng, profile, this.tier, richness, this.lootMult), opts);
  }

  note(x: number, z: number, title: string, text: string, opts: { y?: number; reveals?: { door: string; code: string }; id?: string } = {}): NoteSpec {
    const id = opts.id ?? this.nextId('note');
    const y = opts.y ?? 0.82;
    const g = new GeoBuilder();
    g.layer('glow').box(0.32, 0.02, 0.42, 0, 0, 0, 0xfff4c0, { ry: this.rng.range(-0.4, 0.4) });
    const mesh = g.toGroup({ castShadow: false });
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    const n: NoteSpec = { id, x, y, z, title, text, reveals: opts.reveals, mesh };
    this.notes.push(n);
    return n;
  }

  pickup(x: number, z: number, entry: LootEntry, opts: { y?: number; id?: string } = {}): PickupSpec {
    const id = opts.id ?? this.nextId('obj');
    const y = opts.y ?? 0;
    const g = new GeoBuilder();
    if (entry.kind === 'weapon') {
      g.box(0.9, 0.12, 0.25, 0, 0.1, 0, 0x2a2a2e);
      g.box(0.3, 0.12, 0.25, -0.3, 0.1, 0, 0x6b4a2e);
    } else if (entry.kind === 'item') {
      g.box(0.35, 0.3, 0.35, 0, 0.18, 0, 0xc0a040);
    } else if (entry.kind === 'gear' || entry.kind === 'tool') {
      g.box(0.5, 0.25, 0.4, 0, 0.13, 0, 0x6a7a8a);
    } else {
      g.box(0.5, 0.35, 0.4, 0, 0.18, 0, 0x8a7a5a);
    }
    g.layer('glow').box(0.08, 0.08, 0.08, 0, 0.6, 0, 0xfff0a0);
    const mesh = g.toGroup();
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    const p: PickupSpec = { id, x, y, z, entry, mesh };
    this.pickups.push(p);
    return p;
  }

  lever(x: number, z: number, label: string, states: string[], initial = 0, id?: string): LeverSpec {
    const lid = id ?? this.nextId('levier');
    const g = this.g;
    g.box(0.8, 0.9, 0.5, x, 0.45, z, 0x4a4e48);
    g.box(0.9, 0.08, 0.6, x, 0.92, z, 0x8a2a1e);
    this.colliders.addRect(x - 0.45, z - 0.3, x + 0.45, z + 0.3, 'prop');
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.95, z);
    const lg = new GeoBuilder();
    lg.box(0.08, 1.1, 0.08, 0, 0.55, 0, 0x8a8a8a);
    lg.layer('glow').box(0.18, 0.18, 0.18, 0, 1.12, 0, 0xffd040);
    pivot.add(lg.toGroup());
    this.root.add(pivot);
    const l: LeverSpec = { id: lid, x, z, label, states, initial, pivot };
    this.levers.push(l);
    return l;
  }

  special(x: number, z: number, action: string, label: string, radius = 1.4, y = 0): SpecialSpec {
    const s: SpecialSpec = { id: this.nextId('sp'), x, y, z, radius, action, label };
    this.specials.push(s);
    return s;
  }

  npc(p: NpcPlacement): void {
    this.npcs.push(p);
  }

  enemyGroup(types: EnemyId[], cx: number, cz: number, spread = 4, group?: string): void {
    const gid = group ?? this.nextId('grp');
    for (const t of types) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * spread;
      let x = cx + Math.cos(a) * r;
      let z = cz + Math.sin(a) * r;
      // cherche une place libre en élargissant progressivement la zone ; sinon l'ennemi n'est pas placé
      let k = 0;
      for (; k < 24 && this.colliders.blocked(x, z, 0.8); k++) {
        const s = spread + k * 0.6;
        x = cx + this.rng.range(-s, s);
        z = cz + this.rng.range(-s, s);
      }
      if (k >= 24 && this.colliders.blocked(x, z, 0.8)) continue;
      this.enemies.push({ id: this.nextId('en'), type: t, x, z, group: gid });
    }
  }

  hazard(h: Hazard): void {
    this.hazards.push(h);
  }

  // ------------------------------------------------------------------ mobilier intérieur

  private furnish(b: BuildingHandle, kind: InteriorKind, loot: LootProfile, richness: number): void {
    const r = b.inner;
    const g = this.g;
    const rng = this.rng;
    const lock = b.spec.containerLock;
    const doorZones = b.doors.map((d) => ({ x0: d.x - 1.4, z0: d.z - 1.6, x1: d.x + 1.4, z1: d.z + 1.6 }));
    const clear = (x: number, z: number, hw: number, hd: number) => !doorZones.some((dz) => rectsOverlap(dz, { x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd }));
    // emplacements le long des murs nord, est et ouest
    const slots: { x: number; z: number; ry: number }[] = [];
    for (let x = r.x0 + 1.0; x <= r.x1 - 1.0; x += 1.8) slots.push({ x, z: r.z0 + 0.45, ry: 0 });
    for (let z = r.z0 + 1.6; z <= r.z1 - 1.4; z += 1.8) {
      slots.push({ x: r.x0 + 0.45, z, ry: Math.PI / 2 });
      slots.push({ x: r.x1 - 0.45, z, ry: -Math.PI / 2 });
    }
    for (let x = r.x0 + 1.0; x <= r.x1 - 1.0; x += 2.2) slots.push({ x, z: r.z1 - 0.45, ry: Math.PI });
    rng.shuffle(slots);
    const usable = slots.filter((s) => clear(s.x, s.z, 0.6, 0.6));
    const cw = r.x1 - r.x0;
    const cd = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const nCont = Math.max(1, Math.round((cw * cd) / 26 * richness));
    let placed = 0;
    const takeSlot = () => usable.shift();
    const contKinds: Record<InteriorKind, ContainerKind[]> = {
      maison: ['armoire', 'caisse', 'frigo', 'coffre'],
      boutique: ['etagere', 'caisse', 'etagere'],
      bureau: ['bureau', 'armoire', 'casier'],
      entrepot: ['caisse', 'caisse', 'tonneau', 'etagere'],
      caserne: ['casier', 'casier', 'caisse'],
      armurerie: ['casier', 'coffre', 'caisse'],
      infirmerie: ['pharmacie', 'armoire', 'casier'],
      labo: ['armoire', 'casier', 'bureau'],
      atelier: ['caisse', 'etagere', 'tonneau'],
      chapelle: ['coffre', 'armoire'],
      reacteur: ['casier', 'caisse'],
      cantine: ['frigo', 'etagere', 'caisse'],
      serre: ['caisse', 'tonneau'],
      vide: ['caisse', 'cadavre', 'sac'],
      salle_controle: ['bureau', 'casier'],
      radio: ['bureau', 'caisse'],
      garage: ['caisse', 'tonneau', 'etagere'],
      bar: ['frigo', 'etagere', 'caisse'],
      dortoir: ['casier', 'coffre', 'armoire'],
    };
    // meubles décoratifs selon le type
    const deco = (s: { x: number; z: number; ry: number }) => {
      switch (kind) {
        case 'maison':
        case 'dortoir':
          g.box(1.0, 0.45, 2.0, s.x, 0.25, s.z, 0x5a3a28, { ry: s.ry });
          g.box(0.9, 0.12, 1.9, s.x, 0.52, s.z, 0xb0a890, { ry: s.ry });
          this.colliders.addCircle(s.x, s.z, 0.75);
          break;
        case 'atelier':
        case 'garage':
          g.box(1.6, 0.9, 0.8, s.x, 0.45, s.z, 0x5a4a3a, { ry: s.ry });
          g.box(0.4, 0.4, 0.4, s.x, 1.1, s.z, 0x3a4a5a, { ry: s.ry });
          this.colliders.addCircle(s.x, s.z, 0.8);
          break;
        case 'labo':
        case 'salle_controle':
        case 'radio':
          g.box(1.6, 0.9, 0.8, s.x, 0.45, s.z, 0xb0b4b8, { ry: s.ry });
          g.layer('glow').box(0.7, 0.45, 0.06, s.x, 1.35, s.z, kind === 'radio' ? 0x60ff80 : 0x60c0ff, { ry: s.ry });
          g.layer('base');
          this.colliders.addCircle(s.x, s.z, 0.8);
          break;
        case 'chapelle':
          g.box(1.6, 0.5, 0.5, s.x, 0.25, s.z, 0x6b4e35, { ry: s.ry });
          this.colliders.addCircle(s.x, s.z, 0.6);
          break;
        case 'infirmerie':
          g.box(1.0, 0.6, 2.0, s.x, 0.3, s.z, 0xd8d8d0, { ry: s.ry });
          g.box(0.9, 0.12, 1.9, s.x, 0.62, s.z, 0xf0f0f0, { ry: s.ry });
          this.colliders.addCircle(s.x, s.z, 0.75);
          break;
        case 'serre':
          g.box(1.6, 0.6, 0.9, s.x, 0.3, s.z, 0x5a3a22, { ry: s.ry });
          g.dodeca(0.45, s.x, 0.95, s.z, 0x4a9a3a, { vary: 0.2 });
          this.colliders.addCircle(s.x, s.z, 0.8);
          break;
        default:
          P.crate(g, s.x, s.z, 0.9, 0x8a6a42, s.ry);
          this.colliders.addCircle(s.x, s.z, 0.55);
      }
    };
    while (usable.length && placed < nCont) {
      const s = takeSlot()!;
      const ck = rng.pick(contKinds[kind]);
      this.lootContainer(s.x, s.z, ck, loot, 1, { ry: s.ry, lock: lock && rng.chance(0.6) ? lock : undefined });
      placed++;
    }
    const nDeco = Math.min(usable.length, Math.round((cw * cd) / 18));
    for (let i = 0; i < nDeco; i++) deco(takeSlot()!);
    // pièce centrale
    if (cw > 5 && cd > 4 && clear(cx, cz, 1.2, 1.0)) {
      switch (kind) {
        case 'maison':
        case 'cantine':
        case 'bar':
        case 'caserne':
        case 'bureau':
          g.box(1.8, 0.08, 1.1, cx, 0.78, cz, 0x6b4e35);
          g.box(0.12, 0.74, 0.12, cx - 0.8, 0.37, cz - 0.45, 0x4a3524);
          g.box(0.12, 0.74, 0.12, cx + 0.8, 0.37, cz + 0.45, 0x4a3524);
          g.box(0.12, 0.74, 0.12, cx - 0.8, 0.37, cz + 0.45, 0x4a3524);
          g.box(0.12, 0.74, 0.12, cx + 0.8, 0.37, cz - 0.45, 0x4a3524);
          this.colliders.addRect(cx - 0.95, cz - 0.6, cx + 0.95, cz + 0.6, 'prop', false);
          break;
        case 'chapelle':
          g.box(2.2, 1.0, 1.0, cx, 0.5, r.z0 + 1.2, 0xd8d0b8);
          g.layer('glow').box(0.1, 0.3, 0.1, cx - 0.6, 1.15, r.z0 + 1.2, 0xffd070).box(0.1, 0.3, 0.1, cx + 0.6, 1.15, r.z0 + 1.2, 0xffd070);
          g.layer('base');
          break;
        case 'reacteur':
          g.cyl(2.2, 2.6, 3.0, cx, 1.5, cz, 0x5a5e58, { seg: 14 });
          g.layer('glow').cyl(1.6, 1.6, 3.2, cx, 1.6, cz, 0x6aff4a, { seg: 14 });
          g.layer('base');
          this.colliders.addCircle(cx, cz, 2.7);
          this.lights.push({ x: cx, y: 3, z: cz, color: 0x6aff4a, intensity: 4, distance: 16 });
          break;
        case 'entrepot':
          for (let i = 0; i < 3; i++) {
            const px = cx + (i - 1) * 2.4;
            if (clear(px, cz, 0.6, 0.6)) {
              P.crate(g, px, cz, 1.1, 0x8a6a42, rng.next());
              P.crate(g, px, cz + 1.2, 0.9, 0x7a5a38, rng.next());
              this.colliders.addRect(px - 0.7, cz - 0.7, px + 0.7, cz + 1.8, 'prop');
            }
          }
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ décor extérieur

  /** Disperse des accessoires dans une région (arbres, rochers, épaves…). */
  scatter(region: Rect, count: number, fn: (g: GeoBuilder, x: number, z: number) => PropCollider, size = 1.5): void {
    for (let i = 0; i < count; i++) {
      const p = this.findSpot(size, size, region, 12, 0.3);
      if (!p) continue;
      const c = fn(this.g, p.x, p.z);
      this.addCollider(c);
      this.reserve({ x0: p.x - size / 2, z0: p.z - size / 2, x1: p.x + size / 2, z1: p.z + size / 2 });
    }
  }

  /** Clôture du périmètre (obstacles naturels ou palissade). */
  perimeter(kind: 'palissade' | 'rochers' | 'arbres' | 'grillage' | 'ruines'): void {
    const b = this.bounds;
    const rng = this.rng;
    const g = this.g;
    // murs invisibles
    this.colliders.addRect(b.x0 - 2, b.z0 - 2, b.x1 + 2, b.z0, 'wall');
    this.colliders.addRect(b.x0 - 2, b.z1, b.x1 + 2, b.z1 + 2, 'wall');
    this.colliders.addRect(b.x0 - 2, b.z0, b.x0, b.z1, 'wall');
    this.colliders.addRect(b.x1, b.z0, b.x1 + 2, b.z1, 'wall');
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 3);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        if (Math.abs(z) < 5) continue;
        switch (kind) {
          case 'palissade':
            g.box(0.3, 2.6 + rng.next() * 0.6, 3.1, x, 1.4, z, 0x6b4e35, { ry: Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2, vary: 0.1 });
            break;
          case 'grillage':
            g.box(0.08, 2.4, 0.08, x, 1.2, z, 0x6a6a6a);
            if (i < n) g.box(0.03, 2.2, 3, (x + (x0 + (x1 - x0) * ((i + 1) / n))) / 2, 1.2, (z + (z0 + (z1 - z0) * ((i + 1) / n))) / 2, 0x8a8a8a, { ry: Math.atan2(x1 - x0, z1 - z0) });
            break;
          case 'rochers':
            P.rock(g, x + rng.range(-1, 1), z + rng.range(-1, 1), 1.2 + rng.next() * 1.4, 0x6a665e, rng, this.winter);
            break;
          case 'arbres':
            P.pine(g, x + rng.range(-1, 1), z + rng.range(-1, 1), 0.9 + rng.next() * 0.6, this.winter);
            break;
          case 'ruines':
            P.ruinWall(g, x, z, 3.2, 2 + rng.next() * 2, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2, 0x7a746a, rng);
            break;
        }
      }
    };
    edge(b.x0, b.z0, b.x1, b.z0);
    edge(b.x0, b.z1, b.x1, b.z1);
    edge(b.x0, b.z0, b.x0, b.z1);
    edge(b.x1, b.z0, b.x1, b.z1);
  }

  /** Assemble la géométrie statique. */
  finalize(): void {
    if (!this.g.isEmpty) this.root.add(this.g.toGroup());
    this.plantGroundCover();
    // des décors ont pu être posés après les ennemis : on dégage ceux qui se retrouvent emmurés
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!this.colliders.blocked(e.x, e.z, 0.6)) continue;
      let placed = false;
      for (let ring = 1; ring <= 8 && !placed; ring++) {
        for (let k = 0; k < 8 && !placed; k++) {
          const a = (k / 8) * Math.PI * 2 + ring;
          const x = e.x + Math.cos(a) * ring * 1.2;
          const z = e.z + Math.sin(a) * ring * 1.2;
          if (!this.colliders.blocked(x, z, 0.6) && rectContains(this.bounds, x, z)) {
            e.x = x;
            e.z = z;
            placed = true;
          }
        }
      }
      if (!placed) this.enemies.splice(i, 1);
    }
  }
}


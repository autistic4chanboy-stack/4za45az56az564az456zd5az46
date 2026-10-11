import * as THREE from 'three';
import { GeoBuilder } from '../render/geo';
import { CollisionWorld } from './collision';
import { Rng } from '../core/rng';
import { rectContains, rectsOverlap, type Rect } from '../core/math';
import type { LootEntry, LootProfile } from './loot';
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
import { PartSet } from '../render/parts';
import { buildFurniture, Frame, WALL_MOUNTED, type FurnitureKind, type DeviceKind } from './furniture';
import { rollCompartment } from './searchables';
import { furnishBuilding } from './interiors';
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

/** Un document lisible (note posée ou trouvée au fond d'un tiroir). */
export interface NoteData {
  id: string;
  title: string;
  text: string;
  /** Révèle un code de porte. */
  reveals?: { door: string; code: string };
}

/** Un tiroir, une porte de placard, un couvercle… chacun s'ouvre et se fouille séparément. */
export interface Compartment {
  id: string;
  name: string;
  loot: LootEntry[];
  /** Pièces animées (indices du PartSet). */
  parts: number[];
  /** Ce qu'on y voit quand il n'y a rien d'utile. */
  flavor: string;
  note?: NoteData;
}

export interface ContainerSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Point d'interaction (devant la façade du meuble). */
  ix: number;
  iz: number;
  kind: FurnitureKind;
  name: string;
  lock?: LockSpec;
  compartments: Compartment[];
  building: string | null;
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
  /** Pièces animées de la porte (vantail, voyant, planches). */
  parts: number[];
  collider: Rect;
}

export interface NoteSpec extends NoteData {
  x: number;
  y: number;
  z: number;
  mesh: THREE.Object3D;
}

/** Alimentation électrique d'une gare. */
export type PowerMode = 'reseau' | 'groupe' | 'aucun';

export interface DeviceSpec {
  id: string;
  kind: DeviceKind;
  name: string;
  x: number;
  y: number;
  z: number;
  building: string | null;
  screens: number[];
  screenColor: number;
  light?: { x: number; y: number; z: number; color: number; intensity: number; distance: number };
  needsPower: boolean;
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

const LEGACY_KIND: Record<ContainerKind, FurnitureKind> = {
  caisse: 'caisse', armoire: 'armoire', coffre: 'coffre', etagere: 'etagere', frigo: 'frigo', pharmacie: 'pharmacie',
  bureau: 'bureau', cadavre: 'cadavre', sac: 'sac', casier: 'casier', tonneau: 'tonneau',
};

export class StationBuilder {
  readonly rng: Rng;
  readonly root = new THREE.Group();
  readonly colliders = new CollisionWorld();
  /** Géométrie fixe de la gare, découpée en cellules pour le culling ; lampes et vitres fusionnées. */
  readonly g = new GeoBuilder({ mergeLights: true, chunk: 40 });
  /** Pièces mobiles (portes, tiroirs, couvercles, écrans) : un seul InstancedMesh. */
  readonly parts = new PartSet();
  readonly devices: DeviceSpec[] = [];
  /** Courant : réseau en état de marche, groupe électrogène à démarrer, ou rien. */
  power: PowerMode = 'aucun';
  /** Indices de verrous à placer une fois tous les bâtiments posés (notes, tiroirs, cartes). */
  readonly lockHints: { lock: LockSpec; door: string; exclude: BuildingHandle | null; label: string }[] = [];
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

  /** Le point tombe-t-il sur une rue ou une place ? */
  onPaved(x: number, z: number, margin = 0): boolean {
    return this.paved.some((r) => rectContains(r, x, z, margin));
  }

  /** Herbe, roseaux et fleurs semés là où rien n'est construit. */
  private plantGroundCover(): void {
    const cover = groundCoverFor(this.biome, this.winter);
    if (!cover.grass) return;
    const b = this.bounds;
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    const clump = new Noise2D(this.groundSeed + 77);
    // masque des zones bâties, pavées ou réservées (grille de 50 cm) : un test par brin au lieu de centaines
    const C = 0.5;
    const cols = Math.ceil((b.x1 - b.x0) / C);
    const rows = Math.ceil((b.z1 - b.z0) / C);
    const mask = new Uint8Array(cols * rows);
    const mark = (r: Rect, m: number) => {
      const i0 = Math.max(0, Math.floor((r.x0 - m - b.x0) / C));
      const i1 = Math.min(cols - 1, Math.floor((r.x1 + m - b.x0) / C));
      const j0 = Math.max(0, Math.floor((r.z0 - m - b.z0) / C));
      const j1 = Math.min(rows - 1, Math.floor((r.z1 + m - b.z0) / C));
      for (let j = j0; j <= j1; j++) mask.fill(1, j * cols + i0, j * cols + i1 + 1);
    };
    this.occupied.forEach((r, i) => i > 0 && mark(r, 0.2));
    for (const r of this.paved) mark(r, 0.3);
    for (const bd of this.buildings) mark(bd.rect, 0.4);
    mark(this.platform, 0.4);
    const ok = (x: number, z: number): boolean => {
      if (Math.abs(z) < 2.4) return false;
      const i = Math.floor((x - b.x0) / C);
      const j = Math.floor((z - b.z0) / C);
      if (i < 0 || j < 0 || i >= cols || j >= rows || mask[j * cols + i]) return false;
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
    // murs nord, est et ouest, sol : géométrie fixe de la gare (fusionnée par cellules, peu d'appels de rendu) ;
    // seuls la façade sud, le toit et les cloisons est-ouest restent à part pour pouvoir s'estomper
    const base = this.g;
    const front = new GeoBuilder({ mergeLights: true });
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
    // toit
    const roof = new GeoBuilder({ mergeLights: true });
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
    const runtime: BuildingRuntime = { id, name: spec.name, rect, roof: roofGroup, front: [], dark: !!spec.dark, inside: false, fade: 0 };
    this.buildings.push(runtime);
    if (spec.dark) this.darkRects.push(inner);
    if (spec.hazard) this.hazards.push({ kind: spec.hazard.kind, x, z, r: 0, rect: inner, intensity: spec.hazard.intensity, hidden: spec.hazard.hidden });
    // les cloisons est-ouest rejoignent la façade sud : elles s'estompent avec elle quand on est dedans
    if (spec.interior) this.furnish(handle, spec.interior, spec.loot ?? 'general', spec.richness ?? 1, front);
    const frontGroup = front.toGroup();
    group.add(frontGroup);
    runtime.front.push(frontGroup);
    if (!spec.dark && !spec.ruined) this.lights.push({ x, y: h - 0.6, z, color: 0xffd8a0, intensity: 2.2, distance: Math.max(w, d) + 2, night: true });
    return handle;
  }

  door(id: string, x: number, z: number, along: 'x' | 'z', width: number, lock: LockSpec | undefined, building: string, openDir: 1 | -1): DoorSpec {
    const color = lock?.kind === 'barricade' ? 0x6b4e35 : lock?.kind === 'carte' || lock?.kind === 'code' ? 0x5a6066 : 0x6b4a32;
    // la porte pivote sur un bord ; une barricade arrachée disparaît
    const hx = along === 'x' ? x - width / 2 : x;
    const hz = along === 'x' ? z : z - width / 2;
    const angle = (along === 'x' ? -openDir : openDir) * (Math.PI / 2) * 0.95;
    const barricade = lock?.kind === 'barricade';
    const motion = barricade ? { kind: 'efface' as const } : { kind: 'pivot' as const, px: hx, py: 0, pz: hz, ax: 0, ay: 1, az: 0, angle };
    const P = this.parts;
    const parts: number[] = [];
    const metal = lock?.kind === 'carte' || lock?.kind === 'code';
    if (along === 'x') parts.push(P.box(width - 0.05, 2.4, 0.1, x, 1.2, z, color, { motion, pat: metal ? 0 : PAT.lames }));
    else parts.push(P.box(0.1, 2.4, width - 0.05, x, 1.2, z, color, { motion, pat: metal ? 0 : PAT.lames }));
    if (barricade) {
      for (const [y, r] of [[0.8, 0.2], [1.8, -0.25]] as const) {
        if (along === 'x') parts.push(P.box(width + 0.3, 0.25, 0.14, x, y, z + 0.08 * openDir, 0x8a6a42, { rz: r, motion }));
        else parts.push(P.box(0.14, 0.25, width + 0.3, x + 0.08 * openDir, y, z, 0x8a6a42, { rx: r, motion }));
      }
    } else {
      // poignée
      if (along === 'x') parts.push(P.box(0.06, 0.06, 0.2, x + width / 2 - 0.2, 1.05, z, 0x2a2420, { motion }));
      else parts.push(P.box(0.2, 0.06, 0.06, x, 1.05, z + width / 2 - 0.2, 0x2a2420, { motion }));
    }
    if (lock && !barricade) {
      const lc = lock.kind === 'carte' ? (lock.color === 'rouge' ? 0xe74c3c : lock.color === 'bleue' ? 0x3498db : lock.color === 'verte' ? 0x2ecc71 : 0xf1c40f) : lock.kind === 'code' ? 0x40ff80 : 0xd0a040;
      if (along === 'x') parts.push(P.box(0.18, 0.18, 0.16, x + width / 2 - 0.25, 1.3, z + 0.04 * openDir, lc, { motion, pat: PAT.lumiere }));
      else parts.push(P.box(0.16, 0.18, 0.18, x + 0.04 * openDir, 1.3, z + width / 2 - 0.25, lc, { motion, pat: PAT.lumiere }));
    }
    const collider = along === 'x' ? { x0: x - width / 2, z0: z - 0.15, x1: x + width / 2, z1: z + 0.15 } : { x0: x - 0.15, z0: z - width / 2, x1: x + 0.15, z1: z + width / 2 };
    const spec: DoorSpec = { id, x, z, along, width, lock, building, parts, collider };
    this.doors.push(spec);
    return spec;
  }

  // ------------------------------------------------------------------ conteneurs, notes, objets

  /** Bâtiment en cours d'aménagement (rattache meubles et appareils). */
  private currentBuilding: string | null = null;

  /**
   * Pose un meuble : géométrie fixe fusionnée, pièces mobiles, collision, compartiments fouillables
   * (butin tiré par compartiment) et appareil électrique éventuel. Renvoie le conteneur, s'il y en a un.
   */
  furniture(
    kind: FurnitureKind,
    x: number,
    z: number,
    ry: number,
    opts: { y?: number; profile?: LootProfile; richness?: number; lock?: LockSpec; id?: string; name?: string; loot?: LootEntry[]; building?: string | null; collide?: boolean } = {},
  ): ContainerSpec | null {
    const y = opts.y ?? 0;
    const spec = buildFurniture(kind, this.g, this.parts, x, z, ry, this.rng, y);
    const building = opts.building !== undefined ? opts.building : this.currentBuilding;
    if (spec.blocks !== false && !WALL_MOUNTED.has(kind) && opts.collide !== false && y < 0.5) {
      const c = Math.abs(Math.cos(ry));
      const sn = Math.abs(Math.sin(ry));
      const rx = (c * spec.w + sn * spec.d) / 2;
      const rz = (sn * spec.w + c * spec.d) / 2;
      this.colliders.addRect(x - rx, z - rz, x + rx, z + rz, 'prop', spec.cover ?? false);
    }
    if (spec.device) {
      const dv = spec.device;
      const f = new Frame(x, z, ry, y);
      this.devices.push({
        id: this.nextId('app'),
        kind: dv.kind,
        name: spec.name,
        x: f.wx(0, spec.d / 2 + 0.3),
        y,
        z: f.wz(0, spec.d / 2 + 0.3),
        building,
        screens: dv.screens,
        screenColor: dv.screenColor,
        light: dv.light ? { x: f.wx(dv.light.lx, dv.light.lz), y: y + dv.light.ly, z: f.wz(dv.light.lx, dv.light.lz), color: dv.light.color, intensity: dv.light.intensity, distance: dv.light.distance } : undefined,
        needsPower: dv.needsPower,
      });
    }
    if (!spec.comps.length) return null;
    const id = opts.id ?? this.nextId('cont');
    const profile = opts.profile ?? 'general';
    const richness = opts.richness ?? 1;
    const compartments: Compartment[] = spec.comps.map((cd, i) => {
      const cid = `${id}:${i}`;
      if (opts.loot) return { id: cid, name: cd.name, loot: i === 0 ? opts.loot : [], parts: cd.parts, flavor: i === 0 ? '' : 'Rien d\'utile.' };
      const content = rollCompartment(this.rng, cid, cd.theme, cd.size, profile, this.tier, richness, this.lootMult);
      return { id: cid, name: cd.name, loot: content.loot, parts: cd.parts, flavor: content.flavor, note: content.note };
    });
    const fr = new Frame(x, z, ry, y);
    // point d'interaction juste devant la face avant (même pour un conteneur de 6 m)
    const reach = spec.d / 2 + 0.3;
    const c: ContainerSpec = { id, x, y, z, ix: fr.wx(0, reach), iz: fr.wz(0, reach), kind, name: opts.name ?? spec.name, lock: opts.lock, compartments, building };
    this.containers.push(c);
    return c;
  }

  /** Élément de décor qui s'estompe quand le joueur se tient juste derrière (rempart sud, grand mur). */
  cutaway(rect: Rect, group: THREE.Object3D): void {
    this.buildings.push({ id: this.nextId('mur'), name: 'Rempart', rect, roof: new THREE.Group(), front: [group], dark: false, inside: false, fade: 0 });
  }

  /** Point libre le plus proche (pour les ajouts scénarisés posés à des coordonnées fixes). */
  freeSpotNear(x: number, z: number, r = 0.45, maxDist = 8): { x: number; z: number } {
    if (!this.colliders.blocked(x, z, r)) return { x, z };
    for (let ring = 1; ring <= Math.ceil(maxDist / 0.5); ring++) {
      const d = ring * 0.5;
      const n = 8 + ring * 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (!this.colliders.blocked(px, pz, r)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** Conteneur au contenu imposé (scripts d'histoire, quêtes) ; déplacé s'il tombe dans un meuble ou un mur. */
  container(x: number, z: number, kind: ContainerKind, loot: LootEntry[], opts: { lock?: LockSpec; ry?: number; y?: number; id?: string; name?: string } = {}): ContainerSpec {
    const p = this.freeSpotNear(x, z, 0.6);
    return this.furniture(LEGACY_KIND[kind], p.x, p.z, opts.ry ?? 0, { ...opts, loot })!;
  }

  /** Conteneur avec butin tiré selon un profil. */
  lootContainer(x: number, z: number, kind: ContainerKind, profile: LootProfile, richness = 1, opts: { lock?: LockSpec; ry?: number; y?: number; id?: string } = {}): ContainerSpec {
    return this.furniture(LEGACY_KIND[kind], x, z, opts.ry ?? 0, { ...opts, profile, richness })!;
  }

  note(x: number, z: number, title: string, text: string, opts: { y?: number; reveals?: { door: string; code: string }; id?: string } = {}): NoteSpec {
    const id = opts.id ?? this.nextId('note');
    const y = opts.y ?? 0.82;
    // une note posée au sol ne doit pas finir sous un meuble ou dans un mur
    if (y < 0.3) ({ x, z } = this.freeSpotNear(x, z, 0.3));
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

  private furnish(b: BuildingHandle, kind: InteriorKind, loot: LootProfile, richness: number, innerFront: GeoBuilder): void {
    const r = b.inner;
    const g = this.g;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    this.currentBuilding = b.id;
    // éléments centraux propres à certains bâtiments
    if (kind === 'reacteur') {
      g.cyl(2.2, 2.6, 3.0, cx, 1.5, cz, 0x5a5e58, { seg: 14 });
      g.layer('glow').cyl(1.6, 1.6, 3.2, cx, 1.6, cz, 0x6aff4a, { seg: 14 });
      g.layer('base');
      this.colliders.addCircle(cx, cz, 2.7);
      this.lights.push({ x: cx, y: 3, z: cz, color: 0x6aff4a, intensity: 4, distance: 16 });
    }
    if (kind === 'serre') {
      for (let x = r.x0 + 1.6; x < r.x1 - 1.2; x += 2.6) {
        for (const z of [r.z0 + 1.4, cz, r.z1 - 1.4]) {
          if (b.doors.some((d) => Math.hypot(d.x - x, d.z - z) < 2.2)) continue;
          g.box(1.6, 0.6, 0.9, x, 0.3, z, 0x5a3a22);
          g.layer('foliage').dodeca(0.45, x - 0.35, 0.95, z, 0x4a9a3a, { vary: 0.2 }).dodeca(0.4, x + 0.4, 0.9, z, 0x5aa840, { vary: 0.2 });
          g.layer('base');
          this.colliders.addRect(x - 0.8, z - 0.45, x + 0.8, z + 0.45, 'prop', false);
          // caisse dans l'allée, ouverture côté allée
          if (this.rng.chance(0.3)) {
            const south = z < cz + 0.1;
            this.lootContainer(x, z + (south ? 0.9 : -0.9), 'caisse', loot, 0.5, { ry: south ? 0 : Math.PI });
          }
        }
      }
    }
    furnishBuilding(this, b, { kind, loot, richness, innerFront, lockContainers: b.spec.containerLock, homey: ['maison', 'bar', 'dortoir', 'boutique', 'cantine'].includes(kind) });
    this.currentBuilding = null;
  }

  // ------------------------------------------------------------------ décor extérieur

  /** Disperse des accessoires dans une région (arbres, rochers, épaves…). */
  scatter(region: Rect, count: number, fn: (g: GeoBuilder, x: number, z: number) => PropCollider, size = 1.5): void {
    for (let i = 0; i < count; i++) {
      const p = this.findSpot(size, size, region, 12, 0.3);
      // rues et places restent dégagées
      if (!p || this.onPaved(p.x, p.z, size / 2)) continue;
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
    // les PNJ posés à des coordonnées fixes (scénario, archétypes) sont dégagés des murs et des meubles
    for (const n of this.npcs) {
      const p = this.freeSpotNear(n.x, n.z, 0.45, 12);
      n.x = p.x;
      n.z = p.z;
    }
    if (!this.g.isEmpty) this.root.add(this.g.toGroup());
    const parts = this.parts.build();
    if (parts) this.root.add(parts);
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


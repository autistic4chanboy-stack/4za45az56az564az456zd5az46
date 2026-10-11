import * as THREE from 'three';
import { GeoBuilder } from '../render/geo';
import { PAT } from '../render/toon';
import { WAGON_TYPES, DECOR, type WagonTypeDef, type DecorId, type EquipId } from '../data/train';
import type { WagonState } from '../state/types';

/** Constantes géométriques du train (repère local d'un wagon : origine au centre, sol du wagon à FLOOR). */
export const FLOOR = 1.2;
export const WALL_TOP = 3.9;
export const HALF_W = 2;
export const GAP = 1.2;
export const DOOR_HALF = 0.62;

export type SpotPose = 'lie' | 'sit' | 'stand' | 'work';

export interface Spot {
  x: number;
  z: number;
  pose: SpotPose;
  yaw: number;
  kind: 'lit' | 'siege' | 'poste' | 'debout' | 'cuisine' | 'soin' | 'serre' | 'cellule' | 'chauffe' | 'atelier';
  y?: number;
}

export interface LocalRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface LocalPoint {
  x: number;
  z: number;
  y: number;
}

export interface WagonModel {
  shell: THREE.Group;
  front: THREE.Group;
  roof: THREE.Group;
  colliders: LocalRect[];
  spots: Spot[];
  slotAnchors: LocalPoint[];
  decorAnchors: { x: number; z: number; ry: number }[];
  /** Position de la porte latérale (x local) ou null. */
  sideDoor: number | null;
  points: Record<string, LocalPoint>;
  animated: THREE.Object3D[];
  open: boolean;
}

const WOOD = 0x6b4e35;
const WOOD_DARK = 0x4a3524;
const METAL = 0x3a3c40;
const IRON = 0x24262a;
const GLASS = 0x2a3a48;
const LAMP = 0xffd590;
const SHEET = 0xd8d4c8;

function chassis(g: GeoBuilder, L: number, color: number): void {
  g.box(L - 0.2, 0.32, 3.4, 0, FLOOR - 0.32, 0, IRON);
  for (const bx of [-(L / 2 - 2.1), L / 2 - 2.1]) {
    g.box(2.6, 0.35, 2.6, bx, 0.75, 0, METAL);
    for (const ax of [-0.75, 0.75]) {
      for (const z of [-1.05, 1.05]) g.cyl(0.42, 0.42, 0.18, bx + ax, 0.45, z, IRON, { rx: Math.PI / 2, seg: 10 });
      g.box(0.12, 0.12, 2.3, bx + ax, 0.45, 0, METAL);
    }
  }
  for (const s of [-1, 1]) {
    g.box(0.35, 0.3, 0.5, s * (L / 2 + 0.1), FLOOR - 0.35, 0, IRON);
    g.cyl(0.16, 0.16, 0.25, s * (L / 2 + 0.05), FLOOR - 0.3, 1.3, METAL, { rz: Math.PI / 2, seg: 8 });
    g.cyl(0.16, 0.16, 0.25, s * (L / 2 + 0.05), FLOOR - 0.3, -1.3, METAL, { rz: Math.PI / 2, seg: 8 });
  }
  g.box(L - 0.1, 0.14, 3.9, 0, FLOOR - 0.07, 0, color, { vary: 0 });
}

function floorPlanks(g: GeoBuilder, L: number, color = WOOD, metal = false): void {
  g.box(L - 0.4, 0.04, 3.6, 0, FLOOR + 0.02, 0, color, { pat: metal ? PAT.toleToit : PAT.platelage });
}

/** Motif des parois selon le type de wagon : lames de bois ou tôles rivetées. */
function wallPat(type: string): number {
  return type === 'blinde' || type === 'cellule' || type === 'atelier' || type === 'generateur' || type === 'infirmerie' ? PAT.beton : PAT.lames;
}

function windowXs(L: number, door: number | null, spacing = 2.3): number[] {
  const out: number[] = [];
  const n = Math.floor((L - 1.6) / spacing);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.8 + spacing / 2 + i * spacing;
    if (door !== null && Math.abs(x - door) < 1.3) continue;
    out.push(x);
  }
  return out;
}

/** Mur latéral (z = ±HALF_W) avec ouverture de porte et fenêtres. */
function sideWall(g: GeoBuilder, side: -1 | 1, L: number, door: number | null, color: number, trim: number, windows: boolean, slits = false, pat = 0): void {
  const z = side * (HALF_W - 0.075);
  const segs: [number, number][] = door === null ? [[-L / 2, L / 2]] : [[-L / 2, door - DOOR_HALF], [door + DOOR_HALF, L / 2]];
  const h = WALL_TOP - FLOOR;
  for (const [a, b] of segs) {
    const w = b - a;
    if (w <= 0.01) continue;
    g.box(w, h, 0.15, (a + b) / 2, FLOOR + h / 2, z, color, { grad: 0.15, pat });
    g.box(w, 0.12, 0.2, (a + b) / 2, FLOOR + 0.6, z, trim);
    g.box(w, 0.08, 0.2, (a + b) / 2, WALL_TOP - 0.25, z, trim);
  }
  if (door !== null) {
    // linteau au-dessus de la porte
    g.box(DOOR_HALF * 2, 0.5, 0.15, door, WALL_TOP - 0.25, z, color);
    g.box(0.1, h, 0.22, door - DOOR_HALF, FLOOR + h / 2, z, trim);
    g.box(0.1, h, 0.22, door + DOOR_HALF, FLOOR + h / 2, z, trim);
    // marchepied
    g.box(DOOR_HALF * 2, 0.08, 0.5, door, FLOOR - 0.45, side * (HALF_W + 0.25), METAL);
  }
  if (windows) {
    for (const x of windowXs(L, door)) {
      g.box(1.2, 0.85, 0.2, x, FLOOR + 1.55, z, GLASS);
      g.layer('glow').box(1.1, 0.75, 0.22, x, FLOOR + 1.55, z, LAMP);
      g.layer('base');
      g.box(1.3, 0.08, 0.24, x, FLOOR + 1.12, z, trim);
    }
  }
  if (slits) {
    for (const x of windowXs(L, door, 1.6)) {
      g.box(0.9, 0.16, 0.22, x, FLOOR + 1.6, z, 0x111111);
    }
  }
  // rivets
  for (let x = -L / 2 + 0.3; x < L / 2; x += 0.7) {
    if (door !== null && Math.abs(x - door) < DOOR_HALF + 0.1) continue;
    g.box(0.06, 0.06, 0.04, x, FLOOR + 0.2, z + side * 0.09, 0x1a1a1a);
  }
}

function endWalls(g: GeoBuilder, L: number, color: number, trim: number, pat = 0): void {
  const h = WALL_TOP - FLOOR;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - 0.075);
    const segW = HALF_W - DOOR_HALF;
    g.box(0.15, h, segW, x, FLOOR + h / 2, -(DOOR_HALF + segW / 2), color, { pat });
    g.box(0.15, h, segW, x, FLOOR + h / 2, DOOR_HALF + segW / 2, color, { pat });
    g.box(0.15, 0.5, DOOR_HALF * 2, x, WALL_TOP - 0.25, 0, color, { pat });
    g.box(0.2, h, 0.08, x, FLOOR + h / 2, -DOOR_HALF, trim);
    g.box(0.2, h, 0.08, x, FLOOR + h / 2, DOOR_HALF, trim);
  }
}

/** Toit bombé en tôle à couvre-joints, passerelle et aérateurs. */
function roofOf(L: number, color: number, trim: number, glass = false, vents = 0): THREE.Group {
  const g = new GeoBuilder();
  g.box(L + 0.14, 0.08, 4.3, 0, WALL_TOP + 0.04, 0, trim);
  if (glass) g.layer('glass').vault(L, 0.62, 2.16, 0, WALL_TOP + 0.06, 0, color, { seg: 8 }).layer('base');
  else g.vault(L, 0.42, 2.16, 0, WALL_TOP + 0.06, 0, color, { seg: 8, pat: PAT.toleToit });
  if (glass) {
    for (let x = -L / 2; x <= L / 2 + 0.01; x += L / Math.round(L / 1.6)) g.vault(0.08, 0.64, 2.18, x, WALL_TOP + 0.06, 0, 0x4e5e54, { seg: 8 });
  } else {
    // passerelle de toit
    g.box(L - 0.6, 0.06, 0.56, 0, WALL_TOP + 0.5, 0, 0x5a4634, { pat: PAT.platelage });
    for (let i = 0; i < vents; i++) {
      const x = -L / 2 + (L * (i + 0.5)) / vents;
      g.box(0.5, 0.26, 0.42, x, WALL_TOP + 0.5, 0.95, 0x3a3836);
      g.box(0.62, 0.06, 0.54, x, WALL_TOP + 0.66, 0.95, 0x2a2826);
    }
  }
  return g.toGroup();
}

/** Lampe murale (côté nord). */
function sconce(g: GeoBuilder, x: number): void {
  g.box(0.3, 0.3, 0.15, x, WALL_TOP - 0.6, -HALF_W + 0.22, METAL);
  g.layer('glow').box(0.24, 0.22, 0.1, x, WALL_TOP - 0.6, -HALF_W + 0.32, LAMP);
  g.layer('base');
}

function heaterBox(g: GeoBuilder, x: number, z: number): void {
  g.box(0.9, 0.7, 0.35, x, FLOOR + 0.35, z, 0x5a3a2a);
  for (let i = 0; i < 4; i++) g.box(0.06, 0.6, 0.38, x - 0.33 + i * 0.22, FLOOR + 0.35, z, 0x3a2a1e);
  g.layer('glow').box(0.5, 0.12, 0.05, x, FLOOR + 0.55, z + Math.sign(-z) * 0.18, 0xff7a30);
  g.layer('base');
}

function bed(g: GeoBuilder, x: number, z: number, len = 2.0, sheet = SHEET, frame = WOOD_DARK): void {
  g.box(len, 0.45, 0.9, x, FLOOR + 0.225, z, frame);
  g.box(len - 0.1, 0.14, 0.82, x, FLOOR + 0.52, z, sheet, { vary: 0.05 });
  g.box(0.35, 0.12, 0.6, x - len / 2 + 0.3, FLOOR + 0.64, z, 0xf0ece0);
}

function table(g: GeoBuilder, x: number, z: number, w = 1.0, d = 0.8): void {
  g.box(w, 0.08, d, x, FLOOR + 0.78, z, WOOD);
  g.box(0.1, 0.74, 0.1, x, FLOOR + 0.37, z, WOOD_DARK);
}

function bench(g: GeoBuilder, x: number, z: number, len = 1.0): void {
  g.box(len, 0.1, 0.5, x, FLOOR + 0.45, z, 0x7a2a26);
  g.box(len, 0.45, 0.1, x, FLOOR + 0.7, z + Math.sign(z) * 0.22, 0x7a2a26);
  g.box(len, 0.4, 0.4, x, FLOOR + 0.2, z, WOOD_DARK);
}

function crates(g: GeoBuilder, x: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const s = 0.7 + (i % 3) * 0.1;
    g.box(s, s, s, x + (i % 2) * 0.8 - 0.4, FLOOR + s / 2 + Math.floor(i / 2) * 0.75, z, 0x8a6a42, { vary: 0.1, ry: i * 0.2 });
  }
}


/** Modèle 3D d'une décoration (repère local au point d'ancrage, posée sur le plancher). */
export function decorModel(id: DecorId, g: GeoBuilder, x: number, z: number, ry: number): void {
  const y = FLOOR;
  const d = DECOR[id];
  switch (id) {
    case 'plante':
      g.cyl(0.25, 0.2, 0.4, x, y + 0.2, z, 0x8a4a2a, { seg: 8 });
      g.dodeca(0.45, x, y + 0.75, z, d.color, { vary: 0.15 });
      g.dodeca(0.3, x + 0.2, y + 1.05, z - 0.1, 0x4a9a4a);
      break;
    case 'tapis':
      g.box(2.2, 0.03, 1.2, x, y + 0.05, z, d.color, { ry });
      g.box(1.8, 0.035, 0.8, x, y + 0.055, z, 0xc9a050, { ry });
      break;
    case 'affiches':
      g.box(0.9, 1.1, 0.04, x - 0.6, y + 1.7, -HALF_W + 0.17, 0xd9a441);
      g.box(0.8, 1.0, 0.04, x + 0.6, y + 1.65, -HALF_W + 0.17, 0x4a7ab0);
      g.box(0.5, 0.3, 0.045, x - 0.6, y + 1.95, -HALF_W + 0.18, 0xb03a2e);
      break;
    case 'lampe':
      g.cyl(0.05, 0.12, 1.5, x, y + 0.75, z, 0x3a3a3a, { seg: 6 });
      g.layer('glow').cyl(0.2, 0.32, 0.4, x, y + 1.6, z, 0xffd58a, { seg: 8 });
      g.layer('base');
      break;
    case 'bibliotheque':
      g.box(1.6, 2.0, 0.45, x, y + 1.0, z, d.color, { ry });
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 6; j++) g.box(0.2, 0.36, 0.3, x - 0.6 + j * 0.24, y + 0.3 + i * 0.48, z + 0.06, [0x8a2a2a, 0x2a4a8a, 0x3a6a3a, 0xc9a050, 0x6a4a8a][(i + j) % 5], { ry });
      }
      break;
    case 'arcade':
      g.box(0.85, 1.75, 0.8, x, y + 0.88, z, d.color, { ry });
      g.box(0.8, 0.2, 0.5, x, y + 1.0, z + 0.35, 0x2a2a2a, { ry });
      g.layer('glow').box(0.62, 0.5, 0.05, x, y + 1.45, z + 0.41, 0x4af0ff, { ry }).box(0.7, 0.14, 0.05, x, y + 1.82, z + 0.41, 0xff4ad0, { ry });
      g.layer('base');
      g.box(0.05, 0.12, 0.05, x - 0.15, y + 1.15, z + 0.5, 0xd03030, { ry });
      break;
    case 'jukebox':
      g.box(0.9, 1.5, 0.6, x, y + 0.75, z, d.color, { ry });
      g.cyl(0.45, 0.45, 0.6, x, y + 1.5, z, d.color, { rx: Math.PI / 2, seg: 10, ry });
      g.layer('glow').box(0.7, 0.6, 0.05, x, y + 0.95, z + 0.31, 0xffc040, { ry });
      g.layer('base');
      break;
    case 'poele':
      g.cyl(0.35, 0.4, 0.9, x, y + 0.45, z, d.color, { seg: 8 });
      g.cyl(0.08, 0.08, 1.8, x, y + 1.8, z, 0x2a2a2a, { seg: 6 });
      g.layer('glow').box(0.3, 0.2, 0.05, x, y + 0.45, z + 0.38, 0xff6a20);
      g.layer('base');
      break;
    case 'piano':
      g.box(1.5, 1.3, 0.6, x, y + 0.65, z, d.color, { ry });
      g.box(1.4, 0.06, 0.3, x, y + 0.75, z + 0.4, 0xf0f0e8, { ry });
      g.box(0.8, 0.45, 0.35, x, y + 0.22, z + 0.85, WOOD_DARK, { ry });
      break;
    case 'canape':
      g.box(1.9, 0.45, 0.8, x, y + 0.25, z, d.color, { ry });
      g.box(1.9, 0.6, 0.2, x, y + 0.6, z - 0.3 * Math.sign(z || 1), d.color, { ry });
      g.box(0.2, 0.55, 0.8, x - 0.95, y + 0.4, z, d.color, { ry });
      g.box(0.2, 0.55, 0.8, x + 0.95, y + 0.4, z, d.color, { ry });
      break;
    case 'billard':
      g.box(2.2, 0.2, 1.2, x, y + 0.8, z, d.color, { ry });
      g.box(2.3, 0.1, 1.3, x, y + 0.92, z, WOOD_DARK, { ry });
      g.box(1.8, 0.7, 0.8, x, y + 0.35, z, WOOD_DARK, { ry });
      g.sphere(0.06, x + 0.3, y + 0.98, z, 0xffffff);
      g.sphere(0.06, x - 0.4, y + 0.98, z + 0.2, 0xd03030);
      break;
    case 'aquarium':
      g.box(1.3, 0.8, 0.5, x, y + 0.4, z, WOOD_DARK, { ry });
      g.layer('glow').box(1.2, 0.7, 0.45, x, y + 1.15, z, 0x3aa0c8, { ry });
      g.layer('base');
      break;
    case 'fanion':
      g.cyl(0.03, 0.03, 1.4, x, y + 1.5, -HALF_W + 0.25, 0x8a8a8a, { rz: 0.8 });
      g.box(0.7, 0.45, 0.03, x + 0.55, y + 2.0, -HALF_W + 0.25, d.color);
      break;
    case 'purificateur':
      g.box(0.6, 1.2, 0.6, x, y + 0.6, z, d.color);
      g.layer('glow').box(0.4, 0.08, 0.62, x, y + 1.0, z, 0x60e0ff);
      g.layer('base');
      break;
  }
}

/** Points d'ancrage des décorations selon le type de wagon. */
function decorAnchorsFor(def: WagonTypeDef): { x: number; z: number; ry: number }[] {
  const L = def.length;
  const n = def.decorSlots;
  const out: { x: number; z: number; ry: number }[] = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const span = L - 3.4;
    const k = Math.floor(i / 2);
    const cols = Math.ceil(n / 2);
    const x = -L / 2 + 2.6 + (span * (k + 0.5)) / cols;
    out.push({ x, z: side * 1.35, ry: side < 0 ? 0 : Math.PI });
  }
  return out;
}

export function buildWagonModel(w: WagonState, _frontX: number): WagonModel {
  const def = WAGON_TYPES[w.type];
  const L = def.length;
  const g = new GeoBuilder();
  const fg = new GeoBuilder();
  const colliders: LocalRect[] = [];
  const spots: Spot[] = [];
  const points: Record<string, LocalPoint> = {};
  const animated: THREE.Object3D[] = [];
  let sideDoor: number | null = -L / 2 + 1.7;
  let slotAnchors: LocalPoint[] = [];
  const color = def.color;
  const trim = def.trim;
  let roof: THREE.Group | null = null;

  const wallColliders = (door: number | null) => {
    const segs: [number, number][] = door === null ? [[-L / 2, L / 2]] : [[-L / 2, door - DOOR_HALF], [door + DOOR_HALF, L / 2]];
    for (const [a, b] of segs) {
      colliders.push({ x0: a, z0: -HALF_W - 0.05, x1: b, z1: -HALF_W + 0.15 });
      colliders.push({ x0: a, z0: HALF_W - 0.15, x1: b, z1: HALF_W + 0.05 });
    }
    for (const s of [-1, 1]) {
      const x = s * (L / 2 - 0.08);
      colliders.push({ x0: x - 0.1, z0: -HALF_W, x1: x + 0.1, z1: -DOOR_HALF });
      colliders.push({ x0: x - 0.1, z0: DOOR_HALF, x1: x + 0.1, z1: HALF_W });
    }
  };

  const roofSlots = (n: number) => {
    const out: LocalPoint[] = [];
    for (let i = 0; i < n; i++) out.push({ x: -L / 2 + (L * (i + 0.5)) / n, z: 0, y: WALL_TOP + 0.35 });
    return out;
  };

  chassis(g, L, IRON);

  switch (w.type) {
    case 'locomotive': {
      const cabLen = 4.6;
      const cabX0 = -L / 2;
      const cabX1 = -L / 2 + cabLen;
      sideDoor = cabX0 + 2.3;
      floorPlanks(g, L, 0x4a4540, true);
      // chaudière
      const bx = (cabX1 + L / 2) / 2;
      const bl = L / 2 - cabX1;
      g.cyl(1.35, 1.35, bl, bx + 0.2, FLOOR + 1.45, 0, color, { rz: Math.PI / 2, seg: 14, grad: 0.1 });
      for (let i = 0; i < 4; i++) g.cyl(1.4, 1.4, 0.12, cabX1 + 0.8 + i * (bl / 4), FLOOR + 1.45, 0, trim, { rz: Math.PI / 2, seg: 14 });
      g.cyl(1.25, 1.25, 0.3, L / 2 + 0.1, FLOOR + 1.45, 0, 0x2a2c30, { rz: Math.PI / 2, seg: 14 });
      g.cyl(0.42, 0.55, 1.6, L / 2 - 1.5, FLOOR + 3.3, 0, 0x1e1f22, { seg: 10 });
      g.cyl(0.62, 0.45, 0.3, L / 2 - 1.5, FLOOR + 4.2, 0, 0x1e1f22, { seg: 10 });
      g.sphere(0.6, bx, FLOOR + 2.85, 0, trim, { detail: 1, sy: 0.7 });
      g.cyl(0.25, 0.3, 0.5, bx - 2, FLOOR + 3.0, 0, trim, { seg: 8 });
      // phare et chasse-pierres
      g.layer('glow').cyl(0.35, 0.35, 0.15, L / 2 + 0.3, FLOOR + 2.55, 0, 0xfff2c0, { rz: Math.PI / 2, seg: 10 });
      g.layer('base');
      g.box(0.4, 0.6, 0.6, L / 2 + 0.15, FLOOR + 2.55, 0, 0x2a2c30);
      for (let i = 0; i < 5; i++) g.box(0.12, 0.9, 3.4 - i * 0.55, L / 2 + 0.5 + i * 0.18, 0.5, 0, 0x8a2a1e, { rz: 0.5 });
      // grandes roues motrices
      const wheels = new GeoBuilder();
      for (const wx of [L / 2 - 6.5, L / 2 - 4.4, L / 2 - 2.4]) {
        for (const z of [-1.55, 1.55]) {
          wheels.cyl(0.85, 0.85, 0.18, wx, 0.85, z, 0x8a2a1e, { rx: Math.PI / 2, seg: 14 });
          wheels.cyl(0.25, 0.25, 0.22, wx, 0.85, z, 0x1a1a1a, { rx: Math.PI / 2, seg: 8 });
        }
      }
      const wheelGroup = wheels.toGroup();
      g.box(L - cabLen - 1, 0.4, 3.2, bx, FLOOR - 0.1, 0, 0x2a2c30);
      // bielles (animées)
      const rods = new GeoBuilder();
      for (const z of [-1.7, 1.7]) rods.box(4.4, 0.14, 0.08, L / 2 - 4.4, 0.85, z, 0xb0b0b0);
      const rodGroup = rods.toGroup();
      rodGroup.userData.rod = true;
      animated.push(rodGroup);
      // cabine : cloison avant
      g.box(0.15, WALL_TOP - FLOOR, 4, cabX1, FLOOR + (WALL_TOP - FLOOR) / 2, 0, color);
      // foyer (porte rougeoyante)
      g.box(1.4, 1.6, 0.6, cabX1 - 0.35, FLOOR + 0.8, 0, 0x2a2420);
      g.layer('glow').box(0.8, 0.5, 0.08, cabX1 - 0.68, FLOOR + 0.75, 0, 0xff6a1a);
      g.layer('base');
      // pupitre de conduite
      g.box(0.8, 1.1, 0.9, cabX1 - 0.6, FLOOR + 0.55, -1.35, 0x3a3020);
      g.box(0.6, 0.5, 0.1, cabX1 - 0.6, FLOOR + 1.35, -1.5, 0x1a1a1a);
      g.layer('glow').box(0.15, 0.15, 0.05, cabX1 - 0.75, FLOOR + 1.4, -1.43, 0x60ff60).box(0.15, 0.15, 0.05, cabX1 - 0.45, FLOOR + 1.4, -1.43, 0xffc030);
      g.layer('base');
      g.cyl(0.25, 0.25, 0.08, cabX1 - 0.6, FLOOR + 1.0, -0.85, 0x8a6a2a, { rx: Math.PI / 2, seg: 10 });
      sconce(g, cabX0 + 1.5);
      points.controls = { x: cabX1 - 0.6, z: -0.9, y: FLOOR };
      points.firebox = { x: cabX1 - 0.9, z: 0, y: FLOOR };
      points.maintenance = { x: cabX0 + 0.8, z: 1.4, y: FLOOR };
      points.heater = { x: cabX1 - 0.9, z: 0.6, y: FLOOR };
      points.lights = { x: cabX0 + 1.5, z: -1.6, y: FLOOR };
      spots.push({ x: cabX1 - 1.0, z: 0.9, pose: 'work', yaw: Math.PI / 2, kind: 'chauffe' });
      spots.push({ x: cabX0 + 1.2, z: -1.2, pose: 'stand', yaw: 0, kind: 'debout' });
      // murs de la cabine
      const h = WALL_TOP - FLOOR;
      for (const s of [-1, 1] as const) {
        const z = s * (HALF_W - 0.075);
        const a0 = cabX0;
        const a1 = sideDoor - DOOR_HALF;
        const b0 = sideDoor + DOOR_HALF;
        const b1 = cabX1;
        const target = s < 0 ? g : fg;
        target.box(a1 - a0, h, 0.15, (a0 + a1) / 2, FLOOR + h / 2, z, color, { pat: PAT.beton });
        target.box(b1 - b0, h, 0.15, (b0 + b1) / 2, FLOOR + h / 2, z, color, { pat: PAT.beton });
        target.box(DOOR_HALF * 2, 0.5, 0.15, sideDoor, WALL_TOP - 0.25, z, color, { pat: PAT.beton });
        target.box(cabLen, 0.12, 0.2, (cabX0 + cabX1) / 2, FLOOR + 0.6, z, trim);
        target.box(0.9, 0.7, 0.2, (b0 + b1) / 2, FLOOR + 1.7, z, GLASS);
        target.layer('glow').box(0.8, 0.6, 0.22, (b0 + b1) / 2, FLOOR + 1.7, z, LAMP);
        target.layer('base');
      }
      // mur arrière de la cabine (vers le tender) avec ouverture
      const segW = HALF_W - DOOR_HALF;
      g.box(0.15, h, segW, cabX0 + 0.075, FLOOR + h / 2, -(DOOR_HALF + segW / 2), color);
      g.box(0.15, h, segW, cabX0 + 0.075, FLOOR + h / 2, DOOR_HALF + segW / 2, color);
      // collisions : chaudière pleine + murs de cabine
      colliders.push({ x0: cabX1 - 0.1, z0: -HALF_W, x1: L / 2 + 1.2, z1: HALF_W });
      colliders.push({ x0: cabX1 - 1.1, z0: -0.45, x1: cabX1, z1: 0.45 });
      colliders.push({ x0: cabX1 - 1.05, z0: -1.85, x1: cabX1 - 0.15, z1: -0.85 });
      for (const [a, b] of [[cabX0, sideDoor - DOOR_HALF], [sideDoor + DOOR_HALF, cabX1]]) {
        colliders.push({ x0: a, z0: -HALF_W - 0.05, x1: b, z1: -HALF_W + 0.15 });
        colliders.push({ x0: a, z0: HALF_W - 0.15, x1: b, z1: HALF_W + 0.05 });
      }
      colliders.push({ x0: cabX0 - 0.02, z0: -HALF_W, x1: cabX0 + 0.16, z1: -DOOR_HALF });
      colliders.push({ x0: cabX0 - 0.02, z0: DOOR_HALF, x1: cabX0 + 0.16, z1: HALF_W });
      // toit de cabine
      const rg = new GeoBuilder();
      rg.box(cabLen + 0.34, 0.08, 4.36, (cabX0 + cabX1) / 2, WALL_TOP + 0.04, 0, trim);
      rg.vault(cabLen + 0.3, 0.45, 2.2, (cabX0 + cabX1) / 2, WALL_TOP + 0.06, 0, 0x34363a, { seg: 8, pat: PAT.toleToit });
      roof = rg.toGroup();
      slotAnchors = [{ x: L / 2 - 3.2, z: 0, y: FLOOR + 3.0 }];
      const shell = g.toGroup();
      shell.add(wheelGroup, rodGroup);
      return { shell, front: fg.toGroup(), roof, colliders, spots, slotAnchors, decorAnchors: [], sideDoor, points, animated, open: false };
    }
    case 'tender': {
      sideDoor = null;
      floorPlanks(g, L, 0x4a4540, true);
      for (const s of [-1, 1]) {
        g.box(L - 0.2, 2.0, 1.3, 0, FLOOR + 1.0, s * 1.35, color, { grad: 0.2, pat: PAT.beton });
        g.box(L - 0.4, 0.5, 1.1, 0, FLOOR + 2.1, s * 1.3, 0x1a1a1a, { vary: 0.1 });
        for (let i = 0; i < 6; i++) g.dodeca(0.35, -L / 2 + 0.8 + i * 1.2, FLOOR + 2.35, s * 1.3, 0x151515, { sy: 0.6 });
        colliders.push({ x0: -L / 2, z0: s < 0 ? -HALF_W : 0.68, x1: L / 2, z1: s < 0 ? -0.68 : HALF_W });
      }
      g.box(L, 0.6, 0.1, 0, FLOOR + 2.0, -0.7, trim);
      fg.box(L, 0.6, 0.1, 0, FLOOR + 2.0, 0.7, trim);
      points.maintenance = { x: 0, z: 0, y: FLOOR };
      points.coal = { x: -1.5, z: 0.4, y: FLOOR };
      slotAnchors = [{ x: 0, z: 0, y: FLOOR + 2.6 }];
      return { shell: g.toGroup(), front: fg.toGroup(), roof: new THREE.Group(), colliders, spots, slotAnchors, decorAnchors: [], sideDoor, points, animated, open: true };
    }
    case 'plateforme': {
      sideDoor = 0;
      floorPlanks(g, L, 0x6a5440);
      for (const s of [-1, 1] as const) {
        const target = s < 0 ? g : fg;
        for (const [a, b] of [[-L / 2, -DOOR_HALF], [DOOR_HALF, L / 2]]) {
          target.box(b - a, 0.08, 0.08, (a + b) / 2, FLOOR + 0.9, s * (HALF_W - 0.1), 0x8a8a8a);
          for (let x = a; x <= b; x += 1.2) target.box(0.08, 0.9, 0.08, x, FLOOR + 0.45, s * (HALF_W - 0.1), 0x8a8a8a);
          colliders.push({ x0: a, z0: s < 0 ? -HALF_W - 0.05 : HALF_W - 0.2, x1: b, z1: s < 0 ? -HALF_W + 0.2 : HALF_W + 0.05 });
        }
      }
      for (const s of [-1, 1]) {
        g.box(0.2, 0.9, 1.4, s * (L / 2 - 0.1), FLOOR + 0.45, -1.3, color);
        g.box(0.2, 0.9, 1.4, s * (L / 2 - 0.1), FLOOR + 0.45, 1.3, color);
      }
      const n = def.roofSlots;
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (L * (i + 0.5)) / n;
        const z = i % 2 === 0 ? -1.05 : 1.05;
        slotAnchors.push({ x, z, y: FLOOR + 0.1 });
        g.cyl(0.75, 0.85, 0.25, x, FLOOR + 0.12, z, METAL, { seg: 10 });
        colliders.push({ x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6 });
      }
      points.maintenance = { x: L / 2 - 1.2, z: 0, y: FLOOR };
      spots.push({ x: -L / 2 + 1.2, z: 0, pose: 'stand', yaw: 0, kind: 'debout' });
      return { shell: g.toGroup(), front: fg.toGroup(), roof: new THREE.Group(), colliders, spots, slotAnchors, decorAnchors: [], sideDoor, points, animated, open: true };
    }
  }

  // ---------------------------------------------------- wagons fermés génériques
  const metalFloor = w.type === 'atelier' || w.type === 'generateur' || w.type === 'blinde' || w.type === 'cellule';
  floorPlanks(g, L, w.type === 'infirmerie' ? 0x9a9a92 : metalFloor ? 0x5a5a56 : WOOD, metalFloor);
  const slits = w.type === 'blinde' || w.type === 'cellule';
  const windows = !slits && w.type !== 'fourgon' && w.type !== 'generateur';
  const pat = wallPat(w.type);
  sideWall(g, -1, L, sideDoor, color, trim, windows, slits, pat);
  sideWall(fg, 1, L, sideDoor, color, trim, windows, slits, pat);
  endWalls(g, L, color, trim, pat);
  wallColliders(sideDoor);
  const passengerLike = w.type === 'passagers' || w.type === 'restaurant' || w.type === 'salon' || w.type === 'infirmerie';
  roof = roofOf(L, w.type === 'serre' ? 0x9ac8b0 : 0x55504a, trim, w.type === 'serre', passengerLike ? Math.max(1, Math.round(L / 4)) : 0);
  slotAnchors = roofSlots(def.roofSlots);
  sconce(g, -L / 4);
  sconce(g, L / 4);
  points.lights = { x: -L / 4, z: -1.5, y: FLOOR };
  points.maintenance = { x: L / 2 - 0.8, z: 1.3, y: FLOOR };
  const heaterX = L / 2 - 1.3;
  if (def.insulation > 0) {
    heaterBox(g, heaterX, -1.6);
    colliders.push({ x0: heaterX - 0.5, z0: -1.9, x1: heaterX + 0.5, z1: -1.35 });
    points.heater = { x: heaterX, z: -1.1, y: FLOOR };
  }
  if (slits) {
    for (const p of slotAnchors) points[`gun${slotAnchors.indexOf(p)}`] = { x: p.x, z: -1.2, y: FLOOR };
  }
  const usable = { a: sideDoor + DOOR_HALF + 0.3, b: heaterX - 0.8 };

  const addBedsRow = (side: -1 | 1, count: number, len = 2.0, sheet = SHEET, kind: Spot['kind'] = 'lit') => {
    const span = usable.b - usable.a;
    const step = span / count;
    for (let i = 0; i < count; i++) {
      const x = usable.a + step * (i + 0.5);
      const z = side * 1.35;
      bed(g, x, z, Math.min(len, step - 0.15), sheet);
      colliders.push({ x0: x - len / 2, z0: side < 0 ? -HALF_W : 0.88, x1: x + len / 2, z1: side < 0 ? -0.88 : HALF_W });
      spots.push({ x, z, pose: 'lie', yaw: Math.PI / 2, kind, y: FLOOR + 0.55 });
    }
  };

  switch (w.type) {
    case 'passagers':
      addBedsRow(-1, 3);
      addBedsRow(1, 3);
      for (const x of [usable.a + 0.6, usable.b - 0.5]) spots.push({ x, z: 0.05, pose: 'stand', yaw: Math.PI, kind: 'debout' });
      break;
    case 'fourgon':
      crates(g, -L / 2 + 2.5, -1.4, 5);
      crates(g, -L / 2 + 5.5, -1.4, 4);
      crates(g, L / 2 - 4.5, 1.4, 5);
      for (let i = 0; i < 3; i++) g.cyl(0.38, 0.38, 1.1, 1.2 + i * 0.85, FLOOR + 0.55, 1.4, 0x5a6a5a, { seg: 9 });
      colliders.push({ x0: -L / 2 + 1.8, z0: -HALF_W, x1: -L / 2 + 6.5, z1: -0.9 });
      colliders.push({ x0: L / 2 - 5.4, z0: 0.9, x1: L / 2 - 3.6, z1: HALF_W });
      colliders.push({ x0: 0.7, z0: 0.95, x1: 3.3, z1: HALF_W });
      spots.push({ x: -1, z: 0.3, pose: 'stand', yaw: 0, kind: 'debout' });
      points.storage = { x: -L / 2 + 4, z: -0.6, y: FLOOR };
      break;
    case 'blinde':
      addBedsRow(1, 2, 1.9);
      crates(g, -L / 2 + 3.2, -1.45, 3);
      colliders.push({ x0: -L / 2 + 2.4, z0: -HALF_W, x1: -L / 2 + 4.2, z1: -0.95 });
      for (let i = 0; i < def.roofSlots; i++) spots.push({ x: slotAnchors[i].x, z: -1.0, pose: 'stand', yaw: Math.PI, kind: 'poste' });
      break;
    case 'atelier':
      g.box(3.2, 0.9, 0.9, -0.5, FLOOR + 0.45, -1.45, 0x5a4a3a);
      g.box(3.3, 0.1, 1.0, -0.5, FLOOR + 0.92, -1.45, 0x8a6a42);
      for (let i = 0; i < 6; i++) g.box(0.08, 0.5, 0.05, -1.8 + i * 0.5, FLOOR + 1.8, -1.9, 0x8a8f96, { rz: (i % 3) * 0.3 });
      g.box(1.2, 1.1, 0.8, 2.6, FLOOR + 0.55, -1.45, 0x3a4a5a);
      g.cyl(0.25, 0.25, 0.6, 2.6, FLOOR + 1.3, -1.45, 0x8a8f96, { rz: Math.PI / 2, seg: 8 });
      colliders.push({ x0: -2.1, z0: -HALF_W, x1: 3.3, z1: -0.95 });
      addBedsRow(1, 1, 2.0);
      points.workbench = { x: -0.5, z: -0.6, y: FLOOR };
      spots.push({ x: -0.5, z: -0.65, pose: 'work', yaw: Math.PI, kind: 'atelier' });
      break;
    case 'infirmerie':
      addBedsRow(1, 3, 2.0, 0xf2f2ee, 'soin');
      g.box(1.4, 1.9, 0.5, -0.5, FLOOR + 0.95, -1.65, 0xe8e8e0);
      g.box(0.5, 0.5, 0.06, -0.5, FLOOR + 1.6, -1.38, 0xc0302a);
      g.box(0.15, 0.5, 0.07, -0.5, FLOOR + 1.6, -1.37, 0xffffff);
      g.box(0.5, 0.15, 0.07, -0.5, FLOOR + 1.6, -1.37, 0xffffff);
      g.box(1.2, 0.9, 0.6, 1.6, FLOOR + 0.45, -1.55, 0xd0d0c8);
      colliders.push({ x0: -1.3, z0: -HALF_W, x1: 2.3, z1: -1.2 });
      points.medcab = { x: -0.5, z: -0.9, y: FLOOR };
      spots.push({ x: 0.5, z: -0.7, pose: 'stand', yaw: Math.PI, kind: 'soin' });
      break;
    case 'generateur': {
      g.box(L - 4, 0.35, 1.3, -0.4, FLOOR + 0.17, -1.3, METAL);
      const turb = new GeoBuilder();
      turb.cyl(0.55, 0.55, 3.2, 0, 0, 0, 0x6a5a2a, { rz: Math.PI / 2, seg: 12 });
      for (let i = 0; i < 6; i++) turb.box(3.3, 0.12, 0.12, 0, Math.cos(i) * 0.55, Math.sin(i) * 0.55, 0xe0b33a);
      const tg = turb.toGroup();
      tg.position.set(-0.8, FLOOR + 1.0, -1.3);
      tg.userData.spin = true;
      animated.push(tg);
      g.cyl(0.15, 0.15, 2.4, 1.2, FLOOR + 2.4, -1.3, 0x8a8a8a, { seg: 6 });
      for (let i = 0; i < 3; i++) {
        g.box(0.9, 1.4, 0.7, 2.2 + i * 1.0 - 1, FLOOR + 0.7, 1.45, 0x2a3a2a);
        g.layer('glow').box(0.2, 0.2, 0.05, 2.2 + i * 1.0 - 1, FLOOR + 1.2, 1.08, 0x60ff80);
        g.layer('base');
      }
      colliders.push({ x0: -3, z0: -HALF_W, x1: 1.4, z1: -0.68 });
      colliders.push({ x0: 0.6, z0: 1.05, x1: 3.6, z1: HALF_W });
      points.generator = { x: 2.2, z: 0.5, y: FLOOR };
      const shellG = g.toGroup();
      shellG.add(tg);
      return { shell: shellG, front: fg.toGroup(), roof, colliders, spots, slotAnchors, decorAnchors: decorAnchorsFor(def), sideDoor, points, animated, open: false };
    }
    case 'restaurant': {
      const span = usable.b - usable.a;
      for (let i = 0; i < 3; i++) {
        const x = usable.a + (span * (i + 0.5)) / 3;
        for (const s of [-1, 1] as const) {
          table(g, x, s * 1.45, 0.9, 0.8);
          bench(g, x - 0.75, s * 1.45, 0.55);
          bench(g, x + 0.75, s * 1.45, 0.55);
          colliders.push({ x0: x - 1.05, z0: s < 0 ? -HALF_W : 1.0, x1: x + 1.05, z1: s < 0 ? -1.0 : HALF_W });
          spots.push({ x: x - 0.75, z: s * 1.4, pose: 'sit', yaw: Math.PI / 2, kind: 'siege', y: FLOOR + 0.1 });
          spots.push({ x: x + 0.75, z: s * 1.4, pose: 'sit', yaw: -Math.PI / 2, kind: 'siege', y: FLOOR + 0.1 });
        }
      }
      g.box(1.0, 1.0, 1.4, -L / 2 + 0.9 + 0.2, FLOOR + 0.5, 1.2, 0xb0b0a8);
      points.kitchen = { x: -L / 2 + 2.2, z: 0.9, y: FLOOR };
      spots.push({ x: -L / 2 + 2.2, z: 1.0, pose: 'work', yaw: -Math.PI / 2, kind: 'cuisine' });
      break;
    }
    case 'salon':
      addBedsRow(1, 1, 2.0, 0x8a5a7a);
      spots.push({ x: 0, z: 0.2, pose: 'stand', yaw: 0, kind: 'debout' });
      spots.push({ x: 2, z: -0.3, pose: 'stand', yaw: Math.PI, kind: 'debout' });
      break;
    case 'serre': {
      const span = usable.b - usable.a + 1.5;
      for (const s of [-1, 1]) {
        g.box(span, 0.6, 1.0, usable.a + span / 2 - 0.5, FLOOR + 0.3, s * 1.35, 0x5a3a22);
        g.box(span - 0.1, 0.1, 0.9, usable.a + span / 2 - 0.5, FLOOR + 0.62, s * 1.35, 0x3a2a1a);
        for (let i = 0; i < Math.floor(span / 0.7); i++) {
          g.dodeca(0.28, usable.a + i * 0.7, FLOOR + 0.9, s * 1.35, i % 3 === 0 ? 0xc0402a : 0x4a9a3a, { vary: 0.15 });
        }
        colliders.push({ x0: usable.a - 0.5, z0: s < 0 ? -HALF_W : 0.85, x1: usable.a + span - 0.5, z1: s < 0 ? -0.85 : HALF_W });
      }
      g.layer('glow');
      for (let i = 0; i < 3; i++) g.box(1.6, 0.06, 0.2, usable.a + i * 2.6 + 0.8, WALL_TOP - 0.3, 0, 0xd0a0ff);
      g.layer('base');
      spots.push({ x: 0, z: 0, pose: 'work', yaw: 0, kind: 'serre' });
      break;
    }
    case 'cellule':
      for (const s of [-1, 1] as const) {
        for (let i = 0; i < 6; i++) g.box(0.06, WALL_TOP - FLOOR, 0.06, -1.5 + i * 0.6, FLOOR + (WALL_TOP - FLOOR) / 2, s * 0.85, 0x6a6a6a);
        g.box(3.3, 0.08, 0.08, 0, FLOOR + 2.2, s * 0.85, 0x6a6a6a);
        colliders.push({ x0: -1.6, z0: s * 0.85 - 0.05, x1: 1.6, z1: s * 0.85 + 0.05 });
        colliders.push({ x0: -1.65, z0: s < 0 ? -HALF_W : 0.85, x1: -1.55, z1: s < 0 ? -0.85 : HALF_W });
        colliders.push({ x0: 1.55, z0: s < 0 ? -HALF_W : 0.85, x1: 1.65, z1: s < 0 ? -0.85 : HALF_W });
        g.box(1.8, 0.4, 0.7, 0, FLOOR + 0.2, s * 1.5, WOOD_DARK);
        spots.push({ x: 0, z: s * 1.45, pose: 'sit', yaw: s < 0 ? 0 : Math.PI, kind: 'cellule', y: FLOOR + 0.05 });
      }
      spots.push({ x: 2.6, z: 0, pose: 'stand', yaw: -Math.PI / 2, kind: 'debout' });
      break;
  }
  // postes de tir pour les tourelles de toit (échelle contre le mur nord)
  for (let i = 0; i < slotAnchors.length; i++) {
    const p = slotAnchors[i];
    points[`gun${i}`] ??= { x: p.x, z: -1.2, y: FLOOR };
    g.box(0.5, 0.06, 0.08, p.x, FLOOR + 1.2, -HALF_W + 0.2, METAL);
    g.box(0.5, 0.06, 0.08, p.x, FLOOR + 1.8, -HALF_W + 0.2, METAL);
    g.box(0.5, 0.06, 0.08, p.x, FLOOR + 2.4, -HALF_W + 0.2, METAL);
    g.box(0.06, WALL_TOP - FLOOR - 0.6, 0.08, p.x - 0.25, FLOOR + (WALL_TOP - FLOOR) / 2 + 0.3, -HALF_W + 0.2, METAL);
    g.box(0.06, WALL_TOP - FLOOR - 0.6, 0.08, p.x + 0.25, FLOOR + (WALL_TOP - FLOOR) / 2 + 0.3, -HALF_W + 0.2, METAL);
  }
  return { shell: g.toGroup(), front: fg.toGroup(), roof, colliders, spots, slotAnchors, decorAnchors: decorAnchorsFor(def), sideDoor, points, animated, open: false };
}

/** Modèle d'équipement de toit : socle fixe + tête orientable. */
export function buildEquipModel(id: EquipId, level: number): { base: THREE.Group; head: THREE.Group; muzzle: THREE.Vector3; shieldColor?: number } {
  const b = new GeoBuilder();
  const h = new GeoBuilder();
  const muzzle = new THREE.Vector3(0, 0.5, 1.4);
  const plate = [0x4a4e48, 0x5a5e58, 0x6a6e60, 0x8a7a4a][Math.min(3, level)];
  switch (id) {
    case 'mitrailleuse':
      b.cyl(0.55, 0.65, 0.35, 0, 0.18, 0, METAL, { seg: 10 });
      h.box(0.8, 0.5, 0.8, 0, 0.55, 0, plate);
      h.box(1.0, 0.7, 0.12, 0, 0.6, 0.45, plate);
      h.box(0.12, 0.12, 1.2, -0.12, 0.6, 0.9, IRON);
      h.box(0.12, 0.12, 1.2, 0.12, 0.6, 0.9, IRON);
      muzzle.set(0, 0.6, 1.5);
      break;
    case 'canon':
      b.cyl(0.8, 0.95, 0.4, 0, 0.2, 0, METAL, { seg: 12 });
      h.box(1.4, 0.8, 1.5, 0, 0.75, -0.1, plate, { grad: 0.2 });
      h.cyl(0.18, 0.24, 2.2, 0, 0.8, 1.6, IRON, { rx: Math.PI / 2, seg: 10 });
      h.cyl(0.26, 0.26, 0.3, 0, 0.8, 2.6, IRON, { rx: Math.PI / 2, seg: 10 });
      muzzle.set(0, 0.8, 2.8);
      break;
    case 'lanceflammes':
      b.cyl(0.55, 0.65, 0.35, 0, 0.18, 0, METAL, { seg: 10 });
      h.cyl(0.3, 0.3, 0.9, -0.35, 0.65, -0.1, 0x8a2a1e, { seg: 8 });
      h.cyl(0.3, 0.3, 0.9, 0.35, 0.65, -0.1, 0x8a2a1e, { seg: 8 });
      h.box(0.25, 0.25, 1.3, 0, 0.6, 0.6, IRON);
      h.layer('glow').box(0.12, 0.12, 0.08, 0, 0.6, 1.27, 0x60a0ff);
      h.layer('base');
      muzzle.set(0, 0.6, 1.35);
      break;
    case 'tesla':
      b.cyl(0.5, 0.7, 0.5, 0, 0.25, 0, METAL, { seg: 10 });
      h.cyl(0.15, 0.25, 1.4, 0, 1.2, 0, 0x8a6a3a, { seg: 8 });
      for (let i = 0; i < 4; i++) h.cyl(0.45 - i * 0.07, 0.45 - i * 0.07, 0.08, 0, 0.7 + i * 0.3, 0, 0xb87333, { seg: 12 });
      h.layer('glow').sphere(0.32, 0, 2.05, 0, 0x8fd8ff, { detail: 1 });
      h.layer('base');
      muzzle.set(0, 2.05, 0);
      break;
    case 'bouclier':
      b.cyl(0.6, 0.75, 0.4, 0, 0.2, 0, METAL, { seg: 10 });
      h.cyl(0.2, 0.3, 0.8, 0, 0.8, 0, 0x5a6a7a, { seg: 8 });
      h.layer('glow').sphere(0.35, 0, 1.35, 0, 0x60c0ff, { detail: 1 });
      h.layer('base');
      for (let i = 0; i < 3; i++) h.box(0.08, 0.6, 0.08, Math.cos(i * 2.1) * 0.45, 1.0, Math.sin(i * 2.1) * 0.45, 0xb0b0b0);
      muzzle.set(0, 1.35, 0);
      break;
    case 'projecteur':
      b.cyl(0.35, 0.45, 0.3, 0, 0.15, 0, METAL, { seg: 8 });
      b.box(0.12, 0.6, 0.12, 0, 0.55, 0, METAL);
      h.cyl(0.45, 0.35, 0.6, 0, 0.95, 0.1, 0x3a3c40, { rx: Math.PI / 2, seg: 10 });
      h.layer('glow').cyl(0.4, 0.4, 0.05, 0, 0.95, 0.42, 0xfff6d0, { rx: Math.PI / 2, seg: 10 });
      h.layer('base');
      muzzle.set(0, 0.95, 0.5);
      break;
  }
  for (let i = 0; i < level; i++) b.box(0.15, 0.1, 0.15, -0.5 + i * 0.25, 0.42, -0.6, 0xe0b33a);
  return { base: b.toGroup(), head: h.toGroup(), muzzle, shieldColor: id === 'bouclier' ? 0x60c0ff : undefined };
}

export function makeShieldMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x60c0ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
}


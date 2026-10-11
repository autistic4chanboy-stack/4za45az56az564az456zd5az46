import { GeoBuilder } from '../render/geo';
import { PAT } from '../render/toon';
import { rectsOverlap, type Rect } from '../core/math';
import type { StationBuilder, BuildingHandle, InteriorKind } from './stationBuilder';
import type { FurnitureKind } from './furniture';
import type { LootProfile } from './loot';

/**
 * Intérieurs : découpage des bâtiments en pièces (cloisons, portes intérieures) puis
 * aménagement de chaque pièce selon sa fonction. Les grands meubles évitent les murs sud
 * (côté caméra) ; les cloisons est-ouest s'estompent quand on est à l'intérieur.
 */

export type RoomKind =
  | 'salon' | 'cuisine' | 'chambre' | 'salle_de_bain' | 'debarras' | 'open_space' | 'bureau_chef' | 'archives' | 'salle_pause'
  | 'sanitaires' | 'magasin' | 'reserve' | 'salle_bar' | 'refectoire' | 'dortoir' | 'vestiaire' | 'armurerie' | 'salle_soins'
  | 'pharmacie' | 'chambre_malade' | 'labo' | 'chambre_froide' | 'atelier' | 'entrepot' | 'nef' | 'sacristie' | 'reacteur'
  | 'controle' | 'studio' | 'serre' | 'ruine';

interface Room {
  r: Rect;
  kind: RoomKind;
  /** Zones à garder libres (passages devant les portes). */
  clear: Rect[];
  /** Portes de la pièce (pour placer l'interrupteur). */
  doors: { x: number; z: number; side: 'n' | 's' | 'e' | 'w' }[];
}

type Side = 'n' | 's' | 'e' | 'w';

/** Meubles hauts : jamais contre le mur sud, ils masqueraient la pièce. */
/** Meubles accrochés au mur : aucune emprise au sol. */
const WALL_FLAT: ReadonlySet<FurnitureKind> = new Set(['pharmacie', 'placard_haut', 'armoire_glace', 'interrupteur']);

const TALL: ReadonlySet<FurnitureKind> = new Set(['armoire', 'bibliotheque', 'etagere', 'casier', 'frigo', 'classeur', 'jukebox', 'distributeur', 'arcade', 'serveur', 'ratelier', 'lits_superposes', 'piano', 'cuisine']);

/** Emprise approximative (largeur, profondeur) des meubles pour le placement. */
const SIZE: Partial<Record<FurnitureKind, [number, number]>> = {
  commode: [1.26, 0.56], chevet: [0.5, 0.44], bureau: [1.44, 0.76], buffet: [1.66, 0.56], armoire: [1.12, 0.62], classeur: [0.52, 0.66],
  casier: [0.54, 0.54], frigo: [0.78, 0.74], etabli: [1.84, 0.76], coffre_fort: [0.66, 0.66], comptoir: [2.48, 0.7], cuisine: [2.44, 0.66],
  lit: [1.04, 2.04], lit_double: [1.66, 2.1], lits_superposes: [1.0, 2.04], caisse: [1.08, 0.78], coffre: [1.08, 0.7], tonneau: [0.82, 0.82],
  etagere: [1.62, 0.5], poubelle: [0.6, 0.6], lavabo: [0.84, 0.52], meuble_tv: [1.24, 0.5], paillasse: [2.04, 0.76], vitrine: [1.44, 0.64],
  lit_hopital: [1.04, 2.04], canape: [1.94, 0.9], fauteuil: [0.84, 0.84], table: [1.7, 1.0], table_ronde: [1.1, 1.1], baignoire: [0.84, 1.74],
  toilettes: [0.5, 0.64], bibliotheque: [1.54, 0.44], piano: [1.54, 0.74], plante: [0.5, 0.5], poele: [0.8, 0.8], cuisiniere: [0.74, 0.66],
  banc: [1.84, 0.5], serveur: [0.74, 0.94], palette: [1.24, 1.04], ratelier: [1.44, 0.4], machine: [1.64, 1.14], autel: [2.24, 1.04],
  prie_dieu: [1.64, 0.5], console: [1.64, 0.84], lampadaire: [0.44, 0.44], jukebox: [0.94, 0.64], distributeur: [0.94, 0.8], arcade: [0.84, 0.84],
  groupe: [1.84, 1.04], cadavre: [0.7, 1.7], sac: [0.8, 0.8], caisse_outils: [0.64, 0.36], chaise: [0.5, 0.5], tapis: [2.2, 1.4], conteneur: [2.5, 6.1],
};

interface RoomPlan {
  floor: 'bois' | 'carrelage' | 'beton' | 'tapis';
  /** Meubles muraux par ordre de priorité ; '?' en suffixe : facultatif (50 %). */
  wall: string[];
  center?: string[];
  rows?: { kind: FurnitureKind; dx: number; dz: number; ry: number };
}

const PLANS: Record<RoomKind, RoomPlan> = {
  salon: { floor: 'bois', wall: ['meuble_tv?', 'buffet', 'bibliotheque?', 'commode?', 'canape', 'fauteuil?', 'plante?', 'lampadaire?'], center: ['tapis', 'table_ronde?'] },
  cuisine: { floor: 'carrelage', wall: ['cuisine', 'frigo', 'buffet?', 'poubelle', 'cuisiniere?'], center: ['table'] },
  chambre: { floor: 'bois', wall: ['lit|lit_double', 'chevet', 'armoire', 'commode?', 'chevet?', 'chaise?'], center: ['tapis?'] },
  salle_de_bain: { floor: 'carrelage', wall: ['baignoire?', 'lavabo', 'toilettes', 'pharmacie?'] },
  debarras: { floor: 'beton', wall: ['etagere', 'caisse', 'etagere?', 'tonneau?', 'poubelle?', 'caisse?'] },
  open_space: { floor: 'bois', wall: ['classeur', 'classeur?', 'etagere?', 'plante?', 'distributeur?'], rows: { kind: 'bureau', dx: 2.6, dz: 2.4, ry: 0 } },
  bureau_chef: { floor: 'tapis', wall: ['bureau', 'classeur', 'coffre_fort?', 'bibliotheque?', 'plante?', 'fauteuil?'] },
  archives: { floor: 'beton', wall: ['classeur', 'classeur', 'classeur', 'etagere', 'classeur?', 'etagere?'], rows: { kind: 'etagere', dx: 2.2, dz: 2.0, ry: 0 } },
  salle_pause: { floor: 'carrelage', wall: ['distributeur?', 'frigo', 'meuble_tv?', 'canape?', 'poubelle'], center: ['table'] },
  sanitaires: { floor: 'carrelage', wall: ['lavabo', 'toilettes', 'toilettes?', 'casier?'] },
  magasin: { floor: 'bois', wall: ['etagere', 'etagere', 'vitrine?', 'etagere?', 'distributeur?', 'arcade?'], center: ['comptoir'] },
  reserve: { floor: 'beton', wall: ['etagere', 'caisse', 'palette?', 'etagere?', 'tonneau?', 'caisse?'] },
  salle_bar: { floor: 'bois', wall: ['comptoir', 'jukebox?', 'buffet', 'arcade?', 'piano?', 'meuble_tv?'], rows: { kind: 'table_ronde', dx: 2.4, dz: 2.4, ry: 0 } },
  refectoire: { floor: 'carrelage', wall: ['buffet', 'poubelle', 'distributeur?'], rows: { kind: 'table', dx: 2.4, dz: 2.2, ry: 0 } },
  dortoir: { floor: 'beton', wall: ['lits_superposes', 'casier', 'lits_superposes', 'casier', 'lits_superposes?', 'casier?', 'radio?'] },
  vestiaire: { floor: 'carrelage', wall: ['casier', 'casier', 'casier', 'casier?', 'casier?', 'lavabo?'], center: ['banc'] },
  armurerie: { floor: 'beton', wall: ['ratelier', 'casier', 'coffre_fort', 'caisse', 'ratelier?', 'etabli?'] },
  salle_soins: { floor: 'carrelage', wall: ['lit_hopital', 'lit_hopital', 'pharmacie', 'armoire', 'lavabo?', 'lit_hopital?'], center: ['table?'] },
  pharmacie: { floor: 'carrelage', wall: ['etagere', 'pharmacie', 'armoire', 'classeur?', 'etagere?'], center: ['comptoir?'] },
  chambre_malade: { floor: 'carrelage', wall: ['lit_hopital', 'chevet', 'chaise?', 'pharmacie?'] },
  labo: { floor: 'carrelage', wall: ['paillasse', 'frigo', 'armoire', 'classeur', 'paillasse?', 'ordinateur_table?'], center: ['paillasse?'] },
  chambre_froide: { floor: 'carrelage', wall: ['frigo', 'frigo', 'frigo?', 'etagere?'] },
  atelier: { floor: 'beton', wall: ['etabli', 'etagere', 'etabli?', 'casier?', 'tonneau?', 'radio_table?'], center: ['machine?'] },
  entrepot: { floor: 'beton', wall: ['etagere', 'etagere', 'palette', 'caisse', 'etagere?', 'tonneau?'], rows: { kind: 'etagere', dx: 3.0, dz: 2.4, ry: 0 } },
  nef: { floor: 'carrelage', wall: ['autel', 'armoire?'], rows: { kind: 'prie_dieu', dx: 2.4, dz: 1.4, ry: Math.PI } },
  sacristie: { floor: 'bois', wall: ['armoire', 'commode', 'coffre?', 'bibliotheque?'] },
  reacteur: { floor: 'beton', wall: ['console', 'casier', 'console?', 'casier?'] },
  controle: { floor: 'carrelage', wall: ['console', 'serveur', 'console?', 'classeur', 'serveur?'], center: ['bureau?'] },
  studio: { floor: 'tapis', wall: ['console', 'bureau', 'etagere', 'classeur?', 'radio_table?'] },
  serre: { floor: 'beton', wall: [] },
  ruine: { floor: 'beton', wall: ['caisse?', 'cadavre?', 'sac?', 'tonneau?', 'etagere?'] },
};

/** Pièce principale et pièces annexes selon le type de bâtiment. */
const LAYOUT: Record<InteriorKind, { main: RoomKind; others: RoomKind[]; maxArea: number }> = {
  maison: { main: 'salon', others: ['cuisine', 'chambre', 'salle_de_bain', 'chambre', 'debarras'], maxArea: 20 },
  boutique: { main: 'magasin', others: ['reserve', 'bureau_chef', 'reserve'], maxArea: 34 },
  bureau: { main: 'open_space', others: ['bureau_chef', 'archives', 'salle_pause', 'sanitaires', 'bureau_chef'], maxArea: 30 },
  entrepot: { main: 'entrepot', others: ['bureau_chef', 'reserve'], maxArea: 70 },
  caserne: { main: 'dortoir', others: ['vestiaire', 'armurerie', 'bureau_chef', 'sanitaires'], maxArea: 34 },
  armurerie: { main: 'armurerie', others: ['bureau_chef', 'reserve'], maxArea: 30 },
  infirmerie: { main: 'salle_soins', others: ['pharmacie', 'chambre_malade', 'bureau_chef', 'sanitaires'], maxArea: 30 },
  labo: { main: 'labo', others: ['bureau_chef', 'chambre_froide', 'archives', 'labo'], maxArea: 30 },
  atelier: { main: 'atelier', others: ['bureau_chef', 'reserve'], maxArea: 50 },
  chapelle: { main: 'nef', others: ['sacristie'], maxArea: 120 },
  reacteur: { main: 'reacteur', others: ['controle', 'vestiaire'], maxArea: 200 },
  cantine: { main: 'refectoire', others: ['cuisine', 'reserve'], maxArea: 40 },
  serre: { main: 'serre', others: [], maxArea: 400 },
  vide: { main: 'ruine', others: ['ruine', 'ruine'], maxArea: 26 },
  salle_controle: { main: 'controle', others: ['bureau_chef', 'archives'], maxArea: 34 },
  radio: { main: 'studio', others: ['bureau_chef', 'debarras'], maxArea: 30 },
  garage: { main: 'atelier', others: ['bureau_chef', 'debarras'], maxArea: 60 },
  bar: { main: 'salle_bar', others: ['cuisine', 'reserve', 'chambre'], maxArea: 40 },
  dortoir: { main: 'dortoir', others: ['vestiaire', 'sanitaires', 'chambre'], maxArea: 34 },
};

const WALLPAPER = [0xc8b898, 0xb8a888, 0xa8b098, 0xc0a8a0, 0xb0b8c0, 0xd0c4a8];
const FLOOR_COLORS: Record<RoomPlan['floor'], number[]> = {
  bois: [0x7a5a3c, 0x6a4c32, 0x86643e],
  carrelage: [0xc8c4b8, 0xa8b0b0, 0xc0b098, 0x9aa0a8],
  beton: [0x6e6a64, 0x76726a],
  tapis: [0x6a2e2e, 0x2e3e5a, 0x4a3a2a],
};

export interface FurnishOpts {
  kind: InteriorKind;
  loot: LootProfile;
  richness: number;
  /** Cloisons est-ouest : estompées avec la façade quand on est dedans. */
  innerFront: GeoBuilder;
  lockContainers?: import('./stationBuilder').LockSpec;
  homey: boolean;
}

/** Découpe l'intérieur en pièces et les meuble. Renvoie les pièces (pour les scripts). */
export function furnishBuilding(b: StationBuilder, h: BuildingHandle, o: FurnishOpts): Rect[] {
  const rng = b.rng;
  const layout = LAYOUT[o.kind];
  const wallH = h.spec.h ?? 3.4;
  const inner = h.inner;
  const extDoors = h.doors.map((d) => ({ x: d.x, z: d.z, along: d.along, width: d.width }));
  // ---- découpage
  const leaves: Room[] = [];
  const split = (r: Rect, depth: number, clear: Rect[], doors: Room['doors']) => {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const minSide = 3.0;
    const canX = w >= minSide * 2 + 0.2;
    const canZ = d >= minSide * 2 + 0.2;
    if (depth > 4 || w * d <= layout.maxArea || (!canX && !canZ)) {
      leaves.push({ r, kind: layout.main, clear, doors });
      return;
    }
    const alongX = canX && (!canZ || w >= d);
    for (let attempt = 0; attempt < 6; attempt++) {
      const t = rng.range(0.38, 0.62);
      const cut = alongX ? Math.round((r.x0 + w * t) * 10) / 10 : Math.round((r.z0 + d * t) * 10) / 10;
      if (alongX ? cut - r.x0 < minSide || r.x1 - cut < minSide : cut - r.z0 < minSide || r.z1 - cut < minSide) continue;
      // la cloison ne doit pas tomber dans une porte extérieure
      const hit = extDoors.some((ed) => (alongX ? ed.along === 'x' && Math.abs(ed.x - cut) < ed.width / 2 + 0.5 : ed.along === 'z' && Math.abs(ed.z - cut) < ed.width / 2 + 0.5));
      if (hit) continue;
      // …ni buter contre la porte d'une cloison déjà posée (le passage serait coupé en deux)
      const tee = doors.some((dd) => (alongX ? (dd.side === 'n' || dd.side === 's') && Math.abs(dd.x - cut) < 1.35 : (dd.side === 'e' || dd.side === 'w') && Math.abs(dd.z - cut) < 1.35));
      if (tee) continue;
      // cloison avec une ouverture et une porte
      const T = 0.16;
      const span0 = alongX ? r.z0 : r.x0;
      const span1 = alongX ? r.z1 : r.x1;
      const dw = 1.1;
      const doorC = rng.range(span0 + 0.9 + dw / 2, span1 - 0.9 - dw / 2);
      const segs: [number, number][] = [[span0, doorC - dw / 2], [doorC + dw / 2, span1]];
      const g = alongX ? b.g : o.innerFront;
      const col = o.homey ? rng.pick(WALLPAPER) : 0xb8b4a8;
      for (const [a0, a1] of segs) {
        if (a1 - a0 < 0.05) continue;
        if (alongX) {
          g.box(T, wallH, a1 - a0, cut, wallH / 2, (a0 + a1) / 2, col, { pat: o.homey ? PAT.papier : 0, grad: 0.12 });
          b.colliders.addRect(cut - T / 2, a0, cut + T / 2, a1, 'wall');
        } else {
          g.box(a1 - a0, wallH, T, (a0 + a1) / 2, wallH / 2, cut, col, { pat: o.homey ? PAT.papier : 0, grad: 0.12 });
          b.colliders.addRect(a0, cut - T / 2, a1, cut + T / 2, 'wall');
        }
      }
      // linteau au-dessus de la porte
      if (alongX) g.box(T, wallH - 2.4, dw, cut, 2.4 + (wallH - 2.4) / 2, doorC, col);
      else g.box(dw, wallH - 2.4, T, doorC, 2.4 + (wallH - 2.4) / 2, cut, col);
      const dx = alongX ? cut : doorC;
      const dz = alongX ? doorC : cut;
      const locked = !o.homey && rng.chance(0.12);
      b.door(b.nextId('porte_int'), dx, dz, alongX ? 'z' : 'x', dw, locked ? { kind: 'crochet', difficulty: rng.int(1, 2) } : undefined, h.id, rng.chance(0.5) ? 1 : -1);
      const clearZone: Rect = alongX ? { x0: cut - 1.4, z0: doorC - 0.9, x1: cut + 1.4, z1: doorC + 0.9 } : { x0: doorC - 0.9, z0: cut - 1.4, x1: doorC + 0.9, z1: cut + 1.4 };
      const a: Rect = alongX ? { x0: r.x0, z0: r.z0, x1: cut - T / 2, z1: r.z1 } : { x0: r.x0, z0: r.z0, x1: r.x1, z1: cut - T / 2 };
      const bR: Rect = alongX ? { x0: cut + T / 2, z0: r.z0, x1: r.x1, z1: r.z1 } : { x0: r.x0, z0: cut + T / 2, x1: r.x1, z1: r.z1 };
      const doorA = { x: dx, z: dz, side: (alongX ? 'e' : 's') as Side };
      const doorB = { x: dx, z: dz, side: (alongX ? 'w' : 'n') as Side };
      split(a, depth + 1, [...clear, clearZone], [...doors.filter((dd) => inside(a, dd.x, dd.z, 0.5)), doorA]);
      split(bR, depth + 1, [...clear, clearZone], [...doors.filter((dd) => inside(bR, dd.x, dd.z, 0.5)), doorB]);
      return;
    }
    leaves.push({ r, kind: layout.main, clear, doors });
  };
  const extClear: Rect[] = h.doors.map((d) => (d.along === 'x' ? { x0: d.x - d.width / 2 - 0.4, z0: d.z - 1.6, x1: d.x + d.width / 2 + 0.4, z1: d.z + 1.6 } : { x0: d.x - 1.6, z0: d.z - d.width / 2 - 0.4, x1: d.x + 1.6, z1: d.z + d.width / 2 + 0.4 }));
  const extDoorsRoom = h.doors.map((d) => ({ x: d.x, z: d.z, side: (d.along === 'x' ? (d.z > (inner.z0 + inner.z1) / 2 ? 's' : 'n') : d.x > (inner.x0 + inner.x1) / 2 ? 'e' : 'w') as Side }));
  if (o.kind === 'serre' || o.kind === 'reacteur') leaves.push({ r: inner, kind: layout.main, clear: extClear, doors: extDoorsRoom });
  else split(inner, 0, extClear, extDoorsRoom);

  // ---- typage : la pièce de la porte principale accueille la fonction principale
  const main = h.doors[0];
  const mainRoom = leaves.find((l) => main && inside(l.r, main.x, main.z, 0.6)) ?? leaves[0];
  const others = leaves.filter((l) => l !== mainRoom).sort((a, b2) => area(b2.r) - area(a.r));
  mainRoom.kind = layout.main;
  others.forEach((l, i) => {
    let k = layout.others[i % Math.max(1, layout.others.length)] ?? layout.main;
    // la plus petite pièce d'une maison devient la salle de bain
    if (o.kind === 'maison' && i === others.length - 1 && others.length >= 2) k = 'salle_de_bain';
    l.kind = k;
  });

  // ---- aménagement
  for (const room of leaves) furnishRoom(b, h, room, o, room === mainRoom);
  return leaves.map((l) => l.r);
}

function inside(r: Rect, x: number, z: number, m = 0): boolean {
  return x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
}

function area(r: Rect): number {
  return (r.x1 - r.x0) * (r.z1 - r.z0);
}

/**
 * La pièce reste-t-elle praticable ? Depuis la première porte, on doit atteindre les autres portes
 * et le devant de chaque meuble (grille de 25 cm, gabarit du joueur).
 */
function roomPassable(r: Rect, doors: Room['doors'], obstacles: Rect[], fronts: Rect[]): boolean {
  if (!doors.length) return true;
  const C = 0.25;
  const R = 0.38;
  const cols = Math.max(1, Math.floor((r.x1 - r.x0) / C));
  const rows = Math.max(1, Math.floor((r.z1 - r.z0) / C));
  const cx = (i: number) => r.x0 + (i + 0.5) * C;
  const cz = (j: number) => r.z0 + (j + 0.5) * C;
  const free = new Uint8Array(cols * rows);
  // pas collé aux murs de la pièce
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = cx(i);
      const z = cz(j);
      free[j * cols + i] = x - r.x0 >= R - 0.02 && r.x1 - x >= R - 0.02 && z - r.z0 >= R - 0.02 && r.z1 - z >= R - 0.02 ? 1 : 0;
    }
  }
  // meubles : on ne parcourt que les cellules autour de chacun
  for (const o of obstacles) {
    const i0 = Math.max(0, Math.floor((o.x0 - R - r.x0) / C));
    const i1 = Math.min(cols - 1, Math.floor((o.x1 + R - r.x0) / C));
    const j0 = Math.max(0, Math.floor((o.z0 - R - r.z0) / C));
    const j1 = Math.min(rows - 1, Math.floor((o.z1 + R - r.z0) / C));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = cx(i);
        const z = cz(j);
        const nx = Math.max(o.x0, Math.min(x, o.x1));
        const nz = Math.max(o.z0, Math.min(z, o.z1));
        if ((x - nx) ** 2 + (z - nz) ** 2 < R * R) free[j * cols + i] = 0;
      }
    }
  }
  // cellules d'entrée : le pas de chaque porte, côté pièce
  const near = (x: number, z: number, i: number, j: number, d: number) => Math.hypot(cx(i) - x, cz(j) - z) <= d;
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const d0 = doors[0];
  const si0 = Math.max(0, Math.floor((d0.x - 0.9 - r.x0) / C));
  const si1 = Math.min(cols - 1, Math.floor((d0.x + 0.9 - r.x0) / C));
  const sj0 = Math.max(0, Math.floor((d0.z - 0.9 - r.z0) / C));
  const sj1 = Math.min(rows - 1, Math.floor((d0.z + 0.9 - r.z0) / C));
  for (let j = sj0; j <= sj1; j++) for (let i = si0; i <= si1; i++) if (free[j * cols + i] && near(d0.x, d0.z, i, j, 0.9)) {
    seen[j * cols + i] = 1;
    stack.push(j * cols + i);
  }
  if (!stack.length) return false;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % cols;
    const j = (k - i) / cols;
    if (i > 0 && free[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
    if (i < cols - 1 && free[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
    if (j > 0 && free[k - cols] && !seen[k - cols]) { seen[k - cols] = 1; stack.push(k - cols); }
    if (j < rows - 1 && free[k + cols] && !seen[k + cols]) { seen[k + cols] = 1; stack.push(k + cols); }
  }
  /** Une cellule atteinte dans le rectangle donné (et vérifiant le test) ? */
  const reached = (x0: number, z0: number, x1: number, z1: number, test: (i: number, j: number) => boolean) => {
    const i0 = Math.max(0, Math.floor((x0 - r.x0) / C));
    const i1 = Math.min(cols - 1, Math.floor((x1 - r.x0) / C));
    const j0 = Math.max(0, Math.floor((z0 - r.z0) / C));
    const j1 = Math.min(rows - 1, Math.floor((z1 - r.z0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (seen[j * cols + i] && test(i, j)) return true;
    return false;
  };
  for (const d of doors.slice(1)) if (!reached(d.x - 0.9, d.z - 0.9, d.x + 0.9, d.z + 0.9, (i, j) => near(d.x, d.z, i, j, 0.9))) return false;
  for (const f of fronts) if (!reached(f.x0 - 0.3, f.z0 - 0.3, f.x1 + 0.3, f.z1 + 0.3, () => true)) return false;
  return true;
}

/** Bande de 0,8 m devant la face avant d'un meuble adossé au mur `side`. */
function frontZone(side: Side, x: number, z: number, w: number, d: number): Rect {
  const hw = Math.max(w, 0.8) / 2;
  const D = 0.8;
  switch (side) {
    case 'n':
      return { x0: x - hw, z0: z + d / 2, x1: x + hw, z1: z + d / 2 + D };
    case 's':
      return { x0: x - hw, z0: z - d / 2 - D, x1: x + hw, z1: z - d / 2 };
    case 'w':
      return { x0: x + d / 2, z0: z - hw, x1: x + d / 2 + D, z1: z + hw };
    default:
      return { x0: x - d / 2 - D, z0: z - hw, x1: x - d / 2, z1: z + hw };
  }
}

/** Emprise monde d'un meuble posé en (x, z) avec la rotation ry (multiple de π/2). */
function footprint(kind: FurnitureKind, x: number, z: number, ry: number): Rect {
  const [w, d] = SIZE[kind] ?? [1, 0.6];
  const turned = Math.abs(Math.sin(ry)) > 0.5;
  const hw = (turned ? d : w) / 2;
  const hd = (turned ? w : d) / 2;
  return { x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd };
}

function furnishRoom(b: StationBuilder, h: BuildingHandle, room: Room, o: FurnishOpts, isMain: boolean): void {
  const rng = b.rng;
  const plan = PLANS[room.kind];
  const r = room.r;
  const placed: Rect[] = [];
  /** Dégagements devant les meubles déjà posés : on doit pouvoir s'y tenir pour les fouiller. */
  const access: Rect[] = [];
  const blocked = (fp: Rect) => fp.x0 < r.x0 - 0.01 || fp.x1 > r.x1 + 0.01 || fp.z0 < r.z0 - 0.01 || fp.z1 > r.z1 + 0.01 || room.clear.some((c) => rectsOverlap(c, fp, 0)) || placed.some((p) => rectsOverlap(p, fp, 0.05)) || access.some((a) => rectsOverlap(a, fp, 0));
  // ---- sol de la pièce
  const fc = rng.pick(FLOOR_COLORS[plan.floor]);
  const fpat = plan.floor === 'bois' ? PAT.platelage : plan.floor === 'carrelage' ? PAT.carrelage : 0;
  b.g.box(r.x1 - r.x0, 0.02, r.z1 - r.z0, (r.x0 + r.x1) / 2, 0.13, (r.z0 + r.z1) / 2, fc, { pat: fpat });

  const put = (kind: FurnitureKind, x: number, z: number, ry: number, y = 0) => {
    b.furniture(kind, x, z, ry, { y, profile: o.loot, richness: o.richness, lock: o.lockContainers && rng.chance(0.25) && kind !== 'chevet' ? o.lockContainers : undefined, building: h.id });
  };

  // ---- meubles muraux
  const sides: Side[] = rng.chance(0.5) ? ['n', 'w', 'e', 's'] : ['n', 'e', 'w', 's'];
  const tryWall = (kind: FurnitureKind): { x: number; z: number; ry: number; side: Side } | null => {
    const [w, d] = SIZE[kind] ?? [1, 0.6];
    for (const side of sides) {
      if (side === 's' && TALL.has(kind)) continue;
      const alongX = side === 'n' || side === 's';
      const len0 = alongX ? r.x0 : r.z0;
      const len1 = alongX ? r.x1 : r.z1;
      if (len1 - len0 < w + 0.1) continue;
      const ry = side === 'n' ? 0 : side === 's' ? Math.PI : side === 'w' ? Math.PI / 2 : -Math.PI / 2;
      const fixed = side === 'n' ? r.z0 + d / 2 + 0.03 : side === 's' ? r.z1 - d / 2 - 0.03 : side === 'w' ? r.x0 + d / 2 + 0.03 : r.x1 - d / 2 - 0.03;
      const start = rng.chance(0.5);
      const steps = Math.floor((len1 - len0 - w) / 0.25);
      for (let k = 0; k <= steps; k++) {
        const t = start ? k : steps - k;
        const c = len0 + w / 2 + 0.05 + t * 0.25;
        if (c + w / 2 > len1) continue;
        const x = alongX ? c : fixed;
        const z = alongX ? fixed : c;
        const fp = footprint(kind, x, z, ry);
        if (blocked(fp)) continue;
        // la face avant doit rester accessible (ni meuble ni mur devant)
        const acc = frontZone(side, x, z, w, d);
        if (acc.x0 < r.x0 - 0.01 || acc.x1 > r.x1 + 0.01 || acc.z0 < r.z0 - 0.01 || acc.z1 > r.z1 + 0.01 || placed.some((p) => rectsOverlap(p, acc, 0))) continue;
        // …et la pièce doit rester traversable jusqu'au devant de chaque meuble
        if (!WALL_FLAT.has(kind) && !roomPassable(r, room.doors, [...placed, fp], [...access, acc])) continue;
        return { x, z, ry, side };
      }
    }
    return null;
  };
  for (const entry of plan.wall) {
    const optional = entry.endsWith('?');
    if (optional && !rng.chance(0.55)) continue;
    const name = entry.replace('?', '');
    const choice = (name.includes('|') ? rng.pick(name.split('|')) : name) as string;
    // variantes posées sur un meuble
    if (choice === 'radio_table' || choice === 'ordinateur_table') {
      const host: FurnitureKind = choice === 'radio_table' ? 'commode' : 'bureau';
      const spot = tryWall(host);
      if (!spot) continue;
      placed.push(footprint(host, spot.x, spot.z, spot.ry));
      access.push(frontZone(spot.side, spot.x, spot.z, ...(SIZE[host] ?? [1, 0.6])));
      put(host, spot.x, spot.z, spot.ry);
      const dev: FurnitureKind = choice === 'radio_table' ? 'radio' : 'ordinateur';
      b.furniture(dev, spot.x + Math.sin(spot.ry) * -0.05, spot.z + Math.cos(spot.ry) * -0.05, spot.ry, { y: host === 'commode' ? 0.88 : 0.76, building: h.id });
      continue;
    }
    const kind = choice as FurnitureKind;
    const spot = tryWall(kind);
    if (!spot) continue;
    placed.push(footprint(kind, spot.x, spot.z, spot.ry));
    access.push(frontZone(spot.side, spot.x, spot.z, ...(SIZE[kind] ?? [1, 0.6])));
    put(kind, spot.x, spot.z, spot.ry);
    // compléments : ordinateur sur les bureaux, armoire à glace au-dessus du lavabo, lampe de bureau
    if (kind === 'bureau' && rng.chance(room.kind === 'bureau_chef' || room.kind === 'controle' ? 0.7 : 0.35)) {
      b.furniture('ordinateur', spot.x + Math.cos(spot.ry) * 0.25 - Math.sin(spot.ry) * 0.05, spot.z - Math.sin(spot.ry) * 0.25 - Math.cos(spot.ry) * 0.05, spot.ry, { y: 0.76, building: h.id });
    }
    if (kind === 'lavabo') b.furniture('armoire_glace', spot.x - Math.sin(spot.ry) * 0.2, spot.z - Math.cos(spot.ry) * 0.2, spot.ry, { building: h.id });
    if (kind === 'etabli' && rng.chance(0.5)) b.furniture('caisse_outils', spot.x - Math.cos(spot.ry) * 0.4, spot.z + Math.sin(spot.ry) * 0.4, spot.ry, { y: 0.9, building: h.id });
  }

  // ---- rangées (bureaux, tables, bancs d'église, rayonnages)
  if (plan.rows) {
    const rw = plan.rows;
    const [w, d] = SIZE[rw.kind] ?? [1.4, 0.8];
    const x0 = r.x0 + 1.1 + w / 2;
    const z0 = r.z0 + 1.6 + d / 2;
    for (let z = z0; z <= r.z1 - 1.1 - d / 2; z += Math.max(rw.dz, d + 1.0)) {
      for (let x = x0; x <= r.x1 - 1.1 - w / 2; x += Math.max(rw.dx, w + 0.9)) {
        const fp = footprint(rw.kind, x, z, rw.ry);
        if (blocked({ x0: fp.x0 - 0.3, z0: fp.z0 - 0.3, x1: fp.x1 + 0.3, z1: fp.z1 + 0.3 })) continue;
        if (!roomPassable(r, room.doors, [...placed, fp], access)) continue;
        placed.push(fp);
        put(rw.kind, x, z, rw.ry);
        if (rw.kind === 'bureau' && rng.chance(0.45)) b.furniture('ordinateur', x + 0.25, z - 0.05, rw.ry, { y: 0.76, building: h.id });
      }
    }
  }

  // ---- pièces centrales
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  for (const entry of plan.center ?? []) {
    if (entry.endsWith('?') && !rng.chance(0.55)) continue;
    const kind = entry.replace('?', '') as FurnitureKind;
    const [w, d] = SIZE[kind] ?? [1.4, 0.9];
    if (r.x1 - r.x0 < w + 2.0 || r.z1 - r.z0 < d + 2.0) continue;
    const fp = footprint(kind, cx, cz, 0);
    if (kind === 'tapis') {
      if (!room.clear.some((c) => rectsOverlap(c, fp, 0))) put(kind, cx, cz, 0);
      continue;
    }
    if (blocked({ x0: fp.x0 - 0.6, z0: fp.z0 - 0.6, x1: fp.x1 + 0.6, z1: fp.z1 + 0.6 })) continue;
    if (!roomPassable(r, room.doors, [...placed, fp], access)) continue;
    placed.push(fp);
    put(kind, cx, cz, kind === 'comptoir' ? Math.PI : 0);
  }

  // ---- interrupteur près de l'entrée de la pièce principale
  if (isMain && room.doors.length) {
    const d0 = room.doors[0];
    const off = 1.0;
    let x = d0.x;
    let z = d0.z;
    let ry = 0;
    if (d0.side === 'n') {
      x += off;
      z = r.z0 + 0.03;
      ry = 0;
    } else if (d0.side === 's') {
      x += off;
      z = r.z1 - 0.03;
      ry = Math.PI;
    } else if (d0.side === 'w') {
      z += off;
      x = r.x0 + 0.03;
      ry = Math.PI / 2;
    } else {
      z += off;
      x = r.x1 - 0.03;
      ry = -Math.PI / 2;
    }
    if (inside(r, x, z, 0.1)) b.furniture('interrupteur', x, z, ry, { building: h.id });
  }

  // ---- cadres et horloges sur les murs libres (maisons, bureaux)
  if (o.homey || room.kind === 'bureau_chef' || room.kind === 'salle_bar') {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const side = rng.pick(['n', 'e', 'w'] as const);
      const alongX = side === 'n';
      const c = alongX ? rng.range(r.x0 + 0.6, r.x1 - 0.6) : rng.range(r.z0 + 0.6, r.z1 - 0.6);
      const fw = rng.range(0.35, 0.7);
      const fh = rng.range(0.3, 0.55);
      const col = rng.pick([0x8a6a3a, 0x3a3a3a, 0xc9a050]);
      const art = rng.pick([0x4a6a8a, 0x8a5a3a, 0x5a7a4a, 0xc8b890, 0x7a4a5a]);
      if (alongX) {
        b.g.box(fw, fh, 0.04, c, 1.75, r.z0 + 0.03, col);
        b.g.box(fw - 0.08, fh - 0.08, 0.045, c, 1.75, r.z0 + 0.035, art);
      } else {
        const x = side === 'w' ? r.x0 + 0.03 : r.x1 - 0.03;
        b.g.box(0.04, fh, fw, x, 1.75, c, col);
        b.g.box(0.045, fh - 0.08, fw - 0.08, x + (side === 'w' ? 0.005 : -0.005), 1.75, c, art);
      }
    }
  }
}

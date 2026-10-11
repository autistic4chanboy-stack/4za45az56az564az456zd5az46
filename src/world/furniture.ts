import type { GeoBuilder, PartOpts } from '../render/geo';
import type { PartSet, PartMotion } from '../render/parts';
import { PAT } from '../render/toon';
import type { Rng } from '../core/rng';

/**
 * Bibliothèque de mobilier. Chaque meuble pose sa géométrie fixe dans un GeoBuilder fusionné
 * et ses éléments mobiles (tiroirs, portes, couvercles) dans un PartSet instancié.
 * Repère local : origine au sol, au centre de l'emprise ; la façade regarde +z.
 */

export type FurnitureKind =
  // rangements (fouillables)
  | 'commode' | 'chevet' | 'bureau' | 'buffet' | 'armoire' | 'classeur' | 'casier' | 'frigo' | 'etabli' | 'caisse_outils'
  | 'coffre_fort' | 'comptoir' | 'pharmacie' | 'placard_haut' | 'cuisine' | 'lit' | 'lit_double' | 'lits_superposes' | 'caisse' | 'coffre'
  | 'tonneau' | 'etagere' | 'cadavre' | 'sac' | 'poubelle' | 'lavabo' | 'armoire_glace' | 'meuble_tv' | 'paillasse' | 'vitrine' | 'lit_hopital'
  | 'conteneur'
  // décor
  | 'canape' | 'fauteuil' | 'table' | 'table_ronde' | 'chaise' | 'baignoire' | 'toilettes' | 'bibliotheque' | 'piano' | 'tapis'
  | 'plante' | 'poele' | 'cuisiniere' | 'banc' | 'serveur' | 'palette' | 'ratelier' | 'machine' | 'autel' | 'prie_dieu'
  // appareils
  | 'radio' | 'ordinateur' | 'console' | 'lampadaire' | 'jukebox' | 'distributeur' | 'arcade' | 'groupe' | 'interrupteur' | 'tv';

/** Thème d'un compartiment : oriente le butin, les textes d'ambiance et les documents trouvés. */
export type Theme =
  | 'linge' | 'papiers' | 'cuisine' | 'frigo' | 'outils' | 'toilette' | 'pharmacie' | 'ordures' | 'argent' | 'coffre'
  | 'militaire' | 'labo' | 'livres' | 'divers' | 'cadavre' | 'marchandise' | 'lit';

export interface CompDef {
  name: string;
  parts: number[];
  /** Taille relative (0.5 tiroir, 1 placard, 1.6 grand volume). */
  size: number;
  theme: Theme;
}

export type DeviceKind = 'tv' | 'radio' | 'ordinateur' | 'lampe' | 'interrupteur' | 'jukebox' | 'distributeur' | 'arcade' | 'groupe';

export interface DeviceDef {
  kind: DeviceKind;
  /** Pièces lumineuses (écran, voyant), éteintes par défaut. */
  screens: number[];
  /** Couleur des écrans allumés. */
  screenColor: number;
  /** Position locale de la lumière émise (lampes, écrans). */
  light?: { lx: number; ly: number; lz: number; color: number; intensity: number; distance: number };
  needsPower: boolean;
}

export interface FurnSpec {
  name: string;
  /** Emprise locale (largeur le long de x, profondeur le long de z). */
  w: number;
  d: number;
  comps: CompDef[];
  device?: DeviceDef;
  /** Bloque le passage (défaut : oui). */
  blocks?: boolean;
  /** Arrête les tirs (défaut : non, sauf gros meubles). */
  cover?: boolean;
}

/** Repère d'un meuble posé au sol (rotation autour de y). */
export class Frame {
  readonly c: number;
  readonly s: number;
  constructor(readonly x: number, readonly z: number, readonly ry: number, readonly y = 0) {
    this.c = Math.cos(ry);
    this.s = Math.sin(ry);
  }
  wx(lx: number, lz: number): number {
    return this.x + lx * this.c + lz * this.s;
  }
  wz(lx: number, lz: number): number {
    return this.z - lx * this.s + lz * this.c;
  }
}

type LocalMotion = { glisse: number } | { porte: 'g' | 'd'; hx: number; hz: number; angle?: number } | { couvercle: number; hz: number } | { efface: true };

interface Ctx {
  g: GeoBuilder;
  parts: PartSet;
  f: Frame;
  rng: Rng;
}

// ---------------------------------------------------------------- palette du mobilier
export const WOOD = { clair: 0x9a7450, moyen: 0x7a5638, fonce: 0x553a26, noyer: 0x6a4630 };
const PAINT = [0xd8ccb0, 0x6a8a72, 0x5a7090, 0xb8a888, 0x8a5a4a, 0xa8b0a0];
const METAL = { gris: 0x7a7e82, clair: 0xa6aaac, fonce: 0x4a4e52, olive: 0x5e6248, rouge: 0xa83a2a, vert: 0x4e6a58 };
const KNOB = 0x2a2420;
const BRASS = 0xc8a050;

function sbox(c: Ctx, w: number, h: number, d: number, lx: number, ly: number, lz: number, color: number, opts?: PartOpts): void {
  c.g.box(w, h, d, c.f.wx(lx, lz), c.f.y + ly, c.f.wz(lx, lz), color, { ...opts, ry: c.f.ry + (opts?.ry ?? 0) });
}

function scyl(c: Ctx, rt: number, rb: number, h: number, lx: number, ly: number, lz: number, color: number, opts?: PartOpts): void {
  c.g.cyl(rt, rb, h, c.f.wx(lx, lz), c.f.y + ly, c.f.wz(lx, lz), color, { ...opts, ry: c.f.ry + (opts?.ry ?? 0) });
}

function motionOf(c: Ctx, m: LocalMotion | null): PartMotion {
  const f = c.f;
  if (!m) return { kind: 'fixe' };
  if ('glisse' in m) return { kind: 'glisse', dx: f.s * m.glisse, dy: 0, dz: f.c * m.glisse };
  if ('porte' in m) return { kind: 'pivot', px: f.wx(m.hx, m.hz), py: 0, pz: f.wz(m.hx, m.hz), ax: 0, ay: 1, az: 0, angle: (m.porte === 'g' ? -1 : 1) * (m.angle ?? 1.75) };
  if ('couvercle' in m) return { kind: 'pivot', px: f.wx(0, m.hz), py: f.y + m.couvercle, pz: f.wz(0, m.hz), ax: f.c, ay: 0, az: -f.s, angle: -1.9 };
  return { kind: 'efface' };
}

function pbox(c: Ctx, w: number, h: number, d: number, lx: number, ly: number, lz: number, color: number, m: LocalMotion | null, pat = 0): number {
  return c.parts.box(w, h, d, c.f.wx(lx, lz), c.f.y + ly, c.f.wz(lx, lz), color, { ry: c.f.ry, pat, motion: motionOf(c, m) });
}

/** Tiroir : caisson glissant + bouton ; renvoie les deux pièces. */
function drawer(c: Ctx, w: number, h: number, depth: number, lx: number, ly: number, frontZ: number, color: number, pull = 0.32): number[] {
  const m = { glisse: Math.min(pull, depth * 0.75) };
  const body = pbox(c, w, h, depth, lx, ly, frontZ - depth / 2 + 0.012, color, m);
  const knob = pbox(c, Math.min(0.12, w * 0.3), 0.04, 0.04, lx, ly, frontZ + 0.03, KNOB, m);
  return [body, knob];
}

/** Porte de meuble à charnière (côté 'g' ou 'd'). */
function door(c: Ctx, w: number, h: number, lx: number, ly: number, frontZ: number, color: number, side: 'g' | 'd', pat = 0): number[] {
  const hx = side === 'g' ? lx - w / 2 : lx + w / 2;
  const m: LocalMotion = { porte: side, hx, hz: frontZ };
  const panel = pbox(c, w - 0.01, h, 0.035, lx, ly, frontZ + 0.018, color, m, pat);
  const kx = side === 'g' ? lx + w / 2 - 0.07 : lx - w / 2 + 0.07;
  const knob = pbox(c, 0.035, Math.min(0.12, h * 0.3), 0.04, kx, ly, frontZ + 0.05, KNOB, m);
  return [panel, knob];
}

/** Couvercle à charnière arrière. */
function lid(c: Ctx, w: number, d: number, topY: number, color: number, thick = 0.08, pat = 0): number[] {
  return [pbox(c, w, thick, d, 0, topY + thick / 2, 0, color, { couvercle: topY, hz: -d / 2 }, pat)];
}

const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng.next() * arr.length)];

// ---------------------------------------------------------------- meubles

type Builder = (c: Ctx) => FurnSpec;

const BUILDERS: Record<FurnitureKind, Builder> = {
  commode: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, WOOD.noyer, ...PAINT.slice(0, 2)]);
    const w = 1.2, h = 0.88, d = 0.5;
    sbox(c, w, h - 0.04, d, 0, (h - 0.04) / 2, 0, col, { grad: 0.15 });
    sbox(c, w + 0.06, 0.04, d + 0.04, 0, h - 0.02, 0, shade(col, 1.12));
    sbox(c, w + 0.02, 0.06, d + 0.02, 0, 0.03, 0, shade(col, 0.7));
    const names = ['Tiroir du haut', 'Tiroir du milieu', 'Tiroir du bas'];
    const comps = names.map((name, i) => ({ name, parts: drawer(c, w - 0.1, 0.22, d - 0.06, 0, h - 0.2 - i * 0.25, d / 2, shade(col, 1.08)), size: 0.5, theme: 'linge' as Theme }));
    decorOnTop(c, h, w, d);
    return { name: 'Commode', w, d, comps, cover: true };
  },
  chevet: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, WOOD.clair]);
    const w = 0.46, h = 0.55, d = 0.4;
    sbox(c, w, h - 0.03, d, 0, (h - 0.03) / 2, 0, col);
    sbox(c, w + 0.04, 0.03, d + 0.03, 0, h - 0.015, 0, shade(col, 1.15));
    sbox(c, w - 0.06, 0.2, 0.02, 0, 0.17, d / 2 - 0.01, shade(col, 0.55));
    const comps = [{ name: 'Tiroir', parts: drawer(c, w - 0.08, 0.14, d - 0.06, 0, h - 0.12, d / 2, shade(col, 1.1), 0.22), size: 0.5, theme: 'lit' as Theme }];
    if (c.rng.chance(0.6)) {
      // petite lampe de chevet
      scyl(c, 0.05, 0.07, 0.16, 0.08, h + 0.08, -0.04, 0x8a7a6a, { seg: 6 });
      scyl(c, 0.09, 0.12, 0.12, 0.08, h + 0.21, -0.04, 0xe8d8a8, { seg: 6 });
    }
    return { name: 'Table de chevet', w, d, comps };
  },
  bureau: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, WOOD.noyer, METAL.gris, METAL.olive]);
    const w = 1.4, h = 0.76, d = 0.7;
    sbox(c, w, 0.05, d, 0, h - 0.025, 0, shade(col, 1.12));
    // caisson à tiroirs (gauche) et pieds (droite)
    sbox(c, 0.44, h - 0.05, d - 0.04, -w / 2 + 0.24, (h - 0.05) / 2, 0, col);
    sbox(c, 0.05, h - 0.05, d - 0.08, w / 2 - 0.05, (h - 0.05) / 2, 0, col);
    sbox(c, w - 0.5, 0.35, 0.03, 0.2, h - 0.25, -d / 2 + 0.04, shade(col, 0.85));
    const comps: CompDef[] = [];
    comps.push({ name: 'Tiroir central', parts: drawer(c, 0.5, 0.07, d - 0.12, 0.25, h - 0.1, d / 2 - 0.02, shade(col, 1.05), 0.25), size: 0.4, theme: 'papiers' });
    ['Tiroir du haut', 'Tiroir du milieu', 'Tiroir du bas'].forEach((name, i) => {
      comps.push({ name, parts: drawer(c, 0.38, 0.19, d - 0.1, -w / 2 + 0.24, h - 0.17 - i * 0.215, d / 2 - 0.02, shade(col, 1.08)), size: 0.5, theme: 'papiers' });
    });
    // papiers, lampe, tasse
    sbox(c, 0.3, 0.015, 0.22, 0.25, h + 0.008, 0.05, 0xe8e0c8, { ry: c.rng.range(-0.3, 0.3) });
    if (c.rng.chance(0.5)) {
      sbox(c, 0.04, 0.3, 0.04, w / 2 - 0.2, h + 0.15, -d / 2 + 0.15, 0x3a3a3a);
      sbox(c, 0.18, 0.08, 0.12, w / 2 - 0.25, h + 0.3, -d / 2 + 0.2, 0x4a6a4a);
    }
    return { name: 'Bureau', w, d, comps, cover: true };
  },
  buffet: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, WOOD.noyer, PAINT[0], PAINT[1]]);
    const w = 1.6, h = 0.92, d = 0.5;
    sbox(c, w, h - 0.04, d, 0, (h - 0.04) / 2, 0, col, { grad: 0.12 });
    sbox(c, w + 0.06, 0.04, d + 0.04, 0, h - 0.02, 0, shade(col, 1.12));
    const comps: CompDef[] = [
      { name: 'Tiroir de gauche', parts: drawer(c, w / 2 - 0.08, 0.16, d - 0.06, -w / 4, h - 0.16, d / 2, shade(col, 1.08)), size: 0.5, theme: 'cuisine' },
      { name: 'Tiroir de droite', parts: drawer(c, w / 2 - 0.08, 0.16, d - 0.06, w / 4, h - 0.16, d / 2, shade(col, 1.08)), size: 0.5, theme: 'cuisine' },
      { name: 'Placard', parts: [...door(c, w / 2 - 0.04, 0.56, -w / 4, 0.34, d / 2, shade(col, 1.04), 'g'), ...door(c, w / 2 - 0.04, 0.56, w / 4, 0.34, d / 2, shade(col, 1.04), 'd')], size: 1, theme: 'cuisine' },
    ];
    decorOnTop(c, h, w, d);
    return { name: 'Buffet', w, d, comps, cover: true };
  },
  armoire: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, WOOD.noyer, PAINT[0], PAINT[3]]);
    const w = 1.04, h = 2.0, d = 0.56;
    sbox(c, w, h, d, 0, h / 2, 0, col, { grad: 0.15 });
    sbox(c, w + 0.08, 0.08, d + 0.06, 0, h + 0.03, 0, shade(col, 0.8));
    const comps: CompDef[] = [
      { name: 'Penderie', parts: [...door(c, w / 2 - 0.03, 1.5, -w / 4, 1.18, d / 2, shade(col, 1.06), 'g', PAT.lames), ...door(c, w / 2 - 0.03, 1.5, w / 4, 1.18, d / 2, shade(col, 1.06), 'd', PAT.lames)], size: 1.6, theme: 'linge' },
      { name: 'Tiroir du bas', parts: drawer(c, w - 0.1, 0.22, d - 0.08, 0, 0.2, d / 2, shade(col, 1.1)), size: 0.6, theme: 'linge' },
    ];
    return { name: 'Armoire', w, d, comps, cover: true };
  },
  classeur: (c) => {
    const col = pick(c.rng, [METAL.gris, METAL.olive, METAL.clair, METAL.vert]);
    const w = 0.48, h = 1.32, d = 0.62;
    sbox(c, w, h, d, 0, h / 2, 0, col);
    const comps: CompDef[] = ['Premier tiroir', 'Deuxième tiroir', 'Troisième tiroir', 'Dernier tiroir'].map((name, i) => ({
      name, parts: drawer(c, w - 0.06, 0.28, d - 0.06, 0, h - 0.18 - i * 0.31, d / 2, shade(col, 1.1), 0.42), size: 0.5, theme: 'papiers' as Theme,
    }));
    return { name: 'Classeur', w, d, comps, cover: true };
  },
  casier: (c) => {
    const col = pick(c.rng, [METAL.gris, METAL.olive, METAL.vert, 0x5a6a7a]);
    const w = 0.5, h = 1.9, d = 0.5;
    sbox(c, w, h, d, 0, h / 2, 0, shade(col, 0.85));
    const comps: CompDef[] = [{ name: 'Casier', parts: door(c, w - 0.04, h - 0.06, 0, h / 2, d / 2, col, 'g', PAT.tole), size: 1, theme: 'militaire' }];
    return { name: 'Casier', w, d, comps };
  },
  frigo: (c) => {
    const col = pick(c.rng, [0xe0dcd0, 0xd8d4c4, 0xc8d0c8, 0xd8c8a0]);
    const w = 0.74, h = 1.8, d = 0.7;
    sbox(c, w, h, d - 0.04, 0, h / 2, -0.02, shade(col, 0.88));
    const comps: CompDef[] = [
      { name: 'Congélateur', parts: door(c, w - 0.02, 0.48, 0, h - 0.27, d / 2 - 0.04, col, 'd'), size: 0.7, theme: 'frigo' },
      { name: 'Réfrigérateur', parts: door(c, w - 0.02, 1.22, 0, 0.66, d / 2 - 0.04, col, 'd'), size: 1.2, theme: 'frigo' },
    ];
    return { name: 'Réfrigérateur', w, d, comps, cover: true };
  },
  etabli: (c) => {
    const w = 1.8, h = 0.9, d = 0.72;
    sbox(c, w, 0.08, d, 0, h - 0.04, 0, WOOD.clair, { pat: PAT.platelage });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sbox(c, 0.08, h - 0.08, 0.08, sx * (w / 2 - 0.06), (h - 0.08) / 2, sz * (d / 2 - 0.06), WOOD.fonce);
    sbox(c, w - 0.1, 0.04, d - 0.1, 0, 0.18, 0, WOOD.moyen);
    // étau, outils, caisses sur l'étagère basse
    sbox(c, 0.16, 0.14, 0.2, w / 2 - 0.2, h + 0.07, d / 2 - 0.1, METAL.fonce);
    for (let i = 0; i < 3; i++) sbox(c, 0.3, 0.2, 0.3, -0.5 + i * 0.4, 0.3, 0, pick(c.rng, [0x8a6a42, METAL.rouge, METAL.gris]));
    const comps: CompDef[] = [
      { name: 'Tiroir de gauche', parts: drawer(c, 0.55, 0.12, d - 0.12, -0.45, h - 0.16, d / 2 - 0.04, WOOD.moyen), size: 0.6, theme: 'outils' },
      { name: 'Tiroir de droite', parts: drawer(c, 0.55, 0.12, d - 0.12, 0.25, h - 0.16, d / 2 - 0.04, WOOD.moyen), size: 0.6, theme: 'outils' },
    ];
    return { name: 'Établi', w, d, comps, cover: true };
  },
  caisse_outils: (c) => {
    const w = 0.6, h = 0.3, d = 0.32;
    sbox(c, w, h, d, 0, h / 2, 0, METAL.rouge);
    sbox(c, 0.3, 0.04, 0.04, 0, h + 0.11, 0, METAL.fonce);
    return { name: 'Caisse à outils', w, d, comps: [{ name: 'Caisse à outils', parts: lid(c, w + 0.02, d + 0.02, h, shade(METAL.rouge, 1.1), 0.05), size: 0.8, theme: 'outils' }], blocks: false };
  },
  coffre_fort: (c) => {
    const w = 0.62, h = 0.78, d = 0.62;
    sbox(c, w, h, d, 0, h / 2, 0, 0x3a3e42);
    const parts = door(c, w - 0.08, h - 0.08, 0, h / 2, d / 2, 0x4a4e54, 'g');
    // cadran
    parts.push(c.parts.box(0.12, 0.12, 0.04, c.f.wx(0.06, d / 2 + 0.06), c.f.y + h / 2 + 0.05, c.f.wz(0.06, d / 2 + 0.06), BRASS, { ry: c.f.ry, motion: motionOf(c, { porte: 'g', hx: -w / 2 + 0.04, hz: d / 2 }) }));
    return { name: 'Coffre-fort', w, d, comps: [{ name: 'Coffre-fort', parts, size: 1.2, theme: 'coffre' }], cover: true };
  },
  comptoir: (c) => {
    const col = pick(c.rng, [WOOD.fonce, WOOD.noyer, WOOD.moyen]);
    const w = 2.4, h = 1.02, d = 0.62;
    sbox(c, w, h - 0.05, d, 0, (h - 0.05) / 2, 0, col, { pat: PAT.lames });
    sbox(c, w + 0.08, 0.05, d + 0.08, 0, h - 0.025, 0, shade(col, 1.2));
    // caisse enregistreuse posée côté façade
    sbox(c, 0.42, 0.2, 0.34, 0.6, h + 0.1, 0.05, 0x5a5e62);
    sbox(c, 0.36, 0.12, 0.08, 0.6, h + 0.26, -0.08, 0x2a2e30, { rx: -0.6 });
    const comps: CompDef[] = [
      { name: 'Tiroir-caisse', parts: drawer(c, 0.36, 0.08, 0.3, 0.6, h + 0.05, 0.05 + 0.17, 0x6a6e72, 0.22), size: 0.5, theme: 'argent' },
      { name: 'Sous le comptoir', parts: [...door(c, 0.7, 0.7, -0.6, 0.42, d / 2, shade(col, 1.06), 'g'), ...door(c, 0.7, 0.7, 0.2, 0.42, d / 2, shade(col, 1.06), 'd')], size: 1.2, theme: 'marchandise' },
    ];
    return { name: 'Comptoir', w, d, comps, cover: true };
  },
  pharmacie: (c) => {
    const w = 0.72, h = 0.84, d = 0.26, y0 = 1.15;
    sbox(c, w, h, d, 0, y0 + h / 2, 0, 0xe8e8e0);
    const parts = door(c, w - 0.04, h - 0.04, 0, y0 + h / 2, d / 2, 0xf2f2ea, 'g');
    parts.push(pbox(c, 0.3, 0.08, 0.02, 0, y0 + h / 2 + 0.1, d / 2 + 0.04, 0xc03030, { porte: 'g', hx: -w / 2 + 0.02, hz: d / 2 }));
    parts.push(pbox(c, 0.08, 0.3, 0.02, 0, y0 + h / 2 + 0.1, d / 2 + 0.04, 0xc03030, { porte: 'g', hx: -w / 2 + 0.02, hz: d / 2 }));
    return { name: 'Armoire à pharmacie', w, d, comps: [{ name: 'Armoire à pharmacie', parts, size: 1, theme: 'pharmacie' }], blocks: false };
  },
  placard_haut: (c) => {
    const col = pick(c.rng, [0xe0dcd0, PAINT[0], PAINT[1], WOOD.clair]);
    const w = 1.2, h = 0.62, d = 0.34, y0 = 1.5;
    sbox(c, w, h, d, 0, y0 + h / 2, 0, shade(col, 0.9));
    const parts = [...door(c, w / 2 - 0.02, h - 0.04, -w / 4, y0 + h / 2, d / 2, col, 'g'), ...door(c, w / 2 - 0.02, h - 0.04, w / 4, y0 + h / 2, d / 2, col, 'd')];
    return { name: 'Placard', w, d, comps: [{ name: 'Placard haut', parts, size: 0.8, theme: 'cuisine' }], blocks: false };
  },
  cuisine: (c) => {
    // linéaire de cuisine : 3 modules (évier, tiroirs + porte, four) et placards hauts
    const col = pick(c.rng, [0xe0dcd0, PAINT[0], PAINT[1], PAINT[2], WOOD.clair]);
    const w = 2.4, h = 0.9, d = 0.62;
    sbox(c, w, h - 0.04, d - 0.02, 0, (h - 0.04) / 2, -0.01, shade(col, 0.88));
    sbox(c, w + 0.04, 0.05, d + 0.03, 0, h - 0.02, 0, 0x8a8478, { pat: PAT.carrelage });
    // évier et robinet
    sbox(c, 0.5, 0.02, 0.36, -0.8, h + 0.005, 0, 0x9aa4a8);
    sbox(c, 0.04, 0.22, 0.04, -0.8, h + 0.11, -0.22, 0xb0b4b6);
    // plaques
    for (const [dx, dz] of [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.12], [0.12, 0.12]]) scyl(c, 0.08, 0.08, 0.02, 0.8 + dx, h + 0.01, dz, 0x2a2a2c, { seg: 8 });
    // crédence
    sbox(c, w, 0.6, 0.03, 0, h + 0.3, -d / 2 + 0.015, 0xd8d8d0, { pat: PAT.carrelage });
    const comps: CompDef[] = [
      { name: 'Sous l\'évier', parts: [...door(c, 0.36, 0.66, -0.98, 0.4, d / 2, col, 'g'), ...door(c, 0.36, 0.66, -0.62, 0.4, d / 2, col, 'd')], size: 1, theme: 'ordures' },
      { name: 'Tiroir à couverts', parts: drawer(c, 0.74, 0.14, d - 0.1, 0, h - 0.13, d / 2, col), size: 0.5, theme: 'cuisine' },
      { name: 'Placard bas', parts: door(c, 0.74, 0.5, 0, 0.32, d / 2, col, 'g'), size: 1, theme: 'cuisine' },
      { name: 'Four', parts: door4(c, 0.74, 0.46, 0.8, 0.36, d / 2), size: 0.7, theme: 'cuisine' },
    ];
    // placards hauts
    const yh = 1.55;
    sbox(c, w, 0.66, 0.34, 0, yh + 0.33, -d / 2 + 0.17, shade(col, 0.9));
    comps.push({ name: 'Placard haut', parts: [...door(c, 0.78, 0.62, -0.8, yh + 0.33, -d / 2 + 0.34, col, 'g'), ...door(c, 0.78, 0.62, 0, yh + 0.33, -d / 2 + 0.34, col, 'd')], size: 0.9, theme: 'cuisine' });
    return { name: 'Cuisine', w, d, comps, cover: true };
  },
  lit: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, 0x6a6e72]);
    const sheet = pick(c.rng, [0xb8b0a0, 0x8a9ab0, 0xb08a7a, 0x8aa08a, 0xc8b890]);
    const w = 1.0, d = 2.0;
    sbox(c, w, 0.32, d, 0, 0.16, 0, col);
    sbox(c, w + 0.04, 0.7, 0.06, 0, 0.35, -d / 2 + 0.03, shade(col, 0.9));
    sbox(c, w - 0.06, 0.16, d - 0.1, 0, 0.4, 0.02, 0xe0dccc);
    sbox(c, w - 0.02, 0.06, d * 0.62, 0, 0.5, d * 0.17, sheet, { vary: 0.04 });
    sbox(c, w * 0.7, 0.1, 0.3, 0, 0.53, -d / 2 + 0.28, 0xf0ece0);
    const comps: CompDef[] = [
      { name: 'Sous le matelas', parts: [], size: 0.3, theme: 'lit' },
      { name: 'Tiroir sous le lit', parts: drawer(c, w - 0.16, 0.14, d * 0.45, 0, 0.12, d / 2, shade(col, 1.1), 0.5), size: 0.6, theme: 'linge' },
    ];
    return { name: 'Lit', w, d, comps };
  },
  lit_double: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce, WOOD.noyer]);
    const sheet = pick(c.rng, [0xb8a080, 0x8a9ab0, 0xb08a7a, 0xa0a890]);
    const w = 1.6, d = 2.05;
    sbox(c, w, 0.34, d, 0, 0.17, 0, col);
    sbox(c, w + 0.06, 0.95, 0.08, 0, 0.47, -d / 2 + 0.04, shade(col, 0.85));
    sbox(c, w - 0.06, 0.16, d - 0.1, 0, 0.42, 0.02, 0xe0dccc);
    sbox(c, w - 0.02, 0.07, d * 0.6, 0, 0.52, d * 0.18, sheet, { vary: 0.04 });
    for (const sx of [-0.38, 0.38]) sbox(c, 0.6, 0.11, 0.3, sx, 0.55, -d / 2 + 0.3, 0xf0ece0);
    return { name: 'Lit', w, d, comps: [{ name: 'Sous le matelas', parts: [], size: 0.4, theme: 'lit' }] };
  },
  lits_superposes: (c) => {
    const w = 0.95, d = 2.0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sbox(c, 0.06, 1.75, 0.06, sx * (w / 2 - 0.03), 0.875, sz * (d / 2 - 0.03), METAL.olive);
    for (const y of [0.3, 1.3]) {
      sbox(c, w, 0.06, d, 0, y, 0, METAL.olive);
      sbox(c, w - 0.08, 0.12, d - 0.1, 0, y + 0.09, 0, 0x8a8a6a);
      sbox(c, w - 0.06, 0.05, d * 0.6, 0, y + 0.17, d * 0.17, 0x5a6248);
    }
    return { name: 'Lits superposés', w, d, comps: [{ name: 'Sous le matelas', parts: [], size: 0.3, theme: 'lit' }] };
  },
  caisse: (c) => {
    const col = pick(c.rng, [0x8a6a42, 0x7a5a38, 0x9a7a4a]);
    const w = 1.0, h = 0.7, d = 0.7;
    sbox(c, w, h, d, 0, h / 2, 0, col, { vary: 0.06, pat: PAT.planches });
    sbox(c, w + 0.04, 0.08, d + 0.04, 0, 0.12, 0, shade(col, 0.7));
    return { name: 'Caisse', w, d, comps: [{ name: 'Caisse', parts: lid(c, w + 0.04, d + 0.04, h, shade(col, 0.92), 0.08, PAT.planches), size: 1.4, theme: 'marchandise' }], cover: true };
  },
  coffre: (c) => {
    const w = 1.0, h = 0.55, d = 0.64;
    sbox(c, w, h, d, 0, h / 2, 0, 0x5a3a22, { pat: PAT.planches });
    sbox(c, w + 0.04, 0.06, d + 0.04, 0, h - 0.1, 0, BRASS);
    return { name: 'Coffre', w, d, comps: [{ name: 'Coffre', parts: lid(c, w + 0.02, d + 0.02, h, 0x6a4a2a, 0.18), size: 1.4, theme: 'coffre' }], cover: true };
  },
  tonneau: (c) => {
    scyl(c, 0.38, 0.38, 1.0, 0, 0.5, 0, 0x6a4a2a, { seg: 9 });
    for (const y of [0.18, 0.82]) scyl(c, 0.4, 0.4, 0.05, 0, y, 0, 0x3a3a3a, { seg: 9 });
    return { name: 'Tonneau', w: 0.8, d: 0.8, comps: [{ name: 'Tonneau', parts: lid(c, 0.62, 0.62, 1.0, 0x5a3a20, 0.05), size: 1.2, theme: 'marchandise' }] };
  },
  etagere: (c) => {
    const col = pick(c.rng, [WOOD.moyen, METAL.gris, WOOD.fonce]);
    const w = 1.6, h = 1.9, d = 0.45;
    for (const sx of [-1, 1]) sbox(c, 0.05, h, d, sx * (w / 2 - 0.025), h / 2, 0, col);
    for (let i = 0; i < 4; i++) sbox(c, w, 0.04, d, 0, 0.1 + i * 0.58, 0, shade(col, 1.08));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      if (c.rng.chance(0.3)) continue;
      const s = 0.18 + c.rng.next() * 0.12;
      sbox(c, s * 1.2, s, s, -0.55 + j * 0.37, 0.12 + i * 0.58 + s / 2, 0.02, pick(c.rng, [0xb08040, 0x6a8aa0, 0xa04030, 0x8a8a6a, 0xd8c8a0]), { vary: 0.1 });
    }
    return { name: 'Étagère', w, d, comps: [{ name: 'Étagères', parts: [], size: 1.2, theme: 'marchandise' }], cover: true };
  },
  cadavre: (c) => {
    sbox(c, 0.5, 0.25, 1.6, 0, 0.13, 0, 0x5a4a3a, { ry: 0.3 });
    sbox(c, 0.3, 0.25, 0.3, 0.2, 0.15, 0.9, 0xc68e62, { ry: 0.3 });
    return { name: 'Cadavre', w: 0.6, d: 1.6, comps: [{ name: 'Poches', parts: [], size: 0.8, theme: 'cadavre' }], blocks: false };
  },
  sac: (c) => {
    c.g.sphere(0.4, c.f.x, c.f.y + 0.3, c.f.z, 0x6a5a3a, { sy: 0.8 });
    return { name: 'Sac', w: 0.8, d: 0.8, comps: [{ name: 'Sac', parts: [], size: 0.8, theme: 'divers' }], blocks: false };
  },
  poubelle: (c) => {
    const col = pick(c.rng, [0x4a6a4a, 0x5a5e62, 0x3a4a5a]);
    const w = 0.55, h = 0.85, d = 0.55;
    sbox(c, w, h, d, 0, h / 2, 0, col, { pat: PAT.tole });
    return { name: 'Poubelle', w, d, comps: [{ name: 'Poubelle', parts: lid(c, w + 0.04, d + 0.04, h, shade(col, 1.1), 0.05), size: 0.8, theme: 'ordures' }] };
  },
  lavabo: (c) => {
    const w = 0.8, h = 0.84, d = 0.48;
    sbox(c, w, h - 0.06, d, 0, (h - 0.06) / 2, 0, 0xd8d4c8);
    sbox(c, w + 0.04, 0.06, d + 0.03, 0, h - 0.03, 0, 0xf0f0ea);
    sbox(c, 0.44, 0.02, 0.3, 0, h + 0.005, 0.02, 0xc8d8e0);
    sbox(c, 0.04, 0.18, 0.04, 0, h + 0.09, -d / 2 + 0.06, 0xb0b4b6);
    const parts = [...door(c, w / 2 - 0.03, 0.6, -w / 4, 0.38, d / 2, 0xe8e4d8, 'g'), ...door(c, w / 2 - 0.03, 0.6, w / 4, 0.38, d / 2, 0xe8e4d8, 'd')];
    return { name: 'Lavabo', w, d, comps: [{ name: 'Sous le lavabo', parts, size: 0.8, theme: 'toilette' }] };
  },
  armoire_glace: (c) => {
    const w = 0.6, h = 0.7, d = 0.16, y0 = 1.3;
    sbox(c, w, h, d, 0, y0 + h / 2, 0, 0xe0dcd0);
    const m: LocalMotion = { porte: 'd', hx: w / 2, hz: d / 2 };
    const parts = [pbox(c, w - 0.04, h - 0.04, 0.03, 0, y0 + h / 2, d / 2 + 0.015, 0xa8c0cc, m, PAT.vitre)];
    return { name: 'Armoire à glace', w, d, comps: [{ name: 'Armoire à glace', parts, size: 0.6, theme: 'pharmacie' }], blocks: false };
  },
  meuble_tv: (c) => {
    const col = pick(c.rng, [WOOD.fonce, WOOD.noyer, 0x3a3a3e]);
    const w = 1.2, h = 0.5, d = 0.46;
    sbox(c, w, h, d, 0, h / 2, 0, col);
    const comps: CompDef[] = [
      { name: 'Tiroir de gauche', parts: drawer(c, w / 2 - 0.06, 0.16, d - 0.06, -w / 4, 0.32, d / 2, shade(col, 1.15)), size: 0.5, theme: 'divers' },
      { name: 'Tiroir de droite', parts: drawer(c, w / 2 - 0.06, 0.16, d - 0.06, w / 4, 0.32, d / 2, shade(col, 1.15)), size: 0.5, theme: 'divers' },
    ];
    const dev = tvSet(c, h);
    return { name: 'Télévision', w, d, comps, device: dev, cover: true };
  },
  paillasse: (c) => {
    const w = 2.0, h = 0.92, d = 0.72;
    sbox(c, w, h - 0.05, d - 0.02, 0, (h - 0.05) / 2, -0.01, 0xd8d8d0);
    sbox(c, w + 0.04, 0.05, d + 0.03, 0, h - 0.025, 0, 0x2a2e30);
    // verrerie
    for (let i = 0; i < 4; i++) scyl(c, 0.05, 0.07, 0.18, -0.7 + i * 0.25, h + 0.09, 0.05, i % 2 ? 0x8ad0c0 : 0xd0e0e8, { seg: 6 });
    sbox(c, 0.4, 0.3, 0.3, 0.6, h + 0.15, -0.1, 0x5a6066);
    const comps: CompDef[] = [
      { name: 'Tiroir de gauche', parts: drawer(c, 0.55, 0.14, d - 0.1, -0.6, h - 0.15, d / 2, 0xe8e8e0), size: 0.5, theme: 'labo' },
      { name: 'Tiroir de droite', parts: drawer(c, 0.55, 0.14, d - 0.1, 0.0, h - 0.15, d / 2, 0xe8e8e0), size: 0.5, theme: 'labo' },
      { name: 'Placard', parts: door(c, 0.55, 0.62, 0.65, 0.38, d / 2, 0xe8e8e0, 'g'), size: 1, theme: 'labo' },
    ];
    return { name: 'Paillasse', w, d, comps, cover: true };
  },
  vitrine: (c) => {
    const w = 1.4, d = 0.6;
    sbox(c, w, 0.5, d, 0, 0.25, 0, WOOD.fonce);
    c.g.layer('glass');
    sbox(c, w - 0.04, 0.48, d - 0.04, 0, 0.74, 0, 0xa8d0d8);
    c.g.layer('base');
    for (let i = 0; i < 4; i++) sbox(c, 0.14, 0.08, 0.14, -0.45 + i * 0.3, 0.55, 0, pick(c.rng, [BRASS, 0xc0c0c8, 0x8a4a8a, 0x4a8aa0]));
    const parts = door(c, w - 0.06, 0.4, 0, 0.25, d / 2, shade(WOOD.fonce, 1.1), 'g');
    return { name: 'Vitrine', w, d, comps: [{ name: 'Vitrine', parts, size: 1, theme: 'argent' }], cover: true };
  },
  lit_hopital: (c) => {
    const w = 1.0, d = 2.0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sbox(c, 0.05, 0.6, 0.05, sx * (w / 2 - 0.04), 0.3, sz * (d / 2 - 0.04), 0xc8ccd0);
    sbox(c, w, 0.08, d, 0, 0.5, 0, 0xc8ccd0);
    sbox(c, w - 0.06, 0.14, d - 0.1, 0, 0.61, 0, 0xf0f0f0);
    sbox(c, w - 0.04, 0.05, d * 0.6, 0, 0.7, d * 0.17, 0xa8c0d0);
    sbox(c, w, 0.6, 0.05, 0, 0.8, -d / 2 + 0.02, 0xc8ccd0);
    return { name: 'Lit d\'hôpital', w, d, comps: [{ name: 'Sous le matelas', parts: [], size: 0.3, theme: 'lit' }] };
  },
  conteneur: (c) => {
    // conteneur maritime : tôle ondulée, double porte côté +z
    const col = pick(c.rng, [0x8a3a2a, 0x3a5a7a, 0x4e6a3a, 0xa8762a, 0x6a6e72]);
    const w = 2.44, h = 2.6, d = 6.0;
    sbox(c, w, h, d, 0, h / 2, 0, col, { pat: PAT.tole, grad: 0.15 });
    sbox(c, w + 0.04, 0.12, d + 0.04, 0, h - 0.06, 0, shade(col, 0.75));
    const parts = [...door(c, w / 2 - 0.03, h - 0.2, -w / 4, h / 2, d / 2, shade(col, 1.08), 'g', PAT.tole), ...door(c, w / 2 - 0.03, h - 0.2, w / 4, h / 2, d / 2, shade(col, 1.08), 'd', PAT.tole)];
    return { name: 'Conteneur', w, d, comps: [{ name: 'Conteneur', parts, size: 2.2, theme: 'marchandise' }], cover: true };
  },

  // ------------------------------------------------------------- décor
  canape: (c) => {
    const col = pick(c.rng, [0x7a3a2e, 0x4a5a3a, 0x3a4a6a, 0x8a6a4a, 0x6a4a5a]);
    const w = 1.9, d = 0.85;
    sbox(c, w, 0.42, d, 0, 0.21, 0, col);
    sbox(c, w, 0.5, 0.22, 0, 0.55, -d / 2 + 0.11, shade(col, 0.9));
    for (const sx of [-1, 1]) sbox(c, 0.2, 0.55, d, sx * (w / 2 - 0.1), 0.32, 0, shade(col, 0.95));
    for (const sx of [-0.42, 0.42]) sbox(c, 0.76, 0.1, d - 0.25, sx, 0.47, 0.1, shade(col, 1.12));
    return { name: 'Canapé', w, d, comps: [{ name: 'Entre les coussins', parts: [], size: 0.25, theme: 'lit' }] };
  },
  fauteuil: (c) => {
    const col = pick(c.rng, [0x7a3a2e, 0x4a5a3a, 0x3a4a6a, 0x8a6a4a]);
    sbox(c, 0.8, 0.42, 0.8, 0, 0.21, 0, col);
    sbox(c, 0.8, 0.55, 0.2, 0, 0.6, -0.3, shade(col, 0.9));
    for (const sx of [-1, 1]) sbox(c, 0.16, 0.6, 0.8, sx * 0.32, 0.32, 0, shade(col, 0.95));
    return { name: 'Fauteuil', w: 0.8, d: 0.8, comps: [] };
  },
  table: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.clair, WOOD.fonce]);
    const w = 1.6, d = 0.9;
    sbox(c, w, 0.06, d, 0, 0.76, 0, shade(col, 1.08));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sbox(c, 0.07, 0.73, 0.07, sx * (w / 2 - 0.08), 0.365, sz * (d / 2 - 0.08), col);
    for (const [sx, sz, r] of [[-0.45, 0.62, 0], [0.45, 0.62, 0], [-0.45, -0.62, Math.PI], [0.45, -0.62, Math.PI]] as const) if (c.rng.chance(0.75)) chairAt(c, sx, sz, r + c.rng.range(-0.25, 0.25), col);
    if (c.rng.chance(0.5)) sbox(c, 0.28, 0.02, 0.2, c.rng.range(-0.4, 0.4), 0.8, 0, 0xe0d8c0, { ry: c.rng.next() });
    return { name: 'Table', w, d, comps: [], blocks: true };
  },
  table_ronde: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce]);
    scyl(c, 0.5, 0.5, 0.05, 0, 0.75, 0, shade(col, 1.08), { seg: 10 });
    scyl(c, 0.06, 0.08, 0.72, 0, 0.36, 0, col, { seg: 6 });
    scyl(c, 0.25, 0.28, 0.04, 0, 0.02, 0, col, { seg: 8 });
    for (let i = 0; i < 3; i++) if (c.rng.chance(0.7)) {
      const a = i * 2.1 + 0.3;
      chairAt(c, Math.sin(a) * 0.72, Math.cos(a) * 0.72, a + Math.PI, col);
    }
    return { name: 'Table', w: 1.0, d: 1.0, comps: [] };
  },
  chaise: (c) => {
    chairAt(c, 0, 0, 0, pick(c.rng, [WOOD.moyen, WOOD.fonce]));
    return { name: 'Chaise', w: 0.45, d: 0.45, comps: [], blocks: false };
  },
  baignoire: (c) => {
    const w = 0.8, d = 1.7;
    sbox(c, w, 0.55, d, 0, 0.275, 0, 0xf0f0ea);
    sbox(c, w - 0.14, 0.02, d - 0.14, 0, 0.555, 0, 0xb8c8d0);
    sbox(c, 0.06, 0.2, 0.06, 0, 0.65, -d / 2 + 0.08, 0xb0b4b6);
    return { name: 'Baignoire', w, d, comps: [] };
  },
  toilettes: (c) => {
    sbox(c, 0.4, 0.42, 0.55, 0, 0.21, 0.08, 0xf0f0ea);
    sbox(c, 0.42, 0.04, 0.48, 0, 0.44, 0.1, 0xe8e8e0);
    sbox(c, 0.42, 0.36, 0.18, 0, 0.6, -0.18, 0xf0f0ea);
    return { name: 'Toilettes', w: 0.45, d: 0.6, comps: [{ name: 'Réservoir', parts: [], size: 0.25, theme: 'toilette' }] };
  },
  bibliotheque: (c) => {
    const col = pick(c.rng, [WOOD.fonce, WOOD.noyer, WOOD.moyen]);
    const w = 1.5, h = 2.0, d = 0.4;
    sbox(c, w, h, 0.04, 0, h / 2, -d / 2 + 0.02, shade(col, 0.8));
    for (const sx of [-1, 1]) sbox(c, 0.05, h, d, sx * (w / 2 - 0.025), h / 2, 0, col);
    for (let i = 0; i < 5; i++) sbox(c, w, 0.04, d, 0, 0.05 + i * 0.48, 0, col);
    const books = [0x8a2a2a, 0x2a4a8a, 0x3a6a3a, 0xc9a050, 0x6a4a8a, 0x8a6a3a, 0xd8c8a0];
    for (let i = 0; i < 4; i++) {
      let x = -w / 2 + 0.08;
      while (x < w / 2 - 0.12) {
        const bw = 0.05 + c.rng.next() * 0.06;
        const bh = 0.26 + c.rng.next() * 0.14;
        if (c.rng.chance(0.85)) sbox(c, bw, bh, 0.24, x + bw / 2, 0.07 + i * 0.48 + bh / 2, 0.02, pick(c.rng, books));
        x += bw + 0.008;
      }
    }
    return { name: 'Bibliothèque', w, d, comps: [{ name: 'Rayonnages', parts: [], size: 0.4, theme: 'livres' }], cover: true };
  },
  piano: (c) => {
    sbox(c, 1.5, 1.3, 0.6, 0, 0.65, 0, 0x2b1a12);
    sbox(c, 1.4, 0.06, 0.3, 0, 0.75, 0.4, 0xf0f0e8);
    sbox(c, 0.8, 0.45, 0.35, 0, 0.22, 0.95, WOOD.fonce);
    return { name: 'Piano', w: 1.5, d: 0.7, comps: [] };
  },
  tapis: (c) => {
    const col = pick(c.rng, [0x8a2e2e, 0x2e4a6a, 0x6a5a2e, 0x5a2e4a]);
    sbox(c, 2.2, 0.02, 1.4, 0, 0.012, 0, col);
    sbox(c, 1.8, 0.022, 1.0, 0, 0.014, 0, 0xc9a050);
    sbox(c, 1.4, 0.024, 0.6, 0, 0.016, 0, shade(col, 1.2));
    return { name: 'Tapis', w: 2.2, d: 1.4, comps: [], blocks: false };
  },
  plante: (c) => {
    scyl(c, 0.22, 0.17, 0.36, 0, 0.18, 0, 0x8a4a2a, { seg: 8 });
    c.g.layer('foliage');
    c.g.dodeca(0.38, c.f.x, c.f.y + 0.68, c.f.z, 0x3c7a3c, { vary: 0.15 });
    c.g.dodeca(0.26, c.f.x + 0.15, c.f.y + 0.92, c.f.z - 0.08, 0x5a9a4a);
    c.g.layer('base');
    return { name: 'Plante', w: 0.5, d: 0.5, comps: [], blocks: false };
  },
  poele: (c) => {
    scyl(c, 0.32, 0.36, 0.85, 0, 0.42, 0, 0x2c2c2e, { seg: 8 });
    scyl(c, 0.07, 0.07, 1.6, 0, 1.6, -0.12, 0x2a2a2a, { seg: 6 });
    c.g.layer('glow');
    sbox(c, 0.24, 0.16, 0.04, 0, 0.4, 0.34, 0xff6a20);
    c.g.layer('base');
    return { name: 'Poêle', w: 0.8, d: 0.8, comps: [] };
  },
  cuisiniere: (c) => {
    sbox(c, 0.7, 0.88, 0.62, 0, 0.44, 0, 0xd8d4c8);
    for (const [dx, dz] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]]) scyl(c, 0.09, 0.09, 0.02, dx, 0.89, dz, 0x2a2a2c, { seg: 8 });
    return { name: 'Cuisinière', w: 0.7, d: 0.62, comps: [{ name: 'Four', parts: door4(c, 0.6, 0.45, 0, 0.36, 0.31), size: 0.6, theme: 'cuisine' }] };
  },
  banc: (c) => {
    const col = pick(c.rng, [WOOD.moyen, WOOD.fonce]);
    sbox(c, 1.8, 0.08, 0.42, 0, 0.45, 0, col, { pat: PAT.platelage });
    for (const sx of [-0.75, 0.75]) sbox(c, 0.08, 0.45, 0.4, sx, 0.22, 0, shade(col, 0.8));
    sbox(c, 1.8, 0.4, 0.06, 0, 0.75, -0.2, col);
    return { name: 'Banc', w: 1.8, d: 0.45, comps: [] };
  },
  serveur: (c) => {
    const w = 0.7, h = 2.0, d = 0.9;
    sbox(c, w, h, d, 0, h / 2, 0, 0x2a2e34);
    const screens: number[] = [];
    for (let i = 0; i < 9; i++) screens.push(pbox(c, 0.05, 0.03, 0.02, -0.2 + (i % 3) * 0.2, 0.4 + Math.floor(i / 3) * 0.5, d / 2 + 0.01, 0x101010, null, PAT.lumiere));
    return { name: 'Baie de serveurs', w, d, comps: [], device: { kind: 'ordinateur', screens, screenColor: 0x60ff90, needsPower: true }, cover: true };
  },
  palette: (c) => {
    sbox(c, 1.2, 0.14, 1.0, 0, 0.07, 0, 0x9a7a4a, { pat: PAT.platelage });
    for (let i = 0; i < 4; i++) sbox(c, 0.5, 0.25, 0.4, -0.28 + (i % 2) * 0.56, 0.27 + Math.floor(i / 2) * 0.25, 0, pick(c.rng, [0xc8b890, 0xb8a070, 0x8a8a6a]), { vary: 0.08 });
    return { name: 'Palette', w: 1.2, d: 1.0, comps: [{ name: 'Sacs', parts: [], size: 0.8, theme: 'marchandise' }], cover: true };
  },
  ratelier: (c) => {
    sbox(c, 1.4, 1.6, 0.3, 0, 0.8, 0, WOOD.fonce);
    for (let i = 0; i < 5; i++) sbox(c, 0.06, 1.1, 0.08, -0.5 + i * 0.25, 0.85, 0.18, 0x2a2a2e, { rz: 0.05 });
    return { name: 'Râtelier', w: 1.4, d: 0.35, comps: [{ name: 'Râtelier', parts: [], size: 0.8, theme: 'militaire' }] };
  },
  machine: (c) => {
    const col = pick(c.rng, [0x5a6a5a, 0x6a5a4a, 0x4a5a6a]);
    sbox(c, 1.6, 1.3, 1.1, 0, 0.65, 0, col, { grad: 0.2 });
    scyl(c, 0.3, 0.3, 0.6, 0.4, 1.45, 0, METAL.fonce, { seg: 8 });
    sbox(c, 0.4, 0.3, 0.05, -0.4, 0.95, 0.56, 0x2a2e30);
    return { name: 'Machine', w: 1.6, d: 1.1, comps: [], cover: true };
  },
  autel: (c) => {
    sbox(c, 2.2, 1.0, 1.0, 0, 0.5, 0, 0xd8d0b8, { pat: PAT.pierre });
    sbox(c, 2.3, 0.06, 1.1, 0, 1.03, 0, 0xe8e0c8);
    c.g.layer('glow');
    sbox(c, 0.08, 0.3, 0.08, -0.6, 1.2, 0, 0xffd070);
    sbox(c, 0.08, 0.3, 0.08, 0.6, 1.2, 0, 0xffd070);
    c.g.layer('base');
    return { name: 'Autel', w: 2.2, d: 1.0, comps: [{ name: 'Tronc des offrandes', parts: [], size: 0.4, theme: 'argent' }], cover: true };
  },
  prie_dieu: (c) => {
    sbox(c, 1.6, 0.45, 0.4, 0, 0.23, 0, WOOD.fonce);
    sbox(c, 1.6, 0.5, 0.06, 0, 0.7, -0.18, WOOD.fonce);
    return { name: 'Banc d\'église', w: 1.6, d: 0.45, comps: [] };
  },

  // ------------------------------------------------------------- appareils
  tv: (c) => ({ name: 'Télévision', w: 0.7, d: 0.5, comps: [], device: tvSet(c, 0), blocks: false }),
  radio: (c) => {
    const w = 0.5, h = 0.3, d = 0.22;
    sbox(c, w, h, d, 0, h / 2, 0, pick(c.rng, [WOOD.noyer, 0x8a6a4a, 0x3a3a3e]));
    sbox(c, 0.2, 0.18, 0.02, -0.12, h / 2, d / 2 + 0.01, 0x2a2420);
    const dial = pbox(c, 0.14, 0.06, 0.02, 0.12, h / 2 + 0.05, d / 2 + 0.012, 0x3a3020, null, PAT.lumiere);
    sbox(c, 0.03, 0.4, 0.03, w / 2 - 0.05, h + 0.2, -0.05, 0xb0b4b6, { rz: -0.4 });
    return { name: 'Radio', w, d, comps: [], device: { kind: 'radio', screens: [dial], screenColor: 0xffc860, needsPower: true }, blocks: false };
  },
  ordinateur: (c) => {
    // écran cathodique et clavier, à poser sur un bureau
    sbox(c, 0.44, 0.36, 0.4, 0, 0.18, -0.06, 0xd0c8b0);
    const screen = pbox(c, 0.34, 0.26, 0.02, 0, 0.19, 0.14 + 0.012, 0x101810, null, PAT.lumiere);
    sbox(c, 0.42, 0.03, 0.16, 0, 0.015, 0.28, 0xc8c0a8);
    return { name: 'Ordinateur', w: 0.5, d: 0.6, comps: [], device: { kind: 'ordinateur', screens: [screen], screenColor: 0x60ff90, needsPower: true, light: { lx: 0, ly: 0.3, lz: 0.5, color: 0x80ffa0, intensity: 0.9, distance: 3 } }, blocks: false };
  },
  console: (c) => {
    const w = 1.6, h = 1.0, d = 0.8;
    sbox(c, w, h, d, 0, h / 2, 0, 0x8a9098);
    sbox(c, w, 0.06, 0.5, 0, h + 0.1, -0.1, 0x6a7078, { rx: -0.5 });
    const screens = [
      pbox(c, 0.5, 0.36, 0.02, -0.4, h + 0.42, -0.28, 0x101810, null, PAT.lumiere),
      pbox(c, 0.5, 0.36, 0.02, 0.4, h + 0.42, -0.28, 0x101810, null, PAT.lumiere),
    ];
    sbox(c, w, 0.5, 0.06, 0, h + 0.42, -0.32, 0x5a6068);
    for (let i = 0; i < 6; i++) screens.push(pbox(c, 0.05, 0.05, 0.02, -0.6 + i * 0.24, h + 0.12, 0.1, 0x101010, null, PAT.lumiere));
    return { name: 'Pupitre de commande', w, d, comps: [], device: { kind: 'ordinateur', screens, screenColor: 0x60c0ff, needsPower: true, light: { lx: 0, ly: 1.4, lz: 0.6, color: 0x80c0ff, intensity: 1.4, distance: 5 } }, cover: true };
  },
  lampadaire: (c) => {
    scyl(c, 0.16, 0.18, 0.04, 0, 0.02, 0, 0x2a2a2a, { seg: 8 });
    scyl(c, 0.025, 0.025, 1.5, 0, 0.77, 0, 0x2a2a2a, { seg: 5 });
    const shadeP = pbox(c, 0.36, 0.26, 0.36, 0, 1.62, 0, 0x8a7a5a, null, PAT.lumiere);
    return { name: 'Lampadaire', w: 0.4, d: 0.4, comps: [], device: { kind: 'lampe', screens: [shadeP], screenColor: 0xffe0a0, needsPower: true, light: { lx: 0, ly: 1.6, lz: 0, color: 0xffd8a0, intensity: 2.2, distance: 7 } }, blocks: false };
  },
  jukebox: (c) => {
    sbox(c, 0.9, 1.4, 0.6, 0, 0.7, 0, 0x8a2a2a);
    scyl(c, 0.45, 0.45, 0.6, 0, 1.4, 0, 0x8a2a2a, { rx: Math.PI / 2, seg: 10 });
    const screens = [pbox(c, 0.7, 0.55, 0.03, 0, 0.95, 0.31, 0x3a2a10, null, PAT.lumiere), pbox(c, 0.6, 0.1, 0.03, 0, 0.45, 0.31, 0x3a1a10, null, PAT.lumiere)];
    return { name: 'Juke-box', w: 0.9, d: 0.6, comps: [], device: { kind: 'jukebox', screens, screenColor: 0xffb040, needsPower: true, light: { lx: 0, ly: 1.0, lz: 0.6, color: 0xffa050, intensity: 1.6, distance: 5 } }, cover: true };
  },
  distributeur: (c) => {
    const col = pick(c.rng, [0xa83a2a, 0x2a5a8a, 0x3a6a3a]);
    sbox(c, 0.9, 1.85, 0.75, 0, 0.925, 0, col);
    const screens = [pbox(c, 0.56, 1.1, 0.03, -0.1, 1.15, 0.38, 0x1a2228, null, PAT.vitre)];
    sbox(c, 0.16, 0.5, 0.03, 0.3, 1.2, 0.38, 0x2a2a2e);
    sbox(c, 0.6, 0.2, 0.04, -0.05, 0.3, 0.38, 0x1a1a1e);
    return { name: 'Distributeur', w: 0.9, d: 0.75, comps: [], device: { kind: 'distributeur', screens, screenColor: 0xffe8b0, needsPower: false, light: { lx: 0, ly: 1.2, lz: 0.7, color: 0xd8f0ff, intensity: 1.2, distance: 4 } }, cover: true };
  },
  arcade: (c) => {
    const col = pick(c.rng, [0x7a2cbf, 0x2a6a9a, 0xb03a2a]);
    sbox(c, 0.8, 1.75, 0.8, 0, 0.875, 0, col);
    sbox(c, 0.78, 0.2, 0.45, 0, 1.0, 0.3, 0x2a2a2a);
    const screens = [pbox(c, 0.6, 0.48, 0.04, 0, 1.42, 0.41, 0x101018, null, PAT.lumiere), pbox(c, 0.7, 0.14, 0.04, 0, 1.78, 0.41, 0x201018, null, PAT.lumiere)];
    return { name: 'Borne d\'arcade', w: 0.8, d: 0.8, comps: [], device: { kind: 'arcade', screens, screenColor: 0x4af0ff, needsPower: true, light: { lx: 0, ly: 1.4, lz: 0.8, color: 0x80e0ff, intensity: 1.2, distance: 4 } }, cover: true };
  },
  groupe: (c) => {
    // groupe électrogène sur châssis, réservoir et tableau
    sbox(c, 1.8, 0.2, 1.0, 0, 0.1, 0, 0x2a2c30);
    sbox(c, 1.3, 0.9, 0.85, -0.15, 0.65, 0, 0xc8a030, { grad: 0.2 });
    scyl(c, 0.32, 0.32, 0.9, 0.6, 0.6, 0, METAL.rouge, { rz: Math.PI / 2, seg: 10 });
    scyl(c, 0.07, 0.07, 0.8, -0.6, 1.4, -0.2, 0x2a2a2a, { seg: 6 });
    sbox(c, 0.4, 0.3, 0.06, -0.3, 0.75, 0.45, 0x2a2e30);
    const screens = [pbox(c, 0.08, 0.08, 0.03, -0.4, 0.8, 0.49, 0x301010, null, PAT.lumiere), pbox(c, 0.08, 0.08, 0.03, -0.2, 0.8, 0.49, 0x103010, null, PAT.lumiere)];
    return { name: 'Groupe électrogène', w: 1.8, d: 1.0, comps: [], device: { kind: 'groupe', screens, screenColor: 0x60ff60, needsPower: false }, cover: true };
  },
  interrupteur: (c) => {
    const dot = pbox(c, 0.06, 0.1, 0.03, 0, 1.3, 0.02, 0x606060, null, PAT.lumiere);
    sbox(c, 0.1, 0.14, 0.02, 0, 1.3, 0, 0xe0dcd0);
    return { name: 'Interrupteur', w: 0.1, d: 0.05, comps: [], device: { kind: 'interrupteur', screens: [dot], screenColor: 0xffd060, needsPower: true }, blocks: false };
  },
};

function chairAt(c: Ctx, lx: number, lz: number, r: number, col: number): void {
  const f = new Frame(c.f.wx(lx, lz), c.f.wz(lx, lz), c.f.ry + r, c.f.y);
  const cc: Ctx = { ...c, f };
  sbox(cc, 0.42, 0.05, 0.42, 0, 0.46, 0, col);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) sbox(cc, 0.04, 0.44, 0.04, sx * 0.18, 0.22, sz * 0.18, shade(col, 0.8));
  sbox(cc, 0.42, 0.42, 0.04, 0, 0.7, -0.19, col);
}

/** Porte de four basculante (charnière en bas). */
function door4(c: Ctx, w: number, h: number, lx: number, ly: number, frontZ: number): number[] {
  const f = c.f;
  const motion: PartMotion = { kind: 'pivot', px: f.wx(lx, frontZ), py: f.y + ly - h / 2, pz: f.wz(lx, frontZ), ax: f.c, ay: 0, az: -f.s, angle: 1.4 };
  return [
    c.parts.box(w, h, 0.04, f.wx(lx, frontZ + 0.02), f.y + ly, f.wz(lx, frontZ + 0.02), 0x2a2a2c, { ry: f.ry, motion }),
    c.parts.box(w * 0.7, 0.04, 0.05, f.wx(lx, frontZ + 0.05), f.y + ly + h / 2 - 0.06, f.wz(lx, frontZ + 0.05), 0xb0b4b6, { ry: f.ry, motion }),
  ];
}

/** Téléviseur cathodique posé à la hauteur y0 ; l'écran est une pièce lumineuse. */
function tvSet(c: Ctx, y0: number): DeviceDef {
  sbox(c, 0.66, 0.52, 0.48, 0, y0 + 0.26, -0.02, pick(c.rng, [0x3a3a3e, 0x5a4a3a, 0xc8c0a8]));
  sbox(c, 0.04, 0.3, 0.04, -0.12, y0 + 0.66, -0.1, 0x2a2a2a, { rz: 0.4 });
  sbox(c, 0.04, 0.3, 0.04, 0.12, y0 + 0.66, -0.1, 0x2a2a2a, { rz: -0.4 });
  const screen = pbox(c, 0.5, 0.38, 0.03, -0.04, y0 + 0.27, 0.23, 0x141a18, null, PAT.lumiere);
  return { kind: 'tv', screens: [screen], screenColor: 0xa8d0ff, needsPower: true, light: { lx: 0, ly: y0 + 0.3, lz: 0.9, color: 0x9ac0ff, intensity: 1.6, distance: 5 } };
}

/** Petits objets posés sur un meuble bas. */
function decorOnTop(c: Ctx, h: number, w: number, d: number): void {
  const rng = c.rng;
  const n = rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const x = rng.range(-w / 2 + 0.15, w / 2 - 0.15);
    const k = rng.next();
    if (k < 0.35) scyl(c, 0.06, 0.07, 0.16, x, h + 0.08, rng.range(-0.1, 0.1), pick(rng, [0x8ab0c0, 0xc0a060, 0xa04a4a]), { seg: 6 });
    else if (k < 0.7) sbox(c, 0.16, 0.2, 0.03, x, h + 0.1, -d / 2 + 0.1, pick(rng, [0x5a4a3a, BRASS]), { rx: -0.2 });
    else sbox(c, 0.25, 0.06, 0.18, x, h + 0.03, 0, pick(rng, [0x8a2a2a, 0x2a4a8a, 0xd8c8a0]));
  }
}

export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** Construit un meuble ; renvoie sa description (compartiments, appareil, emprise). */
export function buildFurniture(kind: FurnitureKind, g: GeoBuilder, parts: PartSet, x: number, z: number, ry: number, rng: Rng, y = 0): FurnSpec {
  return BUILDERS[kind]({ g, parts, f: new Frame(x, z, ry, y), rng });
}

/** Meubles muraux (posés contre un mur, sans encombrement au sol). */
export const WALL_MOUNTED: ReadonlySet<FurnitureKind> = new Set(['pharmacie', 'placard_haut', 'armoire_glace', 'interrupteur']);

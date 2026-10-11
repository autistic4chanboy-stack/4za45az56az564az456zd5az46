import * as THREE from 'three';
import { GeoBuilder } from '../render/geo';
import { PAT } from '../render/toon';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import type { InteriorKind, BuildingSpec } from './stationBuilder';

/**
 * Habillage des bâtiments : styles de murs (motifs procéduraux du shader), toitures détaillées,
 * encadrements, volets, auvents, équipements de toit. Tout est purement décoratif : les
 * collisions restent celles des murs posés par StationBuilder.
 */

export type WallStyle = 'bois' | 'grange' | 'brique' | 'pierre' | 'beton' | 'tole' | 'crepi';
export type RoofKind = 'plat' | 'pignon' | 'aucun' | 'verre' | 'arche' | 'sheds';

export interface StyleDef {
  /** Motif des murs. */
  pat: number;
  /** Soubassement (couleur, motif) ou null. */
  plinth: number | null;
  plinthPat: number;
  /** Encadrements, corniche, chaînages. */
  trim: number;
  corner: 'poteau' | 'chainage' | 'aucun';
  shutters: boolean;
}

export const STYLES: Record<WallStyle, StyleDef> = {
  bois: { pat: PAT.planches, plinth: 0x5e5850, plinthPat: PAT.pierre, trim: 0x46301f, corner: 'poteau', shutters: true },
  grange: { pat: PAT.lames, plinth: 0x5e5850, plinthPat: PAT.pierre, trim: 0xd8cfbc, corner: 'poteau', shutters: false },
  brique: { pat: PAT.briques, plinth: 0x605c56, plinthPat: PAT.pierre, trim: 0xc9bca4, corner: 'chainage', shutters: false },
  pierre: { pat: PAT.pierre, plinth: null, plinthPat: 0, trim: 0xb3aa98, corner: 'chainage', shutters: false },
  beton: { pat: PAT.beton, plinth: 0x56585a, plinthPat: PAT.beton, trim: 0x9c9e9a, corner: 'aucun', shutters: false },
  tole: { pat: PAT.tole, plinth: 0x626260, plinthPat: PAT.beton, trim: 0x44484e, corner: 'poteau', shutters: false },
  crepi: { pat: 0, plinth: 0x6a6660, plinthPat: PAT.pierre, trim: 0xe2d9c6, corner: 'chainage', shutters: true },
};

const SHUTTERS = [0x4a6a7a, 0x56704a, 0x7a3a2e, 0x6a5a8a, 0x3e5a52, 0x8a6a3a];
const AWNINGS = [0xa8392a, 0x3a6a4a, 0x35588a, 0xc8922e, 0x7a3a6a];
const HOMEY: InteriorKind[] = ['maison', 'bar', 'boutique', 'dortoir', 'cantine'];

export function wallStyleFor(spec: BuildingSpec, vr: Rng): WallStyle {
  if (spec.style) return spec.style;
  const n = spec.name.toLowerCase();
  if (n.includes('grange')) return 'grange';
  if (n.includes('cabane') || n.includes('baraque') || n.includes('ferme')) return 'bois';
  if (n.includes('chapelle') || n.includes('église') || n.includes('fort')) return 'pierre';
  if (spec.roofType === 'verre') return 'crepi';
  switch (spec.interior) {
    case 'maison':
    case 'bar':
    case 'boutique':
    case 'dortoir':
    case 'cantine':
      return vr.pick(['bois', 'crepi', 'brique', 'crepi', 'bois'] as const);
    case 'entrepot':
    case 'atelier':
    case 'garage':
      return vr.pick(['tole', 'brique', 'tole'] as const);
    case 'labo':
    case 'reacteur':
    case 'salle_controle':
    case 'radio':
      return 'beton';
    case 'bureau':
    case 'infirmerie':
    case 'armurerie':
    case 'caserne':
      return vr.pick(['beton', 'brique', 'crepi'] as const);
    case 'chapelle':
      return 'pierre';
    default:
      return vr.pick(['crepi', 'brique', 'bois'] as const);
  }
}

export function roofKindFor(spec: BuildingSpec, style: WallStyle, vr: Rng): RoofKind {
  if (spec.roofType) return spec.roofType;
  const h = spec.h ?? 3.4;
  const industrial = spec.interior === 'entrepot' || spec.interior === 'atelier' || spec.interior === 'garage';
  if (industrial && h >= 5 && spec.w >= 16) return vr.chance(0.5) ? 'sheds' : 'arche';
  if (style === 'tole') return spec.w * spec.d > 110 ? 'arche' : 'plat';
  if (style === 'grange') return 'pignon';
  if (spec.interior && HOMEY.includes(spec.interior) && style !== 'beton') return vr.chance(0.7) ? 'pignon' : 'plat';
  return 'plat';
}

export function roofPatFor(kind: RoofKind, style: WallStyle, vr: Rng): number {
  if (kind === 'arche' || kind === 'sheds' || style === 'tole') return PAT.toleToit;
  if (kind === 'plat') return PAT.feutre;
  if (style === 'grange') return vr.chance(0.5) ? PAT.toleToit : PAT.bardeaux;
  if (style === 'bois') return vr.chance(0.55) ? PAT.bardeaux : PAT.tuiles;
  return PAT.tuiles;
}

/** Couleur de toit par défaut selon le motif (quand l'archétype n'en impose pas). */
export function roofColorFor(pat: number, vr: Rng): number {
  if (pat === PAT.tuiles) return vr.pick([0x9a4630, 0x8a3c2a, 0xa65a3a, 0x4a5264, 0x55505a]);
  if (pat === PAT.bardeaux) return vr.pick([0x6a4a32, 0x5a4434, 0x76563a]);
  if (pat === PAT.toleToit) return vr.pick([0x5c666e, 0x6a5a4c, 0x4c5e56, 0x7a5040]);
  return vr.pick([0x3c3a40, 0x46444a, 0x3a3c3a]);
}

/** Ravive une couleur de toit imposée par l'archétype (souvent trop terne vue du dessus). */
export function enrichRoof(hex: number, kind: RoofKind): number {
  let r = ((hex >> 16) & 255) / 255;
  let g = ((hex >> 8) & 255) / 255;
  let b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  if (kind === 'pignon') {
    l = Math.max(l, 0.34);
    s = Math.min(0.62, s * 1.3 + 0.04);
  } else if (kind === 'plat') {
    l = Math.max(l, 0.4);
    s *= 0.7;
  } else {
    l = Math.max(l, 0.38);
  }
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** Assombrit / éclaircit une couleur hexadécimale. */
export function shade(hex: number, k: number): number {
  const r = clamp(Math.round(((hex >> 16) & 255) * k), 0, 255);
  const g = clamp(Math.round(((hex >> 8) & 255) * k), 0, 255);
  const b = clamp(Math.round((hex & 255) * k), 0, 255);
  return (r << 16) | (g << 8) | b;
}

type Side = 'n' | 's' | 'e' | 'w';

/** Repère d'une façade : axe le long du mur, plan du mur, sens extérieur. */
export interface Facade {
  side: Side;
  along: 'x' | 'z';
  /** Coordonnée fixe du plan médian du mur. */
  fixed: number;
  /** +1 ou -1 : direction extérieure sur l'axe normal. */
  out: 1 | -1;
}

export function facade(side: Side, rect: { x0: number; z0: number; x1: number; z1: number }, T: number): Facade {
  switch (side) {
    case 'n':
      return { side, along: 'x', fixed: rect.z0 + T / 2, out: -1 };
    case 's':
      return { side, along: 'x', fixed: rect.z1 - T / 2, out: 1 };
    case 'w':
      return { side, along: 'z', fixed: rect.x0 + T / 2, out: -1 };
    default:
      return { side, along: 'z', fixed: rect.x1 - T / 2, out: 1 };
  }
}

/** Boîte placée dans le repère d'une façade : a = position le long du mur, y = centre vertical, o = décalage vers l'extérieur. */
export function fbox(g: GeoBuilder, f: Facade, a: number, y: number, o: number, len: number, h: number, thick: number, color: number, opts?: Parameters<GeoBuilder['box']>[7]): void {
  const n = f.fixed + f.out * o;
  if (f.along === 'x') g.box(len, h, thick, a, y, n, color, opts);
  else g.box(thick, h, len, n, y, a, color, opts);
}

export interface WindowOpts {
  style: StyleDef;
  lit: boolean;
  T: number;
  shutter: number | null;
  flowers: number | null;
  y?: number;
}

/** Fenêtre complète : vitre (calque 'window'), encadrement, appui, croisillons, volets éventuels. */
export function windowArt(g: GeoBuilder, f: Facade, a: number, o: WindowOpts): void {
  const y = o.y ?? 1.9;
  const T = o.T;
  const trim = o.style.trim;
  g.layer('window');
  fbox(g, f, a, y, 0, 1.1, 0.9, T + 0.04, o.lit ? 0xffd28a : 0x2a3440);
  g.layer('base');
  const ext = T / 2 + 0.04;
  // encadrement et linteau
  fbox(g, f, a, y + 0.51, ext, 1.32, 0.13, 0.09, trim);
  fbox(g, f, a - 0.6, y, ext, 0.1, 0.92, 0.08, trim);
  fbox(g, f, a + 0.6, y, ext, 0.1, 0.92, 0.08, trim);
  // appui saillant
  fbox(g, f, a, y - 0.5, ext + 0.06, 1.36, 0.09, 0.2, shade(trim, 0.9));
  // croisillons
  fbox(g, f, a, y, T / 2 + 0.03, 0.06, 0.9, 0.05, shade(trim, 0.85));
  fbox(g, f, a, y + 0.06, T / 2 + 0.03, 1.1, 0.06, 0.05, shade(trim, 0.85));
  if (o.shutter !== null) {
    fbox(g, f, a - 0.95, y, ext, 0.52, 0.98, 0.06, o.shutter, { pat: PAT.lames });
    fbox(g, f, a + 0.95, y, ext, 0.52, 0.98, 0.06, o.shutter, { pat: PAT.lames });
  }
  if (o.flowers !== null) {
    fbox(g, f, a, y - 0.66, ext + 0.12, 1.1, 0.22, 0.24, 0x5a3e2a);
    g.layer('foliage');
    for (let i = 0; i < 4; i++) {
      const aa = a - 0.4 + i * 0.27;
      const n = f.fixed + f.out * (ext + 0.14);
      const px = f.along === 'x' ? aa : n;
      const pz = f.along === 'x' ? n : aa;
      g.sphere(0.13, px, y - 0.48, pz, i % 2 ? o.flowers : 0x4a7a3a, { detail: 0 });
    }
    g.layer('base');
  }
}

export interface DoorArtOpts {
  style: StyleDef;
  T: number;
  width: number;
  h: number;
  awning: number | null;
  sign: boolean;
  lamp: boolean;
}

/** Encadrement de porte, seuil, auvent rayé, enseigne et lanterne. Renvoie la position de la lanterne. */
export function doorArt(g: GeoBuilder, f: Facade, a: number, o: DoorArtOpts): { x: number; y: number; z: number } | null {
  const trim = o.style.trim;
  const ext = o.T / 2 + 0.05;
  const hw = o.width / 2;
  fbox(g, f, a - hw - 0.08, 1.3, ext, 0.16, 2.6, 0.1, trim);
  fbox(g, f, a + hw + 0.08, 1.3, ext, 0.16, 2.6, 0.1, trim);
  fbox(g, f, a, 2.62, ext, o.width + 0.36, 0.18, 0.12, trim);
  // seuil
  fbox(g, f, a, 0.05, o.T / 2 + 0.3, o.width + 0.5, 0.1, 0.6, 0x77736a, { pat: PAT.pierre });
  if (o.awning !== null) {
    const n = 5;
    const wA = o.width + 1.2;
    for (let i = 0; i < n; i++) {
      const aa = a - wA / 2 + (wA * (i + 0.5)) / n;
      const c = i % 2 ? 0xe6dcc8 : o.awning;
      const nn = f.fixed + f.out * (o.T / 2 + 0.55);
      const rot = f.out * 0.42;
      if (f.along === 'x') g.box(wA / n + 0.01, 0.07, 1.15, aa, 2.92, nn, c, { rx: rot });
      else g.box(1.15, 0.07, wA / n + 0.01, nn, 2.92, aa, c, { rz: -rot });
    }
    // lambrequin festonné
    for (let i = 0; i < n * 2; i++) {
      const aa = a - wA / 2 + (wA * (i + 0.5)) / (n * 2);
      fbox(g, f, aa, 2.58, o.T / 2 + 1.06, wA / (n * 2) - 0.05, 0.16, 0.05, i % 2 ? 0xe6dcc8 : o.awning);
    }
  }
  if (o.sign && o.h > 3.2) {
    const sy = Math.min(o.h - 0.45, 3.2);
    fbox(g, f, a, sy, o.T / 2 + 0.06, 1.9, 0.5, 0.08, 0x4a3324);
    for (let i = 0; i < 5; i++) fbox(g, f, a - 0.6 + i * 0.3, sy + (i % 2 ? 0.03 : -0.02), o.T / 2 + 0.11, 0.18, 0.14, 0.03, 0xe0c890);
  }
  if (o.lamp) {
    const la = a + hw + 0.55;
    fbox(g, f, la, 2.55, o.T / 2 + 0.18, 0.06, 0.06, 0.36, 0x2a2a2e);
    g.layer('glow');
    fbox(g, f, la, 2.42, o.T / 2 + 0.34, 0.16, 0.2, 0.16, 0xffc874);
    g.layer('base');
    fbox(g, f, la, 2.56, o.T / 2 + 0.34, 0.22, 0.06, 0.22, 0x2a2a2e);
    const n = f.fixed + f.out * (o.T / 2 + 0.6);
    return f.along === 'x' ? { x: la, y: 2.4, z: n } : { x: n, y: 2.4, z: la };
  }
  return null;
}

/** Chaînages d'angle / poteaux aux quatre coins (sud dans `front`, le reste dans `base`). */
export function cornerArt(base: GeoBuilder, front: GeoBuilder, rect: { x0: number; z0: number; x1: number; z1: number }, h: number, style: StyleDef): void {
  if (style.corner === 'aucun') return;
  const corners: [number, number, GeoBuilder][] = [
    [rect.x0, rect.z0, base],
    [rect.x1, rect.z0, base],
    [rect.x0, rect.z1, front],
    [rect.x1, rect.z1, front],
  ];
  for (const [cx, cz, g] of corners) {
    const ix = Math.sign(rect.x0 + rect.x1 - 2 * cx);
    const iz = Math.sign(rect.z0 + rect.z1 - 2 * cz);
    if (style.corner === 'poteau') {
      g.box(0.32, h + 0.05, 0.32, cx + ix * 0.09, h / 2, cz + iz * 0.09, style.trim, { grad: 0.2 });
    } else {
      const n = Math.floor(h / 0.5);
      for (let k = 0; k < n; k++) {
        const big = k % 2 === 0;
        const sx = big ? 0.62 : 0.36;
        const sz = big ? 0.36 : 0.62;
        g.box(sx, 0.44, sz, cx + ix * (sx / 2 - 0.07), 0.25 + k * 0.5, cz + iz * (sz / 2 - 0.07), style.trim, { vary: 0.05 });
      }
    }
  }
}

export interface RoofOpts {
  kind: RoofKind;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  T: number;
  wall: number;
  wallPat: number;
  color: number;
  pat: number;
  trim: number;
  interior?: InteriorKind;
  dark: boolean;
  vr: Rng;
}

export interface RoofResult {
  /** Bouches de cheminée (fumée). */
  chimneys: { x: number; y: number; z: number }[];
  /** Hauteur du point le plus haut. */
  top: number;
}

const tmpM = new THREE.Matrix4();

/** Construit la toiture dans `g` (repère monde). */
export function roofArt(g: GeoBuilder, o: RoofOpts): RoofResult {
  const { x, z, w, d, h, T, vr } = o;
  const res: RoofResult = { chimneys: [], top: h };
  const darkC = shade(o.color, 0.62);
  if (o.kind === 'pignon') {
    const ridgeZ = d > w * 1.15;
    const L = ridgeZ ? d : w;
    const S = ridgeZ ? w : d;
    const ang = clamp(0.66 - (S - 8) * 0.025, 0.42, 0.66);
    const ov = 0.45;
    const half = S / 2 + ov;
    const tan = Math.tan(ang);
    const rise = tan * (S / 2);
    const M = tmpM.makeRotationY(ridgeZ ? Math.PI / 2 : 0).setPosition(x, 0, z).clone();
    g.parent = M;
    // pignons triangulaires
    g.prism(T, rise, S, -L / 2 + T / 2, h, 0, o.wall, { pat: o.wallPat });
    g.prism(T, rise, S, L / 2 - T / 2, h, 0, o.wall, { pat: o.wallPat });
    // petites fenêtres de comble
    if (S > 6) {
      g.layer('window');
      g.box(T + 0.06, 0.55, 0.5, -L / 2 + T / 2, h + rise * 0.42, 0, o.dark ? 0x2a3440 : 0xffd28a);
      g.box(T + 0.06, 0.55, 0.5, L / 2 - T / 2, h + rise * 0.42, 0, 0x2a3440);
      g.layer('base');
    }
    // versants
    const slope = half / Math.cos(ang);
    for (const sg of [1, -1]) {
      const cy = h + rise - (tan * half) / 2 + Math.cos(ang) * 0.1;
      const cz = (sg * half) / 2 + sg * Math.sin(ang) * 0.1;
      g.box(L + 0.7, 0.2, slope, 0, cy, cz, o.color, { rx: sg * ang, pat: o.pat });
      // bordure d'égout et gouttière
      const ey = h - tan * ov;
      g.box(L + 0.72, 0.18, 0.1, 0, ey - 0.02, sg * (half + 0.03), o.trim);
      if (sg === 1) g.box(L + 0.5, 0.12, 0.16, 0, ey - 0.14, half + 0.1, 0x55595e);
      // rives le long des pignons
      for (const sx of [-1, 1]) g.box(0.12, 0.24, slope, sx * (L / 2 + 0.36), cy, cz, o.trim, { rx: sg * ang });
    }
    // faîtage
    g.box(L + 0.74, 0.18, 0.36, 0, h + rise + 0.14, 0, darkC);
    res.top = h + rise + 0.3;
    // cheminée
    if ((o.interior && HOMEY.includes(o.interior)) || vr.chance(0.3)) {
      const cxL = vr.range(-L * 0.32, L * 0.32);
      const czL = -S * 0.17;
      const ys = h + rise - tan * Math.abs(czL);
      const top = h + rise + 1.0;
      g.box(0.72, top - ys + 0.4, 0.72, cxL, (top + ys - 0.4) / 2, czL, 0x8a4a38, { pat: PAT.briques });
      g.box(0.88, 0.14, 0.88, cxL, top + 0.07, czL, 0x5a5650);
      g.box(0.42, 0.04, 0.42, cxL, top + 0.15, czL, 0x16141a);
      const wp = new THREE.Vector3(cxL, top + 0.2, czL).applyMatrix4(M);
      res.chimneys.push({ x: wp.x, y: wp.y, z: wp.z });
      res.top = Math.max(res.top, top + 0.2);
    }
    g.parent = null;
    return res;
  }
  if (o.kind === 'plat') {
    g.box(w + 0.1, 0.22, d + 0.1, x, h + 0.11, z, o.color, { pat: o.pat });
    // acrotère et couvertine
    const ph = 0.5;
    const py = h + 0.22 + ph / 2;
    g.box(w + 0.1, ph, 0.26, x, py, z - d / 2 + 0.08, o.wall, { pat: o.wallPat });
    g.box(w + 0.1, ph, 0.26, x, py, z + d / 2 - 0.08, o.wall, { pat: o.wallPat });
    g.box(0.26, ph, d - 0.42, x - w / 2 + 0.08, py, z, o.wall, { pat: o.wallPat });
    g.box(0.26, ph, d - 0.42, x + w / 2 - 0.08, py, z, o.wall, { pat: o.wallPat });
    const cy = h + 0.22 + ph + 0.04;
    g.box(w + 0.22, 0.08, 0.38, x, cy, z - d / 2 + 0.08, o.trim);
    g.box(w + 0.22, 0.08, 0.38, x, cy, z + d / 2 - 0.08, o.trim);
    g.box(0.38, 0.08, d - 0.3, x - w / 2 + 0.08, cy, z, o.trim);
    g.box(0.38, 0.08, d - 0.3, x + w / 2 - 0.08, cy, z, o.trim);
    res.top = cy + 0.04;
    roofEquipment(g, o, h + 0.22, res);
    return res;
  }
  if (o.kind === 'arche') {
    const rise = Math.min(4, d * 0.26);
    const halfD = d / 2 + 0.3;
    g.vault(w + 0.4, rise, halfD, x, h, z, o.color, { pat: o.pat, seg: 10 });
    // nervures de la voûte
    const n = Math.max(2, Math.round(w / 4));
    for (let i = 0; i <= n; i++) {
      const xx = x - w / 2 + (w * i) / n;
      g.vault(0.14, rise + 0.06, halfD + 0.06, xx, h, z, shade(o.color, 0.72), { seg: 10 });
    }
    // lanterneau vitré au sommet
    g.layer('window');
    g.box(w * 0.7, 0.08, 1.1, x, h + rise + 0.02, z, o.dark ? 0x2a3440 : 0xffd28a);
    g.layer('base');
    res.top = h + rise + 0.1;
    return res;
  }
  if (o.kind === 'sheds') {
    const n = Math.max(2, Math.round(d / 3.6));
    const tw = d / n;
    const th = Math.min(2.1, tw * 0.55);
    for (let k = 0; k < n; k++) {
      const zc = z - d / 2 + (k + 0.5) * tw;
      g.prism(w + 0.3, th, tw, x, h, zc, o.color, { apex: 0.5, pat: o.pat });
      // verrière verticale côté sud
      const zs = zc + tw / 2 + 0.03;
      g.layer('window');
      g.box(w * 0.94, th * 0.7, 0.06, x, h + th * 0.47, zs, o.dark ? 0x2a3440 : 0xffd28a);
      g.layer('base');
      const m = Math.round(w / 1.4);
      for (let i = 0; i <= m; i++) g.box(0.08, th * 0.74, 0.1, x - (w * 0.94) / 2 + (w * 0.94 * i) / m, h + th * 0.47, zs + 0.02, 0x30343a);
      g.box(w * 0.96, 0.1, 0.12, x, h + th * 0.1, zs + 0.03, 0x30343a);
    }
    res.top = h + th;
    return res;
  }
  if (o.kind === 'verre') {
    g.layer('glass').prism(w, 1.7, d, x, h, z, 0xa8d8c8);
    g.layer('base');
    const n = Math.max(2, Math.floor(w / 2));
    const ang = Math.atan2(1.7, d / 2);
    const sl = Math.hypot(1.7, d / 2);
    for (let i = 0; i <= n; i++) {
      const xx = x - w / 2 + (w * i) / n;
      for (const sg of [1, -1]) g.box(0.1, 0.12, sl, xx, h + 0.85, z + (sg * d) / 4, 0x4e5e54, { rx: sg * ang });
    }
    g.box(w + 0.1, 0.14, 0.16, x, h + 1.72, z, 0x4e5e54);
    res.top = h + 1.8;
    return res;
  }
  return res;
}

/** Équipements de toit-terrasse : aérations, climatiseurs, réservoir, lanterneaux, antenne, tuyaux. */
function roofEquipment(g: GeoBuilder, o: RoofOpts, y0: number, res: RoofResult): void {
  const { x, z, w, d, vr } = o;
  const big = w * d > 100;
  const kinds: string[] = ['aeration', 'clim', 'lanterneau'];
  if (big) kinds.push('reservoir', 'tuyaux');
  if (o.interior === 'radio' || o.interior === 'salle_controle' || o.interior === 'caserne' || o.interior === 'bureau') kinds.push('antenne');
  if (o.interior && HOMEY.includes(o.interior)) kinds.push('cheminee', 'cheminee');
  if (o.interior === 'labo' || o.interior === 'reacteur') kinds.push('tuyaux', 'clim');
  const n = clamp(Math.round((w * d) / 45), 1, 4);
  const placed: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const kind = vr.pick(kinds);
    let px = 0;
    let pz = 0;
    let ok = false;
    for (let t = 0; t < 8 && !ok; t++) {
      px = x + vr.range(-w / 2 + 1.6, w / 2 - 1.6);
      pz = z + vr.range(-d / 2 + 1.5, d / 2 - 1.5);
      ok = placed.every((p) => Math.hypot(p.x - px, p.z - pz) > p.r + 1.6);
    }
    if (!ok) continue;
    placed.push({ x: px, z: pz, r: 1.4 });
    switch (kind) {
      case 'aeration':
        g.box(0.6, 0.5, 0.6, px, y0 + 0.25, pz, 0x6a6e72);
        g.box(0.76, 0.08, 0.76, px, y0 + 0.62, pz, 0x55595e);
        g.box(0.3, 0.02, 0.3, px, y0 + 0.51, pz, 0x1a1a1e);
        break;
      case 'clim':
        g.box(1.4, 0.7, 1.0, px, y0 + 0.35, pz, 0xa8aaa6, { vary: 0.04 });
        g.cyl(0.36, 0.36, 0.05, px - 0.25, y0 + 0.72, pz, 0x2a2c30, { seg: 8 });
        g.box(0.12, 0.12, 0.9, px + 0.55, y0 + 0.2, pz + 0.6, 0x55595e);
        break;
      case 'lanterneau':
        g.box(1.6, 0.18, 1.2, px, y0 + 0.09, pz, 0x77736a);
        g.layer('window');
        g.box(1.4, 0.12, 1.0, px, y0 + 0.24, pz, o.dark ? 0x2a3440 : 0xffd28a);
        g.layer('base');
        break;
      case 'reservoir':
        for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) g.box(0.12, 1.3, 0.12, px + lx, y0 + 0.65, pz + lz, 0x3a3a3e);
        g.cyl(1.05, 1.05, 1.5, px, y0 + 2.05, pz, 0x6a5038, { seg: 10, pat: PAT.lames });
        g.cone(1.15, 0.6, px, y0 + 3.1, pz, 0x4a4a4e, { seg: 10 });
        res.top = Math.max(res.top, y0 + 3.4);
        break;
      case 'tuyaux': {
        const len = Math.min(w - 2.5, 6);
        g.cyl(0.14, 0.14, len, px, y0 + 0.45, pz, 0x7a6a5a, { rz: Math.PI / 2, seg: 6 });
        g.cyl(0.1, 0.1, len, px, y0 + 0.45, pz + 0.4, 0x5a6a6e, { rz: Math.PI / 2, seg: 6 });
        for (let k = -1; k <= 1; k++) g.box(0.12, 0.45, 0.7, px + (k * len) / 2.4, y0 + 0.22, pz + 0.2, 0x3a3a3e);
        break;
      }
      case 'antenne':
        g.cyl(0.05, 0.07, 3.6, px, y0 + 1.8, pz, 0x5a5e62, { seg: 5 });
        g.box(1.0, 0.05, 0.05, px, y0 + 2.8, pz, 0x5a5e62);
        g.box(0.7, 0.05, 0.05, px, y0 + 3.2, pz, 0x5a5e62);
        g.layer('glow').box(0.12, 0.12, 0.12, px, y0 + 3.65, pz, 0xff4030).layer('base');
        res.top = Math.max(res.top, y0 + 3.7);
        break;
      case 'cheminee':
        g.box(0.7, 1.3, 0.7, px, y0 + 0.65, pz, 0x8a4a38, { pat: PAT.briques });
        g.box(0.86, 0.14, 0.86, px, y0 + 1.37, pz, 0x5a5650);
        g.box(0.4, 0.04, 0.4, px, y0 + 1.45, pz, 0x16141a);
        res.chimneys.push({ x: px, y: y0 + 1.5, z: pz });
        break;
    }
  }
}

/** Mur en ruine : pans dentelés de hauteurs inégales. */
export function ruinedWall(g: GeoBuilder, f: Facade, a0: number, a1: number, h: number, T: number, color: number, pat: number, vr: Rng): void {
  let c = a0;
  while (c < a1 - 0.02) {
    const len = Math.min(a1 - c, 0.7 + vr.next() * 1.3);
    const hh = h * (0.22 + vr.next() * 0.72);
    fbox(g, f, c + len / 2, hh / 2, 0, len, hh, T, color, { grad: 0.25, vary: 0.06, pat });
    c += len;
  }
}

export function windowFlags(spec: BuildingSpec, style: WallStyle, winter: boolean, vr: Rng): { shutter: number | null; flowers: number | null } {
  const homey = !!spec.interior && HOMEY.includes(spec.interior);
  const shutter = STYLES[style].shutters && homey && vr.chance(0.7) ? vr.pick(SHUTTERS) : null;
  const flowers = homey && !winter && !spec.dark && vr.chance(0.35) ? vr.pick([0xd04a5a, 0xe8b040, 0xc070c0, 0xf0f0e0]) : null;
  return { shutter, flowers };
}

export function awningFor(spec: BuildingSpec, vr: Rng): number | null {
  const shop = spec.interior === 'boutique' || spec.interior === 'bar' || spec.interior === 'cantine';
  return shop || (spec.interior === 'maison' && vr.chance(0.15)) ? vr.pick(AWNINGS) : null;
}

export function signFor(spec: BuildingSpec): boolean {
  return spec.interior === 'boutique' || spec.interior === 'bar' || spec.interior === 'cantine' || spec.interior === 'armurerie' || spec.interior === 'infirmerie';
}

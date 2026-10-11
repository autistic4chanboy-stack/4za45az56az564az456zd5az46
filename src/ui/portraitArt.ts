import { hashString } from '../core/rng';
import type { NpcLook } from '../data/npcs';
import type { FaceTraits } from '../data/faces';

/**
 * Portraits illustrés : un buste peint en SVG (dégradés, ombres douces, contre-jour)
 * construit à partir de l'apparence du PNJ et des traits de son visage.
 * La bouche (fermée, entrouverte, ouverte), les paupières et les iris sont des calques
 * séparés que l'interface anime pendant que le personnage parle :
 * classes `pt-talk-1` / `pt-talk-2`, `pt-blink`, `pt-look-l` / `pt-look-r` sur le <svg>.
 */

export type Mood =
  | 'neutre' | 'joie' | 'curieux' | 'colere' | 'renfrogne' | 'peur'
  | 'inquiet' | 'las' | 'malice' | 'assure' | 'triste';

export type Garment =
  | 'chemise' | 'costume' | 'gilet' | 'uniforme' | 'officier' | 'blouse'
  | 'salopette' | 'cuisine' | 'capuche' | 'col' | 'robe';

export interface PortraitSpec {
  /** Graine des détails (taches de rousseur, mèches…). */
  key: string;
  look: NpcLook;
  face: FaceTraits;
  garment: Garment;
  mood: Mood;
  /** Accessoires propres au métier (stéthoscope, cartouchière…). */
  trade?: 'medecin' | 'scientifique' | 'tireur' | 'chauffeur' | 'ingenieur' | null;
  /** Malade (0 à 1) : teint pâle, cernes, sueur. */
  sick?: number;
  /** Blessé : pansement. */
  hurt?: boolean;
}

export interface PortraitOpts {
  /** Recadrage serré sur le visage (vignettes des listes). */
  crop?: boolean;
  /** Portrait animé (respiration, regard). */
  anim?: boolean;
}

// ------------------------------------------------------------------ couleurs
type RGB = [number, number, number];
const rgb = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const pack = (r: number, g: number, b: number) => (ch(r) << 16) | (ch(g) << 8) | ch(b);
const mix = (a: number, b: number, t: number): number => {
  const A = rgb(a);
  const B = rgb(b);
  return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
const tone = (n: number, k: number): number => {
  const [r, g, b] = rgb(n);
  return pack(r * k, g * k, b * k);
};
const luma = (n: number) => {
  const [r, g, b] = rgb(n);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const c = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

// ------------------------------------------------------------------ géométrie
type Pt = [number, number];
const C = 100;
const f = (v: number) => String(Math.round(v * 10) / 10);
const P = (p: Pt) => `${f(p[0])},${f(p[1])}`;
const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [2 * C - x, y]);

/** Courbe de Catmull-Rom passant par les points (fermée par défaut). */
function smooth(pts: Pt[], closed = true, k = 1): string {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${P(pts[0])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * k, p1[1] + ((p2[1] - p0[1]) / 6) * k];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * k, p2[1] - ((p3[1] - p1[1]) / 6) * k];
    d += `C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return closed ? `${d}Z` : d;
}

/** Contour symétrique : demi-contour droit de haut en bas (sans les points de l'axe). */
const sym = (top: Pt, right: Pt[], bottom: Pt): Pt[] => [top, ...right, bottom, ...mirror(right).reverse()];

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ expressions
interface Expr {
  /** Décalage vertical de l'attaque des sourcils (+ = froncés vers le bas). */
  browIn: number;
  browOut: number;
  /** Hauteur générale des sourcils (− = levés). */
  browUp: number;
  /** Sourcil gauche (à l'écran) levé en plus (sceptique). */
  asym: number;
  /** Relevé des commissures (+ = sourire). */
  corner: number;
  /** Relevé supplémentaire de la commissure droite (sourire en coin). */
  cornerAsym: number;
  eyeOpen: number;
  /** Paupière supérieure tombante (0 à 1). */
  lid: number;
  /** Pommettes remontées. */
  cheek: number;
  /** Regard de côté. */
  glance: number;
}

const E = (o: Partial<Expr>): Expr => ({ browIn: 0, browOut: 0, browUp: 0, asym: 0, corner: 0.4, cornerAsym: 0, eyeOpen: 1, lid: 0, cheek: 0, glance: 0, ...o });
const EXPR: Record<Mood, Expr> = {
  neutre: E({}),
  joie: E({ browIn: -0.6, browOut: 0.4, browUp: -1.2, corner: 2.9, eyeOpen: 0.9, cheek: 1 }),
  curieux: E({ browIn: -1.4, browOut: -0.6, browUp: -1.9, corner: 1.3, eyeOpen: 1.08, cheek: 0.35 }),
  colere: E({ browIn: 3.8, browOut: -1.4, browUp: 0.8, corner: -1.5, eyeOpen: 0.94, lid: 0.12 }),
  renfrogne: E({ browIn: 2.4, browOut: -0.2, browUp: 1, corner: -0.9, lid: 0.12 }),
  peur: E({ browIn: -3.6, browOut: 0.9, browUp: -2, corner: -1.1, eyeOpen: 1.2 }),
  inquiet: E({ browIn: -2.7, browOut: 0.6, browUp: -0.8, corner: -0.7, eyeOpen: 1.05, glance: -1.4 }),
  las: E({ browIn: 0.4, browOut: 1, browUp: 0.8, corner: -0.3, lid: 0.55 }),
  malice: E({ browIn: 1.2, asym: -3, corner: 0.9, cornerAsym: 2.4, lid: 0.22, glance: 1.1 }),
  assure: E({ browIn: 0.9, browOut: -0.4, corner: 1.3, cornerAsym: 0.7, lid: 0.12 }),
  triste: E({ browIn: -2.9, browOut: 1.5, corner: -2.2, eyeOpen: 0.95, lid: 0.3 }),
};

/** Couleurs des couvre-chefs (identiques au modèle 3D). */
const HAT = { casquette: 0x3a3a46, bonnet: 0x7a3a2a, chapeau: 0x4a3a2a, casque: 0x4a5a3a, paille: 0xc9b06a };

let uid = 0;

/** Construit le SVG du portrait (chaîne de caractères, ids uniques). */
export function portraitSvg(spec: PortraitSpec, opts: PortraitOpts = {}): string {
  const id = `pt${(++uid).toString(36)}`;
  const ref = (k: string) => `url(#${id}${k})`;
  const { look, face, mood } = spec;
  const X = EXPR[mood] ?? EXPR.neutre;
  const R = rand(hashString(spec.key) ^ 0x51ed27);
  const sick = Math.max(0, Math.min(1, spec.sick ?? 0));
  const female = face.female;
  const age = face.age;

  // ---------------------------------------------------------------- palette
  const skin = sick > 0 ? mix(look.skin, 0x98a396, 0.22 + sick * 0.25) : look.skin;
  const skinHi = mix(skin, 0xfff2e2, 0.3);
  const skinSh = mix(tone(skin, 0.7), 0x7a2c22, 0.12);
  const skinDeep = mix(tone(skin, 0.48), 0x3a140f, 0.2);
  const hair = look.hair;
  const hairLight = luma(hair) > 0.55;
  const hairHi = hairLight ? mix(hair, 0xffffff, 0.45) : mix(hair, 0xc8b49a, 0.3);
  const hairSh = hairLight ? tone(hair, 0.66) : tone(hair, 0.55);
  const hairBack = tone(hair, 0.6);
  const browC = hairLight ? mix(tone(hair, 0.6), 0x3a2414, 0.3) : mix(hair, 0x0b0705, 0.3);
  const lash = female ? 0x1a100c : mix(hair, 0x140c08, 0.75);
  const lipBase = female ? mix(skin, 0xb4464a, 0.42) : mix(skin, 0xa0504a, 0.24);
  const lip = sick > 0 ? mix(lipBase, 0x9a8a8a, sick * 0.5) : lipBase;
  const shirt = look.shirt;

  // ---------------------------------------------------------------- proportions
  const SH = [
    { cw: 37, jw: 30, jy: 139, chw: 12.5, chy: 160 }, // ovale
    { cw: 38.5, jw: 34.5, jy: 142, chw: 17, chy: 159 }, // carré
    { cw: 40, jw: 33.5, jy: 137, chw: 14.5, chy: 156.5 }, // rond
    { cw: 35.5, jw: 28.5, jy: 144, chw: 12, chy: 165 }, // long
  ][face.shape] ?? { cw: 37, jw: 30, jy: 139, chw: 12.5, chy: 160 };
  let { cw, jw, jy, chw, chy } = SH;
  if (female) {
    cw -= 0.8;
    jw -= 2.6;
    chw -= 2;
    chy -= 1.5;
  }
  if (age > 55) {
    jy += 2;
    chy += 1;
  }
  const ey = face.shape === 3 ? 107 : face.shape === 2 ? 105 : 106;
  const ny = face.shape === 3 ? 128.5 : face.shape === 2 ? 124.5 : 126;
  const my = (ny + chy) / 2 - 3.2;
  const ex = 17 + face.eyeGap * 1.4;
  const ew = (female ? 8.9 : 8.5) + (age < 24 ? 0.4 : 0);
  const eu = 5.7 * X.eyeOpen;
  const el = 3.9 * Math.min(1.1, X.eyeOpen);
  const nw = [0.86, 1, 1.18][face.nose] ?? 1;
  const mw = (female ? 9.4 : 9) + face.lips * 1.3;
  const ut = 2.1 + face.lips * (female ? 1.8 : 1);
  const lt = 2.8 + face.lips * (female ? 2.4 : 1.4);

  const faceD = smooth(sym([C, 50], [[C + 25, 54], [C + 34.5, 70], [C + cw, 96], [C + cw - 1, 112], [C + jw, jy], [C + chw, chy - 3]], [C, chy]));

  // ---------------------------------------------------------------- defs
  const defs: string[] = [];
  const blur = (k: string, s: number) => defs.push(`<filter id="${id}${k}" x="0" y="0" width="200" height="240" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${s}"/></filter>`);
  blur('b05', 0.5);
  blur('b1', 1);
  blur('b2', 2);
  blur('b4', 4);
  blur('b8', 8);
  blur('b16', 16);
  const lin = (k: string, x1: number, y1: number, x2: number, y2: number, stops: [number, number, number?][]) =>
    defs.push(`<linearGradient id="${id}${k}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops.map(([o, col, a]) => `<stop offset="${o}" stop-color="${c(col)}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`);
  const rad = (k: string, cx: number, cy: number, r: number, stops: [number, number, number?][], fx?: number, fy?: number) =>
    defs.push(`<radialGradient id="${id}${k}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${fx !== undefined ? ` fx="${f(fx)}" fy="${f(fy ?? cy)}"` : ''}>${stops.map(([o, col, a]) => `<stop offset="${o}" stop-color="${c(col)}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`);
  const clip = (k: string, d: string, rule = '') => defs.push(`<clipPath id="${id}${k}"><path d="${d}"${rule ? ` clip-rule="${rule}"` : ''}/></clipPath>`);
  const dots = (k: string, col: number, step: number, r: number) =>
    defs.push(`<pattern id="${id}${k}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(27)"><circle cx="${f(step * 0.25)}" cy="${f(step * 0.3)}" r="${r}" fill="${c(col)}"/><circle cx="${f(step * 0.75)}" cy="${f(step * 0.8)}" r="${f(r * 0.85)}" fill="${c(col)}"/></pattern>`);

  const bgTint = mix(0x3b2c20, shirt, 0.22);
  rad('bg', 92, 92, 170, [[0, mix(bgTint, 0xffd9a0, 0.18)], [0.45, bgTint], [1, 0x0d0907]], 80, 70);
  rad('skin', 86, 98, 78, [[0, mix(skin, 0xfff2e2, 0.16)], [0.55, skin], [1, tone(skin, 0.84)]], 80, 92);
  lin('neck', 0, 128, 0, 182, [[0, skinDeep], [0.45, mix(skinSh, skin, 0.3)], [1, skin]]);
  lin('hair', 0, 34, 0, 120, [[0, mix(hair, hairHi, 0.25)], [0.45, hair], [1, tone(hair, 0.8)]]);
  lin('hairLong', 0, 34, 0, 220, [[0, mix(hair, hairHi, 0.2)], [0.35, hair], [1, tone(hair, 0.62)]]);
  lin('rim', 112, 0, 146, 0, [[0, 0xffe2b0, 0], [1, 0xffe2b0, 0.6]]);
  lin('rimL', 92, 0, 40, 0, [[0, 0xffd49a, 0], [1, 0xffd49a, 0.22]]);
  clip('fc', faceD);

  const out: string[] = [];
  const add = (s: string) => out.push(s);
  const path = (d: string, a: string) => add(`<path d="${d}" ${a}/>`);
  const ell = (cx: number, cy: number, rx: number, ry: number, a: string) => add(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${a}/>`);
  const circ = (cx: number, cy: number, r: number, a: string) => add(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${a}/>`);

  // ---------------------------------------------------------------- fond
  add(`<rect x="-10" y="-10" width="220" height="260" fill="${ref('bg')}"/>`);
  for (let i = 0; i < 6; i++) {
    const bx = 10 + R() * 180;
    const by = 12 + R() * 110;
    if (Math.abs(bx - C) < 46 && by > 30) continue;
    circ(bx, by, 5 + R() * 11, `fill="${c(mix(0xffc070, 0xff9a50, R()))}" opacity="${f(0.05 + R() * 0.09)}" filter="${ref('b4')}"`);
  }
  ell(C - 6, 96, 74, 86, `fill="#ffd49a" opacity="0.13" filter="${ref('b16')}"`);

  const hs = look.hairStyle;
  const hat = look.hat;
  const sd = face.fringe < 0.5 ? 1 : -1; // sens de la mèche (vers la droite de l'écran si raie à gauche)
  const centerPart = (hs === 2 || hs === 4) && face.fringe > 0.32 && face.fringe < 0.68;
  const bangs = female && face.fringe > 0.8 && (hs === 1 || hs === 2 || hs === 4);

  // ================================================================= buste
  add(`<g class="pt-bust">`);

  // ---------------------------------------------------------------- cheveux de dos
  if (hs === 1 && female) {
    path(smooth([[C - cw - 6, 96], [C - cw - 9, 128], [C - cw - 6, 158], [C - 20, 167], [C + 20, 167], [C + cw + 6, 158], [C + cw + 9, 128], [C + cw + 6, 96], [C + 30, 52], [C - 30, 52]]), `fill="${c(hairBack)}"`);
  } else if (hs === 1) {
    path(smooth([[C - cw - 3, 94], [C - cw - 4.5, 118], [C - cw + 4, 136], [C - 14, 146], [C + 14, 146], [C + cw - 4, 136], [C + cw + 4.5, 118], [C + cw + 3, 94], [C + 30, 52], [C - 30, 52]]), `fill="${c(hairBack)}"`);
  } else if (hs === 2) {
    const d = smooth([[C - cw - 8, 92], [C - cw - 14, 140], [C - cw - 18, 196], [C - cw - 12, 232], [C - 18, 214], [C + 18, 214], [C + cw + 12, 232], [C + cw + 18, 196], [C + cw + 14, 140], [C + cw + 8, 92], [C + 30, 50], [C - 30, 50]]);
    path(d, `fill="${c(hairBack)}"`);
    path(d, `fill="none" stroke="${c(hairSh)}" stroke-width="1.2" opacity="0.5"`);
  } else if (hs === 3 && !hat) {
    circ(C + 1, 36, 14.5, `fill="${ref('hair')}"`);
    path(`M${C - 10},30 Q${C + 2},20 ${C + 13},31 M${C - 12},38 Q${C},28 ${C + 14},38 M${C - 9},45 Q${C + 3},36 ${C + 12},45`, `fill="none" stroke="${c(hairSh)}" stroke-width="1" opacity="0.6"`);
    path(`M${C - 6},27 Q${C + 2},23 ${C + 9},27`, `fill="none" stroke="${c(hairHi)}" stroke-width="1.6" opacity="0.5" filter="${ref('b05')}"`);
  } else if (hs === 6) {
    path(smooth([[C - cw - 4, 76], [C - cw - 6, 100], [C - cw - 3, 120], [C, 126], [C + cw + 3, 120], [C + cw + 6, 100], [C + cw + 4, 76], [C, 66]]), `fill="${c(tone(hair, 0.8))}"`);
  }

  // ---------------------------------------------------------------- cou
  const nk = female ? 14.5 : 17;
  const neckD = `M${f(C - nk)},126 C${f(C - nk + 0.6)},150 ${f(C - nk - 1)},166 ${f(C - nk - 5)},182 L${f(C + nk + 5)},182 C${f(C + nk + 1)},166 ${f(C + nk - 0.6)},150 ${f(C + nk)},126 Z`;
  clip('nc', neckD);
  path(neckD, `fill="${ref('neck')}"`);
  add(`<g clip-path="${ref('nc')}">`);
  ell(C + nk - 2, 160, 7, 26, `fill="${c(skinDeep)}" opacity="0.4" filter="${ref('b2')}"`);
  ell(C - nk + 3, 166, 4, 14, `fill="${c(skinHi)}" opacity="0.25" filter="${ref('b2')}"`);
  if (!female && age > 25) path(`M${f(C - 3)},150 Q${f(C)},154 ${f(C + 3)},150`, `fill="none" stroke="${c(skinSh)}" stroke-width="1.3" opacity="0.35" filter="${ref('b05')}"`);
  if (age > 58) path(`M${f(C - 9)},162 Q${f(C)},165 ${f(C + 9)},162`, `fill="none" stroke="${c(skinSh)}" stroke-width="0.8" opacity="0.3"`);
  add('</g>');

  // ---------------------------------------------------------------- vêtements
  drawClothes();

  // ================================================================= tête
  add(`<g class="pt-head">`);

  // couettes (derrière la tête, devant les épaules)
  if (hs === 4) {
    for (const s of [-1, 1]) {
      const Q = (dx: number, y: number): Pt => [C + s * dx, y];
      const d = smooth([Q(cw - 3, 104), Q(cw + 5, 106), Q(cw + 12.5, 117), Q(cw + 18.5, 137), Q(cw + 20, 160), Q(cw + 17, 182), Q(cw + 10, 199), Q(cw + 7.5, 182), Q(cw + 5.5, 160), Q(cw + 4, 138), Q(cw + 1.5, 123), Q(cw - 2, 116)]);
      path(d, `fill="${ref('hairLong')}"`);
      clip(s > 0 ? 'pr' : 'pl', d);
      add(`<g clip-path="${ref(s > 0 ? 'pr' : 'pl')}">`);
      ell(C + s * (cw + 19), 162, 6, 34, `fill="${c(hairSh)}" opacity="0.55" filter="${ref('b2')}"`);
      for (let i = 0; i < 8; i++) {
        const k = i / 7;
        path(`M${P(Q(cw + 6 + k * 4, 118))} C${P(Q(cw + 6 + k * 12, 136))} ${P(Q(cw + 6 + k * 13, 166))} ${P(Q(cw + 8 + k * 5, 196))}`, `fill="none" stroke="${c(i % 3 === 1 ? hairHi : hairSh)}" stroke-width="${f(0.6 + (i % 2) * 0.4)}" opacity="0.45"`);
      }
      path(`M${P(Q(cw + 10, 126))} C${P(Q(cw + 12, 146))} ${P(Q(cw + 12, 166))} ${P(Q(cw + 11, 184))}`, `fill="none" stroke="${c(hairHi)}" stroke-width="2.6" stroke-linecap="round" opacity="${s < 0 ? 0.38 : 0.16}" filter="${ref('b1')}"`);
      add('</g>');
      const [tx, ty] = Q(cw + 9.5, 116.5);
      ell(tx, ty, 3.6, 2.6, `fill="#a8383a" stroke="#5a1a1a" stroke-width="0.5"`);
      ell(tx - 1, ty - 0.8, 1.4, 0.8, `fill="#ffffff" opacity="0.35"`);
    }
  }

  // oreilles
  const earsHidden = hs === 2 || (hs === 1 && female);
  if (!earsHidden) {
    for (const s of [-1, 1]) {
      const bx = C + s * (cw - 2.5);
      const t = ey - 6;
      const b = ny + 3;
      const Q = (dx: number, y: number): Pt => [bx + s * dx, y];
      path(smooth([Q(-1, t + 3), Q(5, t - 2), Q(10, t + 4), Q(10.5, t + 13), Q(8, b - 6), Q(4, b + 1), Q(-1, b - 1)]), `fill="${c(s > 0 ? tone(skin, 0.86) : skin)}"`);
      path(smooth([Q(3, t + 4), Q(7, t + 4.5), Q(7.4, t + 13), Q(5, b - 7)], false), `fill="none" stroke="${c(skinSh)}" stroke-width="1.4" opacity="0.7"`);
      ell(bx + s * 4.5, t + 15, 1.8, 4, `fill="${c(skinDeep)}" opacity="0.35" filter="${ref('b05')}"`);
      if (face.earrings && !earsHidden) {
        if (female) circ(bx + s * 4.2, b + 3.6, 2.8, `fill="none" stroke="#e0b860" stroke-width="1.1"`);
        else circ(bx + s * 4.2, b - 0.5, 1.2, `fill="#e0c070"`);
      }
    }
  }

  // ---------------------------------------------------------------- visage
  path(faceD, `fill="${ref('skin')}"`);
  add(`<g clip-path="${ref('fc')}">`);
  // volume : côté ombré, tempes, sous les pommettes
  ell(C + cw * 0.98, ey + 10, 19, 64, `fill="${c(skinSh)}" opacity="0.55" filter="${ref('b8')}"`);
  ell(C - cw - 4, ey + 4, 8, 50, `fill="${c(skinSh)}" opacity="0.22" filter="${ref('b4')}"`);
  for (const s of [-1, 1]) ell(C + s * (cw - 4), 80, 6, 13, `fill="${c(skinSh)}" opacity="${s > 0 ? 0.3 : 0.16}" filter="${ref('b4')}"`);
  ell(C + 25, ny + 7, 8, 10, `fill="${c(skinSh)}" opacity="0.28" filter="${ref('b4')}"`);
  ell(C - 21, ny + 7, 7, 9, `fill="${c(skinSh)}" opacity="0.1" filter="${ref('b4')}"`);
  // ombre portée sous le menton et le long de la mâchoire
  ell(C + 6, chy + 2, jw * 0.9, 6, `fill="${c(skinDeep)}" opacity="0.25" filter="${ref('b2')}"`);
  // orbites
  for (const s of [-1, 1]) ell(C + s * (ex - 1), ey - 4.5, ew + 2.5, 5.5, `fill="${c(skinSh)}" opacity="${s > 0 ? 0.36 : 0.26}" filter="${ref('b2')}"`);
  // reliefs éclairés : front, pommette gauche, menton, arête
  ell(C - 9, 76, 16, 9, `fill="${c(skinHi)}" opacity="0.3" filter="${ref('b4')}"`);
  if ((hs === 6 || hs === 5) && !hat) add(`<ellipse cx="${f(C - 13)}" cy="60" rx="13" ry="6" transform="rotate(-18 ${f(C - 13)} 60)" fill="#ffffff" opacity="${hs === 6 ? 0.3 : 0.12}" filter="${ref('b2')}"/>`);
  ell(C - 21, ny - 6, 8, 5, `fill="${c(skinHi)}" opacity="${f(0.22 + X.cheek * 0.2)}" filter="${ref('b2')}"`);
  if (X.cheek > 0) ell(C + 21, ny - 5, 7, 4.5, `fill="${c(skinHi)}" opacity="${f(X.cheek * 0.14)}" filter="${ref('b2')}"`);
  ell(C - 1.5, chy - 6, 6.5, 3.4, `fill="${c(skinHi)}" opacity="0.32" filter="${ref('b2')}"`);
  // joues rosées
  const blush = mix(skin, 0xd8604c, 0.55);
  for (const s of [-1, 1]) ell(C + s * 23, ny - 1, 9.5, 6, `fill="${c(blush)}" opacity="${f((female ? 0.26 : 0.13) + X.cheek * 0.08 + (sick > 0 ? 0.05 : 0))}" filter="${ref('b4')}"`);
  // rides
  const wr = (d: string, op: number, w = 0.9) => path(d, `fill="none" stroke="${c(skinSh)}" stroke-width="${w}" stroke-linecap="round" opacity="${f(op)}" filter="${ref('b05')}"`);
  const raised = X.browUp < -1 || X.browIn < -2;
  if (age >= 45 || raised) {
    const op = Math.min(0.42, (age >= 45 ? 0.16 + (age - 45) / 90 : 0) + (raised ? 0.12 : 0));
    for (const [i, y] of [79, 84.5].entries()) wr(`M${f(C - 16 + i * 3)},${f(y)} Q${f(C)},${f(y - 2.6)} ${f(C + 16 - i * 3)},${f(y)}`, op);
  }
  if (X.browIn > 2) for (const s of [-1, 1]) wr(`M${f(C + s * 2.6)},${f(ey - 15)} Q${f(C + s * 3.4)},${f(ey - 11)} ${f(C + s * 2.8)},${f(ey - 7.5)}`, 0.38, 1);
  if (age >= 50 || X.cheek > 0.5) {
    for (const s of [-1, 1]) {
      const ox = C + s * (ex + ew + 1.6);
      for (let i = 0; i < 3; i++) wr(`M${f(ox)},${f(ey - 1.4 + i * 2.1)} L${f(ox + s * 4.6)},${f(ey - 3.2 + i * 3.4)}`, age >= 50 ? 0.3 : 0.18, 0.7);
    }
  }
  if (age >= 55) for (const s of [-1, 1]) wr(`M${f(C + s * (ex - ew * 0.6))},${f(ey + el + 2.6)} Q${f(C + s * ex)},${f(ey + el + 5.4)} ${f(C + s * (ex + ew * 0.7))},${f(ey + el + 2.4)}`, 0.32, 0.8);
  // sillons nasogéniens
  const fold = Math.min(0.55, 0.1 + X.cheek * 0.25 + Math.max(0, age - 35) / 80);
  for (const s of [-1, 1]) wr(`M${f(C + s * 6.8 * nw)},${f(ny - 1)} C${f(C + s * (10 + mw * 0.35))},${f(ny + 5)} ${f(C + s * (mw + 3.8))},${f(my - 4)} ${f(C + s * (mw + 3.2))},${f(my + 2 - X.corner * 0.5)}`, fold * (s > 0 ? 1 : 0.75), 1.3);
  if (age >= 60) for (const s of [-1, 1]) wr(`M${f(C + s * (mw + 1))},${f(my + 2)} Q${f(C + s * (mw + 2.6))},${f(my + 7)} ${f(C + s * (mw + 1.6))},${f(my + 11)}`, 0.28);
  // taches de rousseur
  if (face.freckles) {
    add(`<g filter="${ref('b05')}">`);
    for (let i = 0; i < 34; i++) {
      const dx = (R() * 2 - 1) * 30;
      const y = ny - 13 + R() * 13 + Math.abs(dx) * 0.1;
      if (Math.abs(dx) < 4.5 && y > ny - 6) continue;
      circ(C + dx, y, 0.4 + R() * 0.5, `fill="${c(tone(skin, 0.6))}" opacity="${f(0.3 + R() * 0.35)}"`);
    }
    add('</g>');
  }
  // suie
  if (face.grime > 0.05) {
    const g = face.grime;
    const spots: [number, number, number, number, number][] = [[C + 24, ny + 2, 7.5, 4.5, -20], [C - 15, 80, 6.5, 3, 10], [C + 7, chy - 5, 5, 2.4, 0], [C - 27, ny + 7, 4, 3, 30]];
    for (const [x, y, rx, ry, rot] of spots) add(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${rot} ${f(x)} ${f(y)})" fill="#3e342b" opacity="${f(g * 0.34)}" filter="${ref('b2')}"/>`);
    path(`M${f(C + 18)},${f(ny + 4)} l9,-3 M${f(C + 20)},${f(ny + 7)} l7,-2`, `stroke="#3e342b" stroke-width="1.2" stroke-linecap="round" opacity="${f(g * 0.3)}" filter="${ref('b05')}"`);
  }
  // malade : cernes
  if (sick > 0) for (const s of [-1, 1]) ell(C + s * ex, ey + el + 3, ew, 3.2, `fill="#5a4250" opacity="${f(0.2 + sick * 0.25)}" filter="${ref('b2')}"`);
  // ombre portée par la chevelure et le couvre-chef
  const hairFront = hairFrontPath();
  if (hairFront) path(hairFront, `fill="${c(skinDeep)}" opacity="0.42" transform="translate(1.2 3.2)" filter="${ref('b2')}"`);
  if (hat === 1) ell(C + 2, 92, 42, 9, `fill="#1a120c" opacity="0.38" filter="${ref('b4')}"`);
  else if (hat === 2) ell(C + 2, 90, 40, 5, `fill="#1a120c" opacity="0.3" filter="${ref('b2')}"`);
  else if (hat === 3 || hat === 5) ell(C + 2, 90, 48, 15, `fill="#1a120c" opacity="${hat === 3 ? 0.46 : 0.32}" filter="${ref('b8')}"`);
  else if (hat === 4) ell(C + 2, 94, 46, 8, `fill="#1a120c" opacity="0.36" filter="${ref('b4')}"`);
  // contre-jour
  path(faceD, `fill="none" stroke="${ref('rim')}" stroke-width="3" filter="${ref('b1')}"`);
  path(faceD, `fill="none" stroke="${ref('rimL')}" stroke-width="2.5" filter="${ref('b1')}"`);
  add('</g>');

  // ---------------------------------------------------------------- cicatrice de joue
  if (face.scar === 1) {
    const d = `M${f(C + 20)},${f(ey + 7)} Q${f(C + 26.5)},${f(ey + 15)} ${f(C + 28)},${f(ey + 26)}`;
    path(d, `fill="none" stroke="${c(mix(skin, 0xe7b0a0, 0.55))}" stroke-width="2.4" stroke-linecap="round"`);
    path(d, `fill="none" stroke="${c(mix(skin, 0x8a4038, 0.45))}" stroke-width="0.7" stroke-linecap="round" opacity="0.8"`);
    for (const t of [0.25, 0.5, 0.75]) {
      const x = C + 20 + 8 * t + t * (1 - t) * 4;
      const y = ey + 7 + 19 * t;
      path(`M${f(x - 2)},${f(y + 0.8)} L${f(x + 2)},${f(y - 0.8)}`, `stroke="${c(mix(skin, 0x8a4038, 0.4))}" stroke-width="0.6" opacity="0.7"`);
    }
  }

  // ---------------------------------------------------------------- nez
  {
    const t = ny;
    const k = nw;
    path(`M${f(C + 3.6)},${f(ey - 3)} C${f(C + 5.6)},${f(ey + 6)} ${f(C + 6 * k)},${f(t - 9)} ${f(C + 6.4 * k)},${f(t - 2)}`, `fill="none" stroke="${c(skinSh)}" stroke-width="3.4" opacity="0.4" filter="${ref('b1')}"`);
    path(`M${f(C - 3.6)},${f(ey - 1)} C${f(C - 5)},${f(ey + 8)} ${f(C - 5.6 * k)},${f(t - 8)} ${f(C - 6 * k)},${f(t - 2)}`, `fill="none" stroke="${c(skinSh)}" stroke-width="1.6" opacity="0.16" filter="${ref('b1')}"`);
    path(`M${f(C - 0.9)},${f(ey - 1)} L${f(C - 0.6)},${f(t - 6)}`, `fill="none" stroke="${c(skinHi)}" stroke-width="1.8" opacity="0.4" filter="${ref('b05')}"`);
    ell(C + 0.6, t + 1.8, 6 * k, 2, `fill="${c(skinSh)}" opacity="0.5" filter="${ref('b1')}"`);
    ell(C - 0.6, t - 2.3, 3.4 * k, 2.8, `fill="${c(skinHi)}" opacity="0.55" filter="${ref('b1')}"`);
    for (const s of [-1, 1]) {
      path(`M${f(C + s * 4.6 * k)},${f(t - 4.6)} C${f(C + s * 7.5 * k)},${f(t - 3.6)} ${f(C + s * 7.7 * k)},${f(t + 0.8)} ${f(C + s * 4.4 * k)},${f(t + 1.3)}`, `fill="none" stroke="${c(skinSh)}" stroke-width="1.1" stroke-linecap="round" opacity="${s > 0 ? 0.85 : 0.6}"`);
      add(`<ellipse cx="${f(C + s * 2.8 * k)}" cy="${f(t + 1.1)}" rx="${f(1.6 * k)}" ry="0.85" transform="rotate(${s * 18} ${f(C + s * 2.8 * k)} ${f(t + 1.1)})" fill="${c(skinDeep)}" opacity="0.8"/>`);
    }
    ell(C + 1, t + 4.6, 3.6, 2, `fill="${c(skinSh)}" opacity="0.22" filter="${ref('b1')}"`);
  }

  // ---------------------------------------------------------------- yeux
  const eye = (s: number) => {
    const cx = C + s * ex;
    const cy = ey;
    const tilt = 0.5;
    const openU = eu * (1 - X.lid * 0.62);
    const ix = cx - s * ew; // coin interne
    const ox = cx + s * ew; // coin externe
    const almond = (u: number, l: number) =>
      `M${f(ix)},${f(cy + 0.5)} C${f(cx - s * ew * 0.5)},${f(cy - u * 1.28)} ${f(cx + s * ew * 0.52)},${f(cy - u * 1.28)} ${f(ox)},${f(cy - tilt)} C${f(cx + s * ew * 0.55)},${f(cy + l * 1.25)} ${f(cx - s * ew * 0.5)},${f(cy + l * 1.25)} ${f(ix)},${f(cy + 0.5)} Z`;
    const upper = (u: number) => `M${f(ix)},${f(cy + 0.5)} C${f(cx - s * ew * 0.5)},${f(cy - u * 1.28)} ${f(cx + s * ew * 0.52)},${f(cy - u * 1.28)} ${f(ox)},${f(cy - tilt)}`;
    const opening = almond(openU, el);
    const k = s > 0 ? 'eR' : 'eL';
    clip(k, opening);
    // pli de la paupière
    path(`M${f(cx - s * ew * 0.75)},${f(cy - eu - 1.6)} Q${f(cx + s * ew * 0.1)},${f(cy - eu - 4.4)} ${f(cx + s * ew * 0.95)},${f(cy - eu * 0.9 - 1)}`, `fill="none" stroke="${c(skinSh)}" stroke-width="1.1" opacity="0.55" filter="${ref('b05')}"`);
    if (X.lid > 0.05) path(`M${f(ix)},${f(cy + 0.5)} C${f(cx - s * ew * 0.5)},${f(cy - eu * 1.28)} ${f(cx + s * ew * 0.52)},${f(cy - eu * 1.28)} ${f(ox)},${f(cy - tilt)} C${f(cx + s * ew * 0.52)},${f(cy - openU * 1.28)} ${f(cx - s * ew * 0.5)},${f(cy - openU * 1.28)} ${f(ix)},${f(cy + 0.5)} Z`, `fill="${c(mix(skin, skinSh, 0.35))}"`);
    // blanc de l'œil
    const white = sick > 0.3 ? 0xf0dcd4 : 0xf3eee6;
    path(opening, `fill="${c(white)}"`);
    add(`<g clip-path="${ref(k)}">`);
    add(`<g class="pt-iris">`);
    const ir = 4.8 * (ew / 8.5);
    const icx = cx + X.glance;
    const icy = cy + 0.3;
    rad(`${k}i`, icx, icy, ir, [[0, mix(face.eyes, 0xffffff, 0.3)], [0.35, mix(face.eyes, 0xffffff, 0.12)], [0.75, face.eyes], [0.92, tone(face.eyes, 0.55)], [1, tone(face.eyes, 0.35)]], icx - 1, icy + 1.2);
    circ(icx, icy, ir, `fill="${ref(`${k}i`)}"`);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      path(`M${f(icx + Math.cos(a) * ir * 0.45)},${f(icy + Math.sin(a) * ir * 0.45)} L${f(icx + Math.cos(a) * ir * 0.9)},${f(icy + Math.sin(a) * ir * 0.9)}`, `stroke="${c(mix(face.eyes, 0xffffff, 0.35))}" stroke-width="0.4" opacity="0.5"`);
    }
    circ(icx, icy, ir * 0.44, `fill="#0c0807"`);
    circ(icx - ir * 0.36, icy - ir * 0.38, ir * 0.24, `fill="#ffffff" opacity="0.92"`);
    circ(icx + ir * 0.38, icy + ir * 0.3, ir * 0.11, `fill="#ffffff" opacity="0.6"`);
    add('</g>');
    // ombre de la paupière sur l'œil
    path(upper(openU), `fill="none" stroke="#3a2418" stroke-width="3.4" opacity="0.32" transform="translate(0 1.4)" filter="${ref('b1')}"`);
    add('</g>');
    // caroncule
    ell(ix + s * 1.2, cy + 0.6, 1.3, 1.1, `fill="${c(mix(skin, 0xd07a70, 0.45))}" opacity="0.8"`);
    // ligne de cils
    path(upper(openU), `fill="none" stroke="${c(lash)}" stroke-width="${female ? 2.1 : 1.6}" stroke-linecap="round"`);
    if (female) path(`M${f(ox - s * 1.4)},${f(cy - tilt - 0.7)} Q${f(ox + s * 1.2)},${f(cy - tilt - 1.2)} ${f(ox + s * 2)},${f(cy - tilt - 2.6)}`, `fill="none" stroke="${c(lash)}" stroke-width="1" stroke-linecap="round"`);
    // paupière inférieure
    path(`M${f(ix + s * 1.5)},${f(cy + 1.4)} C${f(cx - s * ew * 0.4)},${f(cy + el * 1.28)} ${f(cx + s * ew * 0.5)},${f(cy + el * 1.25)} ${f(ox - s * 0.4)},${f(cy - tilt + 0.4)}`, `fill="none" stroke="${c(skinSh)}" stroke-width="0.9" opacity="0.65"`);
    // clignement
    add(`<g class="pt-lids">`);
    path(almond(eu + 0.6, el + 0.6), `fill="${c(mix(skin, skinSh, 0.22))}"`);
    path(`M${f(ix)},${f(cy + 0.8)} C${f(cx - s * ew * 0.45)},${f(cy + el * 0.95)} ${f(cx + s * ew * 0.5)},${f(cy + el * 0.95)} ${f(ox)},${f(cy - tilt + 0.4)}`, `fill="none" stroke="${c(lash)}" stroke-width="${female ? 1.8 : 1.4}" stroke-linecap="round"`);
    add('</g>');
  };
  eye(-1);
  eye(1);

  // ---------------------------------------------------------------- sourcils
  for (const s of [-1, 1]) {
    const by = ey - 11.5 + X.browUp + (s < 0 ? X.asym : 0) + (face.shape === 3 ? 0.5 : 0);
    const th = 2.6 * face.brows;
    const ix = C + s * (ex - ew * 0.95);
    const iy = by + X.browIn;
    const px = C + s * (ex + ew * 0.3);
    const py = by - 2.4 + X.browIn * 0.25;
    const ox = C + s * (ex + ew * 1.3);
    const oy = by + 1.6 + X.browOut;
    const pts: Pt[] = [[ix, iy - th * 0.62], [px, py - th * 0.5], [ox, oy - 0.3], [ox + s * 0.4, oy + 0.4], [px, py + th * 0.42], [ix - s * 0.3, iy + th * 0.6]];
    const d = smooth(pts);
    path(d, `fill="${c(browC)}" opacity="0.92"`);
    path(d, `fill="none" stroke="${c(browC)}" stroke-width="0.6" opacity="0.35" filter="${ref('b05')}"`);
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      const x = ix + (ox - ix) * t;
      const y = iy + (oy - iy) * t - Math.sin(t * Math.PI) * 2.6;
      path(`M${f(x)},${f(y + th * 0.3)} L${f(x + s * 2.2)},${f(y - th * 0.3)}`, `stroke="${c(mix(browC, 0xffffff, 0.25))}" stroke-width="0.4" opacity="0.4"`);
    }
  }
  if (face.scar === 2) {
    const d = `M${f(C - ex - 1)},${f(ey - 19)} L${f(C - ex - 3.2)},${f(ey - 5)}`;
    path(d, `stroke="${c(mix(skin, 0xe7b0a0, 0.45))}" stroke-width="2" stroke-linecap="round"`);
    path(d, `stroke="${c(mix(skin, 0x8a4038, 0.4))}" stroke-width="0.6" opacity="0.7"`);
  }

  // ---------------------------------------------------------------- bouche
  {
    const cuL = X.corner;
    const cuR = X.corner + X.cornerAsym;
    const lx = C - mw;
    const rx = C + mw;
    const ly = my - cuL;
    const ry = my - cuR;
    const sag = 0.9 - (cuL + cuR) * 0.12;
    const line = (dy: number) => `M${f(lx)},${f(ly)} C${f(C - mw * 0.4)},${f(my + sag - dy)} ${f(C + mw * 0.4)},${f(my + sag - dy)} ${f(rx)},${f(ry)}`;
    const lowerLip = (open: number) => {
      const o = open;
      const d = `M${f(lx + 0.6)},${f(ly + o * 0.5)} C${f(C - mw * 0.4)},${f(my + sag + o)} ${f(C + mw * 0.4)},${f(my + sag + o)} ${f(rx - 0.6)},${f(ry + o * 0.5)} C${f(C + mw * 0.72)},${f(my + lt * 0.95 + o)} ${f(C + mw * 0.34)},${f(my + lt * 1.12 + o)} ${f(C)},${f(my + lt * 1.08 + o)} C${f(C - mw * 0.34)},${f(my + lt * 1.12 + o)} ${f(C - mw * 0.72)},${f(my + lt * 0.95 + o)} ${f(lx + 0.6)},${f(ly + o * 0.5)} Z`;
      path(d, `fill="${c(lip)}"`);
      ell(C - 1.2, my + lt * 0.55 + o, mw * 0.36, Math.max(0.6, lt * 0.22), `fill="#ffffff" opacity="${female ? 0.3 : 0.16}" filter="${ref('b05')}"`);
      ell(C + 0.5, my + lt + 3 + o, mw * 0.62, 2, `fill="${c(skinSh)}" opacity="0.32" filter="${ref('b1')}"`);
    };
    const interior = (open: number) => {
      const d = `M${f(lx + 0.8)},${f(ly)} C${f(C - mw * 0.4)},${f(my + sag - 0.5)} ${f(C + mw * 0.4)},${f(my + sag - 0.5)} ${f(rx - 0.8)},${f(ry)} C${f(C + mw * 0.6)},${f(my + sag + open)} ${f(C - mw * 0.6)},${f(my + sag + open)} ${f(lx + 0.8)},${f(ly)} Z`;
      const k = `m${open > 4 ? 'o' : 'm'}`;
      clip(k, d);
      path(d, `fill="#3a1512"`);
      add(`<g clip-path="${ref(k)}">`);
      add(`<rect x="${f(lx)}" y="${f(my + sag - 3)}" width="${f(mw * 2)}" height="${f(open > 4 ? 4.6 : 3.4)}" rx="1.2" fill="#efe7dc"/>`);
      if (open > 4) {
        ell(C, my + sag + open - 0.6, mw * 0.55, 2.6, `fill="#a4443e"`);
        add(`<rect x="${f(lx)}" y="${f(my + sag + open - 1.6)}" width="${f(mw * 2)}" height="2" fill="#d9cfc4" opacity="0.7"/>`);
      }
      add('</g>');
    };
    // lèvre supérieure (commune aux trois positions)
    const upperLip = `M${f(lx)},${f(ly)} C${f(C - mw * 0.72)},${f(my - ut * 0.6 - cuL * 0.4)} ${f(C - mw * 0.38)},${f(my - ut - 0.2)} ${f(C - mw * 0.16)},${f(my - ut)} Q${f(C)},${f(my - ut * 0.6)} ${f(C + mw * 0.16)},${f(my - ut)} C${f(C + mw * 0.38)},${f(my - ut - 0.2)} ${f(C + mw * 0.72)},${f(my - ut * 0.6 - cuR * 0.4)} ${f(rx)},${f(ry)} C${f(C + mw * 0.4)},${f(my + sag)} ${f(C - mw * 0.4)},${f(my + sag)} ${f(lx)},${f(ly)} Z`;
    // philtrum
    path(`M${f(C - 2.2)},${f(ny + 3.5)} L${f(C - 2.4)},${f(my - ut)} M${f(C + 2.2)},${f(ny + 3.5)} L${f(C + 2.4)},${f(my - ut)}`, `stroke="${c(skinSh)}" stroke-width="0.9" opacity="0.28" filter="${ref('b05')}"`);
    add(`<g class="pt-mouth-closed">`);
    lowerLip(0);
    add('</g>');
    add(`<g class="pt-mouth-mid">`);
    interior(3.4);
    lowerLip(2.6);
    add('</g>');
    add(`<g class="pt-mouth-open">`);
    interior(6.8);
    lowerLip(5.6);
    add('</g>');
    path(upperLip, `fill="${c(tone(lip, 0.86))}"`);
    path(`M${f(C - mw * 0.5)},${f(my - ut * 0.75)} Q${f(C)},${f(my - ut * 1.25)} ${f(C + mw * 0.5)},${f(my - ut * 0.75)}`, `fill="none" stroke="${c(skinHi)}" stroke-width="0.8" opacity="0.4" filter="${ref('b05')}"`);
    path(line(0), `fill="none" stroke="${c(mix(lip, 0x2a0d0a, 0.62))}" stroke-width="1.15" stroke-linecap="round"`);
    for (const [x, y, s] of [[lx, ly, -1], [rx, ry, 1]] as [number, number, number][]) {
      path(`M${f(x - s * 1.2)},${f(y - 0.2)} Q${f(x + s * 0.6)},${f(y - 0.6)} ${f(x + s * 1.4)},${f(y + 0.8)}`, `fill="none" stroke="${c(skinSh)}" stroke-width="0.9" stroke-linecap="round" opacity="0.55"`);
    }
  }

  // ---------------------------------------------------------------- barbe
  if (face.beard) drawBeard();

  // ---------------------------------------------------------------- malade, pansement
  if (sick > 0.25) {
    for (const [x, y, s] of [[C - 23, 82, 1], [C + 27, 92, 0.8], [C + 14, 77, 0.7]] as [number, number, number][]) {
      path(`M${f(x)},${f(y - 3 * s)} C${f(x + 2.2 * s)},${f(y)} ${f(x + 1.8 * s)},${f(y + 2.6 * s)} ${f(x)},${f(y + 2.6 * s)} C${f(x - 1.8 * s)},${f(y + 2.6 * s)} ${f(x - 2.2 * s)},${f(y)} ${f(x)},${f(y - 3 * s)} Z`, `fill="#e8f2f6" opacity="0.7"`);
      circ(x - 0.6 * s, y + 0.8 * s, 0.6 * s, `fill="#ffffff"`);
    }
  }
  if (spec.hurt) {
    const x = C - 23;
    const y = ey + 15;
    for (const a of [38, -38]) add(`<rect x="${f(x - 7.5)}" y="${f(y - 2.3)}" width="15" height="4.6" rx="1.6" transform="rotate(${a} ${f(x)} ${f(y)})" fill="#e6d8bd" stroke="${c(tone(0xe6d8bd, 0.72))}" stroke-width="0.5"/>`);
    circ(x, y, 1.6, `fill="#b8483c" opacity="0.5" filter="${ref('b05')}"`);
  }

  // ---------------------------------------------------------------- lunettes (sous la frange)
  if (look.accessory === 2) {
    const fr = '#2a221c';
    for (const s of [-1, 1]) {
      const cx = C + s * ex;
      const w = ew * 2 + 6;
      const h2 = eu * 2 + 5.5;
      add(`<rect x="${f(cx - w / 2 + 1)}" y="${f(ey - h2 / 2 + 2.4)}" width="${f(w)}" height="${f(h2)}" rx="5.5" fill="none" stroke="${c(skinDeep)}" stroke-width="1.4" opacity="0.25" filter="${ref('b1')}"/>`);
      add(`<rect x="${f(cx - w / 2)}" y="${f(ey - h2 / 2 + 0.6)}" width="${f(w)}" height="${f(h2)}" rx="5.5" fill="#dfe8ee" fill-opacity="0.08" stroke="${fr}" stroke-width="1.5"/>`);
      path(`M${f(cx - w / 2 + 3)},${f(ey + 2)} L${f(cx - w / 2 + 7.5)},${f(ey - h2 / 2 + 2.6)}`, `stroke="#ffffff" stroke-width="1.6" opacity="0.32" stroke-linecap="round"`);
      path(`M${f(cx + s * (w / 2))},${f(ey - 1.5)} L${f(C + s * (cw - 0.6))},${f(ey - 2.6)}`, `stroke="${fr}" stroke-width="1.3"`);
    }
    path(`M${f(C - ex + ew + 3)},${f(ey - 1.2)} Q${f(C)},${f(ey - 4.5)} ${f(C + ex - ew - 3)},${f(ey - 1.2)}`, `fill="none" stroke="${fr}" stroke-width="1.5"`);
  }

  // ---------------------------------------------------------------- chevelure (devant)
  if (hairFront) drawHairFront(hairFront);

  // ---------------------------------------------------------------- couvre-chefs
  if (hat) drawHat();

  add('</g>'); // tête
  add('</g>'); // buste

  // lumière chaude d'ambiance et vignettage
  add(`<rect x="0" y="0" width="200" height="240" fill="${ref('vig')}"/>`);
  rad('vig', 96, 104, 150, [[0.55, 0x000000, 0], [1, 0x000000, 0.5]]);

  const vb = opts.crop ? '40 36 120 120' : '12 15 176 211.2';
  return `<svg class="pt${opts.anim ? ' pt-anim' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs.join('')}</defs>${out.join('')}</svg>`;

  // ================================================================= sous-parties
  function hairFrontPath(): string | null {
    if (hs === 6) {
      const tuft = (s: number) => smooth([[C + s * (cw - 3), 84], [C + s * (cw + 0.8), 81], [C + s * (cw + 2.2), 93], [C + s * (cw + 0.8), 105], [C + s * (cw - 1.2), 108], [C + s * (cw - 2.2), 96]]);
      return tuft(-1) + tuft(1);
    }
    if (hs === 5) {
      const inner = hairline(64, 0, 0);
      return smooth([[C - cw + 0.5, 100], [C - cw + 0.5, 92], [C - 34.8, 70], [C - 25, 53.6], [C, 49.4], [C + 25, 53.6], [C + 34.8, 70], [C + cw - 0.5, 92], [C + cw - 0.5, 100], ...inner]);
    }
    const vol = hs === 3 ? 2.5 : hs === 0 ? (female ? 5 : 4) : 6.5;
    const top = 46 - vol;
    const J = (a: number) => (R() - 0.5) * a;
    const outerTop: Pt[] = [
      [C - 35 - vol * 0.35, 62 + J(1)], [C - 30 - vol * 0.2, 51 + J(1)], [C - 21, top + 4 + J(1.4)], [C - 11, top + 1 + J(1)], [C - 1, top + J(1)],
      [C + 10, top + 0.6 + J(1)], [C + 21, top + 3.6 + J(1.4)], [C + 30 + vol * 0.2, top + 9 + J(1)], [C + 37 + vol * 0.3, 63 + J(1)],
    ];
    const inner = hairline(hs === 3 ? 67 : 69, sweepAmt(), centerPart || hs === 4 || hs === 3 ? 0 : -3);
    if (hs === 2 || (hs === 1 && female)) {
      const { len, flare } = curtain();
      const L = len - 88;
      const out = (t: number) => cw + 4 + flare * Math.pow(t, 1.2);
      const inn = (t: number) => cw - 3 + flare * 0.4 * Math.pow(t, 1.5);
      const right: Pt[] = [
        [C + out(0), 86], [C + out(0.33) + J(1), 88 + L * 0.33], [C + out(0.66) + J(1), 88 + L * 0.66], [C + out(1), len - 4],
        [C + (out(1) + inn(1)) / 2 + 1, len + 2], [C + inn(1), len - 5], [C + inn(0.6), 88 + L * 0.6], [C + inn(0.3), 88 + L * 0.3], [C + cw - 3.2, 96],
      ];
      const left: Pt[] = mirror(right).reverse();
      return smooth([...left, ...outerTop, ...right, ...inner]);
    }
    const sideB = female ? 102 : hs === 1 ? 114 : 109;
    return smooth([[C - cw + 1.6, sideB], [C - cw - 1.2, 104], [C - cw - 2.2 - vol * 0.15, 86], ...outerTop, [C + cw + 2.2 + vol * 0.15, 86], [C + cw + 1.2, 104], [C + cw - 1.6, sideB], ...inner]);
  }

  /** Longueur et évasement des mèches latérales (cheveux mi-longs et longs). */
  function curtain(): { len: number; flare: number } {
    if (hs === 2) return { len: 184, flare: 13 };
    return female ? { len: 152, flare: 8 } : { len: 130, flare: 4 };
  }

  function sweepAmt(): number {
    if (centerPart || bangs || hs === 3 || hs === 4) return 0;
    if (female) return hs === 0 ? 9 : 6.5;
    return hs === 0 ? 2.6 : 4;
  }

  /** Hauteur de la ligne d'implantation en x. */
  function hlY(x: number, base: number, sweep: number, part: number): number {
    const px = centerPart || hs === 4 ? C : C - sd * 14;
    const dx = Math.min(1, Math.abs(x - C) / (cw - 3));
    let y = base + 23 * Math.pow(dx, 2.4);
    if (bangs) y = Math.max(y, 84 - 3 * Math.pow(dx, 2) + (Math.abs(x - C) < 26 ? Math.sin(x * 0.9) * 0.8 : 0));
    if (sweep) y += sweep * Math.exp(-Math.pow((x - (C + sd * 10)) / 15, 2));
    if (part) y += part * Math.exp(-Math.pow((x - px) / 4, 2));
    if (centerPart) y -= 4 * Math.exp(-Math.pow((x - C) / 6, 2));
    return y;
  }

  /** Ligne d'implantation, de droite à gauche (vue de face). */
  function hairline(base: number, sweep: number, part: number): Pt[] {
    const xs = [C + cw - 3.4, C + cw - 6, C + 26, C + 18, C + 10, C + 2, C - 6, C - 14, C - 22, C - 29, C - cw + 6, C - cw + 3.4];
    return xs.map((x): Pt => [x, hlY(x, base, sweep, part)]);
  }

  function drawHairFront(d: string): void {
    clip('hc', d);
    if (hs === 5) {
      path(d, `fill="${c(hair)}" opacity="0.5" filter="${ref('b05')}"`);
      dots('hd', tone(hair, 0.7), 1.6, 0.34);
      path(d, `fill="${ref('hd')}" opacity="0.7"`);
      add(`<g clip-path="${ref('hc')}">`);
      ell(C - 12, 58, 16, 6, `fill="#ffffff" opacity="0.18" filter="${ref('b2')}"`);
      add('</g>');
      return;
    }
    if (hs === 6) {
      path(d, `fill="${ref('hair')}"`);
      add(`<g clip-path="${ref('hc')}">`);
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) path(`M${f(C + s * (cw - 2.6 + i))},83 Q${f(C + s * (cw + 0.6 + i))},95 ${f(C + s * (cw - 1.6 + i * 0.8))},107`, `fill="none" stroke="${c(i % 2 ? hairHi : hairSh)}" stroke-width="0.6" opacity="0.55"`);
      add('</g>');
      path(d, `fill="none" stroke="${c(hair)}" stroke-width="0.8" opacity="0.6" filter="${ref('b05')}"`);
      return;
    }
    const long = hs === 2 || (hs === 1 && female);
    const base = hs === 3 ? 67 : 69;
    const sw = sweepAmt();
    const pt = centerPart || hs === 4 || hs === 3 ? 0 : -3;
    path(d, `fill="${ref(long ? 'hairLong' : 'hair')}"`);
    add(`<g clip-path="${ref('hc')}">`);
    // volume : ombre côté droit, bandeau de brillance qui suit l'arrondi du crâne
    ell(C + 42, 100, 16, 76, `fill="${c(hairSh)}" opacity="0.55" filter="${ref('b8')}"`);
    ell(C, 74, 40, 6, `fill="${c(hairSh)}" opacity="0.35" filter="${ref('b4')}"`);
    path(`M${f(C - 33)},66 Q${f(C - 18)},45 ${f(C + 10)},46`, `fill="none" stroke="${c(hairHi)}" stroke-width="6" stroke-linecap="round" opacity="0.42" filter="${ref('b2')}"`);
    // mèches : de la raie (ou du sommet) vers la ligne d'implantation, en suivant le crâne
    const ox = centerPart || hs === 4 || hs === 3 ? C : C - sd * 14;
    const oy = hs === 3 ? 40 : 43;
    const n = hs === 3 ? 30 : 40;
    for (let i = 0; i < n; i++) {
      const tx = C - cw + 2 + R() * (cw * 2 - 4);
      const ty = hlY(tx, base, sw, pt) + 1.5;
      const sx = ox + (R() - 0.5) * 7;
      const sy = oy + R() * 3;
      const dir = tx > sx ? 1 : -1;
      const q1x = sx + (tx - sx) * 0.25 + dir * 5;
      const q2x = tx + dir * 3;
      const dark = R() < 0.62;
      path(`M${f(sx)},${f(sy)} C${f(q1x)},${f(sy - 2)} ${f(q2x)},${f(ty - 14)} ${f(tx)},${f(ty)}`, `fill="none" stroke="${c(dark ? hairSh : hairHi)}" stroke-width="${f(0.45 + R() * 0.9)}" opacity="${f(dark ? 0.2 + R() * 0.2 : 0.16 + R() * 0.18)}"`);
    }
    // mèche balayée sur le front
    if (sw > 3) {
      for (let i = 0; i < 7; i++) {
        const y0 = 50 + i * 2.4;
        path(`M${f(ox)},${f(y0)} Q${f(C + sd * 2)},${f(y0 + 18)} ${f(C + sd * (18 + i * 2.6))},${f(hlY(C + sd * (18 + i * 2.6), base, sw, pt) + 0.5)}`, `fill="none" stroke="${c(i % 2 ? hairHi : hairSh)}" stroke-width="${f(0.6 + (i % 3) * 0.3)}" opacity="0.4"`);
      }
    }
    // rideaux : mèches verticales et reflet du côté de la lumière
    if (long) {
      const { len, flare } = curtain();
      for (const s of [-1, 1]) {
        for (let i = 0; i < 7; i++) {
          const k = i / 6;
          const x0 = C + s * (cw - 1 + k * 5);
          const x1 = C + s * (cw - 1 + flare * 0.3 + k * (flare * 0.8 + 4));
          path(`M${f(x0)},90 C${f(x0 + s * 3)},${f(90 + (len - 90) * 0.35)} ${f(x1 - s * 2)},${f(90 + (len - 90) * 0.7)} ${f(x1)},${f(len - 2)}`, `fill="none" stroke="${c(i % 3 === 1 ? hairHi : hairSh)}" stroke-width="${f(0.6 + (i % 2) * 0.5)}" opacity="${i % 3 === 1 ? 0.35 : 0.45}"`);
        }
        const hx = C + s * (cw + 2 + flare * 0.25);
        path(`M${f(hx)},100 C${f(hx + s * 2)},${f(100 + (len - 100) * 0.4)} ${f(hx + s * flare * 0.3)},${f(len - 30)} ${f(hx + s * flare * 0.45)},${f(len - 14)}`, `fill="none" stroke="${c(hairHi)}" stroke-width="2.6" stroke-linecap="round" opacity="${s < 0 ? 0.38 : 0.14}" filter="${ref('b1')}"`);
      }
    }
    // raie
    if (hs !== 3 && hs !== 0) path(`M${f(ox)},${f(oy - 2)} L${f(ox + (ox === C ? 0 : -sd * 1))},${f(hlY(ox, base, sw, pt) - 1)}`, `stroke="${c(hairSh)}" stroke-width="1.1" opacity="0.6"`);
    add('</g>');
    // bord adouci, mèches folles, contre-jour
    path(d, `fill="none" stroke="${c(tone(hair, 0.85))}" stroke-width="1.1" opacity="0.55" filter="${ref('b05')}"`);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.12 + R() * 0.76);
      const x = C - Math.cos(a) * 41;
      const y = 76 - Math.sin(a) * 34;
      path(`M${f(x)},${f(y + 3)} q${f((R() - 0.5) * 6)},${f(-3 - R() * 3)} ${f((R() - 0.5) * 9)},${f(-4 - R() * 4)}`, `fill="none" stroke="${c(i % 2 ? hairHi : hair)}" stroke-width="0.55" opacity="0.5"`);
    }
    for (let i = 0; i < 5 && !bangs; i++) {
      const x = C - 22 + R() * 44;
      const y = hlY(x, base, sw, pt);
      path(`M${f(x)},${f(y - 3)} q${f(sd * 1.5)},${f(2.4)} ${f(sd * (1 + R() * 2))},${f(4 + R() * 3)}`, `fill="none" stroke="${c(hair)}" stroke-width="0.6" opacity="0.55"`);
    }
    add(`<g clip-path="${ref('hc')}">`);
    path(d, `fill="none" stroke="${ref('rim')}" stroke-width="3" filter="${ref('b1')}"`);
    add('</g>');
  }

  function drawBeard(): void {
    const bc = tone(hair, hairLight ? 0.92 : 1);
    const bhi = hairHi;
    const mustache = () => {
      const d = smooth(sym([C, ny + 3.9], [[C + 4.2, ny + 3.1], [C + 9, ny + 4.4], [C + mw + 1.6, my - 2.6], [C + mw + 3, my + 1.4], [C + mw + 0.4, my + 0.2], [C + mw * 0.55, my - 1.4]], [C, my - 1.9]));
      lin('mu', 0, ny + 3, 0, my, [[0, mix(bc, hairHi, 0.25)], [1, tone(bc, 0.8)]]);
      path(d, `fill="${ref('mu')}"`);
      for (let i = 0; i < 10; i++) {
        const s = i % 2 ? 1 : -1;
        const x = C + s * (1.5 + (i >> 1) * 2.2);
        path(`M${f(x)},${f(ny + 4)} L${f(x + s * 2.4)},${f(my - 0.5)}`, `stroke="${c(i % 3 ? hairSh : bhi)}" stroke-width="0.5" opacity="0.5"`);
      }
      path(d, `fill="none" stroke="${c(hairSh)}" stroke-width="0.6" opacity="0.6"`);
    };
    if (face.beard === 1) {
      const rx = mw + 1.8;
      const ry = (ut + lt) / 2 + 1.4;
      const cy = my + (lt - ut) / 2;
      const hole = `M${f(C - rx)},${f(cy)} a${f(rx)},${f(ry)} 0 1,0 ${f(rx * 2)},0 a${f(rx)},${f(ry)} 0 1,0 ${f(-rx * 2)},0 Z`;
      const d = smooth(sym([C, ny + 3.4], [[C + 7, ny + 2.6], [C + mw + 4, my - 4], [C + 18, ny - 1], [C + cw - 5, ny - 6], [C + cw - 1, 104], [C + cw - 0.4, 114], [C + jw, jy], [C + chw, chy - 3]], [C, chy + 0.5])) + hole;
      dots('bd', tone(hair, 0.8), 1.1, 0.2);
      add(`<g clip-path="${ref('fc')}">`);
      path(d, `fill="${c(mix(skin, hair, 0.6))}" fill-rule="evenodd" opacity="0.42" filter="${ref('b2')}"`);
      path(d, `fill="${ref('bd')}" fill-rule="evenodd" opacity="0.4" filter="${ref('b05')}"`);
      add('</g>');
      return;
    }
    if (face.beard === 3) {
      const inner: Pt[] = [[C + cw - 4.5, ey - 3], [C + cw - 7.5, ny - 6], [C + 19, ny + 3.5], [C + mw + 4, my + 0.5], [C + mw + 1.5, my + lt + 2.5], [C + 5, my + lt + 4]];
      const outer: Pt[] = [[C + cw + 0.6, ey - 4], [C + cw + 1.2, ny - 8], [C + jw + 3, jy + 2], [C + chw + 4, chy + 4]];
      const d = smooth([...inner, ...mirror(inner).reverse(), ...mirror(outer), [C, chy + 8], ...outer.reverse()]);
      clip('bc', d);
      path(d, `fill="${c(bc)}"`);
      add(`<g clip-path="${ref('bc')}">`);
      ell(C + 26, 140, 16, 30, `fill="${c(hairSh)}" opacity="0.6" filter="${ref('b4')}"`);
      ell(C - 18, 132, 10, 16, `fill="${c(bhi)}" opacity="0.25" filter="${ref('b4')}"`);
      for (let i = 0; i < 46; i++) {
        const x = C - cw + R() * cw * 2;
        const y = 112 + R() * (chy - 104);
        path(`M${f(x)},${f(y)} q${f((C - x) * 0.05)},${f(3 + R() * 2)} ${f((C - x) * 0.06 + (R() - 0.5) * 2)},${f(5 + R() * 3)}`, `fill="none" stroke="${c(i % 3 ? hairSh : bhi)}" stroke-width="0.6" opacity="0.5"`);
      }
      add('</g>');
      path(d, `fill="none" stroke="${c(hairSh)}" stroke-width="0.7" opacity="0.4"`);
    }
    if (face.beard === 4) {
      const d = smooth([[C + mw + 1, my + 1.5], [C + mw - 0.5, my + lt + 6], [C + 6, chy + 4.5], [C, chy + 6], [C - 6, chy + 4.5], [C - mw + 0.5, my + lt + 6], [C - mw - 1, my + 1.5], [C - mw + 1.5, my + lt + 1.8], [C, my + lt + 2.8], [C + mw - 1.5, my + lt + 1.8]]);
      path(d, `fill="${c(bc)}"`);
      for (let i = 0; i < 12; i++) {
        const x = C - 7 + R() * 14;
        path(`M${f(x)},${f(my + lt + 3)} l${f((R() - 0.5) * 1.5)},${f(6 + R() * 4)}`, `stroke="${c(i % 3 ? hairSh : bhi)}" stroke-width="0.5" opacity="0.5"`);
      }
    }
    mustache();
  }

  function drawHat(): void {
    const band = (d: string, col: number) => path(d, `fill="${c(col)}"`);
    if (hat === 1) {
      const col = HAT.casquette;
      lin('hat', 0, 36, 0, 92, [[0, mix(col, 0xffffff, 0.16)], [1, tone(col, 0.82)]]);
      const crown = smooth([[C - cw - 3.4, 87], [C - cw - 2.6, 66], [C - 26, 44], [C, 38.5], [C + 26, 44], [C + cw + 2.6, 66], [C + cw + 3.4, 87], [C + 20, 89.4], [C, 89.8], [C - 20, 89.4]]);
      path(crown, `fill="${ref('hat')}"`);
      for (const dx of [-15, 0, 15]) path(`M${C},40 Q${f(C + dx * 0.8)},60 ${f(C + dx * 1.15)},88`, `fill="none" stroke="${c(tone(col, 0.65))}" stroke-width="0.8" opacity="0.6"`);
      ell(C - 14, 52, 14, 6, `fill="#ffffff" opacity="0.1" filter="${ref('b2')}"`);
      circ(C, 39.6, 2.2, `fill="${c(tone(col, 0.85))}"`);
      band(`M${f(C - cw - 3.4)},84 Q${C},88.4 ${f(C + cw + 3.4)},84 L${f(C + cw + 3.4)},88 Q${C},92 ${f(C - cw - 3.4)},88 Z`, tone(col, 0.72));
      path(`M${f(C - 38)},88 C${f(C - 30)},101 ${f(C + 30)},101 ${f(C + 38)},88 C${f(C + 20)},93 ${f(C - 20)},93 ${f(C - 38)},88 Z`, `fill="${c(tone(col, 0.6))}"`);
      path(`M${f(C - 36)},89 C${f(C - 26)},92.6 ${f(C + 26)},92.6 ${f(C + 36)},89`, `fill="none" stroke="${c(mix(col, 0xffffff, 0.25))}" stroke-width="0.8" opacity="0.6"`);
    } else if (hat === 2) {
      const col = HAT.bonnet;
      lin('hat', 0, 32, 0, 90, [[0, mix(col, 0xffffff, 0.12)], [1, tone(col, 0.8)]]);
      const dome = smooth([[C - cw - 4.4, 86], [C - cw - 4, 62], [C - 25, 40], [C, 33.5], [C + 25, 40], [C + cw + 4, 62], [C + cw + 4.4, 86], [C, 87]]);
      path(dome, `fill="${ref('hat')}"`);
      clip('hk', dome);
      add(`<g clip-path="${ref('hk')}">`);
      for (let y = 42; y < 74; y += 4.5) path(`M${f(C - 46)},${f(y + 3)} Q${C},${f(y - 3)} ${f(C + 46)},${f(y + 3)}`, `fill="none" stroke="${c(tone(col, 0.7))}" stroke-width="0.7" opacity="0.4"`);
      ell(C + 34, 70, 12, 30, `fill="${c(tone(col, 0.6))}" opacity="0.5" filter="${ref('b4')}"`);
      add('</g>');
      const cuff = `M${f(C - cw - 5.4)},73 Q${C},69 ${f(C + cw + 5.4)},73 L${f(C + cw + 5)},89 Q${C},92.5 ${f(C - cw - 5)},89 Z`;
      clip('hb', cuff);
      band(cuff, tone(col, 0.86));
      add(`<g clip-path="${ref('hb')}">`);
      for (let x = C - 46; x < C + 46; x += 3.2) path(`M${f(x)},68 L${f(x)},94`, `stroke="${c(tone(col, 0.66))}" stroke-width="1" opacity="0.5"`);
      ell(C + 36, 82, 10, 12, `fill="${c(tone(col, 0.55))}" opacity="0.5" filter="${ref('b2')}"`);
      add('</g>');
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        circ(C + Math.cos(a) * 6, 31 + Math.sin(a) * 5.5, 3.6, `fill="${c(i < 7 ? 0xc8bfb0 : 0xe6ded0)}"`);
      }
      circ(C - 1.5, 29.5, 5.5, `fill="#efe8dc"`);
    } else if (hat === 3 || hat === 5) {
      const col = hat === 3 ? HAT.chapeau : HAT.paille;
      const bandCol = hat === 3 ? 0x2a1e14 : 0x8a3a2a;
      lin('hat', 0, 36, 0, 80, [[0, mix(col, 0xffffff, 0.14)], [1, tone(col, 0.78)]]);
      const crown = `M${f(C - 34)},78 C${f(C - 36)},60 ${f(C - 33)},45 ${f(C - 25)},38 Q${f(C - 9)},43.5 ${C},39 Q${f(C + 9)},43.5 ${f(C + 25)},38 C${f(C + 33)},45 ${f(C + 36)},60 ${f(C + 34)},78 Z`;
      path(crown, `fill="${ref('hat')}"`);
      ell(C + 24, 60, 9, 18, `fill="${c(tone(col, 0.6))}" opacity="0.5" filter="${ref('b4')}"`);
      band(`M${f(C - 34.6)},66 Q${C},69.5 ${f(C + 34.6)},66 L${f(C + 34.3)},75 Q${C},78.5 ${f(C - 34.3)},75 Z`, bandCol);
      const brim = `M${f(C - 70)},82 C${f(C - 54)},70 ${f(C + 54)},70 ${f(C + 70)},82 C${f(C + 62)},91 ${f(C - 62)},91 ${f(C - 70)},82 Z`;
      lin('brim', 0, 72, 0, 90, [[0, mix(col, 0xffffff, 0.1)], [0.5, col], [1, tone(col, 0.55)]]);
      path(brim, `fill="${ref('brim')}"`);
      path(`M${f(C - 66)},83 C${f(C - 50)},88.5 ${f(C + 50)},88.5 ${f(C + 66)},83`, `fill="none" stroke="${c(tone(col, 0.5))}" stroke-width="1" opacity="0.7"`);
      if (hat === 5) {
        clip('hw', crown);
        add(`<g clip-path="${ref('hw')}">`);
        for (let x = C - 40; x < C + 40; x += 3) path(`M${f(x)},36 l6,44`, `stroke="${c(tone(col, 0.72))}" stroke-width="0.5" opacity="0.5"`);
        add('</g>');
        for (let x = C - 64; x < C + 64; x += 4) path(`M${f(x)},${f(84 - 9 * (1 - Math.pow((x - C) / 70, 2)))} l1.5,6`, `stroke="${c(tone(col, 0.72))}" stroke-width="0.5" opacity="0.45"`);
      }
    } else if (hat === 4) {
      const col = HAT.casque;
      rad('hat', C - 14, 48, 60, [[0, mix(col, 0xffffff, 0.3)], [0.4, col], [1, tone(col, 0.62)]]);
      const dome = smooth([[C - cw - 7.5, 93], [C - cw - 7, 66], [C - 28, 40], [C, 32], [C + 28, 40], [C + cw + 7, 66], [C + cw + 7.5, 93], [C + 20, 89.5], [C, 89], [C - 20, 89.5]]);
      const strap = `M${f(C - cw - 1.5)},92 Q${f(C - cw - 0.5)},${f(jy - 4)} ${f(C - chw - 4)},${f(chy + 0.5)} L${f(C + chw + 4)},${f(chy + 0.5)} Q${f(C + cw + 0.5)},${f(jy - 4)} ${f(C + cw + 1.5)},92`;
      path(strap, `fill="none" stroke="#3b3326" stroke-width="1.7" opacity="0.9"`);
      path(strap, `fill="none" stroke="#8a7a5a" stroke-width="0.5" opacity="0.5" transform="translate(-0.4 -0.4)"`);
      path(dome, `fill="${ref('hat')}"`);
      path(`M${f(C - cw - 7.5)},91 C${f(C - 20)},86.6 ${f(C + 20)},86.6 ${f(C + cw + 7.5)},91 L${f(C + cw + 7.8)},95 C${f(C + 20)},90.6 ${f(C - 20)},90.6 ${f(C - cw - 7.8)},95 Z`, `fill="${c(tone(col, 0.72))}"`);
      add(`<ellipse cx="${f(C - 16)}" cy="48" rx="13" ry="6" transform="rotate(-20 ${f(C - 16)} 48)" fill="#ffffff" opacity="0.16" filter="${ref('b2')}"/>`);
      for (let i = 0; i < 9; i++) circ(C - 30 + R() * 60, 46 + R() * 38, 1 + R() * 1.6, `fill="${c(tone(col, 0.8))}" opacity="0.5"`);
    }
  }

  function drawClothes(): void {
    const g = spec.garment;
    const isCoat = g === 'blouse';
    const isChef = g === 'cuisine';
    const isRobe = g === 'robe';
    const base = isCoat ? 0xe8e4da : isChef ? 0xece6da : g === 'gilet' || g === 'costume' ? (g === 'gilet' ? 0xe4ddcc : shirt) : isRobe ? mix(shirt, 0x5b4636, 0.5) : shirt;
    const wide = female ? 8 : 0;
    const bust = `M-2,242 L-2,${210 + wide} C${8 + wide},${198 + wide * 0.6} ${26 + wide},${189 + wide * 0.3} ${48 + wide},185 C${64 + wide * 0.5},182 ${74},177 ${f(C - 19)},170 L${f(C + 19)},170 C126,177 ${136 - wide * 0.5},182 ${152 - wide},185 C${174 - wide},${189 + wide * 0.3} ${192 - wide},${198 + wide * 0.6} 202,${210 + wide} L202,242 Z`;
    clip('cl', bust);
    defs.push(`<clipPath id="${id}clx"><path d="${bust}"/><rect x="${C - 34}" y="140" width="68" height="50"/></clipPath>`);
    lin('cloth', 10, 170, 190, 240, [[0, mix(base, 0xffffff, 0.12)], [0.45, base], [1, tone(base, 0.62)]]);
    // capuche tombante, derrière le cou
    if (g === 'capuche' || isRobe) {
      const hood = isRobe ? tone(base, 0.85) : tone(base, 0.8);
      path(smooth([[C - 40, 190], [C - 34, 170], [C - 22, 158], [C, 154], [C + 22, 158], [C + 34, 170], [C + 40, 190], [C, 186]]), `fill="${c(hood)}"`);
    }
    path(bust, `fill="${ref('cloth')}"`);
    add(`<g clip-path="${ref('cl')}">`);
    ell(40, 196, 26, 7, `fill="#ffffff" opacity="0.12" filter="${ref('b4')}"`);
    ell(C, 174, 26, 6, `fill="#000000" opacity="0.35" filter="${ref('b2')}"`);
    for (const s of [-1, 1]) ell(C + s * 62, 240, 18, 22, `fill="#000000" opacity="0.25" filter="${ref('b8')}"`);
    add('</g>');
    add(`<g clip-path="${ref('clx')}">`);
    const dk = (k: number) => c(tone(base, k));
    const button = (x: number, y: number, col = 0xc8a050) => {
      circ(x, y, 2, `fill="${c(col)}" stroke="${c(tone(col, 0.55))}" stroke-width="0.5"`);
      circ(x - 0.6, y - 0.6, 0.6, `fill="#ffffff" opacity="0.6"`);
    };
    const collarWings = (col: number, spread = 1) => {
      for (const s of [-1, 1]) {
        const Q = (dx: number, y: number): Pt => [C + s * dx, y];
        path(`M${P(Q(1.5, 190))} L${P(Q(19, 167))} L${P(Q(27 * spread, 177))} L${P(Q(13 * spread, 199))} Z`, `fill="${c(col)}" stroke="${c(tone(col, 0.6))}" stroke-width="0.7" stroke-linejoin="round"`);
        path(`M${P(Q(13 * spread, 199))} L${P(Q(5, 192))}`, `stroke="#000000" stroke-width="2" opacity="0.18" filter="${ref('b1')}"`);
      }
    };
    const vNeck = (depth: number, col: number) => path(`M${f(C - 15)},170 L${C},${depth} L${f(C + 15)},170 Z`, `fill="${c(col)}"`);
    switch (g) {
      case 'chemise': {
        vNeck(192, tone(skin, 0.8));
        collarWings(mix(shirt, 0xffffff, 0.08));
        path(`M${C},193 L${C},242`, `stroke="${dk(0.7)}" stroke-width="0.8"`);
        for (const y of [206, 222, 238]) circ(C + 1.6, y, 1.4, `fill="${dk(0.6)}"`);
        break;
      }
      case 'costume': {
        path(`M${f(C - 19)},170 L${f(C - 5)},232 L${f(C + 5)},232 L${f(C + 19)},170 Z`, `fill="#e9e4da"`);
        collarWings(0xf2eee6, 0.8);
        for (const s of [-1, 1]) {
          const Q = (dx: number, y: number): Pt => [C + s * dx, y];
          path(`M${P(Q(20, 168))} L${P(Q(31, 186))} L${P(Q(26, 192))} L${P(Q(36, 196))} L${P(Q(5, 236))} L${P(Q(17, 176))} Z`, `fill="${c(mix(shirt, 0xffffff, 0.08))}" stroke="${dk(0.55)}" stroke-width="0.8" stroke-linejoin="round"`);
        }
        button(C, 238, tone(shirt, 0.6));
        break;
      }
      case 'gilet': {
        vNeck(188, tone(skin, 0.8));
        collarWings(0xf0eadc);
        const vest = mix(shirt, 0x000000, 0.12);
        for (const s of [-1, 1]) {
          const Q = (dx: number, y: number): Pt => [C + s * dx, y];
          path(`M${P(Q(21, 174))} L${P(Q(2.5, 214))} L${P(Q(2.5, 242))} L${P(Q(60, 242))} L${P(Q(52, 197))} L${P(Q(38, 184))} Z`, `fill="${c(vest)}" stroke="${c(tone(vest, 0.6))}" stroke-width="0.7"`);
        }
        for (const y of [220, 232]) button(C + 3.5, y, 0xd2b060);
        path(`M${f(C + 3)},226 Q${f(C + 18)},234 ${f(C + 30)},226`, `fill="none" stroke="#d8b860" stroke-width="0.9" stroke-dasharray="1.6 1"`);
        break;
      }
      case 'uniforme':
      case 'officier': {
        const off = g === 'officier';
        path(`M${f(C - 21)},166 Q${C},172 ${f(C + 21)},166 L${f(C + 21)},178 Q${C},184 ${f(C - 21)},178 Z`, `fill="${dk(0.82)}" stroke="${dk(0.55)}" stroke-width="0.7"`);
        if (off) for (const s of [-1, 1]) path(`M${f(C + s * 18)},169 L${f(C + s * 12)},177`, `stroke="#d8b860" stroke-width="1.6"`);
        path(`M${C},182 L${C},242`, `stroke="${dk(0.6)}" stroke-width="1"`);
        for (const y of [192, 208, 224, 240]) button(C + 2.2, y);
        for (const s of [-1, 1]) {
          const Q = (dx: number, y: number): Pt => [C + s * dx, y];
          path(`M${P(Q(36, 181))} L${P(Q(66, 188))} L${P(Q(64, 195))} L${P(Q(35, 188))} Z`, `fill="${off ? '#c8a050' : dk(1.12)}" stroke="${dk(0.6)}" stroke-width="0.6"`);
          button(C + s * 40, 185.5, off ? 0xe8c870 : 0xb89048);
          path(`M${P(Q(18, 206))} L${P(Q(40, 206))} L${P(Q(40, 212))} L${P(Q(29, 214))} L${P(Q(18, 212))} Z`, `fill="${dk(0.9)}" stroke="${dk(0.58)}" stroke-width="0.6"`);
        }
        if (off) {
          const rib = [0x8a2a2a, 0x2a4a8a, 0xd8b860, 0x3a6a3a];
          rib.forEach((col, i) => add(`<rect x="${f(C + 18 + (i % 2) * 7)}" y="${f(196 + Math.floor(i / 2) * 4)}" width="6.4" height="3.2" fill="${c(col)}" stroke="#1a1a1a" stroke-width="0.3"/>`));
        }
        if (spec.trade === 'tireur') {
          path(`M${f(C - 52)},186 L${f(C + 44)},244`, `stroke="#5a4028" stroke-width="8"`);
          for (let i = 0; i < 8; i++) {
            const t = 0.15 + i * 0.1;
            add(`<rect x="${f(C - 52 + 96 * t - 1.2)}" y="${f(186 + 58 * t - 4.5)}" width="2.4" height="6" rx="0.8" transform="rotate(-31 ${f(C - 52 + 96 * t)} ${f(186 + 58 * t)})" fill="#d0a850" stroke="#7a5a20" stroke-width="0.4"/>`);
          }
        }
        break;
      }
      case 'blouse': {
        path(`M${f(C - 19)},170 L${C},216 L${f(C + 19)},170 Z`, `fill="${c(shirt)}"`);
        path(`M${f(C - 15)},170 L${C},184 L${f(C + 15)},170 Z`, `fill="${c(tone(skin, 0.8))}"`);
        for (const s of [-1, 1]) {
          const Q = (dx: number, y: number): Pt => [C + s * dx, y];
          path(`M${P(Q(20, 167))} L${P(Q(2, 216))} L${P(Q(12, 210))} L${P(Q(33, 186))} Z`, `fill="#f4f1ea" stroke="#b8b2a6" stroke-width="0.8" stroke-linejoin="round"`);
        }
        path(`M${C},216 L${C},242`, `stroke="#b8b2a6" stroke-width="0.8"`);
        if (spec.trade === 'medecin') {
          path(`M${f(C - 22)},172 C${f(C - 26)},196 ${f(C - 20)},214 ${f(C - 15)},222`, `fill="none" stroke="#2a2a30" stroke-width="2"`);
          path(`M${f(C + 22)},172 C${f(C + 26)},190 ${f(C + 24)},200 ${f(C + 20)},206`, `fill="none" stroke="#2a2a30" stroke-width="2"`);
          circ(C - 15, 225, 4, `fill="#c8ccd0" stroke="#6a6e74" stroke-width="0.8"`);
          circ(C - 16, 224, 1.4, `fill="#ffffff" opacity="0.7"`);
        } else {
          add(`<rect x="${f(C + 20)}" y="206" width="16" height="12" fill="#ece8de" stroke="#b8b2a6" stroke-width="0.6"/>`);
          add(`<rect x="${f(C + 23)}" y="200" width="2" height="10" fill="#2a4a8a"/><rect x="${f(C + 27)}" y="201" width="2" height="9" fill="#8a2a2a"/>`);
          add(`<rect x="${f(C - 36)}" y="206" width="14" height="6" rx="1" fill="#d8d4ca" stroke="#9a948a" stroke-width="0.5"/>`);
        }
        break;
      }
      case 'salopette': {
        path(`M${f(C - 19)},170 Q${C},186 ${f(C + 19)},170`, `fill="${c(tone(skin, 0.8))}" stroke="${dk(0.6)}" stroke-width="1.6"`);
        const bib = look.pants;
        const bibD = `M${f(C - 25)},206 Q${f(C - 25)},202 ${f(C - 21)},202 L${f(C + 21)},202 Q${f(C + 25)},202 ${f(C + 25)},206 L${f(C + 27)},242 L${f(C - 27)},242 Z`;
        lin('bib', 0, 200, 0, 240, [[0, mix(bib, 0xffffff, 0.08)], [1, tone(bib, 0.72)]]);
        for (const s of [-1, 1]) path(`M${f(C + s * 19)},204 L${f(C + s * 30)},178`, `stroke="${c(bib)}" stroke-width="6"`);
        path(bibD, `fill="${ref('bib')}" stroke="${c(tone(bib, 0.55))}" stroke-width="0.7"`);
        add(`<rect x="${f(C - 9)}" y="212" width="18" height="14" rx="1.5" fill="none" stroke="${c(mix(bib, 0xd8c8a0, 0.5))}" stroke-width="0.6" stroke-dasharray="1.4 1"/>`);
        for (const s of [-1, 1]) add(`<rect x="${f(C + s * 19 - 3)}" y="202.5" width="6" height="5" rx="1" fill="#b8b0a0" stroke="#5a5448" stroke-width="0.5"/>`);
        ell(C + 12, 232, 6, 3, `fill="#1a1612" opacity="0.35" filter="${ref('b1')}"`);
        ell(C - 40, 214, 5, 3, `fill="#1a1612" opacity="0.25" filter="${ref('b1')}"`);
        break;
      }
      case 'cuisine': {
        path(`M${f(C - 20)},166 Q${C},172 ${f(C + 20)},166 L${f(C + 20)},178 Q${C},184 ${f(C - 20)},178 Z`, `fill="#ded8cc" stroke="#a8a090" stroke-width="0.6"`);
        const kerchief = luma(shirt) > 0.7 ? 0xa83a2a : shirt;
        path(`M${f(C - 8)},178 L${f(C + 8)},178 L${C},192 Z`, `fill="${c(kerchief)}"`);
        circ(C, 179, 3, `fill="${c(tone(kerchief, 0.8))}"`);
        path(`M${f(C + 10)},184 L${f(C + 10)},242`, `stroke="#b8b0a2" stroke-width="0.8"`);
        for (const y of [196, 212, 228]) for (const x of [C - 12, C + 16]) button(x, y, 0xd8d0c0);
        break;
      }
      case 'capuche': {
        path(`M${f(C - 19)},171 Q${C},182 ${f(C + 19)},171`, `fill="none" stroke="${dk(0.6)}" stroke-width="2"`);
        path(`M${C},180 L${C},242`, `stroke="${dk(0.55)}" stroke-width="1.6" stroke-dasharray="1 0.8"`);
        add(`<rect x="${f(C - 1.4)}" y="190" width="2.8" height="6" rx="1" fill="#b8b0a0"/>`);
        for (const s of [-1, 1]) {
          path(`M${f(C + s * 8)},178 Q${f(C + s * 9.5)},192 ${f(C + s * 8.5)},206`, `fill="none" stroke="#d8d0c0" stroke-width="1"`);
          add(`<rect x="${f(C + s * 8.5 - 0.9)}" y="205" width="1.8" height="4" fill="#8a8274"/>`);
        }
        break;
      }
      case 'col': {
        const col = tone(shirt, 0.9);
        path(`M${f(C - 18.5)},150 Q${C},156 ${f(C + 18.5)},150 L${f(C + 21)},180 Q${C},186 ${f(C - 21)},180 Z`, `fill="${c(col)}"`);
        for (let x = C - 18; x <= C + 18; x += 3) path(`M${f(x)},${f(153 - (1 - Math.pow((x - C) / 19, 2)) * 2)} L${f(x * 1.05 - C * 0.05)},181`, `stroke="${c(tone(col, 0.72))}" stroke-width="0.7" opacity="0.6"`);
        ell(C + 13, 166, 6, 16, `fill="#000000" opacity="0.25" filter="${ref('b2')}"`);
        break;
      }
      case 'robe': {
        const cowl = tone(base, 0.9);
        path(`M${f(C - 36)},176 C${f(C - 30)},204 ${f(C + 30)},204 ${f(C + 36)},176 C${f(C + 22)},190 ${f(C - 22)},190 ${f(C - 36)},176 Z`, `fill="${c(cowl)}" stroke="${c(tone(base, 0.6))}" stroke-width="0.8"`);
        path(`M${f(C - 30)},184 C${f(C - 20)},198 ${f(C + 20)},198 ${f(C + 30)},184`, `fill="none" stroke="${c(tone(base, 0.65))}" stroke-width="0.8" opacity="0.7"`);
        path(`M${f(C - 9)},186 Q${C},214 ${f(C + 9)},186`, `fill="none" stroke="#7a6040" stroke-width="0.9"`);
        circ(C, 214, 3.4, `fill="#c8a050" stroke="#6a5020" stroke-width="0.6"`);
        break;
      }
    }
    // accessoires du cou et des épaules
    if (look.accessory === 3) {
      const tie = 0x7a1a1a;
      path(`M${f(C - 4.5)},181 L${f(C + 4.5)},181 L${f(C + 3.4)},189 L${f(C - 3.4)},189 Z`, `fill="${c(tone(tie, 0.85))}"`);
      path(`M${f(C - 3.4)},189 L${f(C + 3.4)},189 L${f(C + 7)},228 L${C},238 L${f(C - 7)},228 Z`, `fill="${c(tie)}"`);
      for (let y = 194; y < 232; y += 6) path(`M${f(C - 6)},${y + 3} L${f(C + 6)},${y - 3}`, `stroke="${c(mix(tie, 0xffffff, 0.2))}" stroke-width="1.1" opacity="0.6"`);
    }
    if (look.accessory === 4) {
      for (const s of [-1, 1]) {
        const Q = (dx: number, y: number): Pt => [C + s * dx, y];
        path(`M${P(Q(31, 180))} C${P(Q(36, 196))} ${P(Q(40, 216))} ${P(Q(41, 244))}`, `fill="none" stroke="#4a3c28" stroke-width="7.5"`);
        path(`M${P(Q(31, 180))} C${P(Q(36, 196))} ${P(Q(40, 216))} ${P(Q(41, 244))}`, `fill="none" stroke="#7a6444" stroke-width="5.5" stroke-dasharray="2 1.4" opacity="0.35"`);
        add(`<rect x="${f(C + s * 39.5 - 4)}" y="222" width="8" height="5" rx="1" fill="none" stroke="#b8b0a0" stroke-width="1.2"/>`);
      }
    }
    if (look.accessory === 1) {
      const sc = 0xa83a2a;
      const scarf = `M${f(C - 27)},157 C${f(C - 30)},176 ${f(C - 12)},188 ${C},188 C${f(C + 12)},188 ${f(C + 30)},176 ${f(C + 27)},157 C${f(C + 18)},166 ${f(C - 18)},166 ${f(C - 27)},157 Z`;
      lin('scarf', 0, 156, 0, 190, [[0, tone(sc, 0.8)], [0.5, sc], [1, tone(sc, 0.7)]]);
      path(`M${f(C + 9)},180 L${f(C + 22)},182 L${f(C + 25)},220 L${f(C + 12)},222 Z`, `fill="${c(tone(sc, 0.82))}"`);
      for (let x = C + 13; x < C + 25; x += 2) path(`M${f(x)},${221} l0.4,4`, `stroke="${c(tone(sc, 0.82))}" stroke-width="0.8"`);
      path(scarf, `fill="${ref('scarf')}"`);
      for (const y of [168, 176]) path(`M${f(C - 26)},${f(y - 8)} C${f(C - 14)},${y + 6} ${f(C + 14)},${y + 6} ${f(C + 26)},${f(y - 8)}`, `fill="none" stroke="${c(mix(sc, 0xf0d8a0, 0.5))}" stroke-width="1.4" opacity="0.55"`);
    }
    add('</g>');
    // contre-jour sur l'épaule droite
    add(`<g clip-path="${ref('cl')}">`);
    path(bust, `fill="none" stroke="${ref('rim')}" stroke-width="3" filter="${ref('b1')}"`);
    add('</g>');
  }
}

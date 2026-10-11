import { hashString } from '../core/rng';
import type { NpcLook } from './npcs';

/**
 * Traits du visage d'un personnage, tirés une fois pour toutes de son identifiant :
 * le portrait des dialogues et le modèle 3D les partagent (même barbe, mêmes lunettes…).
 */

/** 0 : aucune, 1 : barbe de trois jours, 2 : moustache, 3 : barbe fournie, 4 : bouc. */
export type Beard = 0 | 1 | 2 | 3 | 4;

export interface FaceTraits {
  female: boolean;
  age: number;
  beard: Beard;
  /** Couleur des iris. */
  eyes: number;
  /** 0 : ovale, 1 : carré, 2 : rond, 3 : long. */
  shape: 0 | 1 | 2 | 3;
  /** 0 : fin, 1 : droit, 2 : fort. */
  nose: 0 | 1 | 2;
  /** Épaisseur des sourcils (0,6 à 1,5). */
  brows: number;
  /** Écartement des yeux (−1 à 1). */
  eyeGap: number;
  /** Lèvres (0 fines à 1 pleines). */
  lips: number;
  freckles: boolean;
  /** 0 : aucune, 1 : joue, 2 : sourcil. */
  scar: 0 | 1 | 2;
  earrings: boolean;
  /** Suie et poussière sur les joues (0 à 1). */
  grime: number;
  /** Mèche ou frange (variante de coiffure). */
  fringe: number;
}

export const EYE_COLORS = [0x4a3020, 0x6a4628, 0x3d6688, 0x4f6e4a, 0x2a2420, 0x7d8c98, 0x8a6a30];

/** Traits imposés aux personnages du scénario (le reste est tiré au sort). */
const STORY: Record<string, Partial<FaceTraits>> = {
  delorme: { beard: 2, shape: 1, nose: 2, brows: 1.4, eyes: 0x3d6688 },
  elise: { shape: 0, nose: 0, brows: 0.8, eyes: 0x4f6e4a, lips: 0.6, freckles: false, grime: 0 },
  bastien: { beard: 3, shape: 2, nose: 2, brows: 1.3, grime: 0.7, eyes: 0x6a4628 },
  rosalie: { freckles: true, shape: 2, lips: 0.7, eyes: 0x6a4628, grime: 0.25 },
  gaspard: { beard: 2, shape: 2, nose: 1, brows: 1.1 },
  anselme: { beard: 3, shape: 3, nose: 1, brows: 1.0, eyes: 0x7d8c98, grime: 0 },
  mila: { freckles: true, shape: 0, nose: 0, eyes: 0x4f6e4a, grime: 0.55, lips: 0.5 },
  silas: { beard: 4, shape: 3, nose: 0, brows: 0.9, eyes: 0x8a6a30, grime: 0 },
  mamajo: { earrings: true, shape: 2, lips: 0.85, brows: 1.1, eyes: 0x2a2420 },
  lambert: { beard: 2, shape: 1, scar: 1, brows: 1.5, nose: 2, eyes: 0x7d8c98 },
  nadia: { scar: 2, shape: 3, brows: 1.0, lips: 0.6, earrings: true, eyes: 0x2a2420 },
  ingrid: { shape: 3, nose: 1, eyes: 0x3d6688, freckles: true, brows: 0.9 },
  oscar: { beard: 1, shape: 0, nose: 0, brows: 0.9, eyes: 0x6a4628, grime: 0.3 },
};

/** Tirage déterministe n° k pour une clé donnée, dans [0, 1). */
function roll(h: number, k: number): number {
  let x = (h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function faceTraits(key: string, look: NpcLook, female: boolean, age: number): FaceTraits {
  const h = hashString(key) >>> 0;
  const r = (k: number) => roll(h, k);
  const pick = <T,>(k: number, arr: readonly T[]): T => arr[Math.floor(r(k) * arr.length)];
  const beard: Beard = female || age < 18 ? 0 : pick(1, [0, 0, 0, 1, 1, 2, 3, 3, 4] as const);
  const base: FaceTraits = {
    female,
    age,
    beard,
    eyes: pick(2, EYE_COLORS),
    shape: pick(3, female ? ([0, 0, 2, 3] as const) : ([0, 1, 1, 2, 3] as const)),
    nose: pick(4, female ? ([0, 0, 1] as const) : ([0, 1, 1, 2] as const)),
    brows: (female ? 0.7 : 0.95) + r(5) * 0.5,
    eyeGap: r(6) * 2 - 1,
    lips: female ? 0.45 + r(7) * 0.5 : r(7) * 0.45,
    freckles: look.skin === 0xf5d6c0 || look.skin === 0xf1c9a5 ? r(8) < 0.3 : false,
    scar: r(9) < 0.12 ? (r(10) < 0.5 ? 1 : 2) : 0,
    earrings: female ? r(11) < 0.4 : r(11) < 0.08,
    grime: r(12) < 0.45 ? r(13) * 0.6 : 0,
    fringe: r(14),
  };
  const story = STORY[key];
  return story ? { ...base, ...story } : base;
}

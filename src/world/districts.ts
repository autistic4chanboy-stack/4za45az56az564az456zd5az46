import * as THREE from 'three';
import { GeoBuilder } from '../render/geo';
import { PAT } from '../render/toon';
import * as P from '../render/props';
import type { Rect } from '../core/math';
import type { StationBuilder, BuildingHandle, InteriorKind, LockSpec } from './stationBuilder';
import type { LootProfile } from './loot';
import type { WallStyle, RoofKind } from './buildingArt';

/**
 * Quartiers denses (îlots, rues, ruelles, corons, bidonvilles) et fortifications
 * (remparts, portes, tours). Les bâtiments existants (repères des archétypes) sont
 * respectés : un lot occupé est simplement laissé de côté.
 */

export type DistrictStyle = 'ville' | 'bourg' | 'corons' | 'bidonville' | 'industriel' | 'militaire' | 'monastique' | 'citadelle' | 'campus' | 'souk';

interface StyleCfg {
  interiors: [InteriorKind, number][];
  loot: LootProfile[];
  walls: WallStyle[];
  roofs: RoofKind[] | null;
  colors: number[];
  tall: number;
  ruined: number;
  lockChance: number;
  lotW: [number, number];
  lotD: [number, number];
  gap: number;
  /** Écart entre deux lots voisins d'une même rangée. */
  spacing: [number, number];
  block: [number, number];
  street: number;
  paving: number;
  lamps: boolean;
}

const STYLES: Record<DistrictStyle, StyleCfg> = {
  ville: {
    interiors: [['maison', 4], ['boutique', 2], ['bureau', 2], ['garage', 1], ['infirmerie', 0.6], ['bar', 0.8], ['entrepot', 0.6]],
    loot: ['general', 'maison', 'medical', 'luxe'], walls: ['brique', 'beton', 'crepi', 'brique'], roofs: ['plat', 'plat', 'pignon'],
    colors: [0x8a8478, 0x9a8a7a, 0x7a7068, 0xa09080, 0x8a6a5a, 0xb0a490], tall: 0.45, ruined: 0.4, lockChance: 0.22,
    lotW: [8, 13], lotD: [8, 11], gap: 1.6, spacing: [0.4, 1.4], block: [24, 34], street: 6, paving: 0x48484a, lamps: true,
  },
  citadelle: {
    interiors: [['maison', 5], ['boutique', 2], ['bar', 1], ['bureau', 1], ['atelier', 1], ['infirmerie', 0.6], ['dortoir', 0.8]],
    loot: ['maison', 'general', 'nourriture', 'luxe'], walls: ['pierre', 'crepi', 'bois', 'brique', 'crepi'], roofs: ['pignon', 'pignon', 'plat'],
    colors: [0xc2b090, 0xb0a080, 0xa89878, 0xc8b8a0, 0x9a8a72, 0xb89a80], tall: 0.5, ruined: 0.05, lockChance: 0.18,
    lotW: [6, 10], lotD: [7, 10], gap: 1.2, spacing: [0.3, 0.8], block: [20, 28], street: 4.5, paving: 0x6e6a62, lamps: true,
  },
  bourg: {
    interiors: [['maison', 6], ['entrepot', 1], ['atelier', 0.8], ['bar', 0.4]],
    loot: ['maison', 'nourriture', 'general'], walls: ['bois', 'crepi', 'brique', 'pierre'], roofs: ['pignon'],
    colors: [0xa89878, 0x9a8a72, 0xb8a888, 0x8a7a66, 0xc0aa88], tall: 0.15, ruined: 0.12, lockChance: 0.15,
    lotW: [9, 14], lotD: [9, 13], gap: 3.2, spacing: [0.8, 2.4], block: [26, 36], street: 5, paving: 0x7a6a52, lamps: false,
  },
  corons: {
    interiors: [['maison', 1]],
    loot: ['maison', 'charbon', 'general'], walls: ['brique'], roofs: ['pignon'],
    colors: [0x8a4a38, 0x7a4234, 0x94503c], tall: 0, ruined: 0.18, lockChance: 0.12,
    lotW: [6.2, 7.2], lotD: [7, 8], gap: 0.6, spacing: [0, 0], block: [34, 44], street: 5, paving: 0x55504a, lamps: true,
  },
  bidonville: {
    interiors: [['maison', 4], ['entrepot', 1.5], ['atelier', 1], ['bar', 0.5], ['vide', 1]],
    loot: ['bandit', 'general', 'maison'], walls: ['tole', 'bois', 'tole'], roofs: ['plat'],
    colors: [0x6a5a4a, 0x5e6a6e, 0x7a5a42, 0x4e5a48, 0x8a6a4a], tall: 0, ruined: 0.1, lockChance: 0.15,
    lotW: [4.5, 7], lotD: [4.5, 6.5], gap: 1.3, spacing: [0.4, 1], block: [16, 22], street: 3.2, paving: 0x5a5046, lamps: false,
  },
  industriel: {
    interiors: [['entrepot', 3], ['atelier', 2], ['garage', 1.5], ['bureau', 0.8]],
    loot: ['industriel', 'charbon', 'general'], walls: ['tole', 'brique', 'beton'], roofs: ['arche', 'sheds', 'plat'],
    colors: [0x6a6e72, 0x7a5a48, 0x6a6a62, 0x5a5e58], tall: 0.6, ruined: 0.25, lockChance: 0.2,
    lotW: [12, 20], lotD: [10, 14], gap: 3, spacing: [1, 2.5], block: [30, 44], street: 7, paving: 0x4a4a4c, lamps: true,
  },
  militaire: {
    interiors: [['caserne', 2], ['dortoir', 2], ['armurerie', 0.8], ['bureau', 1], ['cantine', 0.8], ['garage', 1], ['infirmerie', 0.6]],
    loot: ['militaire', 'general', 'nourriture'], walls: ['beton', 'beton', 'brique'], roofs: ['plat', 'arche'],
    colors: [0x6a6a52, 0x7a7a62, 0x6a6e66, 0x5a5e52], tall: 0.2, ruined: 0.08, lockChance: 0.25,
    lotW: [10, 16], lotD: [8, 11], gap: 3, spacing: [1, 2.5], block: [28, 38], street: 6, paving: 0x5a5a56, lamps: true,
  },
  campus: {
    interiors: [['labo', 3], ['bureau', 2], ['salle_controle', 1], ['entrepot', 1], ['infirmerie', 0.6], ['dortoir', 0.6], ['cantine', 0.4]],
    loot: ['tech', 'medical', 'general'], walls: ['beton', 'beton', 'crepi'], roofs: ['plat'],
    colors: [0xc8c8c4, 0xb8bcc0, 0xd0d0cc, 0xa8acb0], tall: 0.3, ruined: 0.15, lockChance: 0.3,
    lotW: [11, 16], lotD: [9, 12], gap: 2.6, spacing: [1, 2.5], block: [28, 36], street: 6, paving: 0x5a5e62, lamps: true,
  },
  souk: {
    interiors: [['boutique', 4], ['bar', 1.2], ['entrepot', 1.5], ['atelier', 1], ['maison', 1.5]],
    loot: ['general', 'nourriture', 'luxe'], walls: ['tole', 'bois', 'crepi'], roofs: ['plat'],
    colors: [0xa8784a, 0x8a6a4a, 0xb89060, 0x7a6a5a, 0xc0a070], tall: 0.1, ruined: 0.05, lockChance: 0.12,
    lotW: [5.5, 8], lotD: [5.5, 7], gap: 1.4, spacing: [0.3, 0.8], block: [18, 26], street: 3.8, paving: 0x6a5a46, lamps: false,
  },
  monastique: {
    interiors: [['dortoir', 2], ['maison', 1], ['cantine', 1], ['atelier', 0.6], ['infirmerie', 0.6]],
    loot: ['maison', 'medical', 'nourriture'], walls: ['pierre', 'crepi'], roofs: ['pignon'],
    colors: [0xc8c0b0, 0xb8b0a0, 0xd0c8b8], tall: 0.2, ruined: 0.05, lockChance: 0.08,
    lotW: [8, 12], lotD: [7, 9], gap: 2, spacing: [0.6, 1.6], block: [24, 30], street: 4, paving: 0x8a8274, lamps: false,
  },
};

const NAMES: Partial<Record<InteriorKind, string[]>> = {
  maison: ['Maison', 'Logis', 'Maison de ville', 'Pavillon'],
  boutique: ['Boutique', 'Épicerie', 'Quincaillerie', 'Mercerie', 'Bazar', 'Bijouterie'],
  bureau: ['Bureaux', 'Étude notariale', 'Poste', 'Mairie annexe', 'Agence'],
  garage: ['Garage', 'Atelier mécanique'],
  infirmerie: ['Cabinet médical', 'Pharmacie', 'Dispensaire'],
  bar: ['Café', 'Bistrot', 'Taverne'],
  entrepot: ['Entrepôt', 'Remise', 'Dépôt'],
  atelier: ['Atelier', 'Forge', 'Menuiserie'],
  dortoir: ['Dortoir', 'Pension'],
  caserne: ['Caserne', 'Corps de garde'],
  armurerie: ['Armurerie'],
  cantine: ['Cantine', 'Réfectoire'],
  labo: ['Laboratoire', 'Labo d\'analyses', 'Animalerie'],
  salle_controle: ['Salle de contrôle', 'Centre de calcul'],
  vide: ['Cabane', 'Masure'],
};

type Side = 'n' | 's' | 'e' | 'w';

/** Quartiers où les maisons remplissent l'îlot jusqu'au fond. */
const DEEP: ReadonlySet<DistrictStyle> = new Set(['ville', 'citadelle', 'souk']);

/** Probabilité qu'un îlot devienne une place (fontaine, arbres, étals). */
const SQUARE_CHANCE: Partial<Record<DistrictStyle, number>> = { ville: 0.06, citadelle: 0.1, bourg: 0.12, monastique: 0.06, souk: 0.08, campus: 0.05 };

/** Rues pavées : géométrie fine et zone sans herbe. */
function paveStreet(b: StationBuilder, r: Rect, color: number): void {
  if (r.x1 - r.x0 < 0.5 || r.z1 - r.z0 < 0.5) return;
  b.g.box(r.x1 - r.x0, 0.04, r.z1 - r.z0, (r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2, color, { pat: PAT.paves });
  b.pave(r);
}

/** Lot à bâtir ; renvoie le bâtiment posé ou null si la place est prise. */
function lotBuilding(b: StationBuilder, cfg: StyleCfg, lot: Rect, door: Side, o: { ruined: number; hostile: boolean; lockChance?: number; attach?: boolean }): BuildingHandle | null {
  const rng = b.rng;
  const w = Math.max(4, lot.x1 - lot.x0 - cfg.gap);
  const d = Math.max(4, lot.z1 - lot.z0 - cfg.gap);
  const x = (lot.x0 + lot.x1) / 2;
  const z = (lot.z0 + lot.z1) / 2;
  const fp: Rect = { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
  // les corons se serrent : 0,6 m entre deux maisons, on tolère le débord des réservations voisines
  if (!b.isFree(fp, o.attach ? -0.45 : 0.4)) return null;
  const interior = rng.pickWeighted(cfg.interiors, (e) => e[1])[0];
  const ruined = rng.chance(o.ruined);
  const lockP = o.lockChance ?? cfg.lockChance;
  const lock: LockSpec | undefined = !ruined && rng.chance(lockP) ? randomLockLite(b) : undefined;
  const doorLen = door === 'n' || door === 's' ? w : d;
  const offset = rng.range(-doorLen / 2 + 1.6, doorLen / 2 - 1.6);
  const doors: { side: Side; offset: number; lock?: LockSpec; width?: number }[] = [{ side: door, offset: Math.round(offset * 10) / 10, lock }];
  // porte de derrière vers la cour ou la ruelle
  const back: Side = door === 's' ? 'n' : door === 'n' ? 's' : door === 'e' ? 'w' : 'e';
  if (!o.attach && rng.chance(0.35) && (back === 'n' || back === 's' ? w : d) > 5) doors.push({ side: back, offset: 0 });
  const names = NAMES[interior] ?? ['Bâtiment'];
  const h = b.building({
    x, z, w, d,
    h: rng.chance(cfg.tall) ? rng.pick([5.6, 6.5]) : rng.pick([3.4, 3.6, 3.8]),
    name: rng.pick(names),
    wall: rng.pick(cfg.colors),
    style: rng.pick(cfg.walls),
    roofType: cfg.roofs ? rng.pick(cfg.roofs) : undefined,
    interior: ruined ? 'vide' : interior,
    loot: rng.pick(cfg.loot),
    richness: ruined ? 0.6 : 1,
    ruined,
    doors,
  });
  if (lock) b.lockHints.push({ lock, door: h.doors[0].id, exclude: h, label: h.spec.name.toLowerCase() });
  return h;
}

function randomLockLite(b: StationBuilder): LockSpec {
  const k = b.rng.pick(['crochet', 'crochet', 'code', 'barricade'] as const);
  if (k === 'code') return { kind: 'code', code: String(b.rng.int(1000, 9999)) };
  if (k === 'barricade') return { kind: 'barricade' };
  return { kind: 'crochet', difficulty: b.rng.int(1, Math.min(3, 1 + Math.floor(b.tier / 1.5))) };
}

export interface DistrictOpts {
  ruined?: number;
  hostile?: boolean;
  lockChance?: number;
  /** Densité de décor de rue (voitures, poubelles, barricades). */
  clutter?: number;
  /** Zones déjà aménagées (place, enclave fortifiée…) que les rues contournent. */
  exclude?: Rect[];
}

/** Retire d'une bande de rue les zones exclues (découpe le long de son grand axe). */
function clipStreet(r: Rect, excl: Rect[]): Rect[] {
  let pieces: Rect[] = [r];
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  for (const e of excl) {
    const next: Rect[] = [];
    for (const p of pieces) {
      if (e.x1 <= p.x0 || e.x0 >= p.x1 || e.z1 <= p.z0 || e.z0 >= p.z1) {
        next.push(p);
        continue;
      }
      if (alongX) {
        if (e.x0 > p.x0) next.push({ ...p, x1: e.x0 });
        if (e.x1 < p.x1) next.push({ ...p, x0: e.x1 });
      } else {
        if (e.z0 > p.z0) next.push({ ...p, z1: e.z0 });
        if (e.z1 < p.z1) next.push({ ...p, z0: e.z1 });
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Remplit une région d'îlots séparés par des rues. Renvoie les bâtiments posés.
 */
export function district(b: StationBuilder, reg: Rect, style: DistrictStyle, o: DistrictOpts = {}): BuildingHandle[] {
  const cfg = STYLES[style];
  const rng = b.rng;
  const out: BuildingHandle[] = [];
  const ruined = o.ruined ?? cfg.ruined;
  // découpage en îlots
  const cols: [number, number][] = [];
  let x = reg.x0;
  while (x < reg.x1 - 8) {
    let bw = Math.min(rng.range(cfg.block[0], cfg.block[1]), reg.x1 - x);
    // le dernier îlot absorbe la bande restante plutôt que de la laisser vide
    if (reg.x1 - (x + bw) < cfg.block[0] * 0.6 + cfg.street) bw = reg.x1 - x;
    cols.push([x, x + bw]);
    x += bw + cfg.street;
  }
  const rows: [number, number][] = [];
  let z = reg.z0;
  while (z < reg.z1 - 7) {
    let bd = Math.min(rng.range(cfg.block[0] * 0.75, cfg.block[1] * 0.75), reg.z1 - z);
    if (reg.z1 - (z + bd) < cfg.block[0] * 0.45 + cfg.street) bd = reg.z1 - z;
    rows.push([z, z + bd]);
    z += bd + cfg.street;
  }
  // rues : entre les îlots (elles contournent les zones exclues)
  const excl = o.exclude ?? [];
  for (let i = 0; i < cols.length - 1; i++) for (const p of clipStreet({ x0: cols[i][1], z0: reg.z0, x1: cols[i + 1][0], z1: reg.z1 }, excl)) paveStreet(b, p, cfg.paving);
  for (let j = 0; j < rows.length - 1; j++) for (const p of clipStreet({ x0: reg.x0, z0: rows[j][1], x1: reg.x1, z1: rows[j + 1][0] }, excl)) paveStreet(b, p, cfg.paving);
  // îlots : une ou deux rangées de lots
  let squares = 0;
  for (const [bx0, bx1] of cols) {
    for (const [bz0, bz1] of rows) {
      const blk: Rect = { x0: bx0, z0: bz0, x1: bx1, z1: bz1 };
      if (style === 'bidonville') {
        out.push(...shantyBlock(b, cfg, blk, ruined, o));
        continue;
      }
      // une place de temps en temps (sauf corons)
      // une place par quartier, au plus
      if (!squares && rng.chance(SQUARE_CHANCE[style] ?? 0) && (bx1 - bx0) * (bz1 - bz0) <= 560 && b.isFree(blk, 0)) {
        square(b, blk, style);
        squares++;
        continue;
      }
      const depth = bz1 - bz0;
      const twoRows = depth >= cfg.lotD[0] * 2 + 1.5;
      const rowSpecs: { z0: number; z1: number; door: Side }[] = twoRows
        ? [{ z0: bz0, z1: bz0 + depth / 2 - 0.5, door: 'n' }, { z0: bz0 + depth / 2 + 0.5, z1: bz1, door: 's' }]
        : [{ z0: bz0, z1: bz1, door: rng.chance(0.65) ? 's' : 'n' }];
      // bande occupée par chaque rangée (pour les cours intérieures)
      let yardZ0 = bz0;
      let yardZ1 = bz1;
      for (const rs of rowSpecs) {
        // villes serrées : les maisons occupent presque toute la profondeur de l'îlot (petites cours)
        const want = DEEP.has(style) ? Math.min(cfg.lotD[1] * 1.35, rs.z1 - rs.z0 - rng.range(0, 2.2)) : rng.range(cfg.lotD[0], cfg.lotD[1]);
        const lotD = Math.min(rs.z1 - rs.z0, Math.max(cfg.lotD[0], want));
        const lz0 = rs.door === 's' ? rs.z1 - lotD : rs.z0;
        if (rs.door === 'n') yardZ0 = lz0 + lotD + 0.6;
        else yardZ1 = lz0 - 0.6;
        let lx = bx0;
        while (lx < bx1 - 4) {
          const lw = style === 'corons' ? cfg.lotW[0] + rng.next() * (cfg.lotW[1] - cfg.lotW[0]) : rng.range(cfg.lotW[0], cfg.lotW[1]);
          const lx1 = Math.min(bx1, lx + lw);
          if (lx1 - lx >= 4.5) {
            const lo = { ruined, hostile: !!o.hostile, lockChance: o.lockChance, attach: style === 'corons' };
            let h = lotBuilding(b, cfg, { x0: lx, z0: lz0, x1: lx1, z1: lz0 + lotD }, rs.door, lo);
            // lot entamé par un repère (tour, place, grand bâtiment) : on tente une maison plus étroite
            for (const f of [0.62, 0.45]) {
              const w2 = (lx1 - lx) * f;
              if (h || w2 < 4.6) break;
              h = lotBuilding(b, cfg, { x0: lx, z0: lz0, x1: lx + w2, z1: lz0 + lotD }, rs.door, lo) ?? lotBuilding(b, cfg, { x0: lx1 - w2, z0: lz0, x1: lx1, z1: lz0 + lotD }, rs.door, lo);
            }
            if (h) out.push(h);
            else if (style === 'bourg' && rng.chance(0.5)) garden(b, { x0: lx + 0.6, z0: lz0 + 0.6, x1: lx1 - 0.6, z1: lz0 + lotD - 0.6 });
          }
          lx = lx1 + rng.range(cfg.spacing[0], cfg.spacing[1]);
        }
        // jardinets et clôtures derrière les maisons de bourg et les corons
        if ((style === 'bourg' || style === 'corons') && twoRows === false) {
          const gz0 = rs.door === 's' ? rs.z0 : lz0 + lotD + 0.5;
          const gz1 = rs.door === 's' ? lz0 - 0.5 : rs.z1;
          if (gz1 - gz0 > 3) garden(b, { x0: bx0 + 0.5, z0: gz0, x1: bx1 - 0.5, z1: gz1 });
        }
      }
      // cœur d'îlot entre deux rangées dos à dos : potagers, cours encombrées, cabanons
      if (twoRows && yardZ1 - yardZ0 > 3.2) backyard(b, { x0: bx0 + 0.8, z0: yardZ0, x1: bx1 - 0.8, z1: yardZ1 }, style);
    }
  }
  streetDressing(b, reg, cols, rows, cfg, style, o.clutter ?? 1, ruined, excl);
  return out;
}

/** Bidonville : cabanes serrées, passages étroits, bric-à-brac. */
function shantyBlock(b: StationBuilder, cfg: StyleCfg, blk: Rect, ruined: number, o: DistrictOpts): BuildingHandle[] {
  const rng = b.rng;
  const out: BuildingHandle[] = [];
  const n = Math.round(((blk.x1 - blk.x0) * (blk.z1 - blk.z0)) / 34);
  for (let i = 0; i < n; i++) {
    const w = rng.range(cfg.lotW[0], cfg.lotW[1]);
    const d = rng.range(cfg.lotD[0], cfg.lotD[1]);
    const p = b.findSpot(w + 1.4, d + 1.4, blk, 14, 0.2);
    if (!p) continue;
    const door: Side = rng.pick(['s', 'n', 'e', 'w'] as const);
    const h = lotBuilding(b, cfg, { x0: p.x - (w + 1.3) / 2, z0: p.z - (d + 1.3) / 2, x1: p.x + (w + 1.3) / 2, z1: p.z + (d + 1.3) / 2 }, door, { ruined, hostile: !!o.hostile, lockChance: o.lockChance });
    if (h) out.push(h);
  }
  // conteneurs maritimes et bric-à-brac entre les cabanes
  for (let i = 0; i < 2; i++) {
    const ry = rng.chance(0.5) ? 0 : Math.PI / 2;
    const p = b.findSpot(ry ? 6.4 : 2.8, ry ? 2.8 : 6.4, blk, 10, 0.3);
    if (p) {
      b.furniture('conteneur', p.x, p.z, ry, { profile: 'bandit', building: null });
      b.reserve({ x0: p.x - 3.4, z0: p.z - 3.4, x1: p.x + 3.4, z1: p.z + 3.4 });
    }
  }
  return out;
}

/** Une place : pavés, puits ou fontaine, bancs, arbres, étals. */
function square(b: StationBuilder, r: Rect, style: DistrictStyle): void {
  const rng = b.rng;
  const g = b.g;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  paveStreet(b, r, style === 'bourg' ? 0x7a6a52 : 0x6e6a62);
  b.reserve(r);
  if (rng.chance(0.5)) {
    // fontaine
    g.cyl(2.2, 2.4, 0.6, cx, 0.3, cz, 0x8a8478, { seg: 12, pat: PAT.pierre });
    g.cyl(1.9, 1.9, 0.05, cx, 0.58, cz, 0x3a6a78, { seg: 12 });
    g.cyl(0.3, 0.4, 1.6, cx, 1.0, cz, 0x9a9488, { seg: 8 });
    b.colliders.addCircle(cx, cz, 2.4);
  } else {
    // statue sur socle
    g.box(1.6, 1.4, 1.6, cx, 0.7, cz, 0x8a8478, { pat: PAT.pierre });
    g.box(0.6, 1.6, 0.5, cx, 2.2, cz, 0x5a7a6a);
    g.sphere(0.32, cx, 3.2, cz, 0x5a7a6a);
    b.colliders.addRect(cx - 0.9, cz - 0.9, cx + 0.9, cz + 0.9);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = cx + dx * ((r.x1 - r.x0) / 2 - 2.5);
    const tz = cz + dz * ((r.z1 - r.z0) / 2 - 2.5);
    if (rng.chance(0.7)) b.addCollider(P.oak(g, tx, tz, 0.8 + rng.next() * 0.3, b.winter, rng.chance(0.3)));
    else b.furniture('banc', tx, tz, dz > 0 ? Math.PI : 0, { building: null });
  }
  if (style === 'citadelle' || style === 'bourg') {
    const colors = [0xb94e3a, 0x3a6a8a, 0xc9a040, 0x6a8a3a];
    for (let i = 0; i < 2; i++) {
      const sx = cx + (i ? 4.5 : -4.5);
      b.addCollider(P.tent(g, sx, cz + 4, 0, rng.pick(colors)));
    }
  }
}

/** Cœur d'îlot : jardins, cours de service, appentis. */
function backyard(b: StationBuilder, r: Rect, style: DistrictStyle): void {
  const rng = b.rng;
  const g = b.g;
  const w = r.x1 - r.x0;
  if (w < 6) return;
  // découpé en parcelles d'une douzaine de mètres
  const n = Math.max(1, Math.round(w / 12));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const p: Rect = { x0: r.x0 + i * pw + 0.4, z0: r.z0, x1: r.x0 + (i + 1) * pw - 0.4, z1: r.z1 };
    const k = rng.next();
    if ((style === 'bourg' || style === 'corons' || style === 'monastique' || style === 'citadelle') && k < 0.45) garden(b, p);
    else if (k < 0.7 && p.z1 - p.z0 > 3.6 && p.x1 - p.x0 > 4) {
      // appentis : petite remise fouillable
      const sw = Math.min(3.6, p.x1 - p.x0 - 1);
      const sx = rng.range(p.x0 + sw / 2 + 0.3, p.x1 - sw / 2 - 0.3);
      const sz = (p.z0 + p.z1) / 2;
      const fr: Rect = { x0: sx - sw / 2, z0: sz - 1.1, x1: sx + sw / 2, z1: sz + 1.1 };
      if (!b.isFree(fr, 0.2)) continue;
      g.box(sw, 2.0, 2.2, sx, 1.0, sz, rng.pick([0x6b4e35, 0x5e6a6e, 0x7a5a42]), { pat: style === 'ville' || style === 'industriel' ? PAT.tole : PAT.planches, grad: 0.15 });
      g.box(sw + 0.3, 0.12, 2.6, sx, 2.06, sz, 0x4a4e52, { pat: PAT.toleToit, rx: 0.1 });
      b.colliders.addRect(fr.x0, fr.z0, fr.x1, fr.z1, 'wall');
      b.reserve(fr);
      // établi ou caisse adossés à l'appentis, côté cour
      if (p.z1 - sz > 2.4) b.furniture(rng.chance(0.5) ? 'caisse' : 'etabli', sx, sz + 1.5, 0, { profile: style === 'ville' || style === 'industriel' ? 'industriel' : 'maison', building: null });
    } else {
      // cour encombrée : tonneaux, caisses, bois
      for (let j = 0; j < 3; j++) {
        const x = rng.range(p.x0 + 0.8, p.x1 - 0.8);
        const z = rng.range(p.z0 + 0.8, p.z1 - 0.8);
        if (!b.isFree({ x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6 }, 0.1)) continue;
        if (rng.chance(0.5)) b.addCollider(P.barrel(g, x, z, rng.pick([0x5a6a3a, 0x8a2a1e, 0x4a5a6a])));
        else b.furniture(rng.chance(0.6) ? 'caisse' : 'poubelle', x, z, rng.next() * Math.PI, { profile: 'general', building: null });
        b.reserve({ x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6 });
      }
    }
  }
}

/** Potager clôturé. */
function garden(b: StationBuilder, r: Rect): void {
  if (!b.isFree(r, 0)) return;
  const g = b.g;
  const rng = b.rng;
  b.addCollider(P.fence(g, r.x0, r.z0, r.x1, r.z0, 0x7a6448));
  b.addCollider(P.fence(g, r.x0, r.z1, r.x1, r.z1, 0x7a6448));
  for (let z = r.z0 + 1; z < r.z1 - 0.6; z += 1.2) {
    g.box(r.x1 - r.x0 - 1.2, 0.12, 0.6, (r.x0 + r.x1) / 2, 0.06, z, 0x4a3a2a);
    if (!b.winter) for (let x = r.x0 + 1; x < r.x1 - 0.8; x += 0.9) g.layer('foliage').dodeca(0.22, x, 0.25, z, rng.chance(0.2) ? 0xc0402a : 0x5a8a3a, { sy: 0.7 }).layer('base');
  }
  b.reserve(r);
}

/** Lampadaires, voitures, poubelles, barricades le long des rues. */
function streetDressing(b: StationBuilder, reg: Rect, cols: [number, number][], rows: [number, number][], cfg: StyleCfg, style: DistrictStyle, clutter: number, ruined: number, excl: Rect[]): void {
  const rng = b.rng;
  const g = b.g;
  const excluded = (x: number, z: number) => excl.some((e) => x > e.x0 - 1 && x < e.x1 + 1 && z > e.z0 - 1 && z < e.z1 + 1);
  // rues est-ouest
  for (let j = 0; j < rows.length - 1; j++) {
    const z0 = rows[j][1];
    const z1 = rows[j + 1][0];
    const zc = (z0 + z1) / 2;
    for (let x = reg.x0 + 6; x < reg.x1 - 4; x += 15) {
      if (cfg.lamps && b.isFree({ x0: x - 0.4, z0: z0 + 0.2, x1: x + 0.4, z1: z0 + 1 }, 0)) {
        b.addCollider(P.lampPost(g, x, z0 + 0.6, true));
        b.lights.push({ x: x + 0.75, y: 4, z: z0 + 0.6, color: 0xffd8a0, intensity: 2.6, distance: 12, night: true });
      }
      const k = rng.next();
      if (style === 'ville' || style === 'industriel') {
        if (k < 0.3 * clutter) {
          const cz = zc + rng.range(-1, 1);
          if (b.isFree({ x0: x + 3, z0: cz - 1.2, x1: x + 8, z1: cz + 1.2 }, 0)) b.addCollider(P.car(g, x + 5.5, cz, Math.PI / 2 + rng.range(-0.25, 0.25), rng.pick([0x7a3a2a, 0x3a5a7a, 0x6a6a3a, 0x8a8a8a, 0x2a4a3a]), true));
        } else if (k < 0.42 * clutter && ruined > 0.2) {
          b.addCollider(P.sandbags(g, x + 5, zc, rng.range(-0.3, 0.3), 3));
        }
      }
      if (rng.chance(0.18 * clutter)) {
        const px = x + rng.range(1, 6);
        if (b.isFree({ x0: px - 0.4, z0: z1 - 1.0, x1: px + 0.4, z1: z1 - 0.2 }, 0)) b.furniture('poubelle', px, z1 - 0.6, Math.PI, { profile: 'general', building: null });
      }
    }
  }
  // rues nord-sud : quelques lampadaires et cordes à linge entre les façades
  for (let i = 0; i < cols.length - 1; i++) {
    const x0 = cols[i][1];
    const x1 = cols[i + 1][0];
    for (let z = reg.z0 + 5; z < reg.z1 - 4; z += 16) {
      if (cfg.lamps && b.isFree({ x0: x0 + 0.2, z0: z - 0.4, x1: x0 + 1, z1: z + 0.4 }, 0)) {
        b.addCollider(P.lampPost(g, x0 + 0.6, z, true));
        b.lights.push({ x: x0 + 1.35, y: 4, z, color: 0xffd8a0, intensity: 2.4, distance: 11, night: true });
      }
      // (seulement entre deux façades : un mur de chaque côté de la ruelle)
      const walled = !b.isFree({ x0: x0 - 1.6, z0: z + 1.6, x1: x0 - 0.4, z1: z + 2.4 }, 0) && !b.isFree({ x0: x1 + 0.4, z0: z + 1.6, x1: x1 + 1.6, z1: z + 2.4 }, 0);
      if ((style === 'citadelle' || style === 'bidonville' || style === 'corons' || style === 'souk') && walled && rng.chance(0.5) && !excluded(x0, z + 2) && !excluded(x1, z + 2)) {
        // corde à linge en travers de la ruelle
        const y = 3.0 + rng.next() * 0.6;
        g.box(x1 - x0, 0.03, 0.03, (x0 + x1) / 2, y, z + 2, 0x3a3a3a);
        for (let k = 0; k < 4; k++) g.box(0.4, 0.5, 0.03, x0 + 0.8 + k * ((x1 - x0 - 1.6) / 3), y - 0.28, z + 2, rng.pick([0xd8d0c0, 0x8a3a3a, 0x3a5a8a, 0xc8b060]));
      }
    }
  }
}

// ---------------------------------------------------------------- fortifications

export type RampartStyle = 'pierre' | 'beton' | 'tole' | 'palissade';

export interface RampartOpts {
  style: RampartStyle;
  h?: number;
  gates: { side: Side; at: number; w?: number }[];
  towers?: boolean;
  towerInterior?: InteriorKind;
}

const RAMPART: Record<RampartStyle, { t: number; color: number; pat: number; top: 'creneaux' | 'pieux' | 'tole' }> = {
  pierre: { t: 1.4, color: 0x8a8478, pat: PAT.pierre, top: 'creneaux' },
  beton: { t: 1.0, color: 0x7a7a74, pat: PAT.beton, top: 'creneaux' },
  tole: { t: 0.5, color: 0x6a5a4a, pat: PAT.tole, top: 'tole' },
  palissade: { t: 0.6, color: 0x6b4e35, pat: PAT.lames, top: 'pieux' },
};

/**
 * Rempart autour d'un rectangle : murs épais, portes, tours d'angle habitables.
 * Le mur sud (côté caméra) s'efface quand on longe son pied à l'intérieur.
 */
export function rampart(b: StationBuilder, r: Rect, o: RampartOpts): BuildingHandle[] {
  const rng = b.rng;
  const st = RAMPART[o.style];
  const h = o.h ?? (o.style === 'tole' ? 4.2 : o.style === 'palissade' ? 3.8 : 5.6);
  const T = st.t;
  const towers: BuildingHandle[] = [];
  const ts = o.towers ? 5.2 : 0;
  // murs est et ouest : géométrie fixe de la gare ; murs nord et sud à part (ils s'estompent)
  const wallG = b.g;
  const southG = new GeoBuilder({ mergeLights: true });
  const northG = new GeoBuilder({ mergeLights: true });
  const sides: Side[] = ['n', 's', 'e', 'w'];
  for (const side of sides) {
    const alongX = side === 'n' || side === 's';
    const fixed = side === 'n' ? r.z0 : side === 's' ? r.z1 : side === 'w' ? r.x0 : r.x1;
    // sans tours, les murs nord et sud couvrent les angles ; les murs est et ouest s'arrêtent contre eux
    const inset = o.towers ? ts / 2 : alongX ? -T / 2 : T / 2;
    const a0 = (alongX ? r.x0 : r.z0) + inset;
    const a1 = (alongX ? r.x1 : r.z1) - inset;
    const gates = o.gates.filter((gt) => gt.side === side).map((gt) => ({ c: gt.at, w: gt.w ?? 4.6 })).sort((p, q) => p.c - q.c);
    let cur = a0;
    const segs: [number, number][] = [];
    for (const gt of gates) {
      segs.push([cur, gt.c - gt.w / 2]);
      cur = gt.c + gt.w / 2;
    }
    segs.push([cur, a1]);
    const g = side === 's' ? southG : side === 'n' ? northG : wallG;
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 0.2) continue;
      const len = s1 - s0;
      const mid = (s0 + s1) / 2;
      const wx = alongX ? mid : fixed;
      const wz = alongX ? fixed : mid;
      const sx = alongX ? len : T;
      const sz = alongX ? T : len;
      g.box(sx, h, sz, wx, h / 2, wz, st.color, { pat: st.pat, grad: 0.22, vary: 0.03 });
      b.colliders.addRect(wx - sx / 2, wz - sz / 2, wx + sx / 2, wz + sz / 2, 'wall');
      b.reserve({ x0: wx - sx / 2 - 0.6, z0: wz - sz / 2 - 0.6, x1: wx + sx / 2 + 0.6, z1: wz + sz / 2 + 0.6 });
      // couronnement
      const n = Math.floor(len / 1.6);
      for (let k = 0; k < n; k++) {
        const c = s0 + 0.8 + k * 1.6;
        const px = alongX ? c : fixed;
        const pz = alongX ? fixed : c;
        if (st.top === 'creneaux') {
          if (k % 2 === 0) g.box(alongX ? 0.9 : T + 0.1, 0.7, alongX ? T + 0.1 : 0.9, px, h + 0.35, pz, shade(st.color, 1.05), { pat: st.pat });
        } else if (st.top === 'pieux') {
          g.cone(0.22, 0.7, px, h + 0.35, pz, 0x5a4028, { seg: 4 });
          g.cone(0.22, 0.6, px + (alongX ? 0.8 : 0), h + 0.3, pz + (alongX ? 0 : 0.8), 0x5a4028, { seg: 4 });
        } else if (rng.chance(0.6)) {
          g.box(alongX ? 1.4 : T, rng.range(0.3, 1.1), alongX ? T : 1.4, px, h + 0.3, pz, rng.pick([0x7a5a42, 0x5e6a6e, 0x8a4a2a]), { pat: PAT.tole, rz: alongX ? rng.range(-0.1, 0.1) : 0, rx: alongX ? 0 : rng.range(-0.1, 0.1) });
        }
      }
      // chemin de ronde (vu de dessus) et pieux défensifs côté extérieur
      if (o.style === 'pierre' || o.style === 'beton') g.box(alongX ? len : 0.9, 0.12, alongX ? 0.9 : len, wx + (alongX ? 0 : side === 'w' ? 0.9 : -0.9), h - 0.4, wz + (alongX ? (side === 'n' ? 0.9 : -0.9) : 0), shade(st.color, 0.85));
    }
    // portes : piliers, linteau, vantaux ouverts et braseros
    for (const gt of gates) {
      const gx = alongX ? gt.c : fixed;
      const gz = alongX ? fixed : gt.c;
      const half = gt.w / 2;
      // abords dégagés de part et d'autre de la porte (rien ne doit la boucher)
      const ext = 7;
      b.reserve(alongX ? { x0: gx - half - 1, z0: gz - ext, x1: gx + half + 1, z1: gz + ext } : { x0: gx - ext, z0: gz - half - 1, x1: gx + ext, z1: gz + half + 1 });
      for (const sgn of [-1, 1]) {
        const px = gx + (alongX ? sgn * (half + 0.45) : 0);
        const pz = gz + (alongX ? 0 : sgn * (half + 0.45));
        g.box(alongX ? 0.9 : T + 0.6, h + 1.2, alongX ? T + 0.6 : 0.9, px, (h + 1.2) / 2, pz, shade(st.color, 0.92), { pat: st.pat });
        // vantail grand ouvert, plaqué contre le mur intérieur
        const inward = side === 'n' ? 1 : side === 's' ? -1 : side === 'w' ? 1 : -1;
        const lx = gx + (alongX ? sgn * half * 0.5 : inward * (T / 2 + half * 0.5));
        const lz = gz + (alongX ? inward * (T / 2 + half * 0.5) : sgn * half * 0.5);
        g.box(alongX ? 0.14 : half, 3.4, alongX ? half : 0.14, lx + (alongX ? sgn * half * 0.5 : 0), 1.7, lz, o.style === 'tole' ? 0x6a5a4a : 0x5a3e28, { pat: o.style === 'tole' ? PAT.tole : PAT.lames });
        // brasero
        const bx = gx + (alongX ? sgn * (half + 1.4) : inward * -1.6);
        const bz = gz + (alongX ? inward * -1.6 : sgn * (half + 1.4));
        g.cyl(0.35, 0.25, 0.9, bx, 0.45, bz, 0x3a3a3a, { seg: 6 });
        g.layer('glow').cone(0.3, 0.5, bx, 1.1, bz, 0xff9a30, { seg: 5 }).layer('base');
        b.colliders.addCircle(bx, bz, 0.4);
        b.lights.push({ x: bx, y: 1.6, z: bz, color: 0xff9a40, intensity: 2.8, distance: 9 });
      }
      if (o.style === 'pierre' || o.style === 'beton') g.box(alongX ? gt.w + 1.8 : T + 0.6, 1.2, alongX ? T + 0.6 : gt.w + 1.8, gx, h + 0.6, gz, shade(st.color, 0.95), { pat: st.pat });
      // bannières
      for (const sgn of [-1, 1]) {
        const px = gx + (alongX ? sgn * (half + 0.45) : 0);
        const pz = gz + (alongX ? 0 : sgn * (half + 0.45));
        const out = side === 'n' ? -1 : side === 's' ? 1 : side === 'w' ? -1 : 1;
        g.box(alongX ? 0.7 : 0.04, 1.8, alongX ? 0.04 : 0.7, px + (alongX ? 0 : out * (T / 2 + 0.33)), h - 0.4, pz + (alongX ? out * (T / 2 + 0.33) : 0), rng.pick([0x8a2a2a, 0x2a4a7a, 0xc9a040]));
      }
    }
  }
  const root = new THREE.Group();
  b.root.add(root);
  // les murs est-ouest masquent ce qui se trouve juste au nord : ils s'estompent quand on s'y abrite
  // (mur sud vu de l'intérieur, mur nord vu depuis la gare)
  for (const [gb, zc] of [[southG, r.z1], [northG, r.z0]] as const) {
    if (gb.isEmpty) continue;
    const grp = gb.toGroup();
    root.add(grp);
    b.cutaway({ x0: r.x0 - 1, z0: zc - T / 2, x1: r.x1 + 1, z1: zc + T / 2 }, grp);
  }
  // tours d'angle habitables
  if (o.towers) {
    const corners: [number, number, Side][] = [[r.x0, r.z0, 's'], [r.x1, r.z0, 's'], [r.x0, r.z1, 'n'], [r.x1, r.z1, 'n']];
    for (const [cx, cz, door] of corners) {
      const t = b.building({
        x: cx, z: cz, w: ts, d: ts, h: h + 2.6, name: 'Tour',
        wall: st.color, style: o.style === 'beton' ? 'beton' : o.style === 'pierre' ? 'pierre' : o.style === 'tole' ? 'tole' : 'bois',
        roofType: o.style === 'palissade' ? 'pignon' : 'plat', interior: o.towerInterior ?? (rng.chance(0.5) ? 'armurerie' : 'vide'),
        loot: 'militaire', richness: 0.8, windows: o.style !== 'tole',
        doors: [{ side: door, offset: cx < (r.x0 + r.x1) / 2 ? 1.5 : -1.5 }],
      });
      towers.push(t);
      b.lights.push({ x: cx, y: h + 2.8, z: cz, color: 0xffd090, intensity: 2.5, distance: 12, night: true });
    }
  }
  return towers;
}

function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const bl = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | bl;
}

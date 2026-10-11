import type { Rng } from '../core/rng';
import type { ResourceId } from '../data/items';
import { PLAYER_WEAPON_IDS, WEAPONS } from '../data/weapons';

export type LootEntry =
  | { kind: 'resource'; id: ResourceId; qty: number }
  | { kind: 'weapon'; id: string; level: number }
  | { kind: 'gear'; id: string }
  | { kind: 'tool'; id: string }
  | { kind: 'item'; id: string; qty: number };

export type LootProfile = 'general' | 'medical' | 'militaire' | 'industriel' | 'nourriture' | 'tech' | 'charbon' | 'bandit' | 'maison' | 'luxe';

interface Row {
  w: number;
  make: (rng: Rng, tier: number) => LootEntry;
}

const res = (id: ResourceId, min: number, max: number, scale = 0.25): Row['make'] => (rng, tier) => ({ kind: 'resource', id, qty: Math.max(1, Math.round(rng.int(min, max) * (1 + tier * scale))) });

const TABLES: Record<LootProfile, Row[]> = {
  general: [
    { w: 3, make: res('ferraille', 3, 9) },
    { w: 2.5, make: res('nourriture', 2, 4) },
    { w: 2.2, make: res('balles', 6, 18) },
    { w: 1.2, make: res('jetons', 5, 18) },
    { w: 0.8, make: res('medicaments', 1, 2, 0.1) },
    { w: 0.8, make: res('cartouches', 2, 6) },
    { w: 0.6, make: res('crochets', 1, 3, 0) },
    { w: 0.4, make: res('filtres', 1, 2, 0) },
    { w: 0.35, make: res('trousses', 1, 1, 0) },
    { w: 0.25, make: res('dynamite', 1, 2, 0) },
  ],
  maison: [
    { w: 3, make: res('nourriture', 1, 4) },
    { w: 1.5, make: res('jetons', 3, 12) },
    { w: 1.5, make: res('ferraille', 2, 5) },
    { w: 0.8, make: res('medicaments', 1, 1, 0.1) },
    { w: 0.6, make: res('balles', 4, 10) },
    { w: 0.4, make: res('trousses', 1, 1, 0) },
    { w: 0.3, make: (rng) => ({ kind: 'item', id: rng.pick(['photo', 'medaillon', 'journal_bord']), qty: 1 }) },
  ],
  medical: [
    { w: 3, make: res('medicaments', 1, 4, 0.2) },
    { w: 2, make: res('trousses', 1, 2, 0.1) },
    { w: 1.4, make: res('antirad', 1, 2, 0.1) },
    { w: 1, make: res('filtres', 1, 2, 0) },
    { w: 0.6, make: res('nourriture', 1, 3) },
  ],
  militaire: [
    { w: 3, make: res('balles', 12, 30) },
    { w: 1.6, make: res('cartouches', 4, 10) },
    { w: 1.0, make: res('obus', 1, 3, 0.2) },
    { w: 0.8, make: res('dynamite', 1, 2, 0.1) },
    { w: 0.7, make: res('trousses', 1, 1, 0) },
    { w: 0.6, make: res('filtres', 1, 3, 0) },
    { w: 0.5, make: (rng, tier) => ({ kind: 'weapon', id: pickWeapon(rng, tier), level: rng.chance(0.2 + tier * 0.05) ? 1 : 0 }) },
    { w: 0.25, make: (rng) => ({ kind: 'gear', id: rng.pick(['armure', 'masque', 'manteau']) }) },
  ],
  industriel: [
    { w: 3.5, make: res('ferraille', 5, 14) },
    { w: 1.2, make: res('charbon', 4, 12) },
    { w: 1, make: res('cellules', 1, 3, 0.2) },
    { w: 0.8, make: res('crochets', 1, 2, 0) },
    { w: 0.7, make: res('dynamite', 1, 2, 0) },
    { w: 0.5, make: res('filtres', 1, 2, 0) },
    { w: 0.25, make: (rng) => ({ kind: 'item', id: rng.pick(['fusible', 'piece_moteur']), qty: 1 }) },
  ],
  nourriture: [
    { w: 4, make: res('nourriture', 3, 6) },
    { w: 1, make: res('jetons', 3, 10) },
    { w: 0.6, make: (rng) => ({ kind: 'item', id: 'graines', qty: rng.int(1, 2) }) },
  ],
  tech: [
    { w: 2.5, make: res('cellules', 2, 5, 0.25) },
    { w: 2, make: res('ferraille', 4, 10) },
    { w: 1, make: res('antirad', 1, 2, 0.1) },
    { w: 0.8, make: res('medicaments', 1, 2, 0.1) },
    { w: 0.4, make: (rng) => ({ kind: 'item', id: rng.pick(['fusible', 'piece_moteur']), qty: 1 }) },
    { w: 0.3, make: (rng, tier) => ({ kind: 'weapon', id: tier >= 2 && rng.chance(0.5) ? 'fusil_tesla' : 'mitraillette', level: 0 }) },
    { w: 0.2, make: () => ({ kind: 'gear', id: 'geiger' }) },
  ],
  charbon: [
    { w: 5, make: res('charbon', 8, 18, 0.15) },
    { w: 1, make: res('ferraille', 2, 5) },
    { w: 0.5, make: res('dynamite', 1, 2, 0) },
  ],
  bandit: [
    { w: 2.5, make: res('jetons', 8, 25) },
    { w: 2, make: res('balles', 10, 24) },
    { w: 1.4, make: res('nourriture', 2, 4) },
    { w: 1, make: res('cartouches', 3, 8) },
    { w: 0.7, make: res('dynamite', 1, 2, 0) },
    { w: 0.6, make: res('medicaments', 1, 2, 0.1) },
    { w: 0.5, make: res('obus', 1, 2, 0.1) },
    { w: 0.45, make: (rng, tier) => ({ kind: 'weapon', id: pickWeapon(rng, tier), level: rng.chance(0.3) ? 1 : 0 }) },
  ],
  luxe: [
    { w: 3, make: res('jetons', 20, 60) },
    { w: 1, make: res('medicaments', 2, 4) },
    { w: 1, make: (rng) => ({ kind: 'item', id: rng.pick(['medaillon', 'photo', 'graines']), qty: 1 }) },
    { w: 0.6, make: (rng, tier) => ({ kind: 'weapon', id: pickWeapon(rng, tier + 1), level: 1 }) },
  ],
};

function pickWeapon(rng: Rng, tier: number): string {
  const pool = PLAYER_WEAPON_IDS.filter((id) => WEAPONS[id].tier <= Math.min(3, 1 + Math.floor(tier / 1.5)) && WEAPONS[id].tier > 0);
  return rng.pick(pool.length ? pool : ['mitraillette']);
}

/** Tire le contenu d'un conteneur. */
export function rollLoot(rng: Rng, profile: LootProfile, tier: number, richness = 1, lootMult = 1): LootEntry[] {
  const table = TABLES[profile];
  const n = Math.max(1, Math.round((1 + rng.next() * 2) * richness));
  const out: LootEntry[] = [];
  for (let i = 0; i < n; i++) {
    const row = rng.pickWeighted(table, (r) => r.w);
    const e = row.make(rng, tier);
    if (e.kind === 'resource') e.qty = Math.max(1, Math.round(e.qty * lootMult));
    const same = out.find((o) => o.kind === 'resource' && e.kind === 'resource' && o.id === e.id);
    if (same && same.kind === 'resource' && e.kind === 'resource') same.qty += e.qty;
    else out.push(e);
  }
  return out;
}

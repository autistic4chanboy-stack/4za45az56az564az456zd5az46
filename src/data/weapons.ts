import type { SfxId } from '../core/audio';
import type { ResourceId } from './items';

export type FireKind = 'melee' | 'bullet' | 'pellets' | 'shell' | 'flame' | 'arc' | 'spit';

export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  kind: FireKind;
  damage: number;
  /** Tirs par seconde. */
  rate: number;
  range: number;
  spread: number;
  pellets?: number;
  /** Vitesse du projectile (m/s) pour shell/spit. */
  speed?: number;
  splash?: number;
  ammo: ResourceId | null;
  /** Nombre de tirs par unité de munition (défaut 1). */
  shotsPerAmmo?: number;
  /** Taille du chargeur (0 = pas de chargeur). */
  mag: number;
  reload: number;
  knockback?: number;
  pierce?: number;
  chain?: number;
  /** Tir automatique en maintenant le clic. */
  auto: boolean;
  sound: SfxId;
  price: number;
  tier: number;
  color: number;
  /** Ouverture de l'arc de mêlée (radians). */
  arc?: number;
  /** Ralentissement infligé (0..1). */
  slow?: number;
  /** Dégâts de brûlure par seconde (3 s). */
  burn?: number;
  /** Dégâts multipliés contre les structures (wagons). */
  structureMult?: number;
  /** Laisse une flaque d'acide/feu au sol. */
  puddle?: 'acid' | 'fire' | 'ice';
}

export const WEAPONS: Record<string, WeaponDef> = {
  // ------------------------------------------------------------ armes personnelles
  cle: {
    id: 'cle', name: 'Clé à molette', desc: 'Lourde, fiable, inépuisable. L\'arme de tout bon cheminot.', icon: 'wrench',
    kind: 'melee', damage: 24, rate: 2.2, range: 2.0, spread: 0, ammo: null, mag: 0, reload: 0, knockback: 4, auto: true,
    sound: 'melee', price: 0, tier: 0, color: 0xffffff, arc: 1.9,
  },
  machette: {
    id: 'machette', name: 'Machette', desc: 'Rapide et tranchante.', icon: 'machete',
    kind: 'melee', damage: 36, rate: 2.4, range: 2.2, spread: 0, ammo: null, mag: 0, reload: 0, knockback: 3, auto: true,
    sound: 'melee', price: 60, tier: 1, color: 0xffffff, arc: 2.1,
  },
  revolver: {
    id: 'revolver', name: 'Revolver', desc: 'Six coups, précis et puissant.', icon: 'revolver',
    kind: 'bullet', damage: 30, rate: 3, range: 26, spread: 0.035, ammo: 'balles', mag: 6, reload: 1.6, knockback: 2, auto: false,
    sound: 'pistol', price: 80, tier: 0, color: 0xffe08a,
  },
  mitraillette: {
    id: 'mitraillette', name: 'Mitraillette', desc: 'Cadence élevée, précision médiocre.', icon: 'smg',
    kind: 'bullet', damage: 12, rate: 10, range: 22, spread: 0.09, ammo: 'balles', mag: 32, reload: 2.0, knockback: 0.6, auto: true,
    sound: 'smg', price: 180, tier: 1, color: 0xffd070,
  },
  fusil_pompe: {
    id: 'fusil_pompe', name: 'Fusil à pompe', desc: 'Dévastateur à courte portée.', icon: 'shotgun',
    kind: 'pellets', damage: 12, pellets: 7, rate: 1.25, range: 13, spread: 0.3, ammo: 'cartouches', mag: 6, reload: 2.4, knockback: 5, auto: false,
    sound: 'shotgun', price: 170, tier: 1, color: 0xffc070,
  },
  fusil_precision: {
    id: 'fusil_precision', name: 'Fusil de précision', desc: 'Longue portée, transperce deux cibles.', icon: 'rifle',
    kind: 'bullet', damage: 90, rate: 0.85, range: 44, spread: 0.006, pierce: 2, ammo: 'balles', mag: 5, reload: 2.5, knockback: 4, auto: false,
    sound: 'rifle', price: 260, tier: 2, color: 0xfff0b0,
  },
  lance_grenades: {
    id: 'lance_grenades', name: 'Lance-grenades', desc: 'Obus explosifs à tir courbe. Ravage les groupes.', icon: 'launcher',
    kind: 'shell', damage: 95, splash: 3.6, speed: 22, rate: 0.9, range: 24, spread: 0.02, ammo: 'obus', mag: 4, reload: 2.8, knockback: 8, auto: false,
    sound: 'cannon', price: 320, tier: 2, color: 0xffa040, structureMult: 2,
  },
  fusil_tesla: {
    id: 'fusil_tesla', name: 'Fusil Tesla', desc: 'Arc électrique qui rebondit entre trois cibles. 1 cellule = 5 tirs.', icon: 'tesla',
    kind: 'arc', damage: 30, chain: 3, rate: 3, range: 17, spread: 0, ammo: 'cellules', shotsPerAmmo: 5, mag: 20, reload: 2.2, auto: true,
    sound: 'tesla', price: 380, tier: 3, color: 0x8fd8ff,
  },

  // ------------------------------------------------------------ armes de tourelles
  t_mitrailleuse: {
    id: 't_mitrailleuse', name: 'Mitrailleuse', desc: '', icon: 'smg',
    kind: 'bullet', damage: 11, rate: 5, range: 27, spread: 0.06, ammo: 'balles', shotsPerAmmo: 2, mag: 0, reload: 0, knockback: 0.8, auto: true,
    sound: 'smg', price: 0, tier: 0, color: 0xffd070,
  },
  t_canon: {
    id: 't_canon', name: 'Canon', desc: '', icon: 'cannon',
    kind: 'shell', damage: 130, splash: 3.8, speed: 32, rate: 0.42, range: 40, spread: 0.015, ammo: 'obus', mag: 0, reload: 0, knockback: 10, auto: true,
    sound: 'cannon', price: 0, tier: 0, color: 0xffa040, structureMult: 2,
  },
  t_lanceflammes: {
    id: 't_lanceflammes', name: 'Lance-flammes', desc: '', icon: 'flame',
    kind: 'flame', damage: 9, rate: 4, range: 10, spread: 0.45, ammo: 'charbon', shotsPerAmmo: 14, mag: 0, reload: 0, auto: true,
    sound: 'flame', price: 0, tier: 0, color: 0xff8030, burn: 7,
  },
  t_tesla: {
    id: 't_tesla', name: 'Bobine Tesla', desc: '', icon: 'tesla',
    kind: 'arc', damage: 32, chain: 4, rate: 1.25, range: 19, spread: 0, ammo: null, mag: 0, reload: 0, auto: true,
    sound: 'tesla', price: 0, tier: 0, color: 0x8fd8ff,
  },

  // ------------------------------------------------------------ armes ennemies
  e_pistol: {
    id: 'e_pistol', name: 'Pistolet', desc: '', icon: 'revolver', kind: 'bullet', damage: 7, rate: 1.1, range: 17, spread: 0.13,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'pistol', price: 0, tier: 0, color: 0xffb070,
  },
  e_rifle: {
    id: 'e_rifle', name: 'Fusil', desc: '', icon: 'rifle', kind: 'bullet', damage: 17, rate: 0.4, range: 34, spread: 0.04,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'rifle', price: 0, tier: 0, color: 0xffb070,
  },
  e_smg: {
    id: 'e_smg', name: 'Mitrailleuse montée', desc: '', icon: 'smg', kind: 'bullet', damage: 6, rate: 5, range: 22, spread: 0.16,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'smg', price: 0, tier: 0, color: 0xffb070,
  },
  e_shotgun: {
    id: 'e_shotgun', name: 'Tromblon', desc: '', icon: 'shotgun', kind: 'pellets', damage: 7, pellets: 6, rate: 0.8, range: 11, spread: 0.32,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'shotgun', price: 0, tier: 0, color: 0xffb070,
  },
  e_molotov: {
    id: 'e_molotov', name: 'Cocktail incendiaire', desc: '', icon: 'flame', kind: 'shell', damage: 22, splash: 2.6, speed: 14, rate: 0.33, range: 17,
    spread: 0.08, ammo: null, mag: 0, reload: 0, auto: true, sound: 'flame', price: 0, tier: 0, color: 0xff8030, burn: 5, puddle: 'fire', structureMult: 1.5,
  },
  e_club: {
    id: 'e_club', name: 'Gourdin', desc: '', icon: 'wrench', kind: 'melee', damage: 16, rate: 0.85, range: 2.1, spread: 0, arc: 1.6,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'melee', price: 0, tier: 0, color: 0xffffff, knockback: 3,
  },
  e_bite: {
    id: 'e_bite', name: 'Morsure', desc: '', icon: 'fang', kind: 'melee', damage: 8, rate: 1.4, range: 1.7, spread: 0, arc: 1.4,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'bite', price: 0, tier: 0, color: 0xffffff,
  },
  e_claw: {
    id: 'e_claw', name: 'Charge', desc: '', icon: 'fang', kind: 'melee', damage: 34, rate: 0.5, range: 3.2, spread: 0, arc: 1.6,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'hit', price: 0, tier: 0, color: 0xffffff, knockback: 7, structureMult: 1.6,
  },
  e_spit: {
    id: 'e_spit', name: 'Crachat acide', desc: '', icon: 'drop', kind: 'spit', damage: 10, speed: 15, rate: 0.6, range: 15, spread: 0.06,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'spit', price: 0, tier: 0, color: 0x9be22d, puddle: 'acid', splash: 1.2,
  },
  e_sting: {
    id: 'e_sting', name: 'Dard', desc: '', icon: 'fang', kind: 'melee', damage: 3, rate: 2, range: 1.3, spread: 0, arc: 2,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'bite', price: 0, tier: 0, color: 0xffffff,
  },
  e_latch: {
    id: 'e_latch', name: 'Mandibules', desc: '', icon: 'fang', kind: 'melee', damage: 6, rate: 1.1, range: 1.5, spread: 0, arc: 2,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'bite', price: 0, tier: 0, color: 0xffffff, structureMult: 1.3,
  },
  e_frost: {
    id: 'e_frost', name: 'Souffle glacé', desc: '', icon: 'snow', kind: 'spit', damage: 9, speed: 18, rate: 0.8, range: 13, spread: 0.05,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'spit', price: 0, tier: 0, color: 0xbfe8ff, slow: 0.35, puddle: 'ice',
  },
  e_slam: {
    id: 'e_slam', name: 'Écrasement', desc: '', icon: 'fang', kind: 'melee', damage: 45, rate: 0.45, range: 4.2, spread: 0, arc: 2.4,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'explosion', price: 0, tier: 0, color: 0xffffff, knockback: 10, structureMult: 1.8,
  },
  e_queen_spit: {
    id: 'e_queen_spit', name: 'Jet corrosif', desc: '', icon: 'drop', kind: 'spit', damage: 18, speed: 16, rate: 1.2, range: 18, spread: 0.18,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'spit', price: 0, tier: 0, color: 0xc0ff40, puddle: 'acid', splash: 2,
  },
  e_bite_npc: {
    id: 'e_bite_npc', name: 'Poings', desc: '', icon: 'fang', kind: 'melee', damage: 10, rate: 1.2, range: 1.8, spread: 0, arc: 1.6,
    ammo: null, mag: 0, reload: 0, auto: true, sound: 'melee', price: 0, tier: 0, color: 0xffffff,
  },
};

export const PLAYER_WEAPON_IDS = ['cle', 'machette', 'revolver', 'mitraillette', 'fusil_pompe', 'fusil_precision', 'lance_grenades', 'fusil_tesla'];

/** Dégâts par seconde théoriques (aide à l'équilibrage et à l'affichage). */
export function weaponDps(w: WeaponDef, level = 0): number {
  const dmg = w.damage * (1 + 0.15 * level) * (w.pellets ?? 1) * (w.chain ? 1 + (w.chain - 1) * 0.6 : 1);
  return dmg * w.rate;
}

export interface WeaponInstance {
  id: string;
  /** Munitions dans le chargeur. */
  mag: number;
  /** Niveau d'amélioration (0..3) : +15 % dégâts par niveau. */
  level: number;
}

export function newWeapon(id: string, level = 0): WeaponInstance {
  const def = WEAPONS[id];
  return { id, mag: def ? def.mag : 0, level };
}

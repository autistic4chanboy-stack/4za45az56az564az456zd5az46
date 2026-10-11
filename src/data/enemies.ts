import type { BiomeId } from './biomes';

export type EnemyId =
  | 'pillard' | 'brute' | 'tireur' | 'lanceur' | 'chef' | 'abordeur' | 'motard' | 'buggy' | 'camion'
  | 'rodeur' | 'cracheur' | 'mastodonte' | 'nuee' | 'rampant' | 'givreur' | 'fouisseur' | 'infecte'
  | 'reine' | 'behemoth' | 'sentinelle' | 'baron';

export type EnemyModel =
  | 'humanoid' | 'moto' | 'buggy' | 'camion' | 'quadruped' | 'spitter' | 'hulk' | 'swarm' | 'crawler'
  | 'wraith' | 'burrower' | 'queen' | 'behemoth' | 'turret';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  faction: 'bandit' | 'monster' | 'machine';
  hp: number;
  /** Vitesse sol maximale (m/s). Un train plus rapide les distance. */
  speed: number;
  radius: number;
  weapon: string;
  armor?: number;
  /** Préfère attaquer les wagons plutôt que les personnes. */
  attackStructure?: boolean;
  /** Peut monter à bord du train. */
  boards?: boolean;
  flying?: boolean;
  latch?: boolean;
  burrow?: boolean;
  /** Distance de combat préférée (tireurs). */
  preferredRange?: number;
  aggroRange: number;
  xp: number;
  /** Coût dans le budget de vague. */
  threat: number;
  model: EnemyModel;
  color: number;
  color2: number;
  scale: number;
  boss?: boolean;
  fearLight?: boolean;
  winterOnly?: boolean;
  biomes?: BiomeId[];
  /** Transmet une maladie au contact. */
  infects?: boolean;
  /** Fait apparaître des sbires. */
  spawns?: EnemyId;
  loot: { jetons?: [number, number]; balles?: [number, number]; ferraille?: [number, number]; nourriture?: [number, number]; medicaments?: [number, number]; cartouches?: [number, number]; obus?: [number, number] };
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  pillard: {
    id: 'pillard', name: 'Pillard', faction: 'bandit', hp: 55, speed: 6.5, radius: 0.4, weapon: 'e_pistol', preferredRange: 11,
    aggroRange: 20, xp: 8, threat: 2, model: 'humanoid', color: 0x7a3b2e, color2: 0x3a2a20, scale: 1, boards: true,
    loot: { jetons: [1, 6], balles: [2, 8] },
  },
  abordeur: {
    id: 'abordeur', name: 'Abordeur', faction: 'bandit', hp: 60, speed: 7, radius: 0.4, weapon: 'e_club', aggroRange: 25, xp: 9,
    threat: 2.5, model: 'humanoid', color: 0x8a4a2a, color2: 0x2a2a2a, scale: 1, boards: true,
    loot: { jetons: [2, 8], ferraille: [1, 3] },
  },
  brute: {
    id: 'brute', name: 'Brute', faction: 'bandit', hp: 135, speed: 5.6, radius: 0.55, weapon: 'e_club', armor: 0.1, aggroRange: 18,
    xp: 14, threat: 3, model: 'humanoid', color: 0x5a3a2a, color2: 0x4a4a4a, scale: 1.25, boards: true,
    loot: { jetons: [3, 10], ferraille: [2, 5] },
  },
  tireur: {
    id: 'tireur', name: 'Tireur d\'élite', faction: 'bandit', hp: 45, speed: 5.5, radius: 0.4, weapon: 'e_rifle', preferredRange: 24,
    aggroRange: 34, xp: 12, threat: 3, model: 'humanoid', color: 0x4a5a3a, color2: 0x2a3a2a, scale: 1,
    loot: { jetons: [2, 8], balles: [5, 12] },
  },
  lanceur: {
    id: 'lanceur', name: 'Incendiaire', faction: 'bandit', hp: 60, speed: 6, radius: 0.4, weapon: 'e_molotov', preferredRange: 12,
    aggroRange: 20, xp: 12, threat: 3, model: 'humanoid', color: 0x9a5a1a, color2: 0x3a2a1a, scale: 1,
    loot: { jetons: [2, 8], ferraille: [0, 2] },
  },
  chef: {
    id: 'chef', name: 'Chef de bande', faction: 'bandit', hp: 460, speed: 6, radius: 0.55, weapon: 'e_shotgun', armor: 0.2,
    aggroRange: 22, xp: 80, threat: 15, model: 'humanoid', color: 0x8a1a1a, color2: 0x1a1a1a, scale: 1.3, boss: true,
    loot: { jetons: [40, 80], cartouches: [6, 12], obus: [1, 3] },
  },
  baron: {
    id: 'baron', name: 'Le Baron Rouille', faction: 'bandit', hp: 1100, speed: 6.2, radius: 0.6, weapon: 'e_shotgun', armor: 0.3,
    aggroRange: 26, xp: 250, threat: 30, model: 'humanoid', color: 0xa0461e, color2: 0x2a1a10, scale: 1.45, boss: true,
    loot: { jetons: [150, 220], obus: [4, 6], cartouches: [12, 20] },
  },
  motard: {
    id: 'motard', name: 'Motard', faction: 'bandit', hp: 75, speed: 20, radius: 0.8, weapon: 'e_pistol', preferredRange: 9,
    aggroRange: 60, xp: 12, threat: 3, model: 'moto', color: 0x6a2a1a, color2: 0x2a2a2a, scale: 1,
    loot: { jetons: [3, 9], balles: [4, 10] },
  },
  buggy: {
    id: 'buggy', name: 'Buggy armé', faction: 'bandit', hp: 290, speed: 18, radius: 1.5, weapon: 'e_smg', armor: 0.25, preferredRange: 12,
    aggroRange: 60, xp: 30, threat: 7, model: 'buggy', color: 0x8a6a2a, color2: 0x3a3a3a, scale: 1,
    loot: { jetons: [8, 20], ferraille: [6, 14], balles: [10, 20] },
  },
  camion: {
    id: 'camion', name: 'Camion blindé', faction: 'bandit', hp: 950, speed: 15, radius: 2.4, weapon: 'e_smg', armor: 0.35, preferredRange: 9,
    aggroRange: 60, xp: 90, threat: 18, model: 'camion', color: 0x5a4a3a, color2: 0x8a1a1a, scale: 1, boss: true, spawns: 'abordeur',
    loot: { jetons: [40, 70], ferraille: [20, 40], obus: [2, 4] },
  },
  rodeur: {
    id: 'rodeur', name: 'Rôdeur', faction: 'monster', hp: 42, speed: 16, radius: 0.55, weapon: 'e_bite', aggroRange: 30, xp: 6,
    threat: 1.5, model: 'quadruped', color: 0x5a4a42, color2: 0xa04030, scale: 1, attackStructure: true, fearLight: true,
    loot: { nourriture: [0, 2] },
  },
  cracheur: {
    id: 'cracheur', name: 'Cracheur', faction: 'monster', hp: 65, speed: 11, radius: 0.6, weapon: 'e_spit', preferredRange: 10,
    aggroRange: 26, xp: 10, threat: 2.5, model: 'spitter', color: 0x5a7a3a, color2: 0xc0e040, scale: 1, attackStructure: true,
    loot: { medicaments: [0, 1] },
  },
  mastodonte: {
    id: 'mastodonte', name: 'Mastodonte', faction: 'monster', hp: 480, speed: 13, radius: 1.4, weapon: 'e_claw', armor: 0.25,
    aggroRange: 30, xp: 45, threat: 9, model: 'hulk', color: 0x6a5a4a, color2: 0x3a2a22, scale: 1, attackStructure: true,
    loot: { nourriture: [3, 8], ferraille: [0, 4] },
  },
  nuee: {
    id: 'nuee', name: 'Nuée', faction: 'monster', hp: 16, speed: 22, radius: 0.4, weapon: 'e_sting', aggroRange: 40, xp: 2,
    threat: 0.6, model: 'swarm', color: 0x2a2a30, color2: 0xd04040, scale: 1, flying: true, fearLight: true, attackStructure: true,
    loot: {},
  },
  rampant: {
    id: 'rampant', name: 'Rampant', faction: 'monster', hp: 55, speed: 15, radius: 0.5, weapon: 'e_latch', aggroRange: 28, xp: 7,
    threat: 2, model: 'crawler', color: 0x4a3a4a, color2: 0xe0a030, scale: 1, latch: true, attackStructure: true,
    loot: { ferraille: [0, 2] },
  },
  givreur: {
    id: 'givreur', name: 'Spectre du givre', faction: 'monster', hp: 85, speed: 18, radius: 0.55, weapon: 'e_frost', preferredRange: 9,
    aggroRange: 32, xp: 14, threat: 3.5, model: 'wraith', color: 0xbfe0f0, color2: 0x4080c0, scale: 1.1, winterOnly: true, attackStructure: true,
    loot: { medicaments: [0, 1] },
  },
  fouisseur: {
    id: 'fouisseur', name: 'Fouisseur', faction: 'monster', hp: 150, speed: 14, radius: 0.9, weapon: 'e_claw', armor: 0.15, aggroRange: 26,
    xp: 18, threat: 4, model: 'burrower', color: 0x8a6a4a, color2: 0x4a3a2a, scale: 0.8, burrow: true, attackStructure: true,
    biomes: ['desert', 'montagnes', 'ruines'],
    loot: { nourriture: [1, 4] },
  },
  infecte: {
    id: 'infecte', name: 'Infecté', faction: 'monster', hp: 70, speed: 5, radius: 0.42, weapon: 'e_bite_npc', aggroRange: 16, xp: 7,
    threat: 1.5, model: 'humanoid', color: 0x6a7a6a, color2: 0x4a4a4a, scale: 1, infects: true,
    loot: { medicaments: [0, 1], jetons: [0, 4] },
  },
  reine: {
    id: 'reine', name: 'Mère-Rampante', faction: 'monster', hp: 1500, speed: 3.5, radius: 2.2, weapon: 'e_queen_spit', armor: 0.2,
    aggroRange: 28, xp: 200, threat: 25, model: 'queen', color: 0x5a3a5a, color2: 0xe0c030, scale: 1, boss: true, spawns: 'rampant',
    loot: { medicaments: [3, 6], jetons: [40, 80] },
  },
  behemoth: {
    id: 'behemoth', name: 'Béhémoth des glaces', faction: 'monster', hp: 4200, speed: 12, radius: 3, weapon: 'e_slam', armor: 0.3,
    aggroRange: 60, xp: 500, threat: 40, model: 'behemoth', color: 0x9ab0c0, color2: 0x40a0e0, scale: 1, boss: true, spawns: 'givreur',
    attackStructure: true, loot: { jetons: [200, 300], ferraille: [40, 60] },
  },
  sentinelle: {
    id: 'sentinelle', name: 'Sentinelle automatique', faction: 'machine', hp: 220, speed: 0, radius: 0.8, weapon: 'e_smg', armor: 0.4,
    aggroRange: 22, xp: 20, threat: 5, model: 'turret', color: 0x4a5048, color2: 0xd03030, scale: 1,
    loot: { ferraille: [6, 12], balles: [10, 25] },
  },
};

/** Composition des attaques en voyage selon la faction. */
export const TRAVEL_POOLS: Record<'bandit' | 'monster', { id: EnemyId; weight: number; minThreat: number }[]> = {
  bandit: [
    { id: 'motard', weight: 6, minThreat: 0 },
    { id: 'buggy', weight: 2.2, minThreat: 2 },
    { id: 'camion', weight: 0.5, minThreat: 5 },
  ],
  monster: [
    { id: 'rodeur', weight: 6, minThreat: 0 },
    { id: 'cracheur', weight: 3, minThreat: 1 },
    { id: 'rampant', weight: 3, minThreat: 1.5 },
    { id: 'nuee', weight: 3, minThreat: 2 },
    { id: 'mastodonte', weight: 1.1, minThreat: 3 },
    { id: 'givreur', weight: 3, minThreat: 2 },
    { id: 'fouisseur', weight: 1.5, minThreat: 2.5 },
  ],
};

/** Composition des groupes en station. */
export const STATION_POOLS: Record<'bandit' | 'monster' | 'infected', { id: EnemyId; weight: number; minThreat: number }[]> = {
  bandit: [
    { id: 'pillard', weight: 6, minThreat: 0 },
    { id: 'brute', weight: 2.5, minThreat: 1 },
    { id: 'tireur', weight: 2, minThreat: 1.5 },
    { id: 'lanceur', weight: 1.8, minThreat: 2.5 },
  ],
  monster: [
    { id: 'rodeur', weight: 5, minThreat: 0 },
    { id: 'cracheur', weight: 3, minThreat: 1 },
    { id: 'rampant', weight: 2.5, minThreat: 1.5 },
    { id: 'mastodonte', weight: 0.8, minThreat: 3.5 },
    { id: 'givreur', weight: 2.5, minThreat: 2 },
    { id: 'fouisseur', weight: 1.2, minThreat: 2.5 },
  ],
  infected: [
    { id: 'infecte', weight: 6, minThreat: 0 },
    { id: 'rodeur', weight: 2, minThreat: 1 },
    { id: 'cracheur', weight: 1.5, minThreat: 2 },
  ],
};

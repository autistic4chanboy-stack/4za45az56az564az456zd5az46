/** Constantes d'équilibrage centralisées. Toutes les durées sont en secondes réelles (1 s = 1 min de jeu). */

export type Difficulty = 'facile' | 'normal' | 'difficile';

export interface DifficultyDef {
  name: string;
  desc: string;
  enemyHp: number;
  enemyDmg: number;
  loot: number;
  prices: number;
  disease: number;
  attackRate: number;
  coal: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  facile: { name: 'Voyageur', desc: 'Ennemis plus faibles, ressources abondantes. Idéal pour découvrir l\'histoire.', enemyHp: 0.75, enemyDmg: 0.65, loot: 1.4, prices: 0.85, disease: 0.6, attackRate: 0.75, coal: 0.85 },
  normal: { name: 'Convoyeur', desc: 'L\'expérience prévue : chaque ressource compte.', enemyHp: 1, enemyDmg: 1, loot: 1, prices: 1, disease: 1, attackRate: 1, coal: 1 },
  difficile: { name: 'Damné du Rail', desc: 'Ennemis coriaces, pénurie permanente. Pour les vétérans.', enemyHp: 1.25, enemyDmg: 1.3, loot: 0.75, prices: 1.15, disease: 1.3, attackRate: 1.25, coal: 1.15 },
};

export const BAL = {
  // --------------------------------------------------------------- temps
  /** Minutes de jeu par seconde réelle. */
  minutesPerSecond: 1,
  dayStart: 6 * 60,
  nightStart: 20 * 60 + 30,
  dawn: 5 * 60 + 30,

  // --------------------------------------------------------------- train
  /** Vitesses (m/s) par cran de régulateur. */
  speeds: [0, 5, 9, 13, 17],
  speedNames: ['Arrêt', 'Lent', 'Normal', 'Rapide', 'Pleine vapeur'],
  /** Charbon/s par cran (avant facteur de poids). */
  coalRates: [0.006, 0.05, 0.1, 0.17, 0.27],
  /** Facteur de poids : base + par wagon (hors loco). */
  weightBase: 0.75,
  weightPerWagon: 0.09,
  /** Charbon supplémentaire par unité d'énergie consommée. */
  coalPerPower: 0.0016,
  accel: 0.9,
  brake: 2.2,
  /** Pression cible selon le feu ; au-delà de 1.0 => surpression. */
  overpressureDamage: 6,
  /** Points de PV du wagon réparés par unité de ferraille. */
  hpPerScrap: 12,
  /** Vitesse de réparation (PV/s) du joueur ou d'un mécanicien. */
  repairRate: 22,
  /** Seuil de PV (fraction) sous lequel un wagon est critique. */
  criticalHp: 0.25,
  /** Les wagons détachés laissent derrière eux… tout ce qui suit. */
  detachDelay: 6,

  // --------------------------------------------------------------- énergie
  batteryChargeRate: 6,
  batteryDischargeRate: 8,
  heaterDelta: 28,
  tempApproach: 0.025,

  // --------------------------------------------------------------- joueur
  playerHp: 100,
  walkSpeed: 4.6,
  sprintSpeed: 7.2,
  staminaMax: 100,
  sprintCost: 18,
  dodgeCost: 28,
  staminaRegen: 22,
  dodgeTime: 0.32,
  dodgeSpeed: 13,
  medkitHeal: 45,
  antiradAmount: 150,
  filterDuration: 90,

  // --------------------------------------------------------------- dangers
  /** Rads accumulés => malus de PV max. */
  radSickness: [250, 500, 750],
  radLethal: 1000,
  gasDamage: 7,
  /** Perte de chaleur corporelle (/s) par degré sous 10 °C. */
  coldRate: 0.09,
  warmRate: 6,
  hypothermiaDamage: 2.5,
  /** Radiation reçue par les passagers une fois le délai de stationnement dépassé (rads/s). */
  stationRadOverstay: 3,

  // --------------------------------------------------------------- PNJ
  /** Vivres consommés par personne et par heure de jeu (60 s). */
  foodPerHour: 1 / 14,
  /** Moral perdu par heure sans manger. */
  hungerMorale: 6,
  coldMoraleThreshold: 12,
  freezeThreshold: 2,
  contagionPerHour: 0.07,
  theftInterval: [240, 520] as [number, number],
  sabotageChance: 0.5,

  // --------------------------------------------------------------- économie
  sellRatio: 0.45,
  recruitBase: 40,
  stationHeal: 2,
  wageMorale: 8,

  // --------------------------------------------------------------- combats
  enemyHpPerThreat: 0.12,
  enemyDmgPerThreat: 0.07,
  waveBudgetBase: 7,
  waveBudgetPerThreat: 4.5,
  /** Probabilité de base d'attaque par trajet. */
  attackChanceBase: 0.45,
  xpPerLevel: (lvl: number): number => 80 + lvl * 70,
};

/** Valeurs de départ d'une partie. */
export const START_RESOURCES = {
  charbon: 95,
  ferraille: 45,
  nourriture: 30,
  medicaments: 4,
  balles: 130,
  cartouches: 12,
  obus: 6,
  cellules: 0,
  jetons: 80,
  filtres: 2,
  trousses: 3,
  antirad: 1,
  dynamite: 2,
  crochets: 4,
};

/** Définitions des wagons, équipements de toit et décorations. */

export type PowerChannel = 'lumiere' | 'chauffage' | 'armement' | 'bouclier';
export const POWER_CHANNELS: PowerChannel[] = ['lumiere', 'chauffage', 'armement', 'bouclier'];
export const CHANNEL_NAMES: Record<PowerChannel, string> = {
  lumiere: 'Lumière',
  chauffage: 'Chauffage / ventilation',
  armement: 'Armement',
  bouclier: 'Boucliers',
};

export type WagonTypeId =
  | 'locomotive' | 'tender' | 'passagers' | 'fourgon' | 'blinde' | 'atelier' | 'infirmerie'
  | 'generateur' | 'restaurant' | 'salon' | 'serre' | 'plateforme' | 'cellule';

export type WagonFeature = 'cab' | 'firebox' | 'workbench' | 'medbay' | 'kitchen' | 'greenhouse' | 'cells' | 'lounge' | 'generator' | 'coal';

export interface WagonTypeDef {
  id: WagonTypeId;
  name: string;
  desc: string;
  length: number;
  hp: number;
  armor: number;
  roofSlots: number;
  decorSlots: number;
  beds: number;
  storage: number;
  coal: number;
  price: number;
  scrap: number;
  power?: number;
  battery?: number;
  insulation: number;
  color: number;
  trim: number;
  features: WagonFeature[];
  open?: boolean;
}

export const WAGON_TYPES: Record<WagonTypeId, WagonTypeDef> = {
  locomotive: {
    id: 'locomotive', name: 'Locomotive « L\'Espérance »', desc: 'Le cœur du convoi : chaudière, dynamo et poste de conduite.',
    length: 14, hp: 520, armor: 0.2, roofSlots: 1, decorSlots: 0, beds: 0, storage: 20, coal: 40, price: 0, scrap: 0,
    power: 12, battery: 40, insulation: 0.75, color: 0x2b2d33, trim: 0xb8862b, features: ['cab', 'firebox'],
  },
  tender: {
    id: 'tender', name: 'Tender à charbon', desc: 'Réserve de charbon supplémentaire (+110).',
    length: 8, hp: 230, armor: 0.12, roofSlots: 1, decorSlots: 0, beds: 0, storage: 0, coal: 110, price: 150, scrap: 40,
    insulation: 0, color: 0x34302c, trim: 0x6b5a45, features: ['coal'],
  },
  passagers: {
    id: 'passagers', name: 'Voiture-lits', desc: 'Six couchettes pour l\'équipage et les passagers.',
    length: 13, hp: 230, armor: 0.05, roofSlots: 2, decorSlots: 3, beds: 6, storage: 20, coal: 0, price: 200, scrap: 60,
    insulation: 0.55, color: 0x5b2a26, trim: 0xc9a45c, features: [],
  },
  fourgon: {
    id: 'fourgon', name: 'Fourgon de marchandises', desc: 'Grande soute : +250 de capacité de stockage.',
    length: 12, hp: 290, armor: 0.1, roofSlots: 2, decorSlots: 1, beds: 0, storage: 250, coal: 0, price: 160, scrap: 50,
    insulation: 0.35, color: 0x5e4a33, trim: 0x8c7355, features: [],
  },
  blinde: {
    id: 'blinde', name: 'Wagon blindé', desc: 'Plaques d\'acier rivetées, trois emplacements d\'armes.',
    length: 11, hp: 500, armor: 0.35, roofSlots: 3, decorSlots: 1, beds: 2, storage: 30, coal: 0, price: 380, scrap: 140,
    insulation: 0.5, color: 0x4a5048, trim: 0x8d9488, features: [],
  },
  atelier: {
    id: 'atelier', name: 'Wagon-atelier', desc: 'Établi : fabrication de munitions, améliorations et réparations accélérées.',
    length: 12, hp: 260, armor: 0.1, roofSlots: 2, decorSlots: 1, beds: 1, storage: 40, coal: 0, price: 300, scrap: 90,
    insulation: 0.45, color: 0x3f4f5f, trim: 0xd38c2f, features: ['workbench'],
  },
  infirmerie: {
    id: 'infirmerie', name: 'Wagon-infirmerie', desc: 'Lits médicalisés : soins doublés et quarantaine contre la contagion.',
    length: 12, hp: 220, armor: 0.05, roofSlots: 1, decorSlots: 2, beds: 3, storage: 10, coal: 0, price: 320, scrap: 80,
    insulation: 0.6, color: 0xd8d3c4, trim: 0xb03a2e, features: ['medbay'],
  },
  generateur: {
    id: 'generateur', name: 'Wagon-générateur', desc: 'Turbine à vapeur auxiliaire (+10 énergie) et grosse batterie.',
    length: 10, hp: 250, armor: 0.12, roofSlots: 2, decorSlots: 0, beds: 0, storage: 0, coal: 20, price: 360, scrap: 110,
    power: 10, battery: 150, insulation: 0.4, color: 0x3d3a2f, trim: 0xe0b33a, features: ['generator'],
  },
  restaurant: {
    id: 'restaurant', name: 'Voiture-restaurant', desc: 'Cuisine : -20 % de vivres consommés, gros bonus de moral.',
    length: 13, hp: 210, armor: 0.05, roofSlots: 1, decorSlots: 3, beds: 0, storage: 30, coal: 0, price: 240, scrap: 70,
    insulation: 0.55, color: 0x1f3d2f, trim: 0xd4af37, features: ['kitchen'],
  },
  salon: {
    id: 'salon', name: 'Voiture-salon', desc: 'Six emplacements de décoration : bornes d\'arcade, juke-box, billard…',
    length: 13, hp: 200, armor: 0.05, roofSlots: 1, decorSlots: 6, beds: 2, storage: 10, coal: 0, price: 220, scrap: 60,
    insulation: 0.6, color: 0x2a3550, trim: 0xd9b36c, features: ['lounge'],
  },
  serre: {
    id: 'serre', name: 'Wagon-serre', desc: 'Produit des vivres si la lumière et la chaleur sont suffisantes.',
    length: 12, hp: 170, armor: 0.0, roofSlots: 1, decorSlots: 1, beds: 0, storage: 10, coal: 0, price: 280, scrap: 70,
    insulation: 0.4, color: 0x2f5a2a, trim: 0xa8d08d, features: ['greenhouse'],
  },
  plateforme: {
    id: 'plateforme', name: 'Wagon plat armé', desc: 'Plateforme ouverte : quatre emplacements d\'armes lourdes.',
    length: 10, hp: 270, armor: 0.15, roofSlots: 4, decorSlots: 0, beds: 0, storage: 0, coal: 0, price: 190, scrap: 60,
    insulation: 0, color: 0x47423b, trim: 0x7d725f, features: [], open: true,
  },
  cellule: {
    id: 'cellule', name: 'Wagon cellulaire', desc: 'Deux cellules verrouillées pour les suspects et prisonniers.',
    length: 9, hp: 320, armor: 0.25, roofSlots: 1, decorSlots: 0, beds: 2, storage: 0, coal: 0, price: 150, scrap: 50,
    insulation: 0.45, color: 0x383c44, trim: 0x707784, features: ['cells'],
  },
};

export const BUYABLE_WAGONS: WagonTypeId[] = ['tender', 'passagers', 'fourgon', 'blinde', 'atelier', 'infirmerie', 'generateur', 'restaurant', 'salon', 'serre', 'plateforme', 'cellule'];

export type EquipId = 'mitrailleuse' | 'canon' | 'lanceflammes' | 'tesla' | 'bouclier' | 'projecteur';

export interface EquipDef {
  id: EquipId;
  name: string;
  desc: string;
  icon: string;
  weapon?: string;
  /** none : automatique ; optional : mode auto disponible ; required : nécessite un tireur. */
  operator: 'none' | 'optional' | 'required';
  power: number;
  channel: PowerChannel;
  hp: number;
  price: number;
  scrap: number;
  turnRate: number;
  shieldHp?: number;
  shieldRegen?: number;
  lightRange?: number;
}

export const EQUIPMENT: Record<EquipId, EquipDef> = {
  mitrailleuse: {
    id: 'mitrailleuse', name: 'Mitrailleuse', desc: 'Tourelle polyvalente à balles. Mode automatique (moins précis) ou servie par un tireur.',
    icon: 'smg', weapon: 't_mitrailleuse', operator: 'optional', power: 1, channel: 'armement', hp: 130, price: 180, scrap: 50, turnRate: 4,
  },
  canon: {
    id: 'canon', name: 'Canon', desc: 'Obus explosifs à longue portée. Doit être servi par un tireur (PNJ ou vous).',
    icon: 'cannon', weapon: 't_canon', operator: 'required', power: 1, channel: 'armement', hp: 170, price: 320, scrap: 90, turnRate: 1.6,
  },
  lanceflammes: {
    id: 'lanceflammes', name: 'Lance-flammes', desc: 'Brûle tout à courte portée. Consomme du charbon. Redoutable contre les monstres.',
    icon: 'flame', weapon: 't_lanceflammes', operator: 'optional', power: 0.5, channel: 'armement', hp: 130, price: 240, scrap: 60, turnRate: 3,
  },
  tesla: {
    id: 'tesla', name: 'Bobine Tesla', desc: 'Arc électrique en chaîne, entièrement automatique. Gourmande en énergie, sans munitions.',
    icon: 'tesla', weapon: 't_tesla', operator: 'none', power: 6, channel: 'armement', hp: 110, price: 420, scrap: 110, turnRate: 6,
  },
  bouclier: {
    id: 'bouclier', name: 'Générateur de bouclier', desc: 'Dôme d\'énergie protégeant ce wagon et ses deux voisins.',
    icon: 'shield', operator: 'none', power: 5, channel: 'bouclier', hp: 110, price: 380, scrap: 100, turnRate: 0, shieldHp: 170, shieldRegen: 10,
  },
  projecteur: {
    id: 'projecteur', name: 'Projecteur', desc: 'Éclaire la nuit, aveugle et ralentit les monstres (+20 % de dégâts subis).',
    icon: 'light', operator: 'none', power: 2, channel: 'lumiere', hp: 90, price: 120, scrap: 30, turnRate: 3, lightRange: 30,
  },
};

export const EQUIP_IDS: EquipId[] = ['mitrailleuse', 'canon', 'lanceflammes', 'tesla', 'bouclier', 'projecteur'];

/** Coût d'amélioration d'un équipement vers le niveau suivant (1..3). */
export function equipUpgradeCost(def: EquipDef, nextLevel: number): { jetons: number; ferraille: number } {
  return { jetons: Math.round(def.price * 0.45 * nextLevel), ferraille: Math.round(def.scrap * 0.6 * nextLevel) };
}

export type DecorId =
  | 'plante' | 'tapis' | 'affiches' | 'lampe' | 'bibliotheque' | 'arcade' | 'jukebox' | 'poele'
  | 'piano' | 'canape' | 'billard' | 'aquarium' | 'fanion' | 'purificateur';

export interface DecorDef {
  id: DecorId;
  name: string;
  desc: string;
  price: number;
  morale: number;
  power?: number;
  heat?: number;
  antiDisease?: number;
  insulation?: number;
  interactive?: 'arcade' | 'jukebox' | 'piano' | 'bibliotheque';
  color: number;
}

export const DECOR: Record<DecorId, DecorDef> = {
  plante: { id: 'plante', name: 'Plante verte', desc: 'Un peu de vie. Assainit légèrement l\'air.', price: 25, morale: 2, antiDisease: 0.05, color: 0x3c8d3c },
  tapis: { id: 'tapis', name: 'Tapis persan', desc: 'Confort et isolation.', price: 30, morale: 2, insulation: 0.05, color: 0x8b2e2e },
  affiches: { id: 'affiches', name: 'Affiches d\'avant', desc: 'Des souvenirs colorés du vieux monde.', price: 10, morale: 1, color: 0xd9a441 },
  lampe: { id: 'lampe', name: 'Lampe d\'ambiance', desc: 'Lumière chaleureuse, rassure les peureux la nuit.', price: 35, morale: 2, power: 0.2, color: 0xf5d07a },
  bibliotheque: { id: 'bibliotheque', name: 'Bibliothèque', desc: 'Des livres à lire pendant les longs trajets.', price: 60, morale: 3, interactive: 'bibliotheque', color: 0x6b4226 },
  arcade: { id: 'arcade', name: 'Borne d\'arcade « Rail Runner »', desc: 'Une vraie borne jouable ! Gros bonus de moral.', price: 150, morale: 5, power: 0.5, interactive: 'arcade', color: 0x7a2cbf },
  jukebox: { id: 'jukebox', name: 'Juke-box', desc: 'De la musique pour tout le convoi.', price: 120, morale: 4, power: 0.4, interactive: 'jukebox', color: 0xc0392b },
  poele: { id: 'poele', name: 'Poêle à charbon', desc: 'Chauffe le wagon sans énergie (consomme un peu de charbon).', price: 70, morale: 1, heat: 10, color: 0x2c2c2c },
  piano: { id: 'piano', name: 'Piano droit', desc: 'Les musiciens adorent. Moral pour tous.', price: 140, morale: 4, interactive: 'piano', color: 0x2b1a12 },
  canape: { id: 'canape', name: 'Canapé', desc: 'Moelleux et usé.', price: 40, morale: 2, color: 0x7a5a3a },
  billard: { id: 'billard', name: 'Table de billard', desc: 'Pour les longues soirées.', price: 160, morale: 4, color: 0x1e6b3a },
  aquarium: { id: 'aquarium', name: 'Aquarium', desc: 'Des poissons mutants, mais apaisants.', price: 90, morale: 3, power: 0.2, color: 0x3aa0c8 },
  fanion: { id: 'fanion', name: 'Fanion du convoi', desc: 'Les couleurs de L\'Espérance.', price: 5, morale: 1, color: 0xc0392b },
  purificateur: { id: 'purificateur', name: 'Purificateur d\'air', desc: 'Réduit fortement la contagion dans le wagon.', price: 110, morale: 1, power: 0.5, antiDisease: 0.3, color: 0xa0b8c0 },
};

export const DECOR_IDS = Object.keys(DECOR) as DecorId[];

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  cost: (level: number) => { jetons: number; ferraille: number };
}

export const LOCO_UPGRADES: Record<string, UpgradeDef> = {
  chaudiere: {
    id: 'chaudiere', name: 'Chaudière renforcée', desc: '-10 % de charbon consommé par niveau, +6 % de vitesse max.', max: 3,
    cost: (l) => ({ jetons: 120 * l, ferraille: 60 * l }),
  },
  dynamo: {
    id: 'dynamo', name: 'Dynamo améliorée', desc: '+20 % d\'énergie produite par niveau.', max: 3,
    cost: (l) => ({ jetons: 110 * l, ferraille: 50 * l }),
  },
  blindage: {
    id: 'blindage', name: 'Blindage de la locomotive', desc: '+15 % de PV et +6 % d\'armure par niveau.', max: 3,
    cost: (l) => ({ jetons: 90 * l, ferraille: 80 * l }),
  },
  isolation: {
    id: 'isolation', name: 'Calorifugeage des voitures', desc: '+15 % d\'efficacité du chauffage (et de la ventilation) dans tous les wagons, par niveau.', max: 3,
    cost: (l) => ({ jetons: 80 * l, ferraille: 40 * l }),
  },
};

/** Coût du blindage supplémentaire d'un wagon (niveau 1..3). */
export function wagonArmorCost(level: number): { jetons: number; ferraille: number } {
  return { jetons: 50 * level, ferraille: 60 * level };
}

/** Consommation électrique de base de chaque wagon. */
export const WAGON_LIGHT_POWER = 0.5;
export const WAGON_HEATER_POWER = 1.6;

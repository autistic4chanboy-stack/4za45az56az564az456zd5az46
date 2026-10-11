export type BiomeId = 'plaines' | 'foret' | 'desert' | 'toundra' | 'irradie' | 'marais' | 'montagnes' | 'ruines';
export type Season = 'ete' | 'hiver';
export type Weather = 'clair' | 'pluie' | 'neige' | 'tempete' | 'poussiere' | 'brume' | 'cendres';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  desc: string;
  ground: number[];
  groundWinter: number[];
  fog: number;
  fogWinter: number;
  temp: Record<Season, [number, number]>;
  /** Radiation ambiante de base (rads/s) en extérieur. */
  radiation: number;
  /** Probabilité de nappes de gaz. */
  gas: number;
  trees: ('chene' | 'pin' | 'mort' | 'cactus' | 'bouleau' | 'mangrove' | 'champignon' | 'cristal')[];
  treeDensity: number;
  rockDensity: number;
  ruinDensity: number;
  water: number;
  /** Relief des collines lointaines. */
  hills: number;
  monsterBias: number;
  weather: Record<Season, Weather[]>;
  /** Couleur des éléments lumineux (flaques radioactives…). */
  glow?: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  plaines: {
    id: 'plaines', name: 'Plaines cendrées', desc: 'Champs abandonnés et herbes folles sous un ciel gris.',
    ground: [0x4f7a34, 0x5f8a3a, 0x6f9640, 0x84a04a, 0x9aa856], groundWinter: [0xc9d4de, 0xd8e1e9, 0xe6edf2, 0xf1f5f8],
    fog: 0xb9c2b8, fogWinter: 0xc8d2da, temp: { ete: [16, 27], hiver: [-9, 1] }, radiation: 0, gas: 0.05,
    trees: ['chene', 'bouleau', 'mort'], treeDensity: 0.5, rockDensity: 0.4, ruinDensity: 0.25, water: 0.15, hills: 0.5, monsterBias: 0.45,
    weather: { ete: ['clair', 'clair', 'pluie', 'cendres'], hiver: ['neige', 'clair', 'neige'] },
  },
  foret: {
    id: 'foret', name: 'Forêt noire', desc: 'Pins serrés et sous-bois où rôdent les meutes.',
    ground: [0x2c4a2a, 0x355630, 0x3e6234, 0x4a6a36, 0x5a6a3a], groundWinter: [0xc2cfd8, 0xd2dce4, 0xe0e8ee, 0xecf2f6],
    fog: 0x8ea294, fogWinter: 0xb4c3cc, temp: { ete: [12, 22], hiver: [-15, -4] }, radiation: 0, gas: 0.1,
    trees: ['pin', 'pin', 'bouleau', 'mort'], treeDensity: 1.4, rockDensity: 0.5, ruinDensity: 0.1, water: 0.1, hills: 0.7, monsterBias: 0.75,
    weather: { ete: ['clair', 'pluie', 'brume'], hiver: ['neige', 'neige', 'tempete'] },
  },
  desert: {
    id: 'desert', name: 'Désert de Rouille', desc: 'Dunes ocres, carcasses de métal et chaleur écrasante.',
    ground: [0xb4864e, 0xc4985c, 0xd2aa6c, 0xdcba80], groundWinter: [0xb09468, 0xbea278, 0xccb28a],
    fog: 0xd9c49c, fogWinter: 0xc8bba0, temp: { ete: [27, 43], hiver: [1, 14] }, radiation: 0, gas: 0,
    trees: ['cactus', 'mort'], treeDensity: 0.25, rockDensity: 1.1, ruinDensity: 0.35, water: 0, hills: 0.8, monsterBias: 0.4,
    weather: { ete: ['clair', 'poussiere', 'clair'], hiver: ['clair', 'poussiere'] },
  },
  toundra: {
    id: 'toundra', name: 'Toundra gelée', desc: 'Le grand blanc. Le froid y tue plus vite que les monstres.',
    ground: [0xc4d0dc, 0xd4dee8, 0xe2eaf1, 0xeef3f7], groundWinter: [0xccd8e3, 0xdce5ee, 0xe9eff5, 0xf4f7fa],
    fog: 0xd2dde5, fogWinter: 0xdde6ec, temp: { ete: [-5, 7], hiver: [-34, -18] }, radiation: 0, gas: 0,
    trees: ['pin', 'mort'], treeDensity: 0.35, rockDensity: 0.6, ruinDensity: 0.1, water: 0.05, hills: 0.6, monsterBias: 0.6,
    weather: { ete: ['neige', 'clair'], hiver: ['neige', 'tempete', 'neige'] },
  },
  irradie: {
    id: 'irradie', name: 'Terres irradiées', desc: 'Cratères, arbres calcinés et flaques qui luisent la nuit.',
    ground: [0x56532f, 0x666236, 0x76713c, 0x857e44], groundWinter: [0xb8bca8, 0xc6cab6, 0xd4d7c6],
    fog: 0xa3ad78, fogWinter: 0xbcc2a8, temp: { ete: [14, 27], hiver: [-11, 0] }, radiation: 0.25, gas: 0.15,
    trees: ['mort', 'mort', 'cristal'], treeDensity: 0.45, rockDensity: 0.6, ruinDensity: 0.4, water: 0.2, hills: 0.4, monsterBias: 0.6,
    weather: { ete: ['cendres', 'clair', 'poussiere'], hiver: ['neige', 'cendres'] }, glow: 0x7dff3a,
  },
  marais: {
    id: 'marais', name: 'Marais de la Brume', desc: 'Eaux stagnantes, champignons géants et poches de gaz.',
    ground: [0x2f4229, 0x384c2e, 0x415636, 0x4c5c3a], groundWinter: [0xa9b4a6, 0xb8c2b4, 0xc6cfc2],
    fog: 0x9aa486, fogWinter: 0xb0b8a8, temp: { ete: [18, 31], hiver: [-6, 4] }, radiation: 0.02, gas: 0.7,
    trees: ['mangrove', 'champignon', 'mort'], treeDensity: 0.9, rockDensity: 0.2, ruinDensity: 0.15, water: 0.6, hills: 0.2, monsterBias: 0.7,
    weather: { ete: ['brume', 'pluie', 'brume'], hiver: ['brume', 'neige'] }, glow: 0xc8ff60,
  },
  montagnes: {
    id: 'montagnes', name: 'Montagnes du Col', desc: 'Falaises, tunnels et vents glacés.',
    ground: [0x585c56, 0x5f6a4e, 0x686c62, 0x75786c], groundWinter: [0xc8d2db, 0xd6dee6, 0xe4eaf0, 0xeff3f7],
    fog: 0xa9b1b8, fogWinter: 0xc9d2d9, temp: { ete: [3, 14], hiver: [-24, -10] }, radiation: 0, gas: 0.05,
    trees: ['pin', 'mort'], treeDensity: 0.55, rockDensity: 1.6, ruinDensity: 0.1, water: 0.05, hills: 1.4, monsterBias: 0.55,
    weather: { ete: ['clair', 'brume', 'pluie'], hiver: ['neige', 'tempete'] },
  },
  ruines: {
    id: 'ruines', name: 'Mégapole morte', desc: 'Squelettes d\'immeubles et autoroutes effondrées.',
    ground: [0x53504b, 0x5e5a53, 0x68645a, 0x5c5a48], groundWinter: [0xbcc2c8, 0xc8ced3, 0xd4d9dd],
    fog: 0xa29c92, fogWinter: 0xbdbfc0, temp: { ete: [14, 29], hiver: [-9, 0] }, radiation: 0.03, gas: 0.15,
    trees: ['mort', 'bouleau'], treeDensity: 0.2, rockDensity: 0.4, ruinDensity: 1.5, water: 0.1, hills: 0.3, monsterBias: 0.45,
    weather: { ete: ['clair', 'cendres', 'pluie'], hiver: ['neige', 'clair'] },
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

/** Biomes voisins (transitions naturelles du mode infini). */
export const BIOME_NEIGHBORS: Record<BiomeId, BiomeId[]> = {
  plaines: ['foret', 'ruines', 'desert', 'marais'],
  foret: ['plaines', 'montagnes', 'marais', 'toundra'],
  desert: ['plaines', 'ruines', 'irradie'],
  toundra: ['montagnes', 'foret'],
  irradie: ['ruines', 'desert', 'marais'],
  marais: ['foret', 'plaines', 'irradie'],
  montagnes: ['foret', 'toundra', 'ruines'],
  ruines: ['plaines', 'irradie', 'desert', 'montagnes'],
};

export const WEATHER_NAMES: Record<Weather, string> = {
  clair: 'Temps clair',
  pluie: 'Pluie',
  neige: 'Neige',
  tempete: 'Blizzard',
  poussiere: 'Tempête de poussière',
  brume: 'Brume',
  cendres: 'Pluie de cendres',
};

export const SEASON_NAMES: Record<Season, string> = { ete: 'Été', hiver: 'Hiver' };

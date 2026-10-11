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
    ground: [0x6f7a3e, 0x7b8446, 0x667236, 0x83804a], groundWinter: [0xdde4e8, 0xd2dadf, 0xe6ecef],
    fog: 0xb9c2b8, fogWinter: 0xc8d2da, temp: { ete: [16, 27], hiver: [-9, 1] }, radiation: 0, gas: 0.05,
    trees: ['chene', 'bouleau', 'mort'], treeDensity: 0.5, rockDensity: 0.4, ruinDensity: 0.25, water: 0.15, hills: 0.5, monsterBias: 0.45,
    weather: { ete: ['clair', 'clair', 'pluie', 'cendres'], hiver: ['neige', 'clair', 'neige'] },
  },
  foret: {
    id: 'foret', name: 'Forêt noire', desc: 'Pins serrés et sous-bois où rôdent les meutes.',
    ground: [0x3e5730, 0x35502b, 0x4a5f35, 0x2f4626], groundWinter: [0xd6dfe3, 0xc8d3d8, 0xe0e7ea],
    fog: 0x8ea294, fogWinter: 0xb4c3cc, temp: { ete: [12, 22], hiver: [-15, -4] }, radiation: 0, gas: 0.1,
    trees: ['pin', 'pin', 'bouleau', 'mort'], treeDensity: 1.4, rockDensity: 0.5, ruinDensity: 0.1, water: 0.1, hills: 0.7, monsterBias: 0.75,
    weather: { ete: ['clair', 'pluie', 'brume'], hiver: ['neige', 'neige', 'tempete'] },
  },
  desert: {
    id: 'desert', name: 'Désert de Rouille', desc: 'Dunes ocres, carcasses de métal et chaleur écrasante.',
    ground: [0xc9a66b, 0xbf9a5c, 0xd3b07a, 0xb38a52], groundWinter: [0xc2a77a, 0xb89d70, 0xcdb287],
    fog: 0xd9c49c, fogWinter: 0xc8bba0, temp: { ete: [27, 43], hiver: [1, 14] }, radiation: 0, gas: 0,
    trees: ['cactus', 'mort'], treeDensity: 0.25, rockDensity: 1.1, ruinDensity: 0.35, water: 0, hills: 0.8, monsterBias: 0.4,
    weather: { ete: ['clair', 'poussiere', 'clair'], hiver: ['clair', 'poussiere'] },
  },
  toundra: {
    id: 'toundra', name: 'Toundra gelée', desc: 'Le grand blanc. Le froid y tue plus vite que les monstres.',
    ground: [0xdfe7ec, 0xd3dde3, 0xe9eff2], groundWinter: [0xe8eef2, 0xdfe7ec, 0xf2f6f8],
    fog: 0xd2dde5, fogWinter: 0xdde6ec, temp: { ete: [-5, 7], hiver: [-34, -18] }, radiation: 0, gas: 0,
    trees: ['pin', 'mort'], treeDensity: 0.35, rockDensity: 0.6, ruinDensity: 0.1, water: 0.05, hills: 0.6, monsterBias: 0.6,
    weather: { ete: ['neige', 'clair'], hiver: ['neige', 'tempete', 'neige'] },
  },
  irradie: {
    id: 'irradie', name: 'Terres irradiées', desc: 'Cratères, arbres calcinés et flaques qui luisent la nuit.',
    ground: [0x6e6b3c, 0x5c5b33, 0x77723f, 0x63603a], groundWinter: [0xc9cdb8, 0xbfc4ad, 0xd3d6c3],
    fog: 0xa3ad78, fogWinter: 0xbcc2a8, temp: { ete: [14, 27], hiver: [-11, 0] }, radiation: 0.25, gas: 0.15,
    trees: ['mort', 'mort', 'cristal'], treeDensity: 0.45, rockDensity: 0.6, ruinDensity: 0.4, water: 0.2, hills: 0.4, monsterBias: 0.6,
    weather: { ete: ['cendres', 'clair', 'poussiere'], hiver: ['neige', 'cendres'] }, glow: 0x7dff3a,
  },
  marais: {
    id: 'marais', name: 'Marais de la Brume', desc: 'Eaux stagnantes, champignons géants et poches de gaz.',
    ground: [0x4b5435, 0x434c30, 0x55603b, 0x3f472c], groundWinter: [0xb8c0b0, 0xaab3a2, 0xc4cbbc],
    fog: 0x9aa486, fogWinter: 0xb0b8a8, temp: { ete: [18, 31], hiver: [-6, 4] }, radiation: 0.02, gas: 0.7,
    trees: ['mangrove', 'champignon', 'mort'], treeDensity: 0.9, rockDensity: 0.2, ruinDensity: 0.15, water: 0.6, hills: 0.2, monsterBias: 0.7,
    weather: { ete: ['brume', 'pluie', 'brume'], hiver: ['brume', 'neige'] }, glow: 0xc8ff60,
  },
  montagnes: {
    id: 'montagnes', name: 'Montagnes du Col', desc: 'Falaises, tunnels et vents glacés.',
    ground: [0x6d6a63, 0x76736b, 0x625f58, 0x7e7a70], groundWinter: [0xdde3e7, 0xd0d7dc, 0xe7ecef],
    fog: 0xa9b1b8, fogWinter: 0xc9d2d9, temp: { ete: [3, 14], hiver: [-24, -10] }, radiation: 0, gas: 0.05,
    trees: ['pin', 'mort'], treeDensity: 0.55, rockDensity: 1.6, ruinDensity: 0.1, water: 0.05, hills: 1.4, monsterBias: 0.55,
    weather: { ete: ['clair', 'brume', 'pluie'], hiver: ['neige', 'tempete'] },
  },
  ruines: {
    id: 'ruines', name: 'Mégapole morte', desc: 'Squelettes d\'immeubles et autoroutes effondrées.',
    ground: [0x5c5953, 0x67635b, 0x55524d, 0x6e695f], groundWinter: [0xc8ccd0, 0xbcc1c5, 0xd3d7da],
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

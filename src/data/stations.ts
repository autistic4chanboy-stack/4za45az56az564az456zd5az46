import type { BiomeId } from './biomes';
import type { Rng } from '../core/rng';

export type ArchetypeId =
  | 'depot' | 'village' | 'marche' | 'avantposte' | 'mine' | 'ville' | 'centrale' | 'usine' | 'campbandit' | 'nid'
  | 'monastere' | 'hopital' | 'laboratoire' | 'port' | 'pompage' | 'triage' | 'bunker' | 'antenne' | 'cimetiere' | 'serre';

export type ServiceId = 'commerce' | 'atelier' | 'wagons' | 'charbon' | 'soins' | 'recrutement' | 'informations' | 'repos';
export type Hostility = 'sure' | 'neutre' | 'hostile';
export type EnemyFaction = 'bandit' | 'monster' | 'infected' | 'machine' | 'none';

export interface ArchetypeDef {
  id: ArchetypeId;
  name: string;
  desc: string;
  icon: string;
  hostility: Partial<Record<Hostility, number>>;
  services: ServiceId[];
  pattern: string[];
  biomes: BiomeId[];
  enemies: EnemyFaction[];
  /** Plage de radiation ambiante dans les zones chaudes (rads/s). */
  radiation?: [number, number];
  gas?: boolean;
  dark?: boolean;
  loot: number;
  residents: [number, number];
  /** Temps (s) pendant lequel le train peut stationner sans irradier les passagers. */
  radTimer?: number;
  /** Ce que le joueur vient typiquement chercher (affiché sur la carte). */
  tags: string[];
}

export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  depot: {
    id: 'depot', name: 'Dépôt ferroviaire', desc: 'Ateliers, château d\'eau et tour à charbon : le meilleur endroit pour entretenir le convoi.', icon: 'train',
    hostility: { sure: 1 }, services: ['commerce', 'atelier', 'wagons', 'charbon', 'recrutement'], pattern: ['Dépôt de {n}', '{n}-Dépôt', 'Gare de {n}'],
    biomes: ['plaines', 'ruines', 'foret', 'desert', 'montagnes', 'toundra'], enemies: ['none'], loot: 0.6, residents: [2, 4], tags: ['charbon', 'wagons', 'atelier'],
  },
  village: {
    id: 'village', name: 'Village', desc: 'Une communauté qui survit tant bien que mal. Vivres bon marché et volontaires.', icon: 'house',
    hostility: { sure: 0.85, neutre: 0.15 }, services: ['commerce', 'recrutement', 'repos'], pattern: ['{n}', '{n}', 'Hameau de {n}'],
    biomes: ['plaines', 'foret', 'toundra', 'montagnes', 'marais'], enemies: ['none'], loot: 0.5, residents: [3, 6], tags: ['vivres', 'recrues'],
  },
  marche: {
    id: 'marche', name: 'Marché nomade', desc: 'Caravanes et étals : on y trouve de tout, à condition d\'avoir des jetons.', icon: 'tent',
    hostility: { sure: 1 }, services: ['commerce', 'recrutement', 'informations', 'soins'], pattern: ['Marché de {n}', 'Carrefour de {n}', 'Bazar de {n}'],
    biomes: ['plaines', 'desert', 'ruines', 'marais'], enemies: ['none'], loot: 0.4, residents: [4, 7], tags: ['commerce', 'équipement'],
  },
  avantposte: {
    id: 'avantposte', name: 'Avant-poste militaire', desc: 'Miradors et barbelés. Munitions et contrats pour qui sait se rendre utile.', icon: 'flag',
    hostility: { neutre: 0.7, hostile: 0.3 }, services: ['commerce', 'atelier', 'recrutement'], pattern: ['Avant-poste {n}', 'Fort {n}', 'Poste de {n}'],
    biomes: ['plaines', 'desert', 'montagnes', 'toundra', 'ruines'], enemies: ['bandit'], loot: 0.9, residents: [2, 4], tags: ['munitions', 'armes'],
  },
  mine: {
    id: 'mine', name: 'Mine de charbon', desc: 'Galeries obscures et terrils. Du charbon à foison… et ce qui vit dans le noir.', icon: 'pick',
    hostility: { neutre: 0.4, hostile: 0.6 }, services: ['charbon'], pattern: ['Mine de {n}', 'Puits de {n}', 'Houillère de {n}'],
    biomes: ['montagnes', 'foret', 'plaines', 'desert'], enemies: ['monster'], dark: true, loot: 0.8, residents: [0, 2], tags: ['charbon', 'monstres'],
  },
  ville: {
    id: 'ville', name: 'Ville en ruines', desc: 'Immeubles éventrés à fouiller étage par étage. Pillards ou créatures y ont élu domicile.', icon: 'city',
    hostility: { hostile: 0.75, neutre: 0.25 }, services: [], pattern: ['Ruines de {n}', '{n}-la-Morte', 'Vieux-{n}'],
    biomes: ['ruines', 'plaines', 'desert', 'irradie'], enemies: ['bandit', 'monster'], loot: 1.3, residents: [0, 1], tags: ['butin', 'exploration'],
  },
  centrale: {
    id: 'centrale', name: 'Centrale nucléaire', desc: 'Réacteur fissuré. Combinaison et compteur Geiger indispensables, et le train ne peut pas s\'attarder.', icon: 'radiation',
    hostility: { hostile: 0.6, neutre: 0.4 }, services: [], pattern: ['Centrale de {n}', 'Réacteur {n}', 'Site nucléaire de {n}'],
    biomes: ['irradie', 'plaines', 'ruines'], enemies: ['monster'], radiation: [1.5, 6], loot: 1.5, residents: [0, 1], radTimer: 300, tags: ['radiations', 'technologie'],
  },
  usine: {
    id: 'usine', name: 'Usine chimique', desc: 'Cuves percées et halls noyés de gaz. Masque obligatoire. Médicaments et produits rares.', icon: 'factory',
    hostility: { hostile: 0.55, neutre: 0.45 }, services: [], pattern: ['Usine de {n}', 'Chimie-{n}', 'Raffinerie de {n}'],
    biomes: ['marais', 'ruines', 'irradie', 'plaines'], enemies: ['monster', 'infected'], gas: true, loot: 1.3, residents: [0, 1], tags: ['gaz', 'médicaments'],
  },
  campbandit: {
    id: 'campbandit', name: 'Camp de bandits', desc: 'Repaire du Syndicat de la Rouille. Dangereux, mais leur butin est le nôtre.', icon: 'skull',
    hostility: { hostile: 1 }, services: [], pattern: ['Camp de {n}', 'Fort-{n}', 'Repaire de {n}'],
    biomes: ['desert', 'ruines', 'plaines', 'foret'], enemies: ['bandit'], loot: 1.6, residents: [0, 1], tags: ['bandits', 'butin'],
  },
  nid: {
    id: 'nid', name: 'Nid de créatures', desc: 'Une colonie organique palpitante. Détruire les œufs avant l\'éclosion.', icon: 'nest',
    hostility: { hostile: 1 }, services: [], pattern: ['Nid de {n}', 'Fosse de {n}', 'Tanière de {n}'],
    biomes: ['foret', 'marais', 'irradie', 'montagnes', 'desert'], enemies: ['monster'], loot: 1.2, residents: [0, 0], tags: ['monstres', 'boss'],
  },
  monastere: {
    id: 'monastere', name: 'Monastère', desc: 'Des moines-guérisseurs soignent les voyageurs et soulagent les malades.', icon: 'cross',
    hostility: { sure: 1 }, services: ['soins', 'repos', 'recrutement', 'commerce'], pattern: ['Monastère de {n}', 'Saint-{n}', 'Abbaye de {n}'],
    biomes: ['foret', 'montagnes', 'toundra', 'plaines'], enemies: ['none'], loot: 0.4, residents: [2, 5], tags: ['soins', 'repos'],
  },
  hopital: {
    id: 'hopital', name: 'Hôpital abandonné', desc: 'Pharmacie verrouillée et couloirs hantés par des infectés. Risque de contagion.', icon: 'hospital',
    hostility: { hostile: 0.7, neutre: 0.3 }, services: [], pattern: ['Hôpital {n}', 'Clinique de {n}', 'Sanatorium de {n}'],
    biomes: ['ruines', 'plaines', 'marais'], enemies: ['infected'], loot: 1.4, residents: [0, 1], tags: ['médicaments', 'maladie'],
  },
  laboratoire: {
    id: 'laboratoire', name: 'Laboratoire', desc: 'Portes à badges, digicodes et technologies d\'avant : cellules, armes Tesla.', icon: 'flask',
    hostility: { neutre: 0.5, hostile: 0.5 }, services: [], pattern: ['Laboratoire {n}', 'Institut de {n}', 'Station {n}'],
    biomes: ['irradie', 'toundra', 'montagnes', 'ruines'], enemies: ['machine', 'monster'], radiation: [0.2, 1], loot: 1.4, residents: [0, 1], tags: ['technologie', 'codes'],
  },
  port: {
    id: 'port', name: 'Port fluvial', desc: 'Quais, entrepôts et pêcheurs. Commerce et vivres.', icon: 'anchor',
    hostility: { sure: 0.8, neutre: 0.2 }, services: ['commerce', 'recrutement', 'informations'], pattern: ['Port-{n}', 'Quais de {n}', '{n}-sur-Eau'],
    biomes: ['marais', 'plaines', 'ruines', 'foret'], enemies: ['none'], loot: 0.7, residents: [3, 6], tags: ['commerce', 'vivres'],
  },
  pompage: {
    id: 'pompage', name: 'Station de pompage', desc: 'Château d\'eau et pompes. Une eau parfois contaminée.', icon: 'drop',
    hostility: { neutre: 0.7, hostile: 0.3 }, services: ['repos'], pattern: ['Pompage de {n}', 'Château d\'eau de {n}', 'Les Eaux de {n}'],
    biomes: ['plaines', 'desert', 'marais', 'foret'], enemies: ['monster'], loot: 0.8, residents: [0, 2], tags: ['réparation', 'quêtes'],
  },
  triage: {
    id: 'triage', name: 'Gare de triage', desc: 'Un enchevêtrement de voies et d\'aiguillages. Des wagons abandonnés à récupérer.', icon: 'switch',
    hostility: { neutre: 0.6, hostile: 0.4 }, services: ['wagons'], pattern: ['Triage de {n}', 'Gare de triage de {n}', 'Bifurcation de {n}'],
    biomes: ['plaines', 'ruines', 'montagnes', 'desert', 'toundra'], enemies: ['monster', 'bandit'], loot: 1, residents: [0, 1], tags: ['aiguillages', 'wagons'],
  },
  bunker: {
    id: 'bunker', name: 'Bunker', desc: 'Porte blindée à code, sentinelles automatiques et réserves d\'armes intactes.', icon: 'bunker',
    hostility: { hostile: 0.7, neutre: 0.3 }, services: [], pattern: ['Bunker {n}', 'Abri {n}', 'Casemate de {n}'],
    biomes: ['montagnes', 'irradie', 'desert', 'toundra', 'ruines'], enemies: ['machine'], radiation: [0.1, 0.6], loot: 1.8, residents: [0, 0], tags: ['armes', 'codes'],
  },
  antenne: {
    id: 'antenne', name: 'Station radio', desc: 'Relancez le générateur pour capter le Réseau : révèle les gares environnantes.', icon: 'antenna',
    hostility: { neutre: 0.7, hostile: 0.3 }, services: ['informations'], pattern: ['Radio-{n}', 'Antenne de {n}', 'Relais de {n}'],
    biomes: ['montagnes', 'plaines', 'toundra', 'ruines', 'desert'], enemies: ['monster', 'bandit'], loot: 0.9, residents: [0, 1], tags: ['informations', 'carte'],
  },
  cimetiere: {
    id: 'cimetiere', name: 'Cimetière de trains', desc: 'Des locomotives éventrées à perte de vue : ferraille, pièces et wagons à remettre en état.', icon: 'gear',
    hostility: { neutre: 0.5, hostile: 0.5 }, services: ['wagons'], pattern: ['Cimetière de {n}', 'Casse de {n}', 'Les Ferrailles de {n}'],
    biomes: ['desert', 'plaines', 'ruines', 'toundra'], enemies: ['monster', 'bandit'], loot: 1.2, residents: [0, 1], tags: ['ferraille', 'wagons'],
  },
  serre: {
    id: 'serre', name: 'Serres hydroponiques', desc: 'Des dômes de verre où pousse encore la vie. Vivres et semences.', icon: 'leaf',
    hostility: { sure: 0.75, neutre: 0.25 }, services: ['commerce', 'recrutement', 'repos'], pattern: ['Serres de {n}', 'Jardins de {n}', 'Verger de {n}'],
    biomes: ['plaines', 'marais', 'foret', 'desert'], enemies: ['none'], loot: 0.6, residents: [2, 5], tags: ['vivres', 'semences'],
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

const NAME_A = ['Val', 'Mont', 'Roche', 'Bois', 'Pont', 'Fort', 'Croix', 'Font', 'Haut', 'Clair', 'Noir', 'Gris', 'Blanc', 'Cendre', 'Ferre', 'Brume', 'Givre', 'Rouille', 'Saule', 'Chêne', 'Loup', 'Corbeau', 'Sombre', 'Pierre', 'Marne', 'Orme', 'Vieille', 'Cuivre', 'Sel', 'Plomb'];
const NAME_B = ['bourg', 'ville', 'mont', 'court', 'fontaine', 'pierre', 'lac', 'fosse', 'roche', 'val', 'champ', 'brune', 'combe', 'rive', 'noue', 'creux', 'mare', 'pré'];
const NAME_SUFFIX = ['', '', '', '-sur-Cendre', '-les-Mines', '-aux-Loups', '-le-Vieux', '-du-Nord', '-la-Rouille', '-des-Brumes', '-en-Givre', '-Saint-Rail'];

export function generatePlaceName(rng: Rng): string {
  const a = rng.pick(NAME_A);
  let b = rng.pick(NAME_B);
  if (a.toLowerCase().endsWith(b.slice(0, 1))) b = rng.pick(NAME_B);
  const base = a + b;
  return base + rng.pick(NAME_SUFFIX);
}

export function generateStationName(rng: Rng, arch: ArchetypeDef): string {
  const n = generatePlaceName(rng);
  const pattern = rng.pick(arch.pattern);
  if (arch.id === 'laboratoire' || arch.id === 'bunker') {
    const code = `${String.fromCharCode(65 + rng.int(0, 25))}-${rng.int(2, 99)}`;
    return pattern.replace('{n}', rng.chance(0.5) ? code : n.split('-')[0]);
  }
  return pattern.replace('{n}', n);
}

export const SERVICE_NAMES: Record<ServiceId, string> = {
  commerce: 'Commerce',
  atelier: 'Atelier',
  wagons: 'Wagons',
  charbon: 'Charbon',
  soins: 'Soins',
  recrutement: 'Recrutement',
  informations: 'Informations',
  repos: 'Repos',
};

export const HOSTILITY_NAMES: Record<Hostility, string> = { sure: 'Sûre', neutre: 'Neutre', hostile: 'Hostile' };

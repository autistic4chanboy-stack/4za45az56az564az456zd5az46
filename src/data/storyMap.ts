import type { ArchetypeId, Hostility, EnemyFaction } from './stations';
import type { BiomeId, Season } from './biomes';

/** Réseau ferroviaire du mode Histoire. */
export interface StoryNodeDef {
  id: string;
  name: string;
  archetype: ArchetypeId;
  biome: BiomeId;
  layer: number;
  slot: number;
  hostility: Hostility;
  faction: EnemyFaction;
  threat: number;
  links: string[];
  season: Season;
  boss?: boolean;
  hidden?: boolean;
  radiation?: number;
  gas?: boolean;
  required?: boolean;
  blurb: string;
}

export const STORY_NODES: StoryNodeDef[] = [
  { id: 'cendrebourg', name: 'Cendrebourg', archetype: 'depot', biome: 'plaines', layer: 0, slot: 0, hostility: 'sure', faction: 'none', threat: 0, links: ['fourche', 'saint_aubin'], season: 'ete', required: true,
    blurb: 'Votre ville natale, rongée par la Fièvre Grise. Le dépôt abrite la vieille locomotive L\'Espérance.' },
  { id: 'fourche', name: 'Fourche-aux-Saules', archetype: 'village', biome: 'plaines', layer: 1, slot: -1, hostility: 'sure', faction: 'none', threat: 0.4, links: ['creux_noir'], season: 'ete',
    blurb: 'Un village fermier accueillant. Vivres bon marché et bras volontaires.' },
  { id: 'saint_aubin', name: 'Monastère de Saint-Aubin', archetype: 'monastere', biome: 'foret', layer: 1, slot: 1, hostility: 'sure', faction: 'none', threat: 0.5, links: ['creux_noir'], season: 'ete',
    blurb: 'Les frères y soignent les malades. On dit qu\'ils étudient la Fièvre.' },
  { id: 'creux_noir', name: 'Mine de Creux-Noir', archetype: 'mine', biome: 'foret', layer: 2, slot: 0, hostility: 'hostile', faction: 'monster', threat: 1, links: ['carrefour'], season: 'ete', required: true,
    blurb: 'Une mine abandonnée depuis que « quelque chose » s\'est installé dans les galeries profondes.' },
  { id: 'carrefour', name: 'Carrefour-des-Vents', archetype: 'marche', biome: 'plaines', layer: 3, slot: 0, hostility: 'sure', faction: 'none', threat: 1.4, links: ['garde_fer', 'cimetiere_locos'], season: 'ete', required: true,
    blurb: 'Le plus grand marché nomade du Réseau. Tout s\'y vend, même les secrets.' },
  { id: 'garde_fer', name: 'Avant-poste Garde-Fer', archetype: 'avantposte', biome: 'plaines', layer: 4, slot: -1, hostility: 'neutre', faction: 'bandit', threat: 1.9, links: ['valpierre'], season: 'ete',
    blurb: 'La milice de Garde-Fer contrôle la route de la Zone. Elle a besoin de bras.' },
  { id: 'cimetiere_locos', name: 'Cimetière des Locos', archetype: 'cimetiere', biome: 'desert', layer: 4, slot: 1, hostility: 'neutre', faction: 'monster', threat: 2, links: ['valpierre'], season: 'ete',
    blurb: 'Des centaines de locomotives mortes. De quoi récupérer un wagon… si on ose.' },
  { id: 'valpierre', name: 'Centrale de Valpierre', archetype: 'centrale', biome: 'irradie', layer: 5, slot: 0, hostility: 'hostile', faction: 'monster', threat: 2.5, links: ['port_gris', 'sainte_claire'], season: 'ete', required: true, radiation: 4,
    blurb: 'Le réacteur fissuré irradie toute la vallée. Le train ne pourra pas y rester longtemps.' },
  { id: 'port_gris', name: 'Port-Gris', archetype: 'port', biome: 'marais', layer: 6, slot: -1, hostility: 'sure', faction: 'none', threat: 2.6, links: ['morne_brume'], season: 'ete',
    blurb: 'Un port de pêcheurs sur pilotis, au bord des Marais de la Brume.' },
  { id: 'sainte_claire', name: 'Hôpital Sainte-Claire', archetype: 'hopital', biome: 'ruines', layer: 6, slot: 1, hostility: 'hostile', faction: 'infected', threat: 3, links: ['morne_brume'], season: 'ete',
    blurb: 'L\'hôpital où la Fièvre Grise a été décrite pour la première fois.' },
  { id: 'morne_brume', name: 'Usine de Morne-Brume', archetype: 'usine', biome: 'marais', layer: 7, slot: 0, hostility: 'hostile', faction: 'monster', threat: 3.1, links: ['fort_rouille', 'radio_echo'], season: 'ete', required: true, gas: true,
    blurb: 'L\'usine chimique noyée sous la Brume. Le laboratoire du Pr Hallström s\'y trouvait.' },
  { id: 'fort_rouille', name: 'Fort-Rouille', archetype: 'campbandit', biome: 'ruines', layer: 8, slot: -1, hostility: 'hostile', faction: 'bandit', threat: 3.8, links: ['givre'], season: 'hiver', boss: true,
    blurb: 'La forteresse du Syndicat de la Rouille et de son chef, le Baron.' },
  { id: 'radio_echo', name: 'Radio-Écho', archetype: 'antenne', biome: 'montagnes', layer: 8, slot: 1, hostility: 'neutre', faction: 'monster', threat: 3.5, links: ['givre'], season: 'hiver',
    blurb: 'Un relais radio d\'avant. Relancé, il pourrait capter tout le Nord.' },
  { id: 'givre', name: 'Hameau-de-Givre', archetype: 'village', biome: 'toundra', layer: 9, slot: 0, hostility: 'sure', faction: 'none', threat: 3.6, links: ['bunker_k7', 'col'], season: 'hiver', required: true,
    blurb: 'Le dernier village avant le Grand Nord. Ingrid Solberg y connaît la route de Polaris.' },
  { id: 'bunker_k7', name: 'Bunker K-7', archetype: 'bunker', biome: 'montagnes', layer: 10, slot: 1, hostility: 'hostile', faction: 'machine', threat: 4.3, links: ['col'], season: 'hiver',
    blurb: 'Un arsenal militaire scellé. Ses sentinelles fonctionnent encore.' },
  { id: 'col', name: 'Triage du Col', archetype: 'triage', biome: 'montagnes', layer: 11, slot: 0, hostility: 'hostile', faction: 'monster', threat: 4.5, links: ['polaris'], season: 'hiver', required: true,
    blurb: 'Le nœud ferroviaire du Col. Seule la bonne combinaison d\'aiguillages mène à Polaris.' },
  { id: 'polaris', name: 'Station Polaris', archetype: 'laboratoire', biome: 'toundra', layer: 12, slot: 0, hostility: 'hostile', faction: 'monster', threat: 5, links: [], season: 'hiver', required: true, boss: true,
    blurb: 'Le laboratoire polaire où le remède peut être synthétisé. Le terminus.' },
];

/**
 * Objets du jeu.
 * - Les « ressources » sont mises en commun dans la soute du train (charbon, munitions, vivres…).
 * - Les objets personnels (outils, équipements, clés, objets de quête, notes) sont dans le sac du joueur.
 */

export type ResourceId =
  | 'charbon'
  | 'ferraille'
  | 'nourriture'
  | 'medicaments'
  | 'balles'
  | 'cartouches'
  | 'obus'
  | 'cellules'
  | 'jetons'
  | 'filtres'
  | 'trousses'
  | 'antirad'
  | 'dynamite'
  | 'crochets';

export const RESOURCE_IDS: ResourceId[] = [
  'charbon', 'ferraille', 'nourriture', 'medicaments', 'balles', 'cartouches', 'obus', 'cellules',
  'jetons', 'filtres', 'trousses', 'antirad', 'dynamite', 'crochets',
];

export interface ResourceDef {
  id: ResourceId;
  name: string;
  short: string;
  desc: string;
  icon: string;
  /** Prix de base en jetons (achat). */
  price: number;
  /** Encombrement en soute (le charbon a son propre stockage : tender). */
  bulk: number;
  color: string;
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  charbon: { id: 'charbon', name: 'Charbon', short: 'Charbon', desc: 'Fait avancer la locomotive et alimente la dynamo. Stocké dans la loco et les tenders.', icon: 'coal', price: 2, bulk: 0, color: '#3a3a3a' },
  ferraille: { id: 'ferraille', name: 'Ferraille', short: 'Ferraille', desc: 'Pièces et métal de récupération : réparations, construction et améliorations.', icon: 'scrap', price: 3, bulk: 1, color: '#9a8f7e' },
  nourriture: { id: 'nourriture', name: 'Vivres', short: 'Vivres', desc: 'Rations pour l\'équipage et les passagers. La faim ruine le moral et la santé.', icon: 'food', price: 3, bulk: 1, color: '#c9a25a' },
  medicaments: { id: 'medicaments', name: 'Médicaments', short: 'Médocs', desc: 'Utilisés par les médecins pour soigner blessures et maladies.', icon: 'meds', price: 12, bulk: 1, color: '#d9534f' },
  balles: { id: 'balles', name: 'Balles', short: 'Balles', desc: 'Munitions pour revolver, mitraillette, fusil et mitrailleuses.', icon: 'bullet', price: 1, bulk: 0.05, color: '#d4b26a' },
  cartouches: { id: 'cartouches', name: 'Cartouches', short: 'Cartouches', desc: 'Munitions de fusil à pompe.', icon: 'shell', price: 2, bulk: 0.08, color: '#b94e3a' },
  obus: { id: 'obus', name: 'Obus', short: 'Obus', desc: 'Projectiles explosifs pour canons et lance-grenades.', icon: 'cannonball', price: 8, bulk: 0.5, color: '#6d6d5e' },
  cellules: { id: 'cellules', name: 'Cellules d\'énergie', short: 'Cellules', desc: 'Batteries pour le fusil Tesla.', icon: 'cell', price: 5, bulk: 0.2, color: '#5bc0de' },
  jetons: { id: 'jetons', name: 'Jetons', short: 'Jetons', desc: 'Monnaie du Réseau ferroviaire, acceptée dans toutes les gares.', icon: 'token', price: 1, bulk: 0, color: '#e8c547' },
  filtres: { id: 'filtres', name: 'Filtres', short: 'Filtres', desc: 'Cartouches filtrantes pour masque à gaz (90 s chacune).', icon: 'filter', price: 6, bulk: 0.1, color: '#8fbc8f' },
  trousses: { id: 'trousses', name: 'Trousses de soins', short: 'Trousses', desc: 'Soigne 45 PV en quelques secondes. Touche H.', icon: 'medkit', price: 15, bulk: 0.3, color: '#ff6b6b' },
  antirad: { id: 'antirad', name: 'Anti-rad', short: 'Anti-rad', desc: 'Pilules d\'iode et chélateurs : élimine 150 rads. Touche X.', icon: 'pill', price: 14, bulk: 0.1, color: '#9b59b6' },
  dynamite: { id: 'dynamite', name: 'Dynamite', short: 'Dynamite', desc: 'À lancer (touche G) : dégâts de zone et destruction des barricades.', icon: 'dynamite', price: 12, bulk: 0.3, color: '#e74c3c' },
  crochets: { id: 'crochets', name: 'Crochets', short: 'Crochets', desc: 'Outils de crochetage. Peuvent casser en cas d\'échec.', icon: 'lockpick', price: 5, bulk: 0.05, color: '#bdc3c7' },
};

export type GearSlot = 'corps' | 'tete' | 'outil';

export interface GearDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  slot: GearSlot;
  price: number;
  /** Réduction des radiations (0..1). */
  radProtect?: number;
  /** Protection contre le froid (0..1). */
  coldProtect?: number;
  /** Protection contre le gaz (nécessite des filtres). */
  gasProtect?: boolean;
  speedMult?: number;
  armor?: number;
}

export const GEAR: Record<string, GearDef> = {
  combinaison: { id: 'combinaison', name: 'Combinaison anti-radiations', desc: 'Réduit de 85 % l\'exposition aux radiations. Un peu encombrante.', icon: 'suit', slot: 'corps', price: 140, radProtect: 0.85, coldProtect: 0.3, speedMult: 0.92 },
  manteau: { id: 'manteau', name: 'Manteau fourré', desc: 'Protège efficacement du froid (65 %).', icon: 'coat', slot: 'corps', price: 70, coldProtect: 0.65 },
  armure: { id: 'armure', name: 'Gilet pare-balles', desc: 'Réduit les dégâts reçus de 25 %.', icon: 'vest', slot: 'corps', price: 160, armor: 0.25, coldProtect: 0.15 },
  combinaison_polaire: { id: 'combinaison_polaire', name: 'Combinaison polaire blindée', desc: 'Froid (80 %), radiations (50 %), dégâts (-10 %). L\'équipement ultime du Nord.', icon: 'suit', slot: 'corps', price: 320, coldProtect: 0.8, radProtect: 0.5, armor: 0.1, speedMult: 0.95 },
  masque: { id: 'masque', name: 'Masque à gaz', desc: 'Protège des gaz toxiques tant qu\'il reste des filtres.', icon: 'mask', slot: 'tete', price: 60, gasProtect: true },
  geiger: { id: 'geiger', name: 'Compteur Geiger', desc: 'Mesure les radiations ambiantes et votre dose accumulée.', icon: 'geiger', slot: 'outil', price: 80 },
};

export interface ToolDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  price: number;
}

/** Outils permanents (sac du joueur). */
export const TOOLS: Record<string, ToolDef> = {
  pied_de_biche: { id: 'pied_de_biche', name: 'Pied-de-biche', desc: 'Force les portes barricadées et les caisses clouées.', icon: 'crowbar', price: 35 },
  lampe: { id: 'lampe', name: 'Lampe torche', desc: 'Éclaire les zones sombres (touche F).', icon: 'flashlight', price: 20 },
  trousse_outils: { id: 'trousse_outils', name: 'Trousse à outils', desc: 'Réparations 50 % plus rapides.', icon: 'wrench', price: 90 },
  jumelles: { id: 'jumelles', name: 'Jumelles', desc: 'Augmente le zoom maximal de la caméra.', icon: 'binoculars', price: 45 },
};

export type ItemKind = 'resource' | 'gear' | 'tool' | 'weapon' | 'key' | 'quest' | 'decor' | 'equip';

/** Objet de quête ou clé (identifiants dynamiques possibles : « carte:<station>:<couleur> », « cle:<id> »). */
export interface QuestItemDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const QUEST_ITEMS: Record<string, QuestItemDef> = {
  spores_lumen: { id: 'spores_lumen', name: 'Spores de Lumen', desc: 'Champignons bioluminescents des profondeurs de Creux-Noir. Premier composant du remède.', icon: 'mushroom' },
  isotope: { id: 'isotope', name: 'Isotope stabilisé', desc: 'Capsule plombée contenant l\'isotope Co-60 stabilisé de Valpierre. Deuxième composant.', icon: 'isotope' },
  catalyseur: { id: 'catalyseur', name: 'Catalyseur K-9', desc: 'Flacon de catalyseur enzymatique de Morne-Brume. Troisième composant.', icon: 'flask' },
  formule: { id: 'formule', name: 'Carnet du Pr Hallström', desc: 'Les notes de synthèse du remède contre la Fièvre Grise.', icon: 'book' },
  remede: { id: 'remede', name: 'Remède', desc: 'Le sérum contre la Fièvre Grise. L\'espoir du Réseau.', icon: 'flask' },
  emetteur: { id: 'emetteur', name: 'Émetteur radio', desc: 'Un petit émetteur caché. Quelqu\'un communique avec le Syndicat…', icon: 'radio' },
  medaillon: { id: 'medaillon', name: 'Médaillon gravé', desc: 'Un médaillon ancien portant des initiales.', icon: 'medal' },
  piece_moteur: { id: 'piece_moteur', name: 'Pièce de moteur', desc: 'Une pièce mécanique de précision.', icon: 'gear' },
  fusible: { id: 'fusible', name: 'Fusible industriel', desc: 'Un gros fusible en céramique, encore en état.', icon: 'fuse' },
  colis: { id: 'colis', name: 'Colis scellé', desc: 'Un colis à livrer. Ne pas ouvrir.', icon: 'crate' },
  echantillon: { id: 'echantillon', name: 'Échantillon', desc: 'Un échantillon biologique à analyser.', icon: 'flask' },
  carte_polaris: { id: 'carte_polaris', name: 'Badge Polaris niveau 3', desc: 'Badge d\'accès au cœur de la Station Polaris.', icon: 'keycard' },
  plan_col: { id: 'plan_col', name: 'Plan des aiguillages du Col', desc: 'Schéma indiquant la combinaison d\'aiguillages menant à Polaris.', icon: 'map' },
  graines: { id: 'graines', name: 'Sachet de graines', desc: 'Des semences rares d\'avant la Brûlure.', icon: 'seed' },
  photo: { id: 'photo', name: 'Photo jaunie', desc: 'Une photo de famille, très abîmée.', icon: 'photo' },
  journal_bord: { id: 'journal_bord', name: 'Journal de bord', desc: 'Le journal d\'un ancien convoyeur.', icon: 'book' },
};

export const KEYCARD_COLORS = ['rouge', 'bleue', 'verte', 'jaune'] as const;
export type KeycardColor = (typeof KEYCARD_COLORS)[number];
export const KEYCARD_HEX: Record<KeycardColor, string> = { rouge: '#e74c3c', bleue: '#3498db', verte: '#2ecc71', jaune: '#f1c40f' };

/** Nom affichable pour n'importe quel identifiant d'objet personnel. */
export function personalItemName(id: string): string {
  if (id.startsWith('carte:')) {
    const [, station, color] = id.split(':');
    return `Carte d'accès ${color} (${stationNameLookup(station)})`;
  }
  if (id.startsWith('cle:')) {
    const parts = id.split(':');
    return parts[2] ? `Clé : ${parts[2]}` : 'Clé';
  }
  return GEAR[id]?.name ?? TOOLS[id]?.name ?? QUEST_ITEMS[id]?.name ?? id;
}

export function personalItemIcon(id: string): string {
  if (id.startsWith('carte:')) return 'keycard';
  if (id.startsWith('cle:')) return 'key';
  return GEAR[id]?.icon ?? TOOLS[id]?.icon ?? QUEST_ITEMS[id]?.icon ?? 'box';
}

export function personalItemDesc(id: string): string {
  if (id.startsWith('carte:')) return 'Ouvre les portes sécurisées de la couleur correspondante dans cette station.';
  if (id.startsWith('cle:')) return 'Ouvre une serrure bien précise.';
  return GEAR[id]?.desc ?? TOOLS[id]?.desc ?? QUEST_ITEMS[id]?.desc ?? '';
}

// Résolution paresseuse du nom de station (évite une dépendance circulaire avec l'état de jeu).
let stationNameLookup: (id: string) => string = (id) => id;
export function setStationNameLookup(fn: (id: string) => string): void {
  stationNameLookup = fn;
}

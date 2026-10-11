import type { Rng } from '../core/rng';
import { rollLoot, type LootEntry, type LootProfile } from './loot';
import type { Theme } from './furniture';

/**
 * Contenu des tiroirs, placards et poches : un peu de butin (rarement beaucoup),
 * souvent rien d'utile mais toujours quelque chose à raconter, et parfois un document.
 */

/** Probabilité qu'un compartiment contienne quelque chose d'utile, selon son thème. */
const FILL: Record<Theme, number> = {
  argent: 0.6, coffre: 0.92, marchandise: 0.62, militaire: 0.55, pharmacie: 0.58, outils: 0.5, frigo: 0.32, cuisine: 0.26,
  linge: 0.24, papiers: 0.26, lit: 0.22, toilette: 0.28, ordures: 0.3, labo: 0.42, livres: 0.08, divers: 0.4, cadavre: 0.8,
};

/** Table de butin associée au thème (sinon : profil du bâtiment). */
const THEME_PROFILE: Partial<Record<Theme, LootProfile>> = {
  frigo: 'nourriture', cuisine: 'nourriture', pharmacie: 'medical', toilette: 'medical', outils: 'industriel', argent: 'luxe',
  militaire: 'militaire', labo: 'tech', linge: 'maison', lit: 'maison', ordures: 'general', cadavre: 'general',
};

const FLAVOR: Record<Theme, string[]> = {
  linge: ['Des vêtements mités.', 'Des draps soigneusement pliés.', 'Une boîte à couture.', 'Des chaussettes dépareillées.', 'Une robe du dimanche, jamais remise.', 'Une odeur de naphtaline.', 'Des pulls rongés par les mites.'],
  papiers: ['Des factures jaunies.', 'Des formulaires vierges.', 'Un tampon encreur desséché.', 'Des trombones et des crayons usés.', 'Des relevés de compteur de 2041.', 'Un agenda dont les pages s\'arrêtent en mars.', 'Des cartes de vœux jamais envoyées.', 'Des dossiers vides, étiquetés avec soin.'],
  cuisine: ['Des couverts dépareillés.', 'Des torchons raides de poussière.', 'Des bocaux vides.', 'Une boîte à sucre… vide.', 'Des casseroles cabossées.', 'Une râpe et un ouvre-boîte rouillé.', 'Des assiettes ébréchées.'],
  frigo: ['Une odeur abominable.', 'Des bocaux moisis.', 'Rien de comestible.', 'Une bouteille de lait pétrifiée.', 'Des clayettes vides et tachées.'],
  outils: ['Des vis rouillées.', 'Des chiffons gras.', 'Un mètre ruban cassé.', 'Des clous tordus.', 'Une boîte de rondelles dépareillées.'],
  toilette: ['Un peigne édenté.', 'Des flacons vides.', 'Un savon desséché.', 'Une brosse à dents usée jusqu\'au manche.'],
  pharmacie: ['Des boîtes vides.', 'Un thermomètre brisé.', 'Des pansements jaunis et inutilisables.', 'Des ordonnances illisibles.'],
  ordures: ['Des ordures.', 'Des boîtes de conserve vides.', 'Des épluchures fossilisées.', 'Des journaux trempés.'],
  argent: ['Le tiroir est vide. Quelqu\'un est passé avant vous.', 'Quelques pièces d\'avant, sans valeur.', 'Des tickets de caisse.'],
  coffre: ['Vide. Le pillard a refermé derrière lui.', 'Des papiers d\'assurance, désormais inutiles.'],
  marchandise: ['Des cartons éventrés.', 'De la paille et des copeaux.', 'Des marchandises pourries.', 'Des pièces détachées inutilisables.'],
  militaire: ['Des étuis vides.', 'Une gourde percée.', 'Des rangers trop petites.', 'Un vieil uniforme plié.'],
  labo: ['De la verrerie brisée.', 'Des étiquettes effacées.', 'Des échantillons inidentifiables.', 'Des gants en caoutchouc craquelés.'],
  livres: ['Des romans gonflés d\'humidité.', 'Un atlas d\'avant la Brûlure.', 'Des livres de comptes.', 'Un missel aux pages collées.', 'Une encyclopédie incomplète.'],
  divers: ['Rien d\'utile.', 'De la poussière.', 'Des babioles sans valeur.', 'Des piles mortes.'],
  cadavre: ['Rien dans les poches.', 'Une photo écornée, rien d\'autre.'],
  lit: ['Rien sous le matelas.', 'Des moutons de poussière.', 'Une chaussette solitaire.'],
};

/** Documents qu'on peut trouver au fond d'un tiroir : la mémoire du monde d'avant. */
const LORE: { title: string; text: string }[] = [
  { title: 'Lettre à Marthe', text: 'Ma Marthe, le train de 7 h 12 ne passe plus. On dit que la ligne du Nord est coupée après la Brûlure. Garde les petits au chaud et ne bois que l\'eau de la citerne. Je reviens dès que les rails le permettront. Ton Paul.' },
  { title: 'Avis d\'évacuation', text: 'PRÉFECTURE — Par ordre du comité de crise, les habitants du secteur sont priés de rejoindre la gare la plus proche munis d\'une valise par personne. Les animaux ne sont pas admis dans les convois. Toute résistance sera consignée.' },
  { title: 'Liste de courses', text: 'Farine (si on en trouve). Sel. Bougies. Allumettes. Pastilles d\'iode, la pharmacie en aura peut-être encore. Demander à Mme Roux si elle a des graines.' },
  { title: 'Journal intime', text: 'Jour 40. Le ciel est resté gris toute la semaine. Papa dit que c\'est la cendre des villes. Maman tousse depuis trois jours, une toux sèche, grise. Je n\'ose pas lui dire que j\'ai peur.' },
  { title: 'Facture d\'électricité', text: 'Compagnie Électrique du Réseau — Montant dû : 128,40. Dernier relevé estimé. En cas de coupure prolongée, contactez votre agence. (Plus personne ne répond à ce numéro depuis longtemps.)' },
  { title: 'Carte postale', text: 'Bons baisers de la côte ! La mer est grise mais les huîtres sont bonnes. On rentre dimanche par le train de nuit. Arrose les tomates. — Lucie' },
  { title: 'Note du contremaître', text: 'Le groupe électrogène du local technique tient encore avec un peu de charbon. Ne pas le laisser tourner la nuit : le bruit attire les rôdeurs.' },
  { title: 'Recette de grand-mère', text: 'Soupe de cendre-racines : faire bouillir longtemps, changer l\'eau deux fois, ajouter ce qu\'on a. Bénir avant de servir. Ça ne guérit pas la fièvre, mais ça réchauffe.' },
  { title: 'Tract du Syndicat', text: 'LE SYNDICAT DE LA ROUILLE PROTÈGE CEUX QUI PAIENT. Un convoi qui roule sans notre marque est un convoi qui ne roule plus longtemps. Tarifs affichés au Fort.' },
  { title: 'Horaires des trains', text: 'Ligne Cendrebourg – Fourche – Saint-Aubin : départs à 6 h, 11 h, 17 h. Ligne Polaris : SUSPENDUE jusqu\'à nouvel ordre de la direction. Merci de votre compréhension.' },
  { title: 'Lettre d\'amour', text: 'Je t\'attendrai sur le quai, même si tous les trains sont rouillés. Même si la cendre recouvre tout. Reviens juste.' },
  { title: 'Bulletin scolaire', text: 'Élève appliquée, mais rêveuse. Passe trop de temps à dessiner des locomotives dans la marge. Peut mieux faire en arithmétique.' },
  { title: 'Consignes de sécurité', text: 'En cas d\'alerte radiologique : fermer les volets, couper la ventilation, se laver soigneusement. Ne pas consommer les légumes du jardin. Écouter la radio d\'État. (La radio d\'État s\'est tue le troisième jour.)' },
  { title: 'Carnet de rationnement', text: 'Pain : 200 g/jour. Charbon : 5 kg/semaine. Les tickets du mois prochain ne seront pas imprimés. Signé : le maire.' },
  { title: 'Mot d\'enfant', text: 'Cher Père Rail, je voudrais un train électrique et que maman arrête de tousser. Et une lampe pour la nuit, parce que le noir fait du bruit maintenant.' },
  { title: 'Rapport de patrouille', text: 'RAS côté est. Traces de griffes sur la palissade nord, trop hautes pour un chien. Doublé la garde. Demandé des munitions, toujours rien.' },
  { title: 'Prospectus', text: 'VOYAGEZ EN TOUTE SÉCURITÉ avec les Wagons-Lits du Réseau ! Couchettes chauffées, wagon-restaurant, panorama garanti. Réservez dès aujourd\'hui !' },
  { title: 'Testament', text: 'Je lègue mon fusil à mon frère, ma montre à ma fille, et mes dettes au Syndicat, qu\'ils s\'étouffent avec.' },
  { title: 'Notes d\'un ingénieur', text: 'La chaudière tient 12 bars avec la soupape bricolée. Au-delà, prier. Penser à vidanger le tender avant les grands froids, sinon tout gèle.' },
  { title: 'Carnet d\'adresses', text: 'Dr Varga — dispensaire de Cendrebourg. Frère Anselme — Saint-Aubin. Mama Jo — marché du Carrefour, « elle a de tout si on a des jetons ».' },
  { title: 'Feuille de paie', text: 'Mine de Creux-Noir — Salaire du mois : 46 jetons, retenues pour logement et lampe : 12. Reste : 34. Prime de risque : supprimée.' },
  { title: 'Mot laissé sur la table', text: 'Partis vers le sud avec le convoi de midi. La clé est sous le pot de géranium. Ne cherchez pas à nous rattraper.' },
];

/** Un document trouvé dans un compartiment. */
export interface FoundNote {
  id: string;
  title: string;
  text: string;
  reveals?: { door: string; code: string };
}

export interface CompartmentContent {
  loot: LootEntry[];
  flavor: string;
  note?: FoundNote;
}

/** Tire le contenu d'un compartiment. */
export function rollCompartment(rng: Rng, id: string, theme: Theme, size: number, profile: LootProfile, tier: number, richness: number, lootMult: number): CompartmentContent {
  const flavor = rng.pick(FLAVOR[theme]);
  const out: CompartmentContent = { loot: [], flavor };
  const fill = Math.min(0.95, FILL[theme] * (0.75 + richness * 0.25) * (0.7 + size * 0.3));
  if (rng.chance(fill)) {
    const prof = THEME_PROFILE[theme] ?? profile;
    // les petits rangements rapportent peu : une entrée, quantités réduites
    const amount = theme === 'coffre' ? 1 : Math.max(0.35, Math.min(1, size * 0.6));
    const entries = rollLoot(rng, prof, tier, theme === 'coffre' || theme === 'marchandise' ? richness * Math.min(1.4, size) : 0.4, lootMult);
    const keep = theme === 'coffre' || size >= 1.4 ? entries : entries.slice(0, 1);
    for (const e of keep) if (e.kind === 'resource') e.qty = Math.max(1, Math.round(e.qty * amount));
    out.loot = keep;
  }
  const noteChance = theme === 'papiers' ? 0.07 : theme === 'livres' || theme === 'lit' ? 0.06 : theme === 'linge' ? 0.03 : 0;
  if (noteChance > 0 && rng.chance(noteChance)) {
    const n = rng.pick(LORE);
    out.note = { id: `${id}:doc`, title: n.title, text: n.text };
  }
  return out;
}

// ---------------------------------------------------------------- appareils

/** Bribes d'émissions captées par les téléviseurs encore alimentés. */
export const TV_LINES: string[] = [
  '…ici Télé-Réseau, émission de secours…',
  '…restez chez vous, calfeutrez les fenêtres…',
  '(neige grise et grésillements)',
  '♪ une vieille réclame pour du savon ♪',
  '…le train de 7 h 12 est supprimé jusqu\'à nouvel ordre…',
  '…bulletin météo : pluie de cendres sur tout le territoire…',
  '…nous interrompons nos programmes…',
  '…Les aventures du Capitaine Rail, épisode 112…',
  '…la Fièvre Grise n\'est pas contagieuse, nous répétons…',
  '…le numéro d\'urgence est saturé, merci de patienter…',
  '(une mire en couleurs, figée depuis des années)',
  '…et maintenant, le jeu des mille jetons !…',
];

/** Ce que capte une radio. */
export const RADIO_LINES: string[] = [
  '♪ une valse grésillante ♪',
  '…fréquence libre du Réseau, qui nous entend ?…',
  '(friture)',
  '…le Syndicat recrute : rendez-vous au Fort, demandez le Baron…',
  '…ici la station radio, nous émettons tant qu\'il reste du courant…',
  '♪ un air d\'accordéon ♪',
  '…convoi signalé sur la ligne du nord, soyez prudents…',
  '…si vous entendez ce message, ne buvez pas l\'eau des puits…',
  '♪ une chanson d\'avant, que tout le monde fredonnait ♪',
];

export const JUKEBOX_LINES: string[] = ['♪ ♫ ♪', '♫ un vieux swing ♫', '♪ une ballade éraillée ♪', '♫ ça danse encore ici ♫'];

/** Courriels et journaux restés sur les ordinateurs. */
export const TERMINAL_MESSAGES: { title: string; text: string }[] = [
  { title: 'RE: groupe électrogène', text: 'Le groupe tient avec 3 pelletées de charbon, mais ne le faites pas tourner la nuit, le bruit les attire. — Maintenance' },
  { title: 'Note de service', text: 'Suite aux coupures, les ordinateurs ne doivent servir qu\'aux inventaires. Les jeux de cartes sont interdits pendant les heures de garde.' },
  { title: 'Inventaire', text: 'Stock de médicaments : critique. Filtres : 4. Munitions : voir l\'armurerie. Charbon : assez pour deux semaines si l\'hiver est doux.' },
  { title: 'Journal système', text: '> REDÉMARRAGE APRÈS COUPURE SECTEUR\n> 213 JOURS DEPUIS LA DERNIÈRE SYNCHRONISATION RÉSEAU\n> AUCUN SERVEUR JOIGNABLE' },
  { title: 'Message personnel', text: 'Si tu lis ça, Léa, je suis partie vers le sud avec le convoi. Garde la clé du casier, je reviendrai.' },
  { title: 'Rapport d\'incident', text: 'Deux rôdeurs abattus près de la palissade. Une sentinelle blessée. Demande de renforts : refusée.' },
  { title: 'Avis de la direction', text: 'Les badges d\'accès ne sont plus renouvelés. Conservez précieusement le vôtre.' },
  { title: 'Brouillon', text: 'Cher comité, je démissionne. Il n\'y a plus rien à administrer ici, à part la peur.' },
];

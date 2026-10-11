/** Compétences, caractères, secrets et textes des PNJ. */

export type SkillId =
  | 'mecanicien' | 'medecin' | 'tireur' | 'chauffeur' | 'cuisinier' | 'ingenieur' | 'eclaireur'
  | 'marchand' | 'serrurier' | 'garde' | 'scientifique' | 'artiste' | 'agronome';

export interface SkillDef {
  id: SkillId;
  name: string;
  desc: string;
  icon: string;
  /** Poste naturel associé. */
  job: JobId;
  pitch: string[];
}

export const SKILLS: Record<SkillId, SkillDef> = {
  mecanicien: { id: 'mecanicien', name: 'Mécanicien', icon: 'wrench', job: 'mecanicien', desc: 'Répare automatiquement wagons et équipements, consomme moins de ferraille.', pitch: ['Je répare tout ce qui a des boulons.', 'Une clé de 12 et je te remets n\'importe quel moteur sur pied.'] },
  medecin: { id: 'medecin', name: 'Médecin', icon: 'meds', job: 'medecin', desc: 'Soigne blessés et malades (utilise des médicaments), diagnostique les infections cachées.', pitch: ['J\'ai été infirmière avant la Brûlure.', 'Je peux recoudre, soigner, et reconnaître la Fièvre avant qu\'elle ne se voie.'] },
  tireur: { id: 'tireur', name: 'Tireur', icon: 'rifle', job: 'tireur', desc: 'Sert les tourelles : précision et cadence accrues.', pitch: ['Donne-moi une tourelle, je m\'occupe du reste.', 'Je touche un lapin à deux cents mètres.'] },
  chauffeur: { id: 'chauffeur', name: 'Chauffeur', icon: 'coal', job: 'chauffeur', desc: 'Alimente la chaudière : économise le charbon et permet de commander la vitesse à distance.', pitch: ['J\'ai le charbon dans le sang.', 'Une chaudière, ça se sent. Je sais quand elle a faim.'] },
  cuisinier: { id: 'cuisinier', name: 'Cuisinier', icon: 'food', job: 'cuisinier', desc: 'Réduit la consommation de vivres et remonte le moral.', pitch: ['Je fais un ragoût qui réveillerait un mort.', 'Avec trois patates et du sel, je nourris un wagon.'] },
  ingenieur: { id: 'ingenieur', name: 'Ingénieur', icon: 'bolt', job: 'mecanicien', desc: 'Augmente la production d\'énergie, pirate les digicodes en exploration.', pitch: ['Les circuits, c\'est ma langue maternelle.', 'Je peux tirer dix pour cent de plus de n\'importe quelle dynamo.'] },
  eclaireur: { id: 'eclaireur', name: 'Éclaireur', icon: 'binoculars', job: 'suivre', desc: 'Révèle les dangers des prochaines gares, prévient des embuscades et repère le butin.', pitch: ['Je vois venir les ennuis avant qu\'ils ne te voient.', 'J\'ai arpenté la moitié du Réseau à pied.'] },
  marchand: { id: 'marchand', name: 'Marchand', icon: 'token', job: 'repos', desc: 'Obtient de meilleurs prix auprès des commerçants.', pitch: ['Tout s\'achète, tout se vend. Surtout au bon prix.', 'Je connais la valeur de chaque boulon du Réseau.'] },
  serrurier: { id: 'serrurier', name: 'Serrurier', icon: 'lockpick', job: 'suivre', desc: 'Crochète les serrures à votre place lorsqu\'il vous accompagne.', pitch: ['Aucune serrure ne me résiste. Enfin, presque.', 'Les portes fermées, c\'est juste des portes pas encore ouvertes.'] },
  garde: { id: 'garde', name: 'Garde', icon: 'shield', job: 'garde', desc: 'Combat les abordeurs et vous escorte en exploration.', pitch: ['J\'ai tenu des barricades pendant dix ans.', 'Si quelqu\'un monte à bord sans billet, il redescend sans dents.'] },
  scientifique: { id: 'scientifique', name: 'Scientifique', icon: 'flask', job: 'medecin', desc: 'Décontamine l\'équipage (radiations) et analyse les échantillons.', pitch: ['La radioactivité n\'est qu\'une question de mesure.', 'J\'étudiais la Brume avant qu\'elle n\'avale mon laboratoire.'] },
  artiste: { id: 'artiste', name: 'Artiste', icon: 'note', job: 'repos', desc: 'Remonte le moral de tout le convoi, surtout avec un piano ou un juke-box.', pitch: ['Un convoi sans musique, c\'est un corbillard.', 'Je joue de tout ce qui a des cordes ou des touches.'] },
  agronome: { id: 'agronome', name: 'Agronome', icon: 'seed', job: 'jardinier', desc: 'Double la production des wagons-serres.', pitch: ['Je fais pousser des tomates dans la cendre.', 'Donne-moi de la lumière et de l\'eau, je te donne à manger.'] },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

export type PersonalityId =
  | 'courageux' | 'peureux' | 'passif' | 'tetu' | 'loyal' | 'cupide' | 'jovial'
  | 'colerique' | 'paranoiaque' | 'curieux' | 'calme';

export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  desc: string;
  /** Probabilité de base d'obéir à un ordre ordinaire. */
  obedience: number;
  /** Probabilité d'accepter un poste exposé pendant un combat. */
  bravery: number;
  /** Délai (s) avant d'exécuter un ordre. */
  delay: number;
  moraleBase: number;
  greet: string[];
  accept: string[];
  refuse: string[];
  scared: string[];
  idle: string[];
}

export const PERSONALITIES: Record<PersonalityId, PersonalityDef> = {
  courageux: {
    id: 'courageux', name: 'Courageux', desc: 'Accepte les postes dangereux, ne panique jamais.', obedience: 0.9, bravery: 1, delay: 0.5, moraleBase: 60,
    greet: ['Prêt à en découdre.', 'Qu\'est-ce qu\'on attend ?'],
    accept: ['À vos ordres !', 'J\'y vais.', 'Considère que c\'est fait.'],
    refuse: ['Pas cette fois, chef. J\'ai une mauvaise intuition.'],
    scared: ['Qu\'ils viennent !'],
    idle: ['Je garde un œil sur les fenêtres.', 'Le calme avant la tempête…'],
  },
  peureux: {
    id: 'peureux', name: 'Peureux', desc: 'Refuse les postes exposés en combat et fuit vers les wagons sûrs. Craint le noir.', obedience: 0.75, bravery: 0.15, delay: 1.5, moraleBase: 45,
    greet: ['Oh… c\'est vous. Vous m\'avez fait peur.', 'Tout va bien ? On n\'est pas attaqués ?'],
    accept: ['D-d\'accord…', 'Si vous le dites…', 'Bon… j\'y vais.'],
    refuse: ['Non, non et non ! Je ne sortirai pas là-dedans !', 'Vous voulez ma mort ?!', 'Je… je ne peux pas. Désolé.'],
    scared: ['On va tous mourir !', 'Allumez les lumières, par pitié !', 'Je me cache, je me cache !'],
    idle: ['Vous avez entendu ce bruit ?', 'Je déteste les tunnels.'],
  },
  passif: {
    id: 'passif', name: 'Passif', desc: 'Obéit sans discuter, mais lentement. Ne prend aucune initiative.', obedience: 0.95, bravery: 0.5, delay: 4, moraleBase: 55,
    greet: ['Mmh. Bonjour.', 'Ah. C\'est vous.'],
    accept: ['… D\'accord.', 'Si vous voulez.', 'J\'arrive… tout à l\'heure.'],
    refuse: ['Pas maintenant.'],
    scared: ['Hm. Ça tire.'],
    idle: ['…', 'Le paysage défile.'],
  },
  tetu: {
    id: 'tetu', name: 'Têtu', desc: 'Discute les ordres : obéit volontiers seulement s\'il vous apprécie.', obedience: 0.45, bravery: 0.7, delay: 1.5, moraleBase: 50,
    greet: ['Quoi encore ?', 'Si c\'est pour un ordre idiot, passez votre chemin.'],
    accept: ['Bon. Mais c\'est bien parce que c\'est vous.', 'Ça se tient. J\'y vais.'],
    refuse: ['Non. Je reste où je suis.', 'Mauvaise idée. Je refuse.', 'Trouvez quelqu\'un d\'autre.'],
    scared: ['Je ne bougerai pas !'],
    idle: ['J\'aurais fait autrement.', 'On aurait dû prendre l\'autre voie.'],
  },
  loyal: {
    id: 'loyal', name: 'Loyal', desc: 'Vous suit aveuglément. Ne trahira jamais.', obedience: 1, bravery: 0.8, delay: 0.6, moraleBase: 65,
    greet: ['Conducteur ! Toujours là pour vous.', 'Le convoi tient bon grâce à vous.'],
    accept: ['Tout de suite !', 'Comptez sur moi.', 'Avec plaisir.'],
    refuse: ['Je… je ne peux vraiment pas, pardon.'],
    scared: ['Je reste à mon poste !'],
    idle: ['Merci de nous avoir pris à bord.', 'On ira jusqu\'au bout.'],
  },
  cupide: {
    id: 'cupide', name: 'Cupide', desc: 'Obéit mieux quand on le paie. Tenté par le vol.', obedience: 0.65, bravery: 0.4, delay: 1, moraleBase: 50,
    greet: ['Des affaires à proposer ?', 'Le temps, c\'est des jetons.'],
    accept: ['Contre une petite prime, avec plaisir.', 'D\'accord, mais je m\'en souviendrai.'],
    refuse: ['Pas sans compensation.', 'Ça ne paie pas assez.'],
    scared: ['Je n\'ai pas signé pour ça !'],
    idle: ['Combien vaut ce wagon, à votre avis ?', 'Les prix ont encore grimpé à la dernière gare.'],
  },
  jovial: {
    id: 'jovial', name: 'Jovial', desc: 'Remonte le moral de ses voisins de wagon.', obedience: 0.85, bravery: 0.6, delay: 0.8, moraleBase: 70,
    greet: ['Ha ! Le patron ! Quelle belle journée pour rouler !', 'Salut, salut !'],
    accept: ['Avec le sourire !', 'C\'est parti mon kiki !', 'Pas de souci !'],
    refuse: ['Hé, faut pas exagérer quand même !'],
    scared: ['On rira de tout ça ce soir !', 'Courage, les amis !'],
    idle: ['Vous connaissez celle du cheminot et du mutant ?', 'Rien de tel qu\'un bon voyage en train !'],
  },
  colerique: {
    id: 'colerique', name: 'Colérique', desc: 'Se dispute facilement, mais redoutable au corps à corps.', obedience: 0.7, bravery: 0.85, delay: 0.8, moraleBase: 45,
    greet: ['Quoi ?!', 'Faites vite.'],
    accept: ['Grmbl. D\'accord.', 'Ouais, ouais.'],
    refuse: ['Allez au diable !', 'Vous me cherchez ?'],
    scared: ['Venez, bande de rats !'],
    idle: ['Si quelqu\'un touche encore à mes affaires…', 'Ce wagon pue.'],
  },
  paranoiaque: {
    id: 'paranoiaque', name: 'Paranoïaque', desc: 'Remarque les comportements suspects : un précieux témoin.', obedience: 0.7, bravery: 0.35, delay: 1.2, moraleBase: 40,
    greet: ['Fermez la porte derrière vous.', 'On nous observe, j\'en suis sûr.'],
    accept: ['D\'accord… mais je vous ai à l\'œil.', 'Bon. Prudence.'],
    refuse: ['C\'est un piège, je le sens.', 'Non. Trop risqué.'],
    scared: ['Je le savais ! Je le savais !'],
    idle: ['Quelqu\'un fouille dans les caisses la nuit.', 'Vous faites confiance à tout le monde ici ?'],
  },
  curieux: {
    id: 'curieux', name: 'Curieux', desc: 'Fouine partout : trouve des objets en exploration.', obedience: 0.8, bravery: 0.6, delay: 0.9, moraleBase: 60,
    greet: ['Oh ! Vous avez vu ce qu\'il y a dans ce wagon ?', 'Racontez-moi, où va-t-on ?'],
    accept: ['Intéressant ! J\'y vais.', 'Ça me va !'],
    refuse: ['Hmm, non, ça ne m\'intéresse pas.'],
    scared: ['Fascinant… et terrifiant.'],
    idle: ['Je me demande ce qu\'il y a derrière cette colline.', 'Vous saviez que ce train date d\'avant la Brûlure ?'],
  },
  calme: {
    id: 'calme', name: 'Calme', desc: 'Moral stable, apaise les paniques autour de lui.', obedience: 0.88, bravery: 0.7, delay: 0.7, moraleBase: 60,
    greet: ['Bonjour. Tout est en ordre ?', 'Respirons un peu.'],
    accept: ['Bien sûr.', 'Je m\'en occupe.', 'Entendu.'],
    refuse: ['Je ne pense pas que ce soit sage.'],
    scared: ['Restez calmes. Tout ira bien.'],
    idle: ['Le bruit des rails m\'apaise.', 'Chaque gare est une petite victoire.'],
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES) as PersonalityId[];

export type SecretId = 'traitre' | 'voleur' | 'porteur' | 'fugitif' | 'veteran';

export const SECRETS: Record<SecretId, { name: string; desc: string }> = {
  traitre: { name: 'Traître', desc: 'Renseigne les bandits et sabote le train pendant les attaques.' },
  voleur: { name: 'Voleur', desc: 'Dérobe discrètement des ressources dans la soute.' },
  porteur: { name: 'Porteur sain', desc: 'Transmet une maladie sans en montrer les symptômes.' },
  fugitif: { name: 'Fugitif', desc: 'Recherché : des chasseurs de primes le traquent… et une prime peut être touchée.' },
  veteran: { name: 'Ancien soldat', desc: 'Se révèle excellent au combat lorsque le danger survient.' },
};

export type JobId = 'repos' | 'chauffeur' | 'tireur' | 'mecanicien' | 'medecin' | 'cuisinier' | 'garde' | 'jardinier' | 'suivre' | 'prisonnier';

export const JOBS: Record<JobId, { name: string; desc: string; skill?: SkillId[] }> = {
  repos: { name: 'Repos', desc: 'Se repose dans son wagon.' },
  chauffeur: { name: 'Chauffeur', desc: 'Alimente la chaudière de la locomotive.', skill: ['chauffeur'] },
  tireur: { name: 'Tireur', desc: 'Sert une tourelle.', skill: ['tireur', 'garde'] },
  mecanicien: { name: 'Mécanicien de bord', desc: 'Répare tout ce qui est endommagé.', skill: ['mecanicien', 'ingenieur'] },
  medecin: { name: 'Médecin de bord', desc: 'Soigne les blessés et les malades.', skill: ['medecin', 'scientifique'] },
  cuisinier: { name: 'Cuisinier', desc: 'Prépare les repas (voiture-restaurant).', skill: ['cuisinier'] },
  garde: { name: 'Garde', desc: 'Patrouille et repousse les abordeurs.', skill: ['garde', 'tireur'] },
  jardinier: { name: 'Jardinier', desc: 'Entretient le wagon-serre.', skill: ['agronome'] },
  suivre: { name: 'Escorte', desc: 'Vous accompagne en exploration.' },
  prisonnier: { name: 'Prisonnier', desc: 'Enfermé dans une cellule.' },
};

// ---------------------------------------------------------------- noms
export const FIRST_NAMES_F = [
  'Élise', 'Nadia', 'Mila', 'Ingrid', 'Rosalie', 'Agathe', 'Margot', 'Louise', 'Ysée', 'Camille', 'Jeanne', 'Odile', 'Sacha',
  'Léonie', 'Maëlle', 'Inès', 'Zoé', 'Clémence', 'Solène', 'Bérénice', 'Noémie', 'Victoire', 'Apolline', 'Rose', 'Hortense',
  'Yasmine', 'Aïcha', 'Lina', 'Irina', 'Katia', 'Héloïse', 'Gisèle', 'Paulette', 'Mireille', 'Suzon', 'Lou', 'Anouk', 'Thaïs',
];
export const FIRST_NAMES_M = [
  'Bastien', 'Silas', 'Anselme', 'Gaspard', 'Victor', 'Émile', 'Hugo', 'Basile', 'Joachim', 'Lucien', 'Marius', 'Octave',
  'Rémi', 'Théo', 'Yanis', 'Zacharie', 'Aurélien', 'Clovis', 'Edmond', 'Félix', 'Gustave', 'Honoré', 'Isidore', 'Jules',
  'Karim', 'Léandre', 'Malik', 'Nestor', 'Oscar', 'Pacôme', 'Raoul', 'Samuel', 'Tristan', 'Ulysse', 'Valentin', 'Wassim', 'Igor',
];
export const LAST_NAMES = [
  'Moreau', 'Varga', 'Kerr', 'Solberg', 'Delorme', 'Vex', 'Marchal', 'Fournier', 'Lambert', 'Garnier', 'Rousseau', 'Chevalier',
  'Brun', 'Lefort', 'Ferrand', 'Morel', 'Duval', 'Mercier', 'Blanchard', 'Guérin', 'Boyer', 'Roche', 'Perrin', 'Lemaire',
  'Dumont', 'Carpentier', 'Arnaud', 'Barbier', 'Charpentier', 'Collin', 'Faure', 'Gauthier', 'Hamel', 'Jacquet', 'Laurent',
  'Maillard', 'Noël', 'Picard', 'Renaud', 'Tessier', 'Vidal', 'Weber', 'Zimmer', 'Kowalski', 'Novak', 'Haddad', 'Benali',
];
export const NICKNAMES = [
  'Boulon', 'la Pelle', 'Trois-Doigts', 'le Rouquin', 'la Fouine', 'Cendre', 'Bielle', 'le Taiseux', 'Gros-Cœur',
  'la Mèche', 'Vapeur', 'Rouille', 'le Doc', 'Pistache', 'Escarbille', 'Tonnerre', 'la Chouette', 'Grand-Pas',
];

// ---------------------------------------------------------------- apparence
export const SKIN_TONES = [0xf1c9a5, 0xe0ac87, 0xc68e62, 0x9c6b45, 0x7a4e2d, 0x5a3820, 0xf5d6c0];
export const HAIR_COLORS = [0x1c1410, 0x3b2a1e, 0x5c3b22, 0x8a5a2b, 0xc79a52, 0xd9c08f, 0x8c8c8c, 0xe8e8e8, 0x7a2a1a];
export const CLOTH_COLORS = [
  0x5b4636, 0x3c4a3a, 0x4a4f5c, 0x6b3a2e, 0x2f3b4f, 0x7a6a4f, 0x8a7a5a, 0x3d3d3d, 0x5a6b4a, 0x6e5a7a,
  0x8b4c2c, 0x2e5a5a, 0x7a3b3b, 0x9a8a6a, 0x4f6a8a,
];
export const PANTS_COLORS = [0x2e2a26, 0x3a3f4a, 0x4a3b2c, 0x2b3a2a, 0x5a5048, 0x1f2430];

export interface NpcLook {
  skin: number;
  hair: number;
  hairStyle: number;
  shirt: number;
  pants: number;
  hat: number;
  accessory: number;
  height: number;
  build: number;
}

// ---------------------------------------------------------------- textes procéduraux
export const ORIGINS = [
  'des faubourgs de Cendrebourg', 'd\'un hameau de la Toundra', 'des Marais de la Brume', 'de la vieille Mégapole',
  'd\'une ferme des Plaines', 'des mines de l\'Est', 'd\'un camp de réfugiés', 'des Terres irradiées', 'd\'un monastère du Nord',
  'd\'une caravane du désert de Rouille', 'd\'un port fluvial', 'd\'un bunker militaire',
];
export const PASTS = [
  'J\'ai perdu ma famille pendant l\'hiver noir.', 'Les bandits ont brûlé mon village.', 'J\'ai fui la Fièvre Grise.',
  'Mon dernier convoi a été englouti par la Nuée.', 'Je cherche ma sœur, disparue vers le nord.', 'J\'ai passé dix ans à creuser du charbon.',
  'Je suis né·e dans un train, je mourrai dans un train.', 'J\'ai déserté la milice de Garde-Fer.', 'Je n\'ai plus rien, à part mes deux mains.',
  'Ma ferme a été avalée par la Brume.', 'J\'ai tenu une échoppe au Carrefour pendant des années.', 'On m\'a chassé de mon village. Longue histoire.',
];
export const HOPES = [
  'On dit qu\'au nord, il y a encore des terres saines.', 'Je veux juste un endroit chaud où dormir.', 'Un jour, je rouvrirai une boutique.',
  'Je veux revoir la mer, si elle existe encore.', 'Si votre remède existe, je veux aider.', 'Je rêve d\'un monde sans masque à gaz.',
  'Je veux apprendre à mes enfants à lire.', 'Gagner assez pour m\'acheter une draisine.',
];

export const RUMORS = [
  'Les Rôdeurs chassent en meute et courent presque aussi vite qu\'un train. Accélère si tu veux les semer.',
  'Les Cracheurs sont lents : à pleine vapeur, ils ne te rattrapent jamais.',
  'Les Mastodontes s\'en prennent aux wagons. Un bon blindage, ça change la vie.',
  'Les Nuées détestent la lumière. Un projecteur la nuit, et elles hésitent.',
  'Le lance-flammes brûle du charbon, mais rien ne vaut le feu contre les monstres.',
  'Si un wagon lâche, tout ce qui est derrière part avec lui. Faites passer les gens vers l\'avant à temps.',
  'Dans les zones irradiées, ne traîne pas : même le train finit par chauffer.',
  'Les codes des portes sont souvent griffonnés sur des notes oubliées dans les bureaux.',
  'Un bon serrurier vaut son pesant de jetons.',
  'Les Syndicalistes de la Rouille ont des yeux partout. Méfie-toi des nouveaux venus trop aimables.',
  'L\'hiver, une chaudière sans chauffeur s\'étouffe. Garde toujours quelqu\'un à la pelle.',
  'Un équipage affamé devient vite un équipage de voleurs.',
  'La Fièvre Grise se propage dans les wagons bondés. Une infirmerie limite la casse.',
  'Les Spectres du givre n\'apparaissent qu\'en hiver. Ils gèlent les tourelles.',
  'Le marchand de Carrefour-des-Vents vend des combinaisons anti-radiations.',
  'Quand tu croises une draisine marchande, ralentis : ils ont parfois des merveilles.',
  'Les obus sont rares. Garde-les pour les gros morceaux.',
  'Un juke-box dans le salon, et même les plus râleurs se mettent à chanter.',
];

export const BARKS = {
  combat: ['Ils arrivent !', 'À vos postes !', 'Contact à gauche !', 'Feu à volonté !', 'Tenez bon !'],
  cold: ['Je gèle…', 'Brrr… le chauffage !', 'On va mourir de froid ici.'],
  hungry: ['J\'ai faim…', 'Il reste quelque chose à manger ?'],
  dark: ['Il fait si noir…', 'Allumez la lumière !'],
  sick: ['*tousse*', 'Je ne me sens pas bien…', '*tousse violemment*'],
  happy: ['Belle journée !', 'J\'aime ce convoi.', 'Ha ha !'],
  wagonCritical: ['Le wagon va lâcher !', 'Il faut évacuer !', 'Ça craque de partout !'],
  hurt: ['Aïe !', 'Je suis touché !', 'Aidez-moi !'],
  kill: ['Un de moins !', 'Au suivant !', 'Dans le mille !'],
};

// ---------------------------------------------------------------- interrogatoire
export const INTERRO = {
  innocentCalm: ['Je n\'ai rien à cacher. Demandez ce que vous voulez.', 'Je comprends que vous cherchiez. Mais ce n\'est pas moi.'],
  innocentHurt: ['Vous me soupçonnez, moi ? Après tout ce que j\'ai fait ?', 'C\'est blessant, vous savez.'],
  guiltyNervous: ['Pourquoi… pourquoi vous me demandez ça à moi ?', 'J\'étais… je dormais. Oui, je dormais.', 'Vous n\'avez aucune preuve.'],
  guiltySmooth: ['Allons, allons. Vous voyez des complots partout.', 'Je suis un honnête voyageur. Vous me vexez.'],
  confessThief: ['D\'accord, d\'accord ! J\'ai pris quelques rations… j\'avais peur de manquer.', 'C\'était moi. Je vous rendrai tout, promis.'],
  confessTraitor: ['Vous êtes plus malin que je ne pensais. Le Syndicat paie bien, conducteur. Mieux que l\'espoir.', 'Très bien. Oui, je travaille pour la Rouille. Et alors ?'],
  confessFugitive: ['Oui, on me recherche. Mais je n\'ai fait que voler du pain pour mes enfants.'],
  witness: (who: string, where: string, when: string) => `J'ai vu ${who} rôder ${where} vers ${when}. Je dis ça, je dis rien.`,
  noInfo: ['Je n\'ai rien vu de spécial.', 'Désolé, je dormais.', 'Aucune idée.'],
};

/** Atouts du conducteur, gagnés à chaque niveau d'expérience. */
export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const PERKS: Record<string, PerkDef> = {
  robuste: { id: 'robuste', name: 'Robuste', desc: '+25 points de vie maximum.', icon: 'heart' },
  sprinteur: { id: 'sprinteur', name: 'Sprinteur', desc: 'Le sprint et l\'esquive coûtent 30 % d\'endurance en moins.', icon: 'run' },
  tireur: { id: 'tireur', name: 'Œil de lynx', desc: '+15 % de dégâts aux armes à feu, dispersion réduite de 25 %.', icon: 'rifle' },
  cogneur: { id: 'cogneur', name: 'Cogneur', desc: '+35 % de dégâts au corps à corps.', icon: 'wrench' },
  rechargement: { id: 'rechargement', name: 'Mains agiles', desc: 'Rechargement 35 % plus rapide.', icon: 'bullet' },
  mecano: { id: 'mecano', name: 'Cheminot', desc: 'Réparations 50 % plus rapides et 25 % moins chères en ferraille.', icon: 'scrap' },
  crocheteur: { id: 'crocheteur', name: 'Doigts de fée', desc: 'Crochetage plus facile, les crochets cassent deux fois moins.', icon: 'lockpick' },
  negociant: { id: 'negociant', name: 'Négociant', desc: 'Achats 12 % moins chers, ventes 12 % plus chères.', icon: 'token' },
  endurci: { id: 'endurci', name: 'Endurci', desc: 'Résistance au froid +40 % et aux radiations +25 %.', icon: 'thermo' },
  meneur: { id: 'meneur', name: 'Meneur', desc: 'Moral de l\'équipage +8, les ordres sont mieux suivis.', icon: 'flag' },
  infirmier: { id: 'infirmier', name: 'Secouriste', desc: 'Trousses +50 % d\'efficacité, résistance aux maladies.', icon: 'medkit' },
  fouineur: { id: 'fouineur', name: 'Fouineur', desc: '+20 % de butin trouvé dans les conteneurs.', icon: 'box' },
  artificier: { id: 'artificier', name: 'Artificier', desc: 'Dynamite et obus : +40 % de dégâts et de rayon.', icon: 'dynamite' },
  chauffeur: { id: 'chauffeur', name: 'Gueule noire', desc: '-8 % de charbon consommé, la surchauffe monte moins vite.', icon: 'coal' },
  commandant: { id: 'commandant', name: 'Commandant', desc: 'Tourelles : +12 % de cadence tant que vous êtes à bord.', icon: 'shield' },
};

export const PERK_IDS = Object.keys(PERKS);

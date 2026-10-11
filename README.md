# Rails de Cendres

*Tower defense, rogue-like et exploration en 3D, vue de dessus à la troisième personne.*

Vous êtes le conducteur de **L'Espérance**, une vieille locomotive à charbon, dans un monde ravagé par la Grande Brûlure. Le train est votre base : vous l'équipez, le réparez et y vivez avec votre équipage. Vous traversez le Réseau de gare en gare. Entre deux gares, bandits et monstres attaquent le convoi : on passe alors en mode *tower defense*.

Le jeu tourne **entièrement dans le navigateur, sans serveur**. Les sauvegardes sont stockées en local et peuvent être exportées dans un fichier.

---

## Lancer le jeu

### Version prête à jouer

```bash
npm install
npm run build
```

Le build produit **un seul fichier, `dist/index.html`**, qui contient tout le jeu (code, styles, sons procéduraux). Il s'ouvre directement dans le navigateur, même hors ligne (`file://`) ou sur n'importe quel hébergement statique.

### Développement

```bash
npm install
npm run dev        # serveur de développement Vite
npm test           # tests unitaires (vitest)
npm run typecheck  # vérification TypeScript
```

Il faut Node 20 ou plus récent. Le fichier `.npmrc` active `legacy-peer-deps` pour contourner un bug de résolution de npm.

---

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD / flèches | Se déplacer (la disposition du clavier est détectée automatiquement) |
| Maj | Sprinter |
| Espace | Esquive (brève invulnérabilité) |
| Souris + clic gauche | Viser et tirer |
| Clic droit | Coup de clé à molette |
| 1 à 4 | Changer d'arme |
| R | Recharger |
| E | Interagir (maintenir pour réparer, forcer, crocheter…) |
| F | Lampe torche |
| H / X / G | Trousse de soins / pilule anti-radiations / dynamite |
| Tab | Tableau de bord (train, énergie, équipage, inventaire, journal, carte, personnage) |
| T / K / C / I / J / M / P | Onglets du tableau de bord |
| + / − | Régulateur de vitesse (en cabine, ou partout si un chauffeur est à son poste) |
| V | Accélérer le temps (hors combat) |
| Molette | Zoom |
| Échap | Pause / fermer |

Ouvrir un menu met le jeu en pause : vous pouvez donner vos ordres à tête reposée.

---

## Le jeu

### Le train

- **Locomotive à charbon** : le charbon fait avancer le train et alimente la dynamo. Pression, surchauffe à pleine vapeur et coups de pelle se gèrent depuis le poste de conduite.
- **Énergie** à répartir entre **lumière, chauffage/ventilation, armement et boucliers**, à la main ou en mode automatique. Une batterie stocke le surplus.
- **Wagons** ajoutables : voiture-lits, fourgon, wagon blindé, atelier, infirmerie, générateur, restaurant, salon, serre, plateforme d'artillerie, wagon-cellule…
- **Équipements** de toit : mitrailleuses, canons, lance-flammes, bobines Tesla, projecteurs, générateurs de bouclier. Certaines armes tirent seules, d'autres demandent un tireur. Elles consomment balles, obus, charbon ou énergie.
- **Décoration** : poêles, bibliothèques, bornes d'arcade jouables (« Rail Runner »), plantes… Elle améliore le moral et le confort.
- **Tout se casse et se répare** : la coque, le chauffage, l'éclairage et chaque tourelle s'activent, se désactivent et se réparent un à un. Un wagon détruit **se détache et emporte tous les wagons qui le suivent**. Faites changer de wagon les passagers menacés avant qu'il ne soit trop tard.
- Une locomotive à bout de forces s'immobilise. Une réparation de fortune reste toujours possible, même sans ferraille.

### L'équipage

Chaque PNJ a une **personnalité** (courageux, peureux, loyal, cupide, colérique…), une **compétence** (médecin, mécanicien, tireur, chauffeur, ingénieur, cuisinier, éclaireur…), un moral, une faim et une santé. Vous pouvez :

- leur donner un **poste** (tourelle, chaudière, réparations, soins), et les **changer de wagon** ;
- leur **parler**, les **interroger** (amicalement, avec soupçon, sous la menace, en les fouillant) ;
- les **emprisonner**, les **renvoyer** ou les **expulser**.

Certains sont des **voleurs**, d'autres des **traîtres** qui sabotent en plein combat. Les indices s'accumulent dans le journal. Les peureux paniquent sous le feu, et les maladies (grippe, fièvre, infection, mal des rayons) se propagent si l'on entasse les malades.

### Les gares

20 types de gares : dépôt, village, marché, avant-poste, mine, ville en ruines, centrale, usine, camp de bandits, nid de monstres, monastère, hôpital, laboratoire, port, station de pompage, gare de triage, bunker, antenne radio, cimetière de locomotives, serres. Elles se répartissent sur 8 biomes : plaines, forêt, désert, toundra, zone irradiée, marais, montagnes, ruines.

- Gares **sûres**, **neutres** ou **hostiles** (bandits, monstres, infectés, machines).
- **Tous les bâtiments sont visitables**. Certaines portes demandent un **code** (indiqué sur une note quelque part), un **crochetage** (mini-jeu), une **carte d'accès** ou de la **dynamite**.
- Commerce, ateliers, soins, informations et recrutement.
- Aiguillages à actionner, quêtes de PNJ, objets et documents à trouver.

### Dangers et environnement

- **Deux saisons**. L'hiver impose de chauffer les wagons, de porter un manteau et de prévoir davantage de charbon. L'été, en zone chaude, on ventile.
- **Radiations** : il faut une combinaison et un compteur Geiger pour les mesurer. Dans les gares irradiées, le train ne peut pas stationner longtemps.
- **Gaz** : masque à gaz et filtres obligatoires.
- **Événements aléatoires** : blizzards, tempêtes radioactives, nappes de gaz, pannes, incendies, aiguillages manuels, obstacles sur la voie, marchands ambulants, réfugiés, wagons abandonnés, fêtes, disputes, épidémies, chasseurs de primes…

### Deux modes

- **Histoire** : une quête principale en 8 actes, « La Fièvre Grise ». De Cendrebourg à la Station Polaris, il faut réunir trois composants pour synthétiser un remède. En chemin : des personnages mémorables, une trahison, un boss bandit, un bunker scellé, le choix des aiguillages du Col et une défense finale.
- **Infini (rogue-like)** : un réseau procédural sans fin, de 2 à 3 gares par couche. La difficulté monte avec la distance, l'été et l'hiver alternent, un boss revient régulièrement et la mort est définitive. Vos points d'**Héritage** débloquent des avantages de départ pour les parties suivantes.

Trois niveaux de difficulté : Voyageur, Convoyeur et Damné du Rail.

### Direction artistique : « Rouille et braises »

Un monde de cendre froide traversé par la chaleur des lampes, du charbon et de la rouille, rendu en **pixel art 3D** :

- la scène est rendue en basse résolution puis agrandie au pixel près, avec une caméra orthographique calée sur la grille de texels (aucun scintillement, défilement fluide) ;
- un post-traitement maison ajoute les contours, les reflets d'arêtes, les halos lumineux, l'étalonnage de chaque heure du jour et une postérisation des couleurs (ou, en option, la palette stricte de la DA avec tramage) ;
- les matériaux sont des shaders « toon » : terminateur net, ombres franches, ombres de nuages qui dérivent, neige qui tient sur ce qui regarde le ciel, feuillage au vent, eau animée ;
- murs, toits et sols sont décorés par des motifs procéduraux calculés dans le shader (planches, briques, moellons, béton, tôle ondulée, tuiles, bardeaux, pavés…), nets au texel près et sans texture ;
- les vitres reflètent le ciel le jour et s'allument la nuit ; les cheminées fument ;
- météo en pixels : pluie en traits fins et éclaboussures, flocons, cendres et braises, tempête de sable, orages avec éclairs, nappes de brume au ras du sol ;
- interface en police pixel, cadres crantés et jauges segmentées.

Les **Options** permettent de choisir la taille des pixels, le rendu des couleurs (paliers, palette tramée ou couleurs libres), les contours, les halos, les ombres et la qualité.

---

## Architecture

```
src/
  core/      RNG déterministe, maths, bruit, entrées (AZERTY/QWERTY), audio procédural (WebAudio)
  render/    moteur three.js, pipeline pixel art, shaders toon et motifs, terrain, météo, particules, modèles
  data/      données de jeu : objets, armes, wagons, ennemis, biomes, gares, PNJ, équilibrage
  state/     état sérialisable, nouvelle partie, sauvegarde (localStorage + export JSON)
  world/     cartes (Histoire et Infini), génération des 20 types de gares, collisions, butin
  train/     simulation (chaudière, énergie, températures), modèles 3D, logique du train
  game/      orchestration, joueur, ennemis, PNJ, combat, événements, économie, quêtes
  story/     scénario, personnages et dialogues de la quête principale
  ui/        interface DOM : HUD, menus, tableau de bord, dialogues, commerce, mini-jeux
tests/       tests vitest (simulation, cartes, génération des gares, sauvegarde…)
```

Notes techniques :

- Le train reste à l'origine du monde ; en voyage, c'est le décor qui défile. Il est généré par tronçons selon le biome traversé.
- Le décor statique est fusionné en quelques maillages à couleurs de sommets ; un attribut par sommet choisit le motif procédural dessiné par le shader. Herbes et fleurs sont instanciées, les particules utilisent des billboards instanciés et l'éclairage dynamique passe par un pool fixe de lumières.
- Rendu : `render/pixel.ts` (cible basse résolution, contours, halos, étalonnage, palette), `render/toon.ts` (éclairage stylisé, motifs, vitres), `render/palette.ts` (palette de la DA).
- 1 seconde réelle = 1 minute de jeu.
- Le plugin Vite `inlineSingleFile` (dans `vite.config.ts`) intègre JS et CSS au HTML final.

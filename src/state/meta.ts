import { createWagon, newSlot } from './trainState';
import { newWeapon } from '../data/weapons';
import { Rng } from '../core/rng';
import { generateNpc } from '../world/npcgen';
import type { GameState } from './types';

/** Méta-progression du mode infini : « Héritage » conservé entre les parties. */
export interface MetaPerk {
  id: string;
  name: string;
  desc: string;
  cost: number;
  apply: (s: GameState) => void;
}

export const META_PERKS: Record<string, MetaPerk> = {
  reserves: {
    id: 'reserves', name: 'Réserves du dépôt', desc: '+40 charbon, +60 balles et +20 vivres au départ.', cost: 4,
    apply: (s) => {
      s.train.resources.charbon += 40;
      s.train.resources.balles += 60;
      s.train.resources.nourriture += 20;
    },
  },
  blinde: {
    id: 'blinde', name: 'Wagon blindé', desc: 'Commence avec un wagon blindé équipé d\'une mitrailleuse.', cost: 8,
    apply: (s) => {
      const w = createWagon('blinde', `w${s.train.wagons.length + 1}`);
      w.slots[0] = newSlot('mitrailleuse');
      s.train.wagons.push(w);
    },
  },
  canon: {
    id: 'canon', name: 'Canon de proue', desc: 'Remplace le projecteur de la locomotive par un canon (+6 obus).', cost: 7,
    apply: (s) => {
      s.train.wagons[0].slots[0] = newSlot('canon');
      s.train.resources.obus += 6;
    },
  },
  medecin: {
    id: 'medecin', name: 'Médecin de bord', desc: 'Une médecin expérimentée rejoint l\'équipage dès le départ.', cost: 6,
    apply: (s) => {
      const npc = generateNpc(new Rng(s.seed).fork('meta-med'), 'meta_medecin', { skill: 'medecin', personality: 'loyal', secret: null, level: 2 });
      npc.status = 'equipage';
      npc.wagon = s.train.wagons[2]?.uid ?? null;
      npc.job = 'medecin';
      npc.known.personality = true;
      s.npcs[npc.id] = npc;
    },
  },
  chauffeur: {
    id: 'chauffeur', name: 'Vieux chauffeur', desc: 'Un chauffeur loyal tient la pelle dès le premier jour.', cost: 5,
    apply: (s) => {
      const npc = generateNpc(new Rng(s.seed).fork('meta-ch'), 'meta_chauffeur', { skill: 'chauffeur', personality: 'loyal', secret: null, level: 2 });
      npc.status = 'equipage';
      npc.wagon = s.train.wagons[0].uid;
      npc.job = 'chauffeur';
      npc.known.personality = true;
      s.npcs[npc.id] = npc;
    },
  },
  combinaison: {
    id: 'combinaison', name: 'Combinaison et Geiger', desc: 'Démarre avec la combinaison anti-radiations et le compteur Geiger.', cost: 6,
    apply: (s) => {
      s.player.items.combinaison = 1;
      s.player.items.geiger = 1;
    },
  },
  masque: {
    id: 'masque', name: 'Masque à gaz', desc: 'Démarre avec un masque à gaz et 4 filtres.', cost: 4,
    apply: (s) => {
      s.player.items.masque = 1;
      s.train.resources.filtres += 4;
    },
  },
  arme: {
    id: 'arme', name: 'Fusil à pompe', desc: 'Démarre avec un fusil à pompe et 18 cartouches.', cost: 5,
    apply: (s) => {
      s.player.weapons[2] = newWeapon('fusil_pompe');
      s.train.resources.cartouches += 18;
    },
  },
  chaudiere: {
    id: 'chaudiere', name: 'Chaudière rodée', desc: 'Chaudière renforcée niveau 1 dès le départ.', cost: 6,
    apply: (s) => {
      s.train.upgrades.chaudiere = 1;
    },
  },
  veteran: {
    id: 'veteran', name: 'Vétéran du Rail', desc: 'Commence au niveau 2 avec un atout à choisir.', cost: 7,
    apply: (s) => {
      s.player.level = 2;
      s.player.pendingPerks += 1;
    },
  },
};

export interface MetaSave {
  points: number;
  unlocked: string[];
  active: string[];
  bestLayer: number;
  runs: number;
}

const META_KEY = 'rdc_meta_v1';

export function loadMeta(): MetaSave {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return { points: 0, unlocked: [], active: [], bestLayer: 0, runs: 0, ...JSON.parse(raw) };
  } catch {
    /* stockage indisponible */
  }
  return { points: 0, unlocked: [], active: [], bestLayer: 0, runs: 0 };
}

export function saveMeta(m: MetaSave): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* stockage indisponible */
  }
}

/** Points d'héritage gagnés à la fin d'une partie infinie. */
export function heritageEarned(layer: number, kills: number): number {
  return Math.floor(layer * 1.2 + kills / 40);
}

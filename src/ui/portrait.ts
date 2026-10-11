import { h } from './dom';
import { faceTraits } from '../data/faces';
import { portraitSvg, type Garment, type Mood, type PortraitSpec } from './portraitArt';
import type { NpcState } from '../state/types';

/** Tenue du buste selon le rôle dans l'histoire, sinon selon la compétence. */
export function garmentFor(n: NpcState): Garment {
  switch (n.storyRole) {
    case 'maire': return 'costume';
    case 'moine': return 'robe';
    case 'commandant': return 'officier';
  }
  switch (n.skill) {
    case 'garde': case 'tireur': return 'uniforme';
    case 'medecin': case 'scientifique': return 'blouse';
    case 'mecanicien': case 'ingenieur': case 'chauffeur': return 'salopette';
    case 'cuisinier': return 'cuisine';
    case 'marchand': return n.look.accessory === 3 ? 'costume' : 'gilet';
    case 'eclaireur': return 'capuche';
    case 'serrurier': return 'col';
    default: return 'chemise';
  }
}

/** Expression de repos : caractère du personnage, assombrie quand le moral est au plus bas. */
export function baseMood(n: NpcState): Mood {
  if (n.morale < 22 && n.status !== 'resident') return 'triste';
  switch (n.personality) {
    case 'jovial': return 'joie';
    case 'curieux': return 'curieux';
    case 'colerique': return 'colere';
    case 'tetu': return 'renfrogne';
    case 'peureux': return 'peur';
    case 'paranoiaque': return 'inquiet';
    case 'passif': return 'las';
    case 'cupide': return 'malice';
    case 'courageux': return 'assure';
    default: return 'neutre';
  }
}

export function portraitSpec(n: NpcState, mood?: Mood): PortraitSpec {
  const face = faceTraits(n.id, n.look, n.female, n.age);
  const ill = n.disease && n.disease.incubation <= 0 ? n.disease : null;
  if (n.skill === 'chauffeur') face.grime = Math.max(face.grime, 0.5);
  const trade = n.skill === 'medecin' || n.skill === 'scientifique' || n.skill === 'tireur' || n.skill === 'chauffeur' || n.skill === 'ingenieur' ? n.skill : null;
  return {
    key: n.id,
    look: n.look,
    face,
    garment: garmentFor(n),
    mood: mood ?? baseMood(n),
    trade,
    sick: ill ? 0.45 + Math.min(1, ill.severity) * 0.55 : 0,
    hurt: n.hp < n.maxHp * 0.5,
  };
}

/** Vignette illustrée d'un PNJ (listes d'équipage, journal…). */
export function portrait(n: NpcState, big = false): HTMLDivElement {
  return h('div', { class: `portrait${big ? ' big' : ''}`, html: portraitSvg(portraitSpec(n), { crop: true }) });
}

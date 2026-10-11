import { h } from './dom';
import type { NpcState } from '../state/types';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Petit portrait stylisé d'un PNJ (couleurs de peau, cheveux, vêtements). */
export function portrait(n: NpcState, big = false): HTMLDivElement {
  const lk = n.look;
  const sick = n.disease && n.disease.incubation <= 0 && n.disease.id === 'fievre';
  const skin = sick ? '#9aa39a' : hex(lk.skin);
  return h('div', { class: `portrait ${big ? 'big' : ''}`, style: `background:linear-gradient(180deg,#3a3229,#1e1913)` },
    h('div', { class: 'body', style: `background:${hex(lk.shirt)}` }),
    h('div', { class: 'face', style: `background:${skin}` }),
    lk.hairStyle !== 5 || lk.hat ? h('div', { class: 'hair', style: `background:${lk.hat ? '#4a4038' : hex(lk.hair)}` }) : null,
  );
}

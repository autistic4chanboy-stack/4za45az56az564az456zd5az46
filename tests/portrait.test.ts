import { describe, it, expect } from 'vitest';
import { Rng } from '../src/core/rng';
import { generateNpc } from '../src/world/npcgen';
import { createStoryNpcs } from '../src/story/characters';
import { portraitSpec } from '../src/ui/portrait';
import { portraitSvg, type Mood } from '../src/ui/portraitArt';

const MOODS: Mood[] = ['neutre', 'joie', 'curieux', 'colere', 'renfrogne', 'peur', 'inquiet', 'las', 'malice', 'assure', 'triste'];

/** Vérifie qu'un SVG généré est bien formé : pas de valeur invalide, groupes équilibrés, références résolues. */
function checkSvg(svg: string): void {
  expect(svg).not.toMatch(/NaN|undefined|Infinity|null/);
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect((svg.match(/<g[\s>]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
  const ids = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids.has(m[1]), `référence #${m[1]}`).toBe(true);
  // les trois positions de la bouche et les paupières existent pour l'animation
  for (const cls of ['pt-mouth-closed', 'pt-mouth-mid', 'pt-mouth-open', 'pt-lids', 'pt-iris', 'pt-head', 'pt-bust']) expect(svg).toContain(`class="${cls}"`);
}

describe('portraits illustrés', () => {
  it('dessine tous les personnages du scénario', () => {
    for (const n of Object.values(createStoryNpcs(4242))) {
      checkSvg(portraitSvg(portraitSpec(n), { anim: true }));
      checkSvg(portraitSvg(portraitSpec(n), { crop: true }));
    }
  });

  it('couvre coiffures, chapeaux, barbes, tenues et humeurs', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 160; i++) {
      const n = generateNpc(rng, `t${i}`);
      n.look.hairStyle = i % 7;
      n.look.hat = Math.floor(i / 7) % 6;
      n.look.accessory = i % 5;
      if (i % 9 === 0) n.disease = { id: 'fievre', severity: (i % 4) / 3, incubation: 0, known: true, treated: 0 };
      if (i % 11 === 0) n.hp = 5;
      const spec = portraitSpec(n, MOODS[i % MOODS.length]);
      spec.face.beard = n.female ? 0 : ((i % 5) as 0 | 1 | 2 | 3 | 4);
      spec.face.shape = (i % 4) as 0 | 1 | 2 | 3;
      spec.face.scar = (i % 3) as 0 | 1 | 2;
      spec.face.freckles = i % 2 === 0;
      checkSvg(portraitSvg(spec));
    }
  });

  it('donne des identifiants uniques à chaque portrait', () => {
    const n = createStoryNpcs(1).elise;
    const a = portraitSvg(portraitSpec(n));
    const b = portraitSvg(portraitSpec(n));
    const idOf = (s: string) => s.match(/ id="([a-z0-9]+?)b05"/)?.[1];
    expect(idOf(a)).toBeTruthy();
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it('est déterministe pour un même personnage', () => {
    const n = createStoryNpcs(1).bastien;
    const strip = (s: string) => s.replace(/pt[a-z0-9]+(?=[a-zA-Z])/g, 'ID');
    expect(strip(portraitSvg(portraitSpec(n)))).toBe(strip(portraitSvg(portraitSpec(n))));
  });
});

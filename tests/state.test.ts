import { describe, expect, it } from 'vitest';
import { createNewGame, emptyStationDelta, migrateDelta, GEN_VERSION } from '../src/state/newGame';
import { exportSave, importSave } from '../src/state/save';
import { coalCapacity } from '../src/state/trainState';

describe('nouvelle partie', () => {
  it('Histoire : train de départ armé, équipage scénarisé présent, quête principale active', () => {
    const st = createNewGame({ mode: 'histoire', difficulty: 'normal', seed: 3 });
    expect(st.train.wagons.map((w) => w.type)).toEqual(['locomotive', 'tender', 'passagers', 'fourgon']);
    const guns = st.train.wagons.flatMap((w) => w.slots).filter((s) => s.equip === 'mitrailleuse');
    expect(guns.length).toBeGreaterThanOrEqual(3);
    for (const id of ['delorme', 'elise', 'bastien', 'silas', 'ingrid']) expect(st.npcs[id], id).toBeDefined();
    expect(Array.isArray(st.quests)).toBe(true);
    expect(st.train.resources.charbon).toBeLessThanOrEqual(coalCapacity(st.train));
    expect(st.map.current).toBe('cendrebourg');
  });

  it('Infini : départ au dépôt de la couche 0', () => {
    const st = createNewGame({ mode: 'infini', difficulty: 'difficile', seed: 9 });
    expect(st.map.nodes[st.map.current].layer).toBe(0);
    expect(st.map.nodes[st.map.current].hostility).toBe('sure');
  });

  it('la difficulté influe sur les ressources de départ', () => {
    const easy = createNewGame({ mode: 'infini', difficulty: 'facile', seed: 1 });
    const hard = createNewGame({ mode: 'infini', difficulty: 'difficile', seed: 1 });
    expect(easy.train.resources.balles).toBeGreaterThan(hard.train.resources.balles);
  });
});

describe('sauvegarde', () => {
  it('export puis import restitue un état identique', () => {
    const st = createNewGame({ mode: 'histoire', difficulty: 'normal', seed: 77 });
    st.time += 1234;
    st.train.resources.ferraille = 3;
    const back = importSave(exportSave(st));
    expect(back).not.toBeNull();
    expect(JSON.stringify(back)).toBe(JSON.stringify(st));
  });

  it('refuse un fichier invalide', () => {
    expect(importSave('pas du json')).toBeNull();
    expect(importSave(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});

describe('gares déjà visitées', () => {
  it('une nouvelle version du générateur oublie les éléments numérotés mais garde les éléments scénarisés', () => {
    const d = emptyStationDelta();
    d.visits = 2;
    d.looted = ['fort_rouille:cont:12', 'creux_noir:spores', 'fort_rouille:isotope'];
    d.opened = ['fort_rouille:bat:4:porte:s0', 'fort_rouille:butin'];
    d.taken = ['fort_rouille:obj:7'];
    d.killed = ['fort_rouille:en:31'];
    d.drawers = ['fort_rouille:cont:12:1'];
    migrateDelta(d, 'fort_rouille');
    expect(d.looted).toEqual(['creux_noir:spores', 'fort_rouille:isotope']);
    expect(d.opened).toEqual(['fort_rouille:butin']);
    expect(d.taken).toEqual([]);
    expect(d.killed).toEqual([]);
    expect(d.drawers).toEqual([]);
    expect(d.gen).toBe(GEN_VERSION);
    // une seconde passe ne change plus rien
    d.looted.push('fort_rouille:cont:3');
    migrateDelta(d, 'fort_rouille');
    expect(d.looted).toContain('fort_rouille:cont:3');
  });
});

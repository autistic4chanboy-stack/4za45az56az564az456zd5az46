import { describe, expect, it } from 'vitest';
import { ENEMIES, STATION_POOLS, TRAVEL_POOLS } from '../src/data/enemies';
import { WEAPONS } from '../src/data/weapons';
import { EQUIPMENT, WAGON_TYPES } from '../src/data/train';
import { ARCHETYPES, ARCHETYPE_IDS } from '../src/data/stations';
import { STORY_NODES } from '../src/data/storyMap';
import { GENERATORS } from '../src/world/archetypes';
import { BIOMES } from '../src/data/biomes';

describe('intégrité des données', () => {
  it('chaque ennemi utilise une arme existante', () => {
    for (const e of Object.values(ENEMIES)) expect(WEAPONS[e.weapon], `${e.id} -> ${e.weapon}`).toBeDefined();
  });

  it('les tables d\'apparition ne citent que des ennemis connus', () => {
    for (const pool of [...Object.values(TRAVEL_POOLS), ...Object.values(STATION_POOLS)]) {
      for (const p of pool) expect(ENEMIES[p.id], p.id).toBeDefined();
    }
  });

  it('chaque équipement armé référence une arme', () => {
    for (const [id, eq] of Object.entries(EQUIPMENT)) if (eq.weapon) expect(WEAPONS[eq.weapon], `${id} -> ${eq.weapon}`).toBeDefined();
  });

  it('il y a 21 types de gares, tous dotés d\'un générateur', () => {
    expect(ARCHETYPE_IDS.length).toBe(21);
    for (const id of ARCHETYPE_IDS) expect(GENERATORS[id], id).toBeTypeOf('function');
  });

  it('les gares de l\'histoire utilisent des types et biomes valides', () => {
    for (const n of STORY_NODES) {
      expect(ARCHETYPES[n.archetype], n.id).toBeDefined();
      expect(BIOMES[n.biome], n.id).toBeDefined();
    }
  });

  it('chaque wagon a des caractéristiques cohérentes', () => {
    for (const [id, w] of Object.entries(WAGON_TYPES)) {
      expect(w.hp, id).toBeGreaterThan(0);
      expect(w.length, id).toBeGreaterThan(4);
      expect(w.armor, id).toBeGreaterThanOrEqual(0);
      expect(w.armor, id).toBeLessThan(0.8);
    }
  });
});

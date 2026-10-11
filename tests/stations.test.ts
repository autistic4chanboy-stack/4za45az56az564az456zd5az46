import { describe, expect, it } from 'vitest';
import { StationBuilder } from '../src/world/stationBuilder';
import { generateStation } from '../src/world/archetypes';
import { createInfiniteMap } from '../src/world/map';
import { ARCHETYPE_IDS, type ArchetypeId } from '../src/data/stations';
import type { BiomeId, Season } from '../src/data/biomes';
import type { MapNode } from '../src/state/types';

const FRONT_X = 10;
const TRAIN_LEN = 48;
const HOSTILE: ArchetypeId[] = ['campbandit', 'nid', 'laboratoire', 'bunker'];

function makeNode(archetype: ArchetypeId, biome: BiomeId, season: Season, seed: number, threat: number): MapNode {
  const base = Object.values(createInfiniteMap(seed).nodes)[0];
  const hostile = HOSTILE.includes(archetype);
  return {
    ...base,
    id: `test_${archetype}_${seed}`,
    archetype,
    biome,
    season,
    seed,
    threat,
    hostility: hostile ? 'hostile' : 'neutre',
    faction: archetype === 'nid' ? 'monster' : archetype === 'bunker' ? 'machine' : 'bandit',
    radiation: archetype === 'centrale' ? 3 : 0,
  };
}

function build(node: MapNode) {
  const b = new StationBuilder(node.id, node.seed, node.biome, node.season, node.threat, 1, FRONT_X - TRAIN_LEN, FRONT_X);
  const ctx = generateStation(b, node, 1);
  b.finalize();
  return { b, ctx };
}

describe('génération des gares', () => {
  const cases: [ArchetypeId, BiomeId, Season, number][] = [];
  const biomes: BiomeId[] = ['plaines', 'foret', 'desert', 'toundra', 'irradie', 'marais', 'montagnes', 'ruines'];
  ARCHETYPE_IDS.forEach((a, i) => {
    cases.push([a, biomes[i % biomes.length], 'ete', 1000 + i]);
    cases.push([a, biomes[(i + 3) % biomes.length], 'hiver', 2000 + i * 7]);
  });

  it.each(cases)('%s (%s, %s) se génère sans erreur et reste praticable', (arch, biome, season, seed) => {
    const node = makeNode(arch, biome, season, seed, 2);
    const { b } = build(node);
    // le joueur apparaît sur le quai, devant la locomotive
    expect(b.colliders.blocked(FRONT_X - 6, 4.2, 0.45)).toBe(false);
    // au moins un bâtiment visitable
    expect(b.buildings.length).toBeGreaterThan(0);
    // les conteneurs sont dans les limites de la gare
    for (const c of b.containers) {
      expect(c.x).toBeGreaterThanOrEqual(b.bounds.x0);
      expect(c.x).toBeLessThanOrEqual(b.bounds.x1);
      expect(c.z).toBeGreaterThanOrEqual(b.bounds.z0);
      expect(c.z).toBeLessThanOrEqual(b.bounds.z1);
    }
    // les ennemis ne sont pas emmurés
    const stuck = b.enemies.filter((e) => b.colliders.blocked(e.x, e.z, 0.3)).length;
    expect(stuck).toBeLessThanOrEqual(Math.ceil(b.enemies.length * 0.1));
    // les portes à code ont un code à 4 chiffres
    for (const d of b.doors) if (d.lock?.kind === 'code') expect(String(d.lock.code)).toMatch(/^\d{4}$/);
  });

  it('les gares hostiles sont peuplées et la menace augmente les effectifs', () => {
    for (const arch of HOSTILE) {
      const low = build(makeNode(arch, 'plaines', 'ete', 77, 0.6)).b.enemies.length;
      const high = build(makeNode(arch, 'plaines', 'ete', 77, 4.5)).b.enemies.length;
      expect(high, arch).toBeGreaterThan(0);
      expect(high, arch).toBeGreaterThanOrEqual(low);
    }
  });

  it('la génération est déterministe pour une même graine', () => {
    const a = build(makeNode('ville', 'ruines', 'ete', 4242, 2)).b;
    const c = build(makeNode('ville', 'ruines', 'ete', 4242, 2)).b;
    expect(a.containers.map((x) => `${x.id}@${x.x.toFixed(2)},${x.z.toFixed(2)}`)).toEqual(c.containers.map((x) => `${x.id}@${x.x.toFixed(2)},${x.z.toFixed(2)}`));
    expect(a.enemies.length).toBe(c.enemies.length);
  });
});

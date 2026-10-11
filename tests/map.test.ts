import { describe, expect, it } from 'vitest';
import { createInfiniteMap, createStoryMap, extendInfiniteMap, seasonForLayer } from '../src/world/map';
import type { MapState } from '../src/state/types';

function reachable(map: MapState, from: string, without?: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    for (const l of map.nodes[id].links) {
      if (l === without || seen.has(l)) continue;
      seen.add(l);
      stack.push(l);
    }
  }
  return seen;
}

describe('carte du mode Histoire', () => {
  const map = createStoryMap(99);

  it('contient 17 gares toutes atteignables depuis Cendrebourg', () => {
    expect(Object.keys(map.nodes).length).toBe(17);
    const r = reachable(map, 'cendrebourg');
    for (const id of Object.keys(map.nodes)) expect(r.has(id), id).toBe(true);
  });

  it('n\'a que des liaisons valides, vers l\'avant, avec une voie par liaison', () => {
    for (const n of Object.values(map.nodes)) {
      for (const l of n.links) {
        expect(map.nodes[l], `${n.id} -> ${l}`).toBeDefined();
        expect(map.nodes[l].layer).toBeGreaterThan(n.layer);
        expect(map.edges.some((e) => e.from === n.id && e.to === l)).toBe(true);
      }
    }
  });

  it('impose le passage par chaque gare obligatoire pour atteindre Polaris', () => {
    const required = ['creux_noir', 'carrefour', 'valpierre', 'morne_brume', 'givre', 'col'];
    for (const id of required) expect(reachable(map, 'cendrebourg', id).has('polaris'), id).toBe(false);
  });

  it('le premier trajet est sans aiguillage ni tunnel', () => {
    for (const e of map.edges.filter((x) => x.from === 'cendrebourg')) expect(e.features).toEqual([]);
  });
});

describe('carte du mode Infini', () => {
  it('est déterministe pour une graine donnée', () => {
    const a = createInfiniteMap(777);
    const b = createInfiniteMap(777);
    extendInfiniteMap(a, 777, 30);
    extendInfiniteMap(b, 777, 30);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reste connexe et progresse couche par couche sur 40 couches', () => {
    const map = createInfiniteMap(31337);
    extendInfiniteMap(map, 31337, 40);
    const r = reachable(map, 'L0_0');
    for (const n of Object.values(map.nodes)) {
      expect(r.has(n.id), n.id).toBe(true);
      if (n.layer < 40) expect(n.links.length, n.id).toBeGreaterThan(0);
      for (const l of n.links) expect(map.nodes[l].layer).toBe(n.layer + 1);
    }
  });

  it('alterne été/hiver, place des boss et des gares sûres régulièrement', () => {
    const map = createInfiniteMap(5);
    extendInfiniteMap(map, 5, 30);
    const byLayer = (l: number) => Object.values(map.nodes).filter((n) => n.layer === l);
    for (let l = 0; l <= 30; l++) for (const n of byLayer(l)) expect(n.season).toBe(seasonForLayer(l));
    for (const l of [7, 15, 23]) expect(byLayer(l).every((n) => n.boss && n.hostility === 'hostile')).toBe(true);
    for (const l of [1, 4, 10, 13]) expect(byLayer(l).some((n) => n.hostility === 'sure')).toBe(true);
  });

  it('fait monter la menace avec la distance', () => {
    const map = createInfiniteMap(8);
    extendInfiniteMap(map, 8, 20);
    const t = (l: number) => Object.values(map.nodes).find((n) => n.layer === l)!.threat;
    expect(t(20)).toBeGreaterThan(t(10));
    expect(t(10)).toBeGreaterThan(t(1));
  });
});

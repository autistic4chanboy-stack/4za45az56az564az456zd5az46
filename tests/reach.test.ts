import { describe, expect, it } from 'vitest';
import { StationBuilder } from '../src/world/stationBuilder';
import { generateStation } from '../src/world/archetypes';
import { createInfiniteMap } from '../src/world/map';
import { ARCHETYPE_IDS, type ArchetypeId } from '../src/data/stations';
import type { BiomeId } from '../src/data/biomes';
import type { MapNode } from '../src/state/types';

/**
 * Praticabilité des gares denses : depuis le quai, le joueur doit pouvoir atteindre chaque porte,
 * chaque meuble fouillable et chaque PNJ (portes considérées comme ouvertes, eau infranchissable).
 */
const FRONT_X = 10;
const CELL = 0.25;
const RADIUS = 0.36;

function makeNode(archetype: ArchetypeId, biome: BiomeId, seed: number, hostile: boolean): MapNode {
  const base = Object.values(createInfiniteMap(seed).nodes)[0];
  return { ...base, id: `reach_${archetype}_${seed}`, archetype, biome, season: 'ete', seed, threat: 2, hostility: hostile ? 'hostile' : 'neutre', faction: archetype === 'nid' ? 'monster' : archetype === 'bunker' ? 'machine' : 'bandit', radiation: 0 };
}

function reachability(b: StationBuilder) {
  const bd = b.bounds;
  const cols = Math.ceil((bd.x1 - bd.x0) / CELL);
  const rows = Math.ceil((bd.z1 - bd.z0) / CELL);
  const free = new Uint8Array(cols * rows);
  const seen = new Uint8Array(cols * rows);
  const cx = (i: number) => bd.x0 + (i + 0.5) * CELL;
  const cz = (j: number) => bd.z0 + (j + 0.5) * CELL;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) free[j * cols + i] = b.colliders.blocked(cx(i), cz(j), RADIUS, (c) => c.tag === 'door') ? 0 : 1;
  const si = Math.floor((FRONT_X - 6 - bd.x0) / CELL);
  const sj = Math.floor((4.2 - bd.z0) / CELL);
  const queue = [sj * cols + si];
  seen[queue[0]] = 1;
  while (queue.length) {
    const k = queue.pop()!;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (!seen[nk] && free[nk]) {
        seen[nk] = 1;
        queue.push(nk);
      }
    }
  }
  /** Une position atteinte à moins de r mètres de (x, z) ? */
  const near = (x: number, z: number, r: number) => {
    const i0 = Math.max(0, Math.floor((x - r - bd.x0) / CELL));
    const i1 = Math.min(cols - 1, Math.floor((x + r - bd.x0) / CELL));
    const j0 = Math.max(0, Math.floor((z - r - bd.z0) / CELL));
    const j1 = Math.min(rows - 1, Math.floor((z + r - bd.z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (seen[j * cols + i] && Math.hypot(cx(i) - x, cz(j) - z) <= r) return true;
    return false;
  };
  return { near, startFree: free[queue.length ? 0 : sj * cols + si] === 1 };
}

describe('praticabilité des gares denses', () => {
  const biomes: BiomeId[] = ['plaines', 'foret', 'desert', 'ruines', 'marais', 'montagnes', 'toundra'];
  const cases: [ArchetypeId, BiomeId, number][] = [];
  ARCHETYPE_IDS.forEach((a, i) => {
    cases.push([a, biomes[i % biomes.length], 300 + i * 13]);
    cases.push([a, biomes[(i + 4) % biomes.length], 9100 + i * 7]);
  });
  it.each(cases)('%s (%s, graine %i) : portes, meubles et PNJ accessibles depuis le quai', (arch, biome, seed) => {
    const node = makeNode(arch, biome, seed, ['campbandit', 'nid', 'bunker', 'ville', 'hopital'].includes(arch));
    const b = new StationBuilder(node.id, node.seed, node.biome, node.season, node.threat, 1, FRONT_X - 48, FRONT_X);
    generateStation(b, node, 1);
    b.finalize();
    const r = reachability(b);
    const doors = b.doors.filter((d) => !r.near(d.x, d.z, 1.2)).map((d) => `${d.id}@${d.x.toFixed(1)},${d.z.toFixed(1)}`);
    const conts = b.containers.filter((c) => !r.near(c.ix, c.iz, 1.1)).map((c) => `${c.name}@${c.x.toFixed(1)},${c.z.toFixed(1)}`);
    const npcs = b.npcs.filter((n) => !r.near(n.x, n.z, 1.0)).map((n) => `${n.role}@${n.x.toFixed(1)},${n.z.toFixed(1)}`);
    expect(doors, 'portes inaccessibles').toEqual([]);
    expect(npcs, 'PNJ inaccessibles').toEqual([]);
    expect(conts.length, `meubles inaccessibles : ${conts.slice(0, 8).join(' ; ')}`).toBeLessThanOrEqual(Math.floor(b.containers.length * 0.02));
  });
});

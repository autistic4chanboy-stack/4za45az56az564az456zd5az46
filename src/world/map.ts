import { Rng } from '../core/rng';
import { STORY_NODES } from '../data/storyMap';
import { ARCHETYPES, ARCHETYPE_IDS, generateStationName, type ArchetypeId, type Hostility, type EnemyFaction } from '../data/stations';
import { BIOMES, BIOME_NEIGHBORS, type BiomeId, type Season } from '../data/biomes';
import type { MapEdge, MapNode, MapState } from '../state/types';

const LAYER_DX = 150;
const SLOT_DY = 110;

function edgeLength(rng: Rng, threat: number): number {
  return Math.round(1350 + rng.next() * 1150 + threat * 60);
}

function edgeFeatures(rng: Rng, biome: BiomeId): string[] {
  const f: string[] = [];
  if (rng.chance(biome === 'montagnes' ? 0.55 : 0.12)) f.push('tunnel');
  if (rng.chance(0.22)) f.push('aiguillage');
  if (rng.chance(biome === 'marais' || biome === 'plaines' ? 0.25 : 0.1)) f.push('pont');
  return f;
}

export function createStoryMap(seed: number): MapState {
  const rng = new Rng(seed).fork('story-map');
  const nodes: Record<string, MapNode> = {};
  for (const d of STORY_NODES) {
    const arch = ARCHETYPES[d.archetype];
    nodes[d.id] = {
      id: d.id,
      name: d.name,
      archetype: d.archetype,
      biome: d.biome,
      layer: d.layer,
      x: d.layer * LAYER_DX,
      y: d.slot * SLOT_DY,
      links: [...d.links],
      hostility: d.hostility,
      faction: d.faction,
      threat: d.threat,
      seed: rng.int(1, 1e9),
      services: d.hostility === 'hostile' ? [] : [...arch.services],
      known: d.layer <= 1,
      scouted: d.layer <= 1,
      visited: false,
      story: d.id,
      season: d.season,
      radiation: d.radiation ?? (arch.radiation ? arch.radiation[0] : 0),
      gas: d.gas ?? !!arch.gas,
      boss: !!d.boss,
      hidden: !!d.hidden,
      blurb: d.blurb,
    };
  }
  const edges: MapEdge[] = [];
  for (const n of Object.values(nodes)) {
    for (const l of n.links) {
      const to = nodes[l];
      edges.push({ from: n.id, to: l, length: edgeLength(rng, to.threat), biome: to.biome, danger: dangerOf(to), features: edgeFeatures(rng, to.biome) });
    }
  }
  // premier trajet : pas d'aiguillage ni de tunnel, pour un tutoriel en douceur
  for (const e of edges) if (e.from === 'cendrebourg') e.features = [];
  return { nodes, edges, current: 'cendrebourg', maxLayer: 12 };
}

function dangerOf(n: MapNode): number {
  const base = n.hostility === 'hostile' ? 0.75 : n.hostility === 'neutre' ? 0.5 : 0.3;
  return Math.min(1, base + BIOMES[n.biome].monsterBias * 0.2);
}

// ---------------------------------------------------------------- mode infini

const SAFE_ARCHETYPES: ArchetypeId[] = ['depot', 'village', 'marche', 'monastere', 'port', 'serre'];

function archetypeWeight(id: ArchetypeId, biome: BiomeId, layer: number): number {
  const a = ARCHETYPES[id];
  let w = a.biomes.includes(biome) ? 3 : 0.35;
  if (id === 'centrale' && biome === 'irradie') w += 3;
  if (id === 'usine' && biome === 'marais') w += 2;
  if (id === 'campbandit' && (biome === 'desert' || biome === 'ruines')) w += 1.5;
  if (id === 'nid' && layer < 3) w *= 0.2;
  if ((id === 'centrale' || id === 'bunker' || id === 'laboratoire') && layer < 4) w *= 0.3;
  if (id === 'depot') w *= 0.8;
  return w;
}

function pickHostility(rng: Rng, arch: ArchetypeId): Hostility {
  const h = ARCHETYPES[arch].hostility;
  const entries = Object.entries(h) as [Hostility, number][];
  return rng.pickWeighted(entries, (e) => e[1])[0];
}

function pickFaction(rng: Rng, arch: ArchetypeId, hostility: Hostility, biome: BiomeId): EnemyFaction {
  const list = ARCHETYPES[arch].enemies;
  if (hostility === 'sure' || list[0] === 'none') return 'none';
  if (list.length === 1) return list[0];
  return rng.chance(BIOMES[biome].monsterBias) ? (list.includes('monster') ? 'monster' : list[0]) : (list.includes('bandit') ? 'bandit' : list[0]);
}

export function seasonForLayer(layer: number): Season {
  return Math.floor(layer / 6) % 2 === 1 ? 'hiver' : 'ete';
}

export function threatForLayer(layer: number): number {
  return 0.4 + layer * 0.34;
}

function makeInfiniteNode(rng: Rng, id: string, layer: number, slot: number, biome: BiomeId, forceSafe: boolean, boss: boolean): MapNode {
  let arch: ArchetypeId;
  if (layer === 0) arch = 'depot';
  else if (boss) arch = rng.chance(0.5) ? 'nid' : 'campbandit';
  else if (forceSafe) arch = rng.pickWeighted(SAFE_ARCHETYPES, (a) => archetypeWeight(a, biome, layer));
  else arch = rng.pickWeighted(ARCHETYPE_IDS, (a) => archetypeWeight(a, biome, layer));
  const def = ARCHETYPES[arch];
  const hostility = layer === 0 ? 'sure' : boss ? 'hostile' : pickHostility(rng, arch);
  const threat = threatForLayer(layer);
  return {
    id,
    name: generateStationName(rng, def),
    archetype: arch,
    biome,
    layer,
    x: layer * LAYER_DX,
    y: slot * SLOT_DY,
    links: [],
    hostility,
    faction: pickFaction(rng, arch, hostility, biome),
    threat,
    seed: rng.int(1, 1e9),
    services: hostility === 'hostile' ? [] : [...def.services],
    known: layer <= 1,
    scouted: layer === 0,
    visited: false,
    story: null,
    season: seasonForLayer(layer),
    radiation: def.radiation ? def.radiation[0] + rng.next() * (def.radiation[1] - def.radiation[0]) : 0,
    gas: !!def.gas || (BIOMES[biome].gas > 0.5 && rng.chance(0.3)),
    boss,
    hidden: false,
  };
}

export function createInfiniteMap(seed: number): MapState {
  const map: MapState = { nodes: {}, edges: [], current: 'L0_0', maxLayer: -1 };
  const rng = new Rng(seed).fork('inf-0');
  const start = makeInfiniteNode(rng, 'L0_0', 0, 0, 'plaines', true, false);
  start.name = 'Dépôt de Cendrebourg';
  start.known = true;
  start.scouted = true;
  map.nodes[start.id] = start;
  map.maxLayer = 0;
  extendInfiniteMap(map, seed, 6);
  return map;
}

/** Étend la carte infinie jusqu'à la couche demandée (génération paresseuse). */
export function extendInfiniteMap(map: MapState, seed: number, upTo: number): void {
  while (map.maxLayer < upTo) {
    const layer = map.maxLayer + 1;
    const rng = new Rng(seed).fork(`inf-${layer}`);
    const prev = Object.values(map.nodes).filter((n) => n.layer === layer - 1).sort((a, b) => a.y - b.y);
    // biome dominant : dérive progressive depuis la couche précédente
    const prevBiome = prev[Math.floor(prev.length / 2)]?.biome ?? 'plaines';
    let biome: BiomeId = prevBiome;
    if (layer % 4 === 0 || rng.chance(0.18)) biome = rng.pick(BIOME_NEIGHBORS[prevBiome]);
    const boss = layer % 8 === 7;
    const count = boss ? 1 : rng.chance(0.3) ? 3 : 2;
    const needSafe = !boss && (layer % 3 === 1);
    const nodes: MapNode[] = [];
    for (let i = 0; i < count; i++) {
      const slot = count === 1 ? 0 : count === 2 ? (i === 0 ? -0.6 : 0.6) : i - 1;
      const nb: BiomeId = i > 0 && rng.chance(0.35) ? rng.pick(BIOME_NEIGHBORS[biome]) : biome;
      const n = makeInfiniteNode(rng, `L${layer}_${i}`, layer, slot, nb, needSafe && i === 0, boss);
      nodes.push(n);
      map.nodes[n.id] = n;
    }
    // liaisons : chaque nœud précédent rejoint 1-2 nœuds proches ; chaque nouveau nœud a au moins une entrée
    const incoming = new Set<string>();
    for (const p of prev) {
      const sorted = [...nodes].sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y));
      const nLinks = Math.min(sorted.length, rng.chance(0.55) ? 2 : 1);
      for (let k = 0; k < nLinks; k++) {
        if (!p.links.includes(sorted[k].id)) p.links.push(sorted[k].id);
        incoming.add(sorted[k].id);
      }
    }
    for (const n of nodes) {
      if (!incoming.has(n.id) && prev.length > 0) {
        const closest = [...prev].sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0];
        closest.links.push(n.id);
      }
    }
    for (const p of prev) {
      for (const l of p.links) {
        if (map.edges.some((e) => e.from === p.id && e.to === l)) continue;
        const to = map.nodes[l];
        map.edges.push({ from: p.id, to: l, length: edgeLength(rng, to.threat), biome: to.biome, danger: dangerOf(to), features: edgeFeatures(rng, to.biome) });
      }
    }
    map.maxLayer = layer;
  }
}

export function findEdge(map: MapState, from: string, to: string): MapEdge | undefined {
  return map.edges.find((e) => e.from === from && e.to === to);
}

/** Révèle les gares directement accessibles depuis la gare courante. */
export function revealNeighbors(map: MapState, id: string, scout = false): void {
  const n = map.nodes[id];
  if (!n) return;
  for (const l of n.links) {
    const t = map.nodes[l];
    if (!t || t.hidden) continue;
    t.known = true;
    if (scout) t.scouted = true;
    // les gares sûres sont réputées connues
    if (t.hostility === 'sure') t.scouted = true;
  }
}

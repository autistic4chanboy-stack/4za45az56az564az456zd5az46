import { BAL, START_RESOURCES, DIFFICULTIES, type Difficulty } from '../data/balance';
import { RESOURCE_IDS, type ResourceId } from '../data/items';
import { newWeapon } from '../data/weapons';
import { createStoryMap, createInfiniteMap } from '../world/map';
import { createStoryNpcs } from '../story/characters';
import { createWagon, newSlot } from './trainState';
import type { GameMode, GameState, StationDelta } from './types';
import { META_PERKS } from './meta';

export const SAVE_VERSION = 3;

export interface NewGameOptions {
  mode: GameMode;
  difficulty: Difficulty;
  seed?: number;
  playerName?: string;
  /** Atouts d'héritage achetés (mode infini). */
  meta?: string[];
}

export function emptyStationDelta(): StationDelta {
  return { looted: [], opened: [], killed: [], taken: [], levers: {}, flags: {}, visits: 0, lastVisit: 0, residents: [], stock: null, dwell: 0 };
}

export function createNewGame(opts: NewGameOptions): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const diff = DIFFICULTIES[opts.difficulty];
  const resources = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) {
    const base = START_RESOURCES[id] ?? 0;
    resources[id] = id === 'charbon' || id === 'jetons' ? base : Math.round(base * Math.sqrt(diff.loot));
  }

  const loco = createWagon('locomotive', 'w1');
  loco.slots[0] = newSlot('projecteur');
  const tender = createWagon('tender', 'w2');
  tender.slots[0] = newSlot('mitrailleuse');
  const lits = createWagon('passagers', 'w3');
  lits.slots[0] = newSlot('mitrailleuse');
  lits.decor[0] = 'fanion';
  const fourgon = createWagon('fourgon', 'w4');
  fourgon.slots[1] = newSlot('mitrailleuse');

  const state: GameState = {
    version: SAVE_VERSION,
    mode: opts.mode,
    difficulty: opts.difficulty,
    seed,
    time: 8 * 60 + 30,
    season: 'ete',
    player: {
      name: opts.playerName?.trim() || 'Conducteur',
      hp: BAL.playerHp,
      stamina: BAL.staminaMax,
      warmth: 100,
      rads: 0,
      disease: null,
      weapons: [newWeapon('cle'), newWeapon('revolver'), null, null],
      active: 1,
      items: { lampe: 1, pied_de_biche: 0 },
      gear: { corps: null, tete: null },
      filter: 0,
      xp: 0,
      level: 1,
      perks: [],
      pendingPerks: 0,
    },
    train: {
      name: 'L\'Espérance',
      wagons: [loco, tender, lits, fourgon],
      throttle: 0,
      heat: 0,
      pressure: 0.5,
      autoStoker: true,
      power: { alloc: { lumiere: 15, chauffage: 35, armement: 30, bouclier: 20 }, auto: true, battery: 20 },
      resources,
      upgrades: { chaudiere: 0, dynamo: 0, blindage: 0 },
      greenhouse: 0,
      spare: { equip: [], decor: [] },
    },
    npcs: {},
    map: opts.mode === 'histoire' ? createStoryMap(seed) : createInfiniteMap(seed),
    location: { kind: 'station', station: '' },
    quests: [],
    flags: {},
    journal: { notes: [], clues: [], incidents: [], log: [], codes: {} },
    stats: { kills: 0, distance: 0, stations: 0, deaths: 0, saved: 0, attacks: 0, playTime: 0 },
    stations: {},
    nextId: 1,
    over: null,
  };
  state.location = { kind: 'station', station: state.map.current };
  state.stations[state.map.current] = emptyStationDelta();

  if (opts.mode === 'histoire') {
    state.npcs = createStoryNpcs(seed);
    for (const n of Object.values(state.npcs)) {
      if (n.stationId) {
        state.stations[n.stationId] ??= emptyStationDelta();
        state.stations[n.stationId].residents.push(n.id);
      }
    }
  } else {
    for (const perk of opts.meta ?? []) META_PERKS[perk]?.apply(state);
  }
  return state;
}

export function newId(state: GameState, prefix = 'n'): string {
  return `${prefix}${state.nextId++}`;
}

/**
 * Version du générateur de gares. Les meubles, portes et objets générés sont numérotés dans l'ordre
 * de création : quand le générateur change, les anciens identifiants ne désignent plus les mêmes choses.
 */
export const GEN_VERSION = 2;

/** Oublie l'état des éléments générés par une ancienne version (les éléments scénarisés, à identifiant fixe, sont conservés). */
export function migrateDelta(d: StationDelta, stationId: string): void {
  if ((d.gen ?? 1) === GEN_VERSION) return;
  const esc = stationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const generated = new RegExp(`^${esc}:(cont|obj|note|bat|app|sp|porte_int|levier|en|grp|mur):\\d+`);
  const keep = (ids: string[] | undefined) => (ids ?? []).filter((id) => !generated.test(id));
  d.looted = keep(d.looted);
  d.opened = keep(d.opened);
  d.taken = keep(d.taken);
  d.killed = keep(d.killed);
  d.drawers = keep(d.drawers);
  d.emptied = keep(d.emptied);
  d.devices = {};
  d.gen = GEN_VERSION;
}

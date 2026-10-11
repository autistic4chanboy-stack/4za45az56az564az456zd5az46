import { WAGON_TYPES, EQUIPMENT, DECOR, type WagonTypeId, type EquipId } from '../data/train';
import { RESOURCES, type ResourceId } from '../data/items';
import type { GameState, NpcState, SlotState, TrainState, WagonState } from './types';

export function newSlot(equip: EquipId | null = null): SlotState {
  return { equip, level: 0, hp: equip ? EQUIPMENT[equip].hp : 0, on: true, auto: true, gunner: null };
}

export function createWagon(type: WagonTypeId, uid: string): WagonState {
  const def = WAGON_TYPES[type];
  return {
    uid,
    type,
    hp: def.hp,
    armor: 0,
    slots: Array.from({ length: def.roofSlots }, () => newSlot()),
    decor: Array.from({ length: def.decorSlots }, () => null),
    heater: { hp: 100, on: true },
    lights: { hp: 100, on: true },
    temp: 18,
    fire: 0,
    shield: 0,
  };
}

export function wagonMaxHp(state: GameState, w: WagonState): number {
  const def = WAGON_TYPES[w.type];
  const lvl = w.type === 'locomotive' ? state.train.upgrades.blindage ?? 0 : w.armor;
  return Math.round(def.hp * (1 + 0.15 * lvl));
}

export function wagonArmor(state: GameState, w: WagonState): number {
  const def = WAGON_TYPES[w.type];
  const lvl = w.type === 'locomotive' ? state.train.upgrades.blindage ?? 0 : w.armor;
  return Math.min(0.7, def.armor + 0.06 * lvl);
}

export function coalCapacity(train: TrainState): number {
  return train.wagons.reduce((s, w) => s + WAGON_TYPES[w.type].coal, 0);
}

export function storageCapacity(train: TrainState): number {
  return train.wagons.reduce((s, w) => s + WAGON_TYPES[w.type].storage, 0) + 40;
}

export function storageUsed(train: TrainState): number {
  let used = 0;
  for (const id of Object.keys(train.resources) as ResourceId[]) {
    used += (train.resources[id] ?? 0) * RESOURCES[id].bulk;
  }
  return used;
}

export function bedCount(train: TrainState): number {
  return train.wagons.reduce((s, w) => s + WAGON_TYPES[w.type].beds, 0);
}

export function crewOnBoard(state: GameState): NpcState[] {
  return Object.values(state.npcs).filter((n) => n.status === 'equipage' || n.status === 'passager' || n.status === 'prisonnier');
}

export function freeBeds(state: GameState): number {
  return bedCount(state.train) - crewOnBoard(state).length;
}

/**
 * Ajoute (ou retire si négatif) une ressource en respectant les capacités.
 * Retourne la quantité réellement ajoutée.
 */
export function addResource(state: GameState, id: ResourceId, amount: number): number {
  const train = state.train;
  const cur = train.resources[id] ?? 0;
  if (amount < 0) {
    const taken = Math.min(cur, -amount);
    train.resources[id] = cur - taken;
    return -taken;
  }
  let room = Infinity;
  if (id === 'charbon') room = coalCapacity(train) - cur;
  else if (RESOURCES[id].bulk > 0) room = (storageCapacity(train) - storageUsed(train)) / RESOURCES[id].bulk;
  const added = Math.max(0, Math.min(amount, Math.floor(room + 1e-6)));
  train.resources[id] = cur + added;
  return added;
}

export function hasResources(state: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  for (const [k, v] of Object.entries(cost) as [ResourceId, number][]) {
    if ((state.train.resources[k] ?? 0) < v) return false;
  }
  return true;
}

export function spendResources(state: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  if (!hasResources(state, cost)) return false;
  for (const [k, v] of Object.entries(cost) as [ResourceId, number][]) state.train.resources[k] -= v;
  return true;
}

export function trainLength(train: TrainState): number {
  return train.wagons.reduce((s, w) => s + WAGON_TYPES[w.type].length, 0) + (train.wagons.length - 1) * 1.2;
}

export function wagonMorale(w: WagonState): number {
  let m = 0;
  for (const d of w.decor) if (d) m += DECOR[d].morale;
  if (w.type === 'restaurant') m += 3;
  if (w.type === 'salon') m += 2;
  return m;
}

export function wagonIndex(train: TrainState, uid: string): number {
  return train.wagons.findIndex((w) => w.uid === uid);
}

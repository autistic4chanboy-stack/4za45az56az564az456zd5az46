import { BAL } from '../data/balance';
import { WAGON_TYPES, EQUIPMENT, DECOR, POWER_CHANNELS, WAGON_LIGHT_POWER, WAGON_HEATER_POWER, type PowerChannel } from '../data/train';
import { clamp, clamp01 } from '../core/math';
import type { GameState, TrainState } from '../state/types';
import { coalCapacity } from '../state/trainState';

/**
 * Simulation pure (sans rendu) du train : chaudière, charbon, énergie, températures.
 * Testable en Node (voir tests/).
 */

export interface BoilerContext {
  /** Efficacité du chauffeur (1 = automatique, <1 = économise). */
  coalMult: number;
  /** Bonus de vitesse du chauffeur. */
  heatRelief: number;
  /** Puissance électrique effectivement consommée (pour le surcoût en charbon). */
  powerUsed: number;
  difficultyCoal: number;
  /** Santé de la locomotive (0..1). */
  locoHealth: number;
}

export interface BoilerResult {
  coalUsed: number;
  targetSpeed: number;
  overheated: boolean;
  starved: boolean;
}

export function weightFactor(train: TrainState): number {
  return BAL.weightBase + BAL.weightPerWagon * Math.max(0, train.wagons.length - 1);
}

export function maxSpeedFor(train: TrainState, throttle: number, locoHealth: number): number {
  const lvl = train.upgrades.chaudiere ?? 0;
  const healthF = locoHealth < 0.25 ? 0.55 : locoHealth < 0.5 ? 0.8 : 1;
  return BAL.speeds[throttle] * (1 + 0.06 * lvl) * healthF;
}

/** Charbon consommé par seconde au cran donné (hors énergie). */
export function coalRate(train: TrainState, throttle: number, coalMult: number, difficultyCoal = 1): number {
  const lvl = train.upgrades.chaudiere ?? 0;
  return BAL.coalRates[throttle] * weightFactor(train) * coalMult * (1 - 0.1 * lvl) * difficultyCoal;
}

export function boilerStep(train: TrainState, dt: number, ctx: BoilerContext): BoilerResult {
  const throttle = clamp(Math.round(train.throttle), 0, 4);
  const rate = coalRate(train, throttle, ctx.coalMult, ctx.difficultyCoal) + ctx.powerUsed * BAL.coalPerPower * ctx.coalMult;
  const need = rate * dt;
  const have = train.resources.charbon ?? 0;
  const used = Math.min(have, need);
  train.resources.charbon = have - used;
  const starved = have <= 0.0001;
  // pression : suit le régime demandé si le foyer est alimenté
  const targetP = starved ? 0 : [0.55, 0.7, 0.85, 1.0, 1.12][throttle];
  train.pressure += (targetP - train.pressure) * (1 - Math.exp(-dt / (starved ? 18 : 5)));
  // surchauffe à pleine vapeur
  let overheated = false;
  if (throttle === 4 && !starved) train.heat += (2.6 - ctx.heatRelief) * dt;
  else train.heat -= 4 * dt;
  train.heat = clamp(train.heat, 0, 100);
  if (train.heat >= 100) {
    overheated = true;
    train.heat = 60;
    train.throttle = 2;
  }
  const pressureF = clamp01(train.pressure / Math.max(0.5, targetP || 0.5));
  const targetSpeed = starved ? 0 : maxSpeedFor(train, throttle, ctx.locoHealth) * Math.min(1, pressureF + 0.15);
  return { coalUsed: used, targetSpeed, overheated, starved };
}

// ------------------------------------------------------------------ énergie

export interface PowerContext {
  inCombat: boolean;
  night: boolean;
  /** Température extérieure. */
  extTemp: number;
  /** Bonus d'ingénieur (ex : 0.1 = +10 %). */
  engineerBonus: number;
  locoHealth: number;
  /** Gaz extérieur (ventilation requise). */
  gas: boolean;
}

export interface PowerResult {
  production: number;
  demand: Record<PowerChannel, number>;
  supply: Record<PowerChannel, number>;
  ratio: Record<PowerChannel, number>;
  batteryCapacity: number;
  batteryFlow: number;
  used: number;
  alloc: Record<PowerChannel, number>;
}

export function powerProduction(train: TrainState, ctx: PowerContext): number {
  const loco = WAGON_TYPES.locomotive.power ?? 12;
  const dyn = 1 + 0.2 * (train.upgrades.dynamo ?? 0);
  let p = loco * (0.6 + 0.4 * clamp(train.pressure, 0, 1.1)) * dyn * (0.4 + 0.6 * ctx.locoHealth);
  for (const w of train.wagons) {
    const def = WAGON_TYPES[w.type];
    if (def.features.includes('generator') && w.hp > 0 && w.heater.on) p += (def.power ?? 0) * clamp01(w.hp / def.hp + 0.3);
  }
  return p * (1 + ctx.engineerBonus);
}

export function batteryCapacity(train: TrainState): number {
  return train.wagons.reduce((s, w) => s + (WAGON_TYPES[w.type].battery ?? 0), 0);
}

/**
 * Besoin de chauffage/ventilation (0..1) selon la température extérieure : thermostat.
 * Par temps doux, les radiateurs restent en veille.
 */
export function heatingNeed(ext: number, ventilation = false): number {
  if (ventilation) return 1;
  if (ext < 18) return clamp01((18 - ext) / 12) * 0.85 + 0.15;
  if (ext > 26) return clamp01((ext - 26) / 10) * 0.85 + 0.15;
  return 0.1;
}

export function powerDemand(train: TrainState, ext = 10, ventilation = false): Record<PowerChannel, number> {
  const d: Record<PowerChannel, number> = { lumiere: 0, chauffage: 0, armement: 0, bouclier: 0 };
  const need = heatingNeed(ext, ventilation);
  for (const w of train.wagons) {
    const def = WAGON_TYPES[w.type];
    if (w.hp <= 0) continue;
    if (w.lights.on && w.lights.hp > 0) d.lumiere += WAGON_LIGHT_POWER;
    if (w.heater.on && w.heater.hp > 0 && def.insulation > 0) d.chauffage += WAGON_HEATER_POWER * need;
    if (def.features.includes('greenhouse') && w.lights.on) d.lumiere += 1.5;
    for (const dec of w.decor) if (dec && DECOR[dec].power) d.lumiere += DECOR[dec].power!;
    for (const s of w.slots) {
      if (!s.equip || !s.on || s.hp <= 0) continue;
      const e = EQUIPMENT[s.equip];
      d[e.channel] += e.power;
    }
  }
  return d;
}

/** Répartition automatique selon la situation (mode « Auto »). */
export function autoAllocation(demand: Record<PowerChannel, number>, ctx: PowerContext): Record<PowerChannel, number> {
  const w: Record<PowerChannel, number> = { lumiere: 1, chauffage: 1, armement: 1, bouclier: 1 };
  w.lumiere = ctx.night ? 1.4 : 0.5;
  w.chauffage = ctx.extTemp < 5 || ctx.extTemp > 30 || ctx.gas ? 1.8 : ctx.extTemp < 14 ? 1.1 : 0.4;
  w.armement = ctx.inCombat ? 2 : 0.6;
  w.bouclier = ctx.inCombat ? 2 : 0.3;
  const out = {} as Record<PowerChannel, number>;
  let total = 0;
  for (const c of POWER_CHANNELS) total += w[c] * Math.max(0.2, demand[c]);
  for (const c of POWER_CHANNELS) out[c] = Math.round(((w[c] * Math.max(0.2, demand[c])) / total) * 100);
  return out;
}

export function powerStep(train: TrainState, dt: number, ctx: PowerContext): PowerResult {
  const production = powerProduction(train, ctx);
  const demand = powerDemand(train, ctx.extTemp, ctx.gas);
  const alloc = train.power.auto ? autoAllocation(demand, ctx) : train.power.alloc;
  if (train.power.auto) train.power.alloc = alloc;
  let allocSum = 0;
  for (const c of POWER_CHANNELS) allocSum += Math.max(0, alloc[c]);
  if (allocSum <= 0) allocSum = 1;
  const supply: Record<PowerChannel, number> = { lumiere: 0, chauffage: 0, armement: 0, bouclier: 0 };
  let remaining = production;
  // 1re passe : part garantie
  for (const c of POWER_CHANNELS) {
    const share = (production * Math.max(0, alloc[c])) / allocSum;
    const give = Math.min(demand[c], share);
    supply[c] = give;
    remaining -= give;
  }
  // 2e passe : surplus redistribué aux canaux en déficit
  for (let pass = 0; pass < 2 && remaining > 1e-6; pass++) {
    let wSum = 0;
    for (const c of POWER_CHANNELS) if (demand[c] - supply[c] > 1e-6) wSum += Math.max(1, alloc[c]);
    if (wSum <= 0) break;
    const pool = remaining;
    for (const c of POWER_CHANNELS) {
      const deficit = demand[c] - supply[c];
      if (deficit <= 1e-6) continue;
      const give = Math.min(deficit, (pool * Math.max(1, alloc[c])) / wSum);
      supply[c] += give;
      remaining -= give;
    }
  }
  // batterie
  const cap = batteryCapacity(train);
  let flow = 0;
  if (remaining > 0 && cap > 0) {
    const charge = Math.min(remaining, BAL.batteryChargeRate, (cap - train.power.battery) / Math.max(dt, 1e-3));
    train.power.battery = clamp(train.power.battery + charge * dt, 0, cap);
    flow = charge;
  } else {
    let deficitTotal = 0;
    for (const c of POWER_CHANNELS) deficitTotal += demand[c] - supply[c];
    if (deficitTotal > 1e-6 && train.power.battery > 0) {
      const dis = Math.min(deficitTotal, BAL.batteryDischargeRate, train.power.battery / Math.max(dt, 1e-3));
      for (const c of POWER_CHANNELS) {
        const def = demand[c] - supply[c];
        if (def > 0) supply[c] += (dis * def) / deficitTotal;
      }
      train.power.battery = clamp(train.power.battery - dis * dt, 0, cap);
      flow = -dis;
    }
  }
  const ratio = {} as Record<PowerChannel, number>;
  let used = 0;
  for (const c of POWER_CHANNELS) {
    ratio[c] = demand[c] > 0 ? clamp01(supply[c] / demand[c]) : 1;
    used += supply[c];
  }
  return { production, demand, supply, ratio, batteryCapacity: cap, batteryFlow: flow, used: Math.max(0, used + Math.min(0, flow)), alloc };
}

// ------------------------------------------------------------------ température

export function wagonTargetTemp(insulation: number, heaterOn: boolean, heaterHealth: number, ratio: number, ext: number, stoveHeat: number, isLoco: boolean, heatMult = 1): number {
  let target = ext;
  const h = heaterOn ? ratio * clamp01(heaterHealth / 100) : 0;
  if (ext < 20) {
    target = ext + (BAL.heaterDelta * h * heatMult + stoveHeat) * (0.6 + insulation * 0.5);
    target = Math.min(target, Math.max(ext, 23));
  } else if (ext > 24) {
    // ventilation : rafraîchit vers 21 °C
    target = ext - (ext - 21) * Math.min(1, h * 0.85 * heatMult);
  }
  if (isLoco) target += 14;
  return target;
}

export function temperatureStep(state: GameState, dt: number, ext: number, heatRatio: number): void {
  const heatMult = 1 + 0.15 * (state.train.upgrades.isolation ?? 0);
  for (const w of state.train.wagons) {
    const def = WAGON_TYPES[w.type];
    let stove = 0;
    for (const d of w.decor) if (d && DECOR[d].heat) stove += DECOR[d].heat!;
    const target = def.insulation <= 0 ? ext : wagonTargetTemp(def.insulation, w.heater.on, w.heater.hp, heatRatio, ext, stove, w.type === 'locomotive', heatMult);
    const k = BAL.tempApproach * (def.insulation > 0 ? 1.4 - def.insulation * 0.6 : 3);
    w.temp += (target - w.temp) * (1 - Math.exp(-k * dt));
  }
}

/** Autonomie estimée (mètres) avec le charbon restant au cran donné. */
export function rangeEstimate(state: GameState, throttle: number, coalMult = 1, powerUsed = 8): number {
  const t = Math.max(1, throttle);
  const rate = coalRate(state.train, t, coalMult) + powerUsed * BAL.coalPerPower;
  const seconds = (state.train.resources.charbon ?? 0) / Math.max(1e-4, rate);
  return seconds * BAL.speeds[t];
}

export function coalFillRatio(state: GameState): number {
  return (state.train.resources.charbon ?? 0) / Math.max(1, coalCapacity(state.train));
}

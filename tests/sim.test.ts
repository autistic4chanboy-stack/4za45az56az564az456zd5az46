import { describe, expect, it } from 'vitest';
import { createNewGame } from '../src/state/newGame';
import { boilerStep, coalRate, heatingNeed, maxSpeedFor, powerStep, rangeEstimate, temperatureStep, wagonTargetTemp } from '../src/train/sim';
import { BAL } from '../src/data/balance';
import type { PowerContext } from '../src/train/sim';

const fresh = () => createNewGame({ mode: 'histoire', difficulty: 'normal', seed: 12 });
const boilerCtx = { coalMult: 1, heatRelief: 0, powerUsed: 6, difficultyCoal: 1, locoHealth: 1 };
const powerCtx = (extTemp = 12): PowerContext => ({ inCombat: false, night: false, extTemp, engineerBonus: 0, locoHealth: 1, gas: false });

describe('chaudière', () => {
  it('consomme davantage de charbon aux crans élevés', () => {
    const st = fresh();
    const rates = [0, 1, 2, 3, 4].map((t) => coalRate(st.train, t, 1));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });

  it('amène la vitesse cible au cran demandé quand la pression est établie', () => {
    const st = fresh();
    st.train.throttle = 2;
    let res = boilerStep(st.train, 0.1, boilerCtx);
    for (let i = 0; i < 600; i++) res = boilerStep(st.train, 0.1, boilerCtx);
    expect(res.starved).toBe(false);
    expect(res.targetSpeed).toBeCloseTo(BAL.speeds[2], 0);
  });

  it('s\'arrête faute de charbon', () => {
    const st = fresh();
    st.train.resources.charbon = 0.01;
    st.train.throttle = 3;
    let res = boilerStep(st.train, 1, boilerCtx);
    for (let i = 0; i < 120; i++) res = boilerStep(st.train, 1, boilerCtx);
    expect(res.starved).toBe(true);
    expect(res.targetSpeed).toBe(0);
    expect(st.train.resources.charbon).toBe(0);
  });

  it('surchauffe à pleine vapeur prolongée puis redescend au cran 2', () => {
    const st = fresh();
    st.train.throttle = 4;
    let overheated = false;
    for (let i = 0; i < 800 && !overheated; i++) overheated = boilerStep(st.train, 0.1, boilerCtx).overheated;
    expect(overheated).toBe(true);
    expect(st.train.throttle).toBe(2);
  });

  it('une locomotive très abîmée roule moins vite', () => {
    const st = fresh();
    expect(maxSpeedFor(st.train, 3, 0.2)).toBeLessThan(maxSpeedFor(st.train, 3, 1));
  });

  it('un trajet standard (2 km au cran 2) coûte une part raisonnable du tender', () => {
    const st = fresh();
    const seconds = 2000 / BAL.speeds[2];
    const used = (coalRate(st.train, 2, 1) + 6 * BAL.coalPerPower) * seconds;
    expect(used).toBeGreaterThan(10);
    expect(used).toBeLessThan(45);
    expect(rangeEstimate(st, 2)).toBeGreaterThan(3000);
  });
});

describe('énergie', () => {
  it('ne distribue jamais plus que la production plus la décharge de batterie', () => {
    const st = fresh();
    for (const ext of [-25, 0, 18, 35]) {
      const r = powerStep(st.train, 0.5, powerCtx(ext));
      let supply = 0;
      for (const v of Object.values(r.supply)) supply += v;
      expect(supply).toBeLessThanOrEqual(r.production + Math.max(0, -r.batteryFlow) + 1e-6);
      for (const v of Object.values(r.ratio)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('le thermostat ne chauffe presque pas par temps doux', () => {
    expect(heatingNeed(21)).toBeLessThan(0.2);
    expect(heatingNeed(-20)).toBeGreaterThan(0.9);
    expect(heatingNeed(38)).toBeGreaterThan(0.8);
    expect(heatingNeed(21, true)).toBe(1);
  });

  it('le chauffage rend un wagon vivable par grand froid, surtout amélioré', () => {
    // voiture-lits (isolation 0.55) à -25 °C
    const base = wagonTargetTemp(0.55, true, 100, 1, -25, 0, false);
    const poele = wagonTargetTemp(0.55, true, 100, 1, -25, 10, false);
    const calorifuge = wagonTargetTemp(0.55, true, 100, 1, -25, 0, false, 1.45);
    expect(base).toBeGreaterThan(0);
    expect(poele).toBeGreaterThan(10);
    expect(calorifuge).toBeGreaterThan(12);
    expect(wagonTargetTemp(0.55, false, 100, 1, -25, 0, false)).toBe(-25);
    // ventilation par canicule
    expect(wagonTargetTemp(0.55, true, 100, 1, 38, 0, false)).toBeLessThan(26);
  });

  it('les températures des wagons convergent vers leur cible', () => {
    const st = fresh();
    for (const w of st.train.wagons) w.temp = 30;
    for (let i = 0; i < 400; i++) temperatureStep(st, 1, -15, 1);
    const passagers = st.train.wagons.find((w) => w.type === 'passagers')!;
    expect(passagers.temp).toBeLessThan(30);
    expect(passagers.temp).toBeGreaterThan(-15);
  });
});

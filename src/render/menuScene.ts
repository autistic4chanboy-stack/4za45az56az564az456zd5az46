import * as THREE from 'three';
import * as P from './props';
import { Rng } from '../core/rng';
import { buildWagonModel, buildEquipModel, GAP, FLOOR } from '../train/trainModel';
import { createWagon, newSlot } from '../state/trainState';
import { WAGON_TYPES, type WagonTypeId } from '../data/train';
import { StationBuilder, type LightSpec } from '../world/stationBuilder';
import { disposeObject } from './geo';
import { toonUniforms } from './toon';
import type { Engine } from './engine';

/**
 * Décor du menu principal : L'Espérance à quai à Cendrebourg, au crépuscule d'automne.
 * Construit avec les mêmes outils que les gares du jeu (terrain, bâtiments, végétation).
 */
export class MenuScene {
  readonly root = new THREE.Group();
  private chimney = new THREE.Vector3();
  private chimneys: { x: number; y: number; z: number }[] = [];
  private lights: LightSpec[] = [];
  private t = 0;
  private puffT = 0;
  private houseT = 0;

  constructor(private engine: Engine) {
    const rng = new Rng(1234);
    // ---- train
    const types: WagonTypeId[] = ['locomotive', 'tender', 'passagers', 'restaurant', 'blinde', 'fourgon', 'plateforme'];
    let x = 14;
    const front = x;
    const trainGroup = new THREE.Group();
    types.forEach((t, i) => {
      const w = createWagon(t, `m${i}`);
      if (t === 'blinde') w.slots[0] = newSlot('mitrailleuse');
      if (t === 'plateforme') {
        w.slots[0] = newSlot('canon');
        w.slots[2] = newSlot('tesla');
      }
      if (t === 'locomotive') w.slots[0] = newSlot('projecteur');
      const def = WAGON_TYPES[t];
      const cx = x - def.length / 2;
      const m = buildWagonModel(w, x);
      const grp = new THREE.Group();
      grp.position.x = cx;
      grp.add(m.shell, m.front, m.roof);
      w.slots.forEach((s, si) => {
        if (!s.equip) return;
        const a = m.slotAnchors[si];
        const eq = buildEquipModel(s.equip, 0);
        const holder = new THREE.Group();
        holder.position.set(a.x, a.y, a.z);
        holder.add(eq.base, eq.head);
        eq.head.rotation.y = 0.7 + si;
        grp.add(holder);
      });
      trainGroup.add(grp);
      if (t === 'locomotive') this.chimney.set(x - 1.5, FLOOR + 4.5, 0);
      if (!def.open && t !== 'locomotive' && t !== 'tender') this.lights.push({ x: cx, y: FLOOR + 2.4, z: 0, color: 0xffd08a, intensity: 2.2, distance: 9, night: true });
      x -= def.length + GAP;
    });
    const rear = x;
    this.root.add(trainGroup);

    // ---- la gare, bâtie comme celles du jeu
    const b = new StationBuilder('menu', 4242, 'plaines', 'ete', 1, 1, rear, front);
    b.bounds = { x0: -112, z0: -44, x1: 64, z1: 60 };
    b.ground([0x5c6a30, 0x6c7434, 0x7c7c3a, 0x8a8040, 0x9a8646], 77);
    b.track(-220, 140, 0);
    b.buildPlatform();
    b.building({ x: -16, z: 13, w: 14, d: 7.5, h: 3.8, name: 'Gare de Cendrebourg', wall: 0xc2b090, roof: 0x8a3c2a, roofType: 'pignon', style: 'crepi', doors: [{ side: 'n', offset: 0 }, { side: 's', offset: -3 }] });
    b.building({ x: 8, z: 15, w: 9, d: 7, name: 'Lampisterie', wall: 0x8a5a3e, roofType: 'pignon', style: 'brique', interior: 'maison', doors: [{ side: 'n', offset: 1 }] });
    b.building({ x: -44, z: 20, w: 10, d: 8, name: 'Maison du chef de gare', wall: 0xa89878, roofType: 'pignon', style: 'bois', interior: 'maison', doors: [{ side: 'n', offset: -2 }] });
    b.building({ x: 32, z: 26, w: 18, d: 12, h: 5.5, name: 'Entrepôt', wall: 0x6a5a4a, roofType: 'arche', style: 'tole', doors: [{ side: 'w', offset: 0, width: 3 }] });
    const g = b.g;
    P.coalTower(g, -70, 14.6, -1);
    P.waterTower(g, 26, -12, 2.3, 7.5);
    for (let i = 0; i < 2; i++) P.oldWagon(g, -60 + i * 15, -12, i ? 0x4e5048 : 0x6a3a2a, rng);
    b.track(-100, 40, -12);
    // arbres d'automne, bosquets et rochers
    const trees: [number, number][] = [];
    for (let i = 0; i < 70; i++) {
      const tx = rng.range(-110, 62);
      const tz = rng.chance(0.5) ? rng.range(-42, -18) : rng.range(24, 58);
      if (trees.some(([ax, az]) => Math.hypot(ax - tx, az - tz) < 3.2)) continue;
      if (b.occupied.some((r, k) => k > 0 && tx > r.x0 - 2 && tx < r.x1 + 2 && tz > r.z0 - 2 && tz < r.z1 + 2)) continue;
      trees.push([tx, tz]);
      const k = rng.next();
      const s = 0.8 + rng.next() * 0.6;
      if (k < 0.45) P.oak(g, tx, tz, s, false, rng.chance(0.75));
      else if (k < 0.7) P.birch(g, tx, tz, s, false);
      else if (k < 0.9) P.pine(g, tx, tz, s, false);
      else P.rock(g, tx, tz, 0.6 + rng.next(), 0x6e6a62, rng, false);
      if (rng.chance(0.4)) P.bush(g, tx + rng.range(-2.5, 2.5), tz + rng.range(-2.5, 2.5), 0.6 + rng.next() * 0.5, 0x6a6a2c, rng.chance(0.3) ? 0xc0303a : 0);
    }
    for (let i = 0; i < 6; i++) P.crate(g, -30 + i * 0.9, 5.5 + (i % 2) * 0.8, 0.8, 0x8a6a42, i * 0.3);
    P.barrel(g, -27, 5.9, 0x5a6a5a);
    P.barrel(g, -26.2, 5.4, 0x7a3a2a);
    b.finalize();
    this.root.add(b.root);
    this.lights.push(...b.lights);
    this.chimneys = b.chimneys;
    engine.scene.add(this.root);
  }

  update(dt: number): void {
    this.t += dt;
    const eng = this.engine;
    // travelling lent le long du train (sans rotation : l'image reste calée sur la grille de pixels)
    eng.rig.target.set(-24 + Math.sin(this.t * 0.045) * 12, 1.5, 6);
    eng.rig.yaw = 0.42;
    eng.rig.pitch = 0.66;
    eng.rig.setZoom(34);
    eng.rig.update(dt);
    // heure dorée, mais vitres et lampes déjà allumées
    eng.setEnvironment({ minutes: 19 * 60 + 25, fogColor: 0xc8a888, weather: 'clair', darkness: 0, winter: false }, dt);
    toonUniforms.uNightGlow.value = 1;
    // vapeur de la locomotive, fumées des cheminées
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.35;
      eng.fx.steam(this.chimney.x, this.chimney.y, this.chimney.z, 1.2, false);
    }
    this.houseT -= dt;
    if (this.houseT <= 0) {
      this.houseT = 0.3;
      for (const c of this.chimneys) eng.fx.chimney(c.x, c.y, c.z, -0.6, 0.2);
    }
    // feuilles qui tombent et lucioles
    if (Math.random() < dt * 7) {
      const leaf = [0xd08a2a, 0xb85a22, 0xe0b040, 0x9a4a1e][Math.floor(Math.random() * 4)];
      eng.fx.smoke.spawn({ x: -14 + (Math.random() - 0.5) * 90, y: 9, z: (Math.random() - 0.5) * 50, vx: -0.8 + Math.random() * 0.4, vy: -0.9, vz: 0.3, life: 9, size0: 0.22, color0: leaf, alpha0: 1, alpha1: 1, drag: 0.1 });
    }
    if (Math.random() < dt * 10) {
      eng.fx.glow.spawn({ x: -14 + (Math.random() - 0.5) * 80, y: 0.5 + Math.random() * 2, z: 8 + Math.random() * 30, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.6, life: 2.5 + Math.random() * 2, size0: 0.16, size1: 0.1, color0: 0xd8ff70, alpha0: 0.9, alpha1: 0 });
    }
    for (const l of this.lights) eng.lights.add(l.x, l.y, l.z, l.color, l.intensity, l.distance, 1);
    eng.lights.update(dt, eng.rig.target.x, eng.rig.target.z);
    eng.fx.update(dt, 0);
  }

  dispose(): void {
    this.engine.scene.remove(this.root);
    disposeObject(this.root);
    this.engine.fx.clear();
  }
}

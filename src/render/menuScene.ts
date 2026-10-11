import * as THREE from 'three';
import { GeoBuilder } from './geo';
import * as P from './props';
import { Rng } from '../core/rng';
import { buildWagonModel, buildEquipModel, GAP, FLOOR } from '../train/trainModel';
import { createWagon, newSlot } from '../state/trainState';
import { WAGON_TYPES, type WagonTypeId } from '../data/train';
import type { Engine } from './engine';

/** Décor du menu principal : L'Espérance en gare, de nuit, sous la neige. */
export class MenuScene {
  readonly root = new THREE.Group();
  private chimney = new THREE.Vector3();
  private t = 0;
  private puffT = 0;

  constructor(private engine: Engine) {
    const rng = new Rng(1234);
    const g = new GeoBuilder();
    // sol
    for (let x = -120; x < 80; x += 5) {
      for (let z = -60; z < 60; z += 5) {
        const c = [0xd8dfe4, 0xcdd5db, 0xe2e8ec][Math.floor(rng.next() * 3)];
        g.plane(5, 5, x + 2.5, 0, z + 2.5, c);
      }
    }
    for (let x = -120; x < 80; x += 1.1) g.box(0.35, 0.14, 2.6, x, 0.07, 0, 0x4a3a2c);
    g.box(200, 0.12, 0.1, -20, 0.2, -0.75, 0x6a6a6a);
    g.box(200, 0.12, 0.1, -20, 0.2, 0.75, 0x6a6a6a);
    // quai et lampadaires
    g.box(70, 1, 4.5, -25, 0.5, 4.6, 0x8a8478);
    for (let x = -55; x < 10; x += 16) P.lampPost(g, x, 6.2, true);
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-110, 70);
      const z = rng.sign() * rng.range(10, 55);
      if (rng.chance(0.75)) P.pine(g, x, z, 0.8 + rng.next() * 0.7, true, true);
      else P.rock(g, x, z, 0.6 + rng.next(), 0x6a665e, rng, true);
    }
    this.root.add(g.toGroup());
    // train
    const types: WagonTypeId[] = ['locomotive', 'tender', 'passagers', 'blinde', 'fourgon', 'plateforme'];
    let x = 10;
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
      this.root.add(grp);
      if (t === 'locomotive') this.chimney.set(x - 1.5, FLOOR + 4.5, 0);
      x -= def.length + GAP;
    });
    engine.scene.add(this.root);
  }

  update(dt: number): void {
    this.t += dt;
    const eng = this.engine;
    eng.rig.target.set(-14 + Math.sin(this.t * 0.05) * 10, 1.5, 2);
    eng.rig.yaw = 0.35 + Math.sin(this.t * 0.04) * 0.2;
    eng.rig.pitch = 0.42;
    eng.rig.setZoom(34);
    eng.rig.update(dt);
    eng.setEnvironment({ minutes: 21 * 60 + 30, fogColor: 0x9aa8b8, weather: 'neige', darkness: 0, winter: true }, dt);
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.35;
      eng.fx.steam(this.chimney.x, this.chimney.y, this.chimney.z, 1.5, false);
    }
    if (Math.random() < dt * 30) {
      eng.fx.smoke.spawn({ x: -14 + (Math.random() - 0.5) * 80, y: 18, z: (Math.random() - 0.5) * 50, vx: -1, vy: -2.5, life: 7, size0: 0.25, color0: 0xffffff, alpha0: 0.9, alpha1: 0.9 });
    }
    for (let x = -55; x < 10; x += 16) eng.lights.add(x + 0.75, 4, 6.2, 0xffd8a0, 4, 16, 1);
    eng.lights.add(-10, 2.6, 0, 0xffd08a, 3, 12, 1);
    eng.lights.update(dt, eng.rig.target.x, eng.rig.target.z);
    eng.fx.update(dt, 0);
  }

  dispose(): void {
    this.engine.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.engine.fx.clear();
  }
}

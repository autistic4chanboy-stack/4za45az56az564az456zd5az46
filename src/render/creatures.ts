import * as THREE from 'three';
import { GeoBuilder } from './geo';
import type { EnemyModel } from '../data/enemies';

function mesh(build: (g: GeoBuilder) => void, cast = true): THREE.Group {
  const g = new GeoBuilder();
  build(g);
  const grp = g.toGroup({ castShadow: cast, receiveShadow: false });
  return grp;
}

function pivot(x: number, y: number, z: number, child: THREE.Object3D): THREE.Group {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  p.add(child);
  return p;
}

/** Créatures et véhicules ennemis low-poly animés. */
export class Creature {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Group[] = [];
  private parts: Record<string, THREE.Object3D> = {};
  private phase = Math.random() * 10;
  private attackT = 0;
  private hurtT = 0;
  speed = 0;
  dead = false;
  private deadT = 0;
  /** Pour les fouisseurs : 0 = enfoui, 1 = sorti. */
  emerge = 1;

  constructor(readonly model: EnemyModel, readonly c1: number, readonly c2: number, scale = 1) {
    this.root.add(this.body);
    this.body.scale.setScalar(scale);
    this.build();
  }

  private build(): void {
    const { c1, c2 } = this;
    const eye = 0xff3020;
    switch (this.model) {
      case 'quadruped': {
        this.body.add(mesh((g) => {
          g.box(0.5, 0.42, 1.1, 0, 0.78, 0, c1, { grad: 0.3 });
          g.box(0.42, 0.18, 0.7, 0, 1.02, -0.05, c2);
          g.box(0.1, 0.1, 0.5, 0, 0.9, -0.75, c1, { rx: 0.5 });
          for (let i = 0; i < 4; i++) g.cone(0.06, 0.2, 0, 1.08, 0.3 - i * 0.2, 0xd8d0c0, { rx: -0.3 });
        }));
        const head = mesh((g) => {
          g.box(0.36, 0.32, 0.42, 0, 0, 0.1, c1);
          g.box(0.28, 0.12, 0.36, 0, -0.14, 0.32, 0x3a2a26);
          g.box(0.06, 0.06, 0.02, -0.1, 0.06, 0.32, eye, {});
          g.box(0.06, 0.06, 0.02, 0.1, 0.06, 0.32, eye, {});
          g.layer('glow').box(0.07, 0.05, 0.03, -0.1, 0.06, 0.32, eye).box(0.07, 0.05, 0.03, 0.1, 0.06, 0.32, eye);
          g.layer('base');
          g.cone(0.03, 0.08, -0.08, -0.2, 0.46, 0xeeeeee, { rx: Math.PI });
          g.cone(0.03, 0.08, 0.08, -0.2, 0.46, 0xeeeeee, { rx: Math.PI });
        });
        this.parts.head = pivot(0, 0.95, 0.6, head);
        this.body.add(this.parts.head);
        for (const [x, z] of [[-0.2, 0.4], [0.2, 0.4], [-0.2, -0.4], [0.2, -0.4]]) {
          const leg = pivot(x, 0.7, z, mesh((g) => g.box(0.12, 0.7, 0.14, 0, -0.35, 0, c1)));
          this.legs.push(leg);
          this.body.add(leg);
        }
        break;
      }
      case 'spitter': {
        const bodyM = mesh((g) => {
          g.sphere(0.6, 0, 0.9, 0, c1, { detail: 1, sy: 0.85 });
          g.sphere(0.35, 0, 1.25, 0.35, c1, { detail: 0 });
          g.box(0.3, 0.12, 0.25, 0, 1.12, 0.62, 0x2a1a1a);
          g.layer('glow').sphere(0.3, 0, 0.75, 0.45, c2, { detail: 1 });
        });
        this.parts.sac = bodyM;
        this.body.add(bodyM);
        for (const [x, z] of [[-0.35, 0.3], [0.35, 0.3], [-0.35, -0.3], [0.35, -0.3]]) {
          const leg = pivot(x, 0.6, z, mesh((g) => g.box(0.14, 0.6, 0.14, 0, -0.3, 0, c1)));
          this.legs.push(leg);
          this.body.add(leg);
        }
        break;
      }
      case 'hulk': {
        this.body.add(mesh((g) => {
          g.box(1.5, 1.3, 1.1, 0, 2.2, 0, c1, { grad: 0.3 });
          g.box(1.1, 0.6, 0.9, 0, 1.4, 0, c1);
          for (let i = 0; i < 4; i++) g.box(0.9 - i * 0.12, 0.2, 0.3, 0, 2.95 + i * 0.05, -0.2 - i * 0.15, c2);
          g.box(0.5, 0.45, 0.5, 0, 2.6, 0.65, c1);
          g.layer('glow').box(0.08, 0.06, 0.02, -0.12, 2.68, 0.91, 0xffa020).box(0.08, 0.06, 0.02, 0.12, 2.68, 0.91, 0xffa020);
        }));
        for (const x of [-0.95, 0.95]) {
          const arm = pivot(x, 2.6, 0.1, mesh((g) => {
            g.box(0.5, 1.6, 0.55, 0, -0.8, 0, c1);
            g.box(0.6, 0.4, 0.65, 0, -1.7, 0.05, c2);
          }));
          this.parts[x < 0 ? 'armL' : 'armR'] = arm;
          this.body.add(arm);
        }
        for (const x of [-0.4, 0.4]) {
          const leg = pivot(x, 1.2, -0.1, mesh((g) => g.box(0.45, 1.2, 0.5, 0, -0.6, 0, c1)));
          this.legs.push(leg);
          this.body.add(leg);
        }
        break;
      }
      case 'swarm': {
        for (let i = 0; i < 5; i++) {
          const bat = new THREE.Group();
          bat.add(mesh((g) => {
            g.box(0.16, 0.12, 0.26, 0, 0, 0, c1);
            g.layer('glow').box(0.04, 0.03, 0.02, -0.04, 0.02, 0.13, c2).box(0.04, 0.03, 0.02, 0.04, 0.02, 0.13, c2);
          }, false));
          const wl = pivot(-0.08, 0, 0, mesh((g) => g.box(0.4, 0.02, 0.22, -0.2, 0, 0, 0x1a1a20), false));
          const wr = pivot(0.08, 0, 0, mesh((g) => g.box(0.4, 0.02, 0.22, 0.2, 0, 0, 0x1a1a20), false));
          bat.add(wl, wr);
          bat.userData = { wl, wr, off: i * 1.3, r: 0.3 + (i % 3) * 0.25, h: 1.5 + (i % 2) * 0.5 };
          this.body.add(bat);
          this.legs.push(bat);
        }
        break;
      }
      case 'crawler': {
        this.body.add(mesh((g) => {
          g.sphere(0.45, 0, 0.45, -0.1, c1, { detail: 1, sy: 0.5 });
          g.box(0.4, 0.2, 0.35, 0, 0.42, 0.42, c1);
          g.cone(0.05, 0.22, -0.12, 0.35, 0.65, c2, { rx: Math.PI / 2 });
          g.cone(0.05, 0.22, 0.12, 0.35, 0.65, c2, { rx: Math.PI / 2 });
          g.layer('glow').box(0.05, 0.05, 0.02, -0.1, 0.5, 0.6, c2).box(0.05, 0.05, 0.02, 0.1, 0.5, 0.6, c2);
        }));
        for (let i = 0; i < 6; i++) {
          const side = i < 3 ? -1 : 1;
          const z = 0.25 - (i % 3) * 0.3;
          const leg = pivot(side * 0.35, 0.42, z, mesh((g) => g.box(0.5, 0.06, 0.06, side * 0.22, -0.12, 0, c1, { rz: side * 0.6 })));
          this.legs.push(leg);
          this.body.add(leg);
        }
        break;
      }
      case 'wraith': {
        const cloak = mesh((g) => {
          g.cone(0.55, 1.8, 0, 1.3, 0, c1, { seg: 7 });
          g.sphere(0.28, 0, 2.2, 0.05, c1, { detail: 0 });
          for (let i = 0; i < 5; i++) g.cone(0.07, 0.4, Math.cos(i * 1.25) * 0.3, 2.45, Math.sin(i * 1.25) * 0.3 - 0.05, 0xe8f6ff, { rx: Math.sin(i) * 0.4 });
          g.layer('glow').box(0.07, 0.05, 0.03, -0.09, 2.24, 0.3, c2).box(0.07, 0.05, 0.03, 0.09, 2.24, 0.3, c2);
        });
        this.parts.cloak = cloak;
        this.body.add(cloak);
        for (const x of [-0.45, 0.45]) {
          const arm = pivot(x, 1.9, 0, mesh((g) => g.box(0.12, 0.9, 0.12, 0, -0.45, 0.1, c1, { rx: -0.4 })));
          this.legs.push(arm);
          this.body.add(arm);
        }
        break;
      }
      case 'burrower': {
        for (let i = 0; i < 5; i++) {
          const seg = mesh((g) => {
            g.sphere(0.55 - i * 0.06, 0, 0, 0, i % 2 ? c1 : c2, { detail: 1 });
            if (i === 0) {
              g.cone(0.4, 0.6, 0, 0, 0.55, 0x3a3030, { rx: Math.PI / 2, seg: 6 });
              g.layer('glow').box(0.08, 0.06, 0.03, -0.18, 0.15, 0.45, 0xffd040).box(0.08, 0.06, 0.03, 0.18, 0.15, 0.45, 0xffd040);
            }
          });
          seg.position.set(0, 0.6, -i * 0.7);
          this.body.add(seg);
          this.legs.push(seg);
        }
        break;
      }
      case 'queen': {
        const abd = mesh((g) => {
          g.sphere(1.8, 0, 1.6, -1.8, c1, { detail: 1, sy: 0.75 });
          g.layer('glow');
          for (let i = 0; i < 6; i++) g.sphere(0.32, Math.cos(i) * 1.4, 1.9 + Math.sin(i * 2) * 0.4, -1.8 + Math.sin(i) * 1.2, c2, { detail: 0 });
        });
        this.parts.sac = abd;
        this.body.add(abd);
        this.body.add(mesh((g) => {
          g.sphere(0.9, 0, 1.4, 0.4, c1, { detail: 1 });
          g.box(0.8, 0.5, 0.7, 0, 1.5, 1.3, c1);
          g.cone(0.12, 0.7, -0.3, 1.2, 1.9, c2, { rx: Math.PI / 2 });
          g.cone(0.12, 0.7, 0.3, 1.2, 1.9, c2, { rx: Math.PI / 2 });
          g.layer('glow').box(0.12, 0.08, 0.03, -0.2, 1.65, 1.66, 0xff4020).box(0.12, 0.08, 0.03, 0.2, 1.65, 1.66, 0xff4020);
        }));
        for (let i = 0; i < 8; i++) {
          const side = i < 4 ? -1 : 1;
          const z = 0.9 - (i % 4) * 0.6;
          const leg = pivot(side * 0.8, 1.2, z, mesh((g) => g.box(1.4, 0.16, 0.16, side * 0.7, -0.4, 0, c1, { rz: side * 0.7 })));
          this.legs.push(leg);
          this.body.add(leg);
        }
        break;
      }
      case 'behemoth': {
        this.body.add(mesh((g) => {
          g.box(3.2, 2.6, 5.2, 0, 3.6, 0, c1, { grad: 0.3 });
          g.box(2.6, 1.0, 4.2, 0, 5.1, -0.2, 0xd8e6ee);
          g.box(1.8, 1.6, 1.6, 0, 3.8, 3.2, c1);
          g.cone(0.18, 1.4, -0.7, 3.2, 4.1, 0xf0f0e8, { rx: 1.2 });
          g.cone(0.18, 1.4, 0.7, 3.2, 4.1, 0xf0f0e8, { rx: 1.2 });
          g.layer('glow');
          for (let i = 0; i < 7; i++) g.cone(0.35, 1.6 + (i % 3) * 0.5, (i % 2 ? -0.6 : 0.6), 6.1, 1.8 - i * 0.6, c2, { rx: -0.3 });
          g.box(0.18, 0.12, 0.04, -0.45, 4.1, 4.01, 0x60c0ff).box(0.18, 0.12, 0.04, 0.45, 4.1, 4.01, 0x60c0ff);
        }));
        for (const [x, z] of [[-1.2, 1.8], [1.2, 1.8], [-1.2, -1.8], [1.2, -1.8]]) {
          const leg = pivot(x, 2.6, z, mesh((g) => {
            g.box(1.0, 2.6, 1.1, 0, -1.3, 0, c1);
            g.box(1.2, 0.3, 1.3, 0, -2.5, 0.1, 0x6a7a88);
          }));
          this.legs.push(leg);
          this.body.add(leg);
        }
        break;
      }
      case 'turret': {
        this.body.add(mesh((g) => {
          g.cyl(0.7, 0.9, 0.6, 0, 0.3, 0, 0x3a3e3a, { seg: 8 });
          g.cyl(0.3, 0.3, 0.6, 0, 0.9, 0, 0x4a4e48, { seg: 8 });
        }));
        const head = mesh((g) => {
          g.box(0.9, 0.55, 0.9, 0, 0, 0, c1);
          g.box(0.12, 0.12, 0.9, -0.15, 0, 0.75, 0x1a1a1a);
          g.box(0.12, 0.12, 0.9, 0.15, 0, 0.75, 0x1a1a1a);
          g.layer('glow').box(0.2, 0.1, 0.03, 0, 0.12, 0.46, c2);
        });
        this.parts.head = pivot(0, 1.45, 0, head);
        this.body.add(this.parts.head);
        break;
      }
      case 'moto': {
        this.body.add(mesh((g) => {
          g.cyl(0.38, 0.38, 0.14, 0, 0.38, 0.75, 0x1a1a1a, { rz: Math.PI / 2, seg: 10 });
          g.cyl(0.38, 0.38, 0.16, 0, 0.38, -0.75, 0x1a1a1a, { rz: Math.PI / 2, seg: 10 });
          g.box(0.3, 0.3, 1.2, 0, 0.7, 0, c1);
          g.box(0.25, 0.25, 0.5, 0, 0.9, -0.3, 0x2a2a2a);
          g.box(0.6, 0.06, 0.06, 0, 1.1, 0.55, 0x8a8a8a);
          g.layer('glow').box(0.14, 0.1, 0.04, 0, 0.85, 0.82, 0xffe0a0);
        }));
        const rider = mesh((g) => {
          g.box(0.42, 0.55, 0.3, 0, 1.35, -0.1, c1, { rx: 0.4 });
          g.box(0.28, 0.3, 0.28, 0, 1.75, 0.08, 0xc68e62);
          g.box(0.3, 0.12, 0.3, 0, 1.92, 0.08, c2);
          g.box(0.32, 0.08, 0.06, 0, 1.78, 0.23, 0x1a1a1a);
          g.box(0.14, 0.5, 0.14, -0.25, 1.3, 0.25, c1, { rx: -1.1 });
          g.box(0.14, 0.5, 0.14, 0.25, 1.3, 0.25, c1, { rx: -1.1 });
          g.box(0.16, 0.5, 0.18, -0.18, 0.95, 0.1, 0x2a2a2a, { rx: -1.2 });
          g.box(0.16, 0.5, 0.18, 0.18, 0.95, 0.1, 0x2a2a2a, { rx: -1.2 });
        });
        this.parts.rider = rider;
        this.body.add(rider);
        break;
      }
      case 'buggy': {
        this.body.add(mesh((g) => {
          g.box(2.0, 0.6, 3.4, 0, 0.8, 0, c1, { grad: 0.2 });
          g.box(1.8, 0.4, 1.2, 0, 1.25, 0.9, 0x3a3020);
          for (const x of [-0.9, 0.9]) {
            g.box(0.08, 1.1, 0.08, x, 1.6, -0.6, 0x2a2a2a);
            g.box(0.08, 1.1, 0.08, x, 1.6, 0.4, 0x2a2a2a);
          }
          g.box(1.9, 0.08, 1.1, 0, 2.15, -0.1, 0x2a2a2a);
          for (const [x, z] of [[-1.05, 1.2], [1.05, 1.2], [-1.05, -1.2], [1.05, -1.2]]) g.cyl(0.48, 0.48, 0.36, x, 0.48, z, 0x1a1a1a, { rz: Math.PI / 2, seg: 10 });
          g.box(1.6, 0.14, 0.2, 0, 0.7, 1.75, 0x6a6a6a);
          g.layer('glow').box(0.2, 0.12, 0.04, -0.6, 0.95, 1.71, 0xffe0a0).box(0.2, 0.12, 0.04, 0.6, 0.95, 1.71, 0xffe0a0);
        }));
        const gun = mesh((g) => {
          g.box(0.42, 0.55, 0.3, 0, 0.3, -0.2, c2);
          g.box(0.28, 0.3, 0.28, 0, 0.75, -0.2, 0xc68e62);
          g.box(0.3, 0.1, 0.3, 0, 0.92, -0.2, 0x2a2a2a);
          g.box(0.18, 0.18, 1.1, 0, 0.5, 0.35, 0x1a1a1a);
        });
        this.parts.head = pivot(0, 1.4, -0.5, gun);
        this.body.add(this.parts.head);
        break;
      }
      case 'camion': {
        this.body.add(mesh((g) => {
          g.box(2.6, 1.8, 2.2, 0, 1.7, 2.6, c1);
          g.box(2.7, 0.5, 2.3, 0, 2.85, 2.6, 0x3a3a3a);
          g.box(2.4, 0.5, 0.15, 0, 2.0, 3.71, 0x5a7a8a);
          g.box(2.8, 2.4, 5.2, 0, 2.0, -1.4, c1, { grad: 0.25 });
          for (let i = 0; i < 5; i++) g.box(2.9, 0.12, 0.6, 0, 1.0 + i * 0.45, -1.4 + (i % 2 ? 1 : -1) * 0.8, 0x6a5a4a);
          g.box(2.8, 0.25, 0.2, 0, 0.7, 3.75, 0x8a8a8a);
          for (let i = 0; i < 5; i++) g.cone(0.12, 0.6, -1.0 + i * 0.5, 0.7, 4.1, 0xb0b0b0, { rx: Math.PI / 2 });
          for (const z of [2.6, -0.4, -2.8]) for (const x of [-1.3, 1.3]) g.cyl(0.6, 0.6, 0.45, x, 0.6, z, 0x1a1a1a, { rz: Math.PI / 2, seg: 10 });
          g.box(1.2, 1.2, 0.05, -1.43, 2.2, -1.4, c2, { ry: Math.PI / 2 });
          g.box(1.2, 1.2, 0.05, 1.43, 2.2, -1.4, c2, { ry: Math.PI / 2 });
          g.layer('glow').box(0.3, 0.2, 0.04, -0.9, 1.4, 3.73, 0xffe0a0).box(0.3, 0.2, 0.04, 0.9, 1.4, 3.73, 0xffe0a0);
        }));
        const gun = mesh((g) => {
          g.box(0.6, 0.4, 0.6, 0, 0, 0, 0x3a3a3a);
          g.box(0.16, 0.16, 1.3, 0, 0.05, 0.7, 0x1a1a1a);
        });
        this.parts.head = pivot(0, 3.4, -1.2, gun);
        this.body.add(this.parts.head);
        break;
      }
      case 'humanoid':
        break;
    }
  }

  /** Oriente la tourelle/l'arme montée vers un angle de lacet (relatif au corps). */
  aimLocal(yaw: number): void {
    const head = this.parts.head;
    if (head && (this.model === 'turret' || this.model === 'buggy' || this.model === 'camion')) head.rotation.y = yaw;
  }

  attack(): void {
    this.attackT = 1;
  }

  hurt(): void {
    this.hurtT = 1;
  }

  update(dt: number): void {
    if (this.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 2);
      if (this.model === 'swarm') {
        this.body.position.y = -this.deadT * 1.5;
      } else if (this.model === 'moto' || this.model === 'buggy' || this.model === 'camion' || this.model === 'turret') {
        this.body.rotation.z = this.deadT * 0.3;
      } else {
        this.body.rotation.z = this.deadT * (Math.PI / 2);
        this.body.position.y = this.deadT * 0.2;
      }
      return;
    }
    const sp = this.speed;
    this.phase += dt * (2 + sp * 1.4);
    const a = this.attackT;
    switch (this.model) {
      case 'quadruped':
      case 'spitter':
      case 'hulk':
      case 'behemoth': {
        const amp = Math.min(0.8, 0.15 + sp * 0.06);
        this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.phase + (i % 2 === 0 ? 0 : Math.PI) + (i >= 2 ? Math.PI / 2 : 0)) * amp));
        this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * (sp > 0.5 ? 1 : 0.2);
        if (this.parts.head) this.parts.head.rotation.x = -a * 0.6 + Math.sin(this.phase * 0.5) * 0.05;
        if (this.parts.armL) {
          this.parts.armL.rotation.x = -a * 1.6 + Math.sin(this.phase) * 0.3;
          this.parts.armR.rotation.x = -a * 1.6 - Math.sin(this.phase) * 0.3;
        }
        if (this.parts.sac) this.parts.sac.scale.setScalar(1 + Math.sin(this.phase * 1.5) * 0.04 + a * 0.12);
        break;
      }
      case 'swarm':
        for (const bat of this.legs) {
          const u = bat.userData as { wl: THREE.Object3D; wr: THREE.Object3D; off: number; r: number; h: number };
          const t = this.phase * 1.4 + u.off;
          bat.position.set(Math.cos(t) * u.r, u.h + Math.sin(t * 2.3) * 0.25, Math.sin(t) * u.r);
          bat.rotation.y = -t + Math.PI;
          u.wl.rotation.z = Math.sin(this.phase * 9 + u.off) * 0.8;
          u.wr.rotation.z = -Math.sin(this.phase * 9 + u.off) * 0.8;
        }
        break;
      case 'crawler':
        this.legs.forEach((l, i) => (l.rotation.y = Math.sin(this.phase * 2 + i) * 0.4));
        this.body.position.y = Math.abs(Math.sin(this.phase * 2)) * 0.03;
        break;
      case 'wraith':
        this.body.position.y = 0.3 + Math.sin(this.phase * 0.8) * 0.15;
        this.legs.forEach((l, i) => (l.rotation.x = -a * 1.2 + Math.sin(this.phase + i) * 0.2));
        break;
      case 'burrower':
        this.legs.forEach((l, i) => {
          l.position.y = 0.6 + Math.sin(this.phase * 1.5 - i * 0.8) * 0.25;
          l.position.x = Math.sin(this.phase - i * 0.6) * 0.2;
        });
        this.body.position.y = (this.emerge - 1) * 1.6;
        break;
      case 'queen':
        this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.phase * 0.6 + i) * 0.12));
        if (this.parts.sac) this.parts.sac.scale.setScalar(1 + Math.sin(this.phase * 0.8) * 0.03 + a * 0.08);
        break;
      case 'moto':
        if (this.parts.rider) this.parts.rider.rotation.z = Math.sin(this.phase * 0.5) * 0.05;
        this.body.position.y = Math.abs(Math.sin(this.phase * 3)) * 0.03;
        break;
      case 'buggy':
      case 'camion':
        this.body.position.y = Math.abs(Math.sin(this.phase * 2.5)) * 0.04;
        this.body.rotation.z = Math.sin(this.phase * 1.3) * 0.015;
        break;
      case 'turret':
        break;
    }
    if (this.hurtT > 0) {
      this.body.rotation.x = -this.hurtT * 0.12;
      this.hurtT = Math.max(0, this.hurtT - dt * 5);
    } else if (this.model !== 'buggy' && this.model !== 'camion') {
      this.body.rotation.x = 0;
    }
    this.attackT = Math.max(0, this.attackT - dt * 3);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}


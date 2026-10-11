import * as THREE from 'three';
import { GeoBuilder, Materials } from './geo';
import type { NpcLook } from '../data/npcs';

export type Pose = 'stand' | 'walk' | 'run' | 'aim' | 'sit' | 'lie' | 'dead' | 'work' | 'cower';

function part(build: (g: GeoBuilder) => void, cast = true): THREE.Mesh {
  const g = new GeoBuilder();
  build(g);
  const m = g.toMesh(Materials.vc);
  m.castShadow = cast;
  m.receiveShadow = false;
  return m;
}

/** Modèles d'armes tenues en main (dans le repère du bras droit, canon vers +Z). */
export function weaponMesh(id: string): THREE.Mesh | null {
  const dark = 0x2a2a2e;
  const wood = 0x6b4a2e;
  const metal = 0x8a8f96;
  switch (id) {
    case 'cle':
      return part((g) => {
        g.box(0.06, 0.06, 0.5, 0, 0, 0.2, metal);
        g.box(0.16, 0.06, 0.1, 0, 0, 0.47, metal);
      });
    case 'machette':
      return part((g) => {
        g.box(0.05, 0.05, 0.14, 0, 0, 0, wood);
        g.box(0.03, 0.1, 0.55, 0, 0.02, 0.33, 0xb8bcc0);
      });
    case 'revolver':
      return part((g) => {
        g.box(0.07, 0.13, 0.08, 0, -0.04, 0, wood);
        g.box(0.08, 0.08, 0.3, 0, 0.03, 0.14, dark);
      });
    case 'mitraillette':
      return part((g) => {
        g.box(0.08, 0.1, 0.45, 0, 0.02, 0.15, dark);
        g.box(0.05, 0.16, 0.06, 0, -0.08, 0.14, dark);
        g.box(0.05, 0.05, 0.15, 0, 0.03, 0.42, metal);
      });
    case 'fusil_pompe':
      return part((g) => {
        g.box(0.08, 0.1, 0.35, 0, 0, -0.05, wood);
        g.box(0.07, 0.07, 0.6, 0, 0.04, 0.35, dark);
        g.box(0.08, 0.06, 0.18, 0, -0.03, 0.3, wood);
      });
    case 'fusil_precision':
      return part((g) => {
        g.box(0.07, 0.1, 0.4, 0, 0, -0.08, wood);
        g.box(0.05, 0.05, 0.8, 0, 0.04, 0.45, dark);
        g.box(0.06, 0.06, 0.22, 0, 0.12, 0.15, 0x1a1a1a);
      });
    case 'lance_grenades':
      return part((g) => {
        g.box(0.1, 0.12, 0.3, 0, -0.02, 0, dark);
        g.cyl(0.08, 0.08, 0.45, 0, 0.04, 0.3, 0x4a5a3a, { rx: Math.PI / 2, seg: 8 });
      });
    case 'fusil_tesla':
      return part((g) => {
        g.box(0.09, 0.12, 0.4, 0, 0, 0.05, 0x3a4a5a);
        g.cyl(0.05, 0.05, 0.35, 0, 0.05, 0.4, 0x8fd8ff, { rx: Math.PI / 2, seg: 6 });
        g.sphere(0.08, 0, 0.06, 0.6, 0xbfefff);
      });
    default:
      return null;
  }
}

/** Personnage low-poly animé (joueur, PNJ, bandits). */
export class Humanoid {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private weapon: THREE.Mesh | null = null;
  private weaponId = '';
  private phase = Math.random() * 10;
  private attackAnim = 0;
  private hurtAnim = 0;
  pose: Pose = 'stand';
  /** Vitesse de déplacement courante (m/s) pour l'animation. */
  speed = 0;
  private outline: THREE.Group | null = null;

  constructor(look: NpcLook, opts: { scale?: number; outfit?: number; mask?: boolean; armorColor?: number } = {}) {
    const s = (opts.scale ?? 1) * look.height;
    const b = look.build;
    const skin = look.skin;
    const shirt = opts.outfit ?? look.shirt;
    const pants = look.pants;
    this.root.add(this.body);
    this.body.scale.setScalar(s);

    // jambes (pivot à la hanche)
    for (const [leg, x] of [[this.legL, -0.12], [this.legR, 0.12]] as [THREE.Group, number][]) {
      leg.position.set(x * b, 0.86, 0);
      leg.add(part((g) => {
        g.box(0.19, 0.74, 0.21, 0, -0.37, 0, pants);
        g.box(0.21, 0.12, 0.3, 0, -0.8, 0.04, 0x241c16);
      }));
      this.body.add(leg);
    }
    // torse
    this.torso = part((g) => {
      g.box(0.5 * b, 0.62, 0.3, 0, 1.17, 0, shirt, { grad: 0.25 });
      g.box(0.52 * b, 0.07, 0.32, 0, 0.88, 0, 0x2a2018);
      if (opts.armorColor) g.box(0.54 * b, 0.36, 0.34, 0, 1.24, 0, opts.armorColor);
      if (look.accessory === 1) g.box(0.36, 0.1, 0.34, 0, 1.45, 0, 0xa83a2a); // écharpe
      if (look.accessory === 3) g.box(0.07, 0.3, 0.02, 0, 1.28, 0.16, 0x7a1a1a); // cravate
      if (look.accessory === 4) g.box(0.36, 0.42, 0.18, 0, 1.18, -0.24, 0x5a4a32); // sac à dos
    });
    this.body.add(this.torso);
    // tête
    this.head = part((g) => {
      g.box(0.3, 0.32, 0.3, 0, 1.66, 0, skin);
      g.box(0.05, 0.05, 0.02, -0.07, 1.69, 0.155, 0x1a1410);
      g.box(0.05, 0.05, 0.02, 0.07, 1.69, 0.155, 0x1a1410);
      const hair = look.hair;
      switch (look.hairStyle) {
        case 1: g.box(0.32, 0.1, 0.32, 0, 1.84, -0.01, hair); g.box(0.32, 0.2, 0.06, 0, 1.73, -0.14, hair); break;
        case 2: g.box(0.33, 0.12, 0.33, 0, 1.84, 0, hair); g.box(0.34, 0.36, 0.08, 0, 1.6, -0.15, hair); break;
        case 3: g.box(0.33, 0.1, 0.33, 0, 1.84, 0, hair); g.sphere(0.11, 0, 1.78, -0.2, hair); break;
        case 4: g.box(0.33, 0.12, 0.33, 0, 1.84, 0, hair); g.box(0.08, 0.3, 0.08, -0.16, 1.62, -0.1, hair); g.box(0.08, 0.3, 0.08, 0.16, 1.62, -0.1, hair); break;
        case 5: g.box(0.31, 0.06, 0.31, 0, 1.83, 0, hair); break;
        case 6: g.box(0.32, 0.05, 0.2, 0, 1.83, -0.06, hair); g.box(0.04, 0.12, 0.2, -0.16, 1.72, -0.04, hair); g.box(0.04, 0.12, 0.2, 0.16, 1.72, -0.04, hair); break;
        default: g.box(0.31, 0.07, 0.31, 0, 1.84, -0.01, hair);
      }
      switch (look.hat) {
        case 1: g.box(0.34, 0.1, 0.34, 0, 1.87, 0, 0x3a3a46); g.box(0.3, 0.03, 0.16, 0, 1.83, 0.2, 0x3a3a46); break;
        case 2: g.box(0.34, 0.16, 0.34, 0, 1.88, 0, 0x7a3a2a); break;
        case 3: g.box(0.5, 0.03, 0.5, 0, 1.84, 0, 0x4a3a2a); g.box(0.3, 0.14, 0.3, 0, 1.92, 0, 0x4a3a2a); break;
        case 4: g.sphere(0.21, 0, 1.84, 0, 0x4a5a3a, { sy: 0.7 }); break;
        case 5: g.cyl(0.32, 0.32, 0.03, 0, 1.85, 0, 0xc9b06a, { seg: 10 }); g.cyl(0.15, 0.17, 0.12, 0, 1.92, 0, 0xc9b06a, { seg: 10 }); break;
      }
      if (look.accessory === 2) { g.box(0.32, 0.06, 0.04, 0, 1.7, 0.16, 0x1a1a1a); }
      if (opts.mask) { g.box(0.26, 0.16, 0.08, 0, 1.6, 0.17, 0x2a2e2a); g.cyl(0.06, 0.06, 0.08, 0, 1.56, 0.24, 0x4a4e4a, { rx: Math.PI / 2, seg: 6 }); }
    });
    this.body.add(this.head);
    // bras (pivot à l'épaule)
    for (const [arm, x] of [[this.armL, -0.33], [this.armR, 0.33]] as [THREE.Group, number][]) {
      arm.position.set(x * b, 1.42, 0);
      arm.add(part((g) => {
        g.box(0.15, 0.56, 0.17, 0, -0.27, 0, shirt, { grad: 0.2 });
        g.box(0.13, 0.12, 0.14, 0, -0.6, 0, skin);
      }));
      this.body.add(arm);
    }
  }

  setWeapon(id: string | null): void {
    if ((id ?? '') === this.weaponId) return;
    this.weaponId = id ?? '';
    if (this.weapon) {
      this.armR.remove(this.weapon);
      this.weapon.geometry.dispose();
      this.weapon = null;
    }
    if (!id) return;
    const w = weaponMesh(id);
    if (w) {
      w.position.set(0, -0.62, 0.05);
      this.armR.add(w);
      this.weapon = w;
    }
  }

  attack(): void {
    this.attackAnim = 1;
  }

  hurt(): void {
    this.hurtAnim = 1;
  }

  /**
   * Silhouette visible à travers les murs (joueur) : le corps écrit 1 dans le stencil,
   * la silhouette n'est dessinée que derrière un obstacle ET hors des pixels du corps.
   */
  enableXray(color = 0x7fd4ff): void {
    if (this.outline) return;
    const bodyMat = Materials.vc.clone();
    bodyMat.stencilWrite = true;
    bodyMat.stencilRef = 1;
    bodyMat.stencilFunc = THREE.AlwaysStencilFunc;
    bodyMat.stencilZPass = THREE.ReplaceStencilOp;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false });
    mat.stencilWrite = true;
    mat.stencilRef = 1;
    mat.stencilFunc = THREE.NotEqualStencilFunc;
    mat.stencilFail = THREE.KeepStencilOp;
    mat.stencilZFail = THREE.KeepStencilOp;
    mat.stencilZPass = THREE.KeepStencilOp;
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    for (const o of meshes) {
      o.material = bodyMat;
      const c = new THREE.Mesh(o.geometry, mat);
      c.renderOrder = 50;
      c.castShadow = false;
      c.userData.xray = true;
      o.add(c);
    }
    this.outline = new THREE.Group();
  }

  update(dt: number): void {
    const melee = this.weaponId === 'cle' || this.weaponId === 'machette' || this.weaponId === '';
    let legSwing = 0;
    let armSwing = 0;
    let bodyY = 0;
    let bodyRotX = 0;
    let bodyRotZ = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.torso.scale.set(1, 1, 1);

    switch (this.pose) {
      case 'dead':
        this.body.rotation.x = -Math.PI / 2;
        this.body.position.y = 0.18;
        this.body.position.z = -0.8;
        this.armL.rotation.z = 0.6;
        this.armR.rotation.z = -0.4;
        return;
      case 'lie':
        this.body.rotation.x = -Math.PI / 2;
        this.body.position.y = 0.55;
        this.body.position.z = -0.9;
        this.torso.scale.y = 1 + Math.sin(this.phase * 0.8) * 0.015;
        this.phase += dt;
        return;
      case 'sit':
        this.legL.rotation.x = -Math.PI / 2;
        this.legR.rotation.x = -Math.PI / 2;
        this.body.position.y = -0.42;
        this.armL.rotation.x = -0.5;
        this.armR.rotation.x = -0.5;
        this.phase += dt;
        this.torso.scale.y = 1 + Math.sin(this.phase * 1.6) * 0.01;
        return;
      case 'cower':
        this.phase += dt * 20;
        this.legL.rotation.x = -1.2;
        this.legR.rotation.x = -1.2;
        this.body.position.y = -0.3;
        bodyRotX = 0.4;
        this.armL.rotation.x = -2.4;
        this.armR.rotation.x = -2.4;
        this.body.rotation.z = Math.sin(this.phase) * 0.03;
        this.body.rotation.x = bodyRotX;
        return;
      case 'work':
        this.phase += dt * 6;
        this.armR.rotation.x = -1.2 + Math.sin(this.phase) * 0.6;
        this.armL.rotation.x = -1.0 + Math.sin(this.phase + 1) * 0.4;
        bodyRotX = 0.2;
        this.body.rotation.x = bodyRotX;
        return;
    }

    const moving = this.speed > 0.3;
    if (moving) {
      const rate = this.speed * 2.1;
      this.phase += dt * rate;
      const amp = Math.min(0.75, 0.3 + this.speed * 0.07);
      legSwing = Math.sin(this.phase) * amp;
      armSwing = -Math.sin(this.phase) * amp * 0.8;
      bodyY = Math.abs(Math.cos(this.phase)) * 0.05;
      bodyRotX = Math.min(0.2, this.speed * 0.02);
    } else {
      this.phase += dt * 1.5;
      this.torso.scale.y = 1 + Math.sin(this.phase) * 0.012;
    }
    this.legL.rotation.x = legSwing;
    this.legR.rotation.x = -legSwing;
    this.armL.rotation.x = armSwing;
    this.armR.rotation.x = -armSwing;

    const aiming = this.pose === 'aim' && this.weaponId !== '';
    if (aiming && !melee) {
      this.armR.rotation.x = -Math.PI / 2 + 0.05;
      this.armL.rotation.x = -Math.PI / 2 + 0.25;
      this.armL.rotation.z = -0.45;
      if (this.weaponId === 'revolver') this.armL.rotation.set(armSwing * 0.5, 0, 0);
    }
    if (this.attackAnim > 0) {
      const t = this.attackAnim;
      if (melee) {
        this.armR.rotation.x = -2.2 * Math.sin(t * Math.PI);
        this.armR.rotation.z = -0.6 * t;
        bodyRotZ = 0;
      } else {
        this.armR.rotation.x -= 0.25 * t;
        this.armL.rotation.x -= 0.2 * t;
      }
      this.attackAnim = Math.max(0, this.attackAnim - dt * (melee ? 4.5 : 9));
    }
    if (this.hurtAnim > 0) {
      bodyRotX -= 0.25 * this.hurtAnim;
      this.hurtAnim = Math.max(0, this.hurtAnim - dt * 5);
    }
    this.body.position.y = bodyY;
    this.body.rotation.x = bodyRotX;
    this.body.rotation.z = bodyRotZ;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

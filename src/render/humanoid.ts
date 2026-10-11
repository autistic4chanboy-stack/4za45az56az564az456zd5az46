import * as THREE from 'three';
import { GeoBuilder, Materials } from './geo';
import type { NpcLook } from '../data/npcs';
import type { FaceTraits } from '../data/faces';
import { toonClone } from './toon';

export type Pose = 'stand' | 'walk' | 'run' | 'aim' | 'sit' | 'lie' | 'dead' | 'work' | 'cower';

function part(build: (g: GeoBuilder) => void, cast = true, smooth = false): THREE.Mesh {
  const g = new GeoBuilder();
  build(g);
  const m = g.toMesh(smooth ? Materials.vcSmooth : Materials.vc);
  m.castShadow = cast;
  m.receiveShadow = false;
  return m;
}

/** Pièce du corps : volumes arrondis, ombrage lissé. */
const body = (build: (g: GeoBuilder) => void) => part(build, true, true);

/** Assombrit / éclaircit une couleur. */
function tone(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const D = 2; // finesse des sphères (icosaèdre subdivisé)
const SEG = 12; // segments des cylindres

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

  constructor(look: NpcLook, opts: { scale?: number; outfit?: number; mask?: boolean; armorColor?: number; face?: FaceTraits } = {}) {
    const s = (opts.scale ?? 1) * look.height;
    const b = look.build;
    const skin = look.skin;
    const shirt = opts.outfit ?? look.shirt;
    const pants = look.pants;
    const hair = look.hair;
    const boots = 0x2a2018;
    const face = opts.face;
    this.root.add(this.body);
    this.body.scale.setScalar(s);

    // jambes (pivot à la hanche) : cuisse et mollet fuselés, bottes arrondies
    for (const [leg, x] of [[this.legL, -0.115], [this.legR, 0.115]] as [THREE.Group, number][]) {
      leg.position.set(x * b, 0.86, 0);
      leg.add(body((g) => {
        g.cyl(0.098, 0.082, 0.42, 0, -0.2, 0, pants, { seg: SEG });
        g.sphere(0.083, 0, -0.42, 0.005, pants, { detail: 1 });
        g.cyl(0.082, 0.066, 0.34, 0, -0.58, 0, tone(pants, 0.94), { seg: SEG });
        g.cyl(0.078, 0.082, 0.16, 0, -0.77, 0.01, boots, { seg: SEG });
        g.sphere(0.085, 0, -0.81, 0.07, boots, { detail: D, sy: 0.55, sz: 1.35 });
        g.box(0.17, 0.035, 0.3, 0, -0.85, 0.05, 0x161210);
      }));
      this.body.add(leg);
    }
    // torse : bassin, ventre, poitrine ovale, épaules rondes, cou
    this.torso = body((g) => {
      const w = 0.22 * b;
      g.cyl(w * 0.92, w * 0.95, 0.16, 0, 0.92, 0, pants, { seg: SEG, rx: 0 });
      g.cyl(w * 0.98, w * 0.92, 0.2, 0, 1.08, 0, shirt, { seg: SEG, grad: 0.15 });
      g.cyl(w * 1.12, w * 0.98, 0.3, 0, 1.33, 0, shirt, { seg: SEG, grad: 0.12 });
      g.sphere(w * 1.12, 0, 1.47, 0, shirt, { detail: D, sy: 0.32 });
      for (const sx of [-1, 1]) g.sphere(0.092, sx * w * 1.08, 1.43, 0, shirt, { detail: D });
      // ceinture et boucle
      g.cyl(w * 0.97, w * 0.97, 0.06, 0, 0.98, 0, 0x2a2018, { seg: SEG });
      g.box(0.06, 0.045, 0.02, 0, 0.98, w * 0.97 * 0.66, 0xb09a5a);
      // col de chemise et cou
      g.cyl(0.072, 0.09, 0.07, 0, 1.52, 0, tone(shirt, 0.85), { seg: SEG });
      g.cyl(0.058, 0.064, 0.1, 0, 1.56, 0, skin, { seg: SEG });
      if (opts.armorColor) {
        g.cyl(w * 1.2, w * 1.08, 0.36, 0, 1.28, 0, opts.armorColor, { seg: SEG });
        g.box(0.1, 0.16, 0.04, -0.06, 1.25, w * 0.8, tone(opts.armorColor, 0.8));
        g.box(0.1, 0.16, 0.04, 0.06, 1.25, w * 0.8, tone(opts.armorColor, 0.8));
      }
      if (look.accessory === 1) g.cyl(0.115, 0.12, 0.085, 0, 1.52, 0, 0xa83a2a, { seg: SEG }); // écharpe
      if (look.accessory === 3) { g.box(0.045, 0.24, 0.02, 0, 1.36, w * 0.68, 0x7a1a1a); g.box(0.06, 0.04, 0.025, 0, 1.49, w * 0.62, 0x7a1a1a); } // cravate
      if (look.accessory === 4) { // sac à dos
        g.box(0.3, 0.38, 0.15, 0, 1.2, -0.2, 0x5a4a32);
        g.sphere(0.15, 0, 1.39, -0.2, 0x5a4a32, { detail: 1, sy: 0.4, sz: 0.55 });
        g.box(0.22, 0.12, 0.05, 0, 1.08, -0.29, 0x4a3c28);
      }
    });
    this.body.add(this.torso);
    // tête : crâne ovale, oreilles, nez, yeux, sourcils, bouche
    this.head = body((g) => {
      const hy = 1.67;
      g.sphere(0.152, 0, hy, 0, skin, { detail: D, sy: 1.12, sz: 0.97 });
      g.sphere(0.12, 0, hy - 0.075, 0.03, skin, { detail: D, sx: 0.92, sy: 0.7, sz: 0.95 }); // mâchoire
      for (const sx of [-1, 1]) g.sphere(0.036, sx * 0.148, hy - 0.01, -0.005, tone(skin, 0.93), { detail: 1, sx: 0.55 });
      g.sphere(0.03, 0, hy - 0.03, 0.148, tone(skin, 0.94), { detail: 1, sy: 1.25, sz: 0.9 });
      for (const sx of [-1, 1]) {
        g.sphere(0.027, sx * 0.056, hy + 0.012, 0.128, 0xf2efe8, { detail: 1, sy: 0.85, sz: 0.55 });
        g.sphere(0.017, sx * 0.056, hy + 0.01, 0.141, face ? tone(face.eyes, 0.7) : 0x2a1e16, { detail: 1, sy: 1.1, sz: 0.5 });
        g.box(0.06, 0.014 * (face?.brows ?? 1), 0.02, sx * 0.058, hy + 0.052, 0.134, tone(hair, 0.9), { rz: sx * -0.12 });
      }
      g.box(0.055, 0.011, 0.012, 0, hy - 0.086, 0.137, tone(skin, 0.62));
      // barbe et moustache
      const bc = tone(hair, 0.95);
      switch (face?.beard ?? 0) {
        case 1: g.sphere(0.128, 0, hy - 0.085, 0.034, mixHex(skin, hair, 0.45), { detail: D, sx: 0.94, sy: 0.62, sz: 0.97 }); break;
        case 2: g.sphere(0.04, 0, hy - 0.066, 0.143, bc, { detail: 1, sx: 1.4, sy: 0.38, sz: 0.5 }); break;
        case 3:
          g.sphere(0.13, 0, hy - 0.1, 0.035, bc, { detail: D, sx: 0.98, sy: 0.72, sz: 1.0 });
          g.sphere(0.04, 0, hy - 0.064, 0.145, bc, { detail: 1, sx: 1.45, sy: 0.4, sz: 0.5 });
          break;
        case 4:
          g.sphere(0.042, 0, hy - 0.125, 0.11, bc, { detail: 1, sy: 1.25, sz: 0.7 });
          g.sphere(0.035, 0, hy - 0.064, 0.145, bc, { detail: 1, sx: 1.3, sy: 0.33, sz: 0.5 });
          break;
      }
      // chevelure : calotte décalée vers l'arrière (le visage reste dégagé), puis volumes selon la coupe
      const cap = (r = 0.162, sy = 1.02) => g.sphere(r, 0, hy + 0.035, -0.022, hair, { detail: D, sy, sz: 0.98 });
      switch (look.hairStyle) {
        case 1: // mi-longs
          cap(0.166);
          g.sphere(0.15, 0, hy - 0.04, -0.045, hair, { detail: D, sx: 1.12, sy: 1.0, sz: 0.85 });
          break;
        case 2: // longs
          cap(0.168);
          g.sphere(0.16, 0, hy - 0.11, -0.06, hair, { detail: D, sx: 1.08, sy: 1.5, sz: 0.62 });
          break;
        case 3: // chignon
          cap(0.164);
          g.sphere(0.072, 0, hy + 0.1, -0.15, hair, { detail: D });
          break;
        case 4: // couettes
          cap(0.165);
          for (const sx of [-1, 1]) g.sphere(0.055, sx * 0.17, hy - 0.06, -0.06, hair, { detail: D, sy: 1.6 });
          break;
        case 5: // rasé
          g.sphere(0.155, 0, hy + 0.03, -0.01, mixHex(hair, skin, 0.55), { detail: D, sy: 1.0, sz: 0.97 });
          break;
        case 6: // dégarni : couronne sur les côtés et l'arrière
          g.sphere(0.158, 0, hy - 0.005, -0.04, hair, { detail: D, sx: 1.05, sy: 0.72, sz: 0.94 });
          break;
        default: // courts
          cap(0.161, 0.98);
      }
      // couvre-chefs
      switch (look.hat) {
        case 1: // casquette
          g.sphere(0.17, 0, hy + 0.07, -0.01, 0x3a3a46, { detail: D, sy: 0.62 });
          g.cyl(0.11, 0.11, 0.018, 0, hy + 0.06, 0.15, 0x30303a, { seg: SEG, rx: 0.12 });
          break;
        case 2: // bonnet
          g.sphere(0.172, 0, hy + 0.06, -0.01, 0x7a3a2a, { detail: D, sy: 0.82 });
          g.cyl(0.17, 0.172, 0.05, 0, hy + 0.035, -0.01, tone(0x7a3a2a, 0.85), { seg: SEG });
          g.sphere(0.04, 0, hy + 0.205, -0.01, 0xd8cfc0, { detail: 1 });
          break;
        case 3: // chapeau à larges bords
          g.cyl(0.29, 0.3, 0.022, 0, hy + 0.08, -0.01, 0x4a3a2a, { seg: 16 });
          g.cyl(0.13, 0.15, 0.13, 0, hy + 0.15, -0.01, 0x4a3a2a, { seg: 16 });
          g.cyl(0.152, 0.152, 0.03, 0, hy + 0.1, -0.01, 0x2a1e14, { seg: 16 });
          break;
        case 4: // casque
          g.sphere(0.19, 0, hy + 0.05, -0.01, 0x4a5a3a, { detail: D, sy: 0.72 });
          g.cyl(0.195, 0.2, 0.025, 0, hy + 0.01, -0.01, tone(0x4a5a3a, 0.82), { seg: 16 });
          break;
        case 5: // chapeau de paille
          g.cyl(0.3, 0.31, 0.02, 0, hy + 0.08, -0.01, 0xc9b06a, { seg: 16 });
          g.cyl(0.14, 0.16, 0.12, 0, hy + 0.145, -0.01, 0xc9b06a, { seg: 16 });
          g.cyl(0.162, 0.162, 0.028, 0, hy + 0.1, -0.01, 0x8a3a2a, { seg: 16 });
          break;
      }
      if (look.accessory === 2) { // lunettes
        for (const sx of [-1, 1]) g.cyl(0.03, 0.03, 0.008, sx * 0.056, hy + 0.012, 0.15, 0x1a1a1a, { seg: 10, rx: Math.PI / 2 });
        g.box(0.04, 0.008, 0.008, 0, hy + 0.018, 0.152, 0x1a1a1a);
      }
      if (opts.mask) {
        g.sphere(0.1, 0, hy - 0.06, 0.1, 0x2a2e2a, { detail: D, sy: 0.85, sz: 0.75 });
        g.cyl(0.05, 0.055, 0.07, 0, hy - 0.085, 0.19, 0x4a4e4a, { rx: Math.PI / 2, seg: SEG });
        for (const sx of [-1, 1]) g.cyl(0.032, 0.032, 0.01, sx * 0.056, hy + 0.012, 0.147, 0x9ab0a0, { seg: 10, rx: Math.PI / 2 });
      }
    });
    this.body.add(this.head);
    // bras (pivot à l'épaule) : manche fuselée, main ronde
    for (const [arm, x] of [[this.armL, -0.3], [this.armR, 0.3]] as [THREE.Group, number][]) {
      arm.position.set(x * b, 1.42, 0);
      arm.add(body((g) => {
        g.cyl(0.07, 0.062, 0.3, 0, -0.14, 0, shirt, { seg: SEG, grad: 0.15 });
        g.sphere(0.062, 0, -0.3, 0, shirt, { detail: 1 });
        g.cyl(0.062, 0.05, 0.26, 0, -0.43, 0, tone(shirt, 0.95), { seg: SEG });
        g.cyl(0.054, 0.054, 0.04, 0, -0.55, 0, tone(shirt, 0.8), { seg: SEG });
        g.sphere(0.058, 0, -0.61, 0.005, skin, { detail: D, sx: 0.85, sy: 1.1 });
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
    const bodyMat = toonClone(Materials.vcSmooth, { snow: false });
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

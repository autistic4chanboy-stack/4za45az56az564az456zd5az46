import * as THREE from 'three';
import { Materials } from './geo';

/**
 * Pièces mobiles d'une gare (tiroirs, portes de meubles, couvercles, portes de bâtiments…)
 * rassemblées dans un seul InstancedMesh de boîtes : des milliers de pièces animables
 * pour une seule draw call. Chaque pièce garde sa matrice « fermée » et un mouvement :
 * glissière (tiroir), charnière (porte, couvercle) ou disparition (barricade arrachée).
 */
export type PartMotion =
  | { kind: 'fixe' }
  | { kind: 'glisse'; dx: number; dy: number; dz: number }
  | { kind: 'pivot'; px: number; py: number; pz: number; ax: number; ay: number; az: number; angle: number }
  | { kind: 'efface' };

interface PartDef {
  closed: THREE.Matrix4;
  color: THREE.Color;
  pat: number;
  motion: PartMotion;
  t: number;
  target: number;
}

export interface PartBoxOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  pat?: number;
  motion?: PartMotion;
}

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class PartSet {
  private defs: PartDef[] = [];
  mesh: THREE.InstancedMesh | null = null;
  private moving = new Set<number>();
  private patAttr: THREE.InstancedBufferAttribute | null = null;

  get count(): number {
    return this.defs.length;
  }

  /** Ajoute une boîte (centre x,y,z ; dimensions w,h,d) et renvoie son indice. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opts: PartBoxOpts = {}): number {
    tmpE.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpP.set(x, y, z);
    tmpS.set(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3));
    const closed = new THREE.Matrix4().compose(tmpP, tmpQ, tmpS);
    this.defs.push({ closed, color: new THREE.Color(color), pat: opts.pat ?? 0, motion: opts.motion ?? { kind: 'fixe' }, t: 0, target: 0 });
    return this.defs.length - 1;
  }

  private matrixAt(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    const d = this.defs[i];
    const m = d.motion;
    const t = d.t;
    if (t <= 0 || m.kind === 'fixe') return out.copy(d.closed);
    switch (m.kind) {
      case 'glisse':
        return out.makeTranslation(m.dx * t, m.dy * t, m.dz * t).multiply(d.closed);
      case 'pivot':
        tmpAxis.set(m.ax, m.ay, m.az).normalize();
        out.makeTranslation(m.px, m.py, m.pz);
        out.multiply(tmpM2.makeRotationAxis(tmpAxis, m.angle * t));
        out.multiply(tmpM2.makeTranslation(-m.px, -m.py, -m.pz));
        return out.multiply(d.closed);
      case 'efface':
        return t >= 0.5 ? out.copy(zero) : out.copy(d.closed);
    }
  }

  /** Crée l'InstancedMesh (une fois toutes les pièces ajoutées). */
  build(): THREE.InstancedMesh | null {
    const n = this.defs.length;
    if (!n) return null;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const pats = new Float32Array(n);
    this.defs.forEach((d, i) => (pats[i] = d.pat));
    this.patAttr = new THREE.InstancedBufferAttribute(pats, 1);
    geo.setAttribute('aPat', this.patAttr);
    const mesh = new THREE.InstancedMesh(geo, Materials.parts, n);
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, this.matrixAt(i, tmpM));
      mesh.setColorAt(i, this.defs[i].color);
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'pieces';
    mesh.computeBoundingSphere();
    this.mesh = mesh;
    return mesh;
  }

  /** Ouvre (1) ou ferme (0) une pièce ; instant : sans animation. */
  set(i: number, open: number, instant = false): void {
    const d = this.defs[i];
    if (!d) return;
    d.target = open;
    if (instant) {
      d.t = open;
      this.write(i);
    } else if (d.t !== open) this.moving.add(i);
  }

  isOpen(i: number): boolean {
    return (this.defs[i]?.target ?? 0) > 0.5;
  }

  colorOf(i: number): number {
    return this.defs[i]?.color.getHex() ?? 0;
  }

  /** Change la couleur d'une pièce (écrans, voyants). */
  setColor(i: number, color: THREE.ColorRepresentation): void {
    const d = this.defs[i];
    if (!d || !this.mesh) return;
    d.color.set(color);
    this.mesh.setColorAt(i, d.color);
    const c = this.mesh.instanceColor!;
    c.addUpdateRange(i * 3, 3);
    c.needsUpdate = true;
  }

  private write(i: number): void {
    if (!this.mesh) return;
    this.mesh.setMatrixAt(i, this.matrixAt(i, tmpM));
    this.mesh.instanceMatrix.addUpdateRange(i * 16, 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.moving.size) return;
    for (const i of this.moving) {
      const d = this.defs[i];
      const step = dt * 4.5;
      d.t = d.target > d.t ? Math.min(d.target, d.t + step) : Math.max(d.target, d.t - step);
      // départ franc, arrivée amortie
      this.write(i);
      if (d.t === d.target) this.moving.delete(i);
    }
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
    this.mesh?.dispose();
    this.mesh = null;
  }
}

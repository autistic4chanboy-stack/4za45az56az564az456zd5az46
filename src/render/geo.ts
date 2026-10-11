import * as THREE from 'three';

/**
 * GeoBuilder : construit une géométrie low-poly fusionnée avec couleurs de sommets.
 * Une seule draw call par calque (base / glow…) quel que soit le nombre de pièces.
 */

export type ColorLike = number | string | THREE.Color;

interface BaseGeo {
  pos: Float32Array;
  nor: Float32Array;
}

const baseCache = new Map<string, BaseGeo>();

function toBase(geo: THREE.BufferGeometry): BaseGeo {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const base = {
    pos: (g.getAttribute('position').array as Float32Array).slice(),
    nor: (g.getAttribute('normal').array as Float32Array).slice(),
  };
  geo.dispose();
  if (g !== geo) g.dispose();
  return base;
}

function getBase(key: string, make: () => THREE.BufferGeometry): BaseGeo {
  let b = baseCache.get(key);
  if (!b) {
    b = toBase(make());
    baseCache.set(key, b);
  }
  return b;
}

const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const tmpNormalMat = new THREE.Matrix3();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpV = new THREE.Vector3();

export interface PartOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  /** Variation aléatoire de luminosité (0..1). */
  vary?: number;
  /** Assombrit le bas de la pièce (0..1) pour un léger dégradé vertical. */
  grad?: number;
  seg?: number;
}

class GrowArray {
  data: Float32Array;
  length = 0;
  constructor(initial = 4096) {
    this.data = new Float32Array(initial);
  }
  ensure(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let n = this.data.length * 2;
    while (n < this.length + extra) n *= 2;
    const d = new Float32Array(n);
    d.set(this.data.subarray(0, this.length));
    this.data = d;
  }
  view(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

class Layer {
  pos = new GrowArray();
  nor = new GrowArray();
  col = new GrowArray();
}

export function toColor(c: ColorLike, out = tmpColor): THREE.Color {
  if (c instanceof THREE.Color) return out.copy(c);
  return out.set(c as THREE.ColorRepresentation);
}

export class GeoBuilder {
  private layers = new Map<string, Layer>();
  private current = 'base';
  /** Transformation parente optionnelle appliquée à toutes les pièces. */
  parent: THREE.Matrix4 | null = null;
  private rngState = 1;

  layer(name: string): this {
    this.current = name;
    return this;
  }

  private getLayer(): Layer {
    let l = this.layers.get(this.current);
    if (!l) {
      l = new Layer();
      this.layers.set(this.current, l);
    }
    return l;
  }

  private rand(): number {
    // petit LCG local : les variations restent stables d'un build à l'autre
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  get isEmpty(): boolean {
    for (const l of this.layers.values()) if (l.pos.length > 0) return false;
    return true;
  }

  /** Ajoute une géométrie de base transformée. */
  private push(base: BaseGeo, matrix: THREE.Matrix4, color: ColorLike, opts?: PartOpts, height = 1): void {
    const layer = this.getLayer();
    const m = this.parent ? tmpMat.multiplyMatrices(this.parent, matrix) : matrix;
    tmpNormalMat.getNormalMatrix(m);
    const n = base.pos.length;
    layer.pos.ensure(n);
    layer.nor.ensure(n);
    layer.col.ensure(n);
    const c = toColor(color);
    let r = c.r;
    let g = c.g;
    let b = c.b;
    if (opts?.vary) {
      const f = 1 + (this.rand() * 2 - 1) * opts.vary;
      r *= f;
      g *= f;
      b *= f;
    }
    const grad = opts?.grad ?? 0;
    const P = layer.pos.data;
    const N = layer.nor.data;
    const C = layer.col.data;
    let o = layer.pos.length;
    for (let i = 0; i < n; i += 3) {
      tmpV.set(base.pos[i], base.pos[i + 1], base.pos[i + 2]);
      const localY = base.pos[i + 1];
      tmpV.applyMatrix4(m);
      P[o] = tmpV.x;
      P[o + 1] = tmpV.y;
      P[o + 2] = tmpV.z;
      tmpV.set(base.nor[i], base.nor[i + 1], base.nor[i + 2]).applyMatrix3(tmpNormalMat).normalize();
      N[o] = tmpV.x;
      N[o + 1] = tmpV.y;
      N[o + 2] = tmpV.z;
      const shade = grad > 0 ? 1 - grad * (0.5 - localY / height) : 1;
      C[o] = r * shade;
      C[o + 1] = g * shade;
      C[o + 2] = b * shade;
      o += 3;
    }
    layer.pos.length = o;
    layer.nor.length = o;
    layer.col.length = o;
  }

  private matrix(x: number, y: number, z: number, sx: number, sy: number, sz: number, opts?: PartOpts): THREE.Matrix4 {
    tmpEuler.set(opts?.rx ?? 0, opts?.ry ?? 0, opts?.rz ?? 0, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(x, y, z);
    tmpScale.set(sx, sy, sz);
    return new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale);
  }

  /** Boîte centrée en (x, y, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts): this {
    const base = getBase('box', () => new THREE.BoxGeometry(1, 1, 1));
    this.push(base, this.matrix(x, y, z, w, h, d, opts), color, opts, 1);
    return this;
  }

  /** Boîte posée au sol : y = base de la boîte. */
  boxOn(w: number, h: number, d: number, x: number, yBase: number, z: number, color: ColorLike, opts?: PartOpts): this {
    return this.box(w, h, d, x, yBase + h / 2, z, color, opts);
  }

  /** Cylindre/cône tronqué centré en (x,y,z), axe Y. */
  cyl(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts): this {
    const seg = opts?.seg ?? 8;
    const m = Math.max(rTop, rBottom, 1e-4);
    const rt = Math.round((rTop / m) * 100) / 100;
    const rb = Math.round((rBottom / m) * 100) / 100;
    const base = getBase(`cyl:${seg}:${rt}:${rb}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg, 1));
    this.push(base, this.matrix(x, y, z, m, h, m, opts), color, opts, 1);
    return this;
  }

  cone(r: number, h: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts): this {
    return this.cyl(0, r, h, x, y, z, color, opts);
  }

  sphere(r: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts & { detail?: number; sy?: number }): this {
    const detail = opts?.detail ?? 0;
    const base = getBase(`ico:${detail}`, () => new THREE.IcosahedronGeometry(1, detail));
    this.push(base, this.matrix(x, y, z, r, r * (opts?.sy ?? 1), r, opts), color, opts, 2);
    return this;
  }

  dodeca(r: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts & { sy?: number }): this {
    const base = getBase('dodeca', () => new THREE.DodecahedronGeometry(1, 0));
    this.push(base, this.matrix(x, y, z, r, r * (opts?.sy ?? 1), r, opts), color, opts, 2);
    return this;
  }

  /** Plan horizontal (face vers le haut). */
  plane(w: number, d: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts): this {
    const base = getBase('plane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.push(base, this.matrix(x, y, z, w, 1, d, opts), color, opts, 1);
    return this;
  }

  /** Ajoute une géométrie arbitraire (copiée). */
  geometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: ColorLike, opts?: PartOpts): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.computeVertexNormals();
    const base: BaseGeo = {
      pos: g.getAttribute('position').array as Float32Array,
      nor: g.getAttribute('normal').array as Float32Array,
    };
    this.push(base, matrix, color, opts, 1);
    g.dispose();
    return this;
  }

  /** Construit les géométries par calque. */
  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [name, l] of this.layers) {
      if (l.pos.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(l.pos.view(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(l.nor.view(), 3));
      g.setAttribute('color', new THREE.BufferAttribute(l.col.view(), 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(name, g);
    }
    return out;
  }

  /** Construit un groupe de meshes (un par calque) avec les matériaux partagés. */
  toGroup(opts: { castShadow?: boolean; receiveShadow?: boolean; materials?: Partial<Record<string, THREE.Material>> } = {}): THREE.Group {
    const group = new THREE.Group();
    for (const [name, geo] of this.build()) {
      const mat = opts.materials?.[name] ?? Materials.forLayer(name);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = opts.castShadow ?? name === 'base';
      mesh.receiveShadow = opts.receiveShadow ?? name === 'base';
      mesh.name = name;
      group.add(mesh);
    }
    return group;
  }

  /** Mesh unique (calque 'base' uniquement). */
  toMesh(material?: THREE.Material): THREE.Mesh {
    const geo = this.build().get('base') ?? new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, material ?? Materials.vc);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Matériaux partagés. */
export const Materials = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  /** Version transparente pour les murs en coupe (bâtiments/wagons). */
  vcFaded: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.18, depthWrite: false }),
  /** Éléments lumineux (fenêtres éclairées, lampes, néons) : non affectés par l'éclairage. */
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  /** Verre / eau semi-transparents. */
  glass: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }),
  /** Effets additifs (lueurs radioactives…). */
  additive: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  forLayer(name: string): THREE.Material {
    switch (name) {
      case 'glow':
        return Materials.glow;
      case 'glass':
        return Materials.glass;
      case 'additive':
        return Materials.additive;
      default:
        return Materials.vc;
    }
  },
};

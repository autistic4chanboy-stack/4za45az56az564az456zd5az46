import * as THREE from 'three';
import { toonify, windowify, PAT } from './toon';

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

/** Prisme triangulaire unitaire : base y∈[0,1], faîte le long de X, sommet en z = apex (-0.5..0.5). */
function prismGeometry(apex: number): THREE.BufferGeometry {
  const A = [-0.5, 0, -0.5];
  const B = [-0.5, 0, 0.5];
  const C = [-0.5, 1, apex];
  const D = [0.5, 0, -0.5];
  const E = [0.5, 0, 0.5];
  const F = [0.5, 1, apex];
  const tris = [[A, B, C], [D, F, E], [B, E, F], [B, F, C], [A, C, F], [A, F, D], [A, D, E], [A, E, B]];
  const center = new THREE.Vector3(0, 1 / 3, apex / 3);
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const pos: number[] = [];
  for (const [a, b, c] of tris) {
    va.fromArray(a);
    vb.fromArray(b);
    vc.fromArray(c);
    const n = vb.clone().sub(va).cross(vc.clone().sub(va));
    const cen = va.clone().add(vb).add(vc).divideScalar(3).sub(center);
    if (n.lengthSq() < 1e-10) continue;
    if (n.dot(cen) < 0) pos.push(...a, ...c, ...b);
    else pos.push(...a, ...b, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
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
  /** Motif procédural dessiné par le shader (voir PAT dans toon.ts). */
  pat?: number;
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
  pat = new GrowArray(1024);
  hasPat = false;
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
  /**
   * Fusionne les calques 'glow' et 'window' dans 'base' : le shader toon les rend
   * lumineux grâce à leur motif (PAT.lumiere / PAT.vitre). Une draw call par groupe au lieu de trois.
   */
  mergeLights = false;
  /** Découpage spatial (m) des géométries produites, pour que les zones hors champ soient ignorées (0 = aucun). */
  chunk = 0;

  constructor(opts: { mergeLights?: boolean; chunk?: number } = {}) {
    this.mergeLights = opts.mergeLights ?? false;
    this.chunk = opts.chunk ?? 0;
  }

  layer(name: string): this {
    this.current = name;
    return this;
  }

  private getLayer(name = this.current): Layer {
    let l = this.layers.get(name);
    if (!l) {
      l = new Layer();
      this.layers.set(name, l);
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
    let layerName = this.current;
    let pat = opts?.pat ?? 0;
    if (this.mergeLights && (layerName === 'glow' || layerName === 'window')) {
      pat = layerName === 'glow' ? PAT.lumiere : PAT.vitre;
      layerName = 'base';
    }
    const layer = this.getLayer(layerName);
    const m = this.parent ? tmpMat.multiplyMatrices(this.parent, matrix) : matrix;
    tmpNormalMat.getNormalMatrix(m);
    const n = base.pos.length;
    layer.pos.ensure(n);
    layer.nor.ensure(n);
    layer.col.ensure(n);
    layer.pat.ensure(n / 3);
    if (pat) layer.hasPat = true;
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
    const PT = layer.pat.data;
    let o = layer.pos.length;
    let po = layer.pat.length;
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
      PT[po++] = pat;
      o += 3;
    }
    layer.pos.length = o;
    layer.nor.length = o;
    layer.col.length = o;
    layer.pat.length = po;
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

  /**
   * Prisme triangulaire posé en yBase : faîte le long de X (longueur w), portée d le long de Z,
   * hauteur h. apex place le faîte en z relatif (0 = pignon symétrique, 0.5 = shed à face verticale côté +z).
   */
  prism(w: number, h: number, d: number, x: number, yBase: number, z: number, color: ColorLike, opts?: PartOpts & { apex?: number }): this {
    const apex = Math.round((opts?.apex ?? 0) * 100) / 100;
    const base = getBase(`prism:${apex}`, () => prismGeometry(apex));
    this.push(base, this.matrix(x, yBase, z, w, h, d, opts), color, opts, 1);
    return this;
  }

  /** Demi-cylindre (voûte) posé en y, axe le long de X : longueur len, flèche rise, demi-portée halfD. */
  vault(len: number, rise: number, halfD: number, x: number, y: number, z: number, color: ColorLike, opts?: PartOpts): this {
    const seg = opts?.seg ?? 10;
    const base = getBase(`vault:${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false, Math.PI, Math.PI));
    // l'axe Y du cylindre devient X ; le rayon x (négatif sur la demi-voûte) devient la hauteur
    const m = this.matrix(x, y, z, rise, len, halfD, { ...opts, rz: -Math.PI / 2 });
    this.push(base, m, color, { ...opts, grad: 0 }, 1);
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

  /** Construit les géométries par calque (et par cellule si le découpage spatial est actif). */
  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    const make = (pos: Float32Array, nor: Float32Array, col: Float32Array, pat: Float32Array | null) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (pat) g.setAttribute('aPat', new THREE.BufferAttribute(pat, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    };
    for (const [name, l] of this.layers) {
      if (l.pos.length === 0) continue;
      if (this.chunk <= 0) {
        out.set(name, make(l.pos.view(), l.nor.view(), l.col.view(), l.hasPat ? l.pat.view() : null));
        continue;
      }
      // répartition des triangles par cellule selon leur centre (les triangles restent entiers) ;
      // clé numérique et cellule précédente en cache : les triangles d'une même boîte se suivent
      const cells = new Map<number, Layer>();
      const P = l.pos.data;
      const N = l.nor.data;
      const C = l.col.data;
      const T = l.pat.data;
      const tris = l.pos.length / 9;
      const inv = 1 / this.chunk;
      let lastKey = -1;
      let c: Layer | undefined;
      for (let t = 0; t < tris; t++) {
        const o = t * 9;
        const kx = Math.floor(((P[o] + P[o + 3] + P[o + 6]) / 3) * inv);
        const kz = Math.floor(((P[o + 2] + P[o + 5] + P[o + 8]) / 3) * inv);
        const key = (kx + 512) * 1024 + (kz + 512);
        if (key !== lastKey || !c) {
          c = cells.get(key);
          if (!c) {
            c = new Layer();
            cells.set(key, c);
          }
          lastKey = key;
        }
        c.pos.ensure(9);
        c.nor.ensure(9);
        c.col.ensure(9);
        c.pat.ensure(3);
        const cp = c.pos.data;
        const cn = c.nor.data;
        const cc = c.col.data;
        const pl = c.pos.length;
        for (let q = 0; q < 9; q++) {
          cp[pl + q] = P[o + q];
          cn[pl + q] = N[o + q];
          cc[pl + q] = C[o + q];
        }
        const ct = c.pat.data;
        const tl = c.pat.length;
        ct[tl] = T[t * 3];
        ct[tl + 1] = T[t * 3 + 1];
        ct[tl + 2] = T[t * 3 + 2];
        c.pos.length += 9;
        c.nor.length += 9;
        c.col.length += 9;
        c.pat.length += 3;
      }
      for (const [key, cl] of cells) {
        const kx = Math.floor(key / 1024) - 512;
        const kz = (key % 1024) - 512;
        out.set(`${name}|${kx},${kz}`, make(cl.pos.view(), cl.nor.view(), cl.col.view(), l.hasPat ? cl.pat.view() : null));
      }
    }
    return out;
  }

  /** Construit un groupe de meshes (un par calque) avec les matériaux partagés. */
  toGroup(opts: { castShadow?: boolean; receiveShadow?: boolean; materials?: Partial<Record<string, THREE.Material>> } = {}): THREE.Group {
    const group = new THREE.Group();
    for (const [key, geo] of this.build()) {
      const name = key.split('|')[0];
      const mat = opts.materials?.[name] ?? (geo.getAttribute('aPat') && name === 'base' ? Materials.vcPat : Materials.forLayer(name));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = opts.castShadow ?? (name === 'base' || name === 'foliage');
      mesh.receiveShadow = opts.receiveShadow ?? (name === 'base' || name === 'foliage' || name === 'ground' || name === 'water');
      mesh.name = name;
      group.add(mesh);
    }
    return group;
  }

  /** Mesh unique (calque 'base' uniquement). */
  toMesh(material?: THREE.Material): THREE.Mesh {
    const geo = this.build().get('base') ?? new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, material ?? (geo.getAttribute('aPat') ? Materials.vcPat : Materials.vc));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Matériaux partagés (ombrage toon, voir toon.ts). */
export const Materials = {
  vc: toonify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
  /** Variante à motifs procéduraux (planches, briques, tuiles…) pour les géométries portant aPat. */
  vcPat: toonify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { pattern: true }),
  /** Pièces mobiles instanciées (couleur par instance, motifs et surfaces lumineuses). */
  parts: toonify(new THREE.MeshLambertMaterial({ flatShading: true }), { pattern: true }),
  /** Vitres : reflets de jour, lueur la nuit (calque 'window'). */
  window: windowify(new THREE.MeshBasicMaterial({ vertexColors: true })),
  /** Version transparente pour les murs en coupe (bâtiments/wagons). */
  vcFaded: toonify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.18, depthWrite: false })),
  /** Feuillages : se balancent au vent selon leur hauteur. */
  foliage: toonify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { sway: 'world', swayAmp: 0.08 }),
  /** Sol : grain procédural fixé au terrain. */
  ground: toonify(new THREE.MeshLambertMaterial({ vertexColors: true }), { ground: true }),
  /** Eau : rides animées et scintillements. */
  water: toonify(new THREE.MeshLambertMaterial({ vertexColors: true }), { water: true, snow: false }),
  /** Éléments lumineux (fenêtres éclairées, lampes, néons) : non affectés par l'éclairage. */
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  /** Verre / eau semi-transparents. */
  glass: toonify(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }), { snow: false }),
  /** Effets additifs (lueurs radioactives…). */
  additive: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  forLayer(name: string): THREE.Material {
    switch (name) {
      case 'glow':
        return Materials.glow;
      case 'window':
        return Materials.window;
      case 'glass':
        return Materials.glass;
      case 'additive':
        return Materials.additive;
      case 'foliage':
        return Materials.foliage;
      case 'ground':
        return Materials.ground;
      case 'water':
        return Materials.water;
      default:
        return Materials.vc;
    }
  },
};

for (const m of [Materials.vc, Materials.vcPat, Materials.parts, Materials.window, Materials.vcFaded, Materials.foliage, Materials.ground, Materials.water, Materials.glow, Materials.glass, Materials.additive]) m.userData.shared = true;

const waterMats = new Map<number, THREE.MeshLambertMaterial>();
/** Matériau d'eau d'une couleur donnée (partagé). */
export function waterMaterial(color: number): THREE.MeshLambertMaterial {
  let m = waterMats.get(color);
  if (!m) {
    m = toonify(new THREE.MeshLambertMaterial({ color }), { water: true, snow: false });
    m.userData.shared = true;
    waterMats.set(color, m);
  }
  return m;
}

/** Libère géométries et matériaux d'un objet, sauf ceux partagés (userData.shared). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m && !m.userData.shared) m.dispose();
  });
}

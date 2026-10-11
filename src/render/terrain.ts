import * as THREE from 'three';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { Materials } from './geo';
import { toonify } from './toon';

/**
 * Terrain continu et végétation rase :
 * - un maillage de sol à couleurs de sommets lissées (zones d'herbe, de terre, de neige
 *   qui se fondent, puis se découpent en aplats une fois ramenées sur la palette) ;
 * - des touffes d'herbe et des fleurs instanciées (une draw call chacune) qui ondulent au vent.
 */

const tc = new THREE.Color();
const tc2 = new THREE.Color();

let vegDensity = 1;
/** Densité globale de la végétation rase (option de qualité). */
export function setVegetationDensity(k: number): void {
  vegDensity = k;
}
export function vegetationDensity(): number {
  return vegDensity;
}

export interface TerrainOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Taille d'une maille (m). */
  cell: number;
  /** Couleurs du biome, de la plus sombre à la plus claire (ou dans l'ordre souhaité). */
  colors: number[];
  seed: number;
  /** Décalage des coordonnées de bruit (le terrain de voyage est continu d'un tronçon à l'autre). */
  noiseOffsetX?: number;
  /** Retouche locale de la couleur (chemins, ballast, flaques…). */
  paint?: (x: number, z: number, c: THREE.Color) => void;
}

/** Maillage de sol à plat (y = 0), couleurs interpolées entre les sommets. */
export function buildTerrain(o: TerrainOpts): THREE.Mesh {
  const noise = new Noise2D(o.seed);
  const nx = Math.max(1, Math.ceil((o.x1 - o.x0) / o.cell));
  const nz = Math.max(1, Math.ceil((o.z1 - o.z0) / o.cell));
  const vcount = (nx + 1) * (nz + 1);
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const col = new Float32Array(vcount * 3);
  const ox = o.noiseOffsetX ?? 0;
  const cols = o.colors.map((c) => new THREE.Color(c));
  let v = 0;
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const x = Math.min(o.x1, o.x0 + ix * o.cell);
      const z = Math.min(o.z1, o.z0 + iz * o.cell);
      const wx = x + ox;
      // grandes zones (choix de la teinte) + variation fine de luminosité
      const big = noise.fbm(wx * 0.028, z * 0.028, 3) * 0.5 + 0.5;
      const t = Math.min(0.999, Math.max(0, big)) * (cols.length - 1);
      const i = Math.floor(t);
      tc.copy(cols[i]).lerp(cols[Math.min(cols.length - 1, i + 1)], t - i);
      const fine = noise.get(wx * 0.19 + 31, z * 0.19 - 7) * 0.05;
      tc.multiplyScalar(1 + fine);
      o.paint?.(x, z, tc);
      pos[v * 3] = x;
      pos[v * 3 + 1] = 0;
      pos[v * 3 + 2] = z;
      nor[v * 3 + 1] = 1;
      col[v * 3] = tc.r;
      col[v * 3 + 1] = tc.g;
      col[v * 3 + 2] = tc.b;
      v++;
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let k = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, Materials.ground);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}

// ------------------------------------------------------------------ herbe

export type GrassKind = 'herbe' | 'haute' | 'seche' | 'roseau' | 'givre';

const grassMats = new Map<string, THREE.MeshLambertMaterial>();

function grassMaterial(kind: GrassKind): THREE.MeshLambertMaterial {
  let m = grassMats.get(kind);
  if (!m) {
    // pas d'écriture de profondeur : l'herbe se dessine par-dessus le sol sans être cernée de contours
    m = toonify(new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }), { sway: 'local', swayAmp: kind === 'roseau' ? 0.07 : 0.1, snow: false });
    m.userData.shared = true;
    grassMats.set(kind, m);
  }
  return m;
}

const tuftCache = new Map<string, THREE.BufferGeometry>();

/** Touffe : quelques brins effilés, sombres à la base, clairs à la pointe. */
function tuftGeometry(kind: GrassKind): THREE.BufferGeometry {
  const cached = tuftCache.get(kind);
  if (cached) return cached;
  const blades = kind === 'roseau' ? 5 : kind === 'haute' ? 7 : 6;
  const h = kind === 'roseau' ? 1.35 : kind === 'haute' ? 0.85 : kind === 'givre' ? 0.32 : 0.55;
  const w = kind === 'roseau' ? 0.08 : 0.11;
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const rng = new Rng(`tuft:${kind}`);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const r = rng.range(0.02, 0.2);
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const bh = h * rng.range(0.65, 1.15);
    const lean = rng.range(0.08, 0.22) * bh;
    const tx = bx + Math.cos(a) * lean;
    const tz = bz + Math.sin(a) * lean;
    // brin = triangle (base large, pointe), visible des deux côtés, normale vers le ciel
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, bh, tz);
    pos.push(bx + px, 0, bz + pz, bx - px, 0, bz - pz, tx, bh, tz);
    const base = 0.86;
    const tip = 1.18;
    for (let k = 0; k < 2; k++) col.push(base, base, base, base, base, base, tip, tip, tip);
    for (let k = 0; k < 6; k++) nor.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.userData.shared = true;
  tuftCache.set(kind, g);
  return g;
}

export interface ScatterOpts {
  kind: GrassKind;
  count: number;
  seed: number | string;
  /** Tirage d'une position candidate (ou null pour l'abandonner). */
  sample: (rng: Rng) => { x: number; z: number } | null;
  /** Teintes possibles des touffes. */
  colors: number[];
  scale?: [number, number];
}

/** Touffes d'herbe instanciées ondulant au vent. */
export function buildGrass(o: ScatterOpts): THREE.InstancedMesh | null {
  const rng = new Rng(o.seed);
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < o.count * 3 && pts.length < o.count; i++) {
    const p = o.sample(rng);
    if (p) pts.push(p);
  }
  if (!pts.length) return null;
  const mesh = new THREE.InstancedMesh(tuftGeometry(o.kind), grassMaterial(o.kind), pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const [s0, s1] = o.scale ?? [0.75, 1.3];
  pts.forEach((pt, i) => {
    q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
    const k = rng.range(s0, s1);
    s.set(k, k * rng.range(0.85, 1.2), k);
    p.set(pt.x, 0, pt.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    tc.setHex(rng.pick(o.colors)).multiplyScalar(rng.range(0.9, 1.08));
    mesh.setColorAt(i, tc);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  mesh.computeBoundingSphere();
  mesh.name = 'herbe';
  return mesh;
}

// ------------------------------------------------------------------ fleurs

let flowerGeo: THREE.BufferGeometry | null = null;
let flowerMat: THREE.MeshLambertMaterial | null = null;

/** Petites fleurs (tige + corolle) instanciées. */
export function buildFlowers(o: Omit<ScatterOpts, 'kind'>): THREE.InstancedMesh | null {
  if (!flowerGeo) {
    const pos: number[] = [];
    const col: number[] = [];
    const nor: number[] = [];
    const stem = (x: number, z: number, h: number) => {
      pos.push(x - 0.025, 0, z, x + 0.025, 0, z, x, h, z, x + 0.025, 0, z, x - 0.025, 0, z, x, h, z);
      for (let k = 0; k < 2; k++) col.push(0.3, 0.5, 0.2, 0.3, 0.5, 0.2, 0.36, 0.58, 0.24);
      for (let k = 0; k < 6; k++) nor.push(0, 1, 0);
      // corolle : petit losange horizontal tourné vers le ciel (prend la teinte d'instance)
      const r = 0.09;
      pos.push(x - r, h, z, x, h, z + r, x + r, h, z, x - r, h, z, x + r, h, z, x, h, z - r);
      for (let k = 0; k < 6; k++) {
        col.push(1, 1, 1);
        nor.push(0, 1, 0);
      }
    };
    stem(0, 0, 0.3);
    stem(0.14, 0.06, 0.22);
    stem(-0.08, 0.12, 0.26);
    flowerGeo = new THREE.BufferGeometry();
    flowerGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    flowerGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    flowerGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    flowerGeo.computeBoundingSphere();
    flowerGeo.userData.shared = true;
    flowerMat = toonify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false }), { sway: 'local', swayAmp: 0.08, snow: false });
    flowerMat.userData.shared = true;
  }
  const rng = new Rng(o.seed);
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < o.count * 3 && pts.length < o.count; i++) {
    const p = o.sample(rng);
    if (p) pts.push(p);
  }
  if (!pts.length) return null;
  const mesh = new THREE.InstancedMesh(flowerGeo, flowerMat!, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  pts.forEach((pt, i) => {
    q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
    const k = rng.range(0.8, 1.25);
    s.set(k, k, k);
    p.set(pt.x, 0, pt.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, tc2.setHex(rng.pick(o.colors)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.computeBoundingSphere();
  mesh.name = 'fleurs';
  return mesh;
}

/** Réglages de végétation rase par biome. */
export function groundCoverFor(biome: string, winter: boolean): { grass: GrassKind | null; colors: number[]; density: number; flowers: number[] | null; tall: number } {
  if (winter) {
    if (biome === 'desert') return { grass: 'seche', colors: [0xa89060, 0x9a8054, 0xb8a070], density: 0.25, flowers: null, tall: 0 };
    return { grass: 'givre', colors: [0x8a9a86, 0x9aa890, 0xa8b4a0], density: 0.3, flowers: null, tall: 0 };
  }
  switch (biome) {
    case 'plaines': return { grass: 'herbe', colors: [0x5e9036, 0x6c9c3c, 0x7aa844, 0x8cb44c, 0x9cb852], density: 1, flowers: [0xf2e070, 0xf0ece0, 0xc87ab8, 0xe8704e, 0x8aa8f0], tall: 0.25 };
    case 'foret': return { grass: 'herbe', colors: [0x3a6a34, 0x447638, 0x4e8040, 0x5a8a44], density: 0.85, flowers: [0xf0ece0, 0xa080d0], tall: 0.35 };
    case 'desert': return { grass: 'seche', colors: [0xb09a5a, 0xa08a4a, 0xc0aa68], density: 0.16, flowers: null, tall: 0 };
    case 'toundra': return { grass: 'givre', colors: [0x8a9a86, 0x9aa890, 0xa8b4a0], density: 0.28, flowers: null, tall: 0 };
    case 'irradie': return { grass: 'seche', colors: [0x7e7c36, 0x8e8a3c, 0x9e9842, 0xaaa248], density: 0.6, flowers: null, tall: 0.2 };
    case 'marais': return { grass: 'roseau', colors: [0x46663a, 0x527240, 0x5e7a44, 0x6a8048], density: 0.8, flowers: [0xf0ece0], tall: 0.45 };
    case 'montagnes': return { grass: 'herbe', colors: [0x547a40, 0x608646, 0x6c904c], density: 0.5, flowers: [0xa0a0e0, 0xf0ece0], tall: 0.1 };
    case 'ruines': return { grass: 'herbe', colors: [0x5a7a36, 0x66843c, 0x728c42], density: 0.55, flowers: [0xe8d870], tall: 0.2 };
    default: return { grass: 'herbe', colors: [0x6e8a3a], density: 0.6, flowers: null, tall: 0 };
  }
}

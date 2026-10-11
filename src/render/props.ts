import * as THREE from 'three';
import type { GeoBuilder } from './geo';
import { PAT } from './toon';
import type { Rng } from '../core/rng';

/** Décors procéduraux ajoutés à un GeoBuilder. Chaque fonction retourne un collisionneur éventuel. */

export type PropCollider = { kind: 'circle'; x: number; z: number; r: number } | { kind: 'rect'; x0: number; z0: number; x1: number; z1: number } | null;

const SNOW = 0xf0f4f7;

export function pine(g: GeoBuilder, x: number, z: number, s: number, snow: boolean, dark = false): PropCollider {
  const trunk = 0x4a3426;
  const leaf = dark ? 0x22402c : 0x2c5432;
  const leafHi = dark ? 0x2f5636 : 0x3b6a3c;
  g.cyl(0.16 * s, 0.24 * s, 1.5 * s, x, 0.75 * s, z, trunk, { seg: 6 });
  g.layer('foliage');
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const y = (1.25 + i * 0.95) * s;
    const r = (1.7 - i * 0.36) * s;
    g.cone(r, 1.7 * s, x, y + 0.55 * s, z, i % 2 ? leafHi : leaf, { seg: 7, vary: 0.06, ry: i * 0.9 });
    if (snow) g.cone(r * 0.72, 0.62 * s, x, y + 1.08 * s, z, SNOW, { seg: 7, ry: i * 0.9 });
  }
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.35 * s };
}

export function oak(g: GeoBuilder, x: number, z: number, s: number, snow: boolean, autumn = false): PropCollider {
  g.cyl(0.24 * s, 0.36 * s, 2.3 * s, x, 1.15 * s, z, 0x5a4030, { seg: 6 });
  g.cyl(0.1 * s, 0.14 * s, 1.2 * s, x + 0.45 * s, 2.3 * s, z, 0x5a4030, { seg: 5, rz: -0.7 });
  const dark = autumn ? 0x8a5a24 : 0x3e5e2a;
  const mid = autumn ? 0xb07a2a : 0x4f7432;
  const light = autumn ? 0xd09a3a : 0x6a8e3c;
  g.layer('foliage');
  // couronne : volumes sombres dessous, clairs au sommet
  g.dodeca(1.25 * s, x - 0.7 * s, 2.55 * s, z + 0.35 * s, dark, { vary: 0.06 });
  g.dodeca(1.2 * s, x + 0.85 * s, 2.6 * s, z - 0.2 * s, dark, { vary: 0.06 });
  g.dodeca(1.45 * s, x, 3.1 * s, z, mid, { vary: 0.06 });
  g.dodeca(1.0 * s, x + 0.4 * s, 3.75 * s, z + 0.3 * s, light, { vary: 0.06 });
  g.dodeca(0.85 * s, x - 0.55 * s, 3.6 * s, z - 0.35 * s, light, { vary: 0.06 });
  if (snow) {
    g.dodeca(1.05 * s, x + 0.2 * s, 4.15 * s, z, SNOW, { sy: 0.35 });
    g.dodeca(0.8 * s, x - 0.7 * s, 3.55 * s, z + 0.3 * s, SNOW, { sy: 0.3 });
  }
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.45 * s };
}

export function birch(g: GeoBuilder, x: number, z: number, s: number, snow: boolean): PropCollider {
  g.cyl(0.11 * s, 0.15 * s, 3.4 * s, x, 1.7 * s, z, 0xe6e2d4, { seg: 6 });
  for (const y of [0.7, 1.3, 2.0, 2.7]) g.box(0.24 * s, 0.07 * s, 0.24 * s, x, y * s, z, 0x2a2622, { ry: y });
  g.layer('foliage');
  const c1 = snow ? 0xc8d0b0 : 0x8aa448;
  const c2 = snow ? 0xd8dec8 : 0xa8bc5a;
  g.dodeca(0.85 * s, x, 3.3 * s, z, c1, { vary: 0.08, sy: 1.25 });
  g.dodeca(0.65 * s, x + 0.45 * s, 3.85 * s, z - 0.1 * s, c2, { vary: 0.08, sy: 1.2 });
  g.dodeca(0.55 * s, x - 0.4 * s, 4.05 * s, z + 0.15 * s, c2, { vary: 0.08, sy: 1.2 });
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.25 * s };
}

export function deadTree(g: GeoBuilder, x: number, z: number, s: number, rng: Rng, color = 0x3e342c): PropCollider {
  g.cyl(0.14 * s, 0.26 * s, 3.2 * s, x, 1.6 * s, z, color, { seg: 5 });
  for (let i = 0; i < 3; i++) {
    const a = rng.next() * Math.PI * 2;
    const y = (1.6 + i * 0.6) * s;
    g.cyl(0.05 * s, 0.09 * s, 1.4 * s, x + Math.cos(a) * 0.5 * s, y + 0.4 * s, z + Math.sin(a) * 0.5 * s, color, { seg: 4, rz: Math.cos(a) * 0.9, rx: -Math.sin(a) * 0.9 });
  }
  return { kind: 'circle', x, z, r: 0.3 * s };
}

export function cactus(g: GeoBuilder, x: number, z: number, s: number): PropCollider {
  const c = 0x4f7a3a;
  g.cyl(0.28 * s, 0.32 * s, 2.6 * s, x, 1.3 * s, z, c, { seg: 7 });
  g.cyl(0.18 * s, 0.18 * s, 0.9 * s, x + 0.5 * s, 1.4 * s, z, c, { seg: 6, rz: Math.PI / 2 });
  g.cyl(0.18 * s, 0.18 * s, 1.0 * s, x + 0.9 * s, 1.95 * s, z, c, { seg: 6 });
  g.cyl(0.16 * s, 0.16 * s, 0.7 * s, x - 0.4 * s, 1.0 * s, z, c, { seg: 6, rz: Math.PI / 2 });
  g.cyl(0.16 * s, 0.16 * s, 0.8 * s, x - 0.7 * s, 1.4 * s, z, c, { seg: 6 });
  return { kind: 'circle', x, z, r: 0.4 * s };
}

export function mangrove(g: GeoBuilder, x: number, z: number, s: number, rng: Rng): PropCollider {
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.next();
    g.cyl(0.06 * s, 0.1 * s, 1.6 * s, x + Math.cos(a) * 0.5 * s, 0.6 * s, z + Math.sin(a) * 0.5 * s, 0x3a3020, { seg: 4, rz: Math.cos(a) * 0.5, rx: -Math.sin(a) * 0.5 });
  }
  g.cyl(0.2 * s, 0.25 * s, 2.2 * s, x, 2.2 * s, z, 0x3a3020, { seg: 5 });
  g.layer('foliage');
  g.dodeca(1.4 * s, x, 3.6 * s, z, 0x3d5a2a, { vary: 0.08, sy: 0.6 });
  g.dodeca(0.9 * s, x + 0.8 * s, 3.2 * s, z, 0x4a6a32, { vary: 0.08, sy: 0.6 });
  g.dodeca(0.8 * s, x - 0.7 * s, 3.9 * s, z + 0.3 * s, 0x5a7a3a, { vary: 0.08, sy: 0.6 });
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.5 * s };
}

export function mushroom(g: GeoBuilder, x: number, z: number, s: number, glow: number): PropCollider {
  g.cyl(0.25 * s, 0.35 * s, 2.0 * s, x, 1.0 * s, z, 0xd8d0b8, { seg: 7 });
  g.sphere(1.3 * s, x, 2.2 * s, z, 0x8a5a7a, { detail: 1, sy: 0.45 });
  g.layer('glow');
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    g.sphere(0.12 * s, x + Math.cos(a) * 0.8 * s, 2.45 * s, z + Math.sin(a) * 0.8 * s, glow, { detail: 0 });
  }
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.4 * s };
}

export function crystal(g: GeoBuilder, x: number, z: number, s: number, rng: Rng, color = 0x7dff3a): PropCollider {
  g.layer('glow');
  for (let i = 0; i < 4; i++) {
    const a = rng.next() * Math.PI * 2;
    g.cone(0.25 * s, (1.2 + rng.next() * 1.4) * s, x + Math.cos(a) * 0.3 * s, 0.6 * s, z + Math.sin(a) * 0.3 * s, color, { seg: 5, rz: Math.cos(a) * 0.3, rx: Math.sin(a) * 0.3 });
  }
  g.layer('base');
  g.dodeca(0.6 * s, x, 0.2 * s, z, 0x4a4a42);
  return { kind: 'circle', x, z, r: 0.5 * s };
}

export function rock(g: GeoBuilder, x: number, z: number, s: number, color: number, rng: Rng, snow = false): PropCollider {
  g.dodeca(s, x, s * 0.45, z, color, { vary: 0.12, sy: 0.6 + rng.next() * 0.4, ry: rng.next() * 6, rx: rng.next() * 0.4 });
  if (snow) g.dodeca(s * 0.8, x, s * 0.75, z, SNOW, { sy: 0.3 });
  return s > 0.6 ? { kind: 'circle', x, z, r: s * 0.85 } : null;
}

export function bush(g: GeoBuilder, x: number, z: number, s: number, color: number, berries = 0): PropCollider {
  g.layer('foliage');
  g.dodeca(0.7 * s, x, 0.45 * s, z, color, { vary: 0.08, sy: 0.75 });
  g.dodeca(0.5 * s, x + 0.55 * s, 0.35 * s, z + 0.2 * s, color, { vary: 0.08, sy: 0.75 });
  g.dodeca(0.45 * s, x - 0.45 * s, 0.6 * s, z - 0.1 * s, color, { vary: 0.12, sy: 0.8 });
  if (berries) for (let i = 0; i < 4; i++) g.box(0.1, 0.1, 0.1, x + Math.cos(i * 1.7) * 0.5 * s, 0.75 * s, z + Math.sin(i * 1.7) * 0.4 * s, berries);
  g.layer('base');
  return null;
}

/** Souche ou tronc couché, parfois moussu. */
export function stump(g: GeoBuilder, x: number, z: number, rng: Rng, snow = false): void {
  const wood = rng.pick([0x5a4030, 0x4e3828, 0x6a4a34]);
  if (rng.chance(0.5)) {
    g.cyl(0.32, 0.38, 0.45, x, 0.22, z, wood, { seg: 7 });
    g.cyl(0.26, 0.26, 0.02, x, 0.46, z, 0xa8865a, { seg: 7 });
    if (snow) g.cyl(0.3, 0.3, 0.06, x, 0.5, z, SNOW, { seg: 7 });
  } else {
    const a = rng.next() * Math.PI;
    g.cyl(0.22, 0.26, 2.2, x, 0.22, z, wood, { seg: 6, rz: Math.PI / 2, ry: a });
    if (!snow) g.layer('foliage').dodeca(0.28, x, 0.42, z, 0x4e7432, { sy: 0.5 }).layer('base');
    else g.box(1.8, 0.08, 0.3, x, 0.47, z, SNOW, { ry: a });
  }
}

export function grass(g: GeoBuilder, x: number, z: number, s: number, color: number): void {
  for (let i = 0; i < 3; i++) g.cone(0.08 * s, 0.6 * s, x + (i - 1) * 0.12 * s, 0.3 * s, z + ((i * 7) % 3 - 1) * 0.1 * s, color, { seg: 3, rz: (i - 1) * 0.3 });
}

export function barrel(g: GeoBuilder, x: number, z: number, color: number, toxic = false, glow = 0x7dff3a): PropCollider {
  g.cyl(0.38, 0.38, 1.1, x, 0.55, z, color, { seg: 9 });
  g.cyl(0.4, 0.4, 0.06, x, 0.3, z, 0x3a3a3a, { seg: 9 });
  g.cyl(0.4, 0.4, 0.06, x, 0.85, z, 0x3a3a3a, { seg: 9 });
  if (toxic) {
    g.layer('glow').cyl(0.32, 0.32, 0.03, x, 1.11, z, glow, { seg: 9 });
    g.layer('base');
  }
  return { kind: 'circle', x, z, r: 0.42 };
}

export function crate(g: GeoBuilder, x: number, z: number, s: number, color = 0x8a6a42, ry = 0): PropCollider {
  g.box(s, s, s, x, s / 2, z, color, { ry, vary: 0.08 });
  g.box(s * 1.02, s * 0.12, s * 1.02, x, s * 0.85, z, 0x5a4428, { ry });
  g.box(s * 1.02, s * 0.12, s * 1.02, x, s * 0.15, z, 0x5a4428, { ry });
  return { kind: 'rect', x0: x - s * 0.55, z0: z - s * 0.55, x1: x + s * 0.55, z1: z + s * 0.55 };
}

export function car(g: GeoBuilder, x: number, z: number, ry: number, color: number, rusty = true): PropCollider {
  const c = rusty ? 0x7a4a2a : color;
  g.box(1.8, 0.7, 4.2, x, 0.65, z, color, { ry, vary: 0.05 });
  g.box(1.6, 0.6, 2.2, x - Math.sin(ry) * 0.2, 1.3, z - Math.cos(ry) * 0.2, c, { ry });
  g.box(1.5, 0.45, 2.0, x - Math.sin(ry) * 0.2, 1.3, z - Math.cos(ry) * 0.2, 0x2a3036, { ry });
  for (const [dx, dz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const wx = x + Math.cos(ry) * dx + Math.sin(ry) * dz;
    const wz = z - Math.sin(ry) * dx + Math.cos(ry) * dz;
    g.cyl(0.36, 0.36, 0.25, wx, 0.36, wz, 0x1a1a1a, { rz: Math.PI / 2, ry, seg: 8 });
  }
  const hw = Math.abs(Math.cos(ry)) * 0.95 + Math.abs(Math.sin(ry)) * 2.1;
  const hd = Math.abs(Math.sin(ry)) * 0.95 + Math.abs(Math.cos(ry)) * 2.1;
  return { kind: 'rect', x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd };
}

export function pole(g: GeoBuilder, x: number, z: number, h = 6): PropCollider {
  g.cyl(0.12, 0.16, h, x, h / 2, z, 0x4a3a2c, { seg: 6 });
  g.box(1.6, 0.12, 0.12, x, h - 0.5, z, 0x4a3a2c);
  g.box(0.08, 0.15, 0.08, x - 0.6, h - 0.35, z, 0x9ab0b8);
  g.box(0.08, 0.15, 0.08, x + 0.6, h - 0.35, z, 0x9ab0b8);
  return { kind: 'circle', x, z, r: 0.2 };
}

export function lampPost(g: GeoBuilder, x: number, z: number, lit: boolean): PropCollider {
  g.cyl(0.1, 0.14, 4.2, x, 2.1, z, 0x2a2e32, { seg: 6 });
  g.box(0.9, 0.1, 0.12, x + 0.35, 4.15, z, 0x2a2e32);
  if (lit) g.layer('glow');
  g.box(0.36, 0.2, 0.36, x + 0.75, 4.0, z, lit ? 0xffe2a0 : 0x5a5a50);
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.2 };
}

export function fence(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, color = 0x6a5440): PropCollider {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.box(0.12, 1.2, 0.12, x0 + (x1 - x0) * t, 0.6, z0 + (z1 - z0) * t, color);
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  g.box(0.06, 0.1, len, cx, 0.9, cz, color, { ry });
  g.box(0.06, 0.1, len, cx, 0.45, cz, color, { ry });
  return { kind: 'rect', x0: Math.min(x0, x1) - 0.1, z0: Math.min(z0, z1) - 0.1, x1: Math.max(x0, x1) + 0.1, z1: Math.max(z0, z1) + 0.1 };
}

export function sandbags(g: GeoBuilder, x: number, z: number, ry: number, len = 3): PropCollider {
  const n = Math.round(len / 0.6);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < n - row; i++) {
      const off = (i - (n - row - 1) / 2) * 0.6;
      g.box(0.58, 0.28, 0.45, x + Math.cos(ry) * off, 0.14 + row * 0.27, z - Math.sin(ry) * off, 0xa0905e, { ry, vary: 0.06 });
    }
  }
  const hw = Math.abs(Math.cos(ry)) * len / 2 + 0.3;
  const hd = Math.abs(Math.sin(ry)) * len / 2 + 0.3;
  return { kind: 'rect', x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd };
}

export function tent(g: GeoBuilder, x: number, z: number, ry: number, color: number): PropCollider {
  g.box(3.2, 0.06, 3.4, x, 0.03, z, 0x4a4030, { ry });
  g.cyl(0, 2.4, 2.6, x, 1.3, z, color, { seg: 4, ry: ry + Math.PI / 4, vary: 0.05 });
  return { kind: 'circle', x, z, r: 1.5 };
}

export function tank(g: GeoBuilder, x: number, z: number, r: number, h: number, color: number): PropCollider {
  g.cyl(r, r, h, x, h / 2, z, color, { seg: 12, grad: 0.2 });
  g.cyl(r * 0.6, r, 0.6, x, h + 0.3, z, color, { seg: 12 });
  g.box(0.08, h, 0.08, x + r, h / 2, z, 0x5a5a5a);
  return { kind: 'circle', x, z, r: r + 0.1 };
}

export function pipe(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, r: number, color: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0);
  g.cyl(r, r, len, (x0 + x1) / 2, y, (z0 + z1) / 2, color, { rx: Math.PI / 2, ry, seg: 8 });
}

const _pc = new THREE.Color();
const _pd = new THREE.Color();

/** Flaque : bord boueux sombre et, si toxique, cœur luminescent atténué. */
export function puddle(g: GeoBuilder, x: number, z: number, r: number, color: number, glow: boolean): void {
  if (!glow) {
    // mare : berge de terre sombre puis eau animée
    g.cyl(r + 0.35, r + 0.45, 0.04, x, 0.02, z, _pc.setHex(color).lerp(_pd.setHex(0x3a3024), 0.7).getHex(), { seg: 12 });
    g.layer('water');
    g.cyl(r, r, 0.05, x, 0.04, z, color, { seg: 12 });
    g.layer('base');
    return;
  }
  const dark = _pc.setHex(color).multiplyScalar(0.22).lerp(_pd.setHex(0x2a2a1c), 0.55).getHex();
  g.cyl(r, r, 0.04, x, 0.025, z, dark, { seg: 10 });
  g.layer('glow');
  const mid = _pc.setHex(color).multiplyScalar(0.5).getHex();
  g.cyl(r * 0.68, r * 0.68, 0.04, x, 0.04, z, mid, { seg: 10 });
  g.cyl(r * 0.12, r * 0.12, 0.05, x + r * 0.3, 0.05, z - r * 0.2, color, { seg: 6 });
  g.cyl(r * 0.08, r * 0.08, 0.05, x - r * 0.35, 0.05, z + r * 0.15, color, { seg: 6 });
  g.layer('base');
}

export function ruinWall(g: GeoBuilder, x: number, z: number, w: number, h: number, ry: number, color: number, rng: Rng): PropCollider {
  const n = Math.max(2, Math.round(w / 1.2));
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * (w / n);
    const hh = h * (0.4 + rng.next() * 0.6);
    g.box(w / n + 0.02, hh, 0.4, x + Math.cos(ry) * off, hh / 2, z - Math.sin(ry) * off, color, { ry, vary: 0.06 });
  }
  const hw = Math.abs(Math.cos(ry)) * w / 2 + Math.abs(Math.sin(ry)) * 0.25;
  const hd = Math.abs(Math.sin(ry)) * w / 2 + Math.abs(Math.cos(ry)) * 0.25;
  return { kind: 'rect', x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd };
}

export function tire(g: GeoBuilder, x: number, z: number): void {
  g.cyl(0.45, 0.45, 0.3, x, 0.15, z, 0x1a1a1a, { seg: 9 });
}

export function bones(g: GeoBuilder, x: number, z: number, rng: Rng): void {
  for (let i = 0; i < 4; i++) g.box(0.08, 0.06, 0.5, x + rng.range(-0.5, 0.5), 0.04, z + rng.range(-0.5, 0.5), 0xd8d0c0, { ry: rng.next() * 3 });
  g.sphere(0.15, x, 0.12, z, 0xd8d0c0);
}

export function haybale(g: GeoBuilder, x: number, z: number, ry: number): PropCollider {
  g.cyl(0.7, 0.7, 1.2, x, 0.7, z, 0xc9a85a, { rz: Math.PI / 2, ry, seg: 10, vary: 0.05 });
  return { kind: 'circle', x, z, r: 0.75 };
}

export function signpost(g: GeoBuilder, x: number, z: number, color = 0xb0302a): PropCollider {
  g.cyl(0.08, 0.08, 2.4, x, 1.2, z, 0x4a3a2c, { seg: 5 });
  g.box(1.2, 0.5, 0.06, x, 2.1, z, color);
  return { kind: 'circle', x, z, r: 0.15 };
}

export function campfire(g: GeoBuilder, x: number, z: number): PropCollider {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.dodeca(0.2, x + Math.cos(a) * 0.55, 0.12, z + Math.sin(a) * 0.55, 0x5a5a58);
  }
  g.box(0.12, 0.12, 0.9, x, 0.12, z, 0x3a2a1a, { ry: 0.6 });
  g.box(0.12, 0.12, 0.9, x, 0.14, z, 0x3a2a1a, { ry: -0.6 });
  g.layer('glow').cone(0.3, 0.6, x, 0.4, z, 0xff9a30, { seg: 5 });
  g.layer('base');
  return { kind: 'circle', x, z, r: 0.6 };
}

/** Tour à charbon : trémie en planches sur tréteaux, goulotte vers la voie, échelle et tas de charbon. */
export function coalTower(g: GeoBuilder, x: number, z: number, chuteDir: 1 | -1 = -1): void {
  const wood = 0x5e4632;
  const dark = 0x3a2c22;
  // pieds et contreventements
  for (const [lx, lz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) g.box(0.42, 5.4, 0.42, x + lx, 2.7, z + lz, dark, { grad: 0.2 });
  for (const sz of [-2.2, 2.2]) {
    g.box(4.9, 0.18, 0.16, x, 2.6, z + sz, wood, { rz: 0.82 });
    g.box(4.9, 0.18, 0.16, x, 2.6, z + sz, wood, { rz: -0.82 });
  }
  for (const sx of [-2.2, 2.2]) {
    g.box(0.16, 0.18, 4.9, x + sx, 2.6, z, wood, { rx: 0.82 });
    g.box(0.16, 0.18, 4.9, x + sx, 2.6, z, wood, { rx: -0.82 });
  }
  // trémie
  g.box(5.4, 3.4, 5.4, x, 7.1, z, 0x6e5238, { pat: PAT.lames, grad: 0.15 });
  g.box(5.6, 0.3, 5.6, x, 5.45, z, dark);
  g.box(5.6, 0.25, 5.6, x, 8.8, z, dark);
  // toit à deux pans
  g.prism(6.0, 1.5, 6.0, x, 8.9, z, 0x4e5a60, { pat: PAT.toleToit });
  // goulotte et clapet
  g.box(1.1, 0.35, 3.6, x, 5.6, z + chuteDir * 3.6, 0x4a4c50, { rx: chuteDir * 0.42 });
  g.box(1.3, 0.5, 0.12, x, 4.9, z + chuteDir * 5.3, 0x2a2c30);
  // échelle
  g.box(0.06, 8.4, 0.06, x + 2.75, 4.2, z + 1.0, 0x2a2c30);
  g.box(0.06, 8.4, 0.06, x + 2.75, 4.2, z + 1.5, 0x2a2c30);
  for (let i = 0; i < 16; i++) g.box(0.05, 0.05, 0.5, x + 2.75, 0.4 + i * 0.5, z + 1.25, 0x2a2c30);
  // tas de charbon
  for (let i = 0; i < 9; i++) g.dodeca(0.5 + (i % 3) * 0.18, x + ((i % 3) - 1) * 1.1, 0.35, z + chuteDir * (-0.6 + Math.floor(i / 3) * 0.7) + (i % 2) * 0.3, i % 2 ? 0x2c2c34 : 0x22222a, { ry: i, sy: 0.6 });
}

/** Château d'eau : cuve en douelles cerclées sur pieds, toit conique et col de cygne. */
export function waterTower(g: GeoBuilder, x: number, z: number, r = 2.4, h = 7): PropCollider {
  const legs = h - 2.6;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.box(0.36, legs, 0.36, x + Math.cos(a) * r * 0.75, legs / 2, z + Math.sin(a) * r * 0.75, 0x3a2c22, { grad: 0.2 });
  }
  g.box(r * 1.6, 0.16, 0.14, x, legs * 0.45, z, 0x5e4632, { rz: 0.9 });
  g.box(0.14, 0.16, r * 1.6, x, legs * 0.45, z, 0x5e4632, { rx: 0.9 });
  g.cyl(r, r, 2.6, x, legs + 1.3, z, 0x6e5238, { seg: 12, pat: PAT.lames });
  for (const y of [legs + 0.35, legs + 1.3, legs + 2.25]) g.cyl(r + 0.05, r + 0.05, 0.12, x, y, z, 0x2a2c30, { seg: 12 });
  g.cone(r + 0.3, 1.3, x, h + 0.65, z, 0x4e5a60, { seg: 12 });
  g.cyl(0.18, 0.18, 2.4, x - r - 0.2, legs + 0.4, z, 0x2a2c30, { rz: 0.5, seg: 6 });
  return { kind: 'circle', x, z, r: r * 0.85 };
}

/** Wagon abandonné sur une voie de garage. */
export function oldWagon(g: GeoBuilder, x: number, z: number, color: number, rng: Rng, len = 11): void {
  g.box(len - 0.2, 0.3, 3.0, x, 1.05, z, 0x24262a);
  for (const bx of [x - len / 2 + 2, x + len / 2 - 2]) {
    g.box(2.4, 0.35, 2.4, bx, 0.7, z, 0x3a3c40);
    for (const ax of [-0.7, 0.7]) for (const sz of [-1.0, 1.0]) g.cyl(0.42, 0.42, 0.16, bx + ax, 0.45, z + sz, 0x2a2622, { rx: Math.PI / 2, seg: 10 });
  }
  g.box(len, 2.6, 3.4, x, 2.5, z, color, { pat: PAT.lames, grad: 0.2, vary: 0.06 });
  g.vault(len + 0.1, 0.4, 1.8, x, 3.8, z, 0x55504a, { seg: 8, pat: PAT.toleToit });
  // porte coulissante entrouverte
  g.box(1.8, 2.2, 0.08, x + rng.range(-1.5, 1.5), 2.4, z + 1.74, shade(color, 0.8), { pat: PAT.lames });
  g.box(len - 0.4, 0.1, 0.12, x, 3.65, z + 1.74, 0x2a2c30);
  // rouille et lichen
  for (let i = 0; i < 3; i++) g.box(rng.range(0.6, 1.4), rng.range(0.4, 1.2), 0.05, x + rng.range(-len / 2 + 1, len / 2 - 1), rng.range(1.6, 3.2), z + 1.71, 0x7a4028);
}

function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const gg = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (gg << 8) | b;
}

/** Chevalement de mine : tour en treillis rivetée, molettes à rayons, contre-fiche et câbles. */
export function headframe(g: GeoBuilder, x: number, z: number, h = 14): void {
  const steel = 0x6a4a36;
  const dark = 0x3a2c24;
  // quatre montants légèrement inclinés
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.box(0.36, h, 0.36, x + sx * 2.3, h / 2, z + sz * 0.9, steel, { rz: sx * 0.08, rx: -sz * 0.03, grad: 0.25 });
  }
  // croisillons sur les faces avant/arrière et latérales
  const n = Math.floor(h / 2.6);
  for (let i = 0; i < n; i++) {
    const y = 1.4 + i * 2.6;
    const half = 2.3 - (y / h) * 1.1;
    for (const sz of [-0.9, 0.9]) {
      g.box(half * 2, 0.16, 0.12, x, y, z + sz, dark);
      g.box(half * 2.3, 0.12, 0.1, x, y + 1.3, z + sz, steel, { rz: 0.55 });
    }
    for (const sx of [-1, 1]) g.box(0.12, 0.16, 1.8, x + sx * half, y, z, dark);
  }
  // plate-forme et garde-corps
  g.box(3.6, 0.3, 2.6, x, h - 0.6, z, dark);
  for (const sz of [-1.25, 1.25]) g.box(3.6, 0.08, 0.08, x, h + 0.3, z + sz, steel);
  // molettes
  for (const dx of [-0.6, 0.6]) {
    g.cyl(1.45, 1.45, 0.16, x + dx, h + 0.6, z, 0x2a2622, { rz: Math.PI / 2, seg: 14 });
    g.cyl(1.25, 1.25, 0.2, x + dx, h + 0.6, z, 0x8a6a3a, { rz: Math.PI / 2, seg: 14 });
    for (let k = 0; k < 4; k++) g.box(0.22, 2.5, 0.1, x + dx, h + 0.6, z, 0x2a2622, { rx: (k * Math.PI) / 4 });
    g.cyl(0.25, 0.25, 0.3, x + dx, h + 0.6, z, 0x2a2622, { rz: Math.PI / 2, seg: 8 });
  }
  // contre-fiche vers la salle des machines
  g.box(0.42, h * 0.95, 0.42, x, h * 0.45, z + 3.6, steel, { rx: -0.38, grad: 0.2 });
  // câbles
  for (const dx of [-0.6, 0.6]) g.box(0.05, 0.05, 16, x + dx, h - 4.5, z + 4.75, 0x1a1a1e, { rx: 0.94 });
}

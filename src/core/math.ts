export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Lissage exponentiel indépendant du framerate. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);

export const dampAngle = (current: number, target: number, lambda: number, dt: number): number =>
  current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));

/** Rotation limitée en vitesse angulaire. */
export const rotateTowards = (current: number, target: number, maxStep: number): number => {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return wrapAngle(current + Math.sign(d) * maxStep);
};

export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export const dist = (ax: number, az: number, bx: number, bz: number): number => Math.sqrt(dist2(ax, az, bx, bz));

/** Angle de lacet (rotation Y three.js) pour regarder de (ax,az) vers (bx,bz). */
export const yawTo = (ax: number, az: number, bx: number, bz: number): number => Math.atan2(bx - ax, bz - az);

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const rectContains = (r: Rect, x: number, z: number, margin = 0): boolean =>
  x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;

export const rectsOverlap = (a: Rect, b: Rect, margin = 0): boolean =>
  a.x0 - margin < b.x1 && a.x1 + margin > b.x0 && a.z0 - margin < b.z1 && a.z1 + margin > b.z0;

/**
 * Intersection segment (p0 -> p1) / cercle. Retourne t ∈ [0,1] du premier contact, ou -1.
 */
export function segmentCircle(
  x0: number, z0: number, x1: number, z1: number,
  cx: number, cz: number, r: number,
): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const fx = x0 - cx;
  const fz = z0 - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = (-b - s) / (2 * a);
  if (t >= 0 && t <= 1) return t;
  return -1;
}

/** Intersection segment / AABB (méthode des slabs). Retourne t ∈ [0,1] ou -1. */
export function segmentRect(x0: number, z0: number, x1: number, z1: number, r: Rect): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < r.x0 || x0 > r.x1) return -1;
  } else {
    let ta = (r.x0 - x0) / dx;
    let tb = (r.x1 - x0) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    tmin = Math.max(tmin, ta);
    tmax = Math.min(tmax, tb);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z0 < r.z0 || z0 > r.z1) return -1;
  } else {
    let ta = (r.z0 - z0) / dz;
    let tb = (r.z1 - z0) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    tmin = Math.max(tmin, ta);
    tmax = Math.min(tmax, tb);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export const formatTime = (minutes: number): string => {
  const m = Math.floor(minutes) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const pct = (v: number): string => `${Math.round(v * 100)}%`;

export const uid = (() => {
  let n = 0;
  return (prefix = 'id'): string => `${prefix}_${(++n).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
})();

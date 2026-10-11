import { segmentCircle, segmentRect, type Rect } from '../core/math';

/** Monde de collision 2D (plan XZ) : rectangles alignés et cercles, avec grille spatiale. */

export type ColliderTag = 'wall' | 'prop' | 'train' | 'door' | 'water' | 'low';

export interface RectCollider extends Rect {
  id: number;
  kind: 'rect';
  tag: ColliderTag;
  /** Bloque les projectiles (les obstacles bas comme les sacs de sable ne bloquent que les tirs ennemis rasants). */
  blocksShots: boolean;
  enabled: boolean;
}

export interface CircleCollider {
  id: number;
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  tag: ColliderTag;
  blocksShots: boolean;
  enabled: boolean;
}

export type Collider = RectCollider | CircleCollider;

const CELL = 4;

export class CollisionWorld {
  private colliders = new Map<number, Collider>();
  private grid = new Map<number, number[]>();
  private nextId = 1;
  private queryStamp = 0;
  private stamps = new Map<number, number>();

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private cellsOf(c: Collider): [number, number, number, number] {
    if (c.kind === 'rect') return [Math.floor(c.x0 / CELL), Math.floor(c.z0 / CELL), Math.floor(c.x1 / CELL), Math.floor(c.z1 / CELL)];
    return [Math.floor((c.x - c.r) / CELL), Math.floor((c.z - c.r) / CELL), Math.floor((c.x + c.r) / CELL), Math.floor((c.z + c.r) / CELL)];
  }

  private insert(c: Collider): void {
    const [a, b, cc, d] = this.cellsOf(c);
    for (let x = a; x <= cc; x++) {
      for (let z = b; z <= d; z++) {
        const k = this.key(x, z);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(c.id);
      }
    }
  }

  addRect(x0: number, z0: number, x1: number, z1: number, tag: ColliderTag = 'wall', blocksShots = true): RectCollider {
    const c: RectCollider = { id: this.nextId++, kind: 'rect', x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), tag, blocksShots, enabled: true };
    this.colliders.set(c.id, c);
    this.insert(c);
    return c;
  }

  addCircle(x: number, z: number, r: number, tag: ColliderTag = 'prop', blocksShots = true): CircleCollider {
    const c: CircleCollider = { id: this.nextId++, kind: 'circle', x, z, r, tag, blocksShots, enabled: true };
    this.colliders.set(c.id, c);
    this.insert(c);
    return c;
  }

  remove(c: Collider): void {
    this.colliders.delete(c.id);
    const [a, b, cc, d] = this.cellsOf(c);
    for (let x = a; x <= cc; x++) {
      for (let z = b; z <= d; z++) {
        const list = this.grid.get(this.key(x, z));
        if (!list) continue;
        const i = list.indexOf(c.id);
        if (i >= 0) list.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.colliders.clear();
    this.grid.clear();
  }

  get size(): number {
    return this.colliders.size;
  }

  /** Itère les collisionneurs proches d'une zone (sans doublons). */
  query(x0: number, z0: number, x1: number, z1: number, fn: (c: Collider) => void): void {
    const stamp = ++this.queryStamp;
    const a = Math.floor(x0 / CELL);
    const b = Math.floor(z0 / CELL);
    const cc = Math.floor(x1 / CELL);
    const d = Math.floor(z1 / CELL);
    for (let x = a; x <= cc; x++) {
      for (let z = b; z <= d; z++) {
        const list = this.grid.get(this.key(x, z));
        if (!list) continue;
        for (const id of list) {
          if (this.stamps.get(id) === stamp) continue;
          this.stamps.set(id, stamp);
          const c = this.colliders.get(id);
          if (c && c.enabled) fn(c);
        }
      }
    }
  }

  /**
   * Repousse un cercle hors des collisionneurs. Retourne la position corrigée.
   * `ignore` permet d'exclure certaines étiquettes (ex : 'water' pour les créatures volantes).
   */
  resolve(x: number, z: number, r: number, ignore?: (c: Collider) => boolean): { x: number; z: number; hit: boolean } {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(x - r - 0.1, z - r - 0.1, x + r + 0.1, z + r + 0.1, (c) => {
        if (ignore && ignore(c)) return;
        if (c.kind === 'rect') {
          const nx = Math.max(c.x0, Math.min(x, c.x1));
          const nz = Math.max(c.z0, Math.min(z, c.z1));
          let dx = x - nx;
          let dz = z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 < 1e-8) {
              // centre à l'intérieur : sortie par le côté le plus proche
              const left = x - c.x0;
              const right = c.x1 - x;
              const top = z - c.z0;
              const bottom = c.z1 - z;
              const m = Math.min(left, right, top, bottom);
              if (m === left) x = c.x0 - r;
              else if (m === right) x = c.x1 + r;
              else if (m === top) z = c.z0 - r;
              else z = c.z1 + r;
            } else {
              const d = Math.sqrt(d2);
              dx /= d;
              dz /= d;
              x = nx + dx * r;
              z = nz + dz * r;
            }
            moved = true;
            hit = true;
          }
        } else {
          const dx = x - c.x;
          const dz = z - c.z;
          const rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4;
            x = c.x + (dx / d) * rr;
            z = c.z + (dz / d) * rr;
            moved = true;
            hit = true;
          }
        }
      });
      if (!moved) break;
    }
    return { x, z, hit };
  }

  /** Vrai si le cercle chevauche un collisionneur. */
  blocked(x: number, z: number, r: number, ignore?: (c: Collider) => boolean): boolean {
    let b = false;
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (b || (ignore && ignore(c))) return;
      if (c.kind === 'rect') {
        const nx = Math.max(c.x0, Math.min(x, c.x1));
        const nz = Math.max(c.z0, Math.min(z, c.z1));
        if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) b = true;
      } else if ((x - c.x) ** 2 + (z - c.z) ** 2 < (r + c.r) ** 2) b = true;
    });
    return b;
  }

  /** Lancer de rayon : t ∈ [0,1] du premier impact bloquant, ou 1 si libre. */
  raycast(x0: number, z0: number, x1: number, z1: number, shotsOnly = true, ignore?: (c: Collider) => boolean): number {
    let best = 1;
    this.query(Math.min(x0, x1) - 0.5, Math.min(z0, z1) - 0.5, Math.max(x0, x1) + 0.5, Math.max(z0, z1) + 0.5, (c) => {
      if (shotsOnly && !c.blocksShots) return;
      if (ignore && ignore(c)) return;
      const t = c.kind === 'rect' ? segmentRect(x0, z0, x1, z1, c) : segmentCircle(x0, z0, x1, z1, c.x, c.z, c.r);
      if (t >= 0 && t < best) best = t;
    });
    return best;
  }

  /** Ligne de vue dégagée entre deux points. */
  lineOfSight(x0: number, z0: number, x1: number, z1: number, ignore?: (c: Collider) => boolean): boolean {
    return this.raycast(x0, z0, x1, z1, true, ignore) >= 0.999;
  }
}

/**
 * Grille de navigation (A*) construite à partir d'un monde de collision.
 * Utilisée par les ennemis et PNJ en station.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number, readonly cell = 1) {
    this.cols = Math.ceil((x1 - x0) / cell);
    this.rows = Math.ceil((z1 - z0) / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  build(world: CollisionWorld, radius: number, ignore?: (c: Collider) => boolean): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.x0 + (c + 0.5) * this.cell;
        const z = this.z0 + (r + 0.5) * this.cell;
        this.blocked[r * this.cols + c] = world.blocked(x, z, radius, ignore) ? 1 : 0;
      }
    }
  }

  setBlocked(x: number, z: number, v: boolean): void {
    const c = Math.floor((x - this.x0) / this.cell);
    const r = Math.floor((z - this.z0) / this.cell);
    if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.blocked[r * this.cols + c] = v ? 1 : 0;
  }

  isBlocked(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return true;
    return this.blocked[r * this.cols + c] === 1;
  }

  private toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)];
  }

  /** Cherche la cellule libre la plus proche (si la destination est dans un mur). */
  private nearestFree(c: number, r: number): [number, number] | null {
    if (!this.isBlocked(c, r)) return [c, r];
    for (let rad = 1; rad < 6; rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (const dr of [-rad, rad]) if (!this.isBlocked(c + dc, r + dr)) return [c + dc, r + dr];
      }
      for (let dr = -rad + 1; dr < rad; dr++) {
        for (const dc of [-rad, rad]) if (!this.isBlocked(c + dc, r + dr)) return [c + dc, r + dr];
      }
    }
    return null;
  }

  /** A* sur grille 8-connexe ; retourne une liste de points simplifiée. */
  findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = 4000): { x: number; z: number }[] | null {
    const s0 = this.toCell(sx, sz);
    const t0 = this.toCell(tx, tz);
    const s = this.nearestFree(s0[0], s0[1]);
    const t = this.nearestFree(t0[0], t0[1]);
    if (!s || !t) return null;
    const cols = this.cols;
    const start = s[1] * cols + s[0];
    const goal = t[1] * cols + t[0];
    if (start === goal) return [{ x: tx, z: tz }];
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const open: { i: number; f: number }[] = [{ i: start, f: 0 }];
    g.set(start, 0);
    const h = (i: number) => {
      const dx = Math.abs((i % cols) - t[0]);
      const dz = Math.abs(Math.floor(i / cols) - t[1]);
      return Math.max(dx, dz) + 0.41 * Math.min(dx, dz);
    };
    let visited = 0;
    while (open.length > 0 && visited < maxNodes) {
      // tas binaire minimaliste
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      const cur = open[bi].i;
      open[bi] = open[open.length - 1];
      open.pop();
      visited++;
      if (cur === goal) break;
      const cc = cur % cols;
      const cr = Math.floor(cur / cols);
      const gc = g.get(cur)!;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (this.isBlocked(nc, nr)) continue;
          if (dc && dr && (this.isBlocked(cc + dc, cr) || this.isBlocked(cc, cr + dr))) continue;
          const ni = nr * cols + nc;
          const cost = gc + (dc && dr ? 1.414 : 1);
          if (cost < (g.get(ni) ?? Infinity)) {
            g.set(ni, cost);
            came.set(ni, cur);
            open.push({ i: ni, f: cost + h(ni) });
          }
        }
      }
    }
    if (!came.has(goal)) return null;
    const cells: number[] = [];
    let cur = goal;
    while (cur !== start) {
      cells.push(cur);
      cur = came.get(cur)!;
    }
    cells.reverse();
    // simplification : on ne garde que les changements de direction
    const pts: { x: number; z: number }[] = [];
    let lastDir = -99;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const prev = k === 0 ? start : cells[k - 1];
      const dir = (i % cols) - (prev % cols) + 10 * (Math.floor(i / cols) - Math.floor(prev / cols));
      if (dir !== lastDir && k > 0) {
        const p = cells[k - 1];
        pts.push({ x: this.x0 + ((p % cols) + 0.5) * this.cell, z: this.z0 + (Math.floor(p / cols) + 0.5) * this.cell });
      }
      lastDir = dir;
    }
    pts.push({ x: tx, z: tz });
    return pts;
  }
}

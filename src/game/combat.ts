import * as THREE from 'three';
import type { FX } from '../render/particles';
import type { LightPool } from '../render/engine';
import type { Audio } from '../core/audio';
import type { WeaponDef } from '../data/weapons';
import { angleDiff, segmentCircle } from '../core/math';
import type { Actor, DamageSource, Faction, Hazard } from './types';

export interface CombatHost {
  fx: FX;
  lights: LightPool;
  audio: Audio;
  shake(amount: number): void;
  /** Acteurs hostiles à la faction donnée. */
  targets(f: Faction): Actor[];
  /** t ∈ [0,1] du premier obstacle de décor sur le segment. */
  shotBlocked(x0: number, z0: number, x1: number, z1: number): number;
  /** Impact sur la coque du train (tirs extérieurs uniquement). */
  trainHit(x0: number, z0: number, x1: number, z1: number): { t: number; wagon: number } | null;
  damageTrain(wagon: number, amount: number, src: DamageSource, x: number, z: number): void;
  trainInside(x: number, z: number): boolean;
  addHazard(h: Hazard): void;
  onKill(victim: Actor, src: DamageSource): void;
  floatText(x: number, y: number, z: number, text: string, color: string, key?: string): void;
  /** Vitesse du sol (train en marche), pour les effets accrochés au décor. */
  groundSpeed(): number;
}

export interface FireOpts {
  weapon: WeaponDef;
  level?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  faction: Faction;
  owner: Actor | null;
  /** Multiplicateur de dispersion (auto-tourelle, tireur novice…). */
  spreadMult?: number;
  damageMult?: number;
  /** Point visé (obus en cloche). */
  tx?: number;
  tz?: number;
  /** Cible directe (arc Tesla de tourelle). */
  target?: Actor | null;
  fromTrain?: boolean;
  silent?: boolean;
}

interface Projectile {
  kind: 'bullet' | 'shell' | 'spit';
  x: number;
  y: number;
  z: number;
  px: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  dmg: number;
  weapon: WeaponDef;
  faction: Faction;
  owner: Actor | null;
  pierce: number;
  hit: Set<string>;
  color: THREE.Color;
  inside: boolean;
  /** Pour les obus : hauteur cible et gravité. */
  gravity: number;
}

const MAX_PROJ = 400;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const up = new THREE.Vector3(0, 0, 1);
const tmpDir = new THREE.Vector3();

export class Combat {
  private projectiles: Projectile[] = [];
  private tracers: THREE.InstancedMesh;
  private blobs: THREE.InstancedMesh;
  private flameTick = new Map<string, number>();

  constructor(scene: THREE.Scene, private host: CombatHost) {
    const tgeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    const tmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(tgeo, tmat, MAX_PROJ);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.tracers.setColorAt(0, new THREE.Color(1, 1, 1));
    const bgeo = new THREE.IcosahedronGeometry(0.2, 0);
    const bmat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.blobs = new THREE.InstancedMesh(bgeo, bmat, 120);
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    this.blobs.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.tracers, this.blobs);
  }

  clear(): void {
    this.projectiles.length = 0;
    this.tracers.count = 0;
    this.blobs.count = 0;
  }

  get count(): number {
    return this.projectiles.length;
  }

  /** Tire une arme. Retourne vrai si un tir a eu lieu. */
  fire(o: FireOpts): void {
    const w = o.weapon;
    const lvl = o.level ?? 0;
    const dmg = w.damage * (1 + 0.15 * lvl) * (o.damageMult ?? 1);
    const spread = w.spread * (o.spreadMult ?? 1);
    const h = this.host;
    if (!o.silent) h.audio.play(w.sound, { x: o.x, z: o.z, volume: o.faction === 'joueur' ? 0.8 : 0.6 });
    switch (w.kind) {
      case 'melee':
        this.melee(o, dmg);
        return;
      case 'arc':
        this.arc(o, dmg);
        return;
      case 'flame':
        this.flame(o, dmg);
        return;
    }
    if (w.kind === 'bullet' || w.kind === 'pellets') {
      h.fx.muzzle(o.x, o.y, o.z, o.yaw, w.color, w.kind === 'pellets' ? 1.3 : 1);
      h.lights.flash(o.x, o.y + 0.3, o.z, 0xffc070, 3, 7, 0.06);
    } else if (w.kind === 'shell') {
      h.fx.muzzle(o.x, o.y, o.z, o.yaw, 0xffa040, 1.8);
      h.lights.flash(o.x, o.y + 0.3, o.z, 0xffa040, 5, 10, 0.1);
      if (o.faction === 'joueur') h.shake(0.12);
    }
    const n = w.pellets ?? 1;
    for (let i = 0; i < n; i++) {
      if (this.projectiles.length >= MAX_PROJ) break;
      const a = o.yaw + (Math.random() - 0.5) * spread;
      const kind: Projectile['kind'] = w.kind === 'shell' ? 'shell' : w.kind === 'spit' ? 'spit' : 'bullet';
      const speed = kind === 'bullet' ? 95 : (w.speed ?? 20);
      let vy = 0;
      let gravity = 0;
      let life = w.range / speed;
      if (kind === 'shell' || kind === 'spit') {
        // tir en cloche vers le point visé
        const tx = o.tx ?? o.x + Math.sin(a) * w.range;
        const tz = o.tz ?? o.z + Math.cos(a) * w.range;
        const dist = Math.min(w.range, Math.max(2, Math.hypot(tx - o.x, tz - o.z)));
        life = dist / speed;
        gravity = kind === 'shell' ? 14 : 10;
        vy = (gravity * life) / 2 - (o.y - 0.3) / life;
      }
      const c = new THREE.Color(w.color);
      this.projectiles.push({
        kind,
        x: o.x,
        y: o.y,
        z: o.z,
        px: o.x,
        pz: o.z,
        vx: Math.sin(a) * speed,
        vy,
        vz: Math.cos(a) * speed,
        life,
        dmg,
        weapon: w,
        faction: o.faction,
        owner: o.owner,
        pierce: w.pierce ?? 1,
        hit: new Set(),
        color: c,
        inside: o.fromTrain ?? h.trainInside(o.x, o.z),
        gravity,
      });
    }
  }

  private src(o: FireOpts, kind: DamageSource['kind']): DamageSource {
    return { faction: o.faction, x: o.x, z: o.z, kind, weapon: o.weapon, knockback: o.weapon.knockback, burn: o.weapon.burn, slow: o.weapon.slow, attacker: o.owner, structureMult: o.weapon.structureMult };
  }

  private melee(o: FireOpts, dmg: number): void {
    const w = o.weapon;
    const arc = (w.arc ?? 1.6) / 2;
    let hitAny = false;
    for (const t of this.host.targets(o.faction)) {
      if (!t.alive) continue;
      const dx = t.x - o.x;
      const dz = t.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + t.radius) continue;
      const ang = Math.atan2(dx, dz);
      if (Math.abs(angleDiff(o.yaw, ang)) > arc && d > t.radius + 0.4) continue;
      this.applyDamage(t, dmg, this.src(o, 'melee'));
      hitAny = true;
    }
    if (hitAny) this.host.audio.play('hit', { x: o.x, z: o.z });
  }

  private arc(o: FireOpts, dmg: number): void {
    const w = o.weapon;
    const targets = this.host.targets(o.faction).filter((t) => t.alive);
    let first: Actor | null = o.target && o.target.alive ? o.target : null;
    if (!first) {
      let best = Infinity;
      for (const t of targets) {
        const dx = t.x - o.x;
        const dz = t.z - o.z;
        const d = Math.hypot(dx, dz);
        if (d > w.range) continue;
        const da = Math.abs(angleDiff(o.yaw, Math.atan2(dx, dz)));
        if (da > 0.45) continue;
        const score = d + da * 8;
        if (score < best && this.host.shotBlocked(o.x, o.z, t.x, t.z) >= 0.98) {
          best = score;
          first = t;
        }
      }
    }
    const fx = this.host.fx;
    if (!first) {
      // décharge dans le vide
      const ex = o.x + Math.sin(o.yaw) * w.range * 0.6;
      const ez = o.z + Math.cos(o.yaw) * w.range * 0.6;
      fx.electric(o.x, o.y, o.z, ex, 0.6, ez, w.color);
      return;
    }
    const hit = new Set<string>();
    let cur: Actor = first;
    let px = o.x;
    let py = o.y;
    let pz = o.z;
    let d = dmg;
    for (let k = 0; k < (w.chain ?? 1); k++) {
      fx.electric(px, py, pz, cur.x, cur.y + cur.height * 0.6, cur.z, w.color);
      this.applyDamage(cur, d, { ...this.src(o, 'arc'), x: px, z: pz, slow: 0.4 });
      hit.add(cur.id);
      px = cur.x;
      py = cur.y + cur.height * 0.6;
      pz = cur.z;
      d *= 0.85;
      let next: Actor | null = null;
      let best = 7.5;
      for (const t of targets) {
        if (hit.has(t.id) || !t.alive) continue;
        const dd = Math.hypot(t.x - px, t.z - pz);
        if (dd < best) {
          best = dd;
          next = t;
        }
      }
      if (!next) break;
      cur = next;
    }
    this.host.lights.flash(o.x, o.y + 0.5, o.z, 0x8fd8ff, 4, 10, 0.08);
  }

  private flame(o: FireOpts, dmg: number): void {
    const w = o.weapon;
    const half = w.spread / 2 + 0.12;
    const fx = this.host.fx;
    for (let i = 0; i < 3; i++) {
      const a = o.yaw + (Math.random() - 0.5) * w.spread;
      const sp = w.range * 1.9;
      fx.flame(o.x, o.y, o.z, Math.sin(a) * sp, Math.cos(a) * sp);
    }
    this.host.lights.flash(o.x, o.y + 0.5, o.z, 0xff8030, 3, 9, 0.12);
    for (const t of this.host.targets(o.faction)) {
      if (!t.alive) continue;
      const dx = t.x - o.x;
      const dz = t.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + t.radius) continue;
      if (Math.abs(angleDiff(o.yaw, Math.atan2(dx, dz))) > half) continue;
      const last = this.flameTick.get(t.id) ?? 0;
      const now = performance.now();
      if (now - last < 200) continue;
      this.flameTick.set(t.id, now);
      this.applyDamage(t, dmg, this.src(o, 'feu'));
    }
  }

  /** Applique des dégâts (gère brûlure, ralentissement, texte flottant). */
  applyDamage(t: Actor, amount: number, src: DamageSource): void {
    if (!t.alive || amount <= 0) return;
    t.damage(amount, src);
    if (src.burn) {
      t.burnT = 3;
      t.burnDps = Math.max(t.burnDps, src.burn);
    }
    if (src.slow) {
      t.slow = Math.max(t.slow, src.slow);
      t.slowT = 2;
    }
    if (src.faction === 'joueur') this.host.floatText(t.x, t.y + t.height + 0.3, t.z, String(Math.round(amount)), src.kind === 'feu' ? '#ff9a40' : src.kind === 'arc' ? '#8fd8ff' : '#ffe9a0', `dmg:${t.id}`);
    if (!t.alive) this.host.onKill(t, src);
  }

  explode(x: number, y: number, z: number, radius: number, dmg: number, src: DamageSource, puddle?: 'acid' | 'fire' | 'ice'): void {
    const h = this.host;
    if (puddle === 'acid') {
      h.fx.blood(x, y + 0.3, z, 0x9be22d, 10, h.groundSpeed() > 0);
      h.fx.puff(x, 0.4, z, 0x8ac030, 1.2, h.groundSpeed() > 0, 0.4);
    } else if (puddle === 'ice') {
      h.fx.sparks(x, y + 0.3, z, 10, 0xbfe8ff, h.groundSpeed() > 0);
    } else {
      h.fx.explosion(x, y, z, radius, h.groundSpeed() > 0);
      h.lights.flash(x, y + 1, z, 0xffa040, 8, radius * 5, 0.25);
      h.audio.play(radius > 2 ? 'explosion' : 'flame', { x, z, volume: 0.9 });
      h.shake(Math.min(0.6, radius * 0.08));
    }
    for (const t of h.targets(src.faction)) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d > radius + t.radius) continue;
      const f = 1 - Math.max(0, d - t.radius) / radius * 0.6;
      this.applyDamage(t, dmg * f, { ...src, x, z, kind: puddle === 'acid' ? 'acide' : 'explosion' });
    }
    // les tirs ennemis endommagent les wagons
    if (src.faction !== 'joueur') {
      const hit = h.trainHit(x - radius, z, x + radius, z) ?? h.trainHit(x, z - radius, x, z + radius);
      if (hit) h.damageTrain(hit.wagon, dmg * (src.structureMult ?? 1), src, x, z);
    }
    if (puddle) {
      h.addHazard({ kind: puddle === 'acid' ? 'acide' : puddle === 'fire' ? 'feu' : 'glace', x, z, r: Math.max(1.2, radius * 0.8), intensity: puddle === 'fire' ? 8 : puddle === 'acid' ? 6 : 0.5, ttl: 7, world: h.groundSpeed() > 0 });
    }
  }

  update(dt: number): void {
    const h = this.host;
    let ti = 0;
    let bi = 0;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.px = p.x;
      p.pz = p.z;
      const py = p.y;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (p.gravity) {
        p.vy -= p.gravity * dt;
        p.y += p.vy * dt;
      }
      p.life -= dt;
      let dead = false;
      let ex = p.x;
      let ez = p.z;
      // décor
      const tb = h.shotBlocked(p.px, p.pz, p.x, p.z);
      let tHit = tb < 1 && (p.kind === 'bullet' || p.y < 2.5) ? tb : 2;
      // coque du train (tirs extérieurs ennemis)
      let trainWagon = -1;
      if (p.faction !== 'joueur' && !p.inside) {
        const th = h.trainHit(p.px, p.pz, p.x, p.z);
        if (th && th.t < tHit && (p.kind === 'bullet' || p.y < 4.5)) {
          tHit = th.t;
          trainWagon = th.wagon;
        }
      }
      // acteurs
      let victim: Actor | null = null;
      let tv = tHit;
      if (p.kind === 'bullet' || p.y < 2.6) {
        for (const t of h.targets(p.faction)) {
          if (!t.alive || p.hit.has(t.id)) continue;
          // les tirs extérieurs n'atteignent pas l'intérieur du train (sauf wagons ouverts)
          if (t.onTrain && !p.inside && p.faction !== 'joueur' && h.trainInside(t.x, t.z) && trainWagon >= 0) continue;
          const tt = segmentCircle(p.px, p.pz, p.x, p.z, t.x, t.z, t.radius + (p.kind === 'bullet' ? 0.05 : 0.3));
          if (tt >= 0 && tt < tv) {
            tv = tt;
            victim = t;
          }
        }
      }
      if (victim) {
        ex = p.px + (p.x - p.px) * tv;
        ez = p.pz + (p.z - p.pz) * tv;
        if (p.kind === 'bullet') {
          this.applyDamage(victim, p.dmg, { faction: p.faction, x: p.px, z: p.pz, kind: 'balle', weapon: p.weapon, knockback: p.weapon.knockback, attacker: p.owner });
          h.fx.blood(ex, 1.1, ez, victim.faction === 'monstre' ? 0x4a6a2a : victim.faction === 'machine' ? 0xffc060 : 0x8a1010, 4, h.groundSpeed() > 0 && !victim.onTrain);
          p.hit.add(victim.id);
          p.pierce--;
          if (p.pierce <= 0) dead = true;
        } else {
          dead = true;
        }
      } else if (tHit <= 1) {
        ex = p.px + (p.x - p.px) * tHit;
        ez = p.pz + (p.z - p.pz) * tHit;
        dead = true;
        if (trainWagon >= 0 && p.kind === 'bullet') {
          h.damageTrain(trainWagon, p.dmg * (p.weapon.structureMult ?? 1), { faction: p.faction, x: p.px, z: p.pz, kind: 'balle', weapon: p.weapon }, ex, ez);
          h.fx.sparks(ex, 2, ez, 4);
          h.audio.play('hitMetal', { x: ex, z: ez, volume: 0.5 });
        } else if (p.kind === 'bullet') {
          h.fx.sparks(ex, 1, ez, 3, 0xffd080, h.groundSpeed() > 0);
        }
      }
      if (!dead && (p.life <= 0 || (p.gravity && p.y <= 0.2 && py > p.y))) {
        dead = true;
        ex = p.x;
        ez = p.z;
      }
      if (dead) {
        if (p.kind === 'shell' || p.kind === 'spit') {
          const w = p.weapon;
          this.explode(ex, Math.max(0.3, p.y), ez, w.splash ?? 1.2, p.dmg, { faction: p.faction, x: ex, z: ez, kind: 'explosion', weapon: w, knockback: w.knockback, burn: w.burn, slow: w.slow, attacker: p.owner, structureMult: w.structureMult }, w.puddle);
        }
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
        continue;
      }
      // rendu
      if (p.kind === 'bullet') {
        if (ti < MAX_PROJ) {
          tmpDir.set(p.vx, 0, p.vz).normalize();
          tmpQ.setFromUnitVectors(up, tmpDir);
          const len = 1.6;
          tmpP.set(p.x - tmpDir.x * len * 0.5, p.y, p.z - tmpDir.z * len * 0.5);
          tmpS.set(1, 1, len);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.tracers.setMatrixAt(ti, tmpM);
          this.tracers.setColorAt(ti, p.color);
          ti++;
        }
      } else if (bi < 120) {
        tmpP.set(p.x, p.y, p.z);
        tmpS.setScalar(p.kind === 'shell' ? 1 : 1.2);
        tmpM.compose(tmpP, tmpQ.identity(), tmpS);
        this.blobs.setMatrixAt(bi, tmpM);
        this.blobs.setColorAt(bi, p.kind === 'shell' ? tmpColor.setHex(0x2a2a2a) : p.color);
        bi++;
        if (Math.random() < 0.5) {
          if (p.kind === 'shell') h.fx.puff(p.x, p.y, p.z, 0x8a8680, 0.4, false, 0.35);
          else h.fx.glow.spawn({ x: p.x, y: p.y, z: p.z, life: 0.25, size0: 0.35, size1: 0.05, color0: p.color, alpha0: 0.8 });
        }
      }
    }
    this.tracers.count = ti;
    this.blobs.count = bi;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
    if (this.blobs.instanceColor) this.blobs.instanceColor.needsUpdate = true;
  }
}

const tmpColor = new THREE.Color();

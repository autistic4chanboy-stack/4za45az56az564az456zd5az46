import { ENEMIES, type EnemyDef, type EnemyId } from '../data/enemies';
import { WEAPONS, type WeaponDef } from '../data/weapons';
import { BAL, DIFFICULTIES } from '../data/balance';
import { Humanoid } from '../render/humanoid';
import { Creature } from '../render/creatures';
import { randomLook } from '../world/npcgen';
import { Rng } from '../core/rng';
import { angleDiff, clamp, dampAngle, rotateTowards } from '../core/math';
import { HALF_W, FLOOR } from '../train/trainModel';
import type { Actor, DamageSource, Faction } from './types';
import type { Game } from './Game';

export type EnemyMode = 'station' | 'assaut';
type AiState = 'idle' | 'patrol' | 'chase' | 'attack' | 'flee' | 'approach' | 'inside' | 'latched' | 'burrowed' | 'dead';

let enemyCounter = 0;

export class Enemy implements Actor {
  readonly id: string;
  readonly def: EnemyDef;
  x: number;
  y = 0;
  z: number;
  yaw = 0;
  radius: number;
  height: number;
  faction: Faction;
  hp: number;
  maxHp: number;
  alive = true;
  onTrain = false;
  flying: boolean;
  slow = 0;
  slowT = 0;
  burnT = 0;
  burnDps = 0;
  readonly model: Humanoid | Creature;
  readonly weapon: WeaponDef;
  dmgMult: number;
  ai: AiState = 'idle';
  homeX: number;
  homeZ: number;
  target: Actor | null = null;
  targetWagon = -1;
  side: -1 | 1 = 1;
  offsetX = 0;
  standoff = 2;
  private attackCd = 0;
  private path: { x: number; z: number }[] | null = null;
  private pathT = 0;
  private wanderT = 0;
  private wx = 0;
  private wz = 0;
  deadT = 0;
  latchedWagon = -1;
  private latchOffX = 0;
  hiddenFromTurrets = false;
  private burrowT = 0;
  litT = 0;
  /** Identifiant persistant (station) pour ne pas réapparaître après la mort. */
  persistId: string | null = null;
  group: string | null = null;
  private spawnCd = 8;
  boardChance = 0;
  private boardedDone = false;
  private sabotageT = 4;
  lootDone = false;
  alerted = false;
  private vx = 0;
  private vz = 0;
  private strafe = Math.random() < 0.5 ? -1 : 1;
  private strafeT = 0;
  private barkT = Math.random() * 5;
  threat: number;

  constructor(private game: Game, id: EnemyId, x: number, z: number, threat: number, readonly mode: EnemyMode, seed = Math.random() * 1e9) {
    const def = ENEMIES[id];
    this.def = def;
    this.id = `e${++enemyCounter}`;
    this.x = x;
    this.z = z;
    this.homeX = x;
    this.homeZ = z;
    this.threat = threat;
    this.radius = def.radius;
    this.height = def.model === 'humanoid' ? 1.75 * def.scale : def.model === 'hulk' ? 3.3 : def.model === 'behemoth' ? 6 : def.model === 'swarm' ? 2 : 1.2;
    this.faction = def.faction === 'bandit' ? 'bandit' : def.faction === 'machine' ? 'machine' : 'monstre';
    this.flying = !!def.flying;
    const diff = DIFFICULTIES[game.state.difficulty];
    this.maxHp = Math.round(def.hp * diff.enemyHp * (1 + BAL.enemyHpPerThreat * threat));
    this.hp = this.maxHp;
    this.dmgMult = diff.enemyDmg * (1 + BAL.enemyDmgPerThreat * threat);
    this.weapon = WEAPONS[def.weapon];
    if (def.model === 'humanoid') {
      const rng = new Rng(seed);
      const look = randomLook(rng, rng.chance(0.3));
      look.shirt = def.color;
      look.pants = def.color2;
      if (def.id === 'infecte') {
        look.skin = 0x8a9a7a;
        look.shirt = 0x6a6a5a;
      }
      const h = new Humanoid(look, { scale: def.scale, mask: def.faction === 'bandit' && rng.chance(0.35), armorColor: def.armor ? 0x3a3a3a : undefined });
      h.setWeapon(def.weapon === 'e_club' ? 'cle' : def.weapon === 'e_rifle' ? 'fusil_precision' : def.weapon === 'e_shotgun' ? 'fusil_pompe' : def.weapon === 'e_pistol' ? 'revolver' : def.weapon === 'e_molotov' ? null : null);
      this.model = h;
    } else {
      this.model = new Creature(def.model, def.color, def.color2, def.scale);
    }
    if (def.burrow && mode === 'assaut') {
      this.ai = 'burrowed';
      this.hiddenFromTurrets = true;
      (this.model as Creature).emerge = 0;
    }
    if (def.flying) this.y = 0;
    game.scene.add(this.model.root);
    this.model.root.position.set(x, 0, z);
  }

  get creature(): Creature | null {
    return this.model instanceof Creature ? this.model : null;
  }

  damage(amount: number, src: DamageSource): void {
    if (!this.alive) return;
    if (this.hiddenFromTurrets && this.ai === 'burrowed') return;
    let dmg = amount * (1 - (this.def.armor ?? 0) * (src.kind === 'explosion' ? 0.5 : 1));
    if (this.litT > 0) dmg *= 1.2;
    this.hp -= dmg;
    this.model.hurt();
    if (src.knockback && this.def.model !== 'behemoth' && this.def.model !== 'queen' && this.def.model !== 'camion' && this.def.model !== 'turret') {
      const dx = this.x - src.x;
      const dz = this.z - src.z;
      const d = Math.hypot(dx, dz) || 1;
      const k = src.knockback / Math.max(1, this.radius * 2);
      this.vx += (dx / d) * k;
      this.vz += (dz / d) * k;
    }
    if (!this.alerted) this.alert(src.attacker ?? null);
    if (this.hp <= 0) this.die(src);
  }

  alert(by: Actor | null): void {
    this.alerted = true;
    if (this.mode === 'station' && (this.ai === 'idle' || this.ai === 'patrol')) {
      this.ai = 'chase';
      this.target = by && by.alive ? by : this.game.player;
      this.game.alertGroup(this);
    }
  }

  private die(_src: DamageSource): void {
    this.alive = false;
    this.ai = 'dead';
    this.hp = 0;
    if (this.model instanceof Humanoid) this.model.pose = 'dead';
    else this.model.dead = true;
    this.game.audio.play(this.faction === 'monstre' ? 'monsterDie' : this.faction === 'machine' ? 'explosion' : 'humanDie', { x: this.x, z: this.z, volume: 0.7 });
    if (this.faction === 'machine' || this.def.model === 'buggy' || this.def.model === 'camion' || this.def.model === 'moto') {
      this.game.engine.fx.explosion(this.x, 1, this.z, this.def.model === 'moto' ? 1.5 : 3, this.game.groundSpeed() > 0);
    }
    this.latchedWagon = -1;
  }

  dispose(): void {
    this.game.scene.remove(this.model.root);
    this.model.dispose();
  }

  // ------------------------------------------------------------------ IA

  update(dt: number): void {
    const g = this.game;
    if (!this.alive) {
      this.deadT += dt;
      this.model.update(dt);
      if (!this.onTrain && g.groundSpeed() > 0) this.x -= g.groundSpeed() * dt;
      if (this.deadT > 3) this.model.root.position.y -= dt * 0.6;
      this.syncModel();
      return;
    }
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.hp -= this.burnDps * dt;
      if (Math.random() < dt * 10) g.engine.fx.flame(this.x, 0.8, this.z, 0, 0, !this.onTrain && g.groundSpeed() > 0);
      if (this.hp <= 0) {
        this.die({ faction: 'joueur', x: this.x, z: this.z, kind: 'feu' });
        g.onKill(this, { faction: 'joueur', x: this.x, z: this.z, kind: 'feu' });
        return;
      }
    }
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slow = 0;
    }
    this.litT = Math.max(0, this.litT - dt);
    this.attackCd -= dt;
    this.barkT -= dt;
    if (this.barkT <= 0) {
      this.barkT = 4 + Math.random() * 6;
      if (this.faction === 'monstre' && this.ai !== 'idle' && Math.random() < 0.5) g.audio.play('growl', { x: this.x, z: this.z, volume: 0.5, pitch: this.def.model === 'hulk' || this.def.model === 'behemoth' ? 0.5 : 1 + Math.random() * 0.4 });
    }
    if (this.mode === 'station') this.updateStation(dt);
    else this.updateAssault(dt);
    // amortissement des poussées
    this.vx *= Math.exp(-6 * dt);
    this.vz *= Math.exp(-6 * dt);
    this.model.update(dt);
    this.syncModel();
  }

  private syncModel(): void {
    this.model.root.position.set(this.x, this.y, this.z);
    this.model.root.rotation.y = this.yaw;
  }

  private moveSpeedStation(): number {
    const base = this.faction === 'bandit' ? this.def.speed * 0.75 : this.def.speed * 0.5;
    return Math.min(7.8, base) * (1 - this.slow);
  }

  /** Déplacement avec collisions vers (tx, tz). */
  private stepTowards(tx: number, tz: number, speed: number, dt: number): number {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const step = Math.min(d, speed * dt);
    let nx = this.x + (dx / d) * step + this.vx * dt;
    let nz = this.z + (dz / d) * step + this.vz * dt;
    const r = this.game.resolveMove(nx, nz, this.radius, this);
    nx = r.x;
    nz = r.z;
    this.x = nx;
    this.z = nz;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
    this.model.speed = speed;
    return d;
  }

  private canSee(t: Actor): boolean {
    return this.game.lineOfSight(this.x, this.z, t.x, t.z);
  }

  private attackActor(t: Actor, dt: number): void {
    const w = this.weapon;
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const desired = Math.atan2(dx, dz);
    this.yaw = rotateTowards(this.yaw, desired, 8 * dt);
    if (this.creature) this.creature.aimLocal(0);
    if (this.attackCd > 0) return;
    if (Math.abs(angleDiff(this.yaw, desired)) > 0.35) return;
    this.attackCd = 1 / w.rate * (0.8 + Math.random() * 0.4);
    this.model.attack();
    this.game.combat.fire({
      weapon: w,
      x: this.x + Math.sin(this.yaw) * (w.kind === 'melee' ? 0 : this.radius + 0.3),
      y: (this.flying ? this.y : 0) + (w.kind === 'melee' ? 1 : Math.min(2.5, this.height * 0.75)),
      z: this.z + Math.cos(this.yaw) * (w.kind === 'melee' ? 0 : this.radius + 0.3),
      yaw: this.yaw,
      faction: this.faction,
      owner: this,
      damageMult: this.dmgMult,
      tx: t.x,
      tz: t.z,
      fromTrain: this.onTrain,
    });
    if (this.def.infects && w.kind === 'melee' && Math.hypot(dx, dz) < w.range + t.radius && Math.random() < 0.15) {
      if (t === this.game.player) this.game.infectPlayer('infection');
      else this.game.infectActor(t, 'infection');
    }
  }

  // ------------------------------------------------------------------ en station

  private updateStation(dt: number): void {
    const g = this.game;
    const def = this.def;
    const speed = this.moveSpeedStation();
    if (def.model === 'turret') {
      this.updateSentinel(dt);
      return;
    }
    if (def.model === 'queen') this.spawnMinions(dt);
    switch (this.ai) {
      case 'idle':
      case 'patrol': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 3 + Math.random() * 5;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 5;
          this.wx = this.homeX + Math.cos(a) * r;
          this.wz = this.homeZ + Math.sin(a) * r;
        }
        if (Math.hypot(this.wx - this.x, this.wz - this.z) > 0.4) this.stepTowards(this.wx, this.wz, speed * 0.35, dt);
        else this.model.speed = 0;
        const t = g.nearestHostile(this, def.aggroRange);
        if (t && this.canSee(t)) {
          this.ai = 'chase';
          this.target = t;
          this.alerted = true;
          g.alertGroup(this);
          if (this.faction === 'monstre') g.audio.play('growl', { x: this.x, z: this.z, volume: 0.7 });
        }
        break;
      }
      case 'chase':
      case 'attack': {
        let t = this.target;
        if (!t || !t.alive) {
          t = g.nearestHostile(this, def.aggroRange * 1.5);
          this.target = t;
          if (!t) {
            this.ai = 'patrol';
            break;
          }
        }
        const d = Math.hypot(t.x - this.x, t.z - this.z);
        if (d > def.aggroRange * 2.5) {
          this.ai = 'patrol';
          this.target = null;
          break;
        }
        if (this.faction === 'bandit' && this.hp < this.maxHp * 0.25 && !def.boss && Math.random() < dt * 0.3) {
          this.ai = 'flee';
          break;
        }
        const ranged = this.weapon.kind !== 'melee';
        const range = ranged ? Math.min(this.weapon.range * 0.9, def.preferredRange ?? this.weapon.range * 0.7) : this.weapon.range + t.radius - 0.1;
        const visible = this.canSee(t);
        if (d <= (ranged ? this.weapon.range * 0.95 : range) && visible) {
          this.ai = 'attack';
          this.model.speed = 0;
          if (ranged) {
            // garde ses distances et se décale latéralement
            this.strafeT -= dt;
            if (this.strafeT <= 0) {
              this.strafeT = 1.5 + Math.random() * 2;
              this.strafe = -this.strafe as 1 | -1;
            }
            const ax = (t.x - this.x) / (d || 1);
            const az = (t.z - this.z) / (d || 1);
            let mx = -az * this.strafe * 0.6;
            let mz = ax * this.strafe * 0.6;
            if (d < range * 0.6) {
              mx -= ax;
              mz -= az;
            }
            this.stepTowards(this.x + mx, this.z + mz, speed * 0.5, dt);
          }
          this.attackActor(t, dt);
        } else {
          this.ai = 'chase';
          this.followPath(t.x, t.z, speed, dt);
        }
        break;
      }
      case 'flee': {
        const t = g.player;
        const dx = this.x - t.x;
        const dz = this.z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        this.stepTowards(this.x + (dx / d) * 3, this.z + (dz / d) * 3, speed, dt);
        if (d > 30) this.ai = 'patrol';
        break;
      }
      default:
        break;
    }
  }

  private followPath(tx: number, tz: number, speed: number, dt: number): void {
    const g = this.game;
    this.pathT -= dt;
    if (g.lineOfSight(this.x, this.z, tx, tz) && Math.hypot(tx - this.x, tz - this.z) < 18) {
      this.path = null;
      this.stepTowards(tx, tz, speed, dt);
      return;
    }
    if (!this.path || this.pathT <= 0) {
      this.pathT = 0.6 + Math.random() * 0.4;
      this.path = g.findPath(this.x, this.z, tx, tz);
    }
    if (this.path && this.path.length) {
      const p = this.path[0];
      const d = this.stepTowards(p.x, p.z, speed, dt);
      if (d < 0.6) this.path.shift();
    } else {
      this.stepTowards(tx, tz, speed, dt);
    }
  }

  private updateSentinel(dt: number): void {
    const g = this.game;
    const t = g.nearestHostile(this, this.def.aggroRange);
    if (t && this.canSee(t)) {
      const desired = Math.atan2(t.x - this.x, t.z - this.z);
      this.yaw = rotateTowards(this.yaw, desired, 2.2 * dt);
      if (this.creature) this.creature.aimLocal(0);
      if (Math.abs(angleDiff(this.yaw, desired)) < 0.15) this.attackActor(t, dt);
    } else {
      this.yaw += dt * 0.4;
    }
  }

  private spawnMinions(dt: number): void {
    if (!this.def.spawns) return;
    this.spawnCd -= dt;
    if (this.spawnCd > 0 || !this.alerted) return;
    this.spawnCd = this.def.model === 'camion' ? 9 : 7;
    const g = this.game;
    if (g.enemyCount() > 40) return;
    const n = this.def.model === 'behemoth' ? 2 : this.def.model === 'camion' ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = g.spawnEnemy(this.def.spawns, this.x + Math.cos(a) * (this.radius + 1.5), this.z + Math.sin(a) * (this.radius + 1.5), this.threat, this.mode);
      e.alerted = true;
      e.ai = this.mode === 'station' ? 'chase' : 'approach';
      e.target = g.player;
    }
  }

  // ------------------------------------------------------------------ attaque du train

  /** Choisit un wagon cible et un côté. */
  pickTrainTarget(): void {
    const g = this.game;
    const n = g.train.wagons.length;
    if (n === 0) return;
    const weights = g.train.wagons.map((w, i) => {
      let wt = 1;
      if (this.faction === 'bandit' && (w.state.type === 'fourgon' || w.state.type === 'tender')) wt += 1.5;
      if (this.faction === 'monstre' && (w.state.type === 'passagers' || w.state.type === 'restaurant')) wt += 1.2;
      if (i === 0) wt *= 0.6;
      return wt;
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    this.targetWagon = idx;
    const w = g.train.wagons[idx];
    this.offsetX = (Math.random() - 0.5) * (w.x1 - w.x0) * 0.7;
    if (this.boardChance > 0 && w.model.sideDoor !== null) this.offsetX = w.model.sideDoor;
    const ranged = this.weapon.kind !== 'melee';
    const vehicle = this.def.model === 'moto' || this.def.model === 'buggy' || this.def.model === 'camion';
    this.standoff = vehicle ? (this.def.model === 'camion' ? 4.5 : this.def.model === 'buggy' ? 5 + Math.random() * 4 : 2.5 + Math.random() * 3) : ranged ? 4 + Math.random() * ((this.def.preferredRange ?? 10) * 0.6) : this.radius + 0.25;
    if (this.boardChance > 0) this.standoff = 1.6;
  }

  private updateAssault(dt: number): void {
    const g = this.game;
    const def = this.def;
    const trainSpeed = g.groundSpeed();
    if (this.onTrain) {
      this.updateInside(dt);
      return;
    }
    if (def.spawns) this.spawnMinions(dt);
    if (this.targetWagon < 0 || !g.train.wagons[this.targetWagon]) this.pickTrainTarget();
    const w = g.train.wagons[this.targetWagon];
    if (!w) return;

    // accroché à un wagon
    if (this.ai === 'latched') {
      const lw = g.train.wagons[this.latchedWagon];
      if (!lw) {
        this.latchedWagon = -1;
        this.ai = 'approach';
      } else {
        this.x = lw.cx + this.latchOffX;
        this.z = this.side * (HALF_W + this.radius * 0.6);
        this.y = 1.3;
        this.yaw = this.side > 0 ? Math.PI : 0;
        this.model.speed = 2;
        if (this.attackCd <= 0) {
          this.attackCd = 1 / this.weapon.rate;
          this.model.attack();
          g.train.damageWagon(lw.index, this.weapon.damage * this.dmgMult * (this.weapon.structureMult ?? 1), { faction: this.faction, x: this.x, z: this.z, kind: 'melee' }, this.x, this.z);
          g.audio.play('bite', { x: this.x, z: this.z, volume: 0.4 });
        }
        return;
      }
    }

    // fouisseur : sous terre jusqu'au wagon
    if (this.ai === 'burrowed') {
      this.burrowT -= dt;
      const tx = w.cx + this.offsetX;
      const tz = this.side * (HALF_W + 2.2);
      this.moveRelative(tx, tz, def.speed, trainSpeed, dt);
      if (Math.random() < dt * 12) g.engine.fx.dust(this.x, this.z, 0x8a7a5a, trainSpeed > 0);
      if (Math.hypot(tx - this.x, tz - this.z) < 2 && this.burrowT <= 0) {
        this.ai = 'approach';
        this.hiddenFromTurrets = false;
        this.burrowT = 6 + Math.random() * 3;
        g.engine.fx.explosion(this.x, 0, this.z, 1.2, trainSpeed > 0);
      }
      const c = this.creature;
      if (c) c.emerge = Math.max(0, c.emerge - dt * 2);
      return;
    }
    if (def.burrow) {
      const c = this.creature;
      if (c) c.emerge = Math.min(1, c.emerge + dt * 2);
      this.burrowT -= dt;
      if (this.burrowT <= 0) {
        this.ai = 'burrowed';
        this.hiddenFromTurrets = true;
        this.burrowT = 2;
        this.pickTrainTarget();
        return;
      }
    }

    // le joueur à découvert (train arrêté ou wagon ouvert) devient une cible prioritaire
    const p = g.player;
    const playerExposed = p.alive && (!p.onTrain || g.train.wagons[g.train.wagonAt(p.x)]?.model.open);
    const dp = Math.hypot(p.x - this.x, p.z - this.z);
    if (playerExposed && dp < (this.weapon.kind === 'melee' ? 9 : this.weapon.range * 0.9) && trainSpeed < 3) {
      this.moveRelative(p.x, p.z, def.speed * 0.6, trainSpeed, dt, dp < this.weapon.range * 0.6);
      if (dp <= this.weapon.range + p.radius) this.attackActor(p, dt);
      return;
    }

    const tx = w.cx + this.offsetX;
    const tz = this.side * (HALF_W + this.standoff);
    const ty = this.flying ? 4.5 + Math.sin(performance.now() / 400 + this.offsetX) * 0.8 : 0;
    if (this.flying) this.y += (ty - this.y) * (1 - Math.exp(-2 * dt));
    const dist = this.moveRelative(tx, tz, def.speed * (1 - this.slow) * (this.litT > 0 && def.fearLight ? 0.6 : 1), trainSpeed, dt);
    const inRange = dist < (this.weapon.kind === 'melee' ? 1.2 + this.radius : 3.5);
    if (!inRange) {
      if (this.creature) this.creature.aimLocal(0);
      return;
    }
    // abordage
    if (this.boardChance > 0 && !this.boardedDone && w.model.sideDoor !== null && trainSpeed < 15) {
      this.boardedDone = true;
      if (Math.random() < this.boardChance) {
        g.boardTrain(this, w.index);
        return;
      }
    }
    if (def.latch) {
      this.ai = 'latched';
      this.latchedWagon = w.index;
      this.latchOffX = clamp(this.x - w.cx, -(w.x1 - w.x0) / 2 + 0.5, (w.x1 - w.x0) / 2 - 0.5);
      return;
    }
    // attaque de la structure
    const aimX = w.cx + this.offsetX;
    const aimZ = this.side * (HALF_W - 0.5);
    const desired = Math.atan2(aimX - this.x, aimZ - this.z);
    if (this.creature && (def.model === 'buggy' || def.model === 'camion')) {
      this.creature.aimLocal(angleDiff(this.yaw, desired));
    } else {
      this.yaw = rotateTowards(this.yaw, desired, 6 * dt);
    }
    if (this.attackCd <= 0) {
      this.attackCd = 1 / this.weapon.rate * (0.8 + Math.random() * 0.4);
      this.model.attack();
      if (this.weapon.kind === 'melee') {
        const mult = def.model === 'hulk' || def.model === 'behemoth' ? 1 : 1;
        g.train.damageWagon(w.index, this.weapon.damage * this.dmgMult * (this.weapon.structureMult ?? 1) * mult, { faction: this.faction, x: this.x, z: this.z, kind: 'melee', slow: this.weapon.slow }, aimX, aimZ);
        g.engine.fx.sparks(aimX, 1.8, aimZ, 3);
        if (def.model === 'hulk' || def.model === 'behemoth') {
          g.engine.rig.shake(0.25);
          g.audio.play('hitMetal', { x: aimX, z: aimZ, pitch: 0.5 });
        } else g.audio.play('bite', { x: aimX, z: aimZ, volume: 0.4 });
      } else {
        const yaw = Math.atan2(aimX - this.x, aimZ - this.z);
        g.combat.fire({
          weapon: this.weapon,
          x: this.x + Math.sin(yaw) * (this.radius + 0.4),
          y: Math.max(1.2, this.y + this.height * 0.6),
          z: this.z + Math.cos(yaw) * (this.radius + 0.4),
          yaw,
          faction: this.faction,
          owner: this,
          damageMult: this.dmgMult,
          tx: aimX,
          tz: aimZ,
        });
      }
    }
  }

  /**
   * Déplacement dans le repère du train : la vitesse sol est limitée par la vitesse de la créature.
   * Un train plus rapide que l'ennemi le distance naturellement.
   */
  private moveRelative(tx: number, tz: number, maxGround: number, trainSpeed: number, dt: number, backOff = false): number {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    const want = backOff ? -1 : Math.min(1, d / 2);
    let rvx = d > 0.01 ? (dx / d) * maxGround * want : 0;
    let rvz = d > 0.01 ? (dz / d) * maxGround * want : 0;
    // vitesse sol = vitesse relative + vitesse du train
    let gvx = rvx + trainSpeed;
    let gvz = rvz;
    const gs = Math.hypot(gvx, gvz);
    if (gs > maxGround) {
      gvx = (gvx / gs) * maxGround;
      gvz = (gvz / gs) * maxGround;
    }
    rvx = gvx - trainSpeed;
    rvz = gvz;
    let nx = this.x + (rvx + this.vx) * dt;
    let nz = this.z + (rvz + this.vz) * dt;
    // ne jamais traverser le train
    if (!this.flying && Math.abs(nz) < HALF_W + this.radius && nx < this.game.train.frontX + 1 && nx > this.game.train.rearX) {
      nz = Math.sign(this.z || 1) * (HALF_W + this.radius);
    }
    this.x = nx;
    this.z = nz;
    const groundSpeed = Math.hypot(gvx, gvz);
    this.model.speed = groundSpeed;
    if (groundSpeed > 0.5) {
      const heading = Math.atan2(gvx, gvz);
      this.yaw = dampAngle(this.yaw, heading, 6, dt);
    }
    if (trainSpeed > 0 && !this.flying && groundSpeed > 4 && Math.random() < dt * 6) this.game.engine.fx.dust(this.x, this.z, 0x9a8a70, true);
    return d;
  }

  // ------------------------------------------------------------------ à bord

  /** Place l'ennemi à bord, à la porte du wagon. */
  board(wagonIndex: number): void {
    const g = this.game;
    const w = g.train.wagons[wagonIndex];
    if (!w) return;
    this.onTrain = true;
    this.ai = 'inside';
    const door = w.model.sideDoor ?? 0;
    this.x = w.cx + door;
    this.z = this.side * (HALF_W - 0.6);
    this.y = FLOOR;
    this.targetWagon = wagonIndex;
  }

  private updateInside(dt: number): void {
    const g = this.game;
    this.y = FLOOR;
    let t = this.target;
    if (!t || !t.alive || !t.onTrain) {
      t = g.nearestHostile(this, 60, true);
      this.target = t;
    }
    const speed = 3.6 * (1 - this.slow);
    if (t) {
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d <= this.weapon.range + t.radius - 0.1 || (this.weapon.kind !== 'melee' && d < 8 && g.lineOfSight(this.x, this.z, t.x, t.z))) {
        this.model.speed = 0;
        this.attackActor(t, dt);
      } else {
        this.moveAlongAisle(t.x, t.z, speed, dt);
      }
    } else {
      // sabotage : endommage le wagon où il se trouve
      this.sabotageT -= dt;
      const wi = g.train.wagonAt(this.x);
      if (this.sabotageT <= 0 && wi >= 0) {
        this.sabotageT = 2.5;
        this.model.attack();
        g.train.damageWagon(wi, 12 * this.dmgMult, { faction: this.faction, x: this.x, z: this.z, kind: 'melee' }, this.x, this.z);
      }
      this.model.speed = 0;
    }
  }

  private moveAlongAisle(tx: number, tz: number, speed: number, dt: number): void {
    // suit l'allée centrale (z ≈ 0) tant que la cible est dans un autre compartiment
    if (Math.abs(tx - this.x) > 2.5) {
      if (Math.abs(this.z) > 0.3) this.stepTowards(this.x + Math.sign(tx - this.x) * 0.4, 0, speed, dt);
      else this.stepTowards(this.x + Math.sign(tx - this.x) * 2, 0, speed, dt);
    } else {
      this.stepTowards(tx, tz, speed, dt);
    }
  }
}

import { Humanoid } from '../render/humanoid';
import { PERSONALITIES, BARKS } from '../data/npcs';
import { WEAPONS } from '../data/weapons';
import { WAGON_TYPES, EQUIPMENT } from '../data/train';
import { BAL } from '../data/balance';
import { dampAngle, rotateTowards, angleDiff } from '../core/math';
import { FLOOR } from '../train/trainModel';
import { wagonMaxHp } from '../state/trainState';
import type { Actor, DamageSource } from './types';
import type { Game } from './Game';
import type { NpcState } from '../state/types';
import type { Spot } from '../train/trainModel';
import type { Enemy } from './enemy';

type Task = 'idle' | 'goto' | 'work' | 'flee' | 'fight' | 'repair' | 'heal' | 'follow' | 'cower';

interface Waypoint {
  x: number;
  z: number;
}

/** Acteur 3D d'un PNJ (équipage, passager, résident, escorte). */
export class NpcActor implements Actor {
  readonly id: string;
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  radius = 0.33;
  height = 1.75;
  faction: 'joueur' | 'neutre' = 'neutre';
  alive = true;
  onTrain = false;
  slow = 0;
  slowT = 0;
  burnT = 0;
  burnDps = 0;
  model: Humanoid;
  task: Task = 'idle';
  private path: Waypoint[] = [];
  private spotWagon = -1;
  private spotIndex = -1;
  private repathT = 0;
  private attackCd = 0;
  bubble: string | null = null;
  bubbleT = 0;
  private orderDelay = 0;
  private pendingOrder: (() => void) | null = null;
  homeX = 0;
  homeZ = 0;
  private wanderT = Math.random() * 6;
  talking = false;
  private workT = 0;
  /** Cible de travail (wagon à réparer, PNJ à soigner…). */
  private workTarget: { wagon: number; kind: 'coque' | 'composant' | 'feu' } | null = null;
  private healTarget: NpcActor | null = null;
  private coughT = 5 + Math.random() * 10;

  constructor(private game: Game, public data: NpcState) {
    this.id = data.id;
    this.model = new Humanoid(data.look);
    this.model.setWeapon(null);
    game.scene.add(this.model.root);
    this.refreshFaction();
  }

  refreshFaction(): void {
    const s = this.data.status;
    this.faction = s === 'equipage' || s === 'passager' ? 'joueur' : 'neutre';
  }

  get hp(): number {
    return this.data.hp;
  }

  set hp(v: number) {
    this.data.hp = v;
  }

  get maxHp(): number {
    return this.data.maxHp;
  }

  get personality() {
    return PERSONALITIES[this.data.personality];
  }

  say(text: string, dur = 3.5): void {
    this.bubble = text;
    this.bubbleT = dur;
  }

  bark(kind: keyof typeof BARKS, chance = 1): void {
    if (this.bubbleT > 0 || Math.random() > chance) return;
    const list = BARKS[kind];
    this.say(list[Math.floor(Math.random() * list.length)]);
  }

  damage(amount: number, src: DamageSource): void {
    if (!this.alive) return;
    this.data.hp = Math.max(0, this.data.hp - amount);
    this.model.hurt();
    if (src.kind === 'balle' || src.kind === 'melee' || src.kind === 'explosion') this.bark('hurt', 0.5);
    if (src.infects && !this.data.disease && Math.random() < 0.2) this.game.infectActor(this, 'infection');
    if (this.data.hp <= 0) {
      this.alive = false;
      this.model.pose = 'dead';
      this.game.onNpcDeath(this, src);
    }
  }

  teleport(x: number, z: number, y?: number): void {
    this.x = x;
    this.z = z;
    this.y = y ?? this.game.floorY(x, z);
    this.path = [];
    this.sync();
  }

  dispose(): void {
    this.releaseSpot();
    this.game.scene.remove(this.model.root);
    this.model.dispose();
  }

  private sync(): void {
    this.model.root.position.set(this.x, this.y, this.z);
    this.model.root.rotation.y = this.yaw;
  }

  // ------------------------------------------------------------------ ordres

  /** Ordre du joueur : exécuté après un délai qui dépend du caractère. */
  order(fn: () => void, label: string): boolean {
    const p = this.personality;
    const accept = this.game.npcObeys(this.data, label);
    if (!accept) {
      this.say(p.refuse[Math.floor(Math.random() * p.refuse.length)], 4);
      this.game.audio.play('error', { volume: 0.4 });
      return false;
    }
    this.say(p.accept[Math.floor(Math.random() * p.accept.length)], 3);
    this.orderDelay = p.delay * (0.6 + Math.random() * 0.8);
    this.pendingOrder = fn;
    return true;
  }

  // ------------------------------------------------------------------ emplacements dans le train

  private releaseSpot(): void {
    const w = this.game.train.wagons[this.spotWagon];
    if (w && this.spotIndex >= 0 && w.spotUsers[this.spotIndex] === this.id) w.spotUsers[this.spotIndex] = null;
    this.spotWagon = -1;
    this.spotIndex = -1;
  }

  private claimSpot(wagonIndex: number, filter: (s: Spot) => boolean): Spot | null {
    const w = this.game.train.wagons[wagonIndex];
    if (!w) return null;
    if (this.spotWagon === wagonIndex && this.spotIndex >= 0 && filter(w.model.spots[this.spotIndex])) return w.model.spots[this.spotIndex];
    this.releaseSpot();
    const free = w.model.spots.findIndex((s, i) => filter(s) && (w.spotUsers[i] === null || w.spotUsers[i] === this.id));
    if (free < 0) return null;
    w.spotUsers[free] = this.id;
    this.spotWagon = wagonIndex;
    this.spotIndex = free;
    return w.model.spots[free];
  }

  private wagonIndexOf(uid: string | null): number {
    if (!uid) return -1;
    return this.game.train.wagons.findIndex((w) => w.state.uid === uid);
  }

  /** Construit un chemin le long de l'allée centrale. */
  private planTrainPath(tx: number, tz: number): void {
    const pts: Waypoint[] = [];
    if (Math.abs(tx - this.x) > 1.2) {
      if (Math.abs(this.z) > 0.35) pts.push({ x: this.x, z: 0 });
      pts.push({ x: tx, z: 0 });
    }
    pts.push({ x: tx, z: tz });
    this.path = pts;
  }

  private walk(dt: number, speed: number): boolean {
    if (this.path.length === 0) return true;
    const p = this.path[0];
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) {
      this.path.shift();
      return this.path.length === 0;
    }
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
    this.model.speed = speed;
    this.model.pose = 'walk';
    return false;
  }

  // ------------------------------------------------------------------ mise à jour

  update(dt: number): void {
    if (!this.alive) {
      this.model.update(dt);
      this.sync();
      return;
    }
    this.bubbleT = Math.max(0, this.bubbleT - dt);
    if (this.bubbleT <= 0) this.bubble = null;
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slow = 0;
    }
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.data.hp -= this.burnDps * dt;
      if (this.data.hp <= 0) this.damage(1, { faction: 'bandit', x: this.x, z: this.z, kind: 'feu' });
    }
    if (this.orderDelay > 0) {
      this.orderDelay -= dt;
      if (this.orderDelay <= 0 && this.pendingOrder) {
        const f = this.pendingOrder;
        this.pendingOrder = null;
        f();
      }
    }
    // toux des malades
    if (this.data.disease && this.data.disease.incubation <= 0) {
      this.coughT -= dt;
      if (this.coughT <= 0) {
        this.coughT = 6 + Math.random() * 12 * (1 - this.data.disease.severity);
        this.game.audio.play('cough', { x: this.x, z: this.z, volume: 0.35 });
        this.bark('sick', 0.4);
      }
    }
    this.model.speed = 0;
    const s = this.data.status;
    if (this.talking) {
      const p = this.game.player;
      this.yaw = dampAngle(this.yaw, Math.atan2(p.x - this.x, p.z - this.z), 8, dt);
      this.model.pose = 'stand';
    } else if (s === 'resident' || s === 'parti') {
      this.updateResident(dt);
    } else if (this.data.job === 'suivre' && !this.game.isTravelling() && this.game.followersActive()) {
      this.updateFollower(dt);
    } else {
      this.updateOnTrain(dt);
    }
    this.onTrain = this.game.train.isInside(this.x, this.z);
    this.model.update(dt);
    this.sync();
  }

  private updateResident(dt: number): void {
    this.wanderT -= dt;
    if (this.path.length) {
      if (this.walkLevel(dt, 1.4)) this.path = [];
      return;
    }
    this.model.pose = this.data.trader ? 'stand' : 'stand';
    if (this.wanderT <= 0) {
      this.wanderT = 5 + Math.random() * 8;
      if (!this.data.trader && Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 3;
        const tx = this.homeX + Math.cos(a) * r;
        const tz = this.homeZ + Math.sin(a) * r;
        if (!this.game.levelBlocked(tx, tz, this.radius)) this.path = [{ x: tx, z: tz }];
      } else {
        this.yaw += (Math.random() - 0.5) * 1.5;
      }
    }
    const p = this.game.player;
    if (Math.hypot(p.x - this.x, p.z - this.z) < 4) this.yaw = dampAngle(this.yaw, Math.atan2(p.x - this.x, p.z - this.z), 3, dt);
  }

  private walkLevel(dt: number, speed: number): boolean {
    if (this.path.length === 0) return true;
    const p = this.path[0];
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      this.path.shift();
      return this.path.length === 0;
    }
    const step = Math.min(d, speed * dt);
    const r = this.game.resolveMove(this.x + (dx / d) * step, this.z + (dz / d) * step, this.radius, this);
    this.x = r.x;
    this.z = r.z;
    this.y += (this.game.floorY(this.x, this.z) - this.y) * Math.min(1, dt * 12);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
    this.model.speed = speed;
    this.model.pose = 'walk';
    return false;
  }

  private updateFollower(dt: number): void {
    const g = this.game;
    const p = g.player;
    this.attackCd -= dt;
    // combat
    const enemy = g.nearestEnemyTo(this.x, this.z, 16);
    const brave = this.personality.bravery > 0.4 || this.data.skill === 'garde' || this.data.secret === 'veteran';
    if (enemy && brave && g.lineOfSight(this.x, this.z, enemy.x, enemy.z)) {
      const w = WEAPONS[this.data.weapon] ?? WEAPONS.revolver;
      const d = Math.hypot(enemy.x - this.x, enemy.z - this.z);
      const desired = Math.atan2(enemy.x - this.x, enemy.z - this.z);
      this.yaw = rotateTowards(this.yaw, desired, 8 * dt);
      this.model.setWeapon(w.id);
      this.model.pose = 'aim';
      if (d < w.range * 0.9 && this.attackCd <= 0 && Math.abs(angleDiff(this.yaw, desired)) < 0.2) {
        const skill = this.data.skill === 'garde' || this.data.skill === 'tireur' ? 1 : 0.6;
        this.attackCd = (1 / w.rate) * (1.4 - skill * 0.4);
        this.model.attack();
        g.combat.fire({
          weapon: w,
          x: this.x + Math.sin(this.yaw) * 0.6,
          y: this.y + 1.3,
          z: this.z + Math.cos(this.yaw) * 0.6,
          yaw: this.yaw,
          faction: 'joueur',
          owner: this,
          spreadMult: 1.6 - skill * 0.6,
          damageMult: 0.55 + skill * 0.35 + (this.data.secret === 'veteran' ? 0.3 : 0),
          tx: enemy.x,
          tz: enemy.z,
          silent: false,
        });
        if (w.ammo) g.state.train.resources[w.ammo] = Math.max(0, (g.state.train.resources[w.ammo] ?? 0) - 0.25);
      }
      if (d < 3) this.stepAway(enemy, dt);
      return;
    }
    this.model.setWeapon(null);
    if (enemy && !brave) {
      this.stepAway(enemy, dt);
      this.model.pose = 'walk';
      return;
    }
    const d = Math.hypot(p.x - this.x, p.z - this.z);
    if (d > 2.6) {
      this.repathT -= dt;
      if (this.repathT <= 0 || this.path.length === 0) {
        this.repathT = 0.5;
        if (g.lineOfSight(this.x, this.z, p.x, p.z) || d < 4) this.path = [{ x: p.x - Math.sin(p.yaw) * 1.8, z: p.z - Math.cos(p.yaw) * 1.8 }];
        else this.path = g.findPath(this.x, this.z, p.x, p.z) ?? [{ x: p.x, z: p.z }];
      }
      this.walkLevel(dt, d > 8 ? 6.5 : 4.4);
      if (d > 35) this.teleport(p.x - 1, p.z + 1);
    } else {
      this.path = [];
      this.model.pose = 'stand';
      this.yaw = dampAngle(this.yaw, p.yaw, 3, dt);
    }
  }

  private stepAway(enemy: Actor, dt: number): void {
    const dx = this.x - enemy.x;
    const dz = this.z - enemy.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = this.game.resolveMove(this.x + (dx / d) * 3 * dt, this.z + (dz / d) * 3 * dt, this.radius, this);
    this.x = r.x;
    this.z = r.z;
  }

  /** IA à bord du train. */
  private updateOnTrain(dt: number): void {
    const g = this.game;
    const train = g.train;
    const st = this.data;
    this.y = FLOOR;
    let wi = this.wagonIndexOf(st.wagon);
    if (wi < 0) {
      wi = Math.min(2, train.wagons.length - 1);
      st.wagon = train.wagons[wi]?.state.uid ?? null;
    }
    const inCombat = g.inCombat;
    // ennemis à bord : combattre ou fuir
    const boarder = g.boarderNear(this.x, 12);
    if (boarder) {
      const fighter = st.job === 'garde' || st.skill === 'garde' || st.personality === 'courageux' || st.personality === 'colerique' || st.secret === 'veteran';
      if (fighter) {
        this.fightBoarder(boarder, dt);
        return;
      }
      this.task = 'flee';
    }
    // panique : les peureux se cachent pendant les combats et dans le noir
    if (inCombat && (st.personality === 'peureux' || st.morale < 20) && st.job !== 'prisonnier') {
      const safe = g.safestWagon();
      if (this.task !== 'cower' || this.spotWagon !== safe) {
        const w = train.wagons[safe];
        if (w) {
          this.releaseSpot();
          this.task = 'cower';
          this.planTrainPath(w.cx + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 0.8);
          this.spotWagon = safe;
          this.bark('combat', 0.3);
          if (st.personality === 'peureux') this.say(this.personality.scared[Math.floor(Math.random() * this.personality.scared.length)]);
        }
      }
      if (this.walk(dt, 3.2)) this.model.pose = 'cower';
      return;
    }
    if (this.task === 'flee' && !boarder) this.task = 'idle';
    if (this.task === 'flee' && boarder) {
      const away = boarder.x > this.x ? -1 : 1;
      this.planTrainPath(this.x + away * 8, 0);
      this.walk(dt, 3.4);
      return;
    }
    if (this.task === 'cower') this.task = 'idle';

    // travail selon le poste
    switch (st.job) {
      case 'mecanicien':
        if (this.doRepairs(dt)) return;
        break;
      case 'medecin':
        if (this.doHealing(dt)) return;
        break;
      case 'tireur': {
        const [uid, si] = (st.jobTarget ?? '').split(':');
        const twi = this.wagonIndexOf(uid);
        const tw = train.wagons[twi];
        const slot = tw?.state.slots[Number(si)];
        if (tw && slot && slot.equip && EQUIPMENT[slot.equip].weapon) {
          if (inCombat && st.personality === 'peureux' && st.affinity < 50) break;
          const p = train.pointWorld(tw, `gun${si}`);
          if (p) {
            if (Math.hypot(p.x - this.x, p.z - this.z) > 0.3) {
              if (this.path.length === 0) this.planTrainPath(p.x, p.z);
              this.walk(dt, 3.2);
              if (slot.gunner === this.id) slot.gunner = null;
            } else {
              this.model.pose = 'aim';
              this.model.setWeapon('fusil_precision');
              if (slot.gunner !== 'joueur') slot.gunner = this.id;
              const turret = tw.turrets.find((t) => t.slotIndex === Number(si));
              if (turret) this.yaw = dampAngle(this.yaw, turret.yaw, 5, dt);
            }
            return;
          }
        }
        break;
      }
    }
    this.model.setWeapon(null);
    // emplacement de repos ou de poste
    const night = g.isNight();
    const kindFor = (s: Spot): boolean => {
      switch (st.job) {
        case 'chauffeur':
          return s.kind === 'chauffe';
        case 'cuisinier':
          return s.kind === 'cuisine';
        case 'jardinier':
          return s.kind === 'serre';
        case 'prisonnier':
          return s.kind === 'cellule';
        case 'medecin':
          return s.kind === 'soin' && s.pose !== 'lie';
        case 'mecanicien':
          return s.kind === 'atelier' || s.kind === 'debout';
        default:
          return night || st.hp < st.maxHp * 0.5 || (st.disease && st.disease.incubation <= 0) ? s.kind === 'lit' || s.kind === 'soin' : s.kind !== 'chauffe' && s.kind !== 'cellule' && s.kind !== 'cuisine';
      }
    };
    let targetWagon = wi;
    if (st.job === 'chauffeur') targetWagon = 0;
    else if (st.job === 'cuisinier') targetWagon = Math.max(0, train.wagons.findIndex((w) => w.state.type === 'restaurant'));
    else if (st.job === 'jardinier') targetWagon = Math.max(0, train.wagons.findIndex((w) => w.state.type === 'serre'));
    else if (st.job === 'prisonnier') targetWagon = Math.max(0, train.wagons.findIndex((w) => w.state.type === 'cellule'));
    else if (st.job === 'medecin' && train.wagons.some((w) => w.state.type === 'infirmerie')) targetWagon = train.wagons.findIndex((w) => w.state.type === 'infirmerie');
    else if (st.job === 'garde') {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || this.spotWagon < 0) {
        this.wanderT = 12 + Math.random() * 10;
        targetWagon = Math.floor(Math.random() * train.wagons.length);
        this.releaseSpot();
        this.spotWagon = targetWagon;
      } else targetWagon = this.spotWagon;
    }
    let spot = this.claimSpot(targetWagon, kindFor);
    if (!spot) spot = this.claimSpot(targetWagon, (s) => s.kind === 'debout' || s.kind === 'siege' || s.kind === 'lit');
    const w = train.wagons[targetWagon];
    if (!w) return;
    let tx = w.cx;
    let tz = 0;
    let pose: 'stand' | 'sit' | 'lie' | 'work' = 'stand';
    let ty = FLOOR;
    let tyaw = this.yaw;
    if (spot) {
      tx = w.cx + spot.x;
      tz = spot.z;
      pose = spot.pose;
      ty = spot.y ?? FLOOR;
      tyaw = spot.yaw;
      if (pose === 'lie' && !night && st.hp > st.maxHp * 0.5 && !(st.disease && st.disease.incubation <= 0)) pose = 'sit';
    } else {
      tx = w.cx + ((this.id.charCodeAt(this.id.length - 1) % 5) - 2) * 1.2;
      tz = 0.3;
    }
    const d = Math.hypot(tx - this.x, tz - this.z);
    if (d > 0.15) {
      if (this.path.length === 0 || Math.hypot(this.path[this.path.length - 1].x - tx, this.path[this.path.length - 1].z - tz) > 0.5) this.planTrainPath(tx, tz);
      this.walk(dt, 2.6 * (1 - this.slow));
    } else {
      this.x = tx;
      this.z = tz;
      this.y = pose === 'lie' || pose === 'sit' ? ty : FLOOR;
      this.yaw = dampAngle(this.yaw, tyaw, 6, dt);
      this.model.pose = pose;
      if (st.job === 'chauffeur' && pose === 'work') {
        this.workT -= dt;
        if (this.workT <= 0) {
          this.workT = 2.5 + Math.random();
          if (g.trainMoving()) g.audio.play('shovel', { x: this.x, z: this.z, volume: 0.35 });
        }
      }
    }
    // remarques
    this.wanderT -= dt;
    if (this.wanderT <= 0 && this.bubbleT <= 0) {
      this.wanderT = 25 + Math.random() * 40;
      g.npcAmbientBark(this);
    }
  }

  private fightBoarder(e: Enemy, dt: number): void {
    const g = this.game;
    const w = WEAPONS[this.data.weapon] ?? WEAPONS.revolver;
    const d = Math.hypot(e.x - this.x, e.z - this.z);
    this.model.setWeapon(w.id);
    if (d > Math.min(6, w.range * 0.5)) {
      this.planTrainPath(e.x, e.z);
      this.walk(dt, 3.5);
      return;
    }
    const desired = Math.atan2(e.x - this.x, e.z - this.z);
    this.yaw = rotateTowards(this.yaw, desired, 8 * dt);
    this.model.pose = 'aim';
    this.attackCd -= dt;
    if (this.attackCd <= 0) {
      this.attackCd = 1 / w.rate * 1.3;
      this.model.attack();
      g.combat.fire({ weapon: w, x: this.x, y: this.y + 1.3, z: this.z, yaw: this.yaw, faction: 'joueur', owner: this, spreadMult: 1.3, damageMult: 0.7 + (this.data.skill === 'garde' ? 0.4 : 0), fromTrain: true });
    }
  }

  /** Mécanicien : éteint les feux, répare composants et coques. */
  private doRepairs(dt: number): boolean {
    const g = this.game;
    const train = g.train;
    const res = g.state.train.resources;
    if (!this.workTarget || this.workT <= 0) {
      this.workT = 3;
      this.workTarget = null;
      let best = Infinity;
      for (const w of train.wagons) {
        const st = w.state;
        const maxHp = wagonMaxHp(g.state, st);
        let prio = -1;
        let kind: 'coque' | 'composant' | 'feu' = 'coque';
        if (st.fire > 0) {
          prio = 100;
          kind = 'feu';
        } else if (st.slots.some((s) => s.equip && s.hp < EQUIPMENT[s.equip].hp) || st.heater.hp < 100 || st.lights.hp < 100) {
          prio = 40;
          kind = 'composant';
        } else if (st.hp < maxHp * 0.92) {
          prio = 30 * (1 - st.hp / maxHp) + 10;
        }
        if (prio < 0) continue;
        if (kind !== 'feu' && (res.ferraille ?? 0) < 1) continue;
        const score = Math.abs(w.cx - this.x) * 0.3 - prio;
        if (score < best) {
          best = score;
          this.workTarget = { wagon: w.index, kind };
        }
      }
    }
    this.workT -= dt;
    if (!this.workTarget) return false;
    const w = train.wagons[this.workTarget.wagon];
    if (!w) {
      this.workTarget = null;
      return false;
    }
    const tx = w.cx + (this.workTarget.kind === 'feu' ? 0 : (w.model.points.maintenance?.x ?? 0));
    const tz = 0.4;
    if (Math.hypot(tx - this.x, tz - this.z) > 0.6) {
      if (this.path.length === 0) this.planTrainPath(tx, tz);
      this.walk(dt, 3.3);
      return true;
    }
    this.model.pose = 'work';
    this.workT = 1;
    const eff = (this.data.skill === 'mecanicien' || this.data.skill === 'ingenieur' ? 1 + 0.25 * (this.data.skillLevel - 1) : 0.45) * (this.data.morale > 70 ? 1.1 : this.data.morale < 25 ? 0.7 : 1);
    if (Math.random() < dt * 4) g.engine.fx.sparks(this.x + Math.sin(this.yaw) * 0.6, this.y + 1, this.z + Math.cos(this.yaw) * 0.6, 2);
    if (Math.random() < dt * 2) g.audio.play('repair', { x: this.x, z: this.z, volume: 0.3 });
    const st = w.state;
    if (this.workTarget.kind === 'feu') {
      st.fire = Math.max(0, st.fire - dt * 0.25 * eff);
      if (st.fire <= 0) this.workTarget = null;
      return true;
    }
    const scrapUse = this.data.skill === 'mecanicien' ? 0.75 : 1;
    if (this.workTarget.kind === 'composant') {
      const comps: { hp: number; max: number }[] = [
        { hp: st.heater.hp, max: 100 },
        { hp: st.lights.hp, max: 100 },
      ];
      const refs: { hp: number }[] = [st.heater, st.lights];
      for (const sl of st.slots) {
        if (!sl.equip) continue;
        comps.push({ hp: sl.hp, max: EQUIPMENT[sl.equip].hp });
        refs.push(sl);
      }
      const ci = comps.findIndex((cc) => cc.hp < cc.max);
      if (ci < 0) {
        this.workTarget = null;
        return true;
      }
      const c = refs[ci];
      const max = comps[ci].max;
      const amount = BAL.repairRate * 0.8 * eff * dt;
      const cost = (amount / BAL.hpPerScrap) * scrapUse;
      if ((g.state.train.resources.ferraille ?? 0) < cost) return false;
      g.state.train.resources.ferraille -= cost;
      c.hp = Math.min(max, c.hp + amount);
      return true;
    }
    const amount = BAL.repairRate * 0.6 * eff * dt;
    const cost = (amount / BAL.hpPerScrap) * scrapUse;
    if ((g.state.train.resources.ferraille ?? 0) < cost) return false;
    g.state.train.resources.ferraille -= cost;
    train.repairWagon(w.index, amount);
    if (st.hp >= wagonMaxHp(g.state, st) * 0.99) this.workTarget = null;
    return true;
  }

  /** Médecin : soigne blessés et malades à bord. */
  private doHealing(dt: number): boolean {
    const g = this.game;
    if (!this.healTarget || !this.healTarget.alive || this.workT <= 0) {
      this.workT = 4;
      this.healTarget = g.mostNeedyPatient(this);
    }
    this.workT -= dt;
    const t = this.healTarget;
    if (!t) return false;
    const d = Math.hypot(t.x - this.x, t.z - this.z);
    if (d > 1.1) {
      if (this.path.length === 0 || this.repathT <= 0) {
        this.repathT = 1;
        this.planTrainPath(t.x + 0.7, t.z > 0 ? t.z - 0.6 : t.z + 0.6);
      }
      this.repathT -= dt;
      this.walk(dt, 3.2);
      return true;
    }
    this.model.pose = 'work';
    this.yaw = dampAngle(this.yaw, Math.atan2(t.x - this.x, t.z - this.z), 6, dt);
    g.treatPatient(this, t, dt);
    return true;
  }

  /** Utilisé quand le train change (reconstruit) : force une nouvelle place. */
  resetSpot(): void {
    this.spotWagon = -1;
    this.spotIndex = -1;
    this.path = [];
  }

  isInWagonType(type: string): boolean {
    const wi = this.game.train.wagonAt(this.x);
    return wi >= 0 && this.game.train.wagons[wi].state.type === type;
  }

  wagonTypeName(): string {
    const wi = this.wagonIndexOf(this.data.wagon);
    const w = this.game.train.wagons[wi];
    return w ? WAGON_TYPES[w.state.type].name : '—';
  }
}

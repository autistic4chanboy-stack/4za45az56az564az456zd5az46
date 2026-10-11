import * as THREE from 'three';
import { WAGON_TYPES, EQUIPMENT, DECOR, type EquipDef } from '../data/train';
import { WEAPONS } from '../data/weapons';
import { BAL } from '../data/balance';
import { Materials, GeoBuilder } from '../render/geo';
import { windowify } from '../render/toon';
import { CollisionWorld } from '../world/collision';
import { buildWagonModel, buildEquipModel, decorModel, makeShieldMaterial, FLOOR, HALF_W, GAP, DOOR_HALF, WALL_TOP, type WagonModel, type Spot } from './trainModel';
import { wagonMaxHp, wagonArmor } from '../state/trainState';
import { segmentRect, rotateTowards, angleDiff, clamp01, damp } from '../core/math';
import type { WagonState, SlotState } from '../state/types';
import type { PowerResult } from './sim';
import type { Actor, DamageSource } from '../game/types';
import type { Game } from '../game/Game';

export const FRONT_X = 10;

export interface TurretRuntime {
  wagonIndex: number;
  slotIndex: number;
  slot: SlotState;
  def: EquipDef;
  group: THREE.Group;
  head: THREE.Group;
  muzzle: THREE.Vector3;
  yaw: number;
  cooldown: number;
  target: Actor | null;
  retarget: number;
  ammoAcc: number;
  /** Position monde du pivot. */
  x: number;
  y: number;
  z: number;
  /** Visée manuelle (joueur). */
  manualYaw: number | null;
  manualFire: boolean;
  manualTarget: { x: number; z: number } | null;
  beam?: THREE.Mesh;
  smoke: number;
}

export interface WagonRuntime {
  index: number;
  state: WagonState;
  model: WagonModel;
  group: THREE.Group;
  x0: number;
  x1: number;
  cx: number;
  turrets: TurretRuntime[];
  glowMat: THREE.MeshBasicMaterial;
  shieldMesh: THREE.Mesh | null;
  shieldFlash: number;
  frozen: number;
  detachTimer: number;
  lightLevel: number;
  decorGroup: THREE.Group;
  /** Occupation des emplacements PNJ. */
  spotUsers: (string | null)[];
}

interface DetachedPart {
  group: THREE.Group;
  speed: number;
  t: number;
}

const tmpV = new THREE.Vector3();
const WINDOW_DAY = new THREE.Color(0x2c3a46);
const WINDOW_NIGHT = new THREE.Color(0xffd590);
const WINDOW_OFF = new THREE.Color(0x141a20);

export class Train {
  readonly group = new THREE.Group();
  wagons: WagonRuntime[] = [];
  colliders = new CollisionWorld();
  private detached: DetachedPart[] = [];
  private shieldMat = makeShieldMaterial();
  power: PowerResult | null = null;
  /** Vitesse actuelle (m/s). */
  speed = 0;
  wheelPhase = 0;
  private clackT = 0;
  private chuffT = 0;
  insideView = false;
  private frontFaded = false;
  /** Boost manuel de la chaudière (pelletée du joueur). */
  shovelBoost = 0;

  constructor(private game: Game) {}

  get state() {
    return this.game.state.train;
  }

  // ------------------------------------------------------------------ construction

  rebuild(): void {
    for (const w of this.wagons) {
      this.group.remove(w.group);
      w.group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
      });
      w.glowMat.dispose();
    }
    this.wagons = [];
    this.colliders.clear();
    let x = FRONT_X;
    const ws = this.state.wagons;
    for (let i = 0; i < ws.length; i++) {
      const st = ws[i];
      const def = WAGON_TYPES[st.type];
      const x1 = x;
      const x0 = x - def.length;
      const cx = (x0 + x1) / 2;
      const model = buildWagonModel(st, x1);
      const group = new THREE.Group();
      group.position.set(cx, 0, 0);
      const glowMat = windowify(new THREE.MeshBasicMaterial({ vertexColors: true, color: WINDOW_DAY.clone() }));
      const applyGlow = (g: THREE.Object3D) =>
        g.traverse((o) => {
          if (o instanceof THREE.Mesh && o.name === 'glow') o.material = glowMat;
        });
      applyGlow(model.shell);
      applyGlow(model.front);
      group.add(model.shell, model.front, model.roof);
      const decorGroup = this.buildDecor(st, model);
      applyGlow(decorGroup);
      group.add(decorGroup);
      const wr: WagonRuntime = {
        index: i,
        state: st,
        model,
        group,
        x0,
        x1,
        cx,
        turrets: [],
        glowMat,
        shieldMesh: null,
        shieldFlash: 0,
        frozen: 0,
        detachTimer: 0,
        lightLevel: 0,
        decorGroup,
        spotUsers: model.spots.map(() => null),
      };
      for (const r of model.colliders) this.colliders.addRect(cx + r.x0, r.z0, cx + r.x1, r.z1, 'train');
      // tourelles
      st.slots.forEach((slot, si) => {
        if (!slot.equip) return;
        const anchor = model.slotAnchors[si];
        if (!anchor) return;
        wr.turrets.push(this.buildTurret(wr, si, slot, anchor.x, anchor.y, anchor.z));
      });
      if (st.slots.some((s) => s.equip === 'bouclier')) {
        const geo = new THREE.SphereGeometry(1, 20, 12);
        const m = new THREE.Mesh(geo, this.shieldMat.clone());
        m.scale.set((def.length + 12) / 2, 5.5, 5.2);
        m.position.set(0, 2.5, 0);
        m.renderOrder = 30;
        group.add(m);
        wr.shieldMesh = m;
      }
      this.group.add(group);
      this.wagons.push(wr);
      x = x0 - GAP;
      // passerelle entre wagons
      if (i < ws.length - 1) {
        const gx0 = x0 - GAP;
        const gg = new GeoBuilder();
        gg.box(GAP + 0.2, 0.12, DOOR_HALF * 2 + 0.1, 0, FLOOR - 0.06, 0, 0x2a2a2a);
        gg.box(GAP + 0.2, 0.9, 0.06, 0, FLOOR + 0.45, DOOR_HALF + 0.02, 0x3a3a3a);
        gg.box(GAP + 0.2, 0.9, 0.06, 0, FLOOR + 0.45, -DOOR_HALF - 0.02, 0x3a3a3a);
        gg.box(0.8, 0.25, 0.3, 0, FLOOR - 0.35, 0, 0x1a1a1a);
        const gm = gg.toGroup();
        gm.position.set((gx0 + x0) / 2, 0, 0);
        group.add(gm);
        gm.position.x -= cx;
        this.colliders.addRect(gx0 - 0.05, DOOR_HALF, x0 + 0.05, DOOR_HALF + 0.3, 'train');
        this.colliders.addRect(gx0 - 0.05, -DOOR_HALF - 0.3, x0 + 0.05, -DOOR_HALF, 'train');
      }
    }
    this.applyInsideView(this.insideView, true);
  }

  private buildDecor(st: WagonState, model: WagonModel): THREE.Group {
    const g = new GeoBuilder();
    st.decor.forEach((d, i) => {
      if (!d) return;
      const a = model.decorAnchors[i];
      if (a) decorModel(d, g, a.x, a.z, a.ry);
    });
    return g.isEmpty ? new THREE.Group() : g.toGroup();
  }

  private buildTurret(wr: WagonRuntime, si: number, slot: SlotState, ax: number, ay: number, az: number): TurretRuntime {
    const def = EQUIPMENT[slot.equip!];
    const m = buildEquipModel(slot.equip!, slot.level);
    const group = new THREE.Group();
    group.position.set(ax, ay, az);
    const head = new THREE.Group();
    head.add(m.head);
    group.add(m.base, head);
    wr.group.add(group);
    const yaw = az < 0 ? Math.PI : 0;
    head.rotation.y = yaw;
    let beam: THREE.Mesh | undefined;
    if (slot.equip === 'projecteur') {
      const geo = new THREE.ConeGeometry(4, def.lightRange ?? 30, 16, 1, true);
      geo.translate(0, -(def.lightRange ?? 30) / 2, 0);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      beam = new THREE.Mesh(geo, mat);
      beam.position.set(0, 0.95, 0.4);
      beam.rotation.x = 0.12;
      head.add(beam);
    }
    return {
      wagonIndex: wr.index,
      slotIndex: si,
      slot,
      def,
      group,
      head,
      muzzle: m.muzzle,
      yaw,
      cooldown: Math.random() * 0.5,
      target: null,
      retarget: 0,
      ammoAcc: 0,
      x: wr.cx + ax,
      y: ay,
      z: az,
      manualYaw: null,
      manualFire: false,
      manualTarget: null,
      beam,
      smoke: 0,
    };
  }

  // ------------------------------------------------------------------ requêtes

  get frontX(): number {
    return FRONT_X;
  }

  get rearX(): number {
    return this.wagons.length ? this.wagons[this.wagons.length - 1].x0 : FRONT_X;
  }

  /** Index du wagon contenant x (passerelle incluse : wagon de devant). */
  wagonAt(x: number): number {
    for (const w of this.wagons) if (x <= w.x1 + 0.01 && x >= w.x0 - GAP) return w.index;
    return -1;
  }

  /** Point dans l'emprise intérieure du train (plancher). */
  isInside(x: number, z: number): boolean {
    if (Math.abs(z) > HALF_W - 0.05) return false;
    for (const w of this.wagons) {
      if (x <= w.x1 && x >= w.x0) return true;
      if (x < w.x0 && x >= w.x0 - GAP && Math.abs(z) < DOOR_HALF + 0.05 && w.index < this.wagons.length - 1) return true;
    }
    return false;
  }

  /** Emprise extérieure (pour le placement d'ennemis hors du train). */
  footprintContains(x: number, z: number, margin = 0): boolean {
    return x <= FRONT_X + 1 + margin && x >= this.rearX - margin && Math.abs(z) <= HALF_W + margin;
  }

  hitTest(x0: number, z0: number, x1: number, z1: number): { t: number; wagon: number } | null {
    let best: { t: number; wagon: number } | null = null;
    for (const w of this.wagons) {
      if (w.model.open && Math.random() < 0.6) continue;
      const t = segmentRect(x0, z0, x1, z1, { x0: w.x0, z0: -HALF_W, x1: w.x1, z1: HALF_W });
      if (t >= 0 && (!best || t < best.t)) best = { t, wagon: w.index };
    }
    return best;
  }

  spotWorld(w: WagonRuntime, s: Spot): { x: number; y: number; z: number } {
    return { x: w.cx + s.x, y: s.y ?? FLOOR, z: s.z };
  }

  pointWorld(w: WagonRuntime, key: string): { x: number; y: number; z: number } | null {
    const p = w.model.points[key];
    return p ? { x: w.cx + p.x, y: p.y, z: p.z } : null;
  }

  sideDoorWorld(w: WagonRuntime, side: -1 | 1): { x: number; z: number } | null {
    if (w.model.sideDoor === null) return null;
    return { x: w.cx + w.model.sideDoor, z: side * (HALF_W + 0.9) };
  }

  allTurrets(): TurretRuntime[] {
    return this.wagons.flatMap((w) => w.turrets);
  }

  /** Lumière intérieure (0..1) d'un wagon, utile pour la peur la nuit. */
  lightAt(index: number): number {
    return this.wagons[index]?.lightLevel ?? 0;
  }

  // ------------------------------------------------------------------ vue intérieure

  applyInsideView(inside: boolean, force = false): void {
    if (inside === this.insideView && !force) return;
    this.insideView = inside;
    for (const w of this.wagons) {
      w.model.roof.visible = !inside;
      if (w.shieldMesh) w.shieldMesh.visible = true;
      this.setFrontFaded(w, inside);
    }
    this.frontFaded = inside;
  }

  private setFrontFaded(w: WagonRuntime, faded: boolean): void {
    w.model.front.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o.name === 'glow') o.visible = !faded;
        else {
          o.userData.mat0 ??= o.material;
          o.material = faded ? Materials.vcFaded : o.userData.mat0;
        }
        o.castShadow = !faded;
      }
    });
  }

  get fronts(): boolean {
    return this.frontFaded;
  }

  // ------------------------------------------------------------------ dégâts

  /** Inflige des dégâts à un wagon (bouclier, blindage, composants, incendie). */
  damageWagon(index: number, amount: number, src: DamageSource, x: number, z: number): void {
    const w = this.wagons[index];
    if (!w || amount <= 0) return;
    const st = w.state;
    // bouclier : générateur du wagon ou d'un voisin
    for (const k of [index, index - 1, index + 1]) {
      const sw = this.wagons[k];
      if (!sw || sw.state.shield <= 0) continue;
      const absorbed = Math.min(sw.state.shield, amount);
      sw.state.shield -= absorbed;
      amount -= absorbed;
      sw.shieldFlash = 1;
      this.game.engine.fx.sparks(x, 2.2, z, 3, 0x80d0ff);
      if (sw.state.shield <= 0) this.game.audio.play('shield', { x, z, pitch: 0.6 });
      if (amount <= 0) return;
    }
    const armor = wagonArmor(this.game.state, st);
    const dmg = amount * (1 - armor);
    st.hp = Math.max(0, st.hp - dmg);
    if (src.kind === 'froid' || src.slow) w.frozen = Math.max(w.frozen, 4);
    // composants
    if (Math.random() < 0.18 + dmg / 120) {
      const comps: { hp: number }[] = [st.heater, st.lights, ...st.slots.filter((s) => s.equip)];
      const c = comps[Math.floor(Math.random() * comps.length)];
      if (c) {
        const before = c.hp;
        c.hp = Math.max(0, c.hp - dmg * (0.6 + Math.random()));
        if (before > 0 && c.hp <= 0) this.game.onComponentBroken(w, c === st.heater ? 'chauffage' : c === st.lights ? 'éclairage' : EQUIPMENT[(c as SlotState).equip!].name);
      }
    }
    // incendie
    if ((src.kind === 'feu' || src.kind === 'explosion' || src.burn) && Math.random() < 0.25 && !w.model.open) st.fire = Math.max(st.fire, 0.15);
    this.game.onTrainDamaged(index, dmg);
    if (st.hp <= 0 && w.detachTimer <= 0) {
      if (index === 0) this.game.onLocomotiveDestroyed();
      else {
        w.detachTimer = BAL.detachDelay;
        this.game.onWagonCritical(index, true);
      }
    }
  }

  /** Détache le wagon `index` et tous ceux qui suivent. */
  detachFrom(index: number, reason: 'casse' | 'manuel'): void {
    if (index <= 0 || index >= this.wagons.length) return;
    const lost = this.wagons.slice(index);
    const lostIds = lost.map((w) => w.state.uid);
    const parts = new THREE.Group();
    for (const w of lost) {
      this.group.remove(w.group);
      parts.add(w.group);
    }
    this.game.scene.add(parts);
    this.detached.push({ group: parts, speed: this.speed, t: 0 });
    this.state.wagons.splice(index);
    this.game.audio.play('detach', { x: lost[0].x1, z: 0 });
    this.game.onWagonsDetached(lostIds, reason);
    this.rebuild();
    if (this.speed < 0.5) {
      // à l'arrêt : l'épave reste sur place un moment
      this.detached[this.detached.length - 1].speed = 0;
    }
  }

  // ------------------------------------------------------------------ mise à jour

  update(dt: number, inCombat: boolean): void {
    const g = this.game;
    const fx = g.engine.fx;
    const night = 1 - g.engine.daylight;
    const ratio = this.power?.ratio ?? { lumiere: 1, chauffage: 1, armement: 1, bouclier: 1 };
    const sp = this.speed;
    // roues et bielles
    this.wheelPhase += dt * sp * 1.25;
    for (const w of this.wagons) {
      for (const a of w.model.animated) {
        if (a.userData.rod) a.position.set(Math.cos(this.wheelPhase) * 0.3, Math.sin(this.wheelPhase) * 0.3, 0);
        if (a.userData.spin) a.rotation.x += dt * (2 + (this.power?.production ?? 5) * 0.4);
      }
      if (sp > 0.5) w.group.rotation.x = Math.sin(this.wheelPhase * 0.37 + w.index) * 0.004 * Math.min(1, sp / 10);
      else w.group.rotation.x = 0;
    }
    // sons de roulement
    if (sp > 0.5) {
      this.clackT -= dt * sp;
      if (this.clackT <= 0) {
        this.clackT = 14;
        g.audio.play('clack', { x: g.player.x, z: g.player.z, volume: 0.35 + Math.min(0.4, sp / 40) });
      }
    }
    // vapeur de la cheminée
    const loco = this.wagons[0];
    if (loco) {
      const chimX = loco.x1 - 1.5;
      this.chuffT -= dt * (0.8 + sp * 0.35);
      if (this.chuffT <= 0) {
        this.chuffT = 1;
        const dark = this.state.pressure > 0.95 || this.state.heat > 50;
        fx.steam(chimX, FLOOR + 4.5, 0, sp, dark);
        if (sp > 0.3 || Math.random() < 0.3) g.audio.play('chuff', { x: chimX, z: 0, volume: 0.35 + Math.min(0.4, sp / 30) });
      }
      if (this.state.heat > 70 && Math.random() < dt * 8) fx.steam(loco.x1 - 4, FLOOR + 2.5, 1.6, sp, false);
    }
    // lumières, boucliers, incendies
    for (const w of this.wagons) {
      const st = w.state;
      const def = WAGON_TYPES[st.type];
      const lightsOk = st.lights.on && st.lights.hp > 0 && st.hp > 0;
      const level = lightsOk ? ratio.lumiere : 0;
      w.lightLevel = damp(w.lightLevel, level, 4, dt);
      const flicker = st.lights.hp < 40 && lightsOk ? (Math.random() < 0.08 ? 0.3 : 1) : 1;
      const target = night > 0.35 ? WINDOW_NIGHT : WINDOW_DAY;
      w.glowMat.color.copy(WINDOW_OFF).lerp(target, clamp01(w.lightLevel * flicker * (night > 0.35 ? 1 : 0.9) + (night > 0.35 ? 0 : 0.1)));
      if (night > 0.35 && w.lightLevel > 0.3 && !def.open) {
        const px = g.player.x;
        if (Math.abs(w.cx - px) < 30) g.engine.lights.add(w.cx, FLOOR + 2.4, 0, 0xffd08a, 2.2 * w.lightLevel, 9, g.player.onTrain ? 2 : 1);
      }
      // bouclier
      const shieldSlot = st.slots.find((s) => s.equip === 'bouclier' && s.on && s.hp > 0);
      if (shieldSlot) {
        const max = (EQUIPMENT.bouclier.shieldHp ?? 170) + 40 * shieldSlot.level;
        st.shield = Math.min(max, st.shield + (EQUIPMENT.bouclier.shieldRegen ?? 10) * ratio.bouclier * (1 + 0.2 * shieldSlot.level) * dt);
        if (w.shieldMesh) {
          const m = w.shieldMesh.material as THREE.MeshBasicMaterial;
          w.shieldFlash = Math.max(0, w.shieldFlash - dt * 3);
          m.opacity = (inCombat ? 0.05 + 0.1 * (st.shield / max) : 0.025) + w.shieldFlash * 0.25;
          w.shieldMesh.visible = st.shield > 1;
        }
      } else {
        st.shield = 0;
        if (w.shieldMesh) w.shieldMesh.visible = false;
      }
      if (st.fire > 0) {
        st.fire = Math.min(1, st.fire + dt * 0.012);
        const fd = 6 * st.fire * dt;
        st.hp = Math.max(0, st.hp - fd);
        if (Math.random() < dt * 14 * st.fire) fx.flame(w.cx + (Math.random() - 0.5) * (w.x1 - w.x0) * 0.8, FLOOR + 0.5, (Math.random() - 0.5) * 3, 0, 0);
        if (Math.random() < dt * 3) fx.puff(w.cx + (Math.random() - 0.5) * 6, WALL_TOP + 0.5, 0, 0x2a2622, 1.5, false, 0.6);
        g.engine.lights.add(w.cx, FLOOR + 1.5, 0, 0xff7020, 3 * st.fire, 10, 2);
        if (st.fire >= 1 && Math.random() < dt * 0.05) {
          const nb = this.wagons[w.index + (Math.random() < 0.5 ? 1 : -1)];
          if (nb && !nb.model.open && nb.state.fire <= 0) nb.state.fire = 0.1;
        }
        if (st.hp <= 0 && w.detachTimer <= 0 && w.index > 0) {
          w.detachTimer = BAL.detachDelay;
          g.onWagonCritical(w.index, true);
        }
      }
      // fumée de dégâts
      const maxHp = wagonMaxHp(g.state, st);
      if (st.hp < maxHp * 0.4 && Math.random() < dt * (1 - st.hp / maxHp) * 4) fx.puff(w.cx + (Math.random() - 0.5) * 5, WALL_TOP + 0.2, (Math.random() - 0.5) * 2, 0x4a4440, 1, false, 0.45);
      w.frozen = Math.max(0, w.frozen - dt);
      // compte à rebours de détachement
      if (w.detachTimer > 0) {
        if (st.hp > 0) {
          w.detachTimer = 0;
          g.onWagonCritical(w.index, false);
        } else {
          w.detachTimer -= dt;
          if (Math.random() < dt * 10) fx.sparks(w.x1 + 0.4, FLOOR - 0.3, (Math.random() - 0.5) * 2, 3);
          if (w.detachTimer <= 0) {
            this.detachFrom(w.index, 'casse');
            return;
          }
        }
      }
    }
    this.updateTurrets(dt, ratio.armement, night);
    // épaves détachées
    for (let i = this.detached.length - 1; i >= 0; i--) {
      const d = this.detached[i];
      d.t += dt;
      d.speed = Math.max(0, d.speed - dt * 2.2);
      d.group.position.x -= (this.speed - d.speed) * dt;
      if (d.t > 25 || d.group.position.x < -260) {
        this.game.scene.remove(d.group);
        d.group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.detached.splice(i, 1);
      }
    }
  }

  clearDetached(): void {
    for (const d of this.detached) this.game.scene.remove(d.group);
    this.detached = [];
  }

  // ------------------------------------------------------------------ tourelles

  private updateTurrets(dt: number, armRatio: number, night: number): void {
    const g = this.game;
    const enemies = g.enemiesAlive();
    for (const w of this.wagons) {
      const wagonOk = w.state.hp > 0;
      for (const t of w.turrets) {
        t.x = w.cx + t.group.position.x;
        t.y = t.group.position.y;
        t.z = t.group.position.z;
        const s = t.slot;
        const broken = s.hp <= 0 || !wagonOk;
        if (broken) {
          if (Math.random() < dt * 3) g.engine.fx.puff(t.x, t.y + 0.6, t.z, 0x3a3632, 0.7, false, 0.5);
          continue;
        }
        if (!s.on) continue;
        const def = t.def;
        const manned = s.gunner !== null;
        const playerManned = s.gunner === 'joueur';
        // projecteur : suit les monstres, effet d'aveuglement
        if (def.id === 'projecteur') {
          const target = this.nearestEnemy(t, enemies, def.lightRange ?? 30, true);
          const desired = target ? Math.atan2(target.x - t.x, target.z - t.z) : t.z <= 0 ? Math.PI : 0;
          t.yaw = rotateTowards(t.yaw, desired, def.turnRate * dt * Math.max(0.3, armRatio));
          t.head.rotation.y = t.yaw;
          const lit = (this.power?.ratio.lumiere ?? 1) > 0.2;
          if (t.beam) {
            t.beam.visible = lit && night > 0.3;
            (t.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.05 * night;
          }
          if (lit && night > 0.3) {
            const range = def.lightRange ?? 30;
            for (const e of enemies) {
              const dx = e.x - t.x;
              const dz = e.z - t.z;
              const d = Math.hypot(dx, dz);
              if (d > range) continue;
              if (Math.abs(angleDiff(t.yaw, Math.atan2(dx, dz))) < 0.2) g.onEnemyLit(e);
            }
            const tx = t.x + Math.sin(t.yaw) * 12;
            const tz = t.z + Math.cos(t.yaw) * 12;
            g.engine.lights.add(tx, 3, tz, 0xfff0d0, 3, 18, 1.5);
          }
          continue;
        }
        if (def.id === 'bouclier') {
          t.head.rotation.y += dt * 0.8;
          continue;
        }
        const weapon = WEAPONS[def.weapon!];
        if (def.operator === 'required' && !manned) continue;
        const range = weapon.range * (1 + 0.08 * s.level);
        let desired: number | null = null;
        let target: Actor | null = null;
        if (playerManned) {
          desired = t.manualYaw;
        } else {
          t.retarget -= dt;
          if (t.retarget <= 0 || !t.target || !t.target.alive || Math.hypot(t.target.x - t.x, t.target.z - t.z) > range) {
            t.target = this.nearestEnemy(t, enemies, range, false);
            t.retarget = 0.4;
          }
          target = t.target;
          if (target) {
            // anticipation simple du mouvement relatif
            desired = Math.atan2(target.x - t.x, target.z - t.z);
          }
        }
        const turn = def.turnRate * dt * (0.4 + 0.6 * armRatio) * (w.frozen > 0 ? 0.5 : 1);
        if (desired !== null) t.yaw = rotateTowards(t.yaw, desired, turn);
        t.head.rotation.y = t.yaw;
        t.cooldown -= dt;
        const wantFire = playerManned ? t.manualFire : target !== null && desired !== null && Math.abs(angleDiff(t.yaw, desired)) < 0.12;
        if (!wantFire || t.cooldown > 0) continue;
        // énergie / munitions
        let rateMult = 1;
        let dmgMult = 1;
        if (def.id === 'tesla') {
          if (armRatio < 0.2) continue;
          dmgMult = armRatio;
        } else {
          rateMult = 0.5 + 0.5 * armRatio;
        }
        const gunnerSkill = playerManned ? 1.2 : manned ? g.gunnerSkill(s.gunner!) : 0;
        let spreadMult = 1;
        if (!manned && def.operator === 'optional') {
          rateMult *= 0.75;
          spreadMult = 1.7;
        } else if (manned) {
          rateMult *= 1 + 0.1 * gunnerSkill;
          spreadMult = Math.max(0.4, 1 - 0.18 * gunnerSkill);
        }
        if (w.frozen > 0) rateMult *= 0.5;
        if (weapon.ammo) {
          const per = weapon.shotsPerAmmo ?? 1;
          if (t.ammoAcc <= 0) {
            if ((g.state.train.resources[weapon.ammo] ?? 0) < 1) {
              if (Math.random() < 0.02) g.notifyOnce(`ammo_${weapon.ammo}`, `Plus de ${weapon.ammo} pour les tourelles !`, 'mauvais');
              continue;
            }
            g.state.train.resources[weapon.ammo] -= 1;
            t.ammoAcc = per;
          }
          t.ammoAcc--;
        }
        t.cooldown = 1 / (weapon.rate * rateMult * (1 + 0.12 * s.level));
        tmpV.copy(t.muzzle).applyAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
        const mx = t.x + tmpV.x;
        const my = t.y + tmpV.y;
        const mz = t.z + tmpV.z;
        const aimPoint = playerManned ? t.manualTarget : target ? { x: target.x, z: target.z } : null;
        g.combat.fire({
          weapon,
          level: s.level,
          x: mx,
          y: my,
          z: mz,
          yaw: t.yaw,
          faction: 'joueur',
          owner: null,
          spreadMult,
          damageMult: dmgMult * (1 + 0.05 * gunnerSkill),
          tx: aimPoint?.x,
          tz: aimPoint?.z,
          target,
          fromTrain: true,
        });
      }
    }
  }

  private nearestEnemy(t: TurretRuntime, enemies: Actor[], range: number, monstersOnly: boolean): Actor | null {
    let best: Actor | null = null;
    let bestScore = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (monstersOnly && e.faction !== 'monstre') continue;
      if ((e as { hiddenFromTurrets?: boolean }).hiddenFromTurrets) continue;
      if (e.onTrain) continue;
      const d = Math.hypot(e.x - t.x, e.z - t.z);
      if (d > range) continue;
      const latched = (e as { latchedWagon?: number }).latchedWagon !== undefined && (e as { latchedWagon?: number }).latchedWagon! >= 0;
      const score = d - (latched ? 10 : 0) + Math.abs(angleDiff(t.yaw, Math.atan2(e.x - t.x, e.z - t.z))) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /** Répare un wagon ou un composant ; retourne les PV réparés. */
  repairWagon(index: number, amount: number): number {
    const w = this.wagons[index];
    if (!w) return 0;
    const max = wagonMaxHp(this.game.state, w.state);
    const before = w.state.hp;
    w.state.hp = Math.min(max, w.state.hp + amount);
    return w.state.hp - before;
  }

  decorMorale(index: number): number {
    const w = this.wagons[index];
    if (!w) return 0;
    let m = 0;
    for (const d of w.state.decor) if (d) m += DECOR[d].morale;
    return m;
  }
}

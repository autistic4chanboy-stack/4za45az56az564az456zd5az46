import * as THREE from 'three';
import { Humanoid } from '../render/humanoid';
import { WEAPONS, type WeaponDef } from '../data/weapons';
import { GEAR } from '../data/items';
import { BAL } from '../data/balance';
import { clamp, damp, dampAngle } from '../core/math';
import type { Actor, DamageSource, Interactable } from './types';
import type { Game } from './Game';
import type { TurretRuntime } from '../train/Train';
import type { NpcLook } from '../data/npcs';

const DYNAMITE: WeaponDef = {
  id: 'dynamite', name: 'Dynamite', desc: '', icon: 'dynamite', kind: 'shell', damage: 120, splash: 4.2, speed: 16, rate: 1, range: 18, spread: 0.02,
  ammo: null, mag: 0, reload: 0, auto: false, sound: 'melee', price: 0, tier: 0, color: 0xff6040, knockback: 9, structureMult: 2.5,
};

export const PLAYER_LOOK: NpcLook = {
  skin: 0xe0ac87, hair: 0x3b2a1e, hairStyle: 0, shirt: 0x6b3a2e, pants: 0x2e2a26, hat: 1, accessory: 1, height: 1, build: 1.05,
};

export class Player implements Actor {
  readonly id = 'joueur';
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  radius = 0.36;
  height = 1.75;
  faction = 'joueur' as const;
  alive = true;
  onTrain = false;
  slow = 0;
  slowT = 0;
  burnT = 0;
  burnDps = 0;
  model: Humanoid;
  private vx = 0;
  private vz = 0;
  private dodgeT = 0;
  private dodgeDx = 0;
  private dodgeDz = 0;
  private fireCd = 0;
  private meleeCd = 0;
  reloadT = 0;
  reloadTotal = 0;
  mounted: TurretRuntime | null = null;
  readonly aim = new THREE.Vector3();
  flashlight: THREE.SpotLight;
  /** Lampe automatique dans le noir (F pour la couper/rallumer). */
  flashlightOn = true;
  focus: Interactable | null = null;
  holdT = 0;
  private holdTarget: Interactable | null = null;
  private stepT = 0;
  invuln = 0;
  hurtFlash = 0;
  /** Bloque les actions (cinématiques, mini-jeux). */
  frozen = false;
  private suitLook = '';

  constructor(private game: Game) {
    this.model = new Humanoid(PLAYER_LOOK);
    this.model.enableXray();
    this.flashlight = new THREE.SpotLight(0xfff2d8, 0, 26, 0.55, 0.5, 1.2);
    this.flashlight.castShadow = false;
    game.scene.add(this.flashlight, this.flashlight.target);
  }

  get state() {
    return this.game.state.player;
  }

  get hp(): number {
    return this.state.hp;
  }

  set hp(v: number) {
    this.state.hp = v;
  }

  get maxHp(): number {
    let m = BAL.playerHp + (this.state.perks.includes('robuste') ? 25 : 0);
    const r = this.state.rads;
    if (r >= BAL.radSickness[2]) m *= 0.5;
    else if (r >= BAL.radSickness[1]) m *= 0.75;
    else if (r >= BAL.radSickness[0]) m *= 0.9;
    return Math.round(m);
  }

  hasPerk(id: string): boolean {
    return this.state.perks.includes(id);
  }

  weaponDef(): WeaponDef {
    const inst = this.state.weapons[this.state.active];
    return WEAPONS[inst?.id ?? 'cle'] ?? WEAPONS.cle;
  }

  /** Rafraîchit l'apparence selon l'équipement porté (combinaison, masque). */
  refreshLook(): void {
    const key = `${this.state.gear.corps}|${this.state.gear.tete}`;
    if (key === this.suitLook) return;
    this.suitLook = key;
    const parent = this.model.root.parent;
    const pos = this.model.root.position.clone();
    const rot = this.model.root.rotation.y;
    parent?.remove(this.model.root);
    this.model.dispose();
    const corps = this.state.gear.corps;
    const outfit = corps === 'combinaison' ? 0xc9a227 : corps === 'manteau' ? 0x5a4a3a : corps === 'combinaison_polaire' ? 0xd8dde0 : corps === 'armure' ? 0x4a5048 : undefined;
    this.model = new Humanoid(PLAYER_LOOK, { outfit, mask: this.state.gear.tete === 'masque', armorColor: corps === 'armure' ? 0x3a3e38 : undefined });
    this.model.enableXray();
    this.model.root.position.copy(pos);
    this.model.root.rotation.y = rot;
    parent?.add(this.model.root);
    this.model.setWeapon(this.weaponDef().id);
  }

  damage(amount: number, src: DamageSource): void {
    if (!this.alive || this.invuln > 0) return;
    if (this.dodgeT > 0 && src.kind !== 'gaz' && src.kind !== 'radiation' && src.kind !== 'froid' && src.kind !== 'faim' && src.kind !== 'maladie') return;
    const corps = this.state.gear.corps;
    const armor = corps ? GEAR[corps]?.armor ?? 0 : 0;
    const dmg = amount * (1 - armor);
    this.state.hp = Math.max(0, this.state.hp - dmg);
    if (src.kind === 'balle' || src.kind === 'melee' || src.kind === 'explosion' || src.kind === 'acide' || src.kind === 'arc') {
      this.model.hurt();
      this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + dmg / 40);
      this.game.engine.rig.shake(Math.min(0.5, 0.1 + dmg / 60));
      if (src.knockback) {
        const dx = this.x - src.x;
        const dz = this.z - src.z;
        const d = Math.hypot(dx, dz) || 1;
        this.vx += (dx / d) * src.knockback * 0.8;
        this.vz += (dz / d) * src.knockback * 0.8;
      }
      if (src.infects && !this.state.disease && Math.random() < 0.12) this.game.infectPlayer('infection');
    }
    if (this.state.hp <= 0) {
      this.alive = false;
      this.model.pose = 'dead';
      this.game.onPlayerDeath(src);
    }
  }

  heal(n: number): void {
    this.state.hp = Math.min(this.maxHp, this.state.hp + n);
  }

  teleport(x: number, z: number, y?: number): void {
    this.x = x;
    this.z = z;
    this.y = y ?? this.game.floorY(x, z);
    this.vx = 0;
    this.vz = 0;
    this.model.root.position.set(this.x, this.y, this.z);
  }

  mount(t: TurretRuntime): void {
    this.mounted = t;
    t.slot.gunner = 'joueur';
    t.manualYaw = t.yaw;
    this.game.ui.toast(`Aux commandes : ${t.def.name}. Visez à la souris, clic pour tirer, E pour quitter.`, 'info');
  }

  dismount(): void {
    if (!this.mounted) return;
    this.mounted.slot.gunner = null;
    this.mounted.manualFire = false;
    this.mounted.manualYaw = null;
    this.mounted = null;
  }

  update(dt: number): void {
    const g = this.game;
    const input = g.input;
    const st = this.state;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    if (!this.alive) {
      this.model.update(dt);
      return;
    }
    // visée : point du sol sous le curseur (plan à hauteur de poitrine)
    const aimY = this.y + 1.1;
    g.engine.rig.screenToGround(input.mouseX, input.mouseY, g.engine.width, g.engine.height, aimY, this.aim);
    const canAct = !this.frozen && !g.ui.blocking;

    // ----- tourelle manuelle
    if (this.mounted) {
      const t = this.mounted;
      if (t.slot.hp <= 0 || !g.train.wagons[t.wagonIndex]) {
        this.dismount();
      } else {
        t.manualYaw = Math.atan2(this.aim.x - t.x, this.aim.z - t.z);
        t.manualTarget = { x: this.aim.x, z: this.aim.z };
        t.manualFire = canAct && !input.overUI && input.mouseIsDown(0);
        const mv = input.moveAxis();
        if (canAct && (input.keyPressed('e') || input.keyPressed('Escape') || Math.hypot(mv.x, mv.z) > 0.5)) this.dismount();
      }
      this.model.pose = 'stand';
      this.model.speed = 0;
      this.model.update(dt);
      this.syncModel(dt, 0);
      return;
    }

    // ----- déplacement
    let mx = 0;
    let mz = 0;
    if (canAct) {
      const a = input.moveAxis();
      mx = a.x;
      mz = a.z;
    }
    const corps = st.gear.corps;
    let speed = BAL.walkSpeed * (corps ? GEAR[corps]?.speedMult ?? 1 : 1);
    const wantsSprint = canAct && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && (mx !== 0 || mz !== 0);
    const staminaMult = this.hasPerk('sprinteur') ? 0.7 : 1;
    if (wantsSprint && st.stamina > 1) {
      speed = BAL.sprintSpeed * (corps ? GEAR[corps]?.speedMult ?? 1 : 1);
      st.stamina = Math.max(0, st.stamina - BAL.sprintCost * staminaMult * dt);
    } else {
      st.stamina = Math.min(BAL.staminaMax, st.stamina + BAL.staminaRegen * dt * (this.dodgeT > 0 ? 0 : 1));
    }
    if (this.slowT > 0) {
      this.slowT -= dt;
      speed *= 1 - this.slow;
      if (this.slowT <= 0) this.slow = 0;
    }
    if (st.disease && st.disease.severity > 0.5) speed *= 0.9;
    // esquive
    if (canAct && input.wasPressed('Space') && this.dodgeT <= 0 && st.stamina >= BAL.dodgeCost * staminaMult) {
      st.stamina -= BAL.dodgeCost * staminaMult;
      this.dodgeT = BAL.dodgeTime;
      const l = Math.hypot(mx, mz);
      if (l > 0.1) {
        this.dodgeDx = mx / l;
        this.dodgeDz = mz / l;
      } else {
        this.dodgeDx = Math.sin(this.yaw);
        this.dodgeDz = Math.cos(this.yaw);
      }
      g.audio.play('melee', { x: this.x, z: this.z, volume: 0.4, pitch: 0.6 });
    }
    let tvx = mx * speed;
    let tvz = mz * speed;
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      tvx = this.dodgeDx * BAL.dodgeSpeed;
      tvz = this.dodgeDz * BAL.dodgeSpeed;
      g.engine.fx.dust(this.x, this.z, 0xa09a90, false);
    }
    this.vx = damp(this.vx, tvx, this.dodgeT > 0 ? 30 : 14, dt);
    this.vz = damp(this.vz, tvz, this.dodgeT > 0 ? 30 : 14, dt);
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const res = g.resolveMove(nx, nz, this.radius, this);
    this.x = res.x;
    this.z = res.z;
    const targetY = g.floorY(this.x, this.z);
    this.y = damp(this.y, targetY, 18, dt);
    this.onTrain = g.train.isInside(this.x, this.z);
    const moveSpeed = Math.hypot(this.vx, this.vz);
    if (moveSpeed > 1 && this.dodgeT <= 0) {
      this.stepT -= dt * moveSpeed;
      if (this.stepT <= 0) {
        this.stepT = 2.2;
        g.audio.play('step', { x: this.x, z: this.z, volume: 0.5 });
      }
    }

    // ----- orientation : vers la souris
    const desiredYaw = Math.atan2(this.aim.x - this.x, this.aim.z - this.z);
    this.yaw = dampAngle(this.yaw, desiredYaw, 20, dt);

    // ----- armes
    const inst = st.weapons[st.active];
    const w = this.weaponDef();
    this.fireCd -= dt;
    this.meleeCd -= dt;
    if (canAct) {
      for (let i = 0; i < 4; i++) {
        if (input.wasPressed(`Digit${i + 1}`) && st.weapons[i] && i !== st.active) {
          st.active = i;
          this.reloadT = 0;
          this.model.setWeapon(st.weapons[i]!.id);
          g.audio.play('reload', { volume: 0.4 });
        }
      }
      if (input.keyPressed('r') && inst && w.mag > 0 && inst.mag < w.mag) this.startReload();
      if (input.keyPressed('f')) this.flashlightOn = !this.flashlightOn;
      if (input.keyPressed('h')) g.useConsumable('trousses');
      if (input.keyPressed('x')) g.useConsumable('antirad');
      if (input.keyPressed('g')) this.throwDynamite();
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    const firing = canAct && !input.overUI && (w.auto ? input.mouseIsDown(0) : input.mouseWasPressed(0));
    if (firing && this.fireCd <= 0 && this.reloadT <= 0 && this.dodgeT <= 0) this.shoot();
    if (canAct && !input.overUI && input.mouseWasPressed(2) && this.meleeCd <= 0) this.quickMelee();
    this.model.setWeapon(w.id);
    this.model.pose = canAct && (input.mouseIsDown(0) || this.fireCd > 0) && w.kind !== 'melee' ? 'aim' : 'stand';

    // ----- interaction
    this.updateInteraction(dt, canAct);

    // ----- lampe torche
    const lampOwned = (st.items.lampe ?? 0) > 0;
    const night = 1 - g.engine.daylight;
    const dark = g.levelDarkness();
    const lampWanted = lampOwned && this.flashlightOn && (night > 0.35 || dark > 0.3);
    this.flashlight.intensity = lampWanted ? 22 * (0.5 + night * 0.5 + dark * 0.6) : 0;
    this.flashlight.position.set(this.x + Math.sin(this.yaw) * 0.3, this.y + 1.5, this.z + Math.cos(this.yaw) * 0.3);
    this.flashlight.target.position.set(this.x + Math.sin(this.yaw) * 8, this.y, this.z + Math.cos(this.yaw) * 8);

    this.model.speed = moveSpeed;
    this.model.update(dt);
    this.syncModel(dt, moveSpeed);
  }

  private syncModel(_dt: number, _speed: number): void {
    this.model.root.position.set(this.x, this.y, this.z);
    this.model.root.rotation.y = this.yaw;
  }

  private startReload(): void {
    const st = this.state;
    const inst = st.weapons[st.active];
    const w = this.weaponDef();
    if (!inst || w.mag <= 0 || !w.ammo) return;
    const per = w.shotsPerAmmo ?? 1;
    if ((this.game.state.train.resources[w.ammo] ?? 0) * per < 1) {
      this.game.ui.toast(`Plus de munitions (${w.ammo}) !`, 'mauvais');
      this.game.audio.play('empty');
      return;
    }
    this.reloadTotal = w.reload * (this.hasPerk('rechargement') ? 0.65 : 1);
    this.reloadT = this.reloadTotal;
    this.game.audio.play('reload', { x: this.x, z: this.z });
  }

  private finishReload(): void {
    const st = this.state;
    const inst = st.weapons[st.active];
    const w = this.weaponDef();
    if (!inst || !w.ammo) return;
    const per = w.shotsPerAmmo ?? 1;
    const need = w.mag - inst.mag;
    const units = Math.ceil(need / per);
    const have = this.game.state.train.resources[w.ammo] ?? 0;
    const used = Math.min(units, have);
    this.game.state.train.resources[w.ammo] = have - used;
    inst.mag = Math.min(w.mag, inst.mag + used * per);
  }

  private shoot(): void {
    const st = this.state;
    const inst = st.weapons[st.active];
    const w = this.weaponDef();
    if (w.mag > 0 && inst) {
      if (inst.mag <= 0) {
        this.startReload();
        if (this.reloadT <= 0) this.fireCd = 0.3;
        return;
      }
      inst.mag--;
    }
    this.fireCd = 1 / w.rate;
    const gun = w.kind !== 'melee';
    const dmgMult = gun ? (this.hasPerk('tireur') ? 1.15 : 1) : this.hasPerk('cogneur') ? 1.35 : 1;
    const spreadMult = (this.hasPerk('tireur') ? 0.75 : 1) * (Math.hypot(this.vx, this.vz) > 5 ? 1.4 : 1);
    const muzzleY = this.y + 1.3;
    const mx = this.x + Math.sin(this.yaw) * 0.7;
    const mz = this.z + Math.cos(this.yaw) * 0.7;
    this.game.combat.fire({
      weapon: w,
      level: inst?.level ?? 0,
      x: gun ? mx : this.x,
      y: muzzleY,
      z: gun ? mz : this.z,
      yaw: this.yaw,
      faction: 'joueur',
      owner: this,
      damageMult: dmgMult,
      spreadMult,
      tx: this.aim.x,
      tz: this.aim.z,
      fromTrain: this.onTrain,
    });
    this.model.attack();
    if (gun) this.game.engine.rig.shake(w.kind === 'shell' ? 0.15 : 0.04);
    if (w.mag > 0 && inst && inst.mag <= 0) this.startReload();
  }

  private quickMelee(): void {
    const melee = this.state.weapons.find((wi) => wi && WEAPONS[wi.id]?.kind === 'melee');
    const w = WEAPONS[melee?.id ?? 'cle'];
    this.meleeCd = 1 / w.rate;
    this.game.combat.fire({
      weapon: w,
      level: melee?.level ?? 0,
      x: this.x,
      y: this.y + 1.2,
      z: this.z,
      yaw: this.yaw,
      faction: 'joueur',
      owner: this,
      damageMult: this.hasPerk('cogneur') ? 1.35 : 1,
    });
    this.model.attack();
  }

  private throwDynamite(): void {
    const res = this.game.state.train.resources;
    if ((res.dynamite ?? 0) <= 0) {
      this.game.ui.toast('Plus de dynamite.', 'mauvais');
      return;
    }
    res.dynamite--;
    const boost = this.hasPerk('artificier') ? 1.4 : 1;
    const w = { ...DYNAMITE, damage: DYNAMITE.damage * boost, splash: (DYNAMITE.splash ?? 4) * boost };
    const d = Math.min(w.range, Math.hypot(this.aim.x - this.x, this.aim.z - this.z));
    this.game.combat.fire({
      weapon: w,
      x: this.x,
      y: this.y + 1.6,
      z: this.z,
      yaw: this.yaw,
      faction: 'joueur',
      owner: this,
      tx: this.x + Math.sin(this.yaw) * d,
      tz: this.z + Math.cos(this.yaw) * d,
      fromTrain: this.onTrain,
    });
    this.game.onDynamiteThrown(this.x + Math.sin(this.yaw) * d, this.z + Math.cos(this.yaw) * d);
    this.model.attack();
  }

  private updateInteraction(dt: number, canAct: boolean): void {
    const g = this.game;
    const input = g.input;
    // cherche l'interactif le plus proche, devant le joueur de préférence
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const it of g.interactables()) {
      const dx = it.x - this.x;
      const dz = it.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius + 0.9) continue;
      if (Math.abs(it.y - this.y) > 1.6) continue;
      const label = it.label();
      if (!label) continue;
      const facing = Math.cos(Math.atan2(dx, dz) - this.yaw);
      const score = d - facing * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.focus = best;
    if (!canAct) {
      this.holdT = 0;
      this.holdTarget = null;
      return;
    }
    const holdNeeded = best?.hold?.() ?? 0;
    if (best && holdNeeded > 0) {
      if (input.isDown('KeyE') || input.keyPressed('e')) {
        if (this.holdTarget !== best) {
          this.holdTarget = best;
          this.holdT = 0;
        }
        this.holdT += dt;
        if (this.holdT >= holdNeeded) {
          this.holdT = 0;
          best.interact();
        }
      } else {
        this.holdT = 0;
        this.holdTarget = null;
      }
    } else {
      this.holdT = 0;
      this.holdTarget = null;
      if (best && input.keyPressed('e')) best.interact();
    }
  }

  get holdProgress(): number {
    const need = this.holdTarget?.hold?.() ?? 0;
    return need > 0 ? clamp(this.holdT / need, 0, 1) : 0;
  }
}

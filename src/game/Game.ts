import * as THREE from 'three';
import { Engine } from '../render/engine';
import { Input } from '../core/input';
import { Audio } from '../core/audio';
import { BAL, DIFFICULTIES } from '../data/balance';
import { BIOMES, type BiomeDef } from '../data/biomes';
import { RESOURCES, GEAR, TOOLS, QUEST_ITEMS, personalItemName, setStationNameLookup, type ResourceId } from '../data/items';
import { WEAPONS, newWeapon } from '../data/weapons';
import { ENEMIES, type EnemyId } from '../data/enemies';
import { PERSONALITIES, SKILLS } from '../data/npcs';
import { WAGON_TYPES, EQUIPMENT } from '../data/train';
import { PERK_IDS } from '../data/perks';
import { Train, FRONT_X } from '../train/Train';
import { FLOOR, HALF_W } from '../train/trainModel';
import { boilerStep, powerStep, temperatureStep } from '../train/sim';
import { Combat, type CombatHost } from './combat';
import { Player } from './player';
import { Enemy, type EnemyMode } from './enemy';
import { NpcActor } from './npcActor';
import { StationLevel } from './stationLevel';
import { TravelLevel } from './travelLevel';
import { CrewSystem } from './crewSystem';
import { EventSystem } from './events';
import { QuestManager } from './quests';
import { Economy } from './economy';
import { Story } from '../story/story';
import { UI } from '../ui/UI';
import { MenuScene } from '../render/menuScene';
import { createNewGame, emptyStationDelta, type NewGameOptions } from '../state/newGame';
import { saveGame, deleteSave, loadSettings, saveSettings, type Settings } from '../state/save';
import { loadMeta, saveMeta, heritageEarned } from '../state/meta';
import { addResource, crewOnBoard, wagonMaxHp, freeBeds } from '../state/trainState';
import { extendInfiniteMap, findEdge, revealNeighbors } from '../world/map';
import { clamp, clamp01, damp, lerp, rectContains } from '../core/math';
import type { LootEntry } from '../world/loot';
import type { LockSpec, NoteSpec, SpecialSpec, LeverSpec } from '../world/stationBuilder';
import type { Level } from './level';
import type { Actor, DamageSource, Faction, Hazard, Interactable, BuildingRuntime } from './types';
import type { GameState, NpcState, DiseaseId } from '../state/types';
import type { WagonRuntime } from '../train/Train';

export type GameEvent =
  | { type: 'arrive'; station: string }
  | { type: 'depart'; from: string; to: string }
  | { type: 'item'; id: string; qty: number }
  | { type: 'resource'; id: ResourceId; qty: number }
  | { type: 'kill'; enemy: EnemyId; station: string | null; boss: boolean }
  | { type: 'talk'; npc: string }
  | { type: 'special'; action: string; station: string }
  | { type: 'lever'; id: string; state: number }
  | { type: 'recruit'; npc: string }
  | { type: 'note'; id: string }
  | { type: 'enterBuilding'; id: string; name: string }
  | { type: 'waveCleared' }
  | { type: 'npcDeath'; npc: string }
  | { type: 'npcLeft'; npc: string }
  | { type: 'container'; id: string };

export class Game implements CombatHost {
  readonly engine: Engine;
  readonly input: Input;
  readonly audio = new Audio();
  readonly ui: UI;
  state!: GameState;
  train!: Train;
  player!: Player;
  combat!: Combat;
  crew = new Map<string, NpcActor>();
  level: Level | null = null;
  readonly crewSystem: CrewSystem;
  readonly events: EventSystem;
  readonly quests: QuestManager;
  readonly economy: Economy;
  readonly story: Story;
  settings: Settings;
  running = false;
  paused = true;
  timeScale = 1;
  inCombat = false;
  private combatT = 0;
  private lastFrame = performance.now();
  private tickAcc = 0;
  private notified = new Set<string>();
  private floorCache = { x: 0, z: 0 };
  private fpsAcc = { t: 0, n: 0, fps: 60 };
  private transitioning = false;
  private arrivalBrake = false;
  private envT = 0;
  extTempCache = 15;
  private musicT = 0;

  get scene(): THREE.Scene {
    return this.engine.scene;
  }

  get fx() {
    return this.engine.fx;
  }

  get lights() {
    return this.engine.lights;
  }

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.settings = loadSettings();
    this.applySettings();
    this.crewSystem = new CrewSystem(this);
    this.events = new EventSystem(this);
    this.quests = new QuestManager(this);
    this.economy = new Economy(this);
    this.story = new Story(this);
    this.ui = new UI(this, uiRoot);
    setStationNameLookup((id) => this.state?.map.nodes[id]?.name ?? id);
  }

  applySettings(): void {
    const s = this.settings;
    this.audio.volumes = { master: s.master, sfx: s.sfx, music: s.music, ambient: s.ambient };
    this.audio.applyVolumes();
    this.engine.setQuality(s.quality, s.shadows);
    this.engine.rig.shakeEnabled = s.screenShake;
    saveSettings(s);
  }

  // ================================================================== boucle

  start(): void {
    this.running = true;
    this.ui.showMainMenu();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      dt = Math.min(dt, 0.05);
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t >= 0.5) {
      this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t;
      this.fpsAcc.t = 0;
      this.fpsAcc.n = 0;
    }
    if (this.state && this.train && this.player) {
      this.ui.handleHotkeys();
      if (!this.paused && !this.ui.blocking && !this.state.over) {
        const steps = this.timeScale > 1 ? Math.round(this.timeScale) : 1;
        for (let i = 0; i < steps; i++) this.update(dt);
      } else if (this.player) {
        // animations minimales en pause
        this.engine.rig.update(dt);
      }
      this.updateCamera(dt);
      const night = 1 - this.engine.daylight;
      if (this.level) this.level.requestLights(this.player.x, this.player.z, night);
      this.engine.lights.update(dt, this.player.x, this.player.z);
      this.ui.update(dt);
    } else {
      this.menuBackdrop(dt);
    }
    this.engine.render();
    this.input.endFrame();
  }

  get fps(): number {
    return this.fpsAcc.fps;
  }

  /** Débogage / tests : avance la simulation sans rendu. */
  debugStep(seconds: number, dt = 0.05): void {
    for (let t = 0; t < seconds; t += dt) {
      if (this.state.over) break;
      this.update(dt);
    }
  }

  private menu: MenuScene | null = null;
  /** Décor animé du menu principal. */
  private menuBackdrop(dt: number): void {
    if (!this.menu) this.menu = new MenuScene(this.engine);
    this.menu.update(dt);
  }

  /** Vue de débogage (tests automatisés) : caméra libre au-dessus d'un point. */
  debugView: { x: number; z: number; dist: number; pitch: number } | null = null;

  private updateCamera(dt: number): void {
    const rig = this.engine.rig;
    const p = this.player;
    if (this.debugView) {
      const v = this.debugView;
      rig.maxDist = 500;
      rig.setZoom(v.dist, true);
      rig.pitch = v.pitch;
      rig.yaw = 0;
      rig.target.set(v.x, 0, v.z);
      rig.snap();
      rig.update(dt);
      this.engine.scene.fog = null;
      return;
    }
    if (this.input.wheel && !this.ui.blocking && !this.input.overUI) rig.zoom(this.input.wheel);
    const mounted = p.mounted;
    if (mounted) rig.target.set(lerp(p.x, mounted.x, 0.5), 1, lerp(p.z, mounted.z, 0.5));
    else rig.target.set(p.x, p.y * 0.6, p.z);
    rig.yaw = damp(rig.yaw, 0, 3, dt);
    rig.maxDist = (this.state.player.items.jumelles ?? 0) > 0 ? 52 : 42;
    rig.update(dt);
    this.audio.listenerX = p.x;
    this.audio.listenerZ = p.z;
  }

  // ================================================================== simulation

  private update(dt: number): void {
    const st = this.state;
    st.time += dt * BAL.minutesPerSecond;
    st.stats.playTime += dt;
    const level = this.level;
    const travel = level instanceof TravelLevel ? level : null;

    // ---- train : chaudière, énergie, températures
    const loco = st.train.wagons[0];
    const locoHealth = loco ? clamp01(loco.hp / wagonMaxHp(st, loco)) : 0;
    const stoker = this.crewSystem.stokerBonus();
    const ext = this.extTemp();
    this.extTempCache = ext;
    const power = powerStep(st.train, dt, {
      inCombat: this.inCombat,
      night: this.isNight(),
      extTemp: ext,
      engineerBonus: this.crewSystem.engineerBonus(),
      locoHealth,
      gas: !!travel && (BIOMES[travel.to.biome].gas > 0.5 || travel.inTunnel()),
    });
    this.train.power = power;
    const moving = !!travel;
    if (moving) {
      if (this.arrivalBrake) st.train.throttle = 0;
      const res = boilerStep(st.train, dt, {
        coalMult: stoker.coalMult * (this.player.hasPerk('chauffeur') ? 0.92 : 1),
        heatRelief: stoker.heatRelief + (this.player.hasPerk('chauffeur') ? 0.6 : 0),
        powerUsed: power.used,
        difficultyCoal: DIFFICULTIES[st.difficulty].coal,
        locoHealth,
      });
      let target = res.targetSpeed;
      if (locoHealth <= 0) {
        // locomotive hors service : le train s'immobilise jusqu'à réparation
        target = 0;
        st.train.throttle = 0;
      } else if (this.locoDown) {
        this.locoDown = false;
        this.ui.toast('La locomotive est réparée : elle peut repartir.', 'bon');
      }
      if (this.train.shovelBoost > 0) {
        this.train.shovelBoost -= dt;
        target *= 1.08;
      }
      if (travel.onBridge() && this.train.speed > BAL.speeds[3] && Math.random() < dt * 0.5) {
        this.notifyOnce('pont', 'Le pont tremble sous la vitesse ! Ralentissez.', 'mauvais');
        this.train.damageWagon(Math.floor(Math.random() * this.train.wagons.length), 15, { faction: 'neutre', x: 0, z: 0, kind: 'explosion' }, 0, 0);
      }
      const accel = target > this.train.speed ? BAL.accel : BAL.brake;
      this.train.speed = Math.max(0, this.train.speed + clamp(target - this.train.speed, -accel * dt, accel * dt));
      if (res.overheated) {
        this.train.damageWagon(0, 45, { faction: 'neutre', x: FRONT_X - 5, z: 0, kind: 'explosion' }, FRONT_X - 5, 0);
        this.ui.toast('SURCHAUFFE ! La soupape a sauté, la chaudière est endommagée.', 'mauvais');
        this.audio.play('alarm');
      }
      if (res.starved && !this.notified.has('charbon_vide')) {
        this.notifyOnce('charbon_vide', 'Plus de charbon ! Le train ralentit… Cherchez du bois ou du charbon près de la voie.', 'mauvais');
      }
      st.stats.distance += this.train.speed * dt;
    } else {
      this.train.speed = 0;
      // à quai : la chaudière reste en veille
      boilerStep(st.train, dt, { coalMult: stoker.coalMult, heatRelief: 0, powerUsed: power.used, difficultyCoal: DIFFICULTIES[st.difficulty].coal, locoHealth });
      st.train.throttle = 0;
    }
    temperatureStep(st, dt, ext, power.ratio.chauffage);
    this.train.update(dt, this.inCombat);

    // ---- niveau, acteurs
    level?.update(dt);
    if (travel) this.events.update(dt, travel);
    this.player.update(dt);
    for (const a of this.crew.values()) a.update(dt);
    if (level) {
      for (const r of level.residents) r.update(dt);
      for (const e of level.enemies) e.update(dt);
      this.separateEnemies();
    }
    this.combat.update(dt);
    this.engine.fx.update(dt, this.groundSpeed());
    this.updateWeather(dt);

    // ---- vue intérieure du train
    this.train.applyInsideView(this.player.onTrain || (this.player.mounted !== null));

    // ---- environnement & dangers (joueur)
    this.envT += dt;
    this.applyPlayerEnvironment(dt, ext);

    // ---- combat
    const anyEngaged = level ? level.enemies.some((e) => e.alive && (e.mode === 'assaut' || e.ai === 'chase' || e.ai === 'attack' || e.ai === 'inside')) : false;
    if (anyEngaged) this.combatT = 4;
    else this.combatT -= dt;
    const was = this.inCombat;
    this.inCombat = this.combatT > 0;
    if (this.inCombat !== was) {
      if (this.inCombat) this.timeScale = 1;
      this.audio.setMusic(this.inCombat ? 'tense' : 'calm');
    }

    // ---- systèmes à 1 Hz
    this.tickAcc += dt;
    while (this.tickAcc >= 1) {
      this.tickAcc -= 1;
      this.crewSystem.tick(1);
      this.quests.tick(1);
      this.story.tick(1);
      this.economy.tick(1);
      this.checkStationRadiation();
    }

    // ---- environnement visuel
    const env = level?.env;
    const darkness = Math.max(level?.darknessAt(this.player.x, this.player.z) ?? 0, travel?.inTunnel() ? 0.85 : 0);
    if (env) {
      const rad = this.radiationAt(this.player.x, this.player.z);
      const gas = this.hazardAt('gaz', this.player.x, this.player.z);
      this.engine.setEnvironment({
        minutes: st.time,
        fogColor: env.fogColor,
        weather: env.weather,
        darkness,
        winter: st.season === 'hiver' || env.biome === 'toundra',
        tint: gas > 0 ? 0xc8d060 : rad > 0.5 ? 0x7dff3a : env.tint,
        tintAmount: gas > 0 ? 0.35 : rad > 0.5 ? Math.min(0.3, rad * 0.05) : env.tintAmount,
      }, dt);
    }
    // ---- arrivée
    if (travel) this.updateArrival(travel);
    // ---- musique d'ambiance
    this.musicT -= dt;
    if (this.musicT <= 0) {
      this.musicT = 5;
      if (!this.inCombat) this.audio.setMusic('calm');
    }
    const windBase = (st.season === 'hiver' ? 0.6 : 0.25) + (env?.weather === 'tempete' ? 0.5 : 0);
    this.audio.setWind(this.player.onTrain ? windBase * 0.4 + this.train.speed / 40 : windBase + this.train.speed / 30, st.season === 'hiver' ? 0.6 : 0.2);
  }

  private separateEnemies(): void {
    const list = this.level?.enemies ?? [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.flying) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.flying || a.onTrain !== b.onTrain) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0 && d2 < rr * rr) {
          const d = Math.sqrt(d2);
          const push = (rr - d) * 0.5;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
      // repousse aussi le joueur (sans le bloquer)
      const p = this.player;
      if (p.alive && p.onTrain === a.onTrain) {
        const dx = p.x - a.x;
        const dz = p.z - a.z;
        const rr = a.radius + p.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < rr * rr) {
          const d = Math.sqrt(d2);
          const push = rr - d;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
        }
      }
    }
  }

  // ================================================================== nouvelle partie / chargement

  newGame(opts: NewGameOptions): void {
    const meta = opts.mode === 'infini' ? loadMeta() : null;
    const state = createNewGame({ ...opts, meta: meta?.active ?? [] });
    this.loadState(state, true);
  }

  loadState(state: GameState, fresh = false): void {
    if (this.menu) {
      this.menu.dispose();
      this.menu = null;
    }
    this.disposeWorld();
    this.engine.rig.setZoom(25, true);
    this.engine.rig.yaw = 0;
    this.engine.rig.pitch = 0.98;
    this.state = state;
    this.notified.clear();
    this.locoDown = false;
    this.train = new Train(this);
    this.scene.add(this.train.group);
    this.combat = new Combat(this.scene, this);
    this.player = new Player(this);
    this.scene.add(this.player.model.root);
    this.player.refreshLook();
    this.train.rebuild();
    this.story.onLoad(fresh);
    this.quests.onLoad();
    const loc = state.location;
    const stationId = loc.kind === 'station' ? loc.station : loc.from;
    this.enterStation(stationId, { fresh, arriving: false });
    this.paused = false;
    this.audio.setMusic('calm');
    if (fresh) this.story.intro();
  }

  private disposeWorld(): void {
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
    for (const a of this.crew.values()) a.dispose();
    this.crew.clear();
    if (this.train) {
      this.train.clearDetached();
      this.scene.remove(this.train.group);
    }
    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.scene.remove(this.player.flashlight, this.player.flashlight.target);
    }
    if (this.combat) this.combat.clear();
    this.engine.fx.clear();
  }

  quitToMenu(): void {
    this.disposeWorld();
    this.state = undefined as unknown as GameState;
    this.train = undefined as unknown as Train;
    this.paused = true;
    this.ui.showMainMenu();
    this.audio.setMusic('none');
  }

  // ================================================================== gares et voyages

  enterStation(id: string, opts: { fresh?: boolean; arriving?: boolean } = {}): void {
    const st = this.state;
    if (this.level) this.level.dispose();
    this.level = null;
    this.combat.clear();
    this.engine.fx.clear();
    this.train.clearDetached();
    this.train.speed = 0;
    st.train.throttle = 0;
    this.arrivalBrake = false;
    const node = st.map.nodes[id];
    st.map.current = id;
    st.location = { kind: 'station', station: id };
    if (node.season !== st.season && st.mode === 'infini') this.changeSeason(node.season);
    st.stations[id] ??= emptyStationDelta();
    const level = new StationLevel(this, node);
    this.level = level;
    this.engine.snapEnv = true;
    const delta = st.stations[id];
    const firstVisit = delta.visits === 0;
    delta.visits++;
    delta.lastVisit = st.time;
    delta.dwell = 0;
    if (!node.visited) {
      node.visited = true;
      st.stats.stations++;
    }
    node.known = true;
    node.scouted = true;
    revealNeighbors(st.map, id, this.crewSystem.hasSkill('eclaireur'));
    if (st.mode === 'infini') extendInfiniteMap(st.map, st.seed, node.layer + 6);
    // joueur sur le quai
    const sp = level.spawnPoint();
    this.player.teleport(sp.x, sp.z);
    this.player.alive = st.player.hp > 0;
    this.player.dismount();
    this.engine.rig.snap();
    this.syncCrewActors(true);
    if (opts.arriving) {
      this.emit({ type: 'arrive', station: id });
      this.crewSystem.onArrive(id);
      this.ui.stationBanner(node);
    }
    if (firstVisit) this.economy.ensureStock(node);
    if (!opts.fresh) this.autosave();
  }

  /** Lance le voyage vers une gare voisine. */
  depart(toId: string): boolean {
    const st = this.state;
    if (st.location.kind !== 'station' || this.transitioning) return false;
    if ((st.train.wagons[0]?.hp ?? 0) <= 0) {
      this.ui.toast('La locomotive est hors service : réparez-la avant de partir.', 'mauvais');
      return false;
    }
    const from = st.map.current;
    const edge = findEdge(st.map, from, toId);
    if (!edge) return false;
    const block = this.story.canDepart(toId) ?? this.quests.canDepart(toId);
    if (block) {
      this.ui.toast(block, 'mauvais');
      return false;
    }
    if ((st.train.resources.charbon ?? 0) < 3) {
      this.ui.toast('Pas assez de charbon pour partir !', 'mauvais');
      return false;
    }
    // l'escorte remonte à bord
    for (const a of this.crew.values()) if (a.data.job === 'suivre') a.resetSpot();
    if (!this.player.onTrain) {
      const cab = this.train.wagons[0];
      const p = this.train.pointWorld(cab, 'controls');
      if (p) this.player.teleport(p.x - 0.8, p.z + 0.6, FLOOR);
    }
    this.level?.dispose();
    const travel = new TravelLevel(this, st.map.nodes[from], st.map.nodes[toId], edge);
    this.level = travel;
    this.engine.snapEnv = true;
    st.location = { kind: 'voyage', from, to: toId, progress: 0, length: edge.length, eventsDone: [] };
    st.train.throttle = 2;
    this.train.speed = 0.5;
    this.arrivalBrake = false;
    this.syncCrewActors(false);
    this.events.plan(travel);
    this.emit({ type: 'depart', from, to: toId });
    this.audio.play('whistle', { volume: 0.8 });
    this.ui.toast(`Départ pour ${st.map.nodes[toId].name} (${(edge.length / 1000).toFixed(1)} km).`, 'info');
    this.timeScale = 1;
    return true;
  }

  private updateArrival(travel: TravelLevel): void {
    const remaining = travel.length - travel.progress;
    const v = this.train.speed;
    const brakeDist = (v * v) / (2 * BAL.brake) + 6;
    if (remaining <= brakeDist && !this.arrivalBrake) {
      this.arrivalBrake = true;
      this.state.train.throttle = 0;
      this.ui.toast(`Arrivée en gare de ${travel.to.name}…`, 'info');
      this.audio.play('whistle', { volume: 0.6 });
    }
    if (this.arrivalBrake && v < 0.3 && (this.state.train.wagons[0]?.hp ?? 0) > 0) this.train.speed = Math.max(this.train.speed, 0.8);
    // seuls les ennemis à bord ou accrochés aux wagons empêchent d'entrer en gare ;
    // les autres battent en retraite devant les défenses de la gare
    const threat = travel.enemies.some((e) => e.alive && (e.onTrain || e.latchedWagon >= 0));
    if (remaining <= 0.5 && !this.transitioning && !threat) {
      this.transitioning = true;
      this.ui.fade(true, () => {
        this.timeScale = 1;
        this.enterStation(travel.to.id, { arriving: true });
        this.transitioning = false;
        this.ui.fade(false);
      });
    } else if (remaining <= 0.5 && threat) {
      this.train.speed = 0;
      this.notifyOnce(`gare_bloquee:${travel.to.id}`, 'Repoussez les assaillants : le train ne peut pas entrer en gare avec des ennemis à bord ou accrochés aux wagons !', 'mauvais');
    }
  }

  isTravelling(): boolean {
    return this.level instanceof TravelLevel;
  }

  trainMoving(): boolean {
    return this.train.speed > 0.3;
  }

  followersActive(): boolean {
    return this.level instanceof StationLevel || (this.level instanceof TravelLevel && !this.trainMoving());
  }

  changeSeason(season: GameState['season']): void {
    if (this.state.season === season) return;
    this.state.season = season;
    this.ui.toast(season === 'hiver' ? 'L\'hiver est arrivé. Le froid devient un ennemi : chauffez les wagons !' : 'L\'été revient. Le dégel libère les voies.', 'info');
    this.log(season === 'hiver' ? 'Début de l\'hiver.' : 'Retour de l\'été.', 'info');
  }

  /** Crée/supprime les acteurs 3D de l'équipage selon l'état. */
  syncCrewActors(placeOnTrain: boolean): void {
    const onBoard = crewOnBoard(this.state);
    const ids = new Set(onBoard.map((n) => n.id));
    for (const [id, a] of this.crew) {
      if (!ids.has(id)) {
        a.dispose();
        this.crew.delete(id);
      }
    }
    for (const n of onBoard) {
      let a = this.crew.get(n.id);
      if (!a) {
        a = new NpcActor(this, n);
        this.crew.set(n.id, a);
        placeOnTrain = true;
      }
      a.refreshFaction();
      if (placeOnTrain || !this.train.isInside(a.x, a.z)) {
        let wi = this.train.wagons.findIndex((w) => w.state.uid === n.wagon);
        if (wi < 0) {
          wi = this.crewSystem.wagonWithFreeBed() ?? Math.min(2, this.train.wagons.length - 1);
          n.wagon = this.train.wagons[wi]?.state.uid ?? null;
        }
        const w = this.train.wagons[wi];
        if (w) a.teleport(w.cx + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 0.6, FLOOR);
        a.resetSpot();
      }
    }
  }

  // ================================================================== hôte de combat

  targets(f: Faction): Actor[] {
    const out: Actor[] = [];
    const level = this.level;
    if (f === 'joueur') {
      if (level) for (const e of level.enemies) if (e.alive) out.push(e);
    } else {
      if (this.player.alive) out.push(this.player);
      for (const a of this.crew.values()) if (a.alive) out.push(a);
    }
    return out;
  }

  shotBlocked(x0: number, z0: number, x1: number, z1: number): number {
    const lv = this.level;
    if (!lv || !lv.collidersActive) return 1;
    return lv.colliders.raycast(x0, z0, x1, z1, true, (c) => c.tag === 'water');
  }

  trainHit(x0: number, z0: number, x1: number, z1: number): { t: number; wagon: number } | null {
    return this.train.hitTest(x0, z0, x1, z1);
  }

  damageTrain(wagon: number, amount: number, src: DamageSource, x: number, z: number): void {
    this.train.damageWagon(wagon, amount, src, x, z);
  }

  trainInside(x: number, z: number): boolean {
    return this.train.isInside(x, z);
  }

  addHazard(h: Hazard): void {
    this.level?.hazards.push(h);
  }

  shake(amount: number): void {
    this.engine.rig.shake(amount);
  }

  floatText(x: number, y: number, z: number, text: string, color: string): void {
    this.ui.floatText(x, y, z, text, color);
  }

  groundSpeed(): number {
    return this.isTravelling() ? this.train.speed : 0;
  }

  onKill(victim: Actor, src: DamageSource): void {
    if (victim instanceof Enemy) {
      const st = this.state;
      st.stats.kills++;
      this.gainXp(victim.def.xp);
      const lv = this.level;
      if (lv instanceof StationLevel && victim.persistId) {
        lv.delta.killed.push(victim.persistId);
        if (!victim.lootDone) {
          victim.lootDone = true;
          this.dropEnemyLoot(victim, true);
        }
      } else if (lv instanceof TravelLevel) {
        lv.waveKills++;
        if (!victim.lootDone) {
          victim.lootDone = true;
          this.dropEnemyLoot(victim, false);
        }
      }
      this.emit({ type: 'kill', enemy: victim.def.id, station: lv instanceof StationLevel ? lv.node.id : null, boss: !!victim.def.boss });
      if (src.attacker instanceof NpcActor) src.attacker.bark('kill', 0.4);
    }
  }

  private dropEnemyLoot(e: Enemy, station: boolean): void {
    const diff = DIFFICULTIES[this.state.difficulty];
    const parts: string[] = [];
    for (const [k, range] of Object.entries(e.def.loot) as [ResourceId, [number, number]][]) {
      if (!range) continue;
      let q = Math.round((range[0] + Math.random() * (range[1] - range[0])) * diff.loot * (station ? 1 : 0.6));
      if (q <= 0) continue;
      q = addResource(this.state, k, q);
      if (q > 0) parts.push(`+${q} ${RESOURCES[k].short}`);
    }
    if (parts.length) this.floatText(e.x, e.y + 2.2, e.z, parts.join(' '), '#ffe9a0');
  }

  // ================================================================== services aux acteurs

  /** Déplacement avec collisions (décor + train). */
  resolveMove(x: number, z: number, r: number, who: Actor): { x: number; z: number } {
    const lv = this.level;
    let px = x;
    let pz = z;
    if (lv && lv.collidersActive && !(who.flying)) {
      const res = lv.colliders.resolve(px, pz, r);
      px = res.x;
      pz = res.z;
    }
    const res2 = this.train.colliders.resolve(px, pz, r);
    px = res2.x;
    pz = res2.z;
    // à bord d'un train en marche : impossible de descendre
    if (this.trainMoving() && who.onTrain) {
      if (!this.train.isInside(px, pz)) {
        px = clamp(px, this.train.rearX + 0.4, FRONT_X - 0.4);
        pz = clamp(pz, -HALF_W + 0.3, HALF_W - 0.3);
      }
    }
    if (lv) {
      const b = lv.bounds;
      px = clamp(px, b.x0 + 1, b.x1 - 1);
      pz = clamp(pz, b.z0 + 1, b.z1 - 1);
    }
    return { x: px, z: pz };
  }

  floorY(x: number, z: number): number {
    this.floorCache.x = x;
    this.floorCache.z = z;
    if (this.train.isInside(x, z)) return FLOOR;
    return this.level?.groundY(x, z) ?? 0;
  }

  levelBlocked(x: number, z: number, r: number): boolean {
    const lv = this.level;
    if (!lv || !lv.collidersActive) return false;
    return lv.colliders.blocked(x, z, r) || this.train.colliders.blocked(x, z, r);
  }

  lineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    const lv = this.level;
    if (!lv || !lv.collidersActive) return true;
    return lv.colliders.lineOfSight(x0, z0, x1, z1, (c) => c.tag === 'water');
  }

  findPath(x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] | null {
    return this.level?.findPath(x0, z0, x1, z1) ?? null;
  }

  levelDarkness(): number {
    const lv = this.level;
    if (!lv) return 0;
    const tunnel = lv instanceof TravelLevel && lv.inTunnel() ? 0.85 : 0;
    return Math.max(tunnel, lv.darknessAt(this.player.x, this.player.z));
  }

  enemiesAlive(): Actor[] {
    return (this.level?.enemies ?? []).filter((e) => e.alive);
  }

  enemyCount(): number {
    return (this.level?.enemies ?? []).filter((e) => e.alive).length;
  }

  spawnEnemy(id: EnemyId, x: number, z: number, threat: number, mode: EnemyMode): Enemy {
    const e = new Enemy(this, id, x, z, threat, mode);
    if (mode === 'assaut') {
      e.side = z >= 0 ? 1 : -1;
      e.pickTrainTarget();
    }
    this.level?.enemies.push(e);
    return e;
  }

  nearestHostile(e: Enemy, range: number, onTrainOnly = false): Actor | null {
    let best: Actor | null = null;
    let bd = range;
    for (const t of this.targets(e.faction)) {
      if (!t.alive) continue;
      if (onTrainOnly && !t.onTrain) continue;
      if (!onTrainOnly && e.mode === 'station' && t.onTrain && t !== this.player) continue;
      const d = Math.hypot(t.x - e.x, t.z - e.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  nearestEnemyTo(x: number, z: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of this.level?.enemies ?? []) {
      if (!e.alive || e.hiddenFromTurrets) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  boarderNear(x: number, range: number): Enemy | null {
    for (const e of this.level?.enemies ?? []) if (e.alive && e.onTrain && Math.abs(e.x - x) < range) return e;
    return null;
  }

  alertGroup(e: Enemy): void {
    for (const o of this.level?.enemies ?? []) {
      if (o === e || !o.alive || o.alerted) continue;
      if ((e.group && o.group === e.group) || Math.hypot(o.x - e.x, o.z - e.z) < 14) {
        o.alerted = true;
        if (o.ai === 'idle' || o.ai === 'patrol') {
          o.ai = 'chase';
          o.target = e.target;
        }
      }
    }
  }

  boardTrain(e: Enemy, wagonIndex: number): void {
    // un abordeur saute du deux-roues dans le wagon
    const lv = this.level;
    if (!lv) return;
    const w = this.train.wagons[wagonIndex];
    if (!w) return;
    const boarder = new Enemy(this, 'abordeur', e.x, e.z, (lv as TravelLevel).to?.threat ?? 1, 'assaut');
    boarder.side = e.side;
    boarder.board(wagonIndex);
    lv.enemies.push(boarder);
    e.boardChance = 0;
    e.offsetX += 20;
    e.standoff = 12;
    this.ui.toast(`Abordage dans le wagon ${wagonIndex + 1} (${WAGON_TYPES[w.state.type].name}) !`, 'mauvais');
    this.audio.play('alarm', { volume: 0.6 });
    this.crewSystem.onBoarding(wagonIndex);
  }

  onEnemyLit(e: Actor): void {
    const en = e as Enemy;
    en.litT = 0.5;
    if (en.def.fearLight) {
      en.slow = Math.max(en.slow, 0.35);
      en.slowT = 0.5;
    }
  }

  gunnerSkill(id: string): number {
    const n = this.state.npcs[id];
    if (!n) return 0;
    const base = n.skill === 'tireur' ? n.skillLevel : n.skill === 'garde' ? n.skillLevel * 0.6 : 0.3;
    return base * (n.morale < 25 ? 0.6 : 1) + (n.secret === 'veteran' ? 1 : 0);
  }

  infectPlayer(id: DiseaseId): void {
    const p = this.state.player;
    if (p.disease) return;
    if (this.player.hasPerk('infirmier') && Math.random() < 0.5) return;
    p.disease = { id, severity: 0, incubation: id === 'infection' ? 30 : 120, known: false, treated: 0 };
  }

  infectActor(a: Actor, id: DiseaseId): void {
    if (a instanceof NpcActor && !a.data.disease) a.data.disease = { id, severity: 0, incubation: 60, known: false, treated: 0 };
  }

  safestWagon(): number {
    let best = 0;
    let bestScore = -Infinity;
    const enemies = this.level?.enemies.filter((e) => e.alive) ?? [];
    for (const w of this.train.wagons) {
      if (w.model.open) continue;
      const threat = enemies.filter((e) => Math.abs(e.x - w.cx) < 12).length;
      const score = w.state.hp / wagonMaxHp(this.state, w.state) * 10 - threat * 3 + (w.state.type === 'blinde' ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = w.index;
      }
    }
    return best;
  }

  isNight(): boolean {
    return this.engine.daylight < 0.35;
  }

  npcObeys(n: NpcState, label: string): boolean {
    return this.crewSystem.obeys(n, label);
  }

  npcAmbientBark(a: NpcActor): void {
    this.crewSystem.ambientBark(a);
  }

  mostNeedyPatient(medic: NpcActor): NpcActor | null {
    return this.crewSystem.mostNeedyPatient(medic);
  }

  treatPatient(medic: NpcActor, patient: NpcActor, dt: number): void {
    this.crewSystem.treat(medic, patient, dt);
  }

  crewFollowersNear(x: number, z: number, r: number): boolean {
    for (const a of this.crew.values()) if (Math.hypot(a.x - x, a.z - z) < r) return true;
    return false;
  }

  // ================================================================== environnement du joueur

  biome(): BiomeDef {
    return BIOMES[this.level?.env.biome ?? 'plaines'];
  }

  /** Température extérieure (°C) selon biome, saison, heure et météo. */
  extTemp(): number {
    const env = this.level?.env;
    const bio = BIOMES[env?.biome ?? 'plaines'];
    const [lo, hi] = bio.temp[this.state.season];
    const m = ((this.state.time % 1440) + 1440) % 1440;
    const daily = (Math.cos(((m - 15 * 60) / 1440) * Math.PI * 2) + 1) / 2;
    let t = lo + (hi - lo) * daily;
    if (env?.weather === 'tempete') t -= 8;
    else if (env?.weather === 'neige') t -= 3;
    else if (env?.weather === 'pluie') t -= 2;
    t += this.events.tempModifier;
    return t;
  }

  hazardAt(kind: Hazard['kind'], x: number, z: number): number {
    let sum = 0;
    for (const h of this.level?.hazards ?? []) {
      if (h.kind !== kind) continue;
      if (h.rect) {
        if (rectContains(h.rect, x, z)) sum += h.intensity;
      } else {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < h.r) sum += h.intensity * (kind === 'radiation' ? 1 - (d / h.r) * 0.7 : 1);
      }
    }
    return sum;
  }

  radiationAt(x: number, z: number): number {
    const lv = this.level;
    let r = this.hazardAt('radiation', x, z);
    if (lv instanceof StationLevel && !this.train.isInside(x, z)) r += lv.node.radiation * 0.08;
    if (lv instanceof TravelLevel) r += BIOMES[lv.biomeAt(lv.progress)].radiation * 0.15 + this.events.radStorm;
    return r;
  }

  /** Température ressentie à l'endroit du joueur. */
  localTemp(): number {
    const p = this.player;
    if (p.onTrain) {
      const wi = this.train.wagonAt(p.x);
      const w = this.train.wagons[wi];
      if (w) return w.state.temp;
    }
    const ext = this.extTempCache;
    const lv = this.level;
    if (lv instanceof StationLevel) {
      for (const b of lv.buildings) if (b.inside && rectContains(b.rect, p.x, p.z)) return ext + 9;
    }
    return ext;
  }

  private applyPlayerEnvironment(dt: number, _ext: number): void {
    const p = this.player;
    const st = this.state.player;
    if (!p.alive) return;
    const corps = st.gear.corps;
    const gear = corps ? GEAR[corps] : null;
    // froid
    let temp = this.localTemp();
    const heat = this.hazardAt('chaleur', p.x, p.z);
    if (heat > 0) temp = Math.max(temp, 22);
    const coldProt = (gear?.coldProtect ?? 0) + (this.player.hasPerk('endurci') ? 0.4 : 0);
    if (temp < 10) {
      st.warmth -= BAL.coldRate * (10 - temp) * (1 - Math.min(0.9, coldProt)) * dt;
    } else if (temp > 14) {
      st.warmth += BAL.warmRate * dt * (heat > 0 ? 2 : 1);
    }
    st.warmth = clamp(st.warmth, 0, 100);
    if (st.warmth <= 0) {
      p.damage(BAL.hypothermiaDamage * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'froid' });
      this.notifyOnce('hypothermie', 'Hypothermie ! Trouvez de la chaleur : wagon chauffé, bâtiment, feu de camp.', 'mauvais');
    } else if (st.warmth < 30) this.notifyOnce('froid', 'Vous avez froid. Un manteau ou un wagon chauffé vous ferait du bien.', 'info');
    // radiations
    const rad = this.radiationAt(p.x, p.z);
    if (rad > 0.01) {
      const prot = (gear?.radProtect ?? 0) + (this.player.hasPerk('endurci') ? 0.25 * (1 - (gear?.radProtect ?? 0)) : 0);
      st.rads += rad * (1 - Math.min(0.95, prot)) * dt;
      if (st.rads > 60 && !(st.items.geiger ?? 0)) this.notifyOnce('rads_sans_geiger', 'Votre peau picote et vous avez la nausée… Des radiations ? Il vous faudrait un compteur Geiger.', 'mauvais');
    }
    if (st.rads >= BAL.radLethal) p.damage(5 * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'radiation' });
    if (p.hp > p.maxHp) st.hp = p.maxHp;
    // gaz
    const gas = this.hazardAt('gaz', p.x, p.z) + (this.level instanceof TravelLevel && (this.level.inTunnel() && this.biome().gas > 0.5) && !p.onTrain ? 1 : 0);
    if (gas > 0) {
      const masked = st.gear.tete === 'masque';
      if (masked && st.filter <= 0 && (this.state.train.resources.filtres ?? 0) > 0) {
        this.state.train.resources.filtres--;
        st.filter = BAL.filterDuration;
        this.ui.toast('Nouveau filtre installé sur le masque.', 'info');
      }
      if (masked && st.filter > 0) {
        st.filter -= dt;
      } else {
        p.damage(BAL.gasDamage * gas * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'gaz' });
        if (Math.random() < dt * 1.5) this.audio.play('cough', { x: p.x, z: p.z });
        this.notifyOnce('gaz', masked ? 'Plus de filtres ! Le gaz vous brûle les poumons.' : 'Gaz toxique ! Il vous faut un masque à gaz avec des filtres.', 'mauvais');
      }
    }
    // feu, acide, glace au sol
    const fire = this.hazardAt('feu', p.x, p.z);
    if (fire > 0 && !p.onTrain) p.damage(fire * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'feu' });
    const acid = this.hazardAt('acide', p.x, p.z);
    if (acid > 0 && !p.onTrain) p.damage(acid * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'acide' });
    if (this.hazardAt('glace', p.x, p.z) > 0 && !p.onTrain) {
      p.slow = Math.max(p.slow, 0.4);
      p.slowT = 0.3;
    }
    if (p.burnT > 0) {
      p.burnT -= dt;
      p.damage(p.burnDps * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'feu' });
    }
    // maladie
    this.crewSystem.progressDisease(st, dt, true);
    if (st.disease && st.disease.incubation <= 0 && st.disease.severity > 0.85) p.damage(0.6 * dt, { faction: 'neutre', x: p.x, z: p.z, kind: 'maladie' });
    // compteur Geiger : cliquetis
    if ((st.items.geiger ?? 0) > 0 && rad > 0.05 && Math.random() < dt * Math.min(25, rad * 6)) this.audio.play('geiger', { volume: 0.5 });
  }

  /** Rayonnement des gares irradiées sur le train à quai. */
  private checkStationRadiation(): void {
    const lv = this.level;
    if (!(lv instanceof StationLevel)) return;
    const node = lv.node;
    const timer = this.stationRadTimer(node.id);
    if (timer === null) return;
    const left = timer - lv.delta.dwell;
    if (left <= 0) {
      for (const n of crewOnBoard(this.state)) n.rads += BAL.stationRadOverstay;
      if (this.player.onTrain) this.state.player.rads += BAL.stationRadOverstay * 0.6;
      this.notifyOnce(`radtrain:${node.id}`, 'Le train est irradié ! L\'équipage accumule des radiations : partez vite !', 'mauvais');
    } else if (left < 60) this.notifyOnce(`radtrain60:${node.id}`, 'Plus qu\'une minute avant que le train ne soit irradié !', 'mauvais');
  }

  stationRadTimer(id: string): number | null {
    const node = this.state.map.nodes[id];
    if (!node || node.radiation < 1) return null;
    return Math.round(420 - node.radiation * 30);
  }

  // ================================================================== météo

  private weatherPts: THREE.Points | null = null;
  private weatherKind = '';

  private updateWeather(dt: number): void {
    const env = this.level?.env;
    const kind = env ? (env.weather === 'neige' || env.weather === 'tempete' ? 'neige' : env.weather === 'pluie' ? 'pluie' : env.weather === 'cendres' ? 'cendres' : env.weather === 'poussiere' ? 'poussiere' : '') : '';
    const inside = this.levelDarkness() > 0.5;
    if (kind !== this.weatherKind) {
      this.weatherKind = kind;
      if (this.weatherPts) {
        this.scene.remove(this.weatherPts);
        this.weatherPts.geometry.dispose();
        (this.weatherPts.material as THREE.Material).dispose();
        this.weatherPts = null;
      }
      if (kind) {
        const n = this.engine.quality === 'basse' ? 600 : env?.weather === 'tempete' ? 2600 : 1500;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 90;
          pos[i * 3 + 1] = Math.random() * 30;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const color = kind === 'neige' ? 0xffffff : kind === 'pluie' ? 0x9ab0c8 : kind === 'cendres' ? 0x8a8680 : 0xc8a878;
        const mat = new THREE.PointsMaterial({ color, size: kind === 'pluie' ? 0.12 : kind === 'neige' ? 0.22 : 0.18, transparent: true, opacity: kind === 'poussiere' ? 0.5 : 0.85, depthWrite: false });
        this.weatherPts = new THREE.Points(geo, mat);
        this.weatherPts.frustumCulled = false;
        this.scene.add(this.weatherPts);
      }
    }
    const pts = this.weatherPts;
    if (!pts) return;
    pts.visible = !inside;
    const arr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = arr.array as Float32Array;
    const cx = this.player.x;
    const cz = this.player.z;
    const fall = kind === 'pluie' ? 22 : kind === 'neige' ? 3 : kind === 'cendres' ? 1.5 : 1;
    const wind = (kind === 'poussiere' ? 12 : env?.weather === 'tempete' ? 14 : 2) + this.groundSpeed();
    const t = performance.now() / 1000;
    for (let i = 0; i < a.length; i += 3) {
      a[i] -= wind * dt;
      a[i + 1] -= fall * dt;
      a[i + 2] += Math.sin(t + i) * 0.3 * dt;
      if (a[i + 1] < 0) a[i + 1] += 30;
      const rx = a[i] - cx;
      if (rx < -45) a[i] += 90;
      else if (rx > 45) a[i] -= 90;
      const rz = a[i + 2] - cz;
      if (rz < -35) a[i + 2] += 70;
      else if (rz > 35) a[i + 2] -= 70;
    }
    arr.needsUpdate = true;
  }

  // ================================================================== interactions

  interactables(): Interactable[] {
    const lv = this.level;
    const list: Interactable[] = [];
    if (lv) list.push(...lv.interactables);
    list.push(...this.trainInteractables());
    for (const a of this.crew.values()) {
      if (!a.alive) continue;
      list.push({
        id: `crew:${a.id}`,
        x: a.x,
        y: a.y,
        z: a.z,
        radius: 1.2,
        kind: 'pnj',
        label: () => `Parler à ${a.data.name}`,
        interact: () => this.talkTo(a),
      });
    }
    return list;
  }

  private trainItCache: Interactable[] | null = null;
  private trainItKey = '';

  /** Interactifs du train (poste de conduite, tourelles, réparations…). */
  trainInteractables(): Interactable[] {
    const key = this.state.train.wagons.map((w) => `${w.uid}:${w.type}:${w.slots.map((s) => s.equip).join(',')}:${w.decor.join(',')}`).join('|');
    if (this.trainItCache && key === this.trainItKey) return this.trainItCache;
    this.trainItKey = key;
    this.trainItCache = this.ui.buildTrainInteractables();
    return this.trainItCache;
  }

  invalidateTrainInteractables(): void {
    this.trainItCache = null;
  }

  talkTo(a: NpcActor): void {
    this.emit({ type: 'talk', npc: a.id });
    this.ui.openDialogue(a);
  }

  lockLabel(lock: LockSpec | undefined, id: string, base: string): string {
    if (!lock) return base;
    const st = this.state.player;
    switch (lock.kind) {
      case 'code':
        return this.state.journal.codes[id] ? `${base} (code connu)` : `${base} — digicode`;
      case 'crochet':
        return `${base} — serrure (crocheter)`;
      case 'carte':
        return `${base} — badge ${lock.color}${this.hasKeycard(lock) ? ' ✓' : ' requis'}`;
      case 'cle':
        return `${base} — clé requise${(st.items[`cle:${lock.keyId}`] ?? 0) > 0 ? ' ✓' : ''}`;
      case 'barricade':
        return (st.items.pied_de_biche ?? 0) > 0 ? `${base} — forcer la barricade (maintenir E)` : `${base} — barricadée (pied-de-biche ou dynamite)`;
    }
  }

  hasKeycard(lock: LockSpec): boolean {
    const st = this.state;
    const sid = st.map.current;
    return (st.player.items[`carte:${sid}:${lock.color}`] ?? 0) > 0;
  }

  /** Tente d'ouvrir un verrou (porte ou conteneur). */
  tryUnlock(lock: LockSpec | undefined, id: string, what: 'porte' | 'conteneur', onOpen: () => void): void {
    if (!lock) {
      onOpen();
      return;
    }
    const st = this.state;
    const follower = [...this.crew.values()].find((a) => a.data.job === 'suivre' && Math.hypot(a.x - this.player.x, a.z - this.player.z) < 8);
    switch (lock.kind) {
      case 'code': {
        const known = st.journal.codes[id];
        const hacker = follower && follower.data.skill === 'ingenieur';
        this.ui.openKeypad(lock.code ?? '0000', known ?? null, !!hacker, () => {
          this.audio.play('unlock');
          onOpen();
        });
        return;
      }
      case 'crochet': {
        if (follower && follower.data.skill === 'serrurier') {
          follower.say('Laissez-moi faire…');
          this.audio.play('pick');
          window.setTimeout(() => {
            this.audio.play('unlock');
            onOpen();
          }, 1200);
          return;
        }
        if ((st.train.resources.crochets ?? 0) <= 0) {
          this.ui.toast('Il vous faut des crochets (ou un serrurier dans votre escorte).', 'mauvais');
          this.audio.play('locked');
          return;
        }
        this.ui.openLockpick(lock.difficulty ?? 1, (ok) => {
          if (ok) {
            this.audio.play('unlock');
            onOpen();
          }
        });
        return;
      }
      case 'carte':
        if (this.hasKeycard(lock)) {
          this.audio.play('unlock');
          this.ui.toast(`Badge ${lock.color} accepté.`, 'bon');
          onOpen();
        } else {
          this.audio.play('locked');
          this.ui.toast(`Accès refusé : badge ${lock.color} requis. Cherchez-le dans cette gare.`, 'mauvais');
        }
        return;
      case 'cle':
        if ((st.player.items[`cle:${lock.keyId}`] ?? 0) > 0) {
          this.audio.play('unlock');
          onOpen();
        } else {
          this.audio.play('locked');
          this.ui.toast(`Fermé à clé (${lock.keyName ?? 'clé introuvable'}).`, 'mauvais');
        }
        return;
      case 'barricade':
        if ((st.player.items.pied_de_biche ?? 0) > 0) {
          this.audio.play('hitMetal', { pitch: 0.7 });
          this.ui.toast(what === 'porte' ? 'Barricade arrachée !' : 'Couvercle forcé.', 'bon');
          onOpen();
        } else {
          this.audio.play('locked');
          this.ui.toast('Barricadé. Un pied-de-biche ou de la dynamite en viendrait à bout.', 'mauvais');
        }
        return;
    }
  }

  onDynamiteThrown(x: number, z: number): void {
    // la dynamite fait sauter les barricades proches (gares) ou les obstacles sur la voie (voyage)
    window.setTimeout(() => {
      const lv = this.level;
      if (lv instanceof TravelLevel) {
        this.events.explodeObstacle(x);
        return;
      }
      if (!(lv instanceof StationLevel)) return;
      for (const [id, d] of lv.doors) {
        if (d.spec.lock?.kind === 'barricade' && !d.open && Math.hypot(d.spec.x - x, d.spec.z - z) < 4.5) {
          lv.setDoor(id, true, true);
          this.ui.toast('La barricade vole en éclats !', 'bon');
        }
      }
    }, 1300);
  }

  readNote(n: NoteSpec, station: string): void {
    const j = this.state.journal;
    if (!j.notes.some((x) => x.id === n.id)) {
      j.notes.push({ id: n.id, title: n.title, text: n.text, station, time: this.state.time });
      this.gainXp(4);
    }
    if (n.reveals) j.codes[n.reveals.door] = n.reveals.code;
    this.emit({ type: 'note', id: n.id });
    this.ui.openNote(n.title, n.text);
  }

  lootName(e: LootEntry): string {
    switch (e.kind) {
      case 'resource':
        return `${e.qty} ${RESOURCES[e.id].name}`;
      case 'weapon':
        return `${WEAPONS[e.id]?.name ?? e.id}${e.level ? ` +${e.level}` : ''}`;
      case 'gear':
        return GEAR[e.id]?.name ?? e.id;
      case 'tool':
        return TOOLS[e.id]?.name ?? e.id;
      case 'item':
        return `${personalItemName(e.id)}${e.qty > 1 ? ` ×${e.qty}` : ''}`;
    }
  }

  /** Prend un objet ; retourne faux s'il n'a pas pu être pris (soute pleine, armes…). */
  takeLoot(e: LootEntry): boolean {
    const st = this.state;
    switch (e.kind) {
      case 'resource': {
        const added = addResource(st, e.id, e.qty);
        if (added <= 0) {
          this.ui.toast(e.id === 'charbon' ? 'Tender plein !' : 'Soute pleine ! Agrandissez la soute (fourgon).', 'mauvais');
          return false;
        }
        this.audio.play(e.id === 'jetons' ? 'coin' : 'pickup');
        if (added < e.qty) {
          e.qty -= added;
          this.ui.toast(`+${added} ${RESOURCES[e.id].short} (soute pleine)`, 'info');
          return false;
        }
        this.ui.toast(`+${added} ${RESOURCES[e.id].short}`, 'bon');
        this.emit({ type: 'resource', id: e.id, qty: added });
        return true;
      }
      case 'weapon': {
        const slot = st.player.weapons.findIndex((w) => w === null);
        if (slot >= 0) {
          st.player.weapons[slot] = newWeapon(e.id, e.level);
          this.ui.toast(`Nouvelle arme : ${WEAPONS[e.id].name} (touche ${slot + 1})`, 'bon');
          this.audio.play('reload');
          return true;
        }
        this.ui.chooseWeaponSwap(e.id, e.level);
        return false;
      }
      case 'gear':
      case 'tool':
      case 'item': {
        const qty = e.kind === 'item' ? e.qty : 1;
        st.player.items[e.id] = (st.player.items[e.id] ?? 0) + qty;
        this.audio.play('pickup');
        this.ui.toast(`Obtenu : ${this.lootName(e)}`, 'bon');
        if (e.kind === 'gear' && GEAR[e.id]?.slot !== 'outil') this.ui.toast('Équipez-le depuis l\'inventaire (touche I).', 'info');
        this.emit({ type: 'item', id: e.id, qty });
        if (QUEST_ITEMS[e.id]) this.log(`Objet important obtenu : ${QUEST_ITEMS[e.id].name}.`, 'quete');
        return true;
      }
    }
  }

  giveItem(id: string, qty = 1, silent = false): void {
    const st = this.state;
    st.player.items[id] = (st.player.items[id] ?? 0) + qty;
    if (!silent) this.ui.toast(`Obtenu : ${personalItemName(id)}`, 'bon');
    this.emit({ type: 'item', id, qty });
  }

  hasItem(id: string): boolean {
    return (this.state.player.items[id] ?? 0) > 0;
  }

  removeItem(id: string, qty = 1): void {
    const st = this.state;
    st.player.items[id] = Math.max(0, (st.player.items[id] ?? 0) - qty);
    if (st.player.items[id] === 0) delete st.player.items[id];
  }

  useConsumable(id: 'trousses' | 'antirad'): void {
    const st = this.state;
    if ((st.train.resources[id] ?? 0) <= 0) {
      this.ui.toast(id === 'trousses' ? 'Plus de trousses de soins.' : 'Plus de pilules anti-rad.', 'mauvais');
      return;
    }
    if (id === 'trousses') {
      if (st.player.hp >= this.player.maxHp) {
        this.ui.toast('Vous êtes en pleine santé.', 'info');
        return;
      }
      st.train.resources.trousses--;
      const heal = BAL.medkitHeal * (this.player.hasPerk('infirmier') ? 1.5 : 1);
      this.player.heal(heal);
      if (st.player.disease?.id === 'infection') st.player.disease.severity = Math.max(0, st.player.disease.severity - 0.4);
      this.engine.fx.heal(this.player.x, this.player.y + 1, this.player.z);
      this.audio.play('pickup');
    } else {
      st.train.resources.antirad--;
      st.player.rads = Math.max(0, st.player.rads - BAL.antiradAmount);
      this.ui.toast(`-${BAL.antiradAmount} rads.`, 'bon');
      this.audio.play('pickup');
    }
  }

  collectRoadside(kind: 'bois' | 'caisse'): void {
    if (kind === 'bois') {
      const q = addResource(this.state, 'charbon', 7 + Math.floor(Math.random() * 5));
      this.ui.toast(`Bois de chauffe : +${q} (équivalent charbon).`, 'bon');
      this.audio.play('shovel');
    } else {
      const loot: LootEntry = Math.random() < 0.5 ? { kind: 'resource', id: 'ferraille', qty: 4 + Math.floor(Math.random() * 6) } : { kind: 'resource', id: Math.random() < 0.5 ? 'nourriture' : 'balles', qty: 5 + Math.floor(Math.random() * 10) };
      this.takeLoot(loot);
    }
  }

  onLever(id: string, state: number, spec: LeverSpec): void {
    this.emit({ type: 'lever', id, state });
    this.ui.toast(`${spec.label} : ${spec.states[state]}`, 'info');
  }

  specialLabel(s: SpecialSpec, lv: StationLevel): string | null {
    return this.story.specialLabel(s, lv) ?? this.economy.specialLabel(s, lv) ?? s.label;
  }

  handleSpecial(s: SpecialSpec, lv: StationLevel): void {
    if (this.story.handleSpecial(s, lv)) return;
    if (this.economy.handleSpecial(s, lv)) return;
    this.emit({ type: 'special', action: s.action, station: lv.node.id });
  }

  onEnterBuilding(b: BuildingRuntime): void {
    this.emit({ type: 'enterBuilding', id: b.id, name: b.name });
  }

  // ================================================================== événements de dégâts

  onComponentBroken(w: WagonRuntime, name: string): void {
    this.ui.toast(`${name} hors service dans le wagon ${w.index + 1} !`, 'mauvais');
  }

  private dmgToastT = 0;

  onTrainDamaged(index: number, dmg: number): void {
    if (dmg > 25) this.engine.rig.shake(Math.min(0.4, dmg / 100));
    const now = performance.now();
    if (now - this.dmgToastT > 4000 && index >= 0) {
      const w = this.state.train.wagons[index];
      if (w && w.hp < wagonMaxHp(this.state, w) * BAL.criticalHp) {
        this.dmgToastT = now;
        this.ui.toast(`Wagon ${index + 1} (${WAGON_TYPES[w.type].name}) en état critique ! Réparez-le ou évacuez-le.`, 'mauvais');
        this.crewSystem.wagonCriticalBark(index);
      }
    }
  }

  onWagonCritical(index: number, critical: boolean): void {
    if (critical) {
      this.audio.play('alarm');
      this.ui.toast(`L'attelage du wagon ${index + 1} cède ! Il va se détacher dans ${BAL.detachDelay} s avec tout ce qui suit ! Réparez vite (E sur le panneau) ou évacuez !`, 'mauvais');
    } else this.ui.toast(`Attelage du wagon ${index + 1} consolidé.`, 'bon');
  }

  onWagonsDetached(ids: string[], reason: 'casse' | 'manuel'): void {
    const st = this.state;
    const lostNames: string[] = [];
    for (const n of Object.values(st.npcs)) {
      if ((n.status === 'equipage' || n.status === 'passager' || n.status === 'prisonnier') && n.wagon && ids.includes(n.wagon)) {
        const a = this.crew.get(n.id);
        // ceux qui sont physiquement dans un wagon encore attaché s'en sortent
        if (a && this.train.isInside(a.x, a.z) && this.train.wagonAt(a.x) >= 0 && this.train.wagonAt(a.x) < st.train.wagons.length) {
          n.wagon = st.train.wagons[Math.max(0, this.train.wagonAt(a.x))]?.uid ?? st.train.wagons[0].uid;
          continue;
        }
        n.status = 'perdu';
        n.wagon = null;
        lostNames.push(n.name);
        if (a) {
          a.dispose();
          this.crew.delete(n.id);
        }
      }
    }
    // le joueur dans la partie détachée saute dans le dernier wagon
    if (this.player.x < this.train.rearX - 0.5 && Math.abs(this.player.z) < HALF_W + 1) {
      const last = this.train.wagons[this.train.wagons.length - 1];
      this.player.teleport(last.cx, 0, FLOOR);
      this.player.damage(10, { faction: 'neutre', x: this.player.x, z: this.player.z, kind: 'melee' });
      this.ui.toast('Vous sautez in extremis dans le wagon précédent !', 'mauvais');
    }
    // ennemis accrochés aux wagons perdus ; ceux qui étaient à bord partent avec l'épave
    for (const e of this.level?.enemies ?? []) {
      if (e.latchedWagon >= this.train.wagons.length) e.latchedWagon = -1;
      if (e.alive && e.onTrain && e.x < this.train.rearX - 0.3) {
        e.alive = false;
        e.hp = 0;
        e.deadT = 99;
        e.model.root.visible = false;
      }
    }
    this.player.dismount();
    this.invalidateTrainInteractables();
    this.log(reason === 'casse' ? `Un wagon s'est détaché${lostNames.length ? `, emportant ${lostNames.join(', ')}` : ''}.` : 'Wagons dételés.', 'mauvais');
    if (lostNames.length) this.ui.toast(`Perdus avec les wagons : ${lostNames.join(', ')}.`, 'mauvais');
    this.syncCrewActors(false);
  }

  /** Vrai tant que la locomotive est hors service (0 PV). */
  locoDown = false;

  onLocomotiveDestroyed(): void {
    if (this.locoDown) return;
    this.locoDown = true;
    this.state.train.throttle = 0;
    this.ui.toast('La locomotive est hors service ! Réparez-la au panneau de maintenance (locomotive) pour repartir.', 'mauvais');
    this.log('La locomotive est tombée en panne sous les coups.', 'mauvais');
    this.audio.play('alarm');
  }

  onPlayerDeath(src: DamageSource): void {
    const causes: Record<string, string> = {
      froid: 'Mort de froid.',
      radiation: 'Les radiations ont eu raison de vous.',
      gaz: 'Asphyxié par les gaz toxiques.',
      maladie: 'Emporté par la maladie.',
      feu: 'Brûlé vif.',
    };
    this.state.stats.deaths++;
    window.setTimeout(() => this.gameOver(false, causes[src.kind] ?? 'Vous êtes tombé au combat.'), 1500);
  }

  onNpcDeath(a: NpcActor, _src: DamageSource): void {
    const n = a.data;
    n.status = 'mort';
    this.log(`${n.name} est mort${n.female ? 'e' : ''}.`, 'mauvais');
    this.ui.toast(`${n.name} est mort${n.female ? 'e' : ''}…`, 'mauvais');
    this.crewSystem.onDeath(n);
    this.emit({ type: 'npcDeath', npc: n.id });
    window.setTimeout(() => {
      if (this.crew.get(n.id) === a) {
        a.dispose();
        this.crew.delete(n.id);
      }
      const lv = this.level;
      if (lv instanceof StationLevel) lv.removeResident(n.id);
    }, 4000);
  }

  onWaveSpawned(n: number, wave = 1, total = 1, side: 1 | -1 = 1, faction: 'bandit' | 'monstre' = 'monstre'): void {
    if (n <= 0) return;
    const flank = side > 0 ? 'flanc sud' : 'flanc nord';
    const who = faction === 'bandit' ? 'Bandits' : 'Créatures';
    if (wave <= 1) {
      this.state.stats.attacks++;
      this.ui.toast(`Attaque ! ${who} en approche (${flank}). Aux postes de combat !`, 'mauvais');
      for (const a of this.crew.values()) a.bark('combat', 0.3);
    } else {
      this.ui.toast(`Vague ${wave}/${total} : ${n} ${faction === 'bandit' ? 'assaillants' : 'créatures'} (${flank}) !`, 'mauvais');
    }
    this.audio.play('alarm');
  }

  onWaveCleared(kills: number): void {
    this.ui.toast(`Attaque repoussée${kills ? ` (${kills} ennemis abattus)` : ''}.`, 'bon');
    this.gainXp(10 + kills * 2);
    this.emit({ type: 'waveCleared' });
    this.crewSystem.afterBattle();
  }

  onEnemyEscaped(_e: Enemy): void {
    /* distancé par le train */
  }

  // ================================================================== progression

  gainXp(n: number): void {
    const p = this.state.player;
    p.xp += n;
    while (p.xp >= BAL.xpPerLevel(p.level)) {
      p.xp -= BAL.xpPerLevel(p.level);
      p.level++;
      p.pendingPerks++;
      this.ui.toast(`Niveau ${p.level} ! Choisissez un atout (touche P ou menu Personnage).`, 'bon');
      this.audio.play('success');
    }
  }

  perkChoices(): string[] {
    const owned = new Set(this.state.player.perks);
    const pool = PERK_IDS.filter((p) => !owned.has(p));
    const out: string[] = [];
    const seed = this.state.player.level * 31 + this.state.seed;
    let r = seed;
    while (out.length < 3 && pool.length) {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      out.push(pool.splice(r % pool.length, 1)[0]);
    }
    return out;
  }

  // ================================================================== journal & notifications

  emit(e: GameEvent): void {
    this.story.onEvent(e);
    this.quests.onEvent(e);
  }

  log(text: string, kind: 'info' | 'bon' | 'mauvais' | 'quete' = 'info'): void {
    this.state.journal.log.unshift({ time: this.state.time, text, kind });
    if (this.state.journal.log.length > 200) this.state.journal.log.length = 200;
  }

  notifyOnce(key: string, text: string, kind: 'info' | 'bon' | 'mauvais' = 'info'): void {
    if (this.notified.has(key)) return;
    this.notified.add(key);
    this.ui.toast(text, kind);
    window.setTimeout(() => this.notified.delete(key), 60000);
  }

  // ================================================================== sauvegarde & fin

  autosave(): void {
    if (!this.state || this.state.over) return;
    const name = this.state.map.nodes[this.state.map.current]?.name ?? '';
    if (saveGame(this.state, name)) this.ui.toast('Partie sauvegardée.', 'info');
  }

  gameOver(victory: boolean, reason: string): void {
    const st = this.state;
    if (!st || st.over) return;
    st.over = { victory, reason };
    this.paused = true;
    this.audio.setMusic('none');
    let heritage = 0;
    if (st.mode === 'infini') {
      const layer = st.map.nodes[st.map.current]?.layer ?? 0;
      heritage = heritageEarned(layer, st.stats.kills);
      const meta = loadMeta();
      meta.points += heritage;
      meta.runs++;
      meta.bestLayer = Math.max(meta.bestLayer, layer);
      saveMeta(meta);
      deleteSave('infini');
    }
    this.ui.showGameOver(victory, reason, heritage);
  }

  // ================================================================== divers

  stationLevel(): StationLevel | null {
    return this.level instanceof StationLevel ? this.level : null;
  }

  travelLevel(): TravelLevel | null {
    return this.level instanceof TravelLevel ? this.level : null;
  }

  personalityName(n: NpcState): string {
    return n.known.personality ? PERSONALITIES[n.personality].name : '???';
  }

  skillName(n: NpcState): string {
    return SKILLS[n.skill].name;
  }

  freeBeds(): number {
    return freeBeds(this.state);
  }

  equipName(id: keyof typeof EQUIPMENT): string {
    return EQUIPMENT[id].name;
  }

  enemyName(id: EnemyId): string {
    return ENEMIES[id].name;
  }
}

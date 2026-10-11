import * as THREE from 'three';
import { FX } from './particles';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/math';
import { PixelPipeline, PIXEL_MARGIN } from './pixel';
import { toonUniforms } from './toon';
import { setVegetationDensity } from './terrain';
import type { Weather } from '../data/biomes';

export type Quality = 'basse' | 'moyenne' | 'haute';

/** Rapport demi-hauteur visible / « distance » de zoom (équivaut à l'ancienne focale de 38°). */
const ZOOM_K = Math.tan((19 * Math.PI) / 180);
/** Distance de la caméra orthographique à sa cible (sans effet sur le cadrage). */
export const CAM_DIST = 120;
/** Inclinaison de la caméra de jeu (rad) : assez haute pour lire l'action, assez basse pour montrer les façades. */
export const GAME_PITCH = 0.86;

/**
 * Caméra orthographique vue de dessus, calée sur la grille des pixels artistiques :
 * la cible est arrondie au texel près (aucun scintillement), le reste du déplacement
 * est rendu par un décalage sous-texel lors de l'agrandissement final.
 */
export class CameraRig {
  readonly target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  distance = 24;
  minDist = 12;
  maxDist = 42;
  private zoomTarget = 24;
  pitch = GAME_PITCH;
  yaw = 0;
  private shakeAmt = 0;
  private shakeTime = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  shakeEnabled = true;
  /** Décalage sous-texel (+ secousse) à appliquer à l'image agrandie, en texels. */
  readonly offset = new THREE.Vector2();
  /** Position entière de la caméra sur la grille de texels (ancre le tramage). */
  readonly gridPos = new THREE.Vector2();
  /** Demi-dimensions monde du cadre rendu, marge comprise. */
  readonly view = new THREE.Vector2(1, 1);
  /** Taille d'un texel en unités monde. */
  texelWorld = 0.07;
  /** Résolution visible (texels) et taille d'un texel en pixels CSS. */
  lowW = 320;
  lowH = 180;
  texelCss = 3;

  constructor(readonly camera: THREE.OrthographicCamera) {}

  zoom(delta: number): void {
    this.zoomTarget = clamp(this.zoomTarget * (1 + delta * 0.12), this.minDist, this.maxDist);
  }

  setZoom(d: number, instant = false): void {
    this.zoomTarget = clamp(d, this.minDist, this.maxDist);
    if (instant) this.distance = this.zoomTarget;
  }

  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  snap(): void {
    this.smoothTarget.copy(this.target);
  }

  update(dt: number): void {
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, 7, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 7, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, 7, dt);
    this.distance = damp(this.distance, this.zoomTarget, 8, dt);
    const halfH = this.distance * ZOOM_K;
    const px = (2 * halfH) / this.lowH;
    this.texelWorld = px;
    const cam = this.camera;
    // orientation
    this.dir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    cam.position.copy(this.smoothTarget).addScaledVector(this.dir, CAM_DIST);
    cam.lookAt(this.smoothTarget);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    // calage sur la grille de texels
    const tR = this.smoothTarget.dot(this.right) / px;
    const tU = this.smoothTarget.dot(this.up) / px;
    const sR = Math.round(tR);
    const sU = Math.round(tU);
    this.tmp.copy(this.smoothTarget).addScaledVector(this.right, (sR - tR) * px).addScaledVector(this.up, (sU - tU) * px);
    cam.position.copy(this.tmp).addScaledVector(this.dir, CAM_DIST);
    this.gridPos.set(sR, sU);
    this.offset.set(tR - sR, tU - sU);
    if (this.shakeAmt > 0.001) {
      this.shakeTime += dt * 40;
      const s = this.shakeAmt * this.shakeAmt * 9;
      this.offset.x += Math.sin(this.shakeTime * 1.3) * s;
      this.offset.y += Math.cos(this.shakeTime * 1.7 + 1) * s * 0.7;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
    // cadre (avec marge)
    const hw = (this.lowW / 2 + PIXEL_MARGIN) * px;
    const hh = (this.lowH / 2 + PIXEL_MARGIN) * px;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.view.set(hw, hh);
  }

  /** Coordonnées NDC du cadre rendu correspondant à un point écran (px CSS). */
  private screenToNdc(clientX: number, clientY: number, height: number): THREE.Vector2 {
    const tx = clientX / this.texelCss + PIXEL_MARGIN + this.offset.x;
    const ty = (height - clientY) / this.texelCss + PIXEL_MARGIN + this.offset.y;
    this.ndc.set((tx / (this.lowW + PIXEL_MARGIN * 2)) * 2 - 1, (ty / (this.lowH + PIXEL_MARGIN * 2)) * 2 - 1);
    return this.ndc;
  }

  /** Point du sol (plan y = planeY) sous le curseur. */
  screenToGround(clientX: number, clientY: number, _width: number, height: number, planeY = 0, out = new THREE.Vector3()): THREE.Vector3 {
    this.raycaster.setFromCamera(this.screenToNdc(clientX, clientY, height), this.camera);
    this.plane.constant = -planeY;
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.tmp);
    if (hit) out.copy(hit);
    else out.copy(this.target);
    return out;
  }

  /** Projette un point 3D en coordonnées écran (px CSS), en tenant compte du décalage sous-texel. */
  project(x: number, y: number, z: number, _width: number, height: number): { x: number; y: number; visible: boolean } {
    this.tmp.set(x, y, z).project(this.camera);
    const tx = (this.tmp.x * 0.5 + 0.5) * (this.lowW + PIXEL_MARGIN * 2) - PIXEL_MARGIN - this.offset.x;
    const ty = (this.tmp.y * 0.5 + 0.5) * (this.lowH + PIXEL_MARGIN * 2) - PIXEL_MARGIN - this.offset.y;
    return { x: tx * this.texelCss, y: height - ty * this.texelCss, visible: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2 };
  }
}

interface LightRequest {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  priority: number;
}

/** Réserve fixe de lumières ponctuelles (évite les recompilations de shaders). */
export class LightPool {
  private lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];
  private flashes: (LightRequest & { t: number; dur: number })[] = [];

  constructor(scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  add(x: number, y: number, z: number, color: number, intensity: number, distance: number, priority = 1): void {
    this.requests.push({ x, y, z, color, intensity, distance, priority });
  }

  flash(x: number, y: number, z: number, color: number, intensity: number, distance: number, dur = 0.08): void {
    this.flashes.push({ x, y, z, color, intensity, distance, priority: 3, t: 0, dur });
    if (this.flashes.length > 24) this.flashes.shift();
  }

  update(dt: number, cx: number, cz: number): void {
    for (const f of this.flashes) {
      f.t += dt;
      const k = 1 - f.t / f.dur;
      if (k > 0) this.requests.push({ ...f, intensity: f.intensity * k });
    }
    this.flashes = this.flashes.filter((f) => f.t < f.dur);
    const scored = this.requests
      .map((r) => ({ r, s: r.priority * 100 - Math.hypot(r.x - cx, r.z - cz) }))
      .sort((a, b) => b.s - a.s);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const req = scored[i]?.r;
      if (req && Math.hypot(req.x - cx, req.z - cz) < 60) {
        l.position.set(req.x, req.y, req.z);
        l.color.setHex(req.color);
        l.intensity = req.intensity;
        l.distance = req.distance;
      } else {
        l.intensity = 0;
      }
    }
    this.requests.length = 0;
  }
}

export interface EnvParams {
  /** Minutes depuis minuit. */
  minutes: number;
  fogColor: number;
  weather: Weather;
  /** 0..1 assombrissement (intérieur sombre, tunnel). */
  darkness: number;
  /** Teinte supplémentaire (radiations vertes, gaz jaunâtre). */
  tint?: number;
  tintAmount?: number;
  winter: boolean;
  /** Distance parcourue (voyage) : les ombres de nuages défilent avec le terrain. */
  scroll?: number;
  /** 0..1 : rides de sable (désert). */
  sand?: number;
}

/** Une ambiance de la direction artistique (couleurs de lumière et d'étalonnage). */
interface Mood {
  sun: number;
  sunI: number;
  sky: number;
  ground: number;
  hemiI: number;
  lift: [number, number, number];
  gain: [number, number, number];
  sat: number;
  vignette: number;
}

/** Ambiances clés de la journée : nuit bleue, aube rose, jour cendré, heure dorée, crépuscule violet. */
const MOODS: [number, Mood][] = [
  [0, { sun: 0x9ab2f0, sunI: 0.85, sky: 0x34407a, ground: 0x1a1628, hemiI: 0.85, lift: [0.02, 0.025, 0.07], gain: [0.86, 0.94, 1.12], sat: 0.85, vignette: 0.26 }],
  [4.6 * 60, { sun: 0x9ab2f0, sunI: 0.8, sky: 0x34407a, ground: 0x1a1628, hemiI: 0.85, lift: [0.02, 0.025, 0.07], gain: [0.88, 0.94, 1.1], sat: 0.86, vignette: 0.25 }],
  [6 * 60, { sun: 0xff9a78, sunI: 1.25, sky: 0x8f7fb4, ground: 0x3e2e36, hemiI: 0.95, lift: [0.05, 0.025, 0.07], gain: [1.08, 0.95, 0.96], sat: 1.05, vignette: 0.3 }],
  [8 * 60, { sun: 0xffe3b8, sunI: 2.05, sky: 0xaebfdc, ground: 0x5e5246, hemiI: 1.15, lift: [0.02, 0.015, 0.045], gain: [1.03, 1.0, 0.97], sat: 1.05, vignette: 0.22 }],
  [13 * 60, { sun: 0xfff1d6, sunI: 2.3, sky: 0xb9c8de, ground: 0x6a5a48, hemiI: 1.2, lift: [0.015, 0.012, 0.04], gain: [1.02, 1.0, 0.97], sat: 1.04, vignette: 0.2 }],
  [16.8 * 60, { sun: 0xffdca0, sunI: 2.2, sky: 0xadb4d2, ground: 0x66503c, hemiI: 1.1, lift: [0.025, 0.016, 0.045], gain: [1.04, 1.0, 0.93], sat: 1.07, vignette: 0.22 }],
  [19 * 60, { sun: 0xffb478, sunI: 2.0, sky: 0x9e8cba, ground: 0x4c3a30, hemiI: 1.0, lift: [0.04, 0.02, 0.065], gain: [1.08, 0.98, 0.88], sat: 1.08, vignette: 0.26 }],
  [20.6 * 60, { sun: 0xe0807a, sunI: 1.1, sky: 0x5a4a88, ground: 0x241a2c, hemiI: 0.85, lift: [0.04, 0.025, 0.08], gain: [0.96, 0.92, 1.02], sat: 0.95, vignette: 0.28 }],
  [21.8 * 60, { sun: 0x9ab2f0, sunI: 0.85, sky: 0x34407a, ground: 0x1a1628, hemiI: 0.85, lift: [0.02, 0.025, 0.07], gain: [0.86, 0.94, 1.12], sat: 0.85, vignette: 0.26 }],
  [24 * 60, { sun: 0x9ab2f0, sunI: 0.85, sky: 0x34407a, ground: 0x1a1628, hemiI: 0.85, lift: [0.02, 0.025, 0.07], gain: [0.86, 0.94, 1.12], sat: 0.85, vignette: 0.26 }],
];

const ca = new THREE.Color();
const cb = new THREE.Color();

function moodAt(minutes: number, out: Mood): Mood {
  let i = 0;
  while (i < MOODS.length - 2 && MOODS[i + 1][0] <= minutes) i++;
  const [t0, a] = MOODS[i];
  const [t1, b] = MOODS[i + 1];
  const k = smoothstep(0, 1, clamp01((minutes - t0) / Math.max(1, t1 - t0)));
  const mix = (x: number, y: number) => ca.setHex(x).lerp(cb.setHex(y), k).getHex();
  out.sun = mix(a.sun, b.sun);
  out.sky = mix(a.sky, b.sky);
  out.ground = mix(a.ground, b.ground);
  out.sunI = lerp(a.sunI, b.sunI, k);
  out.hemiI = lerp(a.hemiI, b.hemiI, k);
  out.lift = [lerp(a.lift[0], b.lift[0], k), lerp(a.lift[1], b.lift[1], k), lerp(a.lift[2], b.lift[2], k)];
  out.gain = [lerp(a.gain[0], b.gain[0], k), lerp(a.gain[1], b.gain[1], k), lerp(a.gain[2], b.gain[2], k)];
  out.sat = lerp(a.sat, b.sat, k);
  out.vignette = lerp(a.vignette, b.vignette, k);
  return out;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly rig: CameraRig;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly fx: FX;
  readonly lights: LightPool;
  readonly fog: THREE.Fog;
  readonly pixel: PixelPipeline;
  width = 1;
  height = 1;
  quality: Quality = 'haute';
  /** 0 = nuit noire, 1 = plein jour (utile pour le gameplay : lumières, peur…) */
  daylight = 1;
  /** Si vrai, le prochain setEnvironment applique l'ambiance sans transition (changement de niveau). */
  snapEnv = false;
  private bg = new THREE.Color();
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();
  private mood: Mood = { ...MOODS[0][1] };
  private time = 0;
  private drawSize = new THREE.Vector2();
  private weatherK = { dim: 1, haze: 0, cloud: 0.3, cover: 0.62, wind: 0.6 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 1, 420);
    this.rig = new CameraRig(this.camera);
    this.fog = new THREE.Fog(0xb0b8b0, CAM_DIST + 40, CAM_DIST + 120);
    this.scene.fog = this.fog;
    this.scene.background = this.bg;
    this.pixel = new PixelPipeline();

    this.hemi = new THREE.HemisphereLight(0xdfe8f0, 0x5a5040, 1.2);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -36;
    sc.right = 36;
    sc.top = 36;
    sc.bottom = -36;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.fx = new FX(this.scene);
    this.lights = new LightPool(this.scene, 6);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality, shadows: boolean): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = shadows && q !== 'basse';
    const size = q === 'haute' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.fx.smoke.density = q === 'basse' ? 0.4 : q === 'moyenne' ? 0.7 : 1;
    this.fx.glow.density = q === 'basse' ? 0.5 : 1;
    setVegetationDensity(q === 'basse' ? 0.4 : q === 'moyenne' ? 0.7 : 1);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.getDrawingBufferSize(this.drawSize);
    this.pixel.resize(this.drawSize.x, this.drawSize.y);
    this.rig.lowW = this.pixel.lowW;
    this.rig.lowH = this.pixel.lowH;
    this.rig.texelCss = this.pixel.scale / this.renderer.getPixelRatio();
  }

  /** Ambiance : jour/nuit, météo, brouillard, teinte des zones dangereuses. */
  setEnvironment(p: EnvParams, dt: number): void {
    const m = ((p.minutes % 1440) + 1440) % 1440;
    const snap = this.snapEnv;
    const ease = (cur: number, target: number, rate: number) => (snap ? target : damp(cur, target, rate, dt));
    // élévation du soleil : 0 à 5h30, pic vers 13h, 0 à 20h30
    const dayT = (m - 330) / (1230 - 330);
    const elev = dayT > 0 && dayT < 1 ? Math.sin(dayT * Math.PI) : 0;
    const twilight = smoothstep(0, 0.25, elev);
    // météo
    const w = p.weather;
    const wk = this.weatherK;
    const dimT = w === 'tempete' ? 0.5 : w === 'brume' ? 0.8 : w === 'poussiere' ? 0.74 : w === 'pluie' || w === 'neige' || w === 'cendres' ? 0.76 : 1;
    const hazeT = w === 'brume' ? 0.85 : w === 'tempete' ? 0.8 : w === 'poussiere' ? 0.7 : w === 'neige' || w === 'cendres' ? 0.45 : w === 'pluie' ? 0.4 : 0;
    const cloudT = w === 'clair' ? 0.3 : w === 'brume' ? 0.15 : 0.5;
    const coverT = w === 'clair' ? 0.64 : w === 'tempete' ? 0.3 : 0.45;
    const windT = w === 'tempete' ? 1.6 : w === 'poussiere' ? 1.2 : w === 'neige' || w === 'pluie' ? 0.9 : 0.55;
    wk.dim = ease(wk.dim, dimT, 1.2);
    wk.haze = ease(wk.haze, hazeT, 1.2);
    wk.cloud = ease(wk.cloud, cloudT, 0.8);
    wk.cover = ease(wk.cover, coverT, 0.8);
    wk.wind = ease(wk.wind, windT, 0.8);
    const dl = clamp01(twilight * wk.dim * (1 - p.darkness * 0.85));
    this.daylight = ease(this.daylight, dl, 2);

    // ambiance de l'heure
    const mood = moodAt(m, this.mood);
    const dark = 1 - p.darkness * 0.8;
    // soleil (ou lune) : trajectoire est → ouest, du côté de la caméra
    const azim = elev > 0 ? lerp(-1.2, 1.2, clamp01(dayT)) : 0.9;
    const height = elev > 0 ? Math.max(0.22, elev) * 1.2 + 0.18 : 0.9;
    const sunDir = this.tmpV.set(Math.sin(azim) * 0.85, height, 0.6).normalize();
    const t = this.rig.target;
    this.sun.position.set(t.x + sunDir.x * 80, t.y + sunDir.y * 80, t.z + sunDir.z * 80);
    this.sun.target.position.copy(t);
    this.sun.color.setHex(mood.sun);
    this.sun.intensity = ease(this.sun.intensity, mood.sunI * wk.dim * dark, 2);
    this.hemi.color.setHex(mood.sky);
    this.hemi.groundColor.setHex(p.winter ? this.tmpC.setHex(mood.ground).lerp(this.tmpC2.setHex(0x8a90a8), 0.35).getHex() : mood.ground);
    this.hemi.intensity = ease(this.hemi.intensity, mood.hemiI * lerp(1, 0.85, 1 - wk.dim) * (1 - p.darkness * 0.7), 2);
    this.ambient.intensity = 0.1 * (1 - p.darkness * 0.5);

    // ciel, brume
    this.tmpC.setHex(p.fogColor).lerp(this.tmpC2.setHex(mood.sky), 0.35);
    this.bg.copy(this.tmpC2.setHex(0x0b0f1c)).lerp(this.tmpC, clamp01(this.daylight * 1.1));
    if (p.tint !== undefined && p.tintAmount) this.bg.lerp(this.tmpC.setHex(p.tint), p.tintAmount);
    this.fog.color.copy(this.bg);
    const near = CAM_DIST - 12 + (1 - wk.haze) * 60;
    const far = near + 26 + (1 - wk.haze) * 90;
    this.fog.near = ease(this.fog.near, near * (p.darkness > 0.5 ? 0.97 : 1), 1.5);
    this.fog.far = ease(this.fog.far, far, 1.5);

    // étalonnage
    const g = this.pixel.grading;
    const tintK = p.tintAmount ?? 0;
    g.lift.setRGB(mood.lift[0], mood.lift[1], mood.lift[2]);
    g.gain.setRGB(mood.gain[0], mood.gain[1], mood.gain[2]);
    if (p.tint !== undefined && tintK > 0) {
      this.tmpC.setHex(p.tint);
      g.gain.lerp(this.tmpC.multiplyScalar(1.15), tintK * 0.6);
      g.lift.lerp(this.tmpC2.setHex(p.tint).multiplyScalar(0.08), tintK);
    }
    if (w === 'poussiere') g.gain.multiply(this.tmpC.setRGB(1.06, 0.98, 0.84));
    // brume, pluie, neige : voile laiteux dans les ombres plutôt qu'un simple assombrissement
    if (wk.haze > 0.01) g.lift.lerp(this.tmpC.copy(this.bg).multiplyScalar(0.42 * clamp01(this.daylight + 0.3)), wk.haze * 0.55);
    g.saturation = mood.sat * lerp(1, 0.78, wk.haze * 0.6 + (1 - wk.dim) * 0.4);
    g.contrast = lerp(1.06, 0.94, wk.haze);
    g.vignette = mood.vignette + p.darkness * 0.25;
    g.bloom = lerp(0.55, 1.2, 1 - this.daylight);

    // ombres de nuages, vent, neige
    this.time += dt;
    const tu = toonUniforms;
    tu.uTime.value = this.time;
    tu.uWind.value.set(0.55, 0.22).multiplyScalar(wk.wind);
    tu.uCloud.value.set(0.022, wk.cover, wk.cloud * twilight, 0.07);
    tu.uCloudOffset.value.set(this.time * 0.006 * wk.wind + (p.scroll ?? 0) * 0.022, this.time * 0.0025 * wk.wind);
    tu.uSnow.value = ease(tu.uSnow.value, p.winter ? 0.85 : 0, 0.5);
    tu.uNightGlow.value = smoothstep(0.62, 0.3, this.daylight);
    tu.uSand.value = p.sand ?? 0;
    tu.uSkyTint.value.copy(this.bg);
    this.snapEnv = false;
  }

  private tmpV = new THREE.Vector3();

  render(): void {
    // flash d'écran : décroissance
    this.pixel.flash.multiplyScalar(0.86);
    this.pixel.render(this.renderer, this.scene, this.camera, this.rig.offset, this.rig.gridPos, this.rig.view);
  }
}

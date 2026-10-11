import * as THREE from 'three';
import { FX } from './particles';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/math';
import type { Weather } from '../data/biomes';

export type Quality = 'basse' | 'moyenne' | 'haute';

/** Caméra vue de dessus en 3e personne, angle fixe, suivi amorti, zoom et secousses. */
export class CameraRig {
  readonly target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  distance = 24;
  minDist = 12;
  maxDist = 42;
  private zoomTarget = 24;
  pitch = 0.98;
  yaw = 0;
  private shakeAmt = 0;
  private shakeTime = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  shakeEnabled = true;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

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
    const d = this.distance;
    const cx = this.smoothTarget.x + Math.sin(this.yaw) * Math.cos(this.pitch) * d;
    const cy = this.smoothTarget.y + Math.sin(this.pitch) * d;
    const cz = this.smoothTarget.z + Math.cos(this.yaw) * Math.cos(this.pitch) * d;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.smoothTarget);
    if (this.shakeAmt > 0.001) {
      this.shakeTime += dt * 40;
      const s = this.shakeAmt * this.shakeAmt * 0.6;
      this.camera.position.x += Math.sin(this.shakeTime * 1.3) * s;
      this.camera.position.y += Math.sin(this.shakeTime * 1.7 + 1) * s * 0.6;
      this.camera.position.z += Math.cos(this.shakeTime * 1.1) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
  }

  /** Point du sol (plan y = planeY) sous le curseur. */
  screenToGround(clientX: number, clientY: number, width: number, height: number, planeY = 0, out = new THREE.Vector3()): THREE.Vector3 {
    this.ndc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.plane.constant = -planeY;
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.tmp);
    if (hit) out.copy(hit);
    else out.copy(this.target);
    return out;
  }

  /** Projette un point 3D en coordonnées écran (px). */
  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; visible: boolean } {
    this.tmp.set(x, y, z).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * width, y: (-this.tmp.y * 0.5 + 0.5) * height, visible: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2 };
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
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly fx: FX;
  readonly lights: LightPool;
  readonly fog: THREE.Fog;
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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.rig = new CameraRig(this.camera);
    this.fog = new THREE.Fog(0xb0b8b0, 50, 170);
    this.scene.fog = this.fog;
    this.scene.background = this.bg;

    this.hemi = new THREE.HemisphereLight(0xdfe8f0, 0x5a5040, 1.2);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.fx = new FX(this.scene);
    this.lights = new LightPool(this.scene, 5);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality, shadows: boolean): void {
    this.quality = q;
    const ratio = q === 'haute' ? Math.min(window.devicePixelRatio, 1.75) : q === 'moyenne' ? Math.min(window.devicePixelRatio, 1.25) : 0.85;
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = shadows && q !== 'basse';
    const size = q === 'haute' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.fx.smoke.density = q === 'basse' ? 0.4 : q === 'moyenne' ? 0.7 : 1;
    this.fx.glow.density = q === 'basse' ? 0.5 : 1;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Ambiance : jour/nuit, météo, brouillard, teinte des zones dangereuses. */
  setEnvironment(p: EnvParams, dt: number): void {
    const m = ((p.minutes % 1440) + 1440) % 1440;
    // élévation du soleil : 0 à 5h30, pic vers 13h, 0 à 20h30
    const dayT = (m - 330) / (1230 - 330);
    const elev = dayT > 0 && dayT < 1 ? Math.sin(dayT * Math.PI) : 0;
    const twilight = smoothstep(0, 0.25, elev);
    const weatherDim = p.weather === 'tempete' ? 0.45 : p.weather === 'brume' ? 0.6 : p.weather === 'poussiere' ? 0.65 : p.weather === 'pluie' || p.weather === 'neige' || p.weather === 'cendres' ? 0.75 : 1;
    const dl = clamp01(twilight * weatherDim * (1 - p.darkness * 0.85));
    this.daylight = this.snapEnv ? dl : damp(this.daylight, dl, 2, dt);

    const dlv = this.daylight;
    // soleil
    const azim = lerp(-1.2, 1.2, clamp01(dayT));
    const sunDir = new THREE.Vector3(Math.sin(azim) * 0.8, Math.max(0.25, elev) * 1.2 + 0.2, 0.55).normalize();
    const t = this.rig.target;
    this.sun.position.set(t.x + sunDir.x * 70, t.y + sunDir.y * 70, t.z + sunDir.z * 70);
    this.sun.target.position.copy(t);
    const warm = 1 - smoothstep(0.15, 0.6, elev);
    this.tmpC.setHex(0xfff4e0).lerp(this.tmpC2.setHex(0xffa860), warm * 0.7);
    this.sun.color.copy(this.tmpC);
    this.sun.intensity = 2.4 * twilight * weatherDim * (1 - p.darkness);
    // lune : lumière bleutée la nuit
    const night = 1 - dlv;
    this.hemi.color.setHex(0xdde6f0).lerp(this.tmpC2.setHex(0x34405e), night);
    this.hemi.groundColor.setHex(p.winter ? 0x8a8c90 : 0x5a5040).lerp(this.tmpC2.setHex(0x101420), night);
    this.hemi.intensity = lerp(0.55, 1.35, dlv) * (1 - p.darkness * 0.75);
    this.ambient.intensity = lerp(0.18, 0.12, dlv);

    // ciel et brouillard
    this.tmpC.setHex(p.fogColor);
    this.tmpC2.setHex(0x0b0f1c);
    this.bg.copy(this.tmpC2).lerp(this.tmpC, clamp01(dlv * 1.1));
    if (p.tint !== undefined && p.tintAmount) this.bg.lerp(this.tmpC.setHex(p.tint), p.tintAmount);
    if (warm > 0.2 && elev > 0) this.bg.lerp(this.tmpC.setHex(0xd08a5a), (warm - 0.2) * 0.25 * twilight);
    this.fog.color.copy(this.bg);
    let near = 55;
    let far = 165;
    if (p.weather === 'brume') { near = 12; far = 75; }
    else if (p.weather === 'tempete') { near = 8; far = 55; }
    else if (p.weather === 'poussiere') { near = 14; far = 80; }
    else if (p.weather === 'neige' || p.weather === 'pluie' || p.weather === 'cendres') { near = 35; far = 120; }
    if (p.darkness > 0.5) { near *= 0.5; far *= 0.6; }
    this.fog.near = this.snapEnv ? near : damp(this.fog.near, near, 1.5, dt);
    this.fog.far = this.snapEnv ? far : damp(this.fog.far, far, 1.5, dt);
    this.snapEnv = false;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';
import type { FX } from './particles';

/**
 * Météo en style pixel : tout est rendu dans la cible basse résolution, donc
 * - la pluie est faite de traits d'un texel (LineSegments) inclinés par le vent, avec éclaboussures au sol ;
 * - neige, cendres et poussière sont des carrés de 1 à 2 texels (Points) ;
 * - la tempête de sable ajoute des stries horizontales ; l'orage, des éclairs.
 */
export type WeatherFxKind = '' | 'pluie' | 'orage' | 'neige' | 'blizzard' | 'cendres' | 'poussiere';

const PTS_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale;
  #include <fog_vertex>
}
`;

const PTS_FRAG = /* glsl */ `
varying vec3 vColor;
uniform float uOpacity;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColor, uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const MIST_VERT = /* glsl */ `
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
uniform vec2 uOffset;
uniform float uDensity;
uniform vec3 uColor;
uniform float uSeed;
varying vec3 vW;
float mHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float mNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), u.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = vW.xz * 0.05 + uOffset + uSeed;
  float n = mNoise(p) * 0.55 + mNoise(p * 2.1 + 5.2) * 0.3 + mNoise(p * 4.3 + 1.7) * 0.15;
  float a = smoothstep(0.62 - uDensity * 0.3, 0.86, n) * uDensity;
  // nappes en paliers nets, comme peintes à la main
  a = floor(a * 4.0 + 0.35) / 4.0 * 0.6;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

export interface WeatherUpdate {
  dt: number;
  kind: WeatherFxKind;
  /** Centre de la vue (cible caméra). */
  cx: number;
  cz: number;
  /** Demi-dimensions monde du cadre (CameraRig.view). */
  viewW: number;
  viewH: number;
  pitch: number;
  /** Vent (m/s) dans le plan XZ. */
  windX: number;
  windZ: number;
  /** Vitesse du sol (le train roule vers +X : le décor recule). */
  groundSpeed: number;
  hidden: boolean;
  quality: 'basse' | 'moyenne' | 'haute';
  /** 0..1 : nappes de brume au ras du sol. */
  mist: number;
  /** Couleur de la brume (espace de travail linéaire). */
  mistColor: THREE.Color;
}

export class WeatherFx {
  readonly group = new THREE.Group();
  private kind: WeatherFxKind = '';
  private quality = '';
  private rain: THREE.LineSegments | null = null;
  private rainPos: Float32Array | null = null;
  private drops: Float32Array | null = null;
  private flakes: THREE.Points | null = null;
  private flakePos: Float32Array | null = null;
  private flakeSeed: Float32Array | null = null;
  private streaks: THREE.LineSegments | null = null;
  private streakPos: Float32Array | null = null;
  private streakData: Float32Array | null = null;
  private bolt: THREE.Line | null = null;
  private boltT = 0;
  private nextBolt = 6;
  private time = 0;
  private bounds: Bounds = { x0: -40, x1: 40, z0: -30, z1: 40, top: 18 };
  /** Éclair : appelé avec la position (lumière, son). */
  onLightning: ((x: number, z: number) => void) | null = null;

  private mist: THREE.Mesh[] = [];
  private mistAmount = 0;

  constructor(scene: THREE.Scene, private fx: FX) {
    this.group.renderOrder = 15;
    scene.add(this.group);
    // deux nappes de brume (au sol et à hauteur d'homme) : parallaxe légère
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        uniforms: { uOffset: { value: new THREE.Vector2() }, uDensity: { value: 0 }, uColor: { value: new THREE.Color(0xdde4ea) }, uSeed: { value: i * 13.7 } },
        transparent: true,
        depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2), mat);
      m.position.y = i === 0 ? 0.35 : 1.7;
      m.renderOrder = 12;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      this.mist.push(m);
    }
  }

  private updateMist(u: WeatherUpdate): void {
    this.mistAmount += (u.mist * (u.hidden ? 0 : 1) - this.mistAmount) * Math.min(1, u.dt * 0.8);
    for (let i = 0; i < this.mist.length; i++) {
      const m = this.mist[i];
      const mat = m.material as THREE.ShaderMaterial;
      const d = this.mistAmount * (i === 0 ? 1 : 0.7);
      m.visible = d > 0.02;
      if (!m.visible) continue;
      m.position.x = Math.round(u.cx / 10) * 10;
      m.position.z = Math.round(u.cz / 10) * 10;
      const un = mat.uniforms;
      un.uDensity.value = d;
      un.uColor.value.copy(u.mistColor);
      // la brume dérive avec le vent (et recule avec le décor quand le train roule)
      const k = i === 0 ? 0.05 : 0.065;
      un.uOffset.value.x += (u.windX * 0.25 - u.groundSpeed) * u.dt * k;
      un.uOffset.value.y += u.windZ * 0.25 * u.dt * k;
    }
  }

  private clear(): void {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    this.rain = this.flakes = this.streaks = null;
    this.bolt = null;
    this.rainPos = this.drops = this.flakePos = this.flakeSeed = this.streakPos = this.streakData = null;
  }

  private rand(b: Bounds, out: Float32Array, i: number): void {
    out[i] = b.x0 + Math.random() * (b.x1 - b.x0);
    out[i + 1] = Math.random() * b.top;
    out[i + 2] = b.z0 + Math.random() * (b.z1 - b.z0);
  }

  private build(kind: WeatherFxKind, q: string): void {
    this.clear();
    const k = q === 'basse' ? 0.45 : q === 'moyenne' ? 0.75 : 1;
    if (kind === 'pluie' || kind === 'orage') {
      const n = Math.round((kind === 'orage' ? 1500 : 950) * k);
      this.drops = new Float32Array(n * 4);
      this.rainPos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        this.rand(this.bounds, this.drops, i * 4);
        this.drops[i * 4 + 3] = 0.8 + Math.random() * 0.4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineBasicMaterial({ color: 0xa8bed4, transparent: true, opacity: kind === 'orage' ? 0.62 : 0.5, depthWrite: false, fog: true });
      this.rain = new THREE.LineSegments(geo, mat);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 15;
      this.group.add(this.rain);
    }
    if (kind === 'neige' || kind === 'blizzard' || kind === 'cendres' || kind === 'poussiere') {
      const n = Math.round((kind === 'blizzard' ? 2200 : kind === 'neige' ? 1100 : kind === 'cendres' ? 900 : 700) * k);
      this.flakePos = new Float32Array(n * 3);
      this.flakeSeed = new Float32Array(n);
      const size = new Float32Array(n);
      const color = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        this.rand(this.bounds, this.flakePos, i * 3);
        this.flakeSeed[i] = Math.random();
        const r = Math.random();
        size[i] = r < 0.25 ? 2 : 1;
        if (kind === 'neige' || kind === 'blizzard') c.setHex(r < 0.5 ? 0xf4f8ff : 0xd8e4f0);
        else if (kind === 'cendres') c.setHex(r < 0.04 ? 0xff9a48 : r < 0.5 ? 0x9a948e : 0x5e5856);
        else c.setHex(r < 0.5 ? 0xc9a874 : 0xa88a5c);
        color.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
      const mat = new THREE.ShaderMaterial({
        vertexShader: PTS_VERT,
        fragmentShader: PTS_FRAG,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 1 }, uOpacity: { value: kind === 'poussiere' ? 0.55 : 0.92 } }]),
        transparent: true,
        depthWrite: false,
        fog: true,
      });
      this.flakes = new THREE.Points(geo, mat);
      this.flakes.frustumCulled = false;
      this.flakes.renderOrder = 15;
      this.group.add(this.flakes);
    }
    if (kind === 'poussiere' || kind === 'blizzard') {
      const n = Math.round((kind === 'poussiere' ? 200 : 170) * k);
      this.streakPos = new Float32Array(n * 6);
      this.streakData = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        this.rand(this.bounds, this.streakData, i * 4);
        this.streakData[i * 4 + 1] = Math.random() * 5;
        this.streakData[i * 4 + 3] = 1.2 + Math.random() * 2.4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineBasicMaterial({ color: kind === 'poussiere' ? 0xd8b884 : 0xe8f0f8, transparent: true, opacity: 0.3, depthWrite: false, fog: true });
      this.streaks = new THREE.LineSegments(geo, mat);
      this.streaks.frustumCulled = false;
      this.streaks.renderOrder = 15;
      this.group.add(this.streaks);
    }
    if (kind === 'orage') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(11 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      this.bolt = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xeef4ff, fog: false }));
      this.bolt.frustumCulled = false;
      this.bolt.visible = false;
      this.bolt.renderOrder = 16;
      this.group.add(this.bolt);
    }
  }

  /** Recycle un point sorti du volume (le volume suit la caméra). */
  private wrap(a: Float32Array, i: number, b: Bounds): void {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    if (a[i] < b.x0) a[i] += w;
    else if (a[i] > b.x1) a[i] -= w;
    if (a[i + 2] < b.z0) a[i + 2] += d;
    else if (a[i + 2] > b.z1) a[i + 2] -= d;
  }

  update(u: WeatherUpdate): void {
    this.updateMist(u);
    if (u.kind !== this.kind || u.quality !== this.quality) {
      this.kind = u.kind;
      this.quality = u.quality;
      this.build(u.kind, u.quality);
    }
    this.group.visible = !u.hidden && u.kind !== '';
    if (!this.group.visible) return;
    const dt = Math.min(u.dt, 0.1);
    this.time += dt;
    // volume couvrant l'écran : les gouttes hautes apparaissent plus haut à l'écran
    const sp = Math.max(0.3, Math.sin(u.pitch));
    const cp = Math.cos(u.pitch);
    const b = this.bounds;
    b.top = 18;
    b.x0 = u.cx - u.viewW - 3;
    b.x1 = u.cx + u.viewW + 3;
    b.z0 = u.cz - u.viewH / sp - 3;
    b.z1 = u.cz + (b.top * cp + u.viewH) / sp + 3;
    const gs = u.groundSpeed;
    // ---- pluie
    if (this.rain && this.drops && this.rainPos) {
      const D = this.drops;
      const P = this.rainPos;
      const n = D.length / 4;
      const fall = this.kind === 'orage' ? 26 : 21;
      const vx = u.windX * 1.6 - gs;
      const vz = u.windZ * 1.6;
      const tail = 0.042;
      let splashes = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const s = D[o + 3];
        D[o] += vx * dt;
        D[o + 1] -= fall * s * dt;
        D[o + 2] += vz * dt;
        if (D[o + 1] < 0) {
          if (splashes < 14 && Math.random() < 0.5) {
            this.fx.smoke.spawn({ x: D[o], y: 0.06, z: D[o + 2], life: 0.16, size0: 0.1, size1: 0.42, color0: 0xc8d8e8, alpha0: 0.7, alpha1: 0, world: true });
            splashes++;
          }
          this.rand(b, D, o);
          D[o + 1] = b.top * (0.85 + Math.random() * 0.15);
        }
        this.wrap(D, o, b);
        const p = i * 6;
        P[p] = D[o];
        P[p + 1] = D[o + 1];
        P[p + 2] = D[o + 2];
        P[p + 3] = D[o] - vx * tail;
        P[p + 4] = D[o + 1] + fall * s * tail;
        P[p + 5] = D[o + 2] - vz * tail;
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // ---- flocons, cendres, poussière
    if (this.flakes && this.flakePos && this.flakeSeed) {
      const A = this.flakePos;
      const S = this.flakeSeed;
      const n = S.length;
      const k = this.kind;
      const fall = k === 'blizzard' ? 4.5 : k === 'neige' ? 1.6 : k === 'cendres' ? 0.7 : 0.4;
      const windMul = k === 'blizzard' ? 5 : k === 'poussiere' ? 6 : k === 'neige' ? 1.2 : 0.8;
      const vx = u.windX * windMul - gs;
      const vz = u.windZ * windMul;
      const t = this.time;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const s = S[i];
        const sway = Math.sin(t * (0.8 + s * 1.4) + s * 40) * (k === 'cendres' ? 1.1 : 0.6);
        A[o] += (vx * (0.7 + s * 0.6) + sway) * dt;
        A[o + 1] -= fall * (0.6 + s * 0.8) * dt * (k === 'poussiere' ? Math.sin(t * 2 + s * 30) : 1);
        A[o + 2] += (vz + Math.cos(t * 0.9 + s * 25) * 0.4) * dt;
        if (A[o + 1] < 0) {
          A[o] = b.x0 + Math.random() * (b.x1 - b.x0);
          A[o + 1] = k === 'poussiere' ? Math.random() * 4 : b.top;
          A[o + 2] = b.z0 + Math.random() * (b.z1 - b.z0);
        } else if (A[o + 1] > b.top) A[o + 1] = 0.2;
        this.wrap(A, o, b);
      }
      (this.flakes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // ---- stries de vent (sable, blizzard)
    if (this.streaks && this.streakData && this.streakPos) {
      const D = this.streakData;
      const P = this.streakPos;
      const n = D.length / 4;
      const speed = this.kind === 'poussiere' ? 16 : 18;
      const len = Math.hypot(u.windX, u.windZ) || 1;
      const dx = u.windX / len;
      const dz = u.windZ / len;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        D[o] += (dx * speed - gs) * dt;
        D[o + 2] += dz * speed * dt;
        this.wrap(D, o, b);
        const p = i * 6;
        const l = D[o + 3];
        P[p] = D[o];
        P[p + 1] = D[o + 1];
        P[p + 2] = D[o + 2];
        P[p + 3] = D[o] - dx * l;
        P[p + 4] = D[o + 1];
        P[p + 5] = D[o + 2] - dz * l;
      }
      (this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // ---- éclairs
    if (this.bolt) {
      this.nextBolt -= dt;
      if (this.boltT > 0) {
        this.boltT -= dt;
        this.bolt.visible = this.boltT > 0 && (this.boltT > 0.1 || this.boltT % 0.06 > 0.03);
      }
      if (this.nextBolt <= 0) {
        this.nextBolt = 7 + Math.random() * 14;
        this.boltT = 0.22;
        const x = u.cx + (Math.random() - 0.5) * u.viewW * 1.6;
        const z = u.cz - u.viewH * 0.2 + (Math.random() - 0.5) * 8;
        const arr = (this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
        let px = x + (Math.random() - 0.5) * 6;
        let pz = z;
        for (let i = 0; i <= 10; i++) {
          const y = 40 - i * 4;
          arr[i * 3] = px;
          arr[i * 3 + 1] = Math.max(0, y);
          arr[i * 3 + 2] = pz;
          px += (Math.random() - 0.5) * 2.4 + (x - px) * 0.25;
          pz += (Math.random() - 0.5) * 1.2;
        }
        (this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        this.onLightning?.(x, z);
      }
    }
  }
}

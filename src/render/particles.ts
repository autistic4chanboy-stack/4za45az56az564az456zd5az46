import * as THREE from 'three';
import { toonUniforms } from './toon';

/**
 * Système de particules instancié (billboards) : une draw call par système.
 * Les particules « world » dérivent avec le sol quand le train roule.
 */

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1?: number;
  color0: number | THREE.Color;
  color1?: number | THREE.Color;
  alpha0?: number;
  alpha1?: number;
  gravity?: number;
  drag?: number;
  /** Attachée au sol (dérive quand le train roule). */
  world?: boolean;
  /** Ne descend pas sous ce y (rebond simple au sol). */
  floor?: number;
}

const VERT = /* glsl */ `
attribute vec3 iOffset;
attribute float iSize;
attribute vec4 iColor;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vColor = iColor;
  vUv = uv;
  vec4 mvPosition = viewMatrix * vec4(iOffset, 1.0);
  mvPosition.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
uniform float uSoft;
uniform float uAdd;
uniform float uSmooth;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  vec3 col = vColor.rgb;
  float a = vColor.a;
  if (uSmooth > 0.5) {
    // haute définition : volutes fondues, modelé léger
    if (uAdd > 0.5) a *= pow(1.0 - d, 1.7);
    else {
      col *= 0.84 + 0.16 * smoothstep(0.45, -0.45, q.y + q.x * 0.35);
      a *= 1.0 - smoothstep(uSoft * 0.6, 1.0, d);
    }
  } else {
    // pixel art : disque net, volumes en deux tons, transparence en paliers
    if (uAdd > 0.5) {
      a *= d < 0.42 ? 1.0 : d < 0.74 ? 0.5 : 0.16;
    } else {
      col *= q.y + q.x * 0.35 < -0.1 ? 0.8 : 1.0;
      a *= d < uSoft + 0.3 ? 1.0 : 0.55;
    }
    a = floor(a * 5.0 + 0.5) / 5.0;
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const STRIDE = 22;
// indices dans le tableau d'état
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, LIFE = 6, MAX = 7, S0 = 8, S1 = 9;
const R0 = 10, G0 = 11, B0 = 12, A0 = 13, R1 = 14, G1 = 15, B1 = 16, A1 = 17, GRAV = 18, DRAG = 19, WORLD = 20, FLOOR = 21;

const c0 = new THREE.Color();
const c1 = new THREE.Color();

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private state: Float32Array;
  private count = 0;
  private offsets: THREE.InstancedBufferAttribute;
  private sizes: THREE.InstancedBufferAttribute;
  private colors: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  /** Facteur global (option qualité). */
  density = 1;

  constructor(private max: number, additive: boolean, soft = 0.45) {
    this.state = new Float32Array(max * STRIDE);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.sizes = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.offsets.setUsage(THREE.DynamicDrawUsage);
    this.sizes.setUsage(THREE.DynamicDrawUsage);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iOffset', this.offsets);
    this.geo.setAttribute('iSize', this.sizes);
    this.geo.setAttribute('iColor', this.colors);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSoft: { value: soft }, uAdd: { value: additive ? 1 : 0 } }]), uSmooth: toonUniforms.uToonSoft },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: !additive,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  get alive(): number {
    return this.count;
  }

  spawn(p: ParticleSpawn): void {
    if (this.count >= this.max) return;
    if (this.density < 1 && Math.random() > this.density) return;
    const o = this.count * STRIDE;
    const s = this.state;
    s[o + PX] = p.x;
    s[o + PY] = p.y;
    s[o + PZ] = p.z;
    s[o + VX] = p.vx ?? 0;
    s[o + VY] = p.vy ?? 0;
    s[o + VZ] = p.vz ?? 0;
    s[o + LIFE] = p.life;
    s[o + MAX] = p.life;
    s[o + S0] = p.size0;
    s[o + S1] = p.size1 ?? p.size0;
    c0.set(p.color0 as THREE.ColorRepresentation);
    c1.set((p.color1 ?? p.color0) as THREE.ColorRepresentation);
    s[o + R0] = c0.r;
    s[o + G0] = c0.g;
    s[o + B0] = c0.b;
    s[o + A0] = p.alpha0 ?? 1;
    s[o + R1] = c1.r;
    s[o + G1] = c1.g;
    s[o + B1] = c1.b;
    s[o + A1] = p.alpha1 ?? 0;
    s[o + GRAV] = p.gravity ?? 0;
    s[o + DRAG] = p.drag ?? 0;
    s[o + WORLD] = p.world ? 1 : 0;
    s[o + FLOOR] = p.floor ?? -1000;
    this.count++;
  }

  /** groundSpeed : vitesse du train (m/s) — les particules « world » reculent d'autant. */
  update(dt: number, groundSpeed: number): void {
    const s = this.state;
    const off = this.offsets.array as Float32Array;
    const siz = this.sizes.array as Float32Array;
    const col = this.colors.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      s[o + LIFE] -= dt;
      if (s[o + LIFE] <= 0) {
        // retire en échangeant avec la dernière
        this.count--;
        if (i !== this.count) {
          const last = this.count * STRIDE;
          for (let k = 0; k < STRIDE; k++) s[o + k] = s[last + k];
        }
        continue;
      }
      const drag = s[o + DRAG];
      if (drag > 0) {
        const f = Math.exp(-drag * dt);
        s[o + VX] *= f;
        s[o + VY] *= f;
        s[o + VZ] *= f;
      }
      s[o + VY] -= s[o + GRAV] * dt;
      s[o + PX] += (s[o + VX] - (s[o + WORLD] > 0 ? groundSpeed : 0)) * dt;
      s[o + PY] += s[o + VY] * dt;
      s[o + PZ] += s[o + VZ] * dt;
      if (s[o + PY] < s[o + FLOOR]) {
        s[o + PY] = s[o + FLOOR];
        s[o + VY] *= -0.3;
        s[o + VX] *= 0.6;
        s[o + VZ] *= 0.6;
      }
      const t = 1 - s[o + LIFE] / s[o + MAX];
      const k3 = i * 3;
      off[k3] = s[o + PX];
      off[k3 + 1] = s[o + PY];
      off[k3 + 2] = s[o + PZ];
      siz[i] = s[o + S0] + (s[o + S1] - s[o + S0]) * t;
      const k4 = i * 4;
      col[k4] = s[o + R0] + (s[o + R1] - s[o + R0]) * t;
      col[k4 + 1] = s[o + G0] + (s[o + G1] - s[o + G0]) * t;
      col[k4 + 2] = s[o + B0] + (s[o + B1] - s[o + B0]) * t;
      col[k4 + 3] = s[o + A0] + (s[o + A1] - s[o + A0]) * t;
      i++;
    }
    this.geo.instanceCount = this.count;
    if (this.count > 0) {
      this.offsets.clearUpdateRanges();
      this.sizes.clearUpdateRanges();
      this.colors.clearUpdateRanges();
      this.offsets.addUpdateRange(0, this.count * 3);
      this.sizes.addUpdateRange(0, this.count);
      this.colors.addUpdateRange(0, this.count * 4);
      this.offsets.needsUpdate = true;
      this.sizes.needsUpdate = true;
      this.colors.needsUpdate = true;
    }
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}

/** Effets prêts à l'emploi. */
export class FX {
  readonly smoke = new ParticleSystem(2600, false, 0.35);
  readonly glow = new ParticleSystem(1800, true, 0.25);

  constructor(scene: THREE.Scene) {
    scene.add(this.smoke.mesh, this.glow.mesh);
  }

  update(dt: number, groundSpeed: number): void {
    this.smoke.update(dt, groundSpeed);
    this.glow.update(dt, groundSpeed);
  }

  clear(): void {
    this.smoke.clear();
    this.glow.clear();
  }

  muzzle(x: number, y: number, z: number, yaw: number, color = 0xffd27a, scale = 1): void {
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    this.glow.spawn({ x, y, z, life: 0.06, size0: 0.9 * scale, size1: 0.3 * scale, color0: color, alpha0: 1, alpha1: 0 });
    for (let i = 0; i < 3; i++) {
      const sp = 6 + Math.random() * 6;
      this.glow.spawn({
        x, y, z,
        vx: dx * sp + (Math.random() - 0.5) * 2,
        vy: Math.random() * 1.5,
        vz: dz * sp + (Math.random() - 0.5) * 2,
        life: 0.08 + Math.random() * 0.06,
        size0: 0.25 * scale,
        size1: 0.05,
        color0: color,
        alpha0: 1,
      });
    }
    this.smoke.spawn({ x: x + dx * 0.4, y, z: z + dz * 0.4, vx: dx * 1.5, vy: 0.6, vz: dz * 1.5, life: 0.5, size0: 0.3 * scale, size1: 0.9 * scale, color0: 0x9a958c, alpha0: 0.35, drag: 2 });
  }

  sparks(x: number, y: number, z: number, n = 6, color = 0xffc060, world = false): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.glow.spawn({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: 1 + Math.random() * 4,
        vz: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.3,
        size0: 0.18,
        size1: 0.04,
        color0: color,
        gravity: 14,
        world,
        floor: 0.05,
      });
    }
  }

  blood(x: number, y: number, z: number, color = 0x8a1010, n = 6, world = false): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3;
      this.smoke.spawn({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: 1 + Math.random() * 3,
        vz: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        size0: 0.22,
        size1: 0.12,
        color0: color,
        alpha0: 0.9,
        alpha1: 0.4,
        gravity: 12,
        world,
        floor: 0.03,
      });
    }
  }

  explosion(x: number, y: number, z: number, radius: number, world = false): void {
    const n = Math.round(10 + radius * 6);
    this.glow.spawn({ x, y: y + 0.5, z, life: 0.25, size0: radius * 2.2, size1: radius * 3, color0: 0xffe0a0, color1: 0xff5010, alpha0: 1, world });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 4) * (radius / 2);
      this.glow.spawn({
        x, y: y + 0.3, z,
        vx: Math.cos(a) * sp,
        vy: 1 + Math.random() * 4,
        vz: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.4,
        size0: 0.8 + Math.random() * radius * 0.4,
        size1: 0.2,
        color0: 0xffb040,
        color1: 0xff3000,
        drag: 2,
        world,
      });
      this.smoke.spawn({
        x: x + Math.cos(a) * 0.5, y: y + 0.4, z: z + Math.sin(a) * 0.5,
        vx: Math.cos(a) * sp * 0.6,
        vy: 1.5 + Math.random() * 2,
        vz: Math.sin(a) * sp * 0.6,
        life: 1.2 + Math.random() * 1.2,
        size0: 0.8,
        size1: 2.4 + radius * 0.5,
        color0: 0x3c3632,
        color1: 0x6a645c,
        alpha0: 0.7,
        drag: 1.5,
        world,
      });
    }
    this.sparks(x, y + 0.3, z, 8, 0xffd080, world);
  }

  puff(x: number, y: number, z: number, color = 0x8c8680, size = 1, world = false, alpha = 0.5): void {
    this.smoke.spawn({
      x, y, z,
      vx: (Math.random() - 0.5) * 0.6,
      vy: 0.6 + Math.random() * 0.5,
      vz: (Math.random() - 0.5) * 0.6,
      life: 1 + Math.random() * 0.6,
      size0: 0.4 * size,
      size1: 1.4 * size,
      color0: color,
      alpha0: alpha,
      drag: 0.8,
      world,
    });
  }

  dust(x: number, z: number, color = 0xa89a80, world = true): void {
    this.smoke.spawn({
      x, y: 0.2, z,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 0.3 + Math.random() * 0.4,
      vz: (Math.random() - 0.5) * 1.2,
      life: 0.6 + Math.random() * 0.4,
      size0: 0.3,
      size1: 1.1,
      color0: color,
      alpha0: 0.35,
      drag: 1.5,
      world,
    });
  }

  heal(x: number, y: number, z: number): void {
    for (let i = 0; i < 8; i++) {
      this.glow.spawn({
        x: x + (Math.random() - 0.5) * 0.8,
        y: y + Math.random() * 0.8,
        z: z + (Math.random() - 0.5) * 0.8,
        vy: 1 + Math.random(),
        life: 0.8,
        size0: 0.25,
        size1: 0.05,
        color0: 0x60ff90,
      });
    }
  }

  electric(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = 0x8fd8ff): void {
    const n = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : 0.35;
      this.glow.spawn({
        x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * j,
        y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * j,
        z: z0 + (z1 - z0) * t + (Math.random() - 0.5) * j,
        life: 0.12 + Math.random() * 0.06,
        size0: 0.35,
        size1: 0.1,
        color0: 0xffffff,
        color1: color,
      });
    }
  }

  flame(x: number, y: number, z: number, vx: number, vz: number, world = false): void {
    this.glow.spawn({
      x, y, z,
      vx: vx + (Math.random() - 0.5) * 2,
      vy: 0.5 + Math.random(),
      vz: vz + (Math.random() - 0.5) * 2,
      life: 0.35 + Math.random() * 0.2,
      size0: 0.4,
      size1: 1.3,
      color0: 0xffd070,
      color1: 0xff3a00,
      alpha0: 0.9,
      drag: 2.5,
      world,
    });
  }

  /** Fumée de cheminée, poussée par le vent. */
  chimney(x: number, y: number, z: number, windX: number, windZ: number): void {
    this.smoke.spawn({
      x, y, z,
      vx: windX * 0.7 + (Math.random() - 0.5) * 0.15,
      vy: 0.8 + Math.random() * 0.3,
      vz: windZ * 0.7 + (Math.random() - 0.5) * 0.15,
      life: 2.8 + Math.random() * 1.2,
      size0: 0.35,
      size1: 1.7,
      color0: 0x8a847e,
      color1: 0xb8b4ae,
      alpha0: 0.5,
      alpha1: 0,
      drag: 0.25,
    });
  }

  steam(x: number, y: number, z: number, wind: number, dark = false): void {
    this.smoke.spawn({
      x, y, z,
      vx: -wind * 0.9 + (Math.random() - 0.5) * 0.5,
      vy: 2.2 + Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 0.5,
      life: 2.2 + Math.random() * 1.2,
      size0: 0.6,
      size1: 3.2,
      color0: dark ? 0x2a2622 : 0xd8d4cc,
      color1: dark ? 0x5a5650 : 0xa8a6a2,
      alpha0: dark ? 0.6 : 0.5,
      alpha1: 0,
      drag: 0.4,
    });
  }
}

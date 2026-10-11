import * as THREE from 'three';

/**
 * Ombrage « toon » pour le rendu pixel art : les matériaux Lambert de three.js sont
 * patchés à la compilation (onBeforeCompile) pour obtenir
 * - un terminateur net et deux paliers de lumière solaire,
 * - des ombres portées franches, que les ombres de nuages traversent en dérivant,
 * - des lumières ponctuelles (lampes, feux) en paliers bien lisibles,
 * - de la neige sur les surfaces tournées vers le ciel en hiver,
 * - le balancement du feuillage et de l'herbe au vent,
 * - un grain de sol procédural en coordonnées locales (fixe sur le terrain, même quand il défile).
 */

/** Uniformes partagés par tous les matériaux patchés (une seule mise à jour par image). */
export const toonUniforms = {
  uTime: { value: 0 },
  /** Direction et force du vent (m). */
  uWind: { value: new THREE.Vector2(0.6, 0.25) },
  /** x : échelle, y : seuil de couverture, z : force de l'ombre, w : netteté. */
  uCloud: { value: new THREE.Vector4(0.022, 0.62, 0.32, 0.07) },
  uCloudOffset: { value: new THREE.Vector2() },
  /** 0..1 : couverture neigeuse des surfaces horizontales. */
  uSnow: { value: 0 },
  uSnowColor: { value: new THREE.Color(0xeef3f7) },
  /** Nombre de paliers des lumières ponctuelles. */
  uLightBands: { value: 4 },
};

export interface ToonOptions {
  /** Balancement au vent : 'world' (géométrie fusionnée, selon la hauteur) ou 'local' (instances, selon y local). */
  sway?: 'world' | 'local';
  /** Amplitude du balancement (m). */
  swayAmp?: number;
  /** Grain procédural du sol. */
  ground?: boolean;
  /** Accepte la neige (par défaut oui). */
  snow?: boolean;
  /** Surface d'eau animée (rides et reflets). */
  water?: boolean;
}

const COMMON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uCloud;
uniform vec2 uCloudOffset;
uniform float uSnow;
uniform vec3 uSnowColor;
uniform float uLightBands;
varying vec3 vTWorld;
varying vec3 vTLocal;
float toonSunShadow = 1.0;

float tHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * tNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
/** 1 = au soleil, <1 = sous un nuage. */
float toonCloud(vec2 p) {
  if (uCloud.z <= 0.0) return 1.0;
  float n = tFbm(p * uCloud.x + uCloudOffset);
  return 1.0 - smoothstep(uCloud.y - uCloud.w, uCloud.y + uCloud.w, n) * uCloud.z;
}
`;

const LIGHTS_PARS = /* glsl */ `
varying vec3 vViewPosition;

struct LambertMaterial {
  vec3 diffuseColor;
  float specularStrength;
};

// Soleil : terminateur net, deux paliers, ombres portées franches, nuages.
void RE_Direct_Sun( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction );
  float lit = smoothstep( -0.03, 0.05, ndl );
  float form = mix( 0.72, 1.0, smoothstep( 0.32, 0.42, ndl ) );
  float sh = smoothstep( 0.4, 0.6, toonSunShadow );
  float k = lit * sh * toonCloud( vTWorld.xz ) * form;
  reflectedLight.directDiffuse += directLight.color * k * BRDF_Lambert( material.diffuseColor );
}

// Lampes et feux : éclairage enveloppant, intensité découpée en paliers.
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction );
  float wrap = clamp( ndl * 0.6 + 0.4, 0.0, 1.0 );
  vec3 c = directLight.color * wrap;
  float l = max( max( c.r, c.g ), c.b );
  float q = floor( l * uLightBands + 0.35 ) / uLightBands;
  c *= q / max( l, 1e-4 );
  reflectedLight.directDiffuse += c * BRDF_Lambert( material.diffuseColor );
}

void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

let patchedLights: string | null = null;

/** Copie de lights_fragment_begin où le bloc directionnel isole l'ombre et appelle RE_Direct_Sun. */
function lightsFragmentBegin(): string {
  if (patchedLights) return patchedLights;
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const i0 = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = i0 >= 0 ? src.indexOf('#pragma unroll_loop_end', i0) : -1;
  if (i0 < 0 || end < 0) {
    console.warn('toon : chunk lights_fragment_begin inattendu, ombrage standard conservé');
    patchedLights = src;
    return src;
  }
  let block = src.slice(i0, end);
  const shadowExpr = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow(';
  if (block.includes(shadowExpr)) block = block.replace(shadowExpr, 'toonSunShadow = ( directLight.visible && receiveShadow ) ? getShadow(');
  block = block.replace('RE_Direct( directLight', 'RE_Direct_Sun( directLight');
  patchedLights = src.slice(0, i0) + block + src.slice(end);
  return patchedLights;
}

/** Transforme un MeshLambertMaterial en matériau toon (modifie l'instance). */
export function toonify<T extends THREE.MeshLambertMaterial>(mat: T, opts: ToonOptions = {}): T {
  const key = `toon:${opts.sway ?? ''}:${opts.swayAmp ?? 0}:${opts.ground ? 1 : 0}:${opts.snow === false ? 0 : 1}:${opts.water ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    for (const [k, v] of Object.entries(toonUniforms)) u[k] = v;
    u.uSwayAmp = { value: opts.swayAmp ?? (opts.sway === 'local' ? 0.22 : 0.1) };
    if (opts.sway) shader.defines = { ...(shader.defines ?? {}), TOON_SWAY: 1, [opts.sway === 'local' ? 'TOON_SWAY_LOCAL' : 'TOON_SWAY_WORLD']: 1 };
    if (opts.ground) shader.defines = { ...(shader.defines ?? {}), TOON_GROUND: 1 };
    if (opts.snow !== false) shader.defines = { ...(shader.defines ?? {}), TOON_SNOW: 1 };
    if (opts.water) shader.defines = { ...(shader.defines ?? {}), TOON_WATER: 1 };

    // ---------------------------------------------------------------- vertex
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform vec2 uWind;
uniform float uSwayAmp;
varying vec3 vTWorld;
varying vec3 vTLocal;
vec2 toonWind(vec2 p) {
  float w = sin(p.x * 0.31 + uTime * 1.9) * 0.55 + sin(p.y * 0.23 - uTime * 1.3 + p.x * 0.07) * 0.45;
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + p.x * 0.021 + p.y * 0.013);
  return uWind * (0.35 + 0.65 * w) * gust;
}`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `vTLocal = transformed;
vec4 tWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  tWorld = batchingMatrix * tWorld;
#endif
#ifdef USE_INSTANCING
  tWorld = instanceMatrix * tWorld;
#endif
tWorld = modelMatrix * tWorld;
#ifdef TOON_SWAY
  #ifdef TOON_SWAY_LOCAL
    float swayH = clamp( transformed.y, 0.0, 2.0 );
  #else
    float swayH = smoothstep( 0.6, 4.5, tWorld.y );
  #endif
  tWorld.xz += toonWind( tWorld.xz ) * swayH * uSwayAmp * 4.0;
#endif
vTWorld = tWorld.xyz;
vec4 mvPosition = viewMatrix * tWorld;
gl_Position = projectionMatrix * mvPosition;`,
      );

    // ---------------------------------------------------------------- fragment
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAG}`)
      .replace('#include <lights_lambert_pars_fragment>', LIGHTS_PARS)
      .replace('#include <lights_fragment_begin>', lightsFragmentBegin())
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 tWN = normalize( cross( dFdx( vTWorld ), dFdy( vTWorld ) ) );
#ifdef TOON_GROUND
  {
    vec2 gp = vTLocal.xz;
    float big = tNoise( gp * 0.11 );
    float mid = tNoise( gp * 0.9 + 3.7 );
    vec2 cell = floor( gp * 7.0 );
    float h = tHash( cell );
    float g = 1.0 + ( big - 0.5 ) * 0.12 + ( mid - 0.5 ) * 0.08;
    g += step( 0.88, h ) * 0.09 - step( h, 0.08 ) * 0.09;
    diffuseColor.rgb *= g;
  }
#endif
#ifdef TOON_WATER
  {
    // rides qui glissent et scintillements, fixés à la surface (coordonnées locales)
    vec2 wp = vTLocal.xz;
    float t = uTime;
    float r1 = tNoise( vec2( wp.x * 0.55 + t * 0.32, wp.y * 1.6 - t * 0.12 ) );
    float r2 = tNoise( vec2( wp.x * 1.2 - t * 0.21, wp.y * 2.4 + t * 0.17 ) + 7.0 );
    float band = r1 * 0.6 + r2 * 0.4;
    float ripple = step( 0.68, band );
    float trough = step( band, 0.3 );
    float sparkle = step( 0.975, tHash( floor( wp * 5.0 ) + floor( t * 2.5 ) ) );
    diffuseColor.rgb *= 1.0 - trough * 0.16;
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.5 + vec3( 0.05, 0.07, 0.08 ), ripple * 0.75 );
    diffuseColor.rgb += sparkle * vec3( 0.45, 0.5, 0.5 );
  }
#endif
#ifdef TOON_SNOW
  if ( uSnow > 0.0 ) {
    // la neige tient sur ce qui regarde le ciel ; le bruit ne fait que ronger ses bords
    float up = smoothstep( 0.55, 0.75, tWN.y );
    float sn = tNoise( vTLocal.xz * 2.3 + vTLocal.y * 1.3 );
    float cover = up * step( 0.28, sn + uSnow * 0.55 );
    diffuseColor.rgb = mix( diffuseColor.rgb, uSnowColor, cover * smoothstep( 0.2, 0.6, uSnow ) );
  }
#endif`,
      );
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}

/** Clone toon d'un matériau Lambert (onBeforeCompile n'est pas copié par clone()). */
export function toonClone<T extends THREE.MeshLambertMaterial>(mat: T, opts: ToonOptions = {}): T {
  return toonify(mat.clone() as T, opts);
}

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
  /** 0..1 : rides de sable sur le sol (désert). */
  uSand: { value: 0 },
  /** 0 = jour, 1 = nuit : allume les fenêtres. */
  uNightGlow: { value: 0 },
  /** Couleur du ciel (reflets des vitres). */
  uSkyTint: { value: new THREE.Color(0x8aa0b8) },
  /** 0 = ombrage en paliers francs (pixel art), 1 = modelé doux (haute définition). */
  uToonSoft: { value: 1 },
};

/**
 * Motifs procéduraux dessinés par le shader (attribut aPat des géométries GeoBuilder) :
 * ils restent nets au texel près et ne coûtent ni texture ni draw call.
 */
export const PAT = {
  aucun: 0,
  /** Bardage de planches horizontales. */
  planches: 1,
  /** Planches verticales à couvre-joints (granges). */
  lames: 2,
  briques: 3,
  pierre: 4,
  /** Panneaux de béton. */
  beton: 5,
  /** Tôle ondulée (murs). */
  tole: 6,
  /** Tuiles (toits en pente). */
  tuiles: 7,
  /** Bac acier à nervures (toits). */
  toleToit: 8,
  /** Toit-terrasse en lés de bitume. */
  feutre: 9,
  /** Bardeaux de bois. */
  bardeaux: 10,
  /** Platelage (planches au sol) et bardage sur les chants. */
  platelage: 11,
  /** Pavés. */
  paves: 12,
  /** Papier peint à rayures (murs intérieurs). */
  papier: 13,
  /** Carrelage (sols de cuisine, salle de bain, laboratoire…). */
  carrelage: 14,
  /** Surface lumineuse, non éclairée (lampes, écrans, voyants). */
  lumiere: 100,
  /** Vitre : reflets du ciel le jour, lueur la nuit si la couleur est vive. */
  vitre: 101,
} as const;

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
  /** Motifs procéduraux (attribut aPat). */
  pattern?: boolean;
}

const COMMON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uCloud;
uniform vec2 uCloudOffset;
uniform float uSnow;
uniform vec3 uSnowColor;
uniform float uLightBands;
uniform float uSand;
uniform float uNightGlow;
uniform vec3 uSkyTint;
uniform float uToonSoft;
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

const PATTERN_FRAG = /* glsl */ `
varying float vPat;
// ligne d'un texel au bas (pL) ou au haut (pH) de chaque cellule ; w = largeur d'un texel en cellules
float pL( float c, float w ) { return step( fract( c ), w ); }
float pH( float c, float w ) { return step( 1.0 - w, fract( c ) ); }
// un motif s'efface quand sa période tombe sous ~3 texels (pas de moiré)
float pVis( float w ) { return 1.0 - smoothstep( 0.26, 0.45, w ); }

vec3 toonPattern( vec3 col, float id, vec3 p, vec3 n ) {
  vec3 an = abs( n );
  bool top = an.y > 0.6;
  // murs : u horizontal le long de la face, v vertical
  vec2 tw = normalize( vec2( -n.z, n.x ) + vec2( 1e-6, 0.0 ) );
  float u = dot( p.xz, tw );
  float v = p.y;
  // dessus et toits : s descend la pente, w suit le faîtage
  vec2 dd = an.y > 0.985 ? vec2( 0.0, 1.0 ) : normalize( n.xz );
  vec2 tt = vec2( -dd.y, dd.x );
  float s = dot( p.xz, dd ) / max( an.y, 0.3 );
  float w = dot( p.xz, tt );
  float fu = fwidth( u );
  float fv = fwidth( v );
  float fs = fwidth( s );
  float fw = fwidth( w );
  float k = 1.0;
  vec3 c = col;
  if ( !top ) {
    if ( id == 1.0 || id == 11.0 ) {
      // planches horizontales : lèvre éclairée, ombre portée sur la planche du dessous, aboutements
      float r = v / 0.36;
      float row = floor( r );
      float cc = u / 2.6 + tHash( vec2( row, 3.1 ) );
      float lw = fv / 0.36;
      float vis = pVis( lw );
      k = 1.0 + ( tHash( vec2( row, floor( cc ) ) ) - 0.5 ) * 0.12 * vis;
      k *= 1.0 + ( pL( r, lw ) * 0.1 - pH( r, lw ) * 0.32 ) * vis;
      k *= 1.0 - pL( cc, fu / 2.6 ) * 0.2 * vis;
    } else if ( id == 2.0 ) {
      // lames verticales et couvre-joints
      float cc = u / 0.5;
      float lw = fu / 0.5;
      float vis = pVis( lw );
      k = 1.0 + ( tHash( vec2( floor( cc ), 7.7 ) ) - 0.5 ) * 0.14 * vis;
      k *= 1.0 + ( pL( cc, lw ) * 0.12 - pH( cc, lw ) * 0.3 ) * vis;
    } else if ( id == 3.0 ) {
      // briques en quinconce, joints clairs, quelques briques recuites
      float r = v / 0.34;
      float row = floor( r );
      float cc = u / 0.72 + mod( row, 2.0 ) * 0.5;
      float j = tHash( vec2( floor( cc ), row ) );
      float vis = pVis( fv / 0.34 );
      k = 1.0 + ( j - 0.5 ) * 0.16 * vis - step( 0.92, j ) * 0.16 * vis;
      float m = max( pL( r, fv / 0.34 ), pL( cc, fu / 0.72 ) ) * vis;
      c = mix( c * k, mix( c, vec3( 0.3, 0.27, 0.22 ), 0.55 ), m * 0.85 );
      k = 1.0;
    } else if ( id == 4.0 || id == 12.0 ) {
      // moellons : assises irrégulières, joints sombres
      float r = v / 0.5;
      float row = floor( r );
      float len = 0.75 + tHash( vec2( row, 1.3 ) ) * 0.55;
      float cc = u / len + tHash( vec2( row, 2.9 ) );
      float j = tHash( vec2( floor( cc ), row + 0.5 ) );
      float vis = pVis( fv / 0.5 );
      k = 1.0 + ( j - 0.5 ) * 0.22 * vis;
      k *= 1.0 + pL( r, fv / 0.5 ) * 0.1 * vis;
      k *= 1.0 - max( pH( r, fv / 0.5 ), pL( cc, fu / len ) ) * 0.35 * vis;
    } else if ( id == 5.0 ) {
      // panneaux de béton, joints, coulures
      float r = v / 1.6;
      float cc = u / 2.8;
      float vis = pVis( fv / 1.6 * 3.0 );
      k = 1.0 + ( tHash( vec2( floor( cc ), floor( r ) ) ) - 0.5 ) * 0.07;
      k *= 1.0 - step( 0.62, tNoise( vec2( u * 2.2, v * 0.35 ) ) ) * 0.07;
      k *= 1.0 - max( pL( r, fv / 1.6 ), pL( cc, fu / 2.8 ) ) * 0.3 * vis;
    } else if ( id == 13.0 ) {
      // papier peint : rayures verticales et semis de petits motifs
      float cc = u / 0.24;
      float vis = pVis( fu / 0.24 );
      k = 1.0 + ( mod( floor( cc ), 2.0 ) * 0.07 - 0.035 ) * vis;
      float dot2 = step( 0.86, tHash( floor( vec2( u * 5.0, v * 5.0 ) ) ) ) * step( 0.5, fract( cc ) );
      k *= 1.0 - dot2 * 0.12 * vis;
    } else if ( id == 6.0 || id == 8.0 ) {
      // tôle ondulée : nervures verticales, coulures de rouille
      float cc = u / 0.34;
      float vis = pVis( fu / 0.34 );
      float f = fract( cc );
      k = 1.0 + ( f < 0.5 ? 0.07 : -0.08 ) * vis;
      float rs = step( 0.66, tNoise( vec2( floor( cc ) * 0.37, v * 0.45 + floor( cc ) * 1.7 ) ) );
      c = mix( c, c * vec3( 1.25, 0.72, 0.5 ), rs * 0.55 );
    }
  } else {
    if ( id == 7.0 || id == 10.0 ) {
      // tuiles / bardeaux : rangées le long de la pente, lèvre claire, ombre sous la rangée du dessus
      float P = id == 7.0 ? 0.38 : 0.32;
      float r = s / P;
      float row = floor( r );
      float cw = id == 7.0 ? 0.34 : 0.2 + 0.16 * tHash( vec2( row, 5.0 ) );
      float cc = w / cw + ( id == 7.0 ? mod( row, 2.0 ) * 0.5 : tHash( vec2( row, 1.0 ) ) );
      float j = tHash( vec2( floor( cc ), row ) );
      float lw = fs / P;
      float vis = pVis( lw );
      float tone = j < 0.33 ? -0.07 : j < 0.66 ? 0.0 : 0.06;
      k = 1.0 + ( tone + ( id == 10.0 ? ( j - 0.5 ) * 0.1 : 0.0 ) ) * vis;
      k *= 1.0 - step( 0.975, j ) * 0.3 * vis;
      k *= 1.0 + ( pH( r, lw ) * 0.14 - pL( r, lw ) * 0.34 ) * vis;
      k *= 1.0 - pL( cc, fw / cw ) * 0.16 * vis;
      // mousse et salissures par petites plaques
      float moss = step( 0.74, tNoise( p.xz * 0.9 + 11.0 ) ) * step( 0.5, tHash( vec2( floor( cc ), row ) + 3.3 ) );
      c = mix( c, c * vec3( 0.8, 0.94, 0.66 ), moss * 0.4 );
    } else if ( id == 8.0 ) {
      // bac acier : nervures perpendiculaires au faîtage, taches de rouille
      float cc = w / 0.55;
      float lw = fw / 0.55;
      float vis = pVis( lw );
      k = 1.0 + ( pL( cc, lw ) * 0.16 - pL( cc - lw, lw ) * 0.2 ) * vis;
      float rs = step( 0.64, tNoise( p.xz * 0.38 + 3.0 ) );
      c = mix( c, c * vec3( 1.3, 0.7, 0.45 ), rs * 0.5 );
    } else if ( id == 9.0 ) {
      // lés de bitume en quinconce, joints clairs, plaques de goudron
      float r = s / 1.1;
      float row = floor( r );
      float cc = w / 1.8 + mod( row, 2.0 ) * 0.5;
      float vis = pVis( fs / 1.1 * 3.0 );
      k = 1.0 + ( tHash( vec2( floor( cc ), row ) ) - 0.5 ) * 0.08;
      k *= 1.0 + max( pL( r, fs / 1.1 ), pL( cc, fw / 1.8 ) ) * 0.14 * vis;
      k *= 1.0 - step( 0.8, tNoise( p.xz * 1.7 ) ) * 0.1;
    } else if ( id == 11.0 ) {
      // platelage : planches le long de x, aboutements décalés
      float r = p.z / 0.32;
      float row = floor( r );
      float cc = p.x / 2.4 + tHash( vec2( row, 4.2 ) );
      float lw = fwidth( p.z ) / 0.32;
      float vis = pVis( lw );
      k = 1.0 + ( tHash( vec2( row, floor( cc ) ) ) - 0.5 ) * 0.14 * vis;
      k *= 1.0 - max( pL( r, lw ), pL( cc, fwidth( p.x ) / 2.4 ) ) * 0.3 * vis;
    } else if ( id == 14.0 ) {
      // carrelage en damier, joints fins
      float r = p.z / 0.45;
      float cc = p.x / 0.45;
      float lw = fwidth( p.z ) / 0.45;
      float vis = pVis( lw );
      float chk = mod( floor( r ) + floor( cc ), 2.0 );
      k = 1.0 + ( chk * 0.16 - 0.08 ) * vis;
      k *= 1.0 - max( pL( r, lw ), pL( cc, fwidth( p.x ) / 0.45 ) ) * 0.22 * vis;
    } else if ( id == 12.0 ) {
      // pavés en quinconce
      float r = p.z / 0.4;
      float row = floor( r );
      float cc = p.x / 0.46 + mod( row, 2.0 ) * 0.5;
      float j = tHash( vec2( floor( cc ), row ) );
      float lw = fwidth( p.z ) / 0.4;
      float vis = pVis( lw );
      k = 1.0 + ( j - 0.5 ) * 0.2 * vis;
      k *= 1.0 + ( pH( r, lw ) * 0.1 - max( pL( r, lw ), pL( cc, fwidth( p.x ) / 0.46 ) ) * 0.36 ) * vis;
    }
  }
  return c * k;
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
  float soft = uToonSoft;
  float lit = smoothstep( -0.03 - 0.1 * soft, 0.05 + 0.16 * soft, ndl );
  // pixel art : trois paliers (face au soleil, de biais, rasante) ; HD : modelé continu, à peine marqué
  float form = mix( 0.7, 0.86, smoothstep( 0.3, 0.38, ndl ) );
  form = mix( form, 1.0, smoothstep( 0.66, 0.74, ndl ) );
  float formSoft = 0.66 + 0.2 * smoothstep( 0.05, 0.45, ndl ) + 0.14 * smoothstep( 0.4, 0.85, ndl );
  form = mix( form, formSoft, soft );
  // ombres portées : bord franc ou pénombre filtrée
  float sh = mix( smoothstep( 0.4, 0.6, toonSunShadow ), smoothstep( 0.02, 0.98, toonSunShadow ), soft );
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
  c *= mix( q, l, uToonSoft ) / max( l, 1e-4 );
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
  const key = `toon:${opts.sway ?? ''}:${opts.swayAmp ?? 0}:${opts.ground ? 1 : 0}:${opts.snow === false ? 0 : 1}:${opts.water ? 1 : 0}:${opts.pattern ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    for (const [k, v] of Object.entries(toonUniforms)) u[k] = v;
    u.uSwayAmp = { value: opts.swayAmp ?? (opts.sway === 'local' ? 0.22 : 0.1) };
    if (opts.sway) shader.defines = { ...(shader.defines ?? {}), TOON_SWAY: 1, [opts.sway === 'local' ? 'TOON_SWAY_LOCAL' : 'TOON_SWAY_WORLD']: 1 };
    if (opts.ground) shader.defines = { ...(shader.defines ?? {}), TOON_GROUND: 1 };
    if (opts.snow !== false) shader.defines = { ...(shader.defines ?? {}), TOON_SNOW: 1 };
    if (opts.water) shader.defines = { ...(shader.defines ?? {}), TOON_WATER: 1 };
    if (opts.pattern) shader.defines = { ...(shader.defines ?? {}), TOON_PATTERN: 1 };

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
#ifdef TOON_PATTERN
attribute float aPat;
varying float vPat;
#endif
vec2 toonWind(vec2 p) {
  float w = sin(p.x * 0.31 + uTime * 1.9) * 0.55 + sin(p.y * 0.23 - uTime * 1.3 + p.x * 0.07) * 0.45;
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + p.x * 0.021 + p.y * 0.013);
  return uWind * (0.35 + 0.65 * w) * gust;
}`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `vTLocal = transformed;
#ifdef USE_INSTANCING
  // instances : coordonnées du monde (motifs à l'échelle, attachés à la pièce qui bouge)
  vTLocal = ( instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif
#ifdef TOON_PATTERN
vPat = aPat;
#endif
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
      .replace('#include <common>', `#include <common>\n${COMMON_FRAG}\n${opts.pattern ? PATTERN_FRAG : ''}`)
      .replace('#include <lights_lambert_pars_fragment>', LIGHTS_PARS)
      .replace('#include <lights_fragment_begin>', lightsFragmentBegin())
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 tWN = normalize( cross( dFdx( vTWorld ), dFdy( vTWorld ) ) );
#ifdef TOON_PATTERN
  float tEmissive = 0.0;
  vec3 tEmit = vec3( 0.0 );
  {
    float pid = floor( vPat + 0.5 );
    if ( pid > 99.5 ) {
      // surfaces lumineuses fusionnées dans la géométrie (lampes, écrans, vitres)
      vec3 base = diffuseColor.rgb;
      if ( pid > 100.5 ) {
        float isLit = step( 0.22, max( base.r, max( base.g, base.b ) ) );
        vec3 glass = mix( vec3( 0.014, 0.022, 0.035 ), uSkyTint, 0.28 );
        float f = fract( ( vTLocal.x + vTLocal.z ) * 0.62 - vTLocal.y * 0.55 );
        float streak = step( f, 0.13 ) + step( abs( f - 0.24 ), 0.03 ) * 0.7;
        glass += streak * mix( vec3( 0.05 ), uSkyTint * 0.35, 0.5 );
        base = mix( glass, base, isLit * uNightGlow );
      }
      tEmissive = 1.0;
      tEmit = base;
    } else if ( pid > 0.0 ) diffuseColor.rgb = toonPattern( diffuseColor.rgb, pid, vTLocal, normalize( cross( dFdx( vTLocal ), dFdy( vTLocal ) ) ) );
  }
#endif
#ifdef TOON_GROUND
  {
    vec2 gp = vTLocal.xz;
    float big = tNoise( gp * 0.11 );
    float mid = tNoise( gp * 0.9 + 3.7 );
    vec2 cell = floor( gp * 7.0 );
    float h = tHash( cell );
    float g = 1.0 + ( big - 0.5 ) * 0.12 + ( mid - 0.5 ) * 0.08;
    // pixel art : mouchetures au texel ; HD : grain continu (pas de petits carrés)
    float speck = step( 0.88, h ) * 0.09 - step( h, 0.08 ) * 0.09;
    float fine = ( tNoise( gp * 4.3 + 1.7 ) - 0.5 ) * 0.1 + ( tNoise( gp * 11.0 + 5.1 ) - 0.5 ) * 0.06;
    g += mix( speck, fine, uToonSoft );
    if ( uSand > 0.0 ) {
      // rides de sable sinueuses : crête claire, creux ombré
      float wv = gp.x * 0.85 + gp.y * 0.3 + tNoise( gp * 0.12 ) * 4.5;
      float fw = fwidth( wv );
      float r = fract( wv );
      g += ( step( r, fw ) * 0.08 - step( 1.0 - fw, r ) * 0.06 ) * uSand * ( 1.0 - smoothstep( 0.3, 0.5, fw ) );
    }
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
    // HD : reflets ronds plutôt que carrés
    sparkle *= mix( 1.0, 1.0 - smoothstep( 0.12, 0.3, length( fract( wp * 5.0 ) - 0.5 ) ), uToonSoft );
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
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `#ifdef TOON_PATTERN
if ( tEmissive > 0.5 ) outgoingLight = tEmit;
#endif
#include <opaque_fragment>`,
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

/**
 * Vitres : de jour, un verre sombre teinté par le ciel et barré de deux reflets obliques
 * (le reflet classique du pixel art) ; la nuit, les fenêtres éclairées (couleur de sommet vive)
 * s'allument. Modifie un MeshBasicMaterial.
 */
export function windowify<T extends THREE.MeshBasicMaterial>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNightGlow = toonUniforms.uNightGlow;
    shader.uniforms.uSkyTint = toonUniforms.uSkyTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWinP = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinP;\nuniform float uNightGlow;\nuniform vec3 uSkyTint;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 lit = diffuseColor.rgb;
  float isLit = step( 0.22, max( lit.r, max( lit.g, lit.b ) ) );
  vec3 glass = mix( vec3( 0.014, 0.022, 0.035 ), uSkyTint, 0.28 );
  float f = fract( ( vWinP.x + vWinP.z ) * 0.62 - vWinP.y * 0.55 );
  float streak = step( f, 0.13 ) + step( abs( f - 0.24 ), 0.03 ) * 0.7;
  glass += streak * mix( vec3( 0.05 ), uSkyTint * 0.35, 0.5 );
  diffuseColor.rgb = mix( glass, lit, isLit * uNightGlow );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'toon:window';
  mat.needsUpdate = true;
  return mat;
}

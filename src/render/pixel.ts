import * as THREE from 'three';
import { buildPaletteLut, LUT_SIZE } from './palette';

/**
 * Chaîne de rendu, en deux styles :
 * - « haute définition » (par défaut) : la scène est rendue à la résolution de l'écran,
 *   contours fins détectés sur la profondeur, halo doux, étalonnage, puis anticrénelage FXAA ;
 * - « pixel art » : rendu en basse résolution, contours épais, couleurs ramenées sur la
 *   palette de la DA (tramage ordonné), agrandissement au pixel près, décalé de la fraction
 *   de texel de la caméra pour un défilement sans scintillement.
 * Dans les deux cas :
 * 1. la scène est rendue avec une marge de quelques texels (secousses, décalage sous-texel) ;
 * 2. une passe détecte les contours et les arêtes saillantes (normales reconstruites depuis
 *    la profondeur), ajoute le halo des lumières et étalonne les couleurs ;
 * 3. l'image est ramenée à l'écran.
 */

export type RenderStyle = 'hd' | 'pixel';

export interface PixelSettings {
  style: RenderStyle;
  /** Pixel art : taille d'un pixel artistique en pixels physiques (0 = automatique). */
  pixelSize: number;
  /** Pixel art : 'paliers' (postérisation perceptuelle), 'stricte' (palette de la DA) ou 'aucune'. */
  palette: 'paliers' | 'stricte' | 'aucune';
  outlines: boolean;
  bloom: boolean;
  /** Haute définition : fraction de la résolution native rendue (1 = pleine). */
  resolution: number;
}

export interface Grading {
  /** Teinte ajoutée aux ombres (linéaire). */
  lift: THREE.Color;
  /** Multiplicateur des hautes lumières (linéaire). */
  gain: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
  bloom: number;
}

/** Marge (texels) autour de l'image visible : absorbe le décalage sous-texel et les secousses. */
export const PIXEL_MARGIN = 3;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tLut;
uniform vec2 uSize;
uniform vec2 uView;
uniform float uNear;
uniform float uFar;
uniform float uOutline;
uniform float uHighlight;
uniform float uDepthThresh;
uniform vec3 uOutlineTint;
uniform float uBloom;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uPalette;
uniform float uDither;
uniform vec2 uDitherOrigin;
uniform vec3 uFlash;
uniform float uHD;
uniform int uEdge;
varying vec2 vUv;

float linD( ivec2 p ) {
  float d = texelFetch( tDepth, p, 0 ).r;
  return uNear + d * ( uFar - uNear );
}
vec3 viewPos( ivec2 p ) {
  vec2 ndc = ( vec2( p ) + 0.5 ) / uSize * 2.0 - 1.0;
  return vec3( ndc * uView, - linD( p ) );
}
vec3 normalAt( ivec2 p ) {
  vec3 c = viewPos( p );
  vec3 r = viewPos( p + ivec2( 1, 0 ) ) - c;
  vec3 l = c - viewPos( p - ivec2( 1, 0 ) );
  vec3 u = viewPos( p + ivec2( 0, 1 ) ) - c;
  vec3 d = c - viewPos( p - ivec2( 0, 1 ) );
  vec3 dx = abs( r.z ) < abs( l.z ) ? r : l;
  vec3 dy = abs( u.z ) < abs( d.z ) ? u : d;
  return normalize( cross( dx, dy ) );
}
float normalEdge( vec3 n, ivec2 q, float d ) {
  vec3 nn = normalAt( q );
  float depthDiff = linD( q ) - d;
  float normalDiff = dot( n - nn, vec3( 0.6, 1.0, 0.4 ) );
  float normalIndicator = clamp( smoothstep( -0.01, 0.01, normalDiff ), 0.0, 1.0 );
  float depthIndicator = clamp( sign( depthDiff * 0.25 + 0.0025 ), 0.0, 1.0 );
  return ( 1.0 - dot( n, nn ) ) * depthIndicator * normalIndicator;
}
vec3 toSRGB( vec3 c ) {
  c = max( c, 0.0 );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
// OKLab (Björn Ottosson) : quantifier la luminance perçue garde les teintes intactes
vec3 linToOklab( vec3 c ) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  vec3 lms = pow( max( vec3( l, m, s ), 0.0 ), vec3( 1.0 / 3.0 ) );
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z );
}
vec3 oklabToLin( vec3 c ) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s );
}
float bayer4( ivec2 p ) {
  int i = ( p.y & 3 ) * 4 + ( p.x & 3 );
  int b[16] = int[16]( 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 );
  return ( float( b[i] ) + 0.5 ) / 16.0 - 0.5;
}

void main() {
  ivec2 p = ivec2( gl_FragCoord.xy );
  vec3 col = texelFetch( tColor, p, 0 ).rgb;

  // contours et arêtes
  if ( uOutline > 0.0 || uHighlight > 0.0 ) {
    float d = linD( p );
    if ( d < uFar * 0.995 ) {
      ivec2 ex = ivec2( uEdge, 0 );
      ivec2 ey = ivec2( 0, uEdge );
      float dU = linD( p + ey );
      float dD = linD( p - ey );
      float dL = linD( p - ex );
      float dR = linD( p + ex );
      float depthDiff = clamp( dU - d, 0.0, 2.0 ) + clamp( dD - d, 0.0, 2.0 ) + clamp( dL - d, 0.0, 2.0 ) + clamp( dR - d, 0.0, 2.0 );
      // pixel art : trait franc ; haute définition : trait fondu, que l'anticrénelage achève de lisser
      float depthEdge = uHD > 0.5 ? smoothstep( uDepthThresh * 0.45, uDepthThresh * 1.6, depthDiff ) : step( uDepthThresh, depthDiff );
      if ( depthEdge > 0.0 ) col = mix( col, col * 0.28 + uOutlineTint, uOutline * depthEdge );
      if ( uHighlight > 0.0 && depthEdge < 1.0 ) {
        vec3 n = normalAt( p );
        float ne = normalEdge( n, p + ey, d ) + normalEdge( n, p - ey, d ) + normalEdge( n, p + ex, d ) + normalEdge( n, p - ex, d );
        col *= 1.0 + uHighlight * smoothstep( 0.18, 0.4, ne ) * ( 1.0 - depthEdge );
      }
    }
  }

  // halo des sources lumineuses
  col += texture2D( tBloom, ( vec2( p ) + 0.5 ) / uSize ).rgb * uBloom;
  col += uFlash;

  // étalonnage (linéaire)
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, uSaturation );
  col = col * uGain + uLift * ( 1.0 - clamp( col, 0.0, 1.0 ) );

  vec2 v = vUv * 2.0 - 1.0;
  col *= 1.0 - uVignette * smoothstep( 0.6, 1.5, length( v * vec2( 1.0, 0.85 ) ) );
  float b = bayer4( p + ivec2( uDitherOrigin ) );
  vec3 s;
  if ( uPalette > 1.5 ) {
    // palette stricte de la DA (table 32³), tramage ordonné ancré sur le monde
    s = toSRGB( col );
    s = ( s - 0.5 ) * uContrast + 0.5;
    vec3 sd = clamp( s + b * uDither, 0.0, 1.0 );
    ivec3 q = ivec3( floor( sd * ${(LUT_SIZE - 1).toFixed(1)} + 0.5 ) );
    s = texelFetch( tLut, ivec2( q.r + q.b * ${LUT_SIZE}, q.g ), 0 ).rgb;
  } else if ( uPalette > 0.5 ) {
    // postérisation perceptuelle : luminance et saturation en paliers, teintes conservées
    vec3 lab = linToOklab( max( col, 0.0 ) );
    lab.x = ( lab.x - 0.5 ) * uContrast + 0.5;
    float steps = 15.0;
    lab.x = floor( lab.x * steps + 0.5 + b * uDither * steps ) / steps;
    float chroma = length( lab.yz );
    float hue = atan( lab.z, lab.y );
    chroma = floor( chroma * 40.0 + 0.5 ) / 40.0;
    hue = floor( hue / 6.2831853 * 48.0 + 0.5 ) / 48.0 * 6.2831853;
    lab.yz = chroma * vec2( cos( hue ), sin( hue ) );
    s = toSRGB( oklabToLin( lab ) );
  } else {
    s = toSRGB( col );
    s = ( s - 0.5 ) * uContrast + 0.5;
  }
  gl_FragColor = vec4( clamp( s, 0.0, 1.0 ), 1.0 );
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tColor, vUv ).rgb;
  float l = max( max( c.r, c.g ), c.b );
  float k = smoothstep( uThreshold, uThreshold + 0.25, l );
  gl_FragColor = vec4( c * k, 1.0 );
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tInput, vUv ).rgb * 0.227027;
  c += texture2D( tInput, vUv + uDir * 1.3846153846 ).rgb * 0.3162162162;
  c += texture2D( tInput, vUv - uDir * 1.3846153846 ).rgb * 0.3162162162;
  c += texture2D( tInput, vUv + uDir * 3.2307692308 ).rgb * 0.0702702703;
  c += texture2D( tInput, vUv - uDir * 3.2307692308 ).rgb * 0.0702702703;
  gl_FragColor = vec4( c, 1.0 );
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tPost;
uniform vec2 uOffset;
uniform float uScale;
uniform float uMargin;
uniform vec2 uPostSize;
uniform float uHD;

// FXAA (approche « lite » de T. Lottes) : adoucit les arêtes sans flouter les aplats
vec3 fxaa( vec2 uv, vec2 rcp ) {
  vec3 rgbNW = texture2D( tPost, uv + vec2( -1.0, -1.0 ) * rcp ).rgb;
  vec3 rgbNE = texture2D( tPost, uv + vec2( 1.0, -1.0 ) * rcp ).rgb;
  vec3 rgbSW = texture2D( tPost, uv + vec2( -1.0, 1.0 ) * rcp ).rgb;
  vec3 rgbSE = texture2D( tPost, uv + vec2( 1.0, 1.0 ) * rcp ).rgb;
  vec3 rgbM = texture2D( tPost, uv ).rgb;
  vec3 lw = vec3( 0.299, 0.587, 0.114 );
  float lNW = dot( rgbNW, lw );
  float lNE = dot( rgbNE, lw );
  float lSW = dot( rgbSW, lw );
  float lSE = dot( rgbSE, lw );
  float lM = dot( rgbM, lw );
  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
  if ( lMax - lMin < max( 0.0312, lMax * 0.125 ) ) return rgbM;
  vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
  float reduce = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 1.0 / 128.0 );
  float rcpMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + reduce );
  dir = clamp( dir * rcpMin, vec2( -8.0 ), vec2( 8.0 ) ) * rcp;
  vec3 a = 0.5 * ( texture2D( tPost, uv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb + texture2D( tPost, uv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
  vec3 b = a * 0.5 + 0.25 * ( texture2D( tPost, uv - dir * 0.5 ).rgb + texture2D( tPost, uv + dir * 0.5 ).rgb );
  float lB = dot( b, lw );
  return ( lB < lMin || lB > lMax ) ? a : b;
}

void main() {
  vec2 q = gl_FragCoord.xy / uScale + uMargin + uOffset;
  if ( uHD > 0.5 ) {
    vec2 rcp = 1.0 / uPostSize;
    gl_FragColor = vec4( fxaa( q * rcp, rcp ), 1.0 );
  } else {
    gl_FragColor = texelFetch( tPost, ivec2( floor( q ) ), 0 );
  }
}
`;

/** Plafond de pixels rendus en haute définition (au-delà, le gain ne vaut pas le coût). */
const HD_MAX_PIXELS = 3.8e6;

export class PixelPipeline {
  settings: PixelSettings = { style: 'hd', pixelSize: 0, palette: 'paliers', outlines: true, bloom: true, resolution: 1 };
  /** Style effectivement appliqué au dernier redimensionnement. */
  private appliedStyle: RenderStyle | null = null;
  readonly grading: Grading = {
    lift: new THREE.Color(0.018, 0.012, 0.045),
    gain: new THREE.Color(1, 1, 1),
    saturation: 1.05,
    contrast: 1.04,
    vignette: 0.22,
    bloom: 0.9,
  };
  /** Flash plein écran (dégâts, explosions), atténué chaque image. */
  readonly flash = new THREE.Color(0, 0, 0);
  /** Taille d'un pixel artistique (pixels physiques). */
  scale = 3;
  /** Résolution visible (texels), hors marge. */
  lowW = 1;
  lowH = 1;
  private rtScene: THREE.WebGLRenderTarget;
  private rtPost: THREE.WebGLRenderTarget;
  private rtBloomA: THREE.WebGLRenderTarget;
  private rtBloomB: THREE.WebGLRenderTarget;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private postMat: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private blackTex: THREE.DataTexture;

  constructor() {
    const depth = new THREE.DepthTexture(4, 4);
    depth.format = THREE.DepthStencilFormat;
    depth.type = THREE.UnsignedInt248Type;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture: depth,
      colorSpace: THREE.SRGBColorSpace,
    });
    this.rtPost = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const bloomOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtBloomA = new THREE.WebGLRenderTarget(4, 4, bloomOpts);
    this.rtBloomB = new THREE.WebGLRenderTarget(4, 4, bloomOpts);
    this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blackTex.needsUpdate = true;

    const lut = new THREE.DataTexture(buildPaletteLut(), LUT_SIZE * LUT_SIZE, LUT_SIZE);
    lut.minFilter = THREE.NearestFilter;
    lut.magFilter = THREE.NearestFilter;
    lut.needsUpdate = true;

    this.postMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tColor: { value: this.rtScene.texture },
        tDepth: { value: depth },
        tBloom: { value: this.blackTex },
        tLut: { value: lut },
        uSize: { value: new THREE.Vector2(4, 4) },
        uView: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 1 },
        uFar: { value: 400 },
        uOutline: { value: 0.85 },
        uHighlight: { value: 0.32 },
        uDepthThresh: { value: 0.4 },
        uOutlineTint: { value: new THREE.Color(0.012, 0.006, 0.02) },
        uBloom: { value: 0.9 },
        uLift: { value: this.grading.lift },
        uGain: { value: this.grading.gain },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uVignette: { value: 0.2 },
        uPalette: { value: 1 },
        uDither: { value: 0.0 },
        uDitherOrigin: { value: new THREE.Vector2() },
        uFlash: { value: this.flash },
        uHD: { value: 1 },
        uEdge: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tColor: { value: this.rtScene.texture }, uThreshold: { value: 0.72 } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tInput: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: UP_FRAG,
      uniforms: { tPost: { value: this.rtPost.texture }, uOffset: { value: new THREE.Vector2() }, uScale: { value: 3 }, uMargin: { value: PIXEL_MARGIN }, uPostSize: { value: new THREE.Vector2(4, 4) }, uHD: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
  }

  get hd(): boolean {
    return this.settings.style === 'hd';
  }

  /** Recalcule la résolution de rendu selon la taille de l'écran (pixels physiques). */
  resize(devW: number, devH: number): void {
    const hd = this.hd;
    if (hd) {
      // pleine résolution (ou une fraction), plafonnée pour les très grands écrans
      const res = Math.min(1, Math.max(0.4, this.settings.resolution), Math.sqrt(HD_MAX_PIXELS / Math.max(1, devW * devH)));
      this.scale = 1 / res;
    } else {
      const auto = Math.max(2, Math.round(devH / 250));
      this.scale = this.settings.pixelSize > 0 ? this.settings.pixelSize : auto;
    }
    this.lowW = Math.ceil(devW / this.scale);
    this.lowH = Math.ceil(devH / this.scale);
    const w = this.lowW + PIXEL_MARGIN * 2;
    const h = this.lowH + PIXEL_MARGIN * 2;
    this.rtScene.setSize(w, h);
    if (this.appliedStyle !== this.settings.style) {
      // le filtrage de l'image finale dépend du style : on recrée la cible
      this.appliedStyle = this.settings.style;
      this.rtPost.dispose();
      const f = hd ? THREE.LinearFilter : THREE.NearestFilter;
      this.rtPost = new THREE.WebGLRenderTarget(w, h, { minFilter: f, magFilter: f, depthBuffer: false });
      this.upMat.uniforms.tPost.value = this.rtPost.texture;
    }
    this.rtPost.setSize(w, h);
    // halo : quart de résolution en HD (plus large et plus doux), moitié en pixel art
    const div = hd ? 4 : 2;
    const bw = Math.max(1, Math.ceil(w / div));
    const bh = Math.max(1, Math.ceil(h / div));
    this.rtBloomA.setSize(bw, bh);
    this.rtBloomB.setSize(bw, bh);
    this.postMat.uniforms.uSize.value.set(w, h);
    this.postMat.uniforms.uHD.value = hd ? 1 : 0;
    // contours d'environ un pixel CSS, quelle que soit la densité de l'écran
    this.postMat.uniforms.uEdge.value = hd ? Math.max(1, Math.round(this.lowH / 1100)) : 1;
    this.upMat.uniforms.uScale.value = this.scale;
    this.upMat.uniforms.uPostSize.value.set(w, h);
    this.upMat.uniforms.uHD.value = hd ? 1 : 0;
  }

  /** Taille totale (texels) de la cible de rendu, marge comprise. */
  get renderWidth(): number {
    return this.lowW + PIXEL_MARGIN * 2;
  }

  get renderHeight(): number {
    return this.lowH + PIXEL_MARGIN * 2;
  }

  private pass(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.fsScene, this.fsCam);
  }

  /**
   * @param offset décalage sous-texel (et secousses) de la caméra, en texels
   * @param ditherOrigin coordonnées entières de la caméra sur la grille (ancre le tramage)
   * @param view demi-dimensions (monde) du cadre rendu, marge comprise
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera, offset: THREE.Vector2, ditherOrigin: THREE.Vector2, view: THREE.Vector2): void {
    const g = this.grading;
    const s = this.settings;
    renderer.setRenderTarget(this.rtScene);
    renderer.render(scene, camera);

    const bloom = s.bloom && g.bloom > 0;
    if (bloom) {
      this.pass(renderer, this.brightMat, this.rtBloomA);
      const bw = this.rtBloomA.width;
      const bh = this.rtBloomA.height;
      // deux passes de flou en HD : un halo large et doux
      for (let i = 0; i < (this.hd ? 2 : 1); i++) {
        const k = 1 + i * 1.5;
        this.blurMat.uniforms.tInput.value = this.rtBloomA.texture;
        this.blurMat.uniforms.uDir.value.set(k / bw, 0);
        this.pass(renderer, this.blurMat, this.rtBloomB);
        this.blurMat.uniforms.tInput.value = this.rtBloomB.texture;
        this.blurMat.uniforms.uDir.value.set(0, k / bh);
        this.pass(renderer, this.blurMat, this.rtBloomA);
      }
    }

    const u = this.postMat.uniforms;
    u.tBloom.value = bloom ? this.rtBloomA.texture : this.blackTex;
    u.uBloom.value = bloom ? g.bloom : 0;
    u.uView.value.copy(view);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const hd = this.hd;
    u.uOutline.value = s.outlines ? (hd ? 0.62 : 0.85) : 0;
    u.uHighlight.value = s.outlines ? (hd ? 0.18 : 0.32) : 0;
    u.uSaturation.value = g.saturation;
    u.uContrast.value = g.contrast;
    u.uVignette.value = g.vignette;
    u.uPalette.value = hd ? 0 : s.palette === 'stricte' ? 2 : s.palette === 'paliers' ? 1 : 0;
    u.uDither.value = !hd && s.palette === 'stricte' ? 0.03 : 0.0;
    u.uDitherOrigin.value.set(((ditherOrigin.x % 4) + 4) % 4, ((ditherOrigin.y % 4) + 4) % 4);
    this.pass(renderer, this.postMat, this.rtPost);

    this.upMat.uniforms.uOffset.value.copy(offset);
    this.pass(renderer, this.upMat, null);
  }
}

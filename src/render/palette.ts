/**
 * Palette de la direction artistique « Rouille et braises » : un monde de cendre
 * froide traversé par la chaleur des lampes, du charbon et de la rouille.
 * Chaque rampe glisse en teinte (ombres vers le violet-bleu, lumières vers le jaune),
 * comme on le ferait à la main en pixel art.
 */
export const PALETTE: number[] = [
  // cendres (neutres chauds) : de l'ombre profonde au blanc d'os
  0x0f0b12, 0x1c1621, 0x2b2430, 0x3e3540, 0x554a52, 0x6f6466, 0x8c8180, 0xa99e98, 0xc7bdb3, 0xe4dccf, 0xf6f1e7,
  // acier et béton (gris bleutés)
  0x1b2333, 0x283348, 0x3a4a5f, 0x546a7d, 0x7790a0, 0xa2b7c2, 0xcfdde2,
  // pierre et gravier (gris tièdes)
  0x4a4644, 0x605b56, 0x78726a, 0x938b80, 0xb0a79a,
  // rouille et sang
  0x3b1418, 0x5e1e1c, 0x872c22, 0xb24427, 0xd46a3a,
  // braises, lampes, soleil
  0x6b3d16, 0x9c5a1e, 0xcf8a2a, 0xf0b440, 0xffdc6e, 0xfff3b0,
  // bois et terre
  0x2e1d16, 0x46301f, 0x604129, 0x7d5735, 0x9d7449, 0xbf9663,
  // sable
  0xc9a46c, 0xdcc08a, 0xeedcb0,
  // herbes et forêts
  0x13261b, 0x1e3a24, 0x2c5130, 0x3e6a37, 0x5a8540, 0x7ea24c, 0xa8be5c, 0xd0d68a,
  // mousses et olives (plaines, marais)
  0x262c16, 0x3a4320, 0x515c2c, 0x6b7739, 0x87914a, 0xa7ad64,
  // marais et eaux vertes
  0x10302f, 0x1b4a48, 0x2a6a62, 0x46907f, 0x74b8a0,
  // eau, ciel, nuit
  0x141c3a, 0x1f2d5c, 0x2f4a86, 0x4a6fb0, 0x6f9bd2, 0xa3c8ec,
  // nuit (gris-bleus pour un sol lisible au clair de lune)
  0x161a2c, 0x20263c, 0x2c344e, 0x3b4562, 0x4e5a7a, 0x6a7898, 0x8d9cbc,
  // violets du crépuscule
  0x2a1a3a, 0x42295a, 0x614085, 0x8a62ad,
  // zone irradiée
  0x3c5a10, 0x6c9a1c, 0xa8d830, 0xd8ff6a,
  // peaux
  0x7a4a3c, 0xa8684e, 0xd39a78, 0xf0c8a0,
  // glace, boucliers, électricité
  0x7fe0ff, 0xc8f6ff,
];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB (0..1) → OKLab. */
function oklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export const LUT_SIZE = 32;

/**
 * Table de correspondance 32×32×32 → couleur de palette la plus proche (OKLab),
 * rangée en 2D (largeur 32×32, hauteur 32) : x = r + b·32, y = g. Valeurs sRGB.
 */
export function buildPaletteLut(palette: number[] = PALETTE): Uint8Array {
  const N = LUT_SIZE;
  const pal = palette.map((hex) => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    return { rgb: [hex >> 16 & 255, hex >> 8 & 255, hex & 255], lab: oklab(r, g, b) };
  });
  const data = new Uint8Array(N * N * N * 4);
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        const [L, A, B] = oklab(ri / (N - 1), gi / (N - 1), bi / (N - 1));
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < pal.length; k++) {
          const p = pal[k].lab;
          // la luminosité compte un peu plus que la teinte : les volumes restent lisibles
          const d = (p[0] - L) * (p[0] - L) * 1.3 + (p[1] - A) * (p[1] - A) + (p[2] - B) * (p[2] - B);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        const o = (gi * N * N + bi * N + ri) * 4;
        const c = pal[best].rgb;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
  }
  return data;
}

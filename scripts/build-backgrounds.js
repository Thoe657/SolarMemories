// Generator for the baked static background images used by public/js/scene.js.
// Not run at app startup or by `npm start` — only needed again when you want to
// re-tune the sky. Requires the `canvas` and `sharp` devDependencies, neither of
// which anything `npm start` runs ever imports.
//
// Usage:
//   node scripts/build-backgrounds.js              redraw all variants (PNG + WebP)
//   node scripts/build-backgrounds.js solar        redraw one family
//   node scripts/build-backgrounds.js universe-2   redraw one variant
//   node scripts/build-backgrounds.js --reencode   re-encode the PNGs already on
//                                                  disk to WebP, without redrawing
//
// THE ART IS DETERMINISTIC (Plan 4 Phase 3). Every random number below comes
// from a mulberry32 PRNG seeded per variant, so a plain run reproduces exactly
// the art that is on disk. Before Phase 3 this routine used Math.random(), so
// re-running it invented new skies and there was no way back to the shipped
// ones — which meant the sky could not be re-tuned, only replaced. If you edit
// a number in FAMILIES or VARIANTS the art changes on purpose; if you edit
// nothing, the bytes come out the same.
//
// --reencode dates from the Plan 3 Phase 7 job (decode each PNG, write it back
// as alpha-free WebP). It is redundant for a normal redraw, which writes both
// containers itself, but it is still the way to change WEBP_OPTIONS without
// redrawing 6 x 4096x2048 of canvas.
//
// WebP rather than PNG because it is a fraction of the bytes. Both are written;
// scene.js loads the WebP. The PNGs stay in the repo as the lossless source the
// re-encode reads and the guard measures against.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const sharp = require('sharp');

const BG_W = 4096, BG_H = 2048;
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'backgrounds');

// ---------------------------------------------------------------------------
// The guard (Plan 4, plan-wide acceptance criteria 2 and 3)
// ---------------------------------------------------------------------------
// "Vibrant" has a ceiling and it is written down here rather than in a log line.
//
// Criterion 2 says a content card holds a luminance contrast ratio of at least
// ~3:1 against the sky behind it. The `solar` card is cream (#fffaf0, relative
// luminance ~0.97) and is never the binding case. The `universe` card is a cool
// graphite in the 0.20-0.30 range (Phase 5); take the bottom of that range,
// because a ceiling derived from the darkest plausible card is the only one that
// cannot be invalidated by Phase 5 picking a slightly darker graphite.
//
// Rearranging the WCAG-style ratio (L1 + 0.05) / (L2 + 0.05) >= 3 for the sky
// gives the number the art has to stay under.
const UNIVERSE_CARD_LUMINANCE = 0.20;   // darkest graphite Phase 5 may choose
const MIN_CARD_SKY_CONTRAST = 3;        // plan-wide acceptance criterion 2
const SKY_FIELD_LUMINANCE_CEILING =
  (UNIVERSE_CARD_LUMINANCE + 0.05) / MIN_CARD_SKY_CONTRAST - 0.05;   // = 0.0333

// The ceiling binds on *field* luminance — the image box-averaged into
// FIELD_BLOCK x FIELD_BLOCK cells — not on raw pixels. A card spans thousands of
// pixels; what it competes with is the local average brightness behind it, and a
// 3px star cannot out-shout a card however bright that one pixel is. The
// raw-pixel p99 is printed too, but it measures the star field, not the nebula:
// stars cover ~3% of the image and therefore own the top percentile outright
// (measured on the pre-Phase-3 skies, whose nebula is barely present at all, the
// raw p99 was 0.28 — entirely stars).
//
// 128 is card scale, not an arbitrary blur. The image is a 4096x2048
// equirectangular sphere map, so 1 degree is ~11px, and a card subtends roughly
// 10 degrees of the 55-degree FOV. Smaller blocks measure individual stars
// again: on the same pre-Phase-3 skies the p99 runs 0.178 at 8px, 0.075 at 32px
// and 0.026 at 128px, and only the last of those is a statement about the sky
// rather than about one bright star.
const FIELD_BLOCK = 128;

// Saturation is meaningless on a pixel that is essentially black (rgb(1,0,2) is
// "fully saturated" and invisible), so the mean is taken over pixels with any
// channel at or above this 8-bit value.
const SAT_FLOOR = 12;

// Mean saturation is the number the plan names, but on its own it hid the actual
// defect: the pre-Phase-3 skies scored 0.53 mean saturation while being visually
// colourless, because HSV saturation ignores how dark the pixel is — rgb(13,10,22)
// is "54% saturated" and indistinguishable from black. Mean chroma ((max-min)/255,
// over every pixel) is the honest companion: those skies scored 0.021, i.e. about
// five 8-bit levels of colour separation across the whole image. Both are printed.
//
// Pre-Phase-3 baseline, for comparing any future tuning against:
//   nebula-1  sat 0.536  chroma 0.0208  field p99 0.0256
//   nebula-2  sat 0.525  chroma 0.0201  field p99 0.0258
//   nebula-3  sat 0.550  chroma 0.0207  field p99 0.0255

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = (rng, a, b) => a + rng() * (b - a);
const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

function weightedIndex(rng, weights) {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ---------------------------------------------------------------------------
// Colour helpers. Palettes are written as 'r,g,b' strings and each variant
// rotates its whole family palette by a few degrees of hue — that is what keeps
// three variants reading as siblings while still being distinguishable.
// ---------------------------------------------------------------------------
function hueShift(str, deg) {
  const [r, g, b] = str.split(',').map((n) => Number(n) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return seg.map((v) => Math.round(Math.min(255, Math.max(0, (v + m) * 255))));
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------
// A plumper falloff than a straight two-stop gradient: the old script's blobs
// faded linearly from the centre, which reads as a cone of haze. These stops
// hold a core, then drop away fast, which reads as a cloud with a bright heart.
const CLOUD_STOPS = [[0, 1], [0.24, 0.78], [0.48, 0.42], [0.72, 0.15], [1, 0]];
const DUST_STOPS = [[0, 1], [0.45, 0.55], [1, 0]];

// The image is an equirectangular sphere map, so x wraps. Anything painted near
// an edge is painted again one width over, otherwise there is a visible seam
// behind the viewer. (The old script did not do this; it just kept its blobs
// away from the edges, which also kept them away from a third of the sky.)
function paintCloud(ctx, { x, y, r, rgb, alpha, aspect = 1, angle = 0, stops = CLOUD_STOPS }) {
  const reach = r * Math.max(aspect, 1);
  for (const dx of [-BG_W, 0, BG_W]) {
    const cx = x + dx;
    if (cx + reach < 0 || cx - reach > BG_W) continue;
    ctx.save();
    ctx.translate(cx, y);
    ctx.rotate(angle);
    ctx.scale(aspect, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [t, k] of stops) {
      g.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * k).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
}

// Even coverage without a visible grid: one item per jittered cell of a coarse
// grid, cells chosen without replacement. Purely random placement clumps, and a
// clumped sky is the flat sky with extra steps.
function scatter(rng, count, yRange) {
  const cols = Math.max(1, Math.round(Math.sqrt(count * (BG_W / BG_H)) ));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const [y0, y1] = yRange;
  return cells.slice(0, count).map(([c, r]) => ({
    x: ((c + rand(rng, 0.15, 0.85)) / cols) * BG_W,
    y: y0 + ((r + rand(rng, 0.15, 0.85)) / rows) * (y1 - y0),
  }));
}

function paintLayer(ctx, rng, spec, hue, gain = 1) {
  if (!spec || !spec.count) return;
  const pts = scatter(rng, spec.count, spec.y);
  for (const p of pts) {
    paintCloud(ctx, {
      x: p.x,
      y: p.y,
      r: rand(rng, spec.r[0], spec.r[1]),
      rgb: hueShift(pick(rng, spec.palette), hue),
      alpha: rand(rng, spec.alpha[0], spec.alpha[1]) * gain,
      aspect: rand(rng, spec.aspect[0], spec.aspect[1]),
      angle: spec.angle
        ? rand(rng, spec.angle[0], spec.angle[1]) * (Math.PI / 180)
        : rng() * Math.PI,
    });
  }
}

// Dust lanes, drawn with `multiply` so they darken whatever they cross. This is
// what stops a widened palette turning into uniform haze: contrast inside the
// nebula comes from the dark lanes, not from the space around it.
function paintDust(ctx, rng, spec, hue) {
  if (!spec || !spec.count) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const pts = scatter(rng, spec.count, spec.y);
  for (const p of pts) {
    paintCloud(ctx, {
      x: p.x,
      y: p.y,
      r: rand(rng, spec.r[0], spec.r[1]),
      rgb: hueShift(pick(rng, spec.palette), hue),
      alpha: rand(rng, spec.alpha[0], spec.alpha[1]),
      aspect: rand(rng, spec.aspect[0], spec.aspect[1]),
      angle: rng() * Math.PI,
      stops: DUST_STOPS,
    });
  }
  ctx.restore();
}

// Star colour temperature, roughly a blackbody ramp from O/B blue through white
// to M orange. The old script drew all 5600 stars at rgba(255,245,225) — one
// warm white — which is half of why the sky read flat. Each family weights the
// ramp differently: `solar` warm-biased, `universe` cool-biased.
const STAR_TINTS = [
  [155, 176, 255],   // O/B blue
  [190, 208, 255],   // A blue-white
  [228, 236, 255],   // A/F cool white
  [252, 248, 242],   // F/G white
  [255, 232, 200],   // G/K warm white
  [255, 205, 155],   // K amber
  [255, 168, 128],   // M orange
];

function paintStars(ctx, rng, spec, band) {
  const w = spec.tintWeights;
  for (let i = 0; i < spec.count; i++) {
    let x, y;
    if (band && rng() < band.fraction) {
      // stars gathered along the galactic band, gaussian across it
      const t = rng() * BG_W;
      const g = (rng() + rng() + rng() + rng() - 2) * 0.5;   // ~N(0,0.5)
      x = t;
      y = band.centre + Math.tan(band.tilt) * (t - BG_W / 2) + g * band.spread;
      if (y < 0 || y > BG_H) { y = rand(rng, 0, BG_H); }
    } else {
      x = rng() * BG_W;
      y = rng() * BG_H;
    }
    const big = rng() < 0.11;
    const size = big ? rand(rng, 2.4, 5.6) : rand(rng, 0.7, 3.0);
    const alpha = rand(rng, 0.22, 0.80) * (big ? 1 : 0.92);
    const [r, g, b] = STAR_TINTS[weightedIndex(rng, w)];
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintBrightStars(ctx, rng, spec) {
  for (let i = 0; i < spec.bright; i++) {
    const x = rng() * BG_W;
    const y = rand(rng, 60, 1560);
    const [r, g, b] = STAR_TINTS[weightedIndex(rng, spec.tintWeights)];
    const rgb = [r, g, b];
    const halo = rand(rng, 20, 34);
    paintCloud(ctx, { x, y, r: halo, rgb, alpha: 0.85 });
    // faint diffraction cross — two thin elongated glows, near-free at ~26 stars
    const spike = rand(rng, 56, 104);
    paintCloud(ctx, { x, y, r: spike, rgb, alpha: 0.16, aspect: 0.075, angle: 0 });
    paintCloud(ctx, { x, y, r: spike, rgb, alpha: 0.16, aspect: 0.075, angle: Math.PI / 2 });
    ctx.fillStyle = `rgba(${Math.min(255, r + 20)},${Math.min(255, g + 14)},${Math.min(255, b + 10)},0.95)`;
    ctx.beginPath();
    ctx.arc(x, y, rand(rng, 4.4, 6.4), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// The two families
// ---------------------------------------------------------------------------
// One recipe per theme; three variants each, differing only by seed, a hue
// rotation and the tilt of the galactic band. That is deliberate — "one
// consistent family per theme" is the property the script was built for, and
// generating all three from the same recipe makes it structural rather than a
// matter of hand-matching three palettes.
//
// `solar` is warm: amber, rose, plum, with cool blue only as the far depth.
// `universe` is cool and deeper, with more and longer bands.
const FAMILIES = {
  solar: {
    prefix: 'nebula',                              // shipping filenames, unchanged
    base: ['#000000', '#0a0610', '#050208'],
    depth: {                                       // the large-scale depth layer
      count: 4, y: [340, 1720], r: [1500, 2300], alpha: [0.09, 0.13],
      aspect: [1.3, 2.2],
      palette: ['138,60,40', '116,40,96', '82,44,140', '48,62,112'],
    },
    clouds: {
      count: 8, y: [280, 1780], r: [560, 1080], alpha: [0.16, 0.24],
      aspect: [1.0, 1.7],
      palette: ['224,96,40', '212,64,96', '186,44,138', '132,48,176',
                '96,52,168', '60,78,152'],
    },
    bands: {
      count: 5, y: [380, 1660], r: [460, 820], alpha: [0.08, 0.14],
      aspect: [3.0, 5.2], angle: [-26, 26],
      palette: ['236,132,60', '206,72,120', '134,68,170'],
    },
    dust: {
      count: 7, y: [300, 1760], r: [420, 900], alpha: [0.38, 0.66],
      aspect: [1.6, 3.2],
      palette: ['26,14,20', '18,12,26', '30,18,14'],
    },
    stars: { count: 6000, bright: 26, tintWeights: [0.04, 0.09, 0.14, 0.27, 0.24, 0.15, 0.07] },
    band: { centre: 980, spread: 270, fraction: 0.18, glow: '150,90,130', glowAlpha: 0.038 },
  },

  universe: {
    prefix: 'universe',
    base: ['#000000', '#04070e', '#020409'],
    depth: {
      count: 4, y: [340, 1720], r: [1600, 2400], alpha: [0.10, 0.14],
      aspect: [1.5, 2.6],
      palette: ['28,66,128', '52,42,142', '20,88,112', '86,36,124'],
    },
    clouds: {
      count: 9, y: [280, 1780], r: [540, 1060], alpha: [0.18, 0.28],
      aspect: [1.1, 1.9],
      palette: ['36,120,196', '52,84,204', '96,56,192', '20,140,148',
                '146,48,150', '24,74,170'],
    },
    bands: {                                       // "more banded": more, longer
      count: 8, y: [360, 1680], r: [440, 800], alpha: [0.10, 0.16],
      aspect: [4.5, 8.5], angle: [-16, 16],
      palette: ['48,140,204', '80,68,206', '28,150,158', '126,56,172'],
    },
    dust: {
      count: 8, y: [300, 1760], r: [420, 940], alpha: [0.40, 0.68],
      aspect: [1.8, 3.6],
      palette: ['12,16,28', '10,20,26', '20,12,30'],
    },
    stars: { count: 6400, bright: 24, tintWeights: [0.17, 0.24, 0.23, 0.19, 0.10, 0.05, 0.02] },
    band: { centre: 1010, spread: 230, fraction: 0.24, glow: '70,100,180', glowAlpha: 0.055 },
  },
};

// seed / hue rotation / band tilt per variant. Change a seed and you get a
// different sky in the same family; change nothing and you get this one back.
//
// `gain` scales that variant's nebula alphas, and exists because a hue rotation
// is not luminance-neutral: green carries 0.7152 of relative luminance, so
// rotating a blue palette a few degrees towards cyan makes the same alpha
// measurably brighter. universe-2 came out at field p99 0.0387 against a 0.0333
// ceiling for exactly that reason; 0.86 is what brings it back inside. Prefer
// adjusting gain over re-rolling the seed — the seed is what makes the art
// reproducible.
const VARIANTS = [
  { family: 'solar',    index: 1, seed: 0x501a2101, hue: 0,   tilt: -7,  gain: 1 },
  { family: 'solar',    index: 2, seed: 0x501a2202, hue: -14, tilt: 5,   gain: 1 },
  { family: 'solar',    index: 3, seed: 0x501a2303, hue: 17,  tilt: -13, gain: 1 },
  { family: 'universe', index: 1, seed: 0x01ce3401, hue: 0,   tilt: -11, gain: 1 },
  { family: 'universe', index: 2, seed: 0x01ce3502, hue: -12, tilt: 8,   gain: 0.74 },
  { family: 'universe', index: 3, seed: 0x01ce3603, hue: 15,  tilt: -4,  gain: 1 },
].map((v) => ({ ...v, name: `${FAMILIES[v.family].prefix}-${v.index}` }));

// ---------------------------------------------------------------------------
function renderVariant(variant) {
  const fam = FAMILIES[variant.family];
  const rng = mulberry32(variant.seed);
  const hue = variant.hue;
  const canvas = createCanvas(BG_W, BG_H);
  const ctx = canvas.getContext('2d');

  // Opaque base. Nothing after this point clears or erases, so the output has
  // alpha 255 everywhere — Plan 3 Phase 7 re-encodes these alpha-free and the
  // art must not depend on transparency compositing. Asserted in measure().
  const grad = ctx.createLinearGradient(0, 0, 0, BG_H);
  grad.addColorStop(0, fam.base[0]);
  grad.addColorStop(0.5, fam.base[1]);
  grad.addColorStop(1, fam.base[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BG_W, BG_H);

  const band = { ...fam.band, tilt: variant.tilt * (Math.PI / 180) };
  const gain = variant.gain ?? 1;

  // 1. far depth — the large-scale layer the old script had no equivalent of
  paintLayer(ctx, rng, fam.depth, hue, gain);
  // 2. the galactic band's diffuse glow
  paintCloud(ctx, {
    x: BG_W / 2, y: band.centre, r: BG_H * 0.44, rgb: hueShift(band.glow, hue),
    alpha: band.glowAlpha * gain, aspect: 4.6, angle: band.tilt,
  });
  // 3. mid-scale nebula clouds, at 2-4x the alpha the old script used
  paintLayer(ctx, rng, fam.clouds, hue, gain);
  // 4. filaments / banding
  paintLayer(ctx, rng, fam.bands, hue, gain);
  // 5. dark dust lanes (multiply) for internal contrast
  paintDust(ctx, rng, fam.dust, hue);
  // 6. the star field, colour-temperature varied and gathered on the band
  paintStars(ctx, rng, fam.stars, band);
  paintBrightStars(ctx, rng, fam.stars);

  return canvas;
}

// ---------------------------------------------------------------------------
// The numeric guard: mean saturation and 99th-percentile luminance per variant.
// ---------------------------------------------------------------------------
const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const relLum = (r, g, b) =>
  0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b];

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function measure(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, BG_W, BG_H);
  const lum = new Float32Array(BG_W * BG_H);
  let satSum = 0, satCount = 0, chromaSum = 0, opaque = true;

  for (let i = 0, p = 0; p < lum.length; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] !== 255) opaque = false;
    lum[p] = relLum(r, g, b);
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    chromaSum += (max - min) / 255;
    if (max >= SAT_FLOOR) {
      satSum += (max - min) / max;
      satCount++;
    }
  }

  // raw-pixel p99 (dominated by stars — reported, not the binding number)
  const sorted = Float32Array.from(lum).sort();
  const p99 = percentile(sorted, 0.99);

  // field p99: box-average into FIELD_BLOCK cells, in linear light, which is
  // what a card-sized object actually sits against.
  const fw = Math.floor(BG_W / FIELD_BLOCK), fh = Math.floor(BG_H / FIELD_BLOCK);
  const field = new Float32Array(fw * fh);
  const inv = 1 / (FIELD_BLOCK * FIELD_BLOCK);
  for (let by = 0; by < fh; by++) {
    for (let bx = 0; bx < fw; bx++) {
      let s = 0;
      for (let y = 0; y < FIELD_BLOCK; y++) {
        const row = (by * FIELD_BLOCK + y) * BG_W + bx * FIELD_BLOCK;
        for (let x = 0; x < FIELD_BLOCK; x++) s += lum[row + x];
      }
      field[by * fw + bx] = s * inv;
    }
  }
  const fsorted = Float32Array.from(field).sort();

  return {
    meanSat: satCount ? satSum / satCount : 0,
    meanChroma: chromaSum / lum.length,
    litFraction: satCount / lum.length,
    p99,
    fieldP99: percentile(fsorted, 0.99),
    fieldMax: fsorted[fsorted.length - 1],
    opaque,
  };
}

// Contrast of a card of luminance `l` against a sky patch of luminance `s`.
const contrast = (l, s) => (Math.max(l, s) + 0.05) / (Math.min(l, s) + 0.05);

function reportGuard(name, m) {
  const pass = m.fieldP99 <= SKY_FIELD_LUMINANCE_CEILING;
  if (!pass) process.exitCode = 1;
  if (!m.opaque) { console.log(`${name}: NOT OPAQUE — do not ship`); process.exitCode = 1; }
  console.log(
    `  ${name.padEnd(11)} sat ${m.meanSat.toFixed(3)}  chroma ${m.meanChroma.toFixed(4)}`
    + `  lum p99 ${m.p99.toFixed(4)} (raw, star-dominated)`
  );
  console.log(
    `  ${''.padEnd(11)} field p99 ${m.fieldP99.toFixed(4)} / ceiling ${SKY_FIELD_LUMINANCE_CEILING.toFixed(4)}`
    + `  field max ${m.fieldMax.toFixed(4)}`
    + `  graphite card ${contrast(UNIVERSE_CARD_LUMINANCE, m.fieldP99).toFixed(2)}:1`
    + `  cream card ${contrast(0.97, m.fieldP99).toFixed(1)}:1`
    + `  ${pass ? 'PASS' : 'OVER CEILING'}`
  );
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
// Lossy q95, with the alpha channel dropped. Every one of these skies is fully
// opaque, so the channel was three bytes of nothing per pixel. effort 6 is
// sharp's maximum.
//
// WHY NOT LOSSLESS, given Plan 3 Phase 7 chose exactly that. Phase 7's job was
// to shrink the skies *already on disk* without changing them, so "lossless"
// there was the point of the exercise: the acceptance test was that the WebP
// decoded bit-for-bit back to the shipping PNG. Plan 4 Phase 3 replaces the art
// outright — these pixels are generated here, from the seeds in VARIANTS, and
// there is no original for them to stay faithful to. The only question left is
// whether the encode is visually sound, and q95 on smooth nebula gradients is.
//
// It is also *smaller than the skies Phase 7 shipped* (~550kb each), so that
// phase's asset win is kept rather than reversed. Lossless would have cost
// ~1.9MB per sky — near-uniform black compressed beautifully, art with real
// colour in it does not. Measured on nebula-1.png:
//
//   { lossless: true,  effort: 6 }              1917kb
//   { nearLossless: true, quality: 60 }         1875kb   (near-lossless barely helps)
//   { quality: 95 }                              400kb   <- current
//   { quality: 90 }                              258kb
//
// Banding on a smooth gradient is what lossy actually risks here, so it was
// checked rather than assumed: decoded against the source PNG the deltas are
// tiny and, more to the point, the count of distinct luminance levels in a flat
// nebula region barely moves. Re-check that if the quality number is ever
// lowered — file size is not the only axis this constant moves.
const WEBP_OPTIONS = { quality: 95, effort: 6 };

function toWebp(input) {
  return sharp(input).removeAlpha().webp(WEBP_OPTIONS).toBuffer();
}

async function reencode(variants) {
  for (const variant of variants) {
    const pngPath = path.join(OUT_DIR, `${variant.name}.png`);
    if (!fs.existsSync(pngPath)) {
      console.log(`skipped ${variant.name}: no PNG on disk to re-encode`);
      continue;
    }
    const before = fs.statSync(pngPath).size;
    const buffer = await toWebp(pngPath);
    const outPath = path.join(OUT_DIR, `${variant.name}.webp`);
    fs.writeFileSync(outPath, buffer);

    // Decode both back to raw RGB and compare. Under a lossless WEBP_OPTIONS
    // this is an assertion — lossless has to mean lossless, and this is the sky
    // of a keepsake app, so "roughly the same" is not the deal. Under a lossy
    // one it is a *measurement* instead: the encode is expected to differ, and
    // failing the run for it would make --reencode useless rather than safe.
    const [a, b] = await Promise.all([
      sharp(pngPath).removeAlpha().raw().toBuffer(),
      sharp(outPath).removeAlpha().raw().toBuffer(),
    ]);
    const size =
      `${variant.name}: ${(before / 1024).toFixed(0)}kb png -> ${(buffer.length / 1024).toFixed(0)}kb webp`
      + ` (${Math.round((1 - buffer.length / before) * 100)}% smaller)`;

    if (WEBP_OPTIONS.lossless) {
      const identical = a.equals(b);
      console.log(`${size}, pixels ${identical ? 'IDENTICAL' : 'DIFFER -- do not ship'}`);
      if (!identical) process.exitCode = 1;
    } else {
      let maxDelta = 0, sum = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDelta) maxDelta = d;
        sum += d;
      }
      console.log(`${size}, lossy delta max ${maxDelta}/255, mean ${(sum / a.length).toFixed(4)}`);
    }
  }
}

async function redraw(variants) {
  console.log(
    `ceiling: field luminance p99 <= ${SKY_FIELD_LUMINANCE_CEILING.toFixed(4)}`
    + ` (${MIN_CARD_SKY_CONTRAST}:1 against a ${UNIVERSE_CARD_LUMINANCE} graphite card)\n`
  );
  for (const variant of variants) {
    const canvas = renderVariant(variant);
    reportGuard(variant.name, measure(canvas));

    const png = canvas.toBuffer('image/png', { compressionLevel: 9 });
    fs.writeFileSync(path.join(OUT_DIR, `${variant.name}.png`), png);
    const buffer = await toWebp(png);
    fs.writeFileSync(path.join(OUT_DIR, `${variant.name}.webp`), buffer);
    console.log(
      `  ${''.padEnd(11)} wrote ${variant.name}.png (${(png.length / 1024).toFixed(0)}kb)`
      + ` + ${variant.name}.webp (${(buffer.length / 1024).toFixed(0)}kb)\n`
    );
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));
const selected = filters.length
  ? VARIANTS.filter((v) => filters.includes(v.family) || filters.includes(v.name))
  : VARIANTS;

if (!selected.length) {
  console.error(`no variants matched ${filters.join(', ')}`);
  process.exit(1);
}

(args.includes('--reencode') ? reencode(selected) : redraw(selected))
  .catch((e) => { console.error(e); process.exit(1); });

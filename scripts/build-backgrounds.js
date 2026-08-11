// One-off generator for the baked static background images used by
// public/js/scene.js (Phase 14). Not run at app startup or by `npm start` —
// only needed again if you want to regenerate these assets (e.g. a new
// nebula palette). Requires the `canvas` devDependency (`npm install canvas
// --save-dev`), which nothing else in the app needs.
//
// Usage:
//   node scripts/build-backgrounds.js --reencode   convert the PNGs already on
//                                                  disk to lossless WebP
//   node scripts/build-backgrounds.js              redraw the art from scratch
//                                                  (writes WebP; --png for PNG)
//
// READ THIS BEFORE RUNNING IT WITHOUT --reencode. The drawing routine below is
// seeded by Math.random(), so a plain run does not reproduce the skies that are
// on disk — it invents new ones. That is fine when you actually want new art
// and wrong every other time. Plan 3 Phase 7 wanted the existing skies in a
// cheaper container with their pixels untouched, which is what --reencode does:
// it decodes each PNG and re-encodes it as lossless WebP, so every pixel
// survives and only the container changes. Verified bit-for-bit at the time.
//
// WebP rather than PNG because it is roughly half the bytes for identical
// pixels. It needs the `sharp` devDependency (`npm install sharp --save-dev`);
// like `canvas`, nothing `npm start` runs ever imports it.
//
// Mirrors the same procedural drawing routine that used to run in every
// browser on every page load (paintGlow nebula blobs + dense baked stars +
// a few brighter "named" stars), at the same resolution scene.js used
// (4096x2048), so the baked output is visually equivalent to the old
// runtime-generated background.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const sharp = require('sharp');

const BG_W = 4096, BG_H = 2048;
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'backgrounds');

// Each variant is a distinct nebula palette (glow blob colors); the base
// gradient, star field, and layout algorithm stay the same across all of
// them so they read as one consistent "family" of skies.
const VARIANTS = [
  {
    name: 'nebula-1',
    blobs: [
      { x: 3040, y: 600, r: 1040, color: 'rgba(80,60,120,ALPHA)', alpha: '0.12' },
      { x: 800, y: 920, r: 880, color: 'rgba(110,70,90,ALPHA)', alpha: '0.08' },
      { x: 2080, y: 1520, r: 960, color: 'rgba(60,50,100,ALPHA)', alpha: '0.09' },
      { x: 3800, y: 1600, r: 800, color: 'rgba(40,60,90,ALPHA)', alpha: '0.07' },
    ],
  },
  {
    name: 'nebula-2',
    blobs: [
      { x: 900, y: 500, r: 1000, color: 'rgba(110,60,100,ALPHA)', alpha: '0.11' },
      { x: 3200, y: 850, r: 900, color: 'rgba(70,80,120,ALPHA)', alpha: '0.09' },
      { x: 1900, y: 1600, r: 1000, color: 'rgba(90,55,90,ALPHA)', alpha: '0.08' },
      { x: 3600, y: 1450, r: 760, color: 'rgba(50,70,110,ALPHA)', alpha: '0.07' },
    ],
  },
  {
    name: 'nebula-3',
    blobs: [
      { x: 3400, y: 700, r: 1080, color: 'rgba(60,90,110,ALPHA)', alpha: '0.1' },
      { x: 700, y: 1100, r: 860, color: 'rgba(100,60,110,ALPHA)', alpha: '0.09' },
      { x: 2200, y: 1450, r: 940, color: 'rgba(70,55,120,ALPHA)', alpha: '0.08' },
      { x: 3900, y: 1700, r: 780, color: 'rgba(45,80,80,ALPHA)', alpha: '0.06' },
    ],
  },
];

function paintGlow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('ALPHA', alpha));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function renderVariant({ blobs }) {
  const canvas = createCanvas(BG_W, BG_H);
  const ctx = canvas.getContext('2d');

  // base: near-black night sky, with the faintest gradient so it's not flat
  const grad = ctx.createLinearGradient(0, 0, 0, BG_H);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(0.5, '#03030a');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BG_W, BG_H);

  // soft, subtle nebula glow patches
  blobs.forEach((b) => paintGlow(ctx, b.x, b.y, b.r, b.color, b.alpha));

  // dense background stars (varied size + brightness)
  const bakedStarCount = 5600;
  for (let i = 0; i < bakedStarCount; i++) {
    const x = Math.random() * BG_W;
    const y = Math.random() * BG_H;
    const size = Math.random() < 0.85 ? Math.random() * 3 + 0.8 : Math.random() * 5 + 3;
    const alpha = Math.random() * 0.6 + 0.3;
    ctx.fillStyle = `rgba(255, 245, 225, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // a few brighter "named" stars with subtle glow
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * BG_W;
    const y = Math.random() * 1520 + 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 24);
    g.addColorStop(0, 'rgba(255, 250, 235, 0.9)');
    g.addColorStop(1, 'rgba(255, 250, 235, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 24, y - 24, 48, 48);
    ctx.fillStyle = 'rgba(255, 255, 245, 0.95)';
    ctx.beginPath();
    ctx.arc(x, y, 5.6, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

// Lossless, and with the alpha channel dropped. Every one of these skies is
// fully opaque -- checked, alpha is 255 everywhere -- so the channel was three
// bytes of nothing per pixel. That costs little on the wire (a constant channel
// compresses to almost nothing) but it is honest about what the image is.
// effort 6 is sharp's default; the encode is a one-off, so the extra time is
// free and the bytes are not.
function toWebp(input) {
  return sharp(input).removeAlpha().webp({ lossless: true, effort: 6 }).toBuffer();
}

async function reencode() {
  for (const variant of VARIANTS) {
    const pngPath = path.join(OUT_DIR, `${variant.name}.png`);
    if (!fs.existsSync(pngPath)) {
      console.log(`skipped ${variant.name}: no PNG on disk to re-encode`);
      continue;
    }
    const before = fs.statSync(pngPath).size;
    const buffer = await toWebp(pngPath);
    const outPath = path.join(OUT_DIR, `${variant.name}.webp`);
    fs.writeFileSync(outPath, buffer);

    // Lossless has to mean lossless: decode both back to raw RGB and compare.
    // This is the sky of a keepsake app, and "roughly the same" is not the deal.
    const [a, b] = await Promise.all([
      sharp(pngPath).removeAlpha().raw().toBuffer(),
      sharp(outPath).removeAlpha().raw().toBuffer()
    ]);
    const identical = a.equals(b);
    console.log(
      `${variant.name}: ${(before / 1024).toFixed(0)}kb png -> ${(buffer.length / 1024).toFixed(0)}kb webp`
      + ` (${Math.round((1 - buffer.length / before) * 100)}% smaller), pixels ${identical ? 'IDENTICAL' : 'DIFFER -- do not ship'}`
    );
    if (!identical) process.exitCode = 1;
  }
}

async function redraw(wantPng) {
  for (const variant of VARIANTS) {
    const canvas = renderVariant(variant);
    const png = canvas.toBuffer('image/png', { compressionLevel: 9 });
    if (wantPng) {
      const pngPath = path.join(OUT_DIR, `${variant.name}.png`);
      fs.writeFileSync(pngPath, png);
      console.log(`wrote ${pngPath} (${(png.length / 1024).toFixed(0)}kb)`);
    }
    const outPath = path.join(OUT_DIR, `${variant.name}.webp`);
    const buffer = await toWebp(png);
    fs.writeFileSync(outPath, buffer);
    console.log(`wrote ${outPath} (${(buffer.length / 1024).toFixed(0)}kb)`);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
(args.includes('--reencode') ? reencode() : redraw(args.includes('--png')))
  .catch((e) => { console.error(e); process.exit(1); });

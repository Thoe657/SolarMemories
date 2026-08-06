// One-off generator for the baked static background images used by
// public/js/scene.js (Phase 14). Not run at app startup or by `npm start` —
// only needed again if you want to regenerate these assets (e.g. a new
// nebula palette). Requires the `canvas` devDependency (`npm install canvas
// --save-dev`), which nothing else in the app needs.
//
// Usage: node scripts/build-backgrounds.js
//
// Mirrors the same procedural drawing routine that used to run in every
// browser on every page load (paintGlow nebula blobs + dense baked stars +
// a few brighter "named" stars), at the same resolution scene.js used
// (4096x2048), so the baked output is visually equivalent to the old
// runtime-generated background.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

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

fs.mkdirSync(OUT_DIR, { recursive: true });

VARIANTS.forEach((variant) => {
  const canvas = renderVariant(variant);
  const outPath = path.join(OUT_DIR, `${variant.name}.png`);
  const buffer = canvas.toBuffer('image/png', { compressionLevel: 9 });
  fs.writeFileSync(outPath, buffer);
  console.log(`wrote ${outPath} (${(buffer.length / 1024).toFixed(0)}kb)`);
});

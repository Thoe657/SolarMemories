/* ============================================================
   MEMORY CARD TEXTURE — polaroid canvas drawing helpers
   (relies on the global THREE from the CDN <script> tag)
============================================================ */
import { tierSettings } from './quality.js';

/* ----- The card's drawing space (Plan 3 Phase 6) -----
   Every coordinate, font size, line width and corner radius in this file is
   written in a fixed 512×600 reference space. The quality tier decides only
   how many device pixels that space is rasterised into: makeCardCanvas()
   creates the canvas at the tier's size and scales the context once, so the
   low tier's 384×450 is the *same drawing*, smaller — not a cropped or
   re-laid-out one. The high tier's cardTexture is exactly this reference
   size, so its transform is the identity and its cards come out
   pixel-identical, which is decision 2 of the plan.

   Two constraints on the tier table this rests on:
   - Every tier's cardTexture must keep this 512:600 ratio. A different one
     makes the scale non-uniform, which would turn the milestone card's
     circular photo medallion into an ellipse.
   - Front and back share this because they share one mesh: a mismatch in
     either size or ratio would show as the card changing shape mid-flip.
============================================================ */
const CARD_W = 512, CARD_H = 600;

// The tier's pixel size for a card texture — also what scene.js derives the
// card mesh's aspect ratio from, so the mesh's proportions can't drift from
// the drawing's.
export function cardTextureSize() {
  return tierSettings().cardTexture;
}

// A canvas at the tier's size with its context pre-scaled into the reference
// space above. Exported because scene.js's loading placeholder is a card-shaped
// drawing too, and its rounded corners have to line up with a real card's.
export function makeCardCanvas() {
  const { width, height } = cardTextureSize();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.scale(width / CARD_W, height / CARD_H);
  return { canvas, ctx, W: CARD_W, H: CARD_H };
}

export function makePolaroidTexture(memory) {
  const { canvas, ctx, W, H } = makeCardCanvas();

  // Milestone memories get an alpha-masked star silhouette instead of the
  // rounded-rect polaroid (see drawMilestoneStarCard below); everything else
  // is the plain layout, unchanged from before this branch existed.
  if (memory.milestone) {
    drawMilestoneStarCard(ctx, memory, W, H);
  } else {
    drawPlainPolaroid(ctx, memory, W, H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps (CanvasTexture's default) and anisotropy both stay: a card is
  // 1.8 units tall on an 8.2-unit ring, which works out to about a fifth of
  // the viewport height — roughly a 3× minification at pixel ratio 1 — and it
  // tilts and bobs the whole time. This is a texture that is genuinely
  // sampled below 1:1, so it is the wrong place to save the mip chain.
  tex.anisotropy = 4;
  return tex;
}

// Today's plain polaroid: paper rounded-rect, hairline border, rectangular
// photo/placeholder block, handwritten-ish caption + date. Pulled out
// unchanged so makePolaroidTexture can branch to the star variant above
// without altering this path at all.
function drawPlainPolaroid(ctx, memory, W, H) {
  // paper background
  ctx.fillStyle = '#fffaf0';
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W-2, H-2, 14);
  ctx.stroke();

  const photoArea = { x: 24, y: 24, w: W - 48, h: 400 };
  drawPhotoOrPlaceholder(ctx, memory, photoArea);

  // caption area: title in handwritten-ish font + date
  ctx.fillStyle = '#4a3b2a';
  ctx.font = '600 36px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, memory.title || 'untitled memory', W/2, photoArea.y + photoArea.h + 60, W - 60, 42);

  ctx.fillStyle = '#4a3b2a';
  ctx.font = '500 26px "Comic Sans MS", "Caveat", cursive, sans-serif';
  if (memory.date) {
    ctx.fillText(formatDate(memory.date), W/2, H - 28);
  }
}

// Rectangular photo/placeholder block shared by the plain layout.
function drawPhotoOrPlaceholder(ctx, memory, area) {
  if (memory.type === 'photo' && memory.photoImg) {
    drawCover(ctx, memory.photoImg, area.x, area.y, area.w, area.h);
  } else {
    // colored placeholder block based on type
    const colors = { letter: '#ece1f5', audio: '#dceee6' };
    ctx.fillStyle = colors[memory.type] || '#ece1f5';
    ctx.fillRect(area.x, area.y, area.w, area.h);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '60px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = memory.type === 'audio' ? '♪' : '✉';
    ctx.fillText(icon, area.x + area.w/2, area.y + area.h/2);
  }
}

// Circular photo/placeholder inset used by the milestone star card, where
// content has to stay near the shape's centre to avoid the star's points.
function drawCircularPhotoOrPlaceholder(ctx, memory, cx, cy, r) {
  if (memory.type === 'photo' && memory.photoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, memory.photoImg, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  } else {
    const colors = { letter: '#ece1f5', audio: '#dceee6' };
    ctx.fillStyle = colors[memory.type] || '#ece1f5';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = memory.type === 'audio' ? '♪' : '✉';
    ctx.fillText(icon, cx, cy);
  }
}

// Builds a 5-point star outline as a Path2D, with the x/y radii scaled
// independently so it can fill a non-square canvas cleanly. Points start
// straight up and proceed clockwise, alternating outer (tip) and inner
// (notch) vertices every 36 degrees (10 vertices total).
function buildStarPath(cx, cy, outerRx, outerRy, innerRx, innerRy) {
  const path = new Path2D();
  const step = Math.PI / 5;
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * step;
    const rx = i % 2 === 0 ? outerRx : innerRx;
    const ry = i % 2 === 0 ? outerRy : innerRy;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

// Milestone memories' card: the paper, photo and caption are all clipped to
// a 5-point star Path2D (destination content simply isn't drawn outside it,
// same idea as `ctx.clip()` + `destination-in` -- the canvas starts fully
// transparent, so "not drawn" already means "alpha 0"). The result is that
// the whole texture's opaque region *is* the star silhouette -- replacing
// the old gold-double-border signal rather than layering under it. The
// plane geometry/material this gets mapped onto in scene.js is untouched
// (still the same 512:600 rect, still raycast as a full rect), so this is
// purely a texture-level effect per the plan's design decision.
function drawMilestoneStarCard(ctx, memory, W, H) {
  const cx = W / 2, cy = 300;
  const outerRx = 232, outerRy = 272;
  const innerRx = outerRx * 0.66, innerRy = outerRy * 0.66;
  const star = buildStarPath(cx, cy, outerRx, outerRy, innerRx, innerRy);

  ctx.save();
  ctx.fillStyle = '#fffaf0';
  ctx.fill(star);
  ctx.clip(star);

  // warm glow behind the photo so the star reads as "lit up", not just an
  // outline, even out toward its points where the photo doesn't reach
  const glow = ctx.createRadialGradient(cx, cy - 20, 30, cx, cy - 20, outerRy);
  glow.addColorStop(0, 'rgba(255, 221, 150, 0.55)');
  glow.addColorStop(1, 'rgba(255, 221, 150, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // photo/placeholder as a circular medallion near the star's centre --
  // kept inside the star's "safe" inner pentagon so it doesn't get chewed
  // up by the points/notches
  const photoR = 118;
  const photoCx = cx, photoCy = cy - 70;
  drawCircularPhotoOrPlaceholder(ctx, memory, photoCx, photoCy, photoR);

  ctx.strokeStyle = 'rgba(201, 154, 46, 0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(photoCx, photoCy, photoR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#4a3b2a';
  ctx.font = '600 32px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, memory.title || 'untitled memory', cx, photoCy + photoR + 54, 240, 36);

  ctx.fillStyle = '#8a6a24';
  ctx.font = '500 22px "Comic Sans MS", "Caveat", cursive, sans-serif';
  if (memory.date) {
    ctx.fillText(formatDate(memory.date), cx, cy + innerRy - 40);
  }

  ctx.restore(); // drop the star clip so the border below draws full-width

  // gold double-border, echoing the old rectangular treatment but traced
  // along the star outline instead
  ctx.strokeStyle = '#c99a2e';
  ctx.lineWidth = 9;
  ctx.stroke(star);

  const innerStar = buildStarPath(cx, cy, outerRx - 10, outerRy - 10, innerRx - 6, innerRy - 6);
  ctx.strokeStyle = 'rgba(255, 217, 160, 0.7)';
  ctx.lineWidth = 3;
  ctx.stroke(innerStar);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCover(ctx, img, x, y, w, h) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 4);
  ctx.clip();

  const scale = Math.min(w / img.width, h / img.height);

  const dw = img.width * scale;
  const dh = img.height * scale;

  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;

  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

export function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let lines = [];
  for (let w of words) {
    const test = line + w + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line.trim());
      line = w + ' ';
    } else {
      line = test;
    }
  }
  lines.push(line.trim());
  lines = lines.slice(0, 2);
  const startY = y - (lines.length - 1) * lineHeight * 0.5;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ============================================================
   MOON PORTALS — a planet's next/previous moon, shown as an
   actual world hanging far off in the distance rather than a marker
   on the ring. Two textures make one up: an equirectangular surface
   wrapped on a sphere, and a flat caption plate that floats above it.
   A "next moon" that doesn't exist yet (the active one still has
   room) gets the greyed-out surface and a padlock on its plate, so
   the sky reads as continuing rather than simply ending.
============================================================ */
const LOCKED_TINT = [141, 131, 151];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Banded, gas-giant-ish surface in the planet's accent colour. Equirectangular
// (2:1) so it wraps a SphereGeometry without a visible seam at the poles.
export function makeMoonSurfaceTexture({ color = '#ffd9a0', locked = false }) {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const [r, g, b] = locked ? LOCKED_TINT : hexToRgb(color);
  const shade = (t, a = 1) => `rgba(${Math.min(255, Math.round(r * t))}, ${Math.min(255, Math.round(g * t))}, ${Math.min(255, Math.round(b * t))}, ${a})`;

  // base: poles a shade deeper than the equator
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, shade(locked ? 0.5 : 0.34));
  base.addColorStop(0.5, shade(locked ? 0.85 : 0.92));
  base.addColorStop(1, shade(locked ? 0.45 : 0.3));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // latitude bands
  for (let y = 0; y < H;) {
    const h = 7 + Math.random() * 44;
    ctx.fillStyle = shade(0.5 + Math.random() * 0.55, 0.22 + Math.random() * 0.28);
    ctx.fillRect(0, y, W, h);
    y += h;
  }

  // a few soft storm spots, kept off the poles where the wrap pinches
  for (let i = 0; i < 7; i++) {
    const sx = Math.random() * W;
    const sy = H * (0.22 + Math.random() * 0.56);
    const rx = 34 + Math.random() * 86;
    const spot = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    spot.addColorStop(0, shade(1.2, 0.32));
    spot.addColorStop(1, shade(1.2, 0));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, 0.4 + Math.random() * 0.3);
    ctx.translate(-sx, -sy);
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(sx, sy, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Kept, unlike the caption plate below: 1024×512 wrapped onto a sphere about
  // 170 device pixels across is a heavy minification, and the surface runs
  // away from the view at the limb, which is precisely the grazing angle
  // anisotropic filtering exists for.
  tex.anisotropy = 4;
  return tex;
}

// The caption plate floating above a portal moon: "next moon" over the
// moon's name, or a padlock over "not formed yet" when it's locked.
export function makePortalLabelTexture({ caption, label, locked }) {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const cx = W / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (locked) drawPortalLock(ctx, cx, 44);

  ctx.fillStyle = locked ? 'rgba(200, 192, 210, 0.6)' : 'rgba(255, 217, 160, 0.8)';
  ctx.font = '600 28px "Quicksand", sans-serif';
  ctx.fillText(caption, cx, locked ? 128 : 96);

  ctx.fillStyle = locked ? 'rgba(200, 192, 210, 0.7)' : 'rgba(255, 245, 225, 0.98)';
  ctx.font = '600 52px "Comic Sans MS", "Caveat", cursive, sans-serif';
  wrapText(ctx, label, cx, locked ? 190 : 162, W - 50, 56);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  /* No anisotropy on this one (Plan 3 Phase 6's filtering audit). Anisotropic
     filtering does something only where the view is skewed across a surface,
     so the sample footprint comes out long and thin; this plate is a flat quad
     whose group is turned to face the viewer, and the 20.5° elevation it hangs
     at leaves that footprint within about 7% of square. The setting was never
     reaching for a second sample here — dropping it cannot change how the
     plate looks, which is the point: it was a line implying a cost/benefit
     that doesn't exist at this angle.

     Mipmaps do stay, contrary to the plan's premise that this plate is drawn
     at roughly 1:1. Working it out from scene.js's own constants: the plate is
     2.97 units tall (PORTAL_BODY_RADIUS * 2.2 / 2) at 27.8 units out, and a
     55° FOV spans 28.9 units at that depth — so about a tenth of the viewport
     height, i.e. a 256px-tall texture landing on roughly 90 device pixels at
     pixel ratio 1. That is a ~2.8× minification of small text on a plate that
     swings past as you look around, exactly what a mip chain is for, and
     dropping it would trade a third of one texture's memory for shimmering
     captions. */
  return tex;
}

function drawPortalLock(ctx, cx, cy) {
  ctx.strokeStyle = 'rgba(200, 192, 210, 0.7)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, 15, Math.PI, 0); // shackle
  ctx.stroke();
  ctx.fillStyle = 'rgba(200, 192, 210, 0.5)';
  roundRect(ctx, cx - 23, cy, 46, 34, 7); // body
  ctx.fill();
}

// The reverse side of a card, shown mid-flip: just title + date, no photo.
export function makeCardBackTexture(memory) {
  // Same tier-sized canvas and same reference space as the front — they are
  // two faces of one mesh (see the note at the top of this file).
  const { canvas, ctx, W, H } = makeCardCanvas();

  ctx.fillStyle = '#fffaf0';
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  if (memory.milestone) {
    ctx.strokeStyle = '#c99a2e';
    ctx.lineWidth = 8;
    roundRect(ctx, 4, 4, W-8, H-8, 14);
    ctx.stroke();

    // Subtle echo of the front's star silhouette, not a full shape change --
    // the back is only seen edge-on mid-flip, so a small filled glyph reads
    // fine without redoing this side's geometry/clip to match the front.
    ctx.fillStyle = '#c99a2e';
    ctx.fill(buildStarPath(W / 2, 66, 26, 26, 10, 10));
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W-2, H-2, 14);
    ctx.stroke();
  }

  ctx.fillStyle = '#4a3b2a';
  ctx.font = '600 42px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, memory.title || 'untitled memory', W/2, H/2 - 6, W - 90, 50);

  if (memory.date) {
    ctx.fillStyle = '#8a7a68';
    ctx.font = '500 26px "Comic Sans MS", "Caveat", cursive, sans-serif';
    ctx.fillText(formatDate(memory.date), W/2, H/2 + 62);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

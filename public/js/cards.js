/* ============================================================
   MEMORY CARD TEXTURE — polaroid canvas drawing helpers
   (relies on the global THREE from the CDN <script> tag)
============================================================ */

export function makePolaroidTexture(memory) {
  const W = 512, H = 600;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // paper background
  ctx.fillStyle = '#fffaf0';
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  // border: plain by default, gold-toned + thicker for milestone memories
  if (memory.milestone) {
    ctx.strokeStyle = '#c99a2e';
    ctx.lineWidth = 8;
    roundRect(ctx, 4, 4, W-8, H-8, 14);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 217, 160, 0.6)';
    ctx.lineWidth = 2;
    roundRect(ctx, 9, 9, W-18, H-18, 12);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W-2, H-2, 14);
    ctx.stroke();
  }

  const photoArea = { x: 24, y: 24, w: W - 48, h: 400 };

  if (memory.type === 'photo' && memory.photoImg) {
    drawCover(ctx, memory.photoImg, photoArea.x, photoArea.y, photoArea.w, photoArea.h);
  } else {
    // colored placeholder block based on type
    const colors = { letter: '#ece1f5', audio: '#dceee6' };
    ctx.fillStyle = colors[memory.type] || '#ece1f5';
    ctx.fillRect(photoArea.x, photoArea.y, photoArea.w, photoArea.h);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '60px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = memory.type === 'audio' ? '♪' : '✉';
    ctx.fillText(icon, photoArea.x + photoArea.w/2, photoArea.y + photoArea.h/2);
  }

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

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
   PLANET PORTAL TEXTURE — the ring-edge marker for travelling to a
   galaxy's next/previous planet. A locked portal (a "next planet"
   that doesn't exist yet, because the active one still has room) is
   drawn dashed and greyed instead of glowing, so the ring reads as
   continuing rather than simply ending.
============================================================ */
const LOCKED_TINT = [141, 131, 151];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function makePortalTexture({ direction, caption, label, locked, color = '#ffd9a0' }) {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');

  const cx = S / 2;
  const cy = S / 2 - 40; // leaves room for the caption/label under the ring
  const R = 128;
  const [r, g, b] = locked ? LOCKED_TINT : hexToRgb(color);
  const tint = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;

  // soft glow behind the ring
  const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.7);
  glow.addColorStop(0, tint(locked ? 0.08 : 0.32));
  glow.addColorStop(0.55, tint(locked ? 0.03 : 0.12));
  glow.addColorStop(1, tint(0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // the portal ring — solid when you can travel through it, dashed when locked
  ctx.strokeStyle = tint(locked ? 0.5 : 0.95);
  ctx.lineWidth = locked ? 7 : 10;
  if (locked) ctx.setLineDash([18, 15]);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = tint(locked ? 0.16 : 0.42);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 24, 0, Math.PI * 2);
  ctx.stroke();

  if (locked) {
    drawPortalLock(ctx, cx, cy, tint);
  } else {
    drawPortalChevron(ctx, cx, cy, direction, tint);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = tint(locked ? 0.5 : 0.75);
  ctx.font = '600 26px "Quicksand", sans-serif';
  ctx.fillText(caption, cx, cy + R + 60);

  ctx.fillStyle = locked ? tint(0.6) : `rgba(255, 238, 194, 0.95)`;
  ctx.font = '600 44px "Comic Sans MS", "Caveat", cursive, sans-serif';
  wrapText(ctx, label, cx, cy + R + 112, S - 60, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Double chevron pointing the way you'd travel: right for the next planet,
// left for the previous one.
function drawPortalChevron(ctx, cx, cy, direction, tint) {
  const dir = direction === 'prev' ? -1 : 1;
  ctx.strokeStyle = tint(0.9);
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  [-26, 20].forEach((offset, i) => {
    ctx.globalAlpha = i === 0 ? 1 : 0.5;
    const x = cx + dir * offset;
    ctx.beginPath();
    ctx.moveTo(x - dir * 22, cy - 30);
    ctx.lineTo(x + dir * 22, cy);
    ctx.lineTo(x - dir * 22, cy + 30);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawPortalLock(ctx, cx, cy, tint) {
  ctx.strokeStyle = tint(0.75);
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  // shackle
  ctx.beginPath();
  ctx.arc(cx, cy - 12, 24, Math.PI, 0);
  ctx.stroke();
  // body
  ctx.fillStyle = tint(0.55);
  roundRect(ctx, cx - 36, cy - 12, 72, 56, 10);
  ctx.fill();
}

// The reverse side of a card, shown mid-flip: just title + date, no photo.
export function makeCardBackTexture(memory) {
  const W = 512, H = 600;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fffaf0';
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  if (memory.milestone) {
    ctx.strokeStyle = '#c99a2e';
    ctx.lineWidth = 8;
    roundRect(ctx, 4, 4, W-8, H-8, 14);
    ctx.stroke();
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

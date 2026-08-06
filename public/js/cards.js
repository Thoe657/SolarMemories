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

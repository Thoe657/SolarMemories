/* ============================================================
   ENTRY SCREEN — nebula start screen shown once on first load
   -----------------------------------------------------------
   Lightweight standalone 2D canvas (not Three.js), reusing the
   layered radial-gradient "nebula glow" technique from scene.js,
   with a slow drift of a few cloud blobs. Purely a visual/
   interaction gate layered on top of the planet picker, which
   keeps initializing underneath exactly as it always has.
============================================================ */
const entryScreen = document.getElementById('entryScreen');
const canvas = document.getElementById('entryScreenCanvas');
const ctx = canvas.getContext('2d');
const enterBtn = document.getElementById('entryEnterBtn');

let width = 0, height = 0;
function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// A few slow-drifting nebula cloud blobs, reusing the layered
// radial-gradient technique from scene.js's paintGlow.
const blobs = [
  { baseX: 0.3, baseY: 0.35, r: 0.55, color: 'rgba(80,60,120,ALPHA)', alpha: 0.5, speed: 0.02, phase: 0 },
  { baseX: 0.72, baseY: 0.4, r: 0.5, color: 'rgba(110,70,90,ALPHA)', alpha: 0.4, speed: 0.015, phase: 2 },
  { baseX: 0.5, baseY: 0.7, r: 0.6, color: 'rgba(60,50,100,ALPHA)', alpha: 0.45, speed: 0.018, phase: 4 },
];

function paintGlow(x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('ALPHA', alpha));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

let animId = null;
let running = true;

function draw(now = 0) {
  const t = now / 1000;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const maxDim = Math.max(width, height);
  blobs.forEach((b) => {
    const x = (b.baseX + Math.sin(t * b.speed + b.phase) * 0.04) * width;
    const y = (b.baseY + Math.cos(t * b.speed * 0.8 + b.phase) * 0.04) * height;
    paintGlow(x, y, b.r * maxDim, b.color, b.alpha);
  });

  if (running) animId = requestAnimationFrame(draw);
}
draw();

function enter() {
  if (!running) return;
  running = false;
  if (animId) cancelAnimationFrame(animId);
  window.removeEventListener('resize', resize);

  entryScreen.classList.add('fading');
  // matches the .overlay fade timing (~500-700ms) elsewhere in the app
  setTimeout(() => {
    entryScreen.classList.add('hidden');
  }, 700);
}

enterBtn.addEventListener('click', enter);

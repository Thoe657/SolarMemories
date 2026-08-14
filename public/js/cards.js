/* ============================================================
   MEMORY CARD TEXTURE — polaroid canvas drawing helpers
   (relies on the global THREE from the CDN <script> tag)
============================================================ */
import { tierSettings } from './quality.js';
/* ----- Colour comes from the theme, never from a literal (Plan 4 Phase 5) -----
   This file used to hardcode `#fffaf0` and `#4a3b2a` — the same two hexes
   styles.css held as --card-bg/--card-text — because a 2D canvas cannot read
   CSS custom properties. theme.js carries the palette a second time for
   exactly that reason, so the rule for everything a *card* draws is now: NO
   COLOUR LITERALS. Every fill and stroke reads `token()` (the values the DOM
   also uses) or `cardPalette()` (the values only a card wants: its rim, its
   placeholder blocks, its milestone gold). A literal added back here would be
   a solar colour the skin has no way to reach — the same trap the themed-copy
   note further down describes for strings.

   The portal section at the bottom of this file still holds its own warm
   literals, and Phase 7 has now landed without removing them. That is still
   deliberate, but the reason has changed and is worth stating plainly rather
   than leaving the old one to rot:

   - makeMoonSurfaceTexture and makeBlackHoleTexture both take the planet's
     accent through themedAccent(), so the two geometries are already themed
     where it matters. Neither is drawn in the other theme —
     makeMoonSurfaceTexture is solar-only from Phase 7 on, and the black hole
     universe-only — so their remaining literals are per-theme by construction.
   - makePortalLabelTexture is the exception: it is the ONE portal drawing
     shared by both themes, and its warm ink and padlock grey are still
     literals. They read acceptably on graphite, so retinting them was not
     worth spending this phase's budget on. If a later phase touches the plate
     anyway, that is the thing to fix — not another deferral.

   The theme is fixed at load (theme.js's opening note), so these are read at
   draw time and never change under a live texture; that is also why Plan 4
   decision 5 leaves scene.js's LRU cache key without a theme component. */
import { token, cardPalette, themedAccent, themeFlag } from './theme.js';

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

  // Milestone memories get an alpha-masked star (solar) or comet (universe)
  // silhouette instead of the rounded-rect polaroid (see drawMilestoneCard
  // below); everything else is the plain layout, unchanged from before this
  // branch existed.
  if (memory.milestone) {
    drawMilestoneCard(ctx, memory, W, H);
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
  // paper background — the polaroid's mat. It goes graphite in universe; it
  // does not go away. A photo floating on a dark sky with no border around it
  // stops reading as an object you could pick up, which is the whole idea the
  // card is built on.
  ctx.fillStyle = token('--card-bg');
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  // Solar's is a barely-there dark hairline that just stops the cream from
  // bleeding into the sky; universe's is the same line inverted into a faint
  // luminous rim, which is what gives a graphite card an edge at all.
  ctx.strokeStyle = cardPalette().rim;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, W-2, H-2, 14);
  ctx.stroke();

  /* A letter has no picture and never had one: what the photo band used to
     hold was a flat lilac block with a 60px envelope in it, saying nothing
     the title above it wasn't already saying (Plan 5 decision 7). It goes,
     and the card becomes what a letter actually is — writing on blank paper.
     Audio keeps its ♪ on purpose: you cannot tell a voice memo from a letter
     by its title, so that glyph still carries information.

     The same isLetterCard() test gates the BACK (decision 3). Two faces of
     one mesh must agree about what kind of card this is, and the only way to
     guarantee that is for them to ask the same question. */
  if (isLetterCard(memory)) {
    drawCenteredTitleAndDate(ctx, memory, W, H);
    return;
  }

  const photoArea = { x: 24, y: 24, w: W - 48, h: 400 };
  drawPhotoOrPlaceholder(ctx, memory, photoArea);

  // caption area: title in handwritten-ish font + date
  ctx.fillStyle = token('--card-text');
  ctx.font = '600 36px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, memory.title || 'untitled memory', W/2, photoArea.y + photoArea.h + 60, W - 60, 42);

  ctx.fillStyle = token('--card-text');
  ctx.font = '500 26px "Comic Sans MS", "Caveat", cursive, sans-serif';
  if (memory.date) {
    ctx.fillText(formatDate(memory.date), W/2, H - 28);
  }
}

/* The one question both faces ask (Plan 5 Phase 3, decision 3). Letters are
   the only type that changes; photo and audio cards are untouched on both
   sides. Written once so the front's branch and the back's cannot drift into
   disagreeing — a card whose front says "letter" and whose back says
   "not a letter" would flip into a different object. */
function isLetterCard(memory) {
  return memory.type === 'letter';
}

/* Title over date, centred on the card's midline, on blank paper.
   Shared by the letter FRONT and by every non-letter card BACK: these were
   the same drawing written twice the moment the letter front landed, and the
   back's numbers are the ones that were already proven, so they are the ones
   kept. Colours are the back's roles too — title in --card-text, date in
   --card-muted, the same muted role the forms use for their secondary text
   (in solar it happens to be the identical hex this line used to hardcode). */
function drawCenteredTitleAndDate(ctx, memory, W, H) {
  ctx.fillStyle = token('--card-text');
  ctx.font = '600 42px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, memory.title || 'untitled memory', W/2, H/2 - 6, W - 90, 50);

  if (memory.date) {
    ctx.fillStyle = token('--card-muted');
    ctx.font = '500 26px "Comic Sans MS", "Caveat", cursive, sans-serif';
    ctx.fillText(formatDate(memory.date), W/2, H/2 + 62);
  }
}

/* The letter's own words on the back of the card (Plan 5 decision 18): the
   reason to turn a letter over at all. No title — the front carries it — and
   no date either, which stays on the front alone rather than being said
   twice. The block fills NEAR the available space without crowding it: eight
   lines at 46px leading under a 30px face, ink running roughly y=130..500 on
   a 600-tall card, rather than ten lines packed edge to edge. The `…` is what
   says there is more, and the read panel after the flip is where the rest is.

   firstBaselineY clears the milestone glyph a milestone back draws at y=66
   (radius 26, so ink to ~y=92), which is why one set of numbers serves both
   the plain and the milestone letter back. */
const LETTER_BACK = { x: 46, firstBaselineY: 160, lineHeight: 46, maxLines: 8 };

function drawLetterBack(ctx, memory, W, H) {
  const body = (memory.text || '').trim();
  if (!body) {
    /* A letter with no text saved yet. Falling back to the shared blank-paper
       layout keeps the back from being an empty rectangle; note this sits
       INSIDE the letter branch, so the branch itself is still the plain
       isLetterCard() test on both faces. */
    drawCenteredTitleAndDate(ctx, memory, W, H);
    return;
  }

  ctx.fillStyle = token('--card-text');
  ctx.font = '500 30px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  wrapTextBlock(
    ctx, body,
    LETTER_BACK.x, LETTER_BACK.firstBaselineY,
    W - LETTER_BACK.x * 2, LETTER_BACK.lineHeight, LETTER_BACK.maxLines
  );
}

// Rectangular photo/placeholder block shared by the plain layout.
function drawPhotoOrPlaceholder(ctx, memory, area) {
  if (memory.type === 'photo' && memory.photoImg) {
    drawCover(ctx, memory.photoImg, area.x, area.y, area.w, area.h);
  } else {
    // colored placeholder block based on type — themed so it keeps reading as
    // an inset window in the mat rather than a bright panel stuck on top of a
    // dark one (solar's blocks are slightly darker than the cream; universe's
    // are the same two hues, darker than the graphite).
    const paint = cardPalette();
    const colors = { letter: paint.placeholderLetter, audio: paint.placeholderAudio };
    ctx.fillStyle = colors[memory.type] || paint.placeholderLetter;
    ctx.fillRect(area.x, area.y, area.w, area.h);

    ctx.fillStyle = paint.placeholderIcon;
    ctx.font = '60px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = memory.type === 'audio' ? '♪' : '✉';
    ctx.fillText(icon, area.x + area.w/2, area.y + area.h/2);
  }
}

/* Circular photo/placeholder inset used by the milestone card, where content
   has to stay near the shape's bright end to avoid the star's points or the
   comet's tail.

   A MILESTONE LETTER KEEPS THE DISC AND LOSES THE GLYPH (Plan 5 decision 17).
   Phase 3 took the envelope off letter cards, and this is the one place it
   survived — a milestone letter is the rare card that is both. The disc itself
   is not decoration and does not go with it: the comet's head is built around
   this medallion and milestoneLayout hangs the title and date off its radius,
   so removing it would move the text. The blank tinted disc is the answer to
   both — the geometry stays, the icon that said nothing goes.

   Audio keeps its ♪ for the same reason it kept it on a plain card: a title
   cannot tell you something is a recording. */
function drawCircularPhotoOrPlaceholder(ctx, memory, cx, cy, r) {
  if (memory.type === 'photo' && memory.photoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, memory.photoImg, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  } else {
    const paint = cardPalette();
    const colors = { letter: paint.placeholderLetter, audio: paint.placeholderAudio };
    ctx.fillStyle = colors[memory.type] || paint.placeholderLetter;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    if (memory.type === 'audio') {
      ctx.fillStyle = paint.placeholderIcon;
      ctx.font = '52px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', cx, cy);
    }
  }
}

/* How deep the milestone silhouette's inner radii sit, as a fraction of its
   outer ones — the ONE in-texture lever on how much of the card a milestone
   actually covers (Plan 5 Phase 5, decision 12). The shape already spans
   464×544 of a 512×600 card, so there is no room to merely scale it up; the
   only way to get more ink out of the same envelope is to fatten it.

   0.66 → 0.72. It does two different jobs, one per shape, which is why it is
   a single number rather than two:
   - the star's notch depth. Star area is linear in this ratio, so 0.72 is
     +9.1% of ink for free. It stops here on purpose: by ~0.78 the notches are
     shallow enough that five points read as a pentagon with bumps, and the
     ask was "bigger", not "different". If it needs tuning, this is the knob.
   - the comet's head radius (COMET_HEAD_SCALE multiplies it). The head grows
     with it, which is where most of the comet's extra coverage comes from —
     and it is the one visible side effect worth knowing about, since it
     shortens the tail *relative* to the head (the tip is anchored to the
     outer envelope and does not move).
   Every other comet number is expressed in head radii, so the medallion's
   clearance budget in milestoneLayout survives this unchanged. */
const MILESTONE_INNER_RATIO = 0.72;

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

/* ----- The comet (Plan 4 Phase 8) -----
   `universe`'s milestone silhouette. Deliberately the SAME SIGNATURE as
   buildStarPath, because there are three call sites (the card's fill, its
   clip, its two border strokes, and the card back's small glyph) and every
   one of them wants "the milestone shape at this size" rather than a shape
   of its own. One builder swapped for another is the whole branch.

   What the six parameters mean here:
   - (cx, cy) and the OUTER radii are the envelope, exactly as for the star:
     shrinking them shrinks the whole comet about the same centre, which is
     what makes the inner gold border a plain second call with smaller
     numbers rather than a second shape.
   - The INNER radii set the head. The star uses them for its notch depth;
     the comet has no notches, so they buy the one other size it needs.
     innerRx alone, never innerRy: the head must be a CIRCLE in pixel space
     or the photo medallion inside it stops being one, and outerRx/outerRy
     are not equal (232 vs 272 on a real card).

   The construction is a half-circle plus two curves and a forked end: the arc
   covers the head's far side (from +perpendicular round through -unit to
   -perpendicular, i.e. exactly pi of turn), then one edge sweeps out to the
   fork and one comes back, each bowed inward so the tail necks away from the
   head rather than reading as a teardrop. Because everything past the arc is
   expressed in the head->tip frame (see cometPoint) rather than in fixed
   angles, the shape is correct for any tip position — nothing here assumes
   the up-and-left aim below.

   ORIENTATION IS DELIBERATE AND UNMIRRORED (Plan 5 Phase 4, decision 2). The
   reference image is our mirror image, head lower-LEFT; mirroring was
   considered and declined, because what is being replicated is the shape and
   not the aim. So COMET_HEAD_U/V and COMET_TIP_U/V keep their signs, and
   every anchor in milestoneLayout stays where it was. */
const COMET_HEAD_SCALE = 1.14;   // head radius, as a multiple of innerRx
const COMET_HEAD_U = 0.17;       // head centre: right of cx, in outerRx
const COMET_HEAD_V = 0.18;       // head centre: below cy, in outerRy
const COMET_TIP_U = -0.88;       // tail tip: left of cx, in outerRx
const COMET_TIP_V = -0.88;       // tail tip: above cy, in outerRy
/* How far the tail edges bow, in head radii, positive = outward. NEGATIVE ON
   PURPOSE, and it is the difference between a comet and a teardrop: bowed
   outward (the first thing tried, at +0.23) the silhouette is a fat drop with
   a point on it, because a straight-or-convex edge from the head's full width
   to the tip never necks in. Pulled inward the edges are concave, the tail
   sweeps away from the head instead of tapering off it, and the shape reads
   as a comet at card size. Mid-tail half-width goes from 107px (outward) to
   77px (inward) on a 175px head. */
const COMET_TAIL_BOW = -0.12;
/* What fraction of that bow the NEAR-HEAD control carries (Plan 5 Phase 4).
   Each tail edge became a cubic purely so the inward pull can ease in: the
   control by the head gets COMET_TAIL_BOW * this, the one by the fork gets
   all of it. The first cut of the comet applied the full bow evenly, which
   pinched the tail hardest exactly where it leaves the head and left a waist
   too thin to carry the shape. Measured on a real card, this moves the edge's
   inward deviation from the chord to 5.6 / 10.2 / 9.7 px at quarter / half /
   three-quarters of the edge (an even cubic is 11.8 / 15.7 / 11.8): the first
   half is eased, the outer half stays concave, which is the half that does
   the work of not being a teardrop. */
const COMET_WAIST_EASE = 0.3;
/* The forked tip (Plan 5 Phase 4). Each prong is [t, w] in the head->tip
   frame: t along the axis as a fraction of the head->tip distance, w across
   it in head radii. Both are derived from the same tip vector, so the fork
   travels with COMET_TIP_U/V and cannot drift off-axis.

   ORDERED BY INCREASING w, because that is the order the outline visits them
   in — the edge arrives from the -perpendicular side of the head and leaves
   on the +perpendicular side. UNEQUAL LENGTHS on purpose: a fork of three
   equal prongs reads as a fishtail. The middle one runs to the full tip
   (t = 1) and the flanking two fall short by different amounts. */
const COMET_PRONGS = [[0.90, -0.32], [1.00, -0.02], [0.78, 0.30]];
/* How far back the notch between two prongs sits, in the same t units,
   measured from the SHORTER of the pair. Off the shorter one rather than the
   mean because a notch that clears the shorter prong by a fixed amount opens
   the same visible V whatever the pair's length difference. At 0.16 the mask
   is genuinely open — three separate spans across the axis at t = 0.8, two at
   0.7 and 0.9 — so the fork survives rasterisation instead of closing into a
   ragged point. */
const COMET_NOTCH_PULL = 0.16;

// The head is wanted by both the path and the layout that fills it, and a
// second copy of the arithmetic is exactly the kind of thing that drifts.
function cometHead(cx, cy, outerRx, outerRy, innerRx) {
  return {
    hx: cx + outerRx * COMET_HEAD_U,
    hy: cy + outerRy * COMET_HEAD_V,
    r: innerRx * COMET_HEAD_SCALE
  };
}

// The head->tip frame the fork lives in: t runs along the axis (1 = the tip
// COMET_TIP_U/V names), w runs across it in head radii (+/-1 = the head's own
// width). Everything past the arc is written in these two numbers, which is
// what keeps the prongs on-axis for free.
function cometFrame(cx, cy, outerRx, outerRy, innerRx) {
  const { hx, hy, r } = cometHead(cx, cy, outerRx, outerRy, innerRx);
  const dx = (cx + outerRx * COMET_TIP_U) - hx;
  const dy = (cy + outerRy * COMET_TIP_V) - hy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;      // along the axis, head -> tip
  const px = -uy, py = ux;                 // across it, the tail's width
  return {
    hx, hy, r, px, py,
    at: (t, w) => [hx + ux * len * t + px * r * w, hy + uy * len * t + py * r * w]
  };
}

/* One tail edge, from S to E, as a cubic whose two control points carry
   different amounts of the inward bow: `ease` of it next to the head, all of
   it next to the fork. `sigma` is which side of the axis this edge is on
   (-1 = the side the outline leaves the head on, +1 = the side it returns
   along), and it only ever flips the sign of the offset — the near control is
   the one nearer the HEAD on both edges, which is why the two branches read
   the pair in opposite order. */
function cometEdge(path, S, E, px, py, bow, sigma) {
  const near = sigma * bow * COMET_WAIST_EASE, far = sigma * bow;
  const d1 = sigma > 0 ? far : near, d2 = sigma > 0 ? near : far;
  path.bezierCurveTo(
    S[0] + (E[0] - S[0]) / 3 + px * d1, S[1] + (E[1] - S[1]) / 3 + py * d1,
    S[0] + (E[0] - S[0]) * 2 / 3 + px * d2, S[1] + (E[1] - S[1]) * 2 / 3 + py * d2,
    E[0], E[1]
  );
}

function buildCometPath(cx, cy, outerRx, outerRy, innerRx, innerRy) {
  const { hx, hy, r, px, py, at } = cometFrame(cx, cy, outerRx, outerRy, innerRx);

  const ax = hx + px * r, ay = hy + py * r;   // where the near tail edge meets the head
  const bx = hx - px * r, by = hy - py * r;   // ... and the far one
  const startAngle = Math.atan2(ay - hy, ax - hx);
  const bow = r * COMET_TAIL_BOW;
  const prongs = COMET_PRONGS.map(([t, w]) => at(t, w));

  const path = new Path2D();
  path.moveTo(ax, ay);
  // Exactly half a turn from A to B. Sweeping the positive direction from the
  // +perpendicular passes through -unit, i.e. the side of the head facing
  // away from the tail — which is the half we want to keep.
  path.arc(hx, hy, r, startAngle, startAngle + Math.PI, false);
  cometEdge(path, [bx, by], prongs[0], px, py, bow, -1);
  // the fork: out to each prong in turn, dipping to a notch in between
  for (let i = 1; i < COMET_PRONGS.length; i++) {
    const [pt, pw] = COMET_PRONGS[i - 1], [nt, nw] = COMET_PRONGS[i];
    const notch = at(Math.min(pt, nt) - COMET_NOTCH_PULL, (pw + nw) / 2);
    path.lineTo(notch[0], notch[1]);
    path.lineTo(prongs[i][0], prongs[i][1]);
  }
  cometEdge(path, prongs[prongs.length - 1], [ax, ay], px, py, bow, 1);
  path.closePath();
  return path;
}

// Which silhouette a milestone memory is cut into. The flag is false in solar
// (theme.js), so the default theme can only ever reach buildStarPath.
function milestoneShape() {
  return themeFlag('cometMilestones') ? 'comet' : 'star';
}

function buildMilestonePath(shape, cx, cy, outerRx, outerRy, innerRx, innerRy) {
  return shape === 'comet'
    ? buildCometPath(cx, cy, outerRx, outerRy, innerRx, innerRy)
    : buildStarPath(cx, cy, outerRx, outerRy, innerRx, innerRy);
}

/* The ink a milestone is marked in, chosen by SHAPE (Plan 5 Phase 4).
   A star is gold and a comet is ice-blue, which reverses a Plan 4 decision:
   theme.js used to say the gold was "a signal about the memory, not a
   property of the surface" and so identical in both themes. Living with it
   said otherwise — the gold was the last warm thing left in a cool theme and
   read as foreign. Solar's star is untouched and stays gold.

   Read ONCE per card, in one place, because these six values are spent across
   two faces: five on the front and two on the back. Resolving them
   independently is how the front and the back come to disagree about what
   colour a milestone is. Keyed on shape rather than on the theme name so the
   colour cannot get out of step with the silhouette it is tracing, and the
   gold is the fallback when a theme carries no comet family — a theme that
   flipped `cometMilestones` on without adding one still draws. */
function milestonePalette(shape) {
  const p = cardPalette();
  if (shape !== 'comet' || !p.cometLine) {
    return {
      glow: p.milestoneGlow, glowFade: p.milestoneGlowFade, ring: p.milestoneRing,
      line: p.milestoneLine, inner: p.milestoneInner, date: p.milestoneDate
    };
  }
  return {
    glow: p.cometGlow, glowFade: p.cometGlowFade, ring: p.cometRing,
    line: p.cometLine, inner: p.cometInner, date: p.cometDate
  };
}

/* Where the medallion and the two captions sit inside the silhouette.
   The star is symmetric about the card's own centre line, so its anchors are
   the literals that were written inline before this phase — byte-for-byte, so
   solar's milestone cards stay pixel-identical. The comet's head is off-centre
   by construction, so every one of its anchors is derived from the head
   instead: the photo medallion sits inside the head, and both captions hang
   below it, still inside the head's width at their own heights. Nothing is
   anchored to the tail — a tail narrows, and text in a narrowing space is a
   layout that works until someone writes a longer title.

   THE MEDALLION'S TWO NUMBERS ARE A CLEARANCE BUDGET, not a look. Its offset
   above the head centre plus its radius must stay under the head radius, and
   with enough margin for two strokes that are drawn on top of each other's
   space: the medallion's own 4px gold ring (±2) and the silhouette's 9px
   outer border (±4.5). 0.30 + 0.585 = 0.885 leaves 0.115 of the head radius,
   about 20px on a real card, which is comfortably more than the ~6.5px the
   two strokes need. The first pass used 0.33 + 0.615 and left 9.6px, where
   the ring visibly grazed the outline at the top right. */
function milestoneLayout(shape, cx, cy, outerRx, outerRy, innerRx, innerRy) {
  if (shape !== 'comet') {
    const photoCy = cy - 70, photoR = 118;
    return {
      photoCx: cx, photoCy, photoR,
      textCx: cx,
      titleY: photoCy + photoR + 54,
      dateY: cy + innerRy - 40,
      glowCx: cx, glowCy: cy - 20, glowR: outerRy
    };
  }
  const { hx, hy, r } = cometHead(cx, cy, outerRx, outerRy, innerRx);
  const photoR = r * 0.585;
  const photoCy = hy - r * 0.30;
  return {
    photoCx: hx, photoCy, photoR,
    textCx: hx,
    titleY: photoCy + photoR + 50,
    dateY: hy + r * 0.83,
    glowCx: hx, glowCy: hy - 20, glowR: outerRy
  };
}

// Milestone memories' card: the paper, photo and caption are all clipped to
// the milestone silhouette -- a 5-point star in solar, a comet in universe
// (Plan 4 Phase 8) -- as a Path2D (destination content simply isn't drawn
// outside it, same idea as `ctx.clip()` + `destination-in` -- the canvas
// starts fully transparent, so "not drawn" already means "alpha 0"). The
// result is that the whole texture's opaque region *is* the silhouette --
// replacing the old gold-double-border signal rather than layering under it.
// The plane geometry/material this gets mapped onto in scene.js is untouched
// (still the same 512:600 rect, still raycast as a full rect), so this is
// purely a texture-level effect per the plan's design decision -- which is
// also why the shape can change per theme without the scene noticing.
function drawMilestoneCard(ctx, memory, W, H) {
  const shape = milestoneShape();
  const cx = W / 2, cy = 300;
  const outerRx = 232, outerRy = 272;
  const innerRx = outerRx * MILESTONE_INNER_RATIO, innerRy = outerRy * MILESTONE_INNER_RATIO;
  const body = buildMilestonePath(shape, cx, cy, outerRx, outerRy, innerRx, innerRy);
  const lay = milestoneLayout(shape, cx, cy, outerRx, outerRy, innerRx, innerRy);
  const paint = milestonePalette(shape);

  ctx.save();
  ctx.fillStyle = token('--card-bg');
  ctx.fill(body);
  ctx.clip(body);

  // glow behind the photo so the shape reads as "lit up", not just an
  // outline, even out toward the star's points or along the comet's tail
  // where the photo doesn't reach. Warm behind a star, cold behind a comet
  // (see milestonePalette). It is centred on whatever the shape's bright end
  // is: the star's middle, the comet's head. Both stops come from the palette
  // -- the far one used to be a gold literal, which would have left a warm
  // halo bleeding out of an ice-blue comet.
  const glow = ctx.createRadialGradient(lay.glowCx, lay.glowCy, 30, lay.glowCx, lay.glowCy, lay.glowR);
  glow.addColorStop(0, paint.glow);
  glow.addColorStop(1, paint.glowFade);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // photo/placeholder as a circular medallion -- inside the star's "safe"
  // inner pentagon, or inside the comet's head, so it never gets chewed up
  // by the points/notches or by the tail
  drawCircularPhotoOrPlaceholder(ctx, memory, lay.photoCx, lay.photoCy, lay.photoR);

  ctx.strokeStyle = paint.ring;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(lay.photoCx, lay.photoCy, lay.photoR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = token('--card-text');
  ctx.font = '600 32px "Comic Sans MS", "Caveat", cursive, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, memory.title || 'untitled memory', lay.textCx, lay.titleY, 240, 36);

  ctx.fillStyle = paint.date;
  ctx.font = '500 22px "Comic Sans MS", "Caveat", cursive, sans-serif';
  if (memory.date) {
    ctx.fillText(formatDate(memory.date), lay.textCx, lay.dateY);
  }

  ctx.restore(); // drop the clip so the border below draws full-width

  // gold double-border, echoing the old rectangular treatment but traced
  // along the silhouette instead
  ctx.strokeStyle = paint.line;
  ctx.lineWidth = 9;
  ctx.stroke(body);

  const inner = buildMilestonePath(shape, cx, cy, outerRx - 10, outerRy - 10, innerRx - 6, innerRy - 6);
  ctx.strokeStyle = paint.inner;
  ctx.lineWidth = 3;
  ctx.stroke(inner);
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

/* Wrap `text` into at most `maxLines` lines running DOWN from a first
   baseline at `y`, ending in an ellipsis when there was more than fitted.
   Returns `{ lines, truncated }`.

   A separate function rather than options on wrapText above, deliberately.
   wrapText hard-caps at two lines, appends nothing, and centres its block
   vertically on `y` — and makePortalLabelTexture leans on all three. Adding
   parameters to it would have re-laid-out every portal plate in the app in
   order to change one card, and the plates are not what this phase is about.

   The ellipsis is MEASURED, not appended. A line that fit maxWidth on its own
   can overflow it once the `…` is on the end, so words come off the tail
   until the whole string fits; a single word longer than maxWidth loses
   characters instead, since there is no space to cut at.

   Newlines collapse to spaces (the split is on any whitespace). An eight-line
   excerpt has no room to spend on a blank line, and a word token carrying a
   "\n" measures wrong. */
export function wrapTextBlock(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let truncated = false;

  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) { truncated = true; break; }
    } else {
      line = test;
    }
  }
  if (!truncated && line) lines.push(line);

  if (truncated) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) {
      const cut = last.lastIndexOf(' ');
      last = cut > 0 ? last.slice(0, cut) : last.slice(0, -1);
    }
    lines[lines.length - 1] = last + '…';
  }

  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return { lines: lines.length, truncated };
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
   A next moon that doesn't exist yet (the active one still has
   room) gets the greyed-out surface and a padlock on its plate, so
   the sky reads as continuing rather than simply ending.

   NO THEMED COPY IS WRITTEN IN THIS FILE (Plan 4 Phase 2). Every word
   that ends up on a plate arrives as a parameter, already resolved by
   scene.js against theme.js — "next moon" in solar, "next nebula" in
   universe, over a moon name or a derived nebula name. This module draws
   whatever it is handed, and deliberately caches none of it: each call
   bakes a fresh canvas, so a plate can never come back wearing the other
   theme's wording. Keep it that way — a literal added here would be a
   solar string the skin has no way to reach.
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

  /* The planet's accent arrives exactly as the user stored it and is re-aimed
     here rather than in `data/` — themedAccent() is the identity function in
     solar and a lightness clamp / saturation nudge in universe, so the twelve
     pastels that were picked against a cream card still read as twelve
     distinguishable colours against graphite and a near-black sky. Decision 4:
     no second stored colour, no `data/` write, ever. */
  const [r, g, b] = locked ? LOCKED_TINT : hexToRgb(themedAccent(color));
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

/* The universe theme's portal: a black hole with an accretion ring, drawn
   face-on for a flat quad rather than wrapped on a sphere. Square (1:1), and
   transparent outside the glow — the disc's silhouette is the texture's opaque
   region, the same trick the milestone star card uses.

   Draw order is the whole effect. The far side of the accretion disc is laid
   down first, then the lensed halo, then the event horizon over both, then the
   near side over that — so the ring passes behind the hole at the top and in
   front at the bottom, which is what makes it read as a disc seen at an angle
   rather than a flat halo. The ellipse's 0.34 squash is that viewing angle.

   Plan 5 Phase 6 fixed a measured defect and added the arc:

   - The ring used to start at 0.52 of RING_RX (120.6px) while the horizon ends
     at 84px, so there was a 36px annular dead gap all the way round — the ring
     floated off the hole instead of sitting around it. Its stops are now
     written in absolute texture pixels through `ringStop()` precisely so that
     relationship stays legible: first light AT the horizon, peak by ~100px.
     Vertically the 0.34 squash tucks that inner edge behind the disc, which is
     why the gap only ever showed at the left and right extremes.
   - The near half of the disc crosses in *front* of the lower interior of the
     horizon (the hole's face is only black above the disc line). That is not a
     bug and predates this phase — it is what an edge-on disc does.
   - The lensed halo is a second, near-circular (0.9) annulus hugging the
     horizon at lower alpha, drawn BEHIND the horizon so it only shows outside
     it. Horizontally the accretion ring swamps it; what survives is the arc
     over the top and under the bottom, and that vertical arc is what makes the
     shape read as a black hole rather than a ringed planet.

   Every soft edge here is gradient alpha stops. No `shadowBlur`, no
   `ctx.filter`: this texture is rebuilt on every portal update, so a canvas
   blur would be real per-moon-jump cost.

   A locked portal gets the horizon and its glow and NO ring and NO halo. The
   plan's reasoning: the ring is what marks a real one, so its absence says
   "not formed yet" — a better sentence than "greyed out"; the halo goes with
   it for the same reason, leaving only the horizon and a dim photon ring. */
export function makeBlackHoleTexture({ color = '#ffd9a0', locked = false }) {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // Same accent path as the moon surface: re-aimed at render time, never stored.
  const [r, g, b] = locked ? LOCKED_TINT : hexToRgb(themedAccent(color));
  const tint = (t, a = 1) => `rgba(${Math.min(255, Math.round(r * t))}, ${Math.min(255, Math.round(g * t))}, ${Math.min(255, Math.round(b * t))}, ${a})`;

  const HORIZON = 84;
  const RING_RX = 232, RING_RY = 232 * 0.34;
  // Fraction of RING_RX where the ring starts. 0.36 * 232 = 83.5px — the
  // horizon's own radius, so the ring's first light lands on the rim with no
  // gap. This number and HORIZON move together or the gap comes back.
  const RING_INNER = 0.36;
  /* createRadialGradient's stops run 0..1 across [inner, outer], so a stop's
     texture radius is inner + t*(outer-inner). The ring is specified in
     absolute pixels instead, and converted — the whole point of the phase is
     that these radii are readable against HORIZON. */
  const ringStop = (px) => (px - RING_RX * RING_INNER) / (RING_RX * (1 - RING_INNER));

  // Outer bloom, so the hole sits in something rather than being cut out of
  // the sky. Faint and wide; the sky behind it is near-black in both themes.
  const bloom = ctx.createRadialGradient(cx, cy, HORIZON * 0.8, cx, cy, S / 2);
  bloom.addColorStop(0, tint(1, locked ? 0.10 : 0.22));
  bloom.addColorStop(0.45, tint(0.8, locked ? 0.04 : 0.09));
  bloom.addColorStop(1, tint(0.6, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, S, S);

  // One half of the accretion ring. `half` is -1 for the far side (drawn
  // before the horizon) and +1 for the near side (drawn after it).
  const drawRingHalf = (half) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, half < 0 ? 0 : cy, S, cy);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.scale(1, RING_RY / RING_RX);
    const grad = ctx.createRadialGradient(0, 0, RING_RX * RING_INNER, 0, 0, RING_RX);
    grad.addColorStop(0, tint(1.35, 0));                   //  83.5px — the rim
    grad.addColorStop(ringStop(100), tint(1.5, 0.95));     // 100px — peak
    grad.addColorStop(ringStop(118), tint(1.28, 0.72));
    grad.addColorStop(ringStop(145), tint(1.05, 0.45));
    grad.addColorStop(ringStop(185), tint(0.9, 0.2));
    grad.addColorStop(1, tint(0.7, 0));                    // 232px — gone
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, RING_RX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /* The lensed halo: light from the far side of the disc bent up over the top
     and down under the bottom. Near-circular (0.9) rather than the disc's 0.34,
     drawn before the horizon so the horizon crops its inner half away and only
     the arc outside the rim survives. Its inner radius sits *inside* the
     horizon on purpose — that part is covered, and starting outside it would
     put a seam on the rim. */
  const HALO_RX = 144, HALO_SQUASH = 0.9;
  const drawHalo = () => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, HALO_SQUASH);
    const grad = ctx.createRadialGradient(0, 0, HALO_RX * 0.6, 0, 0, HALO_RX);
    grad.addColorStop(0, tint(1.2, 0.5));
    grad.addColorStop(0.2, tint(1.2, 0.46));
    grad.addColorStop(0.45, tint(1.05, 0.28));
    grad.addColorStop(0.75, tint(0.9, 0.1));
    grad.addColorStop(1, tint(0.8, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, HALO_RX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  if (!locked) { drawRingHalf(-1); drawHalo(); }

  // The event horizon: genuinely black, not "dark accent". It is the one
  // thing on screen that should give back no light at all.
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx, cy, HORIZON, 0, Math.PI * 2);
  ctx.fill();

  // Photon ring hugging the horizon. Present when locked too, at a fraction of
  // the strength — without it the locked disc has no edge and stops reading as
  // an object at all, which is the same failure the locked moon's 0.72 opacity
  // was fixing.
  ctx.strokeStyle = tint(1.5, locked ? 0.34 : 0.9);
  ctx.lineWidth = locked ? 2.5 : 4;
  ctx.beginPath();
  ctx.arc(cx, cy, HORIZON + 2, 0, Math.PI * 2);
  ctx.stroke();

  if (!locked) drawRingHalf(1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  /* No anisotropy, for the caption plate's reason rather than the moon
     surface's: this is a flat quad facing the viewer, so the sample footprint
     never goes grazing. Mipmaps stay — 512px landing on roughly 170 device
     pixels is a real minification, and the disc swings past as you look
     around. */
  return tex;
}

// The caption plate floating beside a portal moon: `caption` over `label` —
// e.g. "next moon" over "Europa", or "next nebula" over "Orion" — or a padlock
// over "not formed yet" when it's locked. Both strings come in themed; see the
// section header above.
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
  const paint = cardPalette();

  ctx.fillStyle = token('--card-bg');
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  if (memory.milestone) {
    // Same shape and the same ink as the front, resolved through the same two
    // functions (Plan 5 Phase 4) — the back cannot end up gold while the front
    // is blue, or vice versa, because neither face picks a colour of its own.
    const shape = milestoneShape();
    const mile = milestonePalette(shape);

    ctx.strokeStyle = mile.line;
    ctx.lineWidth = 8;
    roundRect(ctx, 4, 4, W-8, H-8, 14);
    ctx.stroke();

    /* Subtle echo of the front's silhouette, not a full shape change -- the
       back is only seen edge-on mid-flip, so a small filled glyph reads fine
       without redoing this side's geometry/clip to match the front. It goes
       through the same builder as the front (Plan 4 Phase 8), so the two
       faces can never disagree about which shape a milestone is.

       Note the comet comes out a little smaller than the star at the same
       numbers -- a star fills its whole +/-26 box with its five points, while
       the comet's head reaches ~0.83 of it and its tail ~0.85. Left as is:
       matching extents exactly would mean a second set of literals here for
       one glyph seen for 400ms at a glancing angle. */
    ctx.fillStyle = mile.line;
    ctx.fill(buildMilestonePath(shape, W / 2, 66, 26, 26, 10, 10));
  } else {
    ctx.strokeStyle = paint.rim;
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W-2, H-2, 14);
    ctx.stroke();
  }

  // Letters carry their own text here instead of repeating the front's title
  // and date; everything else keeps the blank-paper layout it always had.
  // Same test as the front (decision 3) — see isLetterCard.
  if (isLetterCard(memory)) {
    drawLetterBack(ctx, memory, W, H);
  } else {
    drawCenteredTitleAndDate(ctx, memory, W, H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

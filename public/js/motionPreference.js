/* ============================================================
   MOTION PREFERENCE — OS-level prefers-reduced-motion, read by
   scene.js to dampen ambient animation (fairy-light drift/twinkle,
   card bob) and by planetPicker.js to pick the shorter hyperspace
   preset. No manual toggle in-app; this is purely the stated
   accessibility preference.
============================================================ */
const reducedMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export function prefersReducedMotion() {
  return !!(reducedMotionQuery && reducedMotionQuery.matches);
}

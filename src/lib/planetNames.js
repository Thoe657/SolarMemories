// Pool of astronomical names for auto-generated planet groupings: solar
// system planets, notable moons, and a few named exoplanets. Picked
// uniformly at random per planet creation -- no cross-galaxy uniqueness
// tracking, so rare repeats are acceptable at this app's personal scale.
// Within a single galaxy is different, though: since Phase 4 these names are
// how you navigate ("next planet: Makemake"), and two planets one hop apart
// sharing a name is genuinely confusing, so callers pass the names already
// used in that galaxy and those are avoided while any remain unused.
const PLANET_NAMES = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
  'Ceres', 'Eris', 'Haumea', 'Makemake',
  'Europa', 'Titan', 'Io', 'Ganymede', 'Callisto', 'Triton', 'Titania', 'Oberon',
  'Proxima Centauri b', 'TRAPPIST-1e', 'Kepler-186f',
];

function randomPlanetName(taken = []) {
  const used = new Set(taken);
  // Past 24 planets in one galaxy (672 stars) every name is spoken for and
  // repeats resume — better than running out of names.
  const available = PLANET_NAMES.filter((n) => !used.has(n));
  const pool = available.length > 0 ? available : PLANET_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { PLANET_NAMES, randomPlanetName };

// Pool of real moon names for auto-generated star groupings: since Phase 11
// these are moons of a planet (not planets themselves), so the pool dropped
// planets/dwarf-planets/exoplanets (Earth, Jupiter, Kepler-186f, ...) in
// favour of actual moons across the solar system. Picked uniformly at
// random per moon creation -- no cross-planet uniqueness tracking, so rare
// repeats are acceptable at this app's personal scale.
// Within a single planet is different, though: since Phase 4 these names are
// how you navigate ("next moon: Europa"), and two moons one hop apart
// sharing a name is genuinely confusing, so callers pass the names already
// used on that planet and those are avoided while any remain unused.
const MOON_NAMES = [
  'Europa', 'Titan', 'Io', 'Ganymede', 'Callisto', 'Triton', 'Titania', 'Oberon',
  'Phobos', 'Deimos', 'Enceladus', 'Mimas', 'Rhea', 'Iapetus', 'Dione', 'Tethys',
  'Hyperion', 'Charon', 'Miranda', 'Ariel', 'Umbriel', 'Nereid', 'Proteus',
  'Amalthea', 'Puck', 'Nix', 'Hydra', 'Styx',
];

function randomMoonName(taken = []) {
  const used = new Set(taken);
  // Past 28 moons on one planet every name is spoken for and repeats
  // resume — better than running out of names.
  const available = MOON_NAMES.filter((n) => !used.has(n));
  const pool = available.length > 0 ? available : MOON_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { MOON_NAMES, randomMoonName };

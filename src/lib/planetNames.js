// Pool of astronomical names for auto-generated planet groupings: solar
// system planets, notable moons, and a few named exoplanets. Picked
// uniformly at random per planet creation -- no cross-galaxy uniqueness
// tracking, so rare repeats are acceptable at this app's personal scale.
const PLANET_NAMES = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
  'Ceres', 'Eris', 'Haumea', 'Makemake',
  'Europa', 'Titan', 'Io', 'Ganymede', 'Callisto', 'Triton', 'Titania', 'Oberon',
  'Proxima Centauri b', 'TRAPPIST-1e', 'Kepler-186f',
];

function randomPlanetName() {
  return PLANET_NAMES[Math.floor(Math.random() * PLANET_NAMES.length)];
}

module.exports = { PLANET_NAMES, randomPlanetName };

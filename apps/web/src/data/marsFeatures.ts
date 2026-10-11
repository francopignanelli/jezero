/**
 * Major named features for the globe view: IAU Gazetteer of Planetary Nomenclature centre
 * coordinates (planetocentric latitude, east longitude 0–360°). Heights are approximate MOLA
 * elevations above the areoid (m), only so the label anchor sits near the surface.
 */
export interface MarsFeature {
  id: string;
  name: string;
  lat: number;
  lon: number;
  heightM: number;
  /** Larger features win when labels would overlap. */
  rank: 1 | 2 | 3;
}

export const MARS_FEATURES: readonly MarsFeature[] = [
  { id: 'olympus-mons', name: 'Olympus Mons', lat: 18.65, lon: 226.2, heightM: 21_000, rank: 1 },
  { id: 'valles-marineris', name: 'Valles Marineris', lat: -13.9, lon: 300.8, heightM: -4_000, rank: 1 },
  { id: 'hellas', name: 'Hellas Planitia', lat: -42.4, lon: 70.5, heightM: -7_000, rank: 1 },
  { id: 'argyre', name: 'Argyre Planitia', lat: -49.7, lon: 316.0, heightM: -3_000, rank: 1 },
  { id: 'utopia', name: 'Utopia Planitia', lat: 46.7, lon: 117.5, heightM: -4_000, rank: 1 },
  { id: 'elysium-mons', name: 'Elysium Mons', lat: 25.02, lon: 147.21, heightM: 13_000, rank: 2 },
  { id: 'ascraeus-mons', name: 'Ascraeus Mons', lat: 11.92, lon: 255.92, heightM: 18_000, rank: 2 },
  { id: 'pavonis-mons', name: 'Pavonis Mons', lat: 1.48, lon: 247.04, heightM: 14_000, rank: 2 },
  { id: 'arsia-mons', name: 'Arsia Mons', lat: -8.26, lon: 239.26, heightM: 17_000, rank: 2 },
  { id: 'alba-mons', name: 'Alba Mons', lat: 40.47, lon: 250.4, heightM: 6_000, rank: 2 },
  { id: 'isidis', name: 'Isidis Planitia', lat: 12.9, lon: 87.0, heightM: -3_800, rank: 2 },
  { id: 'syrtis-major', name: 'Syrtis Major Planum', lat: 8.4, lon: 69.5, heightM: 0, rank: 2 },
  { id: 'acidalia', name: 'Acidalia Planitia', lat: 49.76, lon: 339.0, heightM: -4_000, rank: 2 },
  { id: 'chryse', name: 'Chryse Planitia', lat: 28.4, lon: 319.7, heightM: -3_000, rank: 2 },
  { id: 'amazonis', name: 'Amazonis Planitia', lat: 24.8, lon: 196.0, heightM: -3_000, rank: 2 },
  { id: 'elysium-planitia', name: 'Elysium Planitia', lat: 2.98, lon: 154.7, heightM: -2_500, rank: 3 },
  { id: 'noctis', name: 'Noctis Labyrinthus', lat: -6.94, lon: 257.4, heightM: 4_000, rank: 3 },
  { id: 'meridiani', name: 'Meridiani Planum', lat: 0.2, lon: 357.5, heightM: -1_400, rank: 3 },
  { id: 'gale', name: 'Gale Crater', lat: -5.37, lon: 137.81, heightM: -4_500, rank: 3 },
  { id: 'gusev', name: 'Gusev Crater', lat: -14.5, lon: 175.4, heightM: -1_900, rank: 3 },
  { id: 'planum-boreum', name: 'Planum Boreum', lat: 88.0, lon: 15.0, heightM: -2_500, rank: 2 },
  { id: 'planum-australe', name: 'Planum Australe', lat: -83.9, lon: 160.0, heightM: 3_000, rank: 2 },
];

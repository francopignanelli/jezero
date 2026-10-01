/**
 * Mars reference constants. Every scientific calculation takes its body parameters from here.
 * See docs/methodology.md §1 for the rationale behind each convention.
 */

/**
 * Radius (m) of the IAU 2015 Mars reference sphere, IAU_2015:49900 ("Mars 2000" in USGS products).
 * All selected map products (USGS TRN, JPL CTX, PDS PLACES) are projected on this sphere, and so is
 * the renderer.
 */
export const MARS_SPHERE_RADIUS_M = 3_396_190;

/** IAU 2015 Mars ellipsoid radii (m). Used only for planetocentric/planetographic conversion. */
export const MARS_EQUATORIAL_RADIUS_M = 3_396_190;
export const MARS_POLAR_RADIUS_M = 3_376_200;

/** Length of the mean solar day (sol) in SI seconds (Allison & McEwen 2000; NAIF M2020 LMST SCLK). */
export const SOL_SECONDS = 88_775.244;

/** Standard parallel (deg) of the Mars 2020 rover localization frame (PDS PLACES, MMGIS). */
export const M2020_FRAME_LAT_TS_DEG = 18.4663;

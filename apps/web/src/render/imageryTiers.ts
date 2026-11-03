import type { LayerId } from '../app/store';
import { DATA_VERSION, dataUrl } from '../config';
import { loadImageryLayer } from '../data/surfaceData';
import type { LayerGrade, LonLatRect, MarsScene } from './marsScene';
import type { Tint } from './tint';

/**
 * Grade for the Viking colorized mosaics: warmer (hue toward orange) and moderately saturated, with a
 * little more contrast so albedo features read as in true-colour views of Mars from orbit, without the
 * exaggerated blue of the raw colorization. Colours remain illustrative, as the provenance card states.
 */
const VIKING_GRADE = { saturation: 0.82, hue: 0.09, gamma: 1.0, brightness: 1.08, contrast: 1.18 };
/** The colour wash only adds regional hue variation over the tinted CTX/HiRISE. */
const WASH_GRADE = { saturation: 0.8, hue: 0.06, gamma: 1.0, brightness: 1.1, contrast: 1.0 };
/**
 * CTX and HiRISE are greyscale. They are multiplied by the average ground colour of the Mastcam-Z
 * panorama PIA26699 (R:G:B ≈ 148:100:65, natural colour) so the surface reads as Mars without
 * blurring the detail. Approximate colour; the brightness lift offsets the multiply.
 */
const GROUND_TINT: Tint = [1, 0.676, 0.439];
const TINTED_GRADE: LayerGrade = { brightness: 1.25 };
/**
 * Imagery tiers, bottom to top. `toggle` is the layer-panel switch that controls the tier. The
 * Viking 232 m regional pyramid sharpens the descent from orbit; the colour wash re-uses it over
 * the greyscale CTX/HiRISE tiers (see marsScene.fadeImageryTiers).
 */
const IMAGERY: Array<{
  id: string;
  toggle: LayerId;
  credit: string;
  tiles?: string;
  rectangle?: LonLatRect;
  grade?: LayerGrade;
  tint?: Tint;
}> = [
  {
    id: 'viking',
    toggle: 'viking',
    credit: 'NASA/USGS Viking Orbiter colorized mosaic',
    grade: VIKING_GRADE,
  },
  {
    id: 'viking-hd',
    toggle: 'viking',
    credit: 'NASA/USGS Viking MDIM 2.1 colorized mosaic (232 m)',
    grade: VIKING_GRADE,
  },
  {
    id: 'ctx',
    toggle: 'ctx',
    credit: 'NASA/JPL/MSSS/USGS CTX (Mars 2020 science investigation mosaic)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    id: 'hirise',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona/USGS HiRISE (Mars 2020 TRN orthomosaic)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    // The crater rim west of the TRN mosaic (Witch Hazel Hill, Crocodile Bridge), tone-matched to it.
    id: 'hirise-west',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona HiRISE ESP_085859_1985 (2024-11-19)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    id: 'hirise-rover',
    toggle: 'hirise',
    credit: 'NASA/JPL/University of Arizona HiRISE ESP_085859_1985 (2024-11-19)',
    tint: GROUND_TINT,
    grade: TINTED_GRADE,
  },
  {
    id: 'colour-wash',
    toggle: 'viking',
    tiles: 'viking-hd',
    credit: 'Colour from the Viking MDIM 2.1 mosaic over CTX/HiRISE (approximate)',
    rectangle: { west: 77.0, south: 17.6, east: 78.58, north: 19.28 },
    grade: WASH_GRADE,
  },
];

/**
 * Adds the imagery tiers to a scene in draw order (layer metadata is fetched in parallel), each shown
 * per `visible(toggle)`. Resolves false if any tier's metadata is missing.
 */
export async function addImageryTiers(
  scene: MarsScene,
  visible: (toggle: LayerId) => boolean = () => true,
): Promise<boolean> {
  let ok = true;
  const metas = await Promise.all(IMAGERY.map((l) => loadImageryLayer(l.tiles ?? l.id)));
  if (scene.isDestroyed()) return false;
  for (const [i, { id, toggle, credit, tiles, rectangle, grade, tint }] of IMAGERY.entries()) {
    const meta = metas[i];
    if (!meta) {
      ok = false;
      continue;
    }
    scene.addTiledLayer({
      id,
      url: dataUrl(`tiles/imagery/${tiles ?? id}/{z}/{x}/{y}.webp?v=${DATA_VERSION}`),
      rectangle: rectangle ?? meta.rectangle,
      minLevel: meta.minLevel,
      maxLevel: meta.maxLevel,
      credit,
      ...(grade ? { grade } : {}),
      ...(tint ? { tint } : {}),
    });
    scene.setLayerVisible(id, visible(toggle));
  }
  return ok;
}

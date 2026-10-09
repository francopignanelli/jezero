import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import type { ViewState } from '../../render/marsScene';
import { currentScene } from '../../render/sceneRegistry';

/** Below this tilt the view counts as top-down (2D). */
const FLAT_DEG = 12;
/** Oblique view the 3D button turns to (capped by what the height allows). */
const OBLIQUE_DEG = 55;

/**
 * Map view controls, as in Google Maps: a compass that turns with the view (click: north up) and a
 * 2D / 3D toggle (straight down, or an oblique view of the same place). Far from the surface the
 * view is always straight down, so 3D is unavailable there.
 */
export function ViewControl() {
  const { t } = useTranslation();
  const ready = useApp((s) => s.sceneReady);
  const [view, setView] = useState<ViewState | null>(null);

  useEffect(() => {
    if (!ready) return;
    return currentScene()?.onViewChange(setView);
  }, [ready]);

  if (!view) return null;
  const flat = view.tiltDeg < FLAT_DEG;
  const canTilt = view.maxTiltDeg >= FLAT_DEG + 8;
  const northUp = Math.abs(((view.headingDeg + 540) % 360) - 180) > 178;

  return (
    <div className="view-control" role="group" aria-label={t('view.group')}>
      <button
        type="button"
        className="map-button map-button-round"
        aria-label={t('view.north')}
        title={t('view.north')}
        disabled={northUp}
        onClick={() => void currentScene()?.resetNorth()}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          style={{ transform: `rotate(${-view.headingDeg}deg)` }}
        >
          <path d="M12 3.5l3.2 8.5H8.8z" fill="#e8613c" />
          <path d="M12 20.5l-3.2-8.5h6.4z" fill="currentColor" opacity="0.75" />
        </svg>
      </button>
      <button
        type="button"
        className="map-button map-button-round view-tilt"
        aria-pressed={!flat}
        aria-label={flat ? t('view.tilt') : t('view.topDown')}
        title={canTilt || !flat ? (flat ? t('view.tilt') : t('view.topDown')) : t('view.tiltFar')}
        disabled={flat && !canTilt}
        onClick={() => void currentScene()?.setTilt(flat ? OBLIQUE_DEG : 0)}
      >
        {flat ? '3D' : '2D'}
      </button>
    </div>
  );
}

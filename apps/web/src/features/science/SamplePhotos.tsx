import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataUrl, DATA_VERSION } from '../../config';
import type { SampleImage } from '../../data/catalog';
import { IconX } from '../../ui/icons';

const src = (path: string) => dataUrl(`${path}?v=${DATA_VERSION}`);

/** "Drill hole and abraded patch · Navcam, sol 509" */
function useCaption() {
  const { t } = useTranslation();
  return (img: SampleImage) =>
    `${t(`samplePhoto.kind.${img.kind}`)} · ${img.camera}${img.sol !== null ? `, ${t('samplePhoto.sol', { sol: img.sol })}` : ''}`;
}

/**
 * Thumbnails of NASA's photo(s) for a sample: where the core was drilled, or the core in its tube.
 * A click opens the photo large, with what it shows, the camera and the credit.
 */
export function SamplePhotos({
  photos,
  size = 'md',
}: {
  photos: SampleImage[];
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const caption = useCaption();
  const [open, setOpen] = useState<SampleImage | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <span className={`sample-photos sample-photos-${size}`}>
        {photos.map((p) => (
          <button
            key={p.number}
            type="button"
            className="sample-thumb"
            aria-label={t('samplePhoto.view', { n: p.number, name: p.name })}
            title={caption(p)}
            onClick={() => setOpen(p)}
          >
            <img src={src(p.thumb)} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </span>
      {open && <SamplePhotoDialog photo={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SamplePhotoDialog({ photo, onClose }: { photo: SampleImage; onClose(): void }) {
  const { t } = useTranslation();
  const caption = useCaption();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // only this dialog closes, not the 360° view behind it
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div className="sample-dialog-backdrop" onClick={onClose}>
      <figure
        className="sample-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="popover-close sample-dialog-close"
          aria-label={t('samplePhoto.close')}
          onClick={onClose}
        >
          <IconX />
        </button>
        <img src={src(photo.file)} alt={`${caption(photo)}: ${photo.name}`} />
        <figcaption>
          <strong id="sample-dialog-title">
            {t('samplePhoto.title', { n: photo.number, name: photo.name })}
          </strong>
          <span>{caption(photo)}</span>
          <span className="sample-credit">
            {t('samplePhoto.credit', { credit: photo.credit })} ·{' '}
            <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
              {t('samplePhoto.source')}
            </a>
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

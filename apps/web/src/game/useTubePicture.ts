import { useEffect, useState } from 'react';
import { tubePicture } from './world/tube';

/** The sample tube's picture (NASA's model, drawn once), or null while it is drawn. */
export function useTubePicture(horizontal = false): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void tubePicture(horizontal).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [horizontal]);
  return url;
}

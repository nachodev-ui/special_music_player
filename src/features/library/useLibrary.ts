import { useEffect, useMemo, useState } from 'react';
import type { Library } from '../../../shared/contracts';

let restorePromise: Promise<Library | null> | undefined;
export function useLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    restorePromise ??= window.desktop?.restoreLibrary() ?? Promise.resolve(null);
    restorePromise.then((result) => { if (active) setLibrary(result); })
      .catch(() => { if (active) setError('No pude abrir la última carpeta. Puedes elegirla de nuevo.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const desktop = window.desktop;
    if (!library || !desktop) return;
    let active = true, cursor = 0;
    const pending = library.tracks.filter(track => !track.artwork);
    setArtwork({});
    // Keep the library usable while main-process searches fill in each cover.
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (active && cursor < pending.length) {
        const track = pending[cursor++];
        try {
          const cover = await desktop.resolveArtwork(track.id);
          if (active && cover) setArtwork(previous => ({ ...previous, [track.id]: cover }));
        } catch { /* The decorative placeholder also works offline. */ }
      }
    });
    void Promise.all(workers);
    return () => { active = false; };
  }, [library]);
  const resolvedLibrary = useMemo(() => library ? {
    ...library,
    tracks: library.tracks.map(track => artwork[track.id] ? { ...track, artwork: artwork[track.id] } : track),
  } : null, [library, artwork]);
  async function chooseFolder() {
    if (!window.desktop) { setError('Abre la aplicación de escritorio con npm start para elegir una carpeta.'); return; }
    setLoading(true); setError('');
    try { const next = await window.desktop.chooseFolder(); if (next) setLibrary(next); }
    catch { setError('No pude leer esa carpeta. Comprueba que esté disponible y tengas permiso para abrirla.'); }
    finally { setLoading(false); }
  }
  return { library: resolvedLibrary, loading, error, chooseFolder };
}

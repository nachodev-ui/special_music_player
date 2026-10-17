import { useEffect, useState } from 'react';
import type { DesktopAPI, Playlist } from '../../../shared/contracts';

export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.desktop?.getPlaylists().then(items => { if (active) setPlaylists(items); })
      .catch(() => { if (active) setError('No pude leer tus playlists.'); });
    return () => { active = false; };
  }, []);
  async function run(operation: (desktop: DesktopAPI) => Promise<Playlist[] | null>): Promise<Playlist[] | null> {
    try {
      if (!window.desktop) throw new Error('Abre la aplicación de escritorio para editar playlists.');
      const next = await operation(window.desktop);
      if (next) { setPlaylists(next); setError(''); }
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude guardar la playlist.');
      return null;
    }
  }
  return { playlists, error, clearError: () => setError(''),
    create: (name: string) => run(desktop => desktop.createPlaylist(name)),
    rename: (id: string, name: string) => run(desktop => desktop.renamePlaylist(id, name)),
    remove: (id: string) => run(desktop => desktop.deletePlaylist(id)),
    addTrack: (id: string, path: string) => run(desktop => desktop.addPlaylistTrack(id, path)),
    removeTrack: (id: string, path: string) => run(desktop => desktop.removePlaylistTrack(id, path)),
    chooseCover: (id: string) => run(desktop => desktop.choosePlaylistCover(id)),
    clearCover: (id: string) => run(desktop => desktop.clearPlaylistCover(id)),
  };
}

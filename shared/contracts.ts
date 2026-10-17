export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  filename: string;
  path: string;
  format: 'MP3' | 'FLAC';
  duration: number;
  artwork?: string;
  url: string;
}

export interface Library {
  folder: string;
  folderName: string;
  tracks: Track[];
  skipped: number;
}

export interface Playlist {
  id: string;
  name: string;
  paths: string[];
  cover: string | null;
}

export type SongLyrics =
  | { status: 'found'; plain: string; synced: string | null; instrumental: boolean }
  | { status: 'not-found' | 'unavailable' };

export interface DesktopAPI {
  platform: string;
  getGiftPreferences(): Promise<Record<string, string> | null>;
  chooseFolder(): Promise<Library | null>;
  restoreLibrary(): Promise<Library | null>;
  resolveArtwork(trackId: string): Promise<string | null>;
  getLyrics(trackId: string): Promise<SongLyrics>;
  getSongNote(trackId: string): Promise<string>;
  saveSongNote(trackId: string, note: string): Promise<string>;
  onFlushSongNotes(flush: () => Promise<boolean>): () => void;
  getPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string): Promise<Playlist[]>;
  renamePlaylist(id: string, name: string): Promise<Playlist[]>;
  deletePlaylist(id: string): Promise<Playlist[]>;
  addPlaylistTrack(id: string, path: string): Promise<Playlist[]>;
  removePlaylistTrack(id: string, path: string): Promise<Playlist[]>;
  choosePlaylistCover(id: string): Promise<Playlist[] | null>;
  clearPlaylistCover(id: string): Promise<Playlist[]>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
}

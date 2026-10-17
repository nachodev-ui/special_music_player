import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile, selectCover } from 'music-metadata';
import type { Library, Track } from '../shared/contracts';
import { ArtworkCache, filenameTags } from './artwork';

export const allowedAudio = new Map<string, string>();
export const allowedTracks = new Map<string, Track>();

export async function scanFolder(folder: string, artworkCache: ArtworkCache): Promise<Library> {
  const files: string[] = [];
  let skipped = 0;
  async function walk(directory: string, isRoot = false): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (isRoot) throw error; skipped++; return; }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && /\.(mp3|flac)$/i.test(entry.name)) files.push(filename);
    }
  }
  await walk(folder, true);
  files.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const tracks: Track[] = new Array(files.length);
  const folderCovers = new Map<string, Promise<string | undefined>>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor++;
      const filename = files[index];
      const id = createHash('sha256').update(filename).digest('hex');
      const inferred = filenameTags(filename);
      const track: Track = {
        id, filename: path.basename(filename), path: filename,
        title: inferred.title,
        artist: inferred.artist, album: 'Desde tu carpeta',
        format: path.extname(filename).toLowerCase() === '.flac' ? 'FLAC' : 'MP3',
        duration: 0, url: `usagi://audio/${id}`,
      };
      try {
        const metadata = await parseFile(filename, { duration: true });
        track.title = metadata.common.title || track.title;
        track.artist = metadata.common.artist || track.artist;
        track.album = metadata.common.album || track.album;
        track.duration = metadata.format.duration || 0;
        const cover = selectCover(metadata.common.picture);
        if (cover) track.artwork = await artworkCache.store(cover.data);
      } catch { /* A playable file without tags still belongs in the library. */ }
      if (!track.artwork) {
        const directory = path.dirname(filename);
        if (!folderCovers.has(directory)) folderCovers.set(directory, artworkCache.folderCover(directory));
        track.artwork = await folderCovers.get(directory);
      }
      if (!track.artwork) track.artwork = (await artworkCache.cached(track)).artwork;
      tracks[index] = track;
    }
  }));
  allowedAudio.clear();
  allowedTracks.clear();
  tracks.forEach((track, index) => { allowedAudio.set(track.id, files[index]); allowedTracks.set(track.id, track); });
  return { folder, folderName: path.basename(folder) || folder, tracks, skipped };
}

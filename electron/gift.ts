import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeAtomicJson } from './atomicJson';

export interface GiftManifest {
  version: 1;
  tracks: { id: string; file: string }[];
  playlists: { id: string; name: string; paths: string[]; cover: string | null }[];
  notes: Record<string, string>;
  preferences: Record<string, string>;
}
function mediaPath(directory: string, relative: string): string {
  const resolved = path.resolve(directory, relative);
  const inside = path.relative(directory, resolved);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !/\.(mp3|flac)$/i.test(relative)) throw new Error('Ruta de regalo no válida.');
  return resolved;
}
export async function initializeGift(seedDirectory: string, userData: string): Promise<void> {
  const marker = path.join(userData, 'gift-initialized.json');
  try { await stat(marker); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const gift: GiftManifest = JSON.parse(await readFile(path.join(seedDirectory, 'manifest.json'), 'utf8'));
  if (gift.version !== 1 || !Array.isArray(gift.tracks) || !gift.tracks.length) throw new Error('El regalo no contiene canciones.');
  const folder = path.join(userData, 'gift-library');
  const paths = new Map<string, string>(), ids = new Map<string, string>();
  for (const track of gift.tracks) {
    if (!/^[a-f0-9]{64}$/.test(track.id)) throw new Error('Canción de regalo no válida.');
    const source = mediaPath(path.join(seedDirectory, 'music'), track.file);
    const target = mediaPath(folder, track.file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
    paths.set(track.file, target);
    ids.set(track.id, createHash('sha256').update(target).digest('hex'));
  }
  for (const directory of ['playlist-covers', 'artwork-cache', 'lyrics-cache-v1']) {
    const source = path.join(seedDirectory, directory);
    try { await stat(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    await cp(source, path.join(userData, directory), { recursive: true });
  }
  const playlists = gift.playlists.map(item => ({ ...item, paths: item.paths.map(file => {
    const target = paths.get(file);
    if (!target) throw new Error('Falta una canción de la playlist.');
    return target;
  }) }));
  const notes = Object.fromEntries(Object.entries(gift.notes).map(([id, note]) => {
    const target = ids.get(id);
    if (!target) throw new Error('Falta una canción con dedicatoria.');
    return [target, note];
  }));
  const preferences = { ...gift.preferences };
  const favorites: string[] = JSON.parse(preferences['usagi-favorites'] || '[]');
  preferences['usagi-favorites'] = JSON.stringify(favorites.map(id => ids.get(id)).filter(Boolean));
  await writeAtomicJson(path.join(userData, 'playlists.json'), playlists);
  await writeAtomicJson(path.join(userData, 'song-notes.json'), notes);
  await writeAtomicJson(path.join(userData, 'gift-preferences.json'), preferences);
  await writeAtomicJson(path.join(userData, 'library.json'), { folder });
  // Written last: an interrupted first launch retries before exposing any editor.
  await writeAtomicJson(marker, { version: 1 });
}
export async function readGiftPreferences(userData: string): Promise<Record<string, string> | null> {
  try { return JSON.parse(await readFile(path.join(userData, 'gift-preferences.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

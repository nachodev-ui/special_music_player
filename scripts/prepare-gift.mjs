import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.USAGI_GIFT_SOURCE || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Usagi Music Room');
const read = async (name, fallback) => { try { return JSON.parse(await readFile(path.join(source, name), 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; } };
await mkdir(path.join(root, '.verification'), { recursive: true });
const snapshot = await mkdtemp(path.join(root, '.verification/gift-export-'));
await cp(path.join(source, 'Local Storage'), path.join(snapshot, 'Local Storage'), { recursive: true, filter: filename => path.basename(filename) !== 'LOCK' });
execFileSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(root, 'scripts/read-gift-preferences.cjs'), '--snapshot=' + snapshot], { windowsHide: true, stdio: 'inherit', timeout: 30000 });
const origins = JSON.parse(await readFile(path.join(snapshot, 'preferences.json'), 'utf8'));
const origin = process.env.USAGI_GIFT_ORIGIN || (Object.keys(origins.dev).length ? 'dev' : 'file');
if (!origins[origin]) throw new Error('Origen de preferencias no válido.');
const folder = (await read('library.json')).folder;
const playlists = await read('playlists.json', []), notes = await read('song-notes.json', {});
const filenames = new Set((await readdir(folder, { recursive: true })).filter(file => /\.(mp3|flac)$/i.test(file)).map(file => path.join(folder, file)));
for (const playlist of playlists) for (const file of playlist.paths) filenames.add(file);
if (!filenames.size) throw new Error('No hay canciones para el regalo.');
const destination = path.join(snapshot, 'gift');
await mkdir(path.join(destination, 'music'), { recursive: true });
const paths = new Map(), tracks = [];
for (const filename of [...filenames].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
  const info = await stat(filename);
  if (!info.isFile()) throw new Error('Falta la canción: ' + filename);
  const id = createHash('sha256').update(filename).digest('hex');
  const file = String(tracks.length + 1).padStart(3, '0') + '/' + path.basename(filename);
  const target = path.join(destination, 'music', file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(filename, target);
  paths.set(filename, file);
  tracks.push({ id, file });
}
const ids = new Set(tracks.map(track => track.id));
const includedNotes = Object.fromEntries(Object.entries(notes).filter(([id]) => ids.has(id)));
for (const directory of ['artwork-cache', 'lyrics-cache-v1']) {
  try { await stat(path.join(source, directory)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  await cp(path.join(source, directory), path.join(destination, directory), { recursive: true, filter: file => !file.endsWith('.tmp') });
}
for (const playlist of playlists) if (playlist.cover) {
  await mkdir(path.join(destination, 'playlist-covers'), { recursive: true });
  await cp(path.join(source, 'playlist-covers', playlist.cover), path.join(destination, 'playlist-covers', playlist.cover));
}
const manifest = { version: 1, tracks, playlists: playlists.map(item => ({ ...item, paths: item.paths.map(file => paths.get(file)) })), notes: includedNotes, preferences: origins[origin] };
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Only successful exports replace the resource used by the packager.
const seed = path.join(root, 'gift-seed');
const backup = path.join(snapshot, 'previous-seed');
try { await rename(seed, backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await rename(destination, seed); } catch (error) {
  try { await rename(backup, seed); } catch {}
  throw error;
}
if (path.relative(root, backup).startsWith('.verification' + path.sep)) await rm(backup, { recursive: true, force: true });
console.log(JSON.stringify({ songs: tracks.length, playlists: playlists.length, notes: Object.keys(includedNotes).length, origin, preferences: origins[origin], unusedOlderNotes: Object.keys(notes).length - Object.keys(includedNotes).length }, null, 2));

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = process.cwd();
await mkdir(path.join(root, '.verification'), { recursive: true });
const bundled = await build({ entryPoints: ['electron/gift.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { initializeGift } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const seed = path.join(root, 'gift-seed');
const gift = JSON.parse(await readFile(path.join(seed, 'manifest.json'), 'utf8'));
test('relocates all gift songs, playlist order, notes, favorites and cover to a fresh recipient profile', async () => {
  const profile = await mkdtemp(path.join(root, '.verification/recipient-'));
  await initializeGift(seed, profile);
  const library = JSON.parse(await readFile(path.join(profile, 'library.json')));
  const playlists = JSON.parse(await readFile(path.join(profile, 'playlists.json')));
  const notes = JSON.parse(await readFile(path.join(profile, 'song-notes.json')));
  const preferences = JSON.parse(await readFile(path.join(profile, 'gift-preferences.json')));
  const ids = new Map();
  for (const track of gift.tracks) {
    const file = path.join(library.folder, track.file);
    assert.deepEqual(await readFile(file), await readFile(path.join(seed, 'music', track.file)));
    const id = createHash('sha256').update(file).digest('hex');
    ids.set(track.id, id);
    assert.equal(notes[id], gift.notes[track.id]);
  }
  assert.deepEqual(playlists.map(p => p.paths), gift.playlists.map(p => p.paths.map(f => path.join(library.folder, f))));
  for (const playlist of playlists) if (playlist.cover) assert.deepEqual(await readFile(path.join(profile, 'playlist-covers', playlist.cover)), await readFile(path.join(seed, 'playlist-covers', playlist.cover)));
  assert.deepEqual(JSON.parse(preferences['usagi-favorites']), JSON.parse(gift.preferences['usagi-favorites']).map(id => ids.get(id)));
  // Opening again must preserve recipient edits and deletions.
  await writeFile(path.join(profile, 'playlists.json'), '[]');
  await writeFile(path.join(profile, 'song-notes.json'), '{}');
  await initializeGift(seed, profile);
  assert.equal(await readFile(path.join(profile, 'playlists.json'), 'utf8'), '[]');
  assert.equal(await readFile(path.join(profile, 'song-notes.json'), 'utf8'), '{}');
});
test('rejects a manifest that tries to escape the bundled music directory', async () => {
  const malicious = await mkdtemp(path.join(root, '.verification/bad-gift-'));
  const profile = await mkdtemp(path.join(root, '.verification/rejected-recipient-'));
  await writeFile(path.join(malicious, 'manifest.json'), JSON.stringify({ ...gift, tracks: [{ id: 'a'.repeat(64), file: '../outside.mp3' }] }));
  await assert.rejects(initializeGift(malicious, profile), /Ruta de regalo/);
  await assert.rejects(readFile(path.join(profile, 'gift-initialized.json')), { code: 'ENOENT' });
});

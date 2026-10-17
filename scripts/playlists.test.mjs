import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireModule = createRequire(import.meta.url);
async function load(relative, dependencies = {}) {
  const source = await readFile(path.join(root, relative), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const module = { exports: {} };
  runInNewContext(outputText, { module, exports: module.exports, require: name => dependencies[name] ?? requireModule(name), setTimeout, clearTimeout, process, Buffer }, { filename: relative });
  return module.exports;
}
const atomic = await load('electron/atomicJson.ts');
const allowedTracks = new Map();
let resized;
const image = { isEmpty: () => false, getSize: () => ({ width: 1024, height: 768 }), resize: dimensions => { resized = dimensions; return { toPNG: () => Buffer.from('png') }; }, toPNG: () => Buffer.from('png') };
const { Playlists } = await load('electron/playlists.ts', {
  electron: { nativeImage: { createFromBuffer: () => image } },
  './library': { allowedTracks },
  './atomicJson': atomic,
});
const song = path.join(root, 'especial_songs', 'example.mp3');

async function scratch(t) {
  const directory = await mkdtemp(path.join(root, '.playlist-tests-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return directory;
}

test('creates, renames and saves path-based playlists atomically', async t => {
  const directory = await scratch(t);
  allowedTracks.set('song', { path: song });
  const playlists = new Playlists(directory);
  const [created] = await playlists.create('  Mi música  ');
  await Promise.all([playlists.rename(created.id, 'Otra'), playlists.addTrack(created.id, song)]);
  await playlists.flush();
  const [restored] = await new Playlists(directory).list();
  assert.equal(restored.name, 'Otra');
  assert.deepEqual([...restored.paths], [song]);
  assert.deepEqual(await readdir(directory), ['playlists.json']);
  await playlists.removeTrack(created.id, song);
  assert.deepEqual([...((await playlists.list())[0].paths)], []);
  await playlists.delete(created.id);
  assert.equal((await new Playlists(directory).list()).length, 0);
});

test('rejects invalid data and preserves a damaged JSON file', async t => {
  const directory = await scratch(t);
  const playlists = new Playlists(directory);
  assert.throws(() => playlists.create('   '));
  assert.throws(() => playlists.addTrack('not-an-id', '../song.mp3'));
  const filename = path.join(directory, 'playlists.json');
  await writeFile(filename, '{broken', 'utf8');
  await assert.rejects(new Playlists(directory).create('No sobrescribir'));
  assert.equal(await readFile(filename, 'utf8'), '{broken');
});

test('retains missing paths and stores a resized cover under userData', async t => {
  const directory = await scratch(t);
  allowedTracks.set('song', { path: song });
  const playlists = new Playlists(directory);
  const [created] = await playlists.create('Portada');
  await playlists.addTrack(created.id, song);
  allowedTracks.clear();
  assert.deepEqual([...((await new Playlists(directory).list())[0].paths)], [song]);
  const source = path.join(directory, 'chosen.jpg');
  await writeFile(source, 'image bytes');
  const [covered] = await playlists.setCover(created.id, source);
  assert.deepEqual(JSON.parse(JSON.stringify(resized)), { width: 512, height: 384 });
  assert.match(covered.cover, /^usagi:\/\/playlist-cover\/[a-f0-9-]+\.png$/);
  assert.equal(await readFile(await playlists.coverFile(covered.cover.split('/').pop()), 'utf8'), 'png');
  const [plain] = await playlists.clearCover(created.id);
  assert.equal(plain.cover, null);
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(root, '.artwork-tests-'));
await build({ entryPoints: [path.join(root, 'electron/artwork.ts'), path.join(root, 'electron/library.ts')], outdir: scratch, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
const { ArtworkCache, artworkURLs, filenameTags, matchArtwork } = await import(pathToFileURL(path.join(scratch, 'artwork.js')));
const { scanFolder } = await import(pathToFileURL(path.join(scratch, 'library.js')));
after(async () => {
  const relative = path.relative(root, scratch);
  assert.ok(relative.startsWith('.artwork-tests-') && !relative.includes(path.sep));
  await rm(scratch, { recursive: true, force: true });
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQqsAAAAASUVORK5CYII=', 'base64');
const track = { id: 'song', title: 'I Will', artist: 'Mitski', album: 'Bury Me at Makeout Creek', filename: 'Mitski - I Will.mp3', format: 'MP3', duration: 2, url: 'usagi://audio/song' };
const result = { kind: 'song', trackName: track.title, artistName: track.artist, collectionName: track.album, artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/cover/100x100bb.jpg' };
const cachePath = name => path.join(scratch, name);
const mockFetch = calls => async url => {
  calls.push(String(url));
  return String(url).includes('itunes.apple.com/search') ? Response.json({ results: [result] }) : new Response(png);
};
function mp3(picture) {
  const frames = [];
  function tag(id, data) { const head = Buffer.alloc(10); head.write(id); head.writeUInt32BE(data.length, 4); return Buffer.concat([head, data]); }
  frames.push(tag('TIT2', Buffer.from('\x00I Will')), tag('TPE1', Buffer.from('\x00Mitski')), tag('TALB', Buffer.from('\x00Bury Me at Makeout Creek')));
  if (picture) frames.push(tag('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\x00'), Buffer.from([3, 0]), picture])));
  const tags = Buffer.concat(frames), head = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) head[9 - i] = (tags.length >> (7 * i)) & 127;
  const audioFrame = Buffer.alloc(417); Buffer.from([255, 251, 144, 0]).copy(audioFrame);
  return Buffer.concat([head, tags, ...Array.from({ length: 10 }, () => audioFrame)]);
}

test('embedded art wins over folder art and a previously cached online cover', async () => {
  const dir = cachePath('embedded'); await mkdir(dir);
  await writeFile(path.join(dir, 'song.mp3'), mp3(png));
  await writeFile(path.join(dir, 'COVER.JPG'), Buffer.concat([png, Buffer.from('different folder cover')]));
  const cache = new ArtworkCache(cachePath('embedded-data'), { fetch: async url => String(url).includes('itunes.apple.com/search') ? Response.json({ results: [result] }) : new Response(Buffer.concat([png, Buffer.from('online')])), searchInterval: 0 });
  const online = await cache.online(track);
  const library = await scanFolder(dir, cache);
  assert.equal(library.tracks[0].title, 'I Will');
  assert.equal(library.tracks[0].artist, 'Mitski');
  assert.notEqual(library.tracks[0].artwork, online);
  assert.equal(await cache.store(png), library.tracks[0].artwork);
  assert.notEqual(await cache.folderCover(dir), library.tracks[0].artwork);
});

test('folder cover wins over cached online art; corrupt candidates fall through', async () => {
  const dir = cachePath('folder'); await mkdir(dir);
  await writeFile(path.join(dir, 'song.mp3'), mp3());
  await writeFile(path.join(dir, 'cover.jpg'), 'not an image');
  const folderImage = Buffer.concat([png, Buffer.from('folder')]);
  await writeFile(path.join(dir, 'FoLdEr.PNG'), folderImage);
  const calls = [], cache = new ArtworkCache(cachePath('folder-data'), { fetch: mockFetch(calls), searchInterval: 0 });
  const online = await cache.online(track);
  const library = await scanFolder(dir, cache);
  assert.equal(library.tracks[0].artwork, await cache.store(folderImage));
  assert.notEqual(library.tracks[0].artwork, online);
  assert.equal(calls.length, 2);
});

test('online searches deduplicate, request high resolution, and survive restart offline', async () => {
  const calls = [], cache = new ArtworkCache(cachePath('online-data'), { fetch: mockFetch(calls), searchInterval: 0 });
  const [a, b] = await Promise.all([cache.online(track), cache.online({ ...track, id: 'duplicate' })]);
  assert.equal(a, b); assert.match(a, /^usagi:\/\/artwork\/[a-f0-9]{64}$/);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).searchParams.get('term'), 'I Will Mitski');
  assert.match(calls[1], /3000x3000bb/);
  const offline = new ArtworkCache(cachePath('online-data'), { fetch: () => { throw new Error('should not fetch'); } });
  assert.equal(await offline.online(track), a);
  const file = offline.files.get(a.split('/').at(-1));
  assert.deepEqual(await readFile(file.filename), png);
  const dir = cachePath('online-song'); await mkdir(dir); await writeFile(path.join(dir, 'song.mp3'), mp3());
  assert.equal((await scanFolder(dir, offline)).tracks[0].artwork, a);
});

test('a rejected large rendition falls back automatically', async () => {
  const calls = [];
  const cache = new ArtworkCache(cachePath('resize'), { searchInterval: 0, fetch: async url => {
    calls.push(String(url));
    if (String(url).includes('itunes.apple.com')) return Response.json({ results: [result] });
    return String(url).includes('3000x3000') ? new Response(null, { status: 404 }) : new Response(png);
  } });
  assert.ok(await cache.online(track));
  assert.match(calls[1], /3000x3000/); assert.match(calls[2], /1200x1200/);
});

test('empty and failed searches are cached across restarts, then expire', async () => {
  for (const [name, fetcher, ttl] of [['missing', async () => Response.json({ results: [] }), 7 * 86400000], ['offline', async () => { throw new Error('offline'); }, 15 * 60000]]) {
    const directory = cachePath(name); let calls = 0;
    const cache = new ArtworkCache(directory, { searchInterval: 0, fetch: (...args) => { calls++; return fetcher(...args); } });
    assert.equal(await cache.online(track), undefined); assert.equal(await cache.online(track), undefined); assert.equal(calls, 1);
    const second = new ArtworkCache(directory, { searchInterval: 0, fetch: (...args) => { calls++; return fetcher(...args); } });
    assert.equal(await second.online(track), undefined); assert.equal(calls, 1);
    const recordPath = path.join(directory, 'artwork-cache', 'v1');
    const jsonFile = (await readdir(recordPath)).find(file => file.endsWith('.json'));
    const entry = JSON.parse(await readFile(path.join(recordPath, jsonFile), 'utf8'));
    assert.ok(entry.expiresAt > Date.now() && entry.expiresAt <= Date.now() + ttl);
    await writeFile(path.join(recordPath, jsonFile), JSON.stringify({ ...entry, expiresAt: 1 }));
    await new ArtworkCache(directory, { searchInterval: 0, fetch: (...args) => { calls++; return fetcher(...args); } }).online(track);
    assert.equal(calls, 2);
  }
});

test('offline tracks with broken tags remain playable and have no broken artwork URL', async () => {
  const dir = cachePath('broken'); await mkdir(dir); await writeFile(path.join(dir, 'Mitski - I Will.mp3'), 'broken tags');
  const cache = new ArtworkCache(cachePath('broken-data'), { fetch: async () => { throw new Error('offline'); }, searchInterval: 0 });
  const library = await scanFolder(dir, cache);
  assert.equal(library.tracks.length, 1); assert.equal(library.tracks[0].title, 'I Will'); assert.equal(library.tracks[0].artist, 'Mitski');
  assert.equal(await cache.online(library.tracks[0]), undefined); assert.equal(library.tracks[0].artwork, undefined);
});

test('matching rejects unrelated titles and artists and favors the matching album', () => {
  assert.equal(matchArtwork(track, [{ ...result, artistName: 'Another Artist' }, { ...result, trackName: 'Another Song' }]), undefined);
  assert.equal(matchArtwork(track, [{ ...result, collectionName: 'Compilation' }, result]), result);
  assert.deepEqual(filenameTags('01. Björk - Jóga.mp3'), { artist: 'Björk', title: 'Jóga' });
  assert.deepEqual(artworkURLs({ ...result, artworkUrl100: 'https://untrusted.example/100x100bb.jpg' }), []);
});

test('a folder change cancels queued searches and search starts are throttled', async () => {
  const times = [];
  const cache = new ArtworkCache(cachePath('queue'), { searchInterval: 35, fetch: async () => { times.push(Date.now()); return Response.json({ results: [] }); } });
  await Promise.all([cache.online(track), cache.online({ ...track, title: 'Second Song' }), cache.online({ ...track, title: 'Third Song' }, () => false)]);
  assert.equal(times.length, 2); assert.ok(times[1] - times[0] >= 30);
});

test('a corrupt image cache is rebuilt and a read-only cache degrades to a data URL', async () => {
  const directory = cachePath('corrupt'), calls = [];
  const cache = new ArtworkCache(directory, { fetch: mockFetch(calls), searchInterval: 0 });
  const cover = await cache.online(track);
  await writeFile(cache.files.get(cover.split('/').at(-1)).filename, 'corrupt');
  const rebuilt = new ArtworkCache(directory, { fetch: mockFetch(calls), searchInterval: 0 });
  assert.equal(await rebuilt.online(track), cover);
  assert.deepEqual(await readFile(rebuilt.files.get(cover.split('/').at(-1)).filename), png);
  const blocked = cachePath('blocked'); await writeFile(blocked, 'not a directory');
  assert.match(await new ArtworkCache(blocked).store(png), /^data:image\/png;base64,/);
});

// Untagged names from the user's library should still find their matching songs.
test('untagged filenames tolerate translation labels and title-first Japanese uploads', () => {
  const mitski=filenameTags('mitski i will (español).mp3');
  assert.equal(matchArtwork({...track,...mitski},[result]),result);
  const persona=filenameTags('【和訳】Color Your Night - Azumi Takahashi／Lotus Juice.mp3');
  const artwork={...result,trackName:'Color Your Night',artistName:'Lotus Juice / Azumi Takahashi / ATLUS Sound Team / ATLUS GAME MUSIC'};
  assert.equal(persona.title,'Color Your Night');
  assert.equal(matchArtwork({...track,...persona},[artwork]),artwork);
  assert.equal(matchArtwork({...track,title:'Mitski Other Song (español)',artist:'Artista desconocido'},[result]),undefined);
});

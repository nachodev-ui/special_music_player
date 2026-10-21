import { spawn } from 'node:child_process';
import { stat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd();
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const executable = path.join(root, `release/Sukis-Room-Regalo-${version}.exe`);
await stat(executable);
await mkdir(path.join(root, '.verification'), { recursive: true });
const profile = await mkdtemp(path.join(root, '.verification/portable-recipient-'));
const manifest = JSON.parse(await readFile(path.join(root, 'gift-seed/manifest.json')));
const port = 19347;
async function launch() {
  const child = spawn(executable, ['--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--host-resolver-rules=MAP * ~NOTFOUND'], { windowsHide: true, stdio: 'ignore' });
  console.log('Launching portable', { pid: child.pid, profile });
  child.on('error', error => console.error(error));
  child.on('exit', (code, signal) => console.log('Portable exit', { code, signal }));
  let pages;
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error("Portable exited before startup: " + child.exitCode);
    try { pages = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (pages.some(p => p.type === 'page')) break; } catch {}
    await delay(500);
  }
  const page = pages?.find(p => p.type === 'page');
  assert.ok(page, 'Packaged app must start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { const item = pending.get(message.id); clearTimeout(item.timer); item.resolve(message); pending.delete(message.id); } });
  ws.addEventListener('close', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Test connection closed')); } pending.clear(); });
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  // DNS is disabled by the launch flag; Chromium's offline emulation also blocks usagi://.
  await command('Network.enable');
  const evaluate = async expression => {
    const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result.result.value;
  };
  for(let i=0;i<60;i++){ if(await evaluate('!!window.desktop && !!document.querySelector("button")'))break; await delay(250); }
  return { child, ws, evaluate, close: async () => { const exit = new Promise(resolve => child.once('exit', resolve)); await evaluate('window.desktop.windowControl("close")').catch(error => { if (!error.message.includes("connection closed")) throw error; }); ws.close(); await Promise.race([exit, delay(15000).then(() => { if (child.exitCode === null) throw new Error('App did not close after saving'); })]); await delay(700); } };
}
const first = await launch();
try {
  const result = await first.evaluate('(' + (async () => {
    let library;
    for (let i = 0; i < 30; i++) {
      try { library = await window.desktop.restoreLibrary(); break; }
      catch (error) { if (!String(error).includes('cargando una carpeta')) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
    }
    if (!library) throw new Error('Library did not finish loading');
    const playlists = await window.desktop.getPlaylists();
    const tracks = await Promise.all(library.tracks.map(async track => {
      const audio = new Audio();
      const loaded = new Promise((resolve, reject) => { audio.onloadedmetadata = resolve; audio.onerror = () => reject(new Error('Cannot decode ' + track.title)); });
      audio.src = track.url;
      await loaded;
      const duration = audio.duration;
      audio.src = '';
      return { id: track.id, title: track.title, path: track.path, note: await window.desktop.getSongNote(track.id), artwork: track.artwork, duration };
    }));
    const imageLoads = source => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image.naturalWidth > 0); image.onerror = () => resolve(false); image.src = source; });
    const cover = playlists[0].cover ? await imageLoads(playlists[0].cover) : null;
    const pictures = await Promise.all(library.tracks.map(async track => track.artwork ? imageLoads(track.artwork) : null));
    const roomPhoto = await imageLoads(new URL('./photos/room/ascensor.png', location.href).href);
    const audio = new Audio(library.tracks[0].url);
    audio.muted = true;
    await audio.play();
    await new Promise(resolve => setTimeout(resolve, 300));
    const playback = { duration: audio.duration, time: audio.currentTime };
    audio.pause();
    return { tracks, playlists, cover, pictures, roomPhoto, playback, theme: localStorage.getItem('usagi-theme'), favorites: JSON.parse(localStorage.getItem('usagi-favorites')), imported: localStorage.getItem('usagi-gift-imported'), text: document.body.innerText.slice(0,1500) };
  }).toString() + ')()');
  assert.equal(result.tracks.length, manifest.tracks.length);
  assert.equal(result.playlists.length, manifest.playlists.length);
  assert.deepEqual(result.tracks.map(t => t.note), manifest.tracks.map(t => manifest.notes[t.id] || ''));
  assert.ok(result.tracks.every(t => t.duration > 0 && t.path.startsWith(profile)));
  assert.equal(result.cover, true);
  assert.ok(result.pictures.every(Boolean));
  assert.equal(result.roomPhoto, true);
  assert.ok(result.playback.duration > 0 && result.playback.time > 0);
  assert.equal(result.theme, manifest.preferences['usagi-theme']);
  assert.equal(result.imported, '1');
  assert.equal(result.favorites.length, JSON.parse(manifest.preferences['usagi-favorites']).length);
  const id = result.tracks[0].id;
  await first.evaluate('window.desktop.saveSongNote(' + JSON.stringify(id) + ', "Prueba de persistencia del destinatario")');
  await first.evaluate('localStorage.setItem("usagi-volume", "0.23")');
  await first.close();
  const second = await launch();
  try {
    assert.equal(await second.evaluate('window.desktop.getSongNote(' + JSON.stringify(id) + ')'), 'Prueba de persistencia del destinatario');
    assert.equal(await second.evaluate('localStorage.getItem("usagi-volume")'), '0.23');
    await second.close();
  } finally { second.ws.close(); if (second.child.exitCode === null) second.child.kill(); }
  const report = { passed: true, profile, songs: result.tracks.length, playlists: result.playlists.length, notes: result.tracks.filter(t => t.note).length, offlineArtwork: result.pictures, playlistCover: result.cover, playback: result.playback, persistedAfterRestart: true };
  await writeFile(path.join(root, '.verification/portable-gift-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (first.ws.readyState === WebSocket.OPEN) await first.evaluate('window.desktop.windowControl("close")').catch(() => {});
  first.ws.close();
}

import { app, BrowserWindow, dialog, ipcMain, protocol, Menu, net, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { allowedAudio, allowedTracks, scanFolder } from './library';
import { ArtworkCache } from './artwork';
import { SongNotes } from './songNotes';
import { Playlists } from './playlists';
import { LyricsCache } from './lyrics';
import { initializeGift, readGiftPreferences } from './gift';

const directory = path.dirname(fileURLToPath(import.meta.url));
const developmentURL = !app.isPackaged && process.env.USAGI_DEV_URL === 'http://127.0.0.1:5173'
  ? process.env.USAGI_DEV_URL : undefined;
let mainWindow: BrowserWindow | null = null;
let scanning = false;
let artworkCache: ArtworkCache;
let songNotes: SongNotes | undefined;
let playlists: Playlists | undefined;
let allowClose = false;
let quitRequested = false;
let shutdownTask: Promise<void> | null = null;
let flushRequestId = 0;
let noteFlushRequest: { id: number; complete: (saved: boolean) => void } | null = null;
app.setName('Suki\'s Room');
// Se conserva el nombre antiguo de los datos a propósito.
app.setPath('userData', app.isPackaged
  ? (app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), 'Sukis Room Gift'))
  : path.join(app.getPath('appData'), 'Usagi Music Room'));
if (app.isPackaged && !app.requestSingleInstanceLock()) app.exit(0);
protocol.registerSchemesAsPrivileged([{ scheme: 'usagi', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

function trustedSender(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Ventana no autorizada.');
  const url = event.senderFrame.url;
  const expected = developmentURL ?? pathToFileURL(path.resolve(directory, '../dist/index.html')).href;
  if (developmentURL ? new URL(url).origin !== expected : url !== expected) throw new Error('Origen no autorizado.');
}

async function scan(folder: string) {
  if (scanning) throw new Error('Ya se está cargando una carpeta.');
  scanning = true;
  try { return await scanFolder(folder, artworkCache); }
  finally { scanning = false; }
}

function flushRendererNotes(window: BrowserWindow): Promise<void> {
  const contents = window.webContents;
  if (contents.isDestroyed() || contents.isCrashed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const id = ++flushRequestId;
    const send = () => {
      try { contents.send('notes:flush', id); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      contents.removeListener('did-finish-load', send);
      contents.removeListener('destroyed', interrupted);
      contents.removeListener('render-process-gone', interrupted);
      noteFlushRequest = null;
      if (error) reject(error);
      else resolve();
    };
    const interrupted = () => finish(new Error('Se interrumpió el guardado de las notas.'));
    const timer = setTimeout(() => finish(new Error('El guardado de las notas no respondió.')), 10000);
    noteFlushRequest = { id, complete: saved => finish(saved ? undefined : new Error('No se pudieron guardar las notas pendientes.')) };
    contents.once('destroyed', interrupted);
    contents.once('render-process-gone', interrupted);
    if (contents.isLoadingMainFrame()) contents.once('did-finish-load', send);
    else send();
  });
}

function closeAfterSaving() {
  if (shutdownTask) return;
  shutdownTask = (async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) await flushRendererNotes(mainWindow);
      await songNotes?.flush();
      await playlists?.flush();
      allowClose = true;
      if (quitRequested) app.quit();
      else mainWindow?.close();
    } catch (error) {
      quitRequested = false;
      const options = {
        type: 'error' as const,
        message: 'No pude guardar tus cambios. La ventana seguirá abierta para que puedas intentarlo de nuevo.',
        detail: error instanceof Error ? error.message : String(error),
      };
      if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
    } finally { shutdownTask = null; }
  })();
}

app.on('before-quit', event => {
  if (allowClose || (!songNotes && !playlists)) return;
  event.preventDefault();
  quitRequested = true;
  closeAfterSaving();
});

function createWindow() {
  allowClose = false;
  mainWindow = new BrowserWindow({
    width: 1240, height: 830, minWidth: 880, minHeight: 650,
    frame: false, backgroundColor: '#fffaf0', show: false,
    title: 'Suki\'s Room',
    icon: path.join(directory, app.isPackaged ? '../dist/icon.png' : '../public/icon.png'),
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', event => {
    if (allowClose) return;
    event.preventDefault();
    closeAfterSaving();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  if (developmentURL) void mainWindow.loadURL(developmentURL);
  else void mainWindow.loadFile(path.join(directory, '../dist/index.html'));
}

app.whenReady().then(async () => {
  if (app.isPackaged) await initializeGift(path.join(process.resourcesPath, 'gift'), app.getPath('userData'));
  ipcMain.handle('gift:preferences', event => { trustedSender(event); return readGiftPreferences(app.getPath('userData')); });
  Menu.setApplicationMenu(null);
  artworkCache = new ArtworkCache(app.getPath('userData'), {
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    validateImage: bytes => !nativeImage.createFromBuffer(bytes).isEmpty(),
  });
  const playlistStore = playlists = new Playlists(app.getPath('userData'));
  protocol.handle('usagi', async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'playlist-cover') {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
      const filename = await playlistStore.coverFile(url.pathname.slice(1));
      if (!filename) return new Response(null, { status: 404 });
      try {
        const data = await readFile(filename);
        return new Response(request.method === 'HEAD' ? null : data, { headers: {
          'Content-Type': 'image/png', 'Content-Length': String(data.length),
          'Access-Control-Allow-Origin': developmentURL ?? 'null',
        } });
      } catch { return new Response(null, { status: 404 }); }
    }
    if (url.hostname === 'artwork') {
      const image = artworkCache.files.get(url.pathname.slice(1));
      if (!image || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
      try {
        const data = await readFile(image.filename);
        return new Response(request.method === 'HEAD' ? null : data, { headers: {
          'Content-Type': image.mime, 'Content-Length': String(data.length),
          // Artwork textures are consumed by WebGL with anonymous CORS.
          'Access-Control-Allow-Origin': developmentURL ?? 'null',
          'Cache-Control': 'public, max-age=31536000, immutable',
        } });
      } catch { return new Response(null, { status: 404 }); }
    }
    const filename = url.hostname === 'audio' ? allowedAudio.get(url.pathname.slice(1)) : undefined;
    if (!filename || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
    try {
      const size = (await stat(filename)).size;
      const headers: Record<string, string> = { 'Content-Type': filename.toLowerCase().endsWith('.flac') ? 'audio/flac' : 'audio/mpeg', 'Accept-Ranges': 'bytes' };
      let start = 0, end = size - 1;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : end; }
        else start = Math.max(0, size - Number(match[2]));
        if (start > end || start >= size || size === 0) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
      headers['Content-Length'] = String(Math.max(0, end - start + 1));
      const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(createReadStream(filename, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); }
  });
  const lyrics = new LyricsCache(app.getPath('userData'), (url, init) => net.fetch(url, init));
  ipcMain.handle('lyrics:get', async (event, id: unknown) => {
    trustedSender(event);
    const track = typeof id === 'string' ? allowedTracks.get(id) : undefined;
    if (!track) return { status: 'not-found' };
    return lyrics.get(track);
  });
  const notes = songNotes = new SongNotes(app.getPath('userData'));
  ipcMain.handle('notes:flushed', (event, requestId: unknown, saved: unknown) => {
    trustedSender(event);
    if (noteFlushRequest && noteFlushRequest.id === requestId) noteFlushRequest.complete(saved === true);
  });
  ipcMain.handle('notes:get', (event, id: unknown) => {
    trustedSender(event);
    return notes.get(id);
  });
  ipcMain.handle('notes:save', (event, id: unknown, note: unknown) => {
    trustedSender(event);
    return notes.set(id, note);
  });
  ipcMain.handle('playlists:list', event => { trustedSender(event); return playlistStore.list(); });
  ipcMain.handle('playlists:create', (event, name: unknown) => { trustedSender(event); return playlistStore.create(name); });
  ipcMain.handle('playlists:rename', (event, id: unknown, name: unknown) => { trustedSender(event); return playlistStore.rename(id, name); });
  ipcMain.handle('playlists:delete', (event, id: unknown) => { trustedSender(event); return playlistStore.delete(id); });
  ipcMain.handle('playlists:add-track', (event, id: unknown, filename: unknown) => { trustedSender(event); return playlistStore.addTrack(id, filename); });
  ipcMain.handle('playlists:remove-track', (event, id: unknown, filename: unknown) => { trustedSender(event); return playlistStore.removeTrack(id, filename); });
  ipcMain.handle('playlists:clear-cover', (event, id: unknown) => { trustedSender(event); return playlistStore.clearCover(id); });
  ipcMain.handle('playlists:choose-cover', async (event, id: unknown) => {
    trustedSender(event);
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Playlist no válida.');
    const selection = await dialog.showOpenDialog(mainWindow!, { title: 'Elige una portada', properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    return selection.canceled || !selection.filePaths[0] ? null : playlistStore.setCover(id, selection.filePaths[0]);
  });
  const settingsFile = path.join(app.getPath('userData'), 'library.json');
  ipcMain.handle('library:choose', async (event) => {
    trustedSender(event);
    const selection = await dialog.showOpenDialog(mainWindow!, { title: 'Elige tu rincón de música', properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const library = await scan(selection.filePaths[0]);
    await writeFile(settingsFile, JSON.stringify({ folder: library.folder }), 'utf8');
    return library;
  });
  ipcMain.handle('library:restore', async (event) => {
    trustedSender(event);
    let saved;
    try { saved = JSON.parse(await readFile(settingsFile, 'utf8')); }
    catch { return null; }
    if (typeof saved.folder !== 'string') return null;
    return scan(saved.folder);
  });
  ipcMain.handle('library:artwork', async (event, id: unknown) => {
    trustedSender(event);
    if (typeof id !== 'string') return null;
    const track = allowedTracks.get(id);
    if (!track) return null;
    if (track.artwork) return track.artwork;
    const artwork = await artworkCache.online(track, () => allowedTracks.get(id) === track);
    if (allowedTracks.get(id) !== track) return null;
    if (artwork) track.artwork = artwork;
    return artwork ?? null;
  });
  ipcMain.handle('window:control', (event, action: unknown) => {
    trustedSender(event);
    if (action === 'minimize') mainWindow?.minimize();
    if (action === 'maximize') mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
    if (action === 'close') mainWindow?.close();
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(async error => {
  await dialog.showMessageBox({ type: 'error', message: 'No pude preparar los datos del regalo.', detail: String(error) });
  app.exit(1);
});
app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atomicSource = await readFile(path.join(root, 'electron/atomicJson.ts'), 'utf8');
const atomicOutput = ts.transpileModule(atomicSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const atomicUrl = 'data:text/javascript;base64,' + Buffer.from(atomicOutput).toString('base64');
const atomicModule = await import(atomicUrl);
const source = (await readFile(path.join(root, 'electron/songNotes.ts'), 'utf8')).replace("'./atomicJson'", JSON.stringify(atomicUrl));
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { SongNotes } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const first = 'a'.repeat(64), second = 'b'.repeat(64);

async function scratch(t) {
  const directory = await mkdtemp(path.join(root, '.song-notes-tests-'));
  t.after(async () => {
    const relative = path.relative(root, directory);
    assert.ok(relative.startsWith('.song-notes-tests-') && !relative.includes(path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('saves independent notes concurrently and restores them after restart', async t => {
  const directory = await scratch(t);
  const notes = new SongNotes(directory);
  assert.equal(await notes.get(first), '');
  await Promise.all([notes.set(first, ' Mi recuerdo ♡\nSegunda línea '), notes.set(second, 'Otra canción')]);
  const restored = new SongNotes(directory);
  assert.equal(await restored.get(first), 'Mi recuerdo ♡\nSegunda línea');
  assert.equal(await restored.get(second), 'Otra canción');
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'song-notes.json'), 'utf8')), {
    [first]: 'Mi recuerdo ♡\nSegunda línea', [second]: 'Otra canción',
  });
  assert.deepEqual(await readdir(directory), ['song-notes.json']);
});

test('edits and clears a note while preserving the other songs', async t => {
  const notes = new SongNotes(await scratch(t));
  await notes.set(first, 'Antes');
  await notes.set(second, 'Mi otra nota');
  await notes.set(first, 'Después');
  assert.equal(await notes.get(first), 'Después');
  await notes.set(first, '  ');
  assert.equal(await notes.get(first), '');
  assert.equal(await notes.get(second), 'Mi otra nota');
});

test('rejects invalid IDs and note payloads', async t => {
  const notes = new SongNotes(await scratch(t));
  await assert.rejects(notes.get('../library.json'));
  assert.throws(() => notes.set('../library.json', 'texto'));
  assert.throws(() => notes.set(first, { text: 'texto' }));
  assert.throws(() => notes.set(first, 'x'.repeat(5001)));
  await notes.set(first, 'Texto válido');
  assert.equal(await notes.get(first), 'Texto válido');
});

test('preserves a damaged file and recovers the write queue after failure', async t => {
  const directory = await scratch(t);
  const filename = path.join(directory, 'song-notes.json');
  await writeFile(filename, '{broken', 'utf8');
  const notes = new SongNotes(directory);
  await assert.rejects(notes.get(first));
  await assert.rejects(notes.set(first, 'No sobrescribir'));
  assert.equal(await readFile(filename, 'utf8'), '{broken');
  await writeFile(filename, JSON.stringify({ [second]: 'Recuperada' }), 'utf8');
  await notes.set(first, 'Nueva');
  assert.equal(await notes.get(second), 'Recuperada');
  assert.equal(await notes.get(first), 'Nueva');
});


test('flush waits for queued atomic writes before shutdown', async t => {
  const directory = await scratch(t);
  const notes = new SongNotes(directory);
  const writes = [notes.set(first, 'Antes de salir'), notes.set(second, 'Otra pendiente')];
  await notes.flush();
  const restored = new SongNotes(directory);
  assert.equal(await restored.get(first), 'Antes de salir');
  assert.equal(await restored.get(second), 'Otra pendiente');
  await Promise.all(writes);
  assert.deepEqual(await readdir(directory), ['song-notes.json']);
});

test('flush reports a failed write and succeeds after a retry', async t => {
  const directory = await scratch(t);
  const filename = path.join(directory, 'song-notes.json');
  await writeFile(filename, '{broken', 'utf8');
  const notes = new SongNotes(directory);
  await assert.rejects(notes.set(first, 'Pendiente'));
  await assert.rejects(notes.flush());
  assert.equal(await readFile(filename, 'utf8'), '{broken');
  await writeFile(filename, '{}', 'utf8');
  await notes.set(first, 'Pendiente');
  await notes.flush();
  assert.equal(await new SongNotes(directory).get(first), 'Pendiente');
});


// Exercise renderer and Electron shutdown without starting a desktop window.
const { runInNewContext } = await import('node:vm');
const { EventEmitter } = await import('node:events');
const { createRequire } = await import('node:module');
const { pathToFileURL } = await import('node:url');
const requireModule = createRequire(import.meta.url);
async function loadModule(relative, dependencies, globals = {}) {
  const filename = path.join(root, relative);
  const source = (await readFile(filename, 'utf8')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } });
  const module = { exports: {} };
  runInNewContext(outputText, {
    module, exports: module.exports,
    require: name => name in dependencies ? dependencies[name] : name === './atomicJson' ? atomicModule : requireModule(name),
    process: { env: {}, platform: 'win32' }, setTimeout, clearTimeout, URL, ...globals,
  }, { filename });
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

async function noteHarness(save = async (_id, draft) => draft.trim()) {
  const slots = [], effects = [], timers = new Map(), flushers = new Set(), writes = [];
  let cursor = 0, timerId = 0, currentId = first;
  const same = (left, right) => left && left.length === right.length && left.every((v, i) => v === right[i]);
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (same(slots[index]?.dependencies, dependencies)) return;
      effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies, cleanup: callback() };
      });
    },
  };
  const desktop = {
    getSongNote: async () => '',
    saveSongNote: (id, draft) => { writes.push({ id, draft }); return save(id, draft); },
    onFlushSongNotes: flush => { flushers.add(flush); return () => flushers.delete(flush); },
  };
  const { useSongNotes } = await loadModule('src/features/player/useSongNotes.ts', { react }, {
    window: { desktop },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const harness = {
    writes, timers,
    render(id = currentId) {
      currentId = id;
      cursor = 0;
      const notes = useSongNotes(id);
      while (effects.length) effects.shift()();
      return notes;
    },
    fireTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    flush: async () => (await Promise.all([...flushers].map(flush => flush()))).every(Boolean),
  };
  harness.render();
  await settle();
  return harness;
}

test('debounces typing and flushes immediately when the editor loses focus', async () => {
  const harness = await noteHarness();
  harness.render().setDraft('Primero');
  harness.render().setDraft('Último ♡');
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.timers.size, 1);
  assert.equal([...harness.timers.values()][0].delay, 300);
  harness.fireTimers();
  await settle();
  assert.deepEqual(harness.writes, [{ id: first, draft: 'Último ♡' }]);
  harness.render().setDraft('Al salir del campo');
  assert.equal(await harness.render().save(), true);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.render().note, 'Al salir del campo');
});

test('flushes the previous song before its debounce expires', async () => {
  const harness = await noteHarness();
  harness.render().setDraft('Recuerdo de la primera');
  harness.render(second);
  await settle();
  assert.deepEqual(harness.writes, [{ id: first, draft: 'Recuerdo de la primera' }]);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.render().note, '');
  assert.equal(harness.render(first).note, 'Recuerdo de la primera');
});

test('preserves edits made during a write and waits for the newest draft', async () => {
  const gates = [deferred(), deferred()];
  let index = 0;
  const harness = await noteHarness(() => gates[index++].promise);
  harness.render().setDraft('Versión anterior');
  const saving = harness.render().save();
  harness.render().setDraft('Versión nueva');
  const joining = harness.render().save();
  assert.equal(joining, saving);
  gates[0].resolve('Versión anterior');
  await settle();
  assert.equal(harness.render().draft, 'Versión nueva');
  assert.equal(harness.writes.length, 2);
  let finished = false;
  saving.then(() => { finished = true; });
  await settle();
  assert.equal(finished, false);
  gates[1].resolve('Versión nueva');
  assert.equal(await saving, true);
  assert.equal(harness.render().note, 'Versión nueva');
  assert.equal(harness.render().dirty, false);
});

test('shutdown retries unsaved notes for inactive songs and flushes every draft', async () => {
  let fail = true;
  const harness = await noteHarness(async (id, draft) => {
    if (id === first && fail) throw new Error('Disk unavailable');
    return draft;
  });
  harness.render().setDraft('Texto pendiente');
  assert.equal(await harness.render().save(), false);
  assert.equal(harness.render().draft, 'Texto pendiente');
  harness.render(second);
  await settle();
  harness.render().setDraft('Segunda nota');
  fail = false;
  assert.equal(await harness.flush(), true);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.render().note, 'Segunda nota');
  assert.equal(harness.render(first).note, 'Texto pendiente');
});

async function shutdownHarness() {
  const handlers = new Map(), windows = [], sent = [], errors = [];
  const disk = deferred();
  let flushes = 0;
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false, setName() {}, setPath() {}, whenReady: async () => {}, getPath: () => root,
    exited: false,
    quit() {
      if (this.exited) return;
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('before-quit', event);
      if (!event.prevented) { this.exited = true; windows[0]?.close(); }
    },
  });
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return windows.filter(window => !window.closed); }
    constructor() {
      super();
      windows.push(this);
      this.closed = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: pathToFileURL(path.join(root, 'dist/index.html')).href },
        setWindowOpenHandler() {}, isDestroyed: () => this.closed,
        isCrashed: () => false, isLoadingMainFrame: () => false,
        send: (channel, id) => sent.push({ channel, id }),
      });
    }
    setMenuBarVisibility() {} show() {} loadFile() { return Promise.resolve(); }
    isDestroyed() { return this.closed; }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (!event.prevented) { this.closed = true; this.emit('closed'); }
    }
  }
  await loadModule('electron/main.ts', {
    electron: {
      app, BrowserWindow, ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      protocol: { registerSchemesAsPrivileged() {}, handle() {} },
      Menu: { setApplicationMenu() {} }, net: {}, nativeImage: {},
      dialog: { showMessageBox: async (...args) => { errors.push(args); } },
    },
    './gift': { initializeGift: async () => {}, readGiftPreferences: async () => null },
    './library': {}, './artwork': { ArtworkCache: class {} },
    './songNotes': { SongNotes: class { flush() { flushes++; return disk.promise; } } },
    './playlists': { Playlists: class { flush() {} } },
    './lyrics': { LyricsCache: class {} },
  });
  await settle();
  const window = windows[0];
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { app, window, sent, disk, errors, get flushes() { return flushes; },
    acknowledge: (id, saved) => handlers.get('notes:flushed')(event, id, saved),
  };
}

for (const action of ['close', 'quit']) {
  test(action + ' waits for renderer acknowledgement and the atomic write queue', async () => {
    const harness = await shutdownHarness();
    if (action === 'close') harness.window.close();
    else harness.app.quit();
    assert.equal(harness.window.closed, false);
    assert.equal(harness.app.exited, false);
    assert.equal(harness.sent.length, 1);
    const request = harness.sent[0];
    assert.equal(request.channel, 'notes:flush');
    harness.acknowledge(request.id + 1, true);
    await settle();
    assert.equal(harness.flushes, 0);
    harness.acknowledge(request.id, true);
    await settle();
    assert.equal(harness.flushes, 1);
    assert.equal(harness.window.closed, false);
    harness.disk.resolve();
    await settle();
    assert.equal(harness.window.closed, true);
    assert.equal(harness.app.exited, action === 'quit');
  });
}

test('a failed renderer save keeps the window open and permits a later retry', async () => {
  const harness = await shutdownHarness();
  harness.app.quit();
  harness.acknowledge(harness.sent[0].id, false);
  await settle();
  assert.equal(harness.window.closed, false);
  assert.equal(harness.app.exited, false);
  assert.equal(harness.errors.length, 1);
  harness.window.close();
  assert.equal(harness.sent.length, 2);
  harness.acknowledge(harness.sent[1].id, true);
  harness.disk.resolve();
  await settle();
  assert.equal(harness.window.closed, true);
});

test('preload acknowledges shutdown only after registered flushers finish', async () => {
  const ipcRenderer = new EventEmitter(), calls = [], gate = deferred();
  let desktop;
  ipcRenderer.invoke = async (...args) => { calls.push(args); };
  await loadModule('electron/preload.ts', { electron: {
    ipcRenderer, contextBridge: { exposeInMainWorld: (_name, api) => { desktop = api; } },
  } });
  const unsubscribe = desktop.onFlushSongNotes(() => gate.promise);
  ipcRenderer.emit('notes:flush', {}, 42);
  await settle();
  assert.equal(calls.length, 0);
  gate.resolve(true);
  await settle();
  assert.deepEqual(calls, [['notes:flushed', 42, true]]);
  unsubscribe();
  desktop.onFlushSongNotes(async () => false);
  ipcRenderer.emit('notes:flush', {}, 43);
  await settle();
  assert.deepEqual(calls[1], ['notes:flushed', 43, false]);
});


test('atomic replacement retries a temporary file lock without altering the old JSON', async t => {
  const directory = await scratch(t);
  await new SongNotes(directory).set(first, 'Original');
  const filename = path.join(directory, 'song-notes.json');
  const filesystem = await import('node:fs/promises');
  let attempts = 0;
  const lockedAtomic = await loadModule('electron/atomicJson.ts', {
    'node:fs/promises': { ...filesystem, rename: async (temporary, target) => {
      attempts++;
      assert.equal(JSON.parse(await readFile(filename, 'utf8'))[first], 'Original');
      if (attempts < 3) throw Object.assign(new Error('File locked'), { code: 'EPERM' });
      await filesystem.rename(temporary, target);
    } },
  });
  const { SongNotes: LockedNotes } = await loadModule('electron/songNotes.ts', { './atomicJson': lockedAtomic });
  await new LockedNotes(directory).set(first, 'Actualizada');
  assert.ok(attempts >= 3);
  assert.equal(await new SongNotes(directory).get(first), 'Actualizada');
  assert.deepEqual(await readdir(directory), ['song-notes.json']);
});

test('a failed atomic replacement preserves the previous file and reports failure', async t => {
  const directory = await scratch(t);
  await new SongNotes(directory).set(first, 'Original');
  const filesystem = await import('node:fs/promises');
  const failedAtomic = await loadModule('electron/atomicJson.ts', {
    'node:fs/promises': { ...filesystem, rename: async () => {
      throw Object.assign(new Error('Disk failure'), { code: 'EIO' });
    } },
  });
  const { SongNotes: FailedNotes } = await loadModule('electron/songNotes.ts', { './atomicJson': failedAtomic });
  const notes = new FailedNotes(directory);
  await assert.rejects(notes.set(first, 'Pendiente'));
  await assert.rejects(notes.flush());
  assert.equal(await new SongNotes(directory).get(first), 'Original');
  assert.deepEqual(await readdir(directory), ['song-notes.json']);
});

test('quit during a pending window close shares the flush and exits after saving', async () => {
  const harness = await shutdownHarness();
  harness.window.close();
  harness.app.quit();
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.app.exited, false);
  harness.acknowledge(harness.sent[0].id, true);
  harness.disk.resolve();
  await settle();
  assert.equal(harness.flushes, 1);
  assert.equal(harness.window.closed, true);
  assert.equal(harness.app.exited, true);
});


test('autosave preserves spaces in the active draft without repeatedly saving them', async () => {
  const harness = await noteHarness();
  harness.render().setDraft('Una frase ');
  harness.fireTimers();
  await settle();
  assert.equal(harness.render().draft, 'Una frase ');
  assert.equal(harness.render().note, 'Una frase');
  assert.equal(harness.writes.length, 1);
  assert.equal(await harness.flush(), true);
  assert.equal(harness.writes.length, 1);
  harness.render().setDraft(harness.render().draft + 'completa');
  assert.equal(await harness.render().save(), true);
  assert.equal(harness.render().note, 'Una frase completa');
});

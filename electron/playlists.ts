import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import type { Playlist } from '../shared/contracts';
import { allowedTracks } from './library';
import { writeAtomicJson } from './atomicJson';

const idPattern = /^[a-f0-9-]{36}$/;
const coverPattern = /^[a-f0-9-]{36}\.png$/;
const maxImageBytes = 20 * 1024 * 1024;

function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Playlist no válida.');
}
function validName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error('El nombre debe tener entre 1 y 80 caracteres.');
  return name.trim();
}
function validPath(filename: unknown): asserts filename is string {
  if (typeof filename !== 'string' || filename.length > 4096 || !path.isAbsolute(filename) || !/\.(mp3|flac)$/i.test(filename) || filename.includes('\0')) throw new Error('Ruta de canción no válida.');
}

export class Playlists {
  private readonly filename: string;
  private readonly coverDirectory: string;
  private queue: Promise<void> = Promise.resolve();
  private writeError: unknown;
  private items: Playlist[] | null = null;

  constructor(userData: string) {
    this.filename = path.join(userData, 'playlists.json');
    this.coverDirectory = path.join(userData, 'playlist-covers');
  }

  private async load(): Promise<Playlist[]> {
    if (this.items) return this.items;
    let raw: string;
    try { raw = await readFile(this.filename, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.items = [];
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('El archivo de playlists no es válido.');
    const seen = new Set<string>();
    this.items = parsed.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('El archivo de playlists no es válido.');
      const candidate = item as Partial<Playlist>;
      validId(candidate.id);
      const name = validName(candidate.name);
      if (seen.has(candidate.id) || !Array.isArray(candidate.paths) || candidate.paths.length > 10000 || (candidate.cover !== null && (typeof candidate.cover !== 'string' || !coverPattern.test(candidate.cover)))) throw new Error('El archivo de playlists no es válido.');
      seen.add(candidate.id);
      const paths: string[] = [];
      for (const filename of candidate.paths) { validPath(filename); if (!paths.includes(filename)) paths.push(filename); }
      return { id: candidate.id, name, paths, cover: candidate.cover };
    });
    return this.items;
  }

  private snapshot(items: Playlist[]): Playlist[] {
    return items.map(item => ({ ...item, paths: [...item.paths], cover: item.cover ? `usagi://playlist-cover/${item.cover}` : null }));
  }

  async list(): Promise<Playlist[]> {
    await this.queue;
    return this.snapshot(await this.load());
  }

  private mutate(change: (items: Playlist[]) => Playlist[]): Promise<Playlist[]> {
    const operation = this.queue.then(async () => {
      const next = change(await this.load());
      await writeAtomicJson(this.filename, next);
      this.items = next;
      return this.snapshot(next);
    });
    this.queue = operation.then(() => { this.writeError = undefined; }, error => { this.writeError = error; });
    return operation;
  }

  private update(id: unknown, change: (item: Playlist) => Playlist): Promise<Playlist[]> {
    validId(id);
    return this.mutate(items => {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) throw new Error('La playlist ya no existe.');
      return items.map((item, position) => position === index ? change(item) : item);
    });
  }

  create(name: unknown) {
    const safeName = validName(name);
    return this.mutate(items => [...items, { id: randomUUID(), name: safeName, paths: [], cover: null }]);
  }
  rename(id: unknown, name: unknown) {
    const safeName = validName(name);
    return this.update(id, item => ({ ...item, name: safeName }));
  }
  delete(id: unknown) {
    validId(id);
    return this.mutate(items => {
      if (!items.some(item => item.id === id)) throw new Error('La playlist ya no existe.');
      return items.filter(item => item.id !== id);
    });
  }
  addTrack(id: unknown, filename: unknown) {
    validPath(filename);
    if (![...allowedTracks.values()].some(track => track.path === filename)) throw new Error('La canción no está en la biblioteca actual.');
    return this.update(id, item => ({ ...item, paths: item.paths.includes(filename) ? item.paths : [...item.paths, filename] }));
  }
  removeTrack(id: unknown, filename: unknown) {
    validPath(filename);
    return this.update(id, item => ({ ...item, paths: item.paths.filter(saved => saved !== filename) }));
  }
  clearCover(id: unknown) { return this.update(id, item => ({ ...item, cover: null })); }

  async setCover(id: unknown, filename: string): Promise<Playlist[]> {
    validId(id);
    if (!/\.(png|jpe?g|webp)$/i.test(filename)) throw new Error('Elige una imagen PNG, JPG o WebP.');
    if ((await stat(filename)).size > maxImageBytes) throw new Error('La imagen es demasiado grande.');
    const source = nativeImage.createFromBuffer(await readFile(filename));
    if (source.isEmpty()) throw new Error('No pude leer esa imagen.');
    const dimensions = source.getSize();
    const scale = Math.min(1, 512 / Math.max(dimensions.width, dimensions.height));
    const image = scale < 1 ? source.resize({ width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) }) : source;
    const cover = `${randomUUID()}.png`;
    await mkdir(this.coverDirectory, { recursive: true });
    const target = path.join(this.coverDirectory, cover);
    const temporary = `${target}.tmp`;
    try {
      await writeFile(temporary, image.toPNG(), { flush: true });
      await rename(temporary, target);
      return await this.update(id, item => ({ ...item, cover }));
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    } finally { await rm(temporary, { force: true }); }
  }

  async coverFile(id: string): Promise<string | null> {
    if (!coverPattern.test(id)) return null;
    await this.queue;
    return (await this.load()).some(item => item.cover === id) ? path.join(this.coverDirectory, id) : null;
  }

  async flush(): Promise<void> {
    let pending: Promise<void>;
    do { pending = this.queue; await pending; } while (pending !== this.queue);
    if (this.writeError) throw this.writeError;
  }
}

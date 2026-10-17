import { mkdir, readFile, readdir, rename, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Track } from '../shared/contracts';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MISS_TTL = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL = 15 * 60 * 1000;
const SEARCH_INTERVAL = 3100; // iTunes allows approximately 20 searches per minute.
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cleanTitle = (value: string) => value
  .replace(/【(?:和訳|日本語訳|歌詞|lyrics)[^】]*】/gi, '')
  .replace(/[([](?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer|español|spanish|subt[ií]tulos|sub\s+(?:español|esp|es))[^\])]*[\])]/gi, '').trim();

export function filenameTags(filename: string): { title: string; artist: string } {
  const stem = path.basename(filename, path.extname(filename)).replace(/^\d+[. _-]+/, '').trim();
  const parts = stem.split(/\s+[-–—]\s+/);
  if (parts.length === 2) {
    // Japanese uploads commonly put the title before a pair of artists.
    return parts[1].includes('／')
      ? { title: cleanTitle(parts[0]), artist: parts[1].replaceAll('／', ' & ') }
      : { artist: parts[0], title: parts[1] };
  }
  return { title: stem, artist: 'Artista desconocido' };
}

function similarity(left: string, right: string): number {
  const a = normalize(left), b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = new Set(a.split(' ')), y = new Set(b.split(' '));
  return 2 * [...x].filter(token => y.has(token)).length / (x.size + y.size);
}

type SearchResult = { kind?: string; trackName?: string; artistName?: string; collectionName?: string; artworkUrl100?: string; artworkUrl60?: string; artworkUrl600?: string };
export function matchArtwork(track: Track, results: SearchResult[]): SearchResult | undefined {
  const knownArtist = track.artist !== 'Artista desconocido';
  return results.map(result => {
    if (result.kind !== 'song' || !result.trackName || !result.artistName || !result.artworkUrl100) return { result, score: 0 };
    const title = knownArtist ? similarity(cleanTitle(track.title), result.trackName) : Math.max(
      similarity(cleanTitle(track.title), result.trackName),
      similarity(cleanTitle(track.title), result.artistName + ' ' + result.trackName),
    );
    const artistTokens = normalize(track.artist).split(' ').filter(token => !['and', 'the', 'feat', 'ft'].includes(token));
    const resultTokens = new Set(normalize(result.artistName).split(' '));
    // Soundtracks often add composer/studio credits to the same performers.
    const containsArtists = artistTokens.length > 0 && artistTokens.every(token => resultTokens.has(token));
    const artist = knownArtist ? Math.max(similarity(track.artist, result.artistName), containsArtists ? 1 : 0) : 1;
    if (title < (knownArtist ? 0.75 : 0.9) || artist < 0.7) return { result, score: 0 };
    return { result, score: title * 4 + artist * 2 + similarity(track.album, result.collectionName ?? '') };
  }).sort((a, b) => b.score - a.score).find(item => item.score > 0)?.result;
}

export function imageMime(bytes: Uint8Array): string | undefined {
  const data = Buffer.from(bytes);
  if (data.length < 12) return;
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (/^GIF8[79]a/.test(data.toString('ascii', 0, 6))) return 'image/gif';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (data.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(data.toString('ascii', 8, 32))) return 'image/avif';
}

export function artworkURLs(result: SearchResult): string[] {
  const original = result.artworkUrl600 ?? result.artworkUrl100 ?? result.artworkUrl60;
  if (!original) return [];
  let url: URL;
  try { url = new URL(original); } catch { return []; }
  // Only download Apple artwork hosts, never arbitrary URLs from an API response.
  if (!/(^|\.)(mzstatic\.com|itunes\.apple\.com)$/.test(url.hostname)) return [];
  url.protocol = 'https:';
  const full = url.href;
  // Apple's CDN uses the size in the final path segment. Try its largest rendition first.
  return [...new Set([3000, 1200, 600].map(size => full.replace(/\d+x\d+(?:bb|bf|cc)?(?:-\d+)?(?=\.(?:jpg|jpeg|png|webp)(?:[?]|$))/i, size + 'x' + size + 'bb')).concat(full))];
}

type CacheEntry = { image: string | null; expiresAt?: number };
type Options = { fetch?: typeof fetch; validateImage?: (bytes: Buffer) => boolean; searchInterval?: number };
export class ArtworkCache {
  readonly files = new Map<string, { filename: string; mime: string }>();
  private readonly directory: string;
  private readonly fetcher: typeof fetch;
  private readonly validateImage: (bytes: Buffer) => boolean;
  private readonly interval: number;
  private pending = new Map<string, Promise<string | undefined>>();
  private memory = new Map<string, { artwork?: string; expiresAt: number }>();
  private searchQueue: Promise<void> = Promise.resolve();
  private nextSearchAt = 0;

  constructor(userData: string, options: Options = {}) {
    this.directory = path.join(userData, 'artwork-cache', 'v1');
    this.fetcher = options.fetch ?? fetch;
    this.validateImage = options.validateImage ?? (() => true);
    this.interval = options.searchInterval ?? SEARCH_INTERVAL;
  }

  async store(bytes: Uint8Array): Promise<string | undefined> {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return;
    const data = Buffer.from(bytes), mime = imageMime(data);
    if (!mime || !this.validateImage(data)) return;
    const id = hash(data), filename = path.join(this.directory, id + '.img');
    try {
      await mkdir(this.directory, { recursive: true });
      // Immutable, content-addressed files share album covers between songs.
      const stored = await readFile(filename).catch(() => undefined);
      if (!stored?.equals(data)) await this.atomicWrite(filename, data);
      this.files.set(id, { filename, mime });
      return 'usagi://artwork/' + id;
    } catch {
      // A read-only/full cache must never prevent a local cover or song from loading.
      return 'data:' + mime + ';base64,' + data.toString('base64');
    }
  }

  async folderCover(directory: string): Promise<string | undefined> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    const priority = ['cover', 'folder', 'front', 'album', 'albumart', 'artwork', 'albumartsmall'];
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'];
    const candidates = entries.filter(entry => entry.isFile()).map(entry => {
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      const stem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      return { name: entry.name, rank: priority.indexOf(stem), extRank: extensions.indexOf(ext) };
    }).filter(entry => entry.rank >= 0 && entry.extRank >= 0).sort((a, b) => a.rank - b.rank || a.extRank - b.extRank);
    for (const entry of candidates) {
      const filename = path.join(directory, entry.name);
      try {
        if ((await stat(filename)).size > MAX_IMAGE_BYTES) continue;
        const cover = await this.store(await readFile(filename));
        if (cover) return cover;
      } catch { /* Try the next folder image if one is unreadable/corrupt. */ }
    }
  }

  private key(track: Track) { return hash([normalize(cleanTitle(track.title)), normalize(track.artist), normalize(track.album)].join('\n')); }

  async cached(track: Track): Promise<{ found: boolean; artwork?: string }> {
    const key = this.key(track), memory = this.memory.get(key);
    if (memory && memory.expiresAt > Date.now()) return { found: true, artwork: memory.artwork };
    try {
      const entry: CacheEntry = JSON.parse(await readFile(path.join(this.directory, key + '.json'), 'utf8'));
      if (entry.image === null && typeof entry.expiresAt === 'number' && entry.expiresAt > Date.now()) {
        this.memory.set(key, { expiresAt: entry.expiresAt });
        return { found: true };
      }
      if (typeof entry.image === 'string' && /^[a-f0-9]{64}$/.test(entry.image)) {
        const filename = path.join(this.directory, entry.image + '.img');
        if ((await stat(filename)).size > MAX_IMAGE_BYTES) return { found: false };
        const data = await readFile(filename), mime = imageMime(data);
        if (mime && hash(data) === entry.image && this.validateImage(data)) {
          const artwork = 'usagi://artwork/' + entry.image;
          this.files.set(entry.image, { filename, mime });
          this.memory.set(key, { artwork, expiresAt: Infinity });
          return { found: true, artwork };
        }
      }
    } catch { /* Missing or damaged cache entries are safe to rebuild. */ }
    return { found: false };
  }

  async online(track: Track, isCurrent: () => boolean = () => true): Promise<string | undefined> {
    const cached = await this.cached(track);
    if (cached.found) return cached.artwork;
    if (!isCurrent()) return;
    const key = this.key(track), existing = this.pending.get(key);
    if (existing) return existing;
    const work = this.lookup(track, isCurrent).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  private async lookup(track: Track, isCurrent: () => boolean): Promise<string | undefined> {
    const key = this.key(track);
    let artwork: string | undefined, failed = false;
    try {
      const response = await this.search(track, isCurrent);
      if (!response) return; // Folder changed before this search started.
      const result = matchArtwork(track, response);
      if (result) {
        for (const url of artworkURLs(result)) {
          try {
            const bytes = await this.download(url);
            artwork = await this.store(bytes);
            if (artwork) break;
          } catch { /* Fall back to a smaller rendition when the CDN rejects a size. */ }
        }
        if (!artwork) failed = true;
      }
    } catch { failed = true; }
    const expiresAt = Date.now() + (failed ? ERROR_TTL : MISS_TTL);
    this.memory.set(key, { artwork, expiresAt: artwork ? Infinity : expiresAt });
    const image = artwork?.startsWith('usagi://artwork/') ? artwork.slice('usagi://artwork/'.length) : null;
    const entry: CacheEntry = image ? { image } : { image: null, expiresAt };
    try {
      await mkdir(this.directory, { recursive: true });
      await this.atomicWrite(path.join(this.directory, key + '.json'), JSON.stringify(entry));
    } catch { /* Session cache still prevents repeated requests if disk writes fail. */ }
    return artwork;
  }

  private search(track: Track, isCurrent: () => boolean): Promise<SearchResult[] | undefined> {
    const work = this.searchQueue.then(async () => {
      if (!isCurrent()) return;
      const delay = this.nextSearchAt - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      if (!isCurrent()) return;
      this.nextSearchAt = Date.now() + this.interval;
      const url = new URL('https://itunes.apple.com/search');
      const artist = track.artist === 'Artista desconocido' ? '' : track.artist;
      url.search = new URLSearchParams({ term: cleanTitle(track.title) + ' ' + artist, media: 'music', entity: 'song', limit: '15', country: 'US' }).toString();
      const data = JSON.parse((await this.download(url.href, 1024 * 1024)).toString('utf8')) as { results?: SearchResult[] };
      if (!Array.isArray(data.results)) throw new Error('Respuesta de iTunes inválida');
      return data.results;
    });
    this.searchQueue = work.then(() => undefined, () => undefined);
    return work;
  }

  private async download(url: string, limit = MAX_IMAGE_BYTES): Promise<Buffer> {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('Descarga no disponible');
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('Respuesta demasiado grande'); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) throw new Error('Respuesta demasiado grande');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    return Buffer.concat(chunks);
  }

  private async atomicWrite(filename: string, data: string | Buffer) {
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try { await writeFile(temporary, data); await rename(temporary, filename); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SongLyrics, Track } from '../shared/contracts';

type LyricsRecord = { trackName: string; artistName: string; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };
type FetchLyrics = (url: string, init: RequestInit) => Promise<Response>;
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');
const lyricText = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length <= 100_000);

function isRecord(value: unknown): value is LyricsRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<LyricsRecord>;
  return typeof record.trackName === 'string' && typeof record.artistName === 'string'
    && typeof record.duration === 'number' && Number.isFinite(record.duration)
    && typeof record.instrumental === 'boolean' && lyricText(record.plainLyrics) && lyricText(record.syncedLyrics);
}

export class LyricsCache {
  private readonly directory: string;
  private readonly pending = new Map<string, Promise<SongLyrics>>();
  private readonly memory = new Map<string, { result: SongLyrics; expires: number }>();

  constructor(userData: string, private readonly fetchLyrics: FetchLyrics) {
    this.directory = path.join(userData, 'lyrics-cache-v1');
  }

  get(track: Track): Promise<SongLyrics> {
    const signature = JSON.stringify([track.title, track.artist, track.album, Math.round(track.duration)]);
    const key = createHash('sha256').update(signature).digest('hex');
    const cached = this.memory.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.result);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.load(track, key).catch((): SongLyrics => ({ status: 'unavailable' })).then(result => {
      if (result.status !== 'unavailable') {
        if (this.memory.size >= 200) this.memory.delete(this.memory.keys().next().value!);
        this.memory.set(key, { result, expires: Date.now() + (result.status === 'found' ? 86400_000 : 600_000) });
      }
      return result;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, request);
    return request;
  }

  private async request(params: URLSearchParams): Promise<unknown> {
    const response = await this.fetchLyrics('https://lrclib.net/api/get?' + params, {
      headers: { Accept: 'application/json', 'User-Agent': 'Usagi-Music-Room/0.1.0' },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Lyrics provider unavailable');
    return response.json();
  }

  private matches(record: LyricsRecord, track: Track): boolean {
    return normalize(record.trackName) === normalize(track.title)
      && normalize(record.artistName) === normalize(track.artist)
      && (!track.duration || Math.abs(record.duration - track.duration) <= 2.5);
  }

  private async load(track: Track, key: string): Promise<SongLyrics> {
    const filename = path.join(this.directory, key + '.json');
    let record: unknown;
    try { record = JSON.parse(await readFile(filename, 'utf8')); } catch { /* Cache miss. */ }
    if (!isRecord(record) || !this.matches(record, track)) {
      if (!track.title.trim() || !track.artist.trim()) return { status: 'not-found' };
      const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
      if (track.duration >= 1 && track.duration <= 3600) params.set('duration', String(Math.round(track.duration)));
      if (track.album.trim()) params.set('album_name', track.album);
      record = await this.request(params);
      // Folder names and compilations often do not match the provider's album metadata.
      if ((!isRecord(record) || !this.matches(record, track)) && params.has('album_name')) {
        params.delete('album_name');
        record = await this.request(params);
      }
      if (!isRecord(record) || !this.matches(record, track)) return { status: 'not-found' };
      if (!record.instrumental && !record.plainLyrics?.trim() && !record.syncedLyrics?.trim()) return { status: 'not-found' };
      try {
        await mkdir(this.directory, { recursive: true });
        await writeFile(filename, JSON.stringify(record), 'utf8');
      } catch { /* A read-only cache must not prevent displaying fetched lyrics. */ }
    }
    return { status: 'found', plain: record.plainLyrics ?? '', synced: record.syncedLyrics, instrumental: record.instrumental };
  }
}

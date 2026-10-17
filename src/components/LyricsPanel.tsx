import { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, RotateCcw, TextQuote } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import type { SongLyrics } from '../../shared/contracts';

type LyricLine = { time: number; text: string };

function parseLyrics(source: string | null): LyricLine[] {
  if (!source) return [];
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(source)?.[1] ?? 0) / 1000;
  const lines: LyricLine[] = [];
  for (const row of source.split(/\r?\n/)) {
    const timestamps = [...row.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];
    const text = row.replace(/\[\d+:\d{2}(?:\.\d+)?\]/g, '').replace(/<\d+:\d{2}(?:\.\d+)?>/g, '').trim();
    for (const match of timestamps) {
      lines.push({ time: Math.max(0, Number(match[1]) * 60 + Number(match[2]) - offset), text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  // Some LRC files have several lines at one timestamp (duets, for example).
  return lines.reduce<LyricLine[]>((result, line) => {
    const previous = result.at(-1);
    if (previous?.time === line.time) previous.text = [previous.text, line.text].filter(Boolean).join('\n');
    else result.push({ ...line });
    return result;
  }, []);
}

export function LyricsPanel({ trackId, position, onSeek }: {
  trackId?: string;
  position: number;
  onSeek: (seconds: number) => void;
}) {
  const [result, setResult] = useState<SongLyrics | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [following, setFollowing] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFollowing(true);
    if (trackId) {
      // A stale response must never replace the newly selected song's lyrics.
      Promise.resolve().then(() => {
        if (!window.desktop) throw new Error('Desktop bridge unavailable');
        return window.desktop.getLyrics(trackId);
      }).then(value => {
        if (!cancelled) setResult(value);
      }).catch(() => {
        if (!cancelled) setResult({ status: 'unavailable' });
      });
    }
    return () => { cancelled = true; };
  }, [trackId, attempt]);

  const lines = useMemo(() => parseLyrics(result?.status === 'found' ? result.synced : null), [result]);
  let currentLine = -1;
  for (let i = 0; i < lines.length && lines[i].time <= position; i++) currentLine = i;
  const synced = lines.some(line => line.text);

  useEffect(() => {
    if (!following || !synced || !viewport.current) return;
    const container = viewport.current;
    const line = container.querySelector<HTMLElement>('[data-current="true"]');
    const top = line ? container.scrollTop + line.getBoundingClientRect().top - container.getBoundingClientRect().top - (container.clientHeight - line.clientHeight) / 2 : 0;
    container.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'instant' : 'smooth' });
  }, [currentLine, following, synced, reduced]);

  const pauseFollowing = () => { if (synced) setFollowing(false); };
  const found = result?.status === 'found' && !result.instrumental;

  return <section className="lyrics-panel" aria-label="Letra de la canción">
    <header className="lyrics-heading"><h3><TextQuote size={15} /> Letra</h3>{found && <span>{synced ? 'Sincronizada' : 'Texto completo'}</span>}</header>
    {found ? <>
      <div ref={viewport} className="lyrics-scroll" tabIndex={0} aria-label="Letra. Puedes desplazarte para leerla."
        onFocus={pauseFollowing} onWheel={pauseFollowing} onTouchStart={pauseFollowing} onPointerDown={pauseFollowing}
        onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) { pauseFollowing(); event.stopPropagation(); } }}>
        {synced ? lines.map((line, index) => <button key={index} type="button" className="lyrics-line" dir="auto"
          data-current={index === currentLine} aria-current={index === currentLine ? 'true' : undefined}
          aria-label={line.text ? undefined : 'Interludio'} title="Escuchar desde aquí" onClick={() => { onSeek(line.time); setFollowing(true); }}>
          {line.text || '♪'}
        </button>) : <p className="lyrics-plain" dir="auto">{result.plain}</p>}
      </div>
      {synced && <button className="lyrics-follow" type="button" onClick={() => setFollowing(value => !value)} aria-pressed={following}>
        {following ? 'Siguiendo la canción · pausar' : 'Seguir la canción'}
      </button>}
      <footer className="lyrics-credit">Letra de LRCLIB · sin traducción</footer>
    </> : <div className="lyrics-status" role="status">
      <Music2 size={22} aria-hidden="true" />
      {!trackId ? <><strong>Cada canción, sus palabras</strong><p>Elige una canción para leer su letra.</p></>
        : !result ? <><strong>Buscando la letra…</strong><p>Un momento para encontrar sus palabras.</p></>
        : result.status === 'found' ? <><strong>Solo la música</strong><p>Esta canción está marcada como instrumental en LRCLIB.</p></>
        : result.status === 'unavailable' ? <><strong>No se pudo cargar la letra</strong><p>Comprueba tu conexión e inténtalo de nuevo.</p><button type="button" className="lyrics-retry" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={13} /> Reintentar</button></>
        : <><strong>Aún no encontramos su letra</strong><p>No hay una coincidencia para esta versión. El título y el artista del archivo ayudan a encontrarla.</p></>}
    </div>}
  </section>;
}

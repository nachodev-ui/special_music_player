import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../../../shared/contracts';
import { roomEvents } from '../../secrets/events';

export type Repeat = 'off' | 'all' | 'one';
export function usePlayer(tracks: Track[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef(tracks); tracksRef.current = tracks;
  const queueRef = useRef<Track[] | null>(null);
  const currentRef = useRef<Track | null>(null);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<Repeat>('off');
  const attemptRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackStart, setPlaybackStart] = useState<{ trackId: string; sequence: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => { const value = Number(localStorage.getItem('usagi-volume') ?? 0.7); return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.7; });
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [error, setError] = useState('');

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const attempt = ++attemptRef.current;
    setError('');
    try { await audio.play(); }
    catch (error) {
      if (attempt === attemptRef.current && !(error instanceof DOMException && error.name === 'AbortError')) setError('No pude reproducir este archivo. Puede estar dañado o usar un formato no compatible.');
    }
  }, []);

  const select = useCallback((track: Track, autoplay = true, preserveQueue = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!preserveQueue) queueRef.current = null;
    if (currentRef.current?.id !== track.id) {
      attemptRef.current++;
      audio.pause();
      currentRef.current = track; setCurrent(track);
      setPosition(0); setDuration(track.duration); setError('');
      audio.src = track.url; audio.load();
    }
    if (autoplay) { void play(); roomEvents.emit({ type: 'track-played', trackId: track.id }); }
  }, [play]);

  const advance = useCallback((direction: 1 | -1, ended = false) => {
    const audio = audioRef.current;
    const list = queueRef.current ?? tracksRef.current;
    if (!audio || !list.length) return;
    if (direction === -1 && audio.currentTime > 3 && !ended) { audio.currentTime = 0; setPosition(0); return; }
    if (ended && repeatRef.current === 'one') { audio.currentTime = 0; void play(); return; }
    const index = list.findIndex((track) => track.id === currentRef.current?.id);
    if (index < 0) { select(direction === 1 ? list[0] : list[list.length - 1], true, true); return; }
    if (shuffleRef.current && list.length > 1) {
      if (direction === -1) {
        const previous = historyRef.current.pop();
        const track = list.find((item) => item.id === previous);
        if (track) { select(track, true, true); return; }
      }
      const choices = list.filter((track) => track.id !== currentRef.current?.id);
      if (currentRef.current) historyRef.current.push(currentRef.current.id);
      select(choices[Math.floor(Math.random() * choices.length)], true, true); return;
    }
    const next = index + direction;
    if (ended && next >= list.length && repeatRef.current === 'off') { setPlaying(false); return; }
    select(list[(next + list.length) % list.length], true, true);
  }, [play, select]);

  useEffect(() => {
    const audio = new Audio(); audio.preload = 'metadata'; audioRef.current = audio;
    const sync = () => { setPosition(audio.currentTime || 0); if (Number.isFinite(audio.duration)) setDuration(audio.duration); };
    let startedTrackId: string | null = null;
    const onPlay = () => { if (!audio.paused) setPlaying(true); };
    const onPlaying = () => {
      if (audio.paused) return;
      const track = currentRef.current;
      if (track && startedTrackId !== track.id) {
        startedTrackId = track.id;
        setPlaybackStart(previous => ({ trackId: track.id, sequence: (previous?.sequence ?? 0) + 1 }));
      }
    };
    const onPause = () => { startedTrackId = null; setPlaying(false); };
    const onEnded = () => { startedTrackId = null; advance(1, true); };
    const onError = () => { setPlaying(false); setError('No pude reproducir este archivo. Prueba otra canción o revisa el archivo original.'); };
    audio.addEventListener('timeupdate', sync); audio.addEventListener('loadedmetadata', sync); audio.addEventListener('durationchange', sync);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('play', onPlay); audio.addEventListener('pause', onPause); audio.addEventListener('ended', onEnded); audio.addEventListener('error', onError);
    return () => {
      audio.pause(); audio.removeAttribute('src');
      audio.removeEventListener('timeupdate', sync); audio.removeEventListener('loadedmetadata', sync); audio.removeEventListener('durationchange', sync);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause); audio.removeEventListener('ended', onEnded); audio.removeEventListener('error', onError);
      audio.load(); audioRef.current = null;
    };
  }, [advance]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; localStorage.setItem('usagi-volume', String(volume)); }, [volume]);
  useEffect(() => {
    const selected = currentRef.current;
    const updated = tracks.find(track => track.id === selected?.id);
    if (selected && updated && selected !== updated) { currentRef.current = updated; setCurrent(updated); }
    if (selected && !updated) {
      attemptRef.current++; audioRef.current?.pause(); audioRef.current?.removeAttribute('src'); audioRef.current?.load();
      currentRef.current = null; setCurrent(null); setPosition(0); setDuration(0); setError(''); historyRef.current = []; queueRef.current = null;
    }
  }, [tracks]);

  const toggle = useCallback(() => {
    if (!currentRef.current) { if (tracksRef.current[0]) select(tracksRef.current[0]); }
    else if (audioRef.current?.paused) void play();
    else { attemptRef.current++; audioRef.current?.pause(); }
  }, [play, select]);
  const unlock = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.paused) return;
    if (!currentRef.current && tracksRef.current[0]) select(tracksRef.current[0], false);
    if (!audio.src) return;
    // play/pausa síncronos conservan el gesto del usuario sin adelantar la canción.
    void audio.play().catch(() => {});
    audio.pause();
  }, [select]);
  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration)) { audio.currentTime = Math.max(0, Math.min(value, audio.duration)); setPosition(audio.currentTime); }
  }, []);
  const playQueue = useCallback((list: Track[], first?: Track, random = false) => {
    if (!list.length) return;
    const order = [...list];
    if (random) for (let index = order.length - 1; index > 0; index--) {
      const chosen = Math.floor(Math.random() * (index + 1));
      [order[index], order[chosen]] = [order[chosen], order[index]];
    }
    queueRef.current = order;
    historyRef.current = [];
    select(first ?? order[0], true, true);
  }, [select]);
  return { current, playing, playbackStart, position, duration, volume, shuffle, repeat, error, select, toggle, unlock, seek,
    playQueue,
    next: () => advance(1), previous: () => advance(-1), setVolume,
    toggleShuffle: () => { shuffleRef.current = !shuffleRef.current; setShuffle(shuffleRef.current); historyRef.current = []; },
    cycleRepeat: () => { repeatRef.current = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off'; setRepeat(repeatRef.current); },
  };
}

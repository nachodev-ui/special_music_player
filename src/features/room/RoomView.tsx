import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { FolderPlus, Shirt } from 'lucide-react';
import type { Track } from '../../../shared/contracts';
import type { usePlayer } from '../player/usePlayer';
import { roomEvents } from '../../secrets/events';
import { albumsPerPage } from './room.config';
import { room3d, roomPalette, type RoomPalette } from './room3d.config';
import { phaseLabels, useRoomEnvironment, weatherLabel } from './useRoomEnvironment';
import { OutfitDialog } from './OutfitDialog';
import './room.css';

const Room3D = lazy(() => import('./Room3D').then(module => ({ default: module.Room3D })));
type Player = ReturnType<typeof usePlayer>;
export function RoomView({ hidden, player, tracks, loading, error, chooseFolder }: {
  hidden: boolean; player: Player; tracks: Track[]; loading: boolean; error: string; chooseFolder: () => Promise<void>;
}) {
  const { now, weather, phase, location } = useRoomEnvironment();
  const reduced = !!useReducedMotion();
  const section = useRef<HTMLElement>(null);
  const outfitButton = useRef<HTMLButtonElement>(null);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const openWardrobe = useCallback(() => setWardrobeOpen(true), []);
  const closeWardrobe = useCallback(() => setWardrobeOpen(false), []);
  useEffect(() => { if (hidden) setWardrobeOpen(false); }, [hidden]);
  const [outfit, setOutfit] = useState(() => {
    try {
      const saved = localStorage.getItem('usagi-outfit');
      return room3d.mikako.outfits.find(item => item.id === saved)?.id ?? 'rosa';
    } catch { return 'rosa'; }
  });
  const currentOutfit = room3d.mikako.outfits.find(item => item.id === outfit)!;
  useEffect(() => {
    try { localStorage.setItem('usagi-outfit', outfit); } catch { /* Storage may be unavailable. */ }
  }, [outfit]);
  const [palette, setPalette] = useState<RoomPalette>(roomPalette);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const update = () => {
      if (!section.current) return;
      const css = getComputedStyle(section.current);
      const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      setPalette({
        ...roomPalette, bg: token('--bg', roomPalette.bg), surface: token('--surface', roomPalette.surface),
        wall: token('--room-wall', roomPalette.wall), wood: token('--room-wood', roomPalette.wood),
        accent: token('--accent', roomPalette.accent), soft: token('--room-soft', roomPalette.soft),
        ink: token('--room-outline', roomPalette.ink), highlight: token('--accent-deep', roomPalette.highlight),
        rose: token('--room-rose', roomPalette.rose), brass: token('--room-brass', roomPalette.brass),
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const [lampOverride, setLampOverride] = useState<boolean | null>(null);
  const night = phase === 'night';
  useEffect(() => setLampOverride(null), [night]);
  const lampOn = lampOverride ?? night;
  const [plantTaps, setPlantTaps] = useState(0);
  const [mikakoTaps, setMikakoTaps] = useState(0);
  useEffect(() => { if (!plantTaps) return; const timer = window.setTimeout(() => setPlantTaps(0), 1200); return () => window.clearTimeout(timer); }, [plantTaps]);
  useEffect(() => { if (!mikakoTaps) return; const timer = window.setTimeout(() => setMikakoTaps(0), 1200); return () => window.clearTimeout(timer); }, [mikakoTaps]);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(tracks.length / albumsPerPage));
  useEffect(() => {
    const index = tracks.findIndex(track => track.id === player.current?.id);
    setPage(index < 0 ? 0 : Math.floor(index / albumsPerPage));
  }, [player.current?.id, tracks.length]);
  const safePage = Math.min(page, pageCount - 1);
  const albums = useMemo(() => tracks.slice(safePage * albumsPerPage, (safePage + 1) * albumsPerPage), [tracks, safePage]);
  const scenePlayer = useMemo(() => ({
    current: player.current, playing: player.playing, toggle: player.toggle, unlock: player.unlock,
    previous: player.previous, next: player.next, select: player.select,
  }), [player.current, player.playing, player.toggle, player.unlock, player.previous, player.next, player.select]);
  const toggleLamp = useCallback(() => setLampOverride(!lampOn), [lampOn]);
  const tapPlant = useCallback(() => setPlantTaps(value => value + 1), []);
  const [hover, setHover] = useState('');
  const tapMikako = useCallback(() => { setMikakoTaps(value => value + 1); roomEvents.emit({ type: 'mascot-tapped' }); }, []);
  return <section ref={section} hidden={hidden} className="room-view" aria-label="Mi cuarto">
    <div className="room-heading"><div><span className="japanese-label">音楽のある暮らし</span><h1>Mi cuarto <span>♡</span></h1><p>Discos, recuerdos y canciones para quedarse.</p></div><div className="room-clock"><strong>{now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: location.timeZone })}</strong><span>{phaseLabels[phase]} · {location.name}</span></div></div>
    <style>{`
      .room-outfit-button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; margin-bottom: 10px; font-size: 13px; border-radius: 10px; background: var(--tint); }
      .room-outfit-button:hover { background: var(--tint); }
      .room-outfit-button:focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 3px; }
      @media (prefers-reduced-motion: reduce) {
        .room-outfit-button, .room-outfit-button:hover { transition: none; transform: none; }
      }
    `}</style>
    <button ref={outfitButton} type="button" className="subtle-button room-outfit-button" aria-label="Cambiar outfit"
      onClick={() => setOutfit(room3d.mikako.outfits[(room3d.mikako.outfits.indexOf(currentOutfit) + 1) % room3d.mikako.outfits.length].id)}>
      <Shirt size={16} aria-hidden="true" />Outfit · {currentOutfit.label}
    </button>
    {(error || player.error) && <div className="error-note" role="alert">{error || player.error}</div>}
    <div className={'room-scene' + (hover ? ' room-scene-hover' : '')}>
      {!hidden && <Suspense fallback={<p className="room-3d-loading" role="status">Preparando tu cuarto…</p>}>
        <Room3D palette={palette} active={visible} player={scenePlayer} albums={albums} hasTracks={!!tracks.length}
          phase={phase} weather={weather} lampOn={lampOn} reduced={reduced} page={safePage} pageCount={pageCount}
          outfit={outfit} mikakoTaps={mikakoTaps} setPage={setPage} toggleLamp={toggleLamp}
          tapPlant={tapPlant} tapMikako={tapMikako} onHover={setHover} openWardrobe={openWardrobe} />
      </Suspense>}
    </div>
    <div className="room-caption"><div className="room-caption-song"><span className="room-caption-icon">{player.playing ? '♪' : '♫'}</span><div><strong>{player.current?.title ?? 'Tu cuarto está listo para escuchar'}</strong><span>{player.current?.artist ?? 'Toca un álbum o trae tus canciones.'}</span></div></div><div className="room-weather">{weather ? <><span>{weatherLabel(weather.code)} · {Math.round(weather.temperature)} °C</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Clima: Open-Meteo</a></> : <span>La ventana sigue el reloj · sin clima</span>}</div></div>
    {!tracks.length && <button className="subtle-button room-bring-music" disabled={loading} onClick={() => void chooseFolder()}><FolderPlus size={16} />{loading ? 'Preparando tu música…' : 'Traer mis canciones'}</button>}
    <p className="room-hint" aria-live="polite">{hover || (plantTaps ? 'Tu plantita te devuelve el cariño. ✿' : mikakoTaps ? 'Mikako se queda a escuchar contigo. ♡' : tracks.length ? 'Toca el disco o una carátula para escuchar. Estante: página ' + (safePage + 1) + ' de ' + pageCount + '.' : loading ? 'Preparando tus álbumes…' : 'Aquí vivirán tus canciones ♡')}</p>
    <p className="room-keyboard-hint" id="room-keyboard-hint">Clic en el suelo para caminar · Con el cuarto enfocado: Espacio o Enter para play/pausa · ← → canción · 1–6 álbum · RePág/AvPág estante · L luz · P planta · U Mikako.</p>
    {wardrobeOpen && !hidden && <OutfitDialog outfit={outfit} fallbackFocus={outfitButton}
      onClose={closeWardrobe} onChoose={next => { setOutfit(next); closeWardrobe(); }} />}
  </section>;
}

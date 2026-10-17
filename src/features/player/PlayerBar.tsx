import type { CSSProperties } from 'react';
import { Heart, Pause, Play, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, StickyNote } from 'lucide-react';
import { motion } from 'motion/react';
import { Artwork } from '../../components/Artwork';
import { usePlayer } from './usePlayer';

export function time(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
type Player = ReturnType<typeof usePlayer>;
export function PlayerBar({ player, hasTracks, favorite, onFavorite, noteOpen, onToggleNote }: { player: Player; hasTracks: boolean; favorite: boolean; onFavorite: () => void; noteOpen: boolean; onToggleNote: () => void }) {
  const pct = player.duration ? (player.position / player.duration) * 100 : 0;
  return <footer className="player-bar">
    <div className="player-track"><Artwork track={player.current} size="medium" /><div><strong>{player.current?.title ?? '¿Qué vas a escuchar, bobita?'}</strong><span>{player.current?.artist ?? 'Un poquito de música, un poquito de amor'}</span></div>
      <button className={`icon-button heart ${favorite ? 'active' : ''}`} disabled={!player.current} title="Guardar en favoritos" aria-label="Guardar en favoritos" aria-pressed={favorite} onClick={onFavorite}><Heart size={18} fill={favorite ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="playback">
      <div className="playback-buttons">
        <button className={`icon-button ${player.shuffle ? 'active' : ''}`} aria-label="Reproducción aleatoria" title="Aleatorio" aria-pressed={player.shuffle} disabled={!hasTracks} onClick={player.toggleShuffle}><Shuffle size={17} /></button>
        <button className="icon-button skip" aria-label="Canción anterior" title="Anterior" disabled={!hasTracks} onClick={player.previous}><SkipBack size={21} fill="currentColor" /></button>
        <motion.button whileTap={{ scale: 0.9 }} className="play-button" aria-label={player.playing ? 'Pausar' : 'Reproducir'} title="Reproducir / pausar · Espacio" disabled={!hasTracks} onClick={player.toggle}>{player.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</motion.button>
        <button className="icon-button skip" aria-label="Canción siguiente" title="Siguiente" disabled={!hasTracks} onClick={player.next}><SkipForward size={21} fill="currentColor" /></button>
        <button className={`icon-button ${player.repeat !== 'off' ? 'active' : ''}`} aria-label={`Repetición: ${player.repeat === 'off' ? 'desactivada' : player.repeat === 'one' ? 'una canción' : 'todas'}`} title={`Repetir: ${player.repeat === 'off' ? 'no' : player.repeat === 'one' ? 'una' : 'todas'}`} disabled={!hasTracks} onClick={player.cycleRepeat}>{player.repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}</button>
      </div>
      <div className="progress"><span>{time(player.position)}</span><input aria-label="Progreso de reproducción" type="range" min={0} max={player.duration || 1} step="0.1" value={Math.min(player.position, player.duration || 1)} disabled={!player.current || !player.duration} style={{ '--fill': `${pct}%` } as CSSProperties} onChange={(event) => player.seek(Number(event.target.value))} /><span>{time(player.duration)}</span></div>
    </div>
    <div className="volume"><button className={`icon-button song-note-toggle ${noteOpen ? 'active' : ''}`} aria-label={noteOpen ? 'Cerrar nota personal' : 'Ver nota personal de la canción'} title="Mi nota personal" aria-expanded={noteOpen} aria-controls={noteOpen ? 'song-note-card' : undefined} disabled={!player.current} onClick={onToggleNote}><StickyNote size={19} /></button><button className="icon-button" aria-label={player.volume ? 'Silenciar' : 'Activar sonido'} title="Silenciar" onClick={() => player.setVolume(player.volume ? 0 : 0.7)}>{player.volume ? <Volume2 size={19} /> : <VolumeX size={19} />}</button><input aria-label="Volumen" type="range" min="0" max="1" step="0.01" value={player.volume} style={{ '--fill': `${player.volume * 100}%` } as CSSProperties} onChange={(event) => player.setVolume(Number(event.target.value))} /><span>{Math.round(player.volume * 100)}%</span></div>
  </footer>;
}

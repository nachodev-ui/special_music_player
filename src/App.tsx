import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence, color, motion } from 'motion/react';
import { ArrowDownAZ, Check, ChevronRight, Disc3, FolderHeart, FolderPlus, Heart, Library, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Plus, Search, Shuffle, Sun, Trash2, X } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { Artwork, PlaceholderArtwork } from './components/Artwork';
import { LyricsPanel } from './components/LyricsPanel';
import { useLibrary } from './features/library/useLibrary';
import { usePlaylists } from './features/library/usePlaylists';
import { usePlayer } from './features/player/usePlayer';
import { PlayerBar, time } from './features/player/PlayerBar';
import { SongNoteCard } from './features/player/SongNoteCard';
import { useSongNotes } from './features/player/useSongNotes';
import { appear } from './animations/presets';
import { RoomView } from './features/room/RoomView';
import { roomEvents } from './secrets/events';
import type { Playlist, Track } from '../shared/contracts';

const noTracks: Track[] = [];
const defaultHeroDotColor = '#ffc2d1';
const themes = [{ id: 'honey', name: 'Miel', color: '#e6b95c' }, { id: 'sakura', name: 'Sakura', color: '#dfa6be' }, { id: 'matcha', name: 'Matcha', color: '#a8bb83' }];
function PlaylistCover({ playlist, size }: { playlist: Playlist; size: 'small' | 'large' }) {
  const [failed, setFailed] = useState<string>();
  return playlist.cover && playlist.cover !== failed
    ? <img src={playlist.cover} alt={size === 'large' ? `Portada de ${playlist.name}` : ''} onError={() => setFailed(playlist.cover ?? undefined)} />
    : <PlaceholderArtwork title={playlist.name} size={size} />;
}
export default function App() {
  const { library, loading, error, chooseFolder } = useLibrary();
  const savedPlaylists = usePlaylists();
  const tracks = library?.tracks ?? noTracks;
  const player = usePlayer(tracks);
  const notes = useSongNotes(player.current?.id);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => {
    setNoteOpen(!!player.current && player.playbackStart?.trackId === player.current.id);
  }, [player.current?.id, player.playbackStart]);
  const [roomVisible, setRoomVisible] = useState(false);
  const [view, setView] = useState<string>('all');
  const [playlistMenu, setPlaylistMenu] = useState(false);
  const [addMenu, setAddMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'create' | 'rename' | 'delete'; id?: string; trackPath?: string; name: string } | null>(null);
  const [dialogName, setDialogName] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('usagi-theme') || 'honey');
  const [favorites, setFavorites] = useState<string[]>(() => { try { const saved: unknown = JSON.parse(localStorage.getItem('usagi-favorites') || '[]'); return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } });
  const [mascotTap, setMascotTap] = useState(0);
  const [heroDotColor, setHeroDotColor] = useState(defaultHeroDotColor);
  useEffect(() => {
    const artwork = player.current?.artwork;
    if (!artwork) { setHeroDotColor(defaultHeroDotColor); return; }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 24;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 24, 24);
        const pixels = context.getImageData(0, 0, 24, 24).data;
        const colors = new Map<number, { count: number; red: number; green: number; blue: number }>();
        for (let index = 0; index < pixels.length; index += 4) {
          const [red, green, blue, alpha] = pixels.slice(index, index + 4);
          if (alpha < 160 || (red > 228 && green > 228 && blue > 228)) continue;
          const key = (red >> 5 << 10) | (green >> 5 << 5) | (blue >> 5);
          const bucket = colors.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
          bucket.count++;
          bucket.red += red;
          bucket.green += green;
          bucket.blue += blue;
          colors.set(key, bucket);
        }
        const dominant = [...colors.values()].sort((a, b) => b.count - a.count)[0];
        if (dominant) setHeroDotColor(`rgb(${Math.round(dominant.red / dominant.count)} ${Math.round(dominant.green / dominant.count)} ${Math.round(dominant.blue / dominant.count)})`);
        else setHeroDotColor(defaultHeroDotColor);
      } catch { setHeroDotColor(defaultHeroDotColor); }
    };
    image.onerror = () => { if (!cancelled) setHeroDotColor(defaultHeroDotColor); };
    image.src = artwork;
    return () => { cancelled = true; };
  }, [player.current?.artwork]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('usagi-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('usagi-favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === 'Space') { event.preventDefault(); player.toggle(); }
      if (event.altKey && event.code === 'ArrowRight') { event.preventDefault(); player.next(); }
      if (event.altKey && event.code === 'ArrowLeft') { event.preventDefault(); player.previous(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [player.toggle, player.next, player.previous]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const selected = savedPlaylists.playlists.find(item => item.id === view);
    const source = selected ? selected.paths.map(filename => tracks.find(track => track.path === filename)).filter((track): track is Track => !!track) : tracks;
    const list = source.filter((track) => (view !== 'favorites' || favorites.includes(track.id)) && `${track.title} ${track.artist} ${track.album} ${track.filename}`.toLocaleLowerCase().includes(query));
    return sort ? list.sort((a, b) => a.title.localeCompare(b.title, 'es', { numeric: true })) : list;
  }, [tracks, view, savedPlaylists.playlists, favorites, search, sort]);
  const selectedPlaylist = savedPlaylists.playlists.find(item => item.id === view);
  const missingPaths = selectedPlaylist?.paths.filter(filename => !tracks.some(track => track.path === filename)) ?? [];
  const playlistTracks = selectedPlaylist?.paths.map(filename => tracks.find(track => track.path === filename)).filter((track): track is Track => !!track) ?? [];
  const playlistDuration = Math.round(playlistTracks.reduce((sum, track) => sum + track.duration, 0) / 60);
  const libraryFavorites = tracks.filter((track) => favorites.includes(track.id)).length;
  function favorite(id: string) { setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  const totalMinutes = Math.round(tracks.reduce((total, track) => total + track.duration, 0) / 60);
  const currentFavorite = !!player.current && favorites.includes(player.current.id);
  function openDialog(next: { kind: 'create' | 'rename' | 'delete'; id?: string; trackPath?: string; name: string }) { setDialog(next); setDialogName(next.name); setPlaylistMenu(false); setAddMenu(null); }
  async function submitDialog() {
    if (!dialog) return;
    if (dialog.kind === 'delete' && dialog.id) {
      const result = await savedPlaylists.remove(dialog.id);
      if (result) { setView('all'); setDialog(null); }
    } else if (dialog.kind === 'rename' && dialog.id) {
      if (await savedPlaylists.rename(dialog.id, dialogName)) setDialog(null);
    } else if (dialog.kind === 'create') {
      const result = await savedPlaylists.create(dialogName);
      if (result) {
        const created = result[result.length - 1];
        if (dialog.trackPath) await savedPlaylists.addTrack(created.id, dialog.trackPath);
        setView(created.id); setRoomVisible(false); setDialog(null);
      }
    }
  }

  return <div className="app-shell">
    <TitleBar />
    <div className={`workspace ${roomVisible ? 'room-workspace' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Music2 size={24} /></span><div><strong>suki's <span>room</span></strong><small>ちいさな音楽の部屋</small></div></div>
        <div className="sidebar-label">TU PEQUEÑO RINCÓN</div>
        <nav aria-label="Biblioteca">
          <button className={`nav-item ${!roomVisible && view === 'all' ? 'selected' : ''}`} onClick={() => { setView('all'); setRoomVisible(false); }}><Library size={19} />Mi música<span>{tracks.length}</span></button>
          <button className={`nav-item ${!roomVisible && view === 'favorites' ? 'selected' : ''}`} onClick={() => { setView('favorites'); setRoomVisible(false); }}><Heart size={19} />Favoritas<span>{libraryFavorites}</span></button>
          <button className={`nav-item room-nav ${roomVisible ? 'selected' : ''}`} aria-label="Mi cuarto" aria-pressed={roomVisible} onClick={() => setRoomVisible(visible => !visible)}><span className="room-nav-thumb"><img src="./room-preview.png" alt="" /></span><span className="room-nav-copy" aria-hidden="true"><strong>Mi cuarto</strong><small>{player.playing ? 'Mikako te está escuchando' : 'Mikako te espera'}</small></span></button>
        </nav>
        <section className="playlist-sidebar" aria-label="Tus playlists">
          <div className="playlist-sidebar-heading"><span>TUS PLAYLISTS <small>プレイリスト</small></span><button aria-label="Nueva playlist" title="Nueva playlist" onClick={() => openDialog({ kind: 'create', name: '' })}><Plus size={16} /></button></div>
          <div className="playlist-sidebar-list">{savedPlaylists.playlists.map(item => <button key={item.id} className={`playlist-nav ${!roomVisible && view === item.id ? 'selected' : ''}`} onClick={() => { setView(item.id); setRoomVisible(false); setSearch(''); }}><span className="playlist-thumb"><PlaylistCover playlist={item} size="small" /></span><span className="playlist-nav-name">{item.name}</span></button>)}</div>
          <button className="playlist-new" onClick={() => openDialog({ kind: 'create', name: '' })}><Plus size={15} />Nueva playlist</button>
        </section>
        <div className="folder-section"><div className="sidebar-label">DESDE TU COMPUTADOR</div><button className="folder-button" disabled={loading} onClick={() => void chooseFolder()}>{loading ? <LoaderCircle size={19} className="spinning" /> : <FolderPlus size={19} />}<span>{library ? 'Cambiar carpeta' : 'Añadir carpeta'}</span></button>{library && <div className="folder-path" title={library.folder}><FolderHeart size={14} /><span>{library.folderName}</span><span className="local-dot" /></div>}<p>Solo para ti</p></div>
        <div className="sidebar-bottom"><div className="theme-picker"><span><Sun size={15} />El color de hoy</span><div>{themes.map((item) => <button key={item.id} style={{ background: item.color }} aria-label={`Tema ${item.name}`} title={item.name} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}>{theme === item.id && <Check size={13} />}</button>)}</div></div><div className="offline-note"><span className="local-dot" />Una sorpresa para ti</div></div>
      </aside>
      <main className={`main-content ${roomVisible ? 'room-main' : ''}`}>
        <RoomView hidden={!roomVisible} player={player} tracks={tracks} loading={loading} error={error} chooseFolder={chooseFolder} />
        {!roomVisible && <>
        {!selectedPlaylist && <><div className="page-heading"><div><div className="eyebrow">MÚSICA PARA TUS DÍAS</div><h1>Qué bueno que estás aquí<span> ♡</span></h1></div><span className="room-badge"><span className="local-dot" />Tu espacio personal</span></div>
        <motion.section {...appear} className="welcome-card" style={{ '--hero-dot-color': heroDotColor } as CSSProperties}>
          <svg className="hero-dots hero-dots-pink" aria-hidden="true"><defs><pattern id="hero-pink-dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="3.4" fill="currentColor" /></pattern></defs><rect width="100%" height="100%" fill="url(#hero-pink-dots)" /></svg>
          <svg className="hero-dots hero-dots-yellow" aria-hidden="true"><defs><pattern id="hero-yellow-dots" width="56" height="56" patternUnits="userSpaceOnUse"><circle cx="34" cy="34" r="4" fill="currentColor" /></pattern></defs><rect width="100%" height="100%" fill="url(#hero-yellow-dots)" /></svg>
          <svg className="hero-decoration hero-star" viewBox="0 0 56 56" aria-hidden="true"><path d="M28 3 34 21 53 28 34 35 28 53 21 35 3 28 21 21Z" /></svg>
          <svg className="hero-decoration hero-heart" viewBox="0 0 55 51" aria-hidden="true"><path d="M27 47C17 39 4 30 4 18 4 9 16 4 27 15 38 4 51 9 51 18 51 30 38 39 27 47Z" /></svg>
          <div className="welcome-copy"><span className="japanese-label">きみと、音楽と。</span><h2>Un ratito de música.<br />Hecho especial para ti.</h2><p>Por que amas la música.<br />Y te hace sentir bien.</p><div className="welcome-actions"><button className="primary-button" disabled={loading} onClick={() => tracks.length ? player.toggle() : void chooseFolder()}>{loading ? <LoaderCircle size={16} className="spinning" /> : tracks.length ? (player.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />) : <FolderPlus size={16} />}{tracks.length ? (player.playing ? 'Hagamos una pausa' : 'Escuchar mi música') : 'Traer mis canciones'}<ChevronRight size={14} /></button><button className="playlist-action secondary room-cta" onClick={() => setRoomVisible(true)}>Pasa a tu cuarto →</button></div></div>
          <div className="hero-collage">
            <svg className="hero-ribbon" viewBox="0 0 175 54" aria-hidden="true"><path d="M5 13 72 8 85 1 97 8 169 13 153 28 168 41 99 35 85 52 71 35 7 41 21 27Z" /><path d="M20 27 75 22M96 22 152 27" /></svg>
            <div className="hero-magazine"><img src="./assets/room3d/posters/mikako_with_a_cat.jpg" alt="Portada de Mikako con un gato" /></div>
            <svg className="hero-decoration hero-collage-sparkle" viewBox="0 0 56 56" aria-hidden="true"><path d="M28 3 34 21 53 28 34 35 28 53 21 35 3 28 21 21Z" /></svg>
            <button className="mascot" aria-label="Saludar a Usagi" onClick={() => { setMascotTap((value) => value + 1); roomEvents.emit({ type: 'mascot-tapped' }); }}><motion.img key={mascotTap} src="./characters/usagi.jpg" alt="Usagi, feliz con su bolso de estrella" animate={mascotTap ? { rotate: [0, -7, 7, 0], y: [0, -10, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }} /><span>{mascotTap ? '¡Yaha! ♡' : '今日もいっしょ。'}</span></button>
          </div>
        </motion.section></>}
        {selectedPlaylist && <motion.section {...appear} className="playlist-hero">
          <div className="playlist-hero-dots" aria-hidden="true" />
          <div className="playlist-cover"><PlaylistCover playlist={selectedPlaylist} size="large" /></div>
          <div className="playlist-hero-copy"><span className="playlist-kicker">°❀⋆.ೃ࿔*:♡･</span><h1>{selectedPlaylist.name}</h1><p>{selectedPlaylist.paths.length} {selectedPlaylist.paths.length === 1 ? 'canción' : 'canciones'} · {playlistDuration} min{missingPaths.length > 0 ? ` · ${missingPaths.length} no disponibles` : ''}</p><div className="playlist-hero-actions"><button className="playlist-action" disabled={!playlistTracks.length} onClick={() => player.playQueue(playlistTracks)}><Play size={15} fill="currentColor" />Reproducir</button><button className="playlist-action secondary" disabled={!playlistTracks.length} onClick={() => player.playQueue(playlistTracks, undefined, true)}><Shuffle size={15} />Aleatorio</button><div className="playlist-options"><button className="playlist-more" aria-label="Opciones de playlist" aria-expanded={playlistMenu} onClick={() => setPlaylistMenu(value => !value)}><MoreHorizontal size={19} /></button>{playlistMenu && <div className="playlist-popover"><button onClick={() => openDialog({ kind: 'rename', id: selectedPlaylist.id, name: selectedPlaylist.name })}>Renombrar</button><button onClick={() => { setPlaylistMenu(false); void savedPlaylists.chooseCover(selectedPlaylist.id); }}>Cambiar portada</button>{selectedPlaylist.cover && <button onClick={() => { setPlaylistMenu(false); void savedPlaylists.clearCover(selectedPlaylist.id); }}>Dejar sin imagen</button>}<button className="danger" onClick={() => openDialog({ kind: 'delete', id: selectedPlaylist.id, name: selectedPlaylist.name })}><Trash2 size={14} />Eliminar playlist</button></div>}</div></div></div>
        </motion.section>}
        <section className="library-section" aria-label="Lista de canciones">
          <div className="library-heading"><div><h2>{selectedPlaylist ? 'Canciones de la playlist' : view === 'all' ? 'Tu colección' : 'Tus favoritas'}<span>✿</span></h2><p>{selectedPlaylist ? `${playlistTracks.length} disponibles` : tracks.length ? `${visible.length} canciones · ${totalMinutes} min de compañía` : 'Sube las que más atesores y ames.'}</p></div><div className="list-actions"><div className="search-field"><Search size={16} /><input aria-label="Buscar canciones" placeholder="Buscar una canción…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="Limpiar búsqueda" onClick={() => setSearch('')}><X size={13} /></button>}</div><button className={`icon-button sort-button ${sort ? 'active' : ''}`} title="Ordenar por título" aria-label="Ordenar canciones por título" aria-pressed={sort} onClick={() => setSort(!sort)}><ArrowDownAZ size={19} /></button></div></div>
          {(error || player.error) && <div className="error-note" role="alert">{error || player.error}</div>}
          {savedPlaylists.error && <div className="error-note" role="alert">{savedPlaylists.error}</div>}
          {library?.skipped ? <div className="info-note">No se pudieron leer {library.skipped} subcarpetas. El resto está aquí.</div> : null}
          {loading ? <div className="empty-state"><LoaderCircle className="spinning" size={32} /><h3>Preparando tu rincón…</h3><p>Leyendo canciones, carátulas y pequeños detalles.</p></div> : visible.length ? <div className="track-table"><div className="track-table-head"><span>#</span><span>CANCIÓN</span><span>ÁLBUM</span><span>TIEMPO</span><span /></div><div className="track-list">{visible.map((track, index) => {
            const selected = player.current?.id === track.id;
            return <div className={`track-row ${selected ? 'current' : ''}`} key={track.id}>
              <button className="track-number" aria-label={`${selected && player.playing && !selectedPlaylist ? 'Pausar' : 'Reproducir'} ${track.title}`} onClick={() => selectedPlaylist ? player.playQueue(playlistTracks, track) : selected ? player.toggle() : player.select(track)}>{selected && player.playing ? <span className="equalizer"><i /><i /><i /></span> : <><span className="row-index">{String(index + 1).padStart(2, '0')}</span><Play className="row-play" size={13} fill="currentColor" /></>}</button>
              <button className="track-info" onClick={() => selectedPlaylist ? player.playQueue(playlistTracks, track) : selected ? player.toggle() : player.select(track)}><Artwork track={track} /><span><strong>{track.title}</strong><small>{track.artist}<b>{track.format}</b></small></span></button>
              <span className="track-album" title={track.album}>{track.album}</span><span className="track-duration">{track.duration ? time(track.duration) : '—'}</span><div className="track-actions"><button className={`icon-button heart ${favorites.includes(track.id) ? 'active' : ''}`} aria-label={`Marcar ${track.title} como favorita`} aria-pressed={favorites.includes(track.id)} onClick={() => favorite(track.id)}><Heart size={16} fill={favorites.includes(track.id) ? 'currentColor' : 'none'} /></button><div className="track-add"><button className="icon-button" title="Agregar a playlist" aria-label={`Agregar ${track.title} a playlist`} aria-expanded={addMenu === track.id} onClick={() => setAddMenu(addMenu === track.id ? null : track.id)}><Plus size={17} /></button>{addMenu === track.id && <div className="playlist-popover track-add-popover">{savedPlaylists.playlists.map(item => <button key={item.id} disabled={item.paths.includes(track.path)} onClick={() => { setAddMenu(null); void savedPlaylists.addTrack(item.id, track.path); }}>{item.name}{item.paths.includes(track.path) && ' ✓'}</button>)}<button onClick={() => openDialog({ kind: 'create', name: '', trackPath: track.path })}><Plus size={14} />Nueva playlist</button></div>}</div>{selectedPlaylist && <button className="icon-button" title="Quitar de la playlist" aria-label={`Quitar ${track.title} de ${selectedPlaylist.name}`} onClick={() => void savedPlaylists.removeTrack(selectedPlaylist.id, track.path)}><X size={16} /></button>}</div>
            </div>;
          })}</div></div> : <motion.div {...appear} className="empty-state"><span className="empty-icon">{view === 'favorites' ? <Heart size={29} /> : search ? <Search size={29} /> : <FolderHeart size={31} />}</span><h3>{search ? 'Esa canción se está escondiendo' : selectedPlaylist ? 'Esta playlist espera sus canciones' : view === 'favorites' ? 'Un lugar para tus favoritas' : library ? 'Esta carpeta aún no tiene música' : 'Tu música tiene un nuevo hogar'}</h3><p>{search ? 'Prueba con otro título, artista o álbum.' : selectedPlaylist ? 'Usa el botón + de una canción en Mi música para agregarla aquí.' : view === 'favorites' ? 'Toca el corazón de una canción para guardarla aquí.' : 'Elige una carpeta con MP3 o FLAC.'}</p>{!search && view === 'all' && <button className="subtle-button" onClick={() => void chooseFolder()}>Elegir carpeta<ChevronRight size={15} /></button>}<span className="empty-flower">✿</span></motion.div>}
          {selectedPlaylist && missingPaths.length > 0 && <div className="playlist-missing"><strong>No disponibles en la carpeta actual</strong>{missingPaths.map(filename => <div key={filename}><span title={filename}>{filename.split(/[\\/]/).pop()}</span><button aria-label={`Quitar ${filename} de la playlist`} onClick={() => void savedPlaylists.removeTrack(selectedPlaylist.id, filename)}><X size={15} /></button></div>)}</div>}
        </section>
        <div className="collection-footer"><span>君のそばにいる。</span><span>Hecho con mucho amor, para ti <Heart size={11} /></span></div>
        </>}
      </main>
      <aside className="now-panel"><div className="panel-heading"><span><Disc3 size={16} />DISFRUTA TU ESPACIO</span></div><AnimatePresence mode="wait"><motion.div key={player.current?.id ?? 'empty'} {...appear} className="now-content"><div className={`record-sleeve ${player.playing ? 'is-playing' : ''}`}><Artwork track={player.current} className="large-artwork" /><span className="record-sticker">♡</span></div><div className="now-title"><span className="tiny-label">{player.current ? player.current.format + ' · SONANDO EN TU RINCÓN' : 'LISTO PARA ESCUCHAR'}</span><h2>{player.current?.title ?? 'La banda sonora de tus días'}</h2><p>{player.current?.artist ?? 'Aquí empieza algo bonito.'}</p></div><div className="now-details"><span>{player.current?.album ?? 'Una canción a la vez'}</span><Heart size={14} /></div></motion.div></AnimatePresence><LyricsPanel key={player.current?.id ?? "no-track"} trackId={player.current?.id} position={player.position} onSeek={player.seek} /></aside>
    </div>
    <AnimatePresence mode="wait">
      {noteOpen && player.current && <SongNoteCard key={player.current.id} track={player.current} notes={notes} playbackSequence={player.playbackStart?.sequence ?? 0} onClose={() => setNoteOpen(false)} />}
    </AnimatePresence>
    {dialog && <div className="playlist-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><form className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDialog(null); } }} onSubmit={event => { event.preventDefault(); void submitDialog(); }}><span className="playlist-kicker">TU RINCÓN · プレイリスト</span><h2 id="playlist-dialog-title">{dialog.kind === 'create' ? 'Nueva playlist' : dialog.kind === 'rename' ? 'Renombrar playlist' : 'Eliminar playlist'}</h2>{dialog.kind === 'delete' ? <p>¿Eliminar “{dialog.name}”? Las canciones seguirán en tu biblioteca.</p> : <label>Nombre<input autoFocus maxLength={80} value={dialogName} onChange={event => setDialogName(event.target.value)} placeholder="Un nombre bonito…" required /></label>}<div className="playlist-dialog-actions"><button type="button" autoFocus={dialog.kind === 'delete'} onClick={() => setDialog(null)}>Cancelar</button><button type="submit" className={dialog.kind === 'delete' ? 'danger' : ''}>{dialog.kind === 'delete' ? 'Eliminar' : 'Guardar'}</button></div></form></div>}
    <PlayerBar noteOpen={noteOpen} onToggleNote={() => setNoteOpen(open => !open)} player={player} hasTracks={tracks.length > 0} favorite={currentFavorite} onFavorite={() => { if (player.current) favorite(player.current.id); }} />
  </div>;
}

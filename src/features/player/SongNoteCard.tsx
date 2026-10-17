import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Heart, LoaderCircle, Maximize2, Minimize2, PencilLine, X } from 'lucide-react';
import type { Track } from '../../../shared/contracts';
import { Artwork } from '../../components/Artwork';
import type { useSongNotes } from './useSongNotes';
import './songNotes.css';

type Notes = ReturnType<typeof useSongNotes>;
export function SongNoteCard({ track, notes, onClose, playbackSequence }: { track: Track; notes: Notes; onClose: () => void; playbackSequence: number }) {
  const reducedMotion = useReducedMotion();
  const [editing, setEditing] = useState(notes.dirty);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (editing || expanded || hovered || focused || notes.loading || notes.dirty || notes.error || notes.saving) return;
    const timer = window.setTimeout(() => closeRef.current(), 8000);
    return () => window.clearTimeout(timer);
  }, [editing, expanded, hovered, focused, notes.loading, notes.dirty, notes.error, notes.saving, playbackSequence]);

  function closeNote() {
    void notes.save();
    onClose();
  }

  function finishEditing() {
    setEditing(false);
  }

  return <motion.section
    id="song-note-card"
    className={`song-note-card ${expanded ? 'song-note-card-expanded' : ''}`}
    aria-label={`Nota personal de ${track.title}`}
    initial={{ opacity: 0, y: reducedMotion ? 0 : 16, scale: reducedMotion ? 1 : 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: reducedMotion ? 0 : 10, scale: reducedMotion ? 1 : 0.98 }}
    transition={{ duration: reducedMotion ? 0.1 : 0.35, ease: 'easeOut' }}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); closeNote(); }
      if (editing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void notes.save().then(ok => { if (ok) { setSaved(true); finishEditing(); } });
      }
    }}
  >
    <div className="song-note-heading">
      <span><img src="./characters/manga.jpg" alt="" />Recuerdos en canciones - ♡</span>
      <div className="song-note-heading-actions">
        <button className="icon-button" aria-label={expanded ? 'Reducir nota personal' : 'Ampliar nota personal'} title={expanded ? 'Reducir nota' : 'Ampliar nota'} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" aria-label="Cerrar nota personal" title="Cerrar" onClick={closeNote}><X size={17} /></button>
      </div>
    </div>
    <div className="song-note-track">
      <Artwork track={track} className="song-note-artwork" />
      <div><span className="song-note-label">SOBRE ESTA CANCIÓN</span><h2>{track.title}</h2><p>{track.artist}</p></div>
    </div>
    <p className="song-note-announcement" role="status">{track.title} · {track.artist}</p>
    {notes.loading ? <p className="song-note-hint" role="status"><LoaderCircle size={15} className="spinning" />Buscando tu pequeño recuerdo…</p> : <>
      {editing ? <form onSubmit={event => {
        event.preventDefault();
        void notes.save().then(ok => { if (ok) { setSaved(true); finishEditing(); } });
      }}>
        <label className="song-note-label" htmlFor="song-note-text">¿QUÉ SIGNIFICA PARA TI?</label>
        <textarea id="song-note-text" autoFocus maxLength={5000} rows={4} value={notes.draft}
          placeholder="Un recuerdo, una persona, algo que sientes al escucharla…"
          onBlur={() => { void notes.save(); }} onChange={event => { notes.setDraft(event.target.value); setSaved(false); }} />
        <div className="song-note-editor-footer"><span>{notes.draft.length}/5000</span><span>Ctrl + Enter para guardar</span></div>
        <div className="song-note-actions">
          <button type="button" className="subtle-button" disabled={notes.saving} onClick={() => { notes.discard(); finishEditing(); }}>Cancelar</button>
          <button type="submit" className="primary-button" disabled={notes.saving || !notes.loaded}>{notes.saving ? <LoaderCircle size={14} className="spinning" /> : <Heart size={14} />} {notes.saving ? 'Guardando…' : 'Guardar mi nota'}</button>
        </div>
      </form> : <>
        {notes.note ? <p className="song-note-memory">{notes.note}</p> : notes.loaded && <p className="song-note-hint">Esta canción puede guardar un pedacito de ti. Escribe lo que significa para ti ♡</p>}
        <div className="song-note-actions">
          <span className="song-note-saved" role="status">{saved && <><Check size={13} />Nota guardada ♡</>}</span>
          <button ref={editButton} className="subtle-button" disabled={!notes.loaded} onClick={() => { setEditing(true); setSaved(false); }}><PencilLine size={14} />{notes.note ? 'Editar mi nota' : 'Escribir mi nota'}</button>
        </div>
      </>}
      {notes.error && <div className="song-note-error" role="alert">{notes.error}{!notes.loaded && <button className="subtle-button" onClick={notes.retry}>Intentar de nuevo</button>}</div>}
    </>}
  </motion.section>;
}

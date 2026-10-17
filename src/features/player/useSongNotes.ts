import { useCallback, useEffect, useRef, useState } from 'react';

type NoteState = {
  note: string;
  draft: string;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
};
const empty: NoteState = { note: '', draft: '', loaded: false, loading: true, saving: false, error: '' };
const SAVE_DELAY = 300;

export function useSongNotes(trackId?: string) {
  const cache = useRef<Record<string, NoteState>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inFlight = useRef(new Map<string, Promise<boolean>>());
  const [entries, setEntries] = useState<Record<string, NoteState>>({});
  const [retry, setRetry] = useState(0);
  const patch = useCallback((id: string, values: Partial<NoteState>) => {
    const next = { ...cache.current, [id]: { ...(cache.current[id] ?? empty), ...values } };
    cache.current = next;
    setEntries(next);
  }, []);

  const clearTimer = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const flush = useCallback((id: string): Promise<boolean> => {
    clearTimer(id);
    const running = inFlight.current.get(id);
    if (running) return running;
    const initial = cache.current[id];
    if (!initial?.loaded || initial.draft.trim() === initial.note.trim()) return Promise.resolve(true);
    const operation = (async () => {
      while (true) {
        const current = cache.current[id];
        if (!current?.loaded || current.draft.trim() === current.note.trim()) return true;
        if (!window.desktop) return false;
        const draft = current.draft;
        patch(id, { saving: true, error: '' });
        try {
          const note = await window.desktop.saveSongNote(id, draft);
          // Autosave must preserve newer edits and spaces still being typed.
          patch(id, { note });
        } catch {
          patch(id, { error: 'No pude guardar tu nota. Tu texto sigue aquí; vuelve a intentarlo.' });
          return false;
        } finally {
          patch(id, { saving: false });
        }
      }
    })().finally(() => { inFlight.current.delete(id); });
    inFlight.current.set(id, operation);
    return operation;
  }, [clearTimer, patch]);

  const flushAll = useCallback(async () => {
    const results = await Promise.all(Object.keys(cache.current).map(flush));
    return results.every(Boolean);
  }, [flush]);

  useEffect(() => {
    const unsubscribe = window.desktop?.onFlushSongNotes(flushAll);
    return () => { unsubscribe?.(); void flushAll(); };
  }, [flushAll]);

  useEffect(() => {
    if (!trackId) return;
    return () => { void flush(trackId); };
  }, [trackId, flush]);

  useEffect(() => {
    if (!trackId || cache.current[trackId]?.loaded) return;
    let active = true;
    patch(trackId, { loading: true, error: '' });
    const desktop = window.desktop;
    const request = desktop ? desktop.getSongNote(trackId) : Promise.reject(new Error('Desktop unavailable'));
    request.then(note => {
      if (active) patch(trackId, { note, draft: note, loaded: true, loading: false });
    }).catch(() => {
      if (active) patch(trackId, { loading: false, error: 'No pude leer tu nota. Intenta de nuevo.' });
    });
    return () => { active = false; };
  }, [trackId, retry, patch]);

  const entry = (trackId && entries[trackId]) || empty;
  function save(): Promise<boolean> {
    return trackId ? flush(trackId) : Promise.resolve(false);
  }

  return {
    ...entry,
    dirty: entry.draft.trim() !== entry.note.trim(),
    setDraft: (draft: string) => {
      if (!trackId || !cache.current[trackId]?.loaded) return;
      patch(trackId, { draft });
      clearTimer(trackId);
      timers.current.set(trackId, setTimeout(() => { void flush(trackId); }, SAVE_DELAY));
    },
    discard: () => {
      if (!trackId) return;
      clearTimer(trackId);
      patch(trackId, { draft: cache.current[trackId].note, error: '' });
    },
    retry: () => setRetry(value => value + 1),
    save,
  };
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomicJson } from './atomicJson';

export const MAX_NOTE_LENGTH = 5000;
type Notes = Record<string, string>;

export class SongNotes {
  private readonly filename: string;
  private queue: Promise<void> = Promise.resolve();
  private writeError: unknown;

  constructor(userData: string) {
    this.filename = path.join(userData, 'song-notes.json');
  }

  private validateId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) {
      throw new Error('Canción no válida.');
    }
  }

  private async read(): Promise<Notes> {
    let contents: string;
    try { contents = await readFile(this.filename, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null) as Notes;
      throw error;
    }
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('No se pudo leer el archivo de notas.');
    }
    const notes: Notes = Object.create(null) as Notes;
    for (const [id, note] of Object.entries(parsed)) {
      if (!/^[a-f0-9]{64}$/.test(id) || typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) {
        throw new Error('El archivo de notas contiene datos no válidos.');
      }
      notes[id] = note;
    }
    return notes;
  }

  async get(id: unknown): Promise<string> {
    this.validateId(id);
    await this.queue;
    return (await this.read())[id] ?? '';
  }

  async flush(): Promise<void> {
    let pending: Promise<void>;
    do { pending = this.queue; await pending; } while (pending !== this.queue);
    if (this.writeError) throw this.writeError;
  }

  set(id: unknown, note: unknown): Promise<string> {
    this.validateId(id);
    if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) {
      throw new Error('La nota debe tener como máximo 5000 caracteres.');
    }
    const saved = note.trim();
    const operation = this.queue.then(async () => {
      const notes = await this.read();
      if (saved) notes[id] = saved;
      else delete notes[id];
      await writeAtomicJson(this.filename, notes);
      return saved;
    });
    this.queue = operation.then(() => { this.writeError = undefined; }, error => { this.writeError = error; });
    return operation;
  }
}

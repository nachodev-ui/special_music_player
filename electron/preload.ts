import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/contracts';

const noteFlushers = new Set<() => Promise<boolean>>();
ipcRenderer.on('notes:flush', async (_event, requestId: number) => {
  let saved = false;
  try { saved = (await Promise.all([...noteFlushers].map(flush => flush()))).every(Boolean); }
  catch { /* Report failure so the main process keeps the window open. */ }
  await ipcRenderer.invoke('notes:flushed', requestId, saved);
});

const api: DesktopAPI = {
  platform: process.platform,
  getGiftPreferences: () => ipcRenderer.invoke('gift:preferences'),
  chooseFolder: () => ipcRenderer.invoke('library:choose'),
  restoreLibrary: () => ipcRenderer.invoke('library:restore'),
  resolveArtwork: (trackId) => ipcRenderer.invoke('library:artwork', trackId),
  getLyrics: (trackId) => ipcRenderer.invoke('lyrics:get', trackId),
  getSongNote: (trackId) => ipcRenderer.invoke('notes:get', trackId),
  saveSongNote: (trackId, note) => ipcRenderer.invoke('notes:save', trackId, note),
  onFlushSongNotes: (flush) => {
    noteFlushers.add(flush);
    return () => { noteFlushers.delete(flush); };
  },
  getPlaylists: () => ipcRenderer.invoke('playlists:list'),
  createPlaylist: (name) => ipcRenderer.invoke('playlists:create', name),
  renamePlaylist: (id, name) => ipcRenderer.invoke('playlists:rename', id, name),
  deletePlaylist: (id) => ipcRenderer.invoke('playlists:delete', id),
  addPlaylistTrack: (id, path) => ipcRenderer.invoke('playlists:add-track', id, path),
  removePlaylistTrack: (id, path) => ipcRenderer.invoke('playlists:remove-track', id, path),
  choosePlaylistCover: (id) => ipcRenderer.invoke('playlists:choose-cover', id),
  clearPlaylistCover: (id) => ipcRenderer.invoke('playlists:clear-cover', id),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
};
contextBridge.exposeInMainWorld('desktop', api);

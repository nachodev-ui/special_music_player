// Future secrets subscribe here without coupling themselves to the player or UI.
type RoomEvent = { type: 'track-played'; trackId: string } | { type: 'mascot-tapped' };
const listeners = new Set<(event: RoomEvent) => void>();
export const roomEvents = {
  emit(event: RoomEvent) { listeners.forEach((listener) => listener(event)); },
  subscribe(listener: (event: RoomEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

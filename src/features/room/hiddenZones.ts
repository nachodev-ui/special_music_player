import type { Track } from '../../../shared/contracts';
import type { RoomBox } from './room.config';
import type { DayPhase } from './useRoomEnvironment';

export interface RoomContext { current: Track | null; playing: boolean; phase: DayPhase; lampOn: boolean }
export interface HiddenZone {
  id: string;
  label: string;
  box: RoomBox;
  condition: (context: RoomContext) => boolean;
  action: (context: RoomContext) => void;
}
// Intentionally empty: registering a zone adds an invisible, keyboard-accessible target.
// Keep these zones away from essential controls. No secrets are implemented yet.
export const hiddenZones: HiddenZone[] = [];

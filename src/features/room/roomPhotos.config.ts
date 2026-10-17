// Change these filenames to rearrange the local photos. Use null for the original illustration.
// Cork cards are ordered from left to right, top to bottom in the collage canvas.
export const roomPhotoAssignments = {
  sundayPortrait: 'sakura_day.jpg',
  sundayLandscape: 'zoo_atardecer.jpg',
  corkCards: [
    'zoo_entrada.jpg',
    'ascensor.png',
    'metro.jpg',
    'roblox_day.jpg',
    'ositos.png',
    'bicentenario.jpg',
  ],
} as const;

export type RoomPhotoSlot = 'sundayPortrait' | 'sundayLandscape';

export function roomPhotoAsset(filename: string) {
  return import.meta.env.BASE_URL + 'photos/room/' + encodeURIComponent(filename);
}

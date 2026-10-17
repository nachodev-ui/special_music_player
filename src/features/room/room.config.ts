// Coordinates use the scene viewBox. Replace an SVG component or adjust these boxes independently.
export interface RoomBox { x: number; y: number; width: number; height: number }
export const roomLayout = {
  scene: { width: 1000, height: 640 },
  window: { x: 62, y: 60, width: 260, height: 265 },
  shelf: { x: 655, y: 73, width: 285, height: 258 },
  turntable: { x: 310, y: 327, width: 340, height: 220 },
  lamp: { x: 763, y: 333, width: 143, height: 239 },
  plant: { x: 95, y: 332, width: 155, height: 216 },
  usagi: { x: 650, y: 416, width: 153, height: 194 },
} satisfies { scene: { width: number; height: number } } & Record<string, RoomBox | { width: number; height: number }>;
export const albumsPerPage = 6;

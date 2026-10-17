// All transforms are in metres. GLBs are centred on X/Z, grounded at Y=0,
// and fitted uniformly inside size before applying this object's transform.
export type Vec3 = [number, number, number];
// Altura de la lámpara anterior: caja Y=[.01, 2.718], escala 1.
export const LAMP_HEIGHT = 2.708;
export const LAMP_UPRIGHT_ROTATION = Math.PI / 2;
export const LAMP_LIGHT_HEIGHT_FRACTION = 0.8;
export const LAMP_UNIFORM_SCALE = LAMP_HEIGHT / 1.182;

export interface RoomObjectConfig {
  model: string; position: Vec3; rotation: Vec3; scale: Vec3; size: Vec3;
  preserveTextures?: boolean;
  color: 'wood' | 'wall' | 'accent' | 'soft' | 'leaf' | 'surface';
}
export interface RoomPosterConfig {
  image: string; pixels: [number, number]; position: Vec3; rotation: Vec3; scale: Vec3;
}
export interface RoomPlushConfig {
  model: 'plushies/melody_plush' | 'plushies/mikako_plush';
  position: Vec3; rotation: Vec3; scale: Vec3; label: string;
}
const object = (model: string, position: Vec3, size: Vec3, color: RoomObjectConfig['color'], rotation: Vec3 = [0, 0, 0]): RoomObjectConfig =>
  ({ model, position, size, color, rotation, scale: [1, 1, 1] });
// Medidas del GLB con la matriz de sus nodos aplicada; sin visor.
const melodyCouchBounds: Vec3 = [.9068419933, .7937701955, .5930820148];
const melodyCouchSize: Vec3 = [2.05, 1.1, 1.1];
const melodyCouchFit = Math.min(...melodyCouchSize.map((size, i) => size / melodyCouchBounds[i]));
const melodyCouchUniformScale = melodyCouchSize[0] / melodyCouchBounds[0];
export const melodyCouch = {
  // Factor único por ancho; compensa el fit interno de RoomModel sin deformar los ejes.
  // RoomModel resta bounds.min.y antes de escalar: la base sigue apoyada en Y=0.
  modelScale: melodyCouchUniformScale / melodyCouchFit,
  // Centro del bounding box de la superficie superior del cojín (normales hacia arriba).
  seatHeight: (.2668170414 - .0000409568) * melodyCouchUniformScale,
  seatDepth: (.1050205465 - .0887770699) * melodyCouchUniformScale,
  plushSide: .42, // Distancia lateral al centro del cojín; ajustar a ojo si hace falta.
  sitYaw: Math.PI / 2, // Frente del asiento: +Z local, +X en el cuarto.
};
// Escritorio: bounding box del GLB con las matrices de sus nodos aplicadas, sin visor.
const deskBounds: Vec3 = [0.9681349694728851, 0.5193221662562933, 0.49816613159111106];
const deskUniformScale = 1.9;
// Centrado en el hueco libre: se desplaza .448 m a la izquierda del espejo para ganar tamaño.
// Espalda contra la moldura y base sobre el suelo; los demás muebles no se mueven.
const deskPosition: Vec3 = [-.9282208455, .008, -2.885 + deskBounds[2] * deskUniformScale / 2];
const deskRotation: Vec3 = [0, 0, 0]; // Frente/tiradores: +Z, hacia el interior.
const deskScale: Vec3 = [deskUniformScale, deskUniformScale, deskUniformScale];
// Hueco X=[-1.929642, .0732], incluido el lazo del estante: margen .081693 m a cada lado.
// Cubierta <= .994713 m; cara inferior del repisón del espejo = 1.7425 m.
// PC: bounding box del GLB con sus matrices aplicadas; se conserva el conjunto completo.
const pcBounds: Vec3 = [0.9293749928474426, 0.5247191556779421, 0.603567140897851];
const pcUniformScale = 1.4;
// Cubierta útil: 1.799264 × .915969 m; ocupa el 72.32 % del ancho.
// Base en la superficie superior; techo Y=1.729319 < repisón Y=1.7425.
const pcPosition: Vec3 = [-.9152742681298331, .9947121129770032, -2.43536649318516];
const pcRotation: Vec3 = [0, 0, 0]; // Monitores detrás (-Z), periféricos delante (+Z).
const pcScale: Vec3 = [pcUniformScale, pcUniformScale, pcUniformScale];
// Margen posterior: .02 m a la cubierta, .027137 m a la moldura y .112137 m a la pared.
export const room3d = {
  camera: { position: [9, 8, 11] as Vec3, target: [0, 1.65, 0] as Vec3, span: 12.8, parallax: .18 },
  objects: {
    floor: object('floor', [0, -.18, 0], [8, .18, 6], 'wood'),
    backWall: object('back-wall', [0, 0, -3], [8, 3.8, .16], 'wall'),
    sideWall: object('side-wall', [-4, 0, 0], [.16, 3.8, 6], 'wall'),
    window: object('window', [-2.25, 1.65, -2.82], [2.1, 1.6, .14], 'surface'),
    turntable: {
      ...object('models/turntable', [.05, 0, 1.05], [.952, 2.028, .981], 'wood', [0, 0, 0]),
      scale: [.9, .9, .9] as Vec3, preserveTextures: true,
    },
    desk: {
      ...object('models/desk_tres_cuartos', deskPosition, deskBounds, 'wood', deskRotation),
      scale: deskScale, preserveTextures: true,
    },
    pc: {
      ...object('models/pc', pcPosition, pcBounds, 'surface', pcRotation),
      scale: pcScale, preserveTextures: true,
    },
    shelf: object('shelf', [1.5, 0, -2.35], [2.6, 2.85, .65], 'wood'),
    shelfMangas: {
      // Grounded on the top shelf, midway between the plushies; fit uniformly.
      ...object('models/gokinjo_mangas', [1.47, 2.63, -2.35], [.4, .46, .23], 'surface', [0, Math.PI / -10.9, 0]),
      preserveTextures: true,
    },
    lamp: {
      ...object('models/lamp', [3.45, 0, -2.4], [.299644, 1.182281, .297233], 'accent'),
      scale: [LAMP_UNIFORM_SCALE, LAMP_UNIFORM_SCALE, LAMP_UNIFORM_SCALE] as Vec3,
      preserveTextures: true,
    },
    plant: {
      // Face the bunny (-Z) into the room (+X); clear the wardrobe and rug.
      ...object('models/plant', [-3, 0, 0.8], [.694, 1, .572], 'leaf', [0, -Math.PI / 2, 0]),
      scale: [1.65, 1.65, 1.65] as Vec3, preserveTextures: true,
    },
    ropero: {
      // Front-left corner: clear of the plant, rug and wall trim. RoomModel grounds the centred pivot.
      ...object('models/ropero', [-3.55, 0, 2.3], [.39, 1, .95], 'wood', [0, 0, 0]),
      scale: [2, 2, 2] as Vec3, preserveTextures: true,
    },
    sofa: {
      ...object('models/melody_couch', [-2.8, 0, -1.1], melodyCouchSize, 'soft', [0, Math.PI / 2, 0]),
      preserveTextures: true,
    },
  } satisfies Record<string, RoomObjectConfig>,
  posters: [
    {
      image: '/assets/room3d/posters/mikako_makako.jpg', pixels: [670, 1200],
      position: [-3.9, 2.54, -2.4] as Vec3, rotation: [0, Math.PI / 2, 0] as Vec3,
      scale: [.001, .001, 1] as Vec3,
    },
    {
      image: '/assets/room3d/posters/mikako_with_a_cat.jpg', pixels: [736, 1045],
      position: [-3.9, 2.54, -1.57] as Vec3, rotation: [0, Math.PI / 2, 0] as Vec3,
      scale: [.001, .001, 1] as Vec3,
    },
  ] satisfies RoomPosterConfig[],
  plushies: {
    // Posiciones globales; el peluche del sofá se apoya en el cojín medido del modelo nuevo.
    wall: { model: 'plushies/mikako_plush', position: [-3.65, 1.26, 0.001], rotation: [0, Math.PI / 2, 0], scale: [.49, .49, .49], label: 'Peluche de Mikako en la pared' },
    sofa: { model: 'plushies/melody_plush', position: [-2.8 + melodyCouch.seatDepth, melodyCouch.seatHeight, -1.1 - melodyCouch.plushSide], rotation: [0, Math.PI / 2, 0], scale: [.57, .57, .57], label: 'Peluche de My Melody en el sofá' },
    shelfLeft: { model: 'plushies/mikako_plush', position: [.68, 2.63, -2.35], rotation: [0, 1, 0], scale: [.58, .58, .58], label: 'Peluche de Mikako junto al espejo' },
    shelfRight: { model: 'plushies/melody_plush', position: [2.26, 2.63, -2.35], rotation: [0, 0, 0], scale: [.52, .52, .52], label: 'Peluche de My Melody arriba del estante' },
  } satisfies Record<string, RoomPlushConfig>,
  plushSound: { file: 'assets/room3d/plushies/plush_sound.mp3', volume: .3 },
  // The rigged source is 1.8 m tall; retain the previous 2.6 m room height.
  mikako: {
    outfits: [
      {
        id: 'rosa', label: 'Rosa', preview: 'assets/room3d/outfits/rosa.png', model: 'models/mikako/character', hip: 'pelvis', yawOffset: 0,
        clips: { idle: 'models/mikako/idle.clip.json', wave: 'models/mikako/wave.clip.json',
          'sit-stand': 'models/mikako/sit-stand.clip.json', walk: 'models/mikako/walk.clip.json' },
      },
      {
        id: 'cuadros', label: 'Cuadros', preview: 'assets/room3d/outfits/cuadros.png', model: 'models/mikako/gingham/character', hip: 'Hips',
        // Measure the rest-pose foot → toes direction when this outfit loads.
        yawOffset: 'auto',
        footFix: {
          pairs: [{ foot: 'LeftFoot', toe: 'LeftToeBase' }, { foot: 'RightFoot', toe: 'RightToeBase' }],
          stanceMax: 1.2, stanceFade: 1.8, strength: 1,
        },
        clips: { dance: 'models/mikako/gingham/sway.clip.json', stretch: 'models/mikako/gingham/stretch.clip.json',
          'sit-stand': 'models/mikako/gingham/sit-stand.clip.json', wave: 'models/mikako/gingham/wave.clip.json',
          walk: 'models/mikako/gingham/walk.clip.json', 'walk-model': 'models/mikako/gingham/walk-model.clip.json' },
        sitTiming: { start: .83, seated: 2.83, riseSearch: [4.33, 5.17] },
        walkEnabled: true,
      },
    ] as MikakoOutfit[],
    position: [-1.85, 0, -1.1] as Vec3,
    scale: [2.6 / 1.8, 2.6 / 1.8, 2.6 / 1.8] as Vec3, rotation: [0, 0.4, 0] as Vec3,
    walkSpeed: 1.15, // Metres per second while walking.
    // Procedural seated corrections in degrees, around each bone's local X.
    spinePitch: -20,
    neckPitch: -40,
    headPitch: -10,
    legSpread: 12, // Degrees: bring the seated thighs together (0 = off, higher = closer).
    // Seat offsets: depth/height in metres, facing angle in radians.
    sitBack: .55 + .03 - melodyCouch.seatDepth, // Conserva el apoyo del clip respecto al centro del cojín.
    sitLift: .02 + melodyCouch.seatHeight - .7, // Diferencia respecto al cojín anterior, a .7 m.
    sitYaw: melodyCouch.sitYaw, // Orientación frontal del asiento nuevo.
    outline: { thicknessPerUnit: .25, angle: Math.PI / 3 },

  },
  wardrobe: {
    // Approach the doors from the room, clear of the plant and wardrobe footprint.
    position: [-2.65, 0, 2.3] as Vec3,
    facing: [-3.55, 2.3] as [number, number],
  },
  // Native interactive parts are independent of the imported furniture shell.
  // Local coordinates after fitting the GLB; the furniture transform also moves these parts.
  record: { position: [-.061, 1.252, .061] as Vec3, radius: .326 },
  previous: { position: [.19, 1.28, .43] as Vec3, scale: .45 },
  next: { position: [.36, 1.28, .43] as Vec3, scale: .45 },
  albums: { columns: 3, start: [-.82, 2.14, .4] as Vec3, spacing: [.82, .99] as [number, number], size: .64 },
  pagePrevious: { position: [-.95, .38, .4] as Vec3 },
  pageNext: { position: [.95, .38, .4] as Vec3 },
  lampLight: { position: [3.45, LAMP_HEIGHT * LAMP_LIGHT_HEIGHT_FRACTION, -2.4] as Vec3 },
  sun: { position: [-3, 8, 5] as Vec3 },
  pixelRatio: [1, 1.5] as [number, number],
};
export function roomAsset(name: string) {
  // BASE_URL keeps /assets/room3d working in Vite and packaged Electron file://.
  return import.meta.env.BASE_URL + 'assets/room3d/' + name + '.glb';
}

export const roomPalette = {
  bg: '#fffaf0', surface: '#fffefb', wall: '#f3eadb', wood: '#d6b6a6',
  accent: '#e6b95c', soft: '#f2dce1', leaf: '#a8bb83', ink: '#826a61', highlight: '#9f7027',
  rose: '#cc91a2', brass: '#bca078',
};
export type RoomPalette = typeof roomPalette;

export type MikakoOutfit = {
  id: string;
  label: string;
  preview: string;
  model: string;
  hip: string;
  clips: Partial<Record<'idle' | 'wave' | 'sit-stand' | 'walk' | 'walk-model' | 'dance' | 'stretch', string>>;
  sitTiming?: {
    start: number;
    seated: number;
    riseSearch: [number, number];
    riseEnd?: number; // Omit to finish at the loaded clip's duration.
  };
  footFix?: {
    pairs: { foot: string; toe: string }[];
    stanceMax: number;
    stanceFade: number;
    strength: number;
  };
  walkEnabled?: boolean;
  position?: [number, number, number];
  scale?: [number, number, number];
  sitBack?: number;
  sitLift?: number;
  yawOffset?: number | 'auto';
};

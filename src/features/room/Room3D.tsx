import { Component, Suspense, createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Box3, Vector2, Vector3, Raycaster, BufferGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, RingGeometry, MeshBasicMaterial, Float32BufferAttribute, Group, LinearMipmapLinearFilter, MathUtils, Mesh, MeshStandardMaterial, NoToneMapping, OrthographicCamera, PointLight, SRGBColorSpace, Shape as ShapePath, type Texture } from 'three';
import { RoundedBox, useGLTF, useTexture } from '@react-three/drei';
import type { Track } from '../../../shared/contracts';
import type { usePlayer } from '../player/usePlayer';
import type { DayPhase, RoomWeather } from './useRoomEnvironment';
import { Box, Highlight, Outline, Palette, RoomModel, Shape, Toon, ToonRamp, makeToonRamp } from './RoomModel';
import { melodyCouch, room3d, roomAsset, type RoomObjectConfig, type RoomPalette, type RoomPosterConfig, type Vec3 } from './room3d.config';
import { roomPhotoAssignments, roomPhotoAsset, type RoomPhotoSlot } from './roomPhotos.config';
import { useCoverTexture } from './roomTextures';
import { Mikako, type WalkDestination } from './Mikako';
import { RoomPlushies } from './RoomPlushies';
import { measureCouch, type CouchBounds, type CouchRequest } from './mikakoRecline';
import type { TurntableApproach } from './mikakoTurntable';
import { deskChairConfig } from './mikakoDeskChair';

type Player = Pick<ReturnType<typeof usePlayer>, 'current' | 'playing' | 'toggle' | 'unlock' | 'previous' | 'next' | 'select'>;
interface SceneProps {
  player: Player; albums: Track[]; hasTracks: boolean; phase: DayPhase; weather: RoomWeather | null;
  lampOn: boolean; reduced: boolean; page: number; pageCount: number; mikakoTaps: number; outfit: string;
  setPage: (page: number) => void; toggleLamp: () => void; tapPlant: () => void; tapMikako: () => void;
  onHover: (label: string) => void; openWardrobe: () => void;
}
function Action({ label, action, disabled = false, children }: { label: string; action?: () => void; disabled?: boolean; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const onHover = useContext(HoverLabel);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [hover, disabled, invalidate]);
  useEffect(() => { if (hover) onHover(disabled ? '' : label); }, [hover, label, disabled, onHover]);
  const click = (event: ThreeEvent<MouseEvent>) => {
    // DEBUG-TEMP
    console.info('[DBG-ROOM] acción click', { label, disabled });
    event.stopPropagation(); if (!disabled) action?.();
  };
  return <Highlight.Provider value={hover && !disabled}><group
    onClick={action ? click : undefined}
    onPointerOver={event => {
      // DEBUG-TEMP
      console.info('[DBG-ROOM] acción hover', { label, disabled });
      event.stopPropagation(); if (!disabled) { setHover(true); onHover(label); }
    }}
    onPointerOut={event => { event.stopPropagation(); setHover(false); onHover(''); }}
  >{children}</group></Highlight.Provider>;
}
const HoverLabel = createContext<(label: string) => void>(() => {});
function Furniture({ config, children }: { config: RoomObjectConfig; children: ReactNode }) {
  return <group position={config.position} rotation={config.rotation} scale={config.scale}>{children}</group>;
}
function Wardrobe({ action }: { action: () => void }) {
  const model = useRef<Group>(null);
  const measuredModel = useRef<string | null>(null);
  const [hitBox, setHitBox] = useState<{ size: Vector3; center: Vector3 } | null>(null);
  const invalidate = useThree(state => state.invalidate);
  useFrame(() => {
    // RoomModel loads in an effect, rather than suspending. Measure only after
    // its fitted group is attached; the loading commit requests a demand frame.
    const content = model.current?.children[0];
    if (!model.current || !content || measuredModel.current === content.uuid) return;
    model.current.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(model.current, true)
      .applyMatrix4(model.current.matrixWorld.clone().invert());
    if (box.isEmpty()) return;
    // As with Mikako, only the bounding-box collider receives pointer events.
    model.current.traverse(node => { if (node instanceof Mesh) node.raycast = () => {}; });
    measuredModel.current = content.uuid;
    setHitBox({ size: box.getSize(new Vector3()), center: box.getCenter(new Vector3()) });
    invalidate();
  });
  return <Furniture config={room3d.objects.ropero}>
    <Action label="Cambiar outfit · ropero" action={action}>
      <group ref={model}><RoomModel config={room3d.objects.ropero} /></group>
      {hitBox && <mesh position={hitBox.center}>
        <boxGeometry args={[hitBox.size.x, hitBox.size.y, hitBox.size.z]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>}
    </Action>
  </Furniture>;
}
const COUCH_CLICK_ZONES = { leftArmrestFraction: .20, rightArmrestFraction: .20 } as const;
function Couch({ occupied, active, onBounds, request }: {
  occupied: boolean; active: boolean; onBounds: (bounds: CouchBounds) => void;
  request: (pose: Exclude<CouchRequest['pose'], 'stand'>) => void;
}) {
  const model = useRef<Group>(null);
  const measured = useRef<string | null>(null);
  const armrests = useRef<Box3[]>([]);
  const [hitBox, setHitBox] = useState<Box3 | null>(null);
  const plush = useGLTF(roomAsset(room3d.plushies.sofa.model));
  const invalidate = useThree(state => state.invalidate);
  useFrame(() => {
    const content = model.current?.children[0]?.children[0];
    if (!model.current || !content || measured.current === content.uuid) return;
    model.current.updateWorldMatrix(true, true);
    const inverse = model.current.matrixWorld.clone().invert();
    const box = new Box3().setFromObject(model.current, true).applyMatrix4(inverse);
    if (box.isEmpty()) return;
    const namedArmrests: Box3[] = [];
    model.current.traverse(node => {
      if (/arm[ _-]?rest|reposabrazos|(?:sofa|couch)[ _-]?arm/i.test(node.name)) {
        const bounds = new Box3().setFromObject(node, true).applyMatrix4(inverse);
        if (!bounds.isEmpty()) namedArmrests.push(bounds);
      }
      if (node instanceof Mesh) node.raycast = () => {};
    });
    armrests.current = namedArmrests;
    measured.current = content.uuid;
    setHitBox(box);
    onBounds(measureCouch(box, new Box3().setFromObject(plush.scene, true)));
    invalidate();
  });
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!active || occupied || !model.current || !hitBox || event.button !== 0 || event.delta > 5) return;
    model.current.updateWorldMatrix(true, false);
    const point = model.current.worldToLocal(event.point.clone());
    const width = hitBox.max.x - hitBox.min.x;
    if (width <= 0) return;
    const along = MathUtils.clamp((point.x - hitBox.min.x) / width, 0, 1);
    const armrest = armrests.current.length > 0
      ? armrests.current.some(bounds => point.x >= bounds.min.x && point.x <= bounds.max.x)
      : along <= COUCH_CLICK_ZONES.leftArmrestFraction || along >= 1 - COUCH_CLICK_ZONES.rightArmrestFraction;
    request(armrest ? 'recline' : 'sit');
    invalidate();
  };
  const center = hitBox?.getCenter(new Vector3());
  const size = hitBox?.getSize(new Vector3());
  return <Furniture config={room3d.objects.sofa}>
    <Action label="Centro: sentarse · reposabrazos: recostarse" disabled={!active || occupied}>
      <group ref={model}><group scale={melodyCouch.modelScale}><RoomModel config={room3d.objects.sofa} /></group></group>
      {center && size && <mesh position={center} onClick={click}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>}
    </Action>
  </Furniture>;
}
function CameraRig({ reduced, mouse }: { reduced: boolean; mouse: RefObject<[number, number]> }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const orthographic = camera as OrthographicCamera;
    orthographic.zoom = Math.min(size.width / room3d.camera.span, size.height / (room3d.camera.span * .66));
    orthographic.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);
  useFrame((_, delta) => {
    const base = room3d.camera.position;
    const x = base[0] + (reduced ? 0 : mouse.current[0] * room3d.camera.parallax);
    const y = base[1] + (reduced ? 0 : mouse.current[1] * room3d.camera.parallax * .5);
    camera.position.x = reduced ? x : MathUtils.damp(camera.position.x, x, 6, Math.min(delta, .05));
    camera.position.y = reduced ? y : MathUtils.damp(camera.position.y, y, 6, Math.min(delta, .05));
    camera.position.z = base[2];
    camera.lookAt(...room3d.camera.target);
    if (Math.abs(camera.position.x - x) + Math.abs(camera.position.y - y) > .001) invalidate();
  });
  return null;
}
function makeVinylResources() {
  const vertices: number[] = [];
  for (let ring = 0; ring < 18; ring++) {
    const inner = .405 + ring * .031;
    const outer = inner + .003;
    for (let segment = 0; segment < 96; segment++) {
      const a = segment / 96 * Math.PI * 2;
      const b = (segment + 1) / 96 * Math.PI * 2;
      const points = [
        [inner * Math.cos(a), inner * Math.sin(a)], [outer * Math.cos(a), outer * Math.sin(a)],
        [outer * Math.cos(b), outer * Math.sin(b)], [inner * Math.cos(b), inner * Math.sin(b)],
      ];
      for (const index of [0, 1, 2, 0, 2, 3]) vertices.push(...points[index], .029);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  return {
    grooves: geometry,
    body: new CylinderGeometry(1, 1, .054, 96),
    rim: new RingGeometry(.355, .382, 96),
    label: new CircleGeometry(.35, 64),
    hole: new CircleGeometry(.027, 24),
    highlight: new RingGeometry(1.01, 1.065, 96),
    bodyMaterial: new MeshStandardMaterial({ color: '#171518', roughness: .3, metalness: .18 }),
    grooveMaterial: new MeshBasicMaterial({ color: '#514c52', transparent: true, opacity: .36 }),
    rimMaterial: new MeshStandardMaterial({ color: '#252126', roughness: .48 }),
    holeMaterial: new MeshBasicMaterial({ color: '#090809' }),
  };

}
const VinylResources = createContext<ReturnType<typeof makeVinylResources> | null>(null);

// Shared construction: front-facing on the rack, face-up on the turntable.
function Vinyl({ cover, radius, selected = false }: { cover: Texture; radius: number; selected?: boolean }) {
  const palette = useContext(Palette);
  const hover = useContext(Highlight);
  const resources = useContext(VinylResources)!;
  return <group scale={radius}>
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow geometry={resources.body} material={resources.bodyMaterial} />
    <mesh geometry={resources.grooves} material={resources.grooveMaterial} />
    <mesh position={[0, 0, .03]} geometry={resources.rim} material={resources.rimMaterial} />
    <mesh position={[0, 0, .033]} geometry={resources.label}>
      <meshBasicMaterial map={cover} toneMapped={false} />
    </mesh>
    <mesh position={[0, 0, .036]} geometry={resources.hole} material={resources.holeMaterial} />
    {(selected || hover) && <mesh position={[0, 0, -.035]} geometry={resources.highlight}>
      <meshBasicMaterial color={hover ? palette.highlight : palette.rose} />
    </mesh>}
  </group>;
}
function Album({ track, position, selected, select }: { track: Track; position: Vec3; selected: boolean; select: () => void }) {
  const palette = useContext(Palette);
  const cover = useCoverTexture(track.artwork, track.title, track.artist);
  return <Action label={'Reproducir ' + track.title + ' · ' + track.artist} action={select}>
    <group position={position}>
      <Vinyl cover={cover} radius={.36} selected={selected} />
      {selected && <Shape position={[0, .43, .06]} color={palette.accent}><sphereGeometry args={[.06, 8, 6]} /></Shape>}
    </group>
  </Action>;
}
function TransportPart({ position, scale = 1, next, action, disabled, label }: { position: Vec3; scale?: number; next?: boolean; action: () => void; disabled: boolean; label?: string }) {
  const palette = useContext(Palette);
  return <Action label={label ?? (next ? 'Canción siguiente' : 'Canción anterior')} action={action} disabled={disabled}>
    <group position={position} scale={scale}>
      <SoftBox size={[.32, .07, .32]} radius={.03} color={disabled ? palette.wood : palette.rose} />
      <Shape position={[next ? -.025 : .025, .045, 0]} rotation={[0, 0, next ? -Math.PI / 2 : Math.PI / 2]} color={palette.ink}>
        <cylinderGeometry args={[0, .085, .12, 3]} />
      </Shape>
      <Box position={[next ? .1 : -.1, .045, 0]} size={[.025, .02, .17]} color={palette.ink} />
    </group>
  </Action>;
}
function Record({ player, reduced }: Pick<SceneProps, 'player' | 'reduced'>) {
  const record = useRef<Group>(null);
  const palette = useContext(Palette);
  const cover = useCoverTexture(player.current?.artwork, player.current?.title, player.current?.artist);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [player.playing, reduced, invalidate]);
  useFrame((_, delta) => {
    if (player.playing && !reduced && record.current) {
      record.current.rotation.y = (record.current.rotation.y + Math.min(delta, .05) * 1.88) % (Math.PI * 2);
      invalidate();
    }
  });
  return <group>
    <group position={room3d.record.position}>
      <group ref={record}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <Vinyl cover={cover} radius={room3d.record.radius} />
        </group>
      </group>
      <Shape position={[0, .047, 0]} color={palette.accent}><cylinderGeometry args={[.025, .025, .055, 8]} /></Shape>
    </group>
  </group>;
}
function WindowSky({ phase, weather }: Pick<SceneProps, 'phase' | 'weather'>) {
  const palette = useContext(Palette);
  const night = phase === 'night';
  const color = { dawn: '#efb5bb', day: '#c9e4e8', sunset: '#edb294', night: '#656888' }[phase];
  const label = weather?.code ?? 0;
  const snow = label >= 71 && label <= 77 || label === 85 || label === 86;
  const rain = label >= 51 && !snow;
  const cloudy = !!weather && (weather.cloudCover > 35 || label > 0);
  return <group>
    <mesh position={[0, .8, .09]}><planeGeometry args={[1.95, 1.48]} /><meshBasicMaterial color={color} /></mesh>
    <mesh position={[-.58, 1.19, .11]}><circleGeometry args={[night ? .13 : .19, 20]} /><meshBasicMaterial color={night ? '#fff4d4' : '#ffe1a1'} /></mesh>
    {night && [[.2, 1.3], [.68, 1.06], [-.25, .75]].map(([x, y], i) => <mesh key={i} position={[x, y, .12]}><circleGeometry args={[.018, 6]} /><meshBasicMaterial color="#fff4d4" /></mesh>)}
    {cloudy && [-.43, .38].map((x, i) => <group key={x} position={[x, 1.03 - i * .3, .14]}>
      <Shape scale={[1.7, .65, .24]} color={night ? '#85839b' : palette.surface}><sphereGeometry args={[.22, 12, 8]} /></Shape>
    </group>)}
    {(rain || snow) && Array.from({ length: 12 }, (_, i) => <mesh key={i} position={[-.8 + (i % 4) * .5, .33 + Math.floor(i / 4) * .33, .2]} rotation={[0, 0, -.22]}>
      <boxGeometry args={snow ? [.025, .025, .01] : [.012, .12, .01]} /><meshBasicMaterial color={snow ? '#fffefb' : '#7891ae'} />
    </mesh>)}
  </group>;
}

// The furniture is authored here so its upholstery, trim and hardware keep their own colors.
function SoftBox({ size, radius = .06, color, position, rotation }: {
  size: Vec3; radius?: number; color: string; position?: Vec3; rotation?: Vec3;
}) {
  return <RoundedBox args={size} radius={Math.min(radius, ...size.map(value => value / 2))} smoothness={2}
    position={position} rotation={rotation} castShadow receiveShadow><Toon color={color} /><Outline /></RoundedBox>;
}
function Poster({ config }: { config: RoomPosterConfig }) {
  const palette = useContext(Palette);
  const ramp = useContext(ToonRamp);
  const { gl, invalidate } = useThree();
  const texture = useTexture(import.meta.env.BASE_URL + config.image.slice(1));
  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    invalidate();
  }, [texture, gl, invalidate]);
  const width = config.pixels[0] * config.scale[0];
  const height = config.pixels[1] * config.scale[1];
  return <Action label={config.image.includes('with_a_cat') ? 'Póster de Mikako con un gato' : 'Póster de Mikako y Makako'}>
    <group position={config.position} rotation={config.rotation}>
      <SoftBox size={[width + .05, height + .05, .04]} radius={.012} color={palette.wood} />
      <mesh position={[0, 0, .023]} castShadow receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshToonMaterial map={texture} color={palette.surface} gradientMap={ramp} />
        <Outline />
      </mesh>
    </group>
  </Action>;
}
function Bead({ position, scale = [1, 1, 1], color }: { position: Vec3; scale?: Vec3; color: string }) {
  return <mesh position={position} scale={scale} castShadow><sphereGeometry args={[1, 12, 8]} /><Toon color={color} /></mesh>;
}
function Rod({ position, length, color, radius = .025, rotation = [0, 0, 0] }: {
  position: Vec3; length: number; color: string; radius?: number; rotation?: Vec3;
}) {
  return <mesh position={position} rotation={rotation} castShadow><cylinderGeometry args={[radius, radius, length, 10]} /><Toon color={color} /></mesh>;
}
const heartExtrusionOptions = { depth: .12, bevelEnabled: true, bevelSize: .05, bevelThickness: .04, bevelSegments: 2, steps: 1, curveSegments: 16 };
function Heart({ position, size = .15, color, lit = false }: { position: Vec3; size?: number; color: string; lit?: boolean }) {
  const path = useMemo(() => {
    const shape = new ShapePath();
    shape.moveTo(0, -.46);
    shape.bezierCurveTo(-.95, .1, -.48, .82, 0, .36);
    shape.bezierCurveTo(.48, .82, .95, .1, 0, -.46);
    return shape;
  }, []);
  return <mesh position={position} scale={size} castShadow>
    <extrudeGeometry args={[path, heartExtrusionOptions]} />
    <Toon color={color} lit={lit} />
  </mesh>;
}
function Bow({ position, size = .16 }: { position: Vec3; size?: number }) {
  const palette = useContext(Palette);
  return <group position={position} scale={size}>
    {[-1, 1].map(side => <group key={side}>
      <Bead position={[side * .52, 0, 0]} scale={[.6, .33, .16]} color={palette.rose} />
      <SoftBox size={[.23, .72, .08]} position={[side * .25, -.4, -.03]} rotation={[0, 0, side * .25]} color={palette.rose} radius={.025} />
    </group>)}
    <Bead position={[0, 0, .08]} scale={[.22, .22, .2]} color={palette.accent} />
  </group>;
}
function RoomPrint({ kind, position, size, rotation = [0, 0, 0], photoSlot }: {
  kind: 'collage' | 'cover' | 'rug' | 'books'; position: Vec3; size: [number, number]; rotation?: Vec3; photoSlot?: RoomPhotoSlot;
}) {
  const palette = useContext(Palette);
  const ramp = useContext(ToonRamp);
  const invalidate = useThree(state => state.invalidate);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = kind === 'books' ? 256 : 768;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width: w, height: h } = canvas;
    const heart = (x: number, y: number, r: number, color: string) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y + r * .75);
      ctx.bezierCurveTo(x - r * 1.5, y - r * .25, x - r * .5, y - r * 1.3, x, y - r * .45);
      ctx.bezierCurveTo(x + r * .5, y - r * 1.3, x + r * 1.5, y - r * .25, x, y + r * .75); ctx.fill();
    };
    const paper = (x: number, y: number, pw: number, ph: number, color: string) => {
      ctx.fillStyle = color; ctx.fillRect(x, y, pw, ph);
      ctx.strokeStyle = palette.ink; ctx.lineWidth = 2; ctx.strokeRect(x + 8, y + 8, pw - 16, ph - 16);
    };
    if (kind === 'rug') {
      ctx.fillStyle = palette.rose; ctx.beginPath(); ctx.roundRect(15, 15, w - 30, h - 30, 150); ctx.fill();
      ctx.fillStyle = palette.surface; ctx.beginPath(); ctx.roundRect(38, 38, w - 76, h - 76, 135); ctx.fill();
      ctx.strokeStyle = palette.rose; ctx.lineWidth = 4; ctx.setLineDash([5, 12]); ctx.stroke(); ctx.setLineDash([]);
      for (let y = 95; y < h - 60; y += 63) for (let x = 100; x < w - 60; x += 66) {
        ctx.fillStyle = palette.soft; ctx.beginPath(); ctx.arc(x + (Math.round(y / 63) % 2) * 14, y, 7, 0, Math.PI * 2); ctx.fill();
      }
      heart(135, 136, 32, palette.rose); heart(w - 135, h - 136, 32, palette.rose);
    } else if (kind === 'books') {
      ctx.fillStyle = palette.wood; ctx.fillRect(0, 0, w, h);
      const colors = [palette.surface, palette.soft, palette.rose, '#adb5a0', '#d6b48e'];
      for (let i = 0; i < 34; i++) {
        const x = i * 30;
        paper(x, 8 + i % 3 * 5, 27, h - 16 - i % 3 * 5, colors[i % colors.length]);
        ctx.fillStyle = palette.ink; ctx.fillRect(x + 10, 39, 6, 76);
        ctx.font = '18px serif'; ctx.fillText(String(i + 1).padStart(2, '0'), x + 4, h - 29);
        heart(x + 14, 155, 7, palette.rose);
      }
    } else {
      ctx.fillStyle = kind === 'collage' ? '#c8ab8e' : palette.soft; ctx.fillRect(0, 0, w, h);
      if (kind === 'collage') {
        paper(30, 30, 270, 350, palette.surface); paper(326, 43, 360, 270, palette.ink);
        paper(712, 22, 275, 440, palette.rose); paper(55, 406, 420, 325, palette.soft);
        paper(506, 343, 177, 378, palette.surface); paper(716, 495, 274, 235, palette.surface);
        ctx.fillStyle = palette.ink; ctx.font = 'italic 45px Georgia'; ctx.fillText('dear music,', 52, 95);
        ctx.font = '24px Georgia'; ctx.fillText('a little room', 77, 321); ctx.fillText('of my own', 91, 350);
        heart(164, 192, 65, palette.rose);
        ctx.fillStyle = palette.surface; ctx.font = 'italic 37px Georgia'; ctx.fillText('SIDE A', 427, 93);
        ctx.beginPath(); ctx.arc(507, 198, 79, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = palette.rose; ctx.beginPath(); ctx.arc(507, 198, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = palette.ink; ctx.font = 'bold 34px Georgia'; ctx.fillText('petit journal', 745, 77);
        // A simple original fashion sketch, like the illustrated sheets on the reference boards.
        ctx.fillStyle = palette.surface; ctx.beginPath(); ctx.ellipse(850, 176, 45, 56, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = palette.ink; ctx.lineWidth = 5; ctx.stroke();
        ctx.fillStyle = palette.ink; ctx.beginPath(); ctx.moveTo(808, 156); ctx.quadraticCurveTo(790, 85, 876, 113); ctx.lineTo(899, 175); ctx.lineTo(865, 133); ctx.fill();
        ctx.fillStyle = palette.surface; ctx.beginPath(); ctx.moveTo(827, 236); ctx.lineTo(876, 236); ctx.lineTo(915, 365); ctx.lineTo(785, 365); ctx.closePath(); ctx.fill();ctx.stroke();
        ctx.beginPath(); ctx.moveTo(830, 365);ctx.lineTo(823, 416);ctx.moveTo(870, 365);ctx.lineTo(878, 416);ctx.stroke();
        heart(853, 270, 16, palette.rose);
        ctx.fillStyle = palette.ink; ctx.font = 'italic 38px Georgia'; ctx.fillText('little things', 88, 468);
        for (let i = 0; i < 4; i++) {
          heart(130 + i * 90, 557, 24, i % 2 ? palette.rose : palette.surface);
          ctx.fillStyle = palette.ink; ctx.fillRect(92, 622 + i * 19, 290 - i * 30, 3);
          paper(526, 365 + i * 84, 136, 72, i % 2 ? palette.rose : palette.wood);
          ctx.fillStyle = palette.surface; ctx.beginPath();ctx.arc(562, 393 + i * 84, 14, 0, Math.PI * 2);ctx.arc(610, 393 + i * 84, 14, 0, Math.PI * 2);ctx.fill();
        }
        ctx.fillStyle = palette.ink; ctx.font = 'italic 35px Georgia';ctx.fillText('with love', 763, 646);heart(850, 564, 26, palette.rose);
        [[150, 28], [480, 45], [825, 22], [213, 410], [585, 344]].forEach(([x, y]) => {
          ctx.fillStyle = '#e9d9ba'; ctx.globalAlpha = .85; ctx.fillRect(x, y - 7, 82, 24);ctx.globalAlpha = 1;
        });
      } else {
        paper(25, 25, w - 50, h - 50, palette.surface);
        ctx.fillStyle = palette.rose;ctx.font = 'italic 110px Georgia';ctx.fillText('Sunday', 85, 150);
        ctx.fillStyle = palette.ink;ctx.font = '30px Georgia';ctx.fillText('RECORDS & DAYDREAMS', 90, 205);
        heart(730, 475, 170, palette.rose);
        ctx.strokeStyle = palette.ink;ctx.lineWidth = 5;ctx.beginPath();ctx.ellipse(314, 432, 125, 127, -.12, 0, Math.PI * 2);ctx.stroke();
        ctx.beginPath();ctx.ellipse(253, 279, 34, 94, -.3, 0, Math.PI * 2);ctx.ellipse(360, 280, 34, 94, .2, 0, Math.PI * 2);ctx.stroke();
        ctx.fillStyle = palette.ink;[275, 346].forEach(x=>{ctx.beginPath();ctx.arc(x, 430, 8, 0, Math.PI * 2);ctx.fill();});heart(313, 467, 12, palette.rose);
        ctx.font = 'italic 47px Georgia';ctx.fillText('songs to keep close', 110, 655);
      }
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.generateMipmaps = true;
    map.minFilter = LinearMipmapLinearFilter;
    map.anisotropy = 4;
    return map;
  }, [kind, palette]);
  useEffect(() => {
    if (!texture || (kind !== 'collage' && !photoSlot)) return;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let cancelled = false;
    const cards = [
      [30, 30, 270, 350], [326, 43, 360, 270], [712, 22, 275, 440],
      [55, 406, 420, 325], [506, 343, 177, 378], [716, 495, 274, 235],
    ] as const;
    const drawCover = (image: HTMLImageElement, x: number, y: number, width: number, height: number) => {
      // Account for the canvas being mapped onto a differently shaped plane.
      const aspect = width / height * (size[0] / size[1]) / (canvas.width / canvas.height);
      const sourceAspect = image.naturalWidth / image.naturalHeight;
      const sourceWidth = sourceAspect > aspect ? image.naturalHeight * aspect : image.naturalWidth;
      const sourceHeight = sourceAspect > aspect ? image.naturalHeight : image.naturalWidth / aspect;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2,
        sourceWidth, sourceHeight, x, y, width, height);
    };
    const loadPhoto = (filename: string | null, x: number, y: number, width: number, height: number, tape?: readonly [number, number]) => {
      if (!filename) return;
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        drawCover(image, x, y, width, height);
        if (tape) {
          ctx.fillStyle = '#e9d9ba';
          ctx.globalAlpha = .85;
          ctx.fillRect(tape[0], tape[1] - 7, 82, 24);
          ctx.globalAlpha = 1;
        }
        texture.needsUpdate = true;
        invalidate();
      };
      // A missing local file leaves the original illustration in this slot.
      image.onerror = () => {};
      image.src = roomPhotoAsset(filename);
    };
    if (kind === 'collage') {
      const tapes = [[150, 28], [480, 45], [825, 22], [213, 410], [585, 344]] as const;
      roomPhotoAssignments.corkCards.forEach((filename, index) => {
        const [x, y, width, height] = cards[index];
        loadPhoto(filename, x + 10, y + 10, width - 20, height - 20, tapes[index]);
      });
    } else if (photoSlot) {
      loadPhoto(roomPhotoAssignments[photoSlot], 0, 0, canvas.width, canvas.height);
    }
    return () => { cancelled = true; };
  }, [texture, kind, photoSlot, size[0], size[1], invalidate]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return <mesh position={position} rotation={rotation} receiveShadow>
    <planeGeometry args={size} /><meshToonMaterial map={texture} color={palette.surface} transparent={kind === 'rug'} alphaTest={kind === 'rug' ? .1 : 0} gradientMap={ramp} />
  </mesh>;
}
function RoomFloor() {
  const palette = useContext(Palette);
  return <group>
    <SoftBox position={[0, -.12, 0]} size={[8.12, .22, 6.12]} color={palette.wood} radius={.07} />
    {Array.from({ length: 16 }, (_, i) => <group key={i}>
      <mesh position={[-3.75 + i * .5, .002, 0]} receiveShadow><boxGeometry args={[.492, .012, 6]} /><Toon color={i % 3 === 0 ? palette.soft : palette.wood} /></mesh>
      {[-1.7, .3, 2.25].map(z => <mesh key={z} position={[-3.75 + i * .5, .012, z + (i % 2 ? -.35 : 0)]}><boxGeometry args={[.49, .002, .009]} /><Toon color={palette.brass} /></mesh>)}
    </group>)}
    <RoomPrint kind="rug" position={[.1, .026, .72]} rotation={[-Math.PI / 2, 0, 0]} size={[4.5, 3.65]} />
  </group>;
}
function RoomWalls() {
  const palette = useContext(Palette);
  return <group>
    <Box position={[0, 1.9, -3.05]} size={[8.12, 3.8, .16]} color={palette.wall} />
    <Box position={[-4.05, 1.9, 0]} size={[.16, 3.8, 6.12]} color={palette.wall} />
    {[.1, 1.02, 3.68, 3.78].map((y, i) => <group key={y}>
      <Box position={[0, y, -2.93]} size={[8, i === 1 ? .065 : .10, .09]} color={palette.surface} />
      <Box position={[-3.93, y, 0]} size={[.09, i === 1 ? .065 : .10, 6]} color={palette.surface} />
    </group>)}
    <Box position={[0, .54, -2.95]} size={[8, .86, .03]} color={palette.soft} />
    <Box position={[-3.95, .54, 0]} size={[.03, .86, 6]} color={palette.soft} />
    {Array.from({ length: 12 }, (_, i) => <mesh key={i} position={[-3.7 + i * .65, .55, -2.917]}><boxGeometry args={[.018, .83, .018]} /><Toon color={palette.surface} /></mesh>)}
    {Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[-3.917, .55, -2.7 + i * .65]}><boxGeometry args={[.018, .83, .018]} /><Toon color={palette.surface} /></mesh>)}
    <group position={[-3.91, 2.36, .25]} rotation={[0, Math.PI / 2, 0]}>
      <SoftBox size={[2.7, 1.75, .07]} color={palette.brass} radius={.035} />
      <RoomPrint kind="collage" position={[0, 0, .043]} size={[2.56, 1.62]} />
      <Bow position={[1.13, -.67, .09]} size={.2} />
    </group>
    <group position={[-3.9, 2.85, 2.25]} rotation={[0, Math.PI / 2, 0]}>
      <SoftBox size={[.84, 1.15, .055]} color={palette.rose} radius={.025} />
       <RoomPrint kind="cover" position={[0, 0, .035]} size={[.76, 1.06]} photoSlot="sundayPortrait" />
    </group>
    <group position={[-.48, 2.42, -2.86]}>
      <mesh scale={[.38, .58, .7]} castShadow><torusGeometry args={[1, .055, 8, 48]} /><Toon color={palette.brass} /></mesh>
      <mesh position={[0, 0, -.025]} scale={[.36, .56, 1]}><circleGeometry args={[1, 48]} /><meshBasicMaterial color="#d9e2dc" /></mesh>
      <mesh position={[-.065, .03, -.019]} rotation={[0, 0, -.3]}><planeGeometry args={[.04, .77]} /><meshBasicMaterial color={palette.surface} transparent opacity={.55} /></mesh>
      <Bow position={[0, .62, .02]} size={.15} />
      <SoftBox position={[0, -.65, .04]} size={[.88, .055, .23]} color={palette.surface} radius={.02} />
      {[-.23, .17].map((x, i) => <group key={x}>
        <SoftBox position={[x, -.53, .05]} size={[.10, .19 - i * .04, .08]} color={i ? palette.rose : palette.soft} radius={.02} />
        <Bead position={[x, -.405 - i * .02, .05]} scale={[.028, .035, .028]} color={palette.brass} />
      </group>)}
    </group>
    <group position={[1.05, 3.17, -2.9]}>
      <SoftBox size={[1.15, .72, .05]} color={palette.brass} radius={.02} />
       <RoomPrint kind="cover" position={[0, 0, .032]} size={[1.06, .63]} photoSlot="sundayLandscape" />
    </group>
    <group position={[2.55, 3.19, -2.9]}>
      <Heart position={[0, 0, 0]} size={.59} color={palette.rose} />
      <Heart position={[0, 0, .09]} size={.41} color={palette.surface} />
      <Bow position={[0, .38, .06]} size={.12} />
    </group>
  </group>;
}
function Curtains() {
  const palette = useContext(Palette);
  return <group>
    <Rod position={[0, 1.77, .27]} rotation={[0, 0, Math.PI / 2]} length={2.65} radius={.03} color={palette.brass} />
    {[-1, 1].map(side => <group key={side}>
      <Bead position={[side * 1.38, 1.77, .27]} scale={[.065, .065, .065]} color={palette.brass} />
      {Array.from({ length: 6 }, (_, i) => <mesh key={i} position={[side * (.92 + i * .073), .89, .31 + (i % 2) * .026]} castShadow>
        <cylinderGeometry args={[.078, .105, 1.68, 8]} /><Toon color={i % 2 ? palette.rose : palette.soft} />
      </mesh>)}
      <Bow position={[side * 1.06, .59, .49]} size={.22} />
    </group>)}
    {Array.from({ length: 9 }, (_, i) => <Bead key={i} position={[-.88 + i * .22, 1.6, .29]} scale={[.15, .14, .055]} color={palette.soft} />)}
  </group>;
}
// Sillón anterior conservado sin uso; el cuarto carga melody_couch.glb.
export function ListeningSofa() {
  const palette = useContext(Palette);
  return <group>
    <SoftBox position={[0, .34, 0]} size={[2.04, .43, 1.08]} color={palette.rose} radius={.12} />
    <SoftBox position={[0, .82, -.43]} size={[2.04, .62, .25]} color={palette.soft} radius={.11} />
    {[-.43, .43].map(x => <SoftBox key={x} position={[x, .635, .03]} size={[.83, .13, .85]} color={palette.surface} radius={.055} />)}
    {[-.93, .93].map(side => <group key={side}>
      <SoftBox position={[side, .72, 0]} size={[.19, .33, 1.08]} color={palette.soft} radius={.085} />
      {[-.4, .4].map(z => <Rod key={z} position={[side, .19, z]} length={.32} radius={.045} color={palette.brass} />)}
    </group>)}
    {[-.72, -.36, 0, .36, .72].map(x => <Bead key={x} position={[x, .86, -.285]} scale={[.025, .025, .015]} color={palette.rose} />)}
    <SoftBox position={[-.62, .88, -.18]} rotation={[0, 0, -.15]} size={[.42, .42, .16]} color={palette.rose} radius={.09} />
    <Heart position={[-.62, .88, -.085]} size={.18} color={palette.surface} />
  </group>;
}
function CollectionRack() {
  const palette = useContext(Palette);
  return <group>
    {[-1.26, 1.26].flatMap(x => [-.24, .24].map(z => <Rod key={x + ':' + z} position={[x, 1.38, z]} length={2.66} radius={.035} color={palette.rose} />))}
    {[.12, .76, 1.75, 2.6].map(y => <group key={y}>
      <SoftBox position={[0, y, 0]} size={[2.57, .06, .6]} color={palette.soft} radius={.025} />
      <Rod position={[0, y + .16, .31]} rotation={[0, 0, Math.PI / 2]} length={2.58} radius={.025} color={palette.rose} />
    </group>)}
    <RoomPrint kind="books" position={[0, .44, .25]} size={[1.55, .47]} />
    <SoftBox position={[.99, .43, .02]} size={[.3, .44, .4]} color={palette.surface} radius={.025} />
    <Heart position={[.99, .45, .23]} size={.14} color={palette.rose} />
    <Bow position={[1.27, 2.34, .27]} size={.16} />
    <Bow position={[-1.27, 1.38, .27]} size={.14} />
  </group>;
}
function PleatedLamp({ lit, shadeRef }: { lit: boolean; shadeRef: RefObject<Group | null> }) {
  const palette = useContext(Palette);
  return <group>
    <Shape position={[0, .07, 0]} color={palette.brass}><cylinderGeometry args={[.28, .37, .12, 24]} /></Shape>
    <Rod position={[0, 1.2, 0]} length={2.3} radius={.032} color={palette.brass} />
    <Bead position={[0, 2.16, 0]} scale={[.11, .16, .11]} color={palette.rose} />
    <group ref={shadeRef}>{Array.from({ length: 16 }, (_, i) => <mesh key={i} position={[0, 2.43, 0]} castShadow>
      <cylinderGeometry args={[.23, .43, .55, 1, 1, true, i * Math.PI / 8, Math.PI / 8]} />
      <Toon color={i % 2 ? palette.soft : palette.surface} lit={lit} />
    </mesh>)}</group>
    {[2.16, 2.7].map((y, i) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[i ? .23 : .43, .018, 6, 32]} /><Toon color={palette.rose} /></mesh>)}
    <Bow position={[0, 2.07, .09]} size={.16} />
  </group>;
}

function Scene(props: SceneProps & { mouse: RefObject<[number, number]>; active: boolean }) {
  // DEBUG-TEMP: observar el raycast sin modificar el raycaster ni los handlers de R3F.
  const debugWalkReached = useRef(false);
  const debugGet = useThree(state => state.get);
  useEffect(() => {
    const canvas = debugGet().gl.domElement;
    const click = (event: MouseEvent) => {
      debugWalkReached.current = false;
      const state = debugGet();
      const rect = canvas.getBoundingClientRect();
      const ray = new Raycaster();
      ray.layers.mask = state.raycaster.layers.mask;
      ray.params = state.raycaster.params;
      ray.near = state.raycaster.near;
      ray.far = state.raycaster.far;
      try {
        ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
          1 - (event.clientY - rect.top) / rect.height * 2), state.camera);
        const first = ray.intersectObjects(state.internal.interaction, true)[0];
        console.info('[DBG-ROOM] canvas-click primer impacto', first ? {
          nombre: first.object.name || `${first.object.type}:${first.object.uuid}`,
          padres: [first.object.parent?.name, first.object.parent?.parent?.name],
          punto: first.point.toArray(), distancia: first.distance,
        } : null);
      } catch (error) { console.error('[DBG-ROOM] raycast error', error); }
      queueMicrotask(() => console.info('[DBG-ROOM] canvas-click handler suelo ejecutado', debugWalkReached.current));
    };
    canvas.addEventListener('click', click, true);
    return () => canvas.removeEventListener('click', click, true);
  }, [debugGet]);
  const [destination, setDestination] = useState<WalkDestination | null>(null);
  const [couchBounds, setCouchBounds] = useState<CouchBounds | null>(null);
  const [couchRequest, setCouchRequest] = useState<CouchRequest | null>(null);
  const [couchOccupied, setCouchOccupied] = useState(false);
  const [turntableApproach, setTurntableApproach] = useState<TurntableApproach | null>(null);
  const turntableBusy = useRef(false);
  const turntableRequest = useRef<number | null>(null);
  const walkRequest = useRef(0);
  const chairAction = useRef<(() => void) | null>(null);
  const [chairAvailable, setChairAvailable] = useState(false);
  const setChairAction = useMemo(() => (sit: (() => void) | null) => {
    chairAction.current = sit;
    setChairAvailable(sit !== null);
  }, []);
  const currentPlayer = useRef(props.player);
  currentPlayer.current = props.player;
  const requestCouch = (pose: Exclude<CouchRequest['pose'], 'stand'>) => {
    setDestination(null);
    setCouchOccupied(true);
    setCouchRequest(previous => ({ pose, request: (previous?.request ?? 0) + 1 }));
  };
  const leaveCouchForWalk = () => {
    if (couchOccupied) setCouchRequest(previous => ({ pose: 'stand', request: (previous?.request ?? 0) + 1 }));
  };
  const { player, albums, lampOn, phase, weather, reduced, setPage, page, pageCount } = props;
  const palette = useContext(Palette);
  const objects = room3d.objects;
  const goToWardrobe = () => {
    if (reduced && !couchOccupied) { props.openWardrobe(); return; }
    leaveCouchForWalk();
    setDestination({
      point: [room3d.wardrobe.position[0], room3d.wardrobe.position[2]],
      request: ++walkRequest.current, facing: room3d.wardrobe.facing,
      onArrive: () => { setDestination(null); props.openWardrobe(); },
    });
    invalidate();
  };
  const goToTurntable = () => {
    if (!props.active || !props.hasTracks || !turntableApproach || turntableBusy.current) return;
    // Debe ejecutarse dentro del click original, antes de esperar la caminata.
    player.unlock();
    turntableBusy.current = true;
    leaveCouchForWalk();
    const request = ++walkRequest.current;
    turntableRequest.current = request;
    const finish = () => {
      if (turntableRequest.current !== request) return;
      turntableRequest.current = null;
      turntableBusy.current = false;
      setDestination(previous => previous?.request === request ? null : previous);
    };
    setDestination({ ...turntableApproach, request,
      press: { onContact: () => { if (turntableRequest.current === request) currentPlayer.current.toggle(); },
        onFinish: finish, onCancel: finish } });
    invalidate();
  };
  const lampLight = useRef<PointLight>(null);
  const lampShade = useRef<Group>(null);
  const lampStart = useRef<number | null>(null);
  const lampEmissive = useRef(new WeakMap<MeshStandardMaterial, number>());
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { if (props.active) invalidate(); }, [props.active, invalidate]);
  useFrame(() => {
    const now = performance.now();
    const start = lampStart.current ?? (lampStart.current = now);
    const progress = reduced ? 1 : Math.min(1, (now - start) / 1200);
    const factor = .2 + .8 * (1 - (1 - progress) ** 3);
    if (lampLight.current) lampLight.current.intensity = (lampOn ? 3 : 0) * factor;
    for (const child of lampShade.current?.children ?? []) {
      const material = (child as Mesh).material;
      if (!(material instanceof MeshStandardMaterial)) continue;
      let base = lampEmissive.current.get(material);
      if (base === undefined) {
        base = material.emissiveIntensity;
        lampEmissive.current.set(material, base);
      }
      material.emissiveIntensity = base * factor;
    }
    if (progress < 1 && props.active) invalidate();
  });
  return <HoverLabel.Provider value={props.onHover}>
    <CameraRig mouse={props.mouse} reduced={reduced} />
    <hemisphereLight intensity={phase === 'night' ? 1.05 : 1.45} color={phase === 'night' ? '#dfd6ec' : '#fff6e8'} groundColor="#c6a496" />
    <ambientLight intensity={.35} color="#fff4e4" />
    <directionalLight position={room3d.sun.position} intensity={phase === 'night' ? .55 : 1.65} color={phase === 'sunset' ? '#ffc49a' : '#fff3df'} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6}
      shadow-camera-near={.5} shadow-camera-far={22} shadow-bias={-.0003} shadow-normalBias={.025} shadow-radius={4} />
    <pointLight ref={lampLight} position={room3d.lampLight.position} intensity={(lampOn ? 3 : 0) * (reduced ? 1 : .2)} distance={7} decay={2} color="#ffe6c6" />
    <group onClick={event => {
      // DEBUG-TEMP
      console.info('[DBG-ROOM] click suelo', { active: props.active, button: event.button, delta: event.delta });
      if (!props.active || event.button !== 0 || event.delta > 5) return;
      // DEBUG-TEMP
      debugWalkReached.current = true;
      event.stopPropagation();
      leaveCouchForWalk();
      setDestination({ point: [event.point.x, event.point.z], request: ++walkRequest.current });
    }} onPointerOver={() => props.onHover('Caminar con Mikako · clic en el suelo')}
      onPointerOut={() => props.onHover('')}>
      <RoomFloor />
    </group>
    <RoomWalls />
    {room3d.posters.map(poster => <Suspense key={poster.image} fallback={null}><Poster config={poster} /></Suspense>)}
    <Furniture config={objects.window}>
      <WindowSky phase={phase} weather={weather} />
      <group>
        {[-1.03, 1.03].map(x => <Box key={x} position={[x, .8, .16]} size={[.1, 1.7, .16]} color={palette.surface} />)}
        {[0, 1.6].map(y => <Box key={y} position={[0, y, .16]} size={[2.15, .1, .16]} color={palette.surface} />)}
        <Box position={[0, .8, .17]} size={[.055, 1.6, .08]} color={palette.surface} />
        <Box position={[0, .8, .17]} size={[2.1, .055, .08]} color={palette.surface} />
        <Box position={[0, -.05, .22]} size={[2.3, .1, .4]} color={palette.wood} />
        <Curtains />
      </group>
    </Furniture>
    <Suspense fallback={null}><Couch occupied={couchOccupied} active={props.active}
      onBounds={setCouchBounds} request={requestCouch} /></Suspense>
    <Suspense fallback={null}><Wardrobe action={goToWardrobe} /></Suspense>
    <Furniture config={objects.turntable}>
      <Action label={player.playing ? 'Pausar tocadiscos' : 'Reproducir tocadiscos'} action={goToTurntable}
        disabled={!props.hasTracks || !turntableApproach}>
        <RoomModel config={objects.turntable} />
        <Record player={player} reduced={reduced} />
      </Action>
      <TransportPart position={room3d.previous.position} scale={room3d.previous.scale} action={player.previous} disabled={!props.hasTracks} />
      <TransportPart position={room3d.next.position} scale={room3d.next.scale} next action={player.next} disabled={!props.hasTracks} />
    </Furniture>
    <Furniture config={objects.desk}><RoomModel config={objects.desk} /></Furniture>
    <Furniture config={deskChairConfig}>
      <Action label="Sentarse al escritorio" action={chairAvailable ? () => chairAction.current?.() : undefined} disabled={!props.active || !chairAvailable}>
        <RoomModel config={deskChairConfig} />
      </Action>
    </Furniture>
    <Furniture config={objects.pc}><RoomModel config={objects.pc} /></Furniture>
    <Furniture config={objects.shelf}>
      <CollectionRack />
      {albums.map((track, i) => <Album key={track.id} track={track} selected={track.id === player.current?.id} select={() => player.select(track)}
        position={[room3d.albums.start[0] + i % room3d.albums.columns * room3d.albums.spacing[0], room3d.albums.start[1] - Math.floor(i / room3d.albums.columns) * room3d.albums.spacing[1], room3d.albums.start[2]]} />)}
      <TransportPart label="Álbumes anteriores" position={room3d.pagePrevious.position} action={() => setPage(page - 1)} disabled={page === 0} />
      <TransportPart label="Más álbumes" position={room3d.pageNext.position} next action={() => setPage(page + 1)} disabled={page === pageCount - 1} />
    </Furniture>
    <Furniture config={objects.shelfMangas}><RoomModel config={objects.shelfMangas} /></Furniture>
    <Suspense fallback={null}><RoomPlushies reduced={reduced} onHover={props.onHover} /></Suspense>
    <Furniture config={objects.lamp}><Action label={lampOn ? 'Apagar la lámpara' : 'Encender la lámpara'} action={props.toggleLamp}>
      <PleatedLamp lit={lampOn} shadeRef={lampShade} />
    </Action></Furniture>
    <Furniture config={objects.plant}><Action label="Acariciar la planta" action={props.tapPlant}>
      <RoomModel config={objects.plant} />
    </Action></Furniture>
    <Action label="Saludar a Mikako" action={props.tapMikako}>
      <Suspense fallback={null}><Mikako key={props.outfit} outfit={props.outfit} taps={props.mikakoTaps} reduced={reduced} playing={player.playing} active={props.active} destination={destination}
        couchBounds={couchBounds} couchRequest={couchRequest} onCouchOccupied={setCouchOccupied}
        onTurntableReady={setTurntableApproach} onChairReady={setChairAction} /></Suspense>
    </Action>
  </HoverLabel.Provider>;
}
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="room-3d-unavailable" role="alert">No se pudo iniciar la escena 3D. Vuelve a abrir Mi cuarto para intentarlo de nuevo.</p> : this.props.children; }
}
export const Room3D = memo(function Room3D({ palette, active, ...props }: SceneProps & { palette: RoomPalette; active: boolean }) {
  // DEBUG-TEMP: listeners equivalentes a window.onerror y onunhandledrejection, con limpieza.
  useEffect(() => {
    const error = (event: ErrorEvent) => console.error('[DBG-ROOM] window.onerror', event.error ?? event.message);
    const rejection = (event: PromiseRejectionEvent) => console.error('[DBG-ROOM] unhandledrejection', event.reason);
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    return () => {
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
    };
  }, []);
  const [ramp] = useState(makeToonRamp);
  const [vinylResources] = useState(makeVinylResources);
  const mouse = useRef<[number, number]>([0, 0]);
  const canvasContainer = useRef<HTMLDivElement>(null);
  const invalidate = useRef<() => void>(() => {});
  useEffect(() => () => ramp.dispose(), [ramp]);
  useEffect(() => () => {
    Object.values(vinylResources).forEach(resource => resource.dispose());
  }, [vinylResources]);
  useLayoutEffect(() => {
    if (props.reduced) return;
    const animation = canvasContainer.current?.animate([
      { transform: 'scale(.96)', opacity: .6 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 450, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    return () => animation?.cancel();
  }, []);
  return <SceneBoundary><Palette.Provider value={palette}><ToonRamp.Provider value={ramp}>
    <div ref={canvasContainer} className="room-canvas" tabIndex={0} role="group" aria-label="Habitación 3D interactiva" aria-describedby="room-keyboard-hint"
      onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        mouse.current = [(event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2];
        if (!props.reduced) invalidate.current();
      }}
      onPointerLeave={() => { mouse.current = [0, 0]; props.onHover(''); invalidate.current(); }}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        const actions: Record<string, () => void> = {
          ' ': props.player.toggle, enter: props.player.toggle, arrowleft: props.player.previous, arrowright: props.player.next,
          l: props.toggleLamp, p: props.tapPlant, u: props.tapMikako,
          pageup: () => props.setPage(Math.max(0, props.page - 1)), pagedown: () => props.setPage(Math.min(props.pageCount - 1, props.page + 1)),
        };
        const album = /^[1-6]$/.test(key) ? props.albums[Number(key) - 1] : undefined;
        if (album) { event.preventDefault(); event.stopPropagation(); props.player.select(album); }
        else if (actions[key]) { event.preventDefault(); event.stopPropagation(); actions[key](); }
      }}>
      <Canvas orthographic camera={{ position: room3d.camera.position, near: .1, far: 50, zoom: 60 }} shadows="soft"
        dpr={room3d.pixelRatio} frameloop={active ? 'demand' : 'never'} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl, invalidate: nextInvalidate }) => { gl.domElement.setAttribute('aria-hidden', 'true'); gl.toneMapping = NoToneMapping; gl.outputColorSpace = SRGBColorSpace; invalidate.current = nextInvalidate; }}
        fallback={<p className="room-3d-unavailable">Esta ventana necesita WebGL para mostrar Mi cuarto.</p>}>
        <color attach="background" args={[palette.bg]} />
        <VinylResources.Provider value={vinylResources}><Scene {...props} mouse={mouse} active={active} /></VinylResources.Provider>
      </Canvas>
    </div>
  </ToonRamp.Provider></Palette.Provider></SceneBoundary>;
});

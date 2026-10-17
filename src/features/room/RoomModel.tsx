import { Fragment, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal, type ThreeElements } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { Box3, DataTexture, Mesh, MeshToonMaterial, NearestFilter, RedFormat, Texture, Vector3, type BufferGeometry, type Group, type Material, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { roomAsset, roomPalette, type RoomObjectConfig } from './room3d.config';

export const Palette = createContext(roomPalette);
export const Highlight = createContext(false);
export const ToonRamp = createContext<DataTexture | null>(null);
export function makeToonRamp() {
  const ramp = new DataTexture(new Uint8Array([145, 208, 255]), 3, 1, RedFormat);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}
export function Toon({ color, lit = false }: { color: string; lit?: boolean }) {
  const ramp = useContext(ToonRamp);
  return <meshToonMaterial color={color} gradientMap={ramp} emissive={lit ? '#ffc978' : '#000000'} emissiveIntensity={lit ? .18 : 0} />;
}
export function Outline() {
  const palette = useContext(Palette);
  const hover = useContext(Highlight);
  return <Outlines thickness={hover ? 1.15 : .65} screenspace={false} color={hover ? palette.highlight : palette.ink} />;
}
export function Shape({ children, color, lit, ...props }: ThreeElements['mesh'] & { color: string; lit?: boolean }) {
  return <mesh castShadow receiveShadow {...props}>{children}<Toon color={color} lit={lit} /><Outline /></mesh>;
}
export function Box({ size, ...props }: Omit<Parameters<typeof Shape>[0], 'children'> & { size: [number, number, number] }) {
  return <Shape {...props}><boxGeometry args={size} /></Shape>;
}

interface ModelSource { scene: Group; dispose: () => void }
interface ModelCacheEntry { ready: Promise<ModelSource>; users: number; source?: ModelSource }
const modelCache = new Map<string, ModelCacheEntry>();
const modelCacheLimit = 4;
function trimModelCache() {
  for (const [url, entry] of modelCache) {
    if (modelCache.size <= modelCacheLimit) break;
    if (entry.users || !entry.source) continue;
    entry.source.dispose();
    modelCache.delete(url);
  }
}
async function loadModelSource(url: string): Promise<ModelSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo cargar el modelo: ' + url);
  const bytes = await response.arrayBuffer();
  // Vite puede devolver index.html si falta el asset.
  if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) {
    throw new Error('El archivo no es un GLB: ' + url);
  }
  const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', new URL(url, window.location.href)).href);
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  for (const scene of gltf.scenes) scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  return { scene: gltf.scene, dispose: () => {
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => value.dispose());
  } };
}
function acquireModelSource(url: string) {
  let entry = modelCache.get(url);
  if (entry) {
    modelCache.delete(url);
    modelCache.set(url, entry);
  } else {
    const pending: ModelCacheEntry = { ready: loadModelSource(url), users: 0 };
    pending.ready = pending.ready.then(source => {
      pending.source = source;
      trimModelCache();
      return source;
    }, error => {
      modelCache.delete(url);
      throw error;
    });
    modelCache.set(url, pending);
    entry = pending;
  }
  const acquired = entry;
  acquired.users++;
  let released = false;
  return { ready: acquired.ready, release: () => {
    if (released) return;
    released = true;
    acquired.users--;
    trimModelCache();
  } };
}

interface LoadedModel { scene: Group; meshes: Mesh[]; fit: number; dispose: () => void }
export function RoomModel({ config, children, lit = false }: { config: RoomObjectConfig; children?: ReactNode; lit?: boolean }) {
  const palette = useContext(Palette);
  const ramp = useContext(ToonRamp);
  const color = palette[config.color];
  const colorRef = useRef(color);
  colorRef.current = color;
  const [model, setModel] = useState<LoadedModel | null>(null);
  useEffect(() => {
    let active = true;
    const cached = acquireModelSource(roomAsset(config.model));
    let owned: LoadedModel | undefined;
    setModel(null);
    void (async () => {
      try {
        const original = await cached.ready;
        // DEBUG-TEMP
        if (config.model === 'models/desk_chair') console.info('[DBG-ROOM] desk_chair.glb carga correcta', roomAsset(config.model));
        if (!active) return;
        // Los nodos y materiales son locales; geometrías y mapas pertenecen a la caché.
        const scene = clone(original.scene) as Group;
        const materials = new Set<Material>();
        const meshes: Mesh[] = [];
        scene.traverse(node => {
          if (!(node instanceof Mesh)) return;
          const toon = (source: Material) => {
            const original = source as MeshStandardMaterial;
            const material = new MeshToonMaterial({
              color: config.preserveTextures ? original.color : colorRef.current, gradientMap: ramp,
              ...(config.preserveTextures ? {
                map: original.map, side: original.side, transparent: original.transparent,
                opacity: original.opacity, alphaTest: original.alphaTest,
              } : {}),
            });
            materials.add(material);
            return material;
          };
          node.material = Array.isArray(node.material) ? node.material.map(toon) : toon(node.material);
          node.castShadow = node.receiveShadow = true;
          // These named parts are supplied by the project's interactive geometry.
          if (config.model === 'turntable' && /^(record|platter|previous|next|button_previous|button_next)$/i.test(node.name)) node.visible = false;
          if (node.visible) meshes.push(node);
        });
        const bounds = new Box3().setFromObject(scene);
        const extent = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        const fit = Math.min(...config.size.map((size, i) => size / Math.max(extent.getComponent(i), .001)));
        // DEBUG-TEMP
        if (config.model === 'models/desk_chair') console.info('[DBG-ROOM] silla medidas', { extent: extent.toArray(), fit, scale: config.scale });
        scene.position.sub(new Vector3(center.x, bounds.min.y, center.z));
        owned = { scene, meshes, fit, dispose: () => {
          materials.forEach(value => value.dispose());
        } };
        if (!active || !Number.isFinite(fit) || bounds.isEmpty()) { owned.dispose(); owned = undefined; return; }
        setModel(owned);
      } catch (error) {
        // DEBUG-TEMP
        if (config.model === 'models/desk_chair') console.error('[DBG-ROOM] desk_chair.glb error', error);
        // Missing, unsupported or damaged models leave the usable toon placeholder.
      }
    })();
    return () => { active = false; owned?.dispose(); cached.release(); };
  }, [config, ramp]);
  useEffect(() => {
    model?.meshes.forEach(mesh => {
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshToonMaterial[];
      for (const material of materials) {
        if (!config.preserveTextures) material.color.set(color);
        material.emissive.set(lit ? '#ffc978' : '#000000');
        material.emissiveIntensity = lit ? .45 : 0;
      }
    });
  }, [model, color, lit, config.preserveTextures]);
  return model ? <group scale={model.fit} dispose={null}>
    <primitive object={model.scene} />
    {model.meshes.map(mesh => <Fragment key={mesh.uuid}>{createPortal(<Outline />, mesh, { events: { enabled: false } })}</Fragment>)}
  </group> : <>{children}</>;
}

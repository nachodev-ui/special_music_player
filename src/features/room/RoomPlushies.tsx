import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Box3, Group, Mesh, MeshToonMaterial, Vector3, type Material, type MeshStandardMaterial } from 'three';
import { Highlight, Outline, ToonRamp } from './RoomModel';
import { room3d, roomAsset, type RoomPlushConfig } from './room3d.config';

type PlushSource = Group;

function Plush({ config, source, reduced, playSound, onHover }: {
  config: RoomPlushConfig; source: PlushSource; reduced: boolean;
  playSound: () => void; onHover: (label: string) => void;
}) {
  const ramp = useContext(ToonRamp);
  const invalidate = useThree(state => state.invalidate);
  const [hover, setHover] = useState(false);
  const bounce = useRef<Group>(null);
  const elapsed = useRef<number | null>(null);
  const model = useMemo(() => {
    const scene = source.clone(true);
    const bounds = new Box3().setFromObject(scene);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    scene.position.sub(new Vector3(center.x, bounds.min.y, center.z));
    const meshes: Mesh[] = [];
    const materials: MeshToonMaterial[] = [];
    scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      const toon = (sourceMaterial: Material) => {
        const original = sourceMaterial as MeshStandardMaterial;
        const material = new MeshToonMaterial({
          color: original.color, map: original.map, gradientMap: ramp,
          side: original.side, transparent: original.transparent,
          opacity: original.opacity, alphaTest: original.alphaTest,
        });
        materials.push(material);
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(toon) : toon(node.material);
      node.castShadow = node.receiveShadow = true;
      node.raycast = () => {}; // Only the simple collider handles pointer events.
      meshes.push(node);
    });
    return { scene, meshes, materials, size };
  }, [source, ramp]);
  useEffect(() => () => model.materials.forEach(material => material.dispose()), [model]);
  useEffect(() => {
    if (reduced && bounce.current) {
      elapsed.current = null;
      bounce.current.scale.set(1, 1, 1);
      invalidate();
    }
  }, [reduced, invalidate]);
  useEffect(() => () => onHover(''), [onHover]);
  useFrame((_, delta) => {
    if (elapsed.current === null || !bounce.current) return;
    const duration = .42;
    elapsed.current = Math.min(duration, elapsed.current + Math.min(delta, .05));
    const progress = elapsed.current / duration;
    const pulse = Math.sin(progress * Math.PI * 2) * (1 - progress);
    bounce.current.scale.set(1 + pulse * .06, 1 - pulse * .12, 1 + pulse * .06);
    if (progress < 1) invalidate();
    else { elapsed.current = null; bounce.current.scale.set(1, 1, 1); }
  });
  const tap = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    playSound();
    if (!reduced) { elapsed.current = 0; invalidate(); }
  };
  return <Highlight.Provider value={hover}>
    <group position={config.position} rotation={config.rotation} scale={config.scale}
      onPointerOver={event => { event.stopPropagation(); setHover(true); onHover(config.label); }}
      onPointerOut={event => { event.stopPropagation(); setHover(false); onHover(''); }}
      onClick={tap}>
      <group ref={bounce}>
        <primitive object={model.scene} dispose={null} />
        {model.meshes.map(mesh => <Fragment key={mesh.uuid}>{createPortal(<Outline />, mesh, { events: { enabled: false } })}</Fragment>)}
        <mesh position={[0, model.size.y / 2, 0]}>
          <boxGeometry args={[model.size.x, model.size.y, model.size.z]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  </Highlight.Provider>;
}

export function RoomPlushies({ reduced, onHover }: { reduced: boolean; onHover: (label: string) => void }) {
  const [melodyModel, mikakoModel] = useGLTF([
    roomAsset(room3d.plushies.sofa.model), roomAsset(room3d.plushies.wall.model),
  ]);
  const melody = melodyModel.scene;
  const mikako = mikakoModel.scene;
  const sound = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const audio = new Audio(import.meta.env.BASE_URL + room3d.plushSound.file);
    audio.volume = room3d.plushSound.volume;
    sound.current = audio;
    return () => { audio.pause(); audio.removeAttribute('src'); audio.load(); sound.current = null; };
  }, []);
  const playSound = () => {
    const audio = sound.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  };
  return <>{Object.entries(room3d.plushies).map(([slot, config]) =>
    <Plush key={slot} config={config} source={config.model === room3d.plushies.sofa.model ? melody : mikako}
      reduced={reduced} playSound={playSound} onHover={onHover} />
  )}</>;
}

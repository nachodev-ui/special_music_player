import { useContext, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Outlines, useGLTF } from '@react-three/drei';
import { AnimationClip, AnimationMixer, Box3, Group, LoopOnce, LoopRepeat, MathUtils, Mesh, MeshToonMaterial, Quaternion, Vector3, type AnimationAction, type Bone, type MeshStandardMaterial, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Highlight, Palette, ToonRamp } from './RoomModel';
import { room3d, roomAsset } from './room3d.config';
import { COUCH_RECLINE, couchPhase, couchApproachPosition, couchRootPosition, createReclineClip, type CouchBounds, type CouchRequest } from './mikakoRecline';
import { createTurntablePress, TURNTABLE_CONTACT_TIME, TURNTABLE_PRESS, type TurntableApproach } from './mikakoTurntable';
import { CHAIR_POSITION, DESK_CHAIR, chairEntry, chairRoot, chairSlide, createDeskChairClip } from './mikakoDeskChair';

const noRaycast = () => {};
let welcomeAttempted = false;

type WalkMotion = 'walk' | 'walk-repeat' | 'walk-model' | 'walk-model-repeat';
type Motion = 'idle' | 'wave' | 'sit' | 'rise' | 'recline' | 'unrecline' | 'desk-sit' | 'desk-rise' | 'dance' | 'stretch' | 'press' | WalkMotion;
const isWalking = (motion: Motion): motion is WalkMotion =>
  motion === 'walk' || motion === 'walk-repeat' || motion === 'walk-model' || motion === 'walk-model-repeat';
type FloorPoint = [number, number];
export type WalkDestination = {
  point: FloorPoint; request: number; facing?: FloorPoint; onArrive?: () => void;
  press?: { onContact: () => void; onFinish: () => void; onCancel: () => void };
};

// Navigation uses furniture footprints only; no physics or mesh raycasts.
function walkingPath(from: FloorPoint, to: FloorPoint): FloorPoint[] | null {
  const { floor, sofa, turntable, shelf, lamp, plant, ropero, desk } = room3d.objects;
  const bounds = [floor.size[0] / 2 - .2, floor.size[2] / 2 - .2];
  const obstacles = [sofa, turntable, shelf, lamp, plant, ropero, desk].map(object => {
    const c = Math.abs(Math.cos(object.rotation[1]));
    const s = Math.abs(Math.sin(object.rotation[1]));
    const width = object.size[0] * Math.abs(object.scale[0]);
    const depth = object.size[2] * Math.abs(object.scale[2]);
    const x = (width * c + depth * s) / 2 + .16;
    const z = (width * s + depth * c) / 2 + .16;
    return [object.position[0] - x, object.position[0] + x, object.position[2] - z, object.position[2] + z];
  });
  const free = ([x, z]: FloorPoint) => Math.abs(x) < bounds[0] && Math.abs(z) < bounds[1] &&
    !obstacles.some(([left, right, back, front]) => x >= left && x <= right && z >= back && z <= front);
  const distance = (a: FloorPoint, b: FloorPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const clear = (a: FloorPoint, b: FloorPoint) => !obstacles.some(box => {
    let enter = 0;
    let leave = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = b[axis] - a[axis];
      const min = box[axis * 2];
      const max = box[axis * 2 + 1];
      if (Math.abs(delta) < 1e-8) {
        if (a[axis] < min || a[axis] > max) return false;
      } else {
        const first = (min - a[axis]) / delta;
        const last = (max - a[axis]) / delta;
        enter = Math.max(enter, Math.min(first, last));
        leave = Math.min(leave, Math.max(first, last));
        if (enter > leave) return false;
      }
    }
    return true;
  });
  if (!free(from) || !free(to)) return null;
  if (distance(from, to) < .03) return [];
  if (clear(from, to)) return [to];
  const corners: FloorPoint[] = obstacles.flatMap(([left, right, back, front]) =>
    ([ [left - .02, back - .02], [left - .02, front + .02],
      [right + .02, back - .02], [right + .02, front + .02] ] as FloorPoint[]).filter(free));
  const nodes = [from, to, ...corners];
  const costs = nodes.map(() => Infinity);
  const parents = nodes.map(() => -1);
  const visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let closest = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited.has(i) && Number.isFinite(costs[i]) && (closest < 0 || costs[i] < costs[closest])) closest = i;
    }
    if (closest < 0) return null;
    if (closest === 1) {
      const path: FloorPoint[] = [];
      for (let i = 1; i !== 0; i = parents[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(closest);
    for (let i = 0; i < nodes.length; i++) {
      const cost = costs[closest] + distance(nodes[closest], nodes[i]);
      if (!visited.has(i) && cost < costs[i] && clear(nodes[closest], nodes[i])) {
        costs[i] = cost;
        parents[i] = closest;
      }
    }
  }
  return null;
}
type Playback = {
  sync: () => void;
  greet: (welcome?: boolean) => void;
  walk: (destination: WalkDestination) => void;
  chair: () => void;
  frame: (now: number) => void;
  dispose: () => void;
};
const fadeDuration = .25;
const frameInterval = 1000 / 30;

// Los archivos de clips son un conjunto fijo definido por los outfits.
const clipCache = new Map<string, Promise<AnimationClip>>();
function loadClip(name: string): Promise<AnimationClip> {
  const cached = clipCache.get(name);
  if (cached) return cached;
  const pending = (async () => {
    const url = import.meta.env.BASE_URL + 'assets/room3d/' + name;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Mikako ' + name + ': ' + response.status);
    const json = await response.json();
    // three r180 espera userData como texto y una identidad por clip.
    if (json.userData !== undefined && typeof json.userData !== 'string') {
      json.userData = JSON.stringify(json.userData);
    }
    json.uuid = MathUtils.generateUUID();
    return AnimationClip.parse(json);
  })().catch(error => {
    clipCache.delete(name);
    throw error;
  });
  clipCache.set(name, pending);
  return pending;
}

export function Mikako({ outfit, reduced, taps, playing, active = true, destination = null, couchBounds = null, couchRequest = null, onCouchOccupied, onTurntableReady, onChairReady, chairGroup }: {
  outfit: string; reduced: boolean; taps: number; playing: boolean; active?: boolean; destination?: WalkDestination | null;
  couchBounds?: CouchBounds | null; couchRequest?: CouchRequest | null; onCouchOccupied?: (occupied: boolean) => void;
  onTurntableReady?: (approach: TurntableApproach | null) => void;
  onChairReady?: (sit: (() => void) | null) => void;
  chairGroup?: RefObject<Group | null>;
}) {
  const selected = room3d.mikako.outfits.find(item => item.id === outfit) ?? room3d.mikako.outfits[0];
  const isGingham = selected.id === 'cuadros';
  const settings = useMemo(() => ({ ...room3d.mikako, ...selected }), [selected]);
  // Draco stays disabled for the CSP; meshopt is bundled locally by drei.
  const { scene } = useGLTF(roomAsset(selected.model), false, true);
  const ramp = useContext(ToonRamp);
  const palette = useContext(Palette);
  const hover = useContext(Highlight);
  const greetingGroup = useRef<Group>(null);
  const placement = useRef<Group>(null);
  const collider = useRef<Mesh>(null);
  const playback = useRef<Playback | null>(null);
  const pendingWelcome = useRef(false);
  const latest = useRef({ playing, reduced, active, couchRequest, onCouchOccupied });
  const lastTaps = useRef(taps);
  const pendingDestination = useRef(isGingham || destination?.press ? null : destination);
  const lastDestinationRequest = useRef(isGingham || destination?.press ? destination?.request : undefined);
  const turntableReady = useRef(onTurntableReady);
  turntableReady.current = onTurntableReady;
  const chairReady = useRef(onChairReady);
  chairReady.current = onChairReady;
  useEffect(() => {
    if (welcomeAttempted) return;
    if (reduced) { welcomeAttempted = true; return; }
    const timer = window.setTimeout(() => {
      if (welcomeAttempted) return;
      welcomeAttempted = true;
      if (playback.current) playback.current.greet(true);
      else pendingWelcome.current = true;
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    latest.current = { playing, reduced, active, couchRequest, onCouchOccupied };
    playback.current?.sync();
  }, [playing, reduced, active, couchRequest, onCouchOccupied]);
  const invalidate = useThree(state => state.invalidate);
  // Preserve the contour's thickness for the new 1.8-metre source model.
  const outlineThickness = room3d.mikako.outline.thicknessPerUnit * 1.8 * Math.max(...settings.scale);
  const { model, meshes, materials, hitSize, hitCenter, yawOffset } = useMemo(() => {
    const model = clone(scene);
    const meshes: Mesh[] = [];
    const materials: MeshToonMaterial[] = [];
    model.traverse(node => {
      if (!(node instanceof Mesh)) return;
      const toon = (source: MeshStandardMaterial) => {
        const material = new MeshToonMaterial({
          map: source.map, color: source.color, gradientMap: ramp,
          transparent: source.transparent, opacity: source.opacity,
          alphaTest: source.alphaTest, side: source.side,
        });
        materials.push(material);
        return material;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(material => toon(material as MeshStandardMaterial))
        : toon(node.material as MeshStandardMaterial);
      node.castShadow = true;
      node.receiveShadow = false;
      node.frustumCulled = false;
      node.raycast = noRaycast;
      meshes.push(node);
    });
    model.updateMatrixWorld(true);
    // Bone positions include any transforms exported on the model root.
    let foot: Object3D | undefined;
    let toes: Object3D | undefined;
    model.traverse(node => {
      if (/^(LeftFoot|foot_l|l_foot)$/i.test(node.name)) foot = node;
      if (/^(LeftToeBase|ball_l|toe_l|l_toe)$/i.test(node.name)) toes = node;
    });
    const forward = foot && toes
      ? toes.getWorldPosition(new Vector3()).sub(foot.getWorldPosition(new Vector3())) : null;
    const measuredYaw = forward && Math.hypot(forward.x, forward.z) > 1e-6
      ? -Math.atan2(forward.x, forward.z) : 0;
    const yawOffset = settings.yawOffset === 'auto' ? measuredYaw : (settings.yawOffset ?? measuredYaw);
    const box = new Box3().setFromObject(model, true);
    const hitSize = box.getSize(new Vector3());
    // Padding also catches the outline and small sway movements.
    hitSize.add(new Vector3(.12, .04, .12));
    const hitCenter = box.getCenter(new Vector3()).applyAxisAngle(new Vector3(0, 1, 0), yawOffset);
    return { model, meshes, materials, hitSize, hitCenter, yawOffset };
  }, [scene, ramp, settings]);

  useEffect(() => () => {
    // Geometry and maps belong to useGLTF's cache; only materials are local.
    materials.forEach(material => material.dispose());
  }, [materials]);

  useEffect(() => {
    const abort = new AbortController();
    let current: Playback | null = null;
    const entries = Object.entries(selected.clips);
    void Promise.all(entries.map(async ([role, file]) => [role, await loadClip(file)] as const)).then(loaded => {
      const clips = Object.fromEntries(loaded) as Partial<Record<keyof typeof selected.clips, AnimationClip>>;
      const idleClip = clips.idle;
      const waveClip = clips.wave;
      const sitClip = clips['sit-stand'];
      const walkClip = selected.walkEnabled === false ? undefined : clips.walk;
      const walkModelClip = isGingham ? clips['walk-model'] : undefined;
      // Preserve Rosa's cuts by default; other outfits may use the full clip.
      const sitTiming = selected.sitTiming ?? { start: .6, seated: 2.2, riseSearch: [4.4, 4.5], riseEnd: 5.2 };
      const sitDuration = sitClip?.duration ?? 0;
      const sitStart = Math.min(sitTiming.start, sitDuration);
      const sitEnd = Math.min(sitTiming.seated, sitDuration);
      const riseEnd = Math.min(sitTiming.riseEnd ?? sitDuration, sitDuration);
      const restClip = idleClip ?? loaded[0]?.[1] ?? new AnimationClip('rest', 0, []);
      if (abort.signal.aborted) return;
      const hip = (sitClip ?? restClip).tracks.find(track => track.name === selected.hip + '.position');
      const hipAt = (time: number) => {
        if (!hip) return model.getObjectByName(selected.hip)?.position.y ?? 0;
        const { times, values } = hip;
        for (let i = 1; i < times.length; i++) {
          if (time <= times[i]) {
            const mix = Math.max(0, (time - times[i - 1]) / (times[i] - times[i - 1]));
            return values[(i - 1) * 3 + 1] * (1 - mix) + values[i * 3 + 1] * mix;
          }
        }
        return values[(times.length - 1) * 3 + 1];
      };
      const standingHip = hipAt(0);
      const seatedHip = sitClip ? hipAt(sitEnd) : standingHip;
      // Match the frozen hip height within this outfit's rising segment.
      let low = Math.min(sitTiming.riseSearch[0], sitDuration);
      let high = Math.min(sitTiming.riseSearch[1], sitDuration);
      for (let i = 0; i < 20; i++) {
        const middle = (low + high) / 2;
        if (hipAt(middle) < seatedHip) low = middle;
        else high = middle;
      }
      const riseStart = (low + high) / 2;
      // Match Spine/Neck/Head case-insensitively, including numbered rig names.
      // Correct the first joint in each chain so the pitch is not multiplied.
      const seatedBones = ([['spine', 'spinePitch'], ['neck', 'neckPitch'], ['head', 'headPitch']] as const)
        .flatMap(([name, pitch]) => {
          let bone: Bone | undefined;
          const pattern = new RegExp(name + '(?:_?\\d+)?$', 'i');
          model.traverse(node => {
            if (!bone && (node as Bone).isBone && pattern.test(node.name)) bone = node as Bone;
          });
          return bone ? [{ bone, pitch, base: bone.quaternion.clone() }] : [];
        });
      // The seated clip splays the thighs in a V, so one leg can cut through the
      // sofa. Find the two thighs as the pelvis children that are not the spine and
      // swing them towards the body's midline around the model's vertical axis.
      // That frame is independent of the rig's local bone axes (the model faces +Z).
      let pelvis: Bone | undefined;
      model.traverse(node => {
        if (!pelvis && (node as Bone).isBone && /pelvis|hips?$/i.test(node.name)) pelvis = node as Bone;
      });
      model.updateMatrixWorld(true);
      const seatedLegs = (pelvis?.children ?? [])
        .filter((node): node is Bone => (node as Bone).isBone && !/spine|chest|torso/i.test(node.name))
        .map(bone => ({
          bone,
          // Which side of the body the thigh is on, from the rest pose (+1 or -1).
          side: Math.sign(model.worldToLocal(bone.getWorldPosition(new Vector3())).x),
          base: bone.quaternion.clone(),
        }));
      if (sitClip && (seatedLegs.length !== 2 || seatedLegs[0].side === 0 || seatedLegs[0].side === seatedLegs[1].side)) {
        console.warn('Mikako: no se encontraron los dos muslos para corregir las piernas al sentarse.',
          pelvis?.children.map(node => node.name));
        seatedLegs.length = 0;
      }
      const upAxis = new Vector3(0, 1, 0);
      const parentQ = new Quaternion();
      const swingQ = new Quaternion();
      const correctSeatedLegs = (weight: number) => {
        for (const leg of seatedLegs) {
          leg.base.copy(leg.bone.quaternion);
          // Orientation of the thigh's parent in the model's frame.
          parentQ.identity();
          for (let node: Object3D | null = leg.bone.parent; node && node !== model; node = node.parent) {
            parentQ.premultiply(node.quaternion);
          }
          // Positive legSpread brings the legs together. local' = parent^-1 * swing * parent * local.
          swingQ.setFromAxisAngle(upAxis, -leg.side * MathUtils.degToRad(room3d.mikako.legSpread) * weight);
          leg.bone.quaternion.premultiply(parentQ).premultiply(swingQ).premultiply(parentQ.invert());
        }
      };
      let seatedCorrectionApplied = false;
      const restoreSeatedPose = () => {
        if (!seatedCorrectionApplied) return;
        seatedCorrectionApplied = false;
        for (const { bone, base } of seatedBones) bone.quaternion.copy(base);
        for (const { bone, base } of seatedLegs) bone.quaternion.copy(base);
      };
      const correctSeatedPose = (weight: number) => {
        seatedCorrectionApplied = true;
        for (const { bone, pitch, base } of seatedBones) {
          base.copy(bone.quaternion);
          bone.rotateX(MathUtils.degToRad(room3d.mikako[pitch]) * weight);
        }
        correctSeatedLegs(weight);
      };
      // Un apoyo opcional no debe impedir registrar caminar y las demás acciones.
      let reclineClip: AnimationClip | null = null;
      try {
        reclineClip = couchBounds
          ? createReclineClip(model, sitClip ?? restClip, selected.hip, settings.scale, yawOffset, couchBounds, { start: sitStart, end: sitEnd, home: settings.position }) : null;
      } catch (error) {
        console.warn('[DBG-ROOM] recostarse no disponible:', error instanceof Error ? error.message : String(error));
      }
      const turntablePress = createTurntablePress(model, restClip, settings.scale, yawOffset);
      let chairFailed = false;
      const prepareChairClip = (reversed = false): AnimationClip | null => {
        try {
          const clip = createDeskChairClip(model, restClip, selected.hip, settings.scale, yawOffset, true, reversed);
          if (clip) return clip;
        } catch (error) {
          console.warn('[DBG-ROOM] silla de escritorio no disponible:', error instanceof Error ? error.message : String(error));
        }
        chairFailed = true;
        chairReady.current?.(null);
        return null;
      };
      let chairClip: AnimationClip | null = null;
      const mixer = new AnimationMixer(model);
      // Separate actions allow blending between two times of the same clip.
      const actions: Partial<Record<Motion, AnimationAction>> & { idle: AnimationAction } = {
        idle: mixer.clipAction(idleClip ?? restClip.clone()),
        press: mixer.clipAction(turntablePress.clip),
        ...(waveClip ? { wave: mixer.clipAction(waveClip) } : {}),
        ...(reclineClip ? { recline: mixer.clipAction(reclineClip), unrecline: mixer.clipAction(reclineClip.clone()).setEffectiveTimeScale(-1) } : {}),
        ...(sitClip ? { sit: mixer.clipAction(sitClip), rise: mixer.clipAction(sitClip.clone()) } : {}),
        ...(walkClip ? { walk: mixer.clipAction(walkClip) } : {}),
        ...(isGingham && walkClip ? { 'walk-repeat': mixer.clipAction(walkClip.clone()) } : {}),
        ...(walkModelClip ? {
          'walk-model': mixer.clipAction(walkModelClip),
          'walk-model-repeat': mixer.clipAction(walkModelClip.clone()),
        } : {}),
        ...(clips.dance ? { dance: mixer.clipAction(clips.dance) } : {}),
        ...(clips.stretch ? { stretch: mixer.clipAction(clips.stretch) } : {}),
      };
      const actionFor = (name: Motion) => actions[name] ?? actions.idle;
      const names = Object.keys(actions) as Motion[];
      for (const name of names) {
        actionFor(name).setLoop(name === 'idle' || name === 'walk' && !isGingham || name === 'dance' ? LoopRepeat : LoopOnce, Infinity);
        actionFor(name).clampWhenFinished = true;
        actionFor(name).setEffectiveWeight(0);
      }
      const footSupport = (() => {
        const fix = selected.footFix;
        const hips = fix && model.getObjectByName(selected.hip);
        if (!fix || !hips || !hips.parent) return null;
        const hipsParent = hips.parent;
        const anklePosition = new Vector3();
        const toePosition = new Vector3();
        const lateral = new Vector3(-1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), -yawOffset);
        const worldLateral = new Vector3();
        const modelRotation = new Quaternion();
        const parentRotation = new Quaternion();
        const correction = new Quaternion();
        model.updateWorldMatrix(true, true);
        const feet = fix.pairs.flatMap(pair => {
          const foot = model.getObjectByName(pair.foot);
          const toe = model.getObjectByName(pair.toe);
          if (!foot || !foot.parent || !toe) return [];
          model.worldToLocal(foot.getWorldPosition(anklePosition));
          model.worldToLocal(toe.getWorldPosition(toePosition));
          const ankleHeight = anklePosition.y;
          const toeHeight = toePosition.y;
          toePosition.sub(anklePosition);
          if (ankleHeight <= 0) return [];
          return [{ foot, toe, parent: foot.parent, ankleHeight, toeHeight,
            pitch: Math.atan2(toePosition.y, Math.hypot(toePosition.x, toePosition.z)),
            base: foot.quaternion.clone() }];
        });
        if (feet.length !== fix.pairs.length || feet.length === 0) return null;
        let applied = false;
        let hipBaseY = 0;
        let hipOffset = 0;
        return {
          restore: () => {
            if (!applied) return;
            for (const { foot, base } of feet) foot.quaternion.copy(base);
            hips.position.y = hipBaseY;
            applied = false;
          },
          reset: () => { hipOffset = 0; },
          correct: () => {
            // Model coordinates remove scene scale and placement from all heights.
            model.updateWorldMatrix(true, true);
            model.getWorldQuaternion(modelRotation);
            worldLateral.copy(lateral).applyQuaternion(modelRotation).normalize();
            let groundGap = Infinity;
            for (const entry of feet) {
              const { foot, toe, parent, ankleHeight, toeHeight, pitch, base } = entry;
              base.copy(foot.quaternion);
              model.worldToLocal(foot.getWorldPosition(anklePosition));
              model.worldToLocal(toe.getWorldPosition(toePosition));
              const weight = 1 - MathUtils.smoothstep(anklePosition.y / ankleHeight, fix.stanceMax, fix.stanceFade);
              toePosition.sub(anklePosition);
              const currentPitch = Math.atan2(toePosition.y, Math.hypot(toePosition.x, toePosition.z));
              if (weight > 0) {
                correction.setFromAxisAngle(worldLateral, (pitch - currentPitch) * weight * fix.strength);
                parent.getWorldQuaternion(parentRotation);
                // local' = parent^-1 * worldCorrection * parent * local.
                foot.quaternion.premultiply(parentRotation).premultiply(correction).premultiply(parentRotation.invert());
              }
              // Propagate the corrected foot rotation before reading its ToeBase.
              foot.updateWorldMatrix(true, true);
              model.worldToLocal(toe.getWorldPosition(toePosition));
              groundGap = Math.min(groundGap, toePosition.y - toeHeight);
            }
            // The lowest toe determines support; positive clearance lowers Hips.
            hipOffset = MathUtils.lerp(hipOffset, MathUtils.clamp(-groundGap, -.06, .06), .2);
            hipBaseY = hips.position.y;
            model.worldToLocal(hips.getWorldPosition(anklePosition));
            anklePosition.y += hipOffset;
            hipsParent.worldToLocal(model.localToWorld(anklePosition));
            hips.position.y = anklePosition.y;
            applied = true;
            model.updateWorldMatrix(true, true);
          },
        };
      })();
      const home: FloorPoint = [settings.position[0], settings.position[2]];
      const position: FloorPoint = [...home];
      let yaw = room3d.mikako.rotation[1];
      let route: FloorPoint[] = [];
      let routePurpose: 'manual' | 'sofa' | 'chair' = 'manual';
      let chairRequested = false;
      let arrival: WalkDestination | null = null;
      let pendingWalk: WalkDestination | null = null;
      let pressInteraction: WalkDestination['press'] | null = null;
      let contactFired = false;
      const cancelPress = () => {
        const interaction = pressInteraction;
        pressInteraction = null;
        interaction?.onCancel();
      };
      const arrive = () => {
        const destination = arrival;
        arrival = null;
        if (destination?.facing && !destination.press) {
          yaw = Math.atan2(destination.facing[0] - position[0], destination.facing[1] - position[1]);
        }
        return destination?.press ? () => {
          if (pressInteraction !== destination.press) return;
          bow = 1;
          transition('press', 0);
        } : destination?.onArrive;
      };
      let seatRequested = !!sitClip && latest.current.playing;
      let lastOccupied: boolean | undefined;
      const requestedSeat = (): 'sit' | 'recline' => latest.current.couchRequest?.pose === 'recline' && reclineClip ? 'recline' : 'sit';
      let waveRequested = false;
      let stretchRequested = false;
      const restingMotion = (): Motion => latest.current.playing && clips.dance && (isGingham || !sitClip) ? 'dance' : 'idle';
      let motion: Motion = 'idle';
      let blend: { elapsed: number; weights: Record<Motion, number> } | null = null;
      let bow = 1;
      let initialized = false;
      let previous = { ...latest.current };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastFrame = performance.now();
      const running = () => latest.current.active && (!latest.current.reduced || motion === 'press' || motion === 'desk-sit' || motion === 'desk-rise') &&
        (bow < 1 || blend !== null || !actionFor(motion).paused);
      const cancelFrame = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
      const schedule = () => {
        if (!running() || timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (running()) invalidate();
        }, Math.max(0, frameInterval - (performance.now() - lastFrame)));
      };
      const place = () => {
        let hipY = standingHip;
        if (sitClip) for (const name of ['sit', 'rise'] as const) {
          hipY += (hipAt(actionFor(name).time) - standingHip) * actionFor(name).getEffectiveWeight();
        }
        const w = sitClip && standingHip !== seatedHip
          ? Math.max(0, Math.min(1, (standingHip - hipY) / (standingHip - seatedHip))) : 0;
        const couchAction = reclineClip && (motion === 'recline' || motion === 'unrecline') ? actionFor(motion) : null;
        const couchProgress = couchAction ? couchAction.time / reclineClip!.duration : 0;
        const chairAction = motion === 'desk-sit' || motion === 'desk-rise' ? actionFor(motion) : null;
        if (sitClip && !couchAction && !chairAction) correctSeatedPose(MathUtils.smoothstep(w, 0, 1));
        if (placement.current) {
          placement.current.position.set(
            position[0] - settings.sitBack * w,
            settings.position[1] + settings.sitLift * w,
            position[1],
          );
          placement.current.rotation.y = yaw +
            Math.atan2(Math.sin(room3d.mikako.sitYaw - yaw), Math.cos(room3d.mikako.sitYaw - yaw)) * w;
        }
        if (collider.current) {
          collider.current.position.set(hitCenter.x, hitCenter.y - .2 * w, hitCenter.z + .16 * w);
          collider.current.scale.set(1, 1 - .22 * w, 1 + .65 * w);
        }
        if (placement.current && couchAction) {
          placement.current.position.copy(couchRootPosition(couchProgress, settings.position));
          // El giro termina durante la aproximación; tumbarse solo mueve huesos.
          placement.current.rotation.y = room3d.mikako.sitYaw;
        }
        if (placement.current && chairAction && chairClip) {
          placement.current.position.copy(chairRoot(chairAction.time / chairClip.duration, motion === 'desk-rise'));
          placement.current.rotation.y = DESK_CHAIR.facingYaw;
        }
        if (chairGroup?.current) chairGroup.current.position.z = CHAIR_POSITION[2] +
          (chairAction && chairClip ? chairSlide(chairAction.time / chairClip.duration, motion === 'desk-rise') : 0);
        const occupied = seatRequested || motion === 'sit' || motion === 'rise' || motion === 'recline' || motion === 'unrecline';
        if (collider.current) collider.current.raycast = occupied || chairAction ? noRaycast : Mesh.prototype.raycast;
        if (occupied !== lastOccupied) { lastOccupied = occupied; latest.current.onCouchOccupied?.(occupied); }
        if (greetingGroup.current) greetingGroup.current.rotation.x = bow < 1 ? Math.sin(bow * Math.PI) * .035 : 0;
        model.updateMatrixWorld(true);
      };
      const snap = () => {
        const preserveChair = motion === 'desk-sit' || motion === 'desk-rise';
        const chairTime = preserveChair ? actionFor(motion).time : 0;
        restoreSeatedPose();
        footSupport?.restore();
        footSupport?.reset();
        mixer.stopAllAction();
        for (const name of names) actionFor(name).setEffectiveWeight(0);
        route = [];
        arrival = null;
        waveRequested = false;
        stretchRequested = false;
        if (seatRequested) { position[0] = home[0]; position[1] = home[1]; yaw = room3d.mikako.rotation[1]; }
        motion = seatRequested && (latest.current.couchRequest || !latest.current.reduced) ? requestedSeat() : !latest.current.reduced ? restingMotion() : 'idle';
        if (preserveChair) motion = chairRequested ? 'desk-sit' : 'desk-rise';
        if (motion === 'recline') {
          const approach = couchApproachPosition(settings.position);
          position[0] = approach.x; position[1] = approach.z;
          yaw = room3d.mikako.sitYaw;
        }
        const action = actionFor(motion);
        action.reset().setEffectiveWeight(1).play();
        action.time = motion === 'sit' ? sitEnd : motion === 'recline' ? reclineClip!.duration : 0;
        if (preserveChair) action.time = chairTime;
        if (motion === 'desk-rise') action.setEffectiveTimeScale(-1);
        action.paused = motion === 'sit' || motion === 'recline' || motion === 'idle' && !idleClip || latest.current.reduced || !latest.current.active;
        blend = null;
        bow = 1;
        mixer.update(0);
        place();
      };
      const transition = (next: Motion, time: number) => {
        // Preparar antes de detener acciones: si falla, volver a reposo sin bloquear el movimiento.
        if (next === 'desk-sit' && !chairClip && !chairFailed) {
          chairClip = prepareChairClip();
          if (chairClip) {
            actions['desk-sit'] = mixer.clipAction(chairClip);
            actions['desk-rise'] = mixer.clipAction(prepareChairClip(true) ?? chairClip.clone()).setEffectiveTimeScale(-1);
            for (const name of ['desk-sit', 'desk-rise'] as const) {
              names.push(name);
              actionFor(name).setLoop(LoopOnce, Infinity).setEffectiveWeight(0);
              actionFor(name).clampWhenFinished = true;
            }
          }
        }
        if (next === 'desk-sit' && !chairClip) {
          chairRequested = false;
          next = 'idle';
          time = 0;
          if (chairGroup?.current) chairGroup.current.position.z = CHAIR_POSITION[2];
        }
        const wasRunning = running();
        const reversingCouch = (motion === 'recline' && next === 'unrecline') ||
          (motion === 'unrecline' && next === 'recline');
        const reversingChair = motion === 'desk-sit' && next === 'desk-rise';
        if (reversingChair) time = actionFor(motion).time;
        if (reversingCouch) time = actionFor(motion).time;
        const weights = Object.fromEntries(names.map(name => [name, actionFor(name).getEffectiveWeight()])) as Record<Motion, number>;
        if (next === 'recline' && !reversingCouch && couchBounds) {
          // Capturar la pose visible integra la llegada en el mismo reloj;
          // no se mezcla una caminata que siga moviendo los pies por separado.
          if (reclineClip) {
            actionFor('recline').stop(); actionFor('unrecline').stop();
            mixer.uncacheAction(reclineClip);
            mixer.uncacheAction(actionFor('unrecline').getClip());
          }
          reclineClip = createReclineClip(model, sitClip ?? restClip, selected.hip,
            settings.scale, yawOffset, couchBounds,
            { start: sitStart, end: sitEnd, home: settings.position, fromCurrentPose: true });
          actions.recline = mixer.clipAction(reclineClip);
          actions.unrecline = mixer.clipAction(reclineClip.clone()).setEffectiveTimeScale(-1);
          for (const name of ['recline', 'unrecline'] as const) {
            actionFor(name).setLoop(LoopOnce, Infinity);
            actionFor(name).clampWhenFinished = true;
            actionFor(name).setEffectiveWeight(0);
          }
        }
        if (next !== 'desk-sit' && next !== 'desk-rise' && chairGroup?.current)
          chairGroup.current.position.z = CHAIR_POSITION[2];
        motion = next;
        actionFor(next).reset().setEffectiveWeight(weights[next]).play();
        if (next === 'desk-rise') actionFor(next).setEffectiveTimeScale(-1);
        actionFor(next).time = time;
        actionFor(next).paused = next === 'idle' && !idleClip;
        // Entrada e inversión pertenecen al clip: no llevan un fundido paralelo.
        if (reversingCouch || next === 'recline' || next === 'desk-sit' || reversingChair) {
          for (const name of names) if (name !== next) actionFor(name).stop().setEffectiveWeight(0);
          actionFor(next).setEffectiveWeight(1);
          blend = null;
        } else blend = { elapsed: 0, weights };
        if (!wasRunning) lastFrame = performance.now();
        schedule();
      };
      const decide = () => {
        // Finish each crossfade before reusing an action that may still be fading out.
        if (blend) return;
        if (motion === 'desk-sit') {
          if (!chairRequested) transition('desk-rise', actionFor('desk-sit').time);
          return;
        }
        if (motion === 'desk-rise') {
          if (!actionFor('desk-rise').paused) return;
          const entry = chairEntry(); position[0] = entry[0]; position[1] = entry[2];
          if (pendingWalk) {
            const destination = pendingWalk; pendingWalk = null;
            transition(restingMotion(), 0); walkTo(destination); return;
          }
          transition(restingMotion(), 0); return;
        }
        if (motion === 'press') {
          if (!actionFor('press').paused) return;
          const interaction = pressInteraction;
          pressInteraction = null;
          transition(restingMotion(), 0);
          if (latest.current.reduced) snap();
          interaction?.onFinish();
          return;
        }
        if (arrival?.press && route.length === 0 && isWalking(motion)) return;
        if ((motion === 'rise' || motion === 'unrecline') && actionFor(motion).paused && pendingWalk) {
          const destination = pendingWalk;
          pendingWalk = null;
          walkTo(destination);
          return;
        }
        if (motion === 'recline') {
          if (!seatRequested) transition('unrecline', reclineClip!.duration);
          return;
        }
        if (motion === 'unrecline' && !actionFor('unrecline').paused) return;
        if (motion === 'sit') {
          if (!seatRequested) transition('rise', riseStart);
          return;
        }
        if (motion === 'rise' && !actionFor('rise').paused) return;
        if (chairRequested && !chairFailed && route.length === 0) {
          const turn = Math.atan2(Math.sin(DESK_CHAIR.facingYaw - yaw), Math.cos(DESK_CHAIR.facingYaw - yaw));
          if (Math.abs(turn) > DESK_CHAIR.facingTolerance && walkClip && !latest.current.reduced) {
            if (!isWalking(motion) || actionFor(motion).paused) transition('walk', 0);
            return;
          }
          yaw = DESK_CHAIR.facingYaw; transition('desk-sit', 0);
          if (latest.current.reduced && chairClip) { actionFor('desk-sit').time = chairClip.duration; actionFor('desk-sit').paused = true; mixer.update(0); place(); }
          return;
        }
        if (waveRequested && !seatRequested) {
          waveRequested = false;
          if (waveClip || clips.stretch) transition(waveClip ? 'wave' : 'stretch', 0);
          else { bow = 0; lastFrame = performance.now(); schedule(); }
          return;
        }
        if (stretchRequested && !seatRequested && route.length === 0) {
          stretchRequested = false;
          transition('stretch', 0);
          return;
        }
        if (seatRequested && route.length === 0) {
          const approach = requestedSeat() === 'recline' ? couchApproachPosition(settings.position) : null;
          const path = walkingPath(position, approach ? [approach.x, approach.z] : home);
          if (path === null) { seatRequested = false; }
          else if (path.length) { route = path; routePurpose = 'sofa'; }
          else {
            if (requestedSeat() === 'recline') {
              const turn = Math.atan2(Math.sin(room3d.mikako.sitYaw - yaw), Math.cos(room3d.mikako.sitYaw - yaw));
              if (Math.abs(turn) > .005 && walkClip) {
                if (!isWalking(motion) || actionFor(motion).paused) transition('walk', 0);
                return;
              }
              yaw = room3d.mikako.sitYaw;
            }
            transition(requestedSeat(), requestedSeat() === 'sit' ? sitStart : 0); return;
          }
        }
        const rest = restingMotion();
        if (route.length && walkClip) {
          const elegant = latest.current.playing && !!walkModelClip;
          const walking: WalkMotion = elegant ? 'walk-model' : 'walk';
          if (!isWalking(motion) || motion.startsWith('walk-model') !== elegant) {
            transition(walking, 0);
          } else if (isGingham) {
            // Crossfade into a second action before the non-looping export ends.
            const clip = elegant ? walkModelClip! : walkClip;
            const overlap = Math.min(fadeDuration, clip.duration / 2);
            if (actionFor(motion).time >= clip.duration - overlap) {
              const repeat: WalkMotion = elegant ? 'walk-model-repeat' : 'walk-repeat';
              transition(motion === walking ? repeat : walking, 0);
            }
          }
        } else if (isWalking(motion) || motion === 'rise' || motion === 'unrecline' ||
          motion === 'wave' && actionFor('wave').time >= (waveClip?.duration ?? 0) - fadeDuration ||
          motion === 'stretch' && actionFor('stretch').time >= (clips.stretch?.duration ?? 0) ||
          (motion === 'idle' || motion === 'dance') && motion !== rest) {
          transition(rest, 0);
        }
      };
      const walkTo = (destination: WalkDestination) => {
        // DEBUG-TEMP
        console.info('[DBG-ROOM] walkTo ejecutado', { desde: [...position], hasta: destination.point, active: latest.current.active });
        if (!latest.current.active) { destination.press ? cancelPress() : destination.onArrive?.(); return; }
        const { point } = destination;
        const path = walkingPath(position, point);
        // DEBUG-TEMP
        console.info('[DBG-ROOM] ruta', path);
        if (path === null) { destination.press ? cancelPress() : destination.onArrive?.(); return; }
        arrival = destination;
        seatRequested = false;
        waveRequested = false;
        stretchRequested = false;
        route = path;
        routePurpose = 'manual';
        if (latest.current.reduced || !walkClip || path.length === 0) {
          if (path.length) yaw = Math.atan2(point[0] - position[0], point[1] - position[1]);
          position[0] = point[0]; position[1] = point[1];
          if (destination.press && destination.facing) yaw = Math.atan2(destination.facing[0] - point[0], destination.facing[1] - point[1]);
          const complete = arrive();
          snap();
          invalidate();
          complete?.();
        } else {
          decide();
          schedule();
        }
      };
      current = {
        chair: () => {
          if (chairFailed || !latest.current.active || chairRequested || seatRequested || route.length || blend ||
            motion !== 'idle' && motion !== 'dance') return;
          const entry = chairEntry();
          const path = walkingPath(position, [entry[0], entry[2]]);
          if (path === null) return;
          cancelPress(); arrival = null; pendingWalk = null;
          waveRequested = false; stretchRequested = false;
          chairRequested = true; seatRequested = false; routePurpose = 'chair'; route = path;
          if (latest.current.reduced || !walkClip) {
            position[0] = entry[0]; position[1] = entry[2]; route = []; yaw = DESK_CHAIR.facingYaw;
          }
          decide(); schedule(); invalidate();
        },
        sync: () => {
          cancelFrame();
          const next = latest.current;
          if (chairRequested || motion === 'desk-sit' || motion === 'desk-rise') {
            if (next.couchRequest !== previous.couchRequest && next.couchRequest?.pose !== 'stand') {
              chairRequested = false; seatRequested = true;
            }
            if (!next.active) cancelFrame();
            previous = { ...next }; decide(); schedule(); return;
          }
          if (pressInteraction && (!next.active || next.reduced !== previous.reduced || next.couchRequest !== previous.couchRequest)) cancelPress();
          if (motion === 'press' && pressInteraction) {
            previous = { ...next };
            schedule();
            return;
          }
          if (!initialized || next.reduced || !next.active || previous.reduced || !previous.active) {
            const animateSeat = !next.couchRequest && isGingham && !initialized && next.active && !next.reduced && !!sitClip && next.playing;
            seatRequested = next.couchRequest ? next.couchRequest.pose !== 'stand' : !!sitClip && next.playing && !animateSeat;
            snap();
            lastFrame = performance.now();
            if (animateSeat) {
              seatRequested = true;
              decide();
            }
            invalidate();
          } else if (next.couchRequest !== previous.couchRequest) {
            seatRequested = next.couchRequest?.pose !== 'stand';
            arrival = null;
            route = [];
            waveRequested = false;
            stretchRequested = false;
            pendingWalk = null;
            decide();
          } else if (!next.couchRequest && next.playing !== previous.playing) {
            seatRequested = !!sitClip && next.playing && !arrival;
            waveRequested = false;
            stretchRequested = isGingham && !next.playing && !!clips.stretch;
            if (!arrival && (next.playing || routePurpose === 'sofa')) route = [];
            decide();
          }
          initialized = true;
          previous = { ...next };
          if (pendingWalk && next.active && motion !== 'sit' && motion !== 'rise' && motion !== 'recline' && motion !== 'unrecline') {
            const destination = pendingWalk;
            pendingWalk = null;
            walkTo(destination);
          }
          schedule();
        },
        greet: (welcome = false) => {
          if (chairRequested || motion === 'desk-sit' || motion === 'desk-rise') return;
          if (pressInteraction) return;
          if (latest.current.reduced || !latest.current.active || motion === 'recline' || motion === 'unrecline') return;
          if (welcome && (motion !== 'idle' || seatRequested || blend !== null || route.length > 0)) return;
          if ((motion === 'idle' || isWalking(motion) || motion === 'dance') && !seatRequested) {
            route = [];
            arrival = null;
            waveRequested = true;
            decide();
          } else if (motion !== 'wave' && motion !== 'stretch') {
            if (!running()) lastFrame = performance.now();
            bow = 0;
          }
          schedule();
        },
        walk: destination => {
          if (motion === 'desk-sit' || motion === 'desk-rise') {
            const entry = chairEntry();
            if (walkingPath([entry[0], entry[2]], destination.point) === null) return;
            pendingWalk = destination; chairRequested = false; seatRequested = false;
            cancelPress(); pressInteraction = destination.press ?? null; contactFired = false;
            if (latest.current.reduced) {
              transition('desk-rise', actionFor(motion).time);
              actionFor('desk-rise').time = 0; actionFor('desk-rise').paused = true;
              mixer.update(0); place();
            }
            decide(); schedule(); invalidate(); return;
          }
          chairRequested = false;
          // Una nueva ruta usa la misma entrada que el probador y cancela la anterior.
          if (motion === 'press' && pressInteraction) return;
          cancelPress();
          pressInteraction = destination.press ?? null;
          contactFired = false;
          if (!latest.current.active) { destination.press ? cancelPress() : destination.onArrive?.(); return; }
          const leavingCouch = motion === 'sit' || motion === 'rise' || motion === 'recline' || motion === 'unrecline';
          if (leavingCouch) {
            if (walkingPath(position, destination.point) === null) { destination.press ? cancelPress() : destination.onArrive?.(); return; }
            pendingWalk = destination;
            seatRequested = false;
            route = [];
            arrival = null;
            waveRequested = false;
            stretchRequested = false;
            if (latest.current.reduced) {
              snap();
              pendingWalk = null;
              walkTo(destination);
            } else {
              decide();
              schedule();
            }
          } else {
            pendingWalk = null;
            walkTo(destination);
          }
        },
        frame: now => {
          if (!running()) return;
          if (now - lastFrame < frameInterval - .5) { schedule(); return; }
          const delta = Math.min((now - lastFrame) / 1000, .1);
          lastFrame = now;
          // Restore before the mixer: unchanged/paused tracks may skip writing bones.
          restoreSeatedPose();
          footSupport?.restore();
          // Clamp before evaluating the mixer, so the held pose is exactly at the cut.
          if (sitClip) for (const name of ['sit', 'rise'] as const) {
            const action = actionFor(name);
            const end = name === 'sit' ? sitEnd : riseEnd;
            if (action.isRunning() && action.time + delta >= end) {
              action.time = end;
              action.paused = true;
            }
          }
          if (reclineClip) for (const name of ['recline', 'unrecline'] as const) {
            const action = actionFor(name);
            const end = name === 'recline' ? reclineClip.duration : 0;
            if (action.isRunning() && (name === 'recline' ? action.time + delta >= end : action.time - delta <= end)) {
              action.time = end;
              action.paused = true;
            }
          }
          if (chairClip) for (const name of ['desk-sit', 'desk-rise'] as const) {
            const action = actionFor(name), end = name === 'desk-sit' ? chairClip.duration : 0;
            if (action.isRunning() && (name === 'desk-sit' ? action.time + delta >= end : action.time - delta <= end)) {
              action.time = end; action.paused = true;
            }
          }
          if (blend) {
            blend.elapsed = Math.min(fadeDuration, blend.elapsed + delta);
            const mix = blend.elapsed / fadeDuration;
            for (const name of names) actionFor(name).setEffectiveWeight(
              blend.weights[name] * (1 - mix) + (name === motion ? mix : 0),
            );
            if (mix === 1) {
              for (const name of names) if (name !== motion) actionFor(name).stop().setEffectiveWeight(0);
              blend = null;
            }
          }
          // Evaluar exactamente el frame de contacto, incluso si un frame llega tarde.
          const pressAction = actionFor('press');
          const contactStep = motion === 'press' && !contactFired &&
            pressAction.time < TURNTABLE_CONTACT_TIME && pressAction.time + delta >= TURNTABLE_CONTACT_TIME;
          mixer.update(contactStep ? TURNTABLE_CONTACT_TIME - pressAction.time : delta);
          if (footSupport) {
            if (names.some(name => isWalking(name) && actionFor(name).getEffectiveWeight() > .5)) footSupport.correct();
            else footSupport.reset();
          }
          if (isWalking(motion) && route.length) {
            const target = route[0];
            const dx = target[0] - position[0];
            const dz = target[1] - position[1];
            const distance = Math.hypot(dx, dz);
            const travel = Math.min(distance, room3d.mikako.walkSpeed * delta * (isGingham
              ? names.reduce((weight, name) => weight + (isWalking(name) ? actionFor(name).getEffectiveWeight() : 0), 0)
              : actionFor('walk').getEffectiveWeight()));
            if (distance > 1e-6) {
              let facing = Math.atan2(dx, dz);
              if (routePurpose === 'sofa' && requestedSeat() === 'recline' && route.length === 1) {
                const turn = couchPhase(COUCH_RECLINE.turnDistance - distance, 0, COUCH_RECLINE.turnDistance);
                facing += Math.atan2(Math.sin(room3d.mikako.sitYaw - facing), Math.cos(room3d.mikako.sitYaw - facing)) * turn;
              }
              if (routePurpose === 'chair' && route.length === 1) {
                const turn = couchPhase(DESK_CHAIR.turnDistance - distance, 0, DESK_CHAIR.turnDistance);
                facing += Math.atan2(Math.sin(DESK_CHAIR.facingYaw - facing), Math.cos(DESK_CHAIR.facingYaw - facing)) * turn;
              }
              if (arrival?.press && arrival.facing && route.length === 1) {
                const finalYaw = Math.atan2(arrival.facing[0] - arrival.point[0], arrival.facing[1] - arrival.point[1]);
                const turn = couchPhase(TURNTABLE_PRESS.turnDistance - distance, 0, TURNTABLE_PRESS.turnDistance);
                facing += Math.atan2(Math.sin(finalYaw - facing), Math.cos(finalYaw - facing)) * turn;
              }
              yaw += Math.atan2(Math.sin(facing - yaw), Math.cos(facing - yaw)) * Math.min(1, delta * 10);
              position[0] += dx / distance * travel;
              position[1] += dz / distance * travel;
            }
            if (distance <= travel + 1e-6) route.shift();
          }
          let oriented = true;
          if (arrival?.press && arrival.facing && route.length === 0) {
            const finalYaw = Math.atan2(arrival.facing[0] - position[0], arrival.facing[1] - position[1]);
            const turn = Math.atan2(Math.sin(finalYaw - yaw), Math.cos(finalYaw - yaw));
            yaw += turn * Math.min(1, delta * TURNTABLE_PRESS.turnSpeed);
            oriented = Math.abs(turn) <= MathUtils.degToRad(TURNTABLE_PRESS.facingToleranceDegrees);
          }
          if (isWalking(motion) && seatRequested && requestedSeat() === 'recline' && route.length === 0) {
            yaw += Math.atan2(Math.sin(room3d.mikako.sitYaw - yaw), Math.cos(room3d.mikako.sitYaw - yaw)) *
              Math.min(1, delta * COUCH_RECLINE.turnSpeed);
          }
          if (isWalking(motion) && chairRequested && route.length === 0) {
            yaw += Math.atan2(Math.sin(DESK_CHAIR.facingYaw - yaw), Math.cos(DESK_CHAIR.facingYaw - yaw)) *
              Math.min(1, delta * DESK_CHAIR.turnSpeed);
          }
          bow = Math.min(1, bow + delta / .65);
          const complete = arrival && route.length === 0 && oriented && isWalking(motion) ? arrive() : undefined;
          place();
          if (contactStep && pressInteraction) {
            contactFired = true;
            pressInteraction.onContact();
          }
          decide();
          complete?.();
          schedule();
        },
        dispose: () => {
          cancelPress();
          turntableReady.current?.(null);
          chairReady.current?.(null);
          if (chairGroup?.current) chairGroup.current.position.z = CHAIR_POSITION[2];
          cancelFrame();
          restoreSeatedPose();
          footSupport?.restore();
          mixer.stopAllAction();
          mixer.uncacheRoot(model);
        },
      };
      // DEBUG-TEMP: registrar inicio/fin de cada petición y cambios de estado reales en los frames.
      let debugPreviousFlags = '';
      const debugFlags = (phase: string, changedOnly = false) => {
        const flags = {
          ocupado: chairRequested || seatRequested || !!pressInteraction || !!pendingWalk || !!blend ||
            route.length > 0 || motion !== 'idle' && motion !== 'dance',
          sentada: (motion === 'sit' || motion === 'recline' || motion === 'desk-sit') && actionFor(motion).paused,
          moviendo: isWalking(motion) && route.length > 0,
          chairRequested, seatRequested, motion, active: latest.current.active,
        };
        const signature = JSON.stringify(flags);
        if (!changedOnly || signature !== debugPreviousFlags) console.info('[DBG-ROOM] interacción ' + phase, flags);
        debugPreviousFlags = signature;
      };
      const debugInteraction = <T extends unknown[]>(name: string, callback: (...args: T) => void) => (...args: T) => {
        debugFlags(name + ' inicio');
        try { callback(...args); }
        catch (error) { console.error('[DBG-ROOM] interacción error ' + name, error); throw error; }
        finally { debugFlags(name + ' fin de petición'); }
      };
      current.chair = debugInteraction('silla', current.chair);
      current.greet = debugInteraction('saludo', current.greet);
      current.walk = debugInteraction('caminar', current.walk);
      current.sync = debugInteraction('sincronizar', current.sync);
      const debugFrame = current.frame;
      current.frame = now => {
        try { debugFrame(now); }
        catch (error) { console.error('[DBG-ROOM] useFrame error', error); throw error; }
        finally { debugFlags('estado/fin', true); }
      };
      playback.current = current;
      chairReady.current?.(current.chair);
      turntableReady.current?.(turntablePress.approach);
      current.sync();
      if (pendingDestination.current) current.walk(pendingDestination.current);
      pendingDestination.current = null;
      if (pendingWelcome.current) {
        pendingWelcome.current = false;
        current.greet(true);
      }
    }).catch(error => {
      // DEBUG-TEMP
      if (!abort.signal.aborted) console.error('[DBG-ROOM] inicialización de Mikako falló; handlers sin registrar', error);
      if (!abort.signal.aborted) console.error('No se pudieron cargar las animaciones de Mikako.', error);
    });
    return () => {
      abort.abort();
      current?.dispose();
      if (playback.current === current) playback.current = null;
    };
  }, [model, invalidate, selected, settings, hitCenter, isGingham, couchBounds, yawOffset, chairGroup]);

  useLayoutEffect(() => {
    // Include the outline children: only the simple collider is interactive.
    model.traverse(node => {
      if (node instanceof Mesh) {
        node.raycast = noRaycast;
        node.frustumCulled = false;
      }
    });
  }, [model, meshes, hover, outlineThickness, palette.highlight, palette.ink]);

  useEffect(() => {
    // DEBUG-TEMP
    console.info('[DBG-ROOM] destino recibido', { destination, playbackRegistrado: !!playback.current });
    if (taps !== lastTaps.current) playback.current?.greet();
    lastTaps.current = taps;
  }, [taps]);

  useEffect(() => {
    if (destination && destination.request === lastDestinationRequest.current) return;
    lastDestinationRequest.current = destination?.request;
    pendingDestination.current = destination;
    if (destination && playback.current) {
      playback.current.walk(destination);
      pendingDestination.current = null;
    }
  }, [destination]);

  useFrame(() => playback.current?.frame(performance.now()));

  return <group ref={placement} position={settings.position} rotation={room3d.mikako.rotation} scale={settings.scale}>
    <group ref={greetingGroup}>
      <group rotation={[0, yawOffset, 0]}><primitive object={model} dispose={null} /></group>
      {meshes.map(mesh => createPortal(
        <Outlines thickness={outlineThickness * (hover ? 1.25 : 1)} screenspace={false}
          angle={room3d.mikako.outline.angle} color={hover ? palette.highlight : palette.ink} />,
        mesh,
      ))}
    </group>
    {/* Events bubble to the existing Action, which also feeds keyboard taps. */}
    <mesh ref={collider} position={hitCenter} rotation={[0, yawOffset, 0]}>
      <boxGeometry args={[hitSize.x, hitSize.y, hitSize.z]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  </group>;
}

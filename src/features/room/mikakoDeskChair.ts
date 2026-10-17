import { AnimationClip, AnimationMixer, Group, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { room3d, type Vec3 } from './room3d.config';
import { couchPhase, solveTwoBone } from './mikakoRecline';

// GLB sin piezas nombradas: fracción de altura usada para estimar el asiento.
export const CHAIR_SEAT_HEIGHT_FRACTION = .42;
const CHAIR_SOURCE_SIZE: Vec3 = [.6184689999, 1.0068531922, .6016012207];
// Altura mundial de calf_l del esqueleto Rosa, de pie (escala 2.6 / 1.8).
const STANDING_KNEE_HEIGHT = .9117738061;
export const CHAIR_UNIFORM_SCALE = STANDING_KNEE_HEIGHT / (CHAIR_SOURCE_SIZE[1] * CHAIR_SEAT_HEIGHT_FRACTION);
export const CHAIR_SCALE: Vec3 = [CHAIR_UNIFORM_SCALE, CHAIR_UNIFORM_SCALE, CHAIR_UNIFORM_SCALE];
// El cajonero está a la derecha; el frente de este GLB apunta a -Z.
export const CHAIR_POSITION: Vec3 = [-1.19, 0, -1.64];
export const CHAIR_ROTATION: Vec3 = [0, 0, 0];
export const DESK_CHAIR_PULL_ENABLED = true;
export const CHAIR_SIZE: Vec3 = CHAIR_SOURCE_SIZE.map(size => size * CHAIR_UNIFORM_SCALE) as Vec3;
export const deskChairConfig = {
  model: 'models/desk_chair', position: CHAIR_POSITION, rotation: CHAIR_ROTATION,
  scale: CHAIR_SCALE, size: CHAIR_SOURCE_SIZE, color: 'surface' as const, preserveTextures: true,
};
export const DESK_CHAIR = {
  duration: 3.6, steps: 144,
  entryEnd: .10, grabStart: 0, grabEnd: .10, pullStart: .08, pullEnd: .34,
  walkStart: .30, walkCorner: .42, walkEnd: .54,
  lowerStart: .52, lowerEnd: .78, rollStart: .76, rollEnd: .96,
  handsStart: .80, handsEnd: .98,
  footStart: .52, footEnd: .78, turnDistance: .65, turnSpeed: 8, facingTolerance: .005,
  minPull: .55, standGap: .60, pullStep: .60,
  // .05 m no deja pasar la cápsula de radio .22; margen adicional de .02 m.
  standForward: .24,
  facingYaw: Math.PI,
  seatHeight: STANDING_KNEE_HEIGHT, pelvisLift: .10,
  pelvisForward: .12, entryForward: .36, entrySide: .90,
  handAboveTop: .035, handFromFront: .025, handSpread: 1.05, handClearance: .14,
  elbowOut: .12, elbowForward: .20, elbowBelowTop: .04,
  footForward: .70, kneeForward: .82,
} as const;
// RoomModel centra X/Z y apoya Y; estas cotas son el bounding box del escritorio.
export function deskSurface() {
  const desk = room3d.objects.desk;
  return { top: desk.position[1] + desk.size[1] * desk.scale[1],
    front: desk.position[2] + desk.size[2] * desk.scale[2] / 2 };
}
const gapRest = CHAIR_POSITION[2] - CHAIR_SIZE[2] / 2 - deskSurface().front;
export const CHAIR_PULL = Math.max(DESK_CHAIR.minPull, DESK_CHAIR.standGap - gapRest);
export const standZ = CHAIR_POSITION[2] + CHAIR_PULL - CHAIR_SIZE[2] / 2 - DESK_CHAIR.standForward;
// Borde del respaldo más próximo a la entrada: fracciones de la caja escalada.
export const CHAIR_GRIP: Vec3 = [CHAIR_SIZE[0] * .5, CHAIR_SIZE[1] * .60, CHAIR_SIZE[2] * .40];
export function chairSlide(progress: number) {
  if (!DESK_CHAIR_PULL_ENABLED) return 0;
  return CHAIR_PULL * couchPhase(progress, DESK_CHAIR.pullStart, DESK_CHAIR.pullEnd) *
    (1 - couchPhase(progress, DESK_CHAIR.rollStart, DESK_CHAIR.rollEnd));
}
export function chairEntry(): Vec3 {
  return [CHAIR_POSITION[0] + DESK_CHAIR.entrySide, 0, CHAIR_POSITION[2] + DESK_CHAIR.entryForward];
}
export function chairRoot(progress: number) {
  const entry = new Vector3(...chairEntry());
  if (!DESK_CHAIR_PULL_ENABLED) return entry.lerp(
    new Vector3(CHAIR_POSITION[0], 0, CHAIR_POSITION[2] - DESK_CHAIR.pelvisForward),
    couchPhase(progress, .10, .78));
  const c = DESK_CHAIR;
  const slide = chairSlide(progress);
  // Dos tramos ortogonales: primero por el costado, después frente al asiento.
  entry.z += slide * c.pullStep;
  entry.z += (standZ - entry.z) * couchPhase(progress, c.walkStart, c.walkCorner);
  entry.x += (CHAIR_POSITION[0] - entry.x) * couchPhase(progress, c.walkCorner, c.walkEnd);
  entry.z += (CHAIR_POSITION[2] + slide - c.pelvisForward - entry.z) *
    couchPhase(progress, c.lowerStart, c.lowerEnd);
  return entry;
}

// Un único clip de huesos, en el mismo formato AnimationClip que el sillón.
// La colocación comparte su reloj; la orientación permanece fija hacia el escritorio.
export function createDeskChairClip(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, fromCurrentPose = false) {
  try {
    return buildDeskChairClip(model, standing, hipName, scale, yawOffset, fromCurrentPose);
  } catch (error) {
    console.warn('Mikako: no se pudo preparar la silla de escritorio.', error);
    return null;
  }
}
function buildDeskChairClip(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, fromCurrentPose: boolean) {
  const c = DESK_CHAIR;
  const rig = clone(model);
  const frame = new Group(); frame.rotation.y = c.facingYaw; frame.scale.set(...scale);
  const facing = new Group(); facing.rotation.y = yawOffset; frame.add(facing); facing.add(rig);
  const bones: Bone[] = []; rig.traverse(node => { if ((node as Bone).isBone) bones.push(node as Bone); });
  const entry = bones.map(bone => ({ q: bone.quaternion.clone(), p: bone.position.clone() }));
  const sampler = new AnimationMixer(rig); sampler.clipAction(standing).play(); sampler.update(0);
  const base = bones.map(bone => ({ q: bone.quaternion.clone(), p: bone.position.clone() }));
  const find = (...names: string[]) => bones.find(bone => names.includes(bone.name));
  const hip = find(hipName);
  if (!hip?.parent) {
    sampler.stopAllAction(); sampler.uncacheRoot(rig);
    const rest = standing.clone(); rest.duration = c.duration;
    return rest;
  }
  const legs = ['l', 'r'].map((side, i) => {
    const prefix = i ? 'Right' : 'Left';
    return [find('thigh_' + side, prefix + 'UpLeg'), find('calf_' + side, prefix + 'Leg'),
      find('foot_' + side, prefix + 'Foot'), find('ball_' + side, prefix + 'ToeBase')];
  }).filter((leg): leg is Bone[] => leg.every((bone): bone is Bone => !!bone));
  const arms = ['l', 'r'].map((side, i) => {
    const prefix = i ? 'Right' : 'Left';
    return [find('upperarm_' + side, prefix + 'Arm'), find('lowerarm_' + side, prefix + 'ForeArm'), find('hand_' + side, prefix + 'Hand')];
  }).filter((arm): arm is Bone[] => arm.every((bone): bone is Bone => !!bone));
  const point = (bone: Object3D) => bone.getWorldPosition(new Vector3());
  const aim = (bone: Bone, child: Bone, direction: Vector3) => {
    if (!bone.parent || direction.lengthSq() < 1e-12 || !direction.toArray().every(Number.isFinite)) return;
    const world = new Quaternion().setFromUnitVectors(point(child).sub(point(bone)).normalize(), direction.clone().normalize())
      .multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    frame.updateMatrixWorld(true);
  };
  frame.position.copy(chairRoot(0)); frame.updateMatrixWorld(true);
  const restingFeet = legs.map(leg => leg.map(point));
  if (fromCurrentPose) {
    bones.forEach((bone, i) => { bone.quaternion.copy(entry[i].q); bone.position.copy(entry[i].p); });
    frame.updateMatrixWorld(true);
  }
  const initialHip = point(hip);
  const initialRoot = chairRoot(0);
  const hipOffset = initialHip.clone().sub(initialRoot);
  const feet = legs.map(leg => leg.map(point));
  const hands = arms.map(arm => point(arm[2]));
  const elbows = arms.map(arm => point(arm[1]));
  const gripAt = (progress: number) => new Vector3(CHAIR_POSITION[0] + CHAIR_GRIP[0],
    CHAIR_POSITION[1] + CHAIR_GRIP[1], CHAIR_POSITION[2] + chairSlide(progress) + CHAIR_GRIP[2]);
  const gripArm = arms.reduce((nearest, arm, i) => nearest < 0 ||
    point(arm[0]).distanceToSquared(gripAt(0)) < point(arms[nearest][0]).distanceToSquared(gripAt(0)) ? i : nearest, -1);
  const surface = deskSurface();
  const times: number[] = [], positions: number[] = [];
  const rotations = bones.map(() => [] as number[]);
  for (let step = 0; step <= c.steps; step++) {
    const progress = step / c.steps;
    const lower = couchPhase(progress, DESK_CHAIR_PULL_ENABLED ? c.lowerStart : .10, c.lowerEnd);
    const reach = couchPhase(progress, c.handsStart, c.handsEnd);
    bones.forEach((bone, i) => {
      const blend = fromCurrentPose ? couchPhase(progress, 0, c.entryEnd) : 1;
      bone.quaternion.copy(entry[i].q).slerp(base[i].q, blend);
      bone.position.copy(entry[i].p).lerp(base[i].p, blend);
    });
    frame.position.copy(chairRoot(progress)); frame.updateMatrixWorld(true);
    const root = chairRoot(progress);
    const chairZ = CHAIR_POSITION[2] + chairSlide(progress);
    const pelvis = DESK_CHAIR_PULL_ENABLED
      ? root.clone().addScaledVector(hipOffset, 1 - lower)
      : initialHip.clone().lerp(new Vector3(CHAIR_POSITION[0], c.seatHeight + c.pelvisLift,
        chairZ - c.pelvisForward), lower);
    pelvis.y = initialHip.y + (c.seatHeight + c.pelvisLift - initialHip.y) * lower;
    hip.position.copy(hip.parent!.worldToLocal(pelvis)); frame.updateMatrixWorld(true);
    legs.forEach((leg, i) => {
      const side = Math.sign(feet[i][0].x - initialHip.x);
      const displacement = DESK_CHAIR_PULL_ENABLED ? root.clone().sub(initialRoot) : new Vector3();
      const target = feet[i][2].clone().add(displacement).lerp(new Vector3(CHAIR_POSITION[0] + side * Math.abs(feet[i][2].x - initialHip.x),
        restingFeet[i][2].y, chairZ - c.footForward), couchPhase(progress, c.footStart, c.footEnd));
      const pole = feet[i][1].clone().add(displacement).lerp(new Vector3(target.x, c.seatHeight,
        chairZ - c.kneeForward), lower);
      solveTwoBone(leg, target, pole, point, aim);
      aim(leg[2], leg[3], feet[i][3].clone().sub(feet[i][2]).lerp(
        restingFeet[i][3].clone().sub(restingFeet[i][2]), couchPhase(progress, c.footStart, c.footEnd)));
    });
    arms.forEach((arm, i) => {
      const shoulder = point(arm[0]);
      if (DESK_CHAIR_PULL_ENABLED && reach === 0) {
        const grab = couchPhase(progress, c.grabStart, c.grabEnd) *
          (1 - couchPhase(progress, c.walkStart, c.walkCorner));
        if (i !== gripArm || grab === 0) return;
        const grip = gripAt(progress);
        const elbow = point(arm[1]), hand = point(arm[2]);
        const upper = shoulder.distanceTo(elbow), lowerArm = elbow.distanceTo(hand);
        const distance = shoulder.distanceTo(grip);
        if (distance > upper + lowerArm || distance < Math.abs(upper - lowerArm)) return;
        solveTwoBone(arm, hand.lerp(grip, grab), elbow, point, aim);
        return;
      }
      const side = Math.sign(shoulder.x - CHAIR_POSITION[0]);
      const target = (DESK_CHAIR_PULL_ENABLED ? point(arm[2]) : hands[i].clone()).lerp(new Vector3(CHAIR_POSITION[0] +
        (shoulder.x - CHAIR_POSITION[0]) * c.handSpread, surface.top + c.handAboveTop, surface.front - c.handFromFront), reach);
      target.y += Math.sin(reach * Math.PI) * c.handClearance;
      solveTwoBone(arm, target, (DESK_CHAIR_PULL_ENABLED ? point(arm[1]) : elbows[i].clone()).lerp(new Vector3(shoulder.x + side * c.elbowOut,
        surface.top - c.elbowBelowTop, CHAIR_POSITION[2] - c.elbowForward), reach), point, aim);
      // Palma horizontal: se conserva la torsión de reposo y se orientan los dedos hacia delante.
      const finger = arm[2].children.find(child => /middle.*01|Middle1/i.test(child.name)) as Bone | undefined;
      if (finger) {
        const initial = arm[2].quaternion.clone();
        aim(arm[2], finger, new Vector3(0, -.08, -1));
        arm[2].quaternion.copy(initial.slerp(arm[2].quaternion, reach));
        frame.updateMatrixWorld(true);
      }
    });
    times.push(progress * c.duration);
    bones.forEach((bone, i) => {
      if (!bone.quaternion.toArray().every(Number.isFinite)) bone.quaternion.copy(base[i].q);
      rotations[i].push(...bone.quaternion.toArray());
    });
    if (!hip.position.toArray().every(Number.isFinite)) hip.position.copy(base[bones.indexOf(hip)].p);
    positions.push(...hip.position.toArray());
  }
  sampler.stopAllAction(); sampler.uncacheRoot(rig);
  return AnimationClip.parse({ name: 'mikako-desk-chair', duration: c.duration,
    uuid: new AnimationClip().uuid, blendMode: standing.blendMode,
    tracks: [...bones.map((bone, i) => ({ name: bone.name + '.quaternion', type: 'quaternion', times, values: rotations[i] })),
      { name: hip.name + '.position', type: 'vector', times, values: positions }] });
}

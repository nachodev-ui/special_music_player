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
export const deskChairConfig = {
  model: 'models/desk_chair', position: CHAIR_POSITION, rotation: CHAIR_ROTATION,
  scale: CHAIR_SCALE, size: CHAIR_SOURCE_SIZE, color: 'surface' as const, preserveTextures: true,
};
export const DESK_CHAIR = {
  duration: 2.8, steps: 112,
  entryEnd: .18, lowerStart: .10, lowerEnd: .78, handsStart: .22, handsEnd: .94,
  footStart: .08, footEnd: .70, turnDistance: .65, turnSpeed: 8, facingTolerance: .005,
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
export function chairEntry(): Vec3 {
  return [CHAIR_POSITION[0] + DESK_CHAIR.entrySide, 0, CHAIR_POSITION[2] + DESK_CHAIR.entryForward];
}
export function chairRoot(progress: number) {
  const entry = new Vector3(...chairEntry());
  return entry.lerp(new Vector3(CHAIR_POSITION[0], 0, CHAIR_POSITION[2] - DESK_CHAIR.pelvisForward),
    couchPhase(progress, DESK_CHAIR.lowerStart, DESK_CHAIR.lowerEnd));
}

// Un único clip de huesos, en el mismo formato AnimationClip que el sillón.
// La colocación comparte su reloj; la orientación permanece fija hacia el escritorio.
export function createDeskChairClip(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, fromCurrentPose = false) {
  const c = DESK_CHAIR;
  const rig = clone(model);
  const frame = new Group(); frame.rotation.y = c.facingYaw; frame.scale.set(...scale);
  const facing = new Group(); facing.rotation.y = yawOffset; frame.add(facing); facing.add(rig);
  const bones: Bone[] = []; rig.traverse(node => { if ((node as Bone).isBone) bones.push(node as Bone); });
  const entry = bones.map(bone => ({ q: bone.quaternion.clone(), p: bone.position.clone() }));
  const sampler = new AnimationMixer(rig); sampler.clipAction(standing).play(); sampler.update(0);
  const base = bones.map(bone => ({ q: bone.quaternion.clone(), p: bone.position.clone() }));
  const find = (...names: string[]) => {
    const bone = bones.find(bone => names.includes(bone.name));
    if (!bone) throw new Error('Mikako: falta el hueso ' + names.join('/'));
    return bone;
  };
  const hip = find(hipName);
  const legs = ['l', 'r'].map((side, i) => {
    const prefix = i ? 'Right' : 'Left';
    return [find('thigh_' + side, prefix + 'UpLeg'), find('calf_' + side, prefix + 'Leg'),
      find('foot_' + side, prefix + 'Foot'), find('ball_' + side, prefix + 'ToeBase')];
  });
  const arms = ['l', 'r'].map((side, i) => {
    const prefix = i ? 'Right' : 'Left';
    return [find('upperarm_' + side, prefix + 'Arm'), find('lowerarm_' + side, prefix + 'ForeArm'), find('hand_' + side, prefix + 'Hand')];
  });
  const point = (bone: Object3D) => bone.getWorldPosition(new Vector3());
  const aim = (bone: Bone, child: Bone, direction: Vector3) => {
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
  const feet = legs.map(leg => leg.map(point));
  const hands = arms.map(arm => point(arm[2]));
  const elbows = arms.map(arm => point(arm[1]));
  const surface = deskSurface();
  const times: number[] = [], positions: number[] = [];
  const rotations = bones.map(() => [] as number[]);
  for (let step = 0; step <= c.steps; step++) {
    const progress = step / c.steps;
    const lower = couchPhase(progress, c.lowerStart, c.lowerEnd);
    const reach = couchPhase(progress, c.handsStart, c.handsEnd);
    bones.forEach((bone, i) => {
      const blend = fromCurrentPose ? couchPhase(progress, 0, c.entryEnd) : 1;
      bone.quaternion.copy(entry[i].q).slerp(base[i].q, blend);
      bone.position.copy(entry[i].p).lerp(base[i].p, blend);
    });
    frame.position.copy(chairRoot(progress)); frame.updateMatrixWorld(true);
    const pelvis = initialHip.clone().lerp(new Vector3(CHAIR_POSITION[0], c.seatHeight + c.pelvisLift,
      CHAIR_POSITION[2] - c.pelvisForward), lower);
    hip.position.copy(hip.parent!.worldToLocal(pelvis)); frame.updateMatrixWorld(true);
    legs.forEach((leg, i) => {
      const side = Math.sign(feet[i][0].x - initialHip.x);
      const target = feet[i][2].clone().lerp(new Vector3(CHAIR_POSITION[0] + side * Math.abs(feet[i][2].x - initialHip.x),
        restingFeet[i][2].y, CHAIR_POSITION[2] - c.footForward), couchPhase(progress, c.footStart, c.footEnd));
      const pole = feet[i][1].clone().lerp(new Vector3(target.x, c.seatHeight,
        CHAIR_POSITION[2] - c.kneeForward), lower);
      solveTwoBone(leg, target, pole, point, aim);
      aim(leg[2], leg[3], feet[i][3].clone().sub(feet[i][2]).lerp(
        restingFeet[i][3].clone().sub(restingFeet[i][2]), couchPhase(progress, c.footStart, c.footEnd)));
    });
    arms.forEach((arm, i) => {
      const shoulder = point(arm[0]);
      const side = Math.sign(shoulder.x - CHAIR_POSITION[0]);
      const target = hands[i].clone().lerp(new Vector3(CHAIR_POSITION[0] +
        (shoulder.x - CHAIR_POSITION[0]) * c.handSpread, surface.top + c.handAboveTop, surface.front - c.handFromFront), reach);
      target.y += Math.sin(reach * Math.PI) * c.handClearance;
      solveTwoBone(arm, target, elbows[i].clone().lerp(new Vector3(shoulder.x + side * c.elbowOut,
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
    bones.forEach((bone, i) => rotations[i].push(...bone.quaternion.toArray()));
    positions.push(...hip.position.toArray());
  }
  sampler.stopAllAction(); sampler.uncacheRoot(rig);
  return AnimationClip.parse({ name: 'mikako-desk-chair', duration: c.duration,
    uuid: new AnimationClip().uuid, blendMode: standing.blendMode,
    tracks: [...bones.map((bone, i) => ({ name: bone.name + '.quaternion', type: 'quaternion', times, values: rotations[i] })),
      { name: hip.name + '.position', type: 'vector', times, values: positions }] });
}

import { AnimationClip, AnimationMixer, Box3, Euler, Group, LinearInterpolant, Matrix4, Quaternion, QuaternionLinearInterpolant, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { melodyCouch, room3d, type Vec3 } from './room3d.config';

// Metros y grados. +X va hacia los pies; -X es la izquierda vista desde la cámara.
export const COUCH_RECLINE = {
  duration: 3.6,
  seatEnd: .40, reclineStart: .30, reclineEnd: .80,
  settleStart: .70, feetLiftStart: .30, feetClear: .55, feetOnSeat: .80,
  entryEnd: .12, turnDistance: .65, turnSpeed: 8, approachClearance: .20,
  footClearance: .18, kneeClearance: .08, armClearance: .18,
  // Muestreo de los apoyos IK; las únicas metas intermedias son sentarse, despejar y apoyar.
  bakeSteps: 360,
  armrestInset: .06, backrestInset: .24, plushClearance: .035,
  pelvisFraction: .25, pelvisLift: .14, frontOffset: .10,
  armrestRise: .261, headLift: .09, neckReach: .96, headTurn: 12,
  thighMin: 45, thighMax: 60, kneeMin: 90, kneeMax: 110, kneeStep: .25,
  ankleLift: .12, toeLift: .035, footFromEnd: .52, frontMargin: .025,
  farFootInset: .24, nearFootInset: .10, legRadius: .045,
  abdomenAlong: .04, abdomenLift: .14,
  relaxedHandAlong: .05, relaxedHandLift: .03, handOverEdge: .01,
  abdomenElbowPole: [0, .1, -1] as Vec3,
  relaxedElbowPole: [1, .2, 1] as Vec3,
} as const;

// Un único reloj normalizado, compartido por el clip y la colocación.
export function couchPhase(progress: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (progress - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

// Solución compartida por los apoyos del sillón y de la silla de escritorio.
export function solveTwoBone(chain: Bone[], target: Vector3, polePoint: Vector3,
  point: (bone: Object3D) => Vector3, aim: (bone: Bone, child: Bone, direction: Vector3) => void) {
  const [upper, lower, end] = chain;
  const origin = point(upper);
  const a = origin.distanceTo(point(lower));
  const b = point(lower).distanceTo(point(end));
  const delta = target.clone().sub(origin);
  const distance = Math.max(Math.abs(a - b) + 1e-7, Math.min(delta.length(), a + b - 1e-7));
  const direction = delta.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const pole = polePoint.clone().sub(origin).projectOnPlane(direction).normalize();
  const joint = origin.clone().addScaledVector(direction, along).addScaledVector(pole, height);
  aim(upper, lower, joint.sub(origin));
  aim(lower, end, target.clone().sub(point(lower)));
}

export function couchApproachPosition(home: Vec3) {
  return new Vector3(...home).add(new Vector3(0, 0, COUCH_RECLINE.approachClearance)
    .applyAxisAngle(new Vector3(0, 1, 0), room3d.mikako.sitYaw));
}

export function couchRootPosition(progress: number, home: Vec3) {
  return couchApproachPosition(home).lerp(new Vector3(...room3d.objects.sofa.position),
    couchPhase(progress, 0, COUCH_RECLINE.seatEnd));
}

type SeatSource = { start: number; end: number; home: Vec3; fromCurrentPose?: boolean };

export type CouchBounds = { seat: Box3; plush: Box3 };
export type CouchRequest = { pose: 'sit' | 'recline' | 'stand'; request: number };

export function measureCouch(bounds: Box3, plushSource: Box3): CouchBounds {
  const sofa = room3d.objects.sofa;
  const plush = room3d.plushies.sofa;
  const transform = (position: Vec3, rotation: Vec3, scale: Vec3) => new Matrix4().compose(
    new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale),
  );
  const centeredPlush = plushSource.clone().translate(new Vector3(
    -plushSource.getCenter(new Vector3()).x, -plushSource.min.y, -plushSource.getCenter(new Vector3()).z,
  ));
  centeredPlush.applyMatrix4(transform(plush.position, plush.rotation, plush.scale))
    .applyMatrix4(transform(sofa.position, sofa.rotation, sofa.scale).invert());
  const seat = bounds.clone();
  seat.min.x += COUCH_RECLINE.armrestInset;
  seat.max.x -= COUCH_RECLINE.armrestInset;
  seat.min.z += COUCH_RECLINE.backrestInset;
  seat.min.y = seat.max.y = melodyCouch.seatHeight;
  return { seat, plush: centeredPlush };
}

// Las rotaciones se obtienen de los vectores padre → hijo y se convierten al
// espacio local del padre. No se presupone que una articulación flexione en X.
export function createReclineClip(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, bounds: CouchBounds, seat: SeatSource): AnimationClip {
  const c = COUCH_RECLINE;
  const rig = clone(model);
  const entryPose = new Map<string, { quaternion: Quaternion; position: Vector3 }>();
  if (seat.fromCurrentPose) rig.traverse(node => {
    if ((node as Bone).isBone) entryPose.set(node.name,
      { quaternion: node.quaternion.clone(), position: node.position.clone() });
  });
  rig.traverse(node => {
    if ((node as SkinnedMesh).isSkinnedMesh) (node as SkinnedMesh).skeleton.pose();
  });
  const frame = new Group();
  const facing = new Group();
  frame.scale.set(...scale);
  facing.rotation.y = yawOffset;
  frame.add(facing);
  facing.add(rig);
  frame.updateMatrixWorld(true);
  const find = (...names: string[]): Bone => {
    const bone = names.map(name => rig.getObjectByName(name)).find(node => (node as Bone | undefined)?.isBone);
    if (!bone) throw new Error('Mikako: falta el hueso ' + names.join('/'));
    return bone as Bone;
  };
  const point = (bone: Object3D) => bone.getWorldPosition(new Vector3());
  const hip = find(hipName);
  const head = find('head', 'Head');
  const legs = [
    [find('thigh_l', 'LeftUpLeg'), find('calf_l', 'LeftLeg'), find('foot_l', 'LeftFoot'), find('ball_l', 'LeftToeBase')],
    [find('thigh_r', 'RightUpLeg'), find('calf_r', 'RightLeg'), find('foot_r', 'RightFoot'), find('ball_r', 'RightToeBase')],
  ];
  const spine: Bone[] = [];
  for (let node = hip.children.find(child => /spine/i.test(child.name)); node && node !== head;
    node = node.children.find(child => /spine|neck|^head$/i.test(child.name))) spine.push(node as Bone);
  const chest = find('spine_05', 'Spine');
  const chestIndex = spine.indexOf(chest);
  const neck = [chest, ...spine.slice(chestIndex + 1), head];
  const forward = () => legs.reduce((sum, leg) => sum.add(point(leg[3]).sub(point(leg[2]))), new Vector3());
  const restUp = point(spine[0]).sub(point(hip)).normalize();
  const inverseHead = head.getWorldQuaternion(new Quaternion()).invert();
  const faceLocal = (head.children.find(child => child.name === 'headfront')?.position.clone()
    ?? forward().projectOnPlane(restUp).normalize().applyQuaternion(inverseHead)).normalize();
  const headUpLocal = restUp.clone().applyQuaternion(inverseHead);
  const sampler = new AnimationMixer(rig);
  sampler.clipAction(standing).play();
  sampler.update(0);
  frame.updateMatrixWorld(true);
  const bones: Bone[] = [];
  rig.traverse(node => { if ((node as Bone).isBone) bones.push(node as Bone); });
  const base = bones.map(bone => ({ bone, quaternion: bone.quaternion.clone(), position: bone.position.clone() }));
  const basis = (up: Vector3, front: Vector3) => {
    const lateral = new Vector3().crossVectors(up, front).normalize();
    const normal = new Vector3().crossVectors(lateral, up).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(lateral, up.clone().normalize(), normal));
  };
  const orient = (bone: Bone, world: Quaternion) => {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    frame.updateMatrixWorld(true);
  };
  const aim = (bone: Bone, child: Bone, direction: Vector3) => {
    const current = point(child).sub(point(bone)).normalize();
    orient(bone, new Quaternion().setFromUnitVectors(current, direction.clone().normalize())
      .multiply(bone.getWorldQuaternion(new Quaternion())));
  };
  const headDirection = new Vector3(-1, 0, 0);
  const referenceUp = point(spine[0]).sub(point(hip)).normalize();
  const referenceFront = forward().projectOnPlane(referenceUp).normalize();
  orient(hip, basis(headDirection, new Vector3(0, 1, 0))
    .multiply(basis(referenceUp, referenceFront).invert()).multiply(hip.getWorldQuaternion(new Quaternion())));
  const pelvis = new Vector3(
    bounds.seat.min.x + bounds.seat.getSize(new Vector3()).x * c.pelvisFraction,
    bounds.seat.min.y + c.pelvisLift, bounds.seat.getCenter(new Vector3()).z + c.frontOffset,
  );
  hip.position.copy(hip.parent!.worldToLocal(pelvis.clone()));
  frame.updateMatrixWorld(true);
  const torso = [hip, ...spine.slice(0, chestIndex + 1)];
  for (let i = 0; i < torso.length - 1; i++) aim(torso[i], torso[i + 1], headDirection);
  const neckLength = neck.slice(0, -1).reduce((length, bone, i) => length + point(bone).distanceTo(point(neck[i + 1])), 0);
  const headRise = Math.min(bounds.seat.min.y + c.armrestRise + c.headLift - point(chest).y, neckLength * c.neckReach);
  const neckDirection = new Vector3(-Math.sqrt(neckLength ** 2 - headRise ** 2), headRise, 0).normalize();
  for (let i = 0; i < neck.length - 1; i++) aim(neck[i], neck[i + 1], neckDirection);
  const turn = c.headTurn * Math.PI / 180;
  orient(head, basis(headDirection, new Vector3(0, Math.cos(turn), Math.sin(turn)))
    .multiply(basis(headUpLocal, faceLocal).invert()));

  const plush = bounds.plush.clone().expandByScalar(c.legRadius + c.plushClearance);
  const crossesPlush = (from: Vector3, to: Vector3) => {
    let enter = 0, leave = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-9) {
        if (from[axis] < plush.min[axis] || from[axis] > plush.max[axis]) return false;
      } else {
        const first = (plush.min[axis] - from[axis]) / delta;
        const last = (plush.max[axis] - from[axis]) / delta;
        enter = Math.max(enter, Math.min(first, last));
        leave = Math.min(leave, Math.max(first, last));
        if (enter > leave) return false;
      }
    }
    return true;
  };
  for (const [thigh, knee, foot, toe] of legs) {
    const start = point(thigh);
    const upperLength = start.distanceTo(point(knee));
    const lowerLength = point(knee).distanceTo(point(foot));
    const footLength = point(foot).distanceTo(point(toe));
    let best: { cost: number; knee: Vector3; foot: Vector3; direction: Vector3 } | null = null;
    for (let bend = c.kneeMin; bend <= c.kneeMax; bend += c.kneeStep) {
      const flex = bend * Math.PI / 180;
      const a = upperLength + lowerLength * Math.cos(flex);
      const b = lowerLength * Math.sin(flex);
      const rise = bounds.seat.min.y + c.ankleLift - start.y;
      const radius = Math.hypot(a, b);
      if (Math.abs(rise) > radius) continue;
      const angle = Math.atan2(b, a) + Math.asin(rise / radius);
      if (angle < c.thighMin * Math.PI / 180 || angle > c.thighMax * Math.PI / 180) continue;
      const reach = upperLength * Math.cos(angle) + lowerLength * Math.cos(angle - flex);
      const along = bounds.seat.max.x - c.footFromEnd - start.x;
      if (along < 0 || along > reach) continue;
      const lateral = Math.sqrt(reach ** 2 - along ** 2);
      const direction = new Vector3(along, 0, lateral).normalize();
      const kneePoint = start.clone().addScaledVector(direction, upperLength * Math.cos(angle));
      kneePoint.y += upperLength * Math.sin(angle);
      const footPoint = start.clone().addScaledVector(direction, reach).setY(bounds.seat.min.y + c.ankleLift);
      const toeDrop = (c.ankleLift - c.toeLift) / footLength;
      if (toeDrop > 1) continue;
      const footDirection = direction.clone().multiplyScalar(Math.sqrt(1 - toeDrop ** 2)).setY(-toeDrop);
      const toePoint = footPoint.clone().addScaledVector(footDirection, footLength);
      if (toePoint.z > bounds.seat.max.z - c.frontMargin || toePoint.x > bounds.seat.max.x ||
        crossesPlush(start, kneePoint) || crossesPlush(kneePoint, footPoint) || crossesPlush(footPoint, toePoint)) continue;
      const inset = start.z < pelvis.z ? c.farFootInset : c.nearFootInset;
      const cost = Math.abs(footPoint.z - (bounds.seat.max.z - inset));
      if (!best || cost < best.cost) best = { cost, knee: kneePoint, foot: footPoint, direction: footDirection };
    }
    if (!best) throw new Error('Mikako: no hay apoyo seguro para ' + thigh.name);
    aim(thigh, knee, best.knee.clone().sub(start));
    aim(knee, foot, best.foot.clone().sub(point(knee)));
    aim(foot, toe, best.direction);
  }

  const arms = [
    [find('upperarm_l', 'LeftArm'), find('lowerarm_l', 'LeftForeArm'), find('hand_l', 'LeftHand')],
    [find('upperarm_r', 'RightArm'), find('lowerarm_r', 'RightForeArm'), find('hand_r', 'RightHand')],
  ];
  for (const [upper, lower, hand] of arms) {
    const start = point(upper);
    const relaxed = start.z > pelvis.z;
    const target = relaxed
      ? new Vector3(pelvis.x + c.relaxedHandAlong, bounds.seat.min.y + c.relaxedHandLift, bounds.seat.max.z + c.handOverEdge)
      : new Vector3(pelvis.x + c.abdomenAlong, pelvis.y + c.abdomenLift, pelvis.z);
    const upperLength = start.distanceTo(point(lower));
    const lowerLength = point(lower).distanceTo(point(hand));
    const delta = target.clone().sub(start);
    const distance = delta.length();
    const direction = delta.normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
    const pole = new Vector3(...(relaxed ? c.relaxedElbowPole : c.abdomenElbowPole)).projectOnPlane(direction).normalize();
    const elbow = start.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    aim(upper, lower, elbow.sub(start));
    aim(lower, hand, target.sub(point(lower)));
  }

  // Se conserva íntegra la solución final anterior. Los apoyos intermedios se
  // resuelven sobre este mismo rig, sin inclinar el grupo de colocación.
  const final = bones.map(bone => ({ quaternion: bone.quaternion.clone(), position: bone.position.clone() }));
  const finalLegs = legs.map(leg => leg.map(point));
  const finalSpine = spine[0].getWorldQuaternion(new Quaternion());
  const finalHands = arms.map(arm => arm.map(point));
  const sofaYaw = room3d.objects.sofa.rotation[1];
  const rootLocal = (progress: number) => couchRootPosition(progress, seat.home)
    .sub(new Vector3(...room3d.objects.sofa.position)).applyAxisAngle(new Vector3(0, 1, 0), -sofaYaw);
  const seatedPitch = (weight: number) => {
    for (const [pattern, degrees] of [
      [/spine(?:_?\d+)?$/i, room3d.mikako.spinePitch],
      [/neck(?:_?\d+)?$/i, room3d.mikako.neckPitch],
      [/head(?:_?\d+)?$/i, room3d.mikako.headPitch],
    ] as const) bones.find(bone => pattern.test(bone.name))?.rotateX(degrees * Math.PI / 180 * weight);
    frame.updateMatrixWorld(true);
  };
  const seatTracks = standing.tracks.map(track => ({
    bone: rig.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.'))),
    property: track.name.slice(track.name.lastIndexOf('.') + 1),
    interpolant: track.name.endsWith('.quaternion')
      ? new QuaternionLinearInterpolant(track.times, track.values, 4)
      : new LinearInterpolant(track.times, track.values, track.getValueSize()),
  }));
  const hipSource = seatTracks.find(track => track.bone === hip && track.property === 'position');
  const hipStart = hipSource?.interpolant.evaluate(seat.start)[1] ?? hip.position.y;
  const hipEnd = hipSource?.interpolant.evaluate(seat.end)[1] ?? hipStart;
  const sampleSeat = (progress: number) => {
    for (const { bone, quaternion, position } of base) {
      bone.quaternion.copy(quaternion);
      bone.position.copy(position);
    }
    const time = seat.start + (seat.end - seat.start) * couchPhase(progress, 0, c.seatEnd);
    for (const { bone, property, interpolant } of seatTracks) {
      if (property === 'quaternion') bone?.quaternion.fromArray(interpolant.evaluate(time));
      if (property === 'position') bone?.position.fromArray(interpolant.evaluate(time));
    }
    const descent = hipStart === hipEnd ? couchPhase(progress, 0, c.seatEnd)
      : Math.max(0, Math.min(1, (hipStart - hip.position.y) / (hipStart - hipEnd)));
    seatedPitch(couchPhase(descent, 0, 1));
    const entry = couchPhase(progress, 0, c.entryEnd);
    for (const bone of bones) {
      const source = entryPose.get(bone.name);
      if (!source) continue;
      bone.quaternion.copy(source.quaternion.clone().slerp(bone.quaternion, entry));
      bone.position.copy(source.position.clone().lerp(bone.position, entry));
    }
    frame.updateMatrixWorld(true);
    return descent;
  };
  frame.position.copy(rootLocal(0));
  sampleSeat(0);
  const planted = legs.map(leg => leg.map(point));
  const initialHip = point(hip);
  // Dos eslabones: conserva longitudes y el lado del codo/rodilla, en lugar de
  // atravesar el cuerpo al mezclar directamente los cuaterniones extremos.
  const solve = (chain: Bone[], target: Vector3, polePoint: Vector3) => {
    solveTwoBone(chain, target, polePoint, point, aim);
  };
  const times: number[] = [];
  const rotations = bones.map(() => [] as number[]);
  const hipPositions: number[] = [];
  for (let step = 0; step <= c.bakeSteps; step++) {
    const progress = step / c.bakeSteps;
    const sitting = couchPhase(progress, 0, c.seatEnd);
    const reclining = couchPhase(progress, c.reclineStart, c.reclineEnd);
    const settling = couchPhase(progress, c.settleStart, 1);
    frame.position.copy(rootLocal(progress));
    const descent = sampleSeat(progress);
    const uprightSpine = spine[0].getWorldQuaternion(new Quaternion());
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const arm = /arm|hand|finger|thumb|index|middle|ring|pinky|clavicle|shoulder/i.test(bone.name);
      const headBone = bone === head;
      bone.quaternion.slerp(final[i].quaternion, bone === hip ? descent : arm || headBone ? settling : reclining);
    }
    // La pelvis llega al cojín durante el descenso y queda fija al reclinar.
    const hipTarget = initialHip.clone().lerp(pelvis, descent);
    hip.position.copy(hip.parent!.worldToLocal(hipTarget));
    frame.updateMatrixWorld(true);
    orient(spine[0], uprightSpine.slerp(finalSpine, reclining));
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const lift = couchPhase(progress, c.feetLiftStart, c.feetClear);
      const fold = couchPhase(progress, c.feetClear, c.feetOnSeat);
      const clear = planted[i][2].clone();
      clear.y = bounds.seat.min.y + c.footClearance;
      clear.z = Math.max(clear.z, bounds.seat.max.z + c.legRadius + c.frontMargin);
      const target = planted[i][2].clone().lerp(clear, lift).lerp(finalLegs[i][2], fold);
      const pole = planted[i][1].clone().lerp(finalLegs[i][1], reclining);
      pole.y += Math.max(0, bounds.seat.min.y + c.kneeClearance - pole.y) * sitting * (1 - fold);
      pole.z += Math.max(0, bounds.seat.max.z + c.legRadius - pole.z) * sitting * (1 - fold);
      solve(leg, target, pole);
      const direction = planted[i][3].clone().sub(planted[i][2])
        .lerp(finalLegs[i][3].clone().sub(finalLegs[i][2]), fold);
      aim(leg[2], leg[3], direction);
    }
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      const hand = point(arm[2]);
      // Una clave de apoyo por brazo: primero despejar el torso y luego acomodar.
      const support = finalHands[i][2].clone();
      support.y += c.armClearance;
      support.z = Math.max(support.z, pelvis.z + c.armClearance);
      const target = hand.lerp(support, reclining).lerp(finalHands[i][2], settling);
      solve(arm, target, point(arm[1]).lerp(finalHands[i][1], settling));
    }
    // Extremo exacto, incluida la torsión de muñecas y tobillos.
    if (step === c.bakeSteps) for (let i = 0; i < bones.length; i++) {
      bones[i].quaternion.copy(final[i].quaternion);
      bones[i].position.copy(final[i].position);
    }
    times.push(progress * c.duration);
    bones.forEach((bone, i) => rotations[i].push(...bone.quaternion.toArray()));
    hipPositions.push(...hip.position.toArray());
  }
  sampler.stopAllAction();
  sampler.uncacheRoot(rig);
  return AnimationClip.parse({ name: 'mikako-recline', duration: c.duration,
    uuid: new AnimationClip().uuid, blendMode: standing.blendMode,
    tracks: [
      ...bones.map((bone, i) => ({ name: bone.name + '.quaternion', type: 'quaternion', times, values: rotations[i] })),
      { name: hip.name + '.position', type: 'vector', times, values: hipPositions },
    ] });
}

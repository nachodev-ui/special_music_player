import { AnimationClip, AnimationMixer, Box3, Group, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { room3d, type Vec3 } from './room3d.config';

// Segundos, metros y grados; un único reloj para cuerpo, brazo y contacto.
export const TURNTABLE_PRESS = {
  fps: 30, duration: 2.1,
  leanStart: 0, leanEnd: .65, armStart: .15, armRaised: .70,
  pressStart: .70, holdEnd: 1.2, returnEnd: 2.1,
  leanDegrees: 22, pelvisLower: .28, fingerLift: .14,
  approachReachFraction: .38, footClearance: .20,
  surfaceInset: .06, contactForward: .12, surfaceHeight: 1.28,
  pointOffset: [0, 0, 0] as Vec3, elbowOut: .22, kneeForward: .35,
  facingYaw: Math.PI / 2, turnDistance: .65, turnSpeed: 10, facingToleranceDegrees: 1,
  armRadius: .035,
} as const;
export const TURNTABLE_CONTACT_FRAME = 30;
export const TURNTABLE_CONTACT_TIME = TURNTABLE_CONTACT_FRAME / TURNTABLE_PRESS.fps;

// Bounding box del GLB con su matriz aplicada; mismo centrado y fit que RoomModel.
const TURNTABLE_SOURCE_BOUNDS = new Box3(
  new Vector3(-.243551001, .000181964, -.218642026),
  new Vector3(.232095003, 1.014046119, .271608168),
);
const object = room3d.objects.turntable;
const sourceSize = TURNTABLE_SOURCE_BOUNDS.getSize(new Vector3());
const fit = Math.min(...object.size.map((size, axis) => size / sourceSize.getComponent(axis)));
const size = sourceSize.multiplyScalar(fit).multiply(new Vector3(...object.scale));
export const TURNTABLE_BOUNDS = new Box3(
  new Vector3(object.position[0] - size.x / 2, object.position[1], object.position[2] - size.z / 2),
  new Vector3(object.position[0] + size.x / 2, object.position[1] + size.y, object.position[2] + size.z / 2),
);
// Superficie del mueble por el lateral cercano a la posición inicial de Mikako.
export const TURNTABLE_CONTACT_POINT: Vec3 = [
  TURNTABLE_BOUNDS.min.x + TURNTABLE_PRESS.surfaceInset,
  object.position[1] + TURNTABLE_PRESS.surfaceHeight * object.scale[1],
  object.position[2] + TURNTABLE_PRESS.contactForward,
];
export type TurntableApproach = { point: [number, number]; facing: [number, number] };
const phase = (time: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export function createTurntablePress(model: Object3D, idle: AnimationClip, scale: Vec3, yawOffset: number) {
  const c = TURNTABLE_PRESS;
  const rig = clone(model);
  rig.traverse(node => { if ((node as SkinnedMesh).isSkinnedMesh) (node as SkinnedMesh).skeleton.pose(); });
  const frame = new Group();
  const facing = new Group();
  frame.scale.set(...scale);
  frame.rotation.y = c.facingYaw;
  facing.rotation.y = yawOffset;
  frame.add(facing); facing.add(rig);
  const sampler = new AnimationMixer(rig);
  sampler.clipAction(idle).play(); sampler.update(0);
  frame.updateMatrixWorld(true);
  const find = (...names: string[]) => {
    const bone = names.map(name => rig.getObjectByName(name)).find(node => (node as Bone | undefined)?.isBone);
    if (!bone) throw new Error('Mikako: falta el hueso ' + names.join('/'));
    return bone as Bone;
  };
  const point = (node: Object3D) => node.getWorldPosition(new Vector3());
  const hip = find('pelvis', 'Hips');
  const upper = find('upperarm_r', 'RightArm');
  const lower = find('lowerarm_r', 'RightForeArm');
  const hand = find('hand_r', 'RightHand');
  const armLength = point(upper).distanceTo(point(lower)) + point(lower).distanceTo(point(hand));
  // La separación usa el alcance medido, con margen mayor que el obstáculo de navegación (.16 m).
  const TURNTABLE_INTERACTION_POINT: Vec3 = [
    TURNTABLE_BOUNDS.min.x - Math.max(c.footClearance, armLength * c.approachReachFraction) + c.pointOffset[0],
    room3d.mikako.position[1] + c.pointOffset[1],
    TURNTABLE_CONTACT_POINT[2] - point(upper).z + c.pointOffset[2],
  ];
  frame.position.set(...TURNTABLE_INTERACTION_POINT);
  frame.updateMatrixWorld(true);
  // Rosa tiene manos sin falanges: medir el extremo de su malla asociado a hand_r.
  const tipLocal = new Vector3();
  const direction = point(hand).sub(point(lower)).normalize();
  let farthest = 0;
  rig.traverse(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const joint = mesh.skeleton.bones.indexOf(hand);
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (joint < 0 || !indices || !weights) return;
    for (let i = 0; i < indices.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) if (indices.getComponent(i, j) === joint) weight += weights.getComponent(i, j);
      if (weight < .75) continue;
      const vertex = mesh.localToWorld(mesh.getVertexPosition(i, new Vector3()));
      const projection = vertex.clone().sub(point(hand)).dot(direction);
      if (projection > farthest) { farthest = projection; tipLocal.copy(hand.worldToLocal(vertex)); }
    }
  });
  if (farthest === 0) throw new Error('Mikako: no se pudo medir el extremo de la mano derecha');
  const tipLength = tipLocal.clone().applyQuaternion(hand.getWorldQuaternion(new Quaternion()))
    .multiplyScalar(scale[0]).length();
  const bones: Bone[] = [];
  rig.traverse(node => { if ((node as Bone).isBone) bones.push(node as Bone); });
  const base = bones.map(bone => ({ quaternion: bone.quaternion.clone(), position: bone.position.clone() }));
  const legs = [
    [find('thigh_l', 'LeftUpLeg'), find('calf_l', 'LeftLeg'), find('foot_l', 'LeftFoot'), find('ball_l', 'LeftToeBase')],
    [find('thigh_r', 'RightUpLeg'), find('calf_r', 'RightLeg'), find('foot_r', 'RightFoot'), find('ball_r', 'RightToeBase')],
  ];
  const planted = legs.map(leg => leg.map(point));
  const spine = ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'Spine', 'Spine1', 'Spine2']
    .map(name => rig.getObjectByName(name)).filter((node): node is Bone => !!(node as Bone | undefined)?.isBone);
  const orient = (bone: Bone, world: Quaternion) => {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    frame.updateMatrixWorld(true);
  };
  const aim = (bone: Bone, childPosition: Vector3, targetDirection: Vector3) => orient(bone,
    new Quaternion().setFromUnitVectors(childPosition.sub(point(bone)).normalize(), targetDirection.normalize())
      .multiply(bone.getWorldQuaternion(new Quaternion())));
  const solve = (a: Bone, b: Bone, end: Bone, target: Vector3, pole: Vector3) => {
    const origin = point(a);
    const first = origin.distanceTo(point(b));
    const second = point(b).distanceTo(point(end));
    const axis = target.clone().sub(origin);
    const distance = Math.max(Math.abs(first - second) + 1e-5, Math.min(axis.length(), first + second - 1e-5));
    axis.normalize();
    const along = (first * first + distance * distance - second * second) / (2 * distance);
    const normal = pole.clone().sub(origin).addScaledVector(axis, -pole.clone().sub(origin).dot(axis)).normalize();
    const elbow = origin.clone().addScaledVector(axis, along).addScaledVector(normal, Math.sqrt(Math.max(0, first * first - along * along)));
    aim(a, point(b), elbow.sub(origin));
    aim(b, point(end), target.clone().sub(point(b)));
  };
  const times: number[] = [];
  const rotations = bones.map(() => [] as number[]);
  const hipPositions: number[] = [];
  // Cinco metas (reposo, elevar, contacto, sostener, reposo), horneadas con easing suave.
  for (let step = 0; step <= c.duration * c.fps; step++) {
    const time = step / c.fps;
    const returning = phase(time, c.holdEnd, c.returnEnd);
    const lean = phase(time, c.leanStart, c.leanEnd) * (1 - returning);
    const reach = phase(time, c.armStart, c.armRaised) * (1 - returning);
    for (let i = 0; i < bones.length; i++) {
      bones[i].quaternion.copy(base[i].quaternion); bones[i].position.copy(base[i].position);
    }
    frame.updateMatrixWorld(true);
    hip.position.copy(hip.parent!.worldToLocal(point(hip).add(new Vector3(0, -c.pelvisLower * lean, 0))));
    frame.updateMatrixWorld(true);
    for (const bone of spine) orient(bone, new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1),
      c.leanDegrees * Math.PI / 180 * lean / spine.length).multiply(bone.getWorldQuaternion(new Quaternion())));
    legs.forEach((leg, i) => {
      solve(leg[0], leg[1], leg[2], planted[i][2], planted[i][1].clone().add(new Vector3(c.kneeForward * lean, 0, 0)));
      aim(leg[2], point(leg[3]), planted[i][3].clone().sub(planted[i][2]));
    });
    const down = new Vector3(0, -1, 0);
    const handQ = hand.getWorldQuaternion(new Quaternion());
    const pressQ = new Quaternion().setFromUnitVectors(tipLocal.clone().applyQuaternion(handQ).normalize(), down).multiply(handQ);
    const wrist = new Vector3(...TURNTABLE_CONTACT_POINT);
    wrist.y += tipLength + c.fingerLift * (1 - phase(time, c.pressStart, TURNTABLE_CONTACT_TIME));
    const target = point(hand).lerp(wrist, reach);
    solve(upper, lower, hand, target, point(lower).add(new Vector3(-c.elbowOut * reach, 0, c.elbowOut * reach)));
    orient(hand, handQ.slerp(pressQ, reach));
    times.push(time);
    bones.forEach((bone, i) => rotations[i].push(...bone.quaternion.toArray()));
    hipPositions.push(...hip.position.toArray());
  }
  sampler.stopAllAction(); sampler.uncacheRoot(rig);
  const clip = AnimationClip.parse({ name: 'mikako-turntable-press', duration: c.duration,
    uuid: new AnimationClip().uuid, blendMode: idle.blendMode,
    tracks: [...bones.map((bone, i) => ({ name: bone.name + '.quaternion', type: 'quaternion', times, values: rotations[i] })),
      { name: hip.name + '.position', type: 'vector', times, values: hipPositions }] });
  return { clip, tipLocal, hand: hand.name, point: TURNTABLE_INTERACTION_POINT,
    approach: { point: [TURNTABLE_INTERACTION_POINT[0], TURNTABLE_INTERACTION_POINT[2]],
      facing: [TURNTABLE_INTERACTION_POINT[0] + 1, TURNTABLE_INTERACTION_POINT[2]] } satisfies TurntableApproach };
}

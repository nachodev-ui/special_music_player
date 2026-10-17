import { AnimationClip, AnimationMixer, CatmullRomCurve3, Group, Quaternion, Vector3, type Bone, type Object3D } from 'three';
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
  duration: 6.4, steps: 384,
  entryEnd: .45 / 6.4, grabStart: 0, grabEnd: .45 / 6.4, pullStart: .30 / 6.4, pullEnd: 1.30 / 6.4,
  // El pasillo y el paso lateral necesitan tiempo para trasladar el apoyo.
  walkStart: 1.05 / 6.4, walkCorner: 2.80 / 6.4, walkEnd: 4.15 / 6.4,
  lowerStart: 2.80 / 6.4, lowerEnd: 5.40 / 6.4, rollStart: 5.20 / 6.4, rollEnd: 6.10 / 6.4,
  handsStart: 5.40 / 6.4, handsEnd: 6.40 / 6.4,
  footStart: 1.05 / 6.4, footEnd: 4.15 / 6.4, turnDistance: .65, turnSpeed: 8, facingTolerance: .005,
  stride: .45, stepDuration: .30, stepHeight: .10, maxRootMeanSpeed: 1.1,
  minPull: .55, maxPull: .75, standGap: .42, pullStep: .60,
  standForward: .12, corridorClearance: .06,
  pullRelease: .65, rollAcceleration: .35, rollOvershoot: .008, rollSettle: .18 / 6.4,
  pelvisArcDelay: .60, contactSink: .015, contactRecovery: .005, contactTime: .25 / 6.4,
  torsoLean: 12 * Math.PI / 180, headTurn: 20 * Math.PI / 180,
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
export const gapRest = CHAIR_POSITION[2] - CHAIR_SIZE[2] / 2 - deskSurface().front;
export const CHAIR_PULL = Math.min(DESK_CHAIR.maxPull, Math.max(DESK_CHAIR.minPull, DESK_CHAIR.standGap - gapRest));
export const standZ = CHAIR_POSITION[2] + CHAIR_PULL - CHAIR_SIZE[2] / 2 - DESK_CHAIR.standForward;
// Borde del respaldo más próximo a la entrada: fracciones de la caja escalada.
export const CHAIR_GRIP: Vec3 = [CHAIR_SIZE[0] * .5, CHAIR_SIZE[1] * .60, CHAIR_SIZE[2] * .40];
const phase = (progress: number, start: number, end: number) => Math.max(0, Math.min(1, (progress - start) / (end - start)));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
// Velocidad continua: acelera el 35 % del tiempo y frena durante el resto.
function rollEase(t: number) {
  const a = DESK_CHAIR.rollAcceleration;
  return t < a ? t * t / a : 1 - (1 - t) ** 2 / (1 - a);
}
export function chairSlide(progress: number, reversed = false) {
  if (!DESK_CHAIR_PULL_ENABLED) return 0;
  const c = DESK_CHAIR;
  if (reversed) {
    // El reloj del clip sigue bajando: impulso al levantarse y empuje al salir.
    const elapsed = 1 - progress;
    return CHAIR_PULL * rollEase(phase(elapsed, 0, 1.2 / c.duration)) *
      (1 - rollEase(phase(elapsed, 1 - c.pullEnd, 1)));
  }
  const pull = easeOut(phase(progress, c.pullStart, c.pullEnd));
  const roll = rollEase(phase(progress, c.rollStart, c.rollEnd - c.rollSettle));
  const settle = couchPhase(progress, c.rollEnd - c.rollSettle, c.rollEnd);
  return CHAIR_PULL * pull * (1 - roll) - c.rollOvershoot * roll * (1 - settle);
}
export function chairEntry(): Vec3 {
  return [CHAIR_POSITION[0] + DESK_CHAIR.entrySide, 0, CHAIR_POSITION[2] + DESK_CHAIR.entryForward];
}
const chairPath = new CatmullRomCurve3([
  new Vector3(...chairEntry()),
  new Vector3(CHAIR_POSITION[0] + DESK_CHAIR.entrySide, 0,
    chairEntry()[2] + CHAIR_PULL * DESK_CHAIR.pullStep),
  new Vector3(CHAIR_POSITION[0] + DESK_CHAIR.entrySide, 0, standZ - DESK_CHAIR.corridorClearance),
  new Vector3(CHAIR_POSITION[0], 0, standZ),
], false, 'centripetal');
// Reloj Hermite monótono: tangentes compartidas y no nulas en los pasos interiores.
// Solo la entrada y el final del recorrido completo tienen velocidad cero.
function pathClock(progress: number) {
  const c = DESK_CHAIR, knots = [c.pullStart, c.walkStart, c.walkCorner, c.walkEnd];
  if (progress <= knots[0]) return 0;
  if (progress >= knots[3]) return 1;
  const speeds = knots.slice(1).map((end, i) => 1 / (3 * (end - knots[i])));
  const slopes = [0, 2 * speeds[0] * speeds[1] / (speeds[0] + speeds[1]),
    2 * speeds[1] * speeds[2] / (speeds[1] + speeds[2]), 0];
  const i = progress < knots[1] ? 0 : progress < knots[2] ? 1 : 2;
  const duration = knots[i + 1] - knots[i], t = (progress - knots[i]) / duration;
  return (2 * t ** 3 - 3 * t * t + 1) * i / 3 +
    (t ** 3 - 2 * t * t + t) * duration * slopes[i] +
    (-2 * t ** 3 + 3 * t * t) * (i + 1) / 3 + (t ** 3 - t * t) * duration * slopes[i + 1];
}
export function chairRoot(progress: number, reversed = false) {
  const entry = new Vector3(...chairEntry());
  if (!DESK_CHAIR_PULL_ENABLED) return entry.lerp(
    new Vector3(CHAIR_POSITION[0], 0, CHAIR_POSITION[2] - DESK_CHAIR.pelvisForward),
    couchPhase(progress, .10, .78));
  const c = DESK_CHAIR;
  const root = chairPath.getPoint(pathClock(progress));
  // Primero lleva la pelvis atrás; la altura comienza a bajar después.
  const arc = couchPhase(progress, Math.max(c.lowerStart, c.walkEnd), c.lowerEnd);
  root.z += (CHAIR_POSITION[2] + chairSlide(progress, reversed) - c.pelvisForward - root.z) * arc;
  return root;
}

// Apoyos mundiales, calculados en el sentido real de reproducción del clip.
// Nunca se interpola un pie apoyado con la raíz: solo cambia durante su paso.
export function createChairFootsteps(standingFeet: readonly Vector3[], hipOffset = new Vector3(), reversed = false): Vector3[][] {
  const c = DESK_CHAIR, initialRoot = chairRoot(0);
  const offsets = standingFeet.map(foot => foot.clone().sub(initialRoot).sub(hipOffset));
  const forward = plan(false, standingFeet);
  return reversed ? plan(true, forward[c.steps]) : forward;

  function plan(backward: boolean, startingFeet: readonly Vector3[]) {
    const anchors = startingFeet.map(foot => foot.clone());
    const frames: Vector3[][] = Array.from({ length: c.steps + 1 }, () => []);
    let previousRoot = chairRoot(backward ? 1 : 0, backward);
    let nextFoot = -1;
    let swing: { foot: number; from: Vector3; to: Vector3; elapsed: number } | null = null;
    const dt = c.duration / c.steps;
    for (let sample = 0; sample <= c.steps; sample++) {
      const index = backward ? c.steps - sample : sample, progress = index / c.steps;
      const root = chairRoot(progress, backward);
      const movement = root.clone().sub(previousRoot); movement.y = 0;
      const moving = movement.lengthSq() > 1e-12;
      const walking = DESK_CHAIR_PULL_ENABLED && progress >= c.pullStart && progress <= c.walkEnd;
      const direction = movement.clone().normalize();
      if (swing && moving) {
        swing.elapsed = Math.min(c.stepDuration, swing.elapsed + dt);
        const t = swing.elapsed / c.stepDuration;
        // Avance suave y arco senoidal; el punto de aterrizaje queda fijado al despegar.
        anchors[swing.foot].copy(swing.from).lerp(swing.to, t * t * (3 - 2 * t));
        anchors[swing.foot].y = swing.from.y + Math.sin(Math.PI * t) * c.stepHeight;
        if (t >= 1 - 1e-9) {
          anchors[swing.foot].copy(swing.to);
          nextFoot = (swing.foot + 1) % anchors.length;
          swing = null;
        }
      }
      const remaining = (backward ? progress - c.pullStart : c.walkEnd - progress) * c.duration;
      if (!swing && moving && walking && remaining >= c.stepDuration + dt) {
        const approach = couchPhase(progress, c.walkStart, c.walkEnd);
        const arc = couchPhase(progress, c.lowerStart, c.lowerEnd);
        const pelvis = root.clone().addScaledVector(hipOffset, (1 - approach) * (1 - arc));
        const errors = offsets.map((offset, i) => {
          const error = pelvis.clone().add(offset).sub(anchors[i]); error.y = 0;
          return error;
        });
        if (nextFoot < 0) nextFoot = errors.reduce((best, error, i) =>
          best < 0 || error.dot(direction) > errors[best].dot(direction) ? i : best, -1);
        const error = errors[nextFoot];
        // Media zancada detrás del ideal, medida en la dirección del movimiento.
        if (error && error.dot(direction) > c.stride / 2) {
          const from = anchors[nextFoot].clone();
          const to = from.clone().addScaledVector(error.clone().normalize(), c.stride);
          to.y = from.y;
          swing = { foot: nextFoot, from, to, elapsed: 0 };
        }
      }
      frames[index] = anchors.map(foot => foot.clone());
      previousRoot = root;
    }
    return frames;
  }
}

// Un único clip de huesos, en el mismo formato AnimationClip que el sillón.
// La colocación comparte su reloj; la orientación permanece fija hacia el escritorio.
export function createDeskChairClip(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, fromCurrentPose = false, reversed = false) {
  try {
    return buildDeskChairClip(model, standing, hipName, scale, yawOffset, fromCurrentPose, reversed);
  } catch (error) {
    console.warn('Mikako: no se pudo preparar la silla de escritorio.', error);
    return null;
  }
}
function buildDeskChairClip(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, fromCurrentPose: boolean, reversed: boolean) {
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
  const spine = find('spine_02', 'spine_01', 'Spine1', 'Spine');
  const head = find('head', 'Head');
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
  const footsteps = createChairFootsteps(feet.map((leg, i) =>
    new Vector3(leg[2].x, restingFeet[i][2].y, leg[2].z)), hipOffset, reversed);
  const hands = arms.map(arm => point(arm[2]));
  const elbows = arms.map(arm => point(arm[1]));
  const gripAt = (progress: number) => new Vector3(CHAIR_POSITION[0] + CHAIR_GRIP[0],
    CHAIR_POSITION[1] + CHAIR_GRIP[1], CHAIR_POSITION[2] + chairSlide(progress, reversed) + CHAIR_GRIP[2]);
  const gripArm = arms.reduce((nearest, arm, i) => nearest < 0 ||
    point(arm[0]).distanceToSquared(gripAt(0)) < point(arms[nearest][0]).distanceToSquared(gripAt(0)) ? i : nearest, -1);
  const surface = deskSurface();
  const times: number[] = [], positions: number[] = [];
  const rotations = bones.map(() => [] as number[]);
  for (let step = 0; step <= c.steps; step++) {
    const progress = step / c.steps;
    const lowerStart = DESK_CHAIR_PULL_ENABLED ? c.lowerStart : .10;
    const arc = couchPhase(progress, lowerStart, c.lowerEnd);
    const lower = couchPhase(progress, lowerStart + (c.lowerEnd - lowerStart) * c.pelvisArcDelay, c.lowerEnd);
    const reach = couchPhase(progress, c.handsStart, c.handsEnd);
    bones.forEach((bone, i) => {
      const blend = fromCurrentPose ? couchPhase(progress, 0, c.entryEnd) : 1;
      bone.quaternion.copy(entry[i].q).slerp(base[i].q, blend);
      bone.position.copy(entry[i].p).lerp(base[i].p, blend);
    });
    frame.position.copy(chairRoot(progress, reversed)); frame.updateMatrixWorld(true);
    const root = chairRoot(progress, reversed);
    const chairZ = CHAIR_POSITION[2] + chairSlide(progress, reversed);
    const approach = couchPhase(progress, c.walkStart, c.walkEnd);
    const pelvis = DESK_CHAIR_PULL_ENABLED
      ? root.clone().addScaledVector(hipOffset, (1 - approach) * (1 - arc))
      : initialHip.clone().lerp(new Vector3(CHAIR_POSITION[0], c.seatHeight + c.pelvisLift,
        chairZ - c.pelvisForward), lower);
    pelvis.y = initialHip.y + (c.seatHeight + c.pelvisLift - initialHip.y) * lower;
    const cushion = reversed ? (c.contactSink - c.contactRecovery) * lower
      : c.contactSink * couchPhase(progress, c.lowerEnd - .15 / c.duration, c.lowerEnd) -
        c.contactRecovery * couchPhase(progress, c.lowerEnd, c.lowerEnd + c.contactTime);
    pelvis.y -= cushion;
    // Una pierna completamente estirada no alcanza un apoyo que queda atrás.
    // Ceder altura antes del IK mantiene el tobillo en su apoyo mundial.
    const currentHip = point(hip);
    legs.forEach((leg, i) => {
      const thigh = point(leg[0]), knee = point(leg[1]), ankle = point(leg[2]);
      const length = thigh.distanceTo(knee) + knee.distanceTo(ankle) - .0001;
      const offset = thigh.sub(currentHip), target = footsteps[step][i];
      const dx = pelvis.x + offset.x - target.x, dz = pelvis.z + offset.z - target.z;
      const reachY = Math.sqrt(Math.max(0, length * length - dx * dx - dz * dz));
      pelvis.y = Math.min(pelvis.y, target.y + reachY - offset.y);
    });
    hip.position.copy(hip.parent!.worldToLocal(pelvis)); frame.updateMatrixWorld(true);
    const rotateWorld = (bone: Bone | undefined, axis: Vector3, angle: number) => {
      if (!bone?.parent) return;
      const rotation = new Quaternion().setFromAxisAngle(axis, angle).multiply(bone.getWorldQuaternion(new Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
      frame.updateMatrixWorld(true);
    };
    const lean = couchPhase(progress, lowerStart, lowerStart + .35 / c.duration) *
      (1 - couchPhase(progress, c.lowerEnd, c.lowerEnd + c.contactTime));
    rotateWorld(spine, new Vector3(1, 0, 0), -c.torsoLean * lean);
    const look = couchPhase(progress, c.grabStart, c.grabEnd) *
      (1 - couchPhase(progress, c.lowerEnd, c.handsEnd));
    rotateWorld(head, new Vector3(0, 1, 0), c.headTurn * look);
    legs.forEach((leg, i) => {
      const displacement = DESK_CHAIR_PULL_ENABLED ? root.clone().sub(initialRoot) : new Vector3();
      const target = footsteps[step][i];
      const bend = Math.max(0, Math.min(1, (initialHip.y - pelvis.y) / (initialHip.y - c.seatHeight - c.pelvisLift)));
      const pole = feet[i][1].clone().add(displacement).lerp(new Vector3(target.x, pelvis.y - c.pelvisLift,
        target.z - c.kneeForward), bend);
      solveTwoBone(leg, target, pole, point, aim);
      aim(leg[2], leg[3], feet[i][3].clone().sub(feet[i][2]).lerp(
        restingFeet[i][3].clone().sub(restingFeet[i][2]), couchPhase(progress, c.footStart, c.footEnd)));
    });
    arms.forEach((arm, i) => {
      const shoulder = point(arm[0]);
      if (DESK_CHAIR_PULL_ENABLED && i === gripArm && progress < c.lowerStart) {
        const releaseAt = c.pullStart + (c.pullEnd - c.pullStart) * (1 - Math.cbrt(1 - c.pullRelease));
        const grab = reversed
          ? couchPhase(progress, 0, .20 / c.duration) * (1 - couchPhase(progress, c.pullEnd, c.walkStart + .35 / c.duration))
          : couchPhase(progress, c.grabStart, c.grabEnd) * (1 - couchPhase(progress, releaseAt - .10 / c.duration, releaseAt));
        const grip = gripAt(progress);
        const elbow = point(arm[1]), hand = point(arm[2]);
        const upper = shoulder.distanceTo(elbow), lowerArm = elbow.distanceTo(hand);
        const distance = shoulder.distanceTo(grip);
        if (grab > 0 && distance <= upper + lowerArm && distance >= Math.abs(upper - lowerArm)) {
          solveTwoBone(arm, hand.lerp(grip, grab), elbow, point, aim);
          return;
        }
      }
      const side = Math.sign(shoulder.x - CHAIR_POSITION[0]);
      const thigh = new Vector3(pelvis.x + side * .18, pelvis.y - .10, pelvis.z - .24);
      const target = (DESK_CHAIR_PULL_ENABLED ? point(arm[2]).lerp(thigh,
        couchPhase(progress, lowerStart - .15 / c.duration, lowerStart + .25 / c.duration)) : hands[i].clone()).lerp(new Vector3(CHAIR_POSITION[0] +
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

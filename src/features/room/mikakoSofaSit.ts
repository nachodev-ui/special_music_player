import { AnimationClip, AnimationMixer, Box3, Group, Matrix4, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { COUCH_RECLINE, couchPhase, solveTwoBone, type createReclineClip } from './mikakoRecline';
import { melodyCouch, room3d, type Vec3 } from './room3d.config';

export const COUCH_SIT_IK_ENABLED = true;
// Metros y grados, en el espacio local del sofá medido por measureCouch.
// El rig erguido necesita 16 cm más que la cadera horizontal de recostarse.
export const SIT_PELVIS_LIFT = COUCH_RECLINE.pelvisLift - .015 + .16;
export const SIT_TORSO_LEAN = 10;
export const SIT_X_OFFSET = 0;
export const SIT_HAND_FRACTION = .70;
export const SIT_FOOT_MARGIN = .14;
export const SIT_THIGH_MAX = 25;
const SIT_KNEE_MIN = 110;
const SIT_KNEE_MAX = 155;
const SIT_SHIN_CLEARANCE = .02;
const SIT_SHIN_RADIUS_MIN = .06;
const SIT_GAZE_TURN = 12;
const SIT_CHIN_UP = 3;
const FLOOR_EPSILON = .002;
const DURATION = 3;
const STEPS = 180;
const UP = new Vector3(0, 1, 0);
const FRONT = new Vector3(0, 0, 1);

export function sofaSitRootPosition(progress: number, home: Vec3) {
  return new Vector3(...home).lerp(new Vector3(...room3d.objects.sofa.position), couchPhase(progress, 0, .72));
}

/** Mismo contrato que recostarse; un fallo devuelve una copia del clip de origen. */
export function createSofaSitClip(...args: Parameters<typeof createReclineClip>): AnimationClip {
  try {
    const clip = buildSofaSit(...args);
    if (clip) return clip;
  } catch (error) {
    console.warn('Mikako: no se pudo resolver la sentada IK; se conserva sit-stand.', error);
  }
  return args[1].clone();
}

function buildSofaSit(model: Object3D, standing: AnimationClip, hipName: string,
  scale: Vec3, yawOffset: number, bounds: Parameters<typeof createReclineClip>[5],
  seed: Parameters<typeof createReclineClip>[6]): AnimationClip | null {
  const warned = new Set<string>();
  const warn = (message: string) => {
    if (!warned.has(message)) { warned.add(message); console.warn('Mikako sofá: ' + message); }
  };
  if (bounds.seat.isEmpty() || ![...bounds.seat.min.toArray(), ...bounds.seat.max.toArray(), ...scale].every(Number.isFinite) || scale.some(n => n <= 0)) {
    warn('medidas inválidas; se conserva la pose de reposo.'); return null;
  }
  const rig = clone(model);
  const bones: Bone[] = [];
  const meshes: SkinnedMesh[] = [];
  rig.traverse(node => {
    if ((node as Bone).isBone) bones.push(node as Bone);
    if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh);
  });
  const entry = bones.map(b => ({ q: b.quaternion.clone(), p: b.position.clone() }));
  meshes.forEach(mesh => mesh.skeleton.pose());
  const frame = new Group(), facing = new Group();
  frame.scale.set(...scale); facing.rotation.y = yawOffset;
  frame.add(facing); facing.add(rig); frame.updateMatrixWorld(true);
  const find = (...names: string[]) => {
    const bone = bones.find(b => names.some(n => n.toLowerCase() === b.name.toLowerCase()));
    if (!bone) warn('falta ' + names.join('/') + '; se conserva su reposo.');
    return bone;
  };
  const hip = find(hipName), head = find('head');
  const chest = find('spine_05', 'chest', 'spine2', 'Spine');
  const spine = hip?.children.find(n => /spine|chest/i.test(n.name)) as Bone | undefined;
  if (!hip?.parent || !spine || !chest || !head) return null;
  const chains = (names: string[][]) => {
    const chain = names.map(n => find(...n));
    return chain.every((b): b is Bone => !!b) ? chain : null;
  };
  const legs = [chains([['thigh_l', 'LeftUpLeg'], ['calf_l', 'LeftLeg'], ['foot_l', 'LeftFoot'], ['ball_l', 'LeftToeBase']]),
    chains([['thigh_r', 'RightUpLeg'], ['calf_r', 'RightLeg'], ['foot_r', 'RightFoot'], ['ball_r', 'RightToeBase']])];
  const arms = [chains([['upperarm_l', 'LeftArm'], ['lowerarm_l', 'LeftForeArm'], ['hand_l', 'LeftHand']]),
    chains([['upperarm_r', 'RightArm'], ['lowerarm_r', 'RightForeArm'], ['hand_r', 'RightHand']])];
  if (legs.some(c => !c) || arms.some(c => !c)) return null;
  const legChains = legs as Bone[][], armChains = arms as Bone[][];
  // Ejes de la cara en reposo, antes de muestrear sit-stand: así no se
  // hereda el cabeceo grabado. Mismo marco anatómico que recostarse.
  const inverseRestHead = head.getWorldQuaternion(new Quaternion()).invert();
  const bindForward = legChains.reduce((sum, leg) => sum.add(
    leg[3].getWorldPosition(new Vector3()).sub(leg[2].getWorldPosition(new Vector3()))), new Vector3())
    .projectOnPlane(UP).normalize();
  const headfront = head.children.find(child => child.name === 'headfront');
  const faceLocal = headfront?.position.clone().normalize()
    ?? bindForward.applyQuaternion(inverseRestHead).normalize();
  const headUpLocal = UP.clone().applyQuaternion(inverseRestHead).projectOnPlane(faceLocal).normalize();
  if (faceLocal.lengthSq() < .5 || headUpLocal.lengthSq() < .5) {
    warn('ejes de la cara sin resolver; se conserva su orientación de reposo.');
  }
  const sampler = new AnimationMixer(rig);
  const source = sampler.clipAction(standing); source.play();
  source.time = Math.max(0, Math.min(seed.start, standing.duration)); sampler.update(0);
  frame.updateMatrixWorld(true);
  const point = (node: Object3D) => node.getWorldPosition(new Vector3());
  const basis = (up: Vector3, front: Vector3) => {
    const right = new Vector3().crossVectors(up, front).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right,
      up.clone().normalize(), new Vector3().crossVectors(right, up).normalize()));
  };
  const orient = (bone: Bone, q: Quaternion) => {
    if (!bone.parent || !q.toArray().every(Number.isFinite)) { warn('orientación sin resolver: ' + bone.name); return; }
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(q));
    frame.updateMatrixWorld(true);
  };
  const aim = (bone: Bone, child: Bone, direction: Vector3) => {
    const current = point(child).sub(point(bone));
    if (current.lengthSq() < 1e-12 || direction.lengthSq() < 1e-12) { warn('dirección sin resolver: ' + bone.name); return; }
    orient(bone, new Quaternion().setFromUnitVectors(current.normalize(), direction.clone().normalize())
      .multiply(bone.getWorldQuaternion(new Quaternion())));
  };
  const solve = (chain: Bone[], target: Vector3, pole: Vector3, reachFraction = .999999) => {
    const saved = chain.map(b => b.quaternion.clone());
    const a = point(chain[0]).distanceTo(point(chain[1])), b = point(chain[1]).distanceTo(point(chain[2]));
    if (![...target.toArray(), ...pole.toArray(), a, b].every(Number.isFinite) || Math.min(a, b) < 1e-6) {
      warn('apoyo sin resolver: ' + chain[0].name); return;
    }
    // solveTwoBone limita la distancia para calcular la rodilla, pero apunta
    // la tibia al objetivo original. Limitar también ese objetivo evita que
    // una meta inalcanzable deje la cadena recta y cambie de lado al doblarla.
    const origin = point(chain[0]), delta = target.clone().sub(origin);
    const distance = delta.length();
    if (distance < 1e-7) { warn('objetivo sobre la articulación: ' + chain[0].name); return; }
    const reachable = Math.max(Math.abs(a - b) + 1e-6, Math.min(distance, (a + b) * reachFraction));
    const safeTarget = origin.clone().addScaledVector(delta, reachable / distance);
    solveTwoBone(chain, safeTarget, pole, point, aim);
    if (chain.some(bone => !bone.quaternion.toArray().every(Number.isFinite))) {
      chain.forEach((bone, i) => bone.quaternion.copy(saved[i])); frame.updateMatrixWorld(true);
      warn('IK sin resolver: ' + chain[0].name);
    }
  };
  // Alinear la cadera desde los ejes anatómicos, sin presuponer ejes locales del rig.
  const restUp = point(spine).sub(point(hip)).normalize();
  const restFront = legChains.reduce((sum, leg) => sum.add(point(leg[3]).sub(point(leg[2]))), new Vector3())
    .projectOnPlane(restUp).normalize();
  if (restFront.lengthSq() < .5) { warn('frente del modelo sin resolver.'); return null; }
  orient(hip, basis(UP, FRONT).multiply(basis(restUp, restFront).invert()).multiply(hip.getWorldQuaternion(new Quaternion())));
  const base = bones.map(b => ({ q: b.quaternion.clone(), p: b.position.clone() }));
  const reset = () => {
    bones.forEach((b, i) => { b.quaternion.copy(base[i].q); b.position.copy(base[i].p); });
    frame.updateMatrixWorld(true);
  };
  // Superficies del vestido/cuerpo, no las posiciones de los huesos. Las muestras
  // quedan en el espacio de cada hueso y conservan la escala métrica del sofá.
  const vertexCache = new Map<string, { mesh: SkinnedMesh; indices: number[] }[]>();
  const surface = (selected: Bone[], accept: (p: Vector3) => boolean = () => true, minimumWeight = .4) => {
    const samples: Vector3[] = [];
    const key = selected.map(b => b.uuid).join('/') + ':' + minimumWeight;
    let cached = vertexCache.get(key);
    if (!cached) {
      cached = [];
      for (const mesh of meshes) {
        const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
        if (!indices || !weights) continue;
        const selectedIndices = new Set(selected.map(b => mesh.skeleton.bones.indexOf(b)));
        const vertices: number[] = [];
        for (let i = 0; i < indices.count; i++) {
          let weight = 0;
          for (let k = 0; k < 4; k++) if (selectedIndices.has(indices.getComponent(i, k))) weight += weights.getComponent(i, k);
          if (weight >= minimumWeight) vertices.push(i);
        }
        cached.push({ mesh, indices: vertices });
      }
      vertexCache.set(key, cached);
    }
    for (const { mesh, indices } of cached) for (const i of indices) {
      const p = mesh.localToWorld(mesh.getVertexPosition(i, new Vector3()));
      if (accept(p)) samples.push(p);
    }
    return samples;
  };
  const hipRest = point(hip), chestRest = point(chest);
  const chestBones = bones.filter(b => /spine|chest/i.test(b.name));
  const backSamples = surface(chestBones, p => Math.abs(p.y - chestRest.y) < .09 && Math.abs(p.x - chestRest.x) < .15);
  const back = backSamples.sort((a, b) => a.z - b.z)[0];
  const backLocal = back ? chest.worldToLocal(back.clone()) : null;
  if (!backLocal) warn('superficie de espalda sin resolver; se conserva la inclinación de reposo.');
  const legData = legChains.map(leg => {
    const start = point(leg[0]), knee = point(leg[1]), ankle = point(leg[2]);
    const vertices = surface([leg[2], leg[3]]);
    const sole = vertices.length ? Math.min(...vertices.map(p => p.y)) : 0;
    const thighVertices = surface([leg[0]], p => {
      const t = p.clone().sub(start).dot(knee.clone().sub(start)) / start.distanceToSquared(knee);
      return t > .45 && t < .85;
    });
    const shinAxis = ankle.clone().sub(knee).normalize();
    const shinVertices = surface([leg[1]], p => {
      const t = p.clone().sub(knee).dot(shinAxis) / knee.distanceTo(ankle);
      return t >= 0 && t <= 1;
    });
    const shinRadius = Math.max(SIT_SHIN_RADIUS_MIN, ...shinVertices.map(p =>
      p.clone().sub(knee).projectOnPlane(shinAxis).length()));
    const axis = knee.clone().sub(start).normalize();
    const radius = thighVertices.length ? Math.max(...thighVertices.map(p => p.clone().sub(start).projectOnPlane(axis).length())) : .075;
    if (!vertices.length || !thighVertices.length) warn('superficie de pierna incompleta: ' + leg[0].name);
    return { length: start.distanceTo(knee), shin: knee.distanceTo(ankle), ankleLift: Math.max(.02, ankle.y - sole),
      radius, shinRadius, footQ: leg[2].getWorldQuaternion(new Quaternion()), start, knee, ankle };
  });
  const handData = armChains.map(arm => {
    const hand = arm[2], wrist = point(hand), q = hand.getWorldQuaternion(new Quaternion());
    const samples = surface([hand], () => true, .95).map(p => p.sub(wrist).applyQuaternion(q.clone().invert()));
    if (!samples.length) warn('palma sin resolver: ' + hand.name);
    const box = new Box3().setFromPoints(samples), size = box.getSize(new Vector3());
    const long = samples.reduce((sum, p) => sum.add(p), new Vector3()).normalize();
    if (long.lengthSq() < .5) long.copy(point(hand).sub(point(arm[1])).normalize().applyQuaternion(q.clone().invert()));
    const axis = size.x < size.y && size.x < size.z ? new Vector3(1, 0, 0)
      : size.y < size.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const normal = axis.projectOnPlane(long).normalize();
    if (normal.clone().applyQuaternion(q).dot(FRONT) > 0) normal.negate();
    const palmQ = basis(new Vector3(0, -1, 0), FRONT).multiply(basis(normal, long).invert());
    const rotated = samples.map(p => p.clone().applyQuaternion(palmQ));
    const bottom = rotated.sort((a, b) => a.y - b.y)[0] ?? new Vector3(0, -.025, 0);
    return { q: palmQ, bottom };
  });
  // Reservar el ancho completo de piernas/brazos en el tramo libre del asiento.
  const halfWidth = Math.max(...legData.map(d => Math.abs(d.start.x - hipRest.x) + d.radius), .20) + .025;
  const blocked = bounds.plush.clone().expandByScalar(COUCH_RECLINE.plushClearance);
  const intervals = blocked.isEmpty() || blocked.max.z < bounds.seat.min.z || blocked.min.z > bounds.seat.max.z
    ? [[bounds.seat.min.x, bounds.seat.max.x]]
    : [[bounds.seat.min.x, Math.min(bounds.seat.max.x, blocked.min.x)],
      [Math.max(bounds.seat.min.x, blocked.max.x), bounds.seat.max.x]];
  const free = intervals.filter(([a, b]) => b - a >= 2 * halfWidth).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  if (!free) { warn('no hay un tramo libre para sentarse sin tocar el peluche/reposabrazos.'); return null; }
  const x = Math.max(free[0] + halfWidth, Math.min(free[1] - halfWidth, (free[0] + free[1]) / 2 + SIT_X_OFFSET));
  const pelvis = new Vector3(x, bounds.seat.max.y + SIT_PELVIS_LIFT, bounds.seat.min.z + .14);
  const rootLocal = (p: number) => sofaSitRootPosition(p, seed.home).sub(new Vector3(...room3d.objects.sofa.position))
    .applyAxisAngle(UP, -room3d.objects.sofa.rotation[1]);
  const placeHip = (p: Vector3) => { hip.position.copy(hip.parent!.worldToLocal(p.clone())); frame.updateMatrixWorld(true); };
  const spineQ = new Quaternion().setFromUnitVectors(point(chest).sub(point(spine)).normalize(), UP)
    .multiply(spine.getWorldQuaternion(new Quaternion()));
  // measureCouch conserva la cara delantera completa en seat.max.z. Se
  // deshacen sus insets para recuperar X/Z del GLB completo; Y incluye base,
  // brazos y respaldo. La cota de fit es conservadora si cambia el modelo.
  const sofaBox = new Box3(
    new Vector3(bounds.seat.min.x - COUCH_RECLINE.armrestInset, 0,
      bounds.seat.min.z - COUCH_RECLINE.backrestInset),
    new Vector3(bounds.seat.max.x + COUCH_RECLINE.armrestInset,
      Math.max(bounds.seat.max.y, room3d.objects.sofa.size[1] * melodyCouch.modelScale), bounds.seat.max.z),
  );
  const floorY = -room3d.objects.sofa.position[1] / room3d.objects.sofa.scale[1];
  const boxClearance = (p: Vector3) => {
    const outside = p.distanceTo(sofaBox.clampPoint(p, new Vector3()));
    if (outside > 0) return outside;
    return -Math.min(p.x - sofaBox.min.x, sofaBox.max.x - p.x,
      p.y - sofaBox.min.y, sofaBox.max.y - p.y, p.z - sofaBox.min.z, sofaBox.max.z - p.z);
  };
  type LegSupport = { knee: Vector3; foot: Vector3; q: Quaternion; thigh: number;
    bend: number; clearance: number; penetration: number; footDeficit: number; reachExcess: number; score: number };
  const chooseLegSupport = (leg: Bone[], d: typeof legData[number]): LegSupport => {
    const origin = point(leg[0]), ankle = point(leg[2]);
    const q = new Quaternion().setFromAxisAngle(UP,
      Math.sign(d.start.x - hipRest.x) * 10 * Math.PI / 180).multiply(d.footQ);
    const inverseFoot = leg[2].getWorldQuaternion(new Quaternion()).invert();
    const sole = surface([leg[2], leg[3]]).map(p => p.sub(ankle).applyQuaternion(inverseFoot).applyQuaternion(q));
    const minY = sole.length ? Math.min(...sole.map(p => p.y)) : -d.ankleLift;
    const minZ = sole.length ? Math.min(...sole.map(p => p.z)) : -.08;
    const ankleY = floorY + FLOOR_EPSILON - minY;
    const minimumZ = sofaBox.max.z + SIT_FOOT_MARGIN - minZ;
    let best: LegSupport | undefined;
    for (let degrees = 0; degrees <= SIT_THIGH_MAX; degrees++) {
      const angle = degrees * Math.PI / 180;
      const knee = origin.clone().add(new Vector3(0, Math.sin(angle), Math.cos(angle)).multiplyScalar(d.length));
      // Intersección exacta de la tibia con el suelo: no se fuerza el tobillo
      // después de limitar un ángulo, lo que antes cambiaba toda la solución IK.
      const drop = Math.max(-d.shin, Math.min(d.shin, ankleY - knee.y));
      const foot = knee.clone().add(new Vector3(0, drop, Math.sqrt(Math.max(0, d.shin ** 2 - drop ** 2))));
      const bend = origin.clone().sub(knee).angleTo(foot.clone().sub(knee)) * 180 / Math.PI;
      const reachExcess = Math.max(0, origin.distanceTo(foot) - (.98 * d.length + d.shin));
      let clearance = Infinity, penetration = 0;
      for (let sample = 0; sample < 10; sample++) {
        const gap = boxClearance(knee.clone().lerp(foot, sample / 9));
        clearance = Math.min(clearance, gap);
        penetration += Math.max(0, SIT_SHIN_CLEARANCE - gap);
      }
      const footDeficit = Math.max(0, minimumZ - foot.z);
      const angleDeficit = Math.max(0, SIT_KNEE_MIN - bend, bend - SIT_KNEE_MAX);
      const floorDeficit = Math.abs(foot.y - ankleY);
      const valid = reachExcess <= 1e-8 && floorDeficit <= 1e-8 && footDeficit <= 1e-8 &&
        clearance >= SIT_SHIN_CLEARANCE + d.shinRadius && angleDeficit <= 1e-8;
      const score = penetration + footDeficit + floorDeficit + reachExcess + angleDeficit / 180;
      const candidate = { knee, foot, q, thigh: degrees, bend, clearance, penetration, footDeficit, reachExcess, score };
      // Primer válido: menor elevación de muslo, con pasos de un grado.
      if (valid) return candidate;
      if (!best || penetration < best.penetration - 1e-8 ||
        Math.abs(penetration - best.penetration) <= 1e-8 && score < best.score) best = candidate;
    }
    // Si el mueble hace imposible el intervalo, también considerar el objetivo
    // de pie más próximo en el suelo. Se conserva la longitud de ambos huesos:
    // desplazar la rodilla por un pole arbitrario no vuelve alcanzable un pie.
    const maximumReach = .98 * d.length + d.shin;
    const vertical = ankleY - origin.y;
    if (Math.abs(vertical) < maximumReach) {
      const furthestZ = origin.z + Math.sqrt(maximumReach ** 2 - vertical ** 2);
      const foot = new Vector3(origin.x, ankleY, Math.min(minimumZ, furthestZ));
      const delta = foot.clone().sub(origin), distance = delta.length(), direction = delta.clone().normalize();
      if (distance > Math.abs(d.length - d.shin) + 1e-7 && distance < d.length + d.shin) {
        const along = (d.length ** 2 - d.shin ** 2 + distance ** 2) / (2 * distance);
        const height = Math.sqrt(Math.max(0, d.length ** 2 - along ** 2));
        const knee = origin.clone().addScaledVector(direction, along)
          .addScaledVector(UP.clone().projectOnPlane(direction).normalize(), height);
        const thigh = Math.asin(Math.max(-1, Math.min(1, (knee.y - origin.y) / d.length))) * 180 / Math.PI;
        const bend = origin.clone().sub(knee).angleTo(foot.clone().sub(knee)) * 180 / Math.PI;
        let clearance = Infinity, penetration = 0;
        for (let sample = 0; sample < 10; sample++) {
          const gap = boxClearance(knee.clone().lerp(foot, sample / 9));
          clearance = Math.min(clearance, gap);
          penetration += Math.max(0, SIT_SHIN_CLEARANCE - gap);
        }
        const footDeficit = Math.max(0, minimumZ - foot.z);
        const angleDeficit = Math.max(0, -thigh, thigh - SIT_THIGH_MAX) + Math.max(0, SIT_KNEE_MIN - bend, bend - SIT_KNEE_MAX);
        const score = penetration + footDeficit + angleDeficit / 180;
        if (!best || penetration < best.penetration - 1e-8 ||
          Math.abs(penetration - best.penetration) <= 1e-8 && score < best.score) {
          best = { knee, foot, q, thigh, bend, clearance, penetration, footDeficit, reachExcess: 0, score };
        }
      }
    }
    const nearest = best!; // El intervalo incluye siempre el ángulo cero.
    warn('sin apoyo completo para ' + leg[0].name + ': ' + JSON.stringify({
      muslo: nearest.thigh, rangoMuslo: [0, SIT_THIGH_MAX], rodilla: nearest.bend,
      rangoRodilla: [SIT_KNEE_MIN, SIT_KNEE_MAX], holguraMin: nearest.clearance,
      holguraExigida: SIT_SHIN_CLEARANCE, deficitFrente: nearest.footDeficit,
      excesoAlcance: nearest.reachExcess, distancia: origin.distanceTo(nearest.foot),
      alcanceMax: .98 * d.length + d.shin, suelo: floorY, tobilloY: nearest.foot.y,
    }) + '; se usa la solución de menor penetración, sin rebajar la holgura exigida.');
    return nearest;
  };
  // Resolver el contacto de la espalda dentro del intervalo pedido (8–12 grados).
  // El punto superficial se comprueba de nuevo después de aplicar la inclinación.
  let lean = SIT_TORSO_LEAN;
  frame.position.set(0, 0, 0); reset(); placeHip(pelvis);
  if (backLocal) {
    let best = Infinity;
    for (let angle = SIT_TORSO_LEAN - 2; angle <= SIT_TORSO_LEAN + 2; angle += .1) {
      orient(spine, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -angle * Math.PI / 180).multiply(spineQ));
      const gap = chest.localToWorld(backLocal.clone()).z - bounds.seat.min.z;
      const cost = Math.abs(gap - .01) + (gap < 0 ? 10 : 0);
      if (cost < best) { best = cost; lean = angle; }
    }
  }
  // Los ángulos no pueden sacar la rodilla de una caja si la cadera está
  // demasiado atrás. Deslizar el apoyo hacia el borde, conservando altura,
  // inclinación y eje lateral; no aceptar otra pose que siga cortando la base.
  // La holgura incluye el volumen de la pantorrilla, no solo su hueso.
  const advance = Math.max(0, ...legChains.map((leg, i) =>
    sofaBox.max.z + SIT_SHIN_CLEARANCE + legData[i].shinRadius + .003 -
      (point(leg[0]).z + legData[i].length)));
  if (advance > 0) {
    const frontLimit = bounds.seat.max.z - .12;
    const safeAdvance = Math.max(0, Math.min(advance, frontLimit - pelvis.z));
    pelvis.z += safeAdvance;
    placeHip(pelvis);
    if (safeAdvance < advance - 1e-6) warn('asiento insuficiente para despejar la base: avance requerido ' +
      advance.toFixed(3) + ' m, disponible ' + safeAdvance.toFixed(3) + ' m.');
  }
  const legSupports = legChains.map((leg, i) => chooseLegSupport(leg, legData[i]));
  reset();
  const times: number[] = [], rotations = bones.map(() => [] as number[]), positions = bones.map(() => [] as number[]);
  frame.position.copy(rootLocal(0)); reset();
  if (seed.fromCurrentPose) bones.forEach((b, i) => { b.quaternion.copy(entry[i].q); b.position.copy(entry[i].p); });
  frame.updateMatrixWorld(true);
  const initial = point(hip);
  const planted = legChains.map(leg => point(leg[2]));
  // Guardar el plano de flexión de entrada como dirección, no como una
  // posición de rodilla. Interpolar posiciones cruzaba el eje cadera–pie y
  // hacía que la rodilla cambiara de lado a mitad del clip.
  const entryPoles = legChains.map((leg, i) => {
    const origin = point(leg[0]);
    const direction = planted[i].clone().sub(origin).normalize();
    const bend = point(leg[1]).sub(origin).projectOnPlane(direction);
    const forward = FRONT.clone().projectOnPlane(direction).normalize();
    return bend.lengthSq() > 1e-6 && bend.dot(forward) > 0 ? bend.normalize() : forward;
  });
  const turnSign = Math.sign(new Vector3(...room3d.camera.position).sub(new Vector3(...room3d.objects.sofa.position))
    .applyAxisAngle(UP, -room3d.objects.sofa.rotation[1]).x) || 1;
  for (let step = 0; step <= STEPS; step++) {
    const p = step / STEPS;
    frame.position.copy(rootLocal(p)); reset();
    const descent = couchPhase(p, .12, .73), entryWeight = couchPhase(p, 0, .25);
    if (seed.fromCurrentPose) bones.forEach((b, i) => {
      b.quaternion.copy(entry[i].q).slerp(base[i].q, entryWeight);
      b.position.copy(entry[i].p).lerp(base[i].p, entryWeight);
    });
    frame.updateMatrixWorld(true);
    // Arco: el retroceso empieza antes que el descenso; sus velocidades se solapan.
    const target = initial.clone().lerp(pelvis, couchPhase(p, 0, .72));
    target.y = initial.y + (pelvis.y - initial.y) * descent;
    // El contacto baja 15 mm y recupera 5 mm en 0.25 s; el extremo es pelvis.
    target.y += .010 * descent - .015 * couchPhase(p, .68, .72) + .005 * couchPhase(p, .72, .72 + .25 / DURATION);
    placeHip(target);
    // Pies y pelvis comparten el descenso. No adelantar los pies mientras la
    // cadera sigue alta: esa combinación sobreextendía ambas piernas.
    const legWeight = descent;
    const reachFraction = .999999 + (.995 - .999999) * couchPhase(p, 0, .2);
    let hipDrop = 0;
    legChains.forEach((leg, i) => {
      const origin = point(leg[0]);
      const foot = planted[i].clone().lerp(legSupports[i].foot, legWeight);
      const reach = (legData[i].length + legData[i].shin) * reachFraction;
      const horizontalSq = (foot.x - origin.x) ** 2 + (foot.z - origin.z) ** 2;
      if (horizontalSq < reach ** 2) {
        const highestHip = foot.y + Math.sqrt(reach ** 2 - horizontalSq);
        hipDrop = Math.max(hipDrop, origin.y - highestHip);
      } else warn('paso horizontal fuera del alcance: ' + leg[0].name + '; se usa el objetivo alcanzable más próximo.');
    });
    if (hipDrop > 0) { target.y -= hipDrop; placeHip(target); }
    const settling = couchPhase(p, .69, .89);
    const pitch = (10 * couchPhase(p, .08, .48) * (1 - settling) - lean * settling) * Math.PI / 180;
    const beforeSpine = spine.getWorldQuaternion(new Quaternion());
    orient(spine, beforeSpine.slerp(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch).multiply(spineQ), entryWeight));
    // Objetivo de cara en espacio del sofá, independiente del cuello y del
    // pitch grabado. La mirada ya queda nivelada cuando empieza el descenso.
    if (faceLocal.lengthSq() >= .5 && headUpLocal.lengthSq() >= .5) {
      const gazeWeight = couchPhase(p, 0, .12);
      const yaw = turnSign * SIT_GAZE_TURN * Math.PI / 180;
      const chin = SIT_CHIN_UP * Math.PI / 180;
      const look = new Vector3(Math.sin(yaw) * Math.cos(chin), Math.sin(chin), Math.cos(yaw) * Math.cos(chin));
      const desired = basis(UP.clone().projectOnPlane(look).normalize(), look)
        .multiply(basis(headUpLocal, faceLocal).invert());
      const headBefore = head.getWorldQuaternion(new Quaternion());
      const targetHead = headBefore.clone().slerp(desired, gazeWeight);
      const neck = head.parent as Bone;
      if (neck.isBone) {
        const correction = targetHead.clone().multiply(headBefore.clone().invert());
        orient(neck, new Quaternion().slerp(correction, .5).multiply(neck.getWorldQuaternion(new Quaternion())));
      }
      orient(head, targetHead);
    }
    for (let i = 0; i < legChains.length; i++) {
      const leg = legChains[i], support = legSupports[i];
      const weight = legWeight;
      const footTarget = planted[i].clone().lerp(support.foot, weight);
      const origin = point(leg[0]), direction = footTarget.clone().sub(origin).normalize();
      const forward = FRONT.clone().projectOnPlane(direction).normalize();
      const entryPole = entryPoles[i].clone().projectOnPlane(direction);
      if (entryPole.lengthSq() < 1e-6 || entryPole.dot(forward) < 0) entryPole.copy(forward);
      else entryPole.normalize();
      const poleDirection = entryPole.lerp(forward, couchPhase(p, 0, .25)).normalize();
      const pole = origin.clone().addScaledVector(poleDirection, legData[i].length + legData[i].shin);
      solve(leg, footTarget, pole, reachFraction);
      const ankleQ = leg[2].getWorldQuaternion(new Quaternion()).slerp(support.q, weight);
      orient(leg[2], ankleQ);
      // Corregir sobre la suela deformada, sin bajar nunca el pie por debajo
      // del suelo. El apoyo final conserva las longitudes del esqueleto.
      for (let correction = 0; correction < 2; correction++) {
        const sole = surface([leg[2], leg[3]]);
        const floorGap = sole.length ? Math.min(...sole.map(v => v.y)) - floorY : 0;
        if (floorGap >= FLOOR_EPSILON - .0001) break;
        footTarget.y += FLOOR_EPSILON - floorGap;
        solve(leg, footTarget, pole, reachFraction); orient(leg[2], ankleQ);
      }
    }
    for (let i = 0; i < armChains.length; i++) {
      const arm = armChains[i], leg = legChains[i], hand = handData[i];
      const fraction = .94 + (SIT_HAND_FRACTION - .94) * settling;
      const thigh = point(leg[0]).lerp(point(leg[1]), fraction);
      // Elegir un punto real de la superficie superior a la altura de apoyo.
      // Se comprueba sobre la piel deformada, incluyendo la ropa de cada outfit.
      const candidates = surface([leg[0]], v => Math.hypot(v.x - thigh.x, v.z - thigh.z) < .065);
      const top = candidates.sort((a, b) => b.y - a.y)[0];
      if (top) thigh.copy(top);
      else { thigh.y += legData[i].radius; warn('superficie del muslo sin resolver: ' + leg[0].name); }
      const support = thigh.sub(hand.bottom).addScaledVector(UP, .004);
      const weight = couchPhase(p, .06, .62);
      const handTarget = point(arm[2]).lerp(support, weight);
      const shoulder = point(arm[0]);
      const pole = point(arm[1]).lerp(new Vector3(shoulder.x * .9 + pelvis.x * .1, shoulder.y - .22, shoulder.z - .18), weight);
      solve(arm, handTarget, pole);
      orient(arm[2], arm[2].getWorldQuaternion(new Quaternion()).slerp(hand.q, weight));
    }
    times.push(p * DURATION);
    bones.forEach((b, i) => {
      if (![...b.quaternion.toArray(), ...b.position.toArray()].every(Number.isFinite)) {
        b.quaternion.copy(base[i].q); b.position.copy(base[i].p); warn('frame sin resolver: ' + b.name);
      }
      rotations[i].push(...b.quaternion.toArray()); positions[i].push(...b.position.toArray());
    });
  }
  sampler.stopAllAction(); sampler.uncacheRoot(rig);
  return AnimationClip.parse({ name: 'mikako-sofa-sit', duration: DURATION,
    uuid: new AnimationClip().uuid, blendMode: standing.blendMode,
    tracks: bones.flatMap((b, i) => [
      { name: b.name + '.quaternion', type: 'quaternion', times, values: rotations[i] },
      { name: b.name + '.position', type: 'vector', times, values: positions[i] },
    ]) });
}

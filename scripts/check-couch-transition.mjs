// Comprobación numérica, sin renderer, app, build ni suite de tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { AnimationClip, AnimationMixer, Box3, Group, Quaternion, Ray, Triangle, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
// GLTFLoader emite progreso también al leer buffers locales en Node.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) { super(type); Object.assign(this, values); }
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await fs.mkdtemp(path.join(root, 'output', 'couch-check-'));
const emit = async (name, source) => {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await fs.writeFile(path.join(work, name), js);
  return pathToFileURL(path.join(work, name)).href;
};
const config = await import(await emit('config.mjs', await fs.readFile(path.join(root, 'src/features/room/room3d.config.ts'), 'utf8')));
const source = await fs.readFile(path.join(root, 'src/features/room/mikakoRecline.ts'), 'utf8');
const motion = await import(await emit('recline.mjs', source.replace("'./room3d.config'", "'./config.mjs'")));
const { room3d, melodyCouch } = config;
const load = async name => {
  const bytes = await fs.readFile(path.join(root, 'public/assets/room3d', name + '.glb'));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material;
  delete json.images; delete json.textures; delete json.materials;
  if (json.buffers?.[0]) json.buffers[0].uri = 'data:application/octet-stream;base64,' + bytes.subarray(28 + length).toString('base64');
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene;
};
const sofa = await load(room3d.objects.sofa.model), plush = await load(room3d.plushies.sofa.model);
const rawBox = new Box3().setFromObject(sofa, true), center = rawBox.getCenter(new Vector3());
const offset = new Vector3(center.x, rawBox.min.y, center.z);
const fit = room3d.objects.sofa.size[0] / rawBox.getSize(new Vector3()).x;
const fitted = rawBox.clone().translate(offset.clone().negate());
fitted.min.multiplyScalar(fit); fitted.max.multiplyScalar(fit);
const bounds = motion.measureCouch(fitted, new Box3().setFromObject(plush, true));
// Máscara geométrica del cojín y respaldo de melody_couch, en metros.
// Los reposabrazos son apoyos de la pose final existente y no se confunden con el cojín.
const surfaces = { cushionHalfWidth: .56, cushionHeightBand: .06, backHalfWidth: .65, backBottom: .12, backFront: .1 };
const triangles = [];
sofa.updateMatrixWorld(true);
sofa.traverse(node => {
  if (!node.isMesh) return;
  const positions = node.geometry.attributes.position, indices = node.geometry.index;
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    const points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j).applyMatrix4(node.matrixWorld).sub(offset).multiplyScalar(fit));
    const tri = new Triangle(...points), normal = tri.getNormal(new Vector3()), mid = tri.getMidpoint(new Vector3());
    const seat = Math.abs(mid.x) < surfaces.cushionHalfWidth && Math.abs(mid.y - melodyCouch.seatHeight) < surfaces.cushionHeightBand && normal.y > .35;
    const back = Math.abs(mid.x) < surfaces.backHalfWidth && mid.y > melodyCouch.seatHeight + surfaces.backBottom && mid.z < surfaces.backFront && normal.z > .45;
    if (seat || back) triangles.push({ tri, box: new Box3().setFromPoints(points) });
  }
});
const expected = {"rosa":"6822ca33865a3ee65d045bb4f2c16dffd6fb59bed95b3c8dcf225e12164db82a","cuadros":"0ae48d6210bbf3abeed1042bea09daea8c070c012f8b5f0508f670839dc1f46a"};
const finalHash = clip => createHash('sha256').update(JSON.stringify(clip.tracks.map(t => ({ name: t.name, values: Array.from(t.values.slice(-t.getValueSize())) })))).digest('hex');
const results = [];
for (const outfit of room3d.mikako.outfits) {
  const rig = await load(outfit.model), json = JSON.parse(await fs.readFile(path.join(root, 'public/assets/room3d', outfit.clips['sit-stand']), 'utf8'));
  if (typeof json.userData !== 'string') json.userData = JSON.stringify(json.userData ?? {});
  const sit = AnimationClip.parse(json), timing = outfit.sitTiming ?? { start: .6, seated: 2.2 };
  const names = outfit.id === 'rosa' ? [['thigh_l', 'calf_l', 'foot_l', 'ball_l'], ['thigh_r', 'calf_r', 'foot_r', 'ball_r']] : [['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'], ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']];
  rig.updateMatrixWorld(true);
  const forward = rig.getObjectByName(names[0][3]).getWorldPosition(new Vector3()).sub(rig.getObjectByName(names[0][2]).getWorldPosition(new Vector3()));
  const yaw = outfit.yawOffset === 'auto' ? -Math.atan2(forward.x, forward.z) : outfit.yawOffset ?? 0;
  const initial = new AnimationMixer(rig); initial.clipAction(sit).play(); initial.setTime(timing.start);
  const clip = motion.createReclineClip(rig, sit, outfit.hip, room3d.mikako.scale, yaw, bounds, { start: timing.start, end: timing.seated, home: room3d.mikako.position, fromCurrentPose: true });
  let initialPoseError = 0, initialPositionError = 0;
  for (const track of clip.tracks) {
    const node = rig.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.')));
    if (track.name.endsWith('.quaternion')) initialPoseError = Math.max(initialPoseError,
      node.quaternion.clone().normalize().angleTo(new Quaternion().fromArray(track.values).normalize()));
    else initialPositionError = Math.max(initialPositionError, node.position.distanceTo(new Vector3().fromArray(track.values)));
  }
  const frame = new Group(), facing = new Group(), model = clone(rig);
  frame.scale.set(...room3d.mikako.scale); facing.rotation.y = yaw; frame.add(facing); facing.add(model);
  const mixer = new AnimationMixer(model); mixer.clipAction(clip).play();
  let planted, fixedPelvis, maxSlip = 0, pelvisDrift = 0, minFurnitureGap = Infinity, minPlushGap = Infinity, intersections = 0, reverseError = 0;
  const forwardPoses = [];
  for (const direction of [1, -1]) for (let step = 0; step <= 600; step++) {
    const n = direction === 1 ? step : 600 - step, t = n / 600;
    mixer.setTime(Math.min(t * clip.duration, clip.duration - 1e-8));
    frame.position.copy(motion.couchRootPosition(t, room3d.mikako.position).sub(new Vector3(...room3d.objects.sofa.position)).applyAxisAngle(new Vector3(0, 1, 0), -room3d.objects.sofa.rotation[1]));
    frame.updateMatrixWorld(true);
    const pelvis = model.getObjectByName(outfit.hip).getWorldPosition(new Vector3());
    const legs = names.map(chain => chain.map(name => model.getObjectByName(name).getWorldPosition(new Vector3())));
    planted ??= legs.map(chain => chain[2].clone());
    if (t <= motion.COUCH_RECLINE.feetLiftStart) legs.forEach((chain, i) => { maxSlip = Math.max(maxSlip, Math.hypot(chain[2].x - planted[i].x, chain[2].z - planted[i].z)); });
    if (t >= motion.COUCH_RECLINE.seatEnd) { fixedPelvis ??= pelvis.clone(); pelvisDrift = Math.max(pelvisDrift, pelvis.distanceTo(fixedPelvis)); }
    const pose = [pelvis, ...legs.flat()].flatMap(p => p.toArray());
    if (direction === 1) forwardPoses[n] = pose;
    else pose.forEach((value, i) => { reverseError = Math.max(reverseError, Math.abs(value - forwardPoses[n][i])); });
    const capsules = [[pelvis, pelvis, .1], ...legs.flatMap(chain => chain.slice(0, -1).map((p, i) => [p, chain[i + 1], i === 2 ? .02 : motion.COUCH_RECLINE.legRadius]))];
    for (const [a, b, radius] of capsules) {
      const box = new Box3().setFromPoints([a, b]).expandByScalar(radius + .02), ray = new Ray(a, b.clone().sub(a).normalize()), q = new Vector3();
      const samples = Array.from({ length: 21 }, (_, i) => a.clone().lerp(b, i / 20));
      for (const p of samples) minPlushGap = Math.min(minPlushGap, bounds.plush.distanceToPoint(p) - radius - motion.COUCH_RECLINE.plushClearance);
      for (const { tri, box: surface } of triangles) {
        if (!box.intersectsBox(surface)) continue;
        if (a.distanceTo(b) > 1e-7 && ray.intersectTriangle(tri.a, tri.b, tri.c, false, q) && q.distanceTo(a) < a.distanceTo(b)) intersections++;
        for (const p of samples) { tri.closestPointToPoint(p, q); minFurnitureGap = Math.min(minFurnitureGap, p.distanceTo(q) - radius); }
      }
    }
  }
  results.push({ outfit: outfit.id, samples: 1202, initialPoseError, initialPositionError, intersections, minFurnitureGap, minPlushGap, maxSlip, pelvisDrift, reverseError, finalUnchanged: finalHash(clip) === expected[outfit.id] });
}
await fs.writeFile(path.join(root, 'output/couch-transition-report.json'), JSON.stringify({ units: 'metros', surfaces, results }, null, 2));
for (const name of ['config.mjs', 'recline.mjs']) await fs.unlink(path.join(work, name));
await fs.rmdir(work);
console.log(JSON.stringify(results, null, 2));
if (results.some(r => r.initialPoseError > .00001 || r.initialPositionError > .00001 || r.intersections || r.minFurnitureGap < 0 || r.minPlushGap < 0 || r.maxSlip > .0005 || r.pelvisDrift > .00001 || r.reverseError > .00001 || !r.finalUnchanged)) throw new Error('Hay un apoyo fuera de tolerancia.');

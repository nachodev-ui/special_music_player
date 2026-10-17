import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const input = new URL('../public/assets/room3d/models/mikako.glb', import.meta.url);
const output = new URL('../public/assets/room3d/models/mikako.opt.glb', import.meta.url);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const document = await io.read(fileURLToPath(input));
const triangles = () => document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const before = triangles();
// Toon rendering uses only the original base color. Remove unused PBR maps.
for (const material of document.getRoot().listMaterials()) {
  material.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0);
}
await document.transform(prune(), dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 18000 / before, error: 0.02 }));
if (triangles() > 20000) {
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 18000 / triangles(), error: 0.1 }));
}
if (triangles() > 20000 || triangles() < 15000) throw new Error('Simplification outside 15–20k triangle budget: ' + triangles());
await document.transform(
  textureCompress({ encoder: sharp, resize: [2048, 2048] }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(fileURLToPath(output), document);
console.log(JSON.stringify({ trianglesBefore: before, trianglesAfter: triangles(), bytesBefore: (await stat(input)).size, bytesAfter: (await stat(output)).size, textures: document.getRoot().listTextures().map(t => ({ name: t.getName(), size: t.getSize() })) }, null, 2));

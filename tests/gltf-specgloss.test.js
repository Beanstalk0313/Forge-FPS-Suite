import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { playerRigFixture } from '../toolsuite/desktop/rig-test-fixture.cjs';
import { createGLTFLoader, specularGlossinessPlugin, specularToMetalness, SPECULAR_GLOSSINESS } from '../src/systems/GLTFLoaders.js';
import { disposeObject3D } from '../src/systems/Materials.js';

/**
 * Regression coverage for the legacy specular-glossiness shim.
 *
 * three r150+ deleted KHR_materials_pbrSpecularGlossiness from GLTFLoader, and
 * the exporters that still emit it (Sketchfab downloads, older Blender and
 * Substance pipelines) keep *every* texture inside the extension. A bare
 * loader therefore builds untouched white MeshStandardMaterials and never even
 * requests the embedded images: the model renders flat white with no error.
 *
 * Node has no image decoder (neither `createImageBitmap` nor `document`), so
 * these tests stub only the decode step through GLTFLoader's documented
 * `loadTexture` plugin hook and let the real material path run. The browser
 * suite (toolsuite/desktop/ui-test) decodes the same fixture for real.
 */
const bytes = options => { const data = playerRigFixture(options); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
const materialOf = gltf => gltf.scene.getObjectByName('ArmsMesh').material;
const near = (a, b) => Math.abs(a - b) < 1e-3;
/** Records which texture indices the loader asks for and answers with a stand-in image. */
function stubTextures() {
  const requested = [];
  const plugin = () => ({
    name: 'forge-test-texture-stub',
    loadTexture(index) { requested.push(index); return Promise.resolve(new THREE.Texture({ width: 8, height: 8 })); }
  });
  return { requested, plugin };
}
const loading = (options = {}) => {
  const { requested, plugin } = stubTextures();
  const loader = createGLTFLoader();
  loader.register(plugin);
  return { requested, load: () => loader.parseAsync(bytes(options), '') };
};

test('the plugin claims only materials that declare the legacy extension', () => {
  const plugin = specularGlossinessPlugin({ json: { materials: [{ extensions: { [SPECULAR_GLOSSINESS]: {} } }, { pbrMetallicRoughness: {} }] } });
  assert.equal(plugin.name, SPECULAR_GLOSSINESS);
  assert.equal(plugin.getMaterialType(0), THREE.MeshStandardMaterial);
  assert.equal(plugin.getMaterialType(1), null);
  assert.equal(plugin.getMaterialType(99), null);
});

test('dielectric specular stays non-metallic when it maps to metalness', () => {
  assert.equal(specularToMetalness([0.04, 0.04, 0.04]), 0);
  assert.equal(specularToMetalness(undefined), 0);
  assert.equal(specularToMetalness([1, 1, 1]), 1);
  assert.ok(specularToMetalness([0.55, 0.55, 0.55]) > 0 && specularToMetalness([0.55, 0.55, 0.55]) < 1);
});

test('a bare GLTFLoader renders the legacy GLB flat white and asks for no image', async () => {
  const { requested, plugin } = stubTextures();
  const loader = new GLTFLoader();
  loader.register(plugin);
  const gltf = await loader.parseAsync(bytes({ specularGlossiness: true }), '');
  const material = materialOf(gltf);
  assert.equal(material.isMeshStandardMaterial, true);
  assert.equal(material.map, null);
  assert.equal(material.color.getHex(), 0xffffff);
  assert.deepEqual(requested, [], 'nothing in the core material references the embedded image');
  disposeObject3D(gltf.scene);
});

test('createGLTFLoader maps the legacy extension onto its diffuse image and factors', async () => {
  const { requested, load } = loading({ specularGlossiness: true });
  const gltf = await load();
  const material = materialOf(gltf);
  assert.ok(material.map, 'the diffuse texture became the base colour map');
  assert.equal(material.map.image.width, 8);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace, 'base colour must be decoded as sRGB');
  assert.deepEqual(requested, [0], 'only the extension referenced image is requested');
  assert.ok(near(material.roughness, 0.75), `roughness ${material.roughness}`);
  assert.equal(material.metalness, specularToMetalness([0.04, 0.04, 0.04]));
  assert.equal(material.metalness, 0, 'dielectric specular must not become chrome');
  assert.ok(near(material.color.r, 0.2) && near(material.color.g, 0.4) && near(material.color.b, 0.6), `colour ${material.color.r},${material.color.g},${material.color.b}`);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.transparent, false);
  disposeObject3D(gltf.scene);
});

test('modern metallic-roughness materials keep the standard path through the shim', async () => {
  const plain = loading();
  const plainGltf = await plain.load();
  assert.equal(materialOf(plainGltf).map, null);
  assert.ok(near(materialOf(plainGltf).color.r, 0.4), `colour ${materialOf(plainGltf).color.r}`);
  assert.deepEqual(plain.requested, [], 'a material without the extension requests no texture');
  disposeObject3D(plainGltf.scene);

  const textured = loading({ textured: true });
  const texturedGltf = await textured.load();
  assert.ok(materialOf(texturedGltf).map, 'the standard baseColorTexture still resolves');
  assert.deepEqual(textured.requested, [0]);
  assert.ok(near(materialOf(texturedGltf).roughness, 0.8), 'the shim must not rewrite standard roughness');
  assert.ok(near(materialOf(texturedGltf).metalness, 0), 'the shim must not rewrite standard metalness');
  disposeObject3D(texturedGltf.scene);
});

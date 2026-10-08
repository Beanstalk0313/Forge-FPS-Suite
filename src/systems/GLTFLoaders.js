import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Every GLTFLoader in the runtime and the editor is created here.
 *
 * three dropped built-in `KHR_materials_pbrSpecularGlossiness` support (r150+),
 * but exporters that shipped it (Sketchfab downloads, older Blender and
 * Substance pipelines) put *all* of a material's textures inside the
 * extension. Without a shim GLTFLoader falls back to an untouched white
 * MeshStandardMaterial and never references those images, so the model renders
 * flat white with no console error at all — the images are simply never asked
 * for. Registering this plugin gives the legacy workflow a metallic-roughness
 * reading:
 *
 *   diffuseFactor / diffuseTexture -> color + map (sRGB)
 *   glossinessFactor               -> roughness = 1 - glossiness
 *   specularFactor                 -> metalness (0 for dielectric specular)
 *
 * The specular-glossiness texture packs specular in RGB and glossiness in
 * alpha, while `roughnessMap` samples the green channel, so that image is
 * deliberately not reused as a roughness map; the scalar factor is the closer
 * approximation. Plain metallic-roughness GLBs are untouched.
 */
export const SPECULAR_GLOSSINESS = 'KHR_materials_pbrSpecularGlossiness';

/**
 * Dielectric specular (about 0.04) is not metal. Only a bright specular colour
 * reads as metal, and then only partially — mapping 0.04 to full metalness
 * would turn every legacy cloth and skin texture into chrome.
 */
export function specularToMetalness(specularFactor = [0.04, 0.04, 0.04]) {
  const peak = Math.max(...specularFactor.slice(0, 3));
  return peak <= 0.1 ? 0 : Math.min(1, (peak - 0.1) / 0.9);
}

/** GLTFLoader plugin: maps the legacy extension onto MeshStandardMaterial. */
export function specularGlossinessPlugin(parser) {
  return {
    name: SPECULAR_GLOSSINESS,
    // Only claim the materials that actually use the extension, so a GLB mixing
    // legacy and modern materials keeps the standard path for the modern ones.
    getMaterialType(index) {
      return parser.json.materials?.[index]?.extensions?.[SPECULAR_GLOSSINESS] ? THREE.MeshStandardMaterial : null;
    },
    extendMaterialParams(index, params) {
      const materialDef = parser.json.materials?.[index];
      const extension = materialDef?.extensions?.[SPECULAR_GLOSSINESS];
      if (!extension) return null;
      const pending = [];
      const diffuse = Array.isArray(extension.diffuseFactor) ? extension.diffuseFactor : [1, 1, 1, 1];
      params.color.setRGB(diffuse[0], diffuse[1], diffuse[2], THREE.LinearSRGBColorSpace);
      params.opacity = diffuse[3] ?? 1;
      if (params.opacity < 1) {
        // GLTFLoader decides transparency from `materialDef.alphaMode` *after*
        // this hook runs; an OPAQUE default would silently drop a diffuse
        // texture's alpha, so ask for the blend path the data implies.
        materialDef.alphaMode = 'BLEND';
      }
      if (extension.diffuseTexture) pending.push(parser.assignTexture(params, 'map', extension.diffuseTexture, THREE.SRGBColorSpace));
      params.roughness = extension.glossinessFactor !== undefined ? 1 - extension.glossinessFactor : 1;
      params.metalness = specularToMetalness(extension.specularFactor);
      // This must be ONE awaited promise. GLTFLoader builds the material from
      // this parameter object as soon as the returned promise settles, so a
      // bare array of promises is not awaited, the material is constructed
      // before the image resolves, and the texture is silently dropped.
      return Promise.all(pending);
    }
  };
}

/** A GLTFLoader that understands legacy specular-glossiness models. */
export function createGLTFLoader(manager) {
  const loader = new GLTFLoader(manager);
  loader.register(specularGlossinessPlugin);
  return loader;
}

/**
 * Synthetic QA asset, not shipped player art: two skinned meshes and a
 * hand/finger chain, in four material flavours — plain colour, standard
 * embedded texture, texture-less white, and the legacy
 * KHR_materials_pbrSpecularGlossiness form that three's GLTFLoader dropped.
 */
const zlib = require('node:zlib');
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** 8x8 RGBA PNG, uniform colour — enough for GLTFLoader to decode as a texture. */
function tinyPng([r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixel = Buffer.from([r, g, b, 255]);
  // One filter byte + width RGBA pixels per row — rows shorter than the
  // declared width decode leniently in <img> but reject in createImageBitmap,
  // which is what GLTFLoader's ImageBitmapLoader actually uses.
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: 8 }, () => pixel)]);
  const raw = Buffer.concat(Array.from({ length: 8 }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))
  ]);
}
function playerRigFixture({ textured = false, white = false, specularGlossiness = false } = {}) {
  // Both texture-bearing flavours embed one image; they differ only in which
  // material field points at it. The legacy form keeps the reference inside
  // the extension, which is why a bare GLTFLoader never even asks for it.
  const hasImage = textured || specularGlossiness;
  const png = hasImage ? tinyPng([230, 90, 60]) : null;
  const chunks = [], views = [], accessors = [];
  let length = 0;
  const data = (array, type, componentType, count, extra = {}) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const pad = (4 - length % 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    const view = views.length; views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes); length += bytes.length;
    accessors.push({ bufferView: view, componentType, count, type, ...extra }); return accessors.length - 1;
  };
  /** Buffer view without an accessor (images reference views directly). */
  const view = bytes => {
    const pad = (4 - length % 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    const index = views.length; views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes); length += bytes.length; return index;
  };
  const positions = data(new Float32Array([0, 0, 0, 0.25, 0, 0, 0, 0.25, 0]), 'VEC3', 5126, 3, { min: [0, 0, 0], max: [0.25, 0.25, 0] });
  const body = data(new Float32Array([-0.2, 0, 0, 0.2, 0, 0, 0, 1.8, 0]), 'VEC3', 5126, 3, { min: [-0.2, 0, 0], max: [0.2, 1.8, 0] });
  const joints = data(new Uint16Array([4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]), 'VEC4', 5123, 3);
  const bodyJoints = data(new Uint16Array(12), 'VEC4', 5123, 3);
  const weights = data(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', 5126, 3);
  const matrices = [];
  for (const y of [0, 1.1, 1.2, 1.3, 1.4]) matrices.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -y, 0, 1);
  const inverse = data(new Float32Array(matrices), 'MAT4', 5126, 5);
  const times = data(new Float32Array([0, 1]), 'SCALAR', 5126, 2, { min: [0], max: [1] });
  const rotations = data(new Float32Array([0, 0, 0, 1, 0, 0, Math.sin(0.5), Math.cos(0.5)]), 'VEC4', 5126, 2);
  const image = hasImage ? view(png) : null;
  const gltf = { asset: { version: '2.0', generator: 'Forge rig regression fixture' }, scene: 0,
    scenes: [{ nodes: [0, 5, 6] }], nodes: [
      { name: 'Root', children: [1] }, { name: 'Shoulder', translation: [0, 1.1, 0], children: [2] },
      { name: 'Elbow', translation: [0, 0.1, 0], children: [3] }, { name: 'Hand', translation: [0, 0.1, 0], children: [4] },
      { name: 'Finger', translation: [0, 0.1, 0] }, { name: 'ArmsMesh', mesh: 0, skin: 0 }, { name: 'BodyMesh', mesh: 1, skin: 0 }
    ], skins: [{ joints: [0, 1, 2, 3, 4], inverseBindMatrices: inverse, skeleton: 0 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: positions, JOINTS_0: joints, WEIGHTS_0: weights }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: body, JOINTS_0: bodyJoints, WEIGHTS_0: weights }, material: 0 }] }
    ],
    materials: [specularGlossiness
      // No pbrMetallicRoughness and no core baseColorTexture at all: r150+
      // GLTFLoader reads this as an untouched white MeshStandardMaterial and
      // never requests the embedded image.
      ? { doubleSided: true, extensions: { 'KHR_materials_pbrSpecularGlossiness': { diffuseFactor: [0.2, 0.4, 0.6, 1], diffuseTexture: { index: 0 }, glossinessFactor: 0.25, specularFactor: [0.04, 0.04, 0.04] } } }
      : textured
        ? { doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }
        : white
          ? { doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.8 } }
          : { doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.4, 0.9, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    animations: [{ name: 'FingerCurl', samplers: [{ input: times, output: rotations, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 4, path: 'rotation' } }] }],
    buffers: [{ byteLength: length }], bufferViews: views, accessors };
  if (hasImage) {
    gltf.images = [{ bufferView: image, mimeType: 'image/png' }];
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    gltf.textures = [{ source: 0, sampler: 0 }];
  }
  if (specularGlossiness) {
    // Real exporters declare the legacy extension; a loader without a shim
    // only warns here and then renders every material white.
    gltf.extensionsUsed = ['KHR_materials_pbrSpecularGlossiness'];
    gltf.extensionsRequired = ['KHR_materials_pbrSpecularGlossiness'];
  }
  let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  let binary = Buffer.concat(chunks); binary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(binary.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binaryHeader, binary]);
}
module.exports = { playerRigFixture, tinyPng };

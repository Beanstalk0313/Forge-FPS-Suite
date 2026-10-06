/** Synthetic QA asset, not shipped player art: two skinned meshes and a hand/finger chain. */
function playerRigFixture() {
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
  const gltf = { asset: { version: '2.0', generator: 'Forge rig regression fixture' }, scene: 0,
    scenes: [{ nodes: [0, 5, 6] }], nodes: [
      { name: 'Root', children: [1] }, { name: 'Shoulder', translation: [0, 1.1, 0], children: [2] },
      { name: 'Elbow', translation: [0, 0.1, 0], children: [3] }, { name: 'Hand', translation: [0, 0.1, 0], children: [4] },
      { name: 'Finger', translation: [0, 0.1, 0] }, { name: 'ArmsMesh', mesh: 0, skin: 0 }, { name: 'BodyMesh', mesh: 1, skin: 0 }
    ], skins: [{ joints: [0, 1, 2, 3, 4], inverseBindMatrices: inverse, skeleton: 0 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: positions, JOINTS_0: joints, WEIGHTS_0: weights }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: body, JOINTS_0: bodyJoints, WEIGHTS_0: weights }, material: 0 }] }
    ], materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.4, 0.9, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    animations: [{ name: 'FingerCurl', samplers: [{ input: times, output: rotations, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 4, path: 'rotation' } }] }],
    buffers: [{ byteLength: length }], bufferViews: views, accessors };
  let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  let binary = Buffer.concat(chunks); binary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(binary.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binaryHeader, binary]);
}
module.exports = { playerRigFixture };

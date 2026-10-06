import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createMaterial, disposeObject3D } from './Materials.js';
import { meshColliderData, colliderDescFor } from './CollisionShapes.js';
import { applySky, clearSky, skyPreset } from './Skybox.js';
import { applyRenderSettings, renderSettings } from './Rendering.js';
import { AssetBarrier } from './AssetBarrier.js';

/**
 * Level JSON schema — the stable contract the MapEditor (editor.js) will emit.
 *
 * {
 *   "name": "string",
 *   "playerSpawn": { "position": [x,y,z], "yaw": radians },
 *   "environment": { "background": "#rrggbb", "fogNear": n, "fogFar": n },
 *   "lights": [
 *     { "type": "ambient"|"hemisphere"|"directional"|"point",
 *       "color": "#rrggbb", "intensity": n, "position": [x,y,z],
 *       "groundColor": "#..." (hemisphere), "distance": n, "decay": n,
 *       "bob": amplitude (point lights, optional) }
 *   ],
 *   "geometry": [   // static world: colliders fixed by default
 *     { "id": "string", "type": "box",
 *       "position": [x,y,z], "rotation": [rx,ry,rz] (radians),
 *       "scale": [w,h,d] (full box dimensions),
 *       "material": { "color":"#..", "roughness":n, "metalness":n,
 *                     "grid":bool, "gridRepeat":n, "emissive":"#.." },
 *       "collider": "fixed"|"none", "gltfUrl": "path.glb" (optional) }
 *   ],
 *   "props": [      // dynamic rigid bodies
 *     { "id": "string", "type": "box", "position": [...], "rotation": [...],
 *       "scale": [w,h,d], "mass": n, "tags": ["target", ...],
 *       "material": {...} }
 *   ]
 * }
 *
 * gltfUrl entries render a placeholder box immediately (so levels work with
 * zero art assets); if the GLTF loads, the model replaces the visual.
 *
 * `collider` picks the collision shape:
 *   "box"  (default, legacy "fixed") cuboid from the entry scale
 *   "mesh"               triangle mesh from the loaded model (static geometry)
 *   "hull"               convex hull from the loaded model (dynamic props)
 *   "none"               no collision at all
 *
 * `environment` also drives presentation:
 *   { "sky": <preset id>, "background": "#..", "fogNear": n, "fogFar": n,
 *     "render": { "quality"|"shadows"|"shadowSize"|"exposure"|"toneMapping"|"pixelRatio" } }
 * A sky preset supplies the visible dome, the image-based lighting probe and a
 * matching fog colour; `render` sets tone mapping and shadow quality.
 */
const EULER_ORDER = 'YXZ';
const COLLIDER_MODES = ['box', 'mesh', 'hull', 'none'];
/** Legacy scenes wrote "fixed"; it means the default cuboid. */
export const colliderMode = (value) => COLLIDER_MODES.includes(value) ? value : 'box';

export class LevelLoader {
  constructor(engine, physics) {
    this.engine = engine;
    this.physics = physics;
    this.scene = engine.scene;
    this.root = new THREE.Group();
    this.root.name = 'level';
    this.scene.add(this.root);
    this.targets = [];        // dynamic props tagged "target" (Weapon wires these)
    this.spawn = { position: [0, 2, 8], yaw: 0 };
    this._bodies = [];
    this._props = [];         // { mesh, body } dynamic pairs for per-frame sync
    this.assets = new AssetBarrier();
    this._gltfLoader = new GLTFLoader(this.assets.manager);
    this._loads = [];
    this.ready = Promise.resolve(this);
    this._disposed = false;
    // Observable by the editor preview and the automated suites: proves model
    // colliders were really built, not just requested.
    this.stats = { models: 0, meshColliders: 0, hullColliders: 0, triangles: 0 };
  }

  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Level fetch failed (${res.status}): ${url}`);
    this.loadFromJSON(await res.json());
    return this.ready;
  }

  loadFromJSON(data) {
    this.spec = data;
    this.name = data.name ?? 'untitled';
    this.spawn = {
      position: data.playerSpawn?.position ?? [0, 2, 8],
      yaw: data.playerSpawn?.yaw ?? 0
    };
    const environment = this._applyEnvironment(data.environment);
    for (const spec of data.lights ?? []) this._buildLight(spec);
    for (const spec of data.geometry ?? []) this._buildStatic(spec);
    for (const spec of data.props ?? []) this._buildProp(spec);
    // Shadow cameras need the finished level bounds, so they are fitted last.
    this._fitShadowCameras(environment.render);
    this.ready = Promise.all(this._loads).then(() => this.assets.ready()).then(() => {
      if (this._disposed) throw new Error('Level was disposed before loading completed.');
      return this;
    });
    return this;
  }

  _applyEnvironment(env) {
    const environment = env && typeof env === 'object' ? env : {};
    const render = renderSettings(environment.render);
    applyRenderSettings(this.engine, render);
    // Exposed for the automated suites: proves the presentation settings were
    // really applied, not just written into the level file.
    this.render = render;

    const sky = skyPreset(environment.sky);
    this.sky = sky.id;
    applySky(this.engine, sky);

    if (sky.flat) {
      if (environment.background) this.scene.background = new THREE.Color(environment.background);
    } else {
      // The dome paints the background; the colour is kept only as a fog
      // colour so distant geometry dissolves into the sky instead of a wall.
      this.scene.background = new THREE.Color(sky.horizon);
    }
    const fogColor = new THREE.Color(sky.flat ? (environment.background ?? '#0d0f14') : sky.horizon);
    const fogNear = environment.fogNear ?? (sky.flat ? 60 : sky.fogNear);
    const fogFar = environment.fogFar ?? (sky.flat ? 220 : sky.fogFar);
    if (fogNear < fogFar) this.scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
    return { ...environment, render };
  }

  _buildLight(spec) {
    let light;
    const pos = spec.position ?? [0, 5, 0];
    if (spec.type === 'ambient') {
      light = new THREE.AmbientLight(spec.color ?? '#ffffff', spec.intensity ?? 1);
    } else if (spec.type === 'hemisphere') {
      light = new THREE.HemisphereLight(spec.color ?? '#8899bb', spec.groundColor ?? '#30281e', spec.intensity ?? 1);
    } else if (spec.type === 'directional') {
      light = new THREE.DirectionalLight(spec.color ?? '#ffffff', spec.intensity ?? 1);
      // A directional light only means anything if it casts. The default is on
      // for this type; a light may opt out with "shadows": false.
      light.userData.wantsShadows = spec.shadows !== false;
      // The target follows the light so the shadow frustum stays centred on it.
      light.target.position.set(...pos);
      this.root.add(light.target);
    } else {
      light = new THREE.PointLight(spec.color ?? '#ffffff', spec.intensity ?? 100, spec.distance ?? 40, spec.decay ?? 1.8);
    }
    light.position.set(...pos);
    light.userData.bob = spec.bob ?? 0;
    light.userData.baseY = pos[1];
    this.root.add(light);
    return light;
  }

  /**
   * Give every shadow-casting light a frustum that actually covers the level.
   *
   * three defaults a directional shadow camera to 5 units; without fitting it,
   * a 60m arena gets a shadow map of a 10m patch at its centre, which reads as
   * random shadow acne rather than lighting.
   */
  _fitShadowCameras(render) {
    if (!render?.shadows) return;
    const lights = [];
    this.root.traverse(o => { if (o.isDirectionalLight && o.userData.wantsShadows) lights.push(o); });
    if (!lights.length) return;

    const box = new THREE.Box3();
    let any = false;
    for (const spec of [...(this.spec?.geometry ?? []), ...(this.spec?.props ?? [])]) {
      const [w, h, d] = spec.scale ?? [1, 1, 1];
      const [x, y, z] = spec.position ?? [0, 0, 0];
      box.expandByPoint(new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2));
      box.expandByPoint(new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2));
      any = true;
    }
    if (!any) box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 20));
    box.expandByScalar(2);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(8, size.length() / 2);

    for (const light of lights) {
      light.castShadow = true;
      light.shadow.mapSize.set(render.shadowSize, render.shadowSize);
      const camera = light.shadow.camera;
      camera.left = -radius; camera.right = radius;
      camera.top = radius; camera.bottom = -radius;
      // Keep the frustum centred on the level, not on the light's own position.
      camera.near = 0.5;
      camera.far = radius * 4 + 200;
      light.shadow.bias = -0.0005;
      // Normal bias kills the self-shadow stripes that make people disable
      // shadows entirely; a tiny constant bias would only trade them for peter
      // -panning.
      light.shadow.normalBias = 0.04;
      light.shadow.camera.updateProjectionMatrix();
      light.target.position.copy(center);
      light.target.updateMatrixWorld();
      this.shadows = true;
    }
  }

  _boxMesh(spec) {
    const mat = createMaterial(spec.material);
    const geo = new THREE.BoxGeometry(...spec.scale);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...spec.position);
    mesh.rotation.set(...(spec.rotation || [0, 0, 0]), EULER_ORDER);
    mesh.name = spec.id ?? 'unnamed';
    // Both flags on by default: a level that casts but never receives looks
    // flat, and one that receives but never casts floats.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  _buildStatic(spec) {
    const mesh = this._boxMesh(spec);
    this.root.add(mesh);
    const mode = colliderMode(spec.collider);
    if (mode !== 'none') {
      const e = new THREE.Euler(...(spec.rotation || [0, 0, 0]), EULER_ORDER);
      const q = new THREE.Quaternion().setFromEuler(e);
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(...spec.position)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      );
      const [w, h, d] = spec.scale;
      if (mode === 'box') {
        this.physics.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
      } else {
        // Model collider is added when the GLB arrives; a box keeps the
        // object solid until then so nothing falls through the world.
        this.physics.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
        mesh.userData.pendingCollider = { mode, body };
      }
      this._bodies.push(body);
      mesh.userData.body = body;
    }
    if (spec.gltfUrl) this._attachGltf(spec, mesh);
    return mesh;
  }

  _buildProp(spec) {
    const mesh = this._boxMesh(spec);
    this.root.add(mesh);
    const e = new THREE.Euler(...(spec.rotation || [0, 0, 0]), EULER_ORDER);
    const q = new THREE.Quaternion().setFromEuler(e);
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...spec.position)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    const [w, h, d] = spec.scale;
    const collider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setRestitution(0.3), body
    );
    mesh.userData.colliderMode = colliderMode(spec.collider);
    this._bodies.push(body);
    mesh.userData.body = body;
    mesh.userData.collider = collider;
    this._props.push({ mesh, body });
    if (spec.mass) collider.setMass(spec.mass);
    if ((spec.tags ?? []).includes('target')) this.targets.push(mesh);
    if (spec.gltfUrl) this._attachGltf(spec, mesh);
    return mesh;
  }

  /** Swap a placeholder primitive for its GLTF model once the asset arrives. */
  _attachGltf(spec, placeholder) {
    const load = this._gltfLoader.loadAsync(spec.gltfUrl).then((gltf) => {
      if (this._disposed) { disposeObject3D(gltf.scene); return; }
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const factor = new THREE.Vector3(...spec.scale).divide(new THREE.Vector3(size.x || 1, size.y || 1, size.z || 1));
      model.scale.multiply(factor);
      model.position.sub(center).multiply(factor);
      model.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
      placeholder.add(model);
      placeholder.material.visible = false; // children continue following dynamic bodies
      this.stats.models++;
      this._applyModelCollider(spec, placeholder, model);
    }).catch(error => { throw new Error(`Model failed to load: ${spec.gltfUrl}: ${error.message}`); });
    this._loads.push(load);
  }

  /**
   * Replace the placeholder collider with the model's own geometry.
   * Model space maps to body space through the model node's local matrix,
   * because the placeholder node carries exactly the rigid body's transform.
   */
  _applyModelCollider(spec, placeholder, model) {
    if (this._disposed) return;
    const mode = colliderMode(spec.collider);
    if (mode !== 'mesh' && mode !== 'hull') return;
    model.updateMatrix();
    const data = meshColliderData(model, model.matrix);
    if (!data) { console.warn(`Model has no usable geometry for collision: ${spec.gltfUrl}`); return; }
    const desc = colliderDescFor(RAPIER, mode === 'hull' ? 'hull' : 'mesh', data);
    if (!desc) { console.warn(`Could not build a ${mode} collider for ${spec.gltfUrl}`); return; }

    const pending = placeholder.userData.pendingCollider;
    const body = pending?.body || placeholder.userData.body;
    if (pending?.body) {
      // Static: drop the placeholder cuboid, keep the single fixed body.
      this.physics.world.removeCollider(pending.body.collider(0), false);
      pending.body = null;
    } else if (placeholder.userData.collider) {
      // Dynamic prop: swap the cuboid for the hull and move the mass over.
      const old = placeholder.userData.collider;
      const mass = old.mass();
      this.physics.world.removeCollider(old, false);
      if (spec.mass) desc.setMass(mass);
      placeholder.userData.collider = null;
    }
    // Keep userData.collider pointing at the live collider: the weapon matches
    // shot hits against it to find props to damage.
    placeholder.userData.collider = this.physics.createCollider(desc, body);
    placeholder.userData.colliderMode = mode;
    if (mode === 'hull') this.stats.hullColliders++;
    else this.stats.meshColliders++;
    this.stats.triangles += data.triangles;
  }

  update(dt, t = 0) {
    for (const { mesh, body } of this._props) {
      const p = body.translation();
      mesh.position.set(p.x, p.y, p.z);
      const r = body.rotation();
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (mesh.userData.flash > 0) {
        mesh.userData.flash -= dt;
        if (mesh.userData.flash <= 0) {
          mesh.material.color.setHex(mesh.userData.baseColor);
        }
      }
    }
    this.root.traverse((o) => {
      if (o.isLight && o.userData.bob) {
        o.position.y = o.userData.baseY + Math.sin(t * 0.8 + o.userData.baseY) * o.userData.bob;
      }
    });
  }

  onTargetHit(mesh) {
    mesh.userData.baseColor = mesh.userData.baseColor ?? mesh.material.color.getHex();
    mesh.userData.flash = 0.15;
    mesh.material.color.setHex(0xff2222);
  }

  /** Full teardown: bodies, meshes, materials, textures (mission memory check). */
  dispose() {
    this._disposed = true;
    for (const body of this._bodies) this.physics.removeBody(body);
    this._bodies = [];
    this._props = [];
    this.targets = [];
    disposeObject3D(this.root);
    this.root.removeFromParent();
    clearSky(this.engine);
    this.scene.background?.set?.('#0d0f14');
  }
}

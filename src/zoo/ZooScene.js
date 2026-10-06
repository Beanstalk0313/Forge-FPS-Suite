import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createGridTexture } from '../systems/Materials.js';

/**
 * ZooScene: testing sandbox.
 * Grid floor, 3 shootable targets (flash red on hit), stairs + ramp,
 * 3 floating point lights.
 */
export class ZooScene {
  constructor(engine, physics) {
    this.engine = engine;
    this.physics = physics;
    this.scene = engine.scene;
    this.targets = [];
    this._build();
  }

  _staticBox(x, y, z, sx, sy, sz, material, quaternion = null) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    if (quaternion) mesh.quaternion.copy(quaternion);
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(x, y, z);
    if (quaternion) bodyDesc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    const body = this.physics.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setFriction(1.0);
    this.physics.createCollider(colDesc, body);
    return mesh;
  }

  _build() {
    // Lighting: ambient + directional + 3 floating colored point lights
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x30281e, 1.4));
    this.scene.add(new THREE.AmbientLight(0x404050, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

    const lightColors = [0xff5544, 0x44ff88, 0x4488ff];
    this._floatingLights = lightColors.map((color, i) => {
      const light = new THREE.PointLight(color, 220, 40, 1.8);
      light.position.set(Math.cos(i * 2.1) * 10, 5, Math.sin(i * 2.1) * 10);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 12),
        new THREE.MeshBasicMaterial({ color })
      );
      bulb.position.copy(light.position);
      this.scene.add(light, bulb);
      light.userData.bulb = bulb;
      return light;
    });

    // Floor
    const floorMat = new THREE.MeshStandardMaterial({
      map: createGridTexture({ repeat: 40 }),
      roughness: 0.9, metalness: 0.1
    });
    this._staticBox(0, -0.5, 0, 80, 1, 80, floorMat);

    // Walls so players can't slide off the edge
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.8 });
    const W = 40;
    this._staticBox(0, 5, -W, W * 2, 10, 1, wallMat);
    this._staticBox(0, 5, W, W * 2, 10, 1, wallMat);
    this._staticBox(-W, 5, 0, 1, 10, W * 2, wallMat);
    this._staticBox(W, 5, 0, 1, 10, W * 2, wallMat);

    // 3 shooting targets on stands
    const targetMat = new THREE.MeshStandardMaterial({ color: 0xdd5522, roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, targetMat.clone());
      const x = -6 + i * 6;
      mesh.position.set(x, 1.5, -12);
      this.scene.add(mesh);
      this.targets.push(mesh);

      // Dynamic body so bullets knock them around (proof physics works)
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 1.5, -12);
      const body = this.physics.createRigidBody(bodyDesc);
      const collider = this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.3), body
      );
      mesh.userData.body = body;
      mesh.userData.collider = collider;
    }

    // Stairs: 6 steps, each 0.25m riser (under capsule step-up limit) x 0.5m tread
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x3d4657, roughness: 0.85 });
    for (let i = 0; i < 6; i++) {
      this._staticBox(14 + i * 0.5, 0.125 + i * 0.25, -4, 0.5, 0.25 + i * 0.25, 4, stepMat);
    }
    // Landing platform on top of the stairs (top surface flush with stair top)
    this._staticBox(18.5, 1.25, -4, 3.5, 0.5, 4, stepMat);

    // Invisible ramp collider over the stairs: capsules can't step up risers,
    // so physics gets a smooth slope while visuals stay as steps. The ramp is
    // sloped slightly steeper than the step corners so its surface always sits
    // just above every riser, and its low end is buried into the floor.
    const stairAngle = Math.atan2(1.5, 3); // slope 0.5, matches step corners
    const rampBody = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(15.05, 0.85, -4)
        .setRotation({ x: 0, y: 0, z: Math.sin(stairAngle / 2), w: Math.cos(stairAngle / 2) })
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(1.9, 0.1, 2), rampBody
    );

    // Ramp: 15-degree incline to test slope handling + slide downhill
    const rampAngle = THREE.MathUtils.degToRad(15);
    const rampLen = 8, rampWidth = 3;
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x4a5265, roughness: 0.7 });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-rampAngle, 0, 0));
    // Position so low edge touches the floor at z = +6
    const cy = Math.sin(rampAngle) * rampLen / 2;
    this._staticBox(0, cy + 0.1, 6 + Math.cos(rampAngle) * rampLen / 2, rampWidth, 0.2, rampLen, rampMat, q);
  }

  update(dt, t = 0) {
    // Sync dynamic target meshes with their physics bodies
    for (const mesh of this.targets) {
      const b = mesh.userData.body;
      if (!b) continue;
      const t = b.translation();
      mesh.position.set(t.x, t.y, t.z);
      const r = b.rotation();
      mesh.quaternion.set(r.x, r.y, r.z, r.w);

      // Hit flash decay
      if (mesh.userData.flash > 0) {
        mesh.userData.flash -= dt;
        if (mesh.userData.flash <= 0) {
          mesh.material.color.setHex(mesh.userData.baseColor);
        }
      }
    }

    // Bob the floating lights to verify dynamic lighting (t from Engine contract)
    if (this._floatingLights) {
      this._floatingLights.forEach((light, i) => {
        light.position.y = 5 + Math.sin(t * 0.8 + i * 2) * 1.2;
        light.userData.bulb.position.copy(light.position);
      });
    }
  }

  /** Called by Weapon when a ray hits a target collider. */
  onTargetHit(mesh) {
    mesh.userData.baseColor = mesh.userData.baseColor ?? mesh.material.color.getHex();
    mesh.userData.flash = 0.15;
    mesh.material.color.setHex(0xff2222);
  }

  dispose() {
    for (const mesh of this.targets) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      if (mesh.userData.body) this.physics.removeBody(mesh.userData.body);
    }
  }
}

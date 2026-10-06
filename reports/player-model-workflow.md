# Player model and gun-arm animation

## Delivered workflow

- New **Player** workspace: import/select a self-contained GLB, set upright height/orientation, inspect named meshes and bones, select first-person arm/hand meshes, adjust their pose, and assign body idle/walk clips.
- **Animation → Animate** switches between **Full player body** and **Gun + player arms**. A combined gun/rig hierarchy supports shoulder, elbow, wrist/hand and finger bone keys, the existing gizmo/inspector/timeline workflow, and embedded GLB transform-animation import.
- **Weapons → Arms with this gun** overrides arm position/rotation/scale per weapon. Existing idle/walk/fire/reload/equip clip assignments drive gun and arms together in the actual runtime viewmodel pass.
- Body and first-person skeletons are independent loads of the same asset; body animation does not mutate the hand pose. GLB model/dependent-asset readiness is awaited before gameplay. Missing player models fail visibly rather than silently substituting a placeholder.
- Old projects without player configuration and old weapon-only clips remain valid. Schema defaults remain dependency-free for fresh project creation before dependency installation.

## How to use

1. Prepare a rigged GLB in Blender or another modeler. Name meshes and bones uniquely. Export the skeleton and skin weights; include finger bones to animate fingers.
2. In **Player**, import the GLB, set its height/orientation and select the arm/hand meshes. Enable first-person arms.
3. **Animate full player** creates `kind: "player"` clips; assign them to body idle/walk in Player.
4. **Animate arms with gun** creates `kind: "weapon"` clips. Pick a bone from the hierarchy, set a timeline time, pose it with Rotate/the inspector and key it. Gun nodes and player nodes can share one clip without name collisions.
5. In **Weapons**, align the arms for that gun and assign the clip to idle/walk/fire/reload/equip. Save and use Play.

## Data and ownership

- `project.player`: modelUrl, height, rotation, animations, firstPerson { enabled, meshes, position, rotation, scale }.
- `weapon.arms`: optional position/rotation/scale override.
- `clip.kind`: player or weapon; omitted means legacy weapon. Weapon clips record weaponId for preview selection.
- `player:<original node name>`: stable player bone/mesh targets. `@player`: first-person arm pose group. `@root`: clip animation layer.
- Player fitting is on an enclosing group, preserving exported skeleton/bind/local transforms. Normalize with full body bounds before selecting arm meshes.
- Selected nested meshes keep ancestor traversal enabled while excluding unselected ancestor mesh drawing. Required shoulder/hand bones are never hidden.
- Disposal includes skinned mesh skeleton bone textures; superseded model loads are rejected by viewport generation guards.

## Verification

- Syntax check: PASS; production Vite build: PASS (existing large-chunk warning remains).
- Unit suite: **132/132 PASS**. A generated self-contained skinned GLB checks named hand/finger bones, body/arm normalization parity, actual skinned-vertex deformation, independent skeletons, pose restore, runtime body locomotion, nested mesh selection and missing-mesh errors.
- Desktop editor/live Play: **188/188 PASS**, no packaging. Real controls exercise player GLB selection, mesh visibility, full-body and gun-arm keyframing, finger scrub deformation, embedded animation conversion, weapon preview, save and runtime finger playback.
- Source and production loading tests: **16/16 PASS each**, including loaded body/arms and finger playback plus actionable missing-player-model failure.
- Logs: tests/.tmp/player-check.log, player-unit.log, player-build.log, desktop-ui-test.txt, player-loading-source.json, player-loading-build.json.

## Limits

No player artwork is supplied; tests use a synthetic QA rig, not a production character. GLB only. Existing rigs are required: no auto-rigging, IK, retargeting, morph animation or GLB baking. Arms must be separate meshes within the player GLB; a single full-body mesh must be split externally (no automatic geometry cutting). Bones should have unique names; duplicate names are excluded from keyframing.

The full-body runtime instance is hidden from the local first-person camera to prevent head/torso clipping. Third-person gameplay, animation networking and automatic bot-model replacement are not included. The suite stays at 0.1.12; no installer was built.

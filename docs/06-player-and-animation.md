# Player rig and animation

This page is for anyone who wants a visible player: a body model in the world, first-person arms holding the gun,
damage hitboxes, and animation clips. It covers the **Player** and **Animation** workspaces. You need a rigged,
self-contained GLB from your modeler; Forge supplies no character artwork and never builds a rig for you.

## Import a player model

1. **Window → Player**.
2. **Import player GLB…** (desktop app; the file is copied into the project) or pick an existing GLB in the
   **Player GLB** list. The list also offers **No player model** to unset it, and **Clear player model** resets the
   model, the arm selection and every hitbox.
3. Set **Player height (m)** (0.01–10 m) and **Player orientation (radians)**. The humanoid is fitted upright as
   one unit: Forge does not rewrite bind poses, and hitboxes are stored in the fitted rig frame with the feet at
   y = 0, so they keep working when a model is replaced or its units change.

Requirements and load-time reports:

- Meshes and joints need unique names. A mesh with no name, or two meshes sharing one, cannot be selected for the
  arms and is reported: rename them in your modeler.
- Hand and finger animation needs the corresponding bones. Importing a plain mesh does not create a rig.
- A legacy `KHR_materials_pbrSpecularGlossiness` export (older Blender/Substance, most Sketchfab downloads) is
  converted on load, so its diffuse textures render instead of flat white.
- A GLB whose materials genuinely carry no texture and no material colour loads plain white, and the editor says
  so: re-export with images embedded (Blender: glTF export → Images → Embedded).

## First-person arms

Under **First-person arms** in the right panel:

1. Turn on **Enable first-person arms**.
2. Tick the arm/hand meshes under **Show mesh: \<name\>**. Each ticked mesh is outlined in the viewport
   immediately, and clicking a part of the model in the view toggles it as well — no tab switching to work out
   which mesh is which.
3. Use **Arms position**, **Arms rotation** and **Arms scale** when the hands need to move relative to the body.

Notes that matter:

- The body and the first-person arms are independently loaded instances of the same GLB. Animating one does not
  mutate the other, and bones stay intact when head or torso meshes are hidden.
- A single combined full-body skinned mesh cannot be used for arms. Split it into body and arm/hand meshes in your
  modeler first; Forge does not cut geometry.
- Ticking nothing keeps the mesh out of the arms; unticking the last mesh turns first-person arms back off.
- The local body mesh is hidden from the local first-person camera so it cannot clip through the view. There is no
  third-person mode and no automatic bot-model replacement.

## Body clips and gun clips

Clips carry a `kind`: `player` for body animation, `weapon` for a viewmodel. A missing `kind` counts as a legacy
weapon clip.

- **Animate full player** opens the Animation workspace on the body rig; **Animate arms with gun** opens it on the
  combined weapon-and-arms timeline.
- In **Player → Body animation events**, assign a `kind: "player"` clip to **Player idle** and **Player walk**, or
  leave **Rest pose** to keep the imported rest pose. Body clips run on the world player.
- Gun clips are assigned per weapon in **Weapons → animation events** (idle, walk, fire, reload, equip), and animate
  the reused first-person skeleton independently of the body.
- Target naming keeps the two skeletons apart: `@root` addresses the clip's animation layer, `@player` the arms
  group, and imported player nodes use `player:<original name>` so they can never collide with gun node names.

## The Animation workspace

**Window → Animation**, or the two buttons in Player.

Left panel:

- **CLIPS** — **+ New clip**, **Search clips** and one row per clip in the current context (row tooltips show
  duration and track count). Right-click a clip for **Open clip**, **Rename…**, **Duplicate**, **Use this clip
  model** and **Delete** (deleting also clears any weapon/player slot pointing at it).
- **CLIP SETTINGS** — **Clip name**, **Duration (seconds)** (0.01–3600), **Loop**, **Use current preview model**,
  **Duplicate clip**, **Delete clip**. Changing the duration scales every key time together as one undo step, so
  close keys stay distinct.
- **MODEL ANIMATIONS** — **Import "\<name\>"** converts an embedded glTF clip into editable transform keys.
  Morph-weight tracks are not supported and are reported.
- **MODEL HIERARCHY** — **Search model parts**; **Whole model (@root)** plus every uniquely named node (bones are
  prefixed `Bone ·`, animated parts prefixed `●`). Right-click a part for **Select part**, **Key transform here**
  and **Clear keyframes**.

Toolbar: **Move · G**, **Rotate · R**, **Scale · S**, **Frame · F**, the **Animate** context switch
(*Gun + player arms* / *Full player body*), **Animation weapon** and **Preview model** (a primitive stand-in or any
project GLB) for gun clips, and **Player model setup** for body clips.

Keyframing:

1. Click a part in the viewport or the hierarchy. Clicking a skinned part keys its **nearest unique bone**, because
   posing the mesh node itself cannot deform skin.
2. Pose it with the gizmo or the inspector fields (**Position (m)**, **Rotation (rad, YXZ)**, **Scale**).
3. With **● Auto key** on, gizmo and field edits become keyframes at the playhead. With it off, edits are held
   until the playhead moves. **◆ Key transform · K** records position/rotation/scale on the selected part
   explicitly.

Timeline and transport: **⏮ Start**, **◀ Step**, **▶ Play**/**❚❚ Pause**, **Step ▶**, the scrubber, the playhead
time field and the readout; then **Playback speed** (¼×, ½×, 1×, 2×), **Step frame rate** (24, 30, 60),
**Previous key**, **Next key**, **Return to start at end** (writes the authored start pose to the clip end) and
**Selected part only** to filter the timeline to the current part.

Per-track editing lives under **ANIMATED PROPERTIES**: choose **Interpolation** (`linear`, `smooth`, `step`), seek
to a key, edit **Key time** or **Value (X Y Z)** / **Value (X Y Z W)**, delete one key with **×**, or remove the
whole property with **Delete property**. New clips are seeded with deletable time-zero keys for every uniquely
named part and the root, and a deleted default does not come back. Key times are kept on a 1 ms grid, and two keys
cannot occupy the same time.

Keyboard: `G`/`R`/`S` gizmo modes, `F` frame, `Space` play/pause, `Arrow Left`/`Arrow Right` step one frame at the
selected rate, `K` key the selected transform. Tool shortcuts are ignored while a modal is open.

Independent scenes and the project each keep their own Undo/Redo, so retiming, keying and track deletion are all
undoable.

## Damage hitboxes

Player → **Damage hitboxes** places translucent cubes over the model:

1. **+ Head**, **+ Torso**, **+ Arms** or **+ Legs** adds a box seeded to sensible proportions for the current
   player height and selects it.
2. **Select in view** (or clicking the cube) attaches the gizmo; dragging moves the box, the rotate mode turns it
   and the scale mode changes **Size (m)**. Numeric fields are available too: **Hitbox name**, **Body part**,
   **Position (m, feet origin)**, **Rotation (rad)**, **Size (m)**.
3. Repeat per part. **Delete hitbox** removes one.

How damage uses them: each weapon sets its own multipliers in the **Weapons** workspace under **DAMAGE HITBOXES**
(**Head ×**, **Torso ×**, **Arms ×**, **Legs ×**, described there as "damage per body part, × the base damage"). A shot that
lands inside a box deals the weapon's damage × that part's multiplier; a shot that misses every box, or a player
with no hitboxes at all, takes the base damage (1×), so scenes authored before hitboxes existed behave exactly as
they did. Bots reuse the authored rig layout scaled to their capsule height, so one set of boxes covers both.

## Not supported

No IK, no retargeting, no morph tracks, no rig creation, no blend graphs or state machines, and no GLB animation
baking. Third-person gameplay, automatic bot-model replacement and whole-body geometry extraction are not
implemented.

## Related

- [Weapons](05-weapons.md) — per-weapon arms offsets and damage multipliers
- [HUD and menus](07-hud-and-ui.md) — the HUD that renders around the arms
- [Scenes](04-scenes.md) — the player spawn and world lighting

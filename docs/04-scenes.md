# Building a scene

A scene (a level) is where the game happens: its geometry, props, lights, triggers, audio, objectives, spawns,
bots and environment. Everything on this page lives in the **Scene** workspace (Window → Scene), and every value
you edit is saved into the scene document, not baked into code.

Scenes belong to a project: one project can hold many scenes and exactly one is the **entry scene** that Play and
the built game start on.

## The hierarchy

The left panel lists the scene:

- **Primary player spawn** sits at the top and cannot be renamed or deleted; it is where the player starts when
  the scene has no usable team spawn.
- Then one section per collection — **Geometry**, **Props**, **Lights**, **Triggers**, **Audio**, **Objectives**,
  **Spawns**, **Bots** — each shown only when it holds objects.
- **Search objects** filters rows by name, ID or collection.
- Each row has two editor flags on the right: **V**/**H** hides an object in the editor and **U**/**L** locks it.

Right-click a row for **Select**, **Add to selection**, **Frame selection**, **Rename…**, **Duplicate**,
**Save as prefab** and **Delete**. The same verbs are on the buttons at the bottom of the Inspector.

## Adding objects

| Button | Collection | What it creates |
| --- | --- | --- |
| **+ Box** | Geometry | A static box with a fixed box collider (the floor and walls of a level) |
| **+ Prop** | Props | A dynamic box with mass 1 and the tag `target` |
| **+ Light** | Lights | A point light, intensity 100, distance 30, decay 2 |
| **+ Trigger** | Triggers | An oriented trigger zone on `trigger.enter`, once only, with no actions yet |
| **+ Sound** | Audio | A looping, autoplaying positional sound with reference distance 4 |
| **+ Objective** | Objectives | A domination point, radius 3 m, 5 s capture, 1 point/s |
| **+ Spawn** | Spawns | A team spawn for team `A` at `[0, 1.2, 8]` |
| **+ Bot** | Bots | A bot on team `B`, skill 0.5 |

A new object is selected immediately and lands at a fixed default position, so it is always visible in the
viewport after you add it. Double-clicking a GLB or an audio file in the Assets dock hands it to the open
workspace: a model becomes a geometry object with that model, an audio file becomes a sound object with that
asset.

## Transforms and units

Positions are metres, rotations are radians in YXZ order, and **Dimensions (m)** are the object's full box size,
not half extents. Imported GLBs are fitted inside the authored box, so resizing the box resizes the model; the
inspector writes `position`, `rotation` (geometry, props, triggers), `scale` (geometry, props, triggers) and
`yaw` (spawns, bots, player spawn) as those fields.

## Moving objects

- **Move · G**, **Rotate · R** and **Scale · S** switch the gizmo; **Frame · F** fits the view to the selection.
- **Space** switches between world and local axes.
- Drag to orbit the camera, right-drag to pan, and use the wheel to zoom.
- **Snap (m)** sets a fixed translation step. Holding **Shift** snaps to the **Snap (m)** value or 0.5 m and
  rotates in 15° steps; releasing Shift returns to free movement.
- Scale is full-size: doubling **Dimensions (m)** makes an object twice as large in that axis.

## Multi-selection, groups and the clipboard

- Ctrl/Shift+click a row or an object in the viewport to add it to the selection. Two or more objects share a
  group pivot that moves and rotates them together and commits as **one undo step**. Locked and hidden objects
  stay out of group edits, and group scaling is not supported: scale objects individually.
- **Ctrl+C** copies the selection, **Ctrl+V** pastes it with an increasing offset (1 m per paste), **Ctrl+D**
  duplicates it in place (offset by 1 m in X, name suffixed with `copy`), **Delete** removes the selection, and
  **Escape** clears it.
- Copied objects keep their extension fields; a duplicate gets a new ID so the game treats it as a separate
  object.

## Editor-only hide and lock

**Hidden in editor** and **Locked** never change what the game loads: a hidden object is still rendered in the
built game, and a locked object is still solid. Locking only prevents picking and editing; unlock it to change
its components. Both flags live in the object's editor metadata and survive save/load.

## The inspector

With nothing selected, the Inspector shows scene-wide settings (see below). With an object selected it shows its
components:

| Component | Fields |
| --- | --- |
| (identity) | **Name**, plus the collection and ID of the object |
| **Editor** | **Hidden in editor**, **Locked** |
| **Transform** | **Position (m)**, **Rotation (rad)** or **Yaw (rad)**, **Dimensions (m)** |
| **Mesh** (geometry, props) | **Model asset** — a GLB from the project or **Primitive box** |
| **Material** (geometry, props) | **color**, **roughness**, **metalness**, **grid**, **gridRepeat** |
| **Physics** (geometry, props) | **Collider**, **Mass** (props), **Tags** |
| **Light** | **Light type** (point, directional, hemisphere, ambient), **color**, **groundColor**, **intensity**, **distance**, **decay** |
| **Spatial audio** | **Audio asset**, **volume**, **loop**, **autoplay**, **refDistance** |
| **Trigger** | **event**, **once**, **message**, **soundId**, **On enter actions** |
| **Domination objective** | **radius**, **captureTime**, **scorePerSecond** |
| **Team spawn** | **team**, **mode**, **yaw** |
| **Bot** | **team**, **skill (0–1)**, **Damage per shot** |
| **Player spawn** | **Position**, **Yaw** |

**Collider** modes: **Box (from dimensions)** (a box from the authored size, the default for new geometry),
**Mesh (model triangles)** (collision from the imported model's triangles, so bullets stop at the real surface),
**Convex hull (model shape)** (keeps a dynamic prop on the model's hull) and **No collision**. Props use Mass to
decide how heavy the body is; leave a prop heavy and it barely moves, make it light and it gets pushed.

Every object also has an **Object JSON / extensions** panel: hand-edit the raw document, and unknown fields you
add there survive Save. The object ID must stay unchanged.

### Triggers and actions

A trigger is an oriented box that fires when the player enters it. **event** names the event
(`trigger.enter` by default) and is also dispatched to the game as a `level:trigger` event, **once** limits it
to a single firing, **message** shows a HUD message on entry and **soundId** plays one of the scene's sounds.

**On enter actions** run in order when the player enters:

| Action | Fields |
| --- | --- |
| `message` | **Text**, **Duration (s)** |
| `heal` | **Amount** (health restored, capped at 100) |
| `ammo` | **Amount** (added to reserve ammunition) |
| `teleport` | **Destination** position |
| `sound` | **Sound** — one of the scene's audio objects |

Pick **Action type**, press **Add action** and edit the generated row; **Remove action** deletes it. The sound
dropdown lists the sounds defined in this scene, and the project check reports an action that names a sound the
scene does not have.

## Environment

The scene-wide section that owns the look of the level:

- **Sky** — **Clear day**, **Overcast**, **Golden hour**, **Night city** or **Flat colour (no sky)**. The chosen
  dome is both the visible background and the environment probe, which is what lights metal and rough surfaces;
  a flat colour renders no dome.
- **background** — used as the scene background only when Sky is **Flat colour**.
- **fogNear** / **fogFar** — fog distance in metres; far must be greater than near. When unset, the sky preset's
  own distances apply.

## Rendering

- **Quality** — **Low**, **Medium**, **High** or **Ultra**. Choosing a preset adopts its shadow, shadow-map,
  tone-mapping, exposure and pixel-ratio numbers into the fields below, so you can then adjust them.
- **Shadows** — on/off for the whole scene.
- **Shadow map** — 512, 1024, 2048 or 4096 squared pixels.
- **Tone mapping** — **ACES filmic**, **AgX**, **Linear** or **None**.
- **Exposure** — 0.2–3 in 0.05 steps.
- **Pixel ratio** — 0.5–2 in 0.25 steps.

Directional lights cast shadows automatically, and their shadow camera is fitted to the scene bounds; a light
opts out with `shadows: false`. The viewport shows the real sky, lighting, tone mapping and exposure, so this is
what the game renders, not an approximation.

## Match settings

**Match** sits in the scene-wide panel for every mode, and its values only take effect in Team Deathmatch:
**Score limit**, **Time limit (s, 0 = none)**, **Respawn delay (s)**, **Countdown (s)**, **Friendly fire**,
one name field per team (**Team A name**, **Team B name**) and **Player team**. The panel reports how many bots
the scene holds and reminds you that bot kills only score in Team Deathmatch.

## Scene-wide settings

With nothing selected the Inspector shows:

- **Scene** — **Scene name** and **Game mode** (**Sandbox (free play)**, **Domination (capture points)**,
  **Team Deathmatch**), followed by the **Match** section.
- **Environment** and **Rendering** as above.
- **Project** — **Project name** and **Entry scene** (the scene Play and the build start on).
- **Full scene JSON** — the whole document, with the same "unknown fields are preserved" rule as objects.

## Prefabs

**Save as prefab** stores a copy of the selected object (without its ID) under the project's prefabs; prefabs
appear in the left panel as **+ name** buttons and instantiate into any scene of the project with a fresh ID.
Prefabs are copied specs, not linked instances: editing a prefab does not update objects already placed.
Right-click a prefab for **Instantiate**, **Rename…** and **Delete prefab**.

## Scene files and management

Scenes are separate documents. **New scene** in the toolbar starts a new unsaved scene, the **Save filename**
field renames the current one, and **Set entry scene** makes the open scene the entry scene. The **Scenes**
section of the Assets dock lists every scene with **Open**, **Set entry** and **Delete** (desktop only):
deleting the open or entry scene reassigns both automatically, and the last remaining scene cannot be deleted.
Unsaved scene work is never silently replaced — opening another scene or project asks first.

## Keyboard reference

| Key | Action |
| --- | --- |
| `G` / `R` / `S` | Move / rotate / scale gizmo |
| `F` | Frame the selection |
| `Ctrl+C` / `Ctrl+V` | Copy / paste with offset |
| `Ctrl+D` | Duplicate |
| `Delete` | Delete the selection |
| `Escape` | Clear the selection |
| `Shift` (held) | Grid snap and 15° rotation steps |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo the scene |

## Related

[The editor at a glance](02-editor-tour.md) · [Weapons](05-weapons.md) · [Game modes and properties](08-game-modes-and-properties.md) · [Play, test and ship](09-playtest-and-build.md)

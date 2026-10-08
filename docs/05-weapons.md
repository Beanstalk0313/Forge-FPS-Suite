# Weapons

The **Weapons** workspace (Window → Weapons) defines every gun in the project: its model and sound, its
ballistics, how it recoils and spreads, where it sits in the hand, what it does to each body part and which
animation clips play on which event.

The viewport is the real runtime viewmodel, not a mock — the gun sits at the in-game camera, follows recoil and
ADS exactly as the game does. Editing a value applies it live; only changing the **Model** asset rebuilds it.

## The weapon library

- **WEAPONS** lists every weapon in the project with its name; the **●** marks the starting weapon the player
  spawns with.
- **Search weapons** filters the list by name.
- Right-click a weapon for **Set as starting weapon** (or **★ Starting weapon** on the current one),
  **Rename…**, **Duplicate**, **Open in view** and **Delete**. Deleting the starting weapon promotes the next
  weapon automatically.
- **CREATE WEAPON** offers a **Starter preset** and a **+ New weapon** button. Presets create a *new* weapon;
  existing weapons are never overwritten. A new weapon is selected immediately so you can adjust it.

Starter presets (a starting point for tuning, not a balance authority):

| Preset | Magazine | Reserve | Base damage | Shot interval (s) | Range (m) | Reload (s) |
| --- | --- | --- | --- | --- | --- | --- |
| Rifle | 30 | 180 | 34 | 0.075 | 250 | 2.1 |
| Pistol | 12 | 72 | 28 | 0.22 | 90 | 1.3 |
| SMG | 32 | 192 | 22 | 0.06 | 120 | 1.8 |
| Marksman rifle | 10 | 60 | 80 | 0.6 | 500 | 2.6 |

## Preview toolbar

| Control | What it does |
| --- | --- |
| **Toggle ADS preview** | Switches the viewmodel between the hip pose and the aiming pose; the camera field of view lerps toward the weapon's ADS FOV |
| **Fire / recoil** | Plays the recoil kick so you can judge the weapon's feel |
| **Preview reload** | Plays the assigned reload clip |
| **Free view · orbit** | Leaves the first-person camera and orbits around the gun; the game camera returns when you switch back |
| **Muzzle point** | Attaches the gizmo to the barrel tip, so dragging it sets the muzzle |
| **Gun pose** | Attaches the gizmo to the whole viewmodel so you can pose it; the button then reads **Apply to hip pose** or **Apply to ADS pose** for the pose you are previewing, and **Revert** discards the change |
| **Move · G** / **Rotate · R** | Gizmo mode while posing |
| **Model** | Picks the GLB for this weapon, or **Primitive fallback** for a gun-shaped placeholder |

The **Gun pose** gizmo stores rounded position and rotation into the pose you are previewing, so hip and ADS
poses are authored separately. **Muzzle point** writes back on every gizmo release and reports the value.

## Live summary

Above the inspector, the summary reports the weapon's name and one line of figures: `RPM`, `raw DPS`,
`sustained DPS`, `damage / magazine` and `first-to-last shot`. RPM is implied by the shot interval, raw DPS is
base damage per second while firing, sustained DPS spans a full magazine including reload time, damage per
magazine is capacity × base damage, and first-to-last shot is how long the magazine takes to empty.

These are arithmetic from the authored numbers. They assume every shot hits and that no body-part multiplier
applies, so treat them as a design aid, not a combat measurement. Hovering the summary repeats that caveat.

## Inspector

Sections remember whether they were open or closed during the session. **RECOIL / SPREAD (RADIANS)**, **ADS**,
**HIP POSE** and **ADS POSE**, **MUZZLE**, **DAMAGE HITBOXES**, **Arms with this gun** and **ANIMATION EVENTS**
start collapsed.

| Section | Field | Meaning |
| --- | --- | --- |
| (identity) | **Name** | Weapon name shown in the library and document list |
| (identity) | **Gunshot sound** | A project audio asset, or **Default synthesized gunshot** |
| **BALLISTICS** | **Magazine capacity** | Rounds per magazine |
| **BALLISTICS** | **Reserve ammunition** | Rounds carried outside the magazine |
| **BALLISTICS** | **Base damage** | Damage per hit before body-part multipliers |
| **BALLISTICS** | **Shot interval (s)** | Minimum time between shots; the reciprocal is the RPM |
| **BALLISTICS** | **Range (m)** | Maximum hitscan distance |
| **BALLISTICS** | **Reload duration (s)** | How long a reload takes |
| **RECOIL / SPREAD (RADIANS)** | **Vertical recoil (rad)** | Upward kick per shot |
| **RECOIL / SPREAD (RADIANS)** | **Horizontal recoil (rad)** | Sideways kick per shot |
| **RECOIL / SPREAD (RADIANS)** | **Base spread (rad)** | Accuracy with a cold barrel |
| **RECOIL / SPREAD (RADIANS)** | **Maximum spread (rad)** | Ceiling that bloom cannot exceed |
| **RECOIL / SPREAD (RADIANS)** | **Spread added per shot** | Bloom growth while firing |
| **RECOIL / SPREAD (RADIANS)** | **Spread recovery / s** | How quickly bloom decays |
| **RECOIL / SPREAD (RADIANS)** | **Airborne spread** | Spread while jumping or falling |
| **RECOIL / SPREAD (RADIANS)** | **ADS spread multiplier** | Multiplier applied to spread while aiming down sights |
| **ADS** | **ADS field of view** | Camera FOV while aiming (20–100) |
| **ADS** | **ADS transition speed** | How fast the viewmodel moves into the aiming pose |
| **HIP POSE** / **ADS POSE** | `hipPosition`, `hipRotation` / `adsPosition`, `adsRotation` | Exact viewmodel offset; edit the numbers or drag the gun and press **Apply** |
| **MUZZLE** | `muzzle (m)` | Tracer and flash origin, local to the fitted model pivot |
| **DAMAGE HITBOXES** | **Head ×**, **Torso ×**, **Arms ×**, **Legs ×** | Per-part multipliers applied to base damage |
| **Arms with this gun** | **Gun arms position**, **Gun arms rotation**, **Gun arms scale** | Per-weapon override of the player rig's first-person pose |
| **ANIMATION EVENTS** | `idle`, `walk`, `fire`, `reload`, `equip` | Which clip plays for each event |
| (bottom) | **Open Animation Editor** | Opens the Animation workspace with this weapon as its context |
| (bottom) | **Weapon JSON** | Raw document editing; the weapon ID must stay unchanged |

The **Arms with this gun** section only appears when the player rig's first-person arms are enabled in the
**Player** workspace, because there is no arm pose to override until then.

## Damage by body part

Damage hitboxes are authored in the **Player** workspace as labelled boxes over the rig. Each weapon then sets
how much its base damage is multiplied for each part it can hit. The starter rifle ships 2× head, 1× torso and
0.75× arms and legs; a multiplier you leave unset stays 1×. A scene with no hitboxes behaves exactly like a
weapon without part damage, and a shot that lands outside every box uses the base damage. Bots reuse the same
authored layout, scaled to their capsule height.

## Animation events

Weapon clips are separate from player body clips: the **ANIMATION EVENTS** dropdowns list only weapon clips.
Each option shows the clip name, its duration, and a `· other model` flag when the clip was authored against a
different weapon model — which matters if you change the gun later. Leaving an event empty uses the
**Procedural fallback**.

To author the clips themselves, use **Open Animation Editor** (or Window → Animation), where **Animate arms
with gun** gives you the weapon and the first-person arms on one timeline; clicking a skinned part keys its
nearest bone. Idle and walk repeat with the gun even when the clip's **Loop** option is off, while event clips
such as fire stay one-shot.

## In-game controls

| Input | Action |
| --- | --- |
| Left mouse | Fire |
| Right mouse | Aim down sights |
| `R` | Reload |
| `Escape` | Pause and release the pointer |

## Related

[Player rig and animation](06-player-and-animation.md) · [Building a scene](04-scenes.md) · [Play, test and ship](09-playtest-and-build.md)

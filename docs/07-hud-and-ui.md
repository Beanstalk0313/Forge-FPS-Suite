# HUD and menus

This page is for anyone building the heads-up display, the main menu, the pause menu or the settings menu. It
covers the **UI** workspace. The full schema, the exact JSON insertion points, the CSS contract and copy-paste
examples live in [`UI_GUIDE.md`](../UI_GUIDE.md), which is also copied into every new project; this page is the
task-oriented tour.

The editor preview and the running game use the same renderer in a Shadow DOM, at the authored design resolution.
Authored CSS therefore cannot restyle the editor or the game page, and what you frame in the designer is what the
game draws.

## Screens

The left panel lists every screen: `◈` marks a HUD screen, `▣` a menu screen. **+ Add screen** creates one, and
right-clicking a screen offers **Open screen**, **Rename…**, **Duplicate** and **Delete**.

A screen's kind decides how it behaves at runtime:

| Kind | Behaviour |
| --- | --- |
| `hud` | Drawn while playing. Its **Mode** (`all`, `domination`, `tdm`) filters it to one game mode; `all` always draws |
| `menu` | Drawn by the menu system: the default project ships **Main menu**, **Pause menu** and **Settings menu** screens whose IDs (`main`, `pause`, `settings`) the runtime drives |

A new project ships six screens: the default HUD, a domination overlay, a TDM overlay and the three menus. In the
screen inspector you can rename a screen, change **Screen kind**, edit **Mode (all / domination / tdm)** and set
the **Design width**/**Design height**. HUD overlays are composed together in the game, so a TDM match draws the
default HUD plus every TDM screen.

## Elements

**LAYERS** holds **+ text**, **+ panel**, **+ image**, **+ bar**, **+ button**, **+ slider** and **+ crosshair**.

| Type | What it does at runtime |
| --- | --- |
| `text` | Left-aligned label; `{{tokens}}` are substituted from live state |
| `panel` | Plain rectangle for backdrops and frames |
| `image` | Draws the selected project image, contained in the element box (a dashed "No image set" box while `src` is empty) |
| `bar` | Fill from left to right, `value / maximum`, clamped to 0–1 |
| `button` | Clickable; emits one of the allowlisted actions |
| `slider` | Label plus a 0–1 range input bound to `volume` or `sensitivity` |
| `crosshair` | Centred `+` that fades out while aiming down sights |

**Search layers** filters the layer list without changing the selection. Right-click a layer for **Select layer**,
**Rename…**, **Copy**, **Bring forward**, **Send backward**, **Duplicate** and **Delete**. Array order is stacking
order, so forward/backward changes what covers what. **Screen settings / design system** returns the inspector to
the screen itself. `Ctrl+C` copies the selected element into an element clipboard that `Ctrl+V` pastes into any
screen with a small offset.

A new element starts at 60/60 with a 240 × 60 box (panels 400 × 220), anchor *top-left*, 24 px text, full opacity
and an 8 px corner radius; text elements start with `New label {{ammo}}`, buttons with `BUTTON` and the action
`resume`, bars with the `health` binding and a maximum of 100, sliders with the `volume` binding.

## Placing, sizing and anchors

- Drag an element to move it (positions are rounded to whole design pixels; hold **Shift** for a 10 px grid).
- Drag one of the eight handles to resize around the opposite edge; the smallest size is 8 px.
- With an element selected, arrow keys nudge it 1 px (**Shift** = 10 px). Nudging follows the anchor: moving left on
  a right-anchored element grows its offset.
- Clicking the design background clears the selection.

Each element stores an anchor plus `x`/`y`, and the anchor decides what those offsets mean:

| Anchor | `x` | `y` |
| --- | --- | --- |
| `top-left`, `center-left`, `bottom-left` | distance from the left edge | distance from the top or bottom edge |
| `top-center`, `center`, `bottom-center` | offset from the horizontal centre (positive = right) | distance from the top or bottom edge |
| `top-right`, `center-right`, `bottom-right` | distance from the right edge | distance from the top or bottom edge |

The anchor also chooses what "centre" means when the canvas scales, which is why a health bar anchored
`bottom-left` and an ammo readout anchored `bottom-right` both stay in their corners at any resolution.

Six alignment buttons — **Left**, **Center X**, **Right**, **Top**, **Center Y**, **Bottom** — move the element to
that edge or axis, and **Fit inside canvas** shrinks an oversized element and pulls it back on screen. All of them
preserve the anchor, and each is one undoable edit. Elements that end up completely outside the canvas are dimmed
in the editor as a warning and are clipped in the game, so nothing silently draws off screen.

## The inspector

With an element selected, the right panel groups fields into disclosures that remember their state while you edit:

- **ELEMENT / INSPECTOR** — **Element name** and **Element ID / CSS selector** (the ID is what
  `[data-element="…"]` selects; changing it renames the selector).
- **LAYOUT / ALIGNMENT** — **Anchor**, `x`, `y`, `width`, `height`, the alignment buttons and **Fit inside canvas**.
- **APPEARANCE / TYPOGRAPHY** — `fontSize`, `opacity`, `borderRadius`, `color`, `background`, **Font family**, and
  **Upload font and use it here…**.
- **CONTENT / BEHAVIOR** — **Text / {{binding}} template** (multiline), **Visible when**, and type-specific fields:
  **Image asset** for images, **Data binding** for bars and sliders, **Maximum value** for bars, **Button action**
  for buttons.
- **CSS / ADVANCED** — **CSS class(es)** and **STYLE TEMPLATES**.
- **ELEMENT ACTIONS** — **Duplicate element**, **Delete element**, and an **Element JSON** panel that validates
  whatever you paste back.

With no element selected the inspector edits the screen instead: name, kind, mode, design canvas, **FONTS**,
**STYLE TEMPLATES**, **SCREEN ACTIONS** (duplicate/delete the screen), **LIVE PREVIEW DATA** and **Screen JSON**.

## Images and fonts

- **Image asset** picks from the project's images; **Upload image…** copies a file into the project (desktop) or
  inlines it as a data URL under 1.5 MB (browser); **Clear image** empties `src`.
- A missing image file fails the game boot with `Asset not bundled`, which **File → Check project…** reports
  before you ever press Play.
- Fonts are either a bundled `src/assets/fonts/<file>.woff2|woff|ttf|otf` asset or an inline `data:font/…` URL up
  to 3 MB. Remote URLs are rejected. Upload with **Upload font…** (screen inspector) or **Upload font and use it
  here…** (element inspector), then pick the family in **Font family**. Up to 64 fonts per project.

## The CSS code tab

**CSS code** next to **Layout** swaps the stage for the scoped stylesheet editor. It validates as you type and
lists plain-language problems under the heading **CSS CODE — SCOPED TO THE GAME UI**; a clean sheet reports
"No problems found". What the game accepts:

- Selectors over `[data-screen="hud"]`, `[data-element="ammo"]`, the element classes (`.ui-text`, `.ui-button`,
  `.ui-bar .fill`) and `:hover`.
- `@keyframes` on colour, opacity, filter or box-shadow. The engine owns position and size, so animating those
  will not take effect.
- `{{health}}`, `{{ammo}}`, `{{weapon}}` and the other bindings inside templates.

Never JavaScript, `@import` or remote URLs: the renderer drops them and the panel explains why. **FONT FAMILIES —
CLICK TO INSERT** inserts a `font-family` rule for a system or uploaded family, and the cheatsheet at the bottom
keeps the selector and data contract visible. The stylesheet is stored in the project, so it ships with the game
and stays offline.

## Style templates

**STYLE TEMPLATES** applies a reusable CSS snippet to the selected element (or, from the screen inspector, to the
whole screen). Built-in snippets include **Neon glow**, **Spaced uppercase**, **Dark glass panel**, **Mint
button**, **Outline text**, **CRT scanlines** and **HUD bar**. Name a snippet and press **Save as template** to keep
your own; custom templates are project data and can be deleted from their right-click menu. Applying a template
writes one scoped rule, so re-applying replaces rather than stacks.

## Live data: bindings, tokens and actions

Text, buttons and templates substitute `{{token}}` from the runtime state; an unknown token renders as nothing.
The available names are the binding list:

| Group | Names |
| --- | --- |
| Player | `health`, `ammo`, `reserve`, `weapon`, `reloading`, `ads`, `hitmarker`, `message` |
| Scores and objectives | `scoreA`, `scoreB`, `objective`, `mode`, `timeLeft`, `matchStatus` |
| Match and identity | `team`, `teamA`, `teamB`, `kills`, `deaths`, `killfeed`, `enemiesAlive`, `downed` |
| Settings | `volume`, `sensitivity` |

- **Visible when** picks one binding; the element is hidden whenever that value is falsy, which is how `{{message}}`
  banners and the `hitmarker`/`reloading`/`downed` labels appear and disappear.
- **Data binding** on a bar drives its fill (`health`, `ammo`, `scoreA`, …) against **Maximum value**; on a slider it
  is limited to `volume` and `sensitivity`, which the game applies to the shared audio and mouse settings.
- **Button action** is limited to `resume`, `main`, `pause`, `settings`, `back`, `restart` and `quit`. The runtime
  wires those to the real menu flow; in the designer's interactive preview they navigate to the matching screen
  (`settings` → the settings screen, `main` → the main menu, `back` → the pause menu, anything else → the HUD) so
  you can walk the flow without playing.

## Previewing

- **Switch to interactive preview** turns the design surface into a live UI: buttons click through the menus and
  sliders move (editor-only in this mode). **Switch to layout editing** returns to drag-and-drop.
- **Preview mode** chooses which HUD screens are composed (`sandbox`, `domination`, `tdm`), so a mode-specific
  overlay can be checked without starting a match.
- **Preview scenario** fakes player state: *Normal*, *Low health / ammo*, *Reloading*, *Downed* and *Aiming / ADS*.
  These are editor mock values for checking layout and visibility rules; they never change the project's gameplay
  defaults. **LIVE PREVIEW DATA** in the screen inspector lets you set individual values.
- **Viewport** frames the canvas at **Fit workspace**, **960px wide** or **640px wide** so narrow layouts can be
  checked. The choice is editor state and survives edits.

Save when the layout is right; **Play** reads the current project, so the HUD you see in the designer is the HUD in
the game. A missing screen ID the menu system expects (for example no `main` screen) is described in
[`UI_GUIDE.md`](../UI_GUIDE.md)'s failure-mode table.

## Related

- [`UI_GUIDE.md`](../UI_GUIDE.md) — full schema, CSS contract and validated examples
- [Game modes and properties](08-game-modes-and-properties.md) — modes that decide which HUD screens draw
- [Play, test and ship](09-playtest-and-build.md) — the menu flow in the running game

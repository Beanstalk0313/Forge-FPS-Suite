# Forge UI reference (HUD and menus)

Reference contract for the Forge FPS editor and game. Both applications render the **same** authored document with the **same** renderer (`src/ui/UIRenderer.js`), so there is no second UI framework and nothing to import.

Code blocks marked `json ui-*` are executed against the real validator by `tests/ui-guide.test.js`. If you edit one, run `npm test`.

## 1. How to use this file

1. Read §2 (file map) and §3 (hard rules) before changing anything.
2. Decide the change class: **data only** (§5 recipes), **CSS only** (§6), or **engine change** (§7).
3. Apply the recipe exactly: it names the file, the JSON path inside that file, and the editor control that does the same thing if the user is working in the app.
4. Verify with §9. A canvas on screen is not proof — menu readiness is `window.__menu`; fully loaded gameplay readiness is `window.__game`; a failure is `window.__bootError`. The entry level is not constructed until Play.

Never invent a binding, action, or element type. §4.6 and §4.7 are the complete lists; anything else requires the engine change in §7 and a test.

## 2. Where changes belong

| Path (relative to the game project root) | Owns | Edit it when |
| --- | --- | --- |
| `public/authoring/project.json` → `ui` | design resolution, CSS string, fonts, templates, screens, elements | almost every visual change (§5) |
| `public/authoring/project.json` → everything else | weapons, clips, prefabs, entry scene | not UI work; leave untouched |
| `src/assets/images/…` | PNG/JPG/JPEG/WebP artwork referenced by `image` elements | adding art (import through the editor so the path is correct) |
| `src/assets/fonts/…` | woff2/woff/ttf/otf referenced by `ui.fonts[].source` | adding a typeface |
| `src/ui/UIRenderer.js` | shared renderer: element DOM, text interpolation, anchors, bars, sliders, crosshair, `BINDINGS`, `ACTIONS` | a genuinely new element capability or binding (§7) |
| `src/ui/GameUI.js` | runtime host: menu navigation, state mapping, pointer lock, settings persistence | a new runtime value or menu behaviour (§7) |
| `src/systems/MatchState.js` | team scores, kill feed, clock, match status behind §4.6's match bindings | new match rules or scoring |
| `src/authoring/Project.js` | `validateProject()` limits and `defaultUI()` starter document | a new validated field (§7) |
| `src/authoring/UICSS.js` | marker-block insert/replace used by style templates | never for normal CSS |
| `toolsuite/src/UITool.js` | editor controls for screens, layers, inspector, fonts, templates | exposing a new authoring control (§7) |
| `UI_GUIDE.md` | this reference; ships unpacked with the app and is copied into new and repaired projects | documenting any new capability |

A game created in Forge is a self-contained project with its own copy of all of the above. The paths are identical inside a user's project; this repository is itself one such project.

**When a change takes effect**

| Change | Editor preview | Desktop Play | Built game |
| --- | --- | --- | --- |
| `ui` JSON or CSS | immediately | after Save | after Build installer |
| New image/font file | after **Refresh** in the Assets dock, then re-select the element to rebuild its asset list | Play reloads the game page | requires Build (assets are resolved at build time) |
| Engine code (`src/ui/*`) | Vite HMR | Play reloads the game page | requires Build |

## 3. Hard rules

- Project format version is **1**. Keep `version`, and every key you do not understand.
- All numbers are JSON numbers. `"48px"`, `"0.5"`, and `null` are rejected for numeric fields.
- Every element needs these keys, always present: `id`, `type`, `x`, `y`, `width`, `height`, `anchor`, `text`, `color`, `background`, `fontSize`, `opacity`, `borderRadius`. The validator rejects a missing numeric or a non-string `text`/`color`/`background`.
- `width`, `height`, `fontSize` > 0; `opacity` 0–1; `borderRadius` ≥ 0; `maxValue` (bars) > 0 when present.
- `id` is unique inside its screen and is the CSS selector (`[data-element="<id>"]`). Screen `id`s are unique in the document. `name` is a free-text designer label (≤ 64 chars) and is not a selector.
- `id`s `main`, `pause`, `settings` on `kind: "menu"` screens are runtime navigation contracts. Keep them; you may rename `name`.
- Text templates are `{{binding}}` substitutions, not HTML and not expressions. Unknown bindings render as an empty string.
- No scripts, no event-handler strings, no inline HTML. `validateProject()` rejects remote font sources; remote `@import`/`url(...)` in `ui.css` are blocked by the editor CSP and would make a built game non-self-contained — treat them as forbidden (§6.5).
- Save is validated before it writes: an invalid document is refused, and the previous file on disk stays intact.

## 4. The UI document

### 4.1 Top level

```jsonc
{
  "width": 1920,        // design resolution, number > 0
  "height": 1080,
  "css": "",            // hand-written CSS, string, max 1 MB
  "fonts": [],          // max 64 entries (§4.8)
  "templates": [],      // max 200 entries (§4.9)
  "screens": []         // see §4.2
}
```

`width`/`height` are design pixels, not monitor pixels. The renderer scales the whole design uniformly to fit the available rectangle, centres it, and letterboxes the remainder. Anchors operate inside the design rectangle. This is deliberately not a responsive flex/grid engine; check the 640px and 960px preview widths in the editor before calling a layout done.

### 4.2 Screens

```json ui-screen
{
  "id": "tdm",
  "name": "TDM score",
  "kind": "hud",
  "mode": "tdm",
  "elements": [
    {
      "id": "tdm-score", "type": "text", "name": "TDM score",
      "x": 0, "y": 40, "width": 380, "height": 48, "anchor": "top-center",
      "text": "TDM   {{scoreA}} : {{scoreB}}", "color": "#f1f5ff", "background": "transparent",
      "fontSize": 24, "opacity": 1, "borderRadius": 0
    }
  ]
}
```

- `kind`: `"hud"` or `"menu"`.
- `mode`: plain name — `"all"`, the scene's `mode`, or a `?mode=` URL value. HUD screens with `mode: "all"` plus every HUD screen matching the current mode are composited in array order. Exactly one menu screen is shown at a time.
- Adding a mode name does not create that game mode.
- Elements draw in array order; later elements cover earlier ones. There is no parent/child layout: put a backdrop panel immediately before the elements that should sit on it.

Runtime menu contract:

| Screen id | Shown when |
| --- | --- |
| `main` | before the first play, and after a `main` action |
| `pause` | pointer lock released after playing has started |
| `settings` | after a `settings` action |

If the runtime needs a menu screen that does not exist, it renders a plain "Click to resume" button instead.

### 4.3 Element fields

| Field | Type | Required | Meaning / renderer effect |
| --- | --- | --- | --- |
| `id` | string | yes | unique per screen; becomes `data-element` and the CSS selector |
| `type` | string | yes | one of §4.5 |
| `name` | string ≤ 64 | no | designer label only |
| `x`, `y` | number | yes | position relative to the anchor (§4.4) |
| `width`, `height` | number > 0 | yes | design pixels |
| `anchor` | string | yes | one of §4.4 |
| `text` | string | yes | text content / button label / slider label / image alt text |
| `color` | string | yes | CSS colour; also tints `bar` fills (`.fill` uses `currentColor`) |
| `background` | string | yes | CSS background shorthand, gradients allowed |
| `fontSize` | number > 0 | yes | inline `font-size`, design pixels |
| `font` | string ≤ 64 | no | CSS font-family; empty inherits from the shadow root |
| `opacity` | number 0–1 | yes | inline opacity |
| `borderRadius` | number ≥ 0 | yes | inline radius |
| `className` | string | no | appended to the class list; space-separated classes allowed |
| `visibleWhen` | string | no | show only while that binding is truthy (§4.6) |
| `binding` | string | bars, sliders | the value a bar or slider displays |
| `maxValue` | number > 0 | bars | value that equals a full bar; default 100 |
| `action` | string | buttons | one of §4.7 |
| `src` | string | images | asset path under `src/assets/` or a `data:` URL |

### 4.4 Anchors

| Anchor | `x` means | `y` means |
| --- | --- | --- |
| `top-left` | left inset | top inset |
| `top-center` | signed horizontal offset from centre | top inset |
| `top-right` | right inset | top inset |
| `center-left` | left inset | signed vertical offset from centre |
| `center` | signed horizontal offset from centre | signed vertical offset from centre |
| `center-right` | right inset | signed vertical offset from centre |
| `bottom-left` | left inset | bottom inset |
| `bottom-center` | signed horizontal offset from centre | bottom inset |
| `bottom-right` | right inset | bottom inset |

**Editor layout tools (no schema change):** the selected element's **Layout / alignment** group has Left / Center X / Right / Top / Center Y / Bottom buttons, plus **Fit inside canvas**. These move the actual design-space box and convert the position back to the existing anchor offsets; alignment never renames IDs or changes anchors. Fit also limits an oversized box to the design resolution. Every operation is one undoable project edit. **Search layers** filters the list only. The **Preview scenario** picker simulates Normal, Low health/ammo, Reloading, Downed and Aiming/ADS without saving those values into the project. The Viewport picker remains selected across inspector edits and interactive/layout switches.

Centered axes are placed with a `translate(-50%)` on that axis. `anchor: "center"`, `x: 0`, `y: -120` puts the element **centre** 120 design pixels above the design centre. Right/bottom anchors convert `x`/`y` into insets, which is why dragging an element right decreases its `x`. Do not override the anchor transform in CSS unless you intend to replace the layout.

### 4.5 Element types

| Type | Extra fields | Emitted DOM | Runtime behaviour |
| --- | --- | --- | --- |
| `text` | `visibleWhen` | `<div class="ui-element ui-text">` | text re-interpolated every frame |
| `panel` | — | `<div class="ui-element ui-panel">` | decorative background |
| `image` | `src`, `text` (alt) | `<img class="ui-element ui-image">`, or a dashed "No image set" `<div>` when `src` is empty | `object-fit: contain` |
| `bar` | `binding`, `maxValue` | `<div class="ui-element ui-bar"><div class="fill"></div></div>` | fill width = `clamp(value / maxValue)` as a percentage |
| `button` | `text`, `action` | `<button type="button" class="ui-element ui-button">` | click runs the action (§4.7) |
| `slider` | `text`, `binding` | `<div class="ui-element ui-slider"><span>label</span><input type="range" min="0" max="1" step="0.01"></div>` | range 0–1; `volume`/`sensitivity` write through to real settings |
| `crosshair` | — | `<div class="ui-element ui-crosshair">+</div>` | forced to `opacity: 0` while `ads` is true |

Editor defaults when you press `+ <type>`: `x`/`y` 60, `width` 240 (`panel` 400), `height` 60 (`panel` 220), `fontSize` 24, `opacity` 1, `borderRadius` 8, `color` `#edf4ff`, `background` `#24354a` for `panel`/`button` and `transparent` otherwise, `anchor` `top-left`.

### 4.6 Runtime bindings

Text and bars read these names. Sources are exact.

| Binding | Value | Notes |
| --- | --- | --- |
| `health` | `player.health` | starts at 100; bots and other players can damage it |
| `ammo` | rounds in the magazine | integer |
| `reserve` | rounds left in reserve | integer |
| `weapon` | active weapon's authored `name` | text |
| `scoreA` | score of the first team | team mode: `match.teams[0]`; otherwise the domination capture score |
| `scoreB` | score of the second team | `0` in a scene with no second team |
| `objective` | capture status of the nearby point | domination only; often empty |
| `mode` | active mode name | e.g. `sandbox`, `domination`, `tdm` |
| `team` | the player's own team name | `match.teamNames[team]` or the team id |
| `teamA` | display name of the first team | pair with `scoreA` |
| `teamB` | display name of the second team | pair with `scoreB` |
| `kills` | the player's kill count | team modes only |
| `deaths` | the player's death count | team modes only |
| `killfeed` | last five eliminations, one per line | `killer  ›  victim`; lines expire after ~8 s |
| `enemiesAlive` | living participants on the other team | team modes only |
| `timeLeft` | match clock `MM:SS` | empty when the scene has no time limit |
| `matchStatus` | `Starting in 3`, `Alpha wins`, `Draw` | empty while the match is running |
| `downed` | boolean while the player is eliminated and waiting to respawn | team modes only |
| `reloading` | boolean while the reload timer runs | |
| `ads` | boolean while aiming | hides the crosshair |
| `hitmarker` | boolean flash after a hit (~0.12 s) | |
| `message` | current trigger message or elimination notice | cleared after ~4 s |
| `volume` | persisted master volume 0–1 | slider target |
| `sensitivity` | persisted sensitivity control 0–1 | slider target |

Bindings that need a match (`team`, `teamA`, `teamB`, `kills`, `deaths`, `killfeed`, `enemiesAlive`, `timeLeft`, `matchStatus`, `downed`) render as empty or `0` in `sandbox`, so the same screen can be reused across modes.

Interpolation pattern: `\{\{([a-zA-Z0-9_]+)\}\}` — letters, digits, underscore only, no spaces, no expression syntax.

`visibleWhen` compares against the same names, by truthiness, with no expression language. Use `"reloading"`, never `"ammo === 0"`. A `visibleWhen` name that is not in the table hides the element permanently, which is the usual cause of "my element vanished".

### 4.7 Button actions

| Action | Runtime effect |
| --- | --- |
| `resume` | from main: loads the entry level behind an opaque asset barrier, then requests pointer lock; from pause: requests pointer lock. If browser activation expires during loading, click Resume once more |
| `settings` | opens the `settings` screen and remembers the current menu |
| `back` | returns from `settings` to that remembered menu |
| `main` | reloads to the standalone main menu, unloading the game world |
| `pause` | opens `pause` and exits pointer lock |
| `restart` | reloads to the main menu, keeping URL parameters |
| `quit` | closes the desktop game/preview window through its Quit-only bridge; browser tabs may need to be closed manually |

Buttons only fire when the renderer is not in layout-edit mode. In the editor that means: use **Switch to interactive preview** to test buttons.

### 4.8 Fonts

```json ui-font
{
  "id": "font-rajdhani",
  "name": "Rajdhani",
  "source": "src/assets/fonts/rajdhani-1a2b3c4d.woff2"
}
```

- `name` is the value you type into an element's `font` (≤ 64 chars). Matching is exact and case-sensitive.
- `source` must be `src/assets/fonts/<file>.woff2|.woff|.ttf|.otf`, or an inline `data:font/…` / `data:application/font…` URL of at most 3 MB. Remote URLs are rejected.
- The renderer injects one `@font-face` per entry above `ui.css` in the same shadow root, so authored CSS can still override.
- Maximum 64 fonts. One file per family: no variable axes, no per-weight files in one entry.
- Fonts are project-wide: every screen, HUD and menu lists them in **Font family**. Import from either context — the element inspector's **Upload font and use it here…** (assigns it to the element in one step) or the screen panel's **Upload font…**. The CSS code tab lists every family as a clickable chip that inserts `font-family:"…";` at the caret.

### 4.9 Style templates

```json ui-template
{
  "id": "tpl-neon",
  "name": "Neon glow",
  "css": "text-shadow:0 0 8px currentColor,0 0 22px currentColor;"
}
```

A template is a CSS body (no selector) plus a name. Applying it writes a marked rule into `ui.css` (§6.3). Max 200 templates, `css` 1–65536 characters. The editor ships seven built-ins (Neon glow, Spaced uppercase, Dark glass panel, Mint button, Outline text, CRT scanlines, HUD bar) that are not stored in the project.

## 5. Recipes

Each recipe names the file, the JSON path, the block to paste, the equivalent editor action, and how to confirm it.

### 5.1 Add one element to an existing screen

- **Edit** `public/authoring/project.json` → `ui.screens[?id="hud"].elements`, appended to the end of the array unless it must sit behind something.
- **Paste** (ammo readout, bottom-right anchored):

```json ui-element
{
  "id": "ammo-readout", "type": "text", "name": "Ammo readout",
  "x": 48, "y": 48, "width": 240, "height": 60, "anchor": "bottom-right",
  "text": "{{ammo}} / {{reserve}}", "color": "#f4d17b", "background": "transparent",
  "font": "Segoe UI", "fontSize": 36, "opacity": 1, "borderRadius": 0, "className": "ammo-readout"
}
```

- **Editor** UI tab → select the screen in **SCREENS** → `+ text` → set Anchor to `bottom-right` → type `{{ammo}} / {{reserve}}` in **Text / {{binding}} template**.
- **Verify** the preview shows a number pair; press Save.

### 5.2 Add a health bar

```json ui-element
{
  "id": "health-bar", "type": "bar", "name": "Health",
  "x": 48, "y": 48, "width": 280, "height": 14, "anchor": "bottom-left",
  "text": "", "color": "#65e6ac", "background": "#263244",
  "fontSize": 24, "opacity": 1, "borderRadius": 0, "binding": "health", "maxValue": 100,
  "className": "health-bar"
}
```

The bar's `color` also colours the fill (`.fill` uses `currentColor`). Use `background` for the empty track.

### 5.3 Add an image element

1. Import the file: **Assets** dock → **Import files…** (desktop copies it into `src/assets/images/imported/` with a collision-safe name; in the browser edition there is no project folder, so copy the file into `src/assets/images/` yourself). Press **Refresh**, then re-select the element so its **Image asset** list is rebuilt.
2. Add the element with the returned path:

```json ui-element
{
  "id": "brand-mark", "type": "image", "name": "Game logo",
  "x": 0, "y": 100, "width": 320, "height": 160, "anchor": "top-center",
  "text": "Game logo", "color": "#ffffff", "background": "transparent",
  "fontSize": 24, "opacity": 1, "borderRadius": 0,
  "src": "src/assets/images/imported/logo-a1b2c3d4.png", "className": "brand-art"
}
```

- **Editor** shortcut: **Assets** dock → **Use** on the row creates the element with `src` and `name` already filled.
- Artwork guidance: author at ~2× intended design size, keep the aspect ratio in `width`/`height`, use PNG with alpha for logos and icons. For a cropped splash, add `object-fit: cover` through `ui.css` on that `className`.
- **Verify** the `<img>` loads with non-zero `naturalWidth` in the editor preview; a missing file raises `Asset not bundled: …` in the game and fails boot.

### 5.4 Add a font

1. **Projects** dialog → project is open → **Assets** dock → **Import files…** and pick a `.woff2`/`.ttf`/`.otf`; it lands in `src/assets/fonts/`.
2. Add the entry (§4.8) or press **Upload font…** in the **FONTS** panel.
3. Set an element's **Font family** to the font's `name`.

The editor's font list is `name` + registered fonts only; a name that is not registered still renders but falls back to the system font.

### 5.5 Add a menu screen or a mode HUD

- New `kind: "hud"` screen: append to `ui.screens` with a fresh unique `id`, `mode` set to the mode it belongs to (`"all"` for shared HUD). It composes automatically in that mode.
- New `kind: "menu"` screen: only `main`, `pause`, and `settings` are reachable (§4.2). Extra menu screens render only through custom navigation code (§7).
- Backdrops go first in the `elements` array; interactive controls last.
- **Editor** **+ Add screen**, then **Screen settings / design system** to set name, kind, and mode.

### 5.6 Add a conditionally visible element

Add `visibleWhen` with one of §4.6's names:

```json ui-element
{
  "id": "reload-prompt", "type": "text", "name": "Reloading",
  "x": 0, "y": 70, "width": 200, "height": 40, "anchor": "center",
  "text": "RELOADING", "color": "#f4d17b", "background": "transparent",
  "fontSize": 18, "opacity": 1, "borderRadius": 0, "visibleWhen": "reloading"
}
```

The editor's **Visible when** dropdown lists exactly the valid names. Test it by flipping **LIVE PREVIEW DATA → reloading** on the screen inspector.

### 5.7 Safe rename

Change `name` freely. Change `id` only together with every CSS selector and any `visibleWhen`/`className` reference, and prefer the editor's **Element ID / CSS selector** field, which re-renders the preview and keeps undo history.

## 6. CSS

### 6.1 Where it goes

`public/authoring/project.json` → `ui.css`, one string with `\n` escapes. **Editor**: UI tab → **CSS code** stage tab. The editor validates as you type (unbalanced braces, unterminated comments, script URLs, `@import`, unknown at-rules, `url()` targets that are not project assets) with plain-language messages and never executes the stylesheet. The screen panel keeps **Open the CSS code editor** as its entry point and style templates keep writing scoped rules.

The game mounts two separate renderers with two shadow roots: one for the HUD, one for menus. `ui.css` is injected into both, so a `[data-screen="main"]` rule is simply inert in the HUD root and vice versa — that is a scoping tool, not a bug. Authored CSS cannot reach the editor, the game canvas, or the other page. Use `:host` for global variables.

### 6.2 Rendered markup and selectors

```html
<div class="design" style="width:1920px;height:1080px;transform:scale(0.7)">
  <div class="screen" data-screen="hud">
    <div class="ui-element ui-text ammo-readout" data-element="ammo-readout">24 / 180</div>
    <div class="ui-element ui-bar health-bar" data-element="health-bar"><div class="fill" style="width:78%"></div></div>
    <button type="button" class="ui-element ui-button" data-element="play">Play</button>
    <div class="ui-element ui-slider" data-element="volume">
      <span>Master volume</span>
      <input type="range" min="0" max="1" step="0.01" value="0.7" aria-label="Master volume">
    </div>
    <img class="ui-element ui-image" data-element="brand-mark" src="…" alt="Game logo">
    <div class="ui-element ui-crosshair" data-element="crosshair">+</div>
    <div class="ui-element ui-panel" data-element="backdrop"></div>
  </div>
</div>
```

Reliable selectors:

```css
:host { --accent: #77e4c1; }
[data-screen="hud"] [data-element="ammo-readout"] { /* one element */ }
[data-screen="domination"] .ui-text { /* mode overlay typography */ }
.ammo-readout { /* className from element data */ }
.ui-bar .fill { /* bar fill */ }
.ui-button:hover, .ui-button:focus-visible { /* interaction */ }
.ui-slider input { /* native slider */ }
```

### 6.3 What data owns, what CSS owns

The renderer writes these as **inline styles** on every element: position/anchor transform, `width`, `height`, `color`, `background`, `font-size`, `font-family`, `opacity`, `border-radius`. A plain CSS declaration for one of those loses to the inline style; change it in the element data, or use `!important` as a deliberate, commented override.

CSS is for everything else: font weight, letter spacing, text transform, borders, box shadow, padding, gaps, inner layout, gradients over the default background, animations, pseudo-elements, hover/focus states.

Base styles the renderer already sets (override deliberately, not blindly): `.ui-element` is a flex box centred in both axes with `overflow: hidden` and `white-space: pre-wrap`; `.ui-text` is left-aligned and left-justified; `.ui-crosshair` is `font-size: 30px`; `.ui-bar .fill` is absolutely positioned and painted with `currentColor`; `.ui-button:hover` is `filter: brightness(1.2)`; `.ui-button:focus-visible` is a 3px mint outline; Any element also receives `.selected` in the editor when it is the chosen layer, and `.editing .ui-element` (pointer events on, `cursor: move`) applies to every element while the editor is in layout mode.

Complete example skin:

```css
:host {
  --accent: #77e4c1;
  --ink: #eaf6ff;
  --muted: #a9bcc9;
  font-family: 'Segoe UI', Arial, sans-serif;
}
[data-screen="hud"] [data-element="ammo-readout"] {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: .06em;
  justify-content: flex-end;
  text-align: right;
  text-shadow: 0 2px 12px #000;
}
[data-screen="hud"] .ui-bar {
  border: 1px solid #ffffff2e;
  box-shadow: 0 3px 16px #0008;
}
[data-screen="hud"] .ui-bar .fill { transition: width 140ms ease-out; }
[data-screen="main"] [data-element="title"] {
  letter-spacing: .18em;
  text-transform: uppercase;
  text-shadow: 0 4px 32px #000b;
}
[data-screen="main"] .ui-button {
  border: 1px solid #ffffff30;
  letter-spacing: .14em;
  font-weight: 650;
  transition: filter 150ms ease, box-shadow 150ms ease;
}
[data-screen="main"] .ui-button:hover { box-shadow: 0 0 28px #77e4c12b; }
[data-screen="main"] .ui-button:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
.ui-slider span { color: var(--muted); font-size: 18px; letter-spacing: .08em; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

Keep animation subtle and stop it under reduced motion. Never animate or override the `.design` transform: it owns the letterboxed scale.

### 6.4 Template marker blocks

Applying a template (or `upsertRule` in code) writes one scoped rule, preceded by a marker comment:

```css
/*forge:tpl-neon:element:ammo-readout*/
[data-element="ammo-readout"]{text-shadow:0 0 8px currentColor,0 0 22px currentColor;}
```

Marker format: `/*forge:<templateId>:<element|screen>:<targetId>*/`. Reapplying the same template to the same target replaces exactly that rule — brace matching, so nested `@media` inside template CSS is safe — and leaves hand-written rules alone. A different template adds another marked rule. Delete the block by hand to undo it. A malformed marker (no `{`) drops only the comment; an unterminated rule truncates the sheet after the marker, which is why generated rules always close.

### 6.5 Security and portability

- No HTML/JS insertion, no `eval`, no inline handlers, no remote components. Templates substitute text only.
- Remote font URLs are rejected by `validateProject()`. Remote `@import`, `url(...)` and tracking URLs are not rejected by validation but are blocked by the editor's CSP and make a built game non-self-contained: keep authored CSS offline-safe.
- Local CSS `url(...)` is **not** asset-resolved. Use an `image` element's `src` for portable artwork.
- Fonts must be in `ui.fonts` (project file or inline data URL).
- `body`, `#hud-root`, and the game canvas are outside the shadow root; style them with `:host` and the documented selectors or not at all.
- Animate safely with `@keyframes` on `color`, `opacity`, `filter`, or `box-shadow`. The engine owns each element's position and size, so keyframing `transform`, `left`, `top`, `width` or `height` fights the runtime — animate the paint, not the layout.
- Elements fully outside the design canvas never render in the game: the layout editor dims them (35% opacity) instead of clipping, and the game-facing preview and runtime clip the design exactly, so what the frame shows is what ships.
- Review CSS from untrusted sources: shadow DOM isolates selectors, it does not sanitise.

## 7. Engine changes (only when data cannot express it)

Order matters; each step is verifiable on its own.

**New runtime binding (e.g. a new HUD value)**

1. Produce the value in `src/ui/GameUI.js` → `state()` (return a stable primitive).
2. Add the name to `BINDINGS` in `src/ui/UIRenderer.js` so the editor's dropdowns list it.
3. If it needs a limit, add a validator branch in `validateProject()` in `src/authoring/Project.js`.
4. Add the field to the editor's `state` object and **LIVE PREVIEW DATA** list in `toolsuite/src/UITool.js`.
5. Add a test in `tests/authoring.test.js` (validator) or `tests/ui-guide.test.js` (documentation examples).
6. Document it here (§4.6) with the exact expression.

**New element type**

1. Render it in `UIRenderer.render()` (and its per-frame update in `update()` if it animates from state).
2. Add the type name to the `el.type` allowlist in `validateProject()`.
3. Add it to the editor's add-grid and label map in `toolsuite/src/UITool.js`.
4. Add defaults to `createElement` paths and test the markup; document the emitted DOM in §6.2.

**New button action or menu route**

1. Add the name to `ACTIONS` in `src/ui/UIRenderer.js`.
2. Implement it in `GameUI.action()` (and set `this.menu` for menu routes).
3. Allow it in `validateProject()`'s button-action list.
4. Test it and document the exact effect in §4.7.

Renderer changes must land in the shared `UIRenderer`, not in the editor, so the designer and the game stay identical. Do not add a second rendering library, a component framework, or authored scripts.

## 8. Editor walkthrough (exact labels)

Top bar: **Projects**, **Save**, tabs **Scene / Weapons / Animation / UI**, and **Quit** when running the desktop app.

**UI tab layout**

- Viewport toolbar: stage tabs **Layout** / **CSS code**, then (in Layout) **Switch to interactive preview** / **Switch to layout editing**, **Preview mode** (`sandbox`/`domination`/`tdm`), **Viewport** (`Fit workspace`, `960`, `640`).
- Design stage (Layout): the frame around the canvas is the game screen, labelled `<width> × <height>`; anything outside the frame is dimmed and will not render in the game. Drag an element to move it (Shift = 10 px grid); with an element selected, eight mint handles resize it — corners scale both axes, edges one — and commit like any edit (Shift snaps). Arrow keys nudge the selection 1 px, Shift+arrow 10 px, honouring the anchor.
- Left panel: **SCREENS** list (click to open, right-click for Open/Rename…/Duplicate/Delete), **+ Add screen**, then **LAYERS** with `+ text`, `+ panel`, `+ image`, `+ bar`, `+ button`, `+ slider`, `+ crosshair`; layer rows read `type · name` and right-click for Select layer/Bring forward/Send backward/Duplicate/Delete; **Screen settings / design system** selects the screen itself.
- Right panel with an element selected: **ELEMENT / INSPECTOR** — Element name, Element ID / CSS selector, Anchor, `x`, `y`, `width`, `height`, `fontSize`, `opacity`, `borderRadius`, `color`, `background`, Font family + **Upload font and use it here…**, **Text / {{binding}} template**, CSS class(es), Visible when, type-specific fields (Data binding, Maximum value, Button action, Image asset + **Upload image…** / **Clear image**), **STYLE TEMPLATES**, **Duplicate element**, **Delete element**, **Element JSON**.
- Right panel with no element selected: **SCREEN / DESIGN SYSTEM** — Screen name, Screen kind, Mode, Design width/height, **FONTS** (**Upload font…**, right-click rename/delete), **STYLE TEMPLATES**, **Open the CSS code editor**, **SCREEN ACTIONS** (**Duplicate screen**, **Delete screen**), **LIVE PREVIEW DATA** (`health`, `ammo`, `reserve`, `scoreA`, `scoreB`, `weapon`, `objective`, `message`, `ads`, `hitmarker`, `reloading`), **Screen JSON**.
- CSS code stage: the project stylesheet with live plain-language validation, clickable **FONT FAMILIES** chips, and the selectors/animation cheatsheet. `Ctrl+C` / `Ctrl+V` copy and paste elements across screens; clicking empty canvas clears the selection.
- Both JSON panels validate on apply and refuse to change `id` there; rename through the ID field instead.

**Dock and dialogs**

- **Assets** tab: Search assets, **Import files…**, **Refresh**, **Use** (sends the asset to the open tool), and **Console** tab with the retained message log.
- **Projects** dialog: **Choose folder…**, name field + **Create new**, **Recent** list with Open/Repair/Folder/Remove, and Build section with **Build installer**, **Run built game**, **Open folder**. Escape, **Close**, and a backdrop click dismiss it.
- Toolbar (**Scene** tab): Undo/Redo/Import JSON, scene picker, **New scene**, Save filename, **Set entry scene**, then **Play**, **Stop**, **Build installer**.
- Keyboard: `Ctrl+S` save, `Ctrl+Z` / `Ctrl+Y` undo/redo.

## 9. Verification

```bash
npm run check   # JavaScript syntax; this project is not TypeScript
npm test        # includes validation of every marked example in this file
npm run build   # game + editor bundles
npm run dev     # editor at /toolsuite/index.html, game at /
```

Editor pass

- Open the **UI** tab; walk every screen. Common plus mode HUD must compose exactly once (use **Preview mode**).
- Confirm **Switch to interactive preview**: Settings → Back, both sliders, and pointer-lock-free navigation.
- Flip every **LIVE PREVIEW DATA** field and confirm nothing overflows or disappears unexpectedly.
- Drag or edit an element, Save, reopen, and confirm `id`, `name`, geometry, CSS, `src`, fonts and templates survive; Undo/Redo must restore them too.
- Apply a template to an element and to a screen; re-apply and confirm replacement, not stacking.
- Check **Viewport** at `fit`, `960`, and `640` for clipping and truncation.

Game pass

- Native: **Play** (saves project + scene, starts the live game), **Stop**. Browser: **Play** opens an embedded game frame with the current document.
- Or serve the project: `/?level=arena`, `/?level=arena&mode=domination`, `?scene=zoo` for a physics sandbox with no authored data.
- In game: click **Play** on the main menu, shoot, hold RMB for ADS (crosshair hides), press `R`, walk through a trigger to see `message`, capture a domination point to fill `objective`/`scoreA`, press Escape for pause, open Settings and move both sliders.
- In game with a team scene (`?mode=tdm` or a scene whose mode is `tdm`): check the clock (`timeLeft`), both team scores, the kill feed filling on eliminations, `{{matchStatus}}` during the countdown and at the end, and `{{downed}}` while you wait to respawn.
- Assert `window.__game` exists (physics, world, hud) and `window.__bootError` is empty. A visible canvas alone proves nothing.
- Check the console and network panel for `Asset not bundled`, font 404s, or CSP violations. Newly added assets need **Build installer** before a packaged build sees them.

## 10. Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Save refused: `UI <id>: invalid x` | number written as a string or `null` | use real JSON numbers |
| Save refused: `UI <id>: text must be text` | `text`/`color`/`background` missing or non-string | add the key, use `""` for "no text" |
| Save refused: `Screen kind must be hud/menu` | typo in `kind` | `hud` or `menu` |
| Save refused: `UI <id>: missing or duplicate ID` | two elements share an `id` in one screen | rename one |
| Save refused: `UI font must be a bundled font asset…` | remote URL or a path outside `src/assets/fonts/` | import the file, or inline a `data:font/…` URL |
| Save refused: `UI CSS must be text, max 1 MB` | `ui.css` is not a string | keep it a single string |
| Element never appears | `visibleWhen` names a binding that does not exist | use a name from §4.6 |
| Element disappears during play | its `visibleWhen` binding is false (e.g. `ads` on a crosshair element) | check §4.6 semantics |
| Buttons do nothing in the editor | layout-edit mode intercepts clicks | **Switch to interactive preview** |
| Buttons do nothing in game | action is not in §4.7, or pointer lock cooldown | use a listed action; click again |
| Menu shows a plain "Click to resume" button | the expected menu id is missing or not `kind: "menu"` | add `main`/`pause`/`settings` |
| CSS seems ignored | inline element style wins, or the selector is outside the shadow root | change the data, or use `:host`/`[data-element]` with a deliberate `!important` |
| Image renders as dashed "No image set" | `src` is empty | pick **Image asset** |
| Image logs `Asset not bundled: …` | path is not under `src/assets/`, or the built game predates the import | fix the path, then Build |
| Font falls back to a system font | element `font` ≠ registered `name` (case-sensitive) | match `ui.fonts[].name` exactly |
| Bar renders empty | `binding` missing, or `maxValue` far larger than the value | set `binding`, and `maxValue` if the range differs from 100 |
| Crosshair visible while aiming | renderer forces `opacity: 0` for `crosshair` during `ads` | use `text` or `bar` if you need ADS-visible UI |
| Volume/sensitivity changes disappear after restarting the game | settings are intentionally persisted in `localStorage` under `fps-settings` | clear site/application storage for that origin to reset, or change the defaults in `GameUI` |

## 11. Deliberate limits

No responsive breakpoint geometry (one scaled design rectangle), no nested containers or layout engines, no script or expression plugins, no custom navigation graph beyond §4.2/§4.7, no variable fonts or weight axes, no remote fonts or stylesheets, no DOM/HTML injection. Gameplay-side limits that constrain UI expectations: domination is single-player team A capture with no opponent or win condition, `scoreB` never changes, and nothing damages the player yet, so `health` stays at 100. Treat these as unavailable capabilities, not as bugs to design around.

## 12. Worked example

A complete, valid `ui` document for a small game: common combat HUD, per-mode domination HUD, and the three reserved menus.

```json ui-document
{
  "width": 1920,
  "height": 1080,
  "css": "",
  "fonts": [],
  "templates": [],
  "screens": [
    {
      "id": "hud", "name": "Combat HUD", "kind": "hud", "mode": "all",
      "elements": [
        { "id": "crosshair", "type": "crosshair", "name": "Crosshair", "x": 0, "y": 0, "width": 36, "height": 36, "anchor": "center", "text": "", "color": "#eaf6ff", "background": "transparent", "fontSize": 24, "opacity": 1, "borderRadius": 0 },
        { "id": "hitmarker", "type": "text", "name": "Hitmarker", "x": 0, "y": 0, "width": 40, "height": 40, "anchor": "center", "text": "×", "color": "#ffffff", "background": "transparent", "fontSize": 26, "opacity": 1, "borderRadius": 0, "visibleWhen": "hitmarker" },
        { "id": "health", "type": "bar", "name": "Health", "x": 48, "y": 48, "width": 280, "height": 14, "anchor": "bottom-left", "text": "", "color": "#65e6ac", "background": "#263244", "fontSize": 24, "opacity": 1, "borderRadius": 3, "binding": "health", "maxValue": 100 },
        { "id": "ammo", "type": "text", "name": "Ammo", "x": 48, "y": 48, "width": 240, "height": 60, "anchor": "bottom-right", "text": "{{ammo}} / {{reserve}}", "color": "#f4d17b", "background": "transparent", "fontSize": 36, "opacity": 1, "borderRadius": 0, "className": "ammo-readout" },
        { "id": "weapon-name", "type": "text", "name": "Weapon", "x": 48, "y": 112, "width": 240, "height": 32, "anchor": "bottom-right", "text": "{{weapon}}", "color": "#a9bcc9", "background": "transparent", "fontSize": 18, "opacity": 1, "borderRadius": 0, "className": "weapon-name" },
        { "id": "message", "type": "text", "name": "Trigger message", "x": 0, "y": 120, "width": 600, "height": 48, "anchor": "center", "text": "{{message}}", "color": "#f4d17b", "background": "transparent", "fontSize": 24, "opacity": 1, "borderRadius": 0, "visibleWhen": "message" },
        { "id": "reload", "type": "text", "name": "Reloading", "x": 0, "y": 70, "width": 200, "height": 40, "anchor": "center", "text": "RELOADING", "color": "#eaf6ff", "background": "transparent", "fontSize": 18, "opacity": 1, "borderRadius": 0, "visibleWhen": "reloading" }
      ]
    },
    {
      "id": "domination", "name": "Domination score", "kind": "hud", "mode": "domination",
      "elements": [
        { "id": "score", "type": "text", "name": "Score", "x": 0, "y": 40, "width": 420, "height": 48, "anchor": "top-center", "text": "DOMINATION   {{scoreA}} : {{scoreB}}", "color": "#eaf6ff", "background": "transparent", "fontSize": 24, "opacity": 1, "borderRadius": 0, "className": "score" },
        { "id": "objective", "type": "text", "name": "Capture status", "x": 0, "y": 104, "width": 600, "height": 32, "anchor": "top-center", "text": "{{objective}}", "color": "#a9bcc9", "background": "transparent", "fontSize": 18, "opacity": 1, "borderRadius": 0 }
      ]
    },
    {
      "id": "main", "name": "Main menu", "kind": "menu", "mode": "all",
      "elements": [
        { "id": "backdrop", "type": "panel", "name": "Backdrop", "x": 0, "y": 0, "width": 1920, "height": 1080, "anchor": "top-left", "text": "", "color": "#eaf6ff", "background": "#0b101be8", "fontSize": 24, "opacity": 1, "borderRadius": 0 },
        { "id": "title", "type": "text", "name": "Title", "x": 0, "y": -150, "width": 700, "height": 80, "anchor": "center", "text": "FPS Game", "color": "#eaf6ff", "background": "transparent", "fontSize": 54, "opacity": 1, "borderRadius": 0, "className": "title" },
        { "id": "play", "type": "button", "name": "Play", "x": 0, "y": 0, "width": 300, "height": 56, "anchor": "center", "text": "Play", "color": "#eafff7", "background": "#326b64", "fontSize": 24, "opacity": 1, "borderRadius": 6, "action": "resume" },
        { "id": "settings", "type": "button", "name": "Settings", "x": 0, "y": 80, "width": 300, "height": 56, "anchor": "center", "text": "SETTINGS", "color": "#eaf6ff", "background": "#263244", "fontSize": 24, "opacity": 1, "borderRadius": 6, "action": "settings" }
      ]
    },
    {
      "id": "pause", "name": "Pause menu", "kind": "menu", "mode": "all",
      "elements": [
        { "id": "backdrop", "type": "panel", "name": "Backdrop", "x": 0, "y": 0, "width": 1920, "height": 1080, "anchor": "top-left", "text": "", "color": "#eaf6ff", "background": "#0b101bdd", "fontSize": 24, "opacity": 1, "borderRadius": 0 },
        { "id": "title", "type": "text", "name": "Title", "x": 0, "y": -100, "width": 500, "height": 64, "anchor": "center", "text": "PAUSED", "color": "#eaf6ff", "background": "transparent", "fontSize": 48, "opacity": 1, "borderRadius": 0 },
        { "id": "resume", "type": "button", "name": "Resume", "x": 0, "y": 0, "width": 300, "height": 56, "anchor": "center", "text": "RESUME", "color": "#eafff7", "background": "#326b64", "fontSize": 24, "opacity": 1, "borderRadius": 6, "action": "resume" },
        { "id": "settings", "type": "button", "name": "Settings", "x": 0, "y": 80, "width": 300, "height": 56, "anchor": "center", "text": "SETTINGS", "color": "#eaf6ff", "background": "#263244", "fontSize": 24, "opacity": 1, "borderRadius": 6, "action": "settings" },
        { "id": "main", "type": "button", "name": "Main menu", "x": 0, "y": 160, "width": 300, "height": 56, "anchor": "center", "text": "MAIN MENU", "color": "#eaf6ff", "background": "transparent", "fontSize": 24, "opacity": 1, "borderRadius": 6, "action": "main" }
      ]
    },
    {
      "id": "settings", "name": "Settings menu", "kind": "menu", "mode": "all",
      "elements": [
        { "id": "backdrop", "type": "panel", "name": "Backdrop", "x": 0, "y": 0, "width": 1920, "height": 1080, "anchor": "top-left", "text": "", "color": "#eaf6ff", "background": "#0b101bf0", "fontSize": 24, "opacity": 1, "borderRadius": 0 },
        { "id": "title", "type": "text", "name": "Title", "x": 0, "y": -160, "width": 600, "height": 64, "anchor": "center", "text": "SETTINGS", "color": "#eaf6ff", "background": "transparent", "fontSize": 48, "opacity": 1, "borderRadius": 0 },
        { "id": "volume", "type": "slider", "name": "Master volume", "x": 0, "y": -40, "width": 400, "height": 60, "anchor": "center", "text": "Master volume", "color": "#eaf6ff", "background": "transparent", "fontSize": 24, "opacity": 1, "borderRadius": 0, "binding": "volume" },
        { "id": "sensitivity", "type": "slider", "name": "Mouse sensitivity", "x": 0, "y": 40, "width": 400, "height": 60, "anchor": "center", "text": "Mouse sensitivity", "color": "#eaf6ff", "background": "transparent", "fontSize": 24, "opacity": 1, "borderRadius": 0, "binding": "sensitivity" },
        { "id": "back", "type": "button", "name": "Back", "x": 0, "y": 160, "width": 300, "height": 56, "anchor": "center", "text": "BACK", "color": "#eaf6ff", "background": "#263244", "fontSize": 24, "opacity": 1, "borderRadius": 6, "action": "back" }
      ]
    }
  ]
}
```

Pair it with this `ui.css` (paste into **Scoped UI CSS**):

```css
:host { --accent: #77e4c1; --ink: #eaf6ff; --muted: #a9bcc9; }
[data-screen="hud"] .ui-text { text-shadow: 0 2px 12px #000; }
[data-screen="hud"] .ammo-readout { font-variant-numeric: tabular-nums; font-weight: 700; justify-content: flex-end; text-align: right; }
[data-screen="hud"] .weapon-name { letter-spacing: .18em; text-transform: uppercase; justify-content: flex-end; color: var(--muted); }
[data-screen="hud"] .ui-bar { border: 1px solid #ffffff2e; box-shadow: 0 3px 16px #0008; }
[data-screen="hud"] .ui-bar .fill { transition: width 140ms ease-out; }
[data-screen="hud"] .ui-crosshair { color: var(--accent); }
[data-screen="domination"] .score { font-variant-numeric: tabular-nums; letter-spacing: .16em; }
[data-screen="main"] .title, [data-screen="pause"] .title, [data-screen="settings"] .title { letter-spacing: .18em; text-transform: uppercase; }
.ui-button { border: 1px solid #ffffff30; letter-spacing: .14em; font-weight: 650; }
.ui-button:hover { box-shadow: 0 0 28px #77e4c12b; }
.ui-button:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
.ui-slider span { color: var(--muted); font-size: 18px; letter-spacing: .08em; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
```

What this produces: a centred crosshair with a `hitmarker` flash; bottom-left health bar that reflects `health`; bottom-right tabular ammo and a spaced-out weapon name; centred trigger `message` and `RELOADING` prompts that appear only while their bindings are true; a domination-only score/capture strip; and three navigable menus whose buttons cover navigation/settings actions. Add `restart` or `quit` buttons if needed; new projects already include Quit on the main menu.

## 13. Handoff template

When you hand UI work to an agent, give it this request shape and expect the matching response:

> Read `UI_GUIDE.md` first. Make this change: <one goal>. Allowed files: `public/authoring/project.json` (`ui` only) plus assets under `src/assets/`. Do not touch weapons, clips, scenes, or engine code unless §7 explicitly requires it. Return the exact JSON or CSS to paste, the JSON path it goes in, whether a rebuild is required, and the verification steps you ran. Do not invent bindings, actions, or element types.

A good answer contains: the file and JSON path, a complete validated block, the editor equivalent, the rebuild requirement, the verification output, and an explicit list of anything it deliberately did not do.
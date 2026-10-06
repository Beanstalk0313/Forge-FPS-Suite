/**
 * Data-driven UI in a Shadow DOM: authored CSS cannot restyle the editor or
 * game page. Text templates are substitutions, NOT JavaScript/HTML. Buttons
 * emit allowlisted action names to the host; sliders emit setting changes.
 * Both authoring preview and runtime use this renderer at design resolution.
 */
export const ANCHORS = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const ACTIONS = ['resume', 'main', 'pause', 'settings', 'back', 'restart', 'quit'];
export const BINDINGS = [
  // Player state
  'health', 'ammo', 'reserve', 'weapon', 'reloading', 'ads', 'hitmarker', 'message',
  // Scores and objectives
  'scoreA', 'scoreB', 'objective', 'mode', 'timeLeft', 'matchStatus',
  // Match and player identity
  'team', 'teamA', 'teamB', 'kills', 'deaths', 'killfeed', 'enemiesAlive', 'downed',
  // Settings
  'volume', 'sensitivity'
];
export function interpolate(text = '', state = {}) { return String(text).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => String(state[key] ?? '')); }
export function elementPosition(el) {
  const anchor = el.anchor || 'top-left';
  const right = anchor.endsWith('right'), bottom = anchor.startsWith('bottom');
  const centerX = anchor.endsWith('center') || anchor === 'center';
  const centerY = anchor.startsWith('center');
  return {
    left: right ? 'auto' : centerX ? `calc(50% + ${el.x}px)` : `${el.x}px`,
    right: right ? `${el.x}px` : 'auto',
    top: bottom ? 'auto' : centerY ? `calc(50% + ${el.y}px)` : `${el.y}px`,
    bottom: bottom ? `${el.y}px` : 'auto',
    transform: `translate(${centerX ? '-50%' : '0'}, ${centerY ? '-50%' : '0'})`
  };
}
/** Bounding box of an element in design pixels; anchor-aware. */
export function elementRect(spec, ui) {
  const anchor = spec.anchor || 'top-left';
  const right = anchor.endsWith('right'), bottom = anchor.startsWith('bottom');
  const centerX = anchor.endsWith('center') || anchor === 'center';
  const centerY = anchor.startsWith('center');
  const width = Math.max(0, spec.width || 0), height = Math.max(0, spec.height || 0);
  return {
    left: right ? ui.width - spec.x - width : centerX ? ui.width / 2 + spec.x - width / 2 : spec.x,
    top: bottom ? ui.height - spec.y - height : centerY ? ui.height / 2 + spec.y - height / 2 : spec.y,
    width, height
  };
}
export class UIRenderer {
  constructor(host, { resolve = path => path, action = () => {}, setting = () => {}, select = null, drag = null, resize = null, fontsLoaded = false } = {}) {
    this.fontsLoaded = fontsLoaded;
    this.host = host; this.resolve = resolve; this.action = action; this.setting = setting; this.select = select; this.drag = drag; this.resizeCallback = resize; this.selectedId = null;
    this.shadow = host.attachShadow({ mode: 'open' });
    this.baseStyle = document.createElement('style');
    this.baseStyle.textContent = `
      :host {display:block; position:relative; width:100%; height:100%; overflow:hidden; font-family:Segoe UI,Arial,sans-serif;}
      * {box-sizing:border-box} .design {position:absolute; transform-origin:top left;}
      .screen {position:absolute; inset:0; pointer-events:none;}
      .ui-element {position:absolute; display:flex; align-items:center; justify-content:center; overflow:hidden; white-space:pre-wrap; margin:0; padding:0; border:0; font-family:inherit; text-align:center;}
      .ui-text {justify-content:flex-start; text-align:left;}
      .ui-image {object-fit:contain;} .ui-button,.ui-slider {pointer-events:auto; cursor:pointer;}
      .ui-button:hover {filter:brightness(1.2)} .ui-button:focus-visible {outline:3px solid #79e8d0; outline-offset:3px}
      .ui-bar .fill {position:absolute;inset:0 auto 0 0;background:currentColor;}
      .ui-slider {flex-direction:column;gap:6px;} .ui-slider input {width:90%;}
      .ui-crosshair {font-size:30px;line-height:1;}
      .selected {outline:2px solid #6ce2c0; outline-offset:2px;} .editing .ui-element {pointer-events:auto;cursor:move;}
      .design.clipped {overflow:hidden;}
      .design.framed {outline:1px solid rgba(108,226,192,.85); box-shadow:0 0 0 2000px rgba(4,8,13,.52);}
      .design-label {display:none;position:absolute;top:calc(4px*var(--inv,1));left:calc(4px*var(--inv,1));font:600 calc(10px*var(--inv,1))/1.4 'Segoe UI',sans-serif;letter-spacing:.06em;color:#9af2d8;background:rgba(8,20,26,.82);padding:calc(2px*var(--inv,1)) calc(7px*var(--inv,1));border-radius:calc(3px*var(--inv,1));pointer-events:none;}
      .design.framed .design-label {display:block;}
      .ui-element.offscreen {opacity:.35;}
      .ui-handles {position:absolute;inset:0;pointer-events:none;}
      .ui-handle {position:absolute;width:calc(10px*var(--inv,1));height:calc(10px*var(--inv,1));background:#6ce2c0;border:1px solid #06231c;border-radius:calc(1px*var(--inv,1));pointer-events:auto;}
      .ui-handle[data-dir=n],.ui-handle[data-dir=s] {cursor:ns-resize;} .ui-handle[data-dir=e],.ui-handle[data-dir=w] {cursor:ew-resize;}
      .ui-handle[data-dir=nw],.ui-handle[data-dir=se] {cursor:nwse-resize;} .ui-handle[data-dir=ne],.ui-handle[data-dir=sw] {cursor:nesw-resize;}
    `;
    this.customStyle = document.createElement('style'); this.design = document.createElement('div'); this.design.className = 'design';
    this.shadow.append(this.baseStyle, this.customStyle, this.design); this.items = [];
    // Clicking the design background (not an element) clears designer selection.
    // Element handlers stop propagation, so this only ever sees empty canvas.
    // Mouse resize: eight anchor-aware handles around the selected element.
    this.label = document.createElement('div'); this.label.className = 'design-label';
    this.handles = document.createElement('div'); this.handles.className = 'ui-handles';
    for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const handle = document.createElement('div'); handle.className = 'ui-handle'; handle.dataset.dir = dir;
      this.wireHandle(handle); this.handles.append(handle);
    }
    this.design.addEventListener('pointerdown', event => { if (this.select && !event.target.closest?.('.ui-element') && !event.target.closest?.('.ui-handle')) this.select(null); });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
  }
  /** Dragging a handle resizes around the opposite edge; anchors decide which
   *  stored offsets move. Live preview mutates inline styles, and the edit is
   *  committed once through the resize callback (the designer owns undo). */
  wireHandle(handle) {
    handle.addEventListener('pointerdown', event => {
      if (!this.select || !this.resizeCallback) return;
      event.preventDefault(); event.stopPropagation();
      const item = this.items.find(candidate => candidate.spec.id === this.selectedId);
      if (!item) return;
      const spec = item.spec, dir = handle.dataset.dir;
      const right = spec.anchor?.endsWith('right'), bottom = spec.anchor?.startsWith('bottom');
      const centerX = spec.anchor?.endsWith('center') || spec.anchor === 'center', centerY = spec.anchor?.startsWith('center');
      const start = { x: event.clientX, y: event.clientY };
      const work = { x: spec.x, y: spec.y, width: Math.max(8, spec.width), height: Math.max(8, spec.height) };
      const move = e => {
        const dx = (e.clientX - start.x) / (this.scale || 1), dy = (e.clientY - start.y) / (this.scale || 1);
        if (dir.includes('e')) { work.width = Math.max(8, spec.width + dx); if (right) work.x = spec.x - (work.width - spec.width); }
        if (dir.includes('w')) { work.width = Math.max(8, spec.width - dx); if (!right && !centerX) work.x = spec.x + (spec.width - work.width); }
        if (dir.includes('s')) { work.height = Math.max(8, spec.height + dy); if (bottom) work.y = spec.y - (work.height - spec.height); }
        if (dir.includes('n')) { work.height = Math.max(8, spec.height - dy); if (!bottom && !centerY) work.y = spec.y + (spec.height - work.height); }
        Object.assign(item.el.style, elementPosition({ ...spec, x: work.x, y: work.y }), { width: `${work.width}px`, height: `${work.height}px` });
      };
      const finish = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish);
        if (work.width !== spec.width || work.height !== spec.height || work.x !== spec.x || work.y !== spec.y) this.resizeCallback(spec.id, work.x, work.y, work.width, work.height);
      };
      try { handle.setPointerCapture(event.pointerId); } catch { /* synthetic events carry no live pointer id */ }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
    });
  }
  syncHandles() {
    if (!this.handles || !this.ui) return;
    const item = this.select && this.items.find(candidate => candidate.spec.id === this.selectedId);
    this.handles.style.display = item ? '' : 'none';
    if (!item) return;
    const rect = elementRect(item.spec, this.ui), half = 5 / (this.scale || 1);
    for (const handle of this.handles.children) {
      const dir = handle.dataset.dir;
      const px = dir === 'n' || dir === 's' ? rect.left + rect.width / 2 : dir.includes('e') ? rect.left + rect.width : rect.left;
      const py = dir === 'e' || dir === 'w' ? rect.top + rect.height / 2 : dir.includes('s') ? rect.top + rect.height : rect.top;
      handle.style.left = `${px - half}px`; handle.style.top = `${py - half}px`;
    }
  }
  /** Elements fully outside the design canvas never render in the game; the
   *  editor dims them instead of clipping so they can be dragged back. */
  syncOffscreen() {
    for (const { el, spec } of this.items) {
      const rect = elementRect(spec, this.ui);
      const outside = rect.left >= this.ui.width || rect.top >= this.ui.height || rect.left + rect.width <= 0 || rect.top + rect.height <= 0;
      el.classList.toggle('offscreen', outside);
    }
  }
  render(ui, screens, state = {}) {
    this.ui = ui; this.state = state; this.design.replaceChildren(); this.items = [];
    // Uploaded fonts are injected as @font-face in the isolated shadow root;
    // they are project assets or inline data, never remote URLs.
    const faces = (this.fontsLoaded ? [] : ui.fonts ?? []).map(font => `@font-face{font-family:"${font.name.replace(/"/g, '')}";src:url("${this.resolve(font.source)}");font-display:swap;}`).join('\n');
    // Resolve authored CSS URLs too; raw src/assets paths break after Vite hashes.
    const resolveCSS = text => text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi, (match, double, single, bare) => {
      const source = double ?? single ?? bare;
      return source.startsWith('#') ? match : `url(${JSON.stringify(this.resolve(source))})`;
    });
    this.customStyle.textContent = `${faces}\n${resolveCSS(ui.css || '')}`;
    this.design.style.width = `${ui.width}px`; this.design.style.height = `${ui.height}px`; this.design.classList.toggle('editing', !!this.select);
    for (const screen of screens) {
      const layer = document.createElement('div'); layer.className = 'screen'; layer.dataset.screen = screen.id;
      for (const spec of screen.elements) {
        const el = document.createElement(spec.type === 'image' && !spec.src ? 'div' : spec.type === 'image' ? 'img' : spec.type === 'button' ? 'button' : 'div');
        el.className = `ui-element ui-${spec.type}${spec.className ? ' ' + spec.className : ''}`; el.dataset.element = spec.id;
        Object.assign(el.style, elementPosition(spec), { width: `${spec.width}px`, height: `${spec.height}px`, color: spec.color, background: resolveCSS(spec.background), fontSize: `${spec.fontSize}px`, fontFamily: spec.font || '', opacity: spec.opacity, borderRadius: `${spec.borderRadius}px` });
        if (spec.type === 'image') {
          if (spec.src) { el.src = this.resolve(spec.src); el.alt = spec.text || spec.name || spec.id; }
          else { el.textContent = 'No image set'; el.style.outline = '2px dashed #4a5b6b'; el.style.color = '#6d8090'; }
        }
        else if (spec.type === 'bar') { const fill = document.createElement('div'); fill.className = 'fill'; el.append(fill); }
        else if (spec.type === 'slider') {
          const label = document.createElement('span'); label.textContent = spec.text; const input = document.createElement('input');
          input.type = 'range'; input.min = 0; input.max = 1; input.step = 0.01; input.value = state[spec.binding] ?? 0.5; input.setAttribute('aria-label', spec.text || spec.binding);
          input.oninput = () => { if (!this.select && ['volume', 'sensitivity'].includes(spec.binding)) this.setting(spec.binding, Number(input.value)); }; el.append(label, input);
        } else if (spec.type === 'crosshair') el.textContent = '+';
        else el.textContent = interpolate(spec.text, state);
        if (spec.type === 'button') { el.type = 'button'; el.onclick = () => { if (!this.select && ACTIONS.includes(spec.action)) this.action(spec.action); }; }
        if (this.select) {
          el.addEventListener('pointerdown', event => {
            event.preventDefault(); event.stopPropagation(); this.select(spec.id);
            if (!this.drag) return;
            const start = { x: event.clientX, y: event.clientY }, scale = this.scale, original = { x: spec.x, y: spec.y }; let delta = { x: 0, y: 0 };
            const move = e => {
              delta = { x: (e.clientX - start.x) / scale, y: (e.clientY - start.y) / scale };
              const right = spec.anchor?.endsWith('right'), bottom = spec.anchor?.startsWith('bottom');
              Object.assign(el.style, elementPosition({ ...spec, x: original.x + (right ? -delta.x : delta.x), y: original.y + (bottom ? -delta.y : delta.y) }));
            };
            const finish = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', finish); el.removeEventListener('pointercancel', finish); if (Math.hypot(delta.x, delta.y) > 0.5) this.drag(spec.id, original.x + (spec.anchor?.endsWith('right') ? -delta.x : delta.x), original.y + (spec.anchor?.startsWith('bottom') ? -delta.y : delta.y)); };
            el.setPointerCapture(event.pointerId); el.addEventListener('pointermove', move); el.addEventListener('pointerup', finish); el.addEventListener('pointercancel', finish);
          });
        }
        layer.append(el); this.items.push({ el, spec });
      }
      this.design.append(layer);
    }
    this.design.append(this.label, this.handles);
    // Editor shows the design boundary and dims the outside; the game clips to
    // the design canvas, so what the editor frames is exactly what renders.
    this.design.classList.toggle('framed', !!this.select);
    this.design.classList.toggle('clipped', !this.select);
    this.label.textContent = `${this.ui.width} × ${this.ui.height}`;
    this.syncOffscreen();
    this.resize(); this.update(state);
  }
  resize() {
    if (!this.ui) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.scale = Math.min(width / this.ui.width, height / this.ui.height) || 1;
    this.design.style.transform = `scale(${this.scale})`;
    this.design.style.left = `${(width - this.ui.width * this.scale) / 2}px`; this.design.style.top = `${(height - this.ui.height * this.scale) / 2}px`;
    // Handles, boundary and label keep a constant on-screen size: --inv cancels
    // the design scale for everything drawn in editor pixels.
    this.design.style.setProperty('--inv', String(1 / (this.scale || 1)));
    this.syncHandles();
  }
  update(state) {
    this.state = state;
    for (const { el, spec } of this.items) {
      el.hidden = !!spec.visibleWhen && !state[spec.visibleWhen]; el.style.display = el.hidden ? 'none' : '';
      if (spec.type === 'text' || spec.type === 'button') el.textContent = interpolate(spec.text, state);
      if (spec.type === 'bar') el.firstChild.style.width = `${Math.max(0, Math.min(1, Number(state[spec.binding] ?? 0) / (spec.maxValue || 100))) * 100}%`;
      if (spec.type === 'crosshair') el.style.opacity = state.ads ? '0' : String(spec.opacity);
    }
  }
  highlight(id) { this.selectedId = id; for (const { el, spec } of this.items) el.classList.toggle('selected', spec.id === id); this.syncHandles(); }
  dispose() { this.observer.disconnect(); this.shadow.replaceChildren(); }
}

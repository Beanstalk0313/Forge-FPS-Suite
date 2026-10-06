/**
 * Visual designer and CSS source editor share the runtime Shadow DOM renderer.
 * Array order is stacking order; drag changes design pixels, independent of
 * preview size. Editing never runs authored scripts or template expressions.
 */
import { UIRenderer, ANCHORS, ACTIONS, BINDINGS } from '../../src/ui/UIRenderer.js';
import { validateUICSS } from './uiCode.js';
import { upsertRule } from '../../src/authoring/UICSS.js';
import { uid, clone } from '../../src/authoring/Project.js';
import { node, button, field, heading, jsonPanel, guard, toast, onContextMenu, closeContextMenu } from './dom.js';

const BASE_FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'monospace', 'sans-serif'];
/** Built-in style snippets; applying one writes a scoped rule into ui.css. */
const STYLE_TEMPLATES = [
  { id: 'tpl-neon', name: 'Neon glow', css: 'text-shadow:0 0 8px currentColor,0 0 22px currentColor;' },
  { id: 'tpl-stencil', name: 'Spaced uppercase', css: 'letter-spacing:.18em;text-transform:uppercase;' },
  { id: 'tpl-glass', name: 'Dark glass panel', css: 'background:rgba(10,16,24,.72)!important;backdrop-filter:blur(6px);border:1px solid rgba(120,200,180,.35)!important;border-radius:8px!important;padding:10px 14px!important;' },
  { id: 'tpl-tactical', name: 'Mint button', css: 'background:#1d5c4f!important;color:#eafff7!important;border:1px solid #2f8f77!important;border-radius:6px!important;letter-spacing:.08em;text-transform:uppercase;padding:8px 18px!important;' },
  { id: 'tpl-outline', name: 'Outline text', css: '-webkit-text-stroke:1px currentColor;color:transparent!important;' },
  { id: 'tpl-crt', name: 'CRT scanlines', css: 'background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 1px,transparent 1px 3px)!important;' },
  { id: 'tpl-hudbar', name: 'HUD bar', css: 'border:1px solid rgba(140,220,190,.5)!important;border-radius:3px!important;box-shadow:inset 0 0 12px rgba(0,0,0,.6);' }
];
const IMAGE_RE = /\.(png|jpg|jpeg|webp)$/i;
const FONT_RE = /\.(woff2?|ttf|otf)$/i;

export class UITool {
  constructor(host, store) {
    this.store = store; this.screenId = 'hud'; this.elementId = null; this.editing = true;
    this.elementClipboard = null; this.shiftGrid = false; this.mode = 'layout';
    this.state = { health: 78, ammo: 24, reserve: 180, weapon: 'M4', mode: 'domination', scoreA: 42, scoreB: 37, objective: 'A — capturing 65%', hitmarker: true, ads: false, reloading: false, volume: 0.7, sensitivity: 0.5, message: 'Objective secured' };
    host.innerHTML = ''; host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'stage'); this.right = node('aside', 'panel inspector');
    host.append(this.left, this.center, this.right);
    this.toolbar = node('div', 'viewport-toolbar'); this.preview = node('div', 'ui-preview'); this.codePanel = node('div', 'ui-code-panel'); this.codePanel.hidden = true;
    this.center.append(this.toolbar, this.preview, this.codePanel, node('div', 'stage-hint', 'Right-click a screen or layer for actions · Drag to position, drag a handle to resize · Arrow keys nudge · Shift snaps · The CSS code tab validates styles safely · See UI_GUIDE.md'));
    this.createRenderer();
    this.changed = () => this.render(); store.addEventListener('change', this.changed);
    this.snapKeys = event => { if (event.key === 'Shift') this.shiftGrid = event.type === 'keydown'; };
    this.keys = event => {
      if (store.busy || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('.project-scrim:not([hidden])')) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'c') { event.preventDefault(); guard(() => this.copyElement()); }
      else if (key === 'v') { event.preventDefault(); guard(() => this.pasteElement()); }
    };
    // Arrow keys nudge the selected element 1 px (Shift = 10 px), honouring
    // the anchor: moving "left" on a right-anchored element grows the offset.
    this.nudgeKeys = event => {
      if (store.busy || this.mode !== 'layout' || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || document.querySelector('.project-scrim:not([hidden])')) return;
      if (!this.elementId || !event.key.startsWith('Arrow')) return;
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (!dx && !dy) return;
      event.preventDefault(); guard(() => this.nudgeElement(dx, dy));
    };
    document.addEventListener('keydown', this.snapKeys); document.addEventListener('keyup', this.snapKeys);
    document.addEventListener('keydown', this.keys); document.addEventListener('keydown', this.nudgeKeys);
    this.render();
  }
  createRenderer() {
    this.renderer?.dispose();
    if (this.preview.shadowRoot) { const replacement = node('div', 'ui-preview'); this.preview.replaceWith(replacement); this.preview = replacement; }
    this.renderer = new UIRenderer(this.preview, { resolve: p => this.store.resolve(p),
      select: this.editing ? id => { this.elementId = id || null; this.renderer.highlight(this.elementId); this.renderInspector(); this.renderLayers(); } : null,
      drag: (id, x, y) => guard(() => this.edit(s => {
        const snap = value => this.shiftGrid ? Math.round(value / 10) * 10 : Math.round(value); // Shift = 10px grid
        const el = s.elements.find(e => e.id === id); el.x = snap(x); el.y = snap(y);
      })),
      resize: (id, x, y, width, height) => guard(() => this.edit(s => {
        // Handles resize live in the renderer; this commit snaps like drags.
        const snap = value => this.shiftGrid ? Math.round(value / 10) * 10 : Math.round(value);
        const el = s.elements.find(e => e.id === id); el.x = snap(x); el.y = snap(y); el.width = snap(width); el.height = snap(height);
      })),
      action: action => { if (action === 'settings') this.screenId = 'settings'; else if (action === 'main') this.screenId = 'main'; else if (action === 'back') this.screenId = 'pause'; else this.screenId = 'hud'; this.render(); },
      setting: (key, val) => { this.state[key] = val; }
    });
  }
  screen() { return this.store.project.ui.screens.find(s => s.id === this.screenId); }
  element() { return this.screen()?.elements.find(e => e.id === this.elementId) || null; }
  edit(fn) { this.store.change('project', p => fn(p.ui.screens.find(s => s.id === this.screenId))); }
  label(el) { return el.name?.trim() || el.id; }
  images() { return this.store.assets.filter(a => IMAGE_RE.test(a.path)); }
  fonts() { return this.store.project.ui.fonts ?? []; }

  addElement(type, extra = {}) {
    const id = uid(type);
    const count = (this.screen()?.elements || []).filter(e => e.type === type).length + 1;
    const names = { text: 'Label', panel: 'Panel', image: 'Image', bar: 'Bar', button: 'Button', slider: 'Slider', crosshair: 'Crosshair' };
    this.elementId = id;
    this.edit(s => s.elements.push({ id, type, name: `${names[type] || type} ${count}`, x: 60, y: 60,
      width: type === 'panel' ? 400 : 240, height: type === 'panel' ? 220 : 60,
      text: type === 'text' ? 'New label {{ammo}}' : type === 'button' ? 'BUTTON' : '',
      color: '#edf4ff', background: ['panel', 'button'].includes(type) ? '#24354a' : 'transparent',
      fontSize: 24, opacity: 1, borderRadius: 8, anchor: 'top-left',
      ...(type === 'bar' ? { binding: 'health', maxValue: 100 } : {}),
      ...(type === 'button' ? { action: 'resume' } : {}),
      ...(type === 'slider' ? { binding: 'volume' } : {}),
      ...extra }));
  }
  addAsset(asset) {
    if (IMAGE_RE.test(asset.path)) this.addElement('image', { src: asset.path, name: asset.name.replace(IMAGE_RE, '') });
    else if (FONT_RE.test(asset.path)) this.addFont(asset.name.replace(FONT_RE, ''), asset.path);
    else toast('Use images in elements and fonts in the Fonts panel.', true);
  }

  /* ---------- images ---------- */
  async uploadImage() {
    const el = this.element(); if (!el || el.type !== 'image') return;
    if (window.forgeDesktop) {
      const imported = await window.forgeDesktop.importAssets();
      const image = imported.find(p => IMAGE_RE.test(p));
      if (!image) { if (imported.length) toast('No image in the selected files.', true); return; }
      await this.store.refreshAssets();
      this.edit(s => { s.elements.find(e => e.id === el.id).src = image; });
      toast(`Image copied into the project and applied.`);
      return;
    }
    // Browser mode has no project folder: inline the file as a data URL.
    const file = await this.pickFile('image/png,image/jpeg,image/webp');
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) throw new Error('Keep inline images under 1.5 MB, or use the desktop app to copy them into the project.');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    this.edit(s => { s.elements.find(e => e.id === el.id).src = data; });
    toast('Image inlined as a data URL. Save the project to keep it.');
  }
  async addFont(name, source) {
    if (this.fonts().some(f => f.source === source)) { toast('Font already added.'); return; }
    if (this.fonts().length >= 64) throw new Error('Font limit reached (64).');
    const font = { id: uid('font'), name: (name || 'Font').slice(0, 64), source };
    this.store.change('project', p => { (p.ui.fonts ??= []).push(font); });
    toast(`Font "${font.name}" ready.`);
  }
  async uploadFont() {
    if (window.forgeDesktop) {
      const imported = await window.forgeDesktop.importAssets();
      const font = imported.find(p => FONT_RE.test(p));
      if (!font) { if (imported.length) toast('No font file in the selection.', true); return; }
      await this.store.refreshAssets();
      await this.addFont(font.split('/').pop().replace(FONT_RE, ''), font);
      return;
    }
    const file = await this.pickFile('font/woff2,font/woff,font/ttf,font/otf');
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) throw new Error('Keep inline fonts under 1.5 MB, or use the desktop app to copy them into the project.');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    await this.addFont(file.name.replace(FONT_RE, ''), data);
  }
  pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
      input.oncancel = () => resolve(null);
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  }

  /* ---------- style templates ---------- */
  templates() { return [...STYLE_TEMPLATES, ...(this.store.project.ui.templates ?? [])]; }
  applyTemplate(template, scope = 'element') {
    const target = scope === 'screen' ? this.screen()?.id : this.element()?.id;
    if (!target) throw new Error(scope === 'screen' ? 'Select a screen first.' : 'Select an element first.');
    const selector = scope === 'screen' ? `[data-screen="${target}"]` : `[data-element="${target}"]`;
    const marker = `/*forge:${template.id}:${scope}:${target}*/`;
    this.store.change('project', p => { p.ui.css = upsertRule(p.ui.css, marker, selector, template.css); });
    toast(`Applied "${template.name}" to ${scope === 'screen' ? 'screen' : this.label(this.element())}.`);
  }
  saveTemplate(name, css) {
    if (!css?.trim()) throw new Error('Enter CSS for the template first.');
    const template = { id: uid('tpl'), name: name.trim().slice(0, 64) || 'Custom', css: css.trim().slice(0, 65536) };
    this.store.change('project', p => { (p.ui.templates ??= []).push(template); });
    return template;
  }
  deleteTemplate(id) { this.store.change('project', p => { p.ui.templates = (p.ui.templates ?? []).filter(t => t.id !== id); }); }
  copyElement() {
    const el = this.element(); if (!el) throw new Error('Select an element to copy first.');
    this.elementClipboard = clone(el); toast(`Copied ${this.label(el)}. Ctrl+V pastes it into any screen.`);
  }
  pasteElement() {
    if (!this.elementClipboard) throw new Error('The element clipboard is empty. Copy an element first.');
    const copy = clone(this.elementClipboard); copy.id = uid(copy.type); copy.name = `${this.elementClipboard.name || copy.type} copy`; copy.x += 16; copy.y += 16;
    this.elementId = copy.id;
    this.edit(s => s.elements.push(copy));
    toast(`Pasted ${copy.name}.`);
  }
  nudgeElement(dx, dy) {
    this.edit(s => {
      const el = s.elements.find(e => e.id === this.elementId); if (!el) return;
      if (dx) el.x = Math.round(el.x + (el.anchor?.endsWith('right') ? -dx : dx));
      if (dy) el.y = Math.round(el.y + (el.anchor?.startsWith('bottom') ? -dy : dy));
    });
  }
  /* ---------- CSS code editor ----------
     The safe source editor: every keystroke is validated with plain-language
     problems, font families are one click away, and the cheatsheet keeps the
     selectors contract visible. No script ever runs from this text. */
  ensureCodePanel() {
    // Built once; later renders only refresh the value (when not typing) and
    // the problem list, so the caret never jumps mid-word.
    if (this.codeTextarea) {
      if (document.activeElement !== this.codeTextarea) this.codeTextarea.value = this.store.project.ui.css || '';
      this.revalidateCode();
      return;
    }
    heading(this.codePanel, 'CSS CODE — SCOPED TO THE GAME UI');
    const problems = node('div', 'ui-code-problems');
    const textarea = node('textarea', 'code'); textarea.setAttribute('aria-label', 'UI CSS'); textarea.spellcheck = false;
    textarea.value = this.store.project.ui.css || '';
    const show = list => {
      problems.innerHTML = '';
      if (!list.length) { problems.append(node('p', 'muted ui-code-ok', 'No problems found. The game UI stays inside its shadow DOM: this CSS cannot touch the editor or your machine.')); return; }
      for (const problem of list) problems.append(node('p', problem.level === 'error' ? 'ui-problem error' : 'ui-problem warn', `${problem.level === 'error' ? 'Problem' : 'Heads-up'}: ${problem.message}`));
    };
    const revalidate = () => show(validateUICSS(textarea.value, { assets: this.store.assets.map(asset => asset.path) }));
    textarea.addEventListener('input', () => {
      this.store.change('project', p => { p.ui.css = textarea.value; });
      revalidate();
    });
    this.codeTextarea = textarea; this.codeProblems = problems; this.revalidateCode = revalidate;
    heading(this.codePanel, 'FONT FAMILIES — CLICK TO INSERT');
    const chips = node('div', 'font-chips');
    const insert = text => {
      const start = textarea.selectionStart ?? textarea.value.length, end = textarea.selectionEnd ?? start;
      textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
      textarea.focus(); textarea.selectionStart = textarea.selectionEnd = start + text.length;
      textarea.dispatchEvent(new Event('input'));
    };
    for (const family of [...new Set([...BASE_FONTS, ...this.fonts().map(font => font.name)])]) {
      const chip = button(family, () => insert(`font-family:"${family}";`)); chip.className = 'font-chip'; chip.title = `Insert font-family for ${family}`;
      chips.append(chip);
    }
    this.codePanel.append(problems, textarea, chips);
    const sheet = node('div', 'ui-cheatsheet');
    sheet.innerHTML = `<p><b>Selectors</b> [data-screen="hud"] [data-element="ammo"] · .ui-text · .ui-button · .ui-bar .fill · :hover works</p>
      <p><b>Data</b> {{health}} {{ammo}} {{weapon}} and the other bindings from the guide render inside templates</p>
      <p><b>Animation</b> @keyframes on color, opacity, filter or box-shadow are safe; the engine owns position and size</p>
      <p><b>Never</b> JavaScript, @import or remote URLs — the renderer drops them and this panel explains why</p>
      <p class="muted">Full contract in UI_GUIDE.md</p>`;
    this.codePanel.append(sheet);
    revalidate();
  }

  render() {
    if (!this.screen()) this.screenId = this.store.project.ui.screens[0]?.id;
    this.left.innerHTML = ''; this.toolbar.innerHTML = ''; this.right.innerHTML = '';
    this.renderScreens();
    // Stage tabs: the layout designer and the safe CSS code editor share one
    // stage; the code side validates every keystroke instead of trusting CSS.
    const tab = (label, target) => button(label, () => { if (this.mode !== target) { this.mode = target; this.render(); } }, this.mode === target ? 'active' : '');
    this.toolbar.append(tab('Layout', 'layout'), tab('CSS code', 'code'));
    if (this.mode === 'layout') this.toolbar.append(button(this.editing ? 'Switch to interactive preview' : 'Switch to layout editing', () => { this.editing = !this.editing; this.createRenderer(); this.render(); }));
    field(this.toolbar, 'Preview mode', this.state.mode, n => { this.state.mode = n; this.render(); }, { options: ['sandbox', 'domination', 'tdm'] });
    field(this.toolbar, 'Viewport', 'fit', n => { this.preview.style.maxWidth = n === 'fit' ? '' : `${n}px`; this.preview.style.margin = 'auto'; }, { options: [['fit', 'Fit workspace'], ['960', '960px wide'], ['640', '640px wide']] });
    const screen = this.screen(); if (!screen) return;
    this.layers = node('div'); this.left.append(this.layers);
    this.renderLayers(); this.renderInspector();
    this.preview.hidden = this.mode === 'code'; this.codePanel.hidden = this.mode !== 'code';
    if (this.mode === 'code') { this.ensureCodePanel(); return; }
    const screens = !this.editing && screen.kind === 'hud' ? this.store.project.ui.screens.filter(s => s.kind === 'hud' && (s.mode === 'all' || s.mode === this.state.mode)) : [screen];
    this.renderer.render(this.store.project.ui, screens, this.state);
    this.renderer.highlight(this.elementId);
  }
  renderScreens() {
    heading(this.left, 'SCREENS');
    for (const screen of this.store.project.ui.screens) {
      const row = button(`${screen.kind === 'hud' ? '◈' : '▣'} ${screen.name}`, () => { this.screenId = screen.id; this.elementId = null; this.render(); }, screen.id === this.screenId ? 'selected' : '');
      onContextMenu(row, () => this.screenMenu(screen));
      this.left.append(row);
    }
    this.left.append(button('+ Add screen', () => {
      const screen = { id: uid('screen'), name: 'New HUD', kind: 'hud', mode: 'all', elements: [] };
      this.screenId = screen.id; this.elementId = null; this.store.change('project', p => p.ui.screens.push(screen));
    }));
  }
  screenMenu(screen) {
    return [
      { label: 'Open screen', action: () => { this.screenId = screen.id; this.elementId = null; this.render(); } },
      { label: 'Rename…', action: () => { const name = prompt('Screen name', screen.name); if (name?.trim()) this.store.change('project', p => { p.ui.screens.find(s => s.id === screen.id).name = name.trim(); }); } },
      { label: 'Duplicate', action: () => {
        const copy = clone(screen); copy.id = uid('screen'); copy.name += ' copy';
        copy.elements = copy.elements.map(el => ({ ...el, id: uid(el.type) }));
        this.store.change('project', p => p.ui.screens.push(copy)); this.screenId = copy.id; this.render();
      } },
      { label: 'Delete', danger: true, action: () => {
        this.store.change('project', p => { p.ui.screens = p.ui.screens.filter(s => s.id !== screen.id); });
        this.screenId = this.store.project.ui.screens[0]?.id; this.elementId = null; this.render();
      } }
    ];
  }
  renderLayers() {
    if (!this.layers) return;
    this.layers.innerHTML = '';
    heading(this.layers, 'LAYERS');
    const add = node('div', 'add-grid');
    for (const type of ['text', 'panel', 'image', 'bar', 'button', 'slider', 'crosshair']) add.append(button(`+ ${type}`, () => this.addElement(type)));
    this.layers.append(add);
    for (const el of this.screen()?.elements || []) {
      const row = button(`${el.type} · ${this.label(el)}`, () => { this.elementId = el.id; this.renderer.highlight(el.id); this.renderInspector(); this.renderLayers(); }, this.elementId === el.id ? 'selected' : '');
      onContextMenu(row, () => this.layerMenu(el));
      this.layers.append(row);
    }
    this.layers.append(button('Screen settings / design system', () => { this.elementId = null; this.renderer.highlight(null); this.renderInspector(); this.renderLayers(); }));
  }
  layerMenu(el) {
    const move = delta => () => this.edit(s => {
      const i = s.elements.findIndex(e => e.id === el.id);
      const j = Math.max(0, Math.min(s.elements.length - 1, i + delta));
      [s.elements[i], s.elements[j]] = [s.elements[j], s.elements[i]];
    });
    return [
      { label: 'Select layer', action: () => { this.elementId = el.id; this.renderInspector(); this.renderLayers(); } },
      { label: 'Rename…', action: () => { const name = prompt('Element name', el.name || ''); if (name?.trim()) this.edit(s => { s.elements.find(e => e.id === el.id).name = name.trim().slice(0, 64); }); this.renderInspector(); this.renderLayers(); } },
      { label: 'Copy', action: () => { this.elementId = el.id; this.copyElement(); } },
      { label: 'Bring forward', action: move(1) },
      { label: 'Send backward', action: move(-1) },
      { label: 'Duplicate', action: () => { const copy = clone(el); copy.id = uid(el.type); copy.name = `${el.name || el.type} copy`; copy.x += 16; copy.y += 16; this.elementId = copy.id; this.edit(s => s.elements.push(copy)); } },
      { label: 'Delete', danger: true, action: () => { this.elementId = null; this.edit(s => { s.elements = s.elements.filter(e => e.id !== el.id); }); } }
    ];
  }
  renderInspector() {
    this.right.innerHTML = '';
    const screen = this.screen(); if (!screen) return;
    const el = this.element();
    if (el) this.renderElementInspector(el);
    else this.renderScreenInspector(screen);
  }
  renderElementInspector(el) {
    heading(this.right, 'ELEMENT / INSPECTOR');
    const edit = (key, val) => this.edit(s => { s.elements.find(e => e.id === el.id)[key] = val; });
    field(this.right, 'Element name', el.name || '', n => edit('name', n.slice(0, 64)));
    field(this.right, 'Element ID / CSS selector', el.id, value => { this.edit(s => { s.elements.find(e => e.id === el.id).id = value; }); this.elementId = value; this.render(); });
    field(this.right, 'Anchor', el.anchor, n => edit('anchor', n), { options: ANCHORS });
    for (const key of ['x', 'y', 'width', 'height', 'fontSize', 'opacity', 'borderRadius', 'color', 'background']) field(this.right, key, el[key], n => edit(key, n));
    field(this.right, 'Font family', el.font || 'Segoe UI', n => edit('font', n), { options: [...new Set([...BASE_FONTS, ...this.fonts().map(f => f.name)])] });
    // Font import lives in the element context too, not only in screen settings.
    this.right.append(button('Upload font and use it here…', () => guard(async () => {
      const known = new Set(this.fonts().map(font => font.id));
      await this.uploadFont();
      const added = this.fonts().find(font => !known.has(font.id));
      if (added) { edit('font', added.name); toast(`Font "${added.name}" assigned to ${this.label(el)}.`); }
      this.renderInspector();
    })));
    field(this.right, 'Text / {{binding}} template', el.text || '', n => edit('text', n), { multiline: true });
    field(this.right, 'CSS class(es)', el.className || '', n => edit('className', n));
    field(this.right, 'Visible when', el.visibleWhen || '', n => edit('visibleWhen', n), { options: [['', 'Always'], ...BINDINGS] });
    if (['bar', 'slider'].includes(el.type)) field(this.right, 'Data binding', el.binding || 'health', n => edit('binding', n), { options: el.type === 'slider' ? ['volume', 'sensitivity'] : BINDINGS });
    if (el.type === 'bar') field(this.right, 'Maximum value', el.maxValue || 100, n => edit('maxValue', n), { min: 1 });
    if (el.type === 'button') field(this.right, 'Button action', el.action || 'resume', n => edit('action', n), { options: ACTIONS });
    if (el.type === 'image') this.renderImageInspector(el);
    this.renderTemplatePanel('element');
    this.right.append(button('Duplicate element', () => { const copy = clone(el); copy.id = uid(el.type); copy.name = `${el.name || el.type} copy`; copy.x += 16; copy.y += 16; this.elementId = copy.id; this.edit(s => s.elements.push(copy)); }),
      button('Delete element', () => { this.elementId = null; this.edit(s => { s.elements = s.elements.filter(e => e.id !== el.id); }); }, 'danger'));
    jsonPanel(this.right, 'Element JSON', el, data => this.edit(s => { if (data.id !== el.id) throw new Error('Use ID field to rename.'); Object.assign(s.elements.find(e => e.id === el.id), data); }));
  }
  renderImageInspector(el) {
    field(this.right, 'Image asset', el.src || '', n => this.edit(s => { s.elements.find(e => e.id === el.id).src = n; }),
      { options: [['', 'Choose image'], ...this.images().map(a => [a.path, a.name])] });
    this.right.append(button('Upload image…', () => guard(() => this.uploadImage())),
      button('Clear image', () => this.edit(s => { s.elements.find(e => e.id === el.id).src = ''; })));
    this.right.append(node('p', 'muted', 'Uploaded images are copied into the project assets folder automatically. The name above is just a label; the asset path below is what the game loads.'));
  }
  renderTemplatePanel(scope) {
    const ui = this.store.project.ui;
    heading(this.right, 'STYLE TEMPLATES');
    for (const template of this.templates()) {
      const row = button(`✦ ${template.name}`, () => guard(() => this.applyTemplate(template, scope)));
      if (!STYLE_TEMPLATES.some(t => t.id === template.id)) onContextMenu(row, () => [
        { label: 'Apply here', action: () => guard(() => this.applyTemplate(template, scope)) },
        { label: 'Delete template', danger: true, action: () => this.deleteTemplate(template.id) }
      ]);
      this.right.append(row);
    }
    const name = node('input'); name.placeholder = 'New template name'; name.setAttribute('aria-label', 'New template name');
    const css = node('textarea'); css.placeholder = '.selector { color: #fff; }'; css.setAttribute('aria-label', 'Template CSS');
    this.right.append(name, css, button('Save as template', () => guard(() => { this.saveTemplate(name.value, css.value); this.renderInspector(); })));
  }
  renderScreenInspector(screen) {
    heading(this.right, 'SCREEN / DESIGN SYSTEM');
    field(this.right, 'Screen name', screen.name, n => this.store.change('project', p => { p.ui.screens.find(s => s.id === screen.id).name = n; }));
    field(this.right, 'Screen kind', screen.kind, n => this.store.change('project', p => { p.ui.screens.find(s => s.id === screen.id).kind = n; }), { options: ['hud', 'menu'] });
    field(this.right, 'Mode (all / domination / tdm)', screen.mode, n => this.store.change('project', p => { p.ui.screens.find(s => s.id === screen.id).mode = n; }));
    for (const key of ['width', 'height']) field(this.right, `Design ${key}`, this.store.project.ui[key], n => this.store.change('project', p => { p.ui[key] = n; }), { min: 1 });
    this.renderFontPanel();
    this.renderTemplatePanel('screen');
    // The stylesheet itself lives in the validated code tab; the inspector
    // keeps the entry point and the template workflow.
    this.right.append(button('Open the CSS code editor', () => { this.mode = 'code'; this.render(); }),
      node('p', 'muted', 'Styles are edited in the CSS code tab with live validation, clickable font families and the selectors contract. Templates still write scoped rules from here.'));
    heading(this.right, 'SCREEN ACTIONS');
    this.right.append(button('Duplicate screen', () => {
      const copy = clone(screen); copy.id = uid('screen'); copy.name += ' copy';
      copy.elements = copy.elements.map(el => ({ ...el, id: uid(el.type) }));
      this.screenId = copy.id; this.store.change('project', p => p.ui.screens.push(copy)); this.render();
    }), button('Delete screen', () => {
      this.store.change('project', p => { p.ui.screens = p.ui.screens.filter(s => s.id !== screen.id); });
      this.screenId = this.store.project.ui.screens[0]?.id; this.render();
    }, 'danger'));
    heading(this.right, 'LIVE PREVIEW DATA');
    for (const key of ['health', 'ammo', 'reserve', 'scoreA', 'scoreB', 'weapon', 'objective', 'message', 'ads', 'hitmarker', 'reloading']) field(this.right, key, this.state[key], n => { this.state[key] = n; this.renderer.update(this.state); });
    jsonPanel(this.right, 'Screen JSON', screen, data => this.edit(s => { if (data.id !== s.id) throw new Error('Keep screen ID unchanged here.'); Object.assign(s, data); }));
  }
  renderFontPanel() {
    heading(this.right, 'FONTS');
    if (!this.fonts().length) this.right.append(node('p', 'muted', 'No uploaded fonts. Use a system font or upload woff2/ttf/otf.'));
    for (const font of this.fonts()) {
      const row = button(`${font.name}`, () => toast(`Assigned from the element Font family list.`));
      onContextMenu(row, () => [
        { label: 'Rename…', action: () => { const name = prompt('Font name', font.name); if (name?.trim()) this.store.change('project', p => { p.ui.fonts.find(f => f.id === font.id).name = name.trim(); }); } },
        { label: 'Delete', danger: true, action: () => this.store.change('project', p => { p.ui.fonts = p.ui.fonts.filter(f => f.id !== font.id); }) }
      ]);
      this.right.append(row);
    }
    this.right.append(button('Upload font…', () => guard(() => this.uploadFont())));
  }
  dispose() {
    this.store.removeEventListener('change', this.changed);
    document.removeEventListener('keydown', this.snapKeys); document.removeEventListener('keyup', this.snapKeys);
    document.removeEventListener('keydown', this.keys); document.removeEventListener('keydown', this.nudgeKeys);
    closeContextMenu();
    this.renderer.dispose();
  }
}

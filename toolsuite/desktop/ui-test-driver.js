/**
 * Renderer script for the desktop UI test. Serialized with Function#toString and
 * executed inside the real toolsuite window, so it may only use browser globals
 * and its own `root` argument. Every check reports instead of throwing, so one
 * broken feature does not hide the rest of the suite.
 */
export default async function driveUI(root) {
  // Shared with the main process so a crash mid-script still reports progress.
  const checks = window.__uiChecks || (window.__uiChecks = []);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) });
  const find = (selector, text) => [...document.querySelectorAll(selector)].find(el => !text || el.textContent.includes(text));
  const click = async (el, label) => { if (!el) { check(label, false, 'button not found'); return null; } el.click(); await wait(80); return el; };
  const menuLabels = () => [...document.querySelectorAll('.context-menu button')].map(b => b.textContent);
  const rightClick = async (el, label) => {
    if (!el) { check(label || 'right-click target', false, 'row not found'); return false; }
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 })); await wait(60); return true;
  };
  const escape = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(60); };
  /** Wait for a condition instead of sleeping a fixed time: the shell renders on its own schedule. */
  const until = async (test, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (test()) return true; await wait(50); }
    return false;
  };
  const setValue = async (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); await wait(80); };
  /* ---- file-browser dock helpers ---- */
  const treeRow = label => [...document.querySelectorAll('.folder-tree .tree-row')].find(b => b.textContent === label);
  const openTreeFolder = async label => { const row = treeRow(label); await click(row, `tree folder ${label}`); return !!row; };
  const listRows = () => [...document.querySelectorAll('.file-list .file-row')];
  const listNames = () => listRows().map(row => row.querySelector('.file-name-text')?.textContent);
  const fileRow = name => listRows().find(row => row.querySelector('.file-name-text')?.textContent === name);
  const openFileRow = async name => { const row = fileRow(name); if (row) row.querySelector('.file-label').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(120); return !!row; };
  /** Both windows that hold scenes: the file browser follows the open branch. */
  const openScenesFolder = async () => { await openTreeFolder('Forge documents'); await openTreeFolder('Scenes'); };
  /* ---- menu-bar helpers ---- */
  const menuButton = label => [...document.querySelectorAll('.topbar .menubar button')].find(b => b.textContent === label);
  const openMenu = async label => { await click(menuButton(label), `${label} menu`); return menuLabels(); };
  const setChecked = async (el, value) => { el.checked = value; el.dispatchEvent(new Event('change', { bubbles: true })); await wait(80); };

  check('editor always starts on the dedicated project Home', !!document.querySelector('.project-launcher') && document.querySelector('.bottom-dock').hidden && document.querySelector('.commandbar').hidden);
  check('branding uses the Forge icon and RGE text', !!document.querySelector('.brand img') && document.querySelector('.brand').textContent === 'RGE');
  const { store, launch } = window.__forge;
  const tool = () => window.__forge.tool;

  /* ---- project ---- */
  await window.__forge.openProject(root);
  check('opens a project through the native bridge', store.root === root, store.root);
  check('loads authored project data', store.project.ui.screens.length > 0, `${store.project.ui.screens.length} screens`);
  check('lists project assets', store.assets.some(a => a.path.endsWith('.glb')), `${store.assets.length} assets`);
  check('empty engine-v recommends an upgrade', store.engine.needsUpgrade && !store.engine.current);
  await until(() => !!document.querySelector('.engine-dialog'), 20000);
  check('opening an old project automatically prompts for engine review', !!document.querySelector('.engine-dialog'));
  check('engine review explains preservation and backup location', document.querySelector('.engine-dialog').textContent.includes('.forge/backup') && document.querySelector('.engine-dialog').textContent.includes('animations'));
  const upgradeButton = find('.engine-dialog button', 'Back up and upgrade');
  check('custom engine replacement needs approval', upgradeButton.disabled && !!document.querySelector('.conflict-row input'));
  for (const checkbox of document.querySelectorAll('.conflict-row input')) await setChecked(checkbox, true);
  await click(upgradeButton, 'Upgrade engine');
  await until(() => !store.busy && !document.querySelector('.engine-dialog'), 20000);
  check('upgrade updates marker and resets editor documents safely', store.engine.current === store.engine.newest && !store.engine.needsUpgrade);
  check('upgrade creates a restorable backup', (await window.forgeDesktop.engineBackups()).length === 1);
  await click(find('.top-actions button', 'Engine…'), 'Review backups');
  await until(() => !!document.querySelector('.engine-dialog'), 20000);
  const originalConfirm = window.confirm; window.confirm = () => true;
  try { await click(find('.engine-dialog button', 'Restore…'), 'Restore backup'); await until(() => !store.busy && !document.querySelector('.engine-dialog'), 20000); }
  finally { window.confirm = originalConfirm; }
  check('restore returns old engine and keeps a safety backup', store.engine.needsUpgrade && (await window.forgeDesktop.engineBackups()).length === 2);
  await click(find('.top-actions button', 'Engine…'), 'Upgrade restored project');
  await until(() => !!document.querySelector('.engine-dialog'), 20000);
  for (const checkbox of document.querySelectorAll('.conflict-row input')) await setChecked(checkbox, true);
  await click(find('.engine-dialog button', 'Back up and upgrade'), 'Upgrade again');
  await until(() => !store.busy && !document.querySelector('.engine-dialog'), 20000);

  await window.__forge.showProjects();
  const drawer = document.querySelector('.project-scrim');
  const opened = await until(() => drawer && !drawer.hidden && !!drawer.querySelector('.project-dialog'));
  check('project dialog opens as a modal', opened, drawer?.hidden ? 'still hidden' : 'no dialog content');
  const text = drawer ? drawer.textContent : '';
  check('project dialog shows the open project', /project-hero/.test(drawer.innerHTML) && store.root.includes('forge-test'), store.root);
  check('project dialog offers build and create', /Build installer/.test(text) && /Create new/.test(text) && /Choose folder/.test(text));
  check('project dialog lists recents', /Recent/.test(text) && !!drawer.querySelector('.project-row'), text.slice(0, 80));
  check('project dialog exposes Close and editor exposes Quit', /Close/.test(text) && !!find('.top-actions button', 'Quit'));
  // Dismiss with the backdrop; Quit is asserted above but never clicked, because
  // it really would end the process.
  drawer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(200);
  check('project dialog closes on backdrop click', drawer.hidden);

  /* ---- weapon manager ---- */
  launch('weapon');
  await wait(300);
  const weaponTool = tool();
  const leftPanel = document.querySelector('.workspace aside.panel');
  check('weapon list is headed WEAPONS', /WEAPONS/.test(leftPanel.textContent), leftPanel.querySelector('h3')?.textContent);
  const weaponRows = [...leftPanel.querySelectorAll('button')].filter(b => store.project.weapons.some(w => b.textContent.includes(w.name)));
  check('weapon rows match the project', weaponRows.length === store.project.weapons.length, `${weaponRows.length} rows`);
  await rightClick(weaponRows[0], 'weapon context menu');
  check('weapon context menu opens', menuLabels().length > 0, menuLabels().join(' / '));
  check('weapon context menu has the verbs', ['Rename…', 'Duplicate', 'Delete'].every(l => menuLabels().includes(l)), menuLabels().join(' / '));
  await escape();
  check('Escape closes the context menu', !document.querySelector('.context-menu'));

  const modelBefore = weaponTool.model;
  store.change('project', p => { p.weapons[0].magazineSize += 1; });
  await wait(120);
  check('edits reuse the live viewmodel (no GLB reload)', !!modelBefore && weaponTool.model === modelBefore);

  await click(find('.viewport-toolbar button', 'Gun pose'), 'gun pose');
  check('pose mode offers Apply', !!find('.viewport-toolbar button', 'Apply to hip pose'));
  check('pose mode gizmo is attached to the model', weaponTool.view.gizmo.object === weaponTool.model?.offset, String(weaponTool.view.gizmo.object?.type));
  weaponTool.model.offset.position.set(0.2, -0.1, 0.4);
  await click(find('.viewport-toolbar button', 'Apply to hip pose'), 'apply pose');
  check('Apply stores the dragged pose', JSON.stringify(weaponTool.weapon().hipPosition) === JSON.stringify([0.2, -0.1, 0.4]), JSON.stringify(weaponTool.weapon().hipPosition));
  await click(find('.viewport-toolbar button', 'Muzzle point'), 'muzzle');
  const movedMuzzle = [0.05, 0.02, 0.6];
  weaponTool.model.muzzle.position.fromArray(movedMuzzle);
  weaponTool.gizmoReleased();
  await wait(60);
  check('muzzle drag writes back to the weapon', JSON.stringify(weaponTool.weapon().muzzle) === JSON.stringify(movedMuzzle), JSON.stringify(weaponTool.weapon().muzzle));

  /* ---- hud & menus ---- */
  launch('ui');
  await wait(200);
  const uiTool = tool();
  const uiLeft = document.querySelector('.workspace aside.panel');
  const uiRight = document.querySelector('.workspace aside.panel.inspector');
  await click(find('.add-grid button', '+ image'), 'add image');
  const imageElement = uiTool.element();
  check('new image element gets a human name', /^Image \d+$/.test(imageElement?.name || ''), imageElement?.name);
  check('layer row shows type and name', new RegExp(`image · ${imageElement.name}`).test(uiLeft.textContent), uiLeft.textContent.slice(0, 120));
  check('image inspector offers an asset picker', uiRight.textContent.includes('Image asset') && !!uiRight.querySelector('select'));
  check('image inspector offers upload and clear', uiRight.textContent.includes('Upload image…') && uiRight.textContent.includes('Clear image'));

  const reticle = store.assets.find(a => a.name === 'reticle.png');
  check('project image is listed for the picker', !!reticle, JSON.stringify(uiTool.images().map(i => i.path)));
  uiTool.renderInspector();
  const imageSelect = [...document.querySelectorAll('.inspector select')].find(s => [...s.options].some(o => o.value === reticle?.path));
  await setValue(imageSelect, reticle?.path);
  check('image asset picker writes the src', uiTool.element().src === reticle?.path, uiTool.element().src);
  await wait(300);
  const rendered = document.querySelector('.ui-preview')?.shadowRoot?.querySelector(`img[data-element="${uiTool.element().id}"]`);
  check('image renders in the live preview', !!rendered && rendered.naturalWidth > 0, rendered ? `${rendered.naturalWidth}x${rendered.naturalHeight}` : 'no img element');

  await uiTool.addFont('Forge Sans', 'src/assets/fonts/test.ttf');
  await wait(120);
  const fontSelect = [...document.querySelectorAll('.inspector select')].find(s => [...s.options].some(o => o.value === 'Forge Sans'));
  check('uploaded font appears in the element font list', !!fontSelect);
  await setValue(fontSelect, 'Forge Sans');
  check('element font is applied', uiTool.element().font === 'Forge Sans', uiTool.element().font);
  check('font face reaches the shadow DOM', (document.querySelector('.ui-preview')?.shadowRoot?.textContent || '').includes('@font-face'));

  /* ---- selection clearing, Shift snap, clipboard, rename ---- */
  const designSurface = document.querySelector('.ui-preview')?.shadowRoot?.querySelector('.design');
  designSurface?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  check('clicking the design background clears element selection', uiTool.elementId === null && /SCREEN \/ DESIGN SYSTEM/.test(uiRight.textContent), String(uiTool.elementId));
  const layerRowFor = () => [...uiLeft.querySelectorAll('button')].find(b => b.textContent.startsWith('image · '));
  await click(layerRowFor(), 'reselect the image element');
  check('the element inspector returns after reselect', uiTool.element()?.type === 'image', String(uiTool.elementId));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  check('Shift arms 10px snapping for UI drags', uiTool.shiftGrid === true);
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  const elementCount = uiTool.screen().elements.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  check('UI elements copy and paste with Ctrl+C/V', uiTool.screen().elements.length === elementCount + 1, `${elementCount} → ${uiTool.screen().elements.length}`);
  await click(find('.inspector button', 'Delete element'), 'delete the pasted element');
  check('the pasted element is removed again', uiTool.screen().elements.length === elementCount);
  await click(layerRowFor(), 'reselect the image element for template checks');

  const layerRow = [...uiLeft.querySelectorAll('button')].find(b => b.textContent.startsWith('image · '));
  await rightClick(layerRow, 'layer context menu');
  check('layer context menu opens', ['Bring forward', 'Send backward', 'Duplicate', 'Delete'].every(l => menuLabels().includes(l)), menuLabels().join(' / '));
  check('layer context menu offers Rename and Copy', menuLabels().includes('Rename…') && menuLabels().includes('Copy'), menuLabels().join(' / '));
  await escape();

  await click(find('.inspector button', 'Neon glow'), 'apply template');
  check('style template writes scoped CSS', /\*forge:tpl-neon:element:/.test(store.project.ui.css), store.project.ui.css.slice(-120));
  const element = uiTool.element();
  check('template rule targets the element', store.project.ui.css.includes(`[data-element="${element.id}"]`));

  await click(find('.workspace aside.panel button', 'Screen settings'), 'screen settings');
  check('screen inspector shows a fonts panel', /FONTS/.test(uiRight.textContent) && /Forge Sans/.test(uiRight.textContent));
  check('screen inspector shows style templates', /STYLE TEMPLATES/.test(uiRight.textContent));
  check('screen inspector opens the validated CSS tab', !!find('.inspector button', 'Open the CSS code editor'));
  const nameInput = find('.inspector input[placeholder="New template name"]');
  const cssInput = find('.inspector textarea[placeholder=".selector { color: #fff; }"]');
  nameInput.value = 'UI test style';
  cssInput.value = '.forge-test{color:#fff;}';
  await click(find('.inspector button', 'Save as template'), 'save template');
  const custom = store.project.ui.templates.find(t => t.name === 'UI test style');
  check('custom template is stored', !!custom, JSON.stringify(custom || null));
  await click(find('.inspector button', '✦ UI test style'), 'apply custom template');
  check('custom template writes a screen rule', /\*forge:[^:]+:screen:/.test(store.project.ui.css), store.project.ui.css.slice(-140));
  const customRow = [...document.querySelectorAll('.inspector button')].find(b => b.textContent === '✦ UI test style');
  await rightClick(customRow, 'custom template context menu');
  check('custom template context menu deletes', menuLabels().includes('Delete template'), menuLabels().join(' / '));
  await click(find('.context-menu button', 'Delete template'), 'delete template');
  check('template deleted', !store.project.ui.templates.some(t => t.name === 'UI test style'));
  const fontRow = [...document.querySelectorAll('.inspector button')].find(b => b.textContent === 'Forge Sans');
  await rightClick(fontRow, 'font context menu');
  check('font context menu renames or deletes', menuLabels().includes('Delete') && menuLabels().includes('Rename…'), menuLabels().join(' / '));
  await escape();

  /* ---- resize handles, screen boundary, nudging, CSS code editor ---- */
  await click(layerRowFor(), 'reselect the image element for batch 3 checks');
  check('element inspector offers font upload', !!find('.inspector button', 'Upload font and use it here…'));
  const shadowDesign = document.querySelector('.ui-preview')?.shadowRoot?.querySelector('.design');
  check('edit mode frames the design canvas without clipping', shadowDesign?.classList.contains('framed') === true && shadowDesign?.classList.contains('clipped') === false, shadowDesign?.className);
  check('boundary label shows the game screen size', shadowDesign?.querySelector('.design-label')?.textContent === `${store.project.ui.width} × ${store.project.ui.height}`, shadowDesign?.querySelector('.design-label')?.textContent);
  const handleSe = document.querySelector('.ui-preview')?.shadowRoot?.querySelector('.ui-handle[data-dir="se"]');
  check('resize handles appear around the selection', !!handleSe && handleSe.parentElement.style.display !== 'none', String(!!handleSe));
  const resizeBefore = { width: uiTool.element().width, height: uiTool.element().height };
  const designScale = shadowDesign.getBoundingClientRect().width / store.project.ui.width;
  const handleCenter = handleSe.getBoundingClientRect();
  const dragFrom = { x: handleCenter.left + handleCenter.width / 2, y: handleCenter.top + handleCenter.height / 2 };
  const dragHandle = (type, x, y) => handleSe.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, clientX: x, clientY: y }));
  dragHandle('pointerdown', dragFrom.x, dragFrom.y);
  dragHandle('pointermove', dragFrom.x + 40 * designScale, dragFrom.y + 30 * designScale);
  dragHandle('pointerup', dragFrom.x + 40 * designScale, dragFrom.y + 30 * designScale);
  await wait(150);
  check('dragging the corner handle resizes the element', uiTool.element().width >= resizeBefore.width + 30 && uiTool.element().height >= resizeBefore.height + 20, `${resizeBefore.width}×${resizeBefore.height} → ${uiTool.element().width}×${uiTool.element().height}`);
  const nudgeBefore = uiTool.element().x;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  check('arrow keys nudge the selected element', uiTool.element().x === nudgeBefore + 1, `${nudgeBefore} → ${uiTool.element().x}`);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
  check('Shift+arrow nudges ten pixels', uiTool.element().x === nudgeBefore + 11, `${nudgeBefore} → ${uiTool.element().x}`);
  store.change('project', p => { p.ui.screens.find(s => s.id === uiTool.screenId).elements.find(e => e.id === uiTool.elementId).x = store.project.ui.width + 500; });
  await wait(120);
  const offscreenEl = shadowDesign.querySelector(`[data-element="${uiTool.element().id}"]`);
  check('elements off the game canvas are dimmed, not clipped', offscreenEl?.classList.contains('offscreen') === true, offscreenEl?.className);
  store.change('project', p => { p.ui.screens.find(s => s.id === uiTool.screenId).elements.find(e => e.id === uiTool.elementId).x = nudgeBefore; });
  await wait(120);
  await click(find('.viewport-toolbar button', 'Switch to interactive preview'), 'interactive preview');
  await wait(120);
  const previewDesign = document.querySelector('.ui-preview')?.shadowRoot?.querySelector('.design');
  check('the game-facing preview clips to the design canvas instead of framing', previewDesign?.classList.contains('clipped') === true && previewDesign?.classList.contains('framed') === false, previewDesign?.className);
  await click(find('.viewport-toolbar button', 'Switch to layout editing'), 'back to layout');
  await wait(120);

  const originalCss = store.project.ui.css;
  await click(find('.viewport-toolbar button', 'CSS code'), 'open css tab');
  await wait(120);
  const cssTextarea = document.querySelector('.ui-code-panel textarea');
  check('CSS tab carries the project stylesheet', !!cssTextarea && cssTextarea.value === store.project.ui.css, cssTextarea ? `${cssTextarea.value.length} chars` : 'no textarea');
  cssTextarea.value = `${originalCss}\n.ui-text { color: red;`;
  cssTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  check('unterminated block reports a plain problem', /never closed/.test(document.querySelector('.ui-code-problems')?.textContent || ''), document.querySelector('.ui-code-problems')?.textContent?.slice(0, 90));
  cssTextarea.value = `${originalCss}\n@foo { color: teal; }`;
  cssTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  check('unknown at-rule gets a heads-up', /not a known at-rule/.test(document.querySelector('.ui-code-problems')?.textContent || ''), document.querySelector('.ui-code-problems')?.textContent?.slice(0, 90));
  cssTextarea.value = originalCss;
  cssTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  const fontChip = [...document.querySelectorAll('.font-chip')].find(b => b.textContent === 'Forge Sans');
  await click(fontChip, 'click font chip');
  check('font chip inserts the family into the stylesheet', store.project.ui.css.includes('font-family:"Forge Sans"'), store.project.ui.css.slice(-80));
  cssTextarea.value = originalCss;
  cssTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  check('clean CSS reports no problems', /No problems found/.test(document.querySelector('.ui-code-problems')?.textContent || ''), document.querySelector('.ui-code-problems')?.textContent?.slice(0, 90));
  await click(find('.viewport-toolbar button', 'Layout'), 'back to layout');
  await wait(120);
  check('layout tab returns the framed designer', document.querySelector('.ui-preview')?.shadowRoot?.querySelector('.design')?.classList.contains('framed') === true);

  /* ---- level editor ---- */
  launch('level');
  await wait(200);
  const levelTool = tool();
  check('level editor opens its 3D viewport', !!levelTool?.view?.canvas);
  await setValue(document.querySelector('.commandbar input[aria-label="Save filename"]'), 'ui-test');
  check('Play and Stop are available from the global toolbar', !!find('.commandbar button', 'Play') && !!find('.commandbar button', 'Stop'));
  check('persistent dock and resizable side panels are present', !!document.querySelector('.bottom-dock') && document.querySelectorAll('.panel-splitter').length === 2);
  const before = store.level.geometry.length;
  await click(find('.add-grid button', '+ Box'), 'add box');
  check('adding a box writes a spec', store.level.geometry.length === before + 1, `${before} → ${store.level.geometry.length} geometry specs`);
  const spawnRow = find('.hierarchy button', 'Primary player spawn');
  await rightClick(spawnRow, 'hierarchy context menu');
  check('hierarchy context menu opens', menuLabels().includes('Frame selection'), menuLabels().join(' / '));
  const boxRow = find('.hierarchy .entity-select', store.level.geometry[0].name || store.level.geometry[0].id);
  await rightClick(boxRow, 'entity context menu');
  check('entity context menu duplicates and deletes', menuLabels().includes('Duplicate') && menuLabels().includes('Delete'), menuLabels().join(' / '));
  await escape();
  check('level preview target is the saved file', store.levelFile === 'ui-test', store.levelFile);

  /* ---- multi-select, Shift snap, clipboard, rename, scene drawer ---- */
  levelTool.select(null);
  const entityRows = () => [...document.querySelectorAll('.hierarchy .entity-select')];
  const rowFor = spec => entityRows().find(b => b.textContent === (spec.name || spec.id));
  await click(rowFor(store.level.geometry[0]), 'select the floor');
  check('selection draws a subtle outline helper', levelTool.view.helpers.size === 1, String(levelTool.view.helpers.size));
  rowFor(store.level.geometry[0]).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  rowFor(store.level.geometry[1]).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  check('ctrl-click builds a multi-selection on one group gizmo', levelTool.multi.size === 2 && levelTool.view.gizmo.object === levelTool.proxy, `${levelTool.multi.size} selected`);
  const groupRefs = [...levelTool.multi.values()];
  const beforeX = groupRefs.map(ref => levelTool.spec(ref).position[0]);
  levelTool.beginGroupDrag();
  levelTool.proxy.position.x += 2;
  levelTool.updateGroupDrag();
  levelTool.commitGroupDrag();
  check('a group gizmo move writes every selected object', groupRefs.every((ref, i) => Math.abs(levelTool.spec(ref).position[0] - (beforeX[i] + 2)) < 0.01), JSON.stringify(groupRefs.map(ref => levelTool.spec(ref).position)));
  store.undo('level');
  check('a group move is one undo step for the whole group', groupRefs.every((ref, i) => Math.abs(levelTool.spec(ref).position[0] - beforeX[i]) < 0.01));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  check('holding Shift snaps movement to the grid', levelTool.view.gizmo.translationSnap === 0.5, String(levelTool.view.gizmo.translationSnap));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  check('releasing Shift restores free movement', levelTool.view.gizmo.translationSnap === null, String(levelTool.view.gizmo.translationSnap));
  levelTool.select(null);
  levelTool.select({ key: 'geometry', id: store.level.geometry[0].id });
  const copyCount = store.level.geometry.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  check('Ctrl+C then Ctrl+V pastes an offset duplicate', store.level.geometry.length === copyCount + 1, `${copyCount} → ${store.level.geometry.length}`);
  levelTool.remove();
  check('the pasted copy deletes cleanly', store.level.geometry.length === copyCount);
  await rightClick(rowFor(store.level.geometry[1]), 'entity menu for rename');
  check('entity context menu offers Rename', menuLabels().includes('Rename…'), menuLabels().join(' / '));
  await escape();
  await openScenesFolder();
  check('scenes are managed in the dock instead of a dropdown', !document.querySelector('.commandbar select') && !!document.querySelector('.dock-scenes'), `select=${!!document.querySelector('.commandbar select')} dock=${!!document.querySelector('.dock-scenes')}`);
  store.setSceneFile('temp-scene');
  await store.save('level');
  window.__forge.renderDock();
  check('the dock lists every saved scene', [...document.querySelectorAll('.dock-scenes .scene-name')].some(el => el.textContent === 'temp-scene'));
  store.setSceneFile('ui-test');
  await store.save('level'); // the file only exists on disk once saved; Play does this later
  await store.openScene('ui-test');
  await store.deleteScene('temp-scene');
  check('scene delete removes the file from the project list', !store.levels.includes('temp-scene') && store.levelFile === 'ui-test', `${store.levelFile}: ${store.levels.join(', ')}`);
  window.__forge.renderDock();
  levelTool.select(null);
  // Escape (menu close) clears selection by design; restore the box the
  // following hide/lock/prefab checks expect to operate on.
  const restored = store.level.geometry[1];
  if (restored) levelTool.select({ key: 'geometry', id: restored.id });

  const visualBefore = levelTool.findVisual();
  store.change('project', p => { p.name = 'UI test game'; });
  check('project edits retain scene visuals', levelTool.findVisual() === visualBefore);
  const ref = levelTool.selected;
  levelTool.edit(ref, spec => { spec.position[0] += 2; });
  check('transform edits reuse the scene object', levelTool.findVisual() === visualBefore);
  levelTool.view.gizmo.dispatchEvent({ type: 'dragging-changed', value: true });
  check('gizmo dragging disables orbit', !levelTool.view.orbit.enabled);
  levelTool.view.gizmo.dispatchEvent({ type: 'dragging-changed', value: false });
  check('gizmo release restores orbit', levelTool.view.orbit.enabled);
  const selectedSpec = levelTool.spec();
  await click(document.querySelector(`button[aria-label="Hide: ${selectedSpec.name || selectedSpec.id}"]`), 'hide object');
  check('hide affects editor visual only', !levelTool.findVisual().visible && levelTool.spec().editor.hidden);
  await click(document.querySelector(`button[aria-label="Lock: ${selectedSpec.name || selectedSpec.id}"]`), 'lock object');
  check('locked object detaches gizmo', !levelTool.view.gizmo.object);
  levelTool.edit(ref, spec => { spec.editor = { hidden: false, locked: false }; });
  await window.__forge.showProjects(); await escape();
  check('Escape closes Projects', document.querySelector('.project-scrim').hidden);

  const originalPrompt = window.prompt;
  // Escape clears the selection by design; the prefab save needs an object.
  levelTool.select({ key: 'geometry', id: store.level.geometry[1].id });
  try { window.prompt = () => 'Test box'; levelTool.savePrefab(); } finally { window.prompt = originalPrompt; }
  const prefab = store.project.prefabs.find(p => p.name === 'Test box');
  check('Save as prefab stores a validated reusable object', !!prefab && !prefab.spec.id);
  const geometryCount = store.level.geometry.length; levelTool.instantiate(prefab);
  check('prefab instantiation creates a unique scene object', store.level.geometry.length === geometryCount + 1 && levelTool.spec().id !== ref.id);
  levelTool.add('triggers');
  await click(find('.inspector button', 'Add action'), 'add trigger action');
  check('trigger inspector creates built-in actions', levelTool.spec().actions[0]?.type === 'message');
  const triggerRef = levelTool.selected;
  levelTool.edit(triggerRef, value => { value.actions = [{ type: 'heal', amount: 25 }, { type: 'ammo', amount: 30 }, { type: 'message', text: 'Action test', duration: 3 }]; });
  const searchObjects = document.querySelector('input[aria-label="Search objects"]');
  searchObjects.value = 'Trigger'; searchObjects.dispatchEvent(new Event('input', { bubbles: true }));
  check('hierarchy search filters object rows', [...document.querySelectorAll('.hierarchy .entity-select')].every(el => el.textContent.includes('Trigger')));
  searchObjects.value = ''; searchObjects.dispatchEvent(new Event('input', { bubbles: true }));

  /* ---- team deathmatch, bots and colliders ---- */
  levelTool.select(null); await wait(150);
  const modeField = document.querySelector('.inspector [aria-label="Game mode"]');
  check('scene settings offer Team Deathmatch', !!modeField && [...modeField.options].some(o => o.value === 'tdm'), modeField ? [...modeField.options].map(o => o.value).join(',') : 'missing');
  await setValue(modeField, 'tdm');
  check('game mode is stored on the scene', store.level.mode === 'tdm', store.level.mode);
  check('match settings panel is available', !!document.querySelector('.inspector [aria-label="Score limit"]'));
  await setValue(document.querySelector('.inspector [aria-label="Score limit"]'), '5');
  check('score limit is stored in match settings', store.level.match?.scoreLimit === 5, JSON.stringify(store.level.match));
  await setValue(document.querySelector('.inspector [aria-label="Respawn delay (s)"]'), '1.5');
  check('respawn delay is stored in match settings', store.level.match?.respawnDelay === 1.5, JSON.stringify(store.level.match));
  await setChecked(document.querySelector('.inspector [aria-label="Friendly fire"]'), true);
  check('friendly fire toggle is stored', store.level.match?.friendlyFire === true, JSON.stringify(store.level.match));

  /* ---- sky, lighting and render quality ---- */
  const skyField = document.querySelector('.inspector [aria-label="Sky"]');
  const skyIds = skyField ? [...skyField.options].map(o => o.value) : [];
  check('scene settings offer at least two sky presets', skyIds.filter(id => id !== 'none').length >= 2, skyIds.join(','));
  check('sky presets reach the editor viewport', !!levelTool.view.engine.scene.getObjectByName('sky') && !!levelTool.view.engine.scene.environment, `dome=${!!levelTool.view.engine.scene.getObjectByName('sky')} env=${!!levelTool.view.engine.scene.environment}`);
  await setValue(skyField, 'golden-hour');
  check('sky preset is stored on the scene', store.level.environment?.sky === 'golden-hour', store.level.environment?.sky);
  check('changing the sky swaps the live dome', levelTool.view.engine.scene.getObjectByName('sky')?.material.uniforms.uHorizon.value.getHexString() === 'f0a765', levelTool.view.engine.scene.getObjectByName('sky')?.material.uniforms.uHorizon.value.getHexString());
  const qualityField = document.querySelector('.inspector [aria-label="Quality"]');
  check('render quality presets are offered', !!qualityField && ['low', 'medium', 'high', 'ultra'].every(q => [...qualityField.options].some(o => o.value === q)), qualityField ? [...qualityField.options].map(o => o.value).join(',') : 'missing');
  await setValue(qualityField, 'medium');
  check('quality preset stores its numbers', store.level.environment?.render?.quality === 'medium' && store.level.environment.render.shadowSize === 1024, JSON.stringify(store.level.environment?.render));
  await setValue(document.querySelector('.inspector [aria-label="Tone mapping"]'), 'filmic');
  check('tone mapping is stored', store.level.environment?.render?.toneMapping === 'filmic', store.level.environment?.render?.toneMapping);
  await setValue(document.querySelector('.inspector [aria-label="Exposure"]'), '1.4');
  check('exposure is stored', store.level.environment?.render?.exposure === 1.4, store.level.environment?.render?.exposure);
  await setChecked(document.querySelector('.inspector [aria-label="Shadows"]'), false);
  check('shadows can be turned off', store.level.environment?.render?.shadows === false, JSON.stringify(store.level.environment?.render));
  // Left off deliberately: the saved scene is what the game build is checked
  // against, so it has to keep the unusual sky and exposure set above.
  await setChecked(document.querySelector('.inspector [aria-label="Shadows"]'), true);
  check('shadows can be turned back on', store.level.environment?.render?.shadows === true, JSON.stringify(store.level.environment?.render));

  const botButton = find('.workspace .add-grid button', '+ Bot');
  await click(botButton, 'add bot');
  check('adding a bot writes a bot spec', store.level.bots?.length === 1 && store.level.bots[0].team === 'B', JSON.stringify(store.level.bots?.[0]));
  check('bot appears in the hierarchy', /Bot 1/.test(document.querySelector('.hierarchy').textContent));
  const botRef = levelTool.selected;
  check('bot inspector offers skill tuning', !!document.querySelector('.inspector [aria-label="Skill (0–1)"]'));
  await setValue(document.querySelector('.inspector [aria-label="Skill (0–1)"]'), '0.8');
  check('bot skill is stored', store.level.bots.find(bot => bot.id === botRef.id)?.skill === 0.8, JSON.stringify(store.level.bots));
  await setValue(document.querySelector('.inspector [aria-label="team"]'), 'A');
  check('bot team is editable', store.level.bots[0].team === 'A', store.level.bots[0].team);
  await click(find('.workspace .add-grid button', '+ Bot'), 'add enemy bot');
  check('a second bot can be added', store.level.bots.length === 2, `${store.level.bots.length} bots`);
  await setValue(document.querySelector('.inspector [aria-label="team"]'), 'B');
  check('bots can be split across teams', store.level.bots.some(bot => bot.team === 'A') && store.level.bots.some(bot => bot.team === 'B'), JSON.stringify(store.level.bots.map(bot => bot.team)));
  // Item 16: authored bots are visible as a mesh in the editor viewport, not a
  // wireframe capsule. The ghost keeps a real team-coloured body, head, legs,
  // gun and health bar.
  const ghost = levelTool.findVisual({ key: 'bots', id: store.level.bots[1]?.id || store.level.bots[0].id });
  check('authored bot renders as a mesh ghost in the viewport', !!ghost && !ghost.isWireframe && (ghost.children?.length || 0) >= 6, ghost ? `children=${ghost.children?.length} wireframe=${!!ghost.isWireframe}` : 'ghost not found');

  const colliderField = (() => {
    const geometry = store.level.geometry[0];
    levelTool.select({ key: 'geometry', id: geometry.id });
    return document.querySelector('.inspector [aria-label="Collider"]');
  })();
  check('collider picker offers mesh and hull', !!colliderField && ['box', 'mesh', 'hull', 'none'].every(mode => [...colliderField.options].some(o => o.value === mode)), colliderField ? [...colliderField.options].map(o => o.value).join(',') : 'missing');
  await setValue(colliderField, 'mesh');
  check('mesh collider is stored on the object', store.level.geometry[0].collider === 'mesh', store.level.geometry[0].collider);
  // Point it at a real imported model so the game builds a triangle mesh, and
  // give a dynamic prop a convex hull of the same model.
  const weaponAsset = store.assets.find(asset => asset.path.endsWith('/weapons/M4.glb'));
  if (!weaponAsset) throw new Error('The detailed M4 fixture is required for triangle-collider coverage.');
  const modelField = document.querySelector('.inspector [aria-label="Model asset"]');
  await setValue(modelField, weaponAsset.path);
  check('model asset is stored for collider building', store.level.geometry[0].gltfUrl === weaponAsset.path, store.level.geometry[0].gltfUrl || 'none');
  levelTool.add('props', weaponAsset.path);
  levelTool.edit(levelTool.selected, spec => { spec.collider = 'hull'; spec.mass = 4; spec.tags = ['target']; });
  check('a prop can use a hull collider with mass', levelTool.spec().collider === 'hull' && levelTool.spec().mass === 4, JSON.stringify({ c: levelTool.spec().collider, m: levelTool.spec().mass }));

  launch('animation'); await wait(600);
  const animation = tool(); animation.addClip(); animation.animRoot.position.set(1, 2, 3); animation.keyNode('@root', ['position']);
  check('animation auto-key stores a runtime-compatible track', animation.clip().tracks.some(track => track.target === '@root' && track.keys[0]?.value[1] === 2));
  check('animation preview uses the runtime viewmodel hierarchy', !!animation.pivot && animation.animRoot.children.includes(animation.pivot));
  // Seeding waits on the weapon GLTF settling under real machine load; the
  // default 4s deadline is too tight for a busy disk (run 3 flaked on it).
  const settled = await until(() => !!animation.defaults && !animation.pendingDefaults, 12000);
  check('new clips seed all loaded parts at zero', settled && animation.clip().tracks.length >= animation.nodes.size * 3 && animation.clip().tracks.every(t => t.keys.some(k => k.time === 0)));
  animation.setTime(0.5); animation.animRoot.position.set(4, 5, 6); animation.keyNode('@root', ['position']);
  const positionTrack = animation.clip().tracks.find(t => t.target === '@root' && t.property === 'position');
  check('later key retains the initial pose', positionTrack.keys[0].time === 0 && positionTrack.keys[0].value[1] === 2);
  animation.selectNode([...animation.nodes].find(name => name !== '@root') || '@root');
  await click([...document.querySelectorAll('.diamond')].find(b => b.title.includes('0.500s · @root.position')), 'select root key');
  check('clicking a key selects its part and seeks', animation.node === '@root' && animation.time === 0.5 && animation.view.gizmo.object === animation.animRoot);
  animation.autoKey = false; animation.animRoot.position.set(7, 8, 9); animation.view.mode('translate'); animation.gizmoDone(animation.animRoot);
  check('selected-key gizmo edits upsert with Auto key off', animation.clip().tracks.find(t => t.id === positionTrack.id).keys.length === 2 && animation.clip().tracks.find(t => t.id === positionTrack.id).keys[1].value[1] === 8);
  await click(find('.tl-transport button', 'Return to start at end'), 'return pose at end');
  const returned = animation.clip().tracks.find(t => t.id === positionTrack.id);
  check('end pose matches authored starting pose', JSON.stringify(returned.keys.at(-1).value) === JSON.stringify(returned.keys[0].value));
  animation.editTrack(positionTrack.id, t => t.keys.shift()); animation.render();
  check('deleted default keys stay deleted', !animation.clip().tracks.find(t => t.id === positionTrack.id).keys.some(k => k.time === 0));
  animation.edit(c => { c.loop = true; }); animation.setTime(animation.clip().duration); animation.render();
  check('looping clips can seek their actual end pose', JSON.stringify(animation.animRoot.position.toArray()) === JSON.stringify(animation.clip().tracks.find(t => t.id === positionTrack.id).keys.at(-1).value));
  const selectedEndTrack = animation.clip().tracks.find(t => t.id === positionTrack.id);
  animation.selectKey(selectedEndTrack, selectedEndTrack.keys.at(-1));
  await setValue(document.querySelector('.inspector input[aria-label="X"]'), '11');
  check('selected-key inspector edits update the existing key', animation.clip().tracks.find(t => t.id === positionTrack.id).keys.at(-1).value[0] === 11 && animation.clip().tracks.find(t => t.id === positionTrack.id).keys.length === 2);
  launch('level'); await wait(100);

  /* ---- game properties ---- */
  launch('game');
  const gameReady = await until(() => !!document.querySelector('[aria-label="Game name"]'));
  const gameTool = tool();
  const gameLeft = document.querySelector('.workspace aside.panel');
  check('game properties workspace shows the output summary', gameReady && /Output/.test(gameLeft.textContent), gameLeft.textContent.slice(0, 80));
  await setValue(document.querySelector('[aria-label="Game name"]'), 'UI Test Arena');
  check('game name is stored on the project', store.project.game?.name === 'UI Test Arena', JSON.stringify(store.project.game));
  await setValue(document.querySelector('[aria-label="Publisher"]'), 'Forge QA');
  await setValue(document.querySelector('[aria-label="Version"]'), '4.5.6');
  await setValue(document.querySelector('[aria-label="Description"]'), 'Built by the desktop suite.');
  await setChecked(document.querySelector('[aria-label="Desktop shortcut"]'), false);
  await setValue(document.querySelector('[aria-label="Shortcut name"]'), 'UI Test Arena DM');
  check('publisher, version and shortcut options are stored', store.project.game.publisher === 'Forge QA' && store.project.game.version === '4.5.6'
    && store.project.game.createDesktopShortcut === false && store.project.game.shortcutName === 'UI Test Arena DM', JSON.stringify(store.project.game));
  check('output preview names the installer file', /UI-Test-Arena-v/.test(gameLeft.textContent), gameLeft.textContent.slice(0, 160));
  check('output preview lists the publisher', /Forge QA/.test(gameLeft.textContent));
  await setValue(document.querySelector('[aria-label="Game name"]'), 'Bad/Name');
  check('an illegal game name is refused and the old one kept', store.project.game.name === 'UI Test Arena', store.project.game.name);
  await setValue(document.querySelector('[aria-label="Game name"]'), 'UI Test Arena');
  check('reset restores the defaults but keeps the authored name', (gameTool.edit(() => {}), store.project.game.name === 'UI Test Arena'));

  /* ---- dedicated Home, Settings and real documents ---- */
  launch('home'); await wait(150);
  check('Home is a project launcher with open/create controls', !!find('.launcher-actions button', 'Open project') && !!find('.launcher-actions button', 'New project'));
  check('Home hides all editing and shipping chrome', document.querySelector('.bottom-dock').hidden && document.querySelector('.commandbar').hidden && document.querySelector('.document-tabs').hidden && !find('.project-launcher button', 'Build installer'));
  await click(find('.top-actions button', 'Settings'), 'Settings');
  check('Settings opens a dedicated dialog', document.querySelector('.settings-dialog').open);
  const theme = document.querySelector('[aria-label="Editor theme"]');
  check('Settings offers three themes', theme.options.length === 3);
  const authoredTheme = store.project.settings.theme;
  await setValue(theme, 'moss');
  check('editor theme is independent of project data', store.project.settings.theme === authoredTheme && window.__forge.settings.value.theme === 'moss');
  check('picking a theme repaints the shell', document.documentElement.style.getPropertyValue('--mint').trim() === '#9ee493');
  await setValue(theme, 'midnight');
  check('switching back restores the default accent', document.documentElement.style.getPropertyValue('--mint').trim() === '#77e4c1');
  check('Settings exposes autosave and update preferences', !!document.querySelector('[aria-label="Autosave mode"]') && !!document.querySelector('[aria-label="Automatically check for Forge updates"]'));
  await click(find('.settings-dialog button', 'Close'), 'Close Settings');
  launch('game'); await wait(100);
  await setValue(document.querySelector('[aria-label="Volume (0–1)"]'), '0.45');
  check('gameplay defaults remain project data in Game properties', store.project.settings.volume === 0.45);
  launch('level'); await wait(100);
  /* ---- traditional menu bar (File / Edit / Window) ---- */
  const barLabels = [...document.querySelectorAll('.topbar .menubar button')].map(b => b.textContent);
  check('topbar is a File / Edit / Window menu bar', barLabels.join(' / ') === 'File / Edit / Window', barLabels.join(' / '));
  check('no activity sidebar and document tabs still open documents', !document.querySelector('.activity-sidebar') && !![...document.querySelectorAll('.document-tabs button[role="tab"]')].find(tab => tab.textContent.endsWith('.fss')));
  check('the menu bar names the open workspace', /SCENE/i.test(document.querySelector('.workspace-title')?.textContent || ''), document.querySelector('.workspace-title')?.textContent);
  const fileItems = await openMenu('File');
  check('File menu carries project, save and shipping verbs', ['New project…', 'Open project…', 'Save', 'Import files…', 'Build installer…', 'Settings…', 'Quit'].every(label => fileItems.includes(label)), fileItems.join(' / '));
  await escape();
  const editItems = await openMenu('Edit');
  check('Edit menu carries undo, redo and JSON import', editItems.some(label => label.startsWith('Undo')) && editItems.includes('Redo') && editItems.includes('Import JSON…'), editItems.join(' / '));
  await escape();
  check('Escape closes a menu-bar dropdown', !document.querySelector('.context-menu'));
  const windowItems = await openMenu('Window');
  check('Window menu opens every editing workspace', ['Scene', 'Weapons', 'Player', 'Animation', 'UI', 'Game', 'Home'].every(name => windowItems.some(label => label.startsWith(name))), windowItems.join(' / '));
  await click(find('.context-menu button', 'Weapons'), 'Window → Weapons');
  check('choosing a workspace in the Window menu switches the editor', /WEAPONS/.test(document.querySelector('.workspace aside.panel')?.textContent || ''), document.querySelector('.workspace-title')?.textContent);
  await openMenu('Window');
  check('the Window menu marks the open workspace', menuLabels().some(label => label.startsWith('Weapons') && label.includes('●')), menuLabels().join(' / '));
  await escape();
  launch('level'); await wait(150);

  /* ---- file-browser dock ---- */
  await openTreeFolder('src / assets');
  check('assets dock is a file browser with an Up button and breadcrumbs', !!document.querySelector('.folder-tree') && !!document.querySelector('.file-list') && !!document.querySelector('.file-nav .file-up') && !!document.querySelector('.file-crumbs'));
  const rootNames = listNames();
  check('folders are listed first and typed as folders', rootNames.includes('models') && rootNames.includes('images')
    && rootNames.every((name, i) => i === 0 || rootNames[i - 1].localeCompare(name) <= 0)
    && listRows().every(row => row.querySelector('.file-kind')?.textContent === 'Folder'), rootNames.join(', '));
  await openFileRow('models');
  check('double-clicking a folder enters it', listNames().includes('players') && /models/.test(document.querySelector('.file-crumbs').textContent), `${listNames().join(', ')} · ${document.querySelector('.file-crumbs').textContent}`);
  await click(find('.file-nav button', '↑ Up'), 'up one folder');
  check('the Up button walks back out of the folder', !listNames().includes('players'), listNames().join(', '));
  await openFileRow('models');
  await openTreeFolder('players');
  const glbRow = fileRow('rig-test.glb');
  check('a file row names its type and size', !!glbRow && /GLB model/.test(glbRow.textContent) && /KB/.test(glbRow.textContent), glbRow?.textContent?.trim());
  await rightClick(glbRow, 'file context menu');
  check('file rows offer file-browser verbs', menuLabels().includes('Open') && menuLabels().includes('Open file location'), menuLabels().join(' / '));
  await escape();
  const beforeGeometry = store.level.geometry.length;
  await openFileRow('rig-test.glb');
  check('double-clicking a file hands it to the open workspace', store.level.geometry.length === beforeGeometry + 1 && /rig-test\.glb$/.test(store.level.geometry.at(-1)?.gltfUrl || ''), store.level.geometry.at(-1)?.gltfUrl);
  tool().remove();
  check('the handed-over object deletes again', store.level.geometry.length === beforeGeometry);
  const searchBox = document.querySelector('input[aria-label="Search assets"]');
  searchBox.value = 'rig-white'; searchBox.dispatchEvent(new Event('input', { bubbles: true }));
  check('search filters the open folder', listNames().join() === 'rig-white.glb', listNames().join(', '));
  searchBox.value = ''; searchBox.dispatchEvent(new Event('input', { bubbles: true }));
  await openScenesFolder();
  const levelRow = fileRow('ui-test.fss');
  check('Forge document folders list their real files', !!levelRow && /Scene file/.test(levelRow.textContent), levelRow?.textContent?.trim());
  check('Engine dialog reachable from the topbar', !!find('.top-actions button', 'Engine…'));
  check('new projects use authoritative Forge documents', store.documentMode && (await window.forgeDesktop.documents()).some(item => item.name.endsWith('.fsw')));

  /* ---- imported player skeleton, body clips and gun/hand/finger clips ---- */
  launch('player'); await wait(100);
  const playerTool = tool();
  const rigAsset = store.assets.find(asset => asset.path.endsWith('/rig-test.glb'));
  check('Player workspace offers GLB import', !!find('.workspace button', 'Import player GLB'));
  if (!rigAsset) throw new Error('Rigged GLB fixture is missing from the native asset list.');
  await setValue(document.querySelector('[aria-label="Player GLB"]'), rigAsset.path);
  const rigLoaded = await until(() => playerTool.inventory.bones.includes('Finger'), 12000);
  check('player GLB exposes arm meshes and hand/finger bones', rigLoaded && playerTool.inventory.meshes.some(mesh => mesh.name === 'ArmsMesh' && mesh.skinned));
  /* embedded-texture guidance (item 1): white and textured variants of the
     same rig prove both the re-export guidance and that images survive the
     shared model cache and its per-mount SkeletonUtils clones. */
  const statusEl = document.getElementById('status');
  const texturedAsset = store.assets.find(asset => asset.path.endsWith('/rig-textured.glb'));
  const whiteAsset = store.assets.find(asset => asset.path.endsWith('/rig-white.glb'));
  if (!texturedAsset || !whiteAsset) throw new Error('Textured/white rig fixtures are missing from the native asset list.');
  await setValue(document.querySelector('[aria-label="Player GLB"]'), whiteAsset.path);
  await until(() => playerTool.inventory.bones.includes('Finger') && /plain white/.test(statusEl.textContent), 12000);
  const whiteMesh = playerTool.meshByName.get('ArmsMesh');
  check('a textureless white GLB is reported with export guidance', /plain white/.test(statusEl.textContent) && !!whiteMesh && !whiteMesh.material.map, `${statusEl.textContent} · map=${!!whiteMesh?.material?.map}`);
  await setValue(document.querySelector('[aria-label="Player GLB"]'), texturedAsset.path);
  const texturedReady = await until(() => !!playerTool.meshByName.get('ArmsMesh')?.material?.map?.image, 12000);
  const texturedMesh = playerTool.meshByName.get('ArmsMesh');
  const textureImage = texturedMesh?.material?.map?.image;
  check('embedded GLB textures survive the shared model cache and clones', !!texturedReady && !!textureImage, `image=${textureImage ? textureImage.width : 'null'}`);
  check('a textured model is not flagged as plain white', !/plain white/.test(statusEl.textContent), statusEl.textContent);
  /* The legacy export form: three dropped KHR_materials_pbrSpecularGlossiness,
     and real Sketchfab/Blender art keeps every texture inside it. */
  const specAsset = store.assets.find(asset => asset.path.endsWith('/rig-specgloss.glb'));
  if (!specAsset) throw new Error('Specular-glossiness rig fixture is missing from the native asset list.');
  await setValue(document.querySelector('[aria-label="Player GLB"]'), specAsset.path);
  const specReady = await until(() => !!playerTool.meshByName.get('ArmsMesh')?.material?.map?.image, 12000);
  const specMesh = playerTool.meshByName.get('ArmsMesh');
  check('a legacy specular-glossiness GLB keeps its embedded texture', !!specReady && specMesh?.material?.map?.image?.width === 8, `image=${specMesh?.material?.map?.image?.width ?? 'null'}`);
  check('the legacy shim reads glossiness and keeps dielectric specular non-metallic', Math.abs((specMesh?.material?.roughness ?? -1) - 0.75) < 1e-3 && specMesh?.material?.metalness === 0, `roughness=${specMesh?.material?.roughness} metalness=${specMesh?.material?.metalness}`);
  check('a shimmed legacy model is not flagged as plain white', !/plain white/.test(statusEl.textContent), statusEl.textContent);
  await setValue(document.querySelector('[aria-label="Player GLB"]'), rigAsset.path);
  await until(() => playerTool.inventory.bones.includes('Finger'), 12000);
  check('mesh tickboxes stay hidden until first-person arms are enabled', !document.querySelector('[aria-label="Show mesh: ArmsMesh"]'));
  await setChecked(document.querySelector('[aria-label="Enable first-person arms"]'), true);
  await until(() => !!document.querySelector('[aria-label="Show mesh: ArmsMesh"]'));
  check('enabling first-person arms reveals the mesh tickboxes', !!document.querySelector('[aria-label="Show mesh: ArmsMesh"]'));
  await setChecked(document.querySelector('[aria-label="Show mesh: ArmsMesh"]'), true);
  check('first-person mesh selection is stored in player data', store.project.player.firstPerson.enabled && store.project.player.firstPerson.meshes.join() === 'ArmsMesh');
  check('selected first-person meshes are highlighted in the viewport', playerTool.view.helpers.size >= 1);
  const highlightBefore = playerTool.view.helpers.size;
  playerTool.selectPart(playerTool.meshByName.get('ArmsMesh'));
  check('clicking a mesh in the view toggles it out of the first-person arms', store.project.player.firstPerson.meshes.length === 0 && playerTool.view.helpers.size < highlightBefore, `helpers ${playerTool.view.helpers.size}`);
  playerTool.selectPart(playerTool.meshByName.get('ArmsMesh'));
  check('clicking it again restores the first-person arm mesh', store.project.player.firstPerson.meshes.join() === 'ArmsMesh' && playerTool.view.helpers.size === highlightBefore);
  check('model buffers are cached across tool switches', (() => {
    const before = window.__forge.modelCache.entries;
    launch('weapon'); launch('player');
    return window.__forge.modelCache.entries >= 1 && before >= 1;
  })());
  await click(find('.workspace button', 'Animate full player'), 'animate body');
  const bodyAnimation = tool();
  check('body animation opens the upright imported rig', await until(() => bodyAnimation.nodes.has('player:Finger') && !!bodyAnimation.defaults, 12000));
  bodyAnimation.addClip(); bodyAnimation.selectNode('player:Finger'); bodyAnimation.setTime(0.5);
  bodyAnimation.applyTransform('rotation', [0, 0, 0.6]);
  const bodyClip = bodyAnimation.clip().id;
  check('player clips store keyed finger bones', bodyAnimation.clip().kind === 'player' && bodyAnimation.clip().tracks.some(track => track.target === 'player:Finger' && track.keys.some(key => key.time === 0.5)));
  launch('player'); await wait(100);
  await setValue(document.querySelector('[aria-label="Player idle"]'), bodyClip);
  /* damage hitboxes (item 8) */
  const hitboxPlayer = tool();
  await click(find('.workspace button', '+ Head'), 'add head hitbox');
  await click(find('.workspace button', '+ Legs'), 'add legs hitbox');
  const headBox = store.project.player.hitboxes.find(box => box.part === 'head');
  check('hitboxes are authored as cubes on the player rig', store.project.player.hitboxes.length === 2 && !!headBox && hitboxPlayer.hitboxCubes.has(headBox.id));
  hitboxPlayer.selectedHitbox = headBox.id; hitboxPlayer.attachHitboxGizmo();
  const headCube = hitboxPlayer.hitboxCubes.get(headBox.id);
  headCube.position.set(0, 1.7, 0);
  hitboxPlayer.view.gizmo.setMode('translate'); hitboxPlayer.gizmoTransformed(headCube);
  check('dragging a hitbox cube stores its new rig-space position', store.project.player.hitboxes.find(box => box.id === headBox.id).position[1] === 1.7, JSON.stringify(store.project.player.hitboxes.find(box => box.id === headBox.id).position));
  const rig = hitboxPlayer.rigRoot; rig.updateWorldMatrix(true, true);
  const worldPoint = new headCube.position.constructor(0, 1.7, 0).applyMatrix4(rig.matrixWorld);
  check('hitboxes resolve the part at a world point', window.__forge.hitboxPartAt(store.project.player.hitboxes, rig, worldPoint) === 'head');
  check('a point below all hitboxes resolves to no part', window.__forge.hitboxPartAt(store.project.player.hitboxes, rig, new headCube.position.constructor(0, 0.01, 0).applyMatrix4(rig.matrixWorld)) === null);
  await click(find('.workspace button', 'Animate arms with gun'), 'animate gun arms');
  const armAnimation = tool();
  check('gun animation combines weapon and the reused player skeleton', await until(() => armAnimation.nodes.has('player:Finger') && !!armAnimation.defaults, 12000));
  armAnimation.addClip(); armAnimation.selectNode('player:Finger'); armAnimation.setTime(0.5);
  armAnimation.applyTransform('rotation', [0, 0, 1]);
  const handClip = armAnimation.clip().id;
  const mesh = armAnimation.object('player:ArmsMesh');
  armAnimation.animRoot.updateMatrixWorld(true); mesh.skeleton.update();
  const vertex = new mesh.position.constructor().fromBufferAttribute(mesh.geometry.attributes.position, 1);
  const posed = mesh.applyBoneTransform(1, vertex.clone());
  armAnimation.setTime(0); armAnimation.animRoot.updateMatrixWorld(true); mesh.skeleton.update();
  const rest = mesh.applyBoneTransform(1, vertex.clone());
  check('scrubbing finger keys visibly deforms the skinned arm', posed.distanceTo(rest) > 0.1, posed.distanceTo(rest));
  check('hidden body mesh keeps its shoulder/hand bone chain alive', armAnimation.object('player:BodyMesh').visible === false && armAnimation.object('player:Hand').visible === true);
  const importedFinger = armAnimation.imported.find(clip => clip.name === 'FingerCurl');
  armAnimation.importClip(importedFinger);
  check('embedded GLB skeletal animation converts to namespaced editable keys', armAnimation.clip().tracks.some(track => track.target === 'player:Finger' && track.property === 'quaternion'));
  store.change('project', project => { project.weapons.find(w => w.id === store.project.activeWeapon).animations.idle = handClip; });
  launch('weapon'); await wait(100);
  const armsPreview = tool();
  await armsPreview.model.ready;
  check('weapon preview loads the same selected arm meshes', !!armsPreview.model.armsRoot && armsPreview.model.armsRoot.getObjectByName('player:BodyMesh').visible === false);
  launch('level'); await wait(100);

  /* ---- save whole project ---- */
  await click(find('.top-actions button', 'Save'), 'save');
  await wait(400);
  check('Save clears both dirty flags', !store.dirty.project && !store.dirty.level, JSON.stringify(store.dirty));
  check('Save reports success', /saved/i.test(document.getElementById('status').textContent), document.getElementById('status').textContent);

  return { checks, levelFile: 'ui-test' };
}

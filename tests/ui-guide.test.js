/**
 * The UI guide is fed to agents, so its copy-paste examples must stay valid.
 * Fenced blocks tagged `json ui-document|ui-screen|ui-element|ui-font|ui-template`
 * are reconstructed into a real project and run through validateProject(), and
 * the reference must still document every runtime name the code exposes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, validateProject } from '../src/authoring/Project.js';
import { ANCHORS, ACTIONS, BINDINGS } from '../src/ui/UIRenderer.js';

const GUIDE = 'UI_GUIDE.md';
const FENCE = /```json (ui-[a-z]+)\n([\s\S]*?)```/g;
const TYPES = ['text', 'panel', 'image', 'bar', 'button', 'slider', 'crosshair'];
const RESERVED = ['main', 'pause', 'settings'];

function projectWith(ui) { return validateProject({ ...createProject(), ui }); }
function withScreens(screens) { return { ...createProject().ui, screens }; }
function screenOf(id, elements) { return { id, name: `Doc ${id}`, kind: 'hud', mode: 'all', elements }; }

async function guide() { return readFile(GUIDE, 'utf8'); }
function blocks(source) {
  return [...source.matchAll(FENCE)].map(([, kind, body]) => ({ kind, data: JSON.parse(body) }));
}

test('every marked example in the UI guide passes the shared validator', async () => {
  const seen = new Set();
  for (const { kind, data } of blocks(await guide())) {
    seen.add(kind);
    if (kind === 'ui-document') projectWith(data);
    else if (kind === 'ui-screen') projectWith(withScreens([data]));
    else if (kind === 'ui-element') projectWith(withScreens([screenOf('doc-element', [data])]));
    else if (kind === 'ui-font') projectWith({ ...createProject().ui, fonts: [data] });
    else if (kind === 'ui-template') projectWith({ ...createProject().ui, templates: [data] });
    else assert.fail(`Unknown example kind ${kind}`);
  }
  for (const kind of ['ui-document', 'ui-screen', 'ui-element', 'ui-font', 'ui-template']) {
    assert.ok(seen.has(kind), `UI_GUIDE.md has no ${kind} example to validate`);
  }
});

test('the UI guide documents every anchor, action, binding, type and reserved menu id', async () => {
  const source = await guide();
  for (const name of [...ANCHORS, ...ACTIONS, ...BINDINGS, ...TYPES, ...RESERVED]) {
    assert.ok(source.includes(`\`${name}\``) || source.includes(`"${name}"`) || source.includes(`\`${name}\``),
      `UI_GUIDE.md never mentions "${name}"`);
  }
  // Every code path an agent could be asked to edit is named with its real path.
  for (const path of ['public/authoring/project.json', 'src/ui/UIRenderer.js', 'src/ui/GameUI.js',
    'src/authoring/Project.js', 'toolsuite/src/UITool.js', 'src/assets/images/', 'src/assets/fonts/']) {
    assert.ok(source.includes(path), `UI_GUIDE.md never names ${path}`);
  }
});

test('the worked example keeps the reserved menus and uses only runtime names', async () => {
  const document = blocks(await guide()).find(block => block.kind === 'ui-document').data;
  const menus = document.screens.filter(screen => screen.kind === 'menu').map(screen => screen.id);
  for (const id of RESERVED) assert.ok(menus.includes(id), `Worked example is missing the "${id}" menu`);
  const named = new Set(document.screens.flatMap(screen => screen.elements.flatMap(element => [
    ...(typeof element.text === 'string' ? [...element.text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(match => match[1]) : []),
    ...(element.visibleWhen ? [element.visibleWhen] : []),
  ])));
  for (const binding of named) assert.ok(BINDINGS.includes(binding), `Worked example uses unknown binding "${binding}"`);
  for (const screen of document.screens) {
    for (const element of screen.elements) {
      assert.ok(TYPES.includes(element.type), `Worked example uses unknown element type "${element.type}"`);
      if (element.type === 'button') assert.ok(ACTIONS.includes(element.action), `Unknown button action "${element.action}"`);
      if (element.type === 'slider') assert.ok(['volume', 'sensitivity'].includes(element.binding), `Unknown slider binding "${element.binding}"`);
    }
  }
});
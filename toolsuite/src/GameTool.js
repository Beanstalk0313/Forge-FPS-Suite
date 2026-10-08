/**
 * Game properties: what the built game is called, who published it and how the
 * installer is branded. The left panel previews the artefacts, the centre edits
 * the fields, and the right panel shows the icon and the raw JSON.
 *
 * Nothing here reaches outside the project: the icon must be an asset already
 * inside src/assets/images, and the build copies it next to the generated
 * electron-builder config.
 */
import { node, button, field, heading, jsonPanel, guard, toast } from './dom.js';
import { defaultGameProperties, gameOutput } from '../../src/authoring/Project.js';
import { createSettings } from './SettingsTool.js';

const section = (parent, title) => {
  const box = node('details', 'component');
  box.open = true;
  box.append(node('summary', '', title));
  parent.append(box);
  return box;
};

export class GameTool {
  constructor(host, store) {
    this.store = store;
    host.innerHTML = ''; host.className = 'workspace';
    this.left = node('aside', 'panel'); this.center = node('section', 'panel properties'); this.right = node('aside', 'panel inspector');
    host.append(this.left, this.center, this.right);
    this.changed = event => {
      if (event.detail?.kind === 'project-switch') return;
      this.render();
    };
    store.addEventListener('change', this.changed);
    this.assetsChanged = () => this.renderIcon();
    store.addEventListener('assets', this.assetsChanged);
    this.render();
  }

  get game() { return this.store.project.game || {}; }
  edit(fn) { this.store.change('project', project => { project.game = { ...defaultGameProperties(), ...(project.game || {}) }; fn(project.game); }); }

  render() {
    const game = this.game, output = gameOutput(this.store.project);
    this.left.replaceChildren(); this.center.replaceChildren(); this.right.replaceChildren();

    heading(this.left, 'Output');
    const facts = node('div', 'facts');
    for (const [label, value] of [
      ['Game', output.name], ['Executable', output.executable], ['Installer', output.artifact],
      ['Version', output.version], ['Publisher', output.publisher],
      ['Desktop shortcut', output.desktop ? 'yes' : 'no'], ['Start menu shortcut', output.startMenu ? 'yes' : 'no'],
      ['Install scope', output.installScope], ['Icon', output.icon]
    ]) {
      const row = node('div', 'fact-row');
      row.append(node('span', '', label), node('strong', '', value));
      facts.append(row);
    }
    this.left.append(facts);
    if (output.description) this.left.append(node('p', 'muted', output.description));
    this.left.append(node('p', 'muted', 'The executable, the installer file and the shortcuts are all named after the game name.'));
    this.left.append(button('Reset to defaults', () => guard(() => {
      this.store.change('project', project => { project.game = defaultGameProperties(); });
      toast('Game properties reset.');
    })));

    const defaults = section(this.center, 'GAMEPLAY DEFAULTS');
    const settings = createSettings(this.store.project);
    for (const [key, label] of [['volume', 'Volume (0–1)'], ['sensitivity', 'Mouse sensitivity (0–1)']]) field(defaults, label, settings[key], value => this.store.change('project', project => { project.settings = { ...settings, ...project.settings, [key]: value }; }), { min: 0, max: 1, step: 0.05 });
    const identity = section(this.center, 'IDENTITY');
    field(identity, 'Game name', game.name || '', value => this.edit(properties => { properties.name = value.trim(); }));
    identity.append(node('p', 'muted', 'Empty uses the project name. This becomes the executable, the installer and the shortcut.'));
    field(identity, 'Description', game.description || '', value => this.edit(properties => { properties.description = value; }), { multiline: true });
    field(identity, 'Version', game.version || '', value => this.edit(properties => { properties.version = value.trim(); }));
    identity.append(node('p', 'muted', 'major.minor.patch, or empty to add 1 to the patch number on every build.'));

    const branding = section(this.center, 'BRANDING');
    field(branding, 'Publisher', game.publisher || '', value => this.edit(properties => { properties.publisher = value.trim(); }));
    branding.append(node('p', 'muted', 'Shown as CompanyName in the executable and in the installer.'));
    field(branding, 'Shortcut name', game.shortcutName || '', value => this.edit(properties => { properties.shortcutName = value.trim(); }));
    branding.append(node('p', 'muted', 'Empty uses the game name. Shortcuts can still be turned off below.'));
    field(branding, 'Desktop shortcut', game.createDesktopShortcut !== false, value => this.edit(properties => { properties.createDesktopShortcut = !!value; }));
    field(branding, 'Start menu shortcut', game.createStartMenuShortcut !== false, value => this.edit(properties => { properties.createStartMenuShortcut = !!value; }));
    field(branding, 'Install for all users', game.installForAllUsers === true, value => this.edit(properties => { properties.installForAllUsers = !!value; }));
    branding.append(node('p', 'muted', 'All users needs administrator rights during install; the default installs for the current user.'));

    const iconBox = section(this.center, 'ICON');
    const images = this.store.assets.filter(asset => /\.(png|ico)$/i.test(asset.path) && /images/i.test(asset.path));
    field(iconBox, 'Icon', game.icon || '', value => this.edit(properties => { properties.icon = value; }),
      { options: [['', 'Suite default'], ...images.map(asset => [asset.path, asset.name])] });
    iconBox.append(button('Import icon…', () => this.importIcon()));
    iconBox.append(button('Clear icon', () => guard(() => this.edit(properties => { properties.icon = ''; }))));
    iconBox.append(node('p', 'muted', 'PNG or ICO from src/assets/images. Electron needs at least 256×256 pixels; smaller icons are rejected at build time.'));

    heading(this.right, 'ICON PREVIEW');
    this.iconHost = node('div', 'icon-preview');
    this.right.append(this.iconHost);
    jsonPanel(this.right, 'Game properties JSON', { ...defaultGameProperties(), ...game }, data => {
      this.store.change('project', project => {
        const known = Object.keys(defaultGameProperties());
        for (const key of Object.keys(data)) if (!known.includes(key)) throw new Error(`Unknown property: ${key}`);
        project.game = data;
      });
    });
    this.renderIcon();
  }

  /** Import a PNG/ICO into the project through the desktop bridge. */
  async importIcon() {
    if (!window.forgeDesktop) { toast('Importing icons needs the desktop app.', true); return; }
    const files = await window.forgeDesktop.importAssets();
    for (const path of files || []) if (/\.(png|ico)$/i.test(path)) this.edit(properties => { properties.icon = path; });
    await this.store.refreshAssets();
  }

  renderIcon() {
    if (!this.iconHost) return;
    this.iconHost.replaceChildren();
    const path = this.game.icon;
    if (!path) { this.iconHost.append(node('p', 'muted', 'Suite default icon.')); return; }
    const image = node('img');
    image.alt = 'Icon preview';
    image.src = this.store.resolve(path);
    image.onerror = () => { image.replaceWith(node('p', 'muted', 'Icon file is missing from the project.')); };
    this.iconHost.append(image);
    this.iconHost.append(node('div', 'muted', path));
  }

  dispose() {
    this.store.removeEventListener('change', this.changed);
    this.store.removeEventListener('assets', this.assetsChanged);
  }
}
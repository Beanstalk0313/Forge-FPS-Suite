import { node, button, guard } from './dom.js';
export class HomeTool {
  constructor(host, store) {
    this.store = store; host.className = 'workspace launcher-workspace';
    this.center = node('section', 'project-launcher'); host.append(this.center);
    this.changed = () => this.render(); store.addEventListener('projects', this.changed); store.addEventListener('change', this.changed);
    this.render();
  }
  render() {
    const bridge = window.forgeDesktop;
    this.center.replaceChildren();
    const intro = node('div', 'launcher-header');
    intro.append(node('p', 'eyebrow', 'FORGE FPS SUITE'), node('h1', '', 'Your next world starts here.'), node('p', 'launcher-description', 'Create a project, or pick up where you left off.'));
    const actions = node('div', 'launcher-actions');
    actions.append(button('Open project…', () => window.__forge.chooseProject(), 'primary'), button('New project…', () => window.__forge.newProject()));
    if (!bridge) actions.append(node('p', 'muted', 'Project folders require Forge desktop. Use Window to open a browser authoring workspace.'));
    intro.append(actions); this.center.append(intro);
    const recent = node('section', 'recent-projects');
    recent.append(node('h2', '', 'Recent projects'));
    if (!this.store.projects.length) recent.append(node('div', 'launcher-empty', 'No recent projects yet. Open a project folder or create your first game.'));
    for (const entry of this.store.projects) {
      const row = node('article', 'launcher-project'), info = node('div', 'body');
      info.append(node('h3', '', entry.name), node('p', 'path', entry.root), node('span', entry.valid ? 'badge mint' : 'badge warn', entry.valid ? 'Project' : 'Needs repair'));
      const actions = node('div', 'row-actions');
      actions.append(button(entry.current ? 'Continue' : entry.valid ? 'Open' : 'Repair', () => window.__forge.openProject(entry.root), 'primary'), button('Folder', () => bridge.revealProject(entry.root)), button('Remove', async () => { await this.store.forgetProject(entry.root); await this.store.refreshProjects(); }));
      row.append(node('span', 'project-monogram', entry.name.slice(0, 1).toUpperCase()), info, actions); recent.append(row);
    }
    this.center.append(recent);
    if (this.store.root && !this.store.projects.some(entry => entry.current)) this.center.append(button(`Continue ${this.store.project.name}`, () => guard(() => window.__forge.launch('level'))));
  }
  dispose() { this.store.removeEventListener('projects', this.changed); this.store.removeEventListener('change', this.changed); }
}

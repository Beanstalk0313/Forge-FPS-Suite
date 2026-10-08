import { node, button, guard } from './dom.js';
export async function showEngineDialog(store) {
  if (!window.forgeDesktop || !store.root || store.busy) return;
  if (store.dirty.project || store.dirty.level) throw new Error('Save or discard unsaved work before upgrading or restoring the engine.');
  const bridge = window.forgeDesktop, plan = await bridge.enginePlan(), backups = await bridge.engineBackups();
  if (store.busy || store.dirty.project || store.dirty.level) throw new Error('Project changed while preparing review. Save first, then review again.');
  const dialog = node('dialog', 'engine-dialog'); dialog.setAttribute('aria-label', 'Project engine');
  const header = node('header'); header.append(node('h2', '', 'Project engine'), node('span', 'spacer'), button('Later', () => dialog.close())); dialog.append(header);
  dialog.append(node('p', 'engine-version', `Project: ${plan.current || 'Legacy / unknown'} · Forge engine: ${plan.newest}`));
  dialog.append(node('p', '', plan.newer ? 'This project uses a newer engine than this Forge. Install a newer Forge; downgrading the project engine is blocked.' : plan.needsUpgrade ? 'An engine upgrade is recommended. Keeping the old engine also keeps its bugs and may cause compatibility issues with this Forge editor.' : 'This project is on the current engine. You can review engine files or restore a backup below.'));
  dialog.append(node('p', 'safety-note', 'Your animations, levels, weapons, HUDs, UI and imported artwork are preserved. Only engine updates and required format migrations are applied. Every altered file is backed up in .forge/backup before any changes. Migrations are validated, and failed writes roll back. Restore is available if something breaks.'));
  const details = node('details'); details.append(node('summary', '', `${plan.files.length} files to update or migrate`));
  const list = node('pre', 'file-review', plan.files.join('\n')); details.append(list); dialog.append(details);
  const approved = new Set();
  const upgrade = button('Back up and upgrade engine', async () => {
    if (store.dirty.project || store.dirty.level) throw new Error('Save changes and review the upgrade again.');
    upgrade.disabled = true;
    try {
      const result = await store.operation('Upgrading engine', () => bridge.engineUpgrade(plan.token, [...approved]));
      await store.adoptProject(result.project); dialog.close(); store.log(`Engine upgraded. Backup: .forge/backup/${result.backup}`);
    } finally { upgrade.disabled = plan.conflicts.some(file => !approved.has(file)); }
  }, 'primary');
  if (plan.conflicts.length) {
    dialog.append(node('h3', '', 'Custom or unknown engine files'), node('p', 'muted', 'These files differ from the known engine baseline, or predate version tracking. Review each file and explicitly approve replacement. Authored content is not listed as engine code.'));
    for (const file of plan.conflicts) {
      const label = node('label', 'conflict-row'), input = node('input'); input.type = 'checkbox'; input.setAttribute('aria-label', `Replace ${file}`);
      input.onchange = () => { input.checked ? approved.add(file) : approved.delete(file); upgrade.disabled = plan.conflicts.some(name => !approved.has(name)); };
      label.append(input, node('span', '', file)); dialog.append(label);
    }
    upgrade.disabled = true;
  }
  if (plan.files.length) dialog.append(upgrade);
  dialog.append(node('h3', '', 'Restore a backup'), node('p', 'muted', 'Restore changes only the files covered by that backup, including authored documents migrated by the upgrade. Later edits to those files will be reverted; your current files are backed up before restoring. Other artwork is untouched.'));
  for (const item of backups) {
    const row = node('div', 'backup-row'); row.append(node('span', '', `${new Date(item.created).toLocaleString()} · ${item.reason}`), button('Restore…', async () => {
      if (store.dirty.project || store.dirty.level) throw new Error('Save changes before restoring.');
      if (!confirm('Restore these files? Later edits to files in this backup will be reverted. A safety backup of the current files will be created first.')) return;
      const result = await store.operation('Restoring backup', () => bridge.engineRestore(item.id));
      await store.adoptProject(result.project); dialog.close(); store.log(`Restored ${item.id}; safety backup ${result.backup}.`);
    })); dialog.append(row);
  }
  if (!backups.length) dialog.append(node('p', 'muted', 'No upgrade backups yet.'));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}

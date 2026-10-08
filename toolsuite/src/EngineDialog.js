import { node, button } from './dom.js';

const ACKNOWLEDGMENT = 'I UNDERSTAND';
let preparing = false;

/** Typed consent covers exactly the conflicts in this hash-bound native plan. */
export async function showEngineDialog(store) {
  if (!window.forgeDesktop || !store.root || store.busy || preparing) return;
  const existing = document.querySelector('.engine-dialog');
  if (existing) { existing.focus(); return; }
  if (store.dirty.project || store.dirty.level) throw new Error('Save or discard unsaved work before upgrading or restoring the engine.');
  const bridge = window.forgeDesktop, root = store.root;
  preparing = true;
  let plan, backups;
  try { [plan, backups] = await Promise.all([bridge.enginePlan(), bridge.engineBackups()]); }
  finally { preparing = false; }
  if (store.root !== root || store.busy || store.dirty.project || store.dirty.level) throw new Error('Project changed while preparing review. Save first, then review again.');
  const dialog = node('dialog', 'engine-dialog'); dialog.setAttribute('aria-label', 'Project engine');
  const header = node('header');
  const close = button('Later', () => dialog.close());
  header.append(node('h2', '', 'Project engine'), node('span', 'spacer'), close); dialog.append(header);
  const versions = node('div', 'engine-versions');
  for (const [label, value] of [['Your project', plan.current || 'Legacy / untracked'], ['Available engine', plan.newest]]) {
    const card = node('div', 'engine-version-card'); card.append(node('span', 'muted', label), node('strong', '', value)); versions.append(card);
  }
  dialog.append(versions, node('p', 'engine-status', plan.newer
    ? 'A newer engine is already installed. Update Forge before making engine changes; downgrades are blocked.'
    : plan.needsUpgrade ? 'An upgrade is recommended to bring this project up to date.'
      : plan.files.length ? 'Your version is current, but engine files have changes available.' : 'Your project engine is up to date.'));
  dialog.append(node('p', 'safety-note', 'Your animations, levels, weapons, HUDs, UI and imported artwork are preserved. Changed files and required format migrations are backed up in .forge/backup before writing. Migrations are validated; failed writes roll back. You can restore a backup below.'));
  const fileList = (title, files, className = '') => {
    const details = node('details', `engine-file-group ${className}`); details.append(node('summary', '', `${title} (${files.length})`), node('pre', 'file-review', files.join('\n'))); dialog.append(details);
  };
  if (plan.files.length) fileList('Files to update or migrate', plan.files);
  let acknowledgment = null, working = false;
  const acknowledged = () => !plan.conflicts.length || acknowledgment?.value === ACKNOWLEDGMENT;
  const refresh = () => { upgrade.disabled = working || !acknowledged(); close.disabled = working; for (const control of dialog.querySelectorAll('.backup-row button')) control.disabled = working; };
  const assertCurrent = () => {
    if (store.root !== root || store.dirty.project || store.dirty.level) throw new Error('Project changed. Save and open a fresh engine review.');
  };
  const upgrade = button('Back up and upgrade engine', async () => {
    assertCurrent();
    if (working || store.busy) throw new Error('Wait for the current operation.');
    if (!acknowledged()) throw new Error(`Type ${ACKNOWLEDGMENT} to approve replacing the listed custom or unknown engine files.`);
    working = true; refresh();
    try {
      // Preserve the native per-file approval contract: never pass a wildcard
      // or bypass hash validation. This acknowledgment approves only this list.
      const result = await store.operation('Upgrading engine', () => bridge.engineUpgrade(plan.token, [...plan.conflicts]));
      await store.adoptProject(result.project); dialog.close(); store.log(`Engine upgraded. Backup: .forge/backup/${result.backup}`);
    } finally { working = false; refresh(); }
  }, 'primary');
  if (plan.conflicts.length) {
    const warning = node('div', 'engine-warning');
    warning.append(node('h3', '', `${plan.conflicts.length} custom or untracked engine files`), node('p', '', 'These engine files differ from the known baseline, or predate tracking. Upgrading replaces their local code, including your custom edits. Review the list below. A backup keeps the originals, but you may need to merge your custom code back afterwards.'));
    dialog.append(warning); fileList('Review files requiring replacement approval', plan.conflicts, 'engine-conflicts');
    const label = node('label', 'field'); label.append(node('span', '', 'Type I UNDERSTAND to approve replacing all listed conflicts'));
    acknowledgment = node('input'); acknowledgment.type = 'text'; acknowledgment.autocomplete = 'off'; acknowledgment.spellcheck = false;
    acknowledgment.setAttribute('aria-label', 'Engine replacement acknowledgment'); acknowledgment.placeholder = ACKNOWLEDGMENT;
    acknowledgment.oninput = refresh; label.append(acknowledgment); dialog.append(label);
  }
  if (plan.files.length && !plan.newer) {
    const actions = node('div', 'engine-upgrade-actions'); actions.append(upgrade, node('span', 'muted', 'Backup first · validate · apply')); dialog.append(actions);
  }
  dialog.append(node('h3', '', 'Restore a backup'), node('p', 'muted', 'Restore reverts later edits only to files covered by that backup, including migrated authored documents. Current files get a safety backup first; other artwork is untouched.'));
  for (const item of backups) {
    const row = node('div', 'backup-row'); row.append(node('span', '', `${new Date(item.created).toLocaleString()} · ${item.reason}`), button('Restore…', async () => {
      assertCurrent();
      if (working || store.busy) throw new Error('Wait for the current operation.');
      if (!confirm('Restore these files? Later edits to files in this backup will be reverted. A safety backup of the current files will be created first.')) return;
      working = true; refresh();
      try {
        const result = await store.operation('Restoring backup', () => bridge.engineRestore(item.id));
        await store.adoptProject(result.project); dialog.close(); store.log(`Restored ${item.id}; safety backup ${result.backup}.`);
      } finally { working = false; refresh(); }
    })); dialog.append(row);
  }
  if (!backups.length) dialog.append(node('p', 'muted', 'No backups yet. Your first upgrade will create one automatically.'));
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal(); refresh();
}

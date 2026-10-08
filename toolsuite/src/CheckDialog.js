/**
 * Project check: one report of every reference the editor can verify before
 * Play or Build — missing project assets, clips, sounds and unfinished scene
 * setup. The rules live in `authoringTools.auditProject`; this module only
 * presents the result and can hand a problem back to the workspace that owns
 * it. Nothing is repaired here: the author decides.
 */
import { node, button } from './dom.js';
import { auditProject, issueCounts, ISSUE_SEVERITIES } from './authoringTools.js';

const SEVERITY_LABEL = { error: 'Errors', warning: 'Warnings', info: 'Notes' };

/** Assets and scene names the current project actually has, for one check pass. */
export function checkContext(store) {
  return { assets: store.assets || [], levels: [...new Set([store.levelFile, ...(store.levels || [])].filter(Boolean))] };
}

export function projectIssues(store) {
  return auditProject(store.project, store.level, checkContext(store));
}

/**
 * @param options.navigate jump to the workspace owning a problem
 * @param options.playAnyway present when Play was the reason for the report
 */
export function showProjectCheck(store, { navigate, playAnyway } = {}) {
  const existing = document.querySelector('.check-dialog');
  if (existing) { existing.focus(); return existing; }

  const dialog = node('dialog', 'check-dialog');
  dialog.setAttribute('aria-label', 'Project check');
  const header = node('header');
  header.append(node('h2', '', 'Project check'), node('span', 'spacer'), button('Close', () => dialog.close()));
  dialog.append(header, node('p', 'muted', 'Checks that weapons, the player rig, animations, the HUD and this scene only reference assets and IDs the project really has. Nothing is changed.'));

  const body = node('section', 'check-body');
  dialog.append(body);

  const play = button('Play anyway', () => { dialog.close(); playAnyway(); }, 'primary');
  play.hidden = true;

  const render = () => {
    const issues = projectIssues(store);
    const counts = issueCounts(issues);
    const total = counts.error + counts.warning + counts.info;
    body.replaceChildren();
    const summary = node('div', 'check-summary');
    summary.append(
      node('span', counts.error ? 'badge warn' : total ? 'badge' : 'badge mint', counts.error ? `${counts.error} error${counts.error === 1 ? '' : 's'}` : total ? 'No errors' : 'Passed'),
      node('span', 'check-counts', `${counts.warning} warning${counts.warning === 1 ? '' : 's'} · ${counts.info} note${counts.info === 1 ? '' : 's'}`)
    );
    body.append(summary);
    play.hidden = !(counts.error && playAnyway);

    if (!total) {
      body.append(node('div', 'check-clear', 'No broken references found. Play and Build can use this project as it stands.'));
      return;
    }
    for (const severity of ISSUE_SEVERITIES) {
      const group = issues.filter(issue => issue.severity === severity);
      if (!group.length) continue;
      body.append(node('h3', '', `${SEVERITY_LABEL[severity]} (${group.length})`));
      for (const issue of group) {
        const row = node('div', `issue-row ${severity}`);
        row.append(node('span', 'issue-message', issue.message), node('span', 'badge', issue.area));
        if (issue.target && navigate) row.append(button('Show', () => { dialog.close(); navigate(issue.target); }));
        body.append(row);
      }
    }
  };

  render();
  dialog.append(node('p', 'muted', 'Editor-only review: the runtime still resolves assets and validates documents on its own.'));
  const footer = node('div', 'check-actions');
  footer.append(play, button('Check again', render), node('span', 'muted', 'Check after renaming a model, sound or clip.'));
  dialog.append(footer);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

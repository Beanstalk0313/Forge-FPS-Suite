/** Checks never download/install. Restart is explicit and guarded by the shell. */
function createUpdater({ updater, enabled, send }) {
  let state = { phase: enabled ? 'idle' : 'unavailable', message: enabled ? 'Updates are checked through GitHub Releases.' : 'Updates require an installed Forge build.', version: '', percent: 0 };
  const emit = patch => { state = { ...state, ...patch }; send({ ...state }); };
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowPrerelease = false; updater.allowDowngrade = false;
  updater.on('checking-for-update', () => emit({ phase: 'checking', message: 'Checking for updates…' }));
  updater.on('update-available', info => emit({ phase: 'available', version: info.version, message: `Forge ${info.version} is available.` }));
  updater.on('update-not-available', () => emit({ phase: 'idle', message: 'Forge is up to date.' }));
  updater.on('download-progress', info => emit({ phase: 'downloading', percent: info.percent, message: `Downloading update: ${Math.round(info.percent)}%` }));
  updater.on('update-downloaded', info => emit({ phase: 'downloaded', version: info.version, message: 'Update downloaded. Save work before restarting.' }));
  updater.on('error', error => emit({ phase: 'error', message: `Update failed: ${error.message}` }));
  async function check() {
    if (!enabled) return { ...state };
    if (['checking', 'downloading', 'downloaded'].includes(state.phase)) return { ...state };
    emit({ phase: 'checking', message: 'Checking for updates…' });
    try { await updater.checkForUpdates(); } catch (error) { emit({ phase: 'error', message: error.message }); }
    return { ...state };
  }
  async function download() {
    if (!enabled || state.phase !== 'available') throw new Error('Check for an available update first.');
    emit({ phase: 'downloading', message: 'Downloading update…', percent: 0 });
    try { await updater.downloadUpdate(); } catch (error) { emit({ phase: 'error', message: error.message }); throw error; }
    return { ...state };
  }
  function install() {
    if (!enabled || state.phase !== 'downloaded') throw new Error('No downloaded update is ready.');
    updater.quitAndInstall(false, true);
  }
  return { check, download, install, state: () => ({ ...state }) };
}
module.exports = { createUpdater };

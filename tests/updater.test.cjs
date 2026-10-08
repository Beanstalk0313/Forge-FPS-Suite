const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../toolsuite/desktop/updater.cjs');
const preferences = require('../toolsuite/desktop/preferences.cjs');
function fixture(enabled = true) {
  const updater = new EventEmitter(); let downloads = 0, installs = 0;
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.0.1' }); };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 42 }); updater.emit('update-downloaded', { version: '1.0.1' }); };
  updater.quitAndInstall = () => installs++;
  const states = [], api = createUpdater({ updater, enabled, send: state => states.push(state) });
  return { updater, api, states, downloads: () => downloads, installs: () => installs };
}
test('update checks never download, downloaded updates never install on quit', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  await assert.rejects(f.api.download(), /Check/);
  assert.throws(() => f.api.install(), /No downloaded/);
  await f.api.check(); assert.equal(f.downloads(), 0); assert.equal(f.api.state().phase, 'available');
  await f.api.download(); assert.equal(f.downloads(), 1); assert.equal(f.installs(), 0); assert.equal(f.api.state().phase, 'downloaded');
  f.api.install(); assert.equal(f.installs(), 1);
});
test('source-mode updater does not contact releases and check errors remain visible', async () => {
  const source = fixture(false); await source.api.check(); assert.equal(source.states.length, 0);
  await assert.rejects(source.api.download()); assert.throws(() => source.api.install());
  const f = fixture(); f.updater.checkForUpdates = async () => { throw new Error('network unavailable'); };
  await f.api.check(); assert.equal(f.api.state().phase, 'error'); assert.match(f.api.state().message, /network unavailable/);
});
test('editor preferences use safe recovery defaults and validate autosave intervals', () => {
  assert.equal(preferences.validate({}).autosave, 'recovery');
  assert.equal(preferences.validate({}).autoUpdate, true);
  for (const patch of [{ autosaveMinutes: 0 }, { autosaveMinutes: 1.5 }, { autosave: 'anything' }, { theme: 'constructor' }, { autoUpdate: 'true' }]) assert.throws(() => preferences.validate(patch));
  assert.equal(preferences.validate({ autosave: 'disk', autosaveMinutes: 5 }).autosave, 'disk');
});

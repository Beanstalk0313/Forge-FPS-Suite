/** Timed saving never interrupts dialogs, recovery review or an active operation. */
export class Autosave {
  constructor(store) { this.store = store; }
  async run(settings) {
    const store = this.store;
    if (settings.autosave === 'off' || store.busy || store.recovery || !(store.dirty.project || store.dirty.level)) return false;
    if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return false;
    store.persist();
    if (settings.autosave === 'disk' && store.root) await store.operation('Autosaving', () => store.saveAll());
    return true;
  }
}

/** Install before Howl construction so cached loads cannot race listeners. */
export function audioReady(source) {
  let resolve, reject;
  const ready = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { ready, onload: () => resolve(), onloaderror: (_id, reason) => reject(new Error(`Audio failed to load: ${source}: ${reason}`)) };
}

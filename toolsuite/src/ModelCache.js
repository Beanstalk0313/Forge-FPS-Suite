/**
 * Shared GLB buffer cache (item 4).
 *
 * Every tool (Weapons, Player, Animation, Level) used to re-fetch and re-parse
 * the same multi-megabyte GLB every time it mounted, so switching tabs meant
 * re-waiting for a model that had already been loaded twice in this session.
 *
 * This cache keeps the *bytes* and the parsed glTF result per resolved URL.
 * Consumers still get their own Object3D.clone() so material/skeleton state
 * never leaks between previews; clone of a parsed scene is cheap (shares
 * geometry buffers and textures on the GPU).
 */
let cache = new Map(); // url -> Promise<{ gltf, buffer }>
let generation = 0;

export function clearModelCache(reason = '') {
  if (cache.size) cache = new Map();
  generation++;
  if (reason) console.debug(`[forge] model cache cleared: ${reason}`);
}

export function modelCacheStats() {
  return { entries: cache.size, generation };
}

/** Parse-once-per-URL; concurrent callers share one in-flight promise. */
export function cachedGLTF(url, load, onCacheInfo = () => {}) {
  const existing = cache.get(url);
  if (existing) { onCacheInfo('cache'); return existing; }
  onCacheInfo('fetch');
  const entry = load().then(gltf => ({ gltf }));
  // Failures must not poison the slot: drop so a retry re-fetches.
  entry.catch(() => { if (cache.get(url) === entry) cache.delete(url); });
  cache.set(url, entry);
  return entry;
}

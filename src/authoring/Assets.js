/** Authored paths stay stable in JSON; Vite owns hashing in packaged game builds. */
const assets = import.meta.glob('/src/assets/**/*', { query: '?url', import: 'default', eager: true });
export function resolveAsset(path = '') {
  if (!path) return '';
  const key = '/' + path.replace(/^\//, '');
  if (key.startsWith('/src/assets/')) {
    if (!assets[key]) throw new Error(`Asset not bundled: ${path}. Import it into src/assets and rebuild.`);
    return assets[key];
  }
  // Existing levels may reference public-relative models.
  return path;
}
export function resolveLevelAssets(level) {
  const data = structuredClone(level);
  for (const spec of [...(data.geometry || []), ...(data.props || [])]) if (spec.gltfUrl) spec.gltfUrl = resolveAsset(spec.gltfUrl);
  for (const spec of data.sounds || []) if (spec.url) spec.url = resolveAsset(spec.url);
  return data;
}

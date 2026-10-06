/** Asset barrier for the authored UI, including screens not currently mounted. */
export function uiAssetSources(ui, resolve = path => path) {
  const images = new Set(), resources = new Set();
  const css = [ui.css || ''];
  if (/@import\b/i.test(ui.css || '')) throw new Error('UI CSS @import is not supported; bundle styles in the project.');
  for (const screen of ui.screens) for (const el of screen.elements) {
    if (el.type === 'image' && el.src) images.add(resolve(el.src));
    css.push(el.background || '');
  }
  for (const text of css) {
    const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi;
    for (const match of text.matchAll(pattern)) {
      const path = match[1] ?? match[2] ?? match[3];
      if (!path || path.startsWith('#')) continue;
      const url = resolve(path);
      if (/\.(woff2?|ttf|otf)(?:[?#]|$)/i.test(path) || /^data:(font|application\/font)/i.test(path)) resources.add(url);
      else images.add(url);
    }
  }
  return { images: [...images], resources: [...resources], fonts: (ui.fonts || []).map(font => ({ name: font.name, source: resolve(font.source) })) };
}

export async function preloadUI(ui, resolve, {
  image = async url => {
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch { throw new Error(`UI image failed to load: ${url}`); }
  },
  resource = async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`UI resource failed to load (${response.status}): ${url}`);
    await response.arrayBuffer();
  },
  font = async spec => {
    const face = new FontFace(spec.name, `url(${JSON.stringify(spec.source)})`);
    try { await face.load(); } catch { throw new Error(`UI font failed to load: ${spec.name}`); }
    document.fonts.add(face);
    return face;
  }
} = {}) {
  const sources = uiAssetSources(ui, resolve);
  return Promise.all([
    ...sources.images.map(image), ...sources.resources.map(resource), ...sources.fonts.map(font)
  ]);
}

/** Editor-only operations: plain authored data in, no DOM/GPU or runtime schema changes. */
export const WEAPON_PRESETS = {
  rifle: { name: 'Rifle', magazineSize: 30, reserveAmmo: 180, damage: 34, fireRate: 0.075, range: 250, reloadTime: 2.1 },
  pistol: { name: 'Pistol', magazineSize: 12, reserveAmmo: 72, damage: 28, fireRate: 0.22, range: 90, reloadTime: 1.3 },
  smg: { name: 'SMG', magazineSize: 32, reserveAmmo: 192, damage: 22, fireRate: 0.06, range: 120, reloadTime: 1.8 },
  marksman: { name: 'Marksman rifle', magazineSize: 10, reserveAmmo: 60, damage: 80, fireRate: 0.6, range: 500, reloadTime: 2.6 }
};
export function weaponStats(weapon) {
  return { rpm: 60 / weapon.fireRate, dps: weapon.damage / weapon.fireRate,
    magazineDamage: weapon.magazineSize * weapon.damage,
    emptyTime: Math.max(0, weapon.magazineSize - 1) * weapon.fireRate,
    sustainedDps: weapon.magazineSize * weapon.damage / (weapon.magazineSize * weapon.fireRate + weapon.reloadTime) };
}
/** Scale time without millisecond rounding: rounding can merge neighboring keys. */
export function retimeClip(clip, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('Duration must be greater than 0 and at most 3600 seconds.');
  const factor = duration / clip.duration;
  for (const track of clip.tracks) for (const key of track.keys) key.time = Math.min(duration, key.time * factor);
  clip.duration = duration;
}
export function adjacentKeyTime(clip, time, direction) {
  const times = [...new Set(clip.tracks.flatMap(track => track.keys.map(key => key.time)))].sort((a, b) => a - b);
  return direction < 0 ? times.filter(value => value < time - 1e-6).at(-1) ?? 0 : times.find(value => value > time + 1e-6) ?? clip.duration;
}
/** Convert absolute design-space top-left back to the existing anchor offsets. */
export function placeElement(element, ui, left, top) {
  const anchor = element.anchor || 'top-left';
  element.x = anchor.endsWith('right') ? ui.width - left - element.width
    : anchor === 'center' || anchor.endsWith('center') ? left + element.width / 2 - ui.width / 2 : left;
  element.y = anchor.startsWith('bottom') ? ui.height - top - element.height
    : anchor.startsWith('center') ? top + element.height / 2 - ui.height / 2 : top;
}
export function alignElement(element, ui, alignment) {
  const anchor = element.anchor || 'top-left';
  const left = anchor.endsWith('right') ? ui.width - element.x - element.width
    : anchor === 'center' || anchor.endsWith('center') ? ui.width / 2 + element.x - element.width / 2 : element.x;
  const top = anchor.startsWith('bottom') ? ui.height - element.y - element.height
    : anchor.startsWith('center') ? ui.height / 2 + element.y - element.height / 2 : element.y;
  const horizontal = { left: 0, 'center-x': (ui.width - element.width) / 2, right: ui.width - element.width };
  const vertical = { top: 0, 'center-y': (ui.height - element.height) / 2, bottom: ui.height - element.height };
  if (!(alignment in horizontal) && !(alignment in vertical) && alignment !== 'fit') throw new Error('Unknown alignment.');
  if (alignment === 'fit') {
    element.width = Math.min(element.width, ui.width); element.height = Math.min(element.height, ui.height);
    placeElement(element, ui, Math.min(Math.max(left, 0), ui.width - element.width), Math.min(Math.max(top, 0), ui.height - element.height));
  } else placeElement(element, ui, horizontal[alignment] ?? left, vertical[alignment] ?? top);
}
export const PREVIEW_STATES = {
  normal: { health: 78, ammo: 24, reserve: 180, ads: false, reloading: false, downed: false, hitmarker: false, message: '' },
  'low-health': { health: 15, ammo: 2, reserve: 12, ads: false, reloading: false, downed: false, hitmarker: false, message: 'Low health' },
  reloading: { health: 65, ammo: 0, reserve: 120, ads: false, reloading: true, downed: false, hitmarker: false, message: 'Reloading' },
  downed: { health: 0, ammo: 0, reserve: 0, ads: false, reloading: false, downed: true, hitmarker: false, message: 'Respawning…' },
  aiming: { health: 100, ammo: 20, reserve: 80, ads: true, reloading: false, downed: false, hitmarker: false, message: '' }
};

/**
 * Project check: the editor's pre-Play review of references it can actually
 * verify from authored data. The runtime resolves `src/assets/...` through
 * Vite's asset map and fails loudly for anything missing, so a broken weapon
 * model, sound, UI image or font otherwise only surfaces as a Play boot error.
 * Everything here is pure data in, a report out: no DOM, no GPU, no schema
 * change, and the same rules the runtime and the UI barrier already enforce.
 *
 * Severity is deliberately narrow: `error` means Play or Build will break or
 * silently drop the reference, `warning` means the authored setup looks
 * unfinished, `info` is unused content.
 */
export const ISSUE_SEVERITIES = ['error', 'warning', 'info'];
const ISSUE_RANK = { error: 0, warning: 1, info: 2 };
const ASSET_PREFIX = 'src/assets/';

/** Only project assets are checkable: URLs, data blobs and public files are not authored here. */
const isProjectAsset = value => typeof value === 'string' && value.startsWith(ASSET_PREFIX) && !value.includes('..');

/** Count per severity, for summaries and the footer indicator. */
export function issueCounts(issues = []) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) if (issue.severity in counts) counts[issue.severity]++;
  return counts;
}

/**
 * @param project validated project data
 * @param level the scene that Play and Build will load
 * @param context `assets` (project asset list, `{path}` or plain paths) and
 *   `levels` (scene filenames the project owns, current scene included)
 */
export function auditProject(project = {}, level = null, { assets = [], levels = [] } = {}) {
  const knownAssets = new Set(assets.map(asset => (typeof asset === 'string' ? asset : asset?.path)).filter(Boolean));
  const sceneNames = new Set(levels.filter(Boolean));
  const issues = [];
  const add = (severity, area, message, target = null) => issues.push({ severity, area, message, target });
  const checkAsset = (value, area, label, target = null) => {
    if (isProjectAsset(value) && !knownAssets.has(value)) add('error', area, `${label} is not in the project: ${value}`, target);
  };
  const clips = project.clips || [];
  const findClip = id => clips.find(clip => clip.id === id);

  const weapons = project.weapons || [];
  const weaponTarget = weapon => ({ kind: 'weapon', id: weapon.id });
  const seenWeaponNames = new Set();
  for (const weapon of weapons) {
    const target = weaponTarget(weapon);
    checkAsset(weapon.modelUrl, 'Weapon', `${weapon.name} model`, target);
    checkAsset(weapon.gunshot, 'Weapon', `${weapon.name} gunshot sound`, target);
    if (!weapon.modelUrl) add('warning', 'Weapon', `${weapon.name} has no model; Play shows an empty viewmodel`, target);
    for (const [slot, id] of Object.entries(weapon.animations || {})) {
      if (!id) continue;
      const clip = findClip(id);
      if (!clip) add('error', 'Weapon', `${weapon.name} ${slot} animation clip is missing: ${id}`, target);
      else if (clip.kind === 'player') add('error', 'Weapon', `${weapon.name} ${slot} animation is a player clip; weapon clips are separate`, target);
    }
    if (seenWeaponNames.has(weapon.name)) add('warning', 'Weapon', `Two weapons share the name ${weapon.name}; Build and Play use the ID`, target);
    seenWeaponNames.add(weapon.name);
  }

  const player = project.player;
  if (player) {
    const target = { kind: 'player', id: 'player' };
    checkAsset(player.modelUrl, 'Player', 'Player model', target);
    if (player.firstPerson?.enabled && !(player.firstPerson.meshes || []).length) {
      add('warning', 'Player', 'First-person arms are on but no arm meshes are selected', target);
    }
    for (const [slot, id] of Object.entries(player.animations || {})) {
      if (!id) continue;
      const clip = findClip(id);
      if (!clip) add('error', 'Player', `${slot} body clip is missing: ${id}`, target);
      else if (clip.kind && clip.kind !== 'player') add('error', 'Player', `${slot} references a weapon clip; player clips are separate`, target);
    }
  }

  const usedClips = new Set();
  for (const weapon of weapons) for (const id of Object.values(weapon.animations || {})) if (id) usedClips.add(id);
  for (const id of Object.values(player?.animations || {})) if (id) usedClips.add(id);
  for (const clip of clips) {
    const target = { kind: 'animation', id: clip.id };
    const keys = (clip.tracks || []).reduce((total, track) => total + (track.keys?.length || 0), 0);
    if (!keys) add('warning', 'Animation', `Clip ${clip.name} has no keyframes; it animates nothing`, target);
    if (!usedClips.has(clip.id)) add('info', 'Animation', `Clip ${clip.name} is not used by any weapon or the player rig`, target);
  }

  const ui = project.ui || {};
  const screens = ui.screens || [];
  for (const screen of screens) {
    for (const el of screen.elements || []) {
      const target = { kind: 'ui', id: screen.id };
      if (el.type === 'image') {
        if (!el.src) add('warning', 'UI', `${screen.name}: image ${el.name || el.id} has no image selected`, target);
        else checkAsset(el.src, 'UI', `${screen.name}: image ${el.name || el.id}`, target);
      }
    }
  }
  for (const font of ui.fonts || []) checkAsset(font.source, 'UI', `UI font ${font.name}`, { kind: 'ui', id: screens[0]?.id });

  for (const prefab of project.prefabs || []) {
    checkAsset(prefab.spec?.gltfUrl, 'Project', `Prefab ${prefab.name} model`);
    checkAsset(prefab.spec?.url, 'Project', `Prefab ${prefab.name} sound`);
  }
  checkAsset(project.game?.icon, 'Game', 'Installer icon', { kind: 'game', id: 'game' });

  if (project.entryLevel && sceneNames.size && !sceneNames.has(project.entryLevel)) {
    add('error', 'Scene', `Entry scene ${project.entryLevel} is not in the project; Build would ship without it`, { kind: 'level', id: null });
  }

  if (level) {
    const target = { kind: 'level', id: null };
    const soundIds = new Set((level.sounds || []).map(sound => sound.id));
    for (const sound of level.sounds || []) checkAsset(sound.url, 'Scene', `Sound ${sound.name || sound.id}`, target);
    for (const spec of [...(level.geometry || []), ...(level.props || [])]) checkAsset(spec.gltfUrl, 'Scene', `${spec.name || spec.id} model`, target);
    for (const trigger of level.triggers || []) {
      const played = [trigger.soundId, ...(trigger.actions || []).filter(action => action.type === 'sound').map(action => action.soundId)];
      for (const id of played) if (id && !soundIds.has(id)) add('error', 'Scene', `Trigger ${trigger.name || trigger.id} plays a sound that is not in this scene: ${id}`, target);
    }
    if (!(level.lights || []).length) add('warning', 'Scene', 'This scene has no lights; it renders black', target);
    if (!(level.geometry || []).length && !(level.props || []).length) add('warning', 'Scene', 'This scene has no geometry or props', target);
    if (level.mode === 'domination' && !(level.objectives || []).length) add('warning', 'Scene', 'Domination mode needs at least one objective', target);
    if (level.mode === 'tdm') {
      if (!(level.spawns || []).length) add('warning', 'Scene', 'Team deathmatch has no team spawns; every fighter starts at the player spawn', target);
      const teams = new Set(level.match?.teams || []);
      for (const bot of level.bots || []) if (teams.size && !teams.has(bot.team)) add('warning', 'Scene', `Bot ${bot.name} is on team ${bot.team}, which is not in this match`, target);
    }
  }

  // Stable per severity, insertion order inside a severity: the report reads
  // the same way every time the same project is checked.
  return issues.sort((a, b) => ISSUE_RANK[a.severity] - ISSUE_RANK[b.severity]).slice(0, 200);
}

/**
 * Quick-open ranking for the editor palette: prefix beats any other substring,
 * which beats letters found in order. Ties keep the caller's order, so command
 * groups stay stable, and a query that matches nothing returns nothing.
 */
export function rankCommands(entries = [], query = '', limit = 12) {
  const max = Math.max(1, Math.min(50, Math.floor(limit) || 12));
  const text = String(query ?? '').trim().toLowerCase();
  if (!text) return entries.slice(0, max);
  const scored = [];
  entries.forEach((entry, index) => {
    // A label match always outranks a category match: typing "scene" should
    // offer the Scene workspace before everything merely filed under Scene.
    const label = matchScore(String(entry?.label ?? '').toLowerCase(), text);
    const hint = label === null ? matchScore(String(entry?.hint ?? '').toLowerCase(), text) : null;
    const score = label !== null ? label + 1000 : hint;
    if (score !== null && score !== undefined) scored.push({ entry, index, score });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, max).map(item => item.entry);
}
function matchScore(label, query) {
  if (!label) return null;
  const direct = label.indexOf(query);
  if (direct === 0) return 1000 - Math.min(label.length, 900);
  if (direct > 0) return 700 - Math.min(direct, 600);
  let at = 0, gaps = 0, first = -1, previous = -1;
  for (const character of query) {
    const found = label.indexOf(character, at);
    if (found < 0) return null;
    if (first < 0) first = found;
    if (previous >= 0) gaps += found - previous - 1;
    previous = found; at = found + 1;
  }
  return 400 - Math.min(gaps, 300) - Math.min(first, 80);
}

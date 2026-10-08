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

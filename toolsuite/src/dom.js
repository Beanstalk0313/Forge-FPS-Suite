/** Shared small UI primitives; user-authored strings are always text, never HTML. */
export function node(tag, className = '', text = '') { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; }
export function button(text, action, className = '') {
  const el = node('button', className, text); el.type = 'button';
  el.onclick = () => guard(action); return el;
}
export async function guard(fn) { try { return await fn(); } catch (error) { toast(error.message, true); window.dispatchEvent(new CustomEvent('forge:error', { detail: error.message })); } }
export function toast(text, error = false) {
  const el = document.getElementById('status'); if (!el) return;
  el.textContent = text; el.classList.toggle('error', error);
}
export function heading(parent, text) { parent.append(node('h3', '', text)); }
export function field(parent, label, value, changed, { type, options, min, max, step = 'any', multiline = false } = {}) {
  const wrap = node('label', 'field'); wrap.append(node('span', '', label));
  const input = node(options ? 'select' : multiline ? 'textarea' : 'input');
  if (options) for (const option of options) { const [val, text] = Array.isArray(option) ? option : [option, option]; const el = node('option', '', text); el.value = val; input.append(el); }
  else if (!multiline) input.type = type || (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'checkbox' : 'text');
  input.setAttribute('aria-label', label);
  if (input.type === 'checkbox') input.checked = value; else input.value = value ?? '';
  if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (input.type === 'number') input.step = step;
  input.onchange = () => guard(() => {
    const next = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (input.type === 'number' && (!input.validity.valid || !Number.isFinite(next))) throw new Error(`${label}: invalid number.`);
    return changed(next);
  });
  wrap.append(input); parent.append(wrap); return input;
}
export function vector(parent, label, value, changed, length = 3) {
  const row = node('div', 'vector'); row.append(node('span', '', label));
  const values = [...value];
  for (let i = 0; i < length; i++) field(row, ['X', 'Y', 'Z', 'W'][i], values[i], n => { values[i] = n; changed([...values]); });
  parent.append(row);
}
export function jsonPanel(parent, title, value, apply) {
  const details = node('details', 'json-panel'); details.append(node('summary', '', title));
  const text = node('textarea', 'code'); text.value = JSON.stringify(value, null, 2); text.spellcheck = false; text.setAttribute('aria-label', title);
  details.append(text, button('Validate & apply JSON', () => apply(JSON.parse(text.value)))); parent.append(details);
}
/**
 * Right-click menus keep list rows to one verb: the row selects, the menu
 * acts. One menu is open at a time; a click anywhere else or Escape closes it.
 */
let openMenu = null;
export function closeContextMenu() { openMenu?.(); openMenu = null; }
export function contextMenu(items, x, y) {
  closeContextMenu();
  const menu = node('div', 'context-menu');
  for (const item of items.filter(Boolean)) menu.append(button(item.label, () => { done(); return item.action(); }, item.danger ? 'danger' : ''));
  document.body.append(menu);
  const place = () => {
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 8))}px`;
  };
  place();
  const done = () => { clearTimeout(timer); menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); if (openMenu === done) openMenu = null; };
  const outside = e => { if (!menu.contains(e.target)) done(); };
  const escape = e => { if (e.key === 'Escape') done(); };
  openMenu = done;
  // Deferred so the opening right-click does not immediately close the menu.
  const timer = setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true); }, 0);
  return done;
}
export function onContextMenu(element, items) {
  element.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); contextMenu(typeof items === 'function' ? items() : items, e.clientX, e.clientY); });
  return element;
}
export async function openJSON() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.oncancel = () => resolve(null);
    input.onchange = async () => { try { resolve(JSON.parse(await input.files[0].text())); } catch (e) { reject(e); } };
    input.click();
  });
}

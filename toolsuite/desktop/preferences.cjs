const fs = require('node:fs/promises');
const path = require('node:path');
const DEFAULTS = Object.freeze({ theme: 'midnight', autosave: 'recovery', autosaveMinutes: 2, autoUpdate: true });
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid editor settings.');
  const next = { ...DEFAULTS, ...value };
  if (!['midnight', 'moss', 'ember'].includes(next.theme) || !['recovery', 'disk', 'off'].includes(next.autosave) || !Number.isInteger(next.autosaveMinutes) || next.autosaveMinutes < 1 || next.autosaveMinutes > 60 || typeof next.autoUpdate !== 'boolean') throw new Error('Invalid editor preference value.');
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, next[key]]));
}
async function read(file) {
  try { return validate(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return { ...DEFAULTS }; throw error; }
}
async function write(file, value) {
  const settings = validate(value); await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`; await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + '\n'); await fs.rename(tmp, file);
  return settings;
}
module.exports = { DEFAULTS, validate, read, write };

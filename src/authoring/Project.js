/**
 * Versioned authoring contract shared by the desktop suite and game.
 * Files are plain JSON; no generated code or executable scripts are accepted.
 * Positions are meters, rotations radians (YXZ), keyframe times seconds.
 */
import { validateSky, validateRender, DEFAULT_SKY } from './Presentation.js';
import { validateHitboxes, validateDamageMultipliers } from './Hitboxes.js';

export const VERSION = 1;
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const uid = (prefix = 'item') => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const DEFAULT_WEAPON = {
  id: 'm4', name: 'M4', modelUrl: 'src/assets/models/weapons/M4.glb',
  magazineSize: 30, reserveAmmo: 180, damage: 34, fireRate: 0.075,
  range: 120, reloadTime: 2, recoilKick: 0.042, recoilYaw: 0.011,
  spreadBase: 0.0015, spreadMax: 0.028, bloomGrow: 0.0027, bloomDecay: 0.025,
  airSpread: 0.045, adsSpreadMultiplier: 0.35, adsFov: 55, adsSpeed: 12,
  hipPosition: [0.26, -0.24, -0.62], adsPosition: [0, -0.12, -0.46],
  hipRotation: [0, 0, 0], adsRotation: [0, 0, 0], muzzle: [0, 0, -0.45],
  gunshot: 'src/assets/sound/m4.mp3', animations: {},
  damageMultipliers: { head: 2, torso: 1, arms: 0.75, legs: 0.75 }
};
/**
 * Export properties: what the built game calls itself and how the installer is
 * branded. Kept separate from `name` (the project identity in the editor) so a
 * project can be called "Arena" and ship as "Arena Deathmatch".
 */
export function defaultGameProperties() {
  return {
    name: '',            // empty = use the project name
    description: '',
    publisher: '',       // written as the app author -> CompanyName in the .exe
    version: '',         // empty = auto-increment the patch number on each build
    icon: '',            // bundled PNG or ICO under src/assets/images
    shortcutName: '',    // empty = the game name
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    installForAllUsers: false // per-machine install instead of per-user
  };
}

/** Windows-illegal characters in a name that becomes a file and a shortcut. */
const ILLEGAL_NAME = /[<>:"/\\|?*\x00-\x1f]/;

export function validateGameProperties(game = null) {
  if (game === null || game === undefined) return game;
  insist(game && typeof game === 'object' && !Array.isArray(game), 'Game properties must be an object.');
  const text = (value, label, max) => {
    if (value === undefined || value === null) return;
    insist(typeof value === 'string' && value.length <= max, `${label} must be text up to ${max} characters.`);
  };
  text(game.description, 'Description', 512);
  text(game.publisher, 'Publisher', 64);
  text(game.shortcutName, 'Shortcut name', 40);
  if (game.name) {
    insist(game.name.length <= 60, 'Game name must be 60 characters or fewer.');
    insist(!ILLEGAL_NAME.test(game.name), 'Game name cannot contain < > : " / \\ | ? * or control characters.');
    insist(!/[. ]$/.test(game.name) && game.name !== '..', 'Game name cannot end with a space or period.');
    insist(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(game.name), 'Game name cannot be a reserved Windows name.');
  }
  if (game.shortcutName) {
    insist(!ILLEGAL_NAME.test(game.shortcutName), 'Shortcut name cannot contain < > : " / \\ | ? * or control characters.');
  }
  if (game.version) insist(/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(game.version), 'Version must be major.minor.patch, for example 1.0.0.');
  if (game.icon) {
    insist(game.icon.length <= 200 && !/^([a-z]+:)?\/\//i.test(game.icon), 'Icon must be a project-relative asset path.');
    insist(/^src\/assets\/images\/[a-zA-Z0-9._-]+\.(png|ico)$/i.test(game.icon), 'Icon must be a PNG or ICO file inside src/assets/images.');
    insist(!game.icon.includes('..'), 'Icon path cannot leave the project.');
  }
  for (const key of ['createDesktopShortcut', 'createStartMenuShortcut', 'installForAllUsers']) {
    if (game[key] !== undefined) insist(typeof game[key] === 'boolean', 'Install and shortcut options must be on or off.');
  }
  return game;
}

/** Everything the editor shows for a project's export properties. */
export function gameOutput(project = {}) {
  const game = project.game || {};
  const name = game.name || project.name || 'Game';
  const safe = name.replace(/[^\w.-]/g, '-');
  return {
    name,
    version: game.version || '(auto)',
    publisher: game.publisher || '(not set)',
    description: game.description || '',
    icon: game.icon || '(suite default)',
    desktop: game.createDesktopShortcut !== false,
    startMenu: game.createStartMenuShortcut !== false,
    installScope: game.installForAllUsers ? 'all users' : 'current user',
    // The executable keeps the product name as typed; the installer file name
    // replaces anything that is not safe in a filename.
    artifact: `${safe}-v\${version}-Setup.\${ext}`,
    executable: `${name}.exe`
  };
}

const element = (id, type, x, y, width, height, text = '', extra = {}) => ({
  id, type, x, y, width, height, text, color: '#f1f5ff', background: 'transparent',
  fontSize: 24, font: 'Segoe UI', opacity: 1, borderRadius: 0, anchor: 'top-left', ...extra
});
export function defaultUI() {
  return {
    width: 1920, height: 1080, css: '', fonts: [], templates: [],
    screens: [
      { id: 'hud', name: 'Default HUD', kind: 'hud', mode: 'all', elements: [
        element('health', 'bar', 48, 48, 280, 14, '', { anchor: 'bottom-left', binding: 'health', background: '#263244', color: '#65e6ac' }),
        element('match-status', 'text', 0, -150, 520, 44, '{{matchStatus}}', { anchor: 'center', fontSize: 34, color: '#f4d17b', visibleWhen: 'matchStatus' }),
        element('downed', 'text', 0, 40, 420, 40, 'Eliminated — respawning', { anchor: 'center', fontSize: 24, color: '#ff8f7a', visibleWhen: 'downed' }),
        element('ammo', 'text', 48, 48, 240, 60, '{{ammo}} / {{reserve}}', { anchor: 'bottom-right', fontSize: 36, color: '#f4d17b' }),
        element('weapon-name', 'text', 48, 112, 240, 32, '{{weapon}}', { anchor: 'bottom-right', fontSize: 18 }),
        element('crosshair', 'crosshair', 0, 0, 36, 36, '', { anchor: 'center' }),
        element('hitmarker', 'text', 0, 0, 40, 40, '×', { anchor: 'center', visibleWhen: 'hitmarker' }),
        element('message', 'text', 0, 120, 600, 48, '{{message}}', { anchor: 'center', visibleWhen: 'message', color: '#f4d17b' }),
        element('reload', 'text', 0, 70, 200, 40, 'RELOADING', { anchor: 'center', visibleWhen: 'reloading', fontSize: 18 })
      ] },
      { id: 'domination', name: 'Domination overlay', kind: 'hud', mode: 'domination', elements: [
        element('score', 'text', 0, 40, 420, 48, 'DOMINATION   {{scoreA}} : {{scoreB}}', { anchor: 'top-center', fontSize: 24 }),
        element('objective', 'text', 0, 104, 600, 32, '{{objective}}', { anchor: 'top-center', fontSize: 18 })
      ] },
      { id: 'tdm', name: 'TDM overlay', kind: 'hud', mode: 'tdm', elements: [
        element('score', 'text', 0, 40, 460, 48, 'TDM   {{scoreA}} : {{scoreB}}', { anchor: 'top-center' }),
        element('clock', 'text', 0, 88, 200, 28, '{{timeLeft}}', { anchor: 'top-center', fontSize: 20, color: '#9fb2c8' }),
        element('teams', 'text', 0, 116, 460, 28, '{{teamA}} {{scoreA}}    {{scoreB}} {{teamB}}', { anchor: 'top-center', fontSize: 16, color: '#9fb2c8' }),
        element('personal', 'text', 48, 96, 260, 26, '{{kills}} / {{deaths}}', { anchor: 'bottom-left', fontSize: 18, color: '#9fb2c8' }),
        element('killfeed', 'text', 0, 150, 520, 120, '{{killfeed}}', { anchor: 'top-right', fontSize: 16, color: '#c7d4e4' })
      ] },
      { id: 'main', name: 'Main menu', kind: 'menu', mode: 'all', elements: [
        element('backdrop', 'panel', 0, 0, 1920, 1080, '', { background: '#0b101be8' }),
        element('title', 'text', 0, -150, 700, 80, 'FPS Game', { anchor: 'center', fontSize: 54 }),
        element('play', 'button', 0, 0, 300, 56, 'Play', { anchor: 'center', background: '#326b64', action: 'resume' }),
        element('settings', 'button', 0, 80, 300, 56, 'SETTINGS', { anchor: 'center', background: '#263244', action: 'settings' }),
        element('quit', 'button', 0, 160, 300, 56, 'QUIT', { anchor: 'center', background: '#263244', action: 'quit' })
      ] },
      { id: 'pause', name: 'Pause menu', kind: 'menu', mode: 'all', elements: [
        element('backdrop', 'panel', 0, 0, 1920, 1080, '', { background: '#0b101bdd' }),
        element('title', 'text', 0, -100, 500, 64, 'PAUSED', { anchor: 'center', fontSize: 48 }),
        element('resume', 'button', 0, 0, 300, 56, 'RESUME', { anchor: 'center', background: '#326b64', action: 'resume' }),
        element('settings', 'button', 0, 80, 300, 56, 'SETTINGS', { anchor: 'center', background: '#263244', action: 'settings' }),
        element('main', 'button', 0, 160, 300, 56, 'MAIN MENU', { anchor: 'center', action: 'main' })
      ] },
      { id: 'settings', name: 'Settings menu', kind: 'menu', mode: 'all', elements: [
        element('backdrop', 'panel', 0, 0, 1920, 1080, '', { background: '#0b101bf0' }),
        element('title', 'text', 0, -160, 600, 64, 'SETTINGS', { anchor: 'center', fontSize: 48 }),
        element('volume', 'slider', 0, -40, 400, 60, 'Master volume', { anchor: 'center', binding: 'volume' }),
        element('sensitivity', 'slider', 0, 40, 400, 60, 'Mouse sensitivity', { anchor: 'center', binding: 'sensitivity' }),
        element('back', 'button', 0, 160, 300, 56, 'BACK', { anchor: 'center', background: '#263244', action: 'back' })
      ] }
    ]
  };
}
export function defaultPlayer() {
  return { modelUrl: '', height: 1.8, rotation: [0, 0, 0], animations: {}, hitboxes: [],
    firstPerson: { enabled: false, meshes: [], position: [-0.26, -1.5, 0.45], rotation: [0, 0, 0], scale: 1 } };
}
export function createProject() {
  return { version: VERSION, name: 'FPS Game', entryLevel: 'test-level', prefabs: [], activeWeapon: 'm4', weapons: [clone(DEFAULT_WEAPON)],
    clips: [], player: defaultPlayer(), game: defaultGameProperties(), ui: defaultUI(), settings: { theme: 'midnight', volume: 0.7, sensitivity: 0.5 } };
}
export function createLevel() {
  return { version: VERSION, name: 'Untitled arena', mode: 'sandbox',
    playerSpawn: { position: [0, 1.2, 8], yaw: 0 },
    environment: {
      background: '#101827', fogNear: 60, fogFar: 220, sky: DEFAULT_SKY,
      render: { quality: 'high', shadows: true, shadowSize: 2048, toneMapping: 'aces', exposure: 1 }
    },
    // A hemisphere light alone casts no shadows, so a new project used to look
    // flat no matter how the renderer was configured. The sun is what gives the
    // first scene contact shadows and a readable sense of direction.
    lights: [
      { id: uid('light'), name: 'Sky light', type: 'hemisphere', color: '#cfe0ff', groundColor: '#4b525c', intensity: 1.8 },
      { id: uid('sun'), name: 'Sun', type: 'directional', color: '#fff4e0', intensity: 2.6, position: [14, 22, 8] }
    ],
    geometry: [{ id: uid('floor'), type: 'box', position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [40, 1, 40], material: { color: '#7f8894', grid: true, gridRepeat: 20 } }],
    props: [], triggers: [], sounds: [], objectives: [], spawns: [], bots: [] };
}
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const vector = (v, length = 3) => Array.isArray(v) && v.length === length && v.every(finite);
function insist(test, message) { if (!test) throw new Error(message); }
export const GAME_MODES = ['sandbox', 'domination', 'tdm'];
/** "fixed" is the legacy spelling of "box". */
export const COLLIDER_MODES = ['box', 'fixed', 'mesh', 'hull', 'none'];

/** Match settings for team modes; anything absent falls back to these. */
export const MATCH_LIMITS = { scoreLimit: 15, timeLimit: 600, respawnDelay: 3, countdown: 3 };

/** A bot spawns with a team and a skill; everything else has defaults. */
export function createBot(overrides = {}) {
  return { id: uid('bot'), name: 'Bot', team: 'B', skill: 0.5, position: [0, 1.2, 0], yaw: 0, ...overrides };
}

export function validateMatch(match = null) {
  if (match === null || match === undefined) return match;
  insist(match && typeof match === 'object' && !Array.isArray(match), 'Match settings must be an object.');
  insist(match.scoreLimit === undefined || (Number.isInteger(match.scoreLimit) && match.scoreLimit >= 1 && match.scoreLimit <= 999), 'Score limit must be a whole number 1–999.');
  insist(match.timeLimit === undefined || (finite(match.timeLimit) && match.timeLimit >= 0 && match.timeLimit <= 86400), 'Time limit must be 0–86400 seconds.');
  insist(match.respawnDelay === undefined || (finite(match.respawnDelay) && match.respawnDelay >= 0 && match.respawnDelay <= 60), 'Respawn delay must be 0–60 seconds.');
  insist(match.countdown === undefined || (finite(match.countdown) && match.countdown >= 0 && match.countdown <= 30), 'Countdown must be 0–30 seconds.');
  if (match.teams !== undefined) {
    insist(Array.isArray(match.teams) && match.teams.length >= 2 && match.teams.length <= 8, 'A team match needs 2–8 teams.');
    insist(match.teams.every(team => typeof team === 'string' && team.length > 0 && team.length <= 16), 'Team names must be 1–16 characters.');
    insist(new Set(match.teams).size === match.teams.length, 'Team names must be unique.');
  }
  if (match.teamNames !== undefined) {
    insist(match.teamNames && typeof match.teamNames === 'object' && !Array.isArray(match.teamNames), 'Team names must be an object.');
    for (const [team, name] of Object.entries(match.teamNames)) insist(typeof name === 'string' && name.length <= 32, 'Team name must be text up to 32 characters.');
  }
  if (match.playerNames !== undefined) {
    insist(match.playerNames && typeof match.playerNames === 'object' && !Array.isArray(match.playerNames), 'Player names must be an object.');
    for (const name of Object.values(match.playerNames)) insist(typeof name === 'string' && name.length <= 32, 'Player name must be text up to 32 characters.');
  }
  if (match.friendlyFire !== undefined) insist(typeof match.friendlyFire === 'boolean', 'Friendly fire must be on or off.');
  return match;
}

export function validateBots(bots = []) {
  insist(Array.isArray(bots) && bots.length <= 64, 'Bots must be a list (max 64).');
  const seen = new Set();
  for (const bot of bots) {
    insist(bot && typeof bot === 'object' && !Array.isArray(bot), 'Invalid bot.');
    insist(typeof bot.id === 'string' && bot.id.length > 0 && !seen.has(bot.id), 'Bots need unique IDs.');
    seen.add(bot.id);
    insist(typeof bot.name === 'string' && bot.name.trim().length > 0 && bot.name.length <= 32, 'Bot name must be 1–32 characters.');
    insist(typeof bot.team === 'string' && bot.team.length > 0 && bot.team.length <= 16, 'Bot needs a team.');
    insist(bot.skill === undefined || (finite(bot.skill) && bot.skill >= 0 && bot.skill <= 1), 'Bot skill must be between 0 and 1.');
    if (bot.position) insist(vector(bot.position), 'Bot spawn needs a finite XYZ position.');
    insist(finite(bot.yaw ?? 0), 'Bot yaw must be finite.');
  }
  return bots;
}
function ids(items, label) {
  insist(Array.isArray(items) && items.length <= 10000, `${label} must be an array (max 10000).`);
  const seen = new Set();
  for (const item of items) {
    insist(typeof item.id === 'string' && item.id.length > 0 && !seen.has(item.id), `${label}: missing or duplicate ID.`);
    seen.add(item.id);
  }
}
export function validateActions(actions = []) {
  insist(Array.isArray(actions) && actions.length <= 64, 'Trigger actions must be an array (max 64).');
  for (const action of actions) {
    insist(action && ['message', 'heal', 'ammo', 'teleport', 'sound'].includes(action.type), 'Unsupported trigger action.');
    if (action.type === 'message') insist(typeof action.text === 'string' && action.text.length <= 4096 && finite(action.duration) && action.duration > 0 && action.duration <= 3600, 'Message action needs text and a positive duration.');
    if (action.type === 'heal' || action.type === 'ammo') insist(Number.isInteger(action.amount) && action.amount > 0 && action.amount <= 100000, 'Action amount must be a positive integer (max 100000).');
    if (action.type === 'teleport') insist(vector(action.position), 'Teleport requires a finite destination.');
    if (action.type === 'sound') insist(typeof action.soundId === 'string', 'Sound action requires a sound ID.');
  }
  return actions;
}
/**
 * Starter Team Deathmatch scene: a symmetric arena with cover, team spawns and
 * bots on both sides, so a new project can play a team match immediately.
 * IDs are fixed (not random) so the file is stable and diffable.
 */
export function createTdmLevel() {
  const box = (id, name, position, scale, color, extra = {}) => ({
    id, name, type: 'box', position, rotation: [0, 0, 0], scale,
    material: { color }, ...extra
  });
  const level = {
    version: VERSION,
    name: 'Team Deathmatch',
    mode: 'tdm',
    playerTeam: 'A',
    match: {
      scoreLimit: 15, timeLimit: 600, respawnDelay: 3, countdown: 3,
      teams: ['A', 'B'], teamNames: { A: 'Alpha', B: 'Bravo' }, friendlyFire: false
    },
    playerSpawn: { position: [0, 1.2, 14], yaw: 0 },
    environment: {
      background: '#0e1520', fogNear: 45, fogFar: 190, sky: 'overcast',
      render: { quality: 'high', shadows: true, shadowSize: 2048, toneMapping: 'aces', exposure: 1.05 }
    },
    lights: [
      { id: 'tdm-sky', name: 'Sky light', type: 'hemisphere', color: '#cfe0ff', groundColor: '#4b525c', intensity: 1.8 },
      { id: 'tdm-sun', name: 'Sun', type: 'directional', color: '#fff4e0', intensity: 2.6, position: [14, 22, 8] },
      { id: 'tdm-lamp-a', name: 'Lamp A', type: 'point', color: '#8fd7ff', intensity: 90, distance: 26, decay: 2, position: [-9, 5, 0] },
      { id: 'tdm-lamp-b', name: 'Lamp B', type: 'point', color: '#ffb27f', intensity: 90, distance: 26, decay: 2, position: [9, 5, 0] }
    ],
    geometry: [
      box('tdm-floor', 'Floor', [0, -0.5, 0], [44, 1, 44], '#7f8894', { material: { color: '#7f8894', grid: true, gridRepeat: 22 } }),
      box('tdm-wall-n', 'Wall north', [0, 3, -22], [44, 6, 1], '#8f98a5'),
      box('tdm-wall-s', 'Wall south', [0, 3, 22], [44, 6, 1], '#8f98a5'),
      box('tdm-wall-w', 'Wall west', [-22, 3, 0], [1, 6, 44], '#8f98a5'),
      box('tdm-wall-e', 'Wall east', [22, 3, 0], [1, 6, 44], '#8f98a5'),
      box('tdm-ramp-a', 'Ramp A', [-12, 1, -12], [10, 2, 6], '#78828f', { rotation: [0, 0, -0.12] }),
      box('tdm-ramp-b', 'Ramp B', [12, 1, 12], [10, 2, 6], '#78828f', { rotation: [0, 0, 0.12] }),
      box('tdm-pillar-1', 'Pillar 1', [-6, 2.5, 0], [2, 5, 2], '#6d7784'),
      box('tdm-pillar-2', 'Pillar 2', [6, 2.5, 0], [2, 5, 2], '#6d7784'),
      box('tdm-catwalk', 'Catwalk', [0, 4.5, 8], [12, 0.5, 4], '#98a2ae')
    ],
    props: [
      box('tdm-crate-1', 'Crate 1', [-3, 0.75, -4], [1.5, 1.5, 1.5], '#8a6a44', { mass: 8, tags: ['target'] }),
      box('tdm-crate-2', 'Crate 2', [3, 0.75, 4], [1.5, 1.5, 1.5], '#8a6a44', { mass: 8, tags: ['target'] }),
      box('tdm-crate-3', 'Crate 3', [0, 0.75, -7], [1.5, 1.5, 1.5], '#7d5f3d', { mass: 8, tags: ['target'] })
    ],
    spawns: [
      { id: 'tdm-spawn-a1', name: 'Alpha spawn 1', position: [-4, 1.2, 16], yaw: 0, team: 'A', mode: 'tdm' },
      { id: 'tdm-spawn-a2', name: 'Alpha spawn 2', position: [4, 1.2, 16], yaw: 0, team: 'A', mode: 'tdm' },
      { id: 'tdm-spawn-b1', name: 'Bravo spawn 1', position: [-4, 1.2, -16], yaw: Math.PI, team: 'B', mode: 'tdm' },
      { id: 'tdm-spawn-b2', name: 'Bravo spawn 2', position: [4, 1.2, -16], yaw: Math.PI, team: 'B', mode: 'tdm' }
    ],
    bots: [
      { id: 'tdm-bot-a1', name: 'Alpha 1', team: 'A', skill: 0.45, position: [4, 1.2, 14], yaw: 0 },
      { id: 'tdm-bot-b1', name: 'Bravo 1', team: 'B', skill: 0.5, position: [-4, 1.2, -14], yaw: Math.PI },
      { id: 'tdm-bot-b2', name: 'Bravo 2', team: 'B', skill: 0.55, position: [4, 1.2, -16], yaw: Math.PI },
      { id: 'tdm-bot-b3', name: 'Bravo 3', team: 'B', skill: 0.35, position: [0, 1.2, -12], yaw: Math.PI }
    ],
    triggers: [
      { id: 'tdm-center', name: 'Centre platform', event: 'zone.centre', once: false, position: [0, 1, 0], rotation: [0, 0, 0], scale: [8, 4, 8], actions: [] }
    ],
    sounds: [],
    objectives: []
  };
  return validateLevel(level);
}

export function validateLevel(data) {
  insist(data && typeof data === 'object' && !Array.isArray(data), 'Invalid level.');
  insist(!data.version || data.version === VERSION, 'Unsupported level version.');
  insist(vector(data.playerSpawn?.position), 'Player spawn needs a finite XYZ position.');
  if (data.mode !== undefined) insist(GAME_MODES.includes(data.mode), 'Unsupported game mode.');
  if (data.playerTeam !== undefined) insist(typeof data.playerTeam === 'string' && data.playerTeam.length > 0 && data.playerTeam.length <= 16, 'Player team must be a name up to 16 characters.');
  validateMatch(data.match);
  const all = [];
  for (const key of ['geometry', 'props', 'lights', 'triggers', 'sounds', 'objectives', 'spawns', 'bots']) {
    insist(Array.isArray(data[key] ?? []), `${key} must be an array.`);
    for (const item of data[key] ?? []) {
      insist(item && typeof item === 'object' && !Array.isArray(item), `${key}: invalid object.`);
      if (item.id) all.push(item);
      if (item.name !== undefined) insist(typeof item.name === 'string' && item.name.length <= 128, 'Object name must be text up to 128 characters.');
      if (item.editor !== undefined) {
        insist(item.editor && typeof item.editor === 'object' && !Array.isArray(item.editor), 'Invalid editor metadata.');
        for (const flag of ['hidden', 'locked']) if (item.editor[flag] !== undefined) insist(typeof item.editor[flag] === 'boolean', 'Editor flags must be boolean.');
      }
      if (key === 'geometry' || key === 'props' || key === 'triggers') {
        insist(vector(item.scale) && item.scale.every(n => n > 0), `${key}: scale must be positive XYZ dimensions.`);
        insist(vector(item.rotation ?? [0, 0, 0]), `${key}: invalid rotation.`);
      }
      if (key !== 'lights' || item.position) insist(vector(item.position), `${key}: invalid position.`);
      if (key === 'objectives') insist(finite(item.radius) && item.radius > 0 && finite(item.captureTime) && item.captureTime > 0, 'Objective radius/capture time must be positive.');
      if (key === 'sounds') insist(typeof item.url === 'string' && finite(item.volume) && item.volume >= 0 && item.volume <= 1 && (!item.refDistance || (finite(item.refDistance) && item.refDistance > 0)), 'Sound requires URL, volume 0–1, and positive reference distance.');
      if (key === 'lights') {
        insist(['ambient', 'hemisphere', 'directional', 'point'].includes(item.type), 'Unsupported light type.');
        insist(finite(item.intensity) && item.intensity >= 0, 'Light intensity must be nonnegative.');
      }
      if (key === 'props' && item.mass !== undefined) insist(finite(item.mass) && item.mass > 0, 'Prop mass must be positive.');
      if (key === 'objectives') insist(item.type === 'domination' && finite(item.scorePerSecond) && item.scorePerSecond >= 0, 'Objective requires domination type and nonnegative scoring rate.');
      if (key === 'bots') {
        insist(typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 32, 'Bot name must be 1–32 characters.');
        insist(typeof item.team === 'string' && item.team.length > 0 && item.team.length <= 16, 'Bot needs a team.');
        insist(item.skill === undefined || (finite(item.skill) && item.skill >= 0 && item.skill <= 1), 'Bot skill must be between 0 and 1.');
        insist(vector(item.position ?? [0, 1.2, 0]), 'Bot needs a finite XYZ spawn.');
        insist(finite(item.yaw ?? 0), 'Bot yaw must be finite.');
        insist(item.damage === undefined || (finite(item.damage) && item.damage > 0 && item.damage <= 1000), 'Bot damage must be positive.');
      }
      if ((key === 'geometry' || key === 'props') && item.collider !== undefined) {
        insist(COLLIDER_MODES.includes(item.collider), 'Collider must be box, fixed, mesh, hull or none.');
      }
      if (key === 'spawns') {
        insist(item.team === undefined || (typeof item.team === 'string' && item.team.length <= 16), 'Spawn team must be a name up to 16 characters.');
        insist(item.mode === undefined || typeof item.mode === 'string', 'Spawn mode must be a name.');
      }
      if (key === 'triggers') {
        insist(typeof item.event === 'string' && item.event.length > 0, 'Trigger event name required.');
        validateActions(item.actions);
        if (item.once !== undefined) insist(typeof item.once === 'boolean', 'Trigger once must be boolean.');
      }
    }
  }
  insist(finite(data.playerSpawn.yaw ?? 0), 'Player yaw must be finite.');
  for (const spawn of data.spawns ?? []) insist(finite(spawn.yaw ?? 0), 'Spawn yaw must be finite.');
  if (data.environment) {
    for (const key of ['fogNear', 'fogFar']) if (data.environment[key] !== undefined) insist(finite(data.environment[key]) && data.environment[key] >= 0, 'Fog distances must be nonnegative.');
    if (data.environment.fogNear !== undefined && data.environment.fogFar !== undefined) insist(data.environment.fogFar > data.environment.fogNear, 'Fog far must exceed near.');
    if (data.environment.background !== undefined) insist(typeof data.environment.background === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(data.environment.background.trim()), 'Background must be a hex colour.');
    // Presentation settings: the same validation the runtime normalises with,
    // so a bad sky id is refused at save time instead of silently reverting.
    validateSky(data.environment.sky);
    validateRender(data.environment.render);
  }
  ids(all, 'Level objects');
  return data;
}
export function validateProject(data) {
  insist(data?.version === VERSION, 'Unsupported toolsuite project version.');
  insist(typeof data.name === 'string' && data.name.trim().length > 0 && data.name.length <= 128, 'Project name must be 1–128 characters.');
  validateGameProperties(data.game);
  // Home/Settings defaults (item 1): an optional object; unknown extras are
  // preserved like every other authored field.
  if (data.settings !== undefined) {
    insist(data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings), 'Project settings must be an object.');
    if (data.settings.theme !== undefined) insist(typeof data.settings.theme === 'string' && data.settings.theme.length <= 32, 'Theme must be a short name.');
    for (const key of ['volume', 'sensitivity']) {
      if (data.settings[key] !== undefined) insist(finite(data.settings[key]) && data.settings[key] >= 0 && data.settings[key] <= 1, `Default ${key} must be a number 0–1.`);
    }
  }
  if (data.entryLevel !== undefined) insist(/^[a-zA-Z0-9_-]+$/.test(data.entryLevel), 'Entry scene must be a valid scene filename.');
  const prefabs = data.prefabs ?? []; ids(prefabs, 'Prefabs');
  for (const prefab of prefabs) {
    insist(typeof prefab.name === 'string' && prefab.name.trim().length > 0 && prefab.name.length <= 128, 'Prefab needs a name up to 128 characters.');
    insist(['geometry', 'props', 'lights', 'triggers', 'sounds', 'objectives', 'spawns', 'bots'].includes(prefab.collection), 'Invalid prefab collection.');
    insist(prefab.spec && typeof prefab.spec === 'object', 'Prefab requires an object spec.');
    validateLevel({ playerSpawn: { position: [0, 2, 0], yaw: 0 }, [prefab.collection]: [prefab.spec] });
  }
  ids(data.weapons, 'Weapons'); ids(data.clips, 'Animation clips');
  if (data.player !== undefined) {
    const player = data.player;
    insist(player && typeof player === 'object' && !Array.isArray(player), 'Player settings must be an object.');
    insist(typeof player.modelUrl === 'string' && (!player.modelUrl || /\.glb(?:[?#]|$)/i.test(player.modelUrl)), 'Player model must be a GLB asset.');
    insist(finite(player.height) && player.height > 0 && player.height <= 10, 'Player height must be 0–10 metres.');
    insist(vector(player.rotation), 'Player rotation must have three radians.');
    insist(player.animations && typeof player.animations === 'object' && !Array.isArray(player.animations), 'Player animations must be an object.');
    for (const id of Object.values(player.animations || {})) insist(!id || data.clips.some(clip => clip.id === id && clip.kind === 'player'), 'Player animation must reference a player clip.');
    const first = player.firstPerson;
    insist(first && typeof first.enabled === 'boolean' && Array.isArray(first.meshes) && first.meshes.every(name => typeof name === 'string' && name.length > 0), 'Player first-person meshes must be named meshes.');
    insist(new Set(first.meshes).size === first.meshes.length, 'First-person mesh names must be unique.');
    insist(vector(first.position) && vector(first.rotation) && finite(first.scale) && first.scale > 0 && first.scale <= 100, 'Invalid first-person arms pose.');
    // Enabling before picking meshes is allowed: the mesh tickboxes appear
    // exactly when first-person is on (item 3), so the natural order is
    // enable -> tick. The runtime reports a missing arm mesh explicitly.
    insist(!first.enabled || player.modelUrl, 'Choose a player model before enabling first-person arms.');
    validateHitboxes(player.hitboxes);
  }
  insist(typeof data.ui?.css === 'string' && data.ui.css.length <= 1024 * 1024, 'UI CSS must be text, max 1 MB.');
  insist(data.weapons.some(w => w.id === data.activeWeapon) || (!data.weapons.length && !data.activeWeapon), 'Active weapon does not exist.');
  for (const w of data.weapons) {
    for (const key of ['magazineSize', 'reserveAmmo']) insist(Number.isInteger(w[key]) && w[key] >= (key === 'magazineSize' ? 1 : 0), `${w.name}: invalid ${key}.`);
    for (const key of ['damage', 'fireRate', 'range', 'reloadTime', 'adsSpeed']) insist(finite(w[key]) && w[key] > 0, `${w.name}: ${key} must be positive.`);
    for (const key of ['recoilKick', 'recoilYaw', 'spreadBase', 'spreadMax', 'bloomGrow', 'bloomDecay', 'airSpread', 'adsSpreadMultiplier']) insist(finite(w[key]) && w[key] >= 0, `${w.name}: invalid ${key}.`);
    insist(w.spreadMax >= w.spreadBase && finite(w.adsFov) && w.adsFov >= 20 && w.adsFov <= 100, `${w.name}: invalid spread bounds / ADS FOV.`);
    for (const key of ['hipPosition', 'adsPosition', 'hipRotation', 'adsRotation', 'muzzle']) insist(vector(w[key]), `${w.name}: invalid ${key}.`);
    if (w.arms !== undefined) insist(w.arms && vector(w.arms.position) && vector(w.arms.rotation) && finite(w.arms.scale) && w.arms.scale > 0 && w.arms.scale <= 100, `${w.name}: invalid arms pose.`);
    validateDamageMultipliers(w.damageMultipliers);
    for (const id of Object.values(w.animations ?? {})) insist(!id || data.clips.some(c => c.id === id && c.kind !== 'player'), `${w.name}: missing animation ${id}.`);
  }
  for (const clip of data.clips) {
    insist(clip.kind === undefined || ['weapon', 'player'].includes(clip.kind), 'Animation kind must be weapon or player.');
    insist(finite(clip.duration) && clip.duration > 0 && clip.duration <= 3600, 'Clip duration must be 0–3600 seconds.');
    ids(clip.tracks, 'Animation tracks');
    for (const track of clip.tracks) {
      insist(['position', 'rotation', 'scale', 'quaternion'].includes(track.property), 'Unsupported animation property.');
      insist(['linear', 'step', 'smooth'].includes(track.interpolation), 'Unsupported interpolation.');
      insist(typeof track.target === 'string' && track.target.length > 0, 'Animation target required.');
      let last = -1;
      for (const key of track.keys) {
        insist(finite(key.time) && key.time >= 0 && key.time <= clip.duration && key.time > last, 'Keyframes must be unique, sorted, and inside the clip.');
        insist(vector(key.value, track.property === 'quaternion' ? 4 : 3), 'Invalid keyframe value.');
        if (track.property === 'quaternion') insist(Math.hypot(...key.value) > 0, 'Quaternion cannot be zero.');
        last = key.time;
      }
    }
  }
  insist(data.ui && finite(data.ui.width) && data.ui.width > 0 && finite(data.ui.height) && data.ui.height > 0, 'Invalid UI design resolution.');
  // Fonts are either bundled in the project or inline data URLs; nothing is
  // fetched from the network, so the renderer stays offline-safe.
  const fonts = data.ui.fonts ?? [];
  insist(Array.isArray(fonts) && fonts.length <= 64, 'UI fonts must be a list (max 64).');
  for (const font of fonts) {
    insist(font && typeof font.id === 'string' && font.id.length > 0, 'UI font: missing ID.');
    insist(typeof font.name === 'string' && font.name.length > 0 && font.name.length <= 64, 'UI font needs a name up to 64 characters.');
    insist(typeof font.source === 'string' && font.source.length > 0 && font.source.length <= 3 * 1024 * 1024
      && (font.source.startsWith('data:font/') || font.source.startsWith('data:application/font')
        || /^src\/assets\/fonts\/[a-zA-Z0-9._-]+\.(woff2?|ttf|otf)$/.test(font.source)),
      'UI font must be a bundled font asset or an inline font data URL.');
  }
  const templates = data.ui.templates ?? [];
  insist(Array.isArray(templates) && templates.length <= 200, 'UI templates must be a list (max 200).');
  for (const template of templates) {
    insist(template && typeof template.id === 'string' && template.id.length > 0, 'UI template: missing ID.');
    insist(typeof template.name === 'string' && template.name.length > 0 && template.name.length <= 64, 'UI template needs a name.');
    insist(typeof template.css === 'string' && template.css.length > 0 && template.css.length <= 65536, 'UI template CSS must be text up to 64 KB.');
  }
  ids(data.ui.screens, 'UI screens');
  for (const screen of data.ui.screens) {
    insist(['hud', 'menu'].includes(screen.kind), 'Screen kind must be hud/menu.');
    insist(typeof screen.mode === 'string', 'Screen mode must be a name.');
    ids(screen.elements, 'UI elements');
    for (const el of screen.elements) {
      insist(['text', 'panel', 'image', 'bar', 'button', 'slider', 'crosshair'].includes(el.type), 'Unknown UI element type.');
      for (const key of ['x', 'y', 'width', 'height', 'fontSize', 'opacity', 'borderRadius']) insist(finite(el[key]), `UI ${el.id}: invalid ${key}.`);
      insist(!el.name || (typeof el.name === 'string' && el.name.length <= 64), `UI ${el.id}: name must be text up to 64 characters.`);
      insist(!el.font || (typeof el.font === 'string' && el.font.length <= 64), `UI ${el.id}: font must be a family name.`);
      insist(el.width > 0 && el.height > 0 && el.opacity >= 0 && el.opacity <= 1 && el.fontSize > 0 && el.borderRadius >= 0, 'UI dimensions/opacity out of bounds.');
      insist(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'].includes(el.anchor), 'Unsupported UI anchor.');
      for (const key of ['text', 'color', 'background']) insist(typeof el[key] === 'string', `UI ${el.id}: ${key} must be text.`);
      if (el.type === 'bar' && el.maxValue !== undefined) insist(finite(el.maxValue) && el.maxValue > 0, 'Bar maximum must be positive.');
      if (el.type === 'button') insist(['resume', 'main', 'pause', 'settings', 'back', 'restart', 'quit'].includes(el.action), 'Unsupported button action.');
      if (el.type === 'slider') insist(['volume', 'sensitivity'].includes(el.binding), 'Unsupported settings slider.');
    }
  }
  return data;
}
/** Clamp at boundaries; empty tracks have no effect, not a zero pose. */
export function sampleTrack(track, time) {
  const keys = track.keys;
  if (!keys.length) return null;
  if (time <= keys[0].time) return [...keys[0].value];
  if (time >= keys.at(-1).time) return [...keys.at(-1).value];
  const b = keys.findIndex(k => k.time > time), a = b - 1;
  let f = (time - keys[a].time) / (keys[b].time - keys[a].time);
  if (track.interpolation === 'step') f = 0;
  if (track.interpolation === 'smooth') f = f * f * (3 - 2 * f);
  if (track.property === 'quaternion') {
    let start = keys[a].value, end = keys[b].value;
    start = start.map(n => n / Math.hypot(...start)); end = end.map(n => n / Math.hypot(...end));
    let dot = start.reduce((n, v, i) => n + v * end[i], 0);
    if (dot < 0) { dot = -dot; end = end.map(n => -n); }
    let out;
    if (dot > 0.9995) out = start.map((n, i) => n + (end[i] - n) * f);
    else {
      const angle = Math.acos(Math.min(1, dot));
      out = start.map((n, i) => (n * Math.sin((1 - f) * angle) + end[i] * Math.sin(f * angle)) / Math.sin(angle));
    }
    const len = Math.hypot(...out); return out.map(n => n / len);
  }
  return keys[a].value.map((n, i) => n + (keys[b].value[i] - n) * f);
}

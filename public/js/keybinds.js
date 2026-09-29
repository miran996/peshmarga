/** Remappable keyboard bindings — persisted in localStorage. */
const KEY = 'fps_keybinds';

export const DEFAULT_BINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  crouchToggle: 'KeyC',
  jump: 'Space',
  reload: 'KeyR',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  lethal: 'KeyG',
  melee: 'KeyV',
  trophy: 'KeyX',
  uav: 'Digit3',
  airstrike: 'Digit4',
  chat: 'KeyT',
  teamChat: 'KeyY',
  scoreboard: 'Tab',
};

/** UI order + i18n label keys (mouse actions listed separately, not remappable). */
export const BIND_ROWS = [
  { action: 'forward', labelKey: 'bind.forward' },
  { action: 'back', labelKey: 'bind.back' },
  { action: 'left', labelKey: 'bind.left' },
  { action: 'right', labelKey: 'bind.right' },
  { action: 'sprint', labelKey: 'bind.sprint' },
  { action: 'crouch', labelKey: 'bind.crouch' },
  { action: 'crouchToggle', labelKey: 'bind.crouchToggle' },
  { action: 'jump', labelKey: 'bind.jump' },
  { action: 'reload', labelKey: 'bind.reload' },
  { action: 'weapon1', labelKey: 'bind.weapon1' },
  { action: 'weapon2', labelKey: 'bind.weapon2' },
  { action: 'lethal', labelKey: 'bind.lethal' },
  { action: 'melee', labelKey: 'bind.melee' },
  { action: 'trophy', labelKey: 'bind.trophy' },
  { action: 'uav', labelKey: 'bind.uav' },
  { action: 'airstrike', labelKey: 'bind.airstrike' },
  { action: 'chat', labelKey: 'bind.chat' },
  { action: 'teamChat', labelKey: 'bind.teamChat' },
  { action: 'scoreboard', labelKey: 'bind.scoreboard' },
];

const BLOCKED = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* ignore */ }
  const out = { ...DEFAULT_BINDS };
  for (const k of Object.keys(DEFAULT_BINDS)) {
    if (typeof saved[k] === 'string' && saved[k]) out[k] = saved[k];
  }
  return out;
}

export let binds = load();
const listeners = new Set();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch { /* ignore */ }
  for (const fn of listeners) {
    try { fn(binds); } catch { /* ignore */ }
  }
}

export function onKeybinds(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setBind(action, code) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_BINDS, action)) return false;
  if (!code || BLOCKED.has(code)) return false;
  for (const a of Object.keys(binds)) {
    if (a !== action && binds[a] === code) binds[a] = '';
  }
  binds[action] = code;
  persist();
  return true;
}

export function resetKeybinds() {
  binds = { ...DEFAULT_BINDS };
  persist();
}

export function isBlockedCode(code) {
  return BLOCKED.has(code);
}

/** True if `code` triggers `action` (includes L/R Shift/Ctrl aliases). */
export function codeMatches(code, action) {
  const b = binds[action];
  if (!b || !code) return false;
  if (code === b) return true;
  if (b === 'ShiftLeft' && code === 'ShiftRight') return true;
  if (b === 'ShiftRight' && code === 'ShiftLeft') return true;
  if (b === 'ControlLeft' && code === 'ControlRight') return true;
  if (b === 'ControlRight' && code === 'ControlLeft') return true;
  if (b === 'AltLeft' && code === 'AltRight') return true;
  if (b === 'AltRight' && code === 'AltLeft') return true;
  return false;
}

/** True if any matching code is currently held in a Set of KeyboardEvent.code. */
export function actionDown(keys, action) {
  const b = binds[action];
  if (!b || !keys) return false;
  if (keys.has(b)) return true;
  if (b === 'ShiftLeft' && keys.has('ShiftRight')) return true;
  if (b === 'ShiftRight' && keys.has('ShiftLeft')) return true;
  if (b === 'ControlLeft' && keys.has('ControlRight')) return true;
  if (b === 'ControlRight' && keys.has('ControlLeft')) return true;
  if (b === 'AltLeft' && keys.has('AltRight')) return true;
  if (b === 'AltRight' && keys.has('AltLeft')) return true;
  return false;
}

const PRETTY = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'Alt',
  AltRight: 'R-Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function formatCode(code) {
  if (!code) return '—';
  if (PRETTY[code]) return PRETTY[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code.replace(/^Key/, '');
}

/**
 * Character Selection — operator portraits from /img/operators/*.png
 * Exports selectedCharacter for multiplayer join payloads.
 */

import { t } from './i18n.js';

export const CHARACTERS = [
  { id: 'assault', name: 'Assault', role: 'Rifleman', src: '/img/operators/assault.png?v=4' },
  { id: 'heavy', name: 'Heavy', role: 'LMG Gunner', src: '/img/operators/heavy.png?v=4' },
  { id: 'insurgent', name: 'Insurgent', role: 'Guerrilla', src: '/img/operators/insurgent.png?v=4' },
  { id: 'breacher', name: 'Breacher', role: 'Shotgun', src: '/img/operators/breacher.png?v=4' },
  { id: 'scout', name: 'Scout', role: 'Carbine', src: '/img/operators/scout.png?v=4' },
  { id: 'ghillie', name: 'Ghillie', role: 'Sniper', src: '/img/operators/ghillie.png?v=4' },
  { id: 'smg', name: 'Pointman', role: 'SMG', src: '/img/operators/smg.png?v=4' },
  { id: 'nightops', name: 'Night Ops', role: 'CQC / NVG', src: '/img/operators/nightops.png?v=4' },
  { id: 'riot', name: 'Riot Guard', role: 'Shield', src: '/img/operators/riot.png?v=4' },
  { id: 'prone', name: 'Recon', role: 'Prone Overwatch', src: '/img/operators/prone.png?v=4' },
];

/** Currently selected operative — send this id with mp join later. */
export let selectedCharacter = CHARACTERS[0].id;

const STORAGE_KEY = 'fps_selected_character';

function loadSaved() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && CHARACTERS.some((c) => c.id === id)) selectedCharacter = id;
  } catch { /* ignore */ }
}

function saveSelection(id) {
  selectedCharacter = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
}

/**
 * Mount the 2×5 character grid into `root`.
 * @param {HTMLElement} root
 * @param {{ onSelect?: (character: object) => void, initialId?: string }} [opts]
 */
export function mountCharacterSelect(root, opts = {}) {
  if (!root) return null;
  loadSaved();
  if (opts.initialId && CHARACTERS.some((c) => c.id === opts.initialId)) {
    selectedCharacter = opts.initialId;
  }

  root.innerHTML = `
    <div class="char-select">
      <div class="char-select-head">
        <div>
          <h2 data-i18n="ops.title">${t('ops.title')}</h2>
          <p class="sub" data-i18n="ops.sub">${t('ops.sub')}</p>
        </div>
        <div class="char-select-meta"><span data-i18n="ops.selectedOf">${t('ops.selectedOf')}</span> <b id="cs-selected-label">${getCharacter(selectedCharacter).name}</b></div>
      </div>
      <div class="char-grid" role="listbox" aria-label="Character selection" id="cs-grid"></div>
    </div>
  `;

  const grid = root.querySelector('#cs-grid');
  const label = root.querySelector('#cs-selected-label');

  const cards = CHARACTERS.map((ch) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `char-card${ch.id === selectedCharacter ? ' is-selected' : ''}`;
    btn.dataset.characterId = ch.id;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', ch.id === selectedCharacter ? 'true' : 'false');
    btn.innerHTML = `
      <span class="tag-selected" data-i18n="ops.selected">${t('ops.selected')}</span>
      <span class="char-portrait">
        <img src="${ch.src}" alt="${ch.name}" width="420" height="540" loading="lazy" draggable="false" />
      </span>
      <span class="char-card-body">
        <span class="name">${ch.name}</span>
        <span class="role">${ch.role}</span>
      </span>
    `;
    btn.addEventListener('click', () => select(ch.id));
    grid.appendChild(btn);
    return btn;
  });

  function select(id) {
    const ch = getCharacter(id);
    saveSelection(ch.id);
    cards.forEach((card) => {
      const on = card.dataset.characterId === ch.id;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (label) label.textContent = ch.name;
    opts.onSelect?.(ch);
  }

  return {
    get selected() { return getCharacter(selectedCharacter); },
    get selectedId() { return selectedCharacter; },
    select,
    characters: CHARACTERS,
  };
}

loadSaved();

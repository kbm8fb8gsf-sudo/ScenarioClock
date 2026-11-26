// @ts-check
/**
 * Realism Mode: while it's on, each reply gets a short note asking the AI for one line of
 * dialogue and one action, so the chat flows like a real conversation. It's switched on and off
 * from SillyTavern's options menu (☰, where Regenerate and Continue are), the panel or /realism.
 */

import { ROLE_VALUES } from './settings.js';

export const REALISM_PROMPT_KEY = 'sillytweaks_realism';
export const MENU_ITEM_ID = 'sillytweaks_realism_option';

/** SillyTavern's extension_prompt_types.IN_CHAT. */
const IN_CHAT = 1;

/**
 * The note for a generation, or '' for none. Quiet background prompts (summaries and the like)
 * never get it, since it would squeeze them into one line.
 * @param {import('./settings.js').RealismSettings} settings
 * @param {string | null | undefined} generationType
 */
export function realismPromptFor(settings, generationType) {
    if (!settings.enabled || generationType === 'quiet') return '';
    return settings.prompt.trim();
}

/**
 * @param {(key: string, value: string, position: number, depth: number, scan?: boolean, role?: number) => void} setExtensionPrompt
 * @param {import('./settings.js').RealismSettings} settings
 * @param {string | null | undefined} generationType
 */
export function applyRealismPrompt(setExtensionPrompt, settings, generationType) {
    const text = realismPromptFor(settings, generationType);
    setExtensionPrompt(REALISM_PROMPT_KEY, text, IN_CHAT, settings.depth, false, ROLE_VALUES[settings.role]);
}

/**
 * Adds the Realism Mode switch to SillyTavern's options menu, after Continue.
 * SillyTavern only closes that menu for its own items, so this one stays open after a click and
 * shows its new state.
 * @param {Document} doc
 * @param {() => void} onToggle
 * @returns {HTMLElement | null} The item, or null if the menu isn't there.
 */
export function addMenuToggle(doc, onToggle) {
    const existing = doc.getElementById(MENU_ITEM_ID);
    if (existing) return existing;
    const menu = doc.querySelector('#options .options-content');
    if (!menu) return null;

    const item = doc.createElement('a');
    item.id = MENU_ITEM_ID;
    item.title = 'Ask for one line of dialogue and one action per reply, like a real conversation';
    item.setAttribute('role', 'menuitemcheckbox');
    item.setAttribute('aria-checked', 'false');
    const icon = doc.createElement('i');
    icon.className = 'fa-lg fa-solid fa-toggle-off';
    const label = doc.createElement('span');
    label.textContent = 'Realism Mode';
    item.append(icon, label);
    item.addEventListener('click', (event) => {
        event.preventDefault();
        onToggle();
    });

    const anchor = doc.getElementById('option_continue');
    if (anchor && anchor.parentElement === menu) anchor.after(item);
    else menu.append(item);
    return item;
}

/**
 * Shows whether Realism Mode is on: in the menu item, and as a dot on the options (☰) button so
 * it's visible while the menu is closed.
 * @param {Document} doc
 * @param {boolean} on
 */
export function showRealismState(doc, on) {
    const item = doc.getElementById(MENU_ITEM_ID);
    if (item) {
        item.setAttribute('aria-checked', String(on));
        item.classList.toggle('sillytweaks-on', on);
        const icon = item.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-toggle-on', on);
            icon.classList.toggle('fa-toggle-off', !on);
        }
        const label = item.querySelector('span');
        if (label) label.textContent = on ? 'Realism Mode: on' : 'Realism Mode';
    }
    const button = doc.getElementById('options_button');
    if (button) {
        button.classList.toggle('sillytweaks-realism-on', on);
        if (on) button.setAttribute('data-sillytweaks-note', 'Realism Mode is on');
        else button.removeAttribute('data-sillytweaks-note');
    }
}

/**
 * Reads an on/off argument: "on", "off", "toggle" (or nothing), or "status".
 * @param {string} arg
 * @param {boolean} current
 * @returns {boolean | null} The new state, or null for an argument it doesn't understand.
 */
export function nextRealismState(arg, current) {
    const value = arg.trim().toLowerCase();
    if (value === '' || value === 'toggle') return !current;
    if (['on', 'true', 'yes', '1'].includes(value)) return true;
    if (['off', 'false', 'no', '0'].includes(value)) return false;
    if (value === 'status') return current;
    return null;
}

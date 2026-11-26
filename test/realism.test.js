// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MENU_ITEM_ID, REALISM_PROMPT_KEY, addMenuToggle, applyRealismPrompt, nextRealismState, realismPromptFor,
    showRealismState,
} from '../src/realism.js';
import { normalizeRealismSettings } from '../src/settings.js';
import OPTIONS_MENU from './fixtures/options-menu.html?raw';

const ON = normalizeRealismSettings({ enabled: true });
const OFF = normalizeRealismSettings({});

describe('the Realism Mode note', () => {
    it('goes into every kind of reply while on', () => {
        for (const type of ['normal', 'swipe', 'regenerate', 'continue', 'impersonate', null]) {
            expect(realismPromptFor(ON, type)).toBe('(OOC: Realism mode, one line of dialogue and one action only, so it flows like a real conversation.)');
        }
    });

    it('stays out of quiet background prompts, and out of everything while off', () => {
        expect(realismPromptFor(ON, 'quiet')).toBe('');
        expect(realismPromptFor(OFF, 'normal')).toBe('');
    });

    it('is added in the chat at the chosen depth and role', () => {
        const setExtensionPrompt = vi.fn();
        applyRealismPrompt(setExtensionPrompt, normalizeRealismSettings({ enabled: true, depth: 1, role: 'user' }), 'normal');
        expect(setExtensionPrompt).toHaveBeenCalledWith(REALISM_PROMPT_KEY, expect.stringContaining('OOC: Realism mode'), 1, 1, false, 1);
        applyRealismPrompt(setExtensionPrompt, OFF, 'normal');
        expect(setExtensionPrompt).toHaveBeenLastCalledWith(REALISM_PROMPT_KEY, '', 1, 0, false, 0);
    });
});

describe('the menu switch', () => {
    beforeEach(() => {
        document.body.innerHTML = OPTIONS_MENU;
    });

    it('sits after Continue in the options menu', () => {
        const onToggle = vi.fn();
        const item = addMenuToggle(document, onToggle);
        expect(item?.previousElementSibling?.id).toBe('option_continue');
        expect(item?.textContent).toBe('Realism Mode');
        expect(addMenuToggle(document, onToggle)).toBe(item);
        expect(document.querySelectorAll(`#${MENU_ITEM_ID}`)).toHaveLength(1);
        item?.click();
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('shows its state in the menu and on the options button', () => {
        addMenuToggle(document, () => {});
        showRealismState(document, true);
        const item = /** @type {HTMLElement} */ (document.getElementById(MENU_ITEM_ID));
        expect(item.getAttribute('aria-checked')).toBe('true');
        expect(item.querySelector('i')?.classList.contains('fa-toggle-on')).toBe(true);
        expect(item.textContent).toBe('Realism Mode: on');
        expect(document.getElementById('options_button')?.classList.contains('sillytweaks-realism-on')).toBe(true);

        showRealismState(document, false);
        expect(item.querySelector('i')?.classList.contains('fa-toggle-off')).toBe(true);
        expect(item.textContent).toBe('Realism Mode');
        expect(document.getElementById('options_button')?.classList.contains('sillytweaks-realism-on')).toBe(false);
    });

    it('does nothing without the menu', () => {
        document.body.innerHTML = '';
        expect(addMenuToggle(document, () => {})).toBeNull();
        expect(() => showRealismState(document, true)).not.toThrow();
    });
});

describe('/realism arguments', () => {
    it.each([
        ['', false, true], ['toggle', true, false], ['on', false, true], ['OFF', true, false],
        ['status', true, true], ['yes', false, true], ['maybe', false, null],
    ])('%j when %s → %s', (arg, current, expected) => {
        expect(nextRealismState(arg, current)).toBe(expected);
    });
});

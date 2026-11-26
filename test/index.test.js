// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import HTML from '../settings.html?raw';
import OPTIONS_MENU from './fixtures/options-menu.html?raw';

/**
 * A stand-in for the bits of SillyTavern's getContext() that index.js uses.
 */
function fakeSillyTavern() {
    /** @type {Record<string, Array<(...args: any[]) => unknown>>} */
    const listeners = {};
    /** @type {Record<string, any>} */
    const commands = {};
    /** @type {Record<string, () => string>} */
    const macros = {};
    /** @type {Record<string, { value: string, position: number, depth: number, role?: number }>} */
    const prompts = {};
    const context = {
        chat: /** @type {any[]} */ ([]),
        /** @type {Record<string, unknown>} */
        chatMetadata: {},
        chatId: /** @type {string | undefined} */ (undefined),
        getCurrentChatId: () => context.chatId,
        eventSource: {
            on: (/** @type {string} */ name, /** @type {(...args: any[]) => unknown} */ listener) => {
                (listeners[name] ??= []).push(listener);
            },
        },
        eventTypes: {
            APP_READY: 'app_ready',
            CHAT_CHANGED: 'chat_id_changed',
            MESSAGE_RECEIVED: 'message_received',
            MESSAGE_SENT: 'message_sent',
            MESSAGE_DELETED: 'message_deleted',
        },
        /** @type {Record<string, unknown>} */
        extensionSettings: { scenario_clock: { tagDisplay: 'badge' } },
        powerUserSettings: { experimental_macro_engine: true },
        settingsSaves: 0,
        saveSettingsDebounced: () => { context.settingsSaves++; },
        saveMetadata: vi.fn(async () => {}),
        saveChat: vi.fn(async () => {}),
        setExtensionPrompt: (/** @type {string} */ key, /** @type {string} */ value, /** @type {number} */ position, /** @type {number} */ depth, /** @type {boolean} */ _scan, /** @type {number} */ role) => {
            prompts[key] = { value, position, depth, role };
        },
        callGenericPopup: vi.fn(async () => '+30m'),
        POPUP_TYPE: { TEXT: 1, CONFIRM: 2, INPUT: 3 },
        POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
        registerMacro: vi.fn(),
        macros: {
            register: (/** @type {string} */ name, /** @type {{ handler: () => string }} */ options) => {
                macros[name] = options.handler;
            },
            category: { TIME: 'time' },
        },
        SlashCommandParser: { addCommandObject: (/** @type {any} */ command) => { commands[command.name] = command; } },
        SlashCommand: { fromProps: (/** @type {any} */ props) => props },
        SlashCommandArgument: { fromProps: (/** @type {any} */ props) => props },
        SlashCommandNamedArgument: { fromProps: (/** @type {any} */ props) => props },
        ARGUMENT_TYPE: { STRING: 'string', BOOLEAN: 'bool' },
    };
    /** @param {string} name @param {...any} args */
    async function emit(name, ...args) {
        for (const listener of listeners[name] ?? []) await listener(...args);
    }
    return { context, commands, macros, prompts, emit };
}

const st = fakeSillyTavern();
const toastr = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() };
/** @type {any} */
const global = globalThis;

/** @param {string | undefined} type */
const intercept = (type) => global.sillyTweaksInterceptor([], 8000, () => {}, type);
const clockPrompt = () => st.prompts['scenario_clock']?.value ?? '';
const realismPrompt = () => st.prompts['sillytweaks_realism']?.value ?? '';

beforeAll(async () => {
    document.body.innerHTML = `<div id="extensions_settings2"></div><div id="extensionsMenu"></div><div id="chat"></div>${OPTIONS_MENU}`;
    vi.stubGlobal('SillyTavern', { getContext: () => st.context });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(HTML)));
    vi.stubGlobal('toastr', toastr);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 25, 13, 7) });
    const module = await import('../index.js');
    await module.onActivate();
});

/** Opens a chat the way SillyTavern does: messages, then CHAT_CHANGED. */
async function openChat(/** @type {any[]} */ chat, /** @type {Record<string, unknown>} */ metadata = {}) {
    st.context.chat = chat;
    st.context.chatMetadata = metadata;
    st.context.chatId = `chat-${Math.random()}`;
    document.getElementById('chat')?.replaceChildren();
    await st.emit('chat_id_changed');
}

describe('SillyTweaks in SillyTavern', () => {
    it('adds its panel, menu switch, wand button, slash commands and macros', () => {
        expect(st.context.settingsSaves).toBeGreaterThan(0);
        expect(document.querySelector('.sillytweaks-settings')).not.toBeNull();
        expect(document.getElementById('sillytweaks_realism_option')?.previousElementSibling?.id).toBe('option_continue');
        expect(document.getElementById('sillytweaks_clock_wand')?.textContent).toBe('Scenario Clock');
        expect(Object.keys(st.commands).sort()).toEqual(['clock', 'clock-start', 'clock-stop', 'clock-undo', 'realism']);
        expect(Object.keys(st.macros)).toContain('scenario_datetime');
    });

    it('takes over the old Scenario Clock settings and saves them under its own name', () => {
        expect(st.context.extensionSettings['sillytweaks']).toMatchObject({
            clock: { tagDisplay: 'badge', pacing: 'ai' },
            realism: { enabled: false },
        });
    });

    it('starts a clock in a new chat and asks the AI to time every reply', async () => {
        await openChat([{ mes: 'Hello!', is_user: false, extra: {} }]);
        expect(st.context.chatMetadata['scenario_clock']).toMatchObject({
            start: '2026-11-25T13:07', startIndex: -1, pacing: [{ from: 0, mode: 'ai', minutes: 1 }],
        });
        expect(clockPrompt()).toContain('it is 1:07 PM on Wednesday, 25 November 2026 (afternoon), day 1');
        expect(clockPrompt()).toContain('End every reply with a time tag');
        expect(st.macros['scenario_time']?.()).toBe('1:07 PM');
        expect(document.getElementById('sillytweaks_clock_wand')?.textContent).toBe('Clock: Wed 25 Nov, 1:07 PM');
    });

    it("moves by the AI's tags; your message adds nothing; a swipe leaves out the reply it replaces", async () => {
        st.context.chat.push({ mes: 'Want to get dinner? I grab my coat.', is_user: true, extra: {} });
        await st.emit('message_sent', 1);
        expect(clockPrompt()).toContain('it is 1:07 PM');

        st.context.chat.push({ mes: '"Sure!" We walk to the restaurant. [TIME: +25m]', is_user: false, extra: {} });
        await st.emit('message_received', 2, 'normal');
        expect(clockPrompt()).toContain('it is 1:32 PM');

        await intercept('swipe');
        expect(clockPrompt()).toContain('it is 1:07 PM');
        expect(st.macros['scenario_time']?.()).toBe('1:07 PM');

        await st.emit('message_received', 2, 'swipe');
        expect(clockPrompt()).toContain('it is 1:32 PM');
    });

    it('switches Realism Mode from the options menu', async () => {
        const item = /** @type {HTMLElement} */ (document.getElementById('sillytweaks_realism_option'));
        item.click();
        expect(st.context.extensionSettings['sillytweaks']).toMatchObject({ realism: { enabled: true } });
        expect(realismPrompt()).toBe('(OOC: Realism mode, one line of dialogue and one action only, so it flows like a real conversation.)');
        expect(st.prompts['sillytweaks_realism']).toMatchObject({ position: 1, depth: 0, role: 0 });
        expect(item.getAttribute('aria-checked')).toBe('true');
        expect(document.getElementById('options_button')?.classList.contains('sillytweaks-realism-on')).toBe(true);
        expect(/** @type {HTMLInputElement} */ (document.querySelector('[data-setting="realism.enabled"]')).checked).toBe(true);
    });

    it('keeps instructions and Realism Mode out of quiet prompts like summaries', async () => {
        await intercept('quiet');
        expect(clockPrompt()).toContain('Story clock');
        expect(clockPrompt()).not.toContain('[TIME:');
        expect(realismPrompt()).toBe('');
        await intercept('normal');
        expect(clockPrompt()).toContain('End every reply');
        expect(realismPrompt()).toContain('OOC: Realism mode');
    });

    it('handles /realism', async () => {
        expect(await st.commands['realism']?.callback({}, 'status')).toBe('on');
        expect(await st.commands['realism']?.callback({}, 'off')).toBe('off');
        expect(realismPrompt()).toBe('');
        expect(document.getElementById('sillytweaks_realism_option')?.getAttribute('aria-checked')).toBe('false');
        expect(await st.commands['realism']?.callback({}, '')).toBe('on');
        expect(await st.commands['realism']?.callback({}, '')).toBe('off');
        await expect(st.commands['realism']?.callback({}, 'sometimes')).rejects.toThrow('/realism on');
    });

    it('handles /clock commands', async () => {
        expect(await st.commands['clock']?.callback({}, '')).toBe('Wednesday, 25 November 2026, 1:32 PM');
        expect(await st.commands['clock']?.callback({ quiet: 'true', format: 'time' }, '+1h')).toBe('2:32 PM');
        expect(await st.commands['clock-undo']?.callback({}, '')).toBe('2026-11-25T13:32');
        await expect(st.commands['clock-start']?.callback({}, 'next week')).rejects.toThrow('Use a date like');
        expect(await st.commands['clock-start']?.callback({}, '1889-10-04 18:00')).toBe('1889-10-04T18:00');
        expect(st.macros['scenario_weekday']?.()).toBe('Friday');
        await st.commands['clock-stop']?.callback({}, '');
        expect(clockPrompt()).toBe('');
        expect(st.macros['scenario_time']?.()).toBe('');
    });

    it('changes the clock from the wand menu', async () => {
        await openChat([{ mes: 'Hi', is_user: false, extra: {} }]);
        document.getElementById('sillytweaks_clock_wand')?.click();
        await vi.waitFor(() => expect(st.context.chat[0].extra).toEqual({ scenario_clock: { ops: ['+30m'] } }));
        expect(st.macros['scenario_time']?.()).toBe('1:37 PM');
    });

    it('applies a pacing change to the open chat from the next message on', async () => {
        const select = /** @type {HTMLSelectElement} */ (document.querySelector('[data-setting="clock.pacing"]'));
        select.value = 'length';
        select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(st.context.chatMetadata['scenario_clock']).toMatchObject({
            pacing: [{ from: 0, mode: 'ai' }, { from: 1, mode: 'length' }],
        }));
        expect(clockPrompt()).toContain('When time passes in your reply');
    });

    it('leaves existing chats alone until asked', async () => {
        await openChat([
            { mes: 'a', is_user: false, extra: {} },
            { mes: 'b', is_user: true, extra: {} },
        ]);
        expect(st.context.chatMetadata).toEqual({});
        expect(clockPrompt()).toBe('');
        expect(document.querySelector('[data-role="stopped"]')?.hasAttribute('hidden')).toBe(false);
    });

    it('warns when the old Scenario Clock extension is also installed', async () => {
        await st.emit('app_ready');
        expect(toastr.warning).not.toHaveBeenCalled();
        global.scenarioClockInterceptor = async () => {};
        await st.emit('app_ready');
        expect(toastr.warning).toHaveBeenCalledWith(expect.stringContaining('old Scenario Clock extension'), 'SillyTweaks');
        delete global.scenarioClockInterceptor;
    });

    it('stays out of the way if it is installed twice', async () => {
        const interceptor = global.sillyTweaksInterceptor;
        vi.resetModules();
        const second = await import('../index.js');
        await second.onActivate();
        expect(toastr.warning).toHaveBeenLastCalledWith(expect.stringContaining('installed twice'), 'SillyTweaks');
        expect(document.querySelectorAll('.sillytweaks-settings')).toHaveLength(1);
        expect(document.querySelectorAll('#sillytweaks_realism_option')).toHaveLength(1);
        expect(global.sillyTweaksInterceptor).toBe(interceptor);
    });
});

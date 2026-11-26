// @ts-check
/**
 * SillyTweaks: small additions to SillyTavern.
 *
 *  - Scenario Clock keeps the story's own date and time for each chat and tells the AI on every
 *    generation, so the time survives long chats and summaries.
 *  - Realism Mode asks for one line of dialogue and one action per reply.
 *
 * This file is the only one that talks to SillyTavern. SillyTavern loads it, then calls the
 * exported `onActivate` hook named in manifest.json. Verified against SillyTavern 1.19.
 */

import { createController } from './src/clock/controller.js';
import { createChatDecorator } from './src/clock/decorations.js';
import { MACROS } from './src/clock/prompt.js';
import { formatDuration, formatFull, formatShort, fromIso, fromLocalDate, toIso } from './src/clock/time.js';
import { timeAfter } from './src/clock/timeline.js';
import { SettingsPanel, describeChange } from './src/panel.js';
import { addMenuToggle, applyRealismPrompt, nextRealismState, showRealismState } from './src/realism.js';
import { SETTINGS_KEY, readSettings, withSetting } from './src/settings.js';

const LOG_PREFIX = '[SillyTweaks]';
const TEMPLATE_URL = new URL('./settings.html', import.meta.url);

/**
 * If the extension is installed twice (say, as "ScenarioClock" and "SillyTweaks"), only the copy
 * that loads first runs; the other just warns.
 */
const IS_DUPLICATE = Boolean(/** @type {any} */ (globalThis).sillyTweaks);

/** @returns {STContext} */
function ctx() {
    return SillyTavern.getContext();
}

function getSettings() {
    return readSettings(ctx().extensionSettings);
}

/**
 * @param {string} path e.g. 'clock.hour24'
 * @param {unknown} value
 */
function saveSetting(path, value) {
    const before = getSettings();
    const after = withSetting(before, path, value);
    ctx().extensionSettings[SETTINGS_KEY] = after;
    ctx().saveSettingsDebounced();
    if (after.clock.pacing !== before.clock.pacing || after.clock.minutesPerMessage !== before.clock.minutesPerMessage) {
        void syncPacing();
    }
    refreshAll();
}

const controller = createController({ getContext: () => ctx(), getSettings: () => getSettings().clock });

/** @type {SettingsPanel | null} */
let panel = null;
/** @type {ReturnType<typeof createChatDecorator> | null} */
let decorator = null;
/** @type {HTMLElement | null} */
let wandLabel = null;

/**
 * Runs just before SillyTavern builds each prompt (named in manifest.json). Swipes and quiet
 * generations need slightly different text, so it's worked out here rather than only on events.
 * @param {unknown[]} _chat
 * @param {number} _contextSize
 * @param {(immediately: boolean) => void} _abort
 * @param {string} [type]
 */
async function interceptor(_chat, _contextSize, _abort, type) {
    try {
        const generationType = type || 'normal';
        controller.setGenerationType(generationType);
        controller.updatePrompt(generationType);
        applyRealismPrompt(ctx().setExtensionPrompt, getSettings().realism, generationType);
    } catch (error) {
        console.error(LOG_PREFIX, 'Could not update the prompt', error);
    }
}

if (!IS_DUPLICATE) {
    globalThis.sillyTweaksInterceptor = interceptor;
    /** @type {any} */ (globalThis).sillyTweaks = {
        version: '0.2.0',
        clock: {
            /** The story time after the latest message, as "YYYY-MM-DDTHH:MM", or null. */
            now: () => {
                const state = controller.state();
                return state ? toIso(state.timeline.current) : null;
            },
            /** @param {number} index */
            timeAfterMessage: (index) => {
                const state = controller.state();
                return state ? toIso(timeAfter(ctx().chat, state.clock, index)) : null;
            },
            /** @param {string} text e.g. "+2h" */
            adjust: (text) => controller.adjust(text).finally(refreshAll),
        },
        realism: {
            isOn: () => getSettings().realism.enabled,
            /** @param {boolean} on */
            set: (on) => saveSetting('realism.enabled', Boolean(on)),
        },
    };
}

/**
 * @param {string} message
 * @param {'info' | 'success' | 'warning' | 'error'} [level]
 */
function notify(message, level = 'info') {
    const toastr = /** @type {Record<string, (text: string, title?: string, options?: object) => void> | undefined} */ (
        /** @type {any} */ (globalThis).toastr
    );
    const show = toastr?.[level];
    if (show) show(message, 'SillyTweaks');
    else console.log(LOG_PREFIX, message);
}

/**
 * A warning about how SillyTweaks is installed: it stays until it's clicked, since it shows up
 * while SillyTavern is still loading and would otherwise be easy to miss.
 * @param {string} message
 */
function warnUntilDismissed(message) {
    console.warn(LOG_PREFIX, message);
    const toastr = /** @type {any} */ (globalThis).toastr;
    toastr?.warning?.(message, 'SillyTweaks', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
}

/** @param {string} message */
async function confirmPopup(message) {
    const c = ctx();
    const result = await c.callGenericPopup(message, c.POPUP_TYPE.CONFIRM);
    return result === c.POPUP_RESULT.AFFIRMATIVE;
}

async function syncPacing() {
    try {
        await controller.syncPacing();
    } catch (error) {
        console.error(LOG_PREFIX, 'Could not update the pacing', error);
    }
}

function refreshAll() {
    try {
        const settings = getSettings();
        controller.updatePrompt();
        applyRealismPrompt(ctx().setExtensionPrompt, settings.realism, controller.getGenerationType());
        showRealismState(document, settings.realism.enabled);
        panel?.refresh();
        decorator?.refresh();
        refreshWand();
    } catch (error) {
        console.error(LOG_PREFIX, 'Refresh failed', error);
    }
}

/** What the chat decorations need: the time after each message, and how to show it. */
function chatView() {
    const settings = getSettings().clock;
    const state = settings.enabled ? controller.state() : null;
    return {
        enabled: settings.enabled,
        tagDisplay: settings.tagDisplay,
        times: state && settings.showOnMessages ? state.timeline.times : null,
        formatStamp: (/** @type {number} */ time, /** @type {number | null} */ previous) => {
            const moved = previous === null ? '' : ` (${time >= previous ? '+' : '-'}${formatDuration(time - previous)})`;
            return {
                text: formatShort(time, settings),
                title: `Story time after this message: ${formatFull(time, settings)}${moved}`,
            };
        },
    };
}

function refreshWand() {
    if (!wandLabel) return;
    const settings = getSettings().clock;
    const state = settings.enabled ? controller.state() : null;
    wandLabel.textContent = state ? `Clock: ${formatShort(state.timeline.current, settings)}` : 'Scenario Clock';
}

async function promptForChange() {
    const c = ctx();
    if (!controller.state()) {
        notify(controller.hasChat()
            ? "This chat doesn't have a clock yet. Start one in Extensions → SillyTweaks."
            : 'Open a chat first.', 'warning');
        return;
    }
    const answer = await c.callGenericPopup(
        'Move or set the story clock, e.g. <code>+2h</code>, <code>18:00</code>, <code>tomorrow 9am</code>, <code>2024-03-15 18:00</code>',
        c.POPUP_TYPE.INPUT,
        '',
        { okButton: 'Apply' },
    );
    if (typeof answer !== 'string' || !answer.trim()) return;
    try {
        const change = await controller.adjust(answer);
        notify(describeChange(change, getSettings().clock), 'success');
    } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
    }
    refreshAll();
}

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('sillytweaks_clock_wand')) return;
    const button = document.createElement('div');
    button.id = 'sillytweaks_clock_wand';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.tabIndex = 0;
    button.title = 'Move or set the story clock';
    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-clock extensionsMenuExtensionButton';
    wandLabel = document.createElement('span');
    button.append(icon, wandLabel);
    button.addEventListener('click', () => void promptForChange());
    menu.append(button);
    refreshWand();
}

function addRealismToggle() {
    const item = addMenuToggle(document, () => saveSetting('realism.enabled', !getSettings().realism.enabled));
    if (!item) console.warn(LOG_PREFIX, "Couldn't find SillyTavern's options menu for the Realism Mode switch");
}

function registerMacros() {
    const c = ctx();
    const useNewEngine = Boolean(c.powerUserSettings?.experimental_macro_engine && c.macros?.register);
    for (const [name, description] of Object.entries(MACROS)) {
        const handler = () => controller.currentMacroValues()?.[name] ?? '';
        try {
            if (useNewEngine) {
                c.macros.register(name, {
                    handler,
                    category: c.macros.category?.TIME ?? 'time',
                    description: `${description} Empty if the chat has no clock.`,
                    returns: 'Story time text',
                    exampleUsage: `{{${name}}}`,
                });
            } else {
                c.registerMacro(name, handler, description);
            }
        } catch (error) {
            console.warn(LOG_PREFIX, `Could not register {{${name}}}`, error);
        }
    }
}

function registerSlashCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'clock',
        callback: async (/** @type {Record<string, unknown>} */ args, /** @type {unknown} */ value) => {
            const text = String(value ?? '').trim();
            if (text) {
                const change = await controller.adjust(text);
                refreshAll();
                if (args['quiet'] !== 'true') notify(describeChange(change, getSettings().clock), 'success');
            }
            const values = controller.currentMacroValues();
            if (!values) return '';
            const format = String(args['format'] ?? 'datetime');
            return values[`scenario_${format}`] ?? values['scenario_datetime'] ?? '';
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'format',
                description: 'What to return',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'datetime',
                enumList: ['datetime', 'time', 'date', 'weekday', 'timeofday', 'day', 'iso'],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: "Don't show a notice when the clock moves",
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
                enumList: ['true', 'false'],
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Optional change: +2h, 18:00, tomorrow 9am, friday, 2024-03-15 18:00',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        returns: 'the story date and time',
        helpString: '<div>Returns the story date and time of the current chat. With a change, moves or sets the clock first, e.g. <code>/clock +2h</code>, <code>/clock 07:30</code>, <code>/clock 2024-03-15 18:00</code>.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'clock-start',
        callback: async (/** @type {Record<string, unknown>} */ _args, /** @type {unknown} */ value) => {
            const text = String(value ?? '').trim();
            const time = text && text.toLowerCase() !== 'now' ? fromIso(text) : fromLocalDate(new Date());
            if (time === null) throw new Error(`Use a date like 2024-03-14 21:42, not "${text}".`);
            await controller.start(time);
            refreshAll();
            return toIso(time);
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Date and time, e.g. 2024-03-14 21:42, or "now" for the real date and time',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        returns: 'the start time',
        helpString: '<div>Starts (or restarts) the story clock of the current chat at the given date and time, as of the latest message. Example: <code>/clock-start 1889-10-04 18:00</code>.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'clock-undo',
        callback: async () => {
            const change = await controller.undo();
            refreshAll();
            return change ? toIso(change.after) : '';
        },
        returns: 'the story time after undoing',
        helpString: '<div>Takes back the last manual clock change made after the latest message.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'clock-stop',
        callback: async () => {
            await controller.stop();
            refreshAll();
            return '';
        },
        helpString: '<div>Removes the story clock from the current chat. The AI is no longer told the time there.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'realism',
        callback: async (/** @type {Record<string, unknown>} */ _args, /** @type {unknown} */ value) => {
            const current = getSettings().realism.enabled;
            const next = nextRealismState(String(value ?? ''), current);
            if (next === null) throw new Error('Use /realism on, /realism off, /realism toggle or /realism status.');
            if (next !== current) {
                saveSetting('realism.enabled', next);
                notify(`Realism Mode ${next ? 'on' : 'off'}.`, 'info');
            }
            return next ? 'on' : 'off';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'on, off, toggle (the default) or status',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                enumList: ['on', 'off', 'toggle', 'status'],
            }),
        ],
        returns: '"on" or "off"',
        helpString: '<div>Turns Realism Mode on or off: each reply is asked for one line of dialogue and one action. With no argument, switches it. <code>/realism status</code> only reports it.</div>',
    }));
}

/**
 * @param {STContext} c
 * @param {string} key
 * @param {string} fallback
 * @param {(...args: any[]) => unknown} listener
 */
function on(c, key, fallback, listener) {
    c.eventSource.on(c.eventTypes[key] ?? fallback, listener);
}

function bindEvents() {
    const c = ctx();

    on(c, 'CHAT_CHANGED', 'chat_id_changed', async () => {
        controller.setGenerationType(null);
        try {
            await controller.repair();
            if (await controller.autoStart()) console.debug(LOG_PREFIX, 'Started a clock for the new chat');
            await controller.syncPacing();
        } catch (error) {
            console.error(LOG_PREFIX, error);
        }
        refreshAll();
    });

    on(c, 'MESSAGE_DELETED', 'message_deleted', async () => {
        try {
            await controller.repair();
        } catch (error) {
            console.error(LOG_PREFIX, error);
        }
        refreshAll();
    });

    const refreshEvents = [
        ['MESSAGE_SENT', 'message_sent'],
        ['MESSAGE_EDITED', 'message_edited'],
        ['MESSAGE_UPDATED', 'message_updated'],
        ['MESSAGE_SWIPED', 'message_swiped'],
        ['MESSAGE_SWIPE_DELETED', 'message_swipe_deleted'],
        ['MORE_MESSAGES_LOADED', 'more_messages_loaded'],
    ];
    for (const [key, fallback] of refreshEvents) on(c, key ?? '', fallback ?? '', refreshAll);

    // A reply has arrived or generation ended: later prompts count every message again.
    const generationOver = [
        ['MESSAGE_RECEIVED', 'message_received'],
        ['GENERATION_ENDED', 'generation_ended'],
        ['GENERATION_STOPPED', 'generation_stopped'],
    ];
    for (const [key, fallback] of generationOver) {
        on(c, key ?? '', fallback ?? '', () => {
            controller.setGenerationType(null);
            refreshAll();
        });
    }

    on(c, 'APP_READY', 'app_ready', warnAboutOldScenarioClock);
}

/** Scenario Clock 0.1 (this extension's old name) would run alongside and double everything up. */
function warnAboutOldScenarioClock() {
    if (typeof (/** @type {any} */ (globalThis).scenarioClockInterceptor) !== 'function') return;
    warnUntilDismissed('The old Scenario Clock extension is also installed. SillyTweaks includes it, so delete Scenario Clock in Extensions → Manage extensions.');
}

async function mountPanel() {
    const container = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!container) return;
    const response = await fetch(TEMPLATE_URL);
    const html = await response.text();
    panel = new SettingsPanel({
        controller,
        getSettings,
        saveSetting,
        onClockChanged: refreshAll,
        notify,
        confirm: confirmPopup,
    });
    panel.mount(container, html);
}

function startDecorator() {
    const chat = document.getElementById('chat');
    if (!chat) return;
    decorator = createChatDecorator({ root: chat, getView: chatView });
    decorator.start();
}

/** Hook named in manifest.json; SillyTavern calls it once the extension has loaded. */
export async function onActivate() {
    if (IS_DUPLICATE) {
        warnUntilDismissed('SillyTweaks is installed twice. Delete one copy in Extensions → Manage extensions.');
        return;
    }
    const c = ctx();
    const firstRun = !(SETTINGS_KEY in c.extensionSettings);
    c.extensionSettings[SETTINGS_KEY] = getSettings();
    if (firstRun) c.saveSettingsDebounced();

    try {
        await mountPanel();
    } catch (error) {
        console.error(LOG_PREFIX, 'Could not show the settings panel', error);
    }
    startDecorator();
    addWandButton();
    addRealismToggle();
    bindEvents();
    try {
        registerSlashCommands();
    } catch (error) {
        console.error(LOG_PREFIX, 'Could not add slash commands', error);
    }
    registerMacros();
    refreshAll();
    console.log(LOG_PREFIX, 'Loaded.');
}

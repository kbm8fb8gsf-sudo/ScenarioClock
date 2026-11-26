// @ts-check
/**
 * SillyTweaks settings, kept in SillyTavern's extensionSettings.sillytweaks as
 * { clock: {...}, realism: {...} }.
 */

import { PACING_MODES } from './clock/pacing.js';
import { fromIso } from './clock/time.js';

export const SETTINGS_KEY = 'sillytweaks';
/** Where Scenario Clock 0.1 kept its (flat) settings. */
export const LEGACY_CLOCK_KEY = 'scenario_clock';

export const DEFAULT_CLOCK_PROMPT = '[Story clock: it is {{scenario_time}} on {{scenario_weekday}}, {{scenario_date}} '
    + '({{scenario_timeofday}}), day {{scenario_day}} of the story. This is the correct current time and date; '
    + 'it overrides any other time or date in the chat history or its summaries.]';

/** Tag instructions when the AI only marks time skips. */
export const DEFAULT_TAG_HELP = 'When time passes in your reply (a scene change, travel, waiting, sleeping), '
    + 'mark it with a time tag at that point: [TIME: +20m], [TIME: +3h] or [TIME: +2d] moves the clock forward '
    + 'by that much, and [TIME: 07:30] jumps to the next 7:30. Give only the change; the clock works out the '
    + 'new date. A quick exchange of dialogue needs no tag. Never move time backwards.';

/** Tag instructions when the AI says how much time every reply takes. */
export const DEFAULT_TAG_EVERY = 'End every reply with a time tag that moves the clock to the end of your reply, '
    + "counting everything since your previous reply, including {{user}}'s actions: about [TIME: +1m] for a few "
    + 'quick lines, [TIME: +15m] for a longer scene or task, [TIME: +3h] or [TIME: 07:30] (the next 7:30) for a '
    + 'time skip. Judge it from what actually happens. Give only the change; the clock works out the new date. '
    + 'Never move time backwards.';

export const DEFAULT_REALISM_PROMPT = '(OOC: Realism mode, one line of dialogue and one action only, '
    + 'so it flows like a real conversation.)';

/**
 * @typedef {object} ClockSettings
 * @property {boolean} enabled
 * @property {boolean} autoStart Start a clock in every new chat.
 * @property {'real' | 'fixed'} startMode New clocks start at the real date and time, or at `fixedStart`.
 * @property {string} fixedStart "YYYY-MM-DDTHH:MM"
 * @property {import('./clock/pacing.js').PacingMode} pacing How messages without a tag move the clock.
 * @property {number} minutesPerMessage For the "fixed" pacing.
 * @property {boolean} aiTags With "length" or "fixed" pacing: ask the AI to mark time skips with tags.
 *   (The "ai" pacing always asks for a tag in every reply.)
 * @property {'hide' | 'badge' | 'raw'} tagDisplay How tags look in the chat.
 * @property {boolean} showOnMessages Show the story time in each message's header.
 * @property {boolean} hour24
 * @property {'dmy' | 'mdy'} dateOrder
 * @property {'chat' | 'after' | 'before'} position In the chat at `depth`, after the main prompt, or before it.
 * @property {number} depth
 * @property {Role} role
 * @property {string} promptTemplate
 * @property {string} tagTemplate Instructions for marking time skips.
 * @property {string} tagEveryTemplate Instructions for tagging every reply.
 */

/**
 * @typedef {object} RealismSettings
 * @property {boolean} enabled
 * @property {string} prompt
 * @property {number} depth
 * @property {Role} role
 */

/** @typedef {'system' | 'user' | 'assistant'} Role */
/** @typedef {{ clock: ClockSettings, realism: RealismSettings }} Settings */

/** @type {Readonly<ClockSettings>} */
export const DEFAULT_CLOCK_SETTINGS = Object.freeze({
    enabled: true,
    autoStart: true,
    startMode: 'real',
    fixedStart: '2025-06-01T09:00',
    pacing: 'ai',
    minutesPerMessage: 1,
    aiTags: true,
    tagDisplay: 'hide',
    showOnMessages: true,
    hour24: false,
    dateOrder: 'dmy',
    position: 'chat',
    depth: 0,
    role: 'system',
    promptTemplate: DEFAULT_CLOCK_PROMPT,
    tagTemplate: DEFAULT_TAG_HELP,
    tagEveryTemplate: DEFAULT_TAG_EVERY,
});

/** @type {Readonly<RealismSettings>} */
export const DEFAULT_REALISM_SETTINGS = Object.freeze({
    enabled: false,
    prompt: DEFAULT_REALISM_PROMPT,
    depth: 0,
    role: 'system',
});

/** SillyTavern's extension_prompt_types. */
export const POSITION_VALUES = { after: 0, chat: 1, before: 2 };
/** SillyTavern's extension_prompt_roles. */
export const ROLE_VALUES = { system: 0, user: 1, assistant: 2 };

/** @type {readonly Role[]} */
const ROLES = ['system', 'user', 'assistant'];

/**
 * Fills in anything missing or invalid with the default.
 * @param {unknown} raw
 * @returns {ClockSettings}
 */
export function normalizeClockSettings(raw) {
    const input = record(raw);
    const d = DEFAULT_CLOCK_SETTINGS;
    return {
        enabled: bool(input['enabled'], d.enabled),
        autoStart: bool(input['autoStart'], d.autoStart),
        startMode: oneOf(input['startMode'], ['real', 'fixed'], d.startMode),
        fixedStart: fromIso(input['fixedStart']) === null ? d.fixedStart : String(input['fixedStart']).trim(),
        pacing: oneOf(input['pacing'], PACING_MODES, d.pacing),
        minutesPerMessage: number(input['minutesPerMessage'], d.minutesPerMessage, 0, 24 * 60),
        aiTags: bool(input['aiTags'], d.aiTags),
        tagDisplay: oneOf(input['tagDisplay'], ['hide', 'badge', 'raw'], d.tagDisplay),
        showOnMessages: bool(input['showOnMessages'], d.showOnMessages),
        hour24: bool(input['hour24'], d.hour24),
        dateOrder: oneOf(input['dateOrder'], ['dmy', 'mdy'], d.dateOrder),
        position: oneOf(input['position'], ['chat', 'after', 'before'], d.position),
        depth: Math.round(number(input['depth'], d.depth, 0, 10000)),
        role: oneOf(input['role'], ROLES, d.role),
        promptTemplate: text(input['promptTemplate'], d.promptTemplate),
        tagTemplate: text(input['tagTemplate'], d.tagTemplate),
        tagEveryTemplate: text(input['tagEveryTemplate'], d.tagEveryTemplate),
    };
}

/**
 * @param {unknown} raw
 * @returns {RealismSettings}
 */
export function normalizeRealismSettings(raw) {
    const input = record(raw);
    const d = DEFAULT_REALISM_SETTINGS;
    return {
        enabled: bool(input['enabled'], d.enabled),
        prompt: text(input['prompt'], d.prompt),
        depth: Math.round(number(input['depth'], d.depth, 0, 10000)),
        role: oneOf(input['role'], ROLES, d.role),
    };
}

/**
 * @param {unknown} raw
 * @returns {Settings}
 */
export function normalizeSettings(raw) {
    const input = record(raw);
    return { clock: normalizeClockSettings(input['clock']), realism: normalizeRealismSettings(input['realism']) };
}

/**
 * Reads the settings from SillyTavern's extensionSettings, taking over Scenario Clock 0.1's
 * settings the first time.
 * @param {Record<string, unknown>} extensionSettings
 * @returns {Settings}
 */
export function readSettings(extensionSettings) {
    const current = extensionSettings[SETTINGS_KEY];
    if (current && typeof current === 'object') return normalizeSettings(current);
    const legacy = extensionSettings[LEGACY_CLOCK_KEY];
    return normalizeSettings({ clock: legacy && typeof legacy === 'object' ? legacy : {} });
}

/**
 * Returns new settings with one value changed, e.g. withSetting(s, 'clock.hour24', true).
 * Unknown paths are ignored.
 * @param {Settings} settings
 * @param {string} path
 * @param {unknown} value
 * @returns {Settings}
 */
export function withSetting(settings, path, value) {
    const [section, key] = path.split('.');
    if ((section !== 'clock' && section !== 'realism') || !key || !(key in settings[section])) return settings;
    return normalizeSettings({ ...settings, [section]: { ...settings[section], [key]: value } });
}

/**
 * Reads a value by path, e.g. 'clock.hour24'.
 * @param {Settings} settings
 * @param {string} path
 * @returns {unknown}
 */
export function settingAt(settings, path) {
    const [section, key] = path.split('.');
    if (section !== 'clock' && section !== 'realism') return undefined;
    return key ? /** @type {Record<string, unknown>} */ (settings[section])[key] : undefined;
}

/** @param {unknown} value */
function record(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 */
function text(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function number(value, fallback, min, max) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * @template {string} T
 * @param {unknown} value
 * @param {readonly T[]} options
 * @param {T} fallback
 * @returns {T}
 */
function oneOf(value, options, fallback) {
    return options.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;
}

// @ts-check
/**
 * The clock is worked out from the chat itself every time, never cached:
 *
 *   start time  →  message → message → message → ... → the time now
 *
 * Each message moves the clock by its [TIME: ...] tags or, if it has none, by its pacing (see
 * pacing.js), then by any manual changes the user made after it. Because nothing is cached,
 * deleting, editing, swiping, branching and hiding messages all keep the clock right with no
 * extra bookkeeping.
 *
 * Per chat, chatMetadata.scenario_clock holds where the clock starts and the pacing history.
 * Manual changes live in the message they were made after (extra.scenario_clock.ops), so they
 * follow that message around.
 */

import { applyInstruction, parseInstruction } from './instructions.js';
import { isPacingMode, untaggedSeconds } from './pacing.js';
import { findTags } from './tags.js';
import { SECOND, fromIso, toIso } from './time.js';

export const META_KEY = 'scenario_clock';
export const EXTRA_KEY = 'scenario_clock';

/**
 * @typedef {object} ChatMessageLike
 * @property {string} [mes]
 * @property {boolean} [is_user]
 * @property {boolean} [is_system]
 * @property {number} [swipe_id]
 * @property {Array<{ extra?: Record<string, unknown> } | undefined>} [swipe_info]
 * @property {Record<string, unknown>} [extra]
 */

/** @typedef {import('./pacing.js').Pacing} Pacing */
/** @typedef {Pacing & { from: number }} PacingFrom */

/**
 * @typedef {object} ChatClock
 * @property {number} start The time just after message `startIndex`.
 * @property {number} startIndex -1 means the clock starts before the first message, so the
 *   opening message's own tags count. Messages up to this index have no time of their own.
 * @property {PacingFrom[]} pacing How untagged messages move the clock, from message `from`
 *   onwards. Sorted by `from`. A change only affects later messages.
 */

/**
 * @typedef {object} Timeline
 * @property {(number | null)[]} times The time after each message, or null if it's before the clock started.
 * @property {number} origin Day 1 of the story.
 * @property {number} current The time after the last message.
 */

/** @type {Pacing} */
const LEGACY_PACING = { mode: 'fixed', minutes: 1 };

/**
 * @param {unknown} raw chatMetadata.scenario_clock
 * @returns {ChatClock | null}
 */
export function readClock(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (raw);
    const start = fromIso(record['start']);
    if (start === null) return null;
    const startIndex = Number.isInteger(record['startIndex']) ? Math.max(-1, Number(record['startIndex'])) : -1;

    // Clocks from Scenario Clock 0.1 stored fixed minutes-per-message as "rates".
    const entries = Array.isArray(record['pacing'])
        ? record['pacing']
        : Array.isArray(record['rates'])
            ? record['rates'].map((rate) => ({ ...rate, mode: 'fixed' }))
            : [];
    /** @type {PacingFrom[]} */
    const pacing = [];
    for (const entry of entries) {
        const from = Number(entry?.from);
        const minutes = Number(entry?.minutes ?? 0);
        if (!Number.isInteger(from) || from < 0 || !Number.isFinite(minutes) || minutes < 0) continue;
        pacing.push({ from, mode: isPacingMode(entry?.mode) ? entry.mode : 'fixed', minutes });
    }
    pacing.sort((a, b) => a.from - b.from);
    if (pacing.length === 0) pacing.push({ from: 0, ...LEGACY_PACING });
    return { start, startIndex, pacing };
}

/**
 * The form saved in chat metadata.
 * @param {ChatClock} clock
 */
export function writeClock(clock) {
    return {
        start: toIso(clock.start),
        startIndex: clock.startIndex,
        pacing: clock.pacing.map(({ from, mode, minutes }) => ({ from, mode, minutes })),
    };
}

/**
 * @param {number} start
 * @param {number} startIndex
 * @param {Pacing} pacing
 * @returns {ChatClock}
 */
export function newClock(start, startIndex, pacing) {
    return { start, startIndex, pacing: [{ from: 0, mode: pacing.mode, minutes: pacing.minutes }] };
}

/**
 * The pacing in force for message `index`.
 * @param {ChatClock} clock
 * @param {number} index
 * @returns {Pacing}
 */
export function pacingAt(clock, index) {
    /** @type {Pacing} */
    let current = LEGACY_PACING;
    for (const entry of clock.pacing) {
        if (entry.from > index) break;
        current = { mode: entry.mode, minutes: entry.minutes };
    }
    return current;
}

/**
 * Changes the pacing from message `from` onwards, leaving earlier messages as they were.
 * @param {ChatClock} clock
 * @param {number} from
 * @param {Pacing} pacing
 * @returns {ChatClock}
 */
export function withPacing(clock, from, pacing) {
    const kept = clock.pacing.filter((entry) => entry.from < from);
    return { ...clock, pacing: [...kept, { from: Math.max(0, from), mode: pacing.mode, minutes: pacing.minutes }] };
}

/**
 * After messages are deleted (or in a branch made from an earlier message), anything pointing
 * past the end of the chat is pulled back, so new messages there aren't skipped.
 * @param {ChatClock} clock
 * @param {number} chatLength
 * @returns {ChatClock | null} The fixed clock, or null if nothing needed changing.
 */
export function clampClock(clock, chatLength) {
    const startIndex = Math.min(clock.startIndex, chatLength - 1);
    const beyond = clock.pacing.filter((entry) => entry.from > chatLength);
    const latest = beyond[beyond.length - 1];
    const pacing = latest
        ? [...clock.pacing.filter((entry) => entry.from < chatLength), { ...latest, from: chatLength }]
        : clock.pacing;
    if (startIndex === clock.startIndex && !latest) return null;
    return { ...clock, startIndex, pacing };
}

/**
 * Messages SillyTavern adds itself (help, comments, tool calls) don't move the clock.
 * Narrator messages (/sys) do: they're part of the story.
 * @param {ChatMessageLike} message
 */
export function isStoryMessage(message) {
    const type = message.extra?.['type'];
    if (typeof type === 'string' && type !== 'narrator') return false;
    return !Array.isArray(message.extra?.['tool_invocations']);
}

/**
 * Manual changes made after this message.
 * @param {ChatMessageLike} message
 * @returns {string[]}
 */
export function manualOps(message) {
    const record = message.extra?.[EXTRA_KEY];
    if (!record || typeof record !== 'object') return [];
    const ops = /** @type {Record<string, unknown>} */ (record)['ops'];
    return Array.isArray(ops) ? ops.filter((op) => typeof op === 'string') : [];
}

/**
 * The time after a message, given the time before it.
 * @param {ChatMessageLike} message
 * @param {number} index
 * @param {number} before
 * @param {ChatClock} clock
 */
export function advance(message, index, before, clock) {
    let time = before;
    if (isStoryMessage(message)) {
        const tags = findTags(message.mes);
        if (tags.length > 0) {
            for (const tag of tags) time = applyInstruction(tag.parsed, time) ?? time;
        } else {
            time += untaggedSeconds(message, index, pacingAt(clock, index)) * SECOND;
        }
    }
    for (const op of manualOps(message)) {
        const instruction = parseInstruction(op);
        if (instruction) time = applyInstruction(instruction, time) ?? time;
    }
    return time;
}

/**
 * @param {ChatMessageLike[]} chat
 * @param {ChatClock} clock
 * @returns {Timeline}
 */
export function buildTimeline(chat, clock) {
    /** @type {(number | null)[]} */
    const times = [];
    let time = clock.start;
    for (let index = 0; index < chat.length; index++) {
        const message = chat[index];
        if (index < clock.startIndex || !message) {
            times.push(null);
        } else if (index === clock.startIndex) {
            times.push(clock.start);
        } else {
            time = advance(message, index, time, clock);
            times.push(time);
        }
    }
    const first = clock.startIndex === -1 ? times[0] : null;
    return { times, origin: first ?? clock.start, current: time };
}

/**
 * The time just after message `index` (-1: before the first message).
 * @param {ChatMessageLike[]} chat
 * @param {ChatClock} clock
 * @param {number} index
 */
export function timeAfter(chat, clock, index) {
    if (index <= clock.startIndex) return clock.start;
    return buildTimeline(chat.slice(0, index + 1), clock).current;
}

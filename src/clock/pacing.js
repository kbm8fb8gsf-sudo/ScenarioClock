// @ts-check
/**
 * How the clock moves for a message with no [TIME: ...] tag ("pacing"):
 *
 *   ai      The AI is asked to end every reply with a tag saying how much time it took. Your own
 *           messages add nothing, because the AI's next tag covers them. A reply that forgot its
 *           tag falls back to an estimate from its length.
 *   length  Every message adds roughly the time it takes to say and do what it describes, so a
 *           long reply moves the clock more than a quick one.
 *   fixed   Every message adds the same number of minutes.
 */

import { TAG_SOURCE } from './tags.js';

/** @typedef {'ai' | 'length' | 'fixed'} PacingMode */
/** @typedef {{ mode: PacingMode, minutes: number }} Pacing */

/** @type {readonly PacingMode[]} */
export const PACING_MODES = ['ai', 'length', 'fixed'];

/** A relaxed speaking pace, which leaves a little room for the actions in between. */
export const WORDS_PER_MINUTE = 120;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Reasoning a model left in its reply; it isn't part of the story. */
const REASONING = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

/**
 * Roughly how many seconds a message's words take to play out. Time tags, HTML and any
 * <think> reasoning don't count. Chinese and Japanese characters count as half a word each.
 * @param {unknown} text
 */
export function estimateSeconds(text) {
    if (typeof text !== 'string' || text === '') return 0;
    const plain = text
        .replace(REASONING, ' ')
        .replace(new RegExp(TAG_SOURCE, 'gi'), ' ')
        .replace(/<[^<>]*>/g, ' ');
    const cjk = plain.match(CJK)?.length ?? 0;
    const words = plain.replace(CJK, ' ').match(WORD)?.length ?? 0;
    return Math.round(((words + cjk / 2) / WORDS_PER_MINUTE) * 60);
}

/**
 * Seconds a message adds when it has no tag. The opening message adds nothing: the clock's
 * start time is when the story opens.
 * @param {{ mes?: string, is_user?: boolean }} message
 * @param {number} index
 * @param {Pacing} pacing
 */
export function untaggedSeconds(message, index, pacing) {
    if (index === 0) return 0;
    switch (pacing.mode) {
        case 'fixed':
            return Math.round(pacing.minutes * 60);
        case 'length':
            return estimateSeconds(message.mes);
        case 'ai':
            return message.is_user ? 0 : estimateSeconds(message.mes);
    }
    return 0;
}

/**
 * @param {Pacing} a
 * @param {Pacing} b
 */
export function samePacing(a, b) {
    return a.mode === b.mode && (a.mode !== 'fixed' || a.minutes === b.minutes);
}

/**
 * @param {unknown} value
 * @returns {value is PacingMode}
 */
export function isPacingMode(value) {
    return PACING_MODES.includes(/** @type {PacingMode} */ (value));
}

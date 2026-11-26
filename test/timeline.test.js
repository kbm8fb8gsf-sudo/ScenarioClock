import { describe, expect, it } from 'vitest';
import { findTags } from '../src/clock/tags.js';
import { fromIso, toIso } from '../src/clock/time.js';
import {
    buildTimeline, clampClock, newClock, pacingAt, readClock, timeAfter, withPacing, writeClock,
} from '../src/clock/timeline.js';

const START = /** @type {number} */ (fromIso('2024-03-14T21:00'));
/** @type {import('../src/clock/pacing.js').Pacing} */
const FIXED_1 = { mode: 'fixed', minutes: 1 };

/**
 * @param {string} mes
 * @param {Record<string, unknown>} [extra]
 */
function msg(mes, extra = {}) {
    return { mes, is_user: false, extra };
}

/** @param {string} mes */
function user(mes) {
    return { mes, is_user: true, extra: {} };
}

/** @param {(number | null)[]} times */
function iso(times) {
    return times.map((t) => (t === null ? null : toIso(t)));
}

/** Words of filler text. @param {number} count */
function words(count) {
    return Array.from({ length: count }, () => 'word').join(' ');
}

describe('findTags', () => {
    it('finds valid tags in order, case-insensitively', () => {
        const tags = findTags('She waits. [TIME: +2h] Later... [time:07:30] Morning. [TIME: whenever]');
        expect(tags.map((t) => t.instruction)).toEqual(['+2h', '07:30']);
        expect(tags[0]?.raw).toBe('[TIME: +2h]');
    });

    it('ignores text without tags', () => {
        expect(findTags('No time here [OOC: hi]')).toEqual([]);
        expect(findTags(undefined)).toEqual([]);
    });
});

describe('buildTimeline', () => {
    it('folds tags, adds the fixed minutes, and skips the opening message', () => {
        const clock = newClock(START, -1, { mode: 'fixed', minutes: 2 });
        const chat = [
            msg('Hello there.'),
            user('Hi!'),
            msg('[TIME: +3h] Hours later...'),
            msg('[TIME: tomorrow 08:00] Morning.'),
        ];
        expect(iso(buildTimeline(chat, clock).times)).toEqual([
            '2024-03-14T21:00', '2024-03-14T21:02', '2024-03-15T00:02', '2024-03-15T08:00',
        ]);
    });

    it('lets a tag in the greeting set the scene and day 1', () => {
        const clock = newClock(START, -1, FIXED_1);
        const timeline = buildTimeline([msg('[TIME: 1889-10-04 18:00] Fog rolls in.'), msg('Hm.')], clock);
        expect(toIso(timeline.origin)).toBe('1889-10-04T18:00');
        expect(toIso(timeline.current)).toBe('1889-10-04T18:01');
    });

    it("doesn't move for SillyTavern's own notices, but does for narrator messages", () => {
        const clock = newClock(START, -1, { mode: 'fixed', minutes: 5 });
        const chat = [
            msg('Start'),
            { mes: 'Help text with [TIME: +9h] as an example', is_system: true, extra: { type: 'help' } },
            { mes: 'The rain stops. [TIME: +1h]', is_system: false, extra: { type: 'narrator' } },
            { mes: '', extra: { tool_invocations: [] } },
        ];
        expect(iso(buildTimeline(chat, clock).times)).toEqual([
            '2024-03-14T21:00', '2024-03-14T21:00', '2024-03-14T22:00', '2024-03-14T22:00',
        ]);
    });

    it('counts hidden messages, since the story still happened', () => {
        const clock = newClock(START, -1, FIXED_1);
        const chat = [msg('Start'), { mes: '[TIME: +1h]', is_system: true, extra: {} }];
        expect(toIso(buildTimeline(chat, clock).current)).toBe('2024-03-14T22:00');
    });

    it('applies manual changes after the message they were made on', () => {
        const clock = newClock(START, -1, FIXED_1);
        const chat = [msg('Start'), msg('[TIME: +1h] ok', { scenario_clock: { ops: ['+30m', '07:00'] } })];
        expect(toIso(buildTimeline(chat, clock).current)).toBe('2024-03-15T07:00');
    });

    it('ignores messages from before the clock started', () => {
        const clock = newClock(START, 1, FIXED_1);
        const chat = [msg('[TIME: +5d]'), msg('[TIME: +5d]'), msg('[TIME: +1h]')];
        expect(iso(buildTimeline(chat, clock).times)).toEqual([null, '2024-03-14T21:00', '2024-03-14T22:00']);
        expect(toIso(buildTimeline(chat, clock).origin)).toBe('2024-03-14T21:00');
    });

    it('rolls back when messages are removed, with nothing to clean up', () => {
        const clock = newClock(START, -1, FIXED_1);
        const chat = [msg('a'), msg('[TIME: +8h]'), msg('b')];
        expect(toIso(buildTimeline(chat, clock).current)).toBe('2024-03-15T05:01');
        expect(toIso(buildTimeline(chat.slice(0, 1), clock).current)).toBe('2024-03-14T21:00');
    });
});

describe('pacing', () => {
    it('by length: longer messages move the clock more', () => {
        const clock = newClock(START, -1, { mode: 'length', minutes: 1 });
        const chat = [msg('Opening'), user(words(30)), msg(words(240)), user('Hi')];
        const times = buildTimeline(chat, clock).times;
        // 30 words = 15 s, 240 words = 2 min, "Hi" = 1 s.
        expect(((times[1] ?? 0) - START) / 1000).toBe(15);
        expect(((times[2] ?? 0) - (times[1] ?? 0)) / 1000).toBe(120);
        expect(((times[3] ?? 0) - (times[2] ?? 0)) / 1000).toBe(1);
    });

    it("AI mode: the AI's tag covers your message; an untagged reply is timed by its length", () => {
        const clock = newClock(START, -1, { mode: 'ai', minutes: 1 });
        const chat = [
            msg('Opening'),
            user(words(240)),
            msg(`${words(120)} [TIME: +5m]`),
            user('ok'),
            msg(words(240)),
        ];
        expect(iso(buildTimeline(chat, clock).times)).toEqual([
            '2024-03-14T21:00', '2024-03-14T21:00', '2024-03-14T21:05', '2024-03-14T21:05', '2024-03-14T21:07',
        ]);
    });

    it('never moves earlier messages when the pacing changes', () => {
        const clock = withPacing(newClock(START, -1, FIXED_1), 3, { mode: 'fixed', minutes: 10 });
        const chat = [msg('a'), msg('b'), msg('c'), msg('d'), msg('e')];
        expect(iso(buildTimeline(chat, clock).times)).toEqual([
            '2024-03-14T21:00', '2024-03-14T21:01', '2024-03-14T21:02', '2024-03-14T21:12', '2024-03-14T21:22',
        ]);
        expect(pacingAt(clock, 2)).toEqual(FIXED_1);
        expect(pacingAt(clock, 3)).toEqual({ mode: 'fixed', minutes: 10 });
    });

    it('can switch between modes partway through a chat', () => {
        const clock = withPacing(newClock(START, -1, FIXED_1), 2, { mode: 'ai', minutes: 1 });
        const chat = [msg('a'), user('b'), user('c'), msg('[TIME: +1h]')];
        expect(iso(buildTimeline(chat, clock).times)).toEqual([
            '2024-03-14T21:00', '2024-03-14T21:01', '2024-03-14T21:01', '2024-03-14T22:01',
        ]);
    });
});

describe('timeAfter', () => {
    it('gives the time after any message, or the start before the first', () => {
        const clock = newClock(START, -1, FIXED_1);
        const chat = [msg('a'), msg('[TIME: +1h]'), msg('[TIME: +1h]')];
        expect(toIso(timeAfter(chat, clock, -1))).toBe('2024-03-14T21:00');
        expect(toIso(timeAfter(chat, clock, 1))).toBe('2024-03-14T22:00');
        expect(toIso(timeAfter(chat, clock, 2))).toBe('2024-03-14T23:00');
    });
});

describe('clock records', () => {
    it('round-trips through chat metadata', () => {
        const clock = withPacing(newClock(START, 4, FIXED_1), 9, { mode: 'ai', minutes: 1 });
        expect(readClock(writeClock(clock))).toEqual(clock);
        expect(writeClock(clock)).toEqual({
            start: '2024-03-14T21:00',
            startIndex: 4,
            pacing: [{ from: 0, mode: 'fixed', minutes: 1 }, { from: 9, mode: 'ai', minutes: 1 }],
        });
    });

    it('reads clocks saved by Scenario Clock 0.1', () => {
        const old = { start: '2024-03-14T21:00', startIndex: -1, rates: [{ from: 0, minutes: 1 }, { from: 5, minutes: 3 }] };
        expect(readClock(old)?.pacing).toEqual([
            { from: 0, mode: 'fixed', minutes: 1 },
            { from: 5, mode: 'fixed', minutes: 3 },
        ]);
    });

    it('rejects broken records and repairs broken pacing', () => {
        expect(readClock(null)).toBeNull();
        expect(readClock({ start: 'soon' })).toBeNull();
        expect(readClock({ start: '2024-03-14T21:00', startIndex: 'x', pacing: [{ from: -1, mode: 'ai' }, { from: 2, mode: 'weird', minutes: 2 }] }))
            .toEqual({ start: START, startIndex: -1, pacing: [{ from: 2, mode: 'fixed', minutes: 2 }] });
    });

    it('pulls the start and pacing changes back after deletions', () => {
        const clock = withPacing(newClock(START, 10, FIXED_1), 12, { mode: 'length', minutes: 1 });
        expect(clampClock(clock, 20)).toBeNull();
        expect(clampClock(clock, 6)).toEqual({
            start: START,
            startIndex: 5,
            pacing: [{ from: 0, mode: 'fixed', minutes: 1 }, { from: 6, mode: 'length', minutes: 1 }],
        });
    });
});

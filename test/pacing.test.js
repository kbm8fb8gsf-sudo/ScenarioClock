import { describe, expect, it } from 'vitest';
import { estimateSeconds, isPacingMode, samePacing, untaggedSeconds } from '../src/clock/pacing.js';

describe('estimateSeconds', () => {
    it('allows about two words a second', () => {
        expect(estimateSeconds('one two three four')).toBe(2);
        expect(estimateSeconds(Array.from({ length: 120 }, () => 'word').join(' '))).toBe(60);
    });

    it("doesn't count time tags, HTML or punctuation", () => {
        expect(estimateSeconds('[TIME: +2h] *She nods.* "Yes." <br> <font color="red">ok</font> — !!!')).toBe(2);
    });

    it('ignores reasoning the model left in its reply', () => {
        expect(estimateSeconds('<think>Let me plan this reply carefully first.</think>She waves.')).toBe(1);
    });

    it("counts contractions as one word", () => {
        expect(estimateSeconds("don't won't it's we'll")).toBe(2);
    });

    it('counts Chinese and Japanese characters as half a word each', () => {
        expect(estimateSeconds('我们今天去公园散步吧')).toBe(3);
    });

    it('handles empty and missing text', () => {
        expect(estimateSeconds('')).toBe(0);
        expect(estimateSeconds(undefined)).toBe(0);
    });
});

describe('untaggedSeconds', () => {
    const long = { mes: Array.from({ length: 240 }, () => 'word').join(' ') };

    it('adds nothing for the opening message', () => {
        expect(untaggedSeconds(long, 0, { mode: 'length', minutes: 1 })).toBe(0);
        expect(untaggedSeconds(long, 0, { mode: 'fixed', minutes: 5 })).toBe(0);
    });

    it('works per mode', () => {
        expect(untaggedSeconds(long, 3, { mode: 'fixed', minutes: 1.5 })).toBe(90);
        expect(untaggedSeconds(long, 3, { mode: 'length', minutes: 1 })).toBe(120);
        expect(untaggedSeconds({ ...long, is_user: true }, 3, { mode: 'length', minutes: 1 })).toBe(120);
        expect(untaggedSeconds(long, 3, { mode: 'ai', minutes: 1 })).toBe(120);
        expect(untaggedSeconds({ ...long, is_user: true }, 3, { mode: 'ai', minutes: 1 })).toBe(0);
    });
});

describe('samePacing', () => {
    it('only compares minutes for the fixed mode', () => {
        expect(samePacing({ mode: 'ai', minutes: 1 }, { mode: 'ai', minutes: 9 })).toBe(true);
        expect(samePacing({ mode: 'fixed', minutes: 1 }, { mode: 'fixed', minutes: 2 })).toBe(false);
        expect(samePacing({ mode: 'fixed', minutes: 1 }, { mode: 'length', minutes: 1 })).toBe(false);
        expect(isPacingMode('length')).toBe(true);
        expect(isPacingMode('sometimes')).toBe(false);
    });
});

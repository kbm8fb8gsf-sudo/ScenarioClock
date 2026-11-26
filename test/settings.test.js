import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CLOCK_SETTINGS, DEFAULT_REALISM_PROMPT, LEGACY_CLOCK_KEY, SETTINGS_KEY, normalizeSettings, readSettings,
    settingAt, withSetting,
} from '../src/settings.js';

describe('settings', () => {
    it('defaults to the AI timing every reply, and Realism Mode off', () => {
        const settings = normalizeSettings(undefined);
        expect(settings.clock).toEqual(DEFAULT_CLOCK_SETTINGS);
        expect(settings.clock.pacing).toBe('ai');
        expect(settings.realism).toEqual({ enabled: false, prompt: DEFAULT_REALISM_PROMPT, depth: 0, role: 'system' });
        expect(DEFAULT_REALISM_PROMPT).toBe('(OOC: Realism mode, one line of dialogue and one action only, so it flows like a real conversation.)');
    });

    it('repairs bad values', () => {
        const settings = normalizeSettings({
            clock: { depth: '-3', tagDisplay: 'nope', fixedStart: 'x', minutesPerMessage: 99999, pacing: 'often' },
            realism: { enabled: 'yes', role: 'narrator', depth: 2.6 },
        });
        expect(settings.clock).toMatchObject({ depth: 0, tagDisplay: 'hide', fixedStart: '2025-06-01T09:00', minutesPerMessage: 1440, pacing: 'ai' });
        expect(settings.realism).toMatchObject({ enabled: false, role: 'system', depth: 3 });
    });

    it("takes over Scenario Clock 0.1's settings the first time", () => {
        const old = { hour24: true, minutesPerMessage: 2, tagTemplate: 'Custom skips', position: 'before' };
        const settings = readSettings({ [LEGACY_CLOCK_KEY]: old });
        expect(settings.clock).toMatchObject({ hour24: true, minutesPerMessage: 2, tagTemplate: 'Custom skips', position: 'before' });
        expect(readSettings({ [LEGACY_CLOCK_KEY]: old, [SETTINGS_KEY]: { clock: {} } }).clock.hour24).toBe(false);
    });

    it('reads and changes values by path', () => {
        const settings = normalizeSettings({});
        const changed = withSetting(settings, 'realism.enabled', true);
        expect(changed.realism.enabled).toBe(true);
        expect(settings.realism.enabled).toBe(false);
        expect(settingAt(changed, 'realism.enabled')).toBe(true);
        expect(withSetting(settings, 'clock.depth', '7').clock.depth).toBe(7);
        expect(withSetting(settings, 'clock.nope', 1)).toBe(settings);
        expect(withSetting(settings, 'other.enabled', 1)).toBe(settings);
        expect(settingAt(settings, 'nothing')).toBeUndefined();
    });
});

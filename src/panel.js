// @ts-check
/** The SillyTweaks panel in SillyTavern's Extensions menu. */

import {
    dayNumber, formatDate, formatDuration, formatShort, formatTime, formatWeekday, fromIso, fromLocalDate, timeOfDay,
    toIso,
} from './clock/time.js';
import { DEFAULT_CLOCK_SETTINGS, DEFAULT_REALISM_SETTINGS, settingAt } from './settings.js';

/**
 * @typedef {object} PanelDeps
 * @property {import('./clock/controller.js').Controller} controller
 * @property {() => import('./settings.js').Settings} getSettings
 * @property {(path: string, value: unknown) => void} saveSetting e.g. ('clock.hour24', true)
 * @property {() => void} onClockChanged Called after the panel changes the clock.
 * @property {(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void} notify
 * @property {(message: string) => Promise<boolean>} confirm
 * @property {() => Date} [now]
 */

/** Defaults for the "Reset to default" buttons, by setting path. */
const RESETTABLE = {
    'clock.promptTemplate': DEFAULT_CLOCK_SETTINGS.promptTemplate,
    'clock.tagTemplate': DEFAULT_CLOCK_SETTINGS.tagTemplate,
    'clock.tagEveryTemplate': DEFAULT_CLOCK_SETTINGS.tagEveryTemplate,
    'realism.prompt': DEFAULT_REALISM_SETTINGS.prompt,
};

/**
 * Describes a clock change for a notice, e.g. "Moved forward 2 hours. It's now Thu 14 Mar, 9:42 PM."
 * @param {import('./clock/controller.js').Change} change
 * @param {import('./clock/time.js').FormatOptions} options
 */
export function describeChange({ before, after }, options) {
    const diff = after - before;
    const moved = diff === 0 ? 'No change.' : `Moved ${diff > 0 ? 'forward' : 'back'} ${formatDuration(diff)}.`;
    return `${moved} It's now ${formatShort(after, options)}.`;
}

export class SettingsPanel {
    /** @param {PanelDeps} deps */
    constructor(deps) {
        this.deps = deps;
        /** @type {HTMLElement | null} */
        this.root = null;
        this.busy = false;
    }

    /**
     * @param {HTMLElement} container
     * @param {string} html The contents of settings.html.
     */
    mount(container, html) {
        const wrapper = container.ownerDocument.createElement('div');
        wrapper.innerHTML = html;
        const root = /** @type {HTMLElement} */ (wrapper.firstElementChild);
        container.append(root);
        this.root = root;
        this.bindEvents();
        this.refresh();
    }

    refresh() {
        if (!this.root) return;
        const { controller, getSettings } = this.deps;
        const settings = getSettings();
        const clockSettings = settings.clock;
        const state = clockSettings.enabled && controller.hasChat() ? controller.state() : null;

        const faceTime = this.el('[data-role="face-time"]');
        const faceDate = this.el('[data-role="face-date"]');
        const message = this.el('[data-role="message"]');
        if (state) {
            const now = state.timeline.current;
            faceTime.textContent = formatTime(now, clockSettings);
            // Non-breaking spaces keep "day 2" and "14 March" from splitting across lines.
            const date = formatDate(now, clockSettings).replace(/ (?=\S+$)/, '\u00a0');
            faceDate.textContent = `${formatWeekday(now)}, ${date} · ${timeOfDay(now)} · day\u00a0${dayNumber(now, state.timeline.origin)}`;
            message.textContent = '';
        } else {
            faceTime.textContent = '--:--';
            faceDate.textContent = '';
            message.textContent = !clockSettings.enabled
                ? 'The scenario clock is turned off.'
                : controller.hasChat() ? "This chat doesn't have a clock yet." : 'Open a chat to see its clock.';
        }
        this.el('[data-role="face"]').classList.toggle('sillytweaks-face-off', !state);
        this.el('[data-role="running"]').hidden = !state;
        this.el('[data-role="stopped"]').hidden = Boolean(state) || !clockSettings.enabled || !controller.hasChat();

        if (state) {
            const pending = controller.pendingOps();
            this.el('[data-role="pending"]').hidden = pending.length === 0;
            this.el('[data-role="pending-text"]').textContent = `Changed by hand after the latest message: ${pending.join(', ')}`;
            this.fillDateTime('restart', state.timeline.current);
        } else if (!this.input('[data-role="start-date"]').value) {
            this.fillDateTime('start', controller.defaultStart());
        }

        for (const input of this.root.querySelectorAll('[data-setting]')) {
            const value = settingAt(settings, input.getAttribute('data-setting') ?? '');
            if (input instanceof HTMLInputElement && input.type === 'checkbox') {
                input.checked = Boolean(value);
            } else {
                this.fill(input, String(value));
            }
        }
        const fixed = fromIso(clockSettings.fixedStart);
        if (fixed !== null) this.fillDateTime('fixed', fixed);

        const aiPacing = clockSettings.pacing === 'ai';
        const aiTags = this.input('[data-setting="clock.aiTags"]');
        aiTags.disabled = aiPacing;
        if (aiPacing) aiTags.checked = true;
        this.el('[data-role="fixed-minutes"]').hidden = clockSettings.pacing !== 'fixed';
        const skips = !aiPacing && clockSettings.aiTags ? ' The AI marks time skips with tags.' : '';
        this.el('[data-role="pacing-help"]').textContent = PACING_HELP[clockSettings.pacing] + skips;
        this.el('[data-role="tag-template-box"]').hidden = aiPacing;
        this.el('[data-role="tag-every-template-box"]').hidden = !aiPacing;
        this.el('[data-role="fixed-start"]').hidden = clockSettings.startMode !== 'fixed';
        this.el('[data-role="depth-box"]').hidden = clockSettings.position !== 'chat';
        this.el('[data-role="role-box"]').hidden = clockSettings.position !== 'chat';
        this.el('[data-role="cache-warning"]').hidden = clockSettings.position === 'chat' && clockSettings.depth === 0;
    }

    bindEvents() {
        const root = /** @type {HTMLElement} */ (this.root);
        const { saveSetting } = this.deps;

        root.addEventListener('click', (event) => {
            const target = /** @type {Element | null} */ (event.target);
            const button = target?.closest('[data-change], [data-action], [data-reset]');
            if (!button) return;
            const change = button.getAttribute('data-change');
            const action = button.getAttribute('data-action');
            const reset = /** @type {keyof typeof RESETTABLE | null} */ (button.getAttribute('data-reset'));
            if (change) void this.adjust(change);
            if (action) void this.runAction(action);
            if (reset && reset in RESETTABLE) saveSetting(reset, RESETTABLE[reset]);
        });

        this.input('[data-role="change"]').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.runAction('apply');
            }
        });

        for (const input of root.querySelectorAll('[data-setting]')) {
            const path = input.getAttribute('data-setting') ?? '';
            const eventName = input instanceof HTMLTextAreaElement || (input instanceof HTMLInputElement && input.type === 'text')
                ? 'input' : 'change';
            input.addEventListener(eventName, () => {
                const value = input instanceof HTMLInputElement && input.type === 'checkbox'
                    ? input.checked
                    : input instanceof HTMLInputElement && input.type === 'number'
                        ? Number(input.value)
                        : /** @type {HTMLInputElement} */ (input).value;
                saveSetting(path, value);
            });
        }

        for (const part of ['date', 'time']) {
            this.input(`[data-role="fixed-${part}"]`).addEventListener('change', () => {
                const time = this.readDateTime('fixed');
                if (time !== null) saveSetting('clock.fixedStart', toIso(time));
            });
        }
    }

    /** @param {string} action */
    async runAction(action) {
        const { controller, notify, confirm, now = () => new Date() } = this.deps;
        switch (action) {
            case 'apply': {
                const box = this.input('[data-role="change"]');
                if (!box.value.trim()) return;
                if (await this.adjust(box.value)) box.value = '';
                return;
            }
            case 'undo':
                await this.guard(async () => {
                    const change = await controller.undo();
                    if (change) notify(`Undone. ${describeChange(change, this.deps.getSettings().clock)}`, 'info');
                });
                return;
            case 'use-now':
                this.fillDateTime('start', fromLocalDate(now()), true);
                return;
            case 'start':
            case 'restart': {
                const time = this.readDateTime(action);
                if (time === null) {
                    notify('Pick a date and a time first.', 'warning');
                    return;
                }
                await this.guard(async () => {
                    await controller.start(time);
                    notify(`Clock set to ${formatShort(time, this.deps.getSettings().clock)}.`, 'success');
                });
                return;
            }
            case 'stop':
                if (!(await confirm("Remove this chat's clock? The AI will no longer be told the time here."))) return;
                await this.guard(() => controller.stop());
                return;
        }
    }

    /**
     * @param {string} text
     * @returns {Promise<boolean>} Whether it worked.
     */
    async adjust(text) {
        let ok = false;
        await this.guard(async () => {
            const change = await this.deps.controller.adjust(text);
            this.deps.notify(describeChange(change, this.deps.getSettings().clock), 'success');
            ok = true;
        });
        return ok;
    }

    /**
     * Runs one clock change at a time, and reports errors as notices.
     * @param {() => Promise<unknown>} work
     */
    async guard(work) {
        if (this.busy) return;
        this.busy = true;
        try {
            await work();
        } catch (error) {
            this.deps.notify(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            this.busy = false;
            this.deps.onClockChanged();
        }
    }

    /**
     * @param {string} prefix "start", "restart" or "fixed"
     * @returns {number | null}
     */
    readDateTime(prefix) {
        const date = this.input(`[data-role="${prefix}-date"]`).value;
        const time = this.input(`[data-role="${prefix}-time"]`).value || '00:00';
        return date ? fromIso(`${date}T${time.slice(0, 5)}`) : null;
    }

    /**
     * @param {string} prefix
     * @param {number} time
     * @param {boolean} [force] Overwrite even if the user is editing it.
     */
    fillDateTime(prefix, time, force = false) {
        const [date, clock] = toIso(time).split('T');
        this.fill(`[data-role="${prefix}-date"]`, date ?? '', force);
        this.fill(`[data-role="${prefix}-time"]`, clock ?? '', force);
    }

    /**
     * Sets an input's value unless the user is typing in it.
     * @param {string | Element} target
     * @param {string} value
     * @param {boolean} [force]
     */
    fill(target, value, force = false) {
        const input = /** @type {HTMLInputElement} */ (typeof target === 'string' ? this.el(target) : target);
        if (!force && input.ownerDocument.activeElement === input) return;
        if (input.value !== value) input.value = value;
    }

    /** @param {string} selector */
    el(selector) {
        const found = this.root?.querySelector(selector);
        if (!(found instanceof HTMLElement)) throw new Error(`SillyTweaks: missing ${selector}`);
        return found;
    }

    /** @param {string} selector */
    input(selector) {
        return /** @type {HTMLInputElement} */ (this.el(selector));
    }
}

/** @type {Record<import('./clock/pacing.js').PacingMode, string>} */
const PACING_HELP = {
    ai: 'The AI ends every reply with a tag like [TIME: +5m], judged from what happened. Your messages add no time of their own; a reply without a tag is timed from its length.',
    length: 'Each message adds about the time its words take to play out (around 120 words a minute), so longer replies move the clock more.',
    fixed: 'Each message adds the same number of minutes.',
};

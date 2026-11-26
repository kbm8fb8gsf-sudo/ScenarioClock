// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { CLASSES, createChatDecorator, labelMessages, wrapTags } from '../src/clock/decorations.js';

/** @param {string} html */
function element(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
}

/**
 * @param {number} id
 * @param {string} text
 */
function messageHtml(id, text) {
    return `<div class="mes" mesid="${id}"><div class="mes_block"><div class="ch_name"><div><span class="name_text">A</span><small class="timestamp">x</small></div></div><div class="mes_text">${text}</div></div></div>`;
}

const TAG = `.${CLASSES.tag}`;

describe('wrapTags', () => {
    it('wraps valid tags and leaves the rest of the text alone', () => {
        const box = element('<p>[TIME: +2h] She waits. [TIME: soonish] [OOC: hi]</p>');
        expect(wrapTags(box)).toBe(true);
        const tag = box.querySelector(TAG);
        expect(tag?.textContent).toBe('[TIME: +2h]');
        expect(tag?.getAttribute('data-label')).toBe('\u{1F552} +2h');
        expect(box.textContent).toBe('[TIME: +2h] She waits. [TIME: soonish] [OOC: hi]');
        expect(box.querySelectorAll(TAG)).toHaveLength(1);
    });

    it('marks paragraphs that hold nothing but tags', () => {
        const box = element('<p>[TIME: +8h]</p><p>Morning.</p>');
        wrapTags(box);
        expect(box.querySelector('p')?.classList.contains(CLASSES.tagOnly)).toBe(true);
        expect(box.querySelectorAll(`.${CLASSES.tagOnly}`)).toHaveLength(1);
    });

    it('marks the line break next to a tag on its own line', () => {
        const end = element('<p>She smiles.<br>[TIME: +2m]</p>');
        wrapTags(end);
        expect(end.querySelector('br')?.classList.contains(CLASSES.tagBreak)).toBe(true);

        const start = element('<p>[TIME: +8h]<br>Morning comes.</p>');
        wrapTags(start);
        expect(start.querySelector('br')?.classList.contains(CLASSES.tagBreak)).toBe(true);

        const middle = element('<p>One.<br>[TIME: +1m] Two.<br>Three.</p>');
        wrapTags(middle);
        expect(middle.querySelectorAll(`.${CLASSES.tagBreak}`)).toHaveLength(0);
    });

    it('hides the start of a tag that is still streaming in', () => {
        const box = element('<p>She smiles. [TIME: +2</p>');
        expect(wrapTags(box)).toBe(true);
        const partial = box.querySelector(`.${CLASSES.partial}`);
        expect(partial?.textContent).toBe('[TIME: +2');
        expect(box.textContent).toBe('She smiles. [TIME: +2');
        expect(wrapTags(box)).toBe(false);

        const word = element('<p>She smiles. [Tim</p>');
        wrapTags(word);
        expect(word.querySelector(`.${CLASSES.partial}`)?.textContent).toBe('[Tim');
    });

    it('leaves brackets that are not the start of a tag', () => {
        for (const html of ['<p>See [1</p>', '<p>[OOC: hm</p>', '<p>The [time] machine</p>', '<p>[TIME: +2m] done</p>']) {
            const box = element(html);
            wrapTags(box);
            expect(box.querySelector(`.${CLASSES.partial}`)).toBeNull();
        }
    });

    it('skips code blocks, edit boxes, the old extension, and tags it already wrapped', () => {
        const box = element('<pre><code>[TIME: +1h]</code></pre><textarea>[TIME: +1h]</textarea><span class="scenario-clock-tag">[TIME: +1h]</span>');
        expect(wrapTags(box)).toBe(false);
        const done = element('<p>[TIME: +1h]</p>');
        wrapTags(done);
        expect(wrapTags(done)).toBe(false);
        expect(done.querySelectorAll(TAG)).toHaveLength(1);
    });
});

describe('labelMessages', () => {
    const view = {
        enabled: true,
        tagDisplay: /** @type {const} */ ('hide'),
        times: /** @type {(number | null)[]} */ ([null, 1000, 61_000]),
        formatStamp: (/** @type {number} */ t, /** @type {number | null} */ previous) => ({
            text: `T${t}`,
            title: previous === null ? 'first' : `+${t - previous}`,
        }),
    };

    it('labels messages that have a time, after the timestamp, with the change since the one before', () => {
        const root = element(messageHtml(0, 'a') + messageHtml(1, 'b') + messageHtml(2, 'c'));
        labelMessages(root, view);
        const labels = root.querySelectorAll(`.${CLASSES.stamp}`);
        expect(labels).toHaveLength(2);
        expect(labels[0]?.textContent).toBe('T1000');
        expect(labels[0]?.getAttribute('title')).toBe('first');
        expect(labels[1]?.getAttribute('title')).toBe('+60000');
        expect(labels[0]?.previousElementSibling?.className).toBe('timestamp');
    });

    it("goes after SillyTavern's model icon, so the icon stays right after the timestamp", () => {
        const root = element(messageHtml(1, 'b'));
        const timestamp = /** @type {Element} */ (root.querySelector('.timestamp'));
        const icon = document.createElement('img');
        icon.className = 'timestamp-icon';
        timestamp.after(icon);
        labelMessages(root, view);
        expect(timestamp.nextElementSibling).toBe(icon);
        expect(icon.nextElementSibling?.className).toBe(CLASSES.stamp);
    });

    it('stays put when SillyTavern adds its icon afterwards', () => {
        const root = element(messageHtml(1, 'b'));
        labelMessages(root, view);
        const timestamp = /** @type {Element} */ (root.querySelector('.timestamp'));
        const icon = document.createElement('img');
        icon.className = 'timestamp-icon';
        timestamp.after(icon);
        labelMessages(root, view);
        expect(timestamp.nextElementSibling).toBe(icon);
        expect(root.querySelectorAll(`.${CLASSES.stamp}`)).toHaveLength(1);
    });

    it('removes labels when times go away', () => {
        const root = element(messageHtml(1, 'b'));
        labelMessages(root, view);
        labelMessages(root, { ...view, times: null });
        expect(root.querySelector(`.${CLASSES.stamp}`)).toBeNull();
    });
});

describe('createChatDecorator', () => {
    /** @type {HTMLElement} */
    let root;
    /** @type {Array<() => void>} */
    let queued;

    beforeEach(() => {
        document.body.innerHTML = `<div id="chat">${messageHtml(0, '<p>[TIME: +1h] Hi</p>')}</div>`;
        root = /** @type {HTMLElement} */ (document.getElementById('chat'));
        queued = [];
    });

    /** @param {'hide' | 'badge' | 'raw'} [tagDisplay] */
    function decorator(tagDisplay = 'hide') {
        return createChatDecorator({
            root,
            schedule: (/** @type {() => void} */ callback) => queued.push(callback),
            getView: () => ({
                enabled: true,
                tagDisplay,
                times: [5],
                formatStamp: (/** @type {number} */ t) => ({ text: `T${t}`, title: '' }),
            }),
        });
    }

    it('decorates what is already there and sets the display mode', () => {
        decorator('badge').start();
        expect(root.classList.contains(`${CLASSES.modePrefix}badge`)).toBe(true);
        expect(root.querySelector(TAG)).not.toBeNull();
        expect(root.querySelector(`.${CLASSES.stamp}`)?.textContent).toBe('T5');
    });

    it('re-applies when SillyTavern re-renders a message, including while streaming', async () => {
        const instance = decorator();
        instance.start();
        const text = /** @type {HTMLElement} */ (root.querySelector('.mes_text'));
        text.innerHTML = '<p>Swiped. [TIME: 07:</p>';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(text.querySelector(`.${CLASSES.partial}`)?.textContent).toBe('[TIME: 07:');
        text.innerHTML = '<p>Swiped. [TIME: 07:30]</p>';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(text.querySelector(TAG)?.textContent).toBe('[TIME: 07:30]');
        expect(text.querySelector(`.${CLASSES.partial}`)).toBeNull();
        expect(queued.length).toBeGreaterThan(0);
        instance.stop();
    });

    it('handles messages added later', async () => {
        decorator().start();
        root.insertAdjacentHTML('beforeend', messageHtml(1, '<p>[TIME: +2d]</p>'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(root.querySelectorAll(TAG)).toHaveLength(2);
        queued.forEach((callback) => callback());
        expect(root.querySelectorAll(`.${CLASSES.stamp}`)).toHaveLength(1);
    });
});

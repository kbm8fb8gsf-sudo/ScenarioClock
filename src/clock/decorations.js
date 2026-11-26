// @ts-check
/**
 * On-screen touches in the chat: hides (or restyles) [TIME: ...] tags and shows the story time
 * in each message's header. The stored messages are never changed.
 *
 * SillyTavern re-renders messages from many places (streaming, swipes, edits, loading more), so
 * rather than hooking each one, a MutationObserver re-applies the touches whenever the chat's
 * DOM changes.
 */

import { findTags } from './tags.js';

export const CLASSES = {
    tag: 'sillytweaks-clock-tag',
    /** A tag still being streamed in, e.g. "[TIME: +2". */
    partial: 'sillytweaks-clock-tag-partial',
    /** A paragraph holding nothing but tags. */
    tagOnly: 'sillytweaks-clock-tag-only',
    /** A line break left dangling next to a hidden tag. */
    tagBreak: 'sillytweaks-clock-tag-break',
    stamp: 'sillytweaks-clock-stamp',
    modePrefix: 'sillytweaks-tags-',
};

const SHOW_TEXT = 4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const FILTER_SKIP = 3;
/** Never touch text in these. `.scenario-clock-tag` is the old Scenario Clock extension's wrapper. */
const SKIP_INSIDE = `.${CLASSES.tag}, .scenario-clock-tag, textarea, code, pre, script, style`;
const MODES = ['hide', 'badge', 'raw'];
/** The start of a tag at the very end of a message that's still streaming in. */
const PARTIAL_TAG = /\[\s*tim(?:e\s*(?::[^[\]\n]{0,100})?)?$/i;

/**
 * @typedef {object} ChatView
 * @property {boolean} enabled
 * @property {'hide' | 'badge' | 'raw'} tagDisplay
 * @property {(number | null)[] | null} times The time after each message, by message id.
 * @property {(time: number, previous: number | null) => { text: string, title: string }} formatStamp
 *   `previous` is the time after the message before, if it has one.
 */

/**
 * Wraps each valid tag in a span the stylesheet can hide or restyle.
 * @param {Element} container A message's .mes_text.
 * @returns {boolean} Whether anything changed.
 */
export function wrapTags(container) {
    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(container, SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest(SKIP_INSIDE)) return FILTER_REJECT;
            return /\[\s*time\s*:/i.test(node.nodeValue ?? '') ? FILTER_ACCEPT : FILTER_SKIP;
        },
    });
    /** @type {Text[]} */
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(/** @type {Text} */ (node));

    let changed = false;
    for (const node of nodes) {
        const text = node.data;
        const tags = findTags(text);
        if (tags.length === 0) continue;
        const parent = node.parentElement;
        const fragment = doc.createDocumentFragment();
        /** @type {HTMLElement[]} */
        const spans = [];
        let position = 0;
        for (const tag of tags) {
            if (tag.index > position) fragment.append(text.slice(position, tag.index));
            const span = tagSpan(doc, tag.raw, `\u{1F552} ${tag.instruction}`);
            span.title = `Story clock: ${tag.instruction}`;
            spans.push(span);
            fragment.append(span);
            position = tag.index + tag.raw.length;
        }
        if (position < text.length) fragment.append(text.slice(position));
        node.replaceWith(fragment);
        changed = true;
        if (parent && isOnlyTags(parent)) parent.classList.add(CLASSES.tagOnly);
        spans.forEach(markDanglingBreak);
    }
    return wrapPartialTag(container) || changed;
}

/**
 * Hides the start of a tag at the very end of a message, e.g. "[TIME: +2" while the reply is
 * still streaming in, so the tag doesn't flash up before it's complete.
 * @param {Element} container
 */
function wrapPartialTag(container) {
    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(container, SHOW_TEXT);
    /** @type {Text | null} */
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.nodeValue ?? '').trim() !== '') last = /** @type {Text} */ (node);
    }
    if (!last || last.parentElement?.closest(SKIP_INSIDE)) return false;
    const match = PARTIAL_TAG.exec(last.data.trimEnd());
    if (!match) return false;
    const tail = last.splitText(match.index);
    const span = tagSpan(doc, tail.data, '\u{1F552}');
    span.classList.add(CLASSES.partial);
    tail.replaceWith(span);
    return true;
}

/**
 * @param {Document} doc
 * @param {string} raw
 * @param {string} label
 */
function tagSpan(doc, raw, label) {
    const span = doc.createElement('span');
    span.className = CLASSES.tag;
    span.dataset['label'] = label;
    span.textContent = raw;
    return span;
}

/**
 * True if an element holds nothing but tags and whitespace, so hiding the tags would leave
 * an empty paragraph behind.
 * @param {Element} element
 */
function isOnlyTags(element) {
    for (const child of element.childNodes) {
        if (child.nodeType === 3 && (child.nodeValue ?? '').trim() !== '') return false;
        if (child.nodeType === 1) {
            const el = /** @type {Element} */ (child);
            if (!el.classList.contains(CLASSES.tag) && el.tagName !== 'BR') return false;
        }
    }
    return true;
}

/**
 * A tag on its own line at the start or end of a paragraph ("Text<br>[TIME: +2m]") would leave
 * an empty line behind when hidden, so the line break next to it is marked too.
 * @param {Element} span
 */
function markDanglingBreak(span) {
    const before = meaningfulSibling(span, 'previousSibling');
    const after = meaningfulSibling(span, 'nextSibling');
    if (!after && before?.nodeName === 'BR') /** @type {Element} */ (before).classList.add(CLASSES.tagBreak);
    else if (!before && after?.nodeName === 'BR') /** @type {Element} */ (after).classList.add(CLASSES.tagBreak);
}

/**
 * @param {Node} node
 * @param {'previousSibling' | 'nextSibling'} direction
 * @returns {Node | null}
 */
function meaningfulSibling(node, direction) {
    let sibling = node[direction];
    while (sibling && sibling.nodeType === 3 && (sibling.nodeValue ?? '').trim() === '') sibling = sibling[direction];
    return sibling;
}

/**
 * Adds, updates or removes the time label in each message header.
 * @param {Element} root The #chat element.
 * @param {ChatView} view
 */
export function labelMessages(root, view) {
    for (const message of root.querySelectorAll('.mes[mesid]')) {
        const id = Number(message.getAttribute('mesid'));
        const time = view.enabled && view.times && Number.isInteger(id) ? view.times[id] ?? null : null;
        let label = message.querySelector(`.${CLASSES.stamp}`);
        if (time === null) {
            label?.remove();
            continue;
        }
        if (!label) {
            // At the end of the name row, never straight after .timestamp: SillyTavern looks for its
            // model icon right after the timestamp, and adds a second one if something else is there.
            const anchor = message.querySelector('.ch_name .timestamp') ?? message.querySelector('.ch_name .name_text');
            if (!anchor?.parentElement) continue;
            label = message.ownerDocument.createElement('small');
            label.className = CLASSES.stamp;
            anchor.parentElement.append(label);
        }
        const previous = view.times?.[id - 1] ?? null;
        const { text, title } = view.formatStamp(time, previous);
        if (label.textContent !== text) label.textContent = text;
        if (label.getAttribute('title') !== title) label.setAttribute('title', title);
    }
}

/**
 * @param {Element} root
 * @param {ChatView['tagDisplay']} mode
 */
function setMode(root, mode) {
    for (const other of MODES) {
        const name = `${CLASSES.modePrefix}${other}`;
        if (other === mode) {
            if (!root.classList.contains(name)) root.classList.add(name);
        } else if (root.classList.contains(name)) {
            root.classList.remove(name);
        }
    }
}

/**
 * @param {object} deps
 * @param {Element} deps.root The #chat element.
 * @param {() => ChatView} deps.getView
 * @param {(callback: () => void) => void} [deps.schedule] Batches label updates (default: next frame).
 */
export function createChatDecorator({ root, getView, schedule }) {
    const view = root.ownerDocument.defaultView;
    const later = schedule ?? ((callback) => {
        if (view?.requestAnimationFrame) view.requestAnimationFrame(() => callback());
        else setTimeout(callback, 16);
    });
    const options = { childList: true, subtree: true, characterData: true };
    let labelsPending = false;
    /** @type {MutationObserver | null} */
    let observer = null;

    /** @param {() => void} work */
    function quietly(work) {
        observer?.disconnect();
        try {
            work();
        } finally {
            observer?.observe(root, options);
        }
    }

    function updateLabels() {
        labelsPending = false;
        quietly(() => {
            const current = getView();
            setMode(root, current.enabled ? current.tagDisplay : 'raw');
            labelMessages(root, current);
        });
    }

    function scheduleLabels() {
        if (labelsPending) return;
        labelsPending = true;
        later(updateLabels);
    }

    /** @param {MutationRecord[]} records */
    function onMutations(records) {
        /** @type {Set<Element>} */
        const containers = new Set();
        for (const record of records) {
            const target = record.target.nodeType === 1 ? /** @type {Element} */ (record.target) : record.target.parentElement;
            const text = target?.closest('.mes_text');
            if (text) containers.add(text);
            for (const added of record.addedNodes) {
                if (added.nodeType !== 1) continue;
                const el = /** @type {Element} */ (added);
                if (el.matches('.mes_text')) containers.add(el);
                for (const inner of el.querySelectorAll('.mes_text')) containers.add(inner);
            }
        }
        if (containers.size > 0) quietly(() => containers.forEach((container) => wrapTags(container)));
        scheduleLabels();
    }

    /** Re-applies everything now, e.g. after the clock or the settings changed. */
    function refresh() {
        quietly(() => root.querySelectorAll('.mes_text').forEach((container) => wrapTags(container)));
        updateLabels();
    }

    function start() {
        if (observer) return;
        const Observer = view?.MutationObserver ?? MutationObserver;
        observer = new Observer(onMutations);
        observer.observe(root, options);
        refresh();
    }

    function stop() {
        observer?.disconnect();
        observer = null;
    }

    return { start, stop, refresh };
}

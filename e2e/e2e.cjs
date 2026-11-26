// End-to-end checks of SillyTweaks in a real SillyTavern 1.19.1 with a stand-in AI.
const { launch, open, connect, slash, openCharacter, sendMessage, waitForReply, aiCall, check } = require('./st.cjs');

const results = [];
const step = async (name, fn) => {
    try {
        await fn();
    } catch (error) {
        check(results, `${name} (threw)`, false, String(error?.message ?? error).split('\n')[0]);
    }
};

/** "2026-11-26T15:30" + minutes → "3:55 PM" (story time is a plain wall clock). */
function clockText(startIso, minutes) {
    const [date, time] = startIso.split('T');
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d, h, mi) + minutes * 60000);
    const hour = t.getUTCHours();
    return `${hour % 12 === 0 ? 12 : hour % 12}:${String(t.getUTCMinutes()).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

const lastRequest = async () => (await aiCall('/__requests')).at(-1);
const text = (message) => (typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content));

(async () => {
    const { browser, page, logs } = await launch();
    let start = '';
    try {
        await aiCall('/__reset', {});
        await open(page);
        await connect(page);
        // A large context, as with Claude or GPT. With the 4k default, SillyTavern itself pushes
        // example dialogues out as the chat grows, which changes the start of every prompt.
        await page.evaluate(() => {
            $('#oai_max_context_unlocked').prop('checked', true).trigger('input').trigger('change');
            $('#openai_max_context').val(128000).trigger('input');
        });
        await page.waitForTimeout(500);
        // Start from known settings, whatever an earlier run left behind.
        await page.evaluate(() => {
            const settings = SillyTavern.getContext().extensionSettings.sillytweaks;
            Object.assign(settings.clock, {
                enabled: true, autoStart: true, startMode: 'real', pacing: 'ai', aiTags: true, tagDisplay: 'hide',
                showOnMessages: true, hour24: false, dateOrder: 'dmy', position: 'chat', depth: 0, role: 'system',
            });
            settings.realism.enabled = false;
            SillyTavern.getContext().saveSettingsDebounced();
        });
        check(results, 'context set to 128k', (await page.evaluate(() => SillyTavern.getContext().chatCompletionSettings.openai_max_context)) === 128000);
        // Seraphina's lorebook (Eldoria) swaps entries in and out as words come up in the chat,
        // which changes the start of the prompt by itself. Scan depth 0 keeps that out of the cache check.
        await page.evaluate(() => { $('#world_info_depth').val(0).trigger('input'); });

        await step('extension loads', async () => {
            const loaded = await page.evaluate(() => ({
                panel: Boolean(document.querySelector('.sillytweaks-settings')),
                menu: document.getElementById('sillytweaks_realism_option')?.previousElementSibling?.id,
                wand: Boolean(document.getElementById('sillytweaks_clock_wand')),
                api: typeof window.sillyTweaks?.clock?.now,
            }));
            check(results, 'console says [SillyTweaks] Loaded.', logs.some((l) => l.includes('[SillyTweaks] Loaded.')));
            check(results, 'panel, menu switch (after Continue) and wand button are there', loaded.panel && loaded.menu === 'option_continue' && loaded.wand, JSON.stringify(loaded));
        });

        await step('new chat gets a clock', async () => {
            await openCharacter(page, 'Seraphina');
            await slash(page, '/newchat');
            await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1 && SillyTavern.getContext().chatMetadata.scenario_clock, null, { timeout: 20000 });
            await page.waitForTimeout(800);
            const meta = await page.evaluate(() => SillyTavern.getContext().chatMetadata.scenario_clock);
            start = meta?.start ?? '';
            check(results, 'a clock starts in the new chat, timed by the AI', meta?.startIndex === -1 && meta?.pacing?.[0]?.mode === 'ai', JSON.stringify(meta));
            const label = await page.textContent('#chat .mes[mesid="0"] .sillytweaks-clock-stamp');
            check(results, 'the greeting shows the story time', label?.includes(clockText(start, 0)), label ?? 'no label');
        });

        await step('first reply', async () => {
            await aiCall('/__script', { replies: ['"Of course," Seraphina says, taking your hand as you walk to the glade. [TIME: +25m]'] });
            await sendMessage(page, 'Can you show me the forest?');
            const request = await lastRequest();
            const last = request.messages.at(-1);
            check(results, 'the prompt ends with the story clock', last.role === 'system' && text(last).includes(`[Story clock: it is ${clockText(start, 0)}`), text(last).slice(0, 120));
            check(results, 'it asks for a time tag at the end of every reply', text(last).includes('End every reply with a time tag'));
            check(results, '{{user}} in the instructions is filled in', text(last).includes("including User's actions"), text(last).match(/including [^']+'s actions/)?.[0] ?? 'missing');
            const view = await page.evaluate(() => {
                const mes = document.querySelector('#chat .last_mes');
                const tag = mes?.querySelector('.sillytweaks-clock-tag');
                return {
                    visible: mes?.querySelector('.mes_text')?.innerText,
                    tagHidden: tag ? getComputedStyle(tag).display === 'none' : null,
                    stored: SillyTavern.getContext().chat.at(-1).mes,
                    label: mes?.querySelector('.sillytweaks-clock-stamp')?.textContent,
                    title: mes?.querySelector('.sillytweaks-clock-stamp')?.getAttribute('title'),
                };
            });
            check(results, 'the tag is hidden on screen', view.tagHidden === true && !view.visible?.includes('[TIME'), view.visible);
            check(results, 'the tag stays in the saved message', view.stored.includes('[TIME: +25m]'));
            check(results, 'the reply shows the new time (+25 min)', view.label?.includes(clockText(start, 25)), `${view.label} | ${view.title}`);
            check(results, 'its tooltip says how long it took', view.title?.includes('(+25 minutes)'), view.title);
            check(results, 'your own message added no time', (await page.textContent('#chat .mes[mesid="1"] .sillytweaks-clock-stamp'))?.includes(clockText(start, 0)));
        });

        let firstPrompt = [];
        await step('Realism Mode from the options menu', async () => {
            firstPrompt = (await lastRequest()).messages;
            await page.click('#options_button');
            await page.waitForSelector('#sillytweaks_realism_option', { state: 'visible' });
            await page.click('#sillytweaks_realism_option');
            await page.waitForTimeout(400);
            const state = await page.evaluate(() => ({
                checked: document.getElementById('sillytweaks_realism_option')?.getAttribute('aria-checked'),
                label: document.getElementById('sillytweaks_realism_option')?.textContent,
                menuOpen: getComputedStyle(document.getElementById('options')).display !== 'none',
                dot: document.getElementById('options_button')?.classList.contains('sillytweaks-realism-on'),
                saved: SillyTavern.getContext().extensionSettings.sillytweaks?.realism?.enabled,
            }));
            check(results, 'the menu switch turns Realism Mode on', state.checked === 'true' && state.saved === true, JSON.stringify(state));
            check(results, 'the menu stays open and shows "Realism Mode: on"', state.menuOpen && state.label === 'Realism Mode: on');
            check(results, 'the ☰ button shows a dot', state.dot === true);
            await page.screenshot({ path: 'shot-options-menu.png', clip: { x: 300, y: 560, width: 680, height: 340 } });
            await page.mouse.click(640, 300);
            await page.waitForTimeout(500);
            check(results, 'clicking elsewhere closes the menu', await page.evaluate(() => getComputedStyle(document.getElementById('options')).display === 'none'));
        });

        await step('second reply, with Realism Mode', async () => {
            await aiCall('/__script', { replies: ['"Here we are." *She gestures at the moonlit glade.* [TIME: +5m]'] });
            await sendMessage(page, 'Wow.');
            const request = await lastRequest();
            const last = text(request.messages.at(-1));
            check(results, 'the Realism Mode note is in the prompt', last.includes('(OOC: Realism mode, one line of dialogue and one action only, so it flows like a real conversation.)'), last.slice(-160));
            check(results, 'clock and note share the last message (clock first)', last.indexOf('[Story clock') === 0 && last.indexOf('OOC: Realism') > 0);
            check(results, `the clock says ${clockText(start, 25)}`, last.includes(`it is ${clockText(start, 25)}`));
            const prefix = firstPrompt.slice(0, -1);
            const same = JSON.stringify(request.messages.slice(0, prefix.length)) === JSON.stringify(prefix);
            check(results, 'prompt caching: everything before the clock is unchanged from the last prompt', same, `${prefix.length} messages compared`);
        });

        await step('swipe', async () => {
            await aiCall('/__script', { replies: ['"Welcome to my home." *She smiles.* [TIME: +10m]'] });
            const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
            await page.hover('#chat .last_mes');
            await page.click('#chat .last_mes .swipe_right', { force: true });
            await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).swipes?.length >= 2, null, { timeout: 20000 });
            await waitForReply(page, before);
            const request = await lastRequest();
            const last = text(request.messages.at(-1));
            check(results, `the swipe's prompt has the time before the replaced reply (${clockText(start, 25)})`, last.includes(`it is ${clockText(start, 25)}`), last.slice(0, 80));
            const label = await page.textContent('#chat .last_mes .sillytweaks-clock-stamp');
            check(results, 'the new swipe shows its own time (+10 min)', label?.includes(clockText(start, 35)), label);
            await page.click('#chat .last_mes .swipe_left', { force: true });
            await page.waitForTimeout(1200);
            const back = await page.textContent('#chat .last_mes .sillytweaks-clock-stamp');
            check(results, 'swiping back shows the first reply\'s time again (+5 min)', back?.includes(clockText(start, 30)), back);
            await page.click('#chat .last_mes .swipe_right', { force: true });
            await page.waitForTimeout(1200);
        });

        await step('streaming', async () => {
            await page.evaluate(() => { $('#stream_toggle').prop('checked', true).trigger('input').trigger('change'); });
            await page.waitForTimeout(300);
            await aiCall('/__script', { replies: ['"Rest here tonight," she says, spreading a blanket by the fire. [TIME: +40m]'] });
            const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
            await page.fill('#send_textarea', 'Thank you.');
            await page.click('#send_but');
            const seen = [];
            const until = Date.now() + 20000;
            while (Date.now() < until) {
                const snapshot = await page.evaluate(() => {
                    const mes = document.querySelector('#chat .last_mes');
                    return { mine: mes?.getAttribute('is_user') === 'false', text: mes?.querySelector('.mes_text')?.innerText ?? '', done: getComputedStyle(document.getElementById('mes_stop')).display === 'none' };
                });
                if (snapshot.mine) seen.push(snapshot.text);
                if (snapshot.done && seen.length > 5) break;
                await page.waitForTimeout(25);
            }
            await waitForReply(page, before + 2);
            const request = await lastRequest();
            const flashes = seen.filter((t) => /\[\s*TIM/i.test(t));
            check(results, 'the reply really streamed', request.stream === true && seen.length > 5, `${seen.length} snapshots`);
            check(results, 'a tag never shows while streaming in', flashes.length === 0, flashes.slice(0, 3).join(' | '));
            const label = await page.textContent('#chat .last_mes .sillytweaks-clock-stamp');
            check(results, 'the streamed reply moved the clock (+40 min)', label?.includes(clockText(start, 75)), label);
            await page.evaluate(() => { $('#stream_toggle').prop('checked', false).trigger('input').trigger('change'); });
        });

        await step('quiet prompts', async () => {
            await aiCall('/__script', { replies: ['They walked to the glade and settled in for the night.'] });
            await slash(page, '/gen Summarize the story so far in one line.');
            const request = await lastRequest();
            const all = request.messages.map(text).join('\n');
            check(results, 'a quiet prompt (/gen) still gets the clock', all.includes('[Story clock'));
            check(results, '...but not the tag instructions', !all.includes('End every reply'));
            check(results, '...and not the Realism Mode note', !all.includes('OOC: Realism mode'));
        });

        await step('slash commands and macros', async () => {
            check(results, '/clock format=time', (await slash(page, '/clock format=time')) === clockText(start, 75));
            check(results, '/clock +1h moves the clock', (await slash(page, '/clock quiet=true format=time +1h')) === clockText(start, 135));
            await slash(page, '/clock-undo');
            check(results, '/clock-undo takes it back', (await slash(page, '/clock format=time')) === clockText(start, 75));
            const datetime = await page.evaluate(() => SillyTavern.getContext().substituteParams('{{scenario_datetime}}'));
            check(results, '{{scenario_datetime}} macro', datetime.includes(clockText(start, 75)), datetime);
            check(results, '/realism status', (await slash(page, '/realism status')) === 'on');
            check(results, '/realism off', (await slash(page, '/realism off')) === 'off');
            const item = await page.getAttribute('#sillytweaks_realism_option', 'aria-checked');
            check(results, 'the menu switch follows /realism', item === 'false');
        });

        await step('deleting the last reply rolls the clock back', async () => {
            await page.evaluate(() => SillyTavern.getContext().deleteLastMessage());
            await page.waitForTimeout(800);
            check(results, 'clock goes back to before that reply', (await slash(page, '/clock format=time')) === clockText(start, 35));
            const face = await page.textContent('.sillytweaks-face-time');
            check(results, 'the panel agrees', face === clockText(start, 35), face);
        });

        await step('pacing change applies to new messages only', async () => {
            await page.click('#extensions-settings-button .drawer-toggle');
            await page.waitForTimeout(400);
            await page.click('.sillytweaks-settings .inline-drawer-toggle');
            await page.waitForTimeout(400);
            await page.selectOption('[data-setting="clock.pacing"]', 'length');
            await page.waitForTimeout(800);
            const meta = await page.evaluate(() => SillyTavern.getContext().chatMetadata.scenario_clock.pacing);
            const len = await page.evaluate(() => SillyTavern.getContext().chat.length);
            check(results, 'the chat switches to length pacing from the next message', meta.at(-1).mode === 'length' && meta.at(-1).from === len, JSON.stringify(meta));
            check(results, 'earlier times stay put', (await slash(page, '/clock format=time')) === clockText(start, 35));
            await page.screenshot({ path: 'shot-panel.png' });
            await page.selectOption('[data-setting="clock.pacing"]', 'ai');
            await page.waitForTimeout(600);
            await page.click('#extensions-settings-button .drawer-toggle');
        });

        await step('after a reload', async () => {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await open(page);
            await connect(page);
            await openCharacter(page, 'Seraphina');
            await page.waitForFunction(() => SillyTavern.getContext().chat.length > 2, null, { timeout: 20000 });
            await page.waitForTimeout(1500);
            check(results, 'the clock is still right', (await slash(page, '/clock format=time')) === clockText(start, 35));
            const labels = await page.$$eval('#chat .sillytweaks-clock-stamp', (els) => els.length);
            const messages = await page.$$eval('#chat .mes', (els) => els.length);
            check(results, 'every message has its time label', labels === messages, `${labels}/${messages}`);
            check(results, 'tags are still hidden', !(await page.$$eval('#chat .mes_text', (els) => els.some((e) => e.innerText.includes('[TIME')))));
        });

        const errors = logs.filter((l) => /\[pageerror\]|\[error\].*(SillyTweaks|sillytweaks|ScenarioClock)/i.test(l) && !/aihorde|Internal S/.test(l));
        check(results, 'no errors from SillyTweaks in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
    } catch (error) {
        console.log('ERROR', error);
    }
    await page.screenshot({ path: 'shot-final.png' }).catch(() => {});
    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
})();

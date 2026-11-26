// Helpers for driving a real SillyTavern in headless Chromium.
const { chromium } = require('playwright');

const ST = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const AI = process.env.AI_URL ?? 'http://127.0.0.1:5001';

async function aiCall(path, body) {
    const res = await fetch(AI + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
}

async function launch({ scale = 1 } = {}) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: scale });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    return { browser, page, logs };
}

/** Opens SillyTavern and waits until it has finished loading. */
async function open(page) {
    await page.goto(ST, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.eventTypes, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#rm_print_characters_block .character_select, #rm_print_characters_block .group_select'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // First run: the welcome popup asks for a persona name.
    const save = page.locator('dialog[open] .popup-button-ok, dialog[open] .menu_button:has-text("Save")').first();
    if (await save.isVisible().catch(() => false)) {
        await save.click();
        await page.waitForTimeout(1000);
    }
}

/** Clicks Connect in the API panel (SillyTavern doesn't reconnect on load unless Auto-connect is on). */
async function connect(page) {
    const online = await page.evaluate(() => SillyTavern.getContext().onlineStatus);
    if (online !== 'no_connection') return;
    await page.click('#sys-settings-button .drawer-toggle');
    await page.waitForTimeout(400);
    await page.click('#api_button_openai');
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 20000 });
    await page.click('#sys-settings-button .drawer-toggle');
    await page.waitForTimeout(400);
}

/** Runs slash commands the way a user would, and returns the pipe result. */
async function slash(page, text) {
    return page.evaluate(async (command) => {
        const result = await SillyTavern.getContext().executeSlashCommandsWithOptions(command, { handleExecutionErrors: false });
        return result?.pipe ?? null;
    }, text);
}

async function openCharacter(page, name) {
    await page.evaluate(async (wanted) => {
        const ctx = SillyTavern.getContext();
        const index = ctx.characters.findIndex((c) => c.name === wanted);
        if (index < 0) throw new Error(`No character ${wanted}`);
        await ctx.selectCharacterById(index);
    }, name);
    await page.waitForFunction((wanted) => SillyTavern.getContext().name2 === wanted && SillyTavern.getContext().chat.length > 0, name, { timeout: 20000 });
    await page.waitForTimeout(800);
}

/** Types a message in the send box and presses Send, then waits for the reply to finish. */
async function sendMessage(page, text) {
    const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await page.fill('#send_textarea', text);
    await page.click('#send_but');
    await waitForReply(page, before + 2);
}

async function waitForReply(page, length) {
    await page.waitForFunction((n) => SillyTavern.getContext().chat.length >= n, length, { timeout: 30000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('mes_stop')).display === 'none', null, { timeout: 30000 });
    await page.waitForTimeout(700);
}

function check(results, name, ok, detail = '') {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

module.exports = { ST, AI, aiCall, launch, open, connect, slash, openCharacter, sendMessage, waitForReply, check };

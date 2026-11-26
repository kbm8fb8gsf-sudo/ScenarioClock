// One-time setup: persona, AI connection, and installing SillyTweaks from GitHub through the UI.
const { launch, open, check } = require('./st.cjs');
const REPO = process.env.REPO_URL ?? 'https://github.com/kbm8fb8gsf-sudo/SillyTweaks';

(async () => {
    const { browser, page, logs } = await launch();
    const results = [];
    const network = [];
    page.on('response', (r) => { if (r.url().includes('/api/extensions') || r.url().includes('/status')) network.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
    try {
        await open(page);

        // Connect to the stand-in AI through the API Connections panel.
        await page.click('#sys-settings-button .drawer-toggle');
        await page.waitForTimeout(400);
        await page.selectOption('#main_api', 'openai');
        await page.selectOption('#chat_completion_source', 'custom');
        await page.fill('#custom_api_url_text', `${process.env.AI_URL ?? 'http://127.0.0.1:5001'}/v1`);
        await page.fill('#custom_model_id', 'fake-model');
        await page.click('#api_button_openai');
        await page.waitForFunction(() => /valid|connected/i.test(String(SillyTavern.getContext().onlineStatus)) || SillyTavern.getContext().onlineStatus === 'fake-model', null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const status = await page.evaluate(() => ({ api: SillyTavern.getContext().mainApi, online: SillyTavern.getContext().onlineStatus }));
        check(results, 'connected to the stand-in AI', status.api === 'openai' && !/invalid|no_connection/i.test(String(status.online)), JSON.stringify(status));
        await page.click('#sys-settings-button .drawer-toggle');

        // Install the extension the way a user would: Extensions → Install extension → paste URL.
        await page.click('#extensions-settings-button .drawer-toggle');
        await page.waitForTimeout(500);
        await page.click('#third_party_extension_button');
        const dialog = page.locator('dialog[open]').last();
        await dialog.locator('input, textarea').first().fill(REPO);
        await dialog.getByText('Install just for me', { exact: true }).click();
        // SillyTavern then warns about third-party extensions.
        const confirm = page.locator('dialog[open]').last().getByText('Yes, install it', { exact: true });
        await confirm.waitFor({ timeout: 10000 });
        await page.screenshot({ path: 'install-confirm.png' });
        await confirm.click();
        await page.waitForFunction(() => [...document.querySelectorAll('.toast-message, .toast-title')].length > 0, null, { timeout: 90000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const toasts = await page.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map((t) => t.textContent?.trim()));
        check(results, 'SillyTavern reports the install', toasts.some((t) => /success|installed/i.test(t ?? '')), JSON.stringify(toasts));
        await page.screenshot({ path: 'after-install.png' });
    } catch (error) {
        console.log('ERROR', error);
        await page.screenshot({ path: 'setup-error.png' }).catch(() => {});
    }
    console.log('--- network ---\n' + network.join('\n'));
    console.log('--- page log (filtered) ---');
    console.log(logs.filter((l) => /SillyTweaks|Scenario|install|clone|error/i.test(l)).slice(-15).join('\n'));
    await browser.close();
    process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

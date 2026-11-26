import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig(
    { ignores: ['node_modules/'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            globals: { ...globals.browser, SillyTavern: 'readonly' },
        },
    },
    {
        files: ['eslint.config.js', 'vitest.config.js'],
        languageOptions: { globals: globals.node },
    },
    {
        // Run in Node; the functions they pass to page.evaluate() run in SillyTavern's page.
        files: ['e2e/**'],
        languageOptions: { globals: { ...globals.node, ...globals.browser, SillyTavern: 'readonly', $: 'readonly' } },
    },
);

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
);

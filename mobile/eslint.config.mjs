import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'android/', 'ios/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', '../public/js/stops.js', '../public/js/favorites.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
      'no-implied-eval': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'vite.config.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }
  }
];

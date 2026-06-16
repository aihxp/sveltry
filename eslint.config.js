import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

/**
 * Flat ESLint config for the monorepo. Static analysis on top of the strict
 * TypeScript compiler and prettier: it catches the bug-shaped issues a type
 * checker does not (unused values, unsafe patterns, Svelte-specific mistakes).
 * Type-aware rules are intentionally off to keep it fast and project-config-free.
 */
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/_generated/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/dist/**',
      '**/*.config.{js,ts}',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // TypeScript already resolves identifiers/types; the base rule produces
      // false positives on type-only references.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` is discouraged but not a hard error (Sentry payloads are loosely
      // typed in places); surface it as a warning.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty catch blocks are a deliberate "skip this item" pattern at a few
      // ingest/parse sites (always commented).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The app navigates with plain string paths by convention; SvelteKit's
      // typed-routing resolve() is not adopted, so this rule is pure noise here.
      'svelte/no-navigation-without-resolve': 'off',
      // False-positive on ephemeral computation-local `new Map()`/`new Set()`
      // built inside a `$derived` (not reactive state needing SvelteMap/SvelteSet).
      'svelte/prefer-svelte-reactivity': 'off',
      // Aggressive on the idiomatic defensive `let x = init; try { x = ... }`
      // pattern; an opt-in micro-optimization rule, not a correctness check.
      'no-useless-assignment': 'off',
      // svelte-ignore comments suppress svelte-COMPILER warnings (validated by
      // svelte-check), which ESLint cannot see, so it wrongly flags needed ones.
      'svelte/no-unused-svelte-ignore': 'off',
      // Allow `{'a\nb'}` mustaches whose literal carries an escape (e.g. a
      // multi-line textarea placeholder), which a plain attribute cannot express.
      'svelte/no-useless-mustaches': ['error', { ignoreStringEscape: true }],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      /**
       * Запрещаем прямой вызов глобального fetch().
       * Все HTTP-запросы должны идти через MapGLClient.fetchWithUserAgent(),
       * чтобы гарантированно выставлять User-Agent.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name='fetch']",
          message:
            'Используйте MapGLClient.fetchWithUserAgent() вместо прямого fetch() — это гарантирует User-Agent во всех запросах.',
        },
      ],
    },
  },
);

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.es2020 } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: { 'react-hooks/exhaustive-deps': 'warn', 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] },
  },
  { files: ['server/**/*.ts'], languageOptions: { globals: { ...globals.node, ...globals.es2020 } } },
);

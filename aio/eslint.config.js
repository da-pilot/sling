import eslint from '@eslint/js';
import globals from 'globals';
import jestPlugin from 'eslint-plugin-jest';
import importPlugin from 'eslint-plugin-import';
import babelParser from '@babel/eslint-parser';

export default [
  eslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest
      },
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: ['@babel/preset-env']
        }
      }
    },
    plugins: {
      jest: jestPlugin,
      import: importPlugin
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn', 'info', 'debug'] }],
      'import/no-extraneous-dependencies': [
        'error', 
        { 
          devDependencies: [
            '**/*.test.js',
            '**/*.spec.js',
            '**/eslint.config.js',
            '**/jest.config.js',
            '**/.eslintrc.js'
          ] 
        }
      ],
      'max-len': ['error', { code: 120 }]
    }
  }
]; 
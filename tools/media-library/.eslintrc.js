module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  extends: [],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': ['error', { 
      'argsIgnorePattern': '^_',
      'varsIgnorePattern': '^_',
      'caughtErrorsIgnorePattern': '^_'
    }],
    'no-unreachable': 'error',
    'no-unreachable-loop': 'error',
    'no-unused-expressions': 'error',
    'no-return-assign': 'error',
    'no-duplicate-imports': 'error',
    'no-useless-rename': 'error',
    'no-sequences': 'error',
    'no-unused-private-class-members': 'error'
  },
  overrides: [
    {
      files: ['**/*.js'],
      rules: {
        'no-unused-vars': ['error', { 
          'argsIgnorePattern': '^_',
          'varsIgnorePattern': '^_'
        }]
      }
    }
  ]
};

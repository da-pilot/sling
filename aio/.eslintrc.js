module.exports = {
  env: {
    node: true,
    es6: true,
  },
  extends: [
    'airbnb-base',
  ],
  parser: '@babel/eslint-parser',
  parserOptions: {
    ecmaVersion: 2022,
    requireConfigFile: false,
  },
  rules: {
    'no-console': ['error', { allow: ['error', 'warn', 'info', 'debug'] }],
    'import/no-extraneous-dependencies': ['error', { devDependencies: ['**/*.test.js', '**/*.spec.js'] }],
    'max-len': ['error', { code: 120 }],
  },
};
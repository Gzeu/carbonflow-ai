module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: ['eslint:recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'warn',
    'no-unused-vars': 'error',
    'no-undef': 'error',
    'no-unreachable': 'error',
    'consistent-return': 'error',
    'no-duplicate-imports': 'error'
  },
  ignorePatterns: ['node_modules/', 'dist/', 'build/', 'coverage/']
};
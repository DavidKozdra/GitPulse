module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    '*.js',
    'content/*.js',
    '!jest.config.cjs',
  ],
  coverageThreshold: {
    global: {
      statements: 41,
      branches: 36,
      functions: 48,
      lines: 44,
    },
  },
};

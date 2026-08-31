/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/server/server.js'
  ],
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  modulePaths: [
    '<rootDir>/src/server'
  ]
};

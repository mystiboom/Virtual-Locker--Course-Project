module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!uuid/)'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js',
  ],
  moduleNameMapper: {
    '\\.(css|less)$': 'identity-obj-proxy'
  }
};
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.(js|mjs)$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!uuid|@babel|core-js|mongoose|mongodb|bson)/'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js',
  ],
  moduleNameMapper: {
    '\\.(css|less)$': 'identity-obj-proxy'
  }
};
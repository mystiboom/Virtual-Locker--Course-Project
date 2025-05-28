// Polyfills
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock localStorage
const localStorageMock = (function() {
  let store = {};
  return {
    getItem(key) { return store[key] || null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { store = {}; }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock sessionStorage
const sessionStorageMock = (function() {
  let store = {};
  return {
    getItem(key) { return store[key] || null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { store = {}; }
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock
});

// Mock fetch
global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({})
}));

// Mock other browser APIs
window.URL.createObjectURL = jest.fn();
window.URL.revokeObjectURL = jest.fn();
window.prompt = jest.fn();
window.confirm = jest.fn();
window.console.error = jest.fn();
window.console.warn = jest.fn();
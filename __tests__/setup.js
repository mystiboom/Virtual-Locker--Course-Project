const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  // Fix for ESM modules
  jest.mock('uuid', () => ({
    v4: () => 'mock-uuid'
  }));
  
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Minimal test to satisfy Jest
test('setup', () => {
  expect(true).toBeTruthy();
});
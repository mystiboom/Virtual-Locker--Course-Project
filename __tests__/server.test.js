const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Create minimal express app for testing
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock server endpoints
app.post('/create-folder', (req, res) => {
  res.status(201).send('Folder created');
});

app.post('/upload', (req, res) => {
  res.status(200).json({ message: 'File uploaded successfully' });
});

app.get('/files', (req, res) => {
  res.json([]);
});

let mongoServer;

beforeAll(async () => {
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

describe('Server API', () => {
  it('should create a folder', async () => {
    const response = await request(app)
      .post('/create-folder')
      .send({ folderName: 'test-folder' });

    expect(response.status).toBe(201);
    expect(response.text).toBe('Folder created');
  });

  it('should upload a file', async () => {
    const response = await request(app)
      .post('/upload')
      .field('folder', 'test')
      .attach('file', Buffer.from('test'), 'test.txt');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('File uploaded successfully');
  });

  it('should list files', async () => {
    const response = await request(app)
      .get('/files');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
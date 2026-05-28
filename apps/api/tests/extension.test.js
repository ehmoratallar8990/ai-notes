import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';

test('POST /api/extension/clips creates a note', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/extension/clips')
    .send({ title: 'Interesting article', body: 'Selected text excerpt', url: 'https://example.com/article' });
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.note.title, 'Interesting article');
  assert.equal(res.body.data.note.body, 'Selected text excerpt');
  assert.equal(res.body.data.note.source, 'clip');
  assert.equal(res.body.data.note.meetingUrl, 'https://example.com/article');
});

test('POST /api/extension/clips requires url', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/extension/clips')
    .send({ title: 'No URL', body: 'body' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'url is required');
});

test('POST /api/extension/clips defaults title when omitted', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/extension/clips')
    .send({ url: 'https://example.com', body: '' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.note.title, 'Web clip');
});

test('POST /api/extension/clips without auth returns 401 in production', async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const app = createApp({ store: createMemoryStore() });
  const res = await request(app)
    .post('/api/extension/clips')
    .send({ url: 'https://example.com' });
  assert.equal(res.status, 401);
  process.env.NODE_ENV = originalEnv;
});

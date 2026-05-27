import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('health endpoint responds', async () => {
  const app = createApp();
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('login options endpoint can be called without email', async () => {
  const app = createApp();
  const res = await request(app).post('/api/auth/passkey/login/options').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(Object.hasOwn(res.body.data, 'allowCredentials'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFileStore } from '../src/store/fileStore.js';

test('file store persists users across app restarts', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ai-notes-persist-'));
  const filePath = path.join(tempDir, 'store.json');

  try {
    const app1 = createApp({ store: createFileStore({ filePath }) });
    const registerAgent = request.agent(app1);

    const registerRes = await registerAgent.post('/api/auth/register').send({
      username: 'persisted-user',
      displayName: 'Persisted User',
      password: 'supersecret123',
      preferredLanguage: 'en'
    });

    assert.equal(registerRes.status, 201);
    await registerAgent.post('/api/auth/logout').send({});

    const app2 = createApp({ store: createFileStore({ filePath }) });
    const loginAgent = request.agent(app2);
    const loginRes = await loginAgent.post('/api/auth/login').send({
      username: 'persisted-user',
      password: 'supersecret123'
    });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.success, true);
    assert.equal(loginRes.body.data.user.username, 'persisted-user');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

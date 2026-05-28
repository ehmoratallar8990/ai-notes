import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import fs from 'node:fs';
import path from 'node:path';

// --- Attachment tests ---

async function loginUser(app) {
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'attachtest', displayName: 'Attach Test' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-attach-test' });
}

test('upload attachment to a note', async () => {
  const app = createApp();
  await loginUser(app);

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note with attachment', body: 'Content' });
  const noteId = noteRes.body.data.id;

  const buffer = Buffer.from('test file content');
  const res = await request(app)
    .post(`/api/notes/${noteId}/attachments`)
    .attach('file', buffer, 'test.txt');

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.filename, 'test.txt');
  assert.equal(res.body.data.mimeType, 'text/plain');
  assert.ok(res.body.data.storagePath);
  assert.equal(res.body.data.noteId, noteId);
});

test('list attachments for a note', async () => {
  const app = createApp();
  await loginUser(app);

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note', body: 'Content' });
  const noteId = noteRes.body.data.id;

  await request(app).post(`/api/notes/${noteId}/attachments`).attach('file', Buffer.from('a'), 'a.txt');
  await request(app).post(`/api/notes/${noteId}/attachments`).attach('file', Buffer.from('b'), 'b.jpg');

  const res = await request(app).get(`/api/notes/${noteId}/attachments`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 2);
});

test('get attachment returns file', async () => {
  const app = createApp();
  await loginUser(app);

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note', body: 'Content' });
  const noteId = noteRes.body.data.id;

  const uploadRes = await request(app)
    .post(`/api/notes/${noteId}/attachments`)
    .attach('file', Buffer.from('hello attachment'), 'test-file.txt');
  const attId = uploadRes.body.data.id;

  const res = await request(app).get(`/api/attachments/${attId}`);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'hello attachment');
  assert.equal(res.headers['content-type'], 'text/plain');
});

test('delete attachment removes file and row', async () => {
  const app = createApp();
  await loginUser(app);

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note', body: 'Content' });
  const noteId = noteRes.body.data.id;

  const uploadRes = await request(app)
    .post(`/api/notes/${noteId}/attachments`)
    .attach('file', Buffer.from('to be deleted'), 'del-file.txt');
  const attId = uploadRes.body.data.id;

  const res = await request(app).delete(`/api/attachments/${attId}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.deleted, true);
});

test('attachment upload fails without file', async () => {
  const app = createApp();
  await loginUser(app);

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note', body: 'Content' });
  const noteId = noteRes.body.data.id;

  const res = await request(app).post(`/api/notes/${noteId}/attachments`);
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('attachment upload fails for missing note', async () => {
  const app = createApp();
  await loginUser(app);

  const buffer = Buffer.from('test content');
  const res = await request(app)
    .post('/api/notes/nonexistent-id/attachments')
    .attach('file', buffer, 'test.txt');

  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('get attachment returns 404 for missing attachment', async () => {
  const app = createApp();
  await loginUser(app);

  const res = await request(app).get('/api/attachments/nonexistent-id');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('delete attachment returns 404 for missing attachment', async () => {
  const app = createApp();
  await loginUser(app);

  const res = await request(app).delete('/api/attachments/nonexistent-id');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('attachment ownership enforced', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  const userA = store.createUser({ username: 'usera', displayName: 'User A' });
  const userB = store.createUser({ username: 'userb', displayName: 'User B' });
  const noteA = store.createNote(userA.id, { title: 'Note A', body: '' });
  const att = store.createAttachment(userA.id, { noteId: noteA.id, filename: 'secret.txt', mimeType: 'text/plain', sizeBytes: 5, storagePath: 'secret.txt' });

  // userB should not be able to get userA's attachment
  const res = await request(app)
    .get(`/api/attachments/${att.id}`)
    .set('Cookie', 'ai_notes_session=' + Buffer.from(JSON.stringify({ userId: userB.id })).toString('base64'));

  assert.equal(res.status, 404);
});

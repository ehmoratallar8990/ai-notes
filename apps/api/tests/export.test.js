import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';

// --- Export tests ---

async function setupUserAndCreateNotes(app) {
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'exporttest', displayName: 'Export Tester' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-export-test' });

  const note1Res = await request(app).post('/api/notes').send({ title: 'Meeting Notes', body: 'Discussed launch timeline.', tags: ['work', 'meeting'], source: 'manual' });
  const note2Res = await request(app).post('/api/notes').send({ title: 'Ideas', body: 'New product ideas.', tags: ['ideas'], source: 'extension' });
  return { note1: note1Res.body.data, note2: note2Res.body.data };
}

test('export single note as markdown with YAML frontmatter', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  const { note1 } = await setupUserAndCreateNotes(app);

  const res = await request(app).get(`/api/notes/${note1.id}/export?format=md`);
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].startsWith('text/markdown'));
  assert.ok(res.headers['content-disposition'].includes('attachment'));
  const body = res.text;
  assert.ok(body.startsWith('---'));
  assert.ok(body.includes('title: Meeting Notes'));
  assert.ok(body.includes('source: manual'));
  assert.ok(body.includes('tags: [work, meeting]'));
  assert.ok(body.includes('createdAt:'));
  assert.ok(body.includes('Discussed launch timeline.'));
});

test('export single note as JSON', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  const { note1 } = await setupUserAndCreateNotes(app);

  const res = await request(app).get(`/api/notes/${note1.id}/export?format=json`);
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].startsWith('application/json'));
  assert.ok(res.headers['content-disposition'].includes('attachment'));
  assert.equal(res.body.title, 'Meeting Notes');
  assert.deepEqual(res.body.tags, ['work', 'meeting']);
});

test('export nonexistent note returns 404', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'export404', displayName: 'Export 404' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-export-404' });

  const res = await request(app).get('/api/notes/nonexistent/export?format=md');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('bulk export all notes as markdown', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await setupUserAndCreateNotes(app);

  const res = await request(app).get('/api/notes/export?format=md');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].startsWith('text/markdown'));
  const body = res.text;
  assert.ok(body.includes('title: Meeting Notes'));
  assert.ok(body.includes('title: Ideas'));
  assert.ok(body.includes('---\n\n---')); // notes separated by ---
});

test('bulk export all notes as JSON', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await setupUserAndCreateNotes(app);

  const res = await request(app).get('/api/notes/export?format=json');
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].startsWith('application/json'));
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2);
});

test('unsupported export format returns 400', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'exportfmt', displayName: 'Export Format' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-export-fmt' });
  const noteRes = await request(app).post('/api/notes').send({ title: 'Fmt', body: '' });
  const noteId = noteRes.body.data.id;

  const single = await request(app).get(`/api/notes/${noteId}/export?format=xml`);
  assert.equal(single.status, 400);

  const bulk = await request(app).get('/api/notes/export?format=xml');
  assert.equal(bulk.status, 400);
});

test('export markdown includes transcript, summary, key points, and action items', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'exportrich', displayName: 'Export Rich' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-export-rich' });

  const noteRes = await request(app).post('/api/notes').send({
    title: 'Rich Note',
    body: 'Body text.',
    transcript: 'Spoken words.',
    tags: ['test']
  });
  const note = noteRes.body.data;

  // Update note with AI-generated fields
  await request(app).patch(`/api/notes/${note.id}`).send({
    summary: 'A summary.',
    keyPointsJson: [{ text: 'Point one' }, 'Point two'],
    actionItemsJson: [{ text: 'Do thing', dueDate: '2025-01-01' }, 'Another task']
  });

  const res = await request(app).get(`/api/notes/${note.id}/export?format=md`);
  assert.equal(res.status, 200);
  const body = res.text;
  assert.ok(body.includes('## Transcript'));
  assert.ok(body.includes('Spoken words.'));
  assert.ok(body.includes('## Summary'));
  assert.ok(body.includes('A summary.'));
  assert.ok(body.includes('## Key Points'));
  assert.ok(body.includes('- Point one'));
  assert.ok(body.includes('- Point two'));
  assert.ok(body.includes('## Action Items'));
  assert.ok(body.includes('- [ ] Do thing (due: 2025-01-01)'));
  assert.ok(body.includes('- [ ] Another task'));
});

test('export markdown escapes YAML special characters in title', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'exportyaml', displayName: 'Export YAML' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-export-yaml' });

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note: with colon and "quotes"', body: 'Body' });
  const note = noteRes.body.data;
  const res = await request(app).get(`/api/notes/${note.id}/export?format=md`);
  assert.equal(res.status, 200);
  const body = res.text;
  // JSON.stringify wraps in double quotes and escapes internal quotes as \"
  assert.ok(body.includes('title: "Note: with colon and \\"quotes\\""'));
});

test('export empty notes list as markdown returns empty string body', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'emptyexport', displayName: 'Empty Export' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-empty-export' });

  const res = await request(app).get('/api/notes/export?format=md');
  assert.equal(res.status, 200);
  assert.equal(res.text.trim(), '');
});

test('export empty notes list as JSON returns empty array', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'emptyjson', displayName: 'Empty JSON' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-empty-json' });

  const res = await request(app).get('/api/notes/export?format=json');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('export respects user isolation', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });

  // Agent A — persists cookies/session
  const agentA = request.agent(app);
  await agentA.post('/api/auth/passkey/register/options').send({ username: 'usera', displayName: 'User A' });
  await agentA.post('/api/auth/passkey/register/verify').send({ id: 'dev-user-a' });
  const noteRes = await agentA.post('/api/notes').send({ title: 'A Secret', body: '' });
  const noteA = noteRes.body.data;

  // Agent B — separate session
  const agentB = request.agent(app);
  await agentB.post('/api/auth/passkey/register/options').send({ username: 'userb', displayName: 'User B' });
  await agentB.post('/api/auth/passkey/register/verify').send({ id: 'dev-user-b' });

  // User B should not see A's note in bulk export
  const bulk = await agentB.get('/api/notes/export?format=json');
  assert.equal(bulk.body.length, 0);

  // User B should get 404 for A's single note export
  const single = await agentB.get(`/api/notes/${noteA.id}/export?format=md`);
  assert.equal(single.status, 404);
});

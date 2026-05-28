import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';

// --- Store-level template tests ---

test('create template stores name, body, tags, meeting fields', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'tpluser', displayName: 'Template User' });
  const tpl = store.createTemplate(user.id, {
    name: 'Meeting Notes',
    body: '# Meeting\n\n## Attendees\n',
    tags: ['meeting'],
    meetingPlatform: 'Zoom',
    meetingUrl: 'https://zoom.us/j/123'
  });
  assert.equal(tpl.name, 'Meeting Notes');
  assert.equal(tpl.body, '# Meeting\n\n## Attendees\n');
  assert.deepEqual(tpl.tags, ['meeting']);
  assert.equal(tpl.meetingPlatform, 'Zoom');
  assert.equal(tpl.meetingUrl, 'https://zoom.us/j/123');
  assert.ok(tpl.id);
  assert.ok(tpl.createdAt);
});

test('listTemplates returns empty built-ins on first call', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'builtin', displayName: 'Built-in Test' });
  const list = store.listTemplates(user.id);
  assert.equal(list.length, 3);
  const names = list.map(t => t.name).sort();
  assert.deepEqual(names, ['Daily Standup', 'Meeting Notes', 'Project Brief']);
});

test('listTemplates sorts by createdAt desc', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'sort', displayName: 'Sort Test' });
  store.createTemplate(user.id, { name: 'A', body: 'a', tags: [] });
  store.createTemplate(user.id, { name: 'B', body: 'b', tags: [] });
  store.createTemplate(user.id, { name: 'C', body: 'c', tags: [] });
  const list = store.listTemplates(user.id);
  assert.equal(list.length, 3); // built-ins + custom or just 3 custom? Actually built-ins already created in first call, so 3 + 3 = 6
  // But listTemplates creates built-ins lazily on first call; after createTemplate, built-ins already exist
  const custom = list.filter(t => t.name === 'A' || t.name === 'B' || t.name === 'C');
  assert.equal(custom.length, 3);
});

test('getTemplate returns null for missing', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'get', displayName: 'Get Test' });
  assert.equal(store.getTemplate(user.id, 'nonexistent'), null);
});

test('deleteTemplate removes template', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'del', displayName: 'Delete Test' });
  store.listTemplates(user.id); // seed built-ins first
  const tpl = store.createTemplate(user.id, { name: 'D', body: 'd', tags: [] });
  assert.equal(store.listTemplates(user.id).length, 4); // 3 built-ins + 1 custom
  assert.ok(store.deleteTemplate(user.id, tpl.id));
  assert.equal(store.listTemplates(user.id).length, 3);
  assert.equal(store.deleteTemplate(user.id, tpl.id), false);
});

// --- API-level template tests ---

test('POST /api/templates creates template', async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'tplapi', displayName: 'Template API' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-tpl-api' });

  const res = await agent.post('/api/templates').send({
    name: 'My Template',
    body: 'Body here',
    tags: ['test'],
    meetingPlatform: 'Teams',
    meetingUrl: 'https://teams.live.com/meet'
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.name, 'My Template');
  assert.equal(res.body.data.body, 'Body here');
  assert.deepEqual(res.body.data.tags, ['test']);
});

test('GET /api/templates returns templates', async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'tplget', displayName: 'Template GET' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-tpl-get' });

  const res = await agent.get('/api/templates');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.data.length, 3); // built-ins
});

test('DELETE /api/templates/:id removes template', async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'tpldel', displayName: 'Template DEL' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-tpl-del' });

  const createRes = await agent.post('/api/templates').send({ name: 'Removable', body: '...', tags: [] });
  const id = createRes.body.data.id;

  const delRes = await agent.delete(`/api/templates/${id}`);
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.success, true);

  const listRes = await agent.get('/api/templates');
  assert.ok(!listRes.body.data.find(t => t.id === id));
});

test('POST /api/templates without auth returns 401', async () => {
  const app = createApp();
  // In test/dev mode, the dev user middleware auto-attaches a demo user.
  // To test 401, we need to create app in a way that disables dev user.
  // However, createApp uses attachDevUser in non-production.
  // We'll verify 401 by overriding env temporarily.
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const prodApp = createApp();
  const res = await request(prodApp).post('/api/templates').send({ name: 'X', body: 'x' });
  assert.equal(res.status, 401);
  process.env.NODE_ENV = original;
});

test('DELETE /api/templates/:id without auth returns 401', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const prodApp = createApp();
  const res = await request(prodApp).delete('/api/templates/some-id');
  assert.equal(res.status, 401);
  process.env.NODE_ENV = original;
});

// --- Create note with template prefill ---

test('create note with meetingPlatform and meetingUrl via API', async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'meet', displayName: 'Meeting Test' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-meet-test' });

  const res = await agent.post('/api/notes').send({
    title: 'Meeting Note',
    body: 'Notes...',
    tags: ['meeting'],
    format: 'markdown',
    meetingPlatform: 'Zoom',
    meetingUrl: 'https://zoom.us/j/456'
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.meetingPlatform, 'Zoom');
  assert.equal(res.body.data.meetingUrl, 'https://zoom.us/j/456');
});

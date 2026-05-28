import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import { createMockAiProvider, createOllamaProvider, createAiProvider } from '../src/services/aiNoteService.js';

// --- Pinning tests ---

test('pinning a note sorts it to the top', () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  const user = store.createUser({ username: 'pintest', displayName: 'Pin Tester' });

  const note1 = store.createNote(user.id, { title: 'First note', body: 'Alpha' });
  const note2 = store.createNote(user.id, { title: 'Second note', body: 'Beta' });

  store.updateNote(user.id, note2.id, { pinned: true });

  const listed = store.listNotes(user.id);
  assert.equal(listed[0].id, note2.id);
  assert.equal(listed[0].pinned, true);
  assert.equal(listed[1].id, note1.id);
  assert.equal(listed[1].pinned, false);
});

test('pin and unpin via API', async () => {
  const app = createApp();
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'pinapi', displayName: 'Pin API' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-pin-api-test' });

  const noteRes = await request(app).post('/api/notes').send({ title: 'Note to pin', body: 'Content' });
  const noteId = noteRes.body.data.id;

  const pinRes = await request(app).patch(`/api/notes/${noteId}/pin`);
  assert.equal(pinRes.body.success, true);
  assert.equal(pinRes.body.data.pinned, true);

  const unpinRes = await request(app).patch(`/api/notes/${noteId}/unpin`);
  assert.equal(unpinRes.body.success, true);
  assert.equal(unpinRes.body.data.pinned, false);
});

test('filter notes by pinned status', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'pinfilter', displayName: 'Pin Filter' });
  store.createNote(user.id, { title: 'Pinned note', body: 'A', pinned: true });
  store.createNote(user.id, { title: 'Regular note', body: 'B', pinned: false });
  store.createNote(user.id, { title: 'Another pinned', body: 'C', pinned: true });

  const pinnedOnly = store.listNotes(user.id, { pinned: true });
  assert.equal(pinnedOnly.length, 2);
  assert.ok(pinnedOnly.every(n => n.pinned === true));

  const regularOnly = store.listNotes(user.id, { pinned: false });
  assert.equal(regularOnly.length, 1);
  assert.equal(regularOnly[0].title, 'Regular note');
});

// --- Tags tests ---

test('create note with tags and retrieve them', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'tagtest', displayName: 'Tag Tester' });
  const note = store.createNote(user.id, { title: 'Tagged note', body: 'Content', tags: ['work', 'meeting'] });

  assert.deepEqual(note.tags, ['work', 'meeting']);

  const retrieved = store.getNote(user.id, note.id);
  assert.deepEqual(retrieved.tags, ['work', 'meeting']);
});

test('update note tags', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'tagupdate', displayName: 'Tag Updater' });
  const note = store.createNote(user.id, { title: 'Note', body: 'Content' });
  assert.deepEqual(note.tags, []);

  const updated = store.updateNote(user.id, note.id, { tags: ['project-x', 'important'] });
  assert.deepEqual(updated.tags, ['project-x', 'important']);
});

test('list unique tags across all notes', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'taglist', displayName: 'Tag Lister' });
  store.createNote(user.id, { title: 'A', body: '', tags: ['work', 'meeting'] });
  store.createNote(user.id, { title: 'B', body: '', tags: ['personal', 'meeting'] });
  store.createNote(user.id, { title: 'C', body: '', tags: ['work'] });

  const tags = store.listTags(user.id);
  assert.deepEqual(tags, ['meeting', 'personal', 'work']);
});

test('filter notes by tag', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'tagfilter', displayName: 'Tag Filter' });
  store.createNote(user.id, { title: 'Work note', body: '', tags: ['work'] });
  store.createNote(user.id, { title: 'Personal note', body: '', tags: ['personal'] });
  store.createNote(user.id, { title: 'Work+Personal', body: '', tags: ['work', 'personal'] });

  const workNotes = store.listNotes(user.id, { tag: 'work' });
  assert.equal(workNotes.length, 2);
  assert.ok(workNotes.every(n => n.tags.includes('work')));
});

test('tags API endpoint returns user tags', async () => {
  const app = createApp();
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'tagapi', displayName: 'Tag API' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-tag-api-test' });

  await request(app).post('/api/notes').send({ title: 'Note 1', body: '', tags: ['alpha', 'beta'] });
  await request(app).post('/api/notes').send({ title: 'Note 2', body: '', tags: ['alpha'] });

  const res = await request(app).get('/api/notes/tags');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.includes('alpha'));
  assert.ok(res.body.data.includes('beta'));
});

test('notes API supports tag query parameter', async () => {
  const app = createApp();
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'tagquery', displayName: 'Tag Query' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-tag-query-test' });

  await request(app).post('/api/notes').send({ title: 'Work', body: '', tags: ['work'] });
  await request(app).post('/api/notes').send({ title: 'Personal', body: '', tags: ['personal'] });

  const res = await request(app).get('/api/notes?tag=work');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].title, 'Work');
});

// --- Ollama provider tests ---

test('ollama provider throws on connection failure', async () => {
  const provider = createOllamaProvider({
    baseUrl: 'http://localhost:99999',
    model: 'nonexistent'
  });
  await assert.rejects(
    () => provider.summary('test input'),
    /Ollama|fetch|ECONNREFUSED|error/i
  );
});

test('ollama provider has all required methods', () => {
  const provider = createOllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama3' });
  assert.equal(typeof provider.summary, 'function');
  assert.equal(typeof provider.keyPoints, 'function');
  assert.equal(typeof provider.actionItems, 'function');
  assert.equal(typeof provider.mindMap, 'function');
});

test('createAiProvider returns ollama provider when requested', () => {
  const original = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'ollama';
  const provider = createAiProvider();
  assert.equal(typeof provider.summary, 'function');
  assert.equal(typeof provider.keyPoints, 'function');
  process.env.AI_PROVIDER = original;
});

test('mock ai provider still works', async () => {
  const provider = createMockAiProvider();
  const text = 'Discuss launch timeline and follow up with Maria.';
  const summary = await provider.summary(text);
  assert.ok(summary.length > 0);
  const keyPoints = await provider.keyPoints(text);
  assert.ok(Array.isArray(keyPoints));
  const actionItems = await provider.actionItems(text);
  assert.ok(Array.isArray(actionItems));
  const mindMap = await provider.mindMap(text);
  assert.equal(mindMap.root, 'Note');
});

// --- Action items (tasks) tests ---

test('toggle action item via PATCH route', async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'aitest', displayName: 'AI Tester' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-ai-test' });

  const noteRes = await agent.post('/api/notes').send({ title: 'Action items test', body: 'Do thing A. Do thing B.' });
  const noteId = noteRes.body.data.id;

  // Seed action items directly through update
  const items = [
    { text: 'Do thing A', dueDate: null, completed: false },
    { text: 'Do thing B', dueDate: '2025-12-31', completed: false }
  ];
  await agent.patch(`/api/notes/${noteId}`).send({ actionItemsJson: items });

  // Toggle first item
  const toggleRes = await agent.patch(`/api/notes/${noteId}/action-items/0`);
  assert.equal(toggleRes.status, 200);
  assert.equal(toggleRes.body.success, true);
  assert.equal(toggleRes.body.data.actionItemsJson[0].completed, true);
  assert.equal(toggleRes.body.data.actionItemsJson[1].completed, false);

  // Toggle back
  const toggleBack = await agent.patch(`/api/notes/${noteId}/action-items/0`);
  assert.equal(toggleBack.body.data.actionItemsJson[0].completed, false);
});

test('invalid action item index returns 400', async () => {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'badidx', displayName: 'Bad Index' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-bad-idx' });

  const noteRes = await agent.post('/api/notes').send({ title: 'No actions', body: '' });
  const noteId = noteRes.body.data.id;

  const res = await agent.patch(`/api/notes/${noteId}/action-items/0`);
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('aggregate tasks endpoint returns incomplete action items', async () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  const user = store.createUser({ username: 'taskagg', displayName: 'Task Aggregator' });

  const note1 = store.createNote(user.id, { title: 'Note One', body: 'B1' });
  store.updateNote(user.id, note1.id, { actionItemsJson: [
    { text: 'Incomplete A', dueDate: null, completed: false },
    { text: 'Complete B', dueDate: null, completed: true }
  ]});

  const note2 = store.createNote(user.id, { title: 'Note Two', body: 'B2' });
  store.updateNote(user.id, note2.id, { actionItemsJson: [
    { text: 'Incomplete C', dueDate: '2025-06-15', completed: false }
  ]});

  // Use a fresh login that matches the user's session
  const agent = request.agent(app);
  await agent.post('/api/auth/passkey/register/options').send({ username: 'taskagg', displayName: 'Task Aggregator' });
  await agent.post('/api/auth/passkey/register/verify').send({ id: 'dev-task-agg' });

  const res = await agent.get('/api/tasks');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 2);
  assert.ok(res.body.data.some(t => t.text === 'Incomplete A' && t.noteTitle === 'Note One'));
  assert.ok(res.body.data.some(t => t.text === 'Incomplete C' && t.dueDate === '2025-06-15' && t.noteTitle === 'Note Two'));
});

test('listTasks store method aggregates incomplete items', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'storetasks', displayName: 'Store Tasks' });

  const note = store.createNote(user.id, { title: 'Store Note', body: 'Body' });
  store.updateNote(user.id, note.id, { actionItemsJson: [
    { text: 'Todo 1', dueDate: null, completed: false },
    { text: 'Todo 2', dueDate: '2025-01-01', completed: false },
    { text: 'Done', dueDate: null, completed: true }
  ]});

  const tasks = store.listTasks(user.id);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(t => t.noteId === note.id));
  assert.ok(tasks.some(t => t.text === 'Todo 1'));
  assert.ok(tasks.some(t => t.text === 'Todo 2' && t.dueDate === '2025-01-01'));
  assert.ok(tasks.every(t => t.completed === undefined)); // completed not exposed in listTasks
});

// --- Markdown / format tests ---

test('create note defaults to plain text format', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'formattest', displayName: 'Format Tester' });
  const note = store.createNote(user.id, { title: 'Note', body: 'Hello' });
  assert.equal(note.format, 'text');
});

test('create note with markdown format', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'mdtest', displayName: 'Markdown Tester' });
  const note = store.createNote(user.id, { title: 'MD Note', body: '# Hello', format: 'markdown' });
  assert.equal(note.format, 'markdown');
});

test('update note format from text to markdown', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'fmtupdate', displayName: 'Format Updater' });
  const note = store.createNote(user.id, { title: 'Note', body: 'Body' });
  assert.equal(note.format, 'text');

  const updated = store.updateNote(user.id, note.id, { format: 'markdown' });
  assert.equal(updated.format, 'markdown');
});

test('API creates note with markdown format', async () => {
  const app = createApp();
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'mdapi', displayName: 'MD API' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-md-api-test' });

  const res = await request(app).post('/api/notes').send({ title: 'Markdown API', body: '## Heading\n\n- item 1', format: 'markdown' });
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.format, 'markdown');
});

test('API updates note format via PATCH', async () => {
  const app = createApp();
  await request(app).post('/api/auth/passkey/register/options').send({ username: 'mdpatch', displayName: 'MD Patch' });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: 'dev-md-patch-test' });

  const createRes = await request(app).post('/api/notes').send({ title: 'Plain', body: 'Text' });
  const noteId = createRes.body.data.id;
  assert.equal(createRes.body.data.format, 'text');

  const patchRes = await request(app).patch(`/api/notes/${noteId}`).send({ format: 'markdown', body: '# New body' });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.success, true);
  assert.equal(patchRes.body.data.format, 'markdown');
  assert.equal(patchRes.body.data.body, '# New body');
});
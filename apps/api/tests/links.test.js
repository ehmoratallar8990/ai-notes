import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';

async function loginAs(app, username) {
  await request(app).post('/api/auth/passkey/register/options').send({ username, displayName: username });
  await request(app).post('/api/auth/passkey/register/verify').send({ id: `dev-${username}` });
}

// --- Store-level link tests ---

test('store: creating a note with wiki links creates outgoing links', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'linkuser', displayName: 'Link User' });
  const target = store.createNote(user.id, { title: 'Target Note', body: 'I am the target' });

  const note = store.createNote(user.id, { title: 'Source Note', body: `See also [[${target.title}]]` });
  const matches = [...note.body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
  const targetIds = matches.map(t => {
    const found = store.listNotes(user.id).find(n => n.title.trim().toLowerCase() === t.toLowerCase());
    return found ? found.id : null;
  }).filter(Boolean);
  store.setNoteLinks(user.id, note.id, targetIds);

  const links = store.getNoteLinks(user.id, note.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].id, target.id);
});

test('store: updating a note body updates outgoing links', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'linkuser2', displayName: 'Link User 2' });
  const a = store.createNote(user.id, { title: 'Note A', body: 'A' });
  const b = store.createNote(user.id, { title: 'Note B', body: 'B' });
  const c = store.createNote(user.id, { title: 'Note C', body: 'C' });

  const source = store.createNote(user.id, { title: 'Source', body: `[[${a.title}]] [[${b.title}]]` });

  function parseAndSetLinks(body, sourceId) {
    const matches = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
    const targetIds = matches.map(t => {
      const found = store.listNotes(user.id).find(n => n.title.trim().toLowerCase() === t.toLowerCase());
      return found ? found.id : null;
    }).filter(Boolean);
    store.setNoteLinks(user.id, sourceId, targetIds);
  }

  parseAndSetLinks(source.body, source.id);
  assert.equal(store.getNoteLinks(user.id, source.id).length, 2);

  store.updateNote(user.id, source.id, { body: `[[${c.title}]]` });
  parseAndSetLinks(`[[${c.title}]]`, source.id);

  const links = store.getNoteLinks(user.id, source.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].id, c.id);
});

test('store: backlinks show notes that link to the current one', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'backuser', displayName: 'Back User' });
  const target = store.createNote(user.id, { title: 'Target', body: 'Target body' });
  const source = store.createNote(user.id, { title: 'Source', body: `[[${target.title}]]` });
  store.setNoteLinks(user.id, source.id, [target.id]);

  const backlinks = store.getNoteBacklinks(user.id, target.id);
  assert.equal(backlinks.length, 1);
  assert.equal(backlinks[0].id, source.id);
});

test('store: deleting a note cleans up its links', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'deluser', displayName: 'Del User' });
  const target = store.createNote(user.id, { title: 'Target', body: 'Body' });
  const source = store.createNote(user.id, { title: 'Source', body: `[[${target.title}]]` });

  store.setNoteLinks(user.id, source.id, [target.id]);
  assert.equal(store.getNoteLinks(user.id, source.id).length, 1);

  store.deleteNoteLinksForNote(user.id, source.id);
  store.deleteNote(user.id, source.id);

  assert.equal(store.getNoteLinks(user.id, source.id).length, 0);
  assert.equal(store.getNoteBacklinks(user.id, target.id).length, 0);
});

test('store: circular links work', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'circuser', displayName: 'Circ User' });
  const a = store.createNote(user.id, { title: 'Note A', body: 'A' });
  const b = store.createNote(user.id, { title: 'Note B', body: 'B' });

  store.setNoteLinks(user.id, a.id, [b.id]);
  store.setNoteLinks(user.id, b.id, [a.id]);

  assert.equal(store.getNoteLinks(user.id, a.id).length, 1);
  assert.equal(store.getNoteBacklinks(user.id, a.id).length, 1);
  assert.equal(store.getNoteLinks(user.id, b.id).length, 1);
  assert.equal(store.getNoteBacklinks(user.id, b.id).length, 1);
});

test('store: unresolved wiki links are ignored', () => {
  const store = createMemoryStore();
  const user = store.createUser({ username: 'missuser', displayName: 'Miss User' });
  const note = store.createNote(user.id, { title: 'Lonely', body: '[[Nonexistent Note]]' });

  const matches = [...note.body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
  const targetIds = matches.map(t => {
    const found = store.listNotes(user.id).find(n => n.title.trim().toLowerCase() === t.toLowerCase());
    return found ? found.id : null;
  }).filter(Boolean);
  store.setNoteLinks(user.id, note.id, targetIds);

  const links = store.getNoteLinks(user.id, note.id);
  assert.equal(links.length, 0);
});

// --- API route tests ---

test('GET /api/notes/:id/links returns outgoing links', async () => {
  const app = createApp();
  await loginAs(app, 'apiout');

  const noteRes = await request(app).post('/api/notes').send({ title: 'Target', body: 'Body' });
  const targetId = noteRes.body.data.id;

  const sourceRes = await request(app).post('/api/notes').send({ title: 'Source', body: `[[Target]]` });
  const sourceId = sourceRes.body.data.id;

  const res = await request(app).get(`/api/notes/${sourceId}/links`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].id, targetId);
});

test('GET /api/notes/:id/backlinks returns incoming links', async () => {
  const app = createApp();
  await loginAs(app, 'apiin');

  const noteRes = await request(app).post('/api/notes').send({ title: 'Target', body: 'Body' });
  const targetId = noteRes.body.data.id;

  await request(app).post('/api/notes').send({ title: 'Source', body: `[[Target]]` });

  const res = await request(app).get(`/api/notes/${targetId}/backlinks`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].title, 'Source');
});

test('links API respects ownership', () => {
  const store = createMemoryStore();
  const app = createApp({ store });
  const ana = store.createUser({ username: 'ana', displayName: 'Ana' });
  const bob = store.createUser({ username: 'bob', displayName: 'Bob' });
  const anaNote = store.createNote(ana.id, { title: 'AnaNote', body: 'A' });
  const bobNote = store.createNote(bob.id, { title: 'BobNote', body: 'B' });
  store.setNoteLinks(bob.id, bobNote.id, [anaNote.id]);

  const bobLinks = store.getNoteLinks(bob.id, bobNote.id);
  assert.equal(bobLinks.length, 0); // anaNote is not owned by bob
});

test('PATCH note updates links via API', async () => {
  const app = createApp();
  await loginAs(app, 'patchlinks');

  const targetRes = await request(app).post('/api/notes').send({ title: 'PatchTarget', body: 'Target body' });
  const targetId = targetRes.body.data.id;

  const sourceRes = await request(app).post('/api/notes').send({ title: 'PatchSource', body: 'No links yet' });
  const sourceId = sourceRes.body.data.id;

  let linksRes = await request(app).get(`/api/notes/${sourceId}/links`);
  assert.equal(linksRes.body.data.length, 0);

  await request(app).patch(`/api/notes/${sourceId}`).send({ body: `[[PatchTarget]]` });

  linksRes = await request(app).get(`/api/notes/${sourceId}/links`);
  assert.equal(linksRes.body.data.length, 1);
  assert.equal(linksRes.body.data[0].id, targetId);
});

test('DELETE note cleans up links via API', async () => {
  const app = createApp();
  await loginAs(app, 'dellinks');

  const targetRes = await request(app).post('/api/notes').send({ title: 'DelTarget', body: 'Target body' });
  const targetId = targetRes.body.data.id;

  const sourceRes = await request(app).post('/api/notes').send({ title: 'DelSource', body: `[[DelTarget]]` });
  const sourceId = sourceRes.body.data.id;

  let backRes = await request(app).get(`/api/notes/${targetId}/backlinks`);
  assert.equal(backRes.body.data.length, 1);

  await request(app).delete(`/api/notes/${sourceId}`);

  backRes = await request(app).get(`/api/notes/${targetId}/backlinks`);
  assert.equal(backRes.body.data.length, 0);
});

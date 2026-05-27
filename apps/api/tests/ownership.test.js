import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memoryStore.js';

test('users only see their own notes and folders', () => {
  const store = createMemoryStore();
  const ana = store.createUser({ username: 'ana', displayName: 'Ana' });
  const bob = store.createUser({ username: 'bob', displayName: 'Bob' });
  const anaFolder = store.createFolder(ana.id, { name: 'Work' });
  store.createNote(ana.id, { title: 'Ana note', body: 'secret', folderId: anaFolder.id });
  store.createNote(bob.id, { title: 'Bob note', body: 'private' });
  assert.equal(store.listNotes(ana.id).length, 1);
  assert.equal(store.listNotes(ana.id)[0].title, 'Ana note');
  assert.equal(store.getNote(bob.id, store.listNotes(ana.id)[0].id), null);
  assert.equal(store.listFolders(bob.id).length, 0);
});

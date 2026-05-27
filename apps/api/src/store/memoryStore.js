import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : value;

export function createMemoryStore() {
  const db = {
    users: [], passkeys: [], folders: [], notes: [], recordings: [], aiJobs: [], extensionPairingTokens: [], extensionSessions: []
  };

  return {
    db,
    createUser({ username, displayName, preferredLanguage = 'en' }) {
      const user = { id: randomUUID(), username, displayName, preferredLanguage, createdAt: now(), updatedAt: now() };
      db.users.push(user); return clone(user);
    },
    findUserById(id) { return clone(db.users.find(u => u.id === id) || null); },
    findUserByUsername(username) { return clone(db.users.find(u => u.username === username) || null); },
    createPasskey(userId, passkey) {
      const row = { id: randomUUID(), userId, createdAt: now(), lastUsedAt: null, ...passkey };
      db.passkeys.push(row); return clone(row);
    },
    findPasskeyByCredentialId(credentialId) { return clone(db.passkeys.find(p => p.credentialId === credentialId) || null); },
    createFolder(userId, { name }) {
      const folder = { id: randomUUID(), userId, name, createdAt: now(), updatedAt: now() };
      db.folders.push(folder); return clone(folder);
    },
    listFolders(userId) { return clone(db.folders.filter(f => f.userId === userId)); },
    updateFolder(userId, id, attrs) {
      const folder = db.folders.find(f => f.userId === userId && f.id === id); if (!folder) return null;
      if (attrs.name) folder.name = attrs.name; folder.updatedAt = now(); return clone(folder);
    },
    deleteFolder(userId, id) {
      const idx = db.folders.findIndex(f => f.userId === userId && f.id === id); if (idx === -1) return false;
      db.folders.splice(idx, 1); db.notes.forEach(n => { if (n.userId === userId && n.folderId === id) n.folderId = null; }); return true;
    },
    createNote(userId, attrs) {
      const note = {
        id: randomUUID(), userId, folderId: attrs.folderId || null, title: attrs.title || 'Untitled note', body: attrs.body || '',
        transcript: attrs.transcript || '', transcriptionStatus: attrs.transcriptionStatus || 'pending', summary: '', keyPointsJson: [], actionItemsJson: [], mindMapJson: null,
        source: attrs.source || 'manual', meetingPlatform: attrs.meetingPlatform || null, meetingUrl: attrs.meetingUrl || null,
        createdAt: now(), updatedAt: now(), deletedAt: null
      };
      db.notes.push(note); return clone(note);
    },
    listNotes(userId, { folderId, search } = {}) {
      let notes = db.notes.filter(n => n.userId === userId && !n.deletedAt);
      if (folderId) notes = notes.filter(n => n.folderId === folderId);
      if (search) notes = notes.filter(n => `${n.title} ${n.body} ${n.transcript}`.toLowerCase().includes(search.toLowerCase()));
      return clone(notes.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
    },
    getNote(userId, id) { return clone(db.notes.find(n => n.userId === userId && n.id === id && !n.deletedAt) || null); },
    updateNote(userId, id, attrs) {
      const note = db.notes.find(n => n.userId === userId && n.id === id && !n.deletedAt); if (!note) return null;
      for (const key of ['folderId','title','body','transcript','transcriptionStatus','summary','keyPointsJson','actionItemsJson','mindMapJson']) {
        if (Object.hasOwn(attrs, key)) note[key] = attrs[key];
      }
      note.updatedAt = now(); return clone(note);
    },
    deleteNote(userId, id) { const note = db.notes.find(n => n.userId === userId && n.id === id && !n.deletedAt); if (!note) return false; note.deletedAt = now(); return true; },
    createRecording(userId, attrs) {
      const recording = { id: randomUUID(), userId, createdAt: now(), ...attrs };
      db.recordings.push(recording); return clone(recording);
    },
    listRecordingsForNote(userId, noteId) { return clone(db.recordings.filter(r => r.userId === userId && r.noteId === noteId)); },
    createExtensionSession(userId, tokenHash) {
      const session = { id: randomUUID(), userId, tokenHash, createdAt: now(), lastUsedAt: now(), revokedAt: null };
      db.extensionSessions.push(session); return clone(session);
    }
  };
}

export const store = createMemoryStore();

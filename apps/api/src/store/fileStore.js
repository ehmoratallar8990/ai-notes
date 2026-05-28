import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const clone = (value) => (value ? JSON.parse(JSON.stringify(value)) : value);
const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return clone(safeUser);
};

function createEmptyDb() {
  return {
    users: [],
    passkeys: [],
    folders: [],
    notes: [],
    recordings: [],
    attachments: [],
    aiJobs: [],
    extensionPairingTokens: [],
    extensionSessions: [],
    templates: [],
    noteLinks: []
  };
}

function ensureShape(raw = {}) {
  const empty = createEmptyDb();
  return {
    ...empty,
    ...raw,
    users: Array.isArray(raw.users) ? raw.users : [],
    passkeys: Array.isArray(raw.passkeys) ? raw.passkeys : [],
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    recordings: Array.isArray(raw.recordings) ? raw.recordings : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    aiJobs: Array.isArray(raw.aiJobs) ? raw.aiJobs : [],
    extensionPairingTokens: Array.isArray(raw.extensionPairingTokens) ? raw.extensionPairingTokens : [],
    extensionSessions: Array.isArray(raw.extensionSessions) ? raw.extensionSessions : [],
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    noteLinks: Array.isArray(raw.noteLinks) ? raw.noteLinks : []
  };
}

function loadDb(filePath) {
  if (!existsSync(filePath)) return createEmptyDb();
  try {
    return ensureShape(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return createEmptyDb();
  }
}

export function createFileStore({ filePath = path.resolve(process.cwd(), 'data/ai-notes.json') } = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = loadDb(filePath);

  const persist = () => {
    writeFileSync(filePath, JSON.stringify(db, null, 2));
  };

  if (!existsSync(filePath)) persist();

  return {
    db,
    createUser({ username, displayName, preferredLanguage = 'en', passwordHash = null }) {
      const user = { id: randomUUID(), username, displayName, preferredLanguage, passwordHash, createdAt: now(), updatedAt: now() };
      db.users.push(user);
      persist();
      return sanitizeUser(user);
    },
    findUserById(id) { return sanitizeUser(db.users.find((u) => u.id === id) || null); },
    findUserByUsername(username) { return sanitizeUser(db.users.find((u) => u.username === username) || null); },
    getUserRecordById(id) { return clone(db.users.find((u) => u.id === id) || null); },
    getUserRecordByUsername(username) { return clone(db.users.find((u) => u.username === username) || null); },
    updateUser(id, attrs) {
      const user = db.users.find((u) => u.id === id);
      if (!user) return null;
      for (const key of ['username', 'displayName', 'preferredLanguage', 'passwordHash']) {
        if (Object.hasOwn(attrs, key) && attrs[key] !== undefined) user[key] = attrs[key];
      }
      user.updatedAt = now();
      persist();
      return sanitizeUser(user);
    },
    createPasskey(userId, passkey) {
      const row = { id: randomUUID(), userId, createdAt: now(), lastUsedAt: null, ...passkey };
      db.passkeys.push(row);
      persist();
      return clone(row);
    },
    listPasskeysForUser(userId) { return clone(db.passkeys.filter((p) => p.userId === userId)); },
    findPasskeyByCredentialId(credentialId) { return clone(db.passkeys.find((p) => p.credentialId === credentialId) || null); },
    updatePasskey(credentialId, attrs) {
      const passkey = db.passkeys.find((p) => p.credentialId === credentialId);
      if (!passkey) return null;
      Object.assign(passkey, attrs);
      persist();
      return clone(passkey);
    },
    createFolder(userId, { name }) {
      const folder = { id: randomUUID(), userId, name, createdAt: now(), updatedAt: now() };
      db.folders.push(folder);
      persist();
      return clone(folder);
    },
    listFolders(userId) { return clone(db.folders.filter((f) => f.userId === userId)); },
    updateFolder(userId, id, attrs) {
      const folder = db.folders.find((f) => f.userId === userId && f.id === id);
      if (!folder) return null;
      if (attrs.name) folder.name = attrs.name;
      folder.updatedAt = now();
      persist();
      return clone(folder);
    },
    deleteFolder(userId, id) {
      const idx = db.folders.findIndex((f) => f.userId === userId && f.id === id);
      if (idx === -1) return false;
      db.folders.splice(idx, 1);
      db.notes.forEach((n) => {
        if (n.userId === userId && n.folderId === id) n.folderId = null;
      });
      persist();
      return true;
    },
    createNote(userId, attrs) {
      const note = {
        id: randomUUID(),
        userId,
        folderId: attrs.folderId || null,
        title: attrs.title || 'Untitled note',
        body: attrs.body || '',
        transcript: attrs.transcript || '',
        transcriptionStatus: attrs.transcriptionStatus || 'pending',
        summary: '',
        keyPointsJson: [],
        actionItemsJson: [],
        mindMapJson: null,
        pinned: attrs.pinned || false,
        tags: Array.isArray(attrs.tags) ? [...attrs.tags] : [],
        format: attrs.format || 'text',
        source: attrs.source || 'manual',
        meetingPlatform: attrs.meetingPlatform || null,
        meetingUrl: attrs.meetingUrl || null,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      };
      db.notes.push(note);
      persist();
      return clone(note);
    },
    listNotes(userId, { folderId, search, tag, pinned } = {}) {
      let notes = db.notes.filter((n) => n.userId === userId && !n.deletedAt);
      if (folderId) notes = notes.filter((n) => n.folderId === folderId);
      if (search) notes = notes.filter((n) => `${n.title} ${n.body} ${n.transcript}`.toLowerCase().includes(search.toLowerCase()));
      if (tag) notes = notes.filter((n) => Array.isArray(n.tags) && n.tags.includes(tag));
      if (pinned !== undefined) notes = notes.filter((n) => (pinned ? n.pinned : !n.pinned));
      return clone(notes.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }));
    },
    listTags(userId) {
      const tagSet = new Set();
      db.notes.filter((n) => n.userId === userId && !n.deletedAt).forEach((n) => {
        if (Array.isArray(n.tags)) n.tags.forEach((tag) => tagSet.add(tag));
      });
      return [...tagSet].sort();
    },
    listTasks(userId) {
      const tasks = [];
      db.notes.filter((n) => n.userId === userId && !n.deletedAt).forEach((note) => {
        if (!Array.isArray(note.actionItemsJson)) return;
        note.actionItemsJson.forEach((item, index) => {
          if (item && !item.completed) {
            tasks.push({
              noteId: note.id,
              noteTitle: note.title,
              text: item.text || '',
              dueDate: item.dueDate || null,
              index
            });
          }
        });
      });
      return clone(tasks);
    },
    getNote(userId, id) { return clone(db.notes.find((n) => n.userId === userId && n.id === id && !n.deletedAt) || null); },
    updateNote(userId, id, attrs) {
      const note = db.notes.find((n) => n.userId === userId && n.id === id && !n.deletedAt);
      if (!note) return null;
      for (const key of ['folderId', 'title', 'body', 'transcript', 'transcriptionStatus', 'summary', 'keyPointsJson', 'actionItemsJson', 'mindMapJson', 'pinned', 'tags', 'format']) {
        if (Object.hasOwn(attrs, key)) note[key] = attrs[key];
      }
      note.updatedAt = now();
      persist();
      return clone(note);
    },
    deleteNote(userId, id) {
      const note = db.notes.find((n) => n.userId === userId && n.id === id && !n.deletedAt);
      if (!note) return false;
      note.deletedAt = now();
      persist();
      return true;
    },
    createRecording(userId, attrs) {
      const recording = { id: randomUUID(), userId, createdAt: now(), ...attrs };
      db.recordings.push(recording);
      persist();
      return clone(recording);
    },
    listRecordingsForNote(userId, noteId) { return clone(db.recordings.filter((r) => r.userId === userId && r.noteId === noteId)); },
    createAttachment(userId, attrs) {
      const attachment = { id: randomUUID(), userId, createdAt: now(), ...attrs };
      db.attachments.push(attachment);
      persist();
      return clone(attachment);
    },
    listAttachmentsForNote(userId, noteId) {
      return clone(db.attachments.filter((a) => a.userId === userId && a.noteId === noteId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    getAttachment(userId, id) { return clone(db.attachments.find((a) => a.userId === userId && a.id === id) || null); },
    deleteAttachment(userId, id) {
      const idx = db.attachments.findIndex((a) => a.userId === userId && a.id === id);
      if (idx === -1) return false;
      db.attachments.splice(idx, 1);
      persist();
      return true;
    },
    createExtensionSession(userId, tokenHash) {
      const session = { id: randomUUID(), userId, tokenHash, createdAt: now(), lastUsedAt: now(), revokedAt: null };
      db.extensionSessions.push(session);
      persist();
      return clone(session);
    },
    setNoteLinks(userId, sourceNoteId, targetNoteIds) {
      db.noteLinks = db.noteLinks.filter((l) => l.sourceNoteId !== sourceNoteId);
      for (const tid of targetNoteIds) {
        const target = db.notes.find((n) => n.userId === userId && n.id === tid && !n.deletedAt);
        if (target) db.noteLinks.push({ id: randomUUID(), sourceNoteId, targetNoteId: tid, createdAt: now() });
      }
      persist();
    },
    getNoteLinks(userId, noteId) {
      const targetIds = db.noteLinks.filter((l) => l.sourceNoteId === noteId).map((l) => l.targetNoteId);
      return clone(db.notes.filter((n) => n.userId === userId && !n.deletedAt && targetIds.includes(n.id)));
    },
    getNoteBacklinks(userId, noteId) {
      const sourceIds = db.noteLinks.filter((l) => l.targetNoteId === noteId).map((l) => l.sourceNoteId);
      return clone(db.notes.filter((n) => n.userId === userId && !n.deletedAt && sourceIds.includes(n.id)));
    },
    deleteNoteLinksForNote(_userId, noteId) {
      db.noteLinks = db.noteLinks.filter((l) => l.sourceNoteId !== noteId && l.targetNoteId !== noteId);
      persist();
      return true;
    },
    createTemplate(userId, { name, body, tags, meetingPlatform, meetingUrl }) {
      const template = {
        id: randomUUID(),
        userId,
        name,
        body: body || '',
        tags: Array.isArray(tags) ? [...tags] : [],
        meetingPlatform: meetingPlatform || null,
        meetingUrl: meetingUrl || null,
        createdAt: now()
      };
      db.templates.push(template);
      persist();
      return clone(template);
    },
    listTemplates(userId) {
      const userTemplates = db.templates.filter((t) => t.userId === userId);
      if (userTemplates.length === 0) {
        const builtIns = [
          { name: 'Meeting Notes', body: '# Meeting Notes\n\n## Date\n\n## Attendees\n\n## Agenda\n\n## Discussion\n\n## Action Items\n\n', tags: ['meeting'], meetingPlatform: null, meetingUrl: null },
          { name: 'Daily Standup', body: '# Daily Standup\n\n## Yesterday\n\n## Today\n\n## Blockers\n\n', tags: ['standup'], meetingPlatform: null, meetingUrl: null },
          { name: 'Project Brief', body: '# Project Brief\n\n## Overview\n\n## Goals\n\n## Timeline\n\n## Resources\n\n## Risks\n\n', tags: ['project'], meetingPlatform: null, meetingUrl: null }
        ];
        for (const bt of builtIns) {
          db.templates.push({ id: randomUUID(), userId, ...bt, createdAt: now() });
        }
        persist();
        return clone(db.templates.filter((t) => t.userId === userId));
      }
      return clone(userTemplates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    getTemplate(userId, id) { return clone(db.templates.find((t) => t.userId === userId && t.id === id) || null); },
    deleteTemplate(userId, id) {
      const idx = db.templates.findIndex((t) => t.userId === userId && t.id === id);
      if (idx === -1) return false;
      db.templates.splice(idx, 1);
      persist();
      return true;
    }
  };
}

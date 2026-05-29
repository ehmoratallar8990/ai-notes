import express from 'express';
import { requireUser } from '../middleware/auth.js';
import { createAiProvider } from '../services/aiNoteService.js';
import { attachmentsRouter as makeAttachmentsRouter } from './attachments.js';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function notesRouter(store) {
  const router = express.Router();
  const ai = createAiProvider();
  const { upload } = makeAttachmentsRouter(store);
  router.use(requireUser);

  function resolveNoteIdByTitle(userId, title) {
    const all = store.listNotes(userId);
    const t = title.trim().toLowerCase();
    const found = all.find(n => n.title.trim().toLowerCase() === t);
    return found ? found.id : null;
  }

  function parseAndSetLinks(userId, noteId, body) {
    if (typeof body !== 'string') return;
    const matches = [...body.matchAll(WIKILINK_RE)].map(m => m[1].trim());
    const targetIds = [];
    for (const title of matches) {
      const id = resolveNoteIdByTitle(userId, title);
      if (id) targetIds.push(id);
    }
    store.setNoteLinks(userId, noteId, targetIds);
  }

  router.get('/', (req, res) => {
    const { folderId, search, tag, pinned } = req.query;
    const filter = {};
    if (folderId) filter.folderId = folderId;
    if (search) filter.search = search;
    if (tag) filter.tag = tag;
    if (pinned !== undefined) filter.pinned = pinned === 'true';
    res.json({ success: true, data: store.listNotes(req.session.userId, filter) });
  });

  router.post('/', (req, res) => {
    const note = store.createNote(req.session.userId, req.body);
    parseAndSetLinks(req.session.userId, note.id, note.body);
    res.status(201).json({ success: true, data: note });
  });

  router.get('/tags', (req, res) => res.json({ success: true, data: store.listTags(req.session.userId) }));

  // Export endpoints (must be before /:id to avoid 'export' being treated as an id)
  router.get('/export', (req, res) => {
    const format = req.query.format || 'md';
    const notes = store.listNotes(req.session.userId);
    if (format === 'md') {
      const body = notes.map(noteToMarkdown).join('\n---\n\n');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="notes.md"');
      return res.send(body);
    }
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="notes.json"');
      return res.json(notes);
    }
    return res.status(400).json({ success: false, error: 'Unsupported export format' });
  });

  router.get('/:id', (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    res.json({ success: true, data: note });
  });

  router.patch('/:id', (req, res) => {
    const note = store.updateNote(req.session.userId, req.params.id, req.body);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    parseAndSetLinks(req.session.userId, note.id, note.body);
    res.json({ success: true, data: note });
  });

  router.delete('/:id', (req, res) => {
    const userId = req.session.userId;
    const noteId = req.params.id;
    store.deleteNoteLinksForNote(userId, noteId);
    res.json({ success: true, data: { deleted: store.deleteNote(userId, noteId) } });
  });

  router.get('/:id/links', (req, res) => {
    const data = store.getNoteLinks(req.session.userId, req.params.id);
    res.json({ success: true, data });
  });

  router.get('/:id/backlinks', (req, res) => {
    const data = store.getNoteBacklinks(req.session.userId, req.params.id);
    res.json({ success: true, data });
  });

  router.post('/:id/summary', async (req, res) => generate(req, res, 'summary', ai.summary.bind(ai), store));
  router.post('/:id/key-points', async (req, res) => generate(req, res, 'keyPointsJson', ai.keyPoints.bind(ai), store));
  router.post('/:id/action-items', async (req, res) => generate(req, res, 'actionItemsJson', ai.actionItems.bind(ai), store));
  router.post('/:id/mind-map', async (req, res) => generate(req, res, 'mindMapJson', ai.mindMap.bind(ai), store));

  router.post('/:id/chat', async (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, error: 'message is required' });

    const parts = [];
    if (note.title) parts.push(`Title: ${note.title}`);
    if (note.body?.trim()) parts.push(`Content:\n${note.body.slice(0, 3000)}`);
    if (note.transcript?.trim()) parts.push(`Transcript:\n${note.transcript.slice(0, 3000)}`);
    if (note.summary) parts.push(`Summary: ${note.summary}`);
    if (Array.isArray(note.keyPointsJson) && note.keyPointsJson.length)
      parts.push(`Key points:\n${note.keyPointsJson.map(k => `- ${k}`).join('\n')}`);
    const context = parts.join('\n\n');

    const messages = [
      { role: 'system', content: `You are a helpful assistant. Answer questions about the following note concisely and accurately.\n\n${context}` },
      ...history.slice(-20),
      { role: 'user', content: message.trim() },
    ];

    try {
      const reply = await ai.chat(messages);
      res.json({ success: true, data: { reply } });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || 'Chat failed' });
    }
  });

  router.patch('/:id/pin', (req, res) => {
    const note = store.updateNote(req.session.userId, req.params.id, { pinned: true });
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    res.json({ success: true, data: note });
  });

  router.patch('/:id/unpin', (req, res) => {
    const note = store.updateNote(req.session.userId, req.params.id, { pinned: false });
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    res.json({ success: true, data: note });
  });

  router.patch('/:id/action-items/:index', (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    const index = parseInt(req.params.index, 10);
    if (!Array.isArray(note.actionItemsJson) || index < 0 || index >= note.actionItemsJson.length) {
      return res.status(400).json({ success: false, error: 'Invalid action item index' });
    }
    const items = [...note.actionItemsJson];
    const item = { ...items[index], completed: !items[index].completed };
    items[index] = item;
    const updated = store.updateNote(req.session.userId, req.params.id, { actionItemsJson: items });
    res.json({ success: true, data: updated });
  });

  // Attachments
  router.post('/:id/attachments', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'file is required' });
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

    const attachment = store.createAttachment(req.session.userId, {
      noteId: req.params.id,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storagePath: req.file.filename
    });
    res.status(201).json({ success: true, data: attachment });
  });

  router.get('/:id/attachments', (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    res.json({ success: true, data: store.listAttachmentsForNote(req.session.userId, req.params.id) });
  });

  // Export endpoints
  router.get('/:id/export', (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    const format = req.query.format || 'md';
    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="note-${sanitizeFilename(note.title)}.md"`);
      return res.send(noteToMarkdown(note));
    }
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="note-${sanitizeFilename(note.title)}.json"`);
      return res.json(note);
    }
    return res.status(400).json({ success: false, error: 'Unsupported export format' });
  });

  // Set/update/remove password protection
  router.post('/:id/protect', async (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    const { password, remove } = req.body;
    if (remove) {
      const updated = store.updateNote(req.session.userId, req.params.id, { isProtected: false, notePassword: null });
      return res.json({ success: true, data: updated });
    }
    if (!password || password.length < 1) return res.status(400).json({ success: false, error: 'Password required' });
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(password, salt, 32);
    const hash = `${salt}:${derivedKey.toString('hex')}`;
    const updated = store.updateNote(req.session.userId, req.params.id, { isProtected: true, notePassword: hash });
    return res.json({ success: true, data: updated });
  });

  // Verify password to unlock
  router.post('/:id/unlock', async (req, res) => {
    const note = store.getNote(req.session.userId, req.params.id);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    if (!note.isProtected || !note.notePassword) return res.json({ success: true });
    const { password } = req.body;
    if (!password) return res.status(401).json({ success: false, error: 'Password required' });
    try {
      const [salt, storedHash] = note.notePassword.split(':');
      const derivedKey = await scryptAsync(password, salt, 32);
      const match = timingSafeEqual(Buffer.from(storedHash, 'hex'), derivedKey);
      if (!match) return res.status(401).json({ success: false, error: 'Incorrect password' });
      return res.json({ success: true });
    } catch {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }
  });

  return router;
}

function noteToMarkdown(note) {
  const tags = Array.isArray(note.tags) && note.tags.length > 0 ? note.tags.join(', ') : '';
  const frontmatter = [
    '---',
    `title: ${escapeYaml(note.title)}`,
    note.source ? `source: ${escapeYaml(note.source)}` : '',
    note.folderId ? `folder: ${escapeYaml(note.folderId)}` : '',
    tags ? `tags: [${tags}]` : '',
    `createdAt: ${note.createdAt}`,
    note.updatedAt ? `updatedAt: ${note.updatedAt}` : '',
    '---',
    ''
  ].filter(Boolean).join('\n');
  const parts = [frontmatter];
  if (note.body) parts.push(note.body);
  if (note.transcript) {
    parts.push('', '## Transcript', '', note.transcript);
  }
  if (note.summary) {
    parts.push('', '## Summary', '', note.summary);
  }
  if (Array.isArray(note.keyPointsJson) && note.keyPointsJson.length > 0) {
    parts.push('', '## Key Points', '');
    note.keyPointsJson.forEach(kp => {
      const text = typeof kp === 'string' ? kp : (kp.text || kp);
      parts.push(`- ${text}`);
    });
  }
  if (Array.isArray(note.actionItemsJson) && note.actionItemsJson.length > 0) {
    parts.push('', '## Action Items', '');
    note.actionItemsJson.forEach(ai => {
      const text = typeof ai === 'string' ? ai : (ai.text || ai);
      const due = typeof ai === 'object' && ai.dueDate ? ` (due: ${ai.dueDate})` : '';
      parts.push(`- [ ] ${text}${due}`);
    });
  }
  return parts.join('\n');
}

function escapeYaml(value) {
  if (typeof value !== 'string') return value;
  if (/^[\s:#*?|>&!%@`\[\]{},'"\n]/.test(value) || /[\n:]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function sanitizeFilename(name) {
  return (name || 'untitled').replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/-+/g, '-').substring(0, 60);
}

async function generate(req, res, field, fn, store) {
  const note = store.getNote(req.session.userId, req.params.id);
  if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
  try {
    const result = await fn(`${note.title}\n${note.body}\n${note.transcript}`);
    const updated = store.updateNote(req.session.userId, note.id, { [field]: result });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || 'AI generation failed' });
  }
}

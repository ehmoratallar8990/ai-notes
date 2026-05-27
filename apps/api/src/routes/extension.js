import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { requireUser } from '../middleware/auth.js';
import { recordingsRouter } from './recordings.js';

const upload = multer({ dest: 'uploads/extension', limits: { fileSize: 250 * 1024 * 1024 } });
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function extensionRouter(store) {
  const router = express.Router();
  router.post('/pairing/start', requireUser, (req,res)=>{
    const token = crypto.randomBytes(24).toString('base64url');
    const session = store.createExtensionSession(req.session.userId, hash(token));
    res.json({ success:true, data:{ pairingToken: token, sessionId: session.id } });
  });
  router.post('/pairing/verify', (req,res)=>res.json({ success:true, data:{ paired:true } }));
  router.get('/session', requireUser, (req,res)=>res.json({ success:true, data:{ userId:req.session.userId } }));
  router.post('/recordings', requireUser, upload.single('audio'), (req,res)=>{
    if (!req.file) return res.status(400).json({ success:false, error:'audio file is required' });
    const note = store.createNote(req.session.userId, { title: req.body.title || 'Meeting recording', source: 'chrome-extension', meetingPlatform: req.body.meetingPlatform, meetingUrl: req.body.meetingUrl, transcriptionStatus: 'pending' });
    const recording = store.createRecording(req.session.userId, { noteId: note.id, filePath: req.file.path, mimeType: req.file.mimetype, sizeBytes: req.file.size, source: 'chrome-extension', meetingPlatform: req.body.meetingPlatform, meetingUrl: req.body.meetingUrl, startedAt: req.body.startedAt, endedAt: req.body.endedAt, durationSeconds: Number(req.body.durationSeconds || 0) });
    res.status(201).json({ success:true, data:{ note, recording } });
  });
  return router;
}

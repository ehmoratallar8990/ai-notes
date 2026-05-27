import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { requireUser } from '../middleware/auth.js';
import { createTranscriptionProvider } from '../services/transcriptionService.js';

const upload = multer({ dest: path.resolve('uploads/recordings'), limits: { fileSize: 100 * 1024 * 1024 } });

export function recordingsRouter(store) {
  const router = express.Router();
  const transcription = createTranscriptionProvider();
  router.use(requireUser);
  router.post('/', upload.single('audio'), async (req,res)=>{
    if (!req.file) return res.status(400).json({ success:false, error:'audio file is required' });
    const note = store.createNote(req.session.userId, { title: req.body.title || 'Voice note', source: req.body.source || 'voice', transcriptionStatus: 'processing' });
    const recording = store.createRecording(req.session.userId, { noteId: note.id, filePath: req.file.path, mimeType: req.file.mimetype, sizeBytes: req.file.size, durationSeconds: Number(req.body.durationSeconds || 0), source: req.body.source || 'voice' });
    const result = await transcription.transcribe({ filePath: req.file.path });
    const updated = store.updateNote(req.session.userId, note.id, { transcript: result.transcript, transcriptionStatus: result.status });
    res.status(201).json({ success:true, data:{ note: updated, recording } });
  });
  return router;
}

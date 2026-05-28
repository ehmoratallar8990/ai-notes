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

  router.post('/', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'audio file is required' });

    const note = store.createNote(req.session.userId, {
      title: req.body.title || 'Voice note',
      source: req.body.source || 'voice',
      transcriptionStatus: 'processing'
    });

    const recording = store.createRecording(req.session.userId, {
      noteId: note.id,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      durationSeconds: Number(req.body.durationSeconds || 0),
      source: req.body.source || 'voice'
    });

    try {
      const result = await transcription.transcribe({ filePath: req.file.path, mimeType: req.file.mimetype });
      const updated = store.updateNote(req.session.userId, note.id, {
        transcript: result.transcript,
        transcriptSegments: result.segments || [],
        speakerCount: result.speakerCount || 0,
        transcriptionStatus: result.status || 'completed',
      });
      return res.status(201).json({ success: true, data: { note: updated, recording } });
    } catch (error) {
      const failed = store.updateNote(req.session.userId, note.id, {
        transcriptionStatus: 'failed',
        transcript: ''
      });
      return res.status(500).json({
        success: false,
        error: error?.message || 'Transcription failed',
        data: { note: failed, recording }
      });
    }
  });

  return router;
}

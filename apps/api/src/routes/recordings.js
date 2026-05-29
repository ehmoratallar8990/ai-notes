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

    store.updateNote(req.session.userId, note.id, { audioPath: req.file.path });

    try {
      const lang = (req.body.language || '').trim() || null;
      const result = await transcription.transcribe({ filePath: req.file.path, mimeType: req.file.mimetype, language: lang });
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

  // Store audio for an already-transcribed note (on-device transcription path)
  router.post('/:noteId/audio', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'audio file is required' });
    const note = store.getNote(req.session.userId, req.params.noteId);
    if (!note) return res.status(404).json({ success: false, error: 'Note not found' });
    store.createRecording(req.session.userId, {
      noteId: req.params.noteId,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      source: 'voice',
    });
    const updated = store.updateNote(req.session.userId, req.params.noteId, { audioPath: req.file.path });
    res.json({ success: true, data: updated });
  });

  router.get('/:noteId/audio', async (req, res) => {
    try {
      const recording = store.getRecordingByNoteId(req.session.userId, req.params.noteId);
      if (!recording?.filePath) return res.status(404).json({ success: false, error: 'No audio found' });

      const { createReadStream } = await import('node:fs');
      const { stat } = await import('node:fs/promises');
      const fileStat = await stat(recording.filePath);
      const mimeType = recording.mimeType || 'audio/webm';
      const range = req.headers.range;

      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : fileStat.size - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });
        createReadStream(recording.filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileStat.size,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
        });
        createReadStream(recording.filePath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

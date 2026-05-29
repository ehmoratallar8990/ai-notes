import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import multer from 'multer';
import { requireUser } from '../middleware/auth.js';
import { createTranscriptionProvider } from '../services/transcriptionService.js';

const execFileAsync = promisify(execFile);
// Resolve paths relative to this file regardless of CWD
// __fileDir = apps/api/src/routes/, 4 levels up = monorepo root
const __fileDir = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__fileDir, '../../../..');
const EXT_ZIP = path.join(MONOREPO_ROOT, 'apps', 'extension', 'extension.zip');
const EXT_DIST = path.join(MONOREPO_ROOT, 'apps', 'extension', 'dist');

const upload = multer({ dest: 'uploads/extension', limits: { fileSize: 250 * 1024 * 1024 } });
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function extensionRouter(store) {
  const router = express.Router();
  const transcription = createTranscriptionProvider();
  router.post('/pairing/start', requireUser, (req,res)=>{
    const token = crypto.randomBytes(24).toString('base64url');
    const session = store.createExtensionSession(req.session.userId, hash(token));
    res.json({ success:true, data:{ pairingToken: token, sessionId: session.id } });
  });
  router.post('/pairing/verify', (req,res)=>res.json({ success:true, data:{ paired:true } }));
  router.get('/session', requireUser, (req,res)=>res.json({ success:true, data:{ userId:req.session.userId } }));

  router.post('/recordings', requireUser, upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'audio file is required' });

    const note = store.createNote(req.session.userId, {
      title: req.body.title || 'Meeting recording',
      source: 'chrome-extension',
      meetingPlatform: req.body.meetingPlatform,
      meetingUrl: req.body.meetingUrl,
      transcriptionStatus: 'processing'
    });

    const recording = store.createRecording(req.session.userId, {
      noteId: note.id,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      source: 'chrome-extension',
      meetingPlatform: req.body.meetingPlatform,
      meetingUrl: req.body.meetingUrl,
      startedAt: req.body.startedAt,
      endedAt: req.body.endedAt,
      durationSeconds: Number(req.body.durationSeconds || 0)
    });

    try {
      const result = await transcription.transcribe({ filePath: req.file.path });
      const updated = store.updateNote(req.session.userId, note.id, {
        transcript: result.transcript,
        transcriptionStatus: result.status || 'completed'
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

  // Serve pre-built extension zip (built by `make extension-zip`)
  router.get('/download', async (_req, res) => {
    if (existsSync(EXT_ZIP)) {
      res.setHeader('Content-Disposition', 'attachment; filename="ai-notes-extension.zip"');
      res.setHeader('Content-Type', 'application/zip');
      return createReadStream(EXT_ZIP).pipe(res);
    }

    // Try building on-demand with system zip if dist/ exists
    if (existsSync(EXT_DIST)) {
      try {
        await execFileAsync('zip', ['-r', EXT_ZIP, '.'], { cwd: EXT_DIST });
        res.setHeader('Content-Disposition', 'attachment; filename="ai-notes-extension.zip"');
        res.setHeader('Content-Type', 'application/zip');
        return createReadStream(EXT_ZIP).pipe(res);
      } catch (_) { /* zip not available */ }
    }

    return res.status(404).json({
      success: false,
      error: 'Extension zip not found. Run `make extension-zip` from the monorepo root.',
    });
  });

  router.post('/clips', requireUser, (req,res)=>{
    const { title, body, url } = req.body;
    if (!url) return res.status(400).json({ success:false, error:'url is required' });
    const note = store.createNote(req.session.userId, {
      title: title || 'Web clip',
      body: body || '',
      source: 'clip',
      meetingUrl: url
    });
    res.status(201).json({ success:true, data:{ note } });
  });
  return router;
}

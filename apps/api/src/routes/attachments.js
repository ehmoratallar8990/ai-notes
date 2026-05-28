import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requireUser } from '../middleware/auth.js';

const UPLOAD_DIR = path.resolve('uploads', 'attachments');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ext = path.extname(file.originalname) || '';
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

export function attachmentsRouter(store) {
  const router = express.Router();
  router.use(requireUser);

  // Serve / download attachment
  router.get('/:id', (req, res) => {
    const attachment = store.getAttachment(req.session.userId, req.params.id);
    if (!attachment) return res.status(404).json({ success: false, error: 'Attachment not found' });

    const filePath = path.join(UPLOAD_DIR, attachment.storagePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found on disk' });

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    res.setHeader('Content-Length', attachment.sizeBytes);
    fs.createReadStream(filePath).pipe(res);
  });

  // Delete attachment
  router.delete('/:id', (req, res) => {
    const attachment = store.getAttachment(req.session.userId, req.params.id);
    if (!attachment) return res.status(404).json({ success: false, error: 'Attachment not found' });

    const filePath = path.join(UPLOAD_DIR, attachment.storagePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    store.deleteAttachment(req.session.userId, req.params.id);
    res.json({ success: true, data: { deleted: true } });
  });

  return { router, upload };
}

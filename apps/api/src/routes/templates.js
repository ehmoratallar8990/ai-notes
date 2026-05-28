import express from 'express';
import { z } from 'zod';
import { requireUser } from '../middleware/auth.js';

export function templatesRouter(store) {
  const router = express.Router();
  router.use(requireUser);

  router.get('/', (req, res) => {
    res.json({ success: true, data: store.listTemplates(req.session.userId) });
  });

  router.post('/', (req, res) => {
    const parse = z.object({
      name: z.string().min(1),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      meetingPlatform: z.string().optional(),
      meetingUrl: z.string().optional()
    }).safeParse(req.body);
    if (!parse.success) return res.status(400).json({ success: false, error: 'Invalid template' });
    res.status(201).json({ success: true, data: store.createTemplate(req.session.userId, parse.data) });
  });

  router.get('/:id', (req, res) => {
    const template = store.getTemplate(req.session.userId, req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data: template });
  });

  router.delete('/:id', (req, res) => {
    const deleted = store.deleteTemplate(req.session.userId, req.params.id);
    res.json({ success: true, data: { deleted } });
  });

  return router;
}

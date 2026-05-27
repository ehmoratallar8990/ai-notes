import express from 'express';
import { z } from 'zod';
import { requireUser } from '../middleware/auth.js';

export function searchRouter(searchProvider) {
  const router = express.Router();
  router.use(requireUser);

  router.get('/', async (req, res) => {
    const parsed = z.object({ q: z.string().trim().min(1).max(200) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Search query is required' });

    try {
      const results = await searchProvider.search(parsed.data.q);
      res.json({ success: true, data: { query: parsed.data.q, provider: 'duckduckgo', results } });
    } catch (error) {
      console.error('Search failed:', error);
      res.status(502).json({ success: false, error: 'Search provider unavailable' });
    }
  });

  return router;
}

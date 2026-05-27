import express from 'express';
import { requireUser } from '../middleware/auth.js';
import { createAiProvider } from '../services/aiNoteService.js';

export function notesRouter(store) {
  const router = express.Router();
  const ai = createAiProvider();
  router.use(requireUser);
  router.get('/', (req,res)=>res.json({ success:true, data: store.listNotes(req.session.userId, req.query) }));
  router.post('/', (req,res)=>res.status(201).json({ success:true, data: store.createNote(req.session.userId, req.body) }));
  router.get('/:id', (req,res)=>{ const note=store.getNote(req.session.userId, req.params.id); if(!note) return res.status(404).json({success:false,error:'Note not found'}); res.json({success:true,data:note}); });
  router.patch('/:id', (req,res)=>{ const note=store.updateNote(req.session.userId, req.params.id, req.body); if(!note) return res.status(404).json({success:false,error:'Note not found'}); res.json({success:true,data:note}); });
  router.delete('/:id', (req,res)=>res.json({success:true,data:{deleted:store.deleteNote(req.session.userId, req.params.id)}}));
  router.post('/:id/summary', async (req,res)=>generate(req,res,'summary', ai.summary.bind(ai), store));
  router.post('/:id/key-points', async (req,res)=>generate(req,res,'keyPointsJson', ai.keyPoints.bind(ai), store));
  router.post('/:id/action-items', async (req,res)=>generate(req,res,'actionItemsJson', ai.actionItems.bind(ai), store));
  router.post('/:id/mind-map', async (req,res)=>generate(req,res,'mindMapJson', ai.mindMap.bind(ai), store));
  return router;
}

async function generate(req, res, field, fn, store) {
  const note = store.getNote(req.session.userId, req.params.id);
  if (!note) return res.status(404).json({ success:false, error:'Note not found' });
  const result = await fn(`${note.title}\n${note.body}\n${note.transcript}`);
  const updated = store.updateNote(req.session.userId, note.id, { [field]: result });
  res.json({ success:true, data: updated });
}

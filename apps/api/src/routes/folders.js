import express from 'express';
import { z } from 'zod';
import { requireUser } from '../middleware/auth.js';

export function foldersRouter(store) {
  const router = express.Router();
  router.use(requireUser);
  router.get('/', (req,res)=>res.json({ success:true, data: store.listFolders(req.session.userId) }));
  router.post('/', (req,res)=>{ const p=z.object({name:z.string().min(1)}).safeParse(req.body); if(!p.success) return res.status(400).json({success:false,error:'Invalid folder'}); res.status(201).json({success:true,data:store.createFolder(req.session.userId,p.data)}); });
  router.patch('/:id', (req,res)=>{ const folder=store.updateFolder(req.session.userId, req.params.id, req.body); if(!folder) return res.status(404).json({success:false,error:'Folder not found'}); res.json({success:true,data:folder}); });
  router.delete('/:id', (req,res)=>res.json({success:true,data:{deleted:store.deleteFolder(req.session.userId, req.params.id)}}));
  return router;
}

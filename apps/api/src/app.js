import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { store as defaultStore } from './store/memoryStore.js';
import { attachDevUser } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { foldersRouter } from './routes/folders.js';
import { notesRouter } from './routes/notes.js';
import { recordingsRouter } from './routes/recordings.js';
import { extensionRouter } from './routes/extension.js';

export function createApp({ store = defaultStore } = {}) {
  const app = express();
  app.use(cors({ origin: process.env.ORIGIN || 'http://localhost:5173', credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieSession({ name: 'ai_notes_session', keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'], httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }));

  app.get('/api/health', (_req,res)=>res.json({ success:true, data:{ status:'ok', freeProviders:true } }));
  app.use('/api/auth', authRouter(store));
  app.use(attachDevUser(store));
  app.use('/api/folders', foldersRouter(store));
  app.use('/api/notes', notesRouter(store));
  app.use('/api/recordings', recordingsRouter(store));
  app.use('/api/extension', extensionRouter(store));
  return app;
}

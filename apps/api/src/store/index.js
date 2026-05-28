import path from 'node:path';
import { createFileStore } from './fileStore.js';
import { createMemoryStore } from './memoryStore.js';

const dbClient = String(process.env.DB_CLIENT || 'memory').toLowerCase();
const defaultFilePath = process.env.DB_FILE_PATH || path.resolve(process.cwd(), 'data/ai-notes.json');

export const store = dbClient === 'file' || dbClient === 'json'
  ? createFileStore({ filePath: defaultFilePath })
  : createMemoryStore();

export { createFileStore, createMemoryStore };

import express from 'express';
import { z } from 'zod';
import { createPasskeyLoginOptions, createPasskeyRegistrationOptions } from '../services/passkeyOptions.js';

export function authRouter(store) {
  const router = express.Router();
  const rpName = process.env.RP_NAME || 'AI Notes';
  const rpID = process.env.RP_ID || 'localhost';

  router.get('/me', (req, res) => {
    const user = req.session?.userId ? store.findUserById(req.session.userId) : null;
    res.json({ success: true, data: { user } });
  });

  router.post('/passkey/register/options', (req, res) => {
    const schema = z.object({ username: z.string().min(2), displayName: z.string().min(1), preferredLanguage: z.enum(['en','es']).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid registration data' });
    let user = store.findUserByUsername(parsed.data.username);
    if (!user) user = store.createUser(parsed.data);
    req.session.pendingRegistrationUserId = user.id;
    const options = createPasskeyRegistrationOptions({ rpName, rpID, userId: user.id, username: user.username, displayName: user.displayName });
    req.session.currentChallenge = options.challenge;
    res.json({ success: true, data: options });
  });

  router.post('/passkey/register/verify', (req, res) => {
    const userId = req.session.pendingRegistrationUserId;
    if (!userId) return res.status(400).json({ success: false, error: 'No pending registration' });
    const credentialId = req.body?.id || req.body?.credentialId || `dev-${Date.now()}`;
    store.createPasskey(userId, { credentialId, publicKey: req.body?.publicKey || 'development-placeholder', counter: 0, transports: req.body?.transports || [], deviceType: 'singleDevice', backedUp: false });
    req.session.userId = userId;
    delete req.session.pendingRegistrationUserId;
    res.json({ success: true, data: { user: store.findUserById(userId) } });
  });

  router.post('/passkey/login/options', (_req, res) => {
    const options = createPasskeyLoginOptions({ rpID });
    res.json({ success: true, data: options });
  });

  router.post('/passkey/login/verify', (req, res) => {
    const credentialId = req.body?.id || req.body?.credentialId;
    const passkey = credentialId ? store.findPasskeyByCredentialId(credentialId) : null;
    if (!passkey) return res.status(401).json({ success: false, error: 'Passkey not recognized' });
    req.session.userId = passkey.userId;
    res.json({ success: true, data: { user: store.findUserById(passkey.userId) } });
  });

  router.post('/logout', (req, res) => { req.session = null; res.json({ success: true }); });
  return router;
}

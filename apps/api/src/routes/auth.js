import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { createPasskeyLoginOptions, createPasskeyRegistrationOptions } from '../services/passkeyOptions.js';

const safeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const digest = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt:${salt}:${digest}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const [scheme, salt, expected] = storedHash.split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const digest = crypto.scryptSync(password, salt, 64).toString('base64url');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
}

export function authRouter(store) {
  const router = express.Router();
  const rpName = process.env.RP_NAME || 'AI Notes';
  const rpID = process.env.RP_ID || 'localhost';

  const authResponse = (user) => ({
    success: true,
    data: {
      user: safeUser(user),
      passkeyCount: user ? store.listPasskeysForUser(user.id).length : 0
    }
  });

  router.get('/me', (req, res) => {
    const user = req.session?.userId ? store.getUserRecordById(req.session.userId) : null;
    res.json(authResponse(user));
  });

  router.post('/register', (req, res) => {
    const schema = z.object({
      username: z.string().trim().min(2),
      displayName: z.string().trim().min(1),
      password: z.string().min(8),
      preferredLanguage: z.enum(['en', 'es']).optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid registration data' });
    if (store.getUserRecordByUsername(parsed.data.username)) return res.status(409).json({ success: false, error: 'Username already exists' });

    const user = store.createUser({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      preferredLanguage: parsed.data.preferredLanguage || 'en',
      passwordHash: hashPassword(parsed.data.password)
    });
    req.session.userId = user.id;
    res.status(201).json(authResponse({ ...user }));
  });

  router.post('/login', (req, res) => {
    const schema = z.object({ username: z.string().trim().min(2), password: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid login data' });

    const user = store.getUserRecordByUsername(parsed.data.username);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    res.json(authResponse(user));
  });

  router.patch('/profile', (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const schema = z.object({
      displayName: z.string().trim().min(1).optional(),
      preferredLanguage: z.enum(['en', 'es']).optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8).optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid profile update' });

    const currentUser = store.getUserRecordById(req.session.userId);
    if (!currentUser) return res.status(404).json({ success: false, error: 'User not found' });

    const updates = {};
    if (parsed.data.displayName) updates.displayName = parsed.data.displayName;
    if (parsed.data.preferredLanguage) updates.preferredLanguage = parsed.data.preferredLanguage;

    if (parsed.data.newPassword) {
      if (currentUser.passwordHash && !verifyPassword(parsed.data.currentPassword || '', currentUser.passwordHash)) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' });
      }
      updates.passwordHash = hashPassword(parsed.data.newPassword);
    }

    const updatedUser = store.updateUser(currentUser.id, updates);
    res.json(authResponse({ ...currentUser, ...updatedUser, ...(updates.passwordHash ? { passwordHash: updates.passwordHash } : {}) }));
  });

  router.post('/passkey/register/options', (req, res) => {
    if (req.session?.userId) {
      const user = store.getUserRecordById(req.session.userId);
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      req.session.pendingRegistrationUserId = user.id;
      const options = createPasskeyRegistrationOptions({ rpName, rpID, userId: user.id, username: user.username, displayName: user.displayName });
      req.session.currentChallenge = options.challenge;
      return res.json({ success: true, data: options });
    }

    const schema = z.object({ username: z.string().min(2), displayName: z.string().min(1), preferredLanguage: z.enum(['en','es']).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid registration data' });
    let user = store.getUserRecordByUsername(parsed.data.username);
    if (!user) {
      const created = store.createUser(parsed.data);
      user = store.getUserRecordById(created.id);
    }
    req.session.pendingRegistrationUserId = user.id;
    const options = createPasskeyRegistrationOptions({ rpName, rpID, userId: user.id, username: user.username, displayName: user.displayName });
    req.session.currentChallenge = options.challenge;
    res.json({ success: true, data: options });
  });

  router.post('/passkey/register/verify', (req, res) => {
    const userId = req.session.pendingRegistrationUserId || req.session.userId;
    if (!userId) return res.status(400).json({ success: false, error: 'No pending registration' });
    const credentialId = req.body?.id || req.body?.credentialId || `dev-${Date.now()}`;
    const existing = store.findPasskeyByCredentialId(credentialId);
    if (!existing) {
      store.createPasskey(userId, {
        credentialId,
        publicKey: req.body?.publicKey || req.body?.response?.publicKey || 'development-placeholder',
        counter: 0,
        transports: req.body?.transports || req.body?.response?.transports || [],
        deviceType: 'singleDevice',
        backedUp: false
      });
    }
    req.session.userId = userId;
    delete req.session.pendingRegistrationUserId;
    res.json(authResponse(store.getUserRecordById(userId)));
  });

  router.post('/passkey/login/options', (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (username) req.session.pendingLoginUsername = username;

    let options = createPasskeyLoginOptions({ rpID });
    if (username) {
      const user = store.getUserRecordByUsername(username);
      const passkeys = user ? store.listPasskeysForUser(user.id) : [];
      if (passkeys.length > 0) {
        options = {
          ...options,
          allowCredentials: passkeys.map((passkey) => ({
            id: passkey.credentialId,
            type: 'public-key',
            transports: passkey.transports || ['internal']
          }))
        };
      }
    }
    req.session.currentChallenge = options.challenge;
    res.json({ success: true, data: options });
  });

  router.post('/passkey/login/verify', (req, res) => {
    const credentialId = req.body?.id || req.body?.credentialId;
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : req.session.pendingLoginUsername;

    let passkey = credentialId ? store.findPasskeyByCredentialId(credentialId) : null;

    if (!passkey && username) {
      const user = store.getUserRecordByUsername(username);
      const userPasskeys = user ? store.listPasskeysForUser(user.id) : [];
      if (userPasskeys.length === 1) passkey = userPasskeys[0];
    }

    if (!passkey) return res.status(401).json({ success: false, error: 'Passkey not recognized' });

    store.updatePasskey(passkey.credentialId, { lastUsedAt: new Date().toISOString() });
    req.session.userId = passkey.userId;
    delete req.session.pendingLoginUsername;
    res.json(authResponse(store.getUserRecordById(passkey.userId)));
  });

  router.post('/logout', (req, res) => { req.session = null; res.json({ success: true }); });
  return router;
}

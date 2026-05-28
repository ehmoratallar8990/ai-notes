import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('password register and login flow works', async () => {
  const app = createApp();
  const registerAgent = request.agent(app);

  const registerRes = await registerAgent.post('/api/auth/register').send({
    username: 'password-user',
    displayName: 'Password User',
    password: 'supersecret123',
    preferredLanguage: 'en'
  });

  assert.equal(registerRes.status, 201);
  assert.equal(registerRes.body.success, true);
  assert.equal(registerRes.body.data.user.username, 'password-user');
  assert.equal(Object.hasOwn(registerRes.body.data.user, 'passwordHash'), false);

  await registerAgent.post('/api/auth/logout').send({});

  const loginAgent = request.agent(app);
  const loginRes = await loginAgent.post('/api/auth/login').send({ username: 'password-user', password: 'supersecret123' });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.success, true);
  assert.equal(loginRes.body.data.user.displayName, 'Password User');
});

test('profile update can change display name and password', async () => {
  const app = createApp();
  const agent = request.agent(app);

  await agent.post('/api/auth/register').send({
    username: 'profile-user',
    displayName: 'Before Name',
    password: 'supersecret123',
    preferredLanguage: 'en'
  });

  const patchRes = await agent.patch('/api/auth/profile').send({
    displayName: 'After Name',
    preferredLanguage: 'es',
    currentPassword: 'supersecret123',
    newPassword: 'newsecret123'
  });

  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.data.user.displayName, 'After Name');
  assert.equal(patchRes.body.data.user.preferredLanguage, 'es');

  await agent.post('/api/auth/logout').send({});
  const loginRes = await request.agent(app).post('/api/auth/login').send({ username: 'profile-user', password: 'newsecret123' });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.data.user.displayName, 'After Name');
});

test('authenticated user can add a passkey and log in with it later', async () => {
  const app = createApp();
  const agent = request.agent(app);

  await agent.post('/api/auth/register').send({
    username: 'passkey-user',
    displayName: 'Passkey User',
    password: 'supersecret123',
    preferredLanguage: 'en'
  });

  const optionsRes = await agent.post('/api/auth/passkey/register/options').send({});
  assert.equal(optionsRes.status, 200);
  assert.equal(optionsRes.body.success, true);

  const verifyRes = await agent.post('/api/auth/passkey/register/verify').send({
    id: 'cred-passkey-user',
    transports: ['internal']
  });
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.data.passkeyCount, 1);

  await agent.post('/api/auth/logout').send({});

  const passkeyAgent = request.agent(app);
  const loginOptionsRes = await passkeyAgent.post('/api/auth/passkey/login/options').send({ username: 'passkey-user' });
  assert.equal(loginOptionsRes.status, 200);
  assert.equal(loginOptionsRes.body.data.allowCredentials[0].id, 'cred-passkey-user');

  const loginVerifyRes = await passkeyAgent.post('/api/auth/passkey/login/verify').send({ credentialId: 'cred-passkey-user' });
  assert.equal(loginVerifyRes.status, 200);
  assert.equal(loginVerifyRes.body.data.user.username, 'passkey-user');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasskeyLoginOptions, createPasskeyRegistrationOptions } from '../src/services/passkeyOptions.js';

test('passkey login options do not require email or allowCredentials', () => {
  const options = createPasskeyLoginOptions({ rpID: 'localhost' });
  assert.equal(options.rpID, 'localhost');
  assert.equal(options.userVerification, 'preferred');
  assert.equal(Object.hasOwn(options, 'allowCredentials'), false);
  assert.ok(options.challenge.length > 20);
});

test('passkey registration requires discoverable resident credentials', () => {
  const options = createPasskeyRegistrationOptions({
    rpName: 'AI Notes', rpID: 'localhost', userId: 'user-1', username: 'eduardo', displayName: 'Eduardo'
  });
  assert.equal(options.authenticatorSelection.residentKey, 'required');
  assert.equal(options.authenticatorSelection.requireResidentKey, true);
  assert.equal(options.user.name, 'eduardo');
});

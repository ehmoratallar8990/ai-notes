import crypto from 'node:crypto';

function challenge() {
  return crypto.randomBytes(32).toString('base64url');
}

export function createPasskeyLoginOptions({ rpID }) {
  return {
    challenge: challenge(),
    timeout: 60000,
    rpID,
    userVerification: 'preferred'
    // Intentionally no allowCredentials: this enables discoverable passkey login
    // without requiring username/email before opening the browser modal.
  };
}

export function createPasskeyRegistrationOptions({ rpName, rpID, userId, username, displayName }) {
  return {
    challenge: challenge(),
    rp: { name: rpName, id: rpID },
    user: {
      id: Buffer.from(String(userId)).toString('base64url'),
      name: username,
      displayName
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },
      { alg: -257, type: 'public-key' }
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'preferred'
    }
  };
}

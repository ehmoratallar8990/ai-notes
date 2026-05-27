# AI Notes

Free/self-hostable AI note-taking PWA + Express API + Chrome extension, written in JavaScript.

## What it does

- Mobile-first PWA for text notes and voice recordings
- Multi-user notes, folders/categories, and recordings
- Passkey-oriented auth with discoverable credentials: login options do **not** require email before opening the passkey modal
- Free/mock transcription provider, ready for local Whisper/Vosk integration
- Free/mock AI provider, ready for Ollama/llama.cpp/local OpenAI-compatible integration
- English and Spanish UI strings
- Chrome extension MVP for opt-in meeting tab recording and upload

## Stack

- JavaScript only
- React + Vite PWA
- Express API
- Node test runner + Supertest
- In-memory development store plus SQL migration files
- Apache/httpd reverse proxy in Docker Compose
- Chrome Manifest V3 extension

## Quick start

```bash
make install
make test
make build
make dev
```

Open:

- Web: http://localhost:5173
- API health: http://localhost:3001/api/health

## Docker

```bash
make docker-up
curl http://localhost:8080/api/health
make docker-down
```

Docker URLs use `.env` values with safe fallbacks from `docker-compose.yml`:

- Proxy/web: `http://localhost:${PROXY_PORT:-8080}`
- API direct: `http://localhost:${API_PORT:-3001}/api/health`
- Web direct: `http://localhost:${WEB_PORT:-5173}`

Copy `.env.example` to `.env` and adjust ports if needed.

## Chrome extension

Build extension:

```bash
make extension-build
```

Load in Chrome:

1. Go to `chrome://extensions`.
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select `apps/extension/dist`.
5. Set backend URL to `http://localhost:3001`.

The extension supports opt-in recording for meeting tabs such as Google Meet, Teams web, and Zoom web where Chrome tab capture is allowed.

Privacy reminder: do not record meetings without consent. Auto-record is opt-in and should visibly indicate recording status.

## Passkey auth notes

The API implements the key requirement for email-less passkey login:

- `POST /api/auth/passkey/login/options` does not require email/username.
- The generated options intentionally omit `allowCredentials`.
- Registration options require resident/discoverable credentials:
  - `residentKey: "required"`
  - `requireResidentKey: true`

The current MVP has a development verification placeholder so the app can run locally while the frontend WebAuthn ceremony is wired next. The backend service boundaries are prepared for `@simplewebauthn/server` verification.

## Free providers

No paid APIs are required.

Transcription providers planned/configurable:

- `mock` — included
- `whisper-cpp` — local/free
- `faster-whisper` — local/free
- `vosk` — local/free

AI providers planned/configurable:

- `mock` — included
- `ollama` — local/free
- `llama-cpp` — local/free
- `local-openai-compatible` — self-hosted/free

Environment:

```bash
TRANSCRIPTION_PROVIDER=mock
AI_PROVIDER=mock
```

## API endpoints

Auth:

```txt
POST /api/auth/passkey/register/options
POST /api/auth/passkey/register/verify
POST /api/auth/passkey/login/options
POST /api/auth/passkey/login/verify
POST /api/auth/logout
GET  /api/auth/me
```

Folders:

```txt
GET    /api/folders
POST   /api/folders
PATCH  /api/folders/:id
DELETE /api/folders/:id
```

Notes:

```txt
GET    /api/notes
POST   /api/notes
GET    /api/notes/:id
PATCH  /api/notes/:id
DELETE /api/notes/:id
POST   /api/notes/:id/summary
POST   /api/notes/:id/key-points
POST   /api/notes/:id/action-items
POST   /api/notes/:id/mind-map
```

Recordings:

```txt
POST /api/recordings
```

Extension:

```txt
POST /api/extension/pairing/start
POST /api/extension/pairing/verify
GET  /api/extension/session
POST /api/extension/recordings
```

## Database

SQL migration starter:

```txt
apps/api/migrations/001_initial.sql
```

The default MVP uses `DB_CLIENT=memory` for fast local development and tests.

## Makefile commands

```bash
make install
make dev
make build
make test
make lint
make docker-up
make docker-down
make migrate
make seed
make extension-build
make extension-zip
```

## Next implementation steps

- Replace development passkey verification placeholder with full `@simplewebauthn/server` verification.
- Add MySQL repository implementation behind the store interface.
- Add Ollama provider implementation.
- Add whisper.cpp/faster-whisper worker.
- Improve Chrome extension auth pairing outside same-site cookies.
- Add visual mind-map rendering with D3/Markmap.

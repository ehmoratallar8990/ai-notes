# AI Notes

Free/self-hostable AI note-taking PWA + Express API + Chrome extension, written in JavaScript.

## What it does

- Mobile-first PWA for text notes and voice recordings
- Multi-user notes, folders/categories, and recordings
- Passkey-oriented auth with discoverable credentials: login options do **not** require email before opening the passkey modal
- **Markdown editing** — toggle between plain text and Markdown when creating/editing notes, with live HTML preview
- **Note pinning** — pin important notes to the top of your list
- **Note tags** — add tags/labels to notes and filter by tag
- **Note export** — export single notes or all notes as Markdown with YAML frontmatter or as JSON
- **Ollama AI provider** — use local LLMs for summaries, key points, action items, and mind maps
- Free/mock transcription provider, ready for local Whisper/Vosk integration
- Free/mock AI provider, ready for Ollama/llama.cpp/local OpenAI-compatible integration
- Free DuckDuckGo web search provider for note context lookup
- English and Spanish UI strings
- **Web clipper** — right-click any page or use the extension popup to save pages as notes with URL, title, and selected text
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

The extension supports opt-in recording for meeting tabs such as Google Meet, Teams web, and Zoom web where Chrome tab capture is allowed. It also includes a **web clipper**:

- **Right-click** any page and choose **Clip to AI Notes** to save the current page as a note.
- Click the **Clip this page** button in the extension popup to clip without right-clicking.
- Clipped notes include the page title, URL (`meetingUrl` field), and selected text or full page text.

Privacy reminder: do not record meetings without consent. Auto-record is opt-in and should visibly indicate recording status.

## Pinning notes

Pin important notes to keep them at the top of the list:

```txt
PATCH /api/notes/:id/pin     — pin a note
PATCH /api/notes/:id/unpin   — unpin a note
GET  /api/notes?pinned=true  — filter pinned notes only
GET  /api/notes?pinned=false — filter unpinned notes only
```

Pinned notes are sorted to the top regardless of update time.

## Note tags

Add tags to notes for easy categorization and filtering:

```txt
POST   /api/notes             — create note with { tags: ["work", "meeting"] }
PATCH  /api/notes/:id         — update note with { tags: ["project-x"] }
GET    /api/notes?tag=work    — filter notes by tag
GET    /api/notes/tags        — list all unique tags for the user
```

Tags are passed as a comma-separated string in the frontend create-note form and stored as a JSON array.

## Wiki links and backlinks

Link notes together with `[[Note Title]]` syntax:

```txt
[[Another Note]]     — in any note body, creates a link to "Another Note"
```

Behavior:
- On note save (POST/PATCH), the API parses the body for `[[Title]]` and resolves each title to a matching note ID.
- Resolved links are stored in the `note_links` table (or in-memory `noteLinks`).
- Unresolved titles are silently ignored (no broken links stored).
- Deleting a note automatically cleans up any links where it is the source or target.

API:

```txt
GET /api/notes/:id/links      — list outgoing links from this note
GET /api/notes/:id/backlinks  — list notes that link to this note
```

In the frontend:
- `[[Note Title]]` renders as a clickable purple link in both plain text and Markdown views.
- Missing targets render as dimmed text.
- A **Links** section shows outgoing links in the detail view.
- A **Backlinks** section shows all notes that reference the current one.
- Clicking any link or backlink opens that note.

Circular links are fully supported (A links to B, B links to A).

## Markdown editing

Toggle between plain text and Markdown when creating or editing notes:

```txt
POST   /api/notes              — create note with { format: "markdown" }
PATCH  /api/notes/:id          — update note with { format: "markdown" }
```

In the frontend:
- The create-note form has a **Plain text / Markdown** radio toggle.
- Markdown notes render as formatted HTML in the detail view (headings, bold/italic, lists, code blocks, links).
- Click **Edit** on a note to switch to inline editing with an **Edit / Preview** toggle.
- Existing notes remain plain text by default (backward compatible).

## Note export

Export any single note or all notes at once, in Markdown with YAML frontmatter or raw JSON:

```txt
GET /api/notes/export?format=md        — bulk export all notes as Markdown
GET /api/notes/export?format=json      — bulk export all notes as JSON
GET /api/notes/:id/export?format=md  — export single note as Markdown
GET /api/notes/:id/export?format=json — export single note as JSON
```

Markdown output includes YAML frontmatter with `title`, `source`, `folder`, `tags`, `createdAt`, and `updatedAt`. The body follows the frontmatter, plus optional sections for transcript, summary, key points, and action items (with checkboxes).

In the frontend:
- Each note detail view has an **Export** dropdown (📤) with Markdown and JSON options.
- The toolbar has **Export all as Markdown** and **Export all as JSON** buttons.

## Ollama AI provider

To use a local LLM instead of the mock provider:

1. Install [Ollama](https://ollama.com) and pull a model (e.g. `ollama pull llama3`).
2. Set environment variables:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

3. Restart the API server.

The Ollama provider sends prompts to the `/api/chat` endpoint and parses the response. If JSON parsing fails for structured outputs (key points, action items, mind maps), it falls back to reasonable defaults.

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

AI providers configured:

- `mock` — included
- `ollama` — local/free (new)

Search provider:

- `duckduckgo` — included, uses DuckDuckGo's free Instant Answer API and requires no API key

Environment:

```bash
TRANSCRIPTION_PROVIDER=mock
AI_PROVIDER=mock
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
SEARCH_PROVIDER=duckduckgo
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
GET    /api/notes              — ?folderId=&search=&tag=&pinned=true|false
POST   /api/notes              — { title, body, folderId, tags, format }
GET    /api/notes/tags         — list unique tags for user
GET    /api/notes/:id
PATCH  /api/notes/:id          — { title, body, folderId, tags, pinned, format }
DELETE /api/notes/:id
PATCH  /api/notes/:id/pin
PATCH  /api/notes/:id/unpin
GET    /api/notes/:id/links    — outgoing wiki links
GET    /api/notes/:id/backlinks — incoming wiki links
POST   /api/notes/:id/summary
POST   /api/notes/:id/key-points
POST   /api/notes/:id/action-items
POST   /api/notes/:id/mind-map
GET    /api/notes/export?format=md|json
GET    /api/notes/:id/export?format=md|json
```

Recordings:

```txt
POST /api/recordings
```

Search:

```txt
GET /api/search?q=your+query
```

Extension:

```txt
POST /api/extension/pairing/start
POST /api/extension/pairing/verify
GET  /api/extension/session
POST /api/extension/recordings
POST /api/extension/clips         — { title, body, url }
```

## Database

SQL migration starter:

```txt
apps/api/migrations/001_initial.sql
apps/api/migrations/002_pinned_and_tags.sql
apps/api/migrations/003_markdown.sql
apps/api/migrations/004_web_clipper.sql
apps/api/migrations/005_note_links.sql
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
- Add whisper.cpp/faster-whisper worker.
- Improve Chrome extension auth pairing outside same-site cookies.
- Add visual mind-map rendering with D3/Markmap.
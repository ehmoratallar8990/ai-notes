import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '@ai-notes/i18n';
import TranscribeWorker from './transcribeWorker.js?worker';
import AIWorker from './aiWorker.js?worker';
import './styles.css';

const API = import.meta.env.VITE_API_URL || '';

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  return res.json();
}

// ── Passkey helpers ────────────────────────────────────────────────────────────
function base64UrlToUint8Array(value) {
  if (!value) return new Uint8Array();
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function serializeCredential(credential) {
  return {
    id: credential.id,
    credentialId: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    transports: typeof credential.response?.getTransports === 'function' ? credential.response.getTransports() : [],
  };
}

function normalizeRegistrationOptions(options) {
  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    user: { ...options.user, id: base64UrlToUint8Array(options.user.id) },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map(c => ({ ...c, id: base64UrlToUint8Array(c.id) }))
      : [],
  };
}

function normalizeLoginOptions(options) {
  return {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map(c => ({ ...c, id: base64UrlToUint8Array(c.id) }))
      : undefined,
  };
}

function isPasskeySupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const SOURCE_ICONS = { voice: '🎙', meeting: '📹', manual: '📝', clip: '📎' };
const SOURCE_LABELS = { voice: 'Voice', meeting: 'Meeting', manual: 'Note', clip: 'Clip' };

function formatTimer(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffH = (Date.now() - d) / 3600000;
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 48) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatSegmentTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getSpeakerColor(speaker) {
  const match = speaker.match(/\d+/);
  const num = match ? parseInt(match[0], 10) : 1;
  return `sc-${((num - 1) % 5) + 1}`;
}

// ── Small atoms ───────────────────────────────────────────────────────────────
function StatusMessage({ notice }) {
  if (!notice?.message) return null;
  return (
    <p className={`status-message ${notice.type === 'error' ? 'is-error' : 'is-success'}`}>
      {notice.message}
    </p>
  );
}

function WaveformBars({ bars }) {
  return (
    <div className="waveform" aria-hidden="true">
      {bars.map((h, i) => (
        <div key={i} className="waveform-bar" style={{ '--h': h }} />
      ))}
    </div>
  );
}

// ── Auth section ──────────────────────────────────────────────────────────────
function AuthSection({ tr, notice, onPasskeyLogin, onLogin, onRegister }) {
  const [mode, setMode] = useState('login');
  const [loginUsername, setLoginUsername] = useState('');

  return (
    <section className="auth-shell">
      <div className="auth-intro">
        <p className="auth-eyebrow">AI notes, organized elegantly</p>
        <h2 className="auth-heading">{mode === 'login' ? tr('auth.welcomeBack') : tr('auth.createProfile')}</h2>
        <p className="auth-description">{mode === 'login' ? tr('auth.loginHint') : tr('auth.registerHint')}</p>
      </div>

      <section className="auth-section card">
        <div className="auth-tabs">
          <button type="button" className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`} onClick={() => setMode('login')}>{tr('auth.signIn')}</button>
          <button type="button" className={`auth-tab ${mode === 'register' ? 'is-active' : ''}`} onClick={() => setMode('register')}>{tr('auth.createAccount')}</button>
        </div>

        <StatusMessage notice={notice} />

        {mode === 'login' ? (
          <>
            <form className="auth-form" onSubmit={onLogin}>
              <label className="auth-label">{tr('auth.username')}</label>
              <input className="input-field" name="username" value={loginUsername} onChange={e => setLoginUsername(e.target.value)} placeholder={tr('auth.usernamePlaceholder')} required />
              <label className="auth-label">{tr('auth.password')}</label>
              <input className="input-field" name="password" type="password" placeholder={tr('auth.passwordPlaceholder')} required />
              <button className="btn-primary auth-submit">{tr('auth.signIn')}</button>
            </form>
            <div className="auth-passkey">
              <div className="auth-divider"><span>{tr('auth.or')}</span></div>
              <button type="button" className="btn-secondary auth-passkey-btn" onClick={() => onPasskeyLogin(loginUsername)}>{tr('auth.continueWithPasskey')}</button>
              <p className="auth-helper">{tr('auth.passkeyHint')}</p>
            </div>
            <p className="auth-switch">{tr('auth.noAccount')} <button type="button" className="auth-link" onClick={() => setMode('register')}>{tr('auth.createAccount')}</button></p>
          </>
        ) : (
          <>
            <form className="auth-form" onSubmit={onRegister}>
              <label className="auth-label">{tr('auth.displayName')}</label>
              <input className="input-field" name="displayName" placeholder={tr('auth.displayNamePlaceholder')} required />
              <label className="auth-label">{tr('auth.username')}</label>
              <input className="input-field" name="username" placeholder={tr('auth.usernamePlaceholder')} required />
              <label className="auth-label">{tr('auth.password')}</label>
              <input className="input-field" name="password" type="password" placeholder={tr('auth.passwordPlaceholder')} required minLength={8} />
              <label className="auth-label">{tr('auth.confirmPassword')}</label>
              <input className="input-field" name="confirmPassword" type="password" placeholder={tr('auth.confirmPasswordPlaceholder')} required minLength={8} />
              <button className="btn-primary auth-submit">{tr('auth.createAccount')}</button>
            </form>
            <p className="auth-switch">{tr('auth.haveAccount')} <button type="button" className="auth-link" onClick={() => setMode('login')}>{tr('auth.signIn')}</button></p>
          </>
        )}
      </section>
    </section>
  );
}

// ── Profile page ──────────────────────────────────────────────────────────────
function ProfilePage({ user, notes, tr, notice, onSaveProfile, onAddPasskey, onDeletePasskey, passkeys }) {
  const [changingPw, setChangingPw] = useState(false);
  const initials = (user.displayName || user.username || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="profile-shell">
      {/* Avatar + header */}
      <div className="profile-hero card">
        <div className="profile-avatar" aria-hidden="true">{initials}</div>
        <div className="profile-hero-info">
          <h2 className="profile-name">{user.displayName}</h2>
          <p className="profile-username">@{user.username}</p>
        </div>
        <div className="profile-stats">
          <div className="profile-stat">
            <span className="profile-stat-val">{notes.length}</span>
            <span className="profile-stat-label">Notes</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-val">{user.passkeyCount || 0}</span>
            <span className="profile-stat-label">Passkeys</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-val">{user.preferredLanguage?.toUpperCase() || 'EN'}</span>
            <span className="profile-stat-label">Language</span>
          </div>
        </div>
      </div>

      <StatusMessage notice={notice} />

      <div className="profile-grid">
        {/* Identity form */}
        <div className="profile-col">
          <section className="profile-section card">
            <h3 className="profile-section-title">Identity</h3>
            <form className="auth-form" onSubmit={onSaveProfile}>
              <label className="auth-label">{tr('auth.username')}</label>
              <input className="input-field readonly-field" value={user.username || ''} readOnly />

              <label className="auth-label">{tr('auth.displayName')}</label>
              <input className="input-field" name="displayName" defaultValue={user.displayName || ''} required />

              <label className="auth-label">{tr('auth.language')}</label>
              <select className="input-field" name="preferredLanguage" defaultValue={user.preferredLanguage || 'en'}>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>

              {/* Password change — collapsed by default */}
              <div className="pw-change-wrap">
                <button type="button" className="pw-toggle-btn" onClick={() => setChangingPw(v => !v)}>
                  {changingPw ? '▲ Cancel password change' : '🔑 Change password'}
                </button>
                {changingPw && (
                  <div className="pw-fields">
                    <label className="auth-label">{tr('auth.currentPassword')}</label>
                    <input className="input-field" type="password" name="currentPassword" placeholder={tr('auth.currentPasswordPlaceholder')} />
                    <label className="auth-label">{tr('auth.newPassword')}</label>
                    <input className="input-field" type="password" name="newPassword" placeholder={tr('auth.newPasswordPlaceholder')} minLength={8} />
                    <label className="auth-label">{tr('auth.confirmNewPassword')}</label>
                    <input className="input-field" type="password" name="confirmNewPassword" placeholder={tr('auth.confirmPasswordPlaceholder')} minLength={8} />
                  </div>
                )}
              </div>

              <button className="btn-primary" type="submit">{tr('auth.saveProfile')}</button>
            </form>
          </section>
        </div>

        {/* Passkeys section */}
        <div className="profile-col">
          <section className="profile-section card">
            <div className="profile-section-header">
              <h3 className="profile-section-title">Passkeys</h3>
              <button className="btn-secondary passkey-add-btn" type="button" onClick={onAddPasskey}>+ Add</button>
            </div>
            <p className="profile-copy">{tr('auth.passkeyHelp')}</p>

            {passkeys.length === 0 ? (
              <p className="profile-copy" style={{ marginTop: 12 }}>No passkeys yet. Add one to sign in without a password.</p>
            ) : (
              <ul className="passkey-list">
                {passkeys.map(pk => (
                  <li key={pk.credentialId} className="passkey-item">
                    <span className="passkey-icon">🔑</span>
                    <div className="passkey-info">
                      <span className="passkey-type">{pk.deviceType === 'multiDevice' ? 'Synced passkey' : 'Device passkey'}</span>
                      <span className="passkey-dates">
                        Added {formatDate(pk.createdAt)}
                        {pk.lastUsedAt ? ` · Last used ${formatDate(pk.lastUsedAt)}` : ''}
                      </span>
                    </div>
                    {passkeys.length > 1 && (
                      <button className="passkey-delete-btn" onClick={() => onDeletePasskey(pk.credentialId)} title="Remove passkey">✕</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="auth-helper" style={{ marginTop: 12 }}>{tr('auth.passkeySecureContext')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Note list item ────────────────────────────────────────────────────────────
function NoteCard({ note, isSelected, onClick }) {
  const icon = SOURCE_ICONS[note.source] || '📝';
  const label = SOURCE_LABELS[note.source] || 'Note';
  return (
    <button
      draggable
      onDragStart={e => { e.dataTransfer.setData('noteId', note.id); e.dataTransfer.effectAllowed = 'move'; }}
      className={`note-card ${isSelected ? 'is-selected' : ''}`}
      onClick={() => onClick(note)}
    >
      <div className="note-card-top">
        {note.pinned && <span className="pin-dot" title="Pinned">📌</span>}
        {note.isProtected && <span className="lock-dot" title="Protected">🔒</span>}
        <span className="note-card-title">{note.title}</span>
      </div>
      <div className="note-card-meta">
        <span className="note-type-badge">{icon} {label}</span>
        {note.meetingPlatform && <span className="note-platform-badge">{note.meetingPlatform}</span>}
        <span className="note-card-date">{formatDate(note.updatedAt || note.createdAt)}</span>
      </div>
      {Array.isArray(note.tags) && note.tags.length > 0 && (
        <div className="note-card-tags">
          {note.tags.slice(0, 4).map(tag => <span key={tag} className="tag-chip-sm">{tag}</span>)}
        </div>
      )}
    </button>
  );
}

// ── Browse panel (left column) ────────────────────────────────────────────────
function BrowsePanel({ notes, folders, tags, selected, filters, onFilter, onSelect, onQuickCreate, onCreateFolder, onMoveNote, tr }) {
  const [newTitle, setNewTitle] = useState('');
  const [dragOver, setDragOver] = useState(null); // folder id | 'root' | null

  function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onQuickCreate(newTitle.trim());
    setNewTitle('');
  }

  async function handleFolderCreate(e) {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name')?.trim();
    if (!name) return;
    await onCreateFolder(name);
    e.currentTarget.reset();
  }

  function folderDropProps(folderId) {
    return {
      onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(folderId); },
      onDragLeave: () => setDragOver(null),
      onDrop: e => {
        e.preventDefault();
        setDragOver(null);
        const noteId = e.dataTransfer.getData('noteId');
        if (noteId) onMoveNote(noteId, folderId === 'root' ? null : folderId);
      },
    };
  }

  return (
    <aside className="browse-panel card">
      <input
        className="input-field browse-search"
        placeholder="Search notes…"
        value={filters.search}
        onChange={e => onFilter({ search: e.target.value })}
      />

      <form className="quick-create-form" onSubmit={handleCreate}>
        <input className="input-field" placeholder="New note title…" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
        <button className="btn-primary qc-btn" type="submit" disabled={!newTitle.trim()}>+</button>
      </form>

      <div className="browse-section">
        <p className="browse-label">Folders</p>
        <button
          className={`folder-item ${!filters.folderId ? 'is-active' : ''} ${dragOver === 'root' ? 'drag-over' : ''}`}
          onClick={() => onFilter({ folderId: null })}
          {...folderDropProps('root')}
        >
          All notes <span className="folder-count">{notes.length}</span>
        </button>
        {folders.map(f => (
          <button
            key={f.id}
            className={`folder-item ${filters.folderId === f.id ? 'is-active' : ''} ${dragOver === f.id ? 'drag-over' : ''}`}
            onClick={() => onFilter({ folderId: filters.folderId === f.id ? null : f.id })}
            {...folderDropProps(f.id)}
          >
            📁 {f.name}
          </button>
        ))}
        <form className="folder-inline-form" onSubmit={handleFolderCreate}>
          <input className="input-field folder-input" name="name" placeholder="New folder…" />
          <button className="btn-primary qc-btn" type="submit">+</button>
        </form>
      </div>

      {tags.length > 0 && (
        <div className="browse-section">
          <p className="browse-label">Tags</p>
          <div className="tag-cloud">
            {tags.map(tag => (
              <button key={tag} className={`tag-chip ${filters.tag === tag ? 'is-active' : ''}`} onClick={() => onFilter({ tag: filters.tag === tag ? null : tag })}>
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="note-list">
        {notes.length === 0 ? (
          <p className="browse-empty">No notes found</p>
        ) : (
          notes.map(note => <NoteCard key={note.id} note={note} isSelected={selected?.id === note.id} onClick={onSelect} />)
        )}
      </div>
    </aside>
  );
}

// ── Transcript view ───────────────────────────────────────────────────────────
function TranscriptSection({ note, onUpdate, audioPlayerRef }) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [speakerInput, setSpeakerInput] = useState('');

  const hasSegments = Array.isArray(note.transcriptSegments) && note.transcriptSegments.length > 0;
  const hasPlain = Boolean(note.transcript);
  if (!hasSegments && !hasPlain) return null;

  const turns = hasSegments ? note.transcriptSegments.reduce((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.lines.push(seg);
      last.end = seg.end;
    } else {
      acc.push({ speaker: seg.speaker, start: seg.start, end: seg.end, lines: [seg] });
    }
    return acc;
  }, []) : [];

  const uniqueSpeakers = [...new Set(turns.map(t => t.speaker))];
  const speakerCount = note.speakerCount || uniqueSpeakers.length || (hasSegments ? 1 : 0);

  const q = search.toLowerCase();
  const filtered = search
    ? turns.filter(t => t.lines.some(s => s.text.toLowerCase().includes(q)))
    : turns;

  async function copyTranscript() {
    const text = hasSegments
      ? note.transcriptSegments.map(s => `[${formatSegmentTime(s.start)}] ${s.speaker}: ${s.text}`).join('\n')
      : note.transcript;
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function startRename(speaker) {
    setEditingSpeaker(speaker);
    setSpeakerInput(speaker);
  }

  async function saveSpeakerRename() {
    if (!editingSpeaker) { setEditingSpeaker(null); return; }
    const newName = speakerInput.trim();
    if (!newName || newName === editingSpeaker) { setEditingSpeaker(null); return; }
    const updatedSegments = note.transcriptSegments.map(seg =>
      seg.speaker === editingSpeaker ? { ...seg, speaker: newName } : seg
    );
    const res = await api(`/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ transcriptSegments: updatedSegments }),
    });
    if (res.success) onUpdate?.(res.data);
    setEditingSpeaker(null);
  }

  function seekTo(t) {
    audioPlayerRef?.current?.seekTo?.(t);
  }

  return (
    <div className="transcript-section">
      <div className="transcript-header">
        <button className="transcript-toggle" onClick={() => setOpen(o => !o)}>
          <span className="transcript-title">
            <span className="transcript-icon">🎙</span>
            Transcript
            {speakerCount > 0 && (
              <span className="transcript-speaker-count">
                {speakerCount} {speakerCount === 1 ? 'speaker' : 'speakers'}
              </span>
            )}
          </span>
          <span className="toggle-arrow">{open ? '▲' : '▼'}</span>
        </button>
        {open && (hasSegments || hasPlain) && (
          <button className={`transcript-copy ${copied ? 'is-copied' : ''}`} onClick={copyTranscript}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
      </div>

      {open && (
        <div className="transcript-open">
          {hasSegments && uniqueSpeakers.length >= 1 && (
            <div className="speaker-legend">
              {uniqueSpeakers.map(sp => (
                editingSpeaker === sp ? (
                  <span key={sp} className="speaker-chip-wrap">
                    <input
                      className="speaker-rename-input"
                      value={speakerInput}
                      onChange={e => setSpeakerInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveSpeakerRename(); if (e.key === 'Escape') setEditingSpeaker(null); }}
                      autoFocus
                    />
                    <button className="speaker-rename-save" onClick={saveSpeakerRename}>✓</button>
                    <button className="speaker-rename-cancel" onClick={() => setEditingSpeaker(null)}>✕</button>
                  </span>
                ) : (
                  <button
                    key={sp}
                    className={`speaker-chip ${getSpeakerColor(sp)}`}
                    onClick={() => startRename(sp)}
                    title="Click to rename speaker"
                  >
                    {sp} ✎
                  </button>
                )
              ))}
            </div>
          )}

          {hasSegments && turns.length > 4 && (
            <div className="transcript-search-row">
              <input
                className="input-field transcript-search"
                placeholder="Search transcript…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <span className="transcript-search-count">
                  {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          <div className="transcript-body">
            {hasSegments ? (
              filtered.length > 0 ? filtered.map((turn, i) => (
                <div key={i} className={`transcript-turn ${getSpeakerColor(turn.speaker)}`}>
                  <div className="turn-meta">
                    <span className="turn-speaker">{turn.speaker}</span>
                    <button
                      className={`turn-time ${audioPlayerRef ? 'is-seekable' : ''}`}
                      onClick={() => seekTo(turn.start)}
                      title={audioPlayerRef ? 'Jump to this moment' : undefined}
                    >
                      {formatSegmentTime(turn.start)}
                    </button>
                  </div>
                  <div className="turn-lines">
                    {turn.lines.map((seg, j) => (
                      <p key={j} className={`turn-line${q && seg.text.toLowerCase().includes(q) ? ' is-highlight' : ''}`}>
                        {seg.text}
                      </p>
                    ))}
                  </div>
                </div>
              )) : (
                <p className="transcript-no-results">No results for &ldquo;{search}&rdquo;</p>
              )
            ) : (
              <pre className="plain-transcript">{note.transcript}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI output renderers ───────────────────────────────────────────────────────
function MindMapNode({ node, depth }) {
  const [open, setOpen] = useState(true);
  if (!node) return null;
  const label = node.label || node.root || String(node);
  const children = Array.isArray(node.children) ? node.children : [];
  return (
    <div className={`mm-node ${depth === 0 ? 'mm-root' : ''}`}>
      <button className="mm-label" onClick={() => children.length > 0 && setOpen(o => !o)}>
        {children.length > 0 && <span className="mm-arrow">{open ? '▾' : '▸'}</span>}
        {label}
      </button>
      {open && children.length > 0 && (
        <div className="mm-children">
          {children.map((child, i) => <MindMapNode key={i} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function AIResultBlock({ selected, aiLoading, onGenerate, onToggleActionItem, onTranslate, lang, tr }) {
  const [translating, setTranslating] = useState(null); // field being translated
  const [translations, setTranslations] = useState({}); // { summary: 'text', ... }

  async function handleTranslate(field) {
    if (!onTranslate) return;
    const targetLang = lang === 'es' ? 'en' : 'es';
    const targetLabel = targetLang === 'es' ? 'ES' : 'EN';
    if (translations[field]) { setTranslations(p => { const n = { ...p }; delete n[field]; return n; }); return; }
    setTranslating(field);
    const result = await onTranslate(selected, targetLang, field);
    setTranslating(null);
    if (result?.text) setTranslations(p => ({ ...p, [field]: result.text }));
  }

  const hasAny = selected.summary || (selected.keyPointsJson?.length > 0) || (selected.actionItemsJson?.length > 0) || selected.mindMapJson?.root;
  const targetLangLabel = lang === 'es' ? 'EN' : 'ES';

  return (
    <div className="ai-content">
      <div className="ai-actions-row">
        {[
          { type: 'summary', label: tr('ai.btnSummary') },
          { type: 'key-points', label: tr('ai.btnKeyPoints') },
          { type: 'action-items', label: tr('ai.btnActions') },
          { type: 'mind-map', label: tr('ai.btnMindMap') },
        ].map(({ type, label }) => (
          <button
            key={type}
            className={`ai-action-btn ${aiLoading === type ? 'is-loading' : ''}`}
            onClick={() => onGenerate(selected, type)}
            disabled={Boolean(aiLoading)}
          >
            {aiLoading === type ? <span className="ai-spinner" /> : null}
            {label}
          </button>
        ))}
      </div>

      {!hasAny && !aiLoading && (
        <p className="ai-empty-hint">{tr('ai.generateHint')}</p>
      )}

      {selected.summary && (
        <div className="ai-result-block">
          <div className="ai-result-header">
            <h4 className="ai-result-label">{tr('ai.labelSummary')}</h4>
            {onTranslate && <button className={`translate-btn ${translations.summary ? 'is-active' : ''}`} onClick={() => handleTranslate('summary')} disabled={Boolean(translating)}>{translating === 'summary' ? '…' : translations.summary ? `✕ ${targetLangLabel}` : `⇄ ${targetLangLabel}`}</button>}
          </div>
          <p className="ai-summary-text">{selected.summary}</p>
          {translations.summary && <p className="ai-translation">{translations.summary}</p>}
        </div>
      )}

      {Array.isArray(selected.keyPointsJson) && selected.keyPointsJson.length > 0 && (
        <div className="ai-result-block">
          <div className="ai-result-header">
            <h4 className="ai-result-label">{tr('ai.labelKeyPoints')}</h4>
            {onTranslate && <button className={`translate-btn ${translations['key-points'] ? 'is-active' : ''}`} onClick={() => handleTranslate('key-points')} disabled={Boolean(translating)}>{translating === 'key-points' ? '…' : translations['key-points'] ? `✕ ${targetLangLabel}` : `⇄ ${targetLangLabel}`}</button>}
          </div>
          <ul className="key-points-list">
            {selected.keyPointsJson.map((kp, i) => (
              <li key={i}>{typeof kp === 'string' ? kp : (kp.text || String(kp))}</li>
            ))}
          </ul>
          {translations['key-points'] && <p className="ai-translation">{translations['key-points']}</p>}
        </div>
      )}

      {Array.isArray(selected.actionItemsJson) && selected.actionItemsJson.length > 0 && (
        <div className="ai-result-block">
          <div className="ai-result-header">
            <h4 className="ai-result-label">{tr('ai.labelActionItems')}</h4>
            {onTranslate && <button className={`translate-btn ${translations['action-items'] ? 'is-active' : ''}`} onClick={() => handleTranslate('action-items')} disabled={Boolean(translating)}>{translating === 'action-items' ? '…' : translations['action-items'] ? `✕ ${targetLangLabel}` : `⇄ ${targetLangLabel}`}</button>}
          </div>
          <ul className="action-items-list">
            {selected.actionItemsJson.map((item, i) => {
              const text = typeof item === 'string' ? item : (item.text || String(item));
              const completed = typeof item === 'object' && item.completed;
              const due = typeof item === 'object' && item.dueDate ? item.dueDate : null;
              return (
                <li key={i} className={`action-item ${completed ? 'is-done' : ''}`}>
                  <button className="action-checkbox" onClick={() => onToggleActionItem(selected, i)} aria-label={completed ? 'Mark incomplete' : 'Mark complete'}>
                    {completed ? '✓' : ''}
                  </button>
                  <span className="action-text">{text}</span>
                  {due && <span className="action-due">{tr('ai.due')} {due}</span>}
                </li>
              );
            })}
          </ul>
          {translations['action-items'] && <p className="ai-translation">{translations['action-items']}</p>}
        </div>
      )}

      {selected.mindMapJson?.root && (
        <div className="ai-result-block">
          <div className="ai-result-header">
            <h4 className="ai-result-label">{tr('ai.labelMindMap')}</h4>
            {onTranslate && <button className={`translate-btn ${translations['mind-map'] ? 'is-active' : ''}`} onClick={() => handleTranslate('mind-map')} disabled={Boolean(translating)}>{translating === 'mind-map' ? '…' : translations['mind-map'] ? `✕ ${targetLangLabel}` : `⇄ ${targetLangLabel}`}</button>}
          </div>
          <div className="mind-map">
            <MindMapNode node={selected.mindMapJson} depth={0} />
          </div>
          {translations['mind-map'] && <p className="ai-translation">{translations['mind-map']}</p>}
        </div>
      )}
    </div>
  );
}

// ── Audio player ─────────────────────────────────────────────────────────────
function AudioPlayer({ noteId, imperativeRef }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (imperativeRef) {
      imperativeRef.current = {
        seekTo: t => {
          if (!audioRef.current) return;
          audioRef.current.currentTime = t;
          audioRef.current.play().catch(() => {});
        },
      };
    }
  }, [imperativeRef]);

  function toggle() {
    if (!audioRef.current) return;
    playing ? audioRef.current.pause() : audioRef.current.play().catch(() => {});
  }

  function seek(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * duration;
  }

  if (unavailable) return null;

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={`${API}/api/recordings/${noteId}/audio`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onError={() => setUnavailable(true)}
        preload="metadata"
      />
      <button className="audio-play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="audio-scrubber" onClick={seek} role="slider" aria-label="Playback position">
        <div className="audio-scrubber-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
      </div>
      <span className="audio-time">{formatSegmentTime(currentTime)} / {formatSegmentTime(duration)}</span>
    </div>
  );
}

// ── Lock overlay ──────────────────────────────────────────────────────────────
function LockOverlay({ noteId, onUnlock, onBiometric }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await onUnlock(noteId, password);
    setLoading(false);
    if (!res.success) setError(res.error || 'Incorrect password');
  }

  async function tryBiometric() {
    setLoading(true);
    setError('');
    const res = await onBiometric(noteId);
    setLoading(false);
    if (!res.success) setError(res.error || 'Biometric failed');
  }

  return (
    <div className="lock-overlay">
      <div className="lock-overlay-inner">
        <span className="lock-big-icon">🔒</span>
        <h4 className="lock-title">Protected Note</h4>
        <p className="lock-hint">Enter your password to view this note</p>
        <form className="lock-form" onSubmit={submit}>
          <input
            className="input-field"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          <button className="btn-primary" type="submit" disabled={loading || !password}>
            {loading ? '…' : 'Unlock'}
          </button>
        </form>
        {isPasskeySupported() && (
          <button className="btn-secondary biometric-btn" type="button" onClick={tryBiometric} disabled={loading}>
            Face ID / Touch ID
          </button>
        )}
        {error && <p className="lock-error">{error}</p>}
      </div>
    </div>
  );
}

// ── Note view panel (centre column) ──────────────────────────────────────────
function NoteViewPanel({ selected, folders, onUpdate, onPin, onDelete, onNotice, unlockedNotes, onProtectNote, onRemoveProtection, onUnlockNote, onUnlockBiometric, tr }) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftFolder, setDraftFolder] = useState('');
  const [showProtectModal, setShowProtectModal] = useState(false);
  const [protectPassword, setProtectPassword] = useState('');
  const [protectConfirm, setProtectConfirm] = useState('');
  const [protectError, setProtectError] = useState('');
  const [protectLoading, setProtectLoading] = useState(false);
  const audioPlayerRef = useRef(null);

  useEffect(() => {
    setEditing(false);
    setShowProtectModal(false);
    setProtectPassword('');
    setProtectConfirm('');
    setProtectError('');
    if (selected) {
      setDraftTitle(selected.title || '');
      setDraftBody(selected.body || '');
      setDraftFolder(selected.folderId || '');
    }
  }, [selected?.id]);

  if (!selected) {
    return (
      <section className="note-view-panel card detail-empty">
        <div className="empty-state-content">
          <p className="empty-state-icon">🎙</p>
          <p className="empty-state-title">Select a note or start recording</p>
          <p className="empty-state-hint">Voice notes are transcribed automatically with speaker identification</p>
        </div>
      </section>
    );
  }

  const isLocked = selected.isProtected && !unlockedNotes?.has(selected.id);

  async function saveEdits() {
    const res = await api(`/api/notes/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: draftTitle, body: draftBody, folderId: draftFolder || null }),
    });
    if (!res.success) {
      onNotice({ type: 'error', message: res.error || 'Could not save note.' });
      return;
    }
    onUpdate(res.data);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm('Delete this note?')) return;
    await api(`/api/notes/${selected.id}`, { method: 'DELETE' });
    onDelete(selected.id);
  }

  function exportNote(format) {
    window.open(`${API}/api/notes/${selected.id}/export?format=${format}`, '_blank');
  }

  async function handleProtect(e) {
    e.preventDefault();
    if (protectPassword !== protectConfirm) { setProtectError('Passwords do not match'); return; }
    setProtectLoading(true);
    setProtectError('');
    const res = await onProtectNote(selected.id, protectPassword);
    setProtectLoading(false);
    if (!res.success) setProtectError(res.error || 'Could not protect note');
    else { setShowProtectModal(false); setProtectPassword(''); setProtectConfirm(''); }
  }

  async function handleRemoveProtection() {
    if (!window.confirm('Remove password protection from this note?')) return;
    await onRemoveProtection(selected.id);
  }

  const transcriptionBadge = selected.transcriptionStatus === 'processing'
    ? <span className="status-badge processing">Transcribing…</span>
    : selected.transcriptionStatus === 'failed'
    ? <span className="status-badge failed">Transcription failed</span>
    : null;

  const hasAudio = Boolean(selected.audioPath);

  return (
    <section className="note-view-panel card">
      {isLocked && (
        <LockOverlay noteId={selected.id} onUnlock={onUnlockNote} onBiometric={onUnlockBiometric} />
      )}

      {showProtectModal && (
        <div className="protect-modal-overlay" onClick={e => e.target === e.currentTarget && setShowProtectModal(false)}>
          <div className="protect-modal card">
            <h4 className="protect-modal-title">🔒 Protect This Note</h4>
            <form className="auth-form" onSubmit={handleProtect}>
              <label className="auth-label">Password</label>
              <input className="input-field" type="password" value={protectPassword} onChange={e => setProtectPassword(e.target.value)} placeholder="Enter password" required autoFocus />
              <label className="auth-label">Confirm password</label>
              <input className="input-field" type="password" value={protectConfirm} onChange={e => setProtectConfirm(e.target.value)} placeholder="Confirm password" required />
              {protectError && <p className="lock-error">{protectError}</p>}
              <div className="edit-action-row">
                <button className="btn-primary" type="submit" disabled={protectLoading || !protectPassword}>
                  {protectLoading ? '…' : 'Set password'}
                </button>
                <button className="btn-secondary" type="button" onClick={() => setShowProtectModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="note-view-header">
        {editing ? (
          <input
            className="input-field note-title-input"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            autoFocus
          />
        ) : (
          <h2 className="note-title">{selected.title}</h2>
        )}
        <div className="note-view-actions">
          {transcriptionBadge}
          <button className={`action-icon-btn ${selected.pinned ? 'is-pinned' : ''}`} onClick={() => onPin(selected)} title={selected.pinned ? tr('notes.unpin') : tr('notes.pin')}>
            📌
          </button>
          <button className="action-icon-btn" onClick={() => setEditing(e => !e)} title="Edit">✏️</button>
          <button className="action-icon-btn" title="Export as Markdown" onClick={() => exportNote('md')}>⬇️</button>
          {selected.isProtected && unlockedNotes?.has(selected.id) ? (
            <button className="action-icon-btn" onClick={handleRemoveProtection} title="Remove password protection">🔓</button>
          ) : !selected.isProtected ? (
            <button className="action-icon-btn" onClick={() => setShowProtectModal(true)} title="Password-protect this note">🔒</button>
          ) : null}
          <button className="action-icon-btn danger" onClick={handleDelete} title="Delete">🗑</button>
        </div>
      </div>

      {selected.meetingPlatform && (
        <p className="meeting-badge">{SOURCE_ICONS.meeting} {selected.meetingPlatform}{selected.meetingUrl ? ` · ${selected.meetingUrl}` : ''}</p>
      )}

      {editing ? (
        <div className="note-edit-body">
          <textarea
            className="input-field note-body-textarea"
            value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
            placeholder="Note body…"
          />
          <select className="input-field" value={draftFolder} onChange={e => setDraftFolder(e.target.value)}>
            <option value="">Uncategorized</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="edit-action-row">
            <button className="btn-primary" onClick={saveEdits}>Save</button>
            <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        selected.body && <p className="note-body">{selected.body}</p>
      )}

      {!isLocked && hasAudio && (
        <AudioPlayer noteId={selected.id} imperativeRef={audioPlayerRef} />
      )}

      <TranscriptSection
        note={selected}
        onUpdate={onUpdate}
        audioPlayerRef={hasAudio && !isLocked ? audioPlayerRef : null}
      />
    </section>
  );
}

// ── AI + Search panel (right column) ─────────────────────────────────────────
function ChatPanel({ selected, chatHistory, chatLoading, onChat, onClearChat, tr }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, chatLoading]);

  async function submit(e) {
    e.preventDefault();
    if (!input.trim() || chatLoading || !selected) return;
    const msg = input.trim();
    setInput('');
    await onChat(msg);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); }
  }

  return (
    <div className="chat-panel">
      <div className="chat-context-bar">
        {selected
          ? <><span className="chat-context-dot" />{tr('chat.context')}: <strong className="chat-context-title">{selected.title}</strong></>
          : <span className="chat-no-context">{tr('chat.noContext')}</span>
        }
        {chatHistory.length > 0 && (
          <button className="chat-clear-btn" onClick={onClearChat}>{tr('chat.clear')}</button>
        )}
      </div>
      <div className="chat-messages">
        {chatHistory.length === 0 && !chatLoading && (
          <p className="chat-empty">
            {selected
              ? `${tr('chat.context')}: "${selected.title}"…`
              : tr('chat.emptyNoNote')}
          </p>
        )}
        {chatHistory.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className="chat-bubble-inner">{msg.content}</div>
          </div>
        ))}
        {chatLoading && (
          <div className="chat-bubble assistant">
            <div className="chat-bubble-inner chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form className="chat-form" onSubmit={submit}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={selected ? tr('chat.placeholder') : tr('chat.placeholderNoNote')}
          disabled={chatLoading || !selected}
          rows={2}
        />
        <button className="chat-send-btn" type="submit" disabled={chatLoading || !input.trim() || !selected}>
          ↑
        </button>
      </form>
    </div>
  );
}

function AISearchPanel({ selected, aiLoading, onGenerate, onToggleActionItem, searchResults, searchLoading, onSearch, deviceAI, deviceAIReady, deviceAILoading, aiModelProgress, onToggleDeviceAI, onTranslate, lang, chatHistory, chatLoading, onChat, onClearChat, tr }) {
  const [tab, setTab] = useState('ai');
  const aiPct = aiModelProgress?.pct ?? 0;

  return (
    <section className="ai-search-panel card">
      <div className="panel-tab-bar">
        <button className={`panel-tab ${tab === 'ai' ? 'is-active' : ''}`} onClick={() => setTab('ai')}>{tr('ai.tab')}</button>
        <button className={`panel-tab ${tab === 'chat' ? 'is-active' : ''}`} onClick={() => setTab('chat')}>{tr('ai.tabChat')}</button>
        <button className={`panel-tab ${tab === 'search' ? 'is-active' : ''}`} onClick={() => setTab('search')}>{tr('ai.tabSearch')}</button>
      </div>

      {tab === 'ai' && (
        <>
          <div className="ai-device-row">
            <span>{deviceAI ? (deviceAIReady ? tr('ai.onDevice') : deviceAILoading ? `📱 ${tr('ai.loading')} ${aiPct > 0 ? aiPct + '%' : ''}` : `📱 ${tr('ai.queued')}`) : tr('ai.serverAI')}</span>
            <button
              className={`device-transcribe-toggle ${deviceAI ? 'is-on' : ''}`}
              onClick={onToggleDeviceAI}
              disabled={Boolean(aiLoading)}
              title={deviceAI ? 'Switch to server AI' : 'Enable on-device AI (~100 MB download)'}
            >
              {deviceAI ? tr('ai.btnOnDevice') : tr('ai.btnServer')}
            </button>
          </div>
          {deviceAILoading && (
            <div className="model-progress-bar" style={{ marginTop: 4 }}>
              <div className="model-progress-fill" style={{ width: `${aiPct}%`, background: 'var(--teal)' }} />
            </div>
          )}
          {!selected ? (
            <p className="ai-empty-hint">{tr('ai.selectNote')}</p>
          ) : (
            <AIResultBlock
              selected={selected}
              aiLoading={aiLoading}
              onGenerate={onGenerate}
              onToggleActionItem={onToggleActionItem}
              onTranslate={deviceAI && deviceAIReady ? onTranslate : null}
              lang={lang}
              tr={tr}
            />
          )}
        </>
      )}

      {tab === 'chat' && (
        <ChatPanel
          selected={selected}
          chatHistory={chatHistory}
          chatLoading={chatLoading}
          onChat={onChat}
          onClearChat={onClearChat}
          tr={tr}
        />
      )}

      {tab === 'search' && (
        <div className="search-panel">
          <form className="search-form" onSubmit={onSearch}>
            <input
              className="input-field search-input"
              name="q"
              placeholder={tr('search.placeholder')}
              defaultValue={selected?.title || ''}
            />
            <button className="btn-primary">{searchLoading ? '…' : tr('search.submit')}</button>
          </form>
          {searchResults.length === 0 ? (
            <p className="search-empty">{tr('search.empty')}</p>
          ) : (
            <div className="search-results">
              {searchResults.map(result => (
                <a className="result-item" key={result.url} href={result.url} target="_blank" rel="noreferrer">
                  <strong>{result.title}</strong>
                  <span>{result.snippet}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Record button / FAB ───────────────────────────────────────────────────────
function ModelDownloadModal({ onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal card" role="dialog" aria-modal="true">
        <div className="modal-icon">📱</div>
        <h3 className="modal-title">On-Device Transcription</h3>
        <p className="modal-desc">
          Whisper AI will run <strong>entirely in your browser</strong> — no audio is ever sent to a server.
          Ideal for iPhone and private recordings.
        </p>
        <ul className="modal-list">
          <li><span className="modal-list-icon">⬇️</span> One-time download of ~40 MB (cached locally)</li>
          <li><span className="modal-list-icon">🔒</span> Audio never leaves your device</li>
          <li><span className="modal-list-icon">✈️</span> Works offline after first download</li>
          <li><span className="modal-list-icon">📱</span> Supports iPhone Safari 16.4+</li>
        </ul>
        <p className="modal-note">Model: <code>whisper-tiny</code> · English &amp; multilingual</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={onConfirm}>Download &amp; Enable</button>
        </div>
      </div>
    </div>
  );
}

function ExtensionModal({ onClose }) {
  const downloadUrl = `${API}/api/extension/download`;
  const backendUrl = API || 'http://localhost:3001';

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal ext-modal card" role="dialog" aria-modal="true">
        <button className="ext-modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-icon">🧩</div>
        <h3 className="modal-title">Chrome Extension</h3>
        <p className="modal-desc">
          Record Google Meet, Teams, and Zoom in one click. A floating banner appears inside your meeting — audio goes to your self-hosted AI Notes, never a third-party.
        </p>

        <ul className="modal-list">
          <li><span className="modal-list-icon">📹</span> Auto-detects Google Meet, Microsoft Teams &amp; Zoom Web</li>
          <li><span className="modal-list-icon">🎙</span> Floating in-meeting banner with one-click record/stop</li>
          <li><span className="modal-list-icon">📎</span> Right-click any page → <strong>Clip to AI Notes</strong></li>
          <li><span className="modal-list-icon">🔒</span> Opt-in only — never records without your consent</li>
        </ul>

        <p className="modal-note">Requires Chrome / Edge 114+ · <code>tabCapture</code> permission for audio capture</p>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <a className="btn-primary ext-download-btn" href={downloadUrl} download="ai-notes-extension.zip">
            ⬇ Download Extension ZIP
          </a>
        </div>

        {/* ── Full install walkthrough ───────────────────────────────────── */}
        <div className="ext-steps-section">
          <h4 className="ext-steps-title">Installation steps</h4>
          <ol className="ext-steps-list">
            <li className="ext-step">
              <span className="ext-step-num">1</span>
              <div className="ext-step-body">
                <strong>Download &amp; unzip</strong>
                <p>Click <em>Download Extension ZIP</em> above. Unzip the file — you'll get a folder called <code>ai-notes-extension</code> (or similar).</p>
              </div>
            </li>
            <li className="ext-step">
              <span className="ext-step-num">2</span>
              <div className="ext-step-body">
                <strong>Open Extensions page</strong>
                <p>In Chrome or Edge, navigate to <code>chrome://extensions</code> (or <code>edge://extensions</code>).</p>
              </div>
            </li>
            <li className="ext-step">
              <span className="ext-step-num">3</span>
              <div className="ext-step-body">
                <strong>Enable Developer mode</strong>
                <p>Toggle <em>Developer mode</em> in the top-right corner of the Extensions page. This enables loading unpacked extensions.</p>
              </div>
            </li>
            <li className="ext-step">
              <span className="ext-step-num">4</span>
              <div className="ext-step-body">
                <strong>Load the extension</strong>
                <p>Click <em>Load unpacked</em> and select the unzipped folder. The AI Notes icon 🎙 will appear in your browser toolbar.</p>
              </div>
            </li>
            <li className="ext-step">
              <span className="ext-step-num">5</span>
              <div className="ext-step-body">
                <strong>Configure backend URL</strong>
                <p>Click the 🎙 toolbar icon → expand <em>Settings</em> → set Backend URL to <code className="ext-url-code">{backendUrl}</code></p>
              </div>
            </li>
            <li className="ext-step">
              <span className="ext-step-num">6</span>
              <div className="ext-step-body">
                <strong>Sign in &amp; record</strong>
                <p>Open a Google Meet, Teams, or Zoom meeting. A dark banner will appear in the corner — click <em>Start recording</em>. After the meeting, the transcript will appear in AI Notes automatically.</p>
              </div>
            </li>
          </ol>
        </div>

        {/* ── Troubleshooting ───────────────────────────────────────────── */}
        <details className="ext-troubleshoot">
          <summary>Troubleshooting</summary>
          <dl className="ext-trouble-list">
            <dt>Extension says "Not signed in"</dt>
            <dd>Make sure you're logged in to AI Notes in the same browser profile. The backend URL must match exactly (including port).</dd>
            <dt>No banner appears in Google Meet</dt>
            <dd>Reload the meeting page after installing the extension. If still missing, check <code>chrome://extensions</code> and confirm the extension is enabled.</dd>
            <dt>"tabCapture" permission denied</dt>
            <dd>The extension needs to capture the tab's audio. Accept the permission prompt when it appears, or re-install the extension.</dd>
            <dt>Upload fails after recording</dt>
            <dd>Confirm the backend API is reachable at the configured URL. If running locally, ensure the API container is up (<code>make up</code>).</dd>
          </dl>
        </details>
      </div>
    </div>
  );
}

const RECORD_LANGS = [
  { value: '', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
];

function RecordControl({ recording, recordingPhase, recordingSeconds, waveformBars, onStart, onStop, isFab, deviceTranscribe, deviceModelReady, deviceModelLoading, modelProgress, onToggleDeviceTranscribe, recordingLang, onChangeLang }) {
  const isUploading = recordingPhase === 'uploading';
  const cls = isFab ? 'record-fab' : 'btn-record';
  const pct = modelProgress?.pct ?? 0;

  const toggle = onToggleDeviceTranscribe && !isFab ? (
    <div className="device-toggle-wrap">
      <button
        className={`device-transcribe-toggle ${deviceTranscribe ? 'is-on' : ''}`}
        onClick={onToggleDeviceTranscribe}
        disabled={recording || isUploading}
        title={deviceTranscribe ? 'On-device transcription ON — click to use server' : 'Enable on-device transcription (iPhone-compatible)'}
      >
        {deviceModelLoading
          ? `📱 ${pct > 0 ? pct + '%' : 'Starting…'}`
          : deviceTranscribe
            ? (deviceModelReady ? '📱 On-device' : '📱 Queued')
            : '📱 Off'}
      </button>
      {deviceModelLoading && (
        <div className="model-progress-bar">
          <div className="model-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <select
        className="lang-select"
        value={recordingLang}
        onChange={e => onChangeLang?.(e.target.value)}
        disabled={recording || isUploading}
        title="Recording language (Auto = detect)"
      >
        {RECORD_LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
    </div>
  ) : null;

  if (isUploading) {
    return (
      <>
        {toggle}
        <button className={`${cls} is-uploading`} disabled>
          {isFab ? '⏳' : 'Processing…'}
        </button>
      </>
    );
  }

  if (recording) {
    return (
      <>
        {toggle}
        <button className={`${cls} is-recording`} onClick={onStop}>
          {isFab ? (
            <>
              <span className="fab-stop-icon">■</span>
              <span className="fab-timer">{formatTimer(recordingSeconds)}</span>
            </>
          ) : (
            <>
              <WaveformBars bars={waveformBars} />
              <span>{formatTimer(recordingSeconds)}</span>
              <span>Stop</span>
            </>
          )}
        </button>
      </>
    );
  }

  return (
    <>
      {toggle}
      <button className={cls} onClick={onStart}>
        {isFab ? '🎙' : '🎙 Record'}
      </button>
    </>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
function Dashboard({
  user, view, setView, folders, notes, tags, selected, recording, recordingPhase, recordingSeconds, waveformBars,
  filters, aiLoading, searchResults, searchLoading,
  deviceTranscribe, deviceModelReady, deviceModelLoading, modelProgress, onToggleDeviceTranscribe,
  deviceAI, deviceAIReady, deviceAILoading, aiModelProgress, onToggleDeviceAI, onTranslate,
  chatHistory, chatLoading, onChat, onClearChat,
  tr, notice, workspaceNotice, lang,
  onFilter, onSelect, onQuickCreate, onCreateFolder, onMoveNote, onPin, onUpdate, onDelete, onGenerate, onToggleActionItem,
  onSearch, startRecording, stopRecording, recordingLang, onChangeLang, onSaveProfile, onAddPasskey, onDeletePasskey, passkeys,
  unlockedNotes, onProtectNote, onRemoveProtection, onUnlockNote, onUnlockBiometric,
  onLogout, onNotice,
}) {
  const [mobileView, setMobileView] = useState('list');

  function selectNote(note) {
    onSelect(note);
    setMobileView('detail');
  }

  return (
    <section className="dashboard">
      <div className="toolbar card">
        <div className="toolbar-group">
          <button className={`toolbar-tab ${view === 'notes' ? 'is-active' : ''}`} onClick={() => setView('notes')}>{tr('auth.notesView')}</button>
          <button className={`toolbar-tab ${view === 'profile' ? 'is-active' : ''}`} onClick={() => setView('profile')}>{tr('auth.profileView')}</button>
        </div>
        <div className="toolbar-group toolbar-right">
          {view === 'notes' && (
            <RecordControl
              recording={recording}
              recordingPhase={recordingPhase}
              recordingSeconds={recordingSeconds}
              waveformBars={waveformBars}
              onStart={startRecording}
              onStop={stopRecording}
              deviceTranscribe={deviceTranscribe}
              deviceModelReady={deviceModelReady}
              deviceModelLoading={deviceModelLoading}
              modelProgress={modelProgress}
              onToggleDeviceTranscribe={onToggleDeviceTranscribe}
              recordingLang={recordingLang}
              onChangeLang={onChangeLang}
              isFab={false}
            />
          )}
          <span className="user-name">{user.displayName}</span>
          <button className="btn-secondary toolbar-logout" onClick={onLogout}>{tr('auth.logout')}</button>
        </div>
      </div>

      <StatusMessage notice={workspaceNotice} />

      {view === 'profile' ? (
        <ProfilePage user={user} notes={notes} tr={tr} notice={notice} onSaveProfile={onSaveProfile} onAddPasskey={onAddPasskey} onDeletePasskey={onDeletePasskey} passkeys={passkeys} />
      ) : (
        <>
          <div className="layout-grid">
            <BrowsePanel
              notes={notes}
              folders={folders}
              tags={tags}
              selected={selected}
              filters={filters}
              onFilter={onFilter}
              onSelect={selectNote}
              onQuickCreate={onQuickCreate}
              onCreateFolder={onCreateFolder}
              onMoveNote={onMoveNote}
              tr={tr}
            />
            <NoteViewPanel
              selected={selected}
              folders={folders}
              onUpdate={onUpdate}
              onPin={onPin}
              onDelete={onDelete}
              onNotice={onNotice}
              unlockedNotes={unlockedNotes}
              onProtectNote={onProtectNote}
              onRemoveProtection={onRemoveProtection}
              onUnlockNote={onUnlockNote}
              onUnlockBiometric={onUnlockBiometric}
              tr={tr}
            />
            <AISearchPanel
              selected={selected}
              aiLoading={aiLoading}
              onGenerate={onGenerate}
              onToggleActionItem={onToggleActionItem}
              searchResults={searchResults}
              searchLoading={searchLoading}
              onSearch={onSearch}
              deviceAI={deviceAI}
              deviceAIReady={deviceAIReady}
              deviceAILoading={deviceAILoading}
              aiModelProgress={aiModelProgress}
              onToggleDeviceAI={onToggleDeviceAI}
              onTranslate={onTranslate}
              lang={lang}
              chatHistory={chatHistory}
              chatLoading={chatLoading}
              onChat={onChat}
              onClearChat={onClearChat}
              tr={tr}
            />
          </div>

          {/* Mobile FAB */}
          <RecordControl
            recording={recording}
            recordingPhase={recordingPhase}
            recordingSeconds={recordingSeconds}
            waveformBars={waveformBars}
            onStart={startRecording}
            onStop={stopRecording}
            deviceTranscribe={deviceTranscribe}
            deviceModelReady={deviceModelReady}
            deviceModelLoading={deviceModelLoading}
            modelProgress={modelProgress}
            onToggleDeviceTranscribe={onToggleDeviceTranscribe}
            isFab={true}
          />
        </>
      )}
    </section>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
function App() {
  const [lang, setLang] = useState(localStorage.getItem('lang') || 'en');
  const [user, setUser] = useState(null);
  const [view, setView] = useState('notes');
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ search: '', folderId: null, tag: null });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [passkeys, setPasskeys] = useState([]);
  const [unlockedNotes, setUnlockedNotes] = useState(new Set());
  const [deviceTranscribe, setDeviceTranscribe] = useState(true);
  const [deviceModelReady, setDeviceModelReady] = useState(false);
  const [deviceModelLoading, setDeviceModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(null); // { file, pct } | null
  const [showModelModal, setShowModelModal] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [waveformBars, setWaveformBars] = useState(Array(8).fill(0.05));
  const [aiLoading, setAiLoading] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [showExtModal, setShowExtModal] = useState(false);
  const [authNotice, setAuthNotice] = useState(null);
  const [profileNotice, setProfileNotice] = useState(null);
  const [workspaceNotice, setWorkspaceNotice] = useState(null);

  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  const [recordingLang, setRecordingLang] = useState('');
  const [deviceAI, setDeviceAI] = useState(false);
  const [deviceAIReady, setDeviceAIReady] = useState(false);
  const [deviceAILoading, setDeviceAILoading] = useState(false);
  const [aiModelProgress, setAiModelProgress] = useState(null);

  const recorder = useRef(null);
  const chunks = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const animFrameRef = useRef(null);
  const whisperWorkerRef = useRef(null);
  const aiWorkerRef = useRef(null);

  const tr = key => t(lang, key);

  useEffect(() => { localStorage.setItem('lang', lang); }, [lang]);

  useEffect(() => {
    api('/api/auth/me').then(res => {
      if (res.success && res.data.user) {
        setUser(res.data);
        if (res.data.user.preferredLanguage) setLang(res.data.user.preferredLanguage);
      }
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

    const onPrompt = e => { e.preventDefault(); setInstallPromptEvent(e); setCanInstall(true); };
    const onInstalled = () => { setInstallPromptEvent(null); setCanInstall(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  async function loadPasskeys() {
    const res = await api('/api/auth/passkeys');
    if (res.success) setPasskeys(res.data);
  }

  useEffect(() => {
    if (!user?.user?.id) { setNotes([]); setFolders([]); setTags([]); setSelected(null); setPasskeys([]); return; }
    refresh();
    loadPasskeys();
    // Auto-start model download since device transcription is on by default
    startModelDownload();
  }, [user?.user?.id]);

  // Re-fetch notes when filters change (debounced for search)
  useEffect(() => {
    if (!user?.user?.id) return;
    const t = setTimeout(() => refresh(), filters.search ? 280 : 0);
    return () => clearTimeout(t);
  }, [filters.search, filters.folderId, filters.tag]);

  // Clear chat history when selected note changes
  useEffect(() => { setChatHistory([]); }, [selected?.id]);

  async function refresh(overrideFilters) {
    if (!user?.user?.id) return;
    const f = overrideFilters !== undefined ? overrideFilters : filtersRef.current;
    const params = new URLSearchParams();
    if (f.search) params.set('search', f.search);
    if (f.folderId) params.set('folderId', f.folderId);
    if (f.tag) params.set('tag', f.tag);
    const query = params.toString() ? `?${params}` : '';
    const [n, fl, tg] = await Promise.all([api(`/api/notes${query}`), api('/api/folders'), api('/api/notes/tags')]);
    if (n.success) setNotes(n.data);
    if (fl.success) setFolders(fl.data);
    if (tg.success) setTags(tg.data);
  }

  function applyFilter(partial) {
    setFilters(prev => ({ ...prev, ...partial }));
  }

  function setAuthenticatedUser(authData) {
    setUser(authData);
    if (authData?.user?.preferredLanguage) setLang(authData.user.preferredLanguage);
    setAuthNotice(null);
    setProfileNotice(null);
  }

  // ── Auth handlers ──
  async function login(e) {
    e.preventDefault();
    setAuthNotice(null);
    const form = new FormData(e.currentTarget);
    const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: String(form.get('username') || '').trim(), password: String(form.get('password') || '') }) });
    if (!res.success) return setAuthNotice({ type: 'error', message: res.error || tr('auth.loginFailed') });
    setAuthenticatedUser(res.data);
  }

  async function register(e) {
    e.preventDefault();
    setAuthNotice(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') || '');
    if (password !== String(form.get('confirmPassword') || '')) return setAuthNotice({ type: 'error', message: tr('auth.passwordMismatch') });
    const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: String(form.get('username') || '').trim(), displayName: String(form.get('displayName') || '').trim(), password, preferredLanguage: lang }) });
    if (!res.success) return setAuthNotice({ type: 'error', message: res.error || tr('auth.registerFailed') });
    setAuthenticatedUser(res.data);
    setView('profile');
    setProfileNotice({ type: 'success', message: tr('auth.profileCreated') });
  }

  async function passkeyLogin(usernameHint = '') {
    setAuthNotice(null);
    if (!isPasskeySupported()) return setAuthNotice({ type: 'error', message: tr('auth.passkeyUnavailable') });
    try {
      const optRes = await api('/api/auth/passkey/login/options', { method: 'POST', body: JSON.stringify({ username: usernameHint || undefined }) });
      if (!optRes.success) return setAuthNotice({ type: 'error', message: optRes.error || tr('auth.passkeyLoginFailed') });
      const credential = await navigator.credentials.get({ publicKey: normalizeLoginOptions(optRes.data) });
      if (!credential) return setAuthNotice({ type: 'error', message: tr('auth.passkeyLoginFailed') });
      const verRes = await api('/api/auth/passkey/login/verify', { method: 'POST', body: JSON.stringify({ ...serializeCredential(credential), username: usernameHint || undefined }) });
      if (!verRes.success) return setAuthNotice({ type: 'error', message: verRes.error || tr('auth.passkeyLoginFailed') });
      setAuthenticatedUser(verRes.data);
    } catch (err) {
      setAuthNotice({ type: 'error', message: err?.message || tr('auth.passkeyLoginFailed') });
    }
  }

  async function addPasskey() {
    setProfileNotice(null);
    if (!isPasskeySupported()) return setProfileNotice({ type: 'error', message: tr('auth.passkeyUnavailable') });
    try {
      const optRes = await api('/api/auth/passkey/register/options', { method: 'POST', body: '{}' });
      if (!optRes.success) return setProfileNotice({ type: 'error', message: optRes.error || tr('auth.passkeyRegisterFailed') });
      const credential = await navigator.credentials.create({ publicKey: normalizeRegistrationOptions(optRes.data) });
      if (!credential) return setProfileNotice({ type: 'error', message: tr('auth.passkeyRegisterFailed') });
      const verRes = await api('/api/auth/passkey/register/verify', { method: 'POST', body: JSON.stringify(serializeCredential(credential)) });
      if (!verRes.success) return setProfileNotice({ type: 'error', message: verRes.error || tr('auth.passkeyRegisterFailed') });
      setAuthenticatedUser(verRes.data);
      await loadPasskeys();
      setProfileNotice({ type: 'success', message: tr('auth.passkeyRegistered') });
    } catch (err) {
      setProfileNotice({ type: 'error', message: err?.message || tr('auth.passkeyRegisterFailed') });
    }
  }

  async function deletePasskey(credentialId) {
    setProfileNotice(null);
    const res = await api(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, { method: 'DELETE', body: '{}' });
    if (!res.success) return setProfileNotice({ type: 'error', message: res.error || 'Could not delete passkey.' });
    await loadPasskeys();
    setProfileNotice({ type: 'success', message: 'Passkey removed.' });
  }

  async function saveProfile(e) {
    e.preventDefault();
    setProfileNotice(null);
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get('newPassword') || '');
    if (newPassword && newPassword !== String(form.get('confirmNewPassword') || '')) return setProfileNotice({ type: 'error', message: tr('auth.passwordMismatch') });
    const res = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ displayName: String(form.get('displayName') || '').trim(), preferredLanguage: String(form.get('preferredLanguage') || lang), currentPassword: String(form.get('currentPassword') || ''), newPassword: newPassword || undefined }) });
    if (!res.success) return setProfileNotice({ type: 'error', message: res.error || tr('auth.profileSaveFailed') });
    setAuthenticatedUser(res.data);
    setProfileNotice({ type: 'success', message: tr('auth.profileSaved') });
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    setUser(null);
    setView('notes');
    setNotes([]); setFolders([]); setTags([]); setSelected(null);
    setAuthNotice(null); setProfileNotice(null);
  }

  // ── Note handlers ──
  async function quickCreate(title) {
    const res = await api('/api/notes', { method: 'POST', body: JSON.stringify({ title }) });
    if (!res.success) { setWorkspaceNotice({ type: 'error', message: res.error || 'Could not create note.' }); return; }
    setNotes(prev => [res.data, ...prev]);
    setSelected(res.data);
  }

  async function createFolder(name) {
    const res = await api('/api/folders', { method: 'POST', body: JSON.stringify({ name }) });
    if (res.success) setFolders(prev => [...prev, res.data]);
    return res;
  }

  async function moveNoteToFolder(noteId, folderId) {
    const res = await api(`/api/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ folderId: folderId || null }) });
    if (res.success) {
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, folderId: folderId || null } : n));
      if (selected?.id === noteId) setSelected(prev => ({ ...prev, folderId: folderId || null }));
    }
  }

  function handleUpdate(updated) {
    setSelected(updated);
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }

  function handleDelete(noteId) {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (selected?.id === noteId) setSelected(null);
    setUnlockedNotes(prev => { const s = new Set(prev); s.delete(noteId); return s; });
  }

  async function handlePin(note) {
    const endpoint = note.pinned ? 'unpin' : 'pin';
    const res = await api(`/api/notes/${note.id}/${endpoint}`, { method: 'PATCH', body: '{}' });
    if (res.success) handleUpdate(res.data);
  }

  async function protectNote(noteId, password) {
    const res = await api(`/api/notes/${noteId}/protect`, { method: 'POST', body: JSON.stringify({ password }) });
    if (res.success) { handleUpdate(res.data); setUnlockedNotes(prev => new Set([...prev, noteId])); }
    return res;
  }

  async function removeProtection(noteId) {
    const res = await api(`/api/notes/${noteId}/protect`, { method: 'POST', body: JSON.stringify({ remove: true }) });
    if (res.success) handleUpdate(res.data);
    return res;
  }

  async function unlockNote(noteId, password) {
    const res = await api(`/api/notes/${noteId}/unlock`, { method: 'POST', body: JSON.stringify({ password }) });
    if (res.success) setUnlockedNotes(prev => new Set([...prev, noteId]));
    return res;
  }

  async function unlockNoteBiometric(noteId) {
    if (!isPasskeySupported()) return { success: false, error: 'Biometric not available' };
    try {
      const optRes = await api('/api/auth/passkey/login/options', { method: 'POST', body: JSON.stringify({}) });
      if (!optRes.success) return { success: false, error: 'Could not initiate biometric' };
      const credential = await navigator.credentials.get({ publicKey: { ...normalizeLoginOptions(optRes.data), userVerification: 'required' } });
      if (credential) { setUnlockedNotes(prev => new Set([...prev, noteId])); return { success: true }; }
      return { success: false, error: 'Biometric cancelled' };
    } catch (err) {
      return { success: false, error: err?.message || 'Biometric failed' };
    }
  }

  function getOrCreateAIWorker() {
    if (!aiWorkerRef.current) {
      const w = new AIWorker();
      w.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          setDeviceAIReady(true);
          setDeviceAILoading(false);
          setAiModelProgress(null);
        } else if (data.type === 'progress') {
          if (data.status === 'download' && typeof data.progress === 'number') {
            setAiModelProgress({ file: data.file || '', pct: Math.round(data.progress) });
          }
        } else if (data.type === 'error') {
          setDeviceAILoading(false);
          setAiModelProgress(null);
          setWorkspaceNotice({ type: 'error', message: `On-device AI: ${data.message}` });
        }
      };
      aiWorkerRef.current = w;
    }
    return aiWorkerRef.current;
  }

  function startAIModelDownload() {
    if (deviceAIReady || deviceAILoading) return;
    setDeviceAILoading(true);
    setAiModelProgress({ file: '', pct: 0 });
    const w = getOrCreateAIWorker();
    w.postMessage({ type: 'load' });
  }

  function toggleDeviceAI() {
    if (deviceAI) {
      setDeviceAI(false);
    } else {
      setDeviceAI(true);
      startAIModelDownload();
    }
  }

  async function generateOnDevice(note, type, textOverride = null) {
    const text = textOverride || note.transcript || note.body || note.title || '';
    if (!text) { setWorkspaceNotice({ type: 'error', message: 'No text to process.' }); return null; }
    const w = getOrCreateAIWorker();
    return new Promise(resolve => {
      const handler = ({ data }) => {
        if (data.type === 'result' && data.task === type) {
          w.removeEventListener('message', handler);
          resolve(data);
        } else if (data.type === 'error') {
          w.removeEventListener('message', handler);
          resolve(null);
        }
      };
      w.addEventListener('message', handler);
      w.postMessage({ type: 'generate', task: type, text });
    });
  }

  async function translateContent(note, targetLang, field) {
    if (!deviceAI || !deviceAIReady) {
      setWorkspaceNotice({ type: 'error', message: 'Enable on-device AI first to translate.' });
      return null;
    }
    const task = `translate-${targetLang}`;
    let text = '';
    if (field === 'summary') text = note.summary || '';
    else if (field === 'key-points') text = (note.keyPointsJson || []).map(k => typeof k === 'string' ? k : k.text).join('\n');
    else if (field === 'action-items') text = (note.actionItemsJson || []).map(k => typeof k === 'string' ? k : k.text).join('\n');
    else if (field === 'mind-map') text = JSON.stringify(note.mindMapJson || {});
    else if (field === 'transcript') text = note.transcript || (note.transcriptSegments || []).map(s => `${s.speaker}: ${s.text}`).join('\n');
    if (!text.trim()) return null;
    return generateOnDevice(note, task, text);
  }

  async function generate(note, type) {
    setAiLoading(type);
    setWorkspaceNotice(null);

    if (deviceAI && deviceAIReady) {
      const result = await generateOnDevice(note, type);
      setAiLoading(null);
      if (!result) { setWorkspaceNotice({ type: 'error', message: 'On-device AI failed.' }); return; }

      let patch = {};
      if (type === 'summary') patch = { summary: result.text };
      else if (type === 'key-points') patch = { keyPointsJson: result.parsed || result.text.split('\n').filter(Boolean) };
      else if (type === 'action-items') patch = { actionItemsJson: result.parsed || result.text.split('\n').filter(Boolean).map(t => ({ text: t, completed: false })) };
      else if (type === 'mind-map') patch = { mindMapJson: result.parsed || { root: note.title, children: [] } };

      const res = await api(`/api/notes/${note.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      if (res.success) handleUpdate(res.data);
      return;
    }

    const res = await api(`/api/notes/${note.id}/${type}`, { method: 'POST', body: '{}' });
    setAiLoading(null);
    if (!res.success) { setWorkspaceNotice({ type: 'error', message: res.error || 'AI generation failed.' }); return; }
    handleUpdate(res.data);
  }

  async function toggleActionItem(note, index) {
    const res = await api(`/api/notes/${note.id}/action-items/${index}`, { method: 'PATCH', body: '{}' });
    if (res.success) handleUpdate(res.data);
  }

  async function searchWeb(e) {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q');
    if (!q) return;
    setSearchLoading(true);
    const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
    setSearchResults(res.success ? res.data.results : []);
    setSearchLoading(false);
  }

  async function sendChat(message) {
    if (!selected || !message.trim() || chatLoading) return;
    const userMsg = { role: 'user', content: message.trim() };
    setChatHistory(prev => [...prev, userMsg]);
    setChatLoading(true);
    try {
      const res = await api(`/api/notes/${selected.id}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: message.trim(), history: chatHistory }),
      });
      const reply = res.success ? res.data.reply : (res.error || 'Something went wrong.');
      setChatHistory(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: `Error: ${err?.message || 'request failed'}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  // ── On-device transcription (transformers.js / Whisper WASM) ──
  function getOrCreateWorker() {
    if (!whisperWorkerRef.current) {
      const w = new TranscribeWorker();
      w.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          setDeviceModelReady(true);
          setDeviceModelLoading(false);
          setModelProgress(null);
        } else if (data.type === 'progress') {
          if (data.status === 'download' && typeof data.progress === 'number') {
            setModelProgress({ file: data.file || '', pct: Math.round(data.progress) });
          } else if (data.status === 'done') {
            setModelProgress(prev => prev ? { ...prev, pct: 100 } : prev);
          }
        } else if (data.type === 'error') {
          setDeviceModelLoading(false);
          setModelProgress(null);
          setWorkspaceNotice({ type: 'error', message: `On-device model: ${data.message}` });
        }
        // 'result' events are handled by the one-shot listener in runDeviceTranscription
      };
      whisperWorkerRef.current = w;
    }
    return whisperWorkerRef.current;
  }

  function startModelDownload() {
    if (deviceModelReady || deviceModelLoading) return;
    setDeviceModelLoading(true);
    setModelProgress({ file: '', pct: 0 });
    const w = getOrCreateWorker();
    w.postMessage({ type: 'load', model: 'Xenova/whisper-tiny' });
  }

  function toggleDeviceTranscribe() {
    if (deviceTranscribe) {
      setDeviceTranscribe(false);
      return;
    }
    setDeviceTranscribe(true);
    startModelDownload();
  }

  function confirmModelDownload() {
    setShowModelModal(false);
    setDeviceTranscribe(true);
    startModelDownload();
  }

  async function decodeAudioToFloat32(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    await ctx.close();
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < decoded.length; i++) mono[i] += ch[i];
    }
    if (decoded.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i++) mono[i] /= decoded.numberOfChannels;
    }
    return mono;
  }

  function runDeviceTranscription(audio, language = null) {
    return new Promise((resolve, reject) => {
      const w = getOrCreateWorker();
      const handler = ({ data }) => {
        if (data.type === 'result' || data.type === 'error') {
          w.removeEventListener('message', handler);
          if (data.type === 'result') resolve(data);
          else reject(new Error(data.message));
        }
      };
      w.addEventListener('message', handler);
      w.postMessage({ type: 'transcribe', audio, model: 'Xenova/whisper-tiny', language }, [audio.buffer]);
    });
  }

  // ── Recording ──
  function startWaveform(stream) {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = ctx;
      const update = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        setWaveformBars(Array.from({ length: 8 }, (_, i) => Math.max(0.05, data[Math.floor(i * data.length / 8)] / 255)));
        animFrameRef.current = requestAnimationFrame(update);
      };
      update();
    } catch (_) {}
  }

  function stopWaveform() {
    cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setWaveformBars(Array(8).fill(0.05));
  }

  function startTimer() {
    setRecordingSeconds(0);
    timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function startRecording() {
    setWorkspaceNotice(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setWorkspaceNotice({ type: 'error', message: 'Recording requires microphone access over localhost or HTTPS.' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunks.current = [];
      const mimeType = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      recorder.current = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.current.ondataavailable = e => { if (e.data?.size) chunks.current.push(e.data); };
      const useDeviceTranscribe = deviceTranscribe;
      recorder.current.onstop = async () => {
        stopWaveform();
        stopTimer();
        setRecording(false);
        setRecordingPhase('uploading');
        try {
          const mime = mimeType || chunks.current[0]?.type || 'audio/webm';
          const blob = new Blob(chunks.current, { type: mime });

          if (useDeviceTranscribe) {
            setWorkspaceNotice({ type: 'info', message: 'Transcribing on device…' });
            const audio = await decodeAudioToFloat32(blob);
            const { text, chunks: tChunks } = await runDeviceTranscription(audio, recordingLang || null);
            const segments = (tChunks || []).map((c, i) => ({
              speaker: 'Speaker 1',
              start: c.timestamp?.[0] ?? i * 5,
              end: c.timestamp?.[1] ?? (i + 1) * 5,
              text: c.text?.trim() || '',
            }));
            const res = await api('/api/notes', {
              method: 'POST',
              body: JSON.stringify({
                title: `Voice note – ${new Date().toLocaleString()}`,
                body: text,
                transcriptSegments: segments,
                speakerCount: 1,
                source: 'recording',
              }),
            });
            if (!res.success) throw new Error(res.error || 'Save failed.');
            setSelected(res.data);
            // Upload audio blob so the player works
            const ext = mime.includes('mp4') ? 'm4a' : 'webm';
            const audioForm = new FormData();
            audioForm.append('audio', blob, `voice-note.${ext}`);
            const audioRes = await fetch(`${API}/api/recordings/${res.data.id}/audio`, { method: 'POST', credentials: 'include', body: audioForm });
            if (audioRes.ok) { const j = await audioRes.json(); if (j.success) setSelected(j.data); }
            await refresh();
            setWorkspaceNotice({ type: 'success', message: 'Recording transcribed on device and saved.' });
          } else {
            const ext = mime.includes('mp4') ? 'm4a' : 'webm';
            const data = new FormData();
            data.append('audio', blob, `voice-note.${ext}`);
            if (recordingLang) data.append('language', recordingLang);
            const res = await fetch(`${API}/api/recordings`, { method: 'POST', credentials: 'include', body: data });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed.');
            setSelected(json.data.note);
            await refresh();
            setWorkspaceNotice({ type: 'success', message: 'Recording saved and transcribed.' });
          }
        } catch (err) {
          setWorkspaceNotice({ type: 'error', message: err?.message || 'Recording upload failed.' });
        } finally {
          streamRef.current?.getTracks?.().forEach(t => t.stop());
          streamRef.current = null;
          setRecordingPhase('idle');
        }
      };
      recorder.current.start();
      setRecording(true);
      setRecordingPhase('recording');
      startTimer();
      startWaveform(stream);
    } catch (err) {
      streamRef.current?.getTracks?.().forEach(t => t.stop());
      streamRef.current = null;
      setRecording(false);
      setRecordingPhase('idle');
      stopTimer();
      stopWaveform();
      setWorkspaceNotice({ type: 'error', message: err?.message || 'Unable to start recording.' });
    }
  }

  function stopRecording() {
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.stop();
    }
  }

  async function installApp() {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => null);
    setInstallPromptEvent(null);
    setCanInstall(false);
  }

  return (
    <main className="app">
      {showModelModal && (
        <ModelDownloadModal
          onConfirm={confirmModelDownload}
          onCancel={() => setShowModelModal(false)}
        />
      )}
      {showExtModal && <ExtensionModal onClose={() => setShowExtModal(false)} />}
      <header className="app-header">
        <h1 className="app-title">{tr('notes.title')}</h1>
        <div className="header-actions">
          {canInstall && (
            <button className="btn-secondary install-btn" onClick={installApp}>{tr('pwa.install')}</button>
          )}
          <button className="btn-secondary ext-btn" onClick={() => setShowExtModal(true)} title="Install Chrome Extension">🧩 Extension</button>
          <button className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'es' : 'en')}>
            {lang === 'en' ? 'Español' : 'English'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {!user?.user && (
          <AuthSection tr={tr} notice={authNotice} onPasskeyLogin={passkeyLogin} onLogin={login} onRegister={register} />
        )}
        {user?.user && (
          <Dashboard
            user={user.user}
            view={view}
            setView={setView}
            folders={folders}
            notes={notes}
            tags={tags}
            selected={selected}
            recording={recording}
            recordingPhase={recordingPhase}
            recordingSeconds={recordingSeconds}
            waveformBars={waveformBars}
            filters={filters}
            aiLoading={aiLoading}
            searchResults={searchResults}
            searchLoading={searchLoading}
            tr={tr}
            notice={profileNotice}
            workspaceNotice={workspaceNotice}
            onFilter={applyFilter}
            onSelect={setSelected}
            onQuickCreate={quickCreate}
            onCreateFolder={createFolder}
            onMoveNote={moveNoteToFolder}
            onPin={handlePin}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onGenerate={generate}
            onToggleActionItem={toggleActionItem}
            onSearch={searchWeb}
            recordingLang={recordingLang}
            onChangeLang={setRecordingLang}
            deviceTranscribe={deviceTranscribe}
            deviceModelReady={deviceModelReady}
            deviceModelLoading={deviceModelLoading}
            modelProgress={modelProgress}
            onToggleDeviceTranscribe={toggleDeviceTranscribe}
            deviceAI={deviceAI}
            deviceAIReady={deviceAIReady}
            deviceAILoading={deviceAILoading}
            aiModelProgress={aiModelProgress}
            onToggleDeviceAI={toggleDeviceAI}
            onTranslate={translateContent}
            lang={lang}
            chatHistory={chatHistory}
            chatLoading={chatLoading}
            onChat={sendChat}
            onClearChat={() => setChatHistory([])}
            startRecording={startRecording}
            stopRecording={stopRecording}
            onSaveProfile={saveProfile}
            onAddPasskey={addPasskey}
            onDeletePasskey={deletePasskey}
            passkeys={passkeys}
            unlockedNotes={unlockedNotes}
            onProtectNote={protectNote}
            onRemoveProtection={removeProtection}
            onUnlockNote={unlockNote}
            onUnlockBiometric={unlockNoteBiometric}
            onLogout={logout}
            onNotice={setWorkspaceNotice}
          />
        )}
      </main>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '@ai-notes/i18n';
import TranscribeWorker from './transcribeWorker.js?worker';
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
    <button className={`note-card ${isSelected ? 'is-selected' : ''}`} onClick={() => onClick(note)}>
      <div className="note-card-top">
        {note.pinned && <span className="pin-dot" title="Pinned">📌</span>}
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
function BrowsePanel({ notes, folders, tags, selected, filters, onFilter, onSelect, onQuickCreate, tr }) {
  const [newTitle, setNewTitle] = useState('');

  function handleCreate(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onQuickCreate(newTitle.trim());
    setNewTitle('');
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
        <input
          className="input-field"
          placeholder="New note title…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
        />
        <button className="btn-primary qc-btn" type="submit" disabled={!newTitle.trim()}>+</button>
      </form>

      <div className="browse-section">
        <p className="browse-label">Folders</p>
        <button className={`folder-item ${!filters.folderId ? 'is-active' : ''}`} onClick={() => onFilter({ folderId: null })}>
          All notes <span className="folder-count">{notes.length}</span>
        </button>
        {folders.map(f => (
          <button key={f.id} className={`folder-item ${filters.folderId === f.id ? 'is-active' : ''}`} onClick={() => onFilter({ folderId: filters.folderId === f.id ? null : f.id })}>
            📁 {f.name}
          </button>
        ))}
        <form className="folder-inline-form" onSubmit={async e => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          if (!name) return;
          await api('/api/folders', { method: 'POST', body: JSON.stringify({ name }) });
          e.currentTarget.reset();
          onFilter({});
        }}>
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
function TranscriptSection({ note }) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const hasSegments = Array.isArray(note.transcriptSegments) && note.transcriptSegments.length > 0;
  const hasPlain = Boolean(note.transcript);
  if (!hasSegments && !hasPlain) return null;

  // Group consecutive same-speaker segments into conversation turns
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
          {hasSegments && uniqueSpeakers.length > 1 && (
            <div className="speaker-legend">
              {uniqueSpeakers.map(sp => (
                <span key={sp} className={`speaker-chip ${getSpeakerColor(sp)}`}>{sp}</span>
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
                    <span className="turn-time">{formatSegmentTime(turn.start)}</span>
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

function AIResultBlock({ selected, aiLoading, onGenerate, onToggleActionItem }) {
  const hasAny = selected.summary || (selected.keyPointsJson?.length > 0) || (selected.actionItemsJson?.length > 0) || selected.mindMapJson?.root;

  return (
    <div className="ai-content">
      <div className="ai-actions-row">
        {[
          { type: 'summary', label: 'Summary' },
          { type: 'key-points', label: 'Key Points' },
          { type: 'action-items', label: 'Actions' },
          { type: 'mind-map', label: 'Mind Map' },
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
        <p className="ai-empty-hint">Generate AI insights for this note using the buttons above.</p>
      )}

      {selected.summary && (
        <div className="ai-result-block">
          <h4 className="ai-result-label">Summary</h4>
          <p className="ai-summary-text">{selected.summary}</p>
        </div>
      )}

      {Array.isArray(selected.keyPointsJson) && selected.keyPointsJson.length > 0 && (
        <div className="ai-result-block">
          <h4 className="ai-result-label">Key Points</h4>
          <ul className="key-points-list">
            {selected.keyPointsJson.map((kp, i) => (
              <li key={i}>{typeof kp === 'string' ? kp : (kp.text || String(kp))}</li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(selected.actionItemsJson) && selected.actionItemsJson.length > 0 && (
        <div className="ai-result-block">
          <h4 className="ai-result-label">Action Items</h4>
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
                  {due && <span className="action-due">Due {due}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected.mindMapJson?.root && (
        <div className="ai-result-block">
          <h4 className="ai-result-label">Mind Map</h4>
          <div className="mind-map">
            <MindMapNode node={selected.mindMapJson} depth={0} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Note view panel (centre column) ──────────────────────────────────────────
function NoteViewPanel({ selected, folders, onUpdate, onPin, onDelete, onNotice, tr }) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftFolder, setDraftFolder] = useState('');

  useEffect(() => {
    setEditing(false);
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
    onDelete();
  }

  function exportNote(format) {
    window.open(`${API}/api/notes/${selected.id}/export?format=${format}`, '_blank');
  }

  const transcriptionBadge = selected.transcriptionStatus === 'processing'
    ? <span className="status-badge processing">Transcribing…</span>
    : selected.transcriptionStatus === 'failed'
    ? <span className="status-badge failed">Transcription failed</span>
    : null;

  return (
    <section className="note-view-panel card">
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
          <button className="action-icon-btn" onClick={() => setEditing(e => !e)} title="Edit">
            ✏️
          </button>
          <div className="export-menu-wrap">
            <button className="action-icon-btn" title="Export" onClick={() => exportNote('md')}>⬇️</button>
          </div>
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

      <TranscriptSection note={selected} />
    </section>
  );
}

// ── AI + Search panel (right column) ─────────────────────────────────────────
function AISearchPanel({ selected, aiLoading, onGenerate, onToggleActionItem, searchResults, searchLoading, onSearch, tr }) {
  const [tab, setTab] = useState('ai');

  return (
    <section className="ai-search-panel card">
      <div className="panel-tab-bar">
        <button className={`panel-tab ${tab === 'ai' ? 'is-active' : ''}`} onClick={() => setTab('ai')}>AI</button>
        <button className={`panel-tab ${tab === 'search' ? 'is-active' : ''}`} onClick={() => setTab('search')}>Web Search</button>
      </div>

      {tab === 'ai' && (
        !selected ? (
          <p className="ai-empty-hint">Select a note to generate AI insights.</p>
        ) : (
          <AIResultBlock
            selected={selected}
            aiLoading={aiLoading}
            onGenerate={onGenerate}
            onToggleActionItem={onToggleActionItem}
          />
        )
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

function RecordControl({ recording, recordingPhase, recordingSeconds, waveformBars, onStart, onStop, isFab, deviceTranscribe, deviceModelReady, deviceModelLoading, modelProgress, onToggleDeviceTranscribe }) {
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
  tr, notice, workspaceNotice,
  onFilter, onSelect, onQuickCreate, onPin, onUpdate, onDelete, onGenerate, onToggleActionItem,
  onSearch, startRecording, stopRecording, onSaveProfile, onAddPasskey, onDeletePasskey, passkeys, onLogout, onNotice,
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
              tr={tr}
            />
            <NoteViewPanel
              selected={selected}
              folders={folders}
              onUpdate={onUpdate}
              onPin={onPin}
              onDelete={() => { onSelect(null); onFilter({}); }}
              onNotice={onNotice}
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
  const [authNotice, setAuthNotice] = useState(null);
  const [profileNotice, setProfileNotice] = useState(null);
  const [workspaceNotice, setWorkspaceNotice] = useState(null);

  const recorder = useRef(null);
  const chunks = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const animFrameRef = useRef(null);
  const whisperWorkerRef = useRef(null);

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
    await refresh();
    setSelected(res.data);
  }

  function handleUpdate(updated) {
    setSelected(updated);
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }

  async function handlePin(note) {
    const endpoint = note.pinned ? 'unpin' : 'pin';
    const res = await api(`/api/notes/${note.id}/${endpoint}`, { method: 'PATCH', body: '{}' });
    if (res.success) { handleUpdate(res.data); await refresh(); }
  }

  async function generate(note, type) {
    setAiLoading(type);
    setWorkspaceNotice(null);
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

  function runDeviceTranscription(audio) {
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
      w.postMessage({ type: 'transcribe', audio, model: 'Xenova/whisper-tiny' }, [audio.buffer]);
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
            const { text, chunks: tChunks } = await runDeviceTranscription(audio);
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
            await refresh();
            setWorkspaceNotice({ type: 'success', message: 'Recording transcribed on device and saved.' });
          } else {
            const ext = mime.includes('mp4') ? 'm4a' : 'webm';
            const data = new FormData();
            data.append('audio', blob, `voice-note.${ext}`);
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
      <header className="app-header">
        <h1 className="app-title">{tr('notes.title')}</h1>
        <div className="header-actions">
          {canInstall && (
            <button className="btn-secondary install-btn" onClick={installApp}>{tr('pwa.install')}</button>
          )}
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
            onPin={handlePin}
            onUpdate={handleUpdate}
            onDelete={() => { setSelected(null); refresh(); }}
            onGenerate={generate}
            onToggleActionItem={toggleActionItem}
            onSearch={searchWeb}
            deviceTranscribe={deviceTranscribe}
            deviceModelReady={deviceModelReady}
            deviceModelLoading={deviceModelLoading}
            modelProgress={modelProgress}
            onToggleDeviceTranscribe={toggleDeviceTranscribe}
            startRecording={startRecording}
            stopRecording={stopRecording}
            onSaveProfile={saveProfile}
            onAddPasskey={addPasskey}
            onDeletePasskey={deletePasskey}
            passkeys={passkeys}
            onLogout={logout}
            onNotice={setWorkspaceNotice}
          />
        )}
      </main>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

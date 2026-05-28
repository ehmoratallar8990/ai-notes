const $ = id => document.getElementById(id);

const PLATFORM_ICONS = { 'google-meet': '📹', teams: '💼', 'zoom-web': '🎥' };
const SOURCE_ICONS = { voice: '🎙', meeting: '📹', manual: '📝', clip: '📎' };

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffH = (Date.now() - d) / 3600000;
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 48) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTimer(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const saved = await chrome.storage.local.get(['backendUrl', 'autoRecord']);
const backendUrl = saved.backendUrl || 'http://localhost:3001';

$('backendUrl').value = backendUrl;
$('autoRecord').checked = Boolean(saved.autoRecord);

$('backendUrl').addEventListener('change', () => {
  chrome.storage.local.set({ backendUrl: $('backendUrl').value });
});
$('autoRecord').addEventListener('change', () => {
  chrome.storage.local.set({ autoRecord: $('autoRecord').checked });
});

// ── Connection status ─────────────────────────────────────────────────────────
async function checkConnection() {
  const url = $('backendUrl').value || backendUrl;
  try {
    const res = await fetch(`${url}/api/health`, { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json.success;
    $('connDot').className = `conn-dot ${ok ? 'is-online' : 'is-offline'}`;
    $('connLabel').textContent = ok ? 'Connected' : 'Not signed in';
    if (ok) loadRecentNotes(url);
    return ok;
  } catch {
    $('connDot').className = 'conn-dot is-offline';
    $('connLabel').textContent = 'Offline';
    return false;
  }
}

// ── Meeting detection ─────────────────────────────────────────────────────────
const status = await chrome.runtime.sendMessage({ type: 'STATUS' });
const platform = detectPlatform(tab.url);

if (platform) {
  const banner = $('meetingBanner');
  banner.hidden = false;
  $('meetingIcon').textContent = PLATFORM_ICONS[platform] || '📹';
  $('meetingLabel').textContent = `${platformName(platform)} detected`;
  $('meetingUrl').textContent = tab.url;
}

function detectPlatform(url) {
  if (!url) return null;
  if (url.startsWith('https://meet.google.com/')) return 'google-meet';
  if (url.startsWith('https://teams.microsoft.com/')) return 'teams';
  if (/https:\/\/.*zoom\.us\/wc\//.test(url)) return 'zoom-web';
  return null;
}

function platformName(platform) {
  return { 'google-meet': 'Google Meet', teams: 'Teams', 'zoom-web': 'Zoom' }[platform] || 'Meeting';
}

// ── Recording control ─────────────────────────────────────────────────────────
let timerInterval = null;
let elapsedSeconds = status.recording ? (status.elapsedSeconds || 0) : 0;

function updateRecordingUI(isRecording, isUploading) {
  const btn = $('recBtn');
  const icon = $('recIcon');
  const label = $('recLabel');
  const timer = $('recTimer');

  btn.className = `rec-btn${isRecording ? ' is-recording' : isUploading ? ' is-uploading' : ''}`;

  if (isRecording) {
    icon.textContent = '■';
    label.textContent = 'Stop';
    timer.hidden = false;
    $('timerDisplay').textContent = formatTimer(elapsedSeconds);
    if (!timerInterval) {
      timerInterval = setInterval(() => {
        elapsedSeconds++;
        $('timerDisplay').textContent = formatTimer(elapsedSeconds);
      }, 1000);
    }
  } else if (isUploading) {
    icon.textContent = '⏳';
    label.textContent = 'Processing…';
    timer.hidden = true;
    clearInterval(timerInterval);
    timerInterval = null;
  } else {
    icon.textContent = '🎙';
    label.textContent = 'Start recording';
    timer.hidden = true;
    clearInterval(timerInterval);
    timerInterval = null;
    elapsedSeconds = 0;
  }
}

// Set initial state
updateRecordingUI(status.recording, false);

$('recBtn').addEventListener('click', async () => {
  if (status.recording) {
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    updateRecordingUI(false, true);
    setTimeout(() => updateRecordingUI(false, false), 4000);
  } else {
    const res = await chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId: tab.id, meetingUrl: tab.url });
    if (res.success) {
      updateRecordingUI(true, false);
    }
  }
});

// ── Clip page ─────────────────────────────────────────────────────────────────
$('clipBtn').addEventListener('click', async () => {
  const feedback = $('clipFeedback');
  feedback.textContent = 'Clipping…';
  feedback.className = 'clip-feedback';
  const res = await chrome.runtime.sendMessage({ type: 'CLIP_PAGE', tab });
  if (res?.success) {
    feedback.textContent = '✓ Clipped to AI Notes';
    feedback.className = 'clip-feedback is-success';
    loadRecentNotes($('backendUrl').value || backendUrl);
  } else {
    feedback.textContent = res?.error ? `Error: ${res.error}` : 'Clip failed';
    feedback.className = 'clip-feedback is-error';
  }
  setTimeout(() => { feedback.textContent = ''; feedback.className = 'clip-feedback'; }, 4000);
});

// ── Recent notes ──────────────────────────────────────────────────────────────
async function loadRecentNotes(url) {
  try {
    const res = await fetch(`${url}/api/notes`, { credentials: 'include' });
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data) || json.data.length === 0) return;

    const section = $('recentSection');
    const list = $('recentList');
    section.hidden = false;
    list.innerHTML = '';

    json.data.slice(0, 5).forEach(note => {
      const icon = SOURCE_ICONS[note.source] || '📝';
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'recent-item';
      a.href = (url.replace('/api', '') || 'http://localhost:5173') + `#note-${note.id}`;
      a.target = '_blank';
      a.innerHTML = `
        <span class="recent-icon">${icon}</span>
        <span class="recent-title">${escapeHtml(note.title)}</span>
        <span class="recent-date">${formatDate(note.updatedAt || note.createdAt)}</span>
      `;
      li.appendChild(a);
      list.appendChild(li);
    });
  } catch (_) {}
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Kick off connection check
checkConnection();

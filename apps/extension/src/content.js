// AI Notes Meeting Banner — injected into Google Meet / Teams / Zoom web pages
(function () {
  if (document.getElementById('ai-notes-banner')) return; // already injected

  const PLATFORMS = {
    'meet.google.com': 'Google Meet',
    'teams.microsoft.com': 'Teams',
    'zoom.us': 'Zoom',
  };
  const host = location.hostname;
  const platform = Object.entries(PLATFORMS).find(([k]) => host.includes(k))?.[1] || 'Meeting';

  // ── Styles ────────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ai-notes-banner {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }
    #ai-notes-banner * { box-sizing: border-box; margin: 0; padding: 0; }

    .ainb-card {
      background: #0c0e13;
      border: 1px solid rgba(242,239,233,0.12);
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
      overflow: hidden;
      width: 232px;
      transition: opacity 0.2s, transform 0.2s;
      transform-origin: bottom right;
    }
    .ainb-card.is-minimized {
      width: auto;
      border-radius: 999px;
    }

    .ainb-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid rgba(242,239,233,0.07);
    }
    .ainb-logo {
      font-size: 15px;
      line-height: 1;
    }
    .ainb-title {
      flex: 1;
      font-size: 12px;
      font-weight: 700;
      color: #f2efe9;
      letter-spacing: -0.01em;
    }
    .ainb-platform {
      font-size: 10px;
      color: #7a756d;
      font-weight: 400;
    }
    .ainb-minimize {
      background: none;
      border: none;
      cursor: pointer;
      color: #7a756d;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      transition: color 0.15s;
    }
    .ainb-minimize:hover { color: #f2efe9; }

    .ainb-body {
      padding: 12px;
    }
    .ainb-card.is-minimized .ainb-body,
    .ainb-card.is-minimized .ainb-header .ainb-title,
    .ainb-card.is-minimized .ainb-header .ainb-platform {
      display: none;
    }
    .ainb-card.is-minimized .ainb-header {
      border-bottom: none;
      padding: 8px 12px;
    }

    .ainb-status {
      font-size: 11px;
      color: #7a756d;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ainb-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #7a756d;
      flex-shrink: 0;
    }
    .ainb-status-dot.is-recording {
      background: #c45c3e;
      animation: ainb-blink 1s step-start infinite;
    }
    @keyframes ainb-blink { 50% { opacity: 0; } }

    .ainb-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 9px 14px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      transition: all 0.15s;
    }
    .ainb-btn.is-start {
      background: #d49126;
      color: #0c0e13;
      box-shadow: 0 3px 12px rgba(212,145,38,0.35);
    }
    .ainb-btn.is-start:hover {
      background: #e09e30;
      box-shadow: 0 3px 16px rgba(212,145,38,0.5);
    }
    .ainb-btn.is-stop {
      background: rgba(196,92,62,0.15);
      color: #c45c3e;
      border: 1px solid rgba(196,92,62,0.3);
    }
    .ainb-btn.is-stop:hover {
      background: rgba(196,92,62,0.22);
    }
    .ainb-btn.is-processing {
      background: rgba(242,239,233,0.06);
      color: #7a756d;
      cursor: default;
    }

    .ainb-timer {
      font-size: 12px;
      font-weight: 700;
      color: #c45c3e;
      font-variant-numeric: tabular-nums;
    }

    .ainb-hint {
      font-size: 10px;
      color: #7a756d;
      margin-top: 8px;
      text-align: center;
      line-height: 1.4;
    }
    .ainb-hint a {
      color: #b0aba2;
      text-decoration: none;
    }
    .ainb-hint a:hover { color: #f2efe9; }
  `;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'ai-notes-banner';
  root.innerHTML = `
    <div class="ainb-card" id="ainb-card">
      <div class="ainb-header">
        <span class="ainb-logo">🎙</span>
        <div class="ainb-title">
          AI Notes
          <span class="ainb-platform"> · ${platform}</span>
        </div>
        <button class="ainb-minimize" id="ainb-minimize" title="Minimize">−</button>
      </div>
      <div class="ainb-body">
        <div class="ainb-status" id="ainb-status">
          <span class="ainb-status-dot" id="ainb-dot"></span>
          <span id="ainb-status-text">Ready to record</span>
        </div>
        <button class="ainb-btn is-start" id="ainb-btn">
          <span id="ainb-btn-icon">🎙</span>
          <span id="ainb-btn-label">Start recording</span>
          <span class="ainb-timer" id="ainb-timer" hidden></span>
        </button>
        <p class="ainb-hint">
          Recording is <strong>opt-in</strong>. Audio is sent to your
          <a href="#" id="ainb-open-app" target="_blank">AI Notes</a> instance.
        </p>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ── State ─────────────────────────────────────────────────────────────────────
  let recording = false;
  let minimized = false;
  let timerInterval = null;
  let elapsedSeconds = 0;
  let backendUrl = 'http://localhost:3001';

  chrome.storage.local.get(['backendUrl']).then(({ backendUrl: url }) => {
    if (url) backendUrl = url;
    document.getElementById('ainb-open-app').href = backendUrl.replace(/\/api$/, '').replace(':3001', ':5173') || backendUrl;
  });

  // Query current recording state
  chrome.runtime.sendMessage({ type: 'STATUS' }, res => {
    if (res?.recording) {
      recording = true;
      elapsedSeconds = res.elapsedSeconds || 0;
      setRecordingUI(true);
      startTimer();
    }
  });

  // ── Timer ─────────────────────────────────────────────────────────────────────
  function formatTimer(s) {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  }

  function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      const el = document.getElementById('ainb-timer');
      if (el) el.textContent = formatTimer(elapsedSeconds);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    elapsedSeconds = 0;
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  function setRecordingUI(isRecording) {
    const btn = document.getElementById('ainb-btn');
    const dot = document.getElementById('ainb-dot');
    const statusText = document.getElementById('ainb-status-text');
    const btnLabel = document.getElementById('ainb-btn-label');
    const btnIcon = document.getElementById('ainb-btn-icon');
    const timer = document.getElementById('ainb-timer');
    if (!btn) return;

    if (isRecording) {
      btn.className = 'ainb-btn is-stop';
      dot.className = 'ainb-status-dot is-recording';
      statusText.textContent = 'Recording…';
      btnIcon.textContent = '■';
      btnLabel.textContent = 'Stop';
      timer.hidden = false;
      timer.textContent = formatTimer(elapsedSeconds);
    } else {
      btn.className = 'ainb-btn is-start';
      dot.className = 'ainb-status-dot';
      statusText.textContent = 'Ready to record';
      btnIcon.textContent = '🎙';
      btnLabel.textContent = 'Start recording';
      timer.hidden = true;
    }
  }

  function setProcessingUI() {
    const btn = document.getElementById('ainb-btn');
    const statusText = document.getElementById('ainb-status-text');
    const btnLabel = document.getElementById('ainb-btn-label');
    const btnIcon = document.getElementById('ainb-btn-icon');
    if (!btn) return;
    btn.className = 'ainb-btn is-processing';
    btn.disabled = true;
    statusText.textContent = 'Processing…';
    btnIcon.textContent = '⏳';
    btnLabel.textContent = 'Uploading…';
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  document.getElementById('ainb-btn').addEventListener('click', async () => {
    if (recording) {
      recording = false;
      setProcessingUI();
      stopTimer();
      await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      setTimeout(() => setRecordingUI(false), 4000);
    } else {
      const tab = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }).catch(() => null);
      const tabId = tab?.tabId;
      const res = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId,
        meetingUrl: location.href,
      });
      if (res?.success) {
        recording = true;
        elapsedSeconds = 0;
        setRecordingUI(true);
        startTimer();
      }
    }
  });

  document.getElementById('ainb-minimize').addEventListener('click', () => {
    minimized = !minimized;
    const card = document.getElementById('ainb-card');
    const btn = document.getElementById('ainb-minimize');
    card.classList.toggle('is-minimized', minimized);
    btn.textContent = minimized ? '+' : '−';
    btn.title = minimized ? 'Expand' : 'Minimize';
  });
})();

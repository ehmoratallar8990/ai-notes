const MEETING_PATTERNS = [
  { platform: 'google-meet', test: url => url?.startsWith('https://meet.google.com/') },
  { platform: 'teams', test: url => url?.startsWith('https://teams.microsoft.com/') },
  { platform: 'zoom-web', test: url => /https:\/\/.*zoom\.us\/wc\//.test(url || '') }
];
let recorder = null;
let chunks = [];
let current = null;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const { autoRecord } = await chrome.storage.local.get(['autoRecord']);
  const meeting = detectMeeting(tab.url);
  if (autoRecord && meeting && !recorder) chrome.action.setBadgeText({ text: 'REC', tabId });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING') startRecording(message.tabId, message.meetingUrl).then(sendResponse);
  if (message.type === 'STOP_RECORDING') stopRecording().then(sendResponse);
  if (message.type === 'STATUS') sendResponse({ recording: Boolean(recorder), current });
  return true;
});

function detectMeeting(url) { return MEETING_PATTERNS.find(p => p.test(url))?.platform || null; }

async function startRecording(tabId, meetingUrl) {
  if (recorder) return { success: true, alreadyRecording: true };
  const stream = await chrome.tabCapture.capture({ audio: true, video: false });
  chunks = [];
  current = { tabId, meetingUrl, meetingPlatform: detectMeeting(meetingUrl), startedAt: new Date().toISOString() };
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  recorder.ondataavailable = event => chunks.push(event.data);
  recorder.onstop = uploadRecording;
  recorder.start();
  chrome.action.setBadgeText({ text: 'REC' });
  return { success: true };
}

async function stopRecording() {
  if (!recorder) return { success: true, recording: false };
  recorder.stop();
  chrome.action.setBadgeText({ text: '' });
  return { success: true };
}

async function uploadRecording() {
  const { backendUrl = 'http://localhost:3001' } = await chrome.storage.local.get(['backendUrl']);
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', blob, 'meeting.webm');
  form.append('title', `Meeting ${new Date().toLocaleString()}`);
  form.append('meetingUrl', current?.meetingUrl || '');
  form.append('meetingPlatform', current?.meetingPlatform || 'unknown');
  form.append('startedAt', current?.startedAt || '');
  form.append('endedAt', new Date().toISOString());
  try { await fetch(`${backendUrl}/api/extension/recordings`, { method: 'POST', credentials: 'include', body: form }); }
  catch (error) { console.error('Upload failed', error); }
  finally { recorder = null; current = null; chunks = []; }
}

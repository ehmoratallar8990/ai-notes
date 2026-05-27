import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '@ai-notes/i18n';
import './styles.css';

const API = import.meta.env.VITE_API_URL || '';
const api = async (path, options = {}) => {
  const res = await fetch(`${API}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  return res.json();
};

function App() {
  const [lang, setLang] = useState(localStorage.getItem('lang') || 'en');
  const [user, setUser] = useState(null);
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const tr = (key) => t(lang, key);

  useEffect(() => { localStorage.setItem('lang', lang); }, [lang]);
  useEffect(() => { api('/api/auth/me').then(r => setUser(r.data.user)); refresh(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js'); }, []);
  async function refresh() { const [n, f] = await Promise.all([api('/api/notes'), api('/api/folders')]); if (n.success) setNotes(n.data); if (f.success) setFolders(f.data); }
  async function passkeyLogin() { const options = await api('/api/auth/passkey/login/options', { method: 'POST', body: '{}' }); alert(`${tr('auth.continueWithPasskey')}\n\nOptions returned without allowCredentials so discoverable passkeys can open without email. Real navigator.credentials.get() wiring is next.`); }
  async function register(e) { e.preventDefault(); const form = new FormData(e.currentTarget); await api('/api/auth/passkey/register/options', { method: 'POST', body: JSON.stringify({ username: form.get('username'), displayName: form.get('displayName'), preferredLanguage: lang }) }); const verified = await api('/api/auth/passkey/register/verify', { method: 'POST', body: JSON.stringify({ id: `dev-${crypto.randomUUID()}` }) }); setUser(verified.data.user); refresh(); }
  async function createNote(e) { e.preventDefault(); const form = new FormData(e.currentTarget); await api('/api/notes', { method: 'POST', body: JSON.stringify({ title: form.get('title'), body: form.get('body'), folderId: form.get('folderId') || null }) }); e.currentTarget.reset(); refresh(); }
  async function generate(note, type) { const r = await api(`/api/notes/${note.id}/${type}`, { method: 'POST', body: '{}' }); setSelected(r.data); refresh(); }
  async function startRecording() { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks.current = []; recorder.current = new MediaRecorder(stream); recorder.current.ondataavailable = e => chunks.current.push(e.data); recorder.current.onstop = async () => { const blob = new Blob(chunks.current, { type: 'audio/webm' }); const data = new FormData(); data.append('audio', blob, 'voice-note.webm'); const res = await fetch(`${API}/api/recordings`, { method: 'POST', credentials: 'include', body: data }); const json = await res.json(); setSelected(json.data.note); refresh(); }; recorder.current.start(); setRecording(true); }
  function stopRecording() { recorder.current?.stop(); setRecording(false); }

  return <main className="app">
    <header><h1>{tr('notes.title')}</h1><select value={lang} onChange={e=>setLang(e.target.value)}><option value="en">English</option><option value="es">Español</option></select></header>
    {!user && <section className="card auth"><button className="primary" onClick={passkeyLogin}>{tr('auth.continueWithPasskey')}</button><form onSubmit={register}><input name="username" placeholder={tr('auth.username')} required/><input name="displayName" placeholder={tr('auth.displayName')} required/><button>{tr('auth.createAccount')}</button></form></section>}
    {user && <><section className="toolbar"><button className="record" onClick={recording ? stopRecording : startRecording}>{recording ? tr('recording.stop') : tr('recording.start')}</button><span>{user.displayName}</span></section>
    <section className="grid"><aside className="card"><h2>{tr('notes.folder')}</h2>{folders.map(f=><p key={f.id}>📁 {f.name}</p>)}<form onSubmit={async e=>{e.preventDefault(); await api('/api/folders',{method:'POST',body:JSON.stringify({name:new FormData(e.currentTarget).get('name')})}); e.currentTarget.reset(); refresh();}}><input name="name" placeholder="Work / Trabajo"/><button>+</button></form></aside>
    <section className="card"><h2>{tr('notes.newNote')}</h2><form onSubmit={createNote}><input name="title" placeholder="Title"/><textarea name="body" placeholder="Write a note..."></textarea><select name="folderId"><option value="">Uncategorized</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select><button>{tr('notes.save')}</button></form><div>{notes.map(n=><button className="note" key={n.id} onClick={()=>setSelected(n)}>{n.title}<small>{n.transcriptionStatus}</small></button>)}</div></section>
    <section className="card detail">{selected ? <><h2>{selected.title}</h2><p>{selected.body}</p><pre>{selected.transcript}</pre><button onClick={()=>generate(selected,'summary')}>{tr('ai.generateSummary')}</button><button onClick={()=>generate(selected,'key-points')}>{tr('ai.keyPoints')}</button><button onClick={()=>generate(selected,'action-items')}>{tr('ai.actionItems')}</button><button onClick={()=>generate(selected,'mind-map')}>{tr('ai.mindMap')}</button><h3>AI</h3><p>{selected.summary}</p><pre>{JSON.stringify(selected.keyPointsJson || selected.actionItemsJson || selected.mindMapJson, null, 2)}</pre></> : <p>Select a note</p>}</section></section></>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);

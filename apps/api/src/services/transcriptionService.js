import { spawn } from 'node:child_process';
import { readFile, unlink, mkdtemp } from 'node:fs/promises';
import { join, basename, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function segmentsToPlainText(segments) {
  return segments.map(s => `${s.speaker}: ${s.text}`).join('\n');
}

function normalizeSpeakerLabel(raw) {
  if (!raw) return 'Speaker 1';
  // WhisperX uses SPEAKER_00, SPEAKER_01, etc.
  const match = raw.match(/\d+/);
  if (match) return `Speaker ${parseInt(match[0], 10) + 1}`;
  return raw;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function runProcess(cmd, args, spawnOpts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe', ...spawnOpts });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
      else resolve();
    });
    proc.on('error', reject);
  });
}

function runProcessCapture(cmd, args, spawnOpts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe', ...spawnOpts });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
      else resolve(stdout);
    });
    proc.on('error', reject);
  });
}

// ── faster-whisper subprocess provider ────────────────────────────────────────
// Requirements: pip install faster-whisper  (ffmpeg must be in PATH)
// Config via env: WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE,
//                 WHISPER_LANGUAGE, HF_TOKEN (for speaker diarization)
export function createFasterWhisperProvider({
  scriptPath = process.env.WHISPER_SCRIPT_PATH || join(__dirname, 'transcribe.py'),
  model = process.env.WHISPER_MODEL || 'base',
  device = process.env.WHISPER_DEVICE || 'cpu',
  computeType = process.env.WHISPER_COMPUTE_TYPE || 'int8',
  language = process.env.WHISPER_LANGUAGE || undefined,
  hfToken = process.env.HF_TOKEN || '',
} = {}) {
  return {
    async transcribe({ filePath }) {
      const env = {
        ...process.env,
        KMP_DUPLICATE_LIB_OK: 'TRUE',
        WHISPER_MODEL: model,
        WHISPER_DEVICE: device,
        WHISPER_COMPUTE_TYPE: computeType,
        ...(language ? { WHISPER_LANGUAGE: language } : {}),
        ...(hfToken ? { HF_TOKEN: hfToken } : {}),
      };
      const stdout = await runProcessCapture('python3', [scriptPath, filePath], { env });
      const result = JSON.parse(stdout.trim());
      if (result.status === 'failed') throw new Error(result.error || 'faster-whisper failed');
      return result;
    }
  };
}

// ── whisper-http provider ─────────────────────────────────────────────────────
// Calls the standalone Python HTTP service (apps/transcribe/server.py).
// Docker: docker compose up transcribe
// Local:  python3 apps/transcribe/server.py
// Set WHISPER_HTTP_URL=http://localhost:8765 (or http://transcribe:8765 in Docker)
export function createWhisperHttpProvider({
  baseUrl = process.env.WHISPER_HTTP_URL || 'http://localhost:8765',
} = {}) {
  return {
    async transcribe({ filePath, mimeType = 'audio/webm', language = null }) {
      const fileBuffer = await readFile(filePath);
      const ext = extname(filePath) || '.webm';
      const formData = new FormData();
      formData.append('audio', new Blob([fileBuffer], { type: mimeType }), basename(filePath));
      formData.append('ext', ext);
      if (language) formData.append('language', language);
      const res = await fetch(`${baseUrl}/transcribe`, { method: 'POST', body: formData });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Whisper HTTP service error ${res.status}: ${text}`);
      }
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      return result;
    }
  };
}

// Mock provider — realistic diarized output for testing/development
export function createMockTranscriptionProvider() {
  return {
    async transcribe({ filePath }) {
      const segments = [
        { speaker: 'Speaker 1', start: 0.0,  end: 5.2,  text: "Hi everyone, let's get started. I wanted to go over the Q4 roadmap today." },
        { speaker: 'Speaker 2', start: 5.8,  end: 11.4, text: "Thanks for setting this up. I had a chance to review the draft and I have a few questions about the timeline." },
        { speaker: 'Speaker 1', start: 12.0, end: 17.6, text: "Of course, let's go through them one by one. We should make sure everyone is aligned before we move forward." },
        { speaker: 'Speaker 3', start: 18.2, end: 24.0, text: "I agree. Also, I think we need to follow up with the design team about the new components. Can someone take that as an action item?" },
        { speaker: 'Speaker 2', start: 24.8, end: 30.1, text: "I'll take that one. I'll schedule a design review for next week and send the invite to everyone." },
        { speaker: 'Speaker 1', start: 31.0, end: 36.5, text: "Perfect. Let's also make sure we document the decisions made today so nothing falls through the cracks." },
      ];
      return {
        status: 'completed',
        transcript: segmentsToPlainText(segments),
        segments,
        speakerCount: 3,
      };
    }
  };
}

// WhisperX provider — local Python subprocess with speaker diarization
// Requirements: pip install whisperx
// Set HF_TOKEN env var (free at huggingface.co) to enable speaker diarization
// Set WHISPERX_MODEL (tiny/base/small/medium/large-v2/large-v3), WHISPERX_DEVICE (cpu/cuda)
export function createWhisperXProvider({
  model = process.env.WHISPERX_MODEL || 'base',
  hfToken = process.env.HF_TOKEN || '',
  language = process.env.WHISPER_LANGUAGE || undefined,
  device = process.env.WHISPERX_DEVICE || 'cpu',
  computeType = process.env.WHISPERX_COMPUTE_TYPE || 'int8',
} = {}) {
  return {
    async transcribe({ filePath }) {
      const outDir = await mkdtemp(join(tmpdir(), 'whisperx-'));
      const args = [
        '-m', 'whisperx', filePath,
        '--model', model,
        '--device', device,
        '--compute_type', computeType,
        '--output_format', 'json',
        '--output_dir', outDir,
        ...(hfToken ? ['--diarize', '--hf_token', hfToken] : []),
        ...(language ? ['--language', language] : []),
      ];

      await runProcess('python3', args);

      const stem = basename(filePath, extname(filePath));
      const resultPath = join(outDir, `${stem}.json`);
      const raw = JSON.parse(await readFile(resultPath, 'utf8'));
      await unlink(resultPath).catch(() => {});

      // WhisperX JSON: { segments: [{start, end, text, speaker?, words?}] }
      const speakers = new Set();
      const segments = (raw.segments || []).map(seg => {
        const speaker = normalizeSpeakerLabel(seg.speaker);
        speakers.add(speaker);
        return { speaker, start: Number(seg.start), end: Number(seg.end), text: seg.text.trim() };
      });

      return {
        status: 'completed',
        transcript: segmentsToPlainText(segments),
        segments,
        speakerCount: speakers.size,
      };
    }
  };
}

// AssemblyAI provider — cloud transcription with native speaker diarization
// Requires: ASSEMBLYAI_API_KEY env var
export function createAssemblyAIProvider({
  apiKey = process.env.ASSEMBLYAI_API_KEY || '',
  speakerLabels = true,
} = {}) {
  const base = 'https://api.assemblyai.com/v2';
  const headers = { authorization: apiKey, 'content-type': 'application/json' };

  return {
    async transcribe({ filePath, mimeType = 'audio/webm' }) {
      if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is not set');

      const fileBuffer = await readFile(filePath);
      const uploadRes = await fetch(`${base}/upload`, {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': mimeType },
        body: fileBuffer,
      });
      if (!uploadRes.ok) throw new Error(`AssemblyAI upload failed: ${uploadRes.status}`);
      const { upload_url } = await uploadRes.json();

      const transcriptRes = await fetch(`${base}/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ audio_url: upload_url, speaker_labels: speakerLabels }),
      });
      if (!transcriptRes.ok) throw new Error(`AssemblyAI request failed: ${transcriptRes.status}`);
      const { id } = await transcriptRes.json();

      // Poll until completed (max 6 minutes)
      let result;
      for (let attempt = 0; attempt < 120; attempt++) {
        await sleep(3000);
        const pollRes = await fetch(`${base}/transcript/${id}`, { headers: { authorization: apiKey } });
        result = await pollRes.json();
        if (result.status === 'completed' || result.status === 'error') break;
      }

      if (result.status === 'error') throw new Error(`AssemblyAI error: ${result.error}`);
      if (result.status !== 'completed') throw new Error('AssemblyAI timed out after 6 minutes');

      const utterances = result.utterances || [];
      const speakers = new Set();
      const segments = utterances.map(u => {
        const speaker = `Speaker ${u.speaker}`;
        speakers.add(speaker);
        return { speaker, start: u.start / 1000, end: u.end / 1000, text: u.text.trim() };
      });

      return {
        status: 'completed',
        transcript: segments.length > 0 ? segmentsToPlainText(segments) : (result.text || ''),
        segments,
        speakerCount: speakers.size,
      };
    }
  };
}

// Deepgram provider — cloud transcription with speaker diarization
// Requires: DEEPGRAM_API_KEY env var
export function createDeepgramProvider({
  apiKey = process.env.DEEPGRAM_API_KEY || '',
  model = process.env.DEEPGRAM_MODEL || 'nova-2',
  language = process.env.WHISPER_LANGUAGE || 'en',
} = {}) {
  return {
    async transcribe({ filePath, mimeType = 'audio/webm' }) {
      if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set');

      const fileBuffer = await readFile(filePath);
      const params = new URLSearchParams({
        model, language,
        diarize: 'true',
        punctuate: 'true',
        utterances: 'true',
      });

      const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: { authorization: `Token ${apiKey}`, 'content-type': mimeType },
        body: fileBuffer,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Deepgram failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      const utterances = data.results?.utterances || [];
      const speakers = new Set();
      const segments = utterances.map(u => {
        const speaker = `Speaker ${u.speaker + 1}`;
        speakers.add(speaker);
        return { speaker, start: u.start, end: u.end, text: u.transcript.trim() };
      });
      const plainText = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || segmentsToPlainText(segments);

      return {
        status: 'completed',
        transcript: plainText,
        segments,
        speakerCount: speakers.size,
      };
    }
  };
}

// OpenAI Whisper provider — cloud, no speaker diarization
// Requires: OPENAI_API_KEY env var
export function createOpenAIProvider({
  apiKey = process.env.OPENAI_API_KEY || '',
  model = 'whisper-1',
  language = process.env.WHISPER_LANGUAGE || undefined,
} = {}) {
  return {
    async transcribe({ filePath, mimeType = 'audio/webm' }) {
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

      const fileBuffer = await readFile(filePath);
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer], { type: mimeType }), basename(filePath));
      formData.append('model', model);
      formData.append('response_format', 'verbose_json');
      if (language) formData.append('language', language);

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI Whisper failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      // verbose_json has time-aligned segments but no speaker labels
      const segments = (data.segments || []).map(s => ({
        speaker: 'Speaker 1',
        start: Number(s.start),
        end: Number(s.end),
        text: s.text.trim(),
      }));

      return {
        status: 'completed',
        transcript: data.text || '',
        segments,
        speakerCount: 1,
      };
    }
  };
}

// Groq Whisper provider — OpenAI-compatible API, free tier, very fast
// Requires: GROQ_API_KEY env var
export function createGroqProvider({
  apiKey = process.env.GROQ_API_KEY || '',
  model = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
  language = process.env.WHISPER_LANGUAGE || undefined,
} = {}) {
  return {
    async transcribe({ filePath, mimeType = 'audio/webm' }) {
      if (!apiKey) throw new Error('GROQ_API_KEY is not set');

      const fileBuffer = await readFile(filePath);
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer], { type: mimeType }), basename(filePath));
      formData.append('model', model);
      formData.append('response_format', 'verbose_json');
      if (language) formData.append('language', language);

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Groq Whisper failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      const segments = (data.segments || []).map(s => ({
        speaker: 'Speaker 1',
        start: Number(s.start),
        end: Number(s.end),
        text: s.text.trim(),
      }));

      return {
        status: 'completed',
        transcript: data.text || '',
        segments,
        speakerCount: 1,
      };
    }
  };
}

export function createTranscriptionProvider(name = process.env.TRANSCRIPTION_PROVIDER || 'mock', options = {}) {
  switch (name) {
    case 'faster-whisper': return createFasterWhisperProvider(options);
    case 'whisper-http':   return createWhisperHttpProvider(options);
    case 'whisperx':       return createWhisperXProvider(options);
    case 'assemblyai':     return createAssemblyAIProvider(options);
    case 'deepgram':       return createDeepgramProvider(options);
    case 'openai':         return createOpenAIProvider(options);
    case 'groq':           return createGroqProvider(options);
    case 'mock':           return createMockTranscriptionProvider();
    default:
      console.warn(`TRANSCRIPTION_PROVIDER="${name}" not recognized; using mock. Available: faster-whisper, whisper-http, whisperx, assemblyai, deepgram, openai, groq, mock.`);
      return createMockTranscriptionProvider();
  }
}

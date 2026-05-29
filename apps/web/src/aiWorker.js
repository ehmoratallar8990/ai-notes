import { pipeline, env } from '@huggingface/transformers';

env.useBrowserCache = true;
env.allowLocalModels = false;

let generator = null;
let loadedModelId = null;

// ── Model registry ────────────────────────────────────────────────────────────
export const AI_MODELS = [
  { id: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',     label: 'Qwen3.5 0.8B (GPU)', size: '~800 MB', family: 'chatml', device: 'webgpu' },
  { id: 'Qwen/Qwen2.5-0.5B-Instruct',               label: 'Qwen2.5 0.5B',       size: '~400 MB', family: 'chatml', device: 'wasm'   },
  { id: 'HuggingFaceTB/SmolLM2-135M-Instruct',      label: 'SmolLM2 135M',       size: '~100 MB', family: 'chatml', device: 'wasm'   },
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct',      label: 'SmolLM2 360M',       size: '~280 MB', family: 'chatml', device: 'wasm'   },
  { id: 'google/gemma-3n-E2B-it',                   label: 'Gemma 3n E2B',       size: '~1.3 GB', family: 'gemma',  device: 'wasm'   },
];

function modelFamily(modelId) {
  if (modelId?.toLowerCase().includes('gemma')) return 'gemma';
  return 'chatml';
}

function modelDevice(modelId) {
  return AI_MODELS.find(m => m.id === modelId)?.device ?? 'wasm';
}

async function ensureModel(modelId) {
  if (generator && loadedModelId === modelId) return;
  generator = null;
  const device = modelDevice(modelId);
  generator = await pipeline('text-generation', modelId, {
    device,
    dtype: device === 'webgpu' ? 'q4f16' : 'q4',
    progress_callback: info => { self.postMessage({ type: 'progress', ...info }); },
  });
  loadedModelId = modelId;
  self.postMessage({ type: 'ready', model: modelId });
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function chatmlPrompt(system, history, userMessage) {
  let prompt = system ? `<|im_start|>system\n${system}<|im_end|>\n` : '';
  for (const { role, content } of history) {
    prompt += `<|im_start|>${role}\n${content}<|im_end|>\n`;
  }
  prompt += `<|im_start|>user\n${userMessage}<|im_end|>\n<|im_start|>assistant\n`;
  return prompt;
}

function gemmaPrompt(system, history, userMessage) {
  let prompt = '';
  let firstUser = true;
  for (const { role, content } of history) {
    if (role === 'user') {
      const prefix = firstUser && system ? `${system}\n\n` : '';
      prompt += `<start_of_turn>user\n${prefix}${content}<end_of_turn>\n`;
      firstUser = false;
    } else {
      prompt += `<start_of_turn>model\n${content}<end_of_turn>\n`;
    }
  }
  const prefix = firstUser && system ? `${system}\n\n` : '';
  prompt += `<start_of_turn>user\n${prefix}${userMessage}<end_of_turn>\n<start_of_turn>model\n`;
  return prompt;
}

function buildPrompt(family, system, history, userMessage) {
  return family === 'gemma'
    ? gemmaPrompt(system, history, userMessage)
    : chatmlPrompt(system, history, userMessage);
}

// ── Task definitions (user-facing content, no template) ──────────────────────
const TASK_PROMPTS = {
  summary:        t => `Summarize the following in 2-3 clear sentences:\n\n${t.slice(0, 2000)}`,
  'key-points':   t => `List 3-5 key points from the following, one per line starting with "- ":\n\n${t.slice(0, 2000)}`,
  'action-items': t => `Extract action items from the following, one per line starting with "- ":\n\n${t.slice(0, 2000)}`,
  'mind-map':     t => `Create a hierarchical outline of main topic and subtopics from the following:\n\n${t.slice(0, 2000)}`,
  'translate-es': t => `Translate the following text to Spanish. Output only the translation:\n\n${t.slice(0, 3000)}`,
  'translate-en': t => `Translate the following text to English. Output only the translation:\n\n${t.slice(0, 3000)}`,
};

// ── Parse helpers ─────────────────────────────────────────────────────────────
function parseKeyPoints(text) {
  return text.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
}

function parseActionItems(text) {
  return text.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    .map(t => ({ text: t, completed: false }));
}

function parseMindMap(text) {
  const lines = text.split('\n').filter(Boolean);
  const root = lines[0]?.replace(/^[-*#•\s]+/, '').trim() || 'Topic';
  const children = lines.slice(1)
    .map(l => ({ label: l.replace(/^[-*#•\s]+/, '').trim(), children: [] }))
    .filter(c => c.label);
  return { root, children };
}

function buildNoteContext(ctx) {
  const parts = [];
  if (ctx.title)    parts.push(`Title: ${ctx.title}`);
  if (ctx.body?.trim())       parts.push(`Content:\n${ctx.body.slice(0, 2000)}`);
  if (ctx.transcript?.trim()) parts.push(`Transcript:\n${ctx.transcript.slice(0, 2000)}`);
  if (ctx.summary)  parts.push(`Summary: ${ctx.summary}`);
  if (ctx.keyPoints?.length)  parts.push(`Key points:\n${ctx.keyPoints.map(k => `- ${k}`).join('\n')}`);
  return parts.join('\n\n');
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await ensureModel(data.model);

    } else if (data.type === 'generate') {
      const { task, text, model } = data;
      await ensureModel(model);
      const family = modelFamily(model);
      const userContent = TASK_PROMPTS[task]?.(text) || `Process:\n${text}`;
      const prompt = buildPrompt(family, null, [], userContent);

      const result = await generator(prompt, {
        max_new_tokens: 200,
        temperature: 0.1,
        do_sample: false,
        repetition_penalty: 1.1,
      });
      const generated = result[0]?.generated_text?.slice(prompt.length)?.trim() || '';

      let parsed = null;
      if (task === 'key-points')   parsed = parseKeyPoints(generated);
      else if (task === 'action-items') parsed = parseActionItems(generated);
      else if (task === 'mind-map')     parsed = parseMindMap(generated);

      self.postMessage({ type: 'result', task, text: generated, parsed, translated: task.startsWith('translate-') });

    } else if (data.type === 'chat') {
      const { model, noteContext, history, message } = data;
      await ensureModel(model);
      const family = modelFamily(model);
      const system = noteContext
        ? `You are a helpful assistant. Answer questions about the following note concisely and accurately.\n\n${buildNoteContext(noteContext)}`
        : 'You are a helpful assistant. Answer concisely.';

      // Keep last 10 turns to stay within context window
      const trimmedHistory = (history || []).slice(-10);
      const prompt = buildPrompt(family, system, trimmedHistory, message);

      const result = await generator(prompt, {
        max_new_tokens: 400,
        temperature: 0.3,
        do_sample: true,
        repetition_penalty: 1.1,
      });
      const reply = result[0]?.generated_text?.slice(prompt.length)?.trim() || '';
      self.postMessage({ type: 'chat-result', reply });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};

import { pipeline, env } from '@huggingface/transformers';

env.useBrowserCache = true;
env.allowLocalModels = false;

let generator = null;
let loadedModel = null;

const MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct';

async function ensureModel(modelName) {
  if (generator && loadedModel === modelName) return;
  generator = null;
  generator = await pipeline('text-generation', modelName, {
    device: 'wasm',
    dtype: 'q4',
    progress_callback: info => { self.postMessage({ type: 'progress', ...info }); },
  });
  loadedModel = modelName;
  self.postMessage({ type: 'ready', model: modelName });
}

const PROMPTS = {
  summary: text =>
    `<|im_start|>user\nSummarize the following in 2-3 clear sentences:\n\n${text.slice(0, 2000)}<|im_end|>\n<|im_start|>assistant\n`,
  'key-points': text =>
    `<|im_start|>user\nList 3-5 key points from the following, one per line starting with "- ":\n\n${text.slice(0, 2000)}<|im_end|>\n<|im_start|>assistant\n`,
  'action-items': text =>
    `<|im_start|>user\nExtract action items from the following, one per line starting with "- ":\n\n${text.slice(0, 2000)}<|im_end|>\n<|im_start|>assistant\n`,
  'mind-map': text =>
    `<|im_start|>user\nCreate a hierarchical outline of main topic and subtopics from the following:\n\n${text.slice(0, 2000)}<|im_end|>\n<|im_start|>assistant\n`,
  'translate-es': text =>
    `<|im_start|>user\nTranslate the following text to Spanish. Output only the translation:\n\n${text.slice(0, 3000)}<|im_end|>\n<|im_start|>assistant\n`,
  'translate-en': text =>
    `<|im_start|>user\nTranslate the following text to English. Output only the translation:\n\n${text.slice(0, 3000)}<|im_end|>\n<|im_start|>assistant\n`,
};

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
  const children = lines.slice(1).map(l => ({ label: l.replace(/^[-*#•\s]+/, '').trim(), children: [] })).filter(c => c.label);
  return { root, children };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await ensureModel(MODEL);
    } else if (data.type === 'generate') {
      await ensureModel(MODEL);
      const { task, text } = data;
      const prompt = PROMPTS[task]?.(text) || `<|im_start|>user\nProcess:\n${text}<|im_end|>\n<|im_start|>assistant\n`;
      const result = await generator(prompt, {
        max_new_tokens: 200,
        temperature: 0.1,
        do_sample: false,
        repetition_penalty: 1.1,
      });
      const generated = result[0]?.generated_text?.slice(prompt.length)?.trim() || '';

      let parsed = null;
      if (task === 'key-points') parsed = parseKeyPoints(generated);
      else if (task === 'action-items') parsed = parseActionItems(generated);
      else if (task === 'mind-map') parsed = parseMindMap(generated);

      self.postMessage({ type: 'result', task, text: generated, parsed, translated: task.startsWith('translate-') });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};

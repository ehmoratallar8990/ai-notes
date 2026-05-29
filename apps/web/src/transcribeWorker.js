import { pipeline, env } from '@huggingface/transformers';

env.useBrowserCache = true;
env.allowLocalModels = false;
// env.backends.onnx.wasm is populated lazily — do NOT touch it here

let transcriber = null;
let loadedModel = null;

async function ensureModel(modelName) {
  if (transcriber && loadedModel === modelName) return;
  transcriber = null;
  transcriber = await pipeline(
    'automatic-speech-recognition',
    modelName,
    {
      device: 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q4' },
      progress_callback: info => {
        self.postMessage({ type: 'progress', ...info });
      },
    }
  );
  loadedModel = modelName;
  self.postMessage({ type: 'ready', model: modelName });
}

self.onmessage = async ({ data }) => {
  try {
    const model = data.model || 'Xenova/whisper-tiny';
    if (data.type === 'load') {
      await ensureModel(model);
    } else if (data.type === 'transcribe') {
      await ensureModel(model);
      const result = await transcriber(data.audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: data.language || null,
      });
      self.postMessage({
        type: 'result',
        text: result.text?.trim() || '',
        chunks: result.chunks || [],
      });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};

export function createMockTranscriptionProvider() {
  return {
    async transcribe({ filePath }) {
      return { status: 'completed', transcript: `Mock transcript generated for ${filePath}. Replace TRANSCRIPTION_PROVIDER with whisper-cpp, faster-whisper, or vosk for free local transcription.` };
    }
  };
}

export function createTranscriptionProvider(name = process.env.TRANSCRIPTION_PROVIDER || 'mock') {
  if (name !== 'mock') {
    console.warn(`TRANSCRIPTION_PROVIDER=${name} not implemented yet; falling back to mock.`);
  }
  return createMockTranscriptionProvider();
}

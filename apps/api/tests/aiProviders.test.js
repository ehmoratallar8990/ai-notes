import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAiProvider } from '../src/services/aiNoteService.js';
import { createMockTranscriptionProvider } from '../src/services/transcriptionService.js';

test('mock transcription returns completed diarized transcript', async () => {
  const provider = createMockTranscriptionProvider();
  const result = await provider.transcribe({ filePath: 'meeting.webm' });
  assert.equal(result.status, 'completed');
  assert.ok(typeof result.transcript === 'string' && result.transcript.length > 0);
  assert.ok(Array.isArray(result.segments) && result.segments.length > 0);
  assert.ok(result.speakerCount >= 1);
  const seg = result.segments[0];
  assert.ok(seg.speaker && seg.text && typeof seg.start === 'number' && typeof seg.end === 'number');
});

test('mock ai provider returns summary, key points, action items, and mind map', async () => {
  const provider = createMockAiProvider();
  const input = 'Discuss launch timeline and follow up with Maria.';
  assert.match(await provider.summary(input), /Discuss launch/);
  assert.ok(Array.isArray(await provider.keyPoints(input)));
  assert.ok(Array.isArray(await provider.actionItems(input)));
  assert.equal((await provider.mindMap(input)).root, 'Note');
});

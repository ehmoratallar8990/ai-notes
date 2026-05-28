export const SUPPORTED_LANGUAGES = ['en', 'es'];
export const TRANSCRIPTION_STATUSES = ['pending', 'processing', 'completed', 'failed'];
export const AI_PROVIDERS = ['mock', 'ollama'];
export const DEFAULT_AI_PROVIDER = 'mock';
export const MEETING_URL_PATTERNS = [
  { platform: 'google-meet', pattern: /https:\/\/meet\.google\.com\// },
  { platform: 'teams', pattern: /https:\/\/teams\.microsoft\.com\// },
  { platform: 'zoom-web', pattern: /https:\/\/.*zoom\.us\/wc\// }
];
export function detectMeetingPlatform(url = '') {
  return MEETING_URL_PATTERNS.find(item => item.pattern.test(url))?.platform || null;
}
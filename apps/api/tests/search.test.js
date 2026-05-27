import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDuckDuckGoSearchProvider, normalizeDuckDuckGoResults } from '../src/services/searchService.js';

const fixture = {
  AbstractText: 'DuckDuckGo is an internet privacy company.',
  AbstractURL: 'https://duckduckgo.com/about',
  Heading: 'DuckDuckGo',
  RelatedTopics: [
    { FirstURL: 'https://duckduckgo.com/privacy', Text: 'DuckDuckGo Privacy' },
    { Topics: [{ FirstURL: 'https://duckduckgo.com/app', Text: 'DuckDuckGo Browser App' }] }
  ]
};

test('normalizes DuckDuckGo instant answer results', () => {
  const results = normalizeDuckDuckGoResults(fixture);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    title: 'DuckDuckGo',
    url: 'https://duckduckgo.com/about',
    snippet: 'DuckDuckGo is an internet privacy company.',
    source: 'duckduckgo'
  });
});

test('DuckDuckGo provider calls free instant answer API and normalizes output', async () => {
  const provider = createDuckDuckGoSearchProvider({
    fetchImpl: async (url) => {
      assert.match(String(url), /api\.duckduckgo\.com/);
      assert.match(String(url), /q=privacy/);
      return { ok: true, json: async () => fixture };
    }
  });
  const results = await provider.search('privacy');
  assert.equal(results[1].title, 'DuckDuckGo Privacy');
});

test('search endpoint validates query and returns results', async () => {
  const app = createApp({
    searchProvider: { search: async (query) => [{ title: `Result for ${query}`, url: 'https://example.com', snippet: 'Example', source: 'duckduckgo' }] }
  });
  const res = await request(app).get('/api/search?q=meeting%20notes');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.results[0].title, 'Result for meeting notes');
});

test('search endpoint rejects empty query', async () => {
  const app = createApp();
  const res = await request(app).get('/api/search?q=');
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

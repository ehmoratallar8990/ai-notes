function titleFromText(text = '') {
  return text.split(' - ')[0]?.trim() || text.trim() || 'DuckDuckGo result';
}

function collectRelatedTopics(topics = [], output = []) {
  for (const topic of topics) {
    if (topic.FirstURL && topic.Text) {
      output.push({
        title: titleFromText(topic.Text),
        url: topic.FirstURL,
        snippet: topic.Text,
        source: 'duckduckgo'
      });
    }
    if (Array.isArray(topic.Topics)) collectRelatedTopics(topic.Topics, output);
  }
  return output;
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    if (!result.url || seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

export function normalizeDuckDuckGoResults(payload = {}) {
  const results = [];

  if (payload.AbstractURL && (payload.AbstractText || payload.Heading)) {
    results.push({
      title: payload.Heading || titleFromText(payload.AbstractText),
      url: payload.AbstractURL,
      snippet: payload.AbstractText || payload.Heading || '',
      source: 'duckduckgo'
    });
  }

  collectRelatedTopics(payload.RelatedTopics, results);
  return dedupeResults(results).slice(0, 10);
}

export function createDuckDuckGoSearchProvider({ fetchImpl = globalThis.fetch } = {}) {
  return {
    async search(query) {
      const trimmed = String(query || '').trim();
      if (!trimmed) return [];

      const url = new URL('https://api.duckduckgo.com/');
      url.searchParams.set('q', trimmed);
      url.searchParams.set('format', 'json');
      url.searchParams.set('no_html', '1');
      url.searchParams.set('skip_disambig', '1');

      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`DuckDuckGo search failed with HTTP ${response.status}`);
      return normalizeDuckDuckGoResults(await response.json());
    }
  };
}

export function createSearchProvider(name = process.env.SEARCH_PROVIDER || 'duckduckgo') {
  if (name !== 'duckduckgo') {
    console.warn(`SEARCH_PROVIDER=${name} not implemented yet; falling back to duckduckgo.`);
  }
  return createDuckDuckGoSearchProvider();
}

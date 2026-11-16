import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
}

interface WikiSearchResponse {
  query?: {
    search?: Array<{
      title?: string;
      snippet?: string;
      pageid?: number;
    }>;
  };
}

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export const openWebSearchTool = createTool({
  id: 'web_search',
  description: 'Search the web for factual reference summaries and URLs on a topic.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query string.'),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(
      z.object({
        title: z.string(),
        snippet: z.string(),
        url: z.string(),
      }),
    ),
  }),
  execute: async ({ query }, { abortSignal }) => {
    const cleanQuery = query.trim();
    const results: SearchResultItem[] = [];
    const seenUrls = new Set<string>();
    const headers = { 'User-Agent': 'MastraAgentStudio/1.0' };

    const [ddgRes, wikiRes] = await Promise.allSettled([
      fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`,
        { signal: abortSignal, headers },
      ).then(r => (r.ok ? (r.json() as Promise<DuckDuckGoResponse>) : null)),
      fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=1&format=json&srlimit=5`,
        { signal: abortSignal, headers },
      ).then(r => (r.ok ? (r.json() as Promise<WikiSearchResponse>) : null)),
    ]);

    if (ddgRes.status === 'fulfilled' && ddgRes.value) {
      const ddg = ddgRes.value;
      if (ddg.AbstractText && ddg.AbstractURL && !seenUrls.has(ddg.AbstractURL)) {
        seenUrls.add(ddg.AbstractURL);
        results.push({
          title: ddg.Heading || cleanQuery,
          snippet: ddg.AbstractText,
          url: ddg.AbstractURL,
        });
      }
      const stack = [...(ddg.RelatedTopics ?? [])];
      while (stack.length > 0 && results.length < 3) {
        const item = stack.shift();
        if (!item) continue;
        if (Array.isArray(item.Topics)) {
          stack.unshift(...item.Topics);
          continue;
        }
        if (item.Text && item.FirstURL && !seenUrls.has(item.FirstURL)) {
          seenUrls.add(item.FirstURL);
          results.push({
            title: item.Text.split(' - ')[0] || cleanQuery,
            snippet: item.Text,
            url: item.FirstURL,
          });
        }
      }
    }

    if (wikiRes.status === 'fulfilled' && wikiRes.value?.query?.search) {
      for (const hit of wikiRes.value.query.search) {
        if (results.length >= 6) break;
        const title = hit.title?.trim();
        if (!title) continue;
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        results.push({
          title,
          snippet: stripTags(hit.snippet ?? ''),
          url,
        });
      }
    }

    return {
      query: cleanQuery,
      results: results.slice(0, 6),
    };
  },
});

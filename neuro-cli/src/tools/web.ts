// ============================================================
// NeuroCLI - Web Tools
// Web search and fetch capabilities
// ============================================================

import { ToolExecutor, ToolContext } from './registry.js';
import { ToolDefinition } from '../core/types.js';

const MAX_FETCH_SIZE = 500 * 1024; // 500KB
const FETCH_TIMEOUT = 30000;

function truncateWebContent(content: string, maxLength: number = 30000): string {
  if (content.length <= maxLength) return content;
  const half = Math.floor(maxLength / 2);
  return content.slice(0, half) + '\n\n... [content truncated] ...\n\n' + content.slice(-half);
}

// ---- Web Search ----
const webSearchDef: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for information. Returns search results with titles, URLs, and descriptions.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum number of results (default: 10)' },
    },
    required: ['query'],
  },
};

export const webSearchTool: ToolExecutor = {
  name: 'web_search',
  definition: webSearchDef,
  risk: 'low',
  async execute(args) {
    const query = args.query as string;
    const maxResults = (args.max_results as number) || 10;

    try {
      // Use SearXNG or DuckDuckGo as search backend
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&max_results=${maxResults}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'NeuroCLI/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      const data = await response.json() as any;
      const results: string[] = [];

      if (data.Abstract) {
        results.push(`📖 Summary: ${data.Abstract}\nSource: ${data.AbstractURL || 'DuckDuckGo'}\n`);
      }

      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults)) {
          if (topic.Text && topic.FirstURL) {
            results.push(`🔗 ${topic.Text}\n   URL: ${topic.FirstURL}`);
          }
        }
      }

      if (results.length === 0) {
        // Fallback: try a different approach
        return `Search results for "${query}":\n\nNo structured results found. Try using web_fetch to access specific URLs directly.`;
      }

      return `Search results for "${query}":\n\n${results.join('\n\n')}`;
    } catch (error: any) {
      return `Search error: ${error.message}. Try using web_fetch with a specific URL instead.`;
    }
  },
};

// ---- Web Fetch ----
const webFetchDef: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch and extract text content from a web page URL. Returns the page text content.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' },
      raw: { type: 'boolean', description: 'Return raw HTML instead of text (default: false)' },
    },
    required: ['url'],
  },
};

export const webFetchTool: ToolExecutor = {
  name: 'web_fetch',
  definition: webFetchDef,
  risk: 'low',
  async execute(args) {
    const url = args.url as string;
    const raw = (args.raw as boolean) || false;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NeuroCLI/1.0)',
          'Accept': raw ? 'text/html' : 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!response.ok) {
        return `Error fetching ${url}: HTTP ${response.status} ${response.statusText}`;
      }

      let content = await response.text();

      if (content.length > MAX_FETCH_SIZE) {
        content = content.slice(0, MAX_FETCH_SIZE) + '\n\n... [content too large, truncated]';
      }

      if (!raw) {
        // Basic HTML to text conversion
        content = content
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      }

      return truncateWebContent(`Fetched: ${url}\n\n${content}`);
    } catch (error: any) {
      return `Error fetching ${url}: ${error.message}`;
    }
  },
};

// ---- Documentation Search ----
const docSearchDef: ToolDefinition = {
  name: 'doc_search',
  description: 'Search documentation for a specific library, framework, or API. Returns relevant documentation snippets.',
  parameters: {
    type: 'object',
    properties: {
      library: { type: 'string', description: 'Library or framework name (e.g., "react", "next.js", "python")' },
      query: { type: 'string', description: 'Specific question or topic to search for' },
    },
    required: ['library', 'query'],
  },
};

export const docSearchTool: ToolExecutor = {
  name: 'doc_search',
  definition: docSearchDef,
  risk: 'low',
  async execute(args) {
    const library = args.library as string;
    const query = args.query as string;
    const searchQuery = `${library} ${query} documentation`;

    // Delegate to web search with documentation-focused query
    return webSearchTool.execute({ query: searchQuery, max_results: 5 }, {} as ToolContext);
  },
};

export const webTools: ToolExecutor[] = [webSearchTool, webFetchTool, docSearchTool];

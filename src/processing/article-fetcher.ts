import { execSync } from 'node:child_process';
import * as cheerio from 'cheerio';

export interface FetchedArticle {
  title: string;
  byline: string;
  excerpt: string;
  textContent: string;
  source: 'readable' | 'archive' | 'cheerio' | 'failed';
}

const TIMEOUT_MS = 30000;
const READABLE_CMD = 'readable';

/** Fetch article content with three-tier fallback */
export async function fetchArticle(url: string): Promise<FetchedArticle> {
  // Tier 1: readable CLI on the original URL
  const tier1 = tryReadable(url);
  if (tier1 && tier1.textContent.length > 200) {
    return { ...tier1, source: 'readable' };
  }

  // Tier 2: readable CLI via archive.ph
  const archiveUrl = `https://archive.ph/newest/${url}`;
  const tier2 = tryReadable(archiveUrl);
  if (tier2 && tier2.textContent.length > 200) {
    return { ...tier2, source: 'archive' };
  }

  // Tier 3: basic fetch + cheerio extraction
  const tier3 = await tryCheerio(url);
  if (tier3 && tier3.textContent.length > 100) {
    return { ...tier3, source: 'cheerio' };
  }

  // All failed
  return {
    title: tier1?.title || tier2?.title || '',
    byline: '',
    excerpt: '',
    textContent: '',
    source: 'failed',
  };
}

function tryReadable(url: string): Omit<FetchedArticle, 'source'> | null {
  try {
    const result = execSync(
      `${READABLE_CMD} -p title excerpt byline text-content -q ${shellEscape(url)}`,
      { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    return parseReadableOutput(result);
  } catch {
    // readable returns exit 65 when it can't extract, or times out
    return null;
  }
}

function parseReadableOutput(output: string): Omit<FetchedArticle, 'source'> {
  // readable outputs properties separated by blank lines when using -p
  // Format: Title:\n<value>\n\nExcerpt:\n<value>\n\nByline:\n<value>\n\nText Content:\n<value>
  const sections: Record<string, string> = {};
  let currentKey = '';
  let currentValue: string[] = [];

  for (const line of output.split('\n')) {
    const headerMatch = line.match(/^(Title|Excerpt|Byline|Text Content):$/);
    if (headerMatch) {
      if (currentKey) {
        sections[currentKey] = currentValue.join('\n').trim();
      }
      currentKey = headerMatch[1];
      currentValue = [];
    } else {
      currentValue.push(line);
    }
  }
  if (currentKey) {
    sections[currentKey] = currentValue.join('\n').trim();
  }

  return {
    title: sections['Title'] || '',
    byline: sections['Byline'] || '',
    excerpt: sections['Excerpt'] || '',
    textContent: sections['Text Content'] || output.trim(),
  };
}

async function tryCheerio(url: string): Promise<Omit<FetchedArticle, 'source'> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ithildin/1.0)' },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove nav, footer, script, style, aside
    $('nav, footer, script, style, aside, header, .sidebar, .comments, .ad').remove();

    const title = $('title').text().trim() ||
                  $('h1').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content') || '';

    const byline = $('meta[name="author"]').attr('content') ||
                   $('[rel="author"]').first().text().trim() || '';

    const excerpt = $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="description"]').attr('content') || '';

    // Try article tag first, then main, then body
    const textContent = ($('article').text() || $('main').text() || $('body').text())
      .replace(/\s+/g, ' ')
      .trim();

    return { title, byline, excerpt, textContent };
  } catch {
    return null;
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

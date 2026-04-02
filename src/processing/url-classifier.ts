export type UrlClassification = 'article' | 'product' | 'event' | 'skip';

interface ClassificationContext {
  url: string;
  linkText: string;      // the markdown link text, if any
  surroundingText: string; // nearby text for tag detection
}

// Domains that should always be skipped
const SKIP_DOMAINS = [
  'docs.google.com', 'sheets.google.com', 'slides.google.com',
  'drive.google.com', 'github.com', 'gitlab.com',
  'youtube.com', 'youtu.be', 'vimeo.com',
];

// Domains that indicate events
const EVENT_DOMAINS = [
  'urbanaut.app', 'lu.ma', 'eventbrite.com', 'eventbrite.co.uk',
  'insider.in', 'bookmyshow.com', 'meetup.com', 'luma.com',
  'konfhub.com', 'townscript.com', 'allevents.in',
];

// Domains that indicate products/retailers
const PRODUCT_DOMAINS = [
  'amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com',
  'steelcase.com', 'in.steelcase.com', 'ikea.com', 'ikea.in',
  'apple.com/shop', 'store.google.com',
  'croma.com', 'vijaysales.com', 'reliancedigital.in',
];

// URL path patterns that indicate products
const PRODUCT_PATH_PATTERNS = [
  /\/products?\//i, /\/shop\//i, /\/buy\//i,
  /\/dp\//i, /\/p\//i, /\/item\//i,
];

// Patterns that indicate an app/digital product
const APP_PATTERNS = [
  /testflight\.apple\.com/i,
  /apps\.apple\.com/i,
  /play\.google\.com\/store/i,
];

// Tags near a URL that indicate a product
const PRODUCT_TAGS = ['#to-buy', '#considering'];
const PRODUCT_PHRASES = ['want to buy', 'looking at', 'thinking about buying'];

// File extensions to skip
const SKIP_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.pdf', '.mp3', '.mp4', '.mov', '.zip',
];

export function classifyUrl(ctx: ClassificationContext): UrlClassification {
  const { url, surroundingText } = ctx;

  let hostname: string;
  let pathname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.replace(/^www\./, '');
    pathname = parsed.pathname;
  } catch {
    return 'skip';
  }

  // Check file extensions
  if (SKIP_EXTENSIONS.some(ext => pathname.toLowerCase().endsWith(ext))) {
    return 'skip';
  }

  // Check skip domains
  if (SKIP_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
    return 'skip';
  }

  // Check product tags/phrases in surrounding text
  const lower = surroundingText.toLowerCase();
  if (PRODUCT_TAGS.some(t => lower.includes(t)) || PRODUCT_PHRASES.some(p => lower.includes(p))) {
    return 'product';
  }

  // Check product domains
  if (PRODUCT_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d) || `${hostname}${pathname}`.startsWith(d))) {
    return 'product';
  }

  // Check product path patterns
  if (PRODUCT_PATH_PATTERNS.some(p => p.test(pathname))) {
    return 'product';
  }

  // Check app/digital product patterns
  if (APP_PATTERNS.some(p => p.test(url))) {
    return 'product';
  }

  // Check event domains
  if (EVENT_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
    return 'event';
  }

  // Default to article
  return 'article';
}

/** Extract all URLs from markdown text, with their link text and surrounding context */
export function extractUrls(text: string): ClassificationContext[] {
  const results: ClassificationContext[] = [];
  const seen = new Set<string>();

  // Match markdown links: [text](url)
  const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(mdLinkRegex)) {
    const url = match[2];
    if (seen.has(url)) continue;
    seen.add(url);

    const idx = match.index || 0;
    const surrounding = text.slice(Math.max(0, idx - 100), idx + match[0].length + 100);

    results.push({ url, linkText: match[1], surroundingText: surrounding });
  }

  // Match bare URLs not already captured
  const bareUrlRegex = /(?<!\()https?:\/\/[^\s)\]]+/g;
  for (const match of text.matchAll(bareUrlRegex)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);

    const idx = match.index || 0;
    const surrounding = text.slice(Math.max(0, idx - 100), idx + url.length + 100);

    results.push({ url, linkText: '', surroundingText: surrounding });
  }

  return results;
}

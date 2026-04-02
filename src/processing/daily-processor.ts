import { VaultReader } from './vault-reader.js';
import { ClaudeClient } from './claude-client.js';
import { classifyUrl, extractUrls } from './url-classifier.js';
import { fetchArticle } from './article-fetcher.js';
import {
  DAILY_PROCESSING_PROMPT,
  LITERATURE_NOTE_PROMPT,
  PRODUCT_NOTE_PROMPT,
  EVENT_NOTE_PROMPT,
} from './prompts/system-prompt.js';
import { DateTime } from 'luxon';
import matter from 'gray-matter';

export interface DailyProcessingResult {
  processed: boolean;
  skipped: boolean;
  skipReason?: string;
  notesCreated: number;
  tokensUsed: number;
  errors: string[];
}

export async function processDailyNote(
  vault: VaultReader,
  claude: ClaudeClient,
  date?: string,
): Promise<DailyProcessingResult> {
  const result: DailyProcessingResult = {
    processed: false, skipped: false, notesCreated: 0, tokensUsed: 0, errors: [],
  };

  // 1. Read today's daily note
  const daily = vault.readDailyNote(date);
  if (!daily) {
    result.skipped = true;
    result.skipReason = 'No daily note found';
    return result;
  }

  // 2. Check if already processed
  if (daily.frontmatter.processed === true) {
    result.skipped = true;
    result.skipReason = 'Already processed';
    return result;
  }

  // 3. Check if empty (only frontmatter + heading)
  const bodyTrimmed = daily.body.replace(/^#.*\n?/, '').trim();
  if (!bodyTrimmed) {
    result.skipped = true;
    result.skipReason = 'Empty daily note';
    return result;
  }

  // 4. Gather vault context
  const tags = vault.tags().slice(0, 50);
  const files = vault.listFiles();
  const fileNames = files.map(f => f.replace(/\.md$/, '')).join('\n');
  const tagList = tags.map(t => `${t.tag} (${t.count})`).join('\n');

  // Search for keywords from the daily note to find related notes
  const keywords = extractKeywords(bodyTrimmed);
  const relatedNotes: string[] = [];
  for (const kw of keywords.slice(0, 10)) {
    const matches = vault.search(kw);
    for (const m of matches.slice(0, 3)) {
      if (!relatedNotes.includes(m) && m !== daily.path) {
        relatedNotes.push(m);
      }
    }
  }

  // Read a few related notes for context
  const relatedContent: string[] = [];
  for (const notePath of relatedNotes.slice(0, 8)) {
    const note = vault.readNoteByPath(`${vault['vaultPath']}/${notePath}`);
    if (note) {
      relatedContent.push(`### ${note.name}\n${note.body.slice(0, 500)}`);
    }
  }

  const vaultContext = [
    `## Files in vault (${files.length} total)\n${fileNames}`,
    `## Tags\n${tagList}`,
    relatedContent.length > 0 ? `## Related notes\n${relatedContent.join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');

  // 5. Call Claude to process the daily note
  let claudeResult;
  try {
    claudeResult = await claude.processDailyNote({
      systemPrompt: DAILY_PROCESSING_PROMPT,
      dailyNote: daily.content,
      vaultContext,
    });
    result.tokensUsed += claudeResult.tokensUsed;
  } catch (err) {
    result.errors.push(`Claude API error: ${err}`);
    return result;
  }

  // 6. Parse Claude's response
  let parsed: {
    processedSection: string;
    urlClassifications: Array<{ url: string; classification: string; suggestedTitle: string }>;
    fleetingNotes: Array<{ title: string; content: string }>;
  };

  try {
    // Try to extract JSON from the response (may be wrapped in markdown code blocks)
    const jsonStr = claudeResult.content
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    // If JSON parsing fails, treat the whole response as the processed section
    parsed = {
      processedSection: claudeResult.content,
      urlClassifications: [],
      fleetingNotes: [],
    };
  }

  // 7. Write the processed daily note
  const now = DateTime.now().toISO();
  const dailyPath = vault.dailyNotePath(date);
  const newContent = daily.content + '\n\n---\n\n' + parsed.processedSection;

  // Update frontmatter
  const frontmatterUpdate = { ...daily.frontmatter, processed: true };
  const finalContent = matter.stringify(
    newContent.replace(/^---[\s\S]*?---\n?/, ''), // strip old frontmatter
    frontmatterUpdate,
  );
  vault.writeFile(daily.path, finalContent);

  // 8. Process URLs
  const urls = extractUrls(bodyTrimmed);
  for (const urlCtx of urls) {
    const classification = classifyUrl(urlCtx);

    if (classification === 'skip') continue;

    try {
      if (classification === 'article') {
        const article = await fetchArticle(urlCtx.url);
        if (article.textContent) {
          const noteResult = await claude.generateLiteratureNote({
            systemPrompt: LITERATURE_NOTE_PROMPT,
            url: urlCtx.url,
            articleContent: `Title: ${article.title}\nByline: ${article.byline}\n\n${article.textContent}`,
            vaultTags: tagList,
          });
          result.tokensUsed += noteResult.tokensUsed;

          const title = article.byline
            ? `@ ${article.byline} - ${article.title}`
            : `@ ${article.title}`;
          const safeName = title.replace(/[/\\:*?"<>|]/g, '-');
          vault.createNote(safeName, '50 Resources', noteResult.content);
          result.notesCreated++;
        }
      } else if (classification === 'product') {
        const page = await fetchArticle(urlCtx.url);
        const noteResult = await claude.generateProductNote({
          systemPrompt: PRODUCT_NOTE_PROMPT,
          url: urlCtx.url,
          pageContent: `Title: ${page.title}\n\n${page.textContent}`,
          vaultTags: tagList,
        });
        result.tokensUsed += noteResult.tokensUsed;

        // Extract product name from the generated content
        const nameMatch = noteResult.content.match(/^# (.+)$/m);
        const productName = nameMatch?.[1] || page.title || 'Unknown Product';
        const safeName = productName.replace(/[/\\:*?"<>|]/g, '-');
        vault.createNote(safeName, '50 Resources', noteResult.content);
        result.notesCreated++;
      } else if (classification === 'event') {
        const page = await fetchArticle(urlCtx.url);
        const noteResult = await claude.generateEventNote({
          systemPrompt: EVENT_NOTE_PROMPT,
          url: urlCtx.url,
          pageContent: `Title: ${page.title}\n\n${page.textContent || urlCtx.linkText}`,
        });
        result.tokensUsed += noteResult.tokensUsed;

        const nameMatch = noteResult.content.match(/^# (.+)$/m);
        const eventName = nameMatch?.[1] || 'Event';
        const safeName = eventName.replace(/[/\\:*?"<>|]/g, '-');
        vault.createNote(safeName, '00 Inbox', noteResult.content);
        result.notesCreated++;
      }
    } catch (err) {
      result.errors.push(`Error processing URL ${urlCtx.url}: ${err}`);
    }
  }

  // 9. Write fleeting notes
  for (const note of parsed.fleetingNotes || []) {
    try {
      const safeName = note.title.replace(/[/\\:*?"<>|]/g, '-');
      vault.createNote(safeName, '00 Inbox', note.content);
      result.notesCreated++;
    } catch (err) {
      result.errors.push(`Error creating fleeting note "${note.title}": ${err}`);
    }
  }

  result.processed = true;
  return result;
}

/** Extract plausible search keywords from note text */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // Extract [[wikilinks]]
  const wikilinks = text.matchAll(/\[\[([^\]|#]+)/g);
  for (const m of wikilinks) keywords.push(m[1]);

  // Extract #tags
  const tags = text.matchAll(/#[a-zA-Z][a-zA-Z0-9_/-]*/g);
  for (const m of tags) keywords.push(m[0]);

  // Extract capitalised phrases (likely names or proper nouns)
  const names = text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
  for (const m of names) keywords.push(m[1]);

  return [...new Set(keywords)];
}

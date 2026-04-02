import { VaultReader } from './vault-reader.js';
import { ClaudeClient } from './claude-client.js';
import { DIGEST_PROMPT } from './prompts/system-prompt.js';
import { DateTime } from 'luxon';

export interface DigestResult {
  generated: boolean;
  tokensUsed: number;
  errors: string[];
}

export async function generateDigest(
  vault: VaultReader,
  claude: ClaudeClient,
  date?: string,
): Promise<DigestResult> {
  const result: DigestResult = { generated: false, tokensUsed: 0, errors: [] };

  const today = date || DateTime.now().toFormat('yyyy-MM-dd');
  const yesterday = DateTime.fromFormat(today, 'yyyy-MM-dd').minus({ days: 1 }).toFormat('yyyy-MM-dd');
  const twoDaysAgo = DateTime.fromFormat(today, 'yyyy-MM-dd').minus({ days: 2 }).toFormat('yyyy-MM-dd');

  // 1. Gather comprehensive vault context

  // Daily notes
  const todayNote = vault.readDailyNote(today);
  const yesterdayNote = vault.readDailyNote(yesterday);
  const twoDaysAgoNote = vault.readDailyNote(twoDaysAgo);

  // Inbox
  const inboxFiles = vault.listFiles('00 Inbox');
  const inboxContents: string[] = [];
  for (const f of inboxFiles) {
    const note = vault.readNoteByPath(`${vault['vaultPath']}/${f}`);
    if (note) {
      inboxContents.push(`### ${note.name}\n${note.content.slice(0, 1000)}`);
    }
  }

  // Tags and files
  const tags = vault.tags().slice(0, 50);
  const allFiles = vault.listFiles();

  // Seed and growing notes
  const seedNotes = vault.searchByFrontmatter('status', 'seed');
  const growingNotes = vault.searchByFrontmatter('status', 'growing');

  // Actually search by tag since status is often in tags not frontmatter
  const seedFiles = vault.search('#status/seed');
  const growingFiles = vault.search('#status/growing');

  // Orphans and unresolved
  const orphans = vault.orphans();
  const unresolved = vault.unresolved();

  // Previous Claude outputs (last 3 days)
  const recentDigests: string[] = [];
  const recentConnections: string[] = [];
  const recentGaps: string[] = [];

  for (const daysBack of [1, 2, 3]) {
    const d = DateTime.fromFormat(today, 'yyyy-MM-dd').minus({ days: daysBack }).toFormat('yyyy-MM-dd');
    const digest = vault.readNote(`Claude Digest ${d}`);
    if (digest) recentDigests.push(digest.content.slice(0, 1500));
    const conn = vault.readNote(`Connections ${d}`);
    if (conn) recentConnections.push(conn.content.slice(0, 1500));
    const gaps = vault.readNote(`Gaps ${d}`);
    if (gaps) recentGaps.push(gaps.content.slice(0, 1500));
  }

  // 2. Build the context string
  const vaultContext = [
    `# Vault Context for ${today}`,
    '',
    `## Today's Daily Note (${today})`,
    todayNote ? todayNote.content : '(empty or not yet created)',
    '',
    `## Yesterday's Daily Note (${yesterday})`,
    yesterdayNote ? yesterdayNote.content : '(empty)',
    '',
    twoDaysAgoNote ? `## Two Days Ago (${twoDaysAgo})\n${twoDaysAgoNote.content.slice(0, 1000)}` : '',
    '',
    `## Inbox (${inboxFiles.length} items)`,
    inboxContents.join('\n\n') || '(empty)',
    '',
    `## Tags (top 50)`,
    tags.map(t => `${t.tag}: ${t.count}`).join('\n'),
    '',
    `## All Files (${allFiles.length} total)`,
    allFiles.join('\n'),
    '',
    seedFiles.length > 0 ? `## Seed Notes\n${seedFiles.join('\n')}` : '',
    growingFiles.length > 0 ? `## Growing Notes\n${growingFiles.join('\n')}` : '',
    '',
    `## Orphan Notes (${orphans.length})`,
    orphans.slice(0, 20).join('\n'),
    '',
    `## Unresolved Wikilinks (${unresolved.length})`,
    unresolved.slice(0, 30).join('\n'),
    '',
    recentDigests.length > 0 ? `## Previous Digests (avoid repeating)\n${recentDigests.join('\n---\n')}` : '',
    recentConnections.length > 0 ? `## Previous Connections (avoid repeating)\n${recentConnections.join('\n---\n')}` : '',
    recentGaps.length > 0 ? `## Previous Gaps (avoid repeating)\n${recentGaps.join('\n---\n')}` : '',
  ].filter(Boolean).join('\n');

  // 3. Call Claude
  let claudeResult;
  try {
    claudeResult = await claude.generateDigest({
      systemPrompt: DIGEST_PROMPT,
      vaultContext,
    });
    result.tokensUsed += claudeResult.tokensUsed;
  } catch (err) {
    result.errors.push(`Claude API error: ${err}`);
    return result;
  }

  // 4. Parse response
  let parsed: { digest: string; connections: string; gaps: string };
  try {
    const jsonStr = claudeResult.content
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    result.errors.push('Failed to parse Claude digest response as JSON');
    // Try to use the raw content as a single digest
    vault.createNote(`Claude Digest ${today}`, '80 Claude/Digests', claudeResult.content);
    result.generated = true;
    return result;
  }

  // 5. Write the three files
  if (parsed.digest) {
    vault.createNote(`Claude Digest ${today}`, '80 Claude/Digests', parsed.digest);
  }
  if (parsed.connections) {
    vault.createNote(`Connections ${today}`, '80 Claude/Connections', parsed.connections);
  }
  if (parsed.gaps) {
    vault.createNote(`Gaps ${today}`, '80 Claude/Gaps', parsed.gaps);
  }

  result.generated = true;
  return result;
}

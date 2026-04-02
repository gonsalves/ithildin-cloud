import { VaultReader } from '../processing/vault-reader.js';
import { ClaudeClient } from '../processing/claude-client.js';
import { processDailyNote } from '../processing/daily-processor.js';
import { generateDigest } from '../processing/digest-generator.js';

export interface RunResult {
  dailyProcessing: {
    processed: boolean;
    skipped: boolean;
    skipReason?: string;
    notesCreated: number;
  };
  digest: {
    generated: boolean;
  };
  totalTokensUsed: number;
  errors: string[];
}

/** Run the full processing pipeline for a single user */
export async function runProcessing(opts: {
  vaultPath: string;
  anthropicApiKey: string;
  date?: string;
}): Promise<RunResult> {
  const vault = new VaultReader(opts.vaultPath);
  const claude = new ClaudeClient(opts.anthropicApiKey);
  const errors: string[] = [];
  let totalTokens = 0;

  // Ensure folder structure exists
  vault.ensureFolderStructure();

  // Part 1: Process daily note
  console.log('[run] Processing daily note...');
  const dailyResult = await processDailyNote(vault, claude, opts.date);
  totalTokens += dailyResult.tokensUsed;
  errors.push(...dailyResult.errors);

  if (dailyResult.processed) {
    console.log(`[run] Daily note processed. ${dailyResult.notesCreated} notes created. ${dailyResult.tokensUsed} tokens.`);
  } else if (dailyResult.skipped) {
    console.log(`[run] Daily note skipped: ${dailyResult.skipReason}`);
  }

  // Part 2: Generate digest
  console.log('[run] Generating digest...');
  const digestResult = await generateDigest(vault, claude, opts.date);
  totalTokens += digestResult.tokensUsed;
  errors.push(...digestResult.errors);

  if (digestResult.generated) {
    console.log(`[run] Digest generated. ${digestResult.tokensUsed} tokens.`);
  }

  if (errors.length > 0) {
    console.log(`[run] Errors: ${errors.join('; ')}`);
  }

  console.log(`[run] Total tokens used: ${totalTokens}`);

  return {
    dailyProcessing: {
      processed: dailyResult.processed,
      skipped: dailyResult.skipped,
      skipReason: dailyResult.skipReason,
      notesCreated: dailyResult.notesCreated,
    },
    digest: {
      generated: digestResult.generated,
    },
    totalTokensUsed: totalTokens,
    errors,
  };
}

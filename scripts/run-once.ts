/**
 * Manual trigger for testing the processing pipeline.
 *
 * Usage:
 *   npx tsx scripts/run-once.ts [vault-path] [date]
 *
 * Requires ANTHROPIC_API_KEY env var.
 */

import 'dotenv/config';
import { runProcessing } from '../src/worker/run-processing.js';

const vaultPath = process.argv[2] || `${process.env.HOME}/Obsidian/Exocortex/Exocortex`;
const date = process.argv[3]; // optional, defaults to today
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY env var is required');
  process.exit(1);
}

console.log(`Running processing pipeline on: ${vaultPath}`);
if (date) console.log(`Date: ${date}`);
console.log('');

const result = await runProcessing({ vaultPath, anthropicApiKey: apiKey, date });

console.log('\n=== Results ===');
console.log(JSON.stringify(result, null, 2));

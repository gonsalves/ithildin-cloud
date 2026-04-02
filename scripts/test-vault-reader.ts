import { VaultReader } from '../src/processing/vault-reader.js';

const VAULT = process.argv[2] || `${process.env.HOME}/Obsidian/Exocortex/Exocortex`;

console.log(`Testing VaultReader against: ${VAULT}\n`);
const vr = new VaultReader(VAULT);

// 1. Read daily note
console.log('--- readDailyNote("2026-04-02") ---');
const daily = vr.readDailyNote('2026-04-02');
if (daily) {
  console.log(`  path: ${daily.path}`);
  console.log(`  frontmatter.type: ${daily.frontmatter.type}`);
  console.log(`  frontmatter.processed: ${daily.frontmatter.processed}`);
  console.log(`  body length: ${daily.body.length} chars`);
} else {
  console.log('  NOT FOUND');
}

// 2. Search
console.log('\n--- search("PhonePe") ---');
const results = vr.search('PhonePe');
console.log(`  ${results.length} files match`);
results.slice(0, 5).forEach(r => console.log(`  - ${r}`));

// 3. Tags
console.log('\n--- tags() (top 10) ---');
const tags = vr.tags();
tags.slice(0, 10).forEach(t => console.log(`  ${t.tag}: ${t.count}`));

// 4. List files
console.log('\n--- listFiles() ---');
const files = vr.listFiles();
console.log(`  ${files.length} total files`);

// 5. List files in folder
console.log('\n--- listFiles("00 Inbox") ---');
const inbox = vr.listFiles('00 Inbox');
inbox.forEach(f => console.log(`  - ${f}`));

// 6. Backlinks
console.log('\n--- backlinks("Note on our IPO") ---');
const bl = vr.backlinks('Note on our IPO');
bl.forEach(f => console.log(`  - ${f}`));

// 7. Links
console.log('\n--- links("10 Daily/2026-04-01.md") ---');
const links = vr.links('10 Daily/2026-04-01.md');
links.forEach(l => console.log(`  - [[${l}]]`));

// 8. Unresolved
console.log('\n--- unresolved() (first 10) ---');
const unresolved = vr.unresolved();
unresolved.slice(0, 10).forEach(u => console.log(`  - [[${u}]]`));

// 9. Orphans
console.log('\n--- orphans() (first 10) ---');
const orphans = vr.orphans();
console.log(`  ${orphans.length} orphan notes`);
orphans.slice(0, 10).forEach(o => console.log(`  - ${o}`));

// 10. Search by frontmatter
console.log('\n--- searchByFrontmatter("type", "product") ---');
const products = vr.searchByFrontmatter('type', 'product');
products.forEach(p => console.log(`  - ${p.name} (${p.frontmatter.status})`));

// 11. Read note by name
console.log('\n--- readNote("@ Linecook") ---');
const linecook = vr.readNote('@ Linecook');
if (linecook) {
  console.log(`  path: ${linecook.path}`);
  console.log(`  type: ${linecook.frontmatter.type}`);
} else {
  console.log('  NOT FOUND');
}

console.log('\nAll tests passed.');

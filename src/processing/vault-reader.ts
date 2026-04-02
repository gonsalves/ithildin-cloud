import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { DateTime } from 'luxon';

export interface VaultNote {
  path: string;        // relative to vault root
  name: string;        // filename without .md
  content: string;     // full file content
  frontmatter: Record<string, unknown>;
  body: string;        // content below frontmatter
}

export interface TagCount {
  tag: string;
  count: number;
}

export class VaultReader {
  constructor(private vaultPath: string) {
    if (!fs.existsSync(vaultPath)) {
      throw new Error(`Vault path does not exist: ${vaultPath}`);
    }
  }

  // --- Read operations ---

  /** Read today's daily note */
  readDailyNote(date?: string): VaultNote | null {
    const d = date || DateTime.now().toFormat('yyyy-MM-dd');
    const filePath = path.join(this.vaultPath, '10 Daily', `${d}.md`);
    return this.readNoteByPath(filePath);
  }

  /** Get the filesystem path for today's daily note */
  dailyNotePath(date?: string): string {
    const d = date || DateTime.now().toFormat('yyyy-MM-dd');
    return path.join(this.vaultPath, '10 Daily', `${d}.md`);
  }

  /** Read a note by its display name (searches recursively) */
  readNote(name: string): VaultNote | null {
    // Try exact match first
    const exact = this.findFile(`${name}.md`);
    if (exact) return this.readNoteByPath(exact);

    // Try with common prefixes
    for (const prefix of ['@ ', '']) {
      const f = this.findFile(`${prefix}${name}.md`);
      if (f) return this.readNoteByPath(f);
    }

    return null;
  }

  /** Read a note by its full filesystem path */
  readNoteByPath(absPath: string): VaultNote | null {
    if (!fs.existsSync(absPath)) return null;

    const content = fs.readFileSync(absPath, 'utf8');
    const rel = path.relative(this.vaultPath, absPath);

    let frontmatter: Record<string, unknown> = {};
    let body = content;

    try {
      const parsed = matter(content);
      frontmatter = parsed.data as Record<string, unknown>;
      body = parsed.content;
    } catch {
      // Template files or malformed frontmatter — treat as plain content
    }

    return {
      path: rel,
      name: path.basename(absPath, '.md'),
      content,
      frontmatter,
      body,
    };
  }

  // --- Search operations ---

  /** Full-text search across all markdown files. Returns relative paths. */
  search(query: string): string[] {
    try {
      const result = execSync(
        `grep -rl ${this.shellEscape(query)} --include="*.md" .`,
        { cwd: this.vaultPath, encoding: 'utf8', timeout: 10000 }
      );
      return result.trim().split('\n').filter(Boolean).map(p => p.replace(/^\.\//, ''));
    } catch {
      return []; // grep returns exit 1 when no matches
    }
  }

  /** Find all backlinks to a note (files that contain [[NoteName]]) */
  backlinks(noteName: string): string[] {
    return this.search(`\\[\\[${noteName}`);
  }

  /** Find all outgoing wikilinks in a note */
  links(notePath: string): string[] {
    const note = this.readNoteByPath(path.join(this.vaultPath, notePath));
    if (!note) return [];

    const matches = note.content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g);
    return [...new Set([...matches].map(m => m[1]))];
  }

  // --- List operations ---

  /** List all markdown files in the vault. Returns relative paths. */
  listFiles(folder?: string): string[] {
    const dir = folder ? path.join(this.vaultPath, folder) : this.vaultPath;
    if (!fs.existsSync(dir)) return [];

    try {
      const result = execSync(
        `find . -name "*.md" -not -path "./.obsidian/*" -not -path "./node_modules/*"`,
        { cwd: dir, encoding: 'utf8', timeout: 10000 }
      );
      return result.trim().split('\n').filter(Boolean).map(p => {
        const rel = p.replace(/^\.\//, '');
        return folder ? path.join(folder, rel) : rel;
      });
    } catch {
      return [];
    }
  }

  /** List all folders in the vault */
  listFolders(): string[] {
    try {
      const result = execSync(
        `find . -type d -not -path "./.obsidian/*" -not -path "./node_modules/*"`,
        { cwd: this.vaultPath, encoding: 'utf8', timeout: 10000 }
      );
      return result.trim().split('\n').filter(Boolean).map(p => p.replace(/^\.\//, '')).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Get all tags with counts, sorted by frequency */
  tags(): TagCount[] {
    try {
      const result = execSync(
        `grep -roh '#[a-zA-Z][a-zA-Z0-9_/\\-]*' --include="*.md" .`,
        { cwd: this.vaultPath, encoding: 'utf8', timeout: 15000 }
      );

      const counts = new Map<string, number>();
      for (const tag of result.trim().split('\n').filter(Boolean)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }

      return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
    } catch {
      return [];
    }
  }

  /** Find orphan notes (no incoming or outgoing links) */
  orphans(): string[] {
    const allFiles = this.listFiles();
    const allNames = new Set(allFiles.map(f => path.basename(f, '.md')));

    // Collect all wikilink targets
    const linked = new Set<string>();
    for (const file of allFiles) {
      const note = this.readNoteByPath(path.join(this.vaultPath, file));
      if (!note) continue;
      const matches = note.content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g);
      for (const m of matches) {
        linked.add(m[1]);
      }
    }

    // Collect files that link to something
    const linkers = new Set<string>();
    for (const file of allFiles) {
      const note = this.readNoteByPath(path.join(this.vaultPath, file));
      if (!note) continue;
      if (/\[\[.+?\]\]/.test(note.content)) {
        linkers.add(path.basename(file, '.md'));
      }
    }

    // Orphan = not linked to AND doesn't link out
    return allFiles.filter(f => {
      const name = path.basename(f, '.md');
      return !linked.has(name) && !linkers.has(name);
    });
  }

  /** Find unresolved wikilinks (targets that don't match any file) */
  unresolved(): string[] {
    const allFiles = this.listFiles();
    const allNames = new Set(allFiles.map(f => path.basename(f, '.md')));

    const unresolvedSet = new Set<string>();
    for (const file of allFiles) {
      const note = this.readNoteByPath(path.join(this.vaultPath, file));
      if (!note) continue;
      const matches = note.content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g);
      for (const m of matches) {
        if (!allNames.has(m[1])) {
          unresolvedSet.add(m[1]);
        }
      }
    }

    return [...unresolvedSet].sort();
  }

  /** Search for notes by frontmatter field value */
  searchByFrontmatter(field: string, value: string): VaultNote[] {
    const allFiles = this.listFiles();
    const results: VaultNote[] = [];

    for (const file of allFiles) {
      const note = this.readNoteByPath(path.join(this.vaultPath, file));
      if (!note) continue;
      if (String(note.frontmatter[field]) === value) {
        results.push(note);
      }
    }

    return results;
  }

  // --- Write operations ---

  /** Create a new note */
  createNote(name: string, folder: string, content: string): string {
    const dir = path.join(this.vaultPath, folder);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${name}.md`);
    fs.writeFileSync(filePath, content, 'utf8');

    return path.relative(this.vaultPath, filePath);
  }

  /** Append content to an existing note */
  appendToNote(name: string, content: string): boolean {
    const filePath = this.findFile(`${name}.md`);
    if (!filePath) return false;

    fs.appendFileSync(filePath, content, 'utf8');
    return true;
  }

  /** Write complete content to a file path */
  writeFile(relPath: string, content: string): void {
    const absPath = path.join(this.vaultPath, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }

  /** Update a frontmatter property on a note */
  setProperty(relPath: string, key: string, value: unknown): boolean {
    const absPath = path.join(this.vaultPath, relPath);
    if (!fs.existsSync(absPath)) return false;

    const content = fs.readFileSync(absPath, 'utf8');
    const parsed = matter(content);
    parsed.data[key] = value;
    const updated = matter.stringify(parsed.content, parsed.data);

    fs.writeFileSync(absPath, updated, 'utf8');
    return true;
  }

  // --- Helpers ---

  /** Find a file by name recursively in the vault */
  private findFile(filename: string): string | null {
    try {
      const result = execSync(
        `find . -name ${this.shellEscape(filename)} -not -path "./.obsidian/*" | head -1`,
        { cwd: this.vaultPath, encoding: 'utf8', timeout: 5000 }
      );
      const match = result.trim();
      return match ? path.join(this.vaultPath, match.replace(/^\.\//, '')) : null;
    } catch {
      return null;
    }
  }

  /** Escape a string for shell use */
  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }

  /** Ensure the standard Ithildin folder structure exists */
  ensureFolderStructure(): void {
    const folders = [
      '00 Inbox', '10 Daily', '20 Notes', '30 Projects', '40 Areas',
      '50 Resources', '60 Writing', '70 Reviews',
      '80 Claude', '80 Claude/Digests', '80 Claude/Connections', '80 Claude/Gaps',
      '90 Archive', 'Templates',
      'Attachments', 'Attachments/images', 'Attachments/pdfs',
      'Attachments/audio', 'Attachments/misc',
    ];

    for (const folder of folders) {
      fs.mkdirSync(path.join(this.vaultPath, folder), { recursive: true });
    }
  }
}

// ============================================================
// NeuroCLI - Repository Map
// Semantic codebase context (like Aider's repo map)
// Builds a structural map of identifiers for large codebases
// ============================================================

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, extname, relative } from 'path';

export interface RepoMapEntry {
  file: string;
  language: string;
  definitions: string[];
  references: string[];
  lineCount: number;
}

export interface RepoMap {
  entries: RepoMapEntry[];
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  summary: string;
}

export class RepositoryMapper {
  private workingDirectory: string;
  private cached: RepoMap | null = null;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  /**
   * Build a repository map
   */
  build(maxFiles: number = 200): RepoMap {
    if (this.cached) return this.cached;

    const entries: RepoMapEntry[] = [];
    const languages: Record<string, number> = {};
    let totalLines = 0;

    // Get list of source files using ripgrep or git
    const sourceFiles = this.getSourceFiles(maxFiles);

    for (const file of sourceFiles) {
      try {
        const entry = this.mapFile(file);
        if (entry) {
          entries.push(entry);
          totalLines += entry.lineCount;
          languages[entry.language] = (languages[entry.language] || 0) + 1;
        }
      } catch {}
    }

    const summary = this.buildSummary(entries, languages, totalLines);

    this.cached = {
      entries,
      totalFiles: entries.length,
      totalLines,
      languages,
      summary,
    };

    return this.cached;
  }

  /**
   * Get the repo map as a compact string for LLM context
   */
  getContextString(maxEntries: number = 100): string {
    const map = this.build();

    const lines: string[] = [];
    lines.push(`Repository Map: ${map.totalFiles} files, ${map.totalLines} lines`);
    lines.push(`Languages: ${Object.entries(map.languages).map(([l, c]) => `${l}(${c})`).join(', ')}`);
    lines.push('');

    const entries = map.entries.slice(0, maxEntries);
    for (const entry of entries) {
      const relPath = relative(this.workingDirectory, entry.file);
      const defs = entry.definitions.slice(0, 10).join(', ');
      lines.push(`${relPath} (${entry.language}, ${entry.lineCount} lines)${defs ? `: ${defs}` : ''}`);
    }

    if (map.entries.length > maxEntries) {
      lines.push(`... and ${map.entries.length - maxEntries} more files`);
    }

    return lines.join('\n');
  }

  /**
   * Invalidate cache
   */
  invalidate(): void {
    this.cached = null;
  }

  // ---- Private Methods ----

  private getSourceFiles(maxFiles: number): string[] {
    const extensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.pyx', '.pyi',
      '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
      '.rb', '.php', '.cs', '.scala', '.clj',
      '.sh', '.bash', '.zsh',
      '.sql', '.graphql', '.prisma',
      '.html', '.css', '.scss', '.less', '.vue', '.svelte',
      '.yaml', '.yml', '.toml', '.json', '.json5',
      '.md', '.txt',
    ]);

    try {
      // Use ripgrep for fast file discovery
      const result = execSync(
        `rg --files --max-count ${maxFiles} --color never "${this.workingDirectory}"`,
        { encoding: 'utf-8', timeout: 10000, cwd: this.workingDirectory }
      );

      return result.trim().split('\n').filter(f => {
        const ext = extname(f);
        return extensions.has(ext);
      }).slice(0, maxFiles);
    } catch {
      // Fallback: use git ls-files
      try {
        const result = execSync('git ls-files', {
          encoding: 'utf-8',
          cwd: this.workingDirectory,
          timeout: 10000,
        });
        return result.trim().split('\n')
          .filter(f => extensions.has(extname(f)))
          .map(f => join(this.workingDirectory, f))
          .slice(0, maxFiles);
      } catch {
        return [];
      }
    }
  }

  private mapFile(filePath: string): RepoMapEntry | null {
    if (!existsSync(filePath)) return null;

    const ext = extname(filePath);
    const language = this.getLanguage(ext);
    const content = readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').length;

    // Extract definitions based on language
    const definitions = this.extractDefinitions(content, language);
    const references = this.extractReferences(content, language);

    return {
      file: filePath,
      language,
      definitions,
      references,
      lineCount,
    };
  }

  private extractDefinitions(content: string, language: string): string[] {
    const defs: string[] = [];
    const maxDefs = 15;

    const patterns: Record<string, RegExp[]> = {
      'TypeScript': [
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/gm,
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/gm,
        /^(?:export\s+)?interface\s+(\w+)/gm,
        /^(?:export\s+)?type\s+(\w+)\s*=/gm,
        /^(?:export\s+)?enum\s+(\w+)/gm,
      ],
      'Python': [
        /^(?:async\s+)?def\s+(\w+)/gm,
        /^class\s+(\w+)/gm,
        /^(\w+)\s*=\s*/gm,
      ],
      'Rust': [
        /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
        /^(?:pub\s+)?struct\s+(\w+)/gm,
        /^(?:pub\s+)?enum\s+(\w+)/gm,
        /^(?:pub\s+)?trait\s+(\w+)/gm,
        /^(?:pub\s+)?impl\s+(\w+)/gm,
      ],
      'Go': [
        /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/gm,
        /^type\s+(\w+)\s+struct/gm,
        /^type\s+(\w+)\s+interface/gm,
        /^var\s+(\w+)\s*=/gm,
      ],
      'Java': [
        /^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
        /^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?interface\s+(\w+)/gm,
        /^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]+>)?\s+)+(\w+)\s*\(/gm,
      ],
    };

    const langPatterns = patterns[language] || patterns['TypeScript'] || [];

    for (const pattern of langPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null && defs.length < maxDefs) {
        const name = match[1];
        if (name && !defs.includes(name)) {
          defs.push(name);
        }
      }
    }

    return defs;
  }

  private extractReferences(content: string, language: string): string[] {
    // Simple import/require detection
    const refs: string[] = [];
    const importRegex = /(?:import|require|from|use|include)\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1] && refs.length < 20) {
        refs.push(match[1]);
      }
    }
    return refs;
  }

  private getLanguage(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'TypeScript', '.tsx': 'TypeScript',
      '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
      '.py': 'Python', '.pyx': 'Python', '.pyi': 'Python',
      '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
      '.swift': 'Swift', '.c': 'C', '.cpp': 'C++', '.h': 'C', '.hpp': 'C++',
      '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#',
      '.sh': 'Shell', '.bash': 'Shell',
      '.sql': 'SQL', '.graphql': 'GraphQL',
      '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS',
      '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
      '.json': 'JSON', '.md': 'Markdown',
    };
    return map[ext] || 'Unknown';
  }

  private buildSummary(entries: RepoMapEntry[], languages: Record<string, number>, totalLines: number): string {
    const topLangs = Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([l, c]) => `${l}(${c} files)`)
      .join(', ');

    const topFiles = entries
      .sort((a, b) => b.lineCount - a.lineCount)
      .slice(0, 10)
      .map(e => `${relative(this.workingDirectory, e.file)} (${e.lineCount} lines)`)
      .join(', ');

    return `Repository: ${entries.length} files, ${totalLines} lines. Languages: ${topLangs}. Largest files: ${topFiles}`;
  }
}

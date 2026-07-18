// ============================================================
// NeuroCLI - .neuroignore System
// Specifies files the AI should not access, with gitignore-style
// pattern support, negation, caching, and auto-detection.
// ============================================================

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative, normalize, sep, isAbsolute } from 'path';
import { homedir } from 'os';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface IgnoreRule {
  pattern: string;
  negated: boolean;
  regex: RegExp;
  source: string; // which file defined this rule
}

// -----------------------------------------------------------
// Default patterns
// -----------------------------------------------------------

const DEFAULT_IGNORED_PATTERNS: string[] = [
  'node_modules',
  '.git',
  '__pycache__',
  '.env',
  '.env.*',
  '*.pyc',
  '.DS_Store',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  '*.log',
  '.turbo',
  'vendor',
  'target',
  'bin',
  'obj',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '*.min.js',
  '*.min.css',
  'bundle.js',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

// -----------------------------------------------------------
// NeuroIgnore class
// -----------------------------------------------------------

export class NeuroIgnore {
  private rules: IgnoreRule[] = [];
  private cache: Map<string, boolean> = new Map();
  private projectRoot: string;
  private loaded: boolean = false;

  constructor(projectRoot: string) {
    this.projectRoot = normalize(projectRoot);
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------

  /**
   * Load ignore rules from all sources:
   *   1. Default patterns
   *   2. ~/.neuro/ignore  (global user rules)
   *   3. .neuroignore     (project-root rules)
   */
  load(): void {
    this.rules = [];
    this.cache.clear();

    // 1. Built-in defaults
    this.loadDefaultRules();

    // 2. Global user ignore file: ~/.neuro/ignore
    const globalIgnorePath = join(homedir(), '.neuro', 'ignore');
    this.loadFromFile(globalIgnorePath);

    // 3. Project-root .neuroignore
    const projectIgnorePath = join(this.projectRoot, '.neuroignore');
    this.loadFromFile(projectIgnorePath);

    // 4. Auto-detect common directories that should be ignored
    this.autoDetectIgnorableDirs();

    this.loaded = true;
  }

  /**
   * Check whether a given file path should be ignored.
   * The path may be absolute or relative to projectRoot.
   *
   * Evaluation order matters: later rules override earlier ones.
   * Negated patterns (prefixed with !) un-ignore previously matched paths.
   */
  isIgnored(filePath: string): boolean {
    this.ensureLoaded();

    // Normalise to a relative posix-style path from project root
    const relativePath = this.toRelativePosix(filePath);

    // Check cache first
    const cached = this.cache.get(relativePath);
    if (cached !== undefined) {
      return cached;
    }

    let ignored = false;

    for (const rule of this.rules) {
      if (rule.negated) {
        // A negation rule can only un-ignore something that was already ignored
        if (ignored && rule.regex.test(relativePath)) {
          ignored = false;
        }
      } else {
        if (rule.regex.test(relativePath)) {
          ignored = true;
        }
      }
    }

    this.cache.set(relativePath, ignored);
    return ignored;
  }

  /**
   * Filter an array of paths, removing those that are ignored.
   */
  filterPaths(paths: string[]): string[] {
    return paths.filter((p) => !this.isIgnored(p));
  }

  /**
   * Dynamically add a rule at runtime.
   */
  addRule(pattern: string, source: string = '<runtime>'): void {
    const negated = pattern.startsWith('!');
    const cleanPattern = negated ? pattern.slice(1) : pattern;
    const regex = this.patternToRegex(cleanPattern);

    this.rules.push({
      pattern,
      negated,
      regex,
      source,
    });

    // Invalidate cache because rules changed
    this.cache.clear();
  }

  /**
   * Remove a rule by its original pattern string.
   * Returns true if a rule was found and removed.
   */
  removeRule(pattern: string): boolean {
    const index = this.rules.findIndex((r) => r.pattern === pattern);
    if (index === -1) {
      return false;
    }
    this.rules.splice(index, 1);
    this.cache.clear();
    return true;
  }

  /**
   * Return a shallow copy of the current rules list.
   */
  getRules(): IgnoreRule[] {
    return [...this.rules];
  }

  /**
   * Clear the result cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Print all active rules to stdout (useful for debugging).
   */
  printRules(): void {
    const sources = new Set(this.rules.map((r) => r.source));
    for (const source of sources) {
      console.log(`\n[Source: ${source}]`);
      for (const rule of this.rules.filter((r) => r.source === source)) {
        const flag = rule.negated ? ' (NEGATED)' : '';
        console.log(`  ${rule.pattern}${flag}`);
      }
    }
    console.log(`\nTotal rules: ${this.rules.length}, Cache entries: ${this.cache.size}`);
  }

  // ---------------------------------------------------------
  // Static defaults accessor
  // ---------------------------------------------------------

  static readonly DEFAULT_IGNORED: string[] = [...DEFAULT_IGNORED_PATTERNS];

  // ---------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------

  /**
   * Load rules from a single file. Lines starting with # are comments.
   * Blank lines are skipped. Trailing whitespace is trimmed.
   */
  private loadFromFile(filePath: string): void {
    if (!existsSync(filePath)) {
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);

      for (let raw of lines) {
        // Strip comments
        const commentIdx = raw.indexOf('#');
        if (commentIdx !== -1) {
          raw = raw.slice(0, commentIdx);
        }

        const line = raw.trim();
        if (line.length === 0) {
          continue;
        }

        this.addRule(line, filePath);
      }
    } catch {
      // Silently skip unreadable files
    }
  }

  /**
   * Populate the default ignore rules.
   */
  private loadDefaultRules(): void {
    for (const pattern of DEFAULT_IGNORED_PATTERNS) {
      this.addRule(pattern, '<defaults>');
    }
  }

  /**
   * Convert a gitignore-style glob pattern into a RegExp.
   *
   * Supported features:
   *   *        matches anything except /
   *   **       matches anything including /
   *   ?        matches any single character except /
   *   [abc]    character class
   *   [a-z]    character range
   *   {a,b}    brace expansion (alternation)
   *   !prefix  negation (handled separately before this method)
   *
   * A trailing / means the pattern only matches directories; we keep
   * the regex flexible enough to match both for simplicity, but strip
   * the trailing slash indicator.
   */
  private patternToRegex(pattern: string): RegExp {
    let p = pattern;

    // Strip trailing slash (directory-only indicator) -- we match
    // both files and directories for simplicity.
    const dirOnly = p.endsWith('/');
    if (dirOnly) {
      p = p.slice(0, -1);
    }

    // Leading slash means anchored to project root
    const anchored = p.startsWith('/');
    if (anchored) {
      p = p.slice(1);
    }

    // Escape regex-special characters (except those we handle as globs)
    const ESCAPE_RE = /[.+^${}()|[\]\\]/g;
    // We will build the regex manually

    let regexStr = '';
    let i = 0;

    while (i < p.length) {
      const ch = p[i];

      if (ch === '*') {
        // Check for **
        if (i + 1 < p.length && p[i + 1] === '*') {
          // /**/ or **/ or /**
          if (
            i + 2 < p.length &&
            p[i + 2] === '/'
          ) {
            // /**/  -> match any path segment(s) including none
            regexStr += '(?:/|/.+/)';
            i += 3;
          } else if (
            i === 0 ||
            p[i - 1] === '/'
          ) {
            // ** at start or after / -> match any prefix
            regexStr += '(?:.*)';
            i += 2;
          } else {
            // Embedded ** (not at segment boundary) -- treat as literal
            regexStr += '\\*\\*';
            i += 2;
          }
        } else {
          // Single * -> match anything except /
          regexStr += '[^/]*';
          i += 1;
        }
      } else if (ch === '?') {
        regexStr += '[^/]';
        i += 1;
      } else if (ch === '[') {
        // Character class -- find closing ]
        const closeIdx = p.indexOf(']', i + 1);
        if (closeIdx === -1) {
          // No closing bracket -- escape
          regexStr += '\\[';
          i += 1;
        } else {
          const classContent = p.slice(i + 1, closeIdx);
          regexStr += '[' + classContent + ']';
          i = closeIdx + 1;
        }
      } else if (ch === '{') {
        // Brace expansion {a,b,c} -> (?:a|b|c)
        const closeIdx = p.indexOf('}', i + 1);
        if (closeIdx === -1) {
          regexStr += '\\{';
          i += 1;
        } else {
          const inner = p.slice(i + 1, closeIdx);
          const alternatives = inner.split(',').map((alt) =>
            this.escapeRegex(alt)
          );
          regexStr += '(?:' + alternatives.join('|') + ')';
          i = closeIdx + 1;
        }
      } else if (ESCAPE_RE.test(ch)) {
        regexStr += '\\' + ch;
        i += 1;
      } else {
        regexStr += ch;
        i += 1;
      }
    }

    // Build final regex
    // - If anchored, match from start of relative path
    // - If not anchored, the pattern can match anywhere in the path
    //   (either as a complete segment or as a filename)
    let finalRegex: string;
    if (anchored) {
      finalRegex = '^' + regexStr + '$';
    } else {
      // Unanchored patterns match if:
      //   - the entire relative path matches the pattern directly, OR
      //   - the pattern matches a trailing segment (e.g. "dist" matches
      //     "foo/bar/dist" and "dist")
      finalRegex =
        '^(?:' +
        '(?:.*/)?' +
        regexStr +
        ')$';
    }

    try {
      return new RegExp(finalRegex);
    } catch {
      // If the generated regex is invalid, fall back to a simple
      // substring match so we never crash.
      return new RegExp(
        '^.*' + this.escapeRegex(pattern).replace(/\\\*/g, '.*') + '.*$'
      );
    }
  }

  /**
   * Escape a string for use inside a RegExp.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Ensure rules have been loaded before answering queries.
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }

  /**
   * Convert a file path to a relative posix-style path from projectRoot.
   * - Absolute paths are made relative to projectRoot.
   * - Backslashes (Windows) are converted to forward slashes.
   * - Leading ./ is stripped.
   */
  private toRelativePosix(filePath: string): string {
    let rel: string;

    if (isAbsolute(filePath)) {
      rel = relative(this.projectRoot, filePath);
    } else {
      rel = filePath;
    }

    // Normalise separators
    rel = rel.split(sep).join('/');

    // Strip leading ./
    if (rel.startsWith('./')) {
      rel = rel.slice(2);
    }

    return rel;
  }

  /**
   * Auto-detect common directories in the project root that should
   * typically be ignored (e.g. a large "vendor" or "dist" directory
   * that was not already covered by default patterns).
   */
  private autoDetectIgnorableDirs(): void {
    const AUTODETECT_CANDIDATES: string[] = [
      'node_modules',
      '.git',
      '__pycache__',
      '.cache',
      '.turbo',
      'dist',
      'build',
      '.next',
      'coverage',
      'vendor',
      'target',
      'bin',
      'obj',
      '.venv',
      'venv',
      '.tox',
      '.mypy_cache',
      '.pytest_cache',
      '.sass-cache',
      '.idea',
      '.vscode',
      'out',
      '.nuxt',
      '.output',
      '.svelte-kit',
      '.angular',
      'Pods',
    ];

    // Only scan if the project root exists
    if (!existsSync(this.projectRoot)) {
      return;
    }

    try {
      const entries = readdirSync(this.projectRoot, { withFileTypes: true });
      const existingDirs = new Set(
        entries.filter((e) => e.isDirectory()).map((e) => e.name)
      );

      for (const candidate of AUTODETECT_CANDIDATES) {
        if (existingDirs.has(candidate)) {
          // Check whether we already have a rule for this directory
          const alreadyCovered = this.rules.some(
            (r) => !r.negated && (r.pattern === candidate || r.pattern === candidate + '/')
          );
          if (!alreadyCovered) {
            this.addRule(candidate, '<auto-detect>');
          }
        }
      }
    } catch {
      // Permission error or similar -- skip auto-detection
    }
  }
}

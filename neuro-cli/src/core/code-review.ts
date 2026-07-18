// ============================================================
// NeuroCLI - Code Review System
// Automatic code review with pattern-based analysis
// Covers security, performance, style, correctness,
// dead code, complexity, and best practice violations
// ============================================================

import { join, resolve, dirname, extname, basename, relative } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';

// -----------------------------------------------------------
// Public interfaces
// -----------------------------------------------------------

export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  severity: 'critical' | 'major' | 'minor' | 'suggestion' | 'info';
  category: string;
  message: string;
  suggestion?: string;
  rule?: string;
}

export interface ReviewReport {
  id: string;
  timestamp: number;
  files: string[];
  comments: ReviewComment[];
  summary: ReviewSummary;
  score: number; // 0-100 code quality score
}

export interface ReviewSummary {
  totalComments: number;
  critical: number;
  major: number;
  minor: number;
  suggestions: number;
  categories: Record<string, number>;
}

export interface CodeReviewConfig {
  enabled: boolean;
  autoReviewOnChange: boolean;
  focusAreas: string[];
  severityThreshold: 'critical' | 'major' | 'minor';
  excludePatterns: string[];
}

// -----------------------------------------------------------
// Internal types
// -----------------------------------------------------------

type ReviewFocusArea =
  | 'security'
  | 'performance'
  | 'style'
  | 'correctness'
  | 'best-practices'
  | 'dead-code'
  | 'complexity';

interface ReviewPattern {
  rule: string;
  category: ReviewFocusArea;
  severity: ReviewComment['severity'];
  pattern: RegExp;
  message: string;
  suggestion?: string;
  languages?: string[]; // empty = all languages
  multiline?: boolean;
}

interface FileAnalysis {
  path: string;
  content: string;
  lines: string[];
  extension: string;
  language: string;
  lineCount: number;
}

type ReviewCallback = (report: ReviewReport) => void;

// -----------------------------------------------------------
// Default configuration
// -----------------------------------------------------------

const DEFAULT_CODE_REVIEW_CONFIG: CodeReviewConfig = {
  enabled: true,
  autoReviewOnChange: false,
  focusAreas: ['security', 'performance', 'correctness', 'best-practices', 'dead-code', 'complexity', 'style'],
  severityThreshold: 'minor',
  excludePatterns: [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '__pycache__/**',
    'target/**',
    '.next/**',
    'vendor/**',
    '*.min.js',
    '*.min.css',
    '*.bundle.js',
    'package-lock.json',
    'bun.lock',
    'yarn.lock',
    'go.sum',
  ],
};

// -----------------------------------------------------------
// Extension → language mapping
// -----------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'shell',
  '.bash': 'shell',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
};

// Severity order for threshold filtering
const SEVERITY_ORDER: Record<ReviewComment['severity'], number> = {
  critical: 0,
  major: 1,
  minor: 2,
  suggestion: 3,
  info: 4,
};

// -----------------------------------------------------------
// Review patterns database
// -----------------------------------------------------------

const REVIEW_PATTERNS: ReviewPattern[] = [
  // ---- Security ----
  {
    rule: 'SEC001',
    category: 'security',
    severity: 'critical',
    pattern: /eval\s*\(/,
    message: 'Use of eval() is a security risk — can execute arbitrary code.',
    suggestion: 'Use JSON.parse() for JSON data, or a sandboxed interpreter for dynamic code.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'SEC002',
    category: 'security',
    severity: 'critical',
    pattern: /innerHTML\s*[+=]/,
    message: 'Direct innerHTML assignment can lead to XSS vulnerabilities.',
    suggestion: 'Use textContent for plain text, or a sanitization library like DOMPurify for HTML.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'SEC003',
    category: 'security',
    severity: 'critical',
    pattern: /document\.write\s*\(/,
    message: 'document.write() can lead to XSS and overrides the entire document.',
    suggestion: 'Use DOM manipulation methods like createElement() and appendChild().',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'SEC004',
    category: 'security',
    severity: 'critical',
    pattern: /password\s*=\s*["'][^"']+["']/i,
    message: 'Hardcoded password detected. Never store credentials in source code.',
    suggestion: 'Use environment variables or a secrets manager.',
  },
  {
    rule: 'SEC005',
    category: 'security',
    severity: 'critical',
    pattern: /api[_-]?key\s*=\s*["'][^"']+["']/i,
    message: 'Hardcoded API key detected. Never store API keys in source code.',
    suggestion: 'Use environment variables or a secrets manager.',
  },
  {
    rule: 'SEC006',
    category: 'security',
    severity: 'critical',
    pattern: /secret\s*=\s*["'][^"']+["']/i,
    message: 'Hardcoded secret detected. Never store secrets in source code.',
    suggestion: 'Use environment variables or a secrets manager.',
  },
  {
    rule: 'SEC007',
    category: 'security',
    severity: 'major',
    pattern: /exec\s*\(\s*[^)]*\$/,
    message: 'Possible command injection via string interpolation in exec().',
    suggestion: 'Use execFile() with an args array, or sanitize input thoroughly.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'SEC008',
    category: 'security',
    severity: 'critical',
    pattern: /subprocess\.(call|run|Popen)\s*\([^)]*shell\s*=\s*True/,
    message: 'Shell injection risk: subprocess with shell=True.',
    suggestion: 'Pass arguments as a list instead of using shell=True.',
    languages: ['python'],
  },
  {
    rule: 'SEC009',
    category: 'security',
    severity: 'critical',
    pattern: /os\.system\s*\(/,
    message: 'os.system() is vulnerable to shell injection.',
    suggestion: 'Use subprocess.run() with a list of arguments.',
    languages: ['python'],
  },
  {
    rule: 'SEC010',
    category: 'security',
    severity: 'major',
    pattern: /SELECT\s+.*\s+FROM\s+.*\s*(?:WHERE|AND|OR)\s+.*\+\s*|f["']SELECT/i,
    message: 'Possible SQL injection: string concatenation or f-string in SQL query.',
    suggestion: 'Use parameterized queries with placeholders.',
    languages: ['python', 'javascript', 'typescript'],
  },
  {
    rule: 'SEC011',
    category: 'security',
    severity: 'major',
    pattern: /cors\(\s*\)|Access-Control-Allow-Origin.*\*/,
    message: 'CORS configured to allow all origins.',
    suggestion: 'Restrict CORS to specific trusted domains.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'SEC012',
    category: 'security',
    severity: 'minor',
    pattern: /console\.(log|debug|info|warn|error)\s*\(.*password/i,
    message: 'Potential sensitive data logged to console.',
    suggestion: 'Avoid logging sensitive information such as passwords.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'SEC013',
    category: 'security',
    severity: 'major',
    pattern: /unsafe\s+fn|unsafe\s+impl|unsafe\s+trait/,
    message: 'Unsafe Rust block detected — bypasses safety guarantees.',
    suggestion: 'Ensure the unsafe block is absolutely necessary and well-documented.',
    languages: ['rust'],
  },
  {
    rule: 'SEC014',
    category: 'security',
    severity: 'major',
    pattern: /panic!\s*\(/,
    message: 'panic!() can crash the application. Prefer Result-based error handling.',
    suggestion: 'Return Result<T, E> and propagate errors explicitly.',
    languages: ['rust'],
  },

  // ---- Performance ----
  {
    rule: 'PERF001',
    category: 'performance',
    severity: 'major',
    pattern: /\.forEach\s*\([^)]*\)\s*\.forEach|\.map\s*\([^)]*\)\s*\.map/,
    message: 'Chained array iterations — each creates a new pass over the data.',
    suggestion: 'Combine multiple operations into a single .reduce() or for loop.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'PERF002',
    category: 'performance',
    severity: 'major',
    pattern: /JSON\.(parse|stringify)\s*\([^)]*\)\s*(?:inside|within)|for\s*\(.*JSON\./,
    message: 'JSON parse/stringify inside a loop — expensive operation repeated.',
    suggestion: 'Move JSON operations outside the loop when possible.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'PERF003',
    category: 'performance',
    severity: 'minor',
    pattern: /document\.querySelector(?:All)?\s*\([^)]+\)\s*(?:inside|within)|for\s*\(.*querySelector/,
    message: 'DOM query inside a loop — cache the result outside the loop.',
    suggestion: 'Query the DOM once before the loop and reuse the reference.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'PERF004',
    category: 'performance',
    severity: 'major',
    pattern: /\.push\s*\([^)]*\)\s*(?:\.push|\.concat)|Array\s*\(\d{4,}\)/,
    message: 'Large array allocation or repeated push operations detected.',
    suggestion: 'Pre-allocate arrays with known sizes, or use typed arrays for numeric data.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'PERF005',
    category: 'performance',
    severity: 'minor',
    pattern: /Object\.assign\s*\(\s*\{\s*\}/,
    message: 'Unnecessary Object.assign with empty object — use spread syntax instead.',
    suggestion: 'Use { ...source } instead of Object.assign({}, source).',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'PERF006',
    category: 'performance',
    severity: 'major',
    pattern: /for\s+\w+\s+in\s+range\s*\(\s*\d{5,}/,
    message: 'Large range iteration detected — may cause performance issues.',
    suggestion: 'Consider using generators, itertools, or a more efficient algorithm.',
    languages: ['python'],
  },
  {
    rule: 'PERF007',
    category: 'performance',
    severity: 'minor',
    pattern: /list\s*\(\s*map\s*\(|list\s*\(\s*filter\s*\(/,
    message: 'Unnecessary list() around map/filter — iterate lazily unless you need a list.',
    suggestion: 'Remove list() if you only need to iterate, or keep it if you need indexing.',
    languages: ['python'],
  },
  {
    rule: 'PERF008',
    category: 'performance',
    severity: 'major',
    pattern: /string\s*\+=|\.append\s*\(\s*["'].*["']\s*\).*for/,
    message: 'String concatenation in a loop — use string builder pattern.',
    suggestion: 'Collect parts in an array/list and join them at the end.',
  },
  {
    rule: 'PERF009',
    category: 'performance',
    severity: 'minor',
    pattern: /clone\s*\(\s*\)/,
    message: 'Unnecessary .clone() — cloning can be expensive in performance-critical paths.',
    suggestion: 'Use references where possible, or verify the clone is necessary.',
    languages: ['rust'],
  },
  {
    rule: 'PERF010',
    category: 'performance',
    severity: 'minor',
    pattern: /unwrap\s*\(\s*\)/,
    message: '.unwrap() can panic at runtime and hides error handling.',
    suggestion: 'Use pattern matching or .unwrap_or_default() / .unwrap_or(fallback).',
    languages: ['rust'],
  },

  // ---- Style / Consistency ----
  {
    rule: 'STYLE001',
    category: 'style',
    severity: 'minor',
    pattern: /var\s+/,
    message: 'Use of var — prefer const or let for block scoping.',
    suggestion: 'Replace var with const (for constants) or let (for reassignable variables).',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'STYLE002',
    category: 'style',
    severity: 'minor',
    pattern: /==(?!=)/,
    message: 'Use of == — prefer strict equality ===.',
    suggestion: 'Use === for strict comparison to avoid type coercion bugs.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'STYLE003',
    category: 'style',
    severity: 'suggestion',
    pattern: /\/\/\s*TODO|\/\/\s*FIXME|\/\/\s*HACK|\/\/\s*XXX/i,
    message: 'TODO/FIXME/HACK comment found — track these and resolve them.',
    suggestion: 'Create an issue or ticket to track this item.',
  },
  {
    rule: 'STYLE004',
    category: 'style',
    severity: 'minor',
    pattern: /console\.(log|debug|info)\s*\(/,
    message: 'Console log statement detected — should be removed for production.',
    suggestion: 'Remove console.log or replace with a proper logging library.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'STYLE005',
    category: 'style',
    severity: 'minor',
    pattern: /print\s*\([^)]*\)/,
    message: 'Print statement detected — should use a logging framework instead.',
    suggestion: 'Replace with logging.debug(), logging.info(), etc.',
    languages: ['python'],
  },
  {
    rule: 'STYLE006',
    category: 'style',
    severity: 'suggestion',
    pattern: /class\s+\w+\s*:\s*$/,
    message: 'Class without docstring detected.',
    suggestion: 'Add a docstring to document the class purpose.',
    languages: ['python'],
  },
  {
    rule: 'STYLE007',
    category: 'style',
    severity: 'minor',
    pattern: /except\s*:/,
    message: 'Bare except clause — catches all exceptions including SystemExit and KeyboardInterrupt.',
    suggestion: 'Use except Exception: or a more specific exception type.',
    languages: ['python'],
  },

  // ---- Correctness / Bug-prone patterns ----
  {
    rule: 'BUG001',
    category: 'correctness',
    severity: 'major',
    pattern: /if\s*\([^)]*=[^=][^)]*\)/,
    message: 'Possible assignment in conditional — likely intended == comparison.',
    suggestion: 'Use === for comparison. If assignment is intended, wrap in extra parens.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG002',
    category: 'correctness',
    severity: 'critical',
    pattern: /await\s+[^;\n]*[^)]*(?:\n|$)/,
    message: 'Possible missing await — async operation may not complete before use.',
    suggestion: 'Ensure all async operations are properly awaited or handled.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG003',
    category: 'correctness',
    severity: 'major',
    pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/,
    message: 'Empty catch block — errors are silently swallowed.',
    suggestion: 'Log the error, re-throw it, or handle it meaningfully.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG004',
    category: 'correctness',
    severity: 'major',
    pattern: /except\s+\w+\s*:\s*pass/,
    message: 'Empty except block with pass — errors are silently ignored.',
    suggestion: 'Log the error, re-raise it, or handle it meaningfully.',
    languages: ['python'],
  },
  {
    rule: 'BUG005',
    category: 'correctness',
    severity: 'critical',
    pattern: /setInterval\s*\([^,]+,\s*\d+\)/,
    message: 'setInterval without clearInterval — may cause memory leaks.',
    suggestion: 'Store the interval ID and call clearInterval() on cleanup.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG006',
    category: 'correctness',
    severity: 'major',
    pattern: /setTimeout\s*\([^,]+,\s*0\s*\)/,
    message: 'setTimeout with 0ms delay — often indicates a race condition workaround.',
    suggestion: 'Restructure code to avoid relying on event loop timing.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG007',
    category: 'correctness',
    severity: 'major',
    pattern: /return\s+new\s+Promise\s*\(\s*(?:async|function)/,
    message: 'Returning new Promise from an async function — double-wrapping.',
    suggestion: 'Async functions already return promises; remove the new Promise wrapper.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG008',
    category: 'correctness',
    severity: 'minor',
    pattern: /\.sort\s*\(\s*\)/,
    message: 'Array.sort() without comparator — sorts lexicographically, not numerically.',
    suggestion: 'Pass a comparator: .sort((a, b) => a - b) for numeric sorting.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BUG009',
    category: 'correctness',
    severity: 'critical',
    pattern: /if\s+\w+\s*=\s*None/,
    message: 'Using = for None comparison — should use "is None".',
    suggestion: 'Use "if x is None:" or "if x is not None:" for None comparisons.',
    languages: ['python'],
  },
  {
    rule: 'BUG010',
    category: 'correctness',
    severity: 'major',
    pattern: /def\s+\w+\s*\([^)]*mutable_default[^)]*\)|def\s+\w+\s*\([^)]*=\s*\[\]|def\s+\w+\s*\([^)]*=\s*\{/,
    message: 'Mutable default argument — shared across all calls, causing subtle bugs.',
    suggestion: 'Use None as default and initialize inside the function body.',
    languages: ['python'],
  },

  // ---- Best Practices ----
  {
    rule: 'BP001',
    category: 'best-practices',
    severity: 'major',
    pattern: /any\s+(?:as\s+any|:\s*any)/,
    message: 'Use of TypeScript any — defeats type safety.',
    suggestion: 'Use a specific type, unknown, or a generic parameter.',
    languages: ['typescript'],
  },
  {
    rule: 'BP002',
    category: 'best-practices',
    severity: 'minor',
    pattern: /@ts-ignore|@ts-nocheck/,
    message: 'TypeScript suppression directive — hides type errors.',
    suggestion: 'Fix the underlying type error instead of suppressing it.',
    languages: ['typescript'],
  },
  {
    rule: 'BP003',
    category: 'best-practices',
    severity: 'minor',
    pattern: /import\s+\*\s+as/,
    message: 'Namespace import — may increase bundle size with unused exports.',
    suggestion: 'Import only the specific items you need: import { item } from ...',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BP004',
    category: 'best-practices',
    severity: 'suggestion',
    pattern: /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{500,}/,
    message: 'Function is very long — consider breaking it into smaller functions.',
    suggestion: 'Extract logical sections into well-named helper functions.',
  },
  {
    rule: 'BP005',
    category: 'best-practices',
    severity: 'major',
    pattern: /\.bind\s*\(\s*this\s*\)/,
    message: 'Using .bind(this) — prefer arrow functions for lexical this.',
    suggestion: 'Use arrow functions or class properties instead of .bind(this).',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BP006',
    category: 'best-practices',
    severity: 'minor',
    pattern: /new\s+Date\s*\(\s*\)/,
    message: 'Direct Date construction makes code hard to test.',
    suggestion: 'Inject a clock/timestamp function for testability.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'BP007',
    category: 'best-practices',
    severity: 'minor',
    pattern: /import\s+\w+\s+from\s+["']\.+(?!\/)/,
    message: 'Relative import without proper path — may break on refactoring.',
    suggestion: 'Use path aliases configured in tsconfig.json or jsconfig.json.',
    languages: ['javascript', 'typescript'],
  },

  // ---- Dead Code ----
  {
    rule: 'DEAD001',
    category: 'dead-code',
    severity: 'minor',
    pattern: /\/\/\s*eslint-disable-next-line|\/\/\s*eslint-disable\s/,
    message: 'ESLint disable directive — may hide issues that should be fixed.',
    suggestion: 'Fix the underlying issue instead of disabling the rule.',
    languages: ['javascript', 'typescript'],
  },
  {
    rule: 'DEAD002',
    category: 'dead-code',
    severity: 'minor',
    pattern: /\/\/\s*noqa/,
    message: 'noqa directive — may hide lint issues that should be fixed.',
    suggestion: 'Fix the underlying issue instead of suppressing the warning.',
    languages: ['python'],
  },
  {
    rule: 'DEAD003',
    category: 'dead-code',
    severity: 'minor',
    pattern: /\/\*[\s\S]*?\*\//g,
    message: 'Large block comment — could indicate dead/commented-out code.',
    suggestion: 'Remove commented-out code; rely on version control for history.',
    multiline: true,
  },

  // ---- Complexity ----
  {
    rule: 'COMPLEX001',
    category: 'complexity',
    severity: 'major',
    pattern: /if\s*\(.*(?:&&|\|\|).*(?:&&|\|\|).*(?:&&|\|\|)/,
    message: 'Complex boolean expression — hard to read and error-prone.',
    suggestion: 'Extract sub-conditions into well-named boolean variables.',
  },
  {
    rule: 'COMPLEX002',
    category: 'complexity',
    severity: 'major',
    pattern: /(?:if|elif|else)\s*(?:if)?\s*.*(?:if|elif|else)\s*(?:if)?\s*.*(?:if|elif|else)\s*(?:if)?\s*.*(?:if|elif|else)/,
    message: 'Deeply nested conditionals — consider early returns or a switch/match.',
    suggestion: 'Use guard clauses (early returns) or polymorphism to reduce nesting.',
  },
  {
    rule: 'COMPLEX003',
    category: 'complexity',
    severity: 'minor',
    pattern: /try\s*\{[\s\S]*?\}\s*catch\s*\{[\s\S]*?\}\s*finally\s*\{/,
    message: 'try/catch/finally block — ensure each section is simple and clear.',
    suggestion: 'Keep try blocks minimal; move logic out of finally where possible.',
    languages: ['javascript', 'typescript'],
    multiline: true,
  },
];

// -----------------------------------------------------------
// CodeReviewSystem class
// -----------------------------------------------------------

export class CodeReviewSystem {
  private config: CodeReviewConfig;
  private projectRoot: string;
  private comments: ReviewComment[] = [];
  private reports: ReviewReport[] = [];
  private callbacks: ReviewCallback[] = [];
  private focusAreas: Set<ReviewFocusArea>;
  private commentCounter = 0;

  constructor(projectRoot?: string, config?: Partial<CodeReviewConfig>) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.config = { ...DEFAULT_CODE_REVIEW_CONFIG, ...config };
    this.focusAreas = new Set(this.config.focusAreas as ReviewFocusArea[]);
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Review a single file for issues.
   * Returns a ReviewReport with all detected comments and a quality score.
   */
  async reviewFile(filePath: string): Promise<ReviewReport> {
    const absPath = resolve(this.projectRoot, filePath);

    if (!existsSync(absPath)) {
      return this.emptyReport([filePath]);
    }

    const analysis = this.analyzeFile(absPath);
    if (!analysis) {
      return this.emptyReport([filePath]);
    }

    // Check exclusion
    if (this.isExcluded(filePath)) {
      return this.emptyReport([filePath]);
    }

    const comments = this.runPatterns(analysis);
    this.comments = this.comments.concat(comments);

    return this.buildReport([filePath], comments);
  }

  /**
   * Review all uncommitted changes (or changes vs. a base branch).
   */
  async reviewChanges(baseBranch?: string): Promise<ReviewReport> {
    const changedFiles = this.getChangedFiles(baseBranch);
    const allComments: ReviewComment[] = [];

    for (const file of changedFiles) {
      const absPath = resolve(this.projectRoot, file);

      if (!existsSync(absPath)) continue;
      if (this.isExcluded(file)) continue;

      const analysis = this.analyzeFile(absPath);
      if (!analysis) continue;

      const comments = this.runPatterns(analysis);
      allComments.push(...comments);
    }

    this.comments = this.comments.concat(allComments);
    return this.buildReport(changedFiles, allComments);
  }

  /**
   * Review a diff string for issues.
   * Only analyzes the new/changed lines in the diff.
   */
  async reviewDiff(diff: string): Promise<ReviewReport> {
    const parsed = this.parseDiff(diff);
    const allComments: ReviewComment[] = [];
    const reviewedFiles: string[] = [];

    for (const [filePath, changedLines] of parsed) {
      const absPath = resolve(this.projectRoot, filePath);

      if (!existsSync(absPath)) continue;
      if (this.isExcluded(filePath)) continue;

      const analysis = this.analyzeFile(absPath);
      if (!analysis) continue;

      // Only check patterns on changed lines
      const comments = this.runPatterns(analysis).filter(
        comment => changedLines.includes(comment.line),
      );

      allComments.push(...comments);
      reviewedFiles.push(filePath);
    }

    this.comments = this.comments.concat(allComments);
    return this.buildReport(reviewedFiles, allComments);
  }

  /**
   * Review a GitHub PR by URL.
   * Fetches the diff and reviews it.
   */
  async reviewPR(prUrl: string): Promise<ReviewReport> {
    // Extract owner, repo, and PR number from URL
    const prMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!prMatch) {
      throw new Error(`Invalid GitHub PR URL: ${prUrl}`);
    }

    const [, owner, repo, prNumber] = prMatch;

    try {
      // Use gh CLI to fetch the diff
      const diff = execSync(
        `gh pr diff ${prNumber} --repo ${owner}/${repo}`,
        {
          encoding: 'utf-8',
          timeout: 30_000,
          cwd: this.projectRoot,
        },
      );

      return this.reviewDiff(diff);
    } catch (error) {
      // Fallback: try curl with GitHub API
      try {
        const diff = execSync(
          `curl -s -H "Accept: application/vnd.github.v3.diff" https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
          {
            encoding: 'utf-8',
            timeout: 30_000,
            cwd: this.projectRoot,
          },
        );

        return this.reviewDiff(diff);
      } catch {
        throw new Error(
          `Failed to fetch PR diff. Ensure 'gh' CLI is installed and authenticated, or the repository is public.`,
        );
      }
    }
  }

  /**
   * Get review comments for a specific file.
   */
  getReviewComments(filePath?: string): ReviewComment[] {
    if (filePath) {
      const absPath = resolve(this.projectRoot, filePath);
      return this.comments.filter(
        c => resolve(this.projectRoot, c.file) === absPath,
      );
    }
    return [...this.comments];
  }

  /**
   * Filter comments by severity level.
   * Returns comments at or above the given severity threshold.
   */
  severityFilter(severity: ReviewComment['severity']): ReviewComment[] {
    const threshold = SEVERITY_ORDER[severity];
    return this.comments.filter(
      c => SEVERITY_ORDER[c.severity] <= threshold,
    );
  }

  /**
   * Generate a full review report covering all tracked comments.
   */
  generateReport(): ReviewReport {
    const files = [...new Set(this.comments.map(c => c.file))];
    return this.buildReport(files, this.comments);
  }

  /**
   * Set review focus areas. Only patterns in these categories will be evaluated.
   */
  setFocus(areas: ReviewFocusArea[]): void {
    this.focusAreas = new Set(areas);
    this.config.focusAreas = areas;
  }

  /**
   * Register a callback for review reports.
   */
  onReviewResult(callback: ReviewCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a previously registered callback.
   */
  offReviewResult(callback: ReviewCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }

  /**
   * Get the current review configuration.
   */
  getConfig(): CodeReviewConfig {
    return { ...this.config };
  }

  /**
   * Update the review configuration.
   */
  updateConfig(updates: Partial<CodeReviewConfig>): void {
    Object.assign(this.config, updates);
    if (updates.focusAreas) {
      this.focusAreas = new Set(updates.focusAreas as ReviewFocusArea[]);
    }
  }

  /**
   * Clear all stored comments.
   */
  clearComments(): void {
    this.comments = [];
    this.commentCounter = 0;
  }

  /**
   * Get all historical reports.
   */
  getReports(): ReviewReport[] {
    return [...this.reports];
  }

  /**
   * Print a review report summary.
   */
  printSummary(report: ReviewReport): void {
    console.log('');
    console.log('--- Code Review Summary ---');
    console.log(`  Report ID:  ${report.id}`);
    console.log(`  Timestamp:  ${new Date(report.timestamp).toISOString()}`);
    console.log(`  Files:      ${report.files.length}`);
    console.log(`  Score:      ${report.score}/100`);
    console.log('');

    const s = report.summary;
    console.log('  Summary:');
    console.log(`    Critical:   ${s.critical}`);
    console.log(`    Major:      ${s.major}`);
    console.log(`    Minor:      ${s.minor}`);
    console.log(`    Suggestions:${s.suggestions}`);
    console.log(`    Total:      ${s.totalComments}`);
    console.log('');

    if (Object.keys(s.categories).length > 0) {
      console.log('  By Category:');
      for (const [category, count] of Object.entries(s.categories)) {
        console.log(`    ${category}: ${count}`);
      }
      console.log('');
    }

    // Print top critical/major comments
    const significant = report.comments
      .filter(c => c.severity === 'critical' || c.severity === 'major')
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      .slice(0, 15);

    if (significant.length > 0) {
      console.log('  Significant Issues:');
      for (const comment of significant) {
        const sevLabel = comment.severity === 'critical' ? '!!' : '!';
        console.log(
          `    [${sevLabel}] ${comment.file}:${comment.line} — ${comment.rule ?? 'N/A'}: ${comment.message}`,
        );
        if (comment.suggestion) {
          console.log(`         → ${comment.suggestion}`);
        }
      }
      console.log('');
    }

    console.log('----------------------------');
    console.log('');
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private analyzeFile(absPath: string): FileAnalysis | null {
    try {
      const content = readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const ext = extname(absPath).toLowerCase();
      const language = EXTENSION_LANGUAGE_MAP[ext] ?? 'unknown';

      return {
        path: relative(this.projectRoot, absPath),
        content,
        lines,
        extension: ext,
        language,
        lineCount: lines.length,
      };
    } catch {
      return null;
    }
  }

  private runPatterns(analysis: FileAnalysis): ReviewComment[] {
    const comments: ReviewComment[] = [];

    for (const pattern of REVIEW_PATTERNS) {
      // Skip if focus area doesn't include this category
      if (!this.focusAreas.has(pattern.category)) continue;

      // Skip if pattern is language-specific and doesn't match
      if (
        pattern.languages &&
        pattern.languages.length > 0 &&
        !pattern.languages.includes(analysis.language)
      ) {
        continue;
      }

      // Skip if below severity threshold
      if (SEVERITY_ORDER[pattern.severity] > SEVERITY_ORDER[this.config.severityThreshold]) {
        continue;
      }

      // Run pattern against each line
      for (let i = 0; i < analysis.lines.length; i++) {
        const line = analysis.lines[i];
        const match = pattern.pattern.test(line);

        if (match) {
          this.commentCounter++;
          comments.push({
            id: `RC-${this.commentCounter.toString().padStart(5, '0')}`,
            file: analysis.path,
            line: i + 1,
            severity: pattern.severity,
            category: pattern.category,
            message: pattern.message,
            suggestion: pattern.suggestion,
            rule: pattern.rule,
          });

          // Reset regex lastIndex for patterns with global flag
          pattern.pattern.lastIndex = 0;
        }
      }

      // Multi-line patterns: check against full content
      if (pattern.multiline) {
        const fullMatch = pattern.pattern.test(analysis.content);
        if (fullMatch) {
          // Find the approximate line number
          const matchIndex = analysis.content.search(pattern.pattern);
          const lineNumber = matchIndex >= 0
            ? analysis.content.substring(0, matchIndex).split('\n').length
            : 1;

          // Check if we already added this comment for this line
          const alreadyAdded = comments.some(
            c => c.file === analysis.path && c.line === lineNumber && c.rule === pattern.rule,
          );

          if (!alreadyAdded) {
            this.commentCounter++;
            comments.push({
              id: `RC-${this.commentCounter.toString().padStart(5, '0')}`,
              file: analysis.path,
              line: lineNumber,
              severity: pattern.severity,
              category: pattern.category,
              message: pattern.message,
              suggestion: pattern.suggestion,
              rule: pattern.rule,
            });
          }

          pattern.pattern.lastIndex = 0;
        }
      }
    }

    // Add complexity analysis based on file structure
    comments.push(...this.analyzeComplexity(analysis));

    return comments;
  }

  private analyzeComplexity(analysis: FileAnalysis): ReviewComment[] {
    const comments: ReviewComment[] = [];

    // File too long
    if (analysis.lineCount > 500) {
      this.commentCounter++;
      comments.push({
        id: `RC-${this.commentCounter.toString().padStart(5, '0')}`,
        file: analysis.path,
        line: 1,
        severity: analysis.lineCount > 1000 ? 'major' : 'minor',
        category: 'complexity',
        message: `File is ${analysis.lineCount} lines long — consider splitting into smaller modules.`,
        suggestion: 'Extract logical sections into separate files/modules.',
        rule: 'COMPLEX004',
      });
    }

    // Detect deep nesting
    let maxNesting = 0;
    let maxNestingLine = 0;
    for (let i = 0; i < analysis.lines.length; i++) {
      const line = analysis.lines[i];
      const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;
      const nesting = Math.floor(leadingSpaces / 2); // Assuming 2-space indent
      if (nesting > maxNesting) {
        maxNesting = nesting;
        maxNestingLine = i + 1;
      }
    }

    if (maxNesting > 5) {
      this.commentCounter++;
      comments.push({
        id: `RC-${this.commentCounter.toString().padStart(5, '0')}`,
        file: analysis.path,
        line: maxNestingLine,
        severity: 'major',
        category: 'complexity',
        message: `Deep nesting detected (level ${maxNesting}) — code is hard to follow.`,
        suggestion: 'Use guard clauses, early returns, or extract nested logic into functions.',
        rule: 'COMPLEX005',
      });
    }

    // Detect long functions (simple heuristic)
    let functionStart = -1;
    let functionIndent = 0;
    for (let i = 0; i < analysis.lines.length; i++) {
      const line = analysis.lines[i];
      const trimmed = line.trim();

      // Detect function starts (JS/TS, Python, Go)
      if (
        /^(export\s+)?(async\s+)?function\s|^(const|let|var)\s+\w+\s*=\s*(async\s*)?\(|^def\s+\w+|^func\s+\w+/.test(trimmed)
      ) {
        if (functionStart >= 0 && i - functionStart > 50) {
          this.commentCounter++;
          comments.push({
            id: `RC-${this.commentCounter.toString().padStart(5, '0')}`,
            file: analysis.path,
            line: functionStart + 1,
            severity: 'minor',
            category: 'complexity',
            message: `Function is ${i - functionStart} lines long — consider breaking it up.`,
            suggestion: 'Extract logical sections into well-named helper functions.',
            rule: 'COMPLEX006',
          });
        }
        functionStart = i;
        functionIndent = (line.match(/^(\s*)/)?.[1].length ?? 0);
      }

      // If we're back at same or lower indent and it's a closing brace/end
      if (
        functionStart >= 0 &&
        i > functionStart &&
        trimmed.startsWith('}') &&
        (line.match(/^(\s*)/)?.[1].length ?? 0) <= functionIndent
      ) {
        if (i - functionStart > 50) {
          this.commentCounter++;
          comments.push({
            id: `RC-${this.commentCounter.toString().padStart(5, '0')}`,
            file: analysis.path,
            line: functionStart + 1,
            severity: 'minor',
            category: 'complexity',
            message: `Function is ${i - functionStart} lines long — consider breaking it up.`,
            suggestion: 'Extract logical sections into well-named helper functions.',
            rule: 'COMPLEX006',
          });
        }
        functionStart = -1;
      }
    }

    return comments;
  }

  private buildReport(files: string[], comments: ReviewComment[]): ReviewReport {
    const id = `RR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = Date.now();

    // Build summary
    const categories: Record<string, number> = {};
    let critical = 0;
    let major = 0;
    let minor = 0;
    let suggestions = 0;

    for (const comment of comments) {
      switch (comment.severity) {
        case 'critical': critical++; break;
        case 'major': major++; break;
        case 'minor': minor++; break;
        case 'suggestion': suggestions++; break;
        default: break;
      }

      categories[comment.category] = (categories[comment.category] ?? 0) + 1;
    }

    const summary: ReviewSummary = {
      totalComments: comments.length,
      critical,
      major,
      minor,
      suggestions,
      categories,
    };

    // Calculate quality score (0-100)
    const score = this.calculateScore(summary, files.length);

    const report: ReviewReport = {
      id,
      timestamp,
      files,
      comments,
      summary,
      score,
    };

    this.reports.push(report);
    this.emit(report);

    return report;
  }

  /**
   * Calculate a code quality score from 0 to 100.
   * Start at 100 and deduct points based on issue severity.
   */
  private calculateScore(summary: ReviewSummary, fileCount: number): number {
    let score = 100;

    // Deductions per severity
    score -= summary.critical * 15;
    score -= summary.major * 5;
    score -= summary.minor * 2;
    score -= summary.suggestions * 0.5;

    // Normalize by file count (more files = more expected issues)
    if (fileCount > 1) {
      const normalization = Math.max(0.5, 1 - (fileCount - 1) * 0.02);
      const deduction = 100 - score;
      score = 100 - deduction * normalization;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private emptyReport(files: string[]): ReviewReport {
    const id = `RR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    return {
      id,
      timestamp: Date.now(),
      files,
      comments: [],
      summary: {
        totalComments: 0,
        critical: 0,
        major: 0,
        minor: 0,
        suggestions: 0,
        categories: {},
      },
      score: 100,
    };
  }

  private emit(report: ReviewReport): void {
    for (const cb of this.callbacks) {
      try {
        cb(report);
      } catch {
        // Callback errors should not interrupt the flow
      }
    }
  }

  private isExcluded(filePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      const regex = this.globToRegex(pattern);
      if (regex.test(filePath)) return true;
    }
    return false;
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  /**
   * Get changed files from git (uncommitted or vs. a base branch).
   */
  private getChangedFiles(baseBranch?: string): string[] {
    try {
      if (baseBranch) {
        const output = execSync(
          `git diff --name-only ${baseBranch}...HEAD`,
          { encoding: 'utf-8', cwd: this.projectRoot, timeout: 10_000 },
        );
        return output.trim().split('\n').filter(Boolean);
      }

      // Uncommitted changes (staged + unstaged)
      const staged = execSync('git diff --name-only --cached', {
        encoding: 'utf-8',
        cwd: this.projectRoot,
        timeout: 10_000,
      });

      const unstaged = execSync('git diff --name-only', {
        encoding: 'utf-8',
        cwd: this.projectRoot,
        timeout: 10_000,
      });

      const untracked = execSync('git ls-files --others --exclude-standard', {
        encoding: 'utf-8',
        cwd: this.projectRoot,
        timeout: 10_000,
      });

      const allFiles = [
        ...staged.trim().split('\n'),
        ...unstaged.trim().split('\n'),
        ...untracked.trim().split('\n'),
      ];

      return [...new Set(allFiles.filter(Boolean))];
    } catch {
      return [];
    }
  }

  /**
   * Parse a unified diff into a map of file paths to changed line numbers.
   */
  private parseDiff(diff: string): Map<string, number[]> {
    const result = new Map<string, number[]>();
    let currentFile = '';
    let currentLines: number[] = [];
    let lineOffset = 0;

    const lines = diff.split('\n');

    for (const line of lines) {
      // New file in diff
      const fileMatch = line.match(/^---\s+a\/(.+)$|^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
      if (fileMatch) {
        if (currentFile && currentLines.length > 0) {
          result.set(currentFile, currentLines);
        }
        currentFile = fileMatch[1] ?? fileMatch[3] ?? '';
        currentLines = [];
        lineOffset = 0;
        continue;
      }

      // Also handle +++ line
      const plusFileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
      if (plusFileMatch && !currentFile) {
        currentFile = plusFileMatch[1];
        currentLines = [];
        continue;
      }

      // Hunk header: @@ -a,b +c,d @@
      const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        lineOffset = parseInt(hunkMatch[1], 10) - 1;
        continue;
      }

      // Added line
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lineOffset++;
        currentLines.push(lineOffset);
      } else if (line.startsWith('-')) {
        // Removed line — don't increment offset
      } else {
        // Context line
        lineOffset++;
      }
    }

    // Flush last file
    if (currentFile && currentLines.length > 0) {
      result.set(currentFile, currentLines);
    }

    return result;
  }
}

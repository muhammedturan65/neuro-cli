// ============================================================
// NeuroCLI - Linting Integration
// Automatic linter detection, execution, and auto-fix
// Supports ESLint, Prettier, Ruff, Pylint, Flake8,
// golangci-lint, Clippy, and standard linters per language
// ============================================================
import { join, resolve, extname, relative } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
// -----------------------------------------------------------
// Linter definitions
// -----------------------------------------------------------
const LINTERS = [
    // JavaScript / TypeScript
    {
        name: 'eslint',
        language: 'javascript',
        configFiles: [
            '.eslintrc',
            '.eslintrc.js',
            '.eslintrc.cjs',
            '.eslintrc.mjs',
            '.eslintrc.json',
            '.eslintrc.yaml',
            '.eslintrc.yml',
        ],
        commands: {
            lint: ['npx', 'eslint', '--format', 'json'],
            fix: ['npx', 'eslint', '--fix', '--format', 'json'],
        },
        parseOutput: (stdout, _stderr, rootDir) => {
            const issues = [];
            try {
                const results = JSON.parse(stdout);
                for (const fileResult of results) {
                    for (const msg of fileResult.messages) {
                        issues.push({
                            file: relative(rootDir, fileResult.filePath),
                            line: msg.line,
                            column: msg.column,
                            severity: msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info',
                            rule: msg.ruleId ?? 'unknown',
                            message: msg.message,
                            fixable: msg.fix !== undefined,
                        });
                    }
                }
            }
            catch {
                // Parse error — return empty
            }
            return issues;
        },
    },
    // Python - Ruff
    {
        name: 'ruff',
        language: 'python',
        configFiles: ['ruff.toml', 'pyproject.toml'],
        commands: {
            lint: ['ruff', 'check', '--output-format', 'json'],
            fix: ['ruff', 'check', '--fix', '--output-format', 'json'],
            format: ['ruff', 'format'],
        },
        parseOutput: (stdout, _stderr, rootDir) => {
            const issues = [];
            try {
                const results = JSON.parse(stdout);
                for (const item of results) {
                    issues.push({
                        file: relative(rootDir, item.filename),
                        line: item.location.row,
                        column: item.location.column,
                        severity: 'warning',
                        rule: item.code,
                        message: item.message,
                        fixable: item.fix !== undefined,
                    });
                }
            }
            catch {
                // Parse error
            }
            return issues;
        },
    },
    // Python - Pylint
    {
        name: 'pylint',
        language: 'python',
        configFiles: ['.pylintrc', 'pyproject.toml', 'setup.cfg'],
        commands: {
            lint: ['pylint', '--output-format=json'],
            fix: undefined,
        },
        parseOutput: (stdout, _stderr, rootDir) => {
            const issues = [];
            try {
                const results = JSON.parse(stdout);
                for (const item of results) {
                    const sev = item.type === 'error' || item.type === 'fatal'
                        ? 'error'
                        : item.type === 'warning'
                            ? 'warning'
                            : 'info';
                    issues.push({
                        file: relative(rootDir, item.path),
                        line: item.line,
                        column: item.column + 1,
                        severity: sev,
                        rule: item.symbol,
                        message: item.message,
                        fixable: false,
                    });
                }
            }
            catch {
                // Parse error
            }
            return issues;
        },
    },
    // Python - Flake8
    {
        name: 'flake8',
        language: 'python',
        configFiles: ['.flake8', 'setup.cfg', 'tox.ini'],
        commands: {
            lint: ['flake8', '--format=json'],
        },
        parseOutput: (stdout, _stderr, rootDir) => {
            const issues = [];
            try {
                const data = JSON.parse(stdout);
                for (const [filePath, violations] of Object.entries(data)) {
                    for (const v of violations) {
                        issues.push({
                            file: relative(rootDir, filePath),
                            line: v.row,
                            column: v.col,
                            severity: v.code.startsWith('E') || v.code.startsWith('F') ? 'error' : 'warning',
                            rule: v.code,
                            message: v.message,
                            fixable: false,
                        });
                    }
                }
            }
            catch {
                // Try line-by-line parsing as fallback
                const lines = stdout.split('\n');
                const pattern = /^(.+):(\d+):(\d+):\s+(\w+)\s+(.+)$/;
                for (const line of lines) {
                    const match = line.match(pattern);
                    if (match) {
                        issues.push({
                            file: relative(rootDir, match[1]),
                            line: parseInt(match[2], 10),
                            column: parseInt(match[3], 10),
                            severity: match[4].startsWith('E') || match[4].startsWith('F') ? 'error' : 'warning',
                            rule: match[4],
                            message: match[5],
                            fixable: false,
                        });
                    }
                }
            }
            return issues;
        },
    },
    // Go - golangci-lint
    {
        name: 'golangci-lint',
        language: 'go',
        configFiles: ['.golangci.yml', '.golangci.yaml', '.golangci.json', '.golangci.toml'],
        commands: {
            lint: ['golangci-lint', 'run', '--out-format=json'],
            fix: ['golangci-lint', 'run', '--fix', '--out-format=json'],
        },
        parseOutput: (stdout, _stderr, rootDir) => {
            const issues = [];
            try {
                const data = JSON.parse(stdout);
                for (const issue of data.Issues ?? []) {
                    issues.push({
                        file: relative(rootDir, issue.Pos.Filename),
                        line: issue.Pos.Line,
                        column: issue.Pos.Column,
                        severity: issue.Severity === 'error' ? 'error' : 'warning',
                        rule: issue.FromLinter,
                        message: issue.Text,
                        fixable: false,
                    });
                }
            }
            catch {
                // Parse error
            }
            return issues;
        },
    },
    // Rust - Clippy
    {
        name: 'clippy',
        language: 'rust',
        configFiles: ['clippy.toml', '.clippy.toml'],
        commands: {
            lint: ['cargo', 'clippy', '--message-format=json'],
            fix: ['cargo', 'clippy', '--fix', '--allow-dirty', '--message-format=json'],
        },
        parseOutput: (stdout, _stderr, rootDir) => {
            const issues = [];
            const lines = stdout.split('\n');
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.reason === 'compiler-message' && msg.message) {
                        const span = msg.message.spans?.[0];
                        issues.push({
                            file: span ? relative(rootDir, span.file_name) : 'unknown',
                            line: span?.line_start ?? 0,
                            column: span?.column_start ?? 0,
                            severity: msg.message.level === 'error' ? 'error' : 'warning',
                            rule: msg.message.code?.code ?? 'clippy',
                            message: msg.message.rendered?.split('\n')[0] ?? '',
                            fixable: false,
                        });
                    }
                }
                catch {
                    // Not a JSON line — skip
                }
            }
            return issues;
        },
    },
];
// Formatter definitions
const FORMATTERS = [
    {
        name: 'prettier',
        configFiles: [
            '.prettierrc',
            '.prettierrc.js',
            '.prettierrc.cjs',
            '.prettierrc.mjs',
            '.prettierrc.json',
            '.prettierrc.yaml',
            '.prettierrc.yml',
            'prettier.config.js',
            'prettier.config.cjs',
            'prettier.config.mjs',
        ],
        command: ['npx', 'prettier', '--write'],
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.md', '.yaml', '.yml', '.graphql'],
    },
    {
        name: 'ruff-format',
        configFiles: ['ruff.toml', 'pyproject.toml'],
        command: ['ruff', 'format'],
        extensions: ['.py', '.pyi'],
    },
    {
        name: 'gofmt',
        configFiles: [],
        command: ['gofmt', '-w'],
        extensions: ['.go'],
    },
    {
        name: 'rustfmt',
        configFiles: ['rustfmt.toml', '.rustfmt.toml'],
        command: ['cargo', 'fmt'],
        extensions: ['.rs'],
    },
];
// Language → extension mapping for standard linters
const LANGUAGE_EXTENSIONS = {
    javascript: ['.js', '.jsx', '.mjs', '.cjs'],
    typescript: ['.ts', '.tsx', '.mts', '.cts'],
    python: ['.py', '.pyi'],
    go: ['.go'],
    rust: ['.rs'],
    java: ['.java'],
    c: ['.c', '.h'],
    cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
    ruby: ['.rb'],
    shell: ['.sh', '.bash'],
};
// Default configuration
const DEFAULT_LINTER_CONFIG = {
    enabled: true,
    autoRunOnChange: false,
    autoFix: false,
    failOnError: true,
    timeout: 60_000,
    excludePatterns: [
        'node_modules/**',
        '.git/**',
        'dist/**',
        'build/**',
        '__pycache__/**',
        'target/**',
        '.next/**',
        'vendor/**',
    ],
};
// -----------------------------------------------------------
// LintingIntegration class
// -----------------------------------------------------------
export class LintingIntegration {
    config;
    projectRoot;
    detectedLinters = new Map();
    detectedFormatter = null;
    cachedIssues = [];
    callbacks = [];
    lintersDetected = false;
    constructor(projectRoot, config) {
        this.projectRoot = projectRoot ?? process.cwd();
        this.config = { ...DEFAULT_LINTER_CONFIG, ...config };
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Run linter on a specific file or the entire project.
     * Returns a LintResult with all detected issues.
     */
    async runLint(filePath, fix) {
        if (!this.config.enabled) {
            return this.emptyResult('disabled');
        }
        this.ensureDetected();
        if (this.detectedLinters.size === 0) {
            return this.emptyResult('none');
        }
        const shouldFix = fix ?? this.config.autoFix;
        const startTime = Date.now();
        let allIssues = [];
        let totalFixed = 0;
        let totalFiles = 0;
        let primaryLinter = '';
        for (const [name, linter] of this.detectedLinters) {
            // Determine which command to use
            let commandParts;
            if (shouldFix && linter.commands.fix) {
                commandParts = [...linter.commands.fix];
            }
            else {
                commandParts = [...linter.commands.lint];
            }
            // Append file path if provided
            if (filePath) {
                commandParts.push(resolve(this.projectRoot, filePath));
            }
            // Add exclude patterns
            for (const pattern of this.config.excludePatterns) {
                if (name === 'eslint') {
                    commandParts.push('--ignore-pattern', pattern);
                }
                else if (name === 'ruff') {
                    // Ruff uses different exclude syntax
                }
            }
            try {
                const { stdout, stderr, exitCode } = await this.execCommand(commandParts, this.projectRoot, this.config.timeout);
                const issues = linter.parseOutput(stdout, stderr, this.projectRoot);
                allIssues = allIssues.concat(issues);
                totalFiles += this.countLintedFiles(issues);
                if (!primaryLinter)
                    primaryLinter = name;
                // If fixing, count how many were auto-fixed
                if (shouldFix) {
                    const preFixCount = this.cachedIssues.filter(i => i.fixable).length;
                    totalFixed += Math.max(0, preFixCount - issues.length);
                }
            }
            catch (error) {
                // Linter may exit with non-zero when issues found — that's expected
                if (error instanceof Error && 'stdout' in error) {
                    const execErr = error;
                    if (execErr.stdout) {
                        const issues = linter.parseOutput(execErr.stdout, execErr.stderr ?? '', this.projectRoot);
                        allIssues = allIssues.concat(issues);
                        totalFiles += this.countLintedFiles(issues);
                        if (!primaryLinter)
                            primaryLinter = name;
                    }
                }
                // Silently skip linters that fail to execute
            }
        }
        // Filter by exclude patterns
        allIssues = this.filterExcludedIssues(allIssues);
        const duration = Date.now() - startTime;
        this.cachedIssues = allIssues;
        const result = {
            success: allIssues.filter(i => i.severity === 'error').length === 0,
            issues: allIssues,
            fixed: totalFixed,
            totalFiles,
            duration,
            linter: primaryLinter || 'unknown',
        };
        this.emit(result);
        return result;
    }
    /**
     * Detect which linters are configured in the project root.
     * Returns an array of detected linter names.
     */
    detectLinter(projectRoot) {
        const root = projectRoot ?? this.projectRoot;
        const detected = [];
        for (const linter of LINTERS) {
            const hasConfig = linter.configFiles.some(cfg => existsSync(join(root, cfg)));
            // Also check if the linter binary is available
            const hasBinary = this.isCommandAvailable(linter.commands.lint[0]);
            if (hasConfig || hasBinary) {
                detected.push(linter.name);
                this.detectedLinters.set(linter.name, linter);
            }
        }
        // If no linters found but has package.json, assume ESLint for JS projects
        if (detected.length === 0 && existsSync(join(root, 'package.json'))) {
            const defaultEslint = LINTERS.find(l => l.name === 'eslint');
            this.detectedLinters.set('eslint', defaultEslint);
            detected.push('eslint');
        }
        this.lintersDetected = true;
        return detected;
    }
    /**
     * Auto-fix linting issues for a specific file or the entire project.
     */
    async fixIssues(filePath) {
        return this.runLint(filePath, true);
    }
    /**
     * Get all current lint issues, optionally filtered by file.
     * If no cached issues exist, runs the linter first.
     */
    async getIssues(filePath) {
        if (this.cachedIssues.length === 0) {
            await this.runLint(filePath);
        }
        if (filePath) {
            const absPath = resolve(this.projectRoot, filePath);
            return this.cachedIssues.filter(i => resolve(this.projectRoot, i.file) === absPath);
        }
        return [...this.cachedIssues];
    }
    /**
     * Format a file using the project's configured formatter.
     * Returns true if formatting succeeded.
     */
    async formatFile(filePath) {
        this.ensureDetected();
        const formatter = this.detectFormatter(this.projectRoot);
        if (!formatter) {
            return false;
        }
        const ext = extname(filePath);
        if (formatter.extensions.length > 0 && !formatter.extensions.includes(ext)) {
            return false;
        }
        const commandParts = [...formatter.command, resolve(this.projectRoot, filePath)];
        try {
            await this.execCommand(commandParts, this.projectRoot, this.config.timeout);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Detect the configured formatter for the project.
     * Returns the FormatterInfo or null if none found.
     */
    detectFormatter(projectRoot) {
        const root = projectRoot ?? this.projectRoot;
        for (const formatter of FORMATTERS) {
            const hasConfig = formatter.configFiles.some(cfg => existsSync(join(root, cfg)));
            const hasBinary = this.isCommandAvailable(formatter.command[0]);
            if (hasConfig || hasBinary) {
                this.detectedFormatter = formatter;
                return formatter;
            }
        }
        return null;
    }
    /**
     * Register a callback for lint results.
     */
    onLintResult(callback) {
        this.callbacks.push(callback);
    }
    /**
     * Remove a previously registered callback.
     */
    offLintResult(callback) {
        this.callbacks = this.callbacks.filter(cb => cb !== callback);
    }
    /**
     * Get the current linter configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update the linter configuration.
     */
    updateConfig(updates) {
        Object.assign(this.config, updates);
    }
    /**
     * Clear the cached issues.
     */
    clearCache() {
        this.cachedIssues = [];
    }
    /**
     * Get the list of detected linter names.
     */
    getDetectedLinters() {
        this.ensureDetected();
        return Array.from(this.detectedLinters.keys());
    }
    /**
     * Get the detected formatter name, or null.
     */
    getDetectedFormatter() {
        return this.detectedFormatter?.name ?? null;
    }
    /**
     * Determine the primary language of a file based on its extension.
     */
    getLanguageForFile(filePath) {
        const ext = extname(filePath).toLowerCase();
        for (const [lang, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
            if (extensions.includes(ext))
                return lang;
        }
        return null;
    }
    /**
     * Check if a specific linter is available and configured.
     */
    isLinterAvailable(linterName) {
        this.ensureDetected();
        return this.detectedLinters.has(linterName);
    }
    /**
     * Print a summary of lint results.
     */
    printSummary(result) {
        const errors = result.issues.filter(i => i.severity === 'error').length;
        const warnings = result.issues.filter(i => i.severity === 'warning').length;
        const infos = result.issues.filter(i => i.severity === 'info').length;
        console.log('');
        console.log('--- Lint Summary ---');
        console.log(`  Linter:    ${result.linter}`);
        console.log(`  Duration:  ${result.duration}ms`);
        console.log(`  Files:     ${result.totalFiles}`);
        console.log(`  Errors:    ${errors}`);
        console.log(`  Warnings:  ${warnings}`);
        console.log(`  Info:      ${infos}`);
        if (result.fixed > 0) {
            console.log(`  Auto-fixed:${result.fixed}`);
        }
        console.log(`  Status:    ${result.success ? 'PASS' : 'FAIL'}`);
        console.log('');
        // Group issues by file
        const byFile = new Map();
        for (const issue of result.issues) {
            const arr = byFile.get(issue.file) ?? [];
            arr.push(issue);
            byFile.set(issue.file, arr);
        }
        if (byFile.size > 0) {
            for (const [file, issues] of byFile) {
                console.log(`  ${file}:`);
                for (const issue of issues.slice(0, 20)) {
                    const sevLabel = issue.severity === 'error'
                        ? 'E'
                        : issue.severity === 'warning'
                            ? 'W'
                            : 'I';
                    console.log(`    ${sevLabel}  ${issue.line}:${issue.column}  ${issue.rule} — ${issue.message}${issue.fixable ? ' [fixable]' : ''}`);
                }
                if (issues.length > 20) {
                    console.log(`    ... and ${issues.length - 20} more`);
                }
            }
            console.log('');
        }
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    ensureDetected() {
        if (!this.lintersDetected) {
            this.detectLinter(this.projectRoot);
        }
    }
    emit(result) {
        for (const cb of this.callbacks) {
            try {
                cb(result);
            }
            catch {
                // Callback errors should not interrupt the flow
            }
        }
    }
    emptyResult(reason) {
        return {
            success: reason !== 'fail',
            issues: [],
            fixed: 0,
            totalFiles: 0,
            duration: 0,
            linter: reason,
        };
    }
    countLintedFiles(issues) {
        const uniqueFiles = new Set(issues.map(i => i.file));
        return uniqueFiles.size;
    }
    filterExcludedIssues(issues) {
        if (this.config.excludePatterns.length === 0)
            return issues;
        return issues.filter(issue => {
            for (const pattern of this.config.excludePatterns) {
                const globRegex = this.globToRegex(pattern);
                if (globRegex.test(issue.file))
                    return false;
            }
            return true;
        });
    }
    globToRegex(pattern) {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '{{GLOBSTAR}}')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')
            .replace(/\{\{GLOBSTAR\}\}/g, '.*');
        return new RegExp('^' + escaped + '$');
    }
    /**
     * Execute a command and return its output.
     * Rejects on spawn errors; resolves with stdout/stderr even on non-zero exit.
     */
    execCommand(commandParts, cwd, timeout) {
        return new Promise((resolve, reject) => {
            const [cmd, ...args] = commandParts;
            try {
                const result = execSync(`${cmd} ${args.map(a => `"${a}"`).join(' ')}`, {
                    cwd,
                    timeout,
                    encoding: 'utf-8',
                    maxBuffer: 50 * 1024 * 1024,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                resolve({ stdout: result, stderr: '', exitCode: 0 });
            }
            catch (error) {
                const execError = error;
                // Non-zero exit code from linter is normal (issues found)
                if (execError.stdout || execError.stderr) {
                    resolve({
                        stdout: typeof execError.stdout === 'string' ? execError.stdout : (execError.stdout?.toString('utf-8') ?? ''),
                        stderr: typeof execError.stderr === 'string' ? execError.stderr : (execError.stderr?.toString('utf-8') ?? ''),
                        exitCode: execError.status ?? 1,
                    });
                }
                else {
                    reject(error);
                }
            }
        });
    }
    /**
     * Check if a command-line tool is available on the system PATH.
     */
    isCommandAvailable(command) {
        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? `where ${command}` : `which ${command} 2>/dev/null`;
            execSync(checkCmd, { encoding: 'utf-8', timeout: 5_000, stdio: 'pipe' });
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=linting.js.map
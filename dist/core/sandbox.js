// ============================================================
// NeuroCLI - Sandbox Mode
// File isolation and safe execution environment
// Prevents modifications outside the project directory
// ============================================================
import { join, resolve, relative, normalize } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import chalk from 'chalk';
export const DEFAULT_SANDBOX_CONFIG = {
    enabled: false,
    rootDir: process.cwd(),
    allowedDirs: [],
    deniedDirs: [
        'node_modules',
        '.git',
        '__pycache__',
        '.env',
    ],
    deniedPatterns: [
        '**/.env',
        '**/.env.*',
        '**/id_rsa*',
        '**/id_ed25519*',
        '**/*.pem',
        '**/*.key',
        '**/credentials.json',
        '**/secrets.*',
    ],
    allowCommands: true,
    allowedCommands: [],
    deniedCommands: [
        'rm -rf /',
        'sudo rm',
        'mkfs',
        'dd if=',
        ':(){ :|:& };:', // fork bomb
        'chmod 777 /',
        'curl | sh',
        'wget | sh',
    ],
    backupOnModify: true,
    backupDir: '.neuro/backups',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowNetwork: true,
    allowEnvAccess: false,
    readOnly: false,
};
export class Sandbox {
    config;
    violations = [];
    backups = new Map(); // original path -> backup path
    originalContents = new Map(); // for undo
    constructor(config) {
        this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
        if (!this.config.rootDir)
            this.config.rootDir = process.cwd();
        this.config.rootDir = resolve(this.config.rootDir);
    }
    /**
     * Check if a file path is allowed for reading
     */
    canRead(filePath) {
        if (!this.config.enabled)
            return true;
        const absPath = this.resolvePath(filePath);
        // Check denied dirs
        if (this.isInDeniedDir(absPath)) {
            this.recordViolation('file_read', absPath, 'Access denied: path is in a denied directory');
            return false;
        }
        // Check denied patterns
        if (this.matchesDeniedPattern(absPath)) {
            this.recordViolation('file_read', absPath, 'Access denied: path matches a denied pattern');
            return false;
        }
        return true;
    }
    /**
     * Check if a file path is allowed for writing
     */
    canWrite(filePath, contentSize) {
        if (!this.config.enabled)
            return true;
        if (this.config.readOnly) {
            this.recordViolation('file_write', this.resolvePath(filePath), 'Write denied: sandbox is in read-only mode');
            return false;
        }
        const absPath = this.resolvePath(filePath);
        // Must be under rootDir
        if (!this.isUnderRootDir(absPath)) {
            this.recordViolation('file_write', absPath, `Write denied: path is outside project directory (${this.config.rootDir})`);
            return false;
        }
        // Check denied dirs
        if (this.isInDeniedDir(absPath)) {
            this.recordViolation('file_write', absPath, 'Write denied: path is in a denied directory');
            return false;
        }
        // Check denied patterns
        if (this.matchesDeniedPattern(absPath)) {
            this.recordViolation('file_write', absPath, 'Write denied: path matches a denied pattern');
            return false;
        }
        // Check file size
        if (contentSize !== undefined && contentSize > this.config.maxFileSize) {
            this.recordViolation('file_write', absPath, `Write denied: file size (${contentSize} bytes) exceeds maximum (${this.config.maxFileSize} bytes)`);
            return false;
        }
        return true;
    }
    /**
     * Check if a file can be deleted
     */
    canDelete(filePath) {
        if (!this.config.enabled)
            return true;
        if (this.config.readOnly) {
            this.recordViolation('file_delete', this.resolvePath(filePath), 'Delete denied: sandbox is in read-only mode');
            return false;
        }
        const absPath = this.resolvePath(filePath);
        if (!this.isUnderRootDir(absPath)) {
            this.recordViolation('file_delete', absPath, 'Delete denied: path is outside project directory');
            return false;
        }
        if (this.isInDeniedDir(absPath)) {
            this.recordViolation('file_delete', absPath, 'Delete denied: path is in a denied directory');
            return false;
        }
        return true;
    }
    /**
     * Check if a command is allowed
     */
    canRunCommand(command) {
        if (!this.config.enabled)
            return true;
        if (!this.config.allowCommands) {
            this.recordViolation('command', undefined, `Command denied: command execution is disabled`);
            return false;
        }
        // Check denied commands
        const cmdBase = command.trim().split(/\s+/)[0];
        for (const denied of this.config.deniedCommands) {
            if (command.includes(denied) || cmdBase === denied.split(' ')[0]) {
                this.recordViolation('command', undefined, `Command denied: matches denied pattern "${denied}"`);
                return false;
            }
        }
        // Check allowed commands whitelist (if set)
        if (this.config.allowedCommands.length > 0) {
            const isAllowed = this.config.allowedCommands.some(allowed => cmdBase === allowed || command.startsWith(allowed));
            if (!isAllowed) {
                this.recordViolation('command', undefined, `Command denied: "${cmdBase}" is not in the allowed commands list`);
                return false;
            }
        }
        return true;
    }
    /**
     * Check if network access is allowed
     */
    canAccessNetwork() {
        if (!this.config.enabled)
            return true;
        if (!this.config.allowNetwork) {
            this.recordViolation('network', undefined, 'Network access denied');
            return false;
        }
        return true;
    }
    /**
     * Check if environment variable access is allowed
     */
    canAccessEnv() {
        if (!this.config.enabled)
            return true;
        if (!this.config.allowEnvAccess) {
            this.recordViolation('env', undefined, 'Environment variable access denied');
            return false;
        }
        return true;
    }
    /**
     * Create a backup of a file before modification
     */
    backupFile(filePath) {
        if (!this.config.backupOnModify)
            return true;
        const absPath = this.resolvePath(filePath);
        if (!existsSync(absPath))
            return true;
        try {
            const backupDir = join(this.config.rootDir, this.config.backupDir);
            if (!existsSync(backupDir))
                mkdirSync(backupDir, { recursive: true });
            const relPath = relative(this.config.rootDir, absPath);
            const backupPath = join(backupDir, `${Date.now()}_${relPath.replace(/\//g, '_')}`);
            copyFileSync(absPath, backupPath);
            this.backups.set(absPath, backupPath);
            // Store original content for undo
            const content = readFileSync(absPath, 'utf-8');
            this.originalContents.set(absPath, content);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Undo a file modification by restoring from backup
     */
    undoFile(filePath) {
        const absPath = this.resolvePath(filePath);
        const originalContent = this.originalContents.get(absPath);
        if (originalContent === undefined)
            return false;
        try {
            writeFileSync(absPath, originalContent, 'utf-8');
            this.originalContents.delete(absPath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Undo all modifications made in this session
     */
    undoAll() {
        let undone = 0;
        for (const [path] of this.originalContents) {
            if (this.undoFile(path))
                undone++;
        }
        return undone;
    }
    /**
     * Get all violations recorded
     */
    getViolations() {
        return [...this.violations];
    }
    /**
     * Get the number of violations
     */
    getViolationCount() {
        return this.violations.length;
    }
    /**
     * Clear all violations
     */
    clearViolations() {
        this.violations = [];
    }
    /**
     * Enable sandbox mode
     */
    enable() {
        this.config.enabled = true;
    }
    /**
     * Disable sandbox mode
     */
    disable() {
        this.config.enabled = false;
    }
    /**
     * Check if sandbox is enabled
     */
    isEnabled() {
        return this.config.enabled;
    }
    /**
     * Toggle sandbox mode
     */
    toggle() {
        this.config.enabled = !this.config.enabled;
        return this.config.enabled;
    }
    /**
     * Get current sandbox configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update sandbox configuration
     */
    updateConfig(updates) {
        Object.assign(this.config, updates);
    }
    /**
     * Print sandbox status
     */
    printStatus() {
        const status = this.config.enabled ? chalk.green('ENABLED') : chalk.gray('DISABLED');
        console.log(chalk.bold(`\n  Sandbox: ${status}`));
        if (this.config.enabled) {
            console.log(`  Root: ${chalk.cyan(this.config.rootDir)}`);
            console.log(`  Read-only: ${this.config.readOnly ? chalk.red('YES') : chalk.green('NO')}`);
            console.log(`  Commands: ${this.config.allowCommands ? chalk.green('allowed') : chalk.red('denied')}`);
            console.log(`  Network: ${this.config.allowNetwork ? chalk.green('allowed') : chalk.red('denied')}`);
            console.log(`  Backups: ${this.config.backupOnModify ? chalk.green('enabled') : chalk.gray('disabled')}`);
            console.log(`  Denied dirs: ${this.config.deniedDirs.length > 0 ? chalk.yellow(this.config.deniedDirs.join(', ')) : chalk.gray('none')}`);
            console.log(`  Denied patterns: ${this.config.deniedPatterns.length > 0 ? chalk.yellow(this.config.deniedPatterns.length + ' patterns') : chalk.gray('none')}`);
            if (this.violations.length > 0) {
                console.log(`  Violations: ${chalk.red(String(this.violations.length))}`);
            }
        }
        console.log();
    }
    // --- Private Helpers ---
    resolvePath(filePath) {
        if (filePath.startsWith('/'))
            return normalize(filePath);
        if (filePath.startsWith('~/'))
            return normalize(join(require('os').homedir(), filePath.slice(2)));
        return normalize(resolve(this.config.rootDir, filePath));
    }
    isUnderRootDir(absPath) {
        const relativePath = relative(this.config.rootDir, absPath);
        return !relativePath.startsWith('..') && !relativePath.startsWith('/');
    }
    isInDeniedDir(absPath) {
        const relativePath = relative(this.config.rootDir, absPath);
        // Check built-in denied dirs
        for (const deniedDir of this.config.deniedDirs) {
            if (relativePath.startsWith(deniedDir + '/') || relativePath === deniedDir) {
                return true;
            }
        }
        // Check custom allowed dirs (everything else is under rootDir)
        // If allowedDirs is set, deny anything not in those dirs
        if (this.config.allowedDirs.length > 0) {
            const inAllowed = this.config.allowedDirs.some(allowedDir => {
                const absAllowed = resolve(this.config.rootDir, allowedDir);
                return absPath.startsWith(absAllowed);
            });
            if (!inAllowed && this.isUnderRootDir(absPath))
                return false; // Under root but not in allowed
        }
        return false;
    }
    matchesDeniedPattern(absPath) {
        const relativePath = relative(this.config.rootDir, absPath);
        for (const pattern of this.config.deniedPatterns) {
            const globPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
            try {
                const regex = new RegExp('^' + globPattern + '$');
                if (regex.test(relativePath) || regex.test(absPath))
                    return true;
            }
            catch {
                // Invalid pattern, skip
            }
        }
        return false;
    }
    recordViolation(type, path, reason) {
        this.violations.push({
            type,
            path,
            reason: reason || 'Access denied by sandbox',
            timestamp: Date.now(),
        });
    }
}
//# sourceMappingURL=sandbox.js.map
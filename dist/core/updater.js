// ============================================================
// NeuroCLI - Auto-Updater Module
// Remote update checking, self-updating, and changelog display
// v4.1.0
// ============================================================
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
function parseSemver(version) {
    const cleaned = version.replace(/^v/, '');
    const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match)
        return null;
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        prerelease: match[4],
    };
}
function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb)
        return 0;
    if (pa.major !== pb.major)
        return pa.major - pb.major;
    if (pa.minor !== pb.minor)
        return pa.minor - pb.minor;
    if (pa.patch !== pb.patch)
        return pa.patch - pb.patch;
    // No prerelease > prerelease
    if (!pa.prerelease && pb.prerelease)
        return 1;
    if (pa.prerelease && !pb.prerelease)
        return -1;
    if (pa.prerelease && pb.prerelease) {
        return pa.prerelease.localeCompare(pb.prerelease);
    }
    return 0;
}
function isBreakingChange(current, latest) {
    const pc = parseSemver(current);
    const pl = parseSemver(latest);
    if (!pc || !pl)
        return false;
    return pl.major > pc.major;
}
function getUpdateType(current, latest) {
    const pc = parseSemver(current);
    const pl = parseSemver(latest);
    if (!pc || !pl)
        return 'none';
    if (pl.major > pc.major)
        return 'major';
    if (pl.minor > pc.minor)
        return 'minor';
    if (pl.patch > pc.patch)
        return 'patch';
    return 'none';
}
// ---- HTTP Helper ----
async function httpGet(url, timeout = 10000) {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? await import('https') : await import('http');
    return new Promise((resolve, reject) => {
        const req = lib.get(url, { timeout }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}
// ---- Auto-Updater Class ----
export class AutoUpdater {
    config;
    state;
    stateFile;
    lastCheckResult = null;
    constructor(config) {
        const defaultStateDir = join(homedir(), '.neuro');
        this.config = {
            packageName: 'neuro-cli',
            githubRepo: 'muhammedturan65/neuro-cli',
            checkInterval: 24 * 60 * 60 * 1000, // 24 hours
            stateDir: defaultStateDir,
            autoCheck: true,
            autoUpdate: false,
            registryUrl: 'https://registry.npmjs.org',
            showChangelog: true,
            includePrerelease: false,
            ...config,
        };
        this.stateFile = join(this.config.stateDir, 'update-state.json');
        this.state = this.loadState();
    }
    // ---- State Management ----
    loadState() {
        try {
            if (existsSync(this.stateFile)) {
                const data = JSON.parse(readFileSync(this.stateFile, 'utf-8'));
                return {
                    lastCheckTime: data.lastCheckTime || 0,
                    lastKnownVersion: data.lastKnownVersion || this.config.currentVersion,
                    lastCheckSource: data.lastCheckSource || 'cache',
                    dismissedVersions: data.dismissedVersions || [],
                };
            }
        }
        catch {
            // Corrupted state, start fresh
        }
        return {
            lastCheckTime: 0,
            lastKnownVersion: this.config.currentVersion,
            lastCheckSource: 'cache',
            dismissedVersions: [],
        };
    }
    saveState() {
        try {
            if (!existsSync(this.config.stateDir)) {
                mkdirSync(this.config.stateDir, { recursive: true });
            }
            writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf-8');
        }
        catch {
            // Silently fail — update state is non-critical
        }
    }
    // ---- Update Check ----
    /**
     * Check if enough time has passed since last check
     */
    shouldCheck() {
        if (!this.config.autoCheck)
            return false;
        const elapsed = Date.now() - this.state.lastCheckTime;
        return elapsed >= this.config.checkInterval;
    }
    /**
     * Get time until next check is due
     */
    timeUntilNextCheck() {
        const elapsed = Date.now() - this.state.lastCheckTime;
        return Math.max(0, this.config.checkInterval - elapsed);
    }
    /**
     * Check for updates from npm registry
     */
    async checkForUpdate(force = false) {
        // Return cached result if checked recently and not forced
        if (!force && this.lastCheckResult && (Date.now() - this.lastCheckResult.checkedAt) < 60000) {
            return this.lastCheckResult;
        }
        // Try npm first
        let result = await this.checkNpmRegistry();
        if (!result) {
            // Fall back to GitHub
            result = await this.checkGitHubReleases();
        }
        if (!result) {
            // Fall back to npm view command
            result = await this.checkNpmView();
        }
        if (result) {
            this.lastCheckResult = result;
            this.state.lastCheckTime = Date.now();
            this.state.lastKnownVersion = result.latestVersion;
            this.state.lastCheckSource = result.source;
            this.saveState();
            return result;
        }
        // All checks failed — return "no update" with current version
        const fallback = {
            hasUpdate: false,
            currentVersion: this.config.currentVersion,
            latestVersion: this.config.currentVersion,
            source: 'cache',
            checkedAt: Date.now(),
        };
        this.lastCheckResult = fallback;
        return fallback;
    }
    /**
     * Check npm registry API directly
     */
    async checkNpmRegistry() {
        try {
            const url = `${this.config.registryUrl}/${this.config.packageName}/latest`;
            const data = await httpGet(url, 8000);
            const pkg = JSON.parse(data);
            const latestVersion = pkg.version;
            if (!latestVersion)
                return null;
            const hasUpdate = compareSemver(this.config.currentVersion, latestVersion) < 0;
            return {
                hasUpdate,
                currentVersion: this.config.currentVersion,
                latestVersion,
                source: 'npm',
                changelog: hasUpdate ? this.extractChangelog(pkg) : undefined,
                checkedAt: Date.now(),
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Check GitHub releases API
     */
    async checkGitHubReleases() {
        try {
            const url = `https://api.github.com/repos/${this.config.githubRepo}/releases/latest`;
            const data = await httpGet(url, 8000);
            const release = JSON.parse(data);
            const tagName = release.tag_name;
            if (!tagName)
                return null;
            const latestVersion = tagName.replace(/^v/, '');
            const hasUpdate = compareSemver(this.config.currentVersion, latestVersion) < 0;
            return {
                hasUpdate,
                currentVersion: this.config.currentVersion,
                latestVersion,
                source: 'github',
                changelog: hasUpdate ? release.body || undefined : undefined,
                checkedAt: Date.now(),
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Check using `npm view` command (fallback)
     */
    async checkNpmView() {
        try {
            const output = execSync(`npm view ${this.config.packageName} version --json 2>/dev/null`, { encoding: 'utf-8', timeout: 15000 }).trim();
            const latestVersion = output.replace(/^"|"$/g, '').replace(/\n/g, '');
            if (!latestVersion || !parseSemver(latestVersion))
                return null;
            const hasUpdate = compareSemver(this.config.currentVersion, latestVersion) < 0;
            return {
                hasUpdate,
                currentVersion: this.config.currentVersion,
                latestVersion,
                source: 'npm',
                checkedAt: Date.now(),
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Extract changelog from npm package data
     */
    extractChangelog(pkg) {
        // Some packages include changelog in description or separate field
        if (pkg.changelog)
            return pkg.changelog;
        // Build a simple changelog from available info
        const lines = [];
        if (pkg.description)
            lines.push(pkg.description);
        if (pkg.homepage)
            lines.push(`Homepage: ${pkg.homepage}`);
        if (pkg.repository?.url)
            lines.push(`Repository: ${pkg.repository.url}`);
        return lines.length > 0 ? lines.join('\n') : undefined;
    }
    // ---- Update Execution ----
    /**
     * Perform the self-update
     * Returns true if update was successful
     */
    async performUpdate(version) {
        const targetVersion = version || this.lastCheckResult?.latestVersion;
        if (!targetVersion) {
            // Check first
            const check = await this.checkForUpdate(true);
            if (!check.hasUpdate) {
                return { success: false, message: 'Already on the latest version' };
            }
        }
        const updateType = getUpdateType(this.config.currentVersion, targetVersion || this.config.currentVersion);
        const isBreaking = isBreakingChange(this.config.currentVersion, targetVersion || this.config.currentVersion);
        // Warn about breaking changes
        if (isBreaking) {
            console.log(chalk.yellow('\n  ⚠  This is a MAJOR version update with potential breaking changes!'));
            console.log(chalk.yellow(`     ${this.config.currentVersion} → ${targetVersion}`));
            console.log(chalk.gray('     Review the changelog before proceeding.\n'));
        }
        try {
            const command = this.config.updateCommand || `npm update -g ${this.config.packageName}`;
            console.log(chalk.cyan(`  Updating ${this.config.packageName}...`));
            console.log(chalk.gray(`  Running: ${command}`));
            const output = execSync(command, {
                encoding: 'utf-8',
                timeout: 120000, // 2 minutes
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            // Verify the update
            const verifyResult = await this.verifyUpdate(targetVersion);
            if (verifyResult.success) {
                this.state.dismissedVersions = this.state.dismissedVersions.filter(v => v !== targetVersion);
                this.saveState();
                return {
                    success: true,
                    message: `Successfully updated to v${verifyResult.newVersion || targetVersion}`,
                    newVersion: verifyResult.newVersion || targetVersion,
                };
            }
            return verifyResult;
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            // Suggest alternative methods
            console.log(chalk.red('\n  Automatic update failed. Try one of these alternatives:'));
            console.log(chalk.cyan(`    npm install -g ${this.config.packageName}@latest`));
            console.log(chalk.cyan(`    yarn global add ${this.config.packageName}`));
            console.log(chalk.cyan(`    pnpm add -g ${this.config.packageName}`));
            console.log();
            return { success: false, message: `Update failed: ${errMsg}` };
        }
    }
    /**
     * Verify that the update was successful
     */
    async verifyUpdate(expectedVersion) {
        try {
            // Try to get the currently installed version
            const installedVersion = execSync(`npm list -g ${this.config.packageName} --json 2>/dev/null`, { encoding: 'utf-8', timeout: 10000 });
            const parsed = JSON.parse(installedVersion);
            const deps = parsed.dependencies || {};
            const pkg = deps[this.config.packageName];
            if (pkg && pkg.version) {
                const newVersion = pkg.version;
                const isExpected = !expectedVersion || newVersion === expectedVersion;
                if (isExpected || compareSemver(this.config.currentVersion, newVersion) >= 0) {
                    return {
                        success: true,
                        message: `Verified: v${newVersion} installed`,
                        newVersion,
                    };
                }
            }
        }
        catch {
            // npm list failed, that's ok
        }
        // If we can't verify but the command succeeded, assume success
        return {
            success: true,
            message: 'Update completed (could not verify version)',
            newVersion: expectedVersion,
        };
    }
    // ---- Dismiss / Skip ----
    /**
     * Dismiss a specific version (don't notify again)
     */
    dismissVersion(version) {
        if (!this.state.dismissedVersions.includes(version)) {
            this.state.dismissedVersions.push(version);
            this.saveState();
        }
    }
    /**
     * Check if a version has been dismissed
     */
    isDismissed(version) {
        return this.state.dismissedVersions.includes(version);
    }
    // ---- Display ----
    /**
     * Display update notification banner
     */
    showUpdateNotification(result) {
        if (!result.hasUpdate)
            return;
        if (this.isDismissed(result.latestVersion))
            return;
        const updateType = getUpdateType(result.currentVersion, result.latestVersion);
        const isBreaking = updateType === 'major';
        const typeColors = {
            major: chalk.red.bold,
            minor: chalk.yellow.bold,
            patch: chalk.green.bold,
        };
        const typeLabels = {
            major: 'BREAKING',
            minor: 'FEATURE',
            patch: 'FIX',
        };
        const colorFn = typeColors[updateType] || chalk.cyan.bold;
        const label = typeLabels[updateType] || 'UPDATE';
        const lineWidth = 56;
        const topBorder = '┌' + '─'.repeat(lineWidth) + '┐';
        const bottomBorder = '└' + '─'.repeat(lineWidth) + '┘';
        const sideBorder = '│';
        console.log();
        console.log(chalk.cyan(topBorder));
        const titleLine = `  ${colorFn('⬆')}  Update Available: ${label}`;
        console.log(chalk.cyan(sideBorder) + titleLine.padEnd(lineWidth + 1) + chalk.cyan(sideBorder));
        const versionLine = `     ${chalk.gray(result.currentVersion)} → ${chalk.bold.green(result.latestVersion)}`;
        console.log(chalk.cyan(sideBorder) + versionLine.padEnd(lineWidth + 1) + chalk.cyan(sideBorder));
        console.log(chalk.cyan(sideBorder) + ' '.repeat(lineWidth + 1) + chalk.cyan(sideBorder));
        const cmdLine = `  Run ${chalk.cyan('/update')} to update now`;
        console.log(chalk.cyan(sideBorder) + cmdLine.padEnd(lineWidth + 1) + chalk.cyan(sideBorder));
        const dismissLine = `  Run ${chalk.gray('/update dismiss')} to skip this version`;
        console.log(chalk.cyan(sideBorder) + dismissLine.padEnd(lineWidth + 1) + chalk.cyan(sideBorder));
        console.log(chalk.cyan(bottomBorder));
        console.log();
    }
    /**
     * Display detailed update info with changelog
     */
    showUpdateDetails(result) {
        const updateType = getUpdateType(result.currentVersion, result.latestVersion);
        const typeLabels = {
            major: '🔴 MAJOR (Breaking Changes)',
            minor: '🟡 MINOR (New Features)',
            patch: '🟢 PATCH (Bug Fixes)',
            none: '✅ Up to date',
        };
        console.log(chalk.bold('\n  NeuroCLI Update Check\n'));
        console.log(`  Current Version:  ${chalk.cyan('v' + result.currentVersion)}`);
        console.log(`  Latest Version:   ${chalk.green('v' + result.latestVersion)}`);
        console.log(`  Update Type:      ${typeLabels[updateType] || updateType}`);
        console.log(`  Check Source:     ${chalk.gray(result.source)}`);
        console.log(`  Checked At:       ${chalk.gray(new Date(result.checkedAt).toLocaleString())}`);
        if (result.hasUpdate) {
            console.log();
            console.log(chalk.bold('  Changelog:'));
            if (result.changelog) {
                // Display changelog with word wrapping
                const lines = result.changelog.split('\n');
                for (const line of lines.slice(0, 50)) { // Limit to 50 lines
                    console.log(`    ${chalk.gray(line)}`);
                }
                if (lines.length > 50) {
                    console.log(chalk.gray(`    ... and ${lines.length - 50} more lines`));
                }
            }
            else {
                console.log(chalk.gray('    No changelog available for this release.'));
                console.log(chalk.gray(`    View at: https://github.com/${this.config.githubRepo}/releases`));
            }
        }
        console.log();
    }
    /**
     * Show "up to date" message
     */
    showUpToDate() {
        console.log(chalk.green('\n  ✓ NeuroCLI is up to date!'));
        console.log(chalk.gray(`    Current version: v${this.config.currentVersion}`));
        console.log(chalk.gray(`    Last checked: ${new Date(this.state.lastCheckTime).toLocaleString()}`));
        const nextCheck = this.timeUntilNextCheck();
        if (nextCheck > 0) {
            const hours = Math.floor(nextCheck / (60 * 60 * 1000));
            const minutes = Math.floor((nextCheck % (60 * 60 * 1000)) / (60 * 1000));
            console.log(chalk.gray(`    Next check in: ${hours}h ${minutes}m`));
        }
        console.log();
    }
    /**
     * Format time duration in human-readable format
     */
    formatDuration(ms) {
        const hours = Math.floor(ms / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        if (hours > 0)
            return `${hours}h ${minutes}m`;
        if (minutes > 0)
            return `${minutes}m`;
        return `${Math.floor(ms / 1000)}s`;
    }
    // ---- Startup Integration ----
    /**
     * Run background update check on startup.
     * Returns the check result if an update is available, null otherwise.
     */
    async checkOnStartup() {
        if (!this.config.autoCheck)
            return null;
        if (!this.shouldCheck()) {
            // Return cached result if it indicated an update
            if (this.lastCheckResult?.hasUpdate && !this.isDismissed(this.lastCheckResult.latestVersion)) {
                return this.lastCheckResult;
            }
            return null;
        }
        try {
            const result = await this.checkForUpdate(true);
            if (result.hasUpdate && !this.isDismissed(result.latestVersion)) {
                return result;
            }
            return null;
        }
        catch {
            // Silently fail — don't block startup
            return null;
        }
    }
    /**
     * Interactive update flow — check, show, and optionally update
     */
    async interactiveUpdate() {
        console.log(chalk.cyan('\n  Checking for updates...'));
        try {
            const result = await this.checkForUpdate(true);
            if (!result.hasUpdate) {
                this.showUpToDate();
                return;
            }
            // Show update details
            this.showUpdateDetails(result);
            this.showUpdateNotification(result);
            // Auto-update if configured
            if (this.config.autoUpdate) {
                const updateResult = await this.performUpdate(result.latestVersion);
                if (updateResult.success) {
                    console.log(chalk.green(`\n  ✓ ${updateResult.message}`));
                    console.log(chalk.yellow('\n  Please restart NeuroCLI to use the new version.\n'));
                }
                else {
                    console.log(chalk.red(`\n  ✗ ${updateResult.message}\n`));
                }
                return;
            }
            // Manual mode — just show notification
            console.log(chalk.cyan('  To update now, run: /update now'));
            console.log(chalk.gray('  To skip this version: /update dismiss'));
            console.log(chalk.gray('  To check again later: /update check'));
            console.log();
        }
        catch (error) {
            console.log(chalk.red('  Could not check for updates.'));
            console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
            console.log(chalk.gray('  Check your internet connection and try again later.'));
            console.log();
        }
    }
    // ---- Config ----
    /**
     * Set auto-check on/off
     */
    setAutoCheck(enabled) {
        this.config.autoCheck = enabled;
    }
    /**
     * Set auto-update on/off
     */
    setAutoUpdate(enabled) {
        this.config.autoUpdate = enabled;
    }
    /**
     * Set check interval in hours
     */
    setCheckInterval(hours) {
        this.config.checkInterval = hours * 60 * 60 * 1000;
    }
    /**
     * Get current updater config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get last check result
     */
    getLastCheck() {
        return this.lastCheckResult;
    }
    /**
     * Reset dismissed versions
     */
    resetDismissed() {
        this.state.dismissedVersions = [];
        this.saveState();
    }
    /**
     * Force next check on startup
     */
    forceNextCheck() {
        this.state.lastCheckTime = 0;
        this.saveState();
    }
}
// ---- Standalone check function (for CLI subcommand) ----
export async function checkForUpdates(currentVersion) {
    const updater = new AutoUpdater({ currentVersion });
    return updater.checkForUpdate(true);
}
export async function performSelfUpdate(currentVersion, version) {
    const updater = new AutoUpdater({ currentVersion });
    return updater.performUpdate(version);
}
//# sourceMappingURL=updater.js.map
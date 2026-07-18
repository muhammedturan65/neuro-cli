// ============================================================
// NeuroCLI - Spending Warnings System
// Monitors and alerts about API spending across sessions
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// -----------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------
const SPENDING_DIR = join(homedir(), '.neuro', 'spending');
function todayDateStr() {
    const d = new Date();
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
function defaultConfig() {
    return {
        dailyLimit: 0,
        sessionLimit: 0,
        warnAtPercent: [50, 75, 90],
        autoStopAtLimit: true,
        trackByModel: true,
    };
}
// -----------------------------------------------------------
// SpendingMonitor
// -----------------------------------------------------------
export class SpendingMonitor {
    config;
    sessionEntries;
    todayEntries;
    warnedThresholds;
    dataPath;
    sessionStartTime;
    constructor(config) {
        this.config = { ...defaultConfig(), ...config };
        this.sessionEntries = [];
        this.todayEntries = [];
        this.warnedThresholds = new Set();
        this.sessionStartTime = Date.now();
        // Ensure spending directory exists
        if (!existsSync(SPENDING_DIR)) {
            mkdirSync(SPENDING_DIR, { recursive: true });
        }
        this.dataPath = join(SPENDING_DIR, `${todayDateStr()}.json`);
        this.loadTodayData();
        // Schedule daily reset at midnight
        this.scheduleDailyReset();
    }
    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------
    /**
     * Record a spending entry. Returns whether the spend is allowed
     * and optional warning / limit-reached information.
     */
    record(entry) {
        const fullEntry = {
            ...entry,
            timestamp: Date.now(),
        };
        // Check limits before recording
        const limitCheck = this.checkLimit();
        if (limitCheck.limitReached && this.config.autoStopAtLimit) {
            return {
                allowed: false,
                limitReached: limitCheck.limitReached,
            };
        }
        // Record the entry
        this.sessionEntries.push(fullEntry);
        this.todayEntries.push(fullEntry);
        // Persist today's data
        this.saveTodayData();
        // Evaluate warnings after recording
        const sessionTotal = this.sumCost(this.sessionEntries);
        const todayTotal = this.sumCost(this.todayEntries);
        let warning;
        let limitReached;
        // Check session limit
        if (this.config.sessionLimit > 0) {
            const sessionPercent = (sessionTotal / this.config.sessionLimit) * 100;
            const sessionWarning = this.checkWarnings(sessionPercent, 'session');
            if (sessionWarning)
                warning = sessionWarning;
            if (sessionTotal >= this.config.sessionLimit) {
                limitReached = 'session';
            }
        }
        // Check daily limit (daily takes precedence if both are hit)
        if (this.config.dailyLimit > 0) {
            const dailyPercent = (todayTotal / this.config.dailyLimit) * 100;
            const dailyWarning = this.checkWarnings(dailyPercent, 'daily');
            if (dailyWarning) {
                warning = warning ? `${warning} | ${dailyWarning}` : dailyWarning;
            }
            if (todayTotal >= this.config.dailyLimit) {
                limitReached = 'daily';
            }
        }
        return {
            allowed: !limitReached || !this.config.autoStopAtLimit,
            warning,
            limitReached,
        };
    }
    /**
     * Check whether spending is within limits without recording anything.
     */
    checkLimit() {
        const sessionTotal = this.sumCost(this.sessionEntries);
        const todayTotal = this.sumCost(this.todayEntries);
        let limitReached;
        const sessionRemaining = this.config.sessionLimit > 0
            ? Math.max(0, this.config.sessionLimit - sessionTotal)
            : Infinity;
        const dailyRemaining = this.config.dailyLimit > 0
            ? Math.max(0, this.config.dailyLimit - todayTotal)
            : Infinity;
        if (this.config.sessionLimit > 0 && sessionTotal >= this.config.sessionLimit) {
            limitReached = 'session';
        }
        if (this.config.dailyLimit > 0 && todayTotal >= this.config.dailyLimit) {
            limitReached = 'daily'; // daily takes precedence
        }
        return {
            allowed: !limitReached || !this.config.autoStopAtLimit,
            remaining: { daily: dailyRemaining, session: sessionRemaining },
            limitReached,
        };
    }
    /**
     * Build a full spending report.
     */
    getReport() {
        const todayTotal = this.sumCost(this.todayEntries);
        const sessionTotal = this.sumCost(this.sessionEntries);
        const todayByModel = this.sumByModel(this.todayEntries);
        const sessionByModel = this.sumByModel(this.sessionEntries);
        const dailyPercentUsed = this.config.dailyLimit > 0 ? (todayTotal / this.config.dailyLimit) * 100 : 0;
        const sessionPercentUsed = this.config.sessionLimit > 0 ? (sessionTotal / this.config.sessionLimit) * 100 : 0;
        return {
            todayTotal,
            todayByModel,
            sessionTotal,
            sessionByModel,
            dailyLimit: this.config.dailyLimit,
            sessionLimit: this.config.sessionLimit,
            dailyPercentUsed,
            sessionPercentUsed,
            estimatedDailySpend: this.estimateDailySpend(),
            entries: this.todayEntries.length,
        };
    }
    /**
     * Print a formatted spending report to the terminal.
     */
    printReport() {
        const report = this.getReport();
        const bold = '\x1b[1m';
        const reset = '\x1b[0m';
        const yellow = '\x1b[33m';
        const red = '\x1b[31m';
        const green = '\x1b[32m';
        const cyan = '\x1b[36m';
        const dim = '\x1b[2m';
        console.log('');
        console.log(`${bold}--- NeuroCLI Spending Report ---${reset}`);
        console.log('');
        // Today's total
        const todayColor = report.dailyPercentUsed >= 90 ? red : report.dailyPercentUsed >= 75 ? yellow : green;
        console.log(`  Today's Total:    ${todayColor}$${report.todayTotal.toFixed(4)}${reset}`);
        if (report.dailyLimit > 0) {
            console.log(`  Daily Limit:      $${report.dailyLimit.toFixed(2)} (${todayColor}${report.dailyPercentUsed.toFixed(1)}%${reset} used)`);
            const dailyRemaining = Math.max(0, report.dailyLimit - report.todayTotal);
            console.log(`  Daily Remaining:  $${dailyRemaining.toFixed(4)}`);
        }
        else {
            console.log(`  Daily Limit:      ${dim}unlimited${reset}`);
        }
        console.log('');
        // Session total
        const sessionColor = report.sessionPercentUsed >= 90 ? red : report.sessionPercentUsed >= 75 ? yellow : green;
        console.log(`  Session Total:    ${sessionColor}$${report.sessionTotal.toFixed(4)}${reset}`);
        if (report.sessionLimit > 0) {
            console.log(`  Session Limit:    $${report.sessionLimit.toFixed(2)} (${sessionColor}${report.sessionPercentUsed.toFixed(1)}%${reset} used)`);
            const sessionRemaining = Math.max(0, report.sessionLimit - report.sessionTotal);
            console.log(`  Session Remaining: $${sessionRemaining.toFixed(4)}`);
        }
        else {
            console.log(`  Session Limit:    ${dim}unlimited${reset}`);
        }
        console.log('');
        // Estimated daily spend
        if (report.estimatedDailySpend > 0) {
            const estColor = report.dailyLimit > 0 && report.estimatedDailySpend > report.dailyLimit ? red : cyan;
            console.log(`  Est. Daily Spend: ${estColor}$${report.estimatedDailySpend.toFixed(4)}${reset}`);
        }
        console.log(`  Total Entries:    ${report.entries}`);
        console.log('');
        // Model breakdown
        if (this.config.trackByModel) {
            console.log(`${bold}  Breakdown by Model:${reset}`);
            console.log('');
            const allModels = new Set([
                ...Object.keys(report.todayByModel),
                ...Object.keys(report.sessionByModel),
            ]);
            for (const model of allModels) {
                const todayCost = report.todayByModel[model] ?? 0;
                const sessionCost = report.sessionByModel[model] ?? 0;
                console.log(`    ${cyan}${model}${reset}`);
                console.log(`      Today:   $${todayCost.toFixed(4)}`);
                console.log(`      Session: $${sessionCost.toFixed(4)}`);
            }
            if (allModels.size === 0) {
                console.log(`    ${dim}No spending recorded yet${reset}`);
            }
            console.log('');
        }
        console.log(`${bold}--------------------------------${reset}`);
        console.log('');
    }
    /**
     * Reset session-level tracking (e.g. on new conversation).
     */
    resetSession() {
        this.sessionEntries = [];
        this.warnedThresholds = new Set();
        this.sessionStartTime = Date.now();
    }
    /**
     * Reset daily tracking. Called automatically at midnight.
     */
    resetDaily() {
        this.todayEntries = [];
        this.warnedThresholds = new Set();
        this.dataPath = join(SPENDING_DIR, `${todayDateStr()}.json`);
    }
    /**
     * Whether the daily spending limit has been reached.
     */
    isDailyLimitReached() {
        if (this.config.dailyLimit <= 0)
            return false;
        return this.sumCost(this.todayEntries) >= this.config.dailyLimit;
    }
    /**
     * Whether the session spending limit has been reached.
     */
    isSessionLimitReached() {
        if (this.config.sessionLimit <= 0)
            return false;
        return this.sumCost(this.sessionEntries) >= this.config.sessionLimit;
    }
    /**
     * Current spending rate in USD per hour, estimated from the current session.
     */
    getSpendingRate() {
        if (this.sessionEntries.length === 0)
            return 0;
        const elapsed = Date.now() - this.sessionStartTime;
        if (elapsed <= 0)
            return 0;
        const sessionTotal = this.sumCost(this.sessionEntries);
        const hoursElapsed = elapsed / (1000 * 60 * 60);
        return hoursElapsed > 0 ? sessionTotal / hoursElapsed : 0;
    }
    /**
     * Export the full history of today's spending entries.
     */
    exportHistory() {
        return [...this.todayEntries];
    }
    // ----------------------------------------------------------
    // Private helpers
    // ----------------------------------------------------------
    /**
     * Sum the cost of an array of entries.
     */
    sumCost(entries) {
        return entries.reduce((acc, e) => acc + e.cost, 0);
    }
    /**
     * Sum costs grouped by model name.
     */
    sumByModel(entries) {
        if (!this.config.trackByModel)
            return {};
        const result = {};
        for (const entry of entries) {
            result[entry.model] = (result[entry.model] ?? 0) + entry.cost;
        }
        return result;
    }
    /**
     * Estimate total daily spend by extrapolating the current session rate
     * over the remaining portion of the day.
     */
    estimateDailySpend() {
        const todayTotal = this.sumCost(this.todayEntries);
        if (this.sessionEntries.length === 0)
            return todayTotal;
        const rate = this.getSpendingRate();
        if (rate <= 0)
            return todayTotal;
        // Calculate remaining hours until midnight
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        const remainingMs = midnight.getTime() - now.getTime();
        const remainingHours = remainingMs / (1000 * 60 * 60);
        const estimatedRemaining = rate * remainingHours;
        return todayTotal + estimatedRemaining;
    }
    /**
     * Check whether a warning should be emitted for the current usage percent.
     * Returns the warning message or undefined.
     */
    checkWarnings(currentPercent, limitType) {
        const sorted = [...this.config.warnAtPercent].sort((a, b) => a - b);
        let matchedThreshold;
        for (const threshold of sorted) {
            if (currentPercent >= threshold && !this.warnedThresholds.has(threshold)) {
                matchedThreshold = threshold;
                // Keep checking higher thresholds; we want the highest one that applies
            }
        }
        // Actually find the highest threshold we've crossed but not yet warned about
        let highestNew;
        for (const threshold of sorted) {
            if (currentPercent >= threshold && !this.warnedThresholds.has(threshold)) {
                highestNew = threshold;
            }
        }
        if (highestNew === undefined)
            return undefined;
        // Mark all crossed thresholds as warned (including ones below the highest)
        for (const threshold of sorted) {
            if (currentPercent >= threshold) {
                this.warnedThresholds.add(threshold);
            }
        }
        const typeLabel = limitType === 'daily' ? 'Daily' : 'Session';
        const bold = '\x1b[1m';
        const reset = '\x1b[0m';
        const yellow = '\x1b[33m';
        const red = '\x1b[31m';
        const color = highestNew >= 90 ? red : yellow;
        const message = `${color}${bold}[SPENDING WARNING]${reset} ${typeLabel} spending has reached ${highestNew}% of the limit.`;
        // Output the warning to terminal
        console.warn(message);
        if (highestNew >= 90) {
            console.warn(`${red}Approaching spending limit. Consider wrapping up or the session will auto-stop.${reset}`);
        }
        return message;
    }
    /**
     * Load today's spending data from disk.
     */
    loadTodayData() {
        if (existsSync(this.dataPath)) {
            try {
                const raw = readFileSync(this.dataPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.todayEntries = parsed;
                }
                else {
                    this.todayEntries = [];
                }
            }
            catch {
                this.todayEntries = [];
            }
        }
        else {
            this.todayEntries = [];
        }
    }
    /**
     * Persist today's spending data to disk.
     */
    saveTodayData() {
        try {
            if (!existsSync(SPENDING_DIR)) {
                mkdirSync(SPENDING_DIR, { recursive: true });
            }
            writeFileSync(this.dataPath, JSON.stringify(this.todayEntries, null, 2), 'utf-8');
        }
        catch {
            // Silently fail - spending tracking should not block the CLI
        }
    }
    /**
     * Schedule an automatic reset at the next midnight.
     */
    scheduleDailyReset() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        const msUntilMidnight = midnight.getTime() - now.getTime();
        setTimeout(() => {
            this.resetDaily();
            this.cleanupOldFiles();
            // Reschedule for the next day
            this.scheduleDailyReset();
        }, msUntilMidnight);
    }
    /**
     * Remove spending data files older than 30 days to avoid unbounded disk use.
     */
    cleanupOldFiles() {
        try {
            if (!existsSync(SPENDING_DIR))
                return;
            const files = readdirSync(SPENDING_DIR);
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                const filePath = join(SPENDING_DIR, file);
                try {
                    const raw = readFileSync(filePath, 'utf-8');
                    const entries = JSON.parse(raw);
                    if (Array.isArray(entries) && entries.length > 0) {
                        // Check the first entry's timestamp
                        if (entries[0].timestamp < thirtyDaysAgo) {
                            unlinkSync(filePath);
                        }
                    }
                    else {
                        // Empty or malformed file - check filename date
                        const dateMatch = file.match(/^(\d{4})-(\d{2})-(\d{2})\.json$/);
                        if (dateMatch) {
                            const fileDate = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]));
                            if (fileDate.getTime() < thirtyDaysAgo) {
                                unlinkSync(filePath);
                            }
                        }
                    }
                }
                catch {
                    // Skip files we can't parse
                }
            }
        }
        catch {
            // Silently fail - cleanup should not block the CLI
        }
    }
}
//# sourceMappingURL=spending-warnings.js.map
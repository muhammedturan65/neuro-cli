// ============================================================
// NeuroCLI - Doom Loop Protection
// Detects and prevents agent stuck loops
// ============================================================
import chalk from 'chalk';
const DEFAULT_CONFIG = {
    maxConsecutiveErrors: 3,
    maxRepetitiveActions: 3,
    similarityThreshold: 0.7,
    cooldownMs: 5000,
    autoBreak: true,
};
export class DoomLoopProtection {
    config;
    state;
    onLoopDetected;
    constructor(config, onLoopDetected) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.onLoopDetected = onLoopDetected;
        this.state = {
            consecutiveErrors: 0,
            lastActions: [],
            isPaused: false,
            totalLoopsDetected: 0,
        };
    }
    /**
     * Record a tool execution and check for doom loops
     * Returns true if the action should proceed, false if blocked
     */
    async recordAction(toolName, args, result, isError) {
        if (this.state.isPaused) {
            console.log(chalk.yellow(`\n  ⚠ Doom loop protection: Agent is paused. Reason: ${this.state.pauseReason}`));
            return false;
        }
        // Track errors
        if (isError) {
            this.state.consecutiveErrors++;
        }
        else {
            this.state.consecutiveErrors = 0;
        }
        // Record action
        const actionStr = JSON.stringify({ tool: toolName, args: this.summarizeArgs(args) });
        this.state.lastActions.push({
            tool: toolName,
            args: actionStr,
            result: isError ? 'error' : 'success',
            timestamp: Date.now(),
        });
        // Keep only last 20 actions
        if (this.state.lastActions.length > 20) {
            this.state.lastActions = this.state.lastActions.slice(-20);
        }
        // Check for consecutive errors
        if (this.state.consecutiveErrors >= this.config.maxConsecutiveErrors) {
            const reason = `${this.state.consecutiveErrors} consecutive errors detected`;
            return this.handleLoop(reason);
        }
        // Check for repetitive actions
        const recentActions = this.state.lastActions.slice(-this.config.maxRepetitiveActions * 2);
        const repetitiveCount = this.countRepetitiveActions(recentActions, toolName, args);
        if (repetitiveCount >= this.config.maxRepetitiveActions) {
            const reason = `${repetitiveCount} repetitive actions detected for ${toolName}`;
            return this.handleLoop(reason);
        }
        // Check for similar error patterns
        const recentErrors = this.state.lastActions.filter(a => a.result === 'error').slice(-5);
        if (recentErrors.length >= 3) {
            const similarity = this.calculateErrorSimilarity(recentErrors);
            if (similarity >= this.config.similarityThreshold) {
                const reason = `Similar errors detected (${(similarity * 100).toFixed(0)}% similarity)`;
                return this.handleLoop(reason);
            }
        }
        return true;
    }
    /**
     * Reset the state (e.g., after user intervention)
     */
    reset() {
        this.state = {
            consecutiveErrors: 0,
            lastActions: [],
            isPaused: false,
            totalLoopsDetected: 0,
        };
    }
    /**
     * Unpause after user intervention
     */
    unpause() {
        this.state.isPaused = false;
        this.state.pauseReason = undefined;
        this.state.consecutiveErrors = 0;
        this.state.lastActions = [];
        console.log(chalk.green('  ✓ Doom loop protection: Resumed'));
    }
    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Check if currently paused
     */
    isPaused() {
        return this.state.isPaused;
    }
    async handleLoop(reason) {
        this.state.totalLoopsDetected++;
        this.state.isPaused = true;
        this.state.pauseReason = reason;
        console.log(chalk.red.bold(`\n  🚨 Doom Loop Detected: ${reason}`));
        console.log(chalk.yellow('  The agent appears to be stuck in a loop.'));
        console.log(chalk.gray('  Use /unpause to resume or /reset to start fresh.'));
        if (this.onLoopDetected) {
            const shouldContinue = await this.onLoopDetected(reason, this.state);
            if (shouldContinue) {
                this.unpause();
                return true;
            }
        }
        return false;
    }
    countRepetitiveActions(actions, toolName, args) {
        const currentArgs = this.summarizeArgs(args);
        let count = 0;
        for (const action of actions) {
            if (action.tool === toolName) {
                try {
                    const parsed = JSON.parse(action.args);
                    if (parsed.args === currentArgs) {
                        count++;
                    }
                }
                catch { }
            }
        }
        return count;
    }
    calculateErrorSimilarity(errors) {
        if (errors.length < 2)
            return 0;
        // Simple word-overlap similarity
        const allWords = errors.map(e => {
            try {
                const parsed = JSON.parse(e.args);
                return new Set((parsed.args || '').split(/\s+/));
            }
            catch {
                return new Set();
            }
        });
        let totalSimilarity = 0;
        let comparisons = 0;
        for (let i = 0; i < allWords.length - 1; i++) {
            for (let j = i + 1; j < allWords.length; j++) {
                const intersection = new Set([...allWords[i]].filter(x => allWords[j].has(x)));
                const union = new Set([...allWords[i], ...allWords[j]]);
                const similarity = union.size > 0 ? intersection.size / union.size : 0;
                totalSimilarity += similarity;
                comparisons++;
            }
        }
        return comparisons > 0 ? totalSimilarity / comparisons : 0;
    }
    summarizeArgs(args) {
        const entries = Object.entries(args);
        if (entries.length === 0)
            return '';
        return entries.map(([k, v]) => {
            const val = typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v).slice(0, 100);
            return `${k}=${val}`;
        }).join(' ');
    }
}
//# sourceMappingURL=doom-loop.js.map
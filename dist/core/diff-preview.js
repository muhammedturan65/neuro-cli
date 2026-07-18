// ============================================================
// NeuroCLI - Diff Preview System
// Shows file changes before applying them
// ============================================================
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import chalk from 'chalk';
export class DiffPreview {
    /**
     * Create a diff preview between old content and new content
     */
    static createDiff(oldContent, newContent, filePath) {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const diffLines = [];
        // Simple LCS-based diff
        const lcs = DiffPreview.lcs(oldLines, newLines);
        let oi = 0, ni = 0, li = 0;
        let added = 0, removed = 0;
        while (oi < oldLines.length || ni < newLines.length) {
            if (li < lcs.length && oi < oldLines.length && ni < newLines.length &&
                oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
                diffLines.push({ type: 'context', content: oldLines[oi], lineNumber: oi + 1 });
                oi++;
                ni++;
                li++;
            }
            else {
                // Check for removals
                while (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
                    diffLines.push({ type: 'remove', content: oldLines[oi], lineNumber: oi + 1 });
                    removed++;
                    oi++;
                }
                // Check for additions
                while (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
                    diffLines.push({ type: 'add', content: newLines[ni], lineNumber: ni + 1 });
                    added++;
                    ni++;
                }
            }
        }
        return { filePath, added, removed, lines: diffLines };
    }
    /**
     * Create diff for edit_file operation (old_text -> new_text replacement)
     */
    static createEditDiff(filePath, oldText, newText) {
        let content = '';
        if (existsSync(filePath)) {
            content = readFileSync(filePath, 'utf-8');
        }
        else {
            return null;
        }
        // Find the old text in the file
        const idx = content.indexOf(oldText);
        if (idx === -1)
            return null;
        const newContent = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
        return DiffPreview.createDiff(content, newContent, filePath);
    }
    /**
     * Render diff to terminal with colors
     */
    static renderDiff(diff, contextLines = 3) {
        const { filePath, added, removed, lines } = diff;
        // Claude Code style: clean diff header with +/-
        console.log();
        console.log(`  ${chalk.dim('───')} ${chalk.bold(filePath)} ${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)}`);
        let inChange = false;
        let contextCount = 0;
        for (const line of lines) {
            switch (line.type) {
                case 'add':
                    contextCount = 0;
                    inChange = true;
                    console.log(`  ${chalk.green('+')} ${chalk.green(line.content)}`);
                    break;
                case 'remove':
                    contextCount = 0;
                    inChange = true;
                    console.log(`  ${chalk.red('-')} ${chalk.red(line.content)}`);
                    break;
                case 'context':
                    contextCount++;
                    if (inChange) {
                        if (contextCount <= contextLines) {
                            console.log(`  ${chalk.dim(' ')} ${chalk.dim(line.content)}`);
                        }
                        else {
                            inChange = false;
                            console.log(`  ${chalk.dim('  ...')}`);
                        }
                    }
                    else if (contextCount <= 1) {
                        console.log(`  ${chalk.dim(' ')} ${chalk.dim(line.content)}`);
                    }
                    break;
            }
        }
        console.log(`  ${chalk.dim(`${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)}`)}`);
    }
    /**
     * Render a compact summary of multiple diffs
     */
    static renderSummary(diffs) {
        console.log();
        for (const diff of diffs) {
            const statusLabel = diff.added > 0 && diff.removed === 0 ? chalk.green('created') :
                diff.added === 0 && diff.removed > 0 ? chalk.red('deleted') :
                    chalk.yellow('modified');
            console.log(`  ${statusLabel} ${diff.filePath} ${chalk.green(`+${diff.added}`)} ${chalk.red(`-${diff.removed}`)}`);
        }
        const totalAdded = diffs.reduce((s, d) => s + d.added, 0);
        const totalRemoved = diffs.reduce((s, d) => s + d.removed, 0);
        console.log(`  ${chalk.dim(`${chalk.green(`+${totalAdded}`)} ${chalk.red(`-${totalRemoved}`)}`)}`);
    }
    /**
     * Ask user to confirm diff changes
     */
    static async confirmDiff(diff) {
        DiffPreview.renderDiff(diff);
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            rl.question(chalk.cyan('  Apply these changes? [y/n]: '), (answer) => {
                rl.close();
                resolve(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes');
            });
        });
    }
    // Simple Longest Common Subsequence
    static lcs(a, b) {
        const m = a.length;
        const n = b.length;
        const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1] === b[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                }
                else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        // Backtrack
        const result = [];
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1] === b[j - 1]) {
                result.unshift(a[i - 1]);
                i--;
                j--;
            }
            else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            }
            else {
                j--;
            }
        }
        return result;
    }
}
//# sourceMappingURL=diff-preview.js.map
// ============================================================
// NeuroCLI - Shell/Bash Tool
// Execute commands with safety checks
// ============================================================
import { execSync, spawn } from 'child_process';
const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, /:\(\)\{.*;\}/,
    /wget.*\|\s*sh/, /curl.*\|\s*sh/, /chmod\s+-R\s+777/,
    />\s*\/dev\/sda/, /mv\s+.*\s+\/dev\/null/,
];
const BLOCKED_COMMANDS = [
    'sudo', 'su', 'passwd', 'shutdown', 'reboot', 'halt',
    'init', 'telinit', 'systemctl', 'service',
];
const MAX_OUTPUT = 30000;
const TIMEOUT = 120000; // 2 minutes
function isDangerous(command) {
    const trimmed = command.trim();
    for (const blocked of BLOCKED_COMMANDS) {
        if (trimmed.startsWith(blocked) || trimmed.includes(` ${blocked} `)) {
            return { safe: false, reason: `Blocked command: ${blocked}` };
        }
    }
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { safe: false, reason: `Dangerous pattern detected` };
        }
    }
    return { safe: true };
}
function truncateOutput(output) {
    if (output.length <= MAX_OUTPUT)
        return output;
    const half = Math.floor(MAX_OUTPUT / 2);
    return output.slice(0, half) + '\n\n... [output truncated] ...\n\n' + output.slice(-half);
}
// ---- Run Command ----
const runCommandDef = {
    name: 'run_command',
    description: `Execute a shell command and return its output. Commands run in the project's working directory. Supports timeout and background execution.`,
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000, max: 300000)' },
            background: { type: 'boolean', description: 'Run command in background (default: false)' },
        },
        required: ['command'],
    },
};
export const runCommandTool = {
    name: 'run_command',
    definition: runCommandDef,
    risk: 'high',
    getApprovalRequest(args) {
        const command = args.command;
        const check = isDangerous(command);
        return {
            toolName: 'run_command',
            args,
            risk: check.safe ? 'high' : 'high',
            description: `Execute: ${command}${check.reason ? ` ⚠️ ${check.reason}` : ''}`,
        };
    },
    async execute(args, context) {
        const command = args.command;
        const timeout = Math.min(args.timeout || TIMEOUT, 300000);
        const background = args.background || false;
        // Safety check
        const safety = isDangerous(command);
        if (!safety.safe) {
            return `Error: Command blocked for safety. Reason: ${safety.reason}`;
        }
        context.onProgress?.(`Running: ${command}`);
        if (background) {
            // Run in background
            try {
                const child = spawn('sh', ['-c', command], {
                    cwd: context.workingDirectory,
                    detached: true,
                    stdio: 'ignore',
                });
                child.unref();
                return `Command started in background (PID: ${child.pid}): ${command}`;
            }
            catch (error) {
                return `Error starting background command: ${error.message}`;
            }
        }
        // Run synchronously with timeout
        const startTime = Date.now();
        try {
            const result = execSync(command, {
                encoding: 'utf-8',
                cwd: context.workingDirectory,
                timeout,
                maxBuffer: 50 * 1024 * 1024,
                env: { ...process.env, FORCE_COLOR: '0' },
            });
            const duration = Date.now() - startTime;
            const output = result.trim();
            const formatted = output
                ? truncateOutput(output)
                : '(no output)';
            return `Command: ${command}\nDuration: ${duration}ms\nExit code: 0\n\n${formatted}`;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const stdout = error.stdout?.toString().trim() || '';
            const stderr = error.stderr?.toString().trim() || '';
            const exitCode = error.status || 1;
            let output = `Command: ${command}\nDuration: ${duration}ms\nExit code: ${exitCode}\n\n`;
            if (stdout)
                output += `STDOUT:\n${truncateOutput(stdout)}\n\n`;
            if (stderr)
                output += `STDERR:\n${truncateOutput(stderr)}`;
            return output;
        }
    },
};
// ---- Git Operations ----
const gitDef = {
    name: 'git_operation',
    description: 'Execute git operations. Supports status, log, diff, branch, and other read operations. Write operations require approval.',
    parameters: {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                description: 'Git operation to perform',
                enum: ['status', 'log', 'diff', 'branch', 'show', 'stash_list', 'remote', 'blame', 'add', 'commit', 'checkout', 'merge', 'rebase', 'reset', 'stash', 'pull', 'push', 'fetch'],
            },
            args: { type: 'string', description: 'Additional arguments for the git command' },
        },
        required: ['operation'],
    },
};
const GIT_READ_OPS = new Set(['status', 'log', 'diff', 'branch', 'show', 'stash_list', 'remote', 'blame']);
export const gitTool = {
    name: 'git_operation',
    definition: gitDef,
    risk: 'medium',
    getApprovalRequest(args) {
        const op = args.operation;
        const isRead = GIT_READ_OPS.has(op);
        return {
            toolName: 'git_operation',
            args,
            risk: isRead ? 'low' : 'high',
            description: `Git ${op}${args.args ? ` ${args.args}` : ''}`,
        };
    },
    async execute(args, context) {
        const operation = args.operation;
        const extraArgs = args.args || '';
        // Map operation to git command
        const commandMap = {
            'status': 'git status --short --branch',
            'log': `git log --oneline -20 ${extraArgs}`,
            'diff': `git diff ${extraArgs}`,
            'branch': 'git branch -a',
            'show': `git show ${extraArgs}`,
            'stash_list': 'git stash list',
            'remote': 'git remote -v',
            'blame': `git blame ${extraArgs}`,
            'add': `git add ${extraArgs}`,
            'commit': `git commit ${extraArgs}`,
            'checkout': `git checkout ${extraArgs}`,
            'merge': `git merge ${extraArgs}`,
            'rebase': `git rebase ${extraArgs}`,
            'reset': `git reset ${extraArgs}`,
            'stash': `git stash ${extraArgs}`,
            'pull': `git pull ${extraArgs}`,
            'push': `git push ${extraArgs}`,
            'fetch': `git fetch ${extraArgs}`,
        };
        const command = commandMap[operation];
        if (!command)
            return `Error: Unknown git operation: ${operation}`;
        try {
            const result = execSync(command, {
                encoding: 'utf-8',
                cwd: context.workingDirectory,
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
            });
            return truncateOutput(result.trim() || '(no output)');
        }
        catch (error) {
            return `Git error: ${error.stderr?.toString().trim() || error.message}`;
        }
    },
};
export const shellTools = [runCommandTool, gitTool];
//# sourceMappingURL=bash.js.map
// ============================================================
// NeuroCLI - Smart Monitor (GAP-34)
// LLM-based real-time action evaluation for auto mode
// Bridges the gap between manual approval and yolo mode
// ============================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync, } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
    enabled: true,
    evaluatorModel: 'gemma-4-31b',
    riskThresholds: {
        autoApprove: 30,
        askUser: 70,
    },
    learning: {
        enabled: true,
        storagePath: join(homedir(), '.neuro', 'monitor-patterns.json'),
        minSamples: 5,
    },
    escalationRules: [],
    contextAwareness: {
        checkGitStatus: true,
        checkTestCoverage: true,
        checkProductionFiles: true,
        protectedPaths: [
            'src/production/**',
            'src/core/**',
            'src/main/**',
            'package.json',
            'package-lock.json',
            'yarn.lock',
            '.env',
            '.env.*',
            'Dockerfile*',
            'docker-compose.*',
            'tsconfig.json',
            'next.config.*',
            'webpack.config.*',
        ],
    },
};
const PRODUCTION_PATH_SEGMENTS = [
    'src/production',
    'src/core',
    'src/main',
    'src/app',
    'src/server',
    'src/api',
    'dist/',
    'build/',
];
const TEST_PATH_SEGMENTS = [
    '__tests__',
    'test/',
    'tests/',
    'spec/',
    '.test.',
    '.spec.',
];
const CONFIG_FILES = [
    'package.json',
    'tsconfig.json',
    '.eslintrc',
    '.prettierrc',
    'vite.config',
    'webpack.config',
    'next.config',
    'tailwind.config',
    'docker-compose',
    'Dockerfile',
    '.env',
];
const DANGEROUS_COMMANDS = [
    'sudo',
    'rm -rf',
    'rm -r',
    'chmod',
    'chown',
    'mkfs',
    'dd if=',
    'kill -9',
    'pkill',
    'killall',
    'shutdown',
    'reboot',
    'npm publish',
    'git push --force',
    'git reset --hard',
    'drop table',
    'drop database',
    'truncate table',
    'pip uninstall',
    'npm uninstall',
];
const MODERATE_COMMANDS = [
    'npm install',
    'npm update',
    'git push',
    'git merge',
    'git rebase',
    'docker',
    'kubectl',
    'helm',
];
const SAFE_COMMANDS = [
    'ls',
    'cat',
    'head',
    'tail',
    'pwd',
    'echo',
    'which',
    'node -v',
    'npm -v',
    'git status',
    'git log',
    'git diff',
    'git branch',
    'wc',
];
const SAFE_TOOLS = [
    'read_file',
    'search_files',
    'list_directory',
    'web_search',
    'web_fetch',
    'recall_memory',
    'project_context',
    'todowrite',
    'get_file_info',
    'glob',
];
const MODERATE_TOOLS = [
    'write_file',
    'edit_file',
    'apply_diff',
    'execute_command',
    'create_file',
];
const DANGEROUS_TOOLS = [
    'delete_file',
    'shell_exec',
    'sudo_exec',
    'system_command',
];
const IRREVERSIBLE_PATTERNS = [
    'rm ',
    'delete',
    'remove',
    'drop ',
    'truncate',
    'destroy',
    'wipe',
    'format',
    'mkfs',
];
function evaluateFilePathRisk(toolName, args, context) {
    const filePath = extractFilePath(args);
    if (!filePath)
        return null;
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (PRODUCTION_PATH_SEGMENTS.some((seg) => normalized.includes(seg.toLowerCase()))) {
        return {
            name: 'file-path-risk',
            contribution: 65,
            description: `Path "${filePath}" appears to be a production file`,
        };
    }
    if (CONFIG_FILES.some((cfg) => normalized.includes(cfg.toLowerCase()))) {
        return {
            name: 'file-path-risk',
            contribution: 55,
            description: `Path "${filePath}" is a configuration file`,
        };
    }
    if (TEST_PATH_SEGMENTS.some((seg) => normalized.includes(seg.toLowerCase()))) {
        return {
            name: 'file-path-risk',
            contribution: 10,
            description: `Path "${filePath}" appears to be a test file (lower risk)`,
        };
    }
    return {
        name: 'file-path-risk',
        contribution: 25,
        description: `Path "${filePath}" is a standard source file`,
    };
}
function evaluateCommandRisk(toolName, args, _context) {
    const command = extractCommand(args);
    if (!command)
        return null;
    const lowerCmd = command.toLowerCase();
    for (const dangerous of DANGEROUS_COMMANDS) {
        if (lowerCmd.includes(dangerous.toLowerCase())) {
            return {
                name: 'command-risk',
                contribution: 85,
                description: `Command contains dangerous pattern "${dangerous}": ${truncate(command, 80)}`,
            };
        }
    }
    for (const moderate of MODERATE_COMMANDS) {
        if (lowerCmd.includes(moderate.toLowerCase())) {
            return {
                name: 'command-risk',
                contribution: 40,
                description: `Command contains moderate-risk pattern "${moderate}": ${truncate(command, 80)}`,
            };
        }
    }
    for (const safe of SAFE_COMMANDS) {
        if (lowerCmd.startsWith(safe.toLowerCase())) {
            return {
                name: 'command-risk',
                contribution: 5,
                description: `Command appears safe: ${truncate(command, 80)}`,
            };
        }
    }
    return {
        name: 'command-risk',
        contribution: 35,
        description: `Command risk unknown: ${truncate(command, 80)}`,
    };
}
function evaluateToolRisk(toolName, _args, _context) {
    if (SAFE_TOOLS.includes(toolName)) {
        return {
            name: 'tool-risk',
            contribution: 5,
            description: `Tool "${toolName}" is a safe read-only / informational tool`,
        };
    }
    if (DANGEROUS_TOOLS.includes(toolName)) {
        return {
            name: 'tool-risk',
            contribution: 75,
            description: `Tool "${toolName}" is classified as dangerous`,
        };
    }
    if (MODERATE_TOOLS.includes(toolName)) {
        return {
            name: 'tool-risk',
            contribution: 35,
            description: `Tool "${toolName}" can modify files or execute commands`,
        };
    }
    return {
        name: 'tool-risk',
        contribution: 25,
        description: `Tool "${toolName}" is not in any known risk category`,
    };
}
function evaluateScopeRisk(_toolName, args, context) {
    const files = extractMultipleFiles(args);
    if (files.length > 5) {
        return {
            name: 'scope-risk',
            contribution: 60,
            description: `Action affects ${files.length} files — wide scope`,
        };
    }
    if (files.length > 1) {
        return {
            name: 'scope-risk',
            contribution: 30,
            description: `Action affects ${files.length} files`,
        };
    }
    if (files.length === 1) {
        return {
            name: 'scope-risk',
            contribution: 10,
            description: 'Action affects a single file',
        };
    }
    return {
        name: 'scope-risk',
        contribution: 5,
        description: 'Action has no direct file scope',
    };
}
function evaluateNetworkRisk(toolName, args, _context) {
    const urlFields = ['url', 'endpoint', 'api_url', 'webhook_url', 'server_url'];
    for (const field of urlFields) {
        const val = args[field];
        if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
            const isInternal = val.includes('localhost') || val.includes('127.0.0.1') || val.includes('0.0.0.0');
            return {
                name: 'network-risk',
                contribution: isInternal ? 15 : 50,
                description: isInternal
                    ? `Internal network call to ${truncate(val, 60)}`
                    : `External network call to ${truncate(val, 60)}`,
            };
        }
    }
    if (['web_search', 'web_fetch', 'http_request', 'api_call'].includes(toolName)) {
        return {
            name: 'network-risk',
            contribution: 25,
            description: `Tool "${toolName}" makes network requests`,
        };
    }
    return {
        name: 'network-risk',
        contribution: 0,
        description: 'No network activity detected',
    };
}
function evaluateReversibilityRisk(toolName, args, _context) {
    if (DANGEROUS_TOOLS.includes(toolName) || toolName.includes('delete') || toolName.includes('remove')) {
        return {
            name: 'reversibility-risk',
            contribution: 80,
            description: `Action via "${toolName}" is likely irreversible`,
        };
    }
    const command = extractCommand(args);
    if (command) {
        const lowerCmd = command.toLowerCase();
        for (const pattern of IRREVERSIBLE_PATTERNS) {
            if (lowerCmd.includes(pattern.toLowerCase())) {
                return {
                    name: 'reversibility-risk',
                    contribution: 80,
                    description: `Command contains irreversible pattern "${pattern}"`,
                };
            }
        }
    }
    if (MODERATE_TOOLS.includes(toolName)) {
        return {
            name: 'reversibility-risk',
            contribution: 35,
            description: `Action via "${toolName}" can likely be undone with effort`,
        };
    }
    if (SAFE_TOOLS.includes(toolName)) {
        return {
            name: 'reversibility-risk',
            contribution: 2,
            description: 'Read-only action — trivially reversible (no-op)',
        };
    }
    return {
        name: 'reversibility-risk',
        contribution: 20,
        description: 'Reversibility uncertain',
    };
}
function evaluateImpactRadiusRisk(toolName, args, context) {
    const filePath = extractFilePath(args);
    if (!filePath) {
        return {
            name: 'impact-radius-risk',
            contribution: 5,
            description: 'No specific file target — low impact radius',
        };
    }
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const coreModules = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js'];
    const fileName = normalized.split('/').pop() ?? '';
    if (coreModules.some((m) => fileName === m)) {
        return {
            name: 'impact-radius-risk',
            contribution: 70,
            description: `File "${fileName}" is a core entry point — high impact radius`,
        };
    }
    if (normalized.includes('util') || normalized.includes('helper') || normalized.includes('shared')) {
        return {
            name: 'impact-radius-risk',
            contribution: 55,
            description: `Path includes shared/utility — potentially wide impact`,
        };
    }
    if (normalized.includes('test') || normalized.includes('spec') || normalized.includes('mock')) {
        return {
            name: 'impact-radius-risk',
            contribution: 10,
            description: 'Test / spec file — isolated impact',
        };
    }
    return {
        name: 'impact-radius-risk',
        contribution: 25,
        description: 'Standard source file — moderate impact radius',
    };
}
function evaluateCostRisk(_toolName, _args, context) {
    if (context.spendingLimit <= 0) {
        return {
            name: 'cost-risk',
            contribution: 0,
            description: 'No spending limit configured',
        };
    }
    const ratio = context.currentCost / context.spendingLimit;
    if (ratio >= 0.95) {
        return {
            name: 'cost-risk',
            contribution: 90,
            description: `Spending at ${(ratio * 100).toFixed(1)}% of limit ($${context.currentCost.toFixed(4)} / $${context.spendingLimit})`,
        };
    }
    if (ratio >= 0.8) {
        return {
            name: 'cost-risk',
            contribution: 55,
            description: `Spending at ${(ratio * 100).toFixed(1)}% of limit`,
        };
    }
    if (ratio >= 0.5) {
        return {
            name: 'cost-risk',
            contribution: 25,
            description: `Spending at ${(ratio * 100).toFixed(1)}% of limit`,
        };
    }
    return {
        name: 'cost-risk',
        contribution: 5,
        description: `Spending at ${(ratio * 100).toFixed(1)}% of limit — plenty of budget`,
    };
}
const BUILTIN_RISK_EVALUATORS = [
    evaluateFilePathRisk,
    evaluateCommandRisk,
    evaluateToolRisk,
    evaluateScopeRisk,
    evaluateNetworkRisk,
    evaluateReversibilityRisk,
    evaluateImpactRadiusRisk,
    evaluateCostRisk,
];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractFilePath(args) {
    for (const key of ['path', 'filePath', 'file_path', 'filename', 'dest', 'destination']) {
        if (typeof args[key] === 'string')
            return args[key];
    }
    return null;
}
function extractCommand(args) {
    for (const key of ['command', 'cmd', 'script', 'shell_command', 'exec']) {
        if (typeof args[key] === 'string')
            return args[key];
    }
    return null;
}
function extractMultipleFiles(args) {
    const files = [];
    for (const key of ['paths', 'files', 'file_list']) {
        const val = args[key];
        if (Array.isArray(val)) {
            for (const item of val) {
                if (typeof item === 'string')
                    files.push(item);
            }
        }
    }
    const single = extractFilePath(args);
    if (single)
        files.push(single);
    return files;
}
function truncate(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
function normalizePattern(toolName, args) {
    const filePath = extractFilePath(args);
    if (filePath) {
        const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
        return `${toolName}:*${ext}`;
    }
    const command = extractCommand(args);
    if (command) {
        const base = command.trim().split(/\s+/)[0];
        return `${toolName}:${base}`;
    }
    return `${toolName}:*`;
}
function matchesEscalationCondition(rule, toolName, args, context) {
    const condition = rule.condition.toLowerCase();
    if (condition.includes('file matches')) {
        const pattern = condition.replace(/file matches\s+/i, '').trim();
        const filePath = extractFilePath(args);
        if (filePath) {
            const regexStr = pattern
                .replace(/\./g, '\\.')
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*');
            try {
                const re = new RegExp(regexStr, 'i');
                if (re.test(filePath))
                    return true;
            }
            catch {
                if (filePath.toLowerCase().includes(pattern.replace(/\*/g, '').toLowerCase()))
                    return true;
            }
        }
    }
    if (condition.includes('tool is')) {
        const targetTool = condition.replace(/tool is\s+/i, '').trim();
        if (toolName.toLowerCase() === targetTool.toLowerCase())
            return true;
    }
    if (condition.includes('command contains')) {
        const fragment = condition.replace(/command contains\s+/i, '').trim();
        const command = extractCommand(args);
        if (command && command.toLowerCase().includes(fragment.toLowerCase()))
            return true;
    }
    if (condition.includes('uncommitted changes') && context.hasUncommittedChanges) {
        return true;
    }
    if (condition.includes('production')) {
        const filePath = extractFilePath(args);
        if (filePath && PRODUCTION_PATH_SEGMENTS.some((seg) => filePath.toLowerCase().includes(seg.toLowerCase()))) {
            return true;
        }
    }
    if (condition.includes('cost exceeds')) {
        const threshold = parseFloat(condition.replace(/cost exceeds\s+/i, '').replace(/[^0-9.]/g, ''));
        if (!isNaN(threshold) && context.currentCost > threshold)
            return true;
    }
    return false;
}
// ---------------------------------------------------------------------------
// SmartMonitor class
// ---------------------------------------------------------------------------
const NEURO_DIR = join(homedir(), '.neuro');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 200;
export class SmartMonitor {
    config;
    apiClient;
    patterns = new Map();
    evaluationCache = new Map();
    stats;
    constructor(config, apiClient) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.config.riskThresholds = { ...DEFAULT_CONFIG.riskThresholds, ...config.riskThresholds };
        this.config.learning = { ...DEFAULT_CONFIG.learning, ...config.learning };
        this.config.contextAwareness = { ...DEFAULT_CONFIG.contextAwareness, ...config.contextAwareness };
        if (config.escalationRules) {
            this.config.escalationRules = [...config.escalationRules];
        }
        this.apiClient = apiClient;
        this.stats = this.freshStats();
        this.loadPatterns();
    }
    // -----------------------------------------------------------------------
    // Core evaluation
    // -----------------------------------------------------------------------
    async evaluate(toolName, args, context) {
        if (!this.config.enabled) {
            return {
                action: 'approve',
                confidence: 1.0,
                riskScore: 0,
                reasoning: 'Smart monitor is disabled',
                learned: false,
            };
        }
        const startTime = Date.now();
        // 1. Check escalation rules first — these are hard overrides
        for (const rule of this.config.escalationRules) {
            if (matchesEscalationCondition(rule, toolName, args, context)) {
                this.stats.totalEvaluations++;
                this.stats.escalations++;
                const elapsed = Date.now() - startTime;
                this.stats.totalEvaluationTimeMs += elapsed;
                return {
                    action: rule.action === 'deny' ? 'deny' : 'ask-user',
                    confidence: 0.95,
                    riskScore: 95,
                    reasoning: rule.reason,
                    userQuestion: rule.action === 'ask-user'
                        ? `Escalation rule triggered: ${rule.reason}. Proceed anyway?`
                        : undefined,
                    learned: false,
                };
            }
        }
        // 2. Check learned patterns
        if (this.config.learning.enabled) {
            const learnedDecision = this.checkLearnedPatterns(toolName, args);
            if (learnedDecision) {
                this.stats.totalEvaluations++;
                this.stats.learnedDecisions++;
                if (learnedDecision.action === 'approve')
                    this.stats.approvals++;
                else if (learnedDecision.action === 'deny')
                    this.stats.denials++;
                const elapsed = Date.now() - startTime;
                this.stats.totalEvaluationTimeMs += elapsed;
                this.stats.totalRiskScore += learnedDecision.riskScore;
                return learnedDecision;
            }
        }
        // 3. Perform risk assessment
        const risk = await this.assessRisk(toolName, args, context);
        // 4. Apply threshold logic
        let decision;
        if (risk.score <= this.config.riskThresholds.autoApprove) {
            decision = {
                action: 'approve',
                confidence: this.scoreToConfidence(risk.score, 'approve'),
                riskScore: risk.score,
                reasoning: risk.reasoning,
                learned: false,
            };
        }
        else if (risk.score >= this.config.riskThresholds.askUser) {
            decision = {
                action: 'ask-user',
                confidence: this.scoreToConfidence(risk.score, 'ask-user'),
                riskScore: risk.score,
                reasoning: risk.reasoning,
                userQuestion: `Risk score ${risk.score}/100. ${risk.reasoning}. Allow this action?`,
                learned: false,
            };
        }
        else {
            // Middle zone — use LLM evaluation
            const llmDecision = await this.evaluateWithLLM(toolName, args, context, risk);
            decision = {
                ...llmDecision,
                riskScore: risk.score,
                learned: false,
            };
        }
        // 5. Safety-level adjustments
        decision = this.adjustForSafetyLevel(decision, context.safetyLevel);
        // 6. Budget enforcement
        if (context.spendingLimit > 0 &&
            context.currentCost >= context.spendingLimit * 0.95 &&
            decision.action === 'approve') {
            decision = {
                action: 'ask-user',
                confidence: 0.85,
                riskScore: Math.max(decision.riskScore, 75),
                reasoning: `Approaching spending limit ($${context.currentCost.toFixed(4)} / $${context.spendingLimit}). ${decision.reasoning}`,
                userQuestion: `You've used 95%+ of your spending limit. Proceed with this action?`,
                learned: false,
            };
        }
        // Record stats
        this.stats.totalEvaluations++;
        this.stats.totalRiskScore += decision.riskScore;
        const elapsed = Date.now() - startTime;
        this.stats.totalEvaluationTimeMs += elapsed;
        if (decision.action === 'approve')
            this.stats.approvals++;
        else if (decision.action === 'deny')
            this.stats.denials++;
        else if (decision.action === 'modify')
            this.stats.modifications++;
        else if (decision.action === 'ask-user')
            this.stats.escalations++;
        // Cache the decision
        this.cacheDecision(toolName, args, decision);
        return decision;
    }
    // -----------------------------------------------------------------------
    // Risk assessment
    // -----------------------------------------------------------------------
    async assessRisk(toolName, args, context) {
        const factors = [];
        // Run all built-in risk evaluators
        for (const evaluator of BUILTIN_RISK_EVALUATORS) {
            const factor = evaluator(toolName, args, context);
            if (factor)
                factors.push(factor);
        }
        // Check protected paths from context awareness
        if (this.config.contextAwareness.checkProductionFiles) {
            const filePath = extractFilePath(args);
            if (filePath) {
                for (const protectedPath of this.config.contextAwareness.protectedPaths) {
                    const regexStr = protectedPath
                        .replace(/\./g, '\\.')
                        .replace(/\*\*/g, '.*')
                        .replace(/\*/g, '[^/]*');
                    try {
                        const re = new RegExp(regexStr, 'i');
                        if (re.test(filePath)) {
                            factors.push({
                                name: 'protected-path-risk',
                                contribution: 70,
                                description: `Path "${filePath}" matches protected pattern "${protectedPath}"`,
                            });
                            break;
                        }
                    }
                    catch {
                        if (filePath.toLowerCase().includes(protectedPath.replace(/\*/g, '').toLowerCase())) {
                            factors.push({
                                name: 'protected-path-risk',
                                contribution: 70,
                                description: `Path "${filePath}" matches protected pattern "${protectedPath}"`,
                            });
                            break;
                        }
                    }
                }
            }
        }
        // Check git status context
        if (this.config.contextAwareness.checkGitStatus && context.hasUncommittedChanges) {
            factors.push({
                name: 'git-status-risk',
                contribution: 20,
                description: 'There are uncommitted changes in the repository',
            });
        }
        // Compute weighted aggregate score
        // Each factor contributes a weight; we use a weighted average with a
        // minimum of 0 and ceiling of 100.
        const totalContribution = factors.reduce((sum, f) => sum + f.contribution, 0);
        const factorCount = factors.length || 1;
        // Weighted average: contributions above 50 count double (amplification)
        let score = 0;
        for (const factor of factors) {
            const weight = factor.contribution >= 50 ? 1.5 : 1.0;
            score += factor.contribution * weight;
        }
        score = score / (factorCount + factors.filter((f) => f.contribution >= 50).length * 0.5);
        score = Math.round(Math.max(0, Math.min(100, score)));
        // Determine recommendation
        let recommendation;
        if (score <= this.config.riskThresholds.autoApprove) {
            recommendation = 'approve';
        }
        else if (score >= this.config.riskThresholds.askUser) {
            recommendation = 'ask-user';
        }
        else {
            // Factor in specific signals
            const hasIrreversible = factors.some((f) => f.name === 'reversibility-risk' && f.contribution >= 60);
            const hasDangerousCommand = factors.some((f) => f.name === 'command-risk' && f.contribution >= 70);
            const hasProtectedPath = factors.some((f) => f.name === 'protected-path-risk');
            if (hasIrreversible || hasDangerousCommand || hasProtectedPath) {
                recommendation = 'ask-user';
            }
            else {
                recommendation = 'modify';
            }
        }
        const reasoning = factors
            .map((f) => `[${f.contribution}] ${f.name}: ${f.description}`)
            .join('; ');
        return { score, factors, recommendation, reasoning };
    }
    // -----------------------------------------------------------------------
    // LLM evaluation
    // -----------------------------------------------------------------------
    async evaluateWithLLM(toolName, args, context, risk) {
        // Check cache first
        const cacheKey = this.computeCacheKey(toolName, args);
        const cached = this.evaluationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            this.stats.cacheHits++;
            return cached.decision;
        }
        this.stats.cacheMisses++;
        const safeArgsPreview = this.sanitizeArgsForPrompt(args);
        const prompt = `You are a safety monitor for an AI coding assistant. Evaluate this proposed action.

Tool: ${toolName}
Args: ${safeArgsPreview}
Risk Score: ${risk.score}/100
Risk Factors: ${risk.factors.map((f) => `${f.name}(${f.contribution})`).join(', ')}
Safety Level: ${context.safetyLevel}
Uncommitted Changes: ${context.hasUncommittedChanges}
Current Cost: $${context.currentCost.toFixed(4)}${context.spendingLimit > 0 ? ` / $${context.spendingLimit}` : ''}

Respond with exactly one line in this format:
DECISION|confidence|reasoning

Where DECISION is one of: approve, deny, modify, ask-user
Confidence is 0.0 to 1.0
If modify, add a second line with the modified args as JSON.
If ask-user, add a second line with the question to ask.`;
        try {
            const result = await this.callEvaluatorModel(prompt);
            return this.parseLLMResponse(result.text, risk.score);
        }
        catch {
            // LLM call failed — fall back to risk-based decision
            return {
                action: risk.score >= this.config.riskThresholds.askUser ? 'ask-user' : 'approve',
                confidence: 0.5,
                riskScore: risk.score,
                reasoning: `LLM evaluation failed; falling back to risk threshold. ${risk.reasoning}`,
                learned: false,
            };
        }
    }
    async callEvaluatorModel(prompt) {
        if (!this.apiClient || typeof this.apiClient.createChatCompletion !== 'function') {
            throw new Error('API client not available for smart monitor evaluation');
        }
        const result = await this.apiClient.createChatCompletion({
            model: this.config.evaluatorModel,
            messages: [
                {
                    role: 'system',
                    content: 'You are a concise safety evaluator. Respond only in the specified format. No explanations beyond the reasoning field.',
                },
                { role: 'user', content: prompt },
            ],
            max_tokens: 200,
            temperature: 0.1,
        });
        const choice = result.choices?.[0];
        if (!choice?.message?.content) {
            throw new Error('Empty response from evaluator model');
        }
        return {
            text: choice.message.content.trim(),
            inputTokens: result.usage?.prompt_tokens ?? 0,
            outputTokens: result.usage?.completion_tokens ?? 0,
            cost: this.estimateCost(result.usage?.prompt_tokens ?? 0, result.usage?.completion_tokens ?? 0),
        };
    }
    parseLLMResponse(text, riskScore) {
        const lines = text.split('\n').filter((l) => l.trim().length > 0);
        const firstLine = lines[0] ?? '';
        const parts = firstLine.split('|');
        const actionStr = (parts[0] ?? 'approve').trim().toLowerCase();
        const confidence = parseFloat(parts[1] ?? '0.5');
        const reasoning = parts.slice(2).join('|').trim() || 'LLM evaluation';
        const validActions = ['approve', 'deny', 'modify', 'ask-user'];
        const action = validActions.includes(actionStr)
            ? actionStr
            : 'ask-user';
        const decision = {
            action,
            confidence: isNaN(confidence) ? 0.5 : Math.max(0, Math.min(1, confidence)),
            riskScore,
            reasoning,
            learned: false,
        };
        if (action === 'modify' && lines.length > 1) {
            try {
                decision.modifiedArgs = JSON.parse(lines[1]);
            }
            catch {
                // Could not parse modified args — ignore
            }
        }
        if (action === 'ask-user' && lines.length > 1) {
            decision.userQuestion = lines[1].trim();
        }
        return decision;
    }
    estimateCost(inputTokens, outputTokens) {
        // Rough pricing for cheap models
        const inputPricePer1M = 0.15; // ~gemma pricing
        const outputPricePer1M = 0.15;
        return (inputTokens * inputPricePer1M + outputTokens * outputPricePer1M) / 1_000_000;
    }
    // -----------------------------------------------------------------------
    // Learning
    // -----------------------------------------------------------------------
    recordDecision(toolName, args, decision, userOverride) {
        if (!this.config.learning.enabled)
            return;
        const patternKey = normalizePattern(toolName, args);
        const existing = this.patterns.get(patternKey);
        if (existing) {
            existing.lastSeen = Date.now();
            if (userOverride === true) {
                // User explicitly overrode a deny → count as approval
                existing.approvals++;
            }
            else if (userOverride === false) {
                // User explicitly overrode an approval → count as denial
                existing.denials++;
            }
            else if (decision.action === 'approve') {
                existing.approvals++;
            }
            else if (decision.action === 'deny') {
                existing.denials++;
            }
            // Check if pattern now qualifies for auto-approve
            existing.active =
                existing.approvals >= this.config.learning.minSamples &&
                    existing.denials === 0;
        }
        else {
            this.patterns.set(patternKey, {
                pattern: patternKey,
                approvals: decision.action === 'approve' ? 1 : 0,
                denials: decision.action === 'deny' ? 1 : 0,
                lastSeen: Date.now(),
                active: false,
            });
        }
        this.persistPatterns();
    }
    getLearnedPatterns() {
        return Array.from(this.patterns.values());
    }
    resetLearning() {
        this.patterns.clear();
        try {
            if (existsSync(this.config.learning.storagePath)) {
                const { unlinkSync } = require('fs');
                unlinkSync(this.config.learning.storagePath);
            }
        }
        catch {
            // Ignore
        }
    }
    checkLearnedPatterns(toolName, args) {
        const patternKey = normalizePattern(toolName, args);
        const pattern = this.patterns.get(patternKey);
        if (!pattern || !pattern.active)
            return null;
        if (pattern.approvals < this.config.learning.minSamples)
            return null;
        if (pattern.denials > 0)
            return null;
        return {
            action: 'approve',
            confidence: Math.min(0.95, 0.6 + pattern.approvals * 0.03),
            riskScore: 10,
            reasoning: `Auto-approved based on ${pattern.approvals} past approvals for pattern "${patternKey}"`,
            learned: true,
        };
    }
    loadPatterns() {
        try {
            if (existsSync(this.config.learning.storagePath)) {
                const data = JSON.parse(readFileSync(this.config.learning.storagePath, 'utf-8'));
                if (Array.isArray(data)) {
                    for (const p of data) {
                        if (p.pattern) {
                            this.patterns.set(p.pattern, p);
                        }
                    }
                }
            }
        }
        catch {
            // Corrupt or missing file — start fresh
        }
    }
    persistPatterns() {
        try {
            const dir = join(this.config.learning.storagePath, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            const data = Array.from(this.patterns.values());
            writeFileSync(this.config.learning.storagePath, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch {
            // Cannot persist — continue in-memory
        }
    }
    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------
    updateThresholds(thresholds) {
        if (thresholds.autoApprove !== undefined) {
            this.config.riskThresholds.autoApprove = thresholds.autoApprove;
        }
        if (thresholds.askUser !== undefined) {
            this.config.riskThresholds.askUser = thresholds.askUser;
        }
        // Ensure autoApprove < askUser
        if (this.config.riskThresholds.autoApprove >= this.config.riskThresholds.askUser) {
            this.config.riskThresholds.askUser = this.config.riskThresholds.autoApprove + 1;
        }
    }
    addEscalationRule(rule) {
        // Avoid duplicate conditions
        const exists = this.config.escalationRules.some((r) => r.condition === rule.condition);
        if (!exists) {
            this.config.escalationRules.push(rule);
        }
    }
    removeEscalationRule(condition) {
        this.config.escalationRules = this.config.escalationRules.filter((r) => r.condition !== condition);
    }
    getConfig() {
        return Object.freeze({
            ...this.config,
            riskThresholds: { ...this.config.riskThresholds },
            learning: { ...this.config.learning },
            contextAwareness: { ...this.config.contextAwareness },
            escalationRules: [...this.config.escalationRules],
        });
    }
    setEnabled(enabled) {
        this.config.enabled = enabled;
    }
    isEnabled() {
        return this.config.enabled;
    }
    setEvaluatorModel(model) {
        this.config.evaluatorModel = model;
    }
    addProtectedPath(pathPattern) {
        if (!this.config.contextAwareness.protectedPaths.includes(pathPattern)) {
            this.config.contextAwareness.protectedPaths.push(pathPattern);
        }
    }
    removeProtectedPath(pathPattern) {
        this.config.contextAwareness.protectedPaths =
            this.config.contextAwareness.protectedPaths.filter((p) => p !== pathPattern);
    }
    // -----------------------------------------------------------------------
    // Statistics
    // -----------------------------------------------------------------------
    getStats() {
        const total = this.stats.totalEvaluations || 1;
        const cacheTotal = this.stats.cacheHits + this.stats.cacheMisses || 1;
        return {
            totalEvaluations: this.stats.totalEvaluations,
            approvals: this.stats.approvals,
            denials: this.stats.denials,
            modifications: this.stats.modifications,
            escalations: this.stats.escalations,
            approvalRate: this.stats.approvals / total,
            avgRiskScore: this.stats.totalRiskScore / total,
            avgEvaluationTimeMs: this.stats.totalEvaluationTimeMs / total,
            learnedDecisions: this.stats.learnedDecisions,
            cacheHitRate: this.stats.cacheHits / cacheTotal,
        };
    }
    resetStats() {
        this.stats = this.freshStats();
    }
    // -----------------------------------------------------------------------
    // Context helpers — gather live project context
    // -----------------------------------------------------------------------
    gatherContext(workingDirectory, currentCost, spendingLimit) {
        let hasUncommittedChanges = false;
        if (this.config.contextAwareness.checkGitStatus) {
            try {
                const status = execSync('git status --porcelain', {
                    cwd: workingDirectory,
                    encoding: 'utf-8',
                    timeout: 5000,
                });
                hasUncommittedChanges = status.trim().length > 0;
            }
            catch {
                // Not a git repo or git not available
            }
        }
        let neuroMdContent;
        const neuroMdPath = join(workingDirectory, 'NEURO.md');
        try {
            if (existsSync(neuroMdPath)) {
                neuroMdContent = readFileSync(neuroMdPath, 'utf-8');
            }
        }
        catch {
            // Cannot read
        }
        return {
            workingDirectory,
            modifiedFiles: [],
            currentCost,
            spendingLimit,
            safetyLevel: 'moderate',
            recentHistory: [],
            hasUncommittedChanges,
            neuroMdContent,
        };
    }
    // -----------------------------------------------------------------------
    // Internal utilities
    // -----------------------------------------------------------------------
    adjustForSafetyLevel(decision, level) {
        if (level === 'conservative') {
            // Conservative: escalate moderate decisions
            if (decision.action === 'approve' && decision.riskScore > 20) {
                return {
                    ...decision,
                    action: 'ask-user',
                    userQuestion: `Conservative mode: risk score ${decision.riskScore}. ${decision.reasoning}. Allow?`,
                };
            }
            if (decision.action === 'modify') {
                return {
                    ...decision,
                    action: 'ask-user',
                    userQuestion: `Conservative mode requires approval for modifications. ${decision.reasoning}. Allow?`,
                };
            }
        }
        if (level === 'aggressive') {
            // Aggressive: auto-approve moderate decisions
            if (decision.action === 'ask-user' && decision.riskScore < 60) {
                return {
                    ...decision,
                    action: 'approve',
                    reasoning: `Aggressive mode auto-approved (risk ${decision.riskScore} < 60). ${decision.reasoning}`,
                };
            }
        }
        return decision;
    }
    scoreToConfidence(score, action) {
        if (action === 'approve') {
            // Lower score → higher confidence in approving
            return Math.max(0.5, 1.0 - score / 100);
        }
        // Higher score → higher confidence in escalating
        return Math.max(0.5, score / 100);
    }
    computeCacheKey(toolName, args) {
        const filePath = extractFilePath(args);
        const command = extractCommand(args);
        return `${toolName}:${filePath ?? ''}:${command ?? ''}:${this.sanitizeArgsForPrompt(args).slice(0, 100)}`;
    }
    cacheDecision(toolName, args, decision) {
        const key = this.computeCacheKey(toolName, args);
        this.evaluationCache.set(key, { key, decision, timestamp: Date.now() });
        // Evict old entries if cache is too large
        if (this.evaluationCache.size > MAX_CACHE_ENTRIES) {
            const entries = Array.from(this.evaluationCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
            for (const [k] of toRemove) {
                this.evaluationCache.delete(k);
            }
        }
    }
    sanitizeArgsForPrompt(args) {
        try {
            const sanitized = {};
            for (const [key, value] of Object.entries(args)) {
                if (typeof value === 'string') {
                    sanitized[key] = value.length > 200 ? value.slice(0, 200) + '...' : value;
                }
                else if (typeof value === 'number' || typeof value === 'boolean') {
                    sanitized[key] = value;
                }
                else if (Array.isArray(value)) {
                    sanitized[key] = `[Array:${value.length}]`;
                }
                else if (value && typeof value === 'object') {
                    sanitized[key] = '{Object}';
                }
                else {
                    sanitized[key] = String(value);
                }
            }
            return JSON.stringify(sanitized);
        }
        catch {
            return '{unable to serialize args}';
        }
    }
    freshStats() {
        return {
            totalEvaluations: 0,
            approvals: 0,
            denials: 0,
            modifications: 0,
            escalations: 0,
            learnedDecisions: 0,
            cacheHits: 0,
            cacheMisses: 0,
            totalRiskScore: 0,
            totalEvaluationTimeMs: 0,
        };
    }
}
// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------
export function createSmartMonitor(config = {}, apiClient = null) {
    return new SmartMonitor(config, apiClient);
}
export function defaultSmartMonitorConfig() {
    return { ...DEFAULT_CONFIG };
}
//# sourceMappingURL=smart-monitor.js.map
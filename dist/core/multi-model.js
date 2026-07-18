// ============================================================
// NeuroCLI - Multi-Model Orchestrator/Worker Pattern (GAP-33)
// Cost-stratified orchestration: expensive model plans,
// cheap model executes, medium model evaluates.
// Inspired by Aider's Architect mode.
// ============================================================
import { MODELS } from '../api/models.js';
import { FallbackChain } from './fallback.js';
import { SpendingMonitor } from './spending-warnings.js';
// ============================================================
// Classification Prompt Builder
// ============================================================
const CLASSIFICATION_SYSTEM_PROMPT = `You are a task classifier for a multi-model AI orchestration system. Analyze the user's prompt and classify it according to these dimensions:

1. COMPLEXITY: How difficult is this task?
   - "trivial": Simple lookup, greeting, single factual answer
   - "simple": Single-step task, basic code edit, short answer
   - "moderate": Multi-step task, moderate code changes, debugging
   - "complex": Multi-phase implementation, architecture decisions, large refactors
   - "critical": Production-critical changes, security-sensitive, data migration

2. SUGGESTED ROLE: Which model role should handle this?
   - "worker": For trivial/simple tasks (cheap, fast execution)
   - "orchestrator": For complex/critical tasks (expensive, capable planning)
   - "evaluator": For quality assessment tasks
   - "reviewer": For code review tasks

3. ESTIMATED TOKENS: Rough token count for input + expected output

Respond ONLY with valid JSON in this exact format:
{"complexity":"<trivial|simple|moderate|complex|critical>","suggestedRole":"<worker|orchestrator|evaluator|reviewer>","estimatedTokens":<number>,"reasoning":"<brief explanation>"}`;
// ============================================================
// Default Configuration
// ============================================================
export const DEFAULT_ORCHESTRATOR_CONFIG = {
    roles: {
        orchestrator: {
            name: 'orchestrator',
            model: 'qwen/qwen3-coder:free',
            fallbackModels: [
                'nvidia/nemotron-3-super-120b-a12b:free',
                'meta-llama/llama-3.3-70b-instruct:free',
            ],
            maxTokensPerRequest: 262000,
            description: 'Expensive/capable model for planning and decomposition',
        },
        worker: {
            name: 'worker',
            model: 'google/gemma-4-31b-it:free',
            fallbackModels: [
                'meta-llama/llama-3.3-70b-instruct:free',
                'nvidia/nemotron-3-nano-30b-a3b:free',
            ],
            maxTokensPerRequest: 32768,
            description: 'Cheap/fast model for execution and editing',
        },
        evaluator: {
            name: 'evaluator',
            model: 'qwen/qwen3-coder:free',
            fallbackModels: [
                'nvidia/nemotron-3-super-120b-a12b:free',
            ],
            maxTokensPerRequest: 32768,
            description: 'Medium model for quality checks and validation',
        },
        reviewer: {
            name: 'reviewer',
            model: 'qwen/qwen3-coder:free',
            fallbackModels: [
                'nvidia/nemotron-3-super-120b-a12b:free',
            ],
            maxTokensPerRequest: 32768,
            description: 'Medium model for code review',
        },
    },
    costBudget: {
        maxPerSession: 1.0,
        maxPerTask: 0.25,
        warnThreshold: 75,
    },
    qualityGates: {
        enabled: true,
        evaluatorModel: 'qwen/qwen3-coder:free',
        minConfidence: 0.7,
    },
    dynamicSwitching: true,
};
// ============================================================
// Complexity Heuristic Tables (Local fallback for classification)
// ============================================================
const TRIVIAL_PATTERNS = [
    /^(hi|hello|hey|thanks|ok|yes|no|done|sure)\b/i,
    /^(what\s+is|define|list)\b/i,
    /\b(trivial|tiny|quick\s+question)\b/i,
];
const SIMPLE_PATTERNS = [
    /\b(simple|basic|quick|easy|short|single|minor)\b/i,
    /\b(fix\s+a?\s*typo|rename|add\s+a\s+comment|format|lint)\b/i,
];
const COMPLEX_PATTERNS = [
    /\b(implement\s+(a\s+)?(full|complete|comprehensive|end-to-end|production))\b/i,
    /\b(build\s+(a\s+)?(system|application|platform|framework|service|architecture))\b/i,
    /\b(design\s+(and\s+implement|the\s+architecture|from\s+scratch))\b/i,
    /\b(multi[\s-]*(step|phase|stage|part|agent|service|module))\b/i,
    /\b(orchestrat|coordinat|integrat|pipeline|workflow)\b/i,
    /\b(complex|comprehensive|sophisticated|enterprise|large-scale)\b/i,
];
const CRITICAL_PATTERNS = [
    /\b(production|critical|security|migration|data\s*loss|irreversible|deploy)\b/i,
    /\b(security\s+(audit|hardening|fix|vulnerability))\b/i,
    /\b(database\s+migration|schema\s+change|breaking\s+change)\b/i,
];
// ============================================================
// MultiModelOrchestrator
// ============================================================
export class MultiModelOrchestrator {
    config;
    client;
    fallbackChain;
    spendingMonitor;
    // Per-role cost tracking
    roleCosts = {
        orchestrator: 0,
        worker: 0,
        evaluator: 0,
        reviewer: 0,
    };
    // Per-model cost tracking
    modelCosts = {};
    // Per-task cost entries
    taskCostEntries = [];
    // Session totals
    sessionTotalCost = 0;
    sessionTotalTokens = 0;
    sessionStartTime;
    // Dynamic switching: worker failure tracking
    workerFailures = [];
    workerUpgradeUntil = 0;
    // Current effective model per role (may differ from config during fallback)
    effectiveModels;
    // Budget exceeded flag
    budgetExceeded = false;
    constructor(config, apiClient) {
        this.config = config;
        this.client = apiClient;
        this.sessionStartTime = Date.now();
        // Initialize effective models from config
        this.effectiveModels = {
            orchestrator: config.roles.orchestrator.model,
            worker: config.roles.worker.model,
            evaluator: config.roles.evaluator.model,
            reviewer: config.roles.reviewer.model,
        };
        // Set up fallback chain with all fallback models from all roles
        const allFallbacks = new Set();
        for (const role of Object.values(config.roles)) {
            for (const fb of role.fallbackModels) {
                allFallbacks.add(fb);
            }
        }
        this.fallbackChain = new FallbackChain(apiClient, {
            models: [...allFallbacks],
            maxRetries: 2,
            retryDelayMs: 3000,
            fallbackOnErrors: ['rate_limit', 'overloaded', 'context_length_exceeded', 'timeout', 'server_error'],
        });
        // Set up spending monitor with budget from config
        this.spendingMonitor = new SpendingMonitor({
            sessionLimit: config.costBudget.maxPerSession,
            dailyLimit: 0,
            warnAtPercent: [config.costBudget.warnThreshold],
            autoStopAtLimit: true,
            trackByModel: true,
        });
    }
    // ===================================================================
    // Task Routing
    // ===================================================================
    /**
     * Classify a task by complexity and suggest the appropriate model role.
     * Uses a lightweight LLM call when possible; falls back to local heuristics.
     */
    async classifyTask(prompt, context) {
        const fullPrompt = context ? `${context}\n\n---\n\n${prompt}` : prompt;
        // Try LLM-based classification using the cheapest available model
        try {
            const classificationModel = this.cheapestAvailableModel();
            const messages = [
                { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
                { role: 'user', content: fullPrompt },
            ];
            const response = await this.client.quickChat(classificationModel, messages, undefined, 0.1);
            const parsed = this.parseClassificationResponse(response.content);
            if (parsed) {
                // Record the cost of classification
                this.recordCost('orchestrator', classificationModel, response.usage, 'task-classification');
                return parsed;
            }
        }
        catch {
            // Fall through to heuristic classification
        }
        // Local heuristic fallback
        return this.classifyTaskHeuristic(prompt);
    }
    /**
     * Route a classification to the appropriate model ID.
     */
    routeToModel(classification) {
        // Check for dynamic upgrade: if worker has been failing, upgrade
        if (classification.suggestedRole === 'worker' && this.isWorkerUpgraded()) {
            return this.getEffectiveModel('orchestrator');
        }
        return this.getEffectiveModel(classification.suggestedRole);
    }
    // ===================================================================
    // Execution Patterns
    // ===================================================================
    /**
     * Full orchestration pipeline:
     *   orchestrator plans -> worker executes -> evaluator checks -> reviewer reviews
     *
     * Quality gates can re-route to orchestrator if evaluator confidence is low.
     */
    async orchestrateAndExecute(prompt, context) {
        const startTime = Date.now();
        const phases = [];
        let escalated = false;
        let escalationReason;
        // Check budget before starting
        if (!this.isWithinBudget()) {
            return {
                plan: this.emptyResponse('orchestrator'),
                execution: this.emptyResponse('worker'),
                totalCost: 0,
                totalTokens: 0,
                phases: [],
                escalated: false,
                success: false,
                timestamp: Date.now(),
            };
        }
        // --- Phase 1: Orchestrator plans ---
        const planStart = Date.now();
        let plan;
        try {
            plan = await this.callOrchestrator(`Plan the approach for the following task. Break it into clear steps.\n\n${context ? `Context:\n${context}\n\n` : ''}Task: ${prompt}`);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return {
                plan: this.emptyResponse('orchestrator'),
                execution: this.emptyResponse('worker'),
                totalCost: 0,
                totalTokens: 0,
                phases: [{ role: 'orchestrator', model: this.getEffectiveModel('orchestrator'), inputTokens: 0, outputTokens: 0, cost: 0, durationMs: Date.now() - planStart, success: false }],
                escalated: false,
                escalationReason: `Orchestrator failed: ${errMsg}`,
                success: false,
                timestamp: Date.now(),
            };
        }
        phases.push({
            role: 'orchestrator',
            model: plan.model,
            inputTokens: plan.usage.inputTokens,
            outputTokens: plan.usage.outputTokens,
            cost: plan.usage.cost,
            durationMs: Date.now() - planStart,
            success: true,
        });
        // Check budget after orchestrator
        if (!this.isWithinBudget()) {
            return {
                plan,
                execution: this.emptyResponse('worker'),
                evaluation: undefined,
                review: undefined,
                totalCost: this.sumPhaseCosts(phases),
                totalTokens: this.sumPhaseTokens(phases),
                phases,
                escalated: false,
                escalationReason: 'Budget exceeded after orchestrator phase',
                success: false,
                timestamp: Date.now(),
            };
        }
        // --- Phase 2: Worker executes ---
        const execStart = Date.now();
        const workerPrompt = `Based on this plan:\n\n${plan.content}\n\nExecute the task:\n${prompt}${context ? `\n\nContext:\n${context}` : ''}`;
        let execution;
        try {
            execution = await this.callWorker(workerPrompt);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.recordWorkerFailure(this.getEffectiveModel('worker'), errMsg);
            phases.push({
                role: 'worker',
                model: this.getEffectiveModel('worker'),
                inputTokens: 0,
                outputTokens: 0,
                cost: 0,
                durationMs: Date.now() - execStart,
                success: false,
            });
            return {
                plan,
                execution: this.emptyResponse('worker'),
                totalCost: this.sumPhaseCosts(phases),
                totalTokens: this.sumPhaseTokens(phases),
                phases,
                escalated: false,
                escalationReason: `Worker failed: ${errMsg}`,
                success: false,
                timestamp: Date.now(),
            };
        }
        phases.push({
            role: 'worker',
            model: execution.model,
            inputTokens: execution.usage.inputTokens,
            outputTokens: execution.usage.outputTokens,
            cost: execution.usage.cost,
            durationMs: Date.now() - execStart,
            success: true,
        });
        // Check budget after worker
        if (!this.isWithinBudget()) {
            return {
                plan,
                execution,
                evaluation: undefined,
                review: undefined,
                totalCost: this.sumPhaseCosts(phases),
                totalTokens: this.sumPhaseTokens(phases),
                phases,
                escalated: false,
                escalationReason: 'Budget exceeded after worker phase',
                success: true,
                timestamp: Date.now(),
            };
        }
        // --- Phase 3: Evaluator checks (if quality gates enabled) ---
        let evaluation;
        if (this.config.qualityGates.enabled) {
            const evalStart = Date.now();
            const evalPrompt = `Evaluate the quality of this work output.\n\nOriginal task: ${prompt}\n\nPlan:\n${plan.content}\n\nExecution output:\n${execution.content}\n\nRate your confidence that the execution correctly and completely fulfills the task on a scale of 0.0 to 1.0. Respond with JSON: {"confidence": <number>, "issues": [<string>], "passed": <boolean>}`;
            try {
                evaluation = await this.callEvaluator(evalPrompt);
                // Parse evaluator confidence
                const evalResult = this.parseEvaluationResponse(evaluation.content);
                if (evalResult) {
                    evaluation.confidence = evalResult.confidence;
                    // If confidence is below threshold, escalate to orchestrator
                    if (evalResult.confidence < this.config.qualityGates.minConfidence) {
                        escalated = true;
                        escalationReason = `Evaluator confidence ${evalResult.confidence.toFixed(2)} below threshold ${this.config.qualityGates.minConfidence}. Issues: ${evalResult.issues.join('; ')}`;
                        // Re-execute with orchestrator model
                        const retryStart = Date.now();
                        const retryPrompt = `The worker's output was evaluated as insufficient (confidence: ${evalResult.confidence}).\n\nIssues: ${evalResult.issues.join('; ')}\n\nOriginal task: ${prompt}\n\nPrevious plan:\n${plan.content}\n\nPrevious output:\n${execution.content}\n\nPlease produce a better execution that addresses these issues.`;
                        try {
                            const retryExecution = await this.callOrchestrator(retryPrompt);
                            phases.push({
                                role: 'orchestrator',
                                model: retryExecution.model,
                                inputTokens: retryExecution.usage.inputTokens,
                                outputTokens: retryExecution.usage.outputTokens,
                                cost: retryExecution.usage.cost,
                                durationMs: Date.now() - retryStart,
                                success: true,
                            });
                            execution = retryExecution;
                        }
                        catch {
                            phases.push({
                                role: 'orchestrator',
                                model: this.getEffectiveModel('orchestrator'),
                                inputTokens: 0,
                                outputTokens: 0,
                                cost: 0,
                                durationMs: Date.now() - retryStart,
                                success: false,
                            });
                        }
                    }
                }
                phases.push({
                    role: 'evaluator',
                    model: evaluation.model,
                    inputTokens: evaluation.usage.inputTokens,
                    outputTokens: evaluation.usage.outputTokens,
                    cost: evaluation.usage.cost,
                    durationMs: Date.now() - evalStart,
                    success: true,
                });
            }
            catch {
                // Evaluator failure is non-fatal; continue without evaluation
                phases.push({
                    role: 'evaluator',
                    model: this.getEffectiveModel('evaluator'),
                    inputTokens: 0,
                    outputTokens: 0,
                    cost: 0,
                    durationMs: Date.now() - evalStart,
                    success: false,
                });
            }
        }
        // Check budget after evaluator
        if (!this.isWithinBudget()) {
            return {
                plan,
                execution,
                evaluation,
                review: undefined,
                totalCost: this.sumPhaseCosts(phases),
                totalTokens: this.sumPhaseTokens(phases),
                phases,
                escalated,
                escalationReason: escalated ? escalationReason : 'Budget exceeded after evaluator phase',
                success: true,
                timestamp: Date.now(),
            };
        }
        // --- Phase 4: Reviewer reviews (if quality gates enabled) ---
        let review;
        if (this.config.qualityGates.enabled) {
            const reviewStart = Date.now();
            const reviewPrompt = `Review the following code/output for correctness, style, and best practices.\n\nOriginal task: ${prompt}\n\nExecution output:\n${execution.content}\n\nProvide a brief review with: {"approved": <boolean>, "comments": [<string>], "severity": "low"|"medium"|"high"}`;
            try {
                review = await this.callReviewer(reviewPrompt);
                phases.push({
                    role: 'reviewer',
                    model: review.model,
                    inputTokens: review.usage.inputTokens,
                    outputTokens: review.usage.outputTokens,
                    cost: review.usage.cost,
                    durationMs: Date.now() - reviewStart,
                    success: true,
                });
            }
            catch {
                // Reviewer failure is non-fatal
                phases.push({
                    role: 'reviewer',
                    model: this.getEffectiveModel('reviewer'),
                    inputTokens: 0,
                    outputTokens: 0,
                    cost: 0,
                    durationMs: Date.now() - reviewStart,
                    success: false,
                });
            }
        }
        const totalCost = this.sumPhaseCosts(phases);
        const totalTokens = this.sumPhaseTokens(phases);
        return {
            plan,
            execution,
            evaluation,
            review,
            totalCost,
            totalTokens,
            phases,
            escalated,
            escalationReason: escalated ? escalationReason : undefined,
            success: true,
            timestamp: Date.now(),
        };
    }
    // ===================================================================
    // Direct Model Access by Role
    // ===================================================================
    /**
     * Call the orchestrator model with a prompt.
     */
    async callOrchestrator(prompt) {
        return this.callRole('orchestrator', prompt);
    }
    /**
     * Call the worker model with a prompt.
     */
    async callWorker(prompt) {
        // Dynamic switching: if worker has been failing, use orchestrator model
        if (this.isWorkerUpgraded()) {
            return this.callRole('orchestrator', prompt);
        }
        return this.callRole('worker', prompt);
    }
    /**
     * Call the evaluator model with a prompt.
     */
    async callEvaluator(prompt) {
        return this.callRole('evaluator', prompt);
    }
    /**
     * Call the reviewer model with a prompt.
     */
    async callReviewer(prompt) {
        return this.callRole('reviewer', prompt);
    }
    // ===================================================================
    // Cost Management
    // ===================================================================
    /**
     * Get the full cost breakdown for this session.
     */
    getSessionCost() {
        return {
            total: this.sessionTotalCost,
            byRole: { ...this.roleCosts },
            byModel: { ...this.modelCosts },
            perTask: [...this.taskCostEntries],
            sessionStart: this.sessionStartTime,
        };
    }
    /**
     * Get cost grouped by role.
     */
    getCostByRole() {
        return { ...this.roleCosts };
    }
    /**
     * Check whether spending is within budget.
     */
    isWithinBudget() {
        if (this.budgetExceeded)
            return false;
        if (this.config.costBudget.maxPerSession > 0 && this.sessionTotalCost >= this.config.costBudget.maxPerSession) {
            this.budgetExceeded = true;
            return false;
        }
        const limitCheck = this.spendingMonitor.checkLimit();
        if (!limitCheck.allowed) {
            this.budgetExceeded = true;
            return false;
        }
        return true;
    }
    // ===================================================================
    // Configuration
    // ===================================================================
    /**
     * Update role configurations partially.
     */
    updateRoles(roles) {
        if (roles.orchestrator) {
            this.config.roles.orchestrator = { ...this.config.roles.orchestrator, ...roles.orchestrator };
            this.effectiveModels.orchestrator = this.config.roles.orchestrator.model;
        }
        if (roles.worker) {
            this.config.roles.worker = { ...this.config.roles.worker, ...roles.worker };
            this.effectiveModels.worker = this.config.roles.worker.model;
        }
        if (roles.evaluator) {
            this.config.roles.evaluator = { ...this.config.roles.evaluator, ...roles.evaluator };
            this.effectiveModels.evaluator = this.config.roles.evaluator.model;
        }
        if (roles.reviewer) {
            this.config.roles.reviewer = { ...this.config.roles.reviewer, ...roles.reviewer };
            this.effectiveModels.reviewer = this.config.roles.reviewer.model;
        }
        // Rebuild fallback chain with updated models
        this.rebuildFallbackChain();
    }
    /**
     * Set a new cost budget.
     */
    setCostBudget(budget) {
        this.config.costBudget = { ...budget };
        this.budgetExceeded = false;
        // Update spending monitor
        this.spendingMonitor = new SpendingMonitor({
            sessionLimit: budget.maxPerSession,
            dailyLimit: 0,
            warnAtPercent: [budget.warnThreshold],
            autoStopAtLimit: true,
            trackByModel: true,
        });
    }
    /**
     * Get the currently effective model for a given role.
     * This may differ from the configured model during fallback scenarios.
     */
    getEffectiveModel(role) {
        return this.effectiveModels[role] ?? this.config.roles.orchestrator.model;
    }
    /**
     * Get the full orchestrator config.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Reset session-level cost tracking and worker failure state.
     */
    resetSession() {
        this.roleCosts = { orchestrator: 0, worker: 0, evaluator: 0, reviewer: 0 };
        this.modelCosts = {};
        this.taskCostEntries = [];
        this.sessionTotalCost = 0;
        this.sessionTotalTokens = 0;
        this.sessionStartTime = Date.now();
        this.workerFailures = [];
        this.workerUpgradeUntil = 0;
        this.budgetExceeded = false;
        this.effectiveModels = {
            orchestrator: this.config.roles.orchestrator.model,
            worker: this.config.roles.worker.model,
            evaluator: this.config.roles.evaluator.model,
            reviewer: this.config.roles.reviewer.model,
        };
        this.spendingMonitor.resetSession();
    }
    // ===================================================================
    // Private: Role Call with Fallback
    // ===================================================================
    /**
     * Call a model for a specific role, with fallback chain support.
     */
    async callRole(roleName, prompt) {
        const role = this.getRoleByName(roleName);
        if (!role) {
            throw new Error(`Unknown role: ${roleName}`);
        }
        const primaryModel = this.effectiveModels[roleName] ?? role.model;
        const messages = [
            { role: 'system', content: this.getSystemPromptForRole(roleName) },
            { role: 'user', content: prompt },
        ];
        const startTime = Date.now();
        try {
            // Try primary model first
            const response = await this.client.chat({
                model: primaryModel,
                messages,
                maxTokens: role.maxTokensPerRequest,
                stream: false,
                temperature: this.getTemperatureForRole(roleName),
            });
            const modelResponse = {
                content: response.content,
                model: primaryModel,
                role: roleName,
                usage: response.usage,
                toolCalls: response.toolCalls ?? [],
                timestamp: Date.now(),
            };
            this.recordCost(roleName, primaryModel, response.usage, prompt.slice(0, 80));
            return modelResponse;
        }
        catch (primaryError) {
            // Primary model failed; try fallback chain
            const errMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
            for (const fallbackModel of role.fallbackModels) {
                try {
                    const response = await this.client.chat({
                        model: fallbackModel,
                        messages,
                        maxTokens: role.maxTokensPerRequest,
                        stream: false,
                        temperature: this.getTemperatureForRole(roleName),
                    });
                    // Update effective model for this role
                    this.effectiveModels[roleName] = fallbackModel;
                    const modelResponse = {
                        content: response.content,
                        model: fallbackModel,
                        role: roleName,
                        usage: response.usage,
                        toolCalls: response.toolCalls ?? [],
                        timestamp: Date.now(),
                    };
                    this.recordCost(roleName, fallbackModel, response.usage, prompt.slice(0, 80));
                    return modelResponse;
                }
                catch {
                    // Continue to next fallback
                    continue;
                }
            }
            // All models failed including fallbacks
            throw new Error(`All models failed for role "${roleName}" (primary: ${primaryModel}). Primary error: ${errMsg}`);
        }
    }
    // ===================================================================
    // Private: Cost Recording
    // ===================================================================
    /**
     * Record a cost entry for a role/model combination.
     */
    recordCost(role, model, usage, taskDescription) {
        const cost = usage.cost;
        this.roleCosts[role] = (this.roleCosts[role] ?? 0) + cost;
        this.modelCosts[model] = (this.modelCosts[model] ?? 0) + cost;
        this.sessionTotalCost += cost;
        this.sessionTotalTokens += usage.inputTokens + usage.outputTokens;
        this.taskCostEntries.push({
            taskDescription: taskDescription.slice(0, 120),
            cost,
            role,
            model,
            timestamp: Date.now(),
        });
        // Also record in the spending monitor for integration with the broader system
        this.spendingMonitor.record({
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cost,
            sessionId: 'multi-model-session',
        });
        // Check warn threshold
        if (this.config.costBudget.maxPerSession > 0) {
            const percentUsed = (this.sessionTotalCost / this.config.costBudget.maxPerSession) * 100;
            if (percentUsed >= this.config.costBudget.warnThreshold) {
                console.warn(`\x1b[33m\x1b[1m[BUDGET WARNING]\x1b[0m Session spending at ${percentUsed.toFixed(1)}% of budget ($${this.sessionTotalCost.toFixed(4)} / $${this.config.costBudget.maxPerSession.toFixed(2)})`);
            }
        }
    }
    // ===================================================================
    // Private: Task Classification
    // ===================================================================
    /**
     * Parse the LLM classification response.
     */
    parseClassificationResponse(content) {
        try {
            // Try to extract JSON from the response (may be wrapped in markdown)
            const jsonMatch = content.match(/\{[\s\S]*?\}/);
            if (!jsonMatch)
                return null;
            const parsed = JSON.parse(jsonMatch[0]);
            const validComplexities = ['trivial', 'simple', 'moderate', 'complex', 'critical'];
            const validRoles = ['worker', 'orchestrator', 'evaluator', 'reviewer'];
            const complexity = validComplexities.includes(parsed.complexity) ? parsed.complexity : 'moderate';
            const suggestedRole = validRoles.includes(parsed.suggestedRole) ? parsed.suggestedRole : 'worker';
            return {
                complexity,
                suggestedRole,
                suggestedModel: this.getEffectiveModel(suggestedRole),
                estimatedTokens: typeof parsed.estimatedTokens === 'number' ? parsed.estimatedTokens : 1000,
                reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'LLM-classified',
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Local heuristic classification fallback.
     * Used when the LLM classification call fails or is unavailable.
     */
    classifyTaskHeuristic(prompt) {
        const length = prompt.length;
        // Check critical patterns first
        for (const pattern of CRITICAL_PATTERNS) {
            if (pattern.test(prompt)) {
                return {
                    complexity: 'critical',
                    suggestedRole: 'orchestrator',
                    suggestedModel: this.getEffectiveModel('orchestrator'),
                    estimatedTokens: Math.max(length * 3, 2000),
                    reasoning: 'Critical patterns detected (production/security/migration)',
                };
            }
        }
        // Check complex patterns
        for (const pattern of COMPLEX_PATTERNS) {
            if (pattern.test(prompt)) {
                return {
                    complexity: 'complex',
                    suggestedRole: 'orchestrator',
                    suggestedModel: this.getEffectiveModel('orchestrator'),
                    estimatedTokens: Math.max(length * 3, 2000),
                    reasoning: 'Complex multi-phase task indicators detected',
                };
            }
        }
        // Check simple patterns
        for (const pattern of SIMPLE_PATTERNS) {
            if (pattern.test(prompt)) {
                return {
                    complexity: 'simple',
                    suggestedRole: 'worker',
                    suggestedModel: this.getEffectiveModel('worker'),
                    estimatedTokens: Math.max(Math.ceil(length / 4), 500),
                    reasoning: 'Simple task indicators detected',
                };
            }
        }
        // Check trivial patterns
        for (const pattern of TRIVIAL_PATTERNS) {
            if (pattern.test(prompt)) {
                return {
                    complexity: 'trivial',
                    suggestedRole: 'worker',
                    suggestedModel: this.getEffectiveModel('worker'),
                    estimatedTokens: Math.max(Math.ceil(length / 4), 100),
                    reasoning: 'Trivial interaction detected',
                };
            }
        }
        // Default to moderate based on length
        if (length > 500) {
            return {
                complexity: 'moderate',
                suggestedRole: 'orchestrator',
                suggestedModel: this.getEffectiveModel('orchestrator'),
                estimatedTokens: Math.ceil(length / 3) + 1000,
                reasoning: 'Long prompt suggests moderate complexity',
            };
        }
        return {
            complexity: 'moderate',
            suggestedRole: 'worker',
            suggestedModel: this.getEffectiveModel('worker'),
            estimatedTokens: Math.ceil(length / 3) + 500,
            reasoning: 'Default moderate classification',
        };
    }
    // ===================================================================
    // Private: Evaluation Parsing
    // ===================================================================
    /**
     * Parse the evaluator's confidence response.
     */
    parseEvaluationResponse(content) {
        try {
            const jsonMatch = content.match(/\{[\s\S]*?\}/);
            if (!jsonMatch)
                return null;
            const parsed = JSON.parse(jsonMatch[0]);
            const confidence = typeof parsed.confidence === 'number'
                ? Math.max(0, Math.min(1, parsed.confidence))
                : 0.5;
            const issues = Array.isArray(parsed.issues)
                ? parsed.issues.filter((i) => typeof i === 'string')
                : [];
            const passed = typeof parsed.passed === 'boolean' ? parsed.passed : confidence >= this.config.qualityGates.minConfidence;
            return { confidence, issues, passed };
        }
        catch {
            return null;
        }
    }
    // ===================================================================
    // Private: Dynamic Switching
    // ===================================================================
    /**
     * Record a worker failure for dynamic switching.
     */
    recordWorkerFailure(model, error) {
        this.workerFailures.push({
            model,
            timestamp: Date.now(),
            error,
        });
        // If 3 or more failures in the last 5 minutes, upgrade worker to orchestrator model
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        const recentFailures = this.workerFailures.filter(f => f.timestamp > fiveMinutesAgo);
        if (recentFailures.length >= 3 && this.config.dynamicSwitching) {
            this.workerUpgradeUntil = Date.now() + 10 * 60 * 1000; // Upgrade for 10 minutes
            console.warn(`\x1b[33m\x1b[1m[DYNAMIC SWITCH]\x1b[0m Worker model has failed ${recentFailures.length} times in 5 minutes. Upgrading to orchestrator model for 10 minutes.`);
        }
    }
    /**
     * Check if the worker is currently upgraded to the orchestrator model.
     */
    isWorkerUpgraded() {
        if (!this.config.dynamicSwitching)
            return false;
        if (this.workerUpgradeUntil <= 0)
            return false;
        if (Date.now() > this.workerUpgradeUntil) {
            this.workerUpgradeUntil = 0;
            // Reset effective model back to worker's configured model
            this.effectiveModels.worker = this.config.roles.worker.model;
            return false;
        }
        return true;
    }
    // ===================================================================
    // Private: Helpers
    // ===================================================================
    /**
     * Get the cheapest available model from the registry.
     * Used for classification calls to minimize cost.
     */
    cheapestAvailableModel() {
        // Prefer free models with tool support
        const freeToolModels = Object.values(MODELS).filter(m => m.inputPrice === 0 && m.outputPrice === 0 && m.supportsTools);
        if (freeToolModels.length > 0) {
            // Sort by context window descending (larger is better for classification)
            freeToolModels.sort((a, b) => b.contextWindow - a.contextWindow);
            return freeToolModels[0].id;
        }
        // Fall back to any free model
        const freeModels = Object.values(MODELS).filter(m => m.inputPrice === 0 && m.outputPrice === 0);
        if (freeModels.length > 0) {
            return freeModels[0].id;
        }
        // Last resort: use worker model
        return this.config.roles.worker.model;
    }
    /**
     * Get the ModelRole config for a given role name.
     */
    getRoleByName(name) {
        switch (name) {
            case 'orchestrator': return this.config.roles.orchestrator;
            case 'worker': return this.config.roles.worker;
            case 'evaluator': return this.config.roles.evaluator;
            case 'reviewer': return this.config.roles.reviewer;
            default: return undefined;
        }
    }
    /**
     * Get a system prompt appropriate for a role.
     */
    getSystemPromptForRole(roleName) {
        switch (roleName) {
            case 'orchestrator':
                return 'You are an expert software architect and planner. Analyze tasks, break them into clear actionable steps, and provide detailed implementation plans. Be thorough and consider edge cases.';
            case 'worker':
                return 'You are an efficient code executor. Follow the provided plan precisely and implement the required changes. Focus on correctness, clean code, and minimal changes. Do not over-engineer.';
            case 'evaluator':
                return 'You are a quality assurance evaluator. Assess whether the execution output correctly and completely fulfills the original task. Be objective and thorough. Rate your confidence from 0.0 to 1.0.';
            case 'reviewer':
                return 'You are a senior code reviewer. Review the output for correctness, style, best practices, potential bugs, and security issues. Be constructive and specific.';
            default:
                return 'You are a helpful AI assistant.';
        }
    }
    /**
     * Get an appropriate temperature for a role.
     */
    getTemperatureForRole(roleName) {
        switch (roleName) {
            case 'orchestrator': return 0.4; // More creative planning
            case 'worker': return 0.2; // Precise execution
            case 'evaluator': return 0.1; // Objective evaluation
            case 'reviewer': return 0.2; // Thorough but precise
            default: return 0.5;
        }
    }
    /**
     * Create an empty ModelResponse for error/budget-exceeded cases.
     */
    emptyResponse(role) {
        return {
            content: '',
            model: this.getEffectiveModel(role),
            role,
            usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
            toolCalls: [],
            timestamp: Date.now(),
        };
    }
    /**
     * Sum the cost of completed phases.
     */
    sumPhaseCosts(phases) {
        return phases.reduce((sum, p) => sum + p.cost, 0);
    }
    /**
     * Sum the tokens of completed phases.
     */
    sumPhaseTokens(phases) {
        return phases.reduce((sum, p) => sum + p.inputTokens + p.outputTokens, 0);
    }
    /**
     * Rebuild the fallback chain when role configs change.
     */
    rebuildFallbackChain() {
        const allFallbacks = new Set();
        for (const role of Object.values(this.config.roles)) {
            for (const fb of role.fallbackModels) {
                allFallbacks.add(fb);
            }
        }
        this.fallbackChain = new FallbackChain(this.client, {
            models: [...allFallbacks],
            maxRetries: 2,
            retryDelayMs: 3000,
            fallbackOnErrors: ['rate_limit', 'overloaded', 'context_length_exceeded', 'timeout', 'server_error'],
        });
    }
}
// ============================================================
// Factory: Create a pre-configured orchestrator
// ============================================================
/**
 * Create a MultiModelOrchestrator with sensible defaults for free models.
 */
export function createFreeOrchestrator(apiClient) {
    return new MultiModelOrchestrator(DEFAULT_ORCHESTRATOR_CONFIG, apiClient);
}
/**
 * Create a MultiModelOrchestrator with premium models for maximum capability.
 */
export function createPremiumOrchestrator(apiClient) {
    const premiumConfig = {
        roles: {
            orchestrator: {
                name: 'orchestrator',
                model: 'anthropic/claude-opus-4',
                fallbackModels: ['openai/o3', 'google/gemini-2.5-pro'],
                maxTokensPerRequest: 32000,
                description: 'Premium orchestrator for complex planning',
            },
            worker: {
                name: 'worker',
                model: 'anthropic/claude-sonnet-4',
                fallbackModels: ['google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
                maxTokensPerRequest: 64000,
                description: 'Capable worker for execution',
            },
            evaluator: {
                name: 'evaluator',
                model: 'google/gemini-2.5-flash',
                fallbackModels: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'],
                maxTokensPerRequest: 65536,
                description: 'Fast evaluator for quality checks',
            },
            reviewer: {
                name: 'reviewer',
                model: 'anthropic/claude-sonnet-4',
                fallbackModels: ['google/gemini-2.5-pro', 'deepseek/deepseek-r1'],
                maxTokensPerRequest: 64000,
                description: 'Thorough reviewer for code review',
            },
        },
        costBudget: {
            maxPerSession: 10.0,
            maxPerTask: 2.0,
            warnThreshold: 75,
        },
        qualityGates: {
            enabled: true,
            evaluatorModel: 'google/gemini-2.5-flash',
            minConfidence: 0.7,
        },
        dynamicSwitching: true,
    };
    return new MultiModelOrchestrator(premiumConfig, apiClient);
}
/**
 * Create a MultiModelOrchestrator with a balanced mix of free and premium models.
 */
export function createBalancedOrchestrator(apiClient) {
    const balancedConfig = {
        roles: {
            orchestrator: {
                name: 'orchestrator',
                model: 'anthropic/claude-sonnet-4',
                fallbackModels: ['qwen/qwen3-coder:free', 'google/gemini-2.5-pro'],
                maxTokensPerRequest: 64000,
                description: 'Balanced orchestrator for planning',
            },
            worker: {
                name: 'worker',
                model: 'qwen/qwen3-coder:free',
                fallbackModels: ['google/gemma-4-31b-it:free', 'deepseek/deepseek-chat'],
                maxTokensPerRequest: 262000,
                description: 'Free worker for execution',
            },
            evaluator: {
                name: 'evaluator',
                model: 'google/gemini-2.5-flash',
                fallbackModels: ['qwen/qwen3-coder:free', 'deepseek/deepseek-chat'],
                maxTokensPerRequest: 65536,
                description: 'Fast evaluator for quality checks',
            },
            reviewer: {
                name: 'reviewer',
                model: 'google/gemini-2.5-flash',
                fallbackModels: ['qwen/qwen3-coder:free', 'deepseek/deepseek-r1'],
                maxTokensPerRequest: 65536,
                description: 'Fast reviewer for code review',
            },
        },
        costBudget: {
            maxPerSession: 3.0,
            maxPerTask: 0.75,
            warnThreshold: 75,
        },
        qualityGates: {
            enabled: true,
            evaluatorModel: 'google/gemini-2.5-flash',
            minConfidence: 0.7,
        },
        dynamicSwitching: true,
    };
    return new MultiModelOrchestrator(balancedConfig, apiClient);
}
//# sourceMappingURL=multi-model.js.map
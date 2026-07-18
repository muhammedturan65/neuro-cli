// ============================================================
// NeuroCLI - LLM Evaluator Hooks (GAP-31)
// LLM-based approval/denial evaluators for hook lifecycle events
// ============================================================
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// YAML frontmatter parser (lightweight, no external dependency)
// ---------------------------------------------------------------------------
function parseYamlFrontmatter(text) {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('---')) {
        return { frontmatter: {}, body: text };
    }
    const closingIndex = trimmed.indexOf('---', 3);
    if (closingIndex === -1) {
        return { frontmatter: {}, body: text };
    }
    const yamlBlock = trimmed.slice(3, closingIndex).trim();
    const body = trimmed.slice(closingIndex + 3).trim();
    const frontmatter = {};
    for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if (value === 'true')
            value = true;
        else if (value === 'false')
            value = false;
        else if (value === 'null' || value === '~')
            value = null;
        else if (/^-?\d+$/.test(value))
            value = Number(value);
        else if (/^-?\d+\.\d+$/.test(value))
            value = Number(value);
        else if (/^["']/.test(value) && /["']$/.test(value))
            value = value.slice(1, -1);
        const keys = key.split('.');
        let target = frontmatter;
        for (let i = 0; i < keys.length - 1; i++) {
            if (target[keys[i]] === undefined)
                target[keys[i]] = {};
            target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
    }
    return { frontmatter, body };
}
// ---------------------------------------------------------------------------
// Prompt construction helpers
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an action evaluator for NeuroCLI, an AI-powered terminal coding assistant.
Your job is to evaluate whether a proposed tool action should be approved, denied, modified, or escalated to the user.

You MUST respond with a JSON object (and nothing else) in the following format:
{
  "decision": "approve" | "deny" | "modify" | "ask-user",
  "confidence": <number between 0 and 1>,
  "reasoning": "<your reasoning>",
  "suggestedModification": { ... } // only when decision is "modify"
  "userQuestion": "<question>"      // only when decision is "ask-user"
}

Guidelines:
- "approve": The action is safe and aligns with project goals.
- "deny": The action is unsafe, destructive, or violates the rubric.
- "modify": The action is mostly fine but needs adjustments to the arguments.
- "ask-user": You are uncertain and the user should decide.
- If your confidence is below 0.7, prefer "ask-user" over a direct decision.
- Always explain your reasoning clearly.`;
function buildEvaluationPrompt(hook, context) {
    const parts = [];
    parts.push(`## Evaluation Rubric\n${hook.rubric}`);
    parts.push(`## Proposed Action\nTool: ${context.toolName}`);
    parts.push(`Arguments:\n\`\`\`json\n${JSON.stringify(context.toolArgs, null, 2)}\n\`\`\``);
    if (context.fileChanges && context.fileChanges.length > 0) {
        parts.push(`## File Changes\n${context.fileChanges.map(fc => {
            const label = fc.type === 'create' ? 'CREATE' : fc.type === 'delete' ? 'DELETE' : 'MODIFY';
            return `- [${label}] ${fc.path}${fc.diff ? '\n' + fc.diff : ''}`;
        }).join('\n')}`);
    }
    if (context.commandOutput) {
        parts.push(`## Command Output\n\`\`\`\n${context.commandOutput.slice(0, 4000)}\n\`\`\``);
    }
    if (context.conversationContext) {
        parts.push(`## Conversation Context\n${context.conversationContext.slice(0, 4000)}`);
    }
    if (context.projectContext) {
        parts.push(`## Project Context (NEURO.md)\n${context.projectContext.slice(0, 4000)}`);
    }
    return parts.join('\n\n');
}
// ---------------------------------------------------------------------------
// Cache key computation
// ---------------------------------------------------------------------------
function computeCacheKey(hook, context) {
    const payload = JSON.stringify({
        tool: context.toolName,
        args: context.toolArgs,
        rubric: hook.rubric,
        model: hook.evaluatorModel,
    });
    return createHash('sha256').update(payload).digest('hex');
}
// ---------------------------------------------------------------------------
// Ollama client (minimal, for local evaluation models)
// ---------------------------------------------------------------------------
async function callOllama(baseUrl, model, systemPrompt, userPrompt, temperature, maxTokens) {
    const start = Date.now();
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            stream: false,
            options: { temperature, num_predict: maxTokens },
        }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${body}`);
    }
    const data = await response.json();
    const content = data.message?.content ?? '';
    return { content, duration: Date.now() - start };
}
// ---------------------------------------------------------------------------
// LLMEvaluatorManager
// ---------------------------------------------------------------------------
export class LLMEvaluatorManager {
    apiClient;
    evaluators = new Map();
    eventIndex = new Map();
    cache = new Map();
    stats = {
        totalEvaluations: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        cacheHits: 0,
        cacheMisses: 0,
        decisions: { approve: 0, deny: 0, modify: 0, 'ask-user': 0 },
        byEvaluator: {},
    };
    defaultModel;
    defaultRubric;
    confidenceThreshold;
    cacheEnabled;
    defaultCacheTTL;
    maxCacheEntries;
    ollamaBaseUrl;
    constructor(apiClient, config) {
        this.apiClient = apiClient;
        this.defaultModel = config?.defaultModel ?? 'google/gemma-4-31b-it:free';
        this.defaultRubric = config?.defaultRubric ?? 'Evaluate whether this action is safe and aligns with project goals';
        this.confidenceThreshold = config?.confidenceThreshold ?? 0.7;
        this.cacheEnabled = config?.cacheEnabled ?? true;
        this.defaultCacheTTL = config?.defaultCacheTTL ?? 600;
        this.maxCacheEntries = config?.maxCacheEntries ?? 1000;
        this.ollamaBaseUrl = config?.ollamaBaseUrl ?? 'http://localhost:11434';
    }
    // -----------------------------------------------------------------------
    // Evaluator registration
    // -----------------------------------------------------------------------
    /** Register a new LLM evaluator hook. */
    registerEvaluator(hook) {
        const resolved = {
            ...hook,
            evaluatorModel: hook.evaluatorModel || this.defaultModel,
            rubric: hook.rubric || this.defaultRubric,
            maxTokens: hook.maxTokens || 512,
            temperature: hook.temperature ?? 0.2,
            cacheDecisions: hook.cacheDecisions ?? this.cacheEnabled,
            cacheTTL: hook.cacheTTL || this.defaultCacheTTL,
            enabled: hook.enabled !== false,
        };
        this.evaluators.set(resolved.id, resolved);
        if (!this.eventIndex.has(resolved.event)) {
            this.eventIndex.set(resolved.event, []);
        }
        const list = this.eventIndex.get(resolved.event);
        if (!list.includes(resolved.id)) {
            list.push(resolved.id);
        }
    }
    /** Remove a registered evaluator by its id. */
    unregisterEvaluator(id) {
        const hook = this.evaluators.get(id);
        if (!hook)
            return;
        this.evaluators.delete(id);
        const list = this.eventIndex.get(hook.event);
        if (list) {
            const idx = list.indexOf(id);
            if (idx !== -1)
                list.splice(idx, 1);
            if (list.length === 0)
                this.eventIndex.delete(hook.event);
        }
        delete this.stats.byEvaluator[id];
    }
    /** Return all registered evaluators. */
    listEvaluators() {
        return Array.from(this.evaluators.values());
    }
    // -----------------------------------------------------------------------
    // Core evaluation
    // -----------------------------------------------------------------------
    /**
     * Run all evaluators registered for `event` against the given `context`.
     * Evaluators are executed sequentially in registration order.
     * The first "deny" short-circuits; "modify" updates the context for
     * subsequent evaluators; "ask-user" is collected and returned.
     */
    async evaluate(event, context) {
        const evaluatorIds = this.eventIndex.get(event) ?? [];
        const matchingEvaluators = evaluatorIds
            .map(id => this.evaluators.get(id))
            .filter(h => h.enabled !== false)
            .filter(h => {
            if (!h.matcher)
                return true;
            return new RegExp(h.matcher).test(context.toolName);
        });
        if (matchingEvaluators.length === 0) {
            return {
                decision: 'approve',
                confidence: 1.0,
                reasoning: 'No evaluators registered for this event/tool combination.',
                cached: false,
                modelUsed: 'none',
                tokensUsed: 0,
                duration: 0,
            };
        }
        let lastResult = null;
        let aggregatedTokens = 0;
        let aggregatedDuration = 0;
        for (const hook of matchingEvaluators) {
            const result = await this.evaluateSingle(hook, context);
            aggregatedTokens += result.tokensUsed;
            aggregatedDuration += result.duration;
            // If confidence is below threshold, escalate to ask-user
            if (result.confidence < this.confidenceThreshold && result.decision !== 'ask-user') {
                result.decision = 'ask-user';
                result.userQuestion = `Low confidence (${(result.confidence * 100).toFixed(0)}%) on evaluation. Reasoning: ${result.reasoning}`;
            }
            // Track stats
            this.stats.totalEvaluations += 1;
            this.stats.totalTokensUsed += result.tokensUsed;
            this.stats.decisions[result.decision] = (this.stats.decisions[result.decision] ?? 0) + 1;
            if (!this.stats.byEvaluator[hook.id]) {
                this.stats.byEvaluator[hook.id] = { evaluations: 0, tokensUsed: 0, cost: 0 };
            }
            this.stats.byEvaluator[hook.id].evaluations += 1;
            this.stats.byEvaluator[hook.id].tokensUsed += result.tokensUsed;
            lastResult = result;
            // Short-circuit on deny
            if (result.decision === 'deny') {
                return {
                    ...result,
                    tokensUsed: aggregatedTokens,
                    duration: aggregatedDuration,
                };
            }
            // Apply modifications to context for downstream evaluators
            if (result.decision === 'modify' && result.suggestedModification) {
                context.toolArgs = { ...context.toolArgs, ...result.suggestedModification };
            }
        }
        return {
            ...lastResult,
            tokensUsed: aggregatedTokens,
            duration: aggregatedDuration,
        };
    }
    // -----------------------------------------------------------------------
    // Single evaluator execution
    // -----------------------------------------------------------------------
    async evaluateSingle(hook, context) {
        const startTime = Date.now();
        // Check cache
        if (hook.cacheDecisions) {
            const cached = this.getFromCache(hook, context);
            if (cached) {
                this.stats.cacheHits += 1;
                return { ...cached, cached: true, duration: Date.now() - startTime };
            }
            this.stats.cacheMisses += 1;
        }
        // Build prompt
        const userPrompt = buildEvaluationPrompt(hook, context);
        let rawContent;
        let tokensUsed;
        let cost;
        let modelUsed = hook.evaluatorModel;
        try {
            if (hook.provider === 'ollama') {
                const ollamaResult = await callOllama(hook.ollamaBaseUrl ?? this.ollamaBaseUrl, hook.evaluatorModel, SYSTEM_PROMPT, userPrompt, hook.temperature, hook.maxTokens);
                rawContent = ollamaResult.content;
                tokensUsed = this.estimateTokens(rawContent);
                cost = 0; // local model, no cost
                modelUsed = hook.evaluatorModel;
            }
            else {
                // Use OpenRouter client
                const chatResult = await this.apiClient.quickChat(hook.evaluatorModel, [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ], undefined, hook.temperature);
                rawContent = chatResult.content;
                tokensUsed = chatResult.usage.inputTokens + chatResult.usage.outputTokens;
                cost = chatResult.usage.cost;
                modelUsed = hook.evaluatorModel;
            }
        }
        catch (error) {
            // On error, fall back to the hook's default action
            return {
                decision: hook.action,
                confidence: 0,
                reasoning: `Evaluator call failed: ${error instanceof Error ? error.message : String(error)}. Falling back to default action.`,
                cached: false,
                modelUsed: 'error-fallback',
                tokensUsed: 0,
                duration: Date.now() - startTime,
            };
        }
        // Parse the LLM response
        const result = this.parseEvaluationResponse(rawContent, modelUsed, tokensUsed);
        result.duration = Date.now() - startTime;
        result.cached = false;
        // Track cost
        this.stats.totalCost += cost;
        if (this.stats.byEvaluator[hook.id]) {
            this.stats.byEvaluator[hook.id].cost += cost;
        }
        // Store in cache
        if (hook.cacheDecisions) {
            this.storeInCache(hook, context, result);
        }
        return result;
    }
    // -----------------------------------------------------------------------
    // Response parsing
    // -----------------------------------------------------------------------
    parseEvaluationResponse(rawContent, modelUsed, tokensUsed) {
        // Try to extract JSON from the response
        let parsed = null;
        // Attempt 1: Direct parse of the full content
        try {
            parsed = JSON.parse(rawContent);
        }
        catch {
            // Attempt 2: Extract JSON from markdown code fences
            const fenceMatch = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            if (fenceMatch) {
                try {
                    parsed = JSON.parse(fenceMatch[1]);
                }
                catch {
                    // continue to fallback
                }
            }
            // Attempt 3: Find the first { ... } block
            if (!parsed) {
                const braceMatch = rawContent.match(/\{[\s\S]*\}/);
                if (braceMatch) {
                    try {
                        parsed = JSON.parse(braceMatch[0]);
                    }
                    catch {
                        // continue to fallback
                    }
                }
            }
        }
        // Fallback: if we could not parse JSON, create a heuristic result
        if (!parsed || typeof parsed !== 'object') {
            const lower = rawContent.toLowerCase();
            let decision = 'approve';
            if (lower.includes('deny') || lower.includes('block') || lower.includes('reject')) {
                decision = 'deny';
            }
            else if (lower.includes('modify') || lower.includes('adjust') || lower.includes('suggest')) {
                decision = 'modify';
            }
            else if (lower.includes('ask') || lower.includes('unsure') || lower.includes('uncertain')) {
                decision = 'ask-user';
            }
            return {
                decision,
                confidence: 0.5,
                reasoning: rawContent.slice(0, 1000),
                cached: false,
                modelUsed,
                tokensUsed,
                duration: 0,
            };
        }
        // Validate and normalise parsed object
        const validDecisions = new Set(['approve', 'deny', 'modify', 'ask-user']);
        const decision = validDecisions.has(parsed.decision) ? parsed.decision : 'ask-user';
        const confidence = typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5;
        const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
        const suggestedModification = parsed.suggestedModification ?? undefined;
        const userQuestion = parsed.userQuestion ?? undefined;
        return {
            decision,
            confidence,
            reasoning,
            suggestedModification,
            userQuestion,
            cached: false,
            modelUsed,
            tokensUsed,
            duration: 0,
        };
    }
    // -----------------------------------------------------------------------
    // Cache management
    // -----------------------------------------------------------------------
    getFromCache(hook, context) {
        const key = computeCacheKey(hook, context);
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return { ...entry.result };
    }
    storeInCache(hook, context, result) {
        // Evict oldest entries when cache is full
        if (this.cache.size >= this.maxCacheEntries) {
            const keys = Array.from(this.cache.keys());
            const toDelete = Math.ceil(this.maxCacheEntries * 0.2);
            for (let i = 0; i < toDelete && i < keys.length; i++) {
                this.cache.delete(keys[i]);
            }
        }
        const key = computeCacheKey(hook, context);
        this.cache.set(key, {
            result: { ...result },
            expiresAt: Date.now() + hook.cacheTTL * 1000,
        });
    }
    /** Remove all cached decisions. */
    clearCache() {
        this.cache.clear();
    }
    // -----------------------------------------------------------------------
    // Loading evaluators from .neuro/hooks/ YAML files
    // -----------------------------------------------------------------------
    /**
     * Scan `dir/.neuro/hooks/` for YAML files with frontmatter and register
     * them as evaluators.
     *
     * Expected file format:
     * ```
     * ---
     * id: my-evaluator
     * name: My Safety Evaluator
     * event: BeforeTool
     * evaluatorModel: google/gemma-4-31b-it:free
     * action: deny
     * maxTokens: 256
     * temperature: 0.1
     * cacheDecisions: true
     * cacheTTL: 300
     * matcher: "write|delete|exec"
     * provider: openrouter
     * ---
     * Never allow modifications to .env files or deletion of test files.
     * ```
     *
     * The body (after frontmatter) becomes the rubric.
     */
    async loadFromConfig(dir) {
        const hooksDir = join(dir, '.neuro', 'hooks');
        let entries;
        try {
            entries = await readdir(hooksDir);
        }
        catch {
            // Directory does not exist — nothing to load
            return;
        }
        for (const entry of entries) {
            if (!entry.endsWith('.yml') && !entry.endsWith('.yaml'))
                continue;
            const filePath = join(hooksDir, entry);
            let fileStat;
            try {
                fileStat = await stat(filePath);
            }
            catch {
                continue;
            }
            if (!fileStat.isFile())
                continue;
            const content = await readFile(filePath, 'utf-8');
            const { frontmatter, body } = parseYamlFrontmatter(content);
            if (!frontmatter.id || !frontmatter.event) {
                // Skip files missing required fields
                continue;
            }
            const hook = {
                id: String(frontmatter.id),
                name: String(frontmatter.name ?? frontmatter.id),
                event: frontmatter.event,
                evaluatorModel: String(frontmatter.evaluatorModel ?? this.defaultModel),
                rubric: String(frontmatter.rubric ?? body ?? this.defaultRubric),
                action: frontmatter.action ?? 'ask-user',
                maxTokens: typeof frontmatter.maxTokens === 'number' ? frontmatter.maxTokens : 512,
                temperature: typeof frontmatter.temperature === 'number' ? frontmatter.temperature : 0.2,
                cacheDecisions: frontmatter.cacheDecisions !== false,
                cacheTTL: typeof frontmatter.cacheTTL === 'number' ? frontmatter.cacheTTL : this.defaultCacheTTL,
                matcher: frontmatter.matcher != null ? String(frontmatter.matcher) : undefined,
                enabled: frontmatter.enabled !== false,
                provider: frontmatter.provider ?? undefined,
                ollamaBaseUrl: frontmatter.ollamaBaseUrl != null ? String(frontmatter.ollamaBaseUrl) : undefined,
            };
            this.registerEvaluator(hook);
        }
    }
    // -----------------------------------------------------------------------
    // Statistics
    // -----------------------------------------------------------------------
    /** Return a snapshot of aggregate evaluation statistics. */
    getStats() {
        return {
            totalEvaluations: this.stats.totalEvaluations,
            totalTokensUsed: this.stats.totalTokensUsed,
            totalCost: this.stats.totalCost,
            cacheHits: this.stats.cacheHits,
            cacheMisses: this.stats.cacheMisses,
            decisions: { ...this.stats.decisions },
            byEvaluator: Object.fromEntries(Object.entries(this.stats.byEvaluator).map(([id, s]) => [id, { ...s }])),
        };
    }
    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    /** Rough token estimator when exact counts are unavailable. */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
}
//# sourceMappingURL=llm-evaluator.js.map
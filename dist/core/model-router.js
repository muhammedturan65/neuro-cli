// ============================================================
// NeuroCLI - Model Router
// Automatically selects the best model based on task complexity,
// category, and effort level using local heuristic analysis.
// ============================================================
// ---------------------------------------------------------------------------
// Keyword / pattern tables
// ---------------------------------------------------------------------------
const CATEGORY_PATTERNS = {
    code: [
        /\b(write|create|implement|build|develop|code|program|function|class|method|module|api|endpoint|component|hook|middleware|service|library|package|script|utility|helper|factory|adapter|decorator|singleton|interface|type|enum|struct|trait|impl|abstract)\b/i,
        /\b(generat|scaffold|bootstrap|setup|init|boilerplate|snippet|algorithm|data\s*structure|parse|serialize|deserialize|encode|decode|compile|transpil|bundl)\b/i,
        /\b(react|vue|angular|svelte|next|nuxt|express|fastify|nestjs|django|flask|spring|rails|laravel)\b/i,
        /\b(sql|graphql|rest|grpc|websocket|rpc|crud|orm|migration|schema|query|mutation|subscription)\b/i,
        /\b(typescript|javascript|python|rust|go|java|c\+\+|ruby|swift|kotlin|scala|php|perl|shell|bash)\b/i,
    ],
    reasoning: [
        /\b(analy[zs]|evaluat|reason|deduc|infer|logic|propositional|syllogism|premise|conclusion|argument|proof|theorem|lemma)\b/i,
        /\b(why\s+does|how\s+does|what\s+causes|explain\s+why|explain\s+how|causal|correlat|implication|contradiction|paradox)\b/i,
        /\b(compare|contrast|weigh|trade[\s-]?off|pros?\s+and\s+cons?|advantage|disadvantage|merit|drawback|criterion|criteria)\b/i,
        /\b(decide|decision|choose|select\s+between|opt\s+for|rational|optimal|strategy|heuristic|judg[ei]|assess)\b/i,
        /\b(philosoph|ethical|moral|epistem|ontolog|metaphys|dialectic|hypothesis|hypothes[ie]s)\b/i,
    ],
    creative: [
        /\b(write|creat|compos|draft|story|poem|poetry|novel|fiction|narrative|tale|fable|myth|lore)\b/i,
        /\b(song|lyric|rap|ballad|haiku|limerick|sonnet|verse|stanza|rhyme)\b/i,
        /\b(creative|imagin|inspir|brainstorm|ideat|invent|original|unique|innovative|artistic|expressive)\b/i,
        /\b(screenplay|dialog|monologu|script|scene|plot|character|protagonist|antagonist|setting|world[\s-]?build)\b/i,
        /\b(marketing|copy|slogan|tagline|headline|pitch|campaign|brand|motto|manifesto)\b/i,
    ],
    analysis: [
        /\b(analy[zs]|assess|evaluat|measur|metric|statistic|quantif|quantif|data|dataset|insight|trend|pattern)\b/i,
        /\b(report|dashboard|chart|graph|visuali[zs]|plot|histogram|distribution|correlation|regression|outlier|anomal)\b/i,
        /\b(kpi|roi|conversion|retention|churn|funnel|cohort|segment|benchmark|baseline|variance|deviation)\b/i,
        /\b(survey|questionnaire|feedback|sentiment|opinion|poll|research|study|finding|conclusion|recommendation)\b/i,
        /\b(performance|latency|throughput|bottleneck|profiling|benchmark|load\s*test|stress\s*test|capacity)\b/i,
    ],
    conversation: [
        /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|howdy|sup|yo)\b/i,
        /\b(what\s+is|what\s+are|who\s+is|who\s+are|when\s+did|where\s+is|tell\s+me\s+about|explain\s+briefly)\b/i,
        /\b(how\s+do\s+i|how\s+can\s+i|help\s+me|can\s+you|could\s+you|would\s+you|please\s+(help|explain|tell|show))\b/i,
        /\b(thanks?|thank\s+you|appreciate|got\s*it|understood|makes?\s+sense|right|ok|okay|sure|cool|great|nice|awesome)\b/i,
        /\b(chat|talk|discuss|convers|question|answer|curious|wondering)\b/i,
    ],
    debugging: [
        /\b(debug|bug|error|issue|problem|crash|exception|traceback|stack\s*trace|fault|failure|faulty)\b/i,
        /\b(fix|repair|patch|resolve|troubleshoot|diagnos|investigat|root\s*cause|bisect|pinpoint|isolate)\b/i,
        /\b(not\s+work|broken|wrong|unexpected|incorrect|misbehav|regression|side\s*effect|glitch|hang|freeze)\b/i,
        /\b(log|stderr|stdout|assert|throw|catch|try|raise|panic|fatal|segfault|overflow|underflow|null\s*pointer|nil)\b/i,
        /\b(reproduce|repro|minimal\s+(repro|example|case)|step\s+to\s+reproduce|stack\s*overflow|memory\s*leak)\b/i,
    ],
    review: [
        /\b(review|audit|inspect|examine|check|verify|validat|ensure|confirm|certif|compliance)\b/i,
        /\b(code\s*review|pull\s*request|pr|merge\s*request|diff|change|change\s*set|patch|commit)\b/i,
        /\b(quality|standard|guideline|convention|style|lint|best\s*practice|clean\s*code|solid|dry|kiss)\b/i,
        /\b(secur|vulnerab|exploit|cve|owasp|injection|xss|csrf|sanitize|escape|encrypt|auth|perm)\b/i,
        /\b(performance\s*review|architectur(e|al)\s*review|design\s*review|security\s*review|readability)\b/i,
    ],
    refactoring: [
        /\b(refactor|restructur|reorganiz|rearrang|rearchitect|rewrite|overhaul|moderniz|migrate|port)\b/i,
        /\b(clean\s*up|simplif|duplicat|dead\s*code|unused|redundant|consolidat|merge|split|extract|inline)\b/i,
        /\b(design\s*pattern|solid|dry|kiss|yagni|coupling|cohesion|separation\s*of\s*concerns|single\s*responsib)\b/i,
        /\b(rename|rename|move|promote|demote|encapsulat|abstract|generaliz|speciali[zs]|parametri[zs])\b/i,
        /\b(improv(e|ing)|enhanc(e|ing)|optimi[zs]|speed\s*up|reduc(e|ing)|streamlin|declutter|tidy)\b/i,
    ],
};
const COMPLEXITY_SIGNALS = {
    simple: {
        patterns: [
            /^(what\s+is|what\s+are|who\s+is|define|explain\s+briefly|list|show\s+me|tell\s+me|give\s+me\s+a)\b/i,
            /\b(simple|basic|quick|easy|short|small|single|one|trivial|minor|tiny|brief)\b/i,
            /\b(hello|hi|thanks|yes|no|ok|sure|done|correct|right|please)\b/i,
        ],
        lengthThreshold: 80,
        maxSteps: 5,
    },
    moderate: {
        patterns: [
            /\b(add|modify|update|change|extend|enhance|improve|adjust|configure|customize)\b/i,
            /\b(fix|debug|solve|resolve|handle|implement\s+a|write\s+a|create\s+a)\b/i,
            /\b(test|spec|assert|validate|verify)\b/i,
            /\b(review|check|audit|inspect|compare|evaluate)\b/i,
            /\b(refactor|clean|simplify|optimize|restructure)\b/i,
        ],
        lengthThreshold: 300,
        maxSteps: 15,
    },
    complex: {
        patterns: [
            /\b(implement\s+(a\s+)?(full|complete|entire|comprehensive|end[\s-]to[\s-]end|production|scalable|robust))\b/i,
            /\b(build\s+(a\s+)?(system|application|platform|framework|service|architecture|infrastructure|pipeline))\b/i,
            /\b(design\s+(and\s+implement|the\s+architecture|a\s+system|from\s+scratch))\b/i,
            /\b(migrate|migration|port\s+from|rewrite\s+(from|the|entire)|overhaul|modernize)\b/i,
            /\b(multi[\s-]*(step|phase|stage|part|agent|service|module|component)|micro[\s-]*service|distributed)\b/i,
            /\b(orchestrat|coordinat|integrat|synchron[iz]|pipeline|workflow|state\s*machine)\b/i,
            /\b(complex|comprehensive|intricate|sophisticated|elaborate|advanced|enterprise|large[\s-]*scale)\b/i,
            /\b(security\s+(audit|review|hardening)|performance\s+(optim|tuning|profiling)|scalab(ility|le))\b/i,
        ],
        lengthThreshold: 500,
        maxSteps: 30,
    },
};
// ---------------------------------------------------------------------------
// Step-counting heuristics
// ---------------------------------------------------------------------------
const STEP_INDICATORS = [
    /\band\b/gi,
    /\bthen\b/gi,
    /\bafter\s+(that|which|complet|finish|done)\b/gi,
    /\bfinally\b/gi,
    /\bnext\b/gi,
    /\bfollowed\s+by\b/gi,
    /\bonce\s+(that|it|complete|done|finish)\b/gi,
    /\bsubsequently\b/gi,
    /\badditionally\b/gi,
    /\bfurthermore\b/gi,
    /\bmoreover\b/gi,
];
// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------
export class ModelRouter {
    config;
    availableModels;
    currentEffort = 'medium';
    forcedModel = null;
    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------
    constructor(config, availableModels) {
        this.config = config;
        this.availableModels = availableModels;
        this.validateConfig();
    }
    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    /**
     * Route a prompt to the best available model.
     */
    route(prompt, effort) {
        const effectiveEffort = effort ?? this.currentEffort;
        const analysis = this.analyzePrompt(prompt);
        const estimatedTokens = this.estimateTokens(prompt);
        const model = this.selectModel(analysis.complexity, analysis.category, effectiveEffort);
        const alternatives = this.getAlternatives(analysis.complexity, analysis.category);
        const reasoning = this.buildReasoning(analysis, effectiveEffort, model);
        return {
            model,
            complexity: analysis.complexity,
            category: analysis.category,
            effort: effectiveEffort,
            estimatedTokens,
            reasoning,
            alternatives,
        };
    }
    /**
     * Set the default effort level for subsequent routing calls.
     */
    setEffort(level) {
        this.currentEffort = level;
    }
    /**
     * Get the current effort level.
     */
    getEffort() {
        return this.currentEffort;
    }
    /**
     * Force all routing decisions to use a specific model.
     */
    overrideModel(modelId) {
        if (!this.availableModels[modelId]) {
            throw new Error(`Cannot override to unknown model "${modelId}". Available: ${Object.keys(this.availableModels).join(', ')}`);
        }
        this.forcedModel = modelId;
    }
    /**
     * Remove any forced model override.
     */
    clearOverride() {
        this.forcedModel = null;
    }
    /**
     * Classify the task category of a prompt.
     */
    getCategory(prompt) {
        return this.analyzePrompt(prompt).category;
    }
    /**
     * Classify the complexity of a prompt.
     */
    getComplexity(prompt) {
        return this.analyzePrompt(prompt).complexity;
    }
    /**
     * Estimate the number of tokens a prompt will consume.
     * Uses a character-based heuristic (~4 chars per token for English,
     * with adjustments for code-heavy content).
     */
    estimateTokens(prompt) {
        if (prompt.length === 0)
            return 0;
        // Base estimate: ~4 characters per token for typical English text
        let charPerToken = 4;
        // Code-heavy prompts tend to have higher token density
        const codeIndicators = [
            /```[\s\S]*?```/, // fenced code blocks
            /\bfunction\b/, // function keyword
            /\bconst\b|\blet\b|\bvar\b/, // variable declarations
            /[{}()\[\];]/, // braces and brackets
            /=>/, // arrow functions
            /import\s+.+\s+from/, // imports
        ];
        const codeSignalCount = codeIndicators.filter(p => p.test(prompt)).length;
        if (codeSignalCount >= 3) {
            charPerToken = 3.2; // code is denser
        }
        else if (codeSignalCount >= 1) {
            charPerToken = 3.6;
        }
        // Whitespace-heavy prompts have lower density
        const whitespaceRatio = (prompt.match(/\s/g) ?? []).length / prompt.length;
        if (whitespaceRatio > 0.4) {
            charPerToken = 4.5;
        }
        const baseTokens = Math.ceil(prompt.length / charPerToken);
        // Add overhead for special tokens (system, role markers, etc.)
        const overhead = 8;
        return baseTokens + overhead;
    }
    /**
     * Print a human-readable routing decision to stdout.
     */
    printDecision(decision) {
        const border = '-'.repeat(60);
        const lines = [
            border,
            '  MODEL ROUTING DECISION',
            border,
            `  Model       : ${decision.model}`,
            `  Complexity  : ${decision.complexity}`,
            `  Category    : ${decision.category}`,
            `  Effort      : ${decision.effort}`,
            `  Est. Tokens : ${decision.estimatedTokens.toLocaleString()}`,
            `  Reasoning   : ${decision.reasoning}`,
        ];
        if (decision.alternatives.length > 0) {
            lines.push(`  Alternatives: ${decision.alternatives.join(', ')}`);
        }
        lines.push(border);
        for (const line of lines) {
            console.log(line);
        }
    }
    // -----------------------------------------------------------------------
    // Private: prompt analysis
    // -----------------------------------------------------------------------
    analyzePrompt(prompt) {
        const indicators = [];
        // --- Category detection (scored) ---
        const categoryScores = this.scoreCategories(prompt);
        const category = this.pickTopCategory(categoryScores, indicators);
        // --- Complexity detection (scored) ---
        const complexity = this.scoreComplexity(prompt, indicators);
        return { complexity, category, indicators };
    }
    /**
     * Score each category based on how many pattern groups match.
     * Each group in CATEGORY_PATTERNS is worth 1 point when at least one
     * pattern in the group matches.
     */
    scoreCategories(prompt) {
        const scores = new Map();
        for (const [cat, patternGroups] of Object.entries(CATEGORY_PATTERNS)) {
            let score = 0;
            for (const pattern of patternGroups) {
                if (pattern.test(prompt)) {
                    score += 1;
                }
            }
            scores.set(cat, score);
        }
        return scores;
    }
    /**
     * Determine the winning category and record indicators.
     */
    pickTopCategory(scores, indicators) {
        let bestCategory = 'conversation';
        let bestScore = 0;
        for (const [cat, score] of scores) {
            if (score > bestScore) {
                bestScore = score;
                bestCategory = cat;
            }
        }
        // If nothing matched at all, default to conversation
        if (bestScore === 0) {
            indicators.push('no strong category signals -- defaulting to conversation');
            return 'conversation';
        }
        indicators.push(`category "${bestCategory}" matched with score ${bestScore}`);
        return bestCategory;
    }
    /**
     * Score complexity using a weighted combination of:
     *   1. Pattern match signals
     *   2. Prompt length
     *   3. Multi-step indicators
     */
    scoreComplexity(prompt, indicators) {
        let simpleScore = 0;
        let moderateScore = 0;
        let complexScore = 0;
        // --- Pattern-based scoring ---
        for (const pattern of COMPLEXITY_SIGNALS.simple.patterns) {
            if (pattern.test(prompt)) {
                simpleScore += 2;
                indicators.push(`simple signal: "${this.truncateMatch(prompt, pattern)}"`);
            }
        }
        for (const pattern of COMPLEXITY_SIGNALS.moderate.patterns) {
            if (pattern.test(prompt)) {
                moderateScore += 2;
                indicators.push(`moderate signal: "${this.truncateMatch(prompt, pattern)}"`);
            }
        }
        for (const pattern of COMPLEXITY_SIGNALS.complex.patterns) {
            if (pattern.test(prompt)) {
                complexScore += 3;
                indicators.push(`complex signal: "${this.truncateMatch(prompt, pattern)}"`);
            }
        }
        // --- Length-based scoring ---
        const length = prompt.length;
        if (length <= COMPLEXITY_SIGNALS.simple.lengthThreshold) {
            simpleScore += 1;
            indicators.push(`short prompt (${length} chars)`);
        }
        else if (length <= COMPLEXITY_SIGNALS.moderate.lengthThreshold) {
            moderateScore += 1;
            indicators.push(`medium prompt (${length} chars)`);
        }
        else if (length <= COMPLEXITY_SIGNALS.complex.lengthThreshold) {
            moderateScore += 1;
            complexScore += 1;
            indicators.push(`long prompt (${length} chars)`);
        }
        else {
            complexScore += 2;
            indicators.push(`very long prompt (${length} chars)`);
        }
        // --- Step-count scoring ---
        const stepCount = this.countSteps(prompt);
        if (stepCount <= COMPLEXITY_SIGNALS.simple.maxSteps) {
            simpleScore += 1;
        }
        else if (stepCount <= COMPLEXITY_SIGNALS.moderate.maxSteps) {
            moderateScore += 1;
            indicators.push(`multi-step request (${stepCount} steps detected)`);
        }
        else {
            complexScore += 2;
            indicators.push(`many-step request (${stepCount} steps detected)`);
        }
        // --- Final decision ---
        const maxScore = Math.max(simpleScore, moderateScore, complexScore);
        // Ties go to the higher complexity (safer default)
        if (complexScore === maxScore)
            return 'complex';
        if (moderateScore === maxScore)
            return 'moderate';
        return 'simple';
    }
    /**
     * Count the approximate number of distinct steps or sub-tasks in a prompt.
     */
    countSteps(prompt) {
        let steps = 1; // at least one step
        for (const pattern of STEP_INDICATORS) {
            const matches = prompt.match(pattern);
            if (matches) {
                steps += matches.length;
            }
        }
        return steps;
    }
    /**
     * Extract a short snippet from the prompt that matched a pattern,
     * for use as a human-readable indicator.
     */
    truncateMatch(prompt, pattern) {
        const match = prompt.match(pattern);
        if (!match)
            return '(no match)';
        const text = match[0];
        return text.length > 40 ? text.slice(0, 37) + '...' : text;
    }
    // -----------------------------------------------------------------------
    // Private: model selection
    // -----------------------------------------------------------------------
    selectModel(complexity, category, effort) {
        // 1. User override takes absolute precedence
        if (this.forcedModel) {
            return this.forcedModel;
        }
        // 2. Effort-level model mapping takes precedence when the effort is
        //    explicitly above "medium". This lets users escalate thinking
        //    without changing the prompt.
        if (effort === 'ultrathink' || effort === 'high') {
            const effortModel = this.config.effortModels[effort];
            if (effortModel && this.availableModels[effortModel]) {
                return effortModel;
            }
        }
        // 3. Category-specific override
        const categoryModel = this.config.categoryOverrides[category];
        if (categoryModel && this.availableModels[categoryModel]) {
            return categoryModel;
        }
        // 4. Effort-level mapping for low/medium
        if (effort === 'low' || effort === 'medium') {
            const effortModel = this.config.effortModels[effort];
            if (effortModel && this.availableModels[effortModel]) {
                return effortModel;
            }
        }
        // 5. Complexity-based default
        switch (complexity) {
            case 'simple':
                return this.config.simpleModel;
            case 'moderate':
                return this.config.moderateModel;
            case 'complex':
                return this.config.complexModel;
        }
    }
    /**
     * Return alternative models that could handle the same task but were not
     * selected as the primary choice.
     */
    getAlternatives(complexity, category) {
        const selected = this.selectModel(complexity, category, this.currentEffort);
        const candidates = new Set();
        // Add complexity-adjacent models
        candidates.add(this.config.simpleModel);
        candidates.add(this.config.moderateModel);
        candidates.add(this.config.complexModel);
        // Add effort models
        for (const model of Object.values(this.config.effortModels)) {
            candidates.add(model);
        }
        // Add category override if present
        const categoryModel = this.config.categoryOverrides[category];
        if (categoryModel) {
            candidates.add(categoryModel);
        }
        // Remove the selected model and any models not in the available set
        candidates.delete(selected);
        for (const candidate of [...candidates]) {
            if (!this.availableModels[candidate]) {
                candidates.delete(candidate);
            }
        }
        return [...candidates];
    }
    // -----------------------------------------------------------------------
    // Private: reasoning string
    // -----------------------------------------------------------------------
    buildReasoning(analysis, effort, model) {
        const parts = [];
        if (this.forcedModel) {
            parts.push(`User override forced model to "${this.forcedModel}".`);
            return parts.join(' ');
        }
        parts.push(`Prompt classified as ${analysis.complexity} ${analysis.category} task.`);
        switch (analysis.complexity) {
            case 'simple':
                parts.push('Routed to fast model for quick response.');
                break;
            case 'moderate':
                parts.push('Routed to balanced model for capable response.');
                break;
            case 'complex':
                parts.push('Routed to powerful model for thorough analysis.');
                break;
        }
        if (effort === 'ultrathink') {
            parts.push('Ultrathink mode: using highest-capability model for deep reasoning.');
        }
        else if (effort === 'high') {
            parts.push('High effort: using advanced model for detailed output.');
        }
        else if (effort === 'low') {
            parts.push('Low effort: using fast model for concise response.');
        }
        parts.push(`Selected "${model}".`);
        return parts.join(' ');
    }
    // -----------------------------------------------------------------------
    // Private: config validation
    // -----------------------------------------------------------------------
    validateConfig() {
        const requiredModels = [
            this.config.defaultModel,
            this.config.simpleModel,
            this.config.moderateModel,
            this.config.complexModel,
        ];
        for (const modelId of requiredModels) {
            if (!this.availableModels[modelId]) {
                throw new Error(`RouterConfig references model "${modelId}" which is not in the available models list. ` +
                    `Available: ${Object.keys(this.availableModels).join(', ')}`);
            }
        }
        for (const [level, modelId] of Object.entries(this.config.effortModels)) {
            if (!this.availableModels[modelId]) {
                throw new Error(`RouterConfig effortModels.${level} references model "${modelId}" which is not in the available models list. ` +
                    `Available: ${Object.keys(this.availableModels).join(', ')}`);
            }
        }
        for (const [category, modelId] of Object.entries(this.config.categoryOverrides)) {
            if (modelId && !this.availableModels[modelId]) {
                throw new Error(`RouterConfig categoryOverrides.${category} references model "${modelId}" which is not in the available models list. ` +
                    `Available: ${Object.keys(this.availableModels).join(', ')}`);
            }
        }
        if (this.config.maxTokenBudget <= 0) {
            throw new Error('RouterConfig.maxTokenBudget must be a positive integer.');
        }
    }
}
// ---------------------------------------------------------------------------
// Default configuration factory
// ---------------------------------------------------------------------------
export const DEFAULT_ROUTER_CONFIG = {
    defaultModel: 'anthropic/claude-sonnet-4',
    simpleModel: 'google/gemini-2.0-flash-001',
    moderateModel: 'anthropic/claude-sonnet-4',
    complexModel: 'anthropic/claude-opus-4',
    effortModels: {
        low: 'google/gemini-2.0-flash-001',
        medium: 'anthropic/claude-sonnet-4',
        high: 'anthropic/claude-opus-4',
        ultrathink: 'openai/o3',
    },
    categoryOverrides: {
        code: 'anthropic/claude-sonnet-4',
        reasoning: 'openai/o3',
        creative: 'anthropic/claude-sonnet-4',
        debugging: 'anthropic/claude-sonnet-4',
        review: 'anthropic/claude-sonnet-4',
        refactoring: 'anthropic/claude-sonnet-4',
    },
    maxTokenBudget: 200_000,
};
export const DEFAULT_AVAILABLE_MODELS = {
    'google/gemini-2.0-flash-001': {
        name: 'Gemini 2.0 Flash',
        contextWindow: 1_048_576,
        maxOutput: 8_192,
    },
    'anthropic/claude-sonnet-4': {
        name: 'Claude Sonnet 4',
        contextWindow: 200_000,
        maxOutput: 16_384,
    },
    'anthropic/claude-opus-4': {
        name: 'Claude Opus 4',
        contextWindow: 200_000,
        maxOutput: 32_000,
    },
    'openai/o3': {
        name: 'OpenAI o3',
        contextWindow: 200_000,
        maxOutput: 100_000,
    },
};
//# sourceMappingURL=model-router.js.map
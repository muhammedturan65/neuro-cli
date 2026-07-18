// ============================================================
// NeuroCLI - Rubric-Based Outcome Grading (GAP-35)
// Isolated evaluator grades agent output against structured
// rubrics; revision loop drives agents to meet criteria
// before delivery. Inspired by Claude Code Managed Agents.
// No external dependencies — Node.js built-in modules only.
// ============================================================
import { resolve, join, extname } from 'path';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
// ============================================================
// Constants
// ============================================================
const DEFAULT_GRADING_CONFIG = {
    defaultEvaluatorModel: 'anthropic/claude-sonnet-4',
    globalMaxRevisions: 5,
    rubricsDir: '.neuro/rubrics',
    persistHistory: false,
    historyDir: '.neuro/grading-history',
    evaluatorTemperature: 0.1,
    evaluatorTimeoutMs: 60_000,
};
/** Characters per token heuristic for rough estimation. */
const CHARS_PER_TOKEN = 4;
// ============================================================
// Built-in Rubric Definitions
// ============================================================
function createBuiltinRubrics() {
    return [
        {
            id: 'builtin-code-quality',
            name: 'Code Quality',
            description: 'Evaluates clean code principles: readability, proper naming, absence of code smells, appropriate abstractions, and adherence to SOLID principles.',
            criteria: [
                {
                    id: 'cq-readability',
                    name: 'Readability',
                    description: 'Code is easy to read and understand. Indentation, spacing, and formatting are consistent. Complex logic has explanatory comments.',
                    weight: 0.25,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'cq-naming',
                    name: 'Naming Conventions',
                    description: 'Variables, functions, classes, and modules use clear, descriptive names. No abbreviations unless widely understood. No single-letter variables except loop counters.',
                    weight: 0.2,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'cq-no-smells',
                    name: 'No Code Smells',
                    description: 'No duplicated code, overly long functions (>50 lines), deeply nested logic (>3 levels), magic numbers, or dead code.',
                    weight: 0.25,
                    type: 'boolean',
                    passingScore: 100,
                },
                {
                    id: 'cq-abstractions',
                    name: 'Appropriate Abstractions',
                    description: 'Abstractions are at the right level. No leaky abstractions. Functions do one thing. Classes have single responsibility.',
                    weight: 0.15,
                    type: 'scale',
                    passingScore: 60,
                },
                {
                    id: 'cq-solid',
                    name: 'SOLID Principles',
                    description: 'Code follows SOLID principles where applicable. Dependencies are injected, not hardcoded. Open for extension, closed for modification.',
                    weight: 0.15,
                    type: 'scale',
                    passingScore: 60,
                },
            ],
            passingThreshold: 70,
            maxRevisions: 3,
            evaluatorModel: 'anthropic/claude-sonnet-4',
        },
        {
            id: 'builtin-security',
            name: 'Security',
            description: 'Evaluates security posture: no vulnerabilities, proper input validation, no hardcoded secrets, safe data handling, and follows OWASP guidelines.',
            criteria: [
                {
                    id: 'sec-input-validation',
                    name: 'Input Validation',
                    description: 'All user inputs are validated, sanitized, and type-checked. No trust of client-side data. Parameterized queries used for databases.',
                    weight: 0.3,
                    type: 'boolean',
                    passingScore: 100,
                },
                {
                    id: 'sec-no-secrets',
                    name: 'No Hardcoded Secrets',
                    description: 'No API keys, passwords, tokens, or private keys in source code. Secrets are loaded from environment variables or secret managers.',
                    weight: 0.25,
                    type: 'boolean',
                    passingScore: 100,
                },
                {
                    id: 'sec-vulnerabilities',
                    name: 'No Known Vulnerabilities',
                    description: 'No SQL injection, XSS, CSRF, path traversal, command injection, or other OWASP Top 10 vulnerabilities.',
                    weight: 0.3,
                    type: 'boolean',
                    passingScore: 100,
                },
                {
                    id: 'sec-safe-handling',
                    name: 'Safe Data Handling',
                    description: 'Sensitive data is encrypted at rest and in transit. PII is not logged. Error messages do not leak internal details.',
                    weight: 0.15,
                    type: 'scale',
                    passingScore: 80,
                },
            ],
            passingThreshold: 90,
            maxRevisions: 3,
            evaluatorModel: 'anthropic/claude-sonnet-4',
        },
        {
            id: 'builtin-test-coverage',
            name: 'Test Coverage',
            description: 'Evaluates test quality and coverage: tests exist, cover edge cases, have good assertions, and follow testing best practices.',
            criteria: [
                {
                    id: 'tc-existence',
                    name: 'Tests Exist',
                    description: 'Unit and/or integration tests are present for the implemented functionality.',
                    weight: 0.2,
                    type: 'boolean',
                    passingScore: 100,
                },
                {
                    id: 'tc-edge-cases',
                    name: 'Edge Cases Covered',
                    description: 'Boundary conditions, empty inputs, null/undefined values, large inputs, and error paths are tested.',
                    weight: 0.25,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'tc-assertions',
                    name: 'Meaningful Assertions',
                    description: 'Assertions verify actual behavior, not just that no errors occurred. Each test has clear arrange/act/assert structure.',
                    weight: 0.25,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'tc-isolation',
                    name: 'Test Isolation',
                    description: 'Tests are independent and can run in any order. External dependencies are properly mocked or stubbed. No shared mutable state between tests.',
                    weight: 0.15,
                    type: 'scale',
                    passingScore: 60,
                },
                {
                    id: 'tc-naming',
                    name: 'Test Naming',
                    description: 'Test names clearly describe the scenario and expected outcome. Follow consistent naming convention (e.g., should_X_when_Y).',
                    weight: 0.15,
                    type: 'scale',
                    passingScore: 60,
                },
            ],
            passingThreshold: 70,
            maxRevisions: 3,
            evaluatorModel: 'anthropic/claude-sonnet-4',
        },
        {
            id: 'builtin-performance',
            name: 'Performance',
            description: 'Evaluates performance characteristics: no obvious bottlenecks, efficient algorithms, proper data structure choices, and resource awareness.',
            criteria: [
                {
                    id: 'perf-algorithms',
                    name: 'Efficient Algorithms',
                    description: 'Algorithm complexity is appropriate for the problem. No O(n²) where O(n log n) or O(n) suffices. No unnecessary nested loops.',
                    weight: 0.3,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'perf-data-structures',
                    name: 'Appropriate Data Structures',
                    description: 'Correct data structures are chosen for the use case. Arrays vs Maps vs Sets are used appropriately. No linear searches where hash lookups apply.',
                    weight: 0.25,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'perf-no-bottlenecks',
                    name: 'No Obvious Bottlenecks',
                    description: 'No unnecessary I/O in loops, no synchronous blocking in async contexts, no memory leaks, no excessive object creation.',
                    weight: 0.25,
                    type: 'boolean',
                    passingScore: 100,
                },
                {
                    id: 'perf-resource-awareness',
                    name: 'Resource Awareness',
                    description: 'Connections are pooled, caches used where appropriate, large datasets are streamed rather than loaded entirely, cleanup is handled properly.',
                    weight: 0.2,
                    type: 'scale',
                    passingScore: 60,
                },
            ],
            passingThreshold: 70,
            maxRevisions: 3,
            evaluatorModel: 'anthropic/claude-sonnet-4',
        },
        {
            id: 'builtin-documentation',
            name: 'Documentation',
            description: 'Evaluates documentation quality: code comments, docstrings, README completeness, API documentation, and usage examples.',
            criteria: [
                {
                    id: 'doc-comments',
                    name: 'Code Comments',
                    description: 'Complex logic is explained with inline comments. Comments explain "why", not "what". No commented-out code left behind.',
                    weight: 0.2,
                    type: 'scale',
                    passingScore: 60,
                },
                {
                    id: 'doc-docstrings',
                    name: 'Docstrings / Type Docs',
                    description: 'Public functions, classes, and interfaces have docstrings or TSDoc/JSDoc annotations. Parameters and return values are documented.',
                    weight: 0.3,
                    type: 'scale',
                    passingScore: 70,
                },
                {
                    id: 'doc-readme',
                    name: 'README / Module Docs',
                    description: 'Module or package has a README explaining purpose, installation, usage, and configuration. Examples are provided for common use cases.',
                    weight: 0.25,
                    type: 'scale',
                    passingScore: 60,
                },
                {
                    id: 'doc-api-docs',
                    name: 'API Documentation',
                    description: 'Public APIs are documented with request/response examples. Error codes and edge cases are explained. Authentication is described if applicable.',
                    weight: 0.25,
                    type: 'scale',
                    passingScore: 60,
                },
            ],
            passingThreshold: 65,
            maxRevisions: 3,
            evaluatorModel: 'anthropic/claude-sonnet-4',
        },
    ];
}
// ============================================================
// OutcomeGrader Class
// ============================================================
export class OutcomeGrader {
    rubrics = new Map();
    gradingHistory = [];
    apiClient;
    config;
    constructor(apiClient, config) {
        this.apiClient = apiClient ?? null;
        this.config = { ...DEFAULT_GRADING_CONFIG, ...config };
        // Load built-in rubrics
        for (const rubric of createBuiltinRubrics()) {
            this.rubrics.set(rubric.id, rubric);
        }
    }
    // ----------------------------------------------------------
    // Rubric Management
    // ----------------------------------------------------------
    /**
     * Register a rubric definition. Overwrites any existing rubric with the same id.
     */
    defineRubric(rubric) {
        this.validateRubric(rubric);
        this.rubrics.set(rubric.id, { ...rubric });
    }
    /**
     * Return all registered rubrics.
     */
    listRubrics() {
        return Array.from(this.rubrics.values());
    }
    /**
     * Get a single rubric by id, or undefined if not found.
     */
    getRubric(rubricId) {
        return this.rubrics.get(rubricId);
    }
    /**
     * Remove a rubric by id. Returns true if the rubric existed and was removed.
     */
    removeRubric(rubricId) {
        return this.rubrics.delete(rubricId);
    }
    /**
     * Load rubric definitions from JSON files in a directory.
     * Each .json file should contain a single Rubric object or an array of Rubric objects.
     */
    async loadRubrics(dir) {
        const absDir = resolve(dir);
        if (!existsSync(absDir)) {
            mkdirSync(absDir, { recursive: true });
            return;
        }
        const entries = readdirSync(absDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.json') {
                continue;
            }
            const filePath = join(absDir, entry.name);
            try {
                const raw = readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        this.defineRubric(item);
                    }
                }
                else if (typeof parsed === 'object' && parsed !== null) {
                    this.defineRubric(parsed);
                }
            }
            catch {
                // Skip malformed rubric files silently — callers can validate via listRubrics
            }
        }
    }
    /**
     * Save a rubric to disk as JSON.
     */
    async saveRubric(rubric, dir) {
        const targetDir = resolve(dir ?? this.config.rubricsDir);
        if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
        }
        const filePath = join(targetDir, `${rubric.id}.json`);
        writeFileSync(filePath, JSON.stringify(rubric, null, 2), 'utf-8');
    }
    // ----------------------------------------------------------
    // Grading
    // ----------------------------------------------------------
    /**
     * Grade an output string against a rubric.
     * Uses the isolated evaluator (separate LLM call) so that grading
     * is decoupled from agent reasoning context.
     *
     * If no API client is available, performs heuristic-based grading.
     */
    async grade(output, rubricId, context) {
        const rubric = this.rubrics.get(rubricId);
        if (!rubric) {
            throw new Error(`Rubric not found: "${rubricId}". Available rubrics: ${Array.from(this.rubrics.keys()).join(', ')}`);
        }
        const evaluatorModel = rubric.evaluatorModel || this.config.defaultEvaluatorModel;
        let totalTokensUsed = 0;
        const criteriaResults = [];
        if (this.apiClient && typeof this.apiClient.chat === 'function') {
            // Isolated LLM-based evaluation
            const result = await this.evaluateWithLLM(output, rubric, evaluatorModel, context);
            totalTokensUsed = result.tokensUsed;
            criteriaResults.push(...result.criteriaResults);
        }
        else {
            // Heuristic-based fallback when no API client is available
            const result = this.evaluateWithHeuristics(output, rubric);
            criteriaResults.push(...result);
        }
        // Compute weighted overall score
        let overallScore = 0;
        for (let i = 0; i < rubric.criteria.length; i++) {
            const criterion = rubric.criteria[i];
            const criterionResult = criteriaResults.find((cr) => cr.criterionId === criterion.id);
            if (criterionResult) {
                overallScore += criterion.weight * criterionResult.score;
            }
        }
        overallScore = Math.round(overallScore * 100) / 100;
        const passed = overallScore >= rubric.passingThreshold;
        const revisionNeeded = !passed;
        const revisionSuggestions = this.generateRevisionSuggestions(rubric, criteriaResults);
        const feedback = this.synthesizeFeedback(rubric, criteriaResults, overallScore, passed);
        const gradingResult = {
            rubricId,
            overallScore,
            passed,
            criteriaResults,
            feedback,
            revisionNeeded,
            revisionSuggestions,
            evaluatorModel,
            tokensUsed: totalTokensUsed,
        };
        this.gradingHistory.push(gradingResult);
        if (this.config.persistHistory) {
            this.persistGradingResult(gradingResult);
        }
        return gradingResult;
    }
    /**
     * Grade an agent's output and loop revisions until the rubric is satisfied
     * or the maximum number of revisions is reached.
     *
     * The agent receives grading feedback + revision suggestions after each
     * unsuccessful attempt and is asked to revise.
     */
    async gradeWithRevision(agent, prompt, rubricId) {
        const rubric = this.rubrics.get(rubricId);
        if (!rubric) {
            throw new Error(`Rubric not found: "${rubricId}". Available rubrics: ${Array.from(this.rubrics.keys()).join(', ')}`);
        }
        const maxRevisions = Math.min(rubric.maxRevisions, this.config.globalMaxRevisions);
        const revisionHistory = [];
        let currentOutput = '';
        let currentGrade = null;
        // Initial run
        const initialRun = await agent.run(prompt);
        currentOutput = initialRun.output;
        // Grade the initial output
        currentGrade = await this.grade(currentOutput, rubricId, prompt);
        revisionHistory.push({
            revisionNumber: 0,
            output: currentOutput,
            grade: currentGrade,
            timestamp: Date.now(),
        });
        // Revision loop
        let revisionCount = 0;
        while (!currentGrade.passed && revisionCount < maxRevisions) {
            revisionCount++;
            const revisionPrompt = this.buildRevisionPrompt(prompt, currentOutput, currentGrade, rubric, revisionCount, maxRevisions);
            const revisionRun = await agent.run(revisionPrompt);
            currentOutput = revisionRun.output;
            currentGrade = await this.grade(currentOutput, rubricId, prompt);
            revisionHistory.push({
                revisionNumber: revisionCount,
                output: currentOutput,
                grade: currentGrade,
                timestamp: Date.now(),
            });
        }
        return {
            finalOutput: currentOutput,
            finalGrade: currentGrade,
            totalRevisions: revisionCount,
            revisionHistory,
            passed: currentGrade.passed,
        };
    }
    // ----------------------------------------------------------
    // History
    // ----------------------------------------------------------
    /**
     * Return all grading results from this session.
     */
    getGradingHistory() {
        return [...this.gradingHistory];
    }
    /**
     * Clear all grading history from memory.
     */
    clearHistory() {
        this.gradingHistory = [];
    }
    /**
     * Return grading results filtered by rubric id.
     */
    getGradingHistoryByRubric(rubricId) {
        return this.gradingHistory.filter((g) => g.rubricId === rubricId);
    }
    /**
     * Return the most recent grading result, or undefined if none exists.
     */
    getLatestGrading() {
        if (this.gradingHistory.length === 0)
            return undefined;
        return this.gradingHistory[this.gradingHistory.length - 1];
    }
    // ----------------------------------------------------------
    // Composite Rubric Helpers
    // ----------------------------------------------------------
    /**
     * Create a composite rubric that combines multiple criteria from
     * existing rubrics with custom weights.
     *
     * @param id - Unique id for the composite rubric
     * @param name - Human-readable name
     * @param criteria - Array of { rubricId, criterionId, weight } tuples
     * @param passingThreshold - Overall passing threshold (0-100)
     * @param maxRevisions - Maximum revision attempts
     * @param evaluatorModel - Model to use for evaluation
     */
    createCompositeRubric(id, name, criteria, passingThreshold, maxRevisions = 3, evaluatorModel) {
        const compositeCriteria = [];
        for (const item of criteria) {
            const sourceRubric = this.rubrics.get(item.rubricId);
            if (!sourceRubric) {
                throw new Error(`Source rubric not found: "${item.rubricId}"`);
            }
            const sourceCriterion = sourceRubric.criteria.find((c) => c.id === item.criterionId);
            if (!sourceCriterion) {
                throw new Error(`Criterion "${item.criterionId}" not found in rubric "${item.rubricId}"`);
            }
            // Prefix criterion id with source rubric id to avoid collisions
            compositeCriteria.push({
                ...sourceCriterion,
                id: `${item.rubricId}__${item.criterionId}`,
                weight: item.weight,
            });
        }
        const rubric = {
            id,
            name,
            description: `Composite rubric combining criteria from: ${criteria.map((c) => c.rubricId).join(', ')}`,
            criteria: compositeCriteria,
            passingThreshold,
            maxRevisions,
            evaluatorModel: evaluatorModel ?? this.config.defaultEvaluatorModel,
        };
        this.defineRubric(rubric);
        return rubric;
    }
    // ----------------------------------------------------------
    // Private: LLM-Based Evaluation
    // ----------------------------------------------------------
    /**
     * Evaluate output against all criteria in a rubric using an isolated LLM call.
     * The evaluator runs in a separate context window from the agent, ensuring
     * objective assessment.
     */
    async evaluateWithLLM(output, rubric, model, context) {
        const criteriaDescriptions = rubric.criteria
            .map((c) => {
            let typeGuidance = '';
            if (c.type === 'boolean') {
                typeGuidance = 'Score 100 if the criterion is fully met, 0 if it is not met. No partial scores.';
            }
            else if (c.type === 'scale') {
                typeGuidance = `Score on a 0-100 scale. Passing threshold is ${c.passingScore}.`;
            }
            else {
                typeGuidance = 'Provide a descriptive score from 0-100 based on the quality and completeness of the output for this criterion.';
            }
            return `- ID: ${c.id} | Name: ${c.name} | Weight: ${c.weight}\n  Description: ${c.description}\n  Type: ${c.type} | ${typeGuidance}`;
        })
            .join('\n\n');
        const systemPrompt = `You are an impartial outcome evaluator. Your job is to grade the provided output against a rubric's criteria. You must be objective, evidence-based, and thorough.

SCORING RULES:
- Each criterion gets a score from 0 to 100.
- For "boolean" criteria: score 100 if fully met, 0 if not met.
- For "scale" criteria: score proportionally, with the passing threshold as guidance.
- For "descriptive" criteria: score based on the depth, accuracy, and completeness of the output relative to the criterion description.
- Provide specific evidence from the output to justify each score.
- Provide actionable feedback for improvement.

RESPONSE FORMAT — you MUST respond with valid JSON matching this structure:
{
  "criteriaResults": [
    {
      "criterionId": "<criterion id>",
      "score": <0-100>,
      "passed": <true|false>,
      "feedback": "<specific feedback>",
      "evidence": "<what you found in the output>"
    }
  ]
}

Do NOT include any text outside the JSON object.`;
        const contextSection = context
            ? `\n\nCONTEXT (the original task/prompt):\n${context}`
            : '';
        const userPrompt = `RUBRIC: ${rubric.name}
Passing threshold: ${rubric.passingThreshold}/100

CRITERIA:
${criteriaDescriptions}
${contextSection}

OUTPUT TO EVALUATE:
${output}

Evaluate the output against each criterion. Respond ONLY with the JSON object.`;
        let tokensUsed = 0;
        let criteriaResults = [];
        try {
            const response = await this.apiClient.chat({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: this.config.evaluatorTemperature,
                max_tokens: 4096,
                timeout: this.config.evaluatorTimeoutMs,
            });
            if (response.usage) {
                tokensUsed = response.usage.total_tokens;
            }
            else {
                // Rough estimation
                tokensUsed = Math.ceil((systemPrompt.length + userPrompt.length + response.content.length) / CHARS_PER_TOKEN);
            }
            criteriaResults = this.parseEvaluationResponse(response.content, rubric);
        }
        catch (error) {
            // If LLM call fails, fall back to heuristic grading
            criteriaResults = this.evaluateWithHeuristics(output, rubric);
        }
        // Ensure every criterion has a result
        for (const criterion of rubric.criteria) {
            const existing = criteriaResults.find((cr) => cr.criterionId === criterion.id);
            if (!existing) {
                criteriaResults.push({
                    criterionId: criterion.id,
                    score: 0,
                    passed: false,
                    feedback: `Evaluation failed for criterion "${criterion.name}". Defaulting to 0.`,
                    evidence: 'No evaluation evidence available.',
                });
            }
        }
        return { criteriaResults, tokensUsed };
    }
    /**
     * Parse the LLM's JSON evaluation response into structured CriterionResult objects.
     * Handles malformed responses gracefully.
     */
    parseEvaluationResponse(responseContent, rubric) {
        const results = [];
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = responseContent.trim();
        const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            jsonStr = jsonBlockMatch[1].trim();
        }
        // Try to find JSON object in the response
        const braceStart = jsonStr.indexOf('{');
        const braceEnd = jsonStr.lastIndexOf('}');
        if (braceStart === -1 || braceEnd === -1) {
            return results;
        }
        jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        }
        catch {
            return results;
        }
        if (!parsed || !Array.isArray(parsed.criteriaResults)) {
            return results;
        }
        const validCriterionIds = new Set(rubric.criteria.map((c) => c.id));
        for (const item of parsed.criteriaResults) {
            if (!item.criterionId || !validCriterionIds.has(item.criterionId)) {
                continue;
            }
            const criterion = rubric.criteria.find((c) => c.id === item.criterionId);
            let score = typeof item.score === 'number' ? item.score : 0;
            score = Math.max(0, Math.min(100, Math.round(score)));
            let passed;
            if (criterion.type === 'boolean') {
                passed = score >= 100;
            }
            else {
                passed = score >= criterion.passingScore;
            }
            results.push({
                criterionId: item.criterionId,
                score,
                passed,
                feedback: typeof item.feedback === 'string' ? item.feedback : '',
                evidence: typeof item.evidence === 'string' ? item.evidence : '',
            });
        }
        return results;
    }
    // ----------------------------------------------------------
    // Private: Heuristic-Based Evaluation (fallback)
    // ----------------------------------------------------------
    /**
     * Evaluate output using heuristic pattern matching when no LLM is available.
     * Provides basic quality signals based on code/text analysis.
     */
    evaluateWithHeuristics(output, rubric) {
        const results = [];
        for (const criterion of rubric.criteria) {
            const result = this.evaluateCriterionHeuristic(output, criterion, rubric);
            results.push(result);
        }
        return results;
    }
    /**
     * Apply heuristic scoring for a single criterion based on its type and name.
     */
    evaluateCriterionHeuristic(output, criterion, rubric) {
        const outputLines = output.split('\n');
        const outputLen = output.length;
        const nonEmptyLines = outputLines.filter((l) => l.trim().length > 0).length;
        // Detect if output looks like code
        const codeIndicators = [
            /\bfunction\b/, /\bclass\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
            /\bimport\b/, /\bexport\b/, /\breturn\b/, /\bif\s*\(/, /\bfor\s*\(/,
        ];
        const isCode = codeIndicators.some((pat) => pat.test(output));
        // Detect if output has tests
        const testIndicators = [
            /\bdescribe\s*\(/, /\bit\s*\(/, /\btest\s*\(/, /\bexpect\s*\(/,
            /\bassert\b/, /\bshould\b/, /\bbeforeEach\b/, /\bafterEach\b/,
        ];
        const hasTests = testIndicators.some((pat) => pat.test(output));
        // Detect documentation patterns
        const docIndicators = [
            /\/\*\*[\s\S]*?\*\//, /\/\/\s*.+/, /#{1,6}\s+.+/, /\*\*[^*]+\*\*/,
            /```[\s\S]*?```/,
        ];
        const hasDocs = docIndicators.some((pat) => pat.test(output));
        // Detect security anti-patterns
        const securitySmells = [
            /eval\s*\(/, /innerHTML\s*=/, /document\.write\s*\(/,
            /\bpassword\s*=\s*['"]/, /\bapi[_-]?key\s*=\s*['"]/,
            /\bsecret\s*=\s*['"]/, /SELECT\s+.*\s+FROM\s+/i,
        ];
        const hasSecurityIssues = securitySmells.some((pat) => pat.test(output));
        // Detect performance anti-patterns
        const perfSmells = [
            /for\s*\(.*await\b/, /\.forEach\s*\(.*async/,
            /while\s*\(true\)/, /new Array\(\d{4,}\)/,
        ];
        const hasPerfIssues = perfSmells.some((pat) => pat.test(output));
        let score = 50; // baseline
        let passed = false;
        let feedback = '';
        let evidence = '';
        // Heuristic scoring based on rubric type and criterion name/id
        const nameLower = criterion.name.toLowerCase();
        const idLower = criterion.id.toLowerCase();
        if (idLower.includes('security') || nameLower.includes('security') || nameLower.includes('vulnerabilit') || nameLower.includes('secret') || nameLower.includes('input validation')) {
            if (hasSecurityIssues) {
                score = 20;
                feedback = 'Security anti-patterns detected in the output (e.g., eval, hardcoded secrets, SQL concatenation).';
                evidence = 'Pattern match found security-sensitive constructs.';
            }
            else {
                score = 80;
                feedback = 'No obvious security anti-patterns detected via heuristic scan.';
                evidence = 'Heuristic scan did not find known security smell patterns.';
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        else if (idLower.includes('test') || nameLower.includes('test') || nameLower.includes('coverage') || nameLower.includes('edge case') || nameLower.includes('assertion')) {
            if (hasTests) {
                const testCount = (output.match(/\b(it|test)\s*\(/g) || []).length;
                score = Math.min(100, 50 + testCount * 10);
                feedback = `Found ${testCount} test case(s). Test structure detected.`;
                evidence = `Heuristic detected ${testCount} test() or it() calls.`;
            }
            else {
                score = 15;
                feedback = 'No test patterns detected in the output.';
                evidence = 'Heuristic scan found no describe/test/it/expect patterns.';
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        else if (idLower.includes('doc') || nameLower.includes('doc') || nameLower.includes('comment') || nameLower.includes('readme')) {
            if (hasDocs) {
                const docCommentCount = (output.match(/\/\*\*[\s\S]*?\*\//g) || []).length;
                const inlineCommentCount = (output.match(/\/\/\s*.+/g) || []).length;
                score = Math.min(100, 40 + docCommentCount * 15 + inlineCommentCount * 5);
                feedback = `Found ${docCommentCount} doc comment(s) and ${inlineCommentCount} inline comment(s).`;
                evidence = `Heuristic detected documentation patterns: ${docCommentCount} doc blocks, ${inlineCommentCount} inline comments.`;
            }
            else {
                score = 20;
                feedback = 'No documentation patterns detected.';
                evidence = 'Heuristic scan found no doc comments, inline comments, or markdown headers.';
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        else if (idLower.includes('perf') || nameLower.includes('perform') || nameLower.includes('bottleneck') || nameLower.includes('algorithm') || nameLower.includes('data structure')) {
            if (hasPerfIssues) {
                score = 25;
                feedback = 'Performance anti-patterns detected (e.g., await in loops, unbounded allocations).';
                evidence = 'Pattern match found performance-sensitive constructs.';
            }
            else if (isCode && nonEmptyLines > 10) {
                score = 70;
                feedback = 'No obvious performance anti-patterns detected. Output appears to have reasonable structure.';
                evidence = 'Heuristic scan found no performance smell patterns.';
            }
            else {
                score = 60;
                feedback = 'Limited code to evaluate for performance. No obvious issues detected.';
                evidence = 'Output is too short or not code-like for thorough performance heuristic evaluation.';
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        else if (idLower.includes('readab') || nameLower.includes('readab') || idLower.includes('naming') || nameLower.includes('naming')) {
            if (isCode) {
                const avgLineLen = outputLen / Math.max(nonEmptyLines, 1);
                const longLines = outputLines.filter((l) => l.length > 120).length;
                const lineLenPenalty = longLines * 3;
                const veryShortVars = (output.match(/\b[a-z]\b\s*=/g) || []).length;
                const shortVarPenalty = veryShortVars * 5;
                score = Math.max(0, Math.min(100, 70 - lineLenPenalty - shortVarPenalty));
                feedback = score >= 70
                    ? 'Code appears reasonably readable. Line lengths and naming are acceptable.'
                    : 'Readability could be improved. Some lines are too long or variable names are too short.';
                evidence = `Average line length: ${Math.round(avgLineLen)}. Long lines (>120 chars): ${longLines}. Single-letter variables: ${veryShortVars}.`;
            }
            else {
                score = 60;
                feedback = 'Output is not code; readability heuristic is less applicable.';
                evidence = 'Non-code output detected; readability assessment based on paragraph structure.';
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        else if (idLower.includes('smell') || nameLower.includes('smell') || idLower.includes('solid') || nameLower.includes('solid') || idLower.includes('abstract') || nameLower.includes('abstract')) {
            if (isCode) {
                const duplicateLines = this.countDuplicateLines(outputLines);
                const deepNesting = this.maxNestingDepth(output);
                const dupPenalty = Math.min(30, duplicateLines * 5);
                const nestPenalty = Math.min(20, Math.max(0, deepNesting - 3) * 10);
                score = Math.max(0, Math.min(100, 75 - dupPenalty - nestPenalty));
                feedback = score >= 70
                    ? 'No significant code smells detected heuristically.'
                    : 'Potential code smells: duplicated lines or excessive nesting depth.';
                evidence = `Duplicate non-empty lines: ${duplicateLines}. Max nesting depth: ${deepNesting}.`;
            }
            else {
                score = 60;
                feedback = 'Output is not code; code smell heuristic is less applicable.';
                evidence = 'Non-code output detected; limited heuristic evaluation possible.';
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        else {
            // Generic heuristic for any criterion
            if (outputLen < 50) {
                score = 20;
                feedback = 'Output is very short; insufficient to evaluate this criterion thoroughly.';
                evidence = `Output is only ${outputLen} characters long.`;
            }
            else if (outputLen < 200) {
                score = 45;
                feedback = 'Output is short; limited evidence available for evaluation.';
                evidence = `Output is ${outputLen} characters with ${nonEmptyLines} non-empty lines.`;
            }
            else {
                score = 65;
                feedback = 'Output has reasonable length. Heuristic evaluation provides limited insight without LLM evaluator.';
                evidence = `Output is ${outputLen} characters with ${nonEmptyLines} non-empty lines.`;
            }
            passed = criterion.type === 'boolean' ? score >= 100 : score >= criterion.passingScore;
        }
        return {
            criterionId: criterion.id,
            score,
            passed,
            feedback,
            evidence,
        };
    }
    // ----------------------------------------------------------
    // Private: Revision Loop Helpers
    // ----------------------------------------------------------
    /**
     * Build a prompt that asks the agent to revise its output based on grading feedback.
     */
    buildRevisionPrompt(originalPrompt, currentOutput, grade, rubric, revisionNumber, maxRevisions) {
        const failedCriteria = grade.criteriaResults.filter((cr) => !cr.passed);
        const failedDetails = failedCriteria
            .map((cr) => {
            const criterion = rubric.criteria.find((c) => c.id === cr.criterionId);
            return `  - ${criterion?.name ?? cr.criterionId}: Score ${cr.score}/100 (needed ${criterion?.passingScore ?? 'N/A'})
    Feedback: ${cr.feedback}
    Evidence: ${cr.evidence}`;
        })
            .join('\n');
        return `You previously produced output for this task, but it did not pass the "${rubric.name}" rubric (score: ${grade.overallScore}/${rubric.passingThreshold} needed).

ORIGINAL TASK:
${originalPrompt}

YOUR PREVIOUS OUTPUT:
${currentOutput}

GRADING RESULTS (Revision ${revisionNumber} of ${maxRevisions}):
Overall score: ${grade.overallScore}/100 (passing: ${rubric.passingThreshold})

FAILED CRITERIA:
${failedDetails}

REVISION SUGGESTIONS:
${grade.revisionSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Please revise your output to address the failed criteria. Focus specifically on the areas where you scored below the passing threshold. Produce a complete, revised output that addresses all the feedback.`;
    }
    /**
     * Generate specific, actionable revision suggestions based on failed criteria.
     */
    generateRevisionSuggestions(rubric, criteriaResults) {
        const suggestions = [];
        for (const result of criteriaResults) {
            if (result.passed)
                continue;
            const criterion = rubric.criteria.find((c) => c.id === result.criterionId);
            if (!criterion)
                continue;
            const gap = criterion.passingScore - result.score;
            if (criterion.type === 'boolean' && !result.passed) {
                suggestions.push(`CRITICAL: "${criterion.name}" is a pass/fail criterion that is currently failing. ${criterion.description}. You MUST address this fully.`);
            }
            else if (criterion.type === 'scale') {
                suggestions.push(`Improve "${criterion.name}" by at least ${gap} points. Current score: ${result.score}/${criterion.passingScore} needed. Focus: ${result.feedback || criterion.description}`);
            }
            else {
                suggestions.push(`Enhance "${criterion.name}": ${result.feedback || criterion.description}`);
            }
        }
        // Prioritize boolean failures first
        suggestions.sort((a, b) => {
            const aCrit = a.startsWith('CRITICAL') ? 0 : 1;
            const bCrit = b.startsWith('CRITICAL') ? 0 : 1;
            return aCrit - bCrit;
        });
        return suggestions;
    }
    /**
     * Synthesize overall feedback from criterion results.
     */
    synthesizeFeedback(rubric, criteriaResults, overallScore, passed) {
        const passedCount = criteriaResults.filter((cr) => cr.passed).length;
        const totalCount = criteriaResults.length;
        const status = passed ? 'PASSED' : 'FAILED';
        let feedback = `Rubric "${rubric.name}" ${status}. Overall score: ${overallScore}/100 (threshold: ${rubric.passingThreshold}). ${passedCount}/${totalCount} criteria passed.`;
        if (!passed) {
            const failedNames = criteriaResults
                .filter((cr) => !cr.passed)
                .map((cr) => {
                const c = rubric.criteria.find((crit) => crit.id === cr.criterionId);
                return c?.name ?? cr.criterionId;
            });
            feedback += ` Failed criteria: ${failedNames.join(', ')}.`;
        }
        // Add per-criterion summary
        feedback += '\n\nCriterion breakdown:';
        for (const cr of criteriaResults) {
            const c = rubric.criteria.find((crit) => crit.id === cr.criterionId);
            const statusIcon = cr.passed ? '✓' : '✗';
            feedback += `\n  ${statusIcon} ${c?.name ?? cr.criterionId}: ${cr.score}/100${cr.feedback ? ` — ${cr.feedback}` : ''}`;
        }
        return feedback;
    }
    // ----------------------------------------------------------
    // Private: Rubric Validation
    // ----------------------------------------------------------
    /**
     * Validate that a rubric is well-formed.
     * Throws descriptive errors for structural problems.
     */
    validateRubric(rubric) {
        if (!rubric.id || typeof rubric.id !== 'string') {
            throw new Error('Rubric must have a non-empty string id.');
        }
        if (!rubric.name || typeof rubric.name !== 'string') {
            throw new Error('Rubric must have a non-empty string name.');
        }
        if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
            throw new Error(`Rubric "${rubric.id}" must have at least one criterion.`);
        }
        const weightSum = rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
        if (Math.abs(weightSum - 1) > 0.01) {
            throw new Error(`Rubric "${rubric.id}" criterion weights must sum to 1.0. Current sum: ${weightSum.toFixed(4)}`);
        }
        const ids = new Set();
        for (const criterion of rubric.criteria) {
            if (!criterion.id || typeof criterion.id !== 'string') {
                throw new Error(`Rubric "${rubric.id}" has a criterion with a missing or invalid id.`);
            }
            if (ids.has(criterion.id)) {
                throw new Error(`Rubric "${rubric.id}" has duplicate criterion id: "${criterion.id}".`);
            }
            ids.add(criterion.id);
            if (criterion.weight < 0 || criterion.weight > 1) {
                throw new Error(`Criterion "${criterion.id}" in rubric "${rubric.id}" has weight outside [0, 1]: ${criterion.weight}`);
            }
            if (!['boolean', 'scale', 'descriptive'].includes(criterion.type)) {
                throw new Error(`Criterion "${criterion.id}" in rubric "${rubric.id}" has invalid type: "${criterion.type}". Must be "boolean", "scale", or "descriptive".`);
            }
            if (criterion.passingScore < 0 || criterion.passingScore > 100) {
                throw new Error(`Criterion "${criterion.id}" in rubric "${rubric.id}" has passingScore outside [0, 100]: ${criterion.passingScore}`);
            }
        }
        if (rubric.passingThreshold < 0 || rubric.passingThreshold > 100) {
            throw new Error(`Rubric "${rubric.id}" passingThreshold must be between 0 and 100. Got: ${rubric.passingThreshold}`);
        }
        if (rubric.maxRevisions < 0 || !Number.isInteger(rubric.maxRevisions)) {
            throw new Error(`Rubric "${rubric.id}" maxRevisions must be a non-negative integer. Got: ${rubric.maxRevisions}`);
        }
    }
    // ----------------------------------------------------------
    // Private: Utility Methods
    // ----------------------------------------------------------
    /**
     * Count duplicate non-empty, non-trivial lines in the output.
     */
    countDuplicateLines(lines) {
        const normalized = lines
            .map((l) => l.trim())
            .filter((l) => l.length > 5); // ignore short/trivial lines
        const seen = new Map();
        let duplicates = 0;
        for (const line of normalized) {
            const count = seen.get(line) ?? 0;
            if (count === 1)
                duplicates++; // count second occurrence
            seen.set(line, count + 1);
        }
        return duplicates;
    }
    /**
     * Estimate maximum nesting depth of code by counting brace/paren indent levels.
     */
    maxNestingDepth(code) {
        let depth = 0;
        let maxDepth = 0;
        let inString = null;
        for (let i = 0; i < code.length; i++) {
            const ch = code[i];
            // Simple string tracking to avoid counting braces inside strings
            if (inString) {
                if (ch === inString && code[i - 1] !== '\\') {
                    inString = null;
                }
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                inString = ch;
                continue;
            }
            if (ch === '{' || ch === '(' || ch === '[') {
                depth++;
                if (depth > maxDepth)
                    maxDepth = depth;
            }
            else if (ch === '}' || ch === ')' || ch === ']') {
                depth = Math.max(0, depth - 1);
            }
        }
        return maxDepth;
    }
    /**
     * Persist a grading result to disk for historical analysis.
     */
    persistGradingResult(result) {
        const historyDir = resolve(this.config.historyDir);
        if (!existsSync(historyDir)) {
            mkdirSync(historyDir, { recursive: true });
        }
        const timestamp = Date.now();
        const filename = `${result.rubricId}_${timestamp}.json`;
        const filePath = join(historyDir, filename);
        writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
    }
}
// ============================================================
// Factory & Convenience Functions
// ============================================================
/**
 * Create a new OutcomeGrader with optional API client and configuration.
 */
export function createOutcomeGrader(apiClient, config) {
    return new OutcomeGrader(apiClient, config);
}
/**
 * Create a quick rubric with a simpler API.
 * Useful for one-off grading tasks.
 */
export function createQuickRubric(id, name, criteria, passingThreshold = 70, maxRevisions = 3, evaluatorModel = 'anthropic/claude-sonnet-4') {
    const n = criteria.length;
    const equalWeight = Math.round((1 / n) * 1000) / 1000;
    // Distribute weights equally, adjust last to ensure sum === 1
    const weights = criteria.map((_, i) => {
        if (i < n - 1)
            return equalWeight;
        const sumSoFar = equalWeight * (n - 1);
        return Math.round((1 - sumSoFar) * 1000) / 1000;
    });
    return {
        id,
        name,
        description: `Quick rubric: ${name}`,
        criteria: criteria.map((c, i) => ({
            id: `${id}-c${i + 1}`,
            name: c.name,
            description: c.description,
            weight: weights[i],
            type: c.type,
            passingScore: c.passingScore ?? (c.type === 'boolean' ? 100 : 70),
        })),
        passingThreshold,
        maxRevisions,
        evaluatorModel,
    };
}
/**
 * Grade output against a rubric in a single call without
 * managing an OutcomeGrader instance.
 */
export async function quickGrade(output, rubric, apiClient, config) {
    const grader = new OutcomeGrader(apiClient, config);
    grader.defineRubric(rubric);
    return grader.grade(output, rubric.id);
}
//# sourceMappingURL=outcome-grading.js.map
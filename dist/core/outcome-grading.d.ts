/** A single criterion within a rubric. */
export interface RubricCriterion {
    id: string;
    name: string;
    description: string;
    weight: number;
    type: 'boolean' | 'scale' | 'descriptive';
    passingScore: number;
}
/** A structured rubric defining success criteria for an outcome. */
export interface Rubric {
    id: string;
    name: string;
    description: string;
    criteria: RubricCriterion[];
    passingThreshold: number;
    maxRevisions: number;
    evaluatorModel: string;
}
/** Result for a single criterion evaluation. */
export interface CriterionResult {
    criterionId: string;
    score: number;
    passed: boolean;
    feedback: string;
    evidence: string;
}
/** Full grading result for a rubric evaluation. */
export interface GradingResult {
    rubricId: string;
    overallScore: number;
    passed: boolean;
    criteriaResults: CriterionResult[];
    feedback: string;
    revisionNeeded: boolean;
    revisionSuggestions: string[];
    evaluatorModel: string;
    tokensUsed: number;
}
/** Result of a revision loop that iterates grading + revision. */
export interface RevisionLoopResult {
    finalOutput: string;
    finalGrade: GradingResult;
    totalRevisions: number;
    revisionHistory: RevisionEntry[];
    passed: boolean;
}
/** Single revision step within the loop. */
export interface RevisionEntry {
    revisionNumber: number;
    output: string;
    grade: GradingResult;
    timestamp: number;
}
/** Configuration for the OutcomeGrader. */
export interface GradingConfig {
    /** Default model used for isolated evaluation when rubric doesn't specify one */
    defaultEvaluatorModel: string;
    /** Maximum revisions allowed globally (rubric maxRevisions takes precedence) */
    globalMaxRevisions: number;
    /** Directory where rubric JSON files are stored */
    rubricsDir: string;
    /** Whether to persist grading history to disk */
    persistHistory: boolean;
    /** Directory for persisted grading history */
    historyDir: string;
    /** Temperature for evaluator LLM calls */
    evaluatorTemperature: number;
    /** Timeout in ms for evaluator API calls */
    evaluatorTimeoutMs: number;
}
/** Minimal shape of an agent that can be driven in a revision loop. */
interface RevisionableAgent {
    run(prompt: string): Promise<{
        output: string;
        tokensUsed: number;
    }>;
}
export declare class OutcomeGrader {
    private rubrics;
    private gradingHistory;
    private apiClient;
    private config;
    constructor(apiClient?: any, config?: Partial<GradingConfig>);
    /**
     * Register a rubric definition. Overwrites any existing rubric with the same id.
     */
    defineRubric(rubric: Rubric): void;
    /**
     * Return all registered rubrics.
     */
    listRubrics(): Rubric[];
    /**
     * Get a single rubric by id, or undefined if not found.
     */
    getRubric(rubricId: string): Rubric | undefined;
    /**
     * Remove a rubric by id. Returns true if the rubric existed and was removed.
     */
    removeRubric(rubricId: string): boolean;
    /**
     * Load rubric definitions from JSON files in a directory.
     * Each .json file should contain a single Rubric object or an array of Rubric objects.
     */
    loadRubrics(dir: string): Promise<void>;
    /**
     * Save a rubric to disk as JSON.
     */
    saveRubric(rubric: Rubric, dir?: string): Promise<void>;
    /**
     * Grade an output string against a rubric.
     * Uses the isolated evaluator (separate LLM call) so that grading
     * is decoupled from agent reasoning context.
     *
     * If no API client is available, performs heuristic-based grading.
     */
    grade(output: string, rubricId: string, context?: string): Promise<GradingResult>;
    /**
     * Grade an agent's output and loop revisions until the rubric is satisfied
     * or the maximum number of revisions is reached.
     *
     * The agent receives grading feedback + revision suggestions after each
     * unsuccessful attempt and is asked to revise.
     */
    gradeWithRevision(agent: RevisionableAgent, prompt: string, rubricId: string): Promise<RevisionLoopResult>;
    /**
     * Return all grading results from this session.
     */
    getGradingHistory(): GradingResult[];
    /**
     * Clear all grading history from memory.
     */
    clearHistory(): void;
    /**
     * Return grading results filtered by rubric id.
     */
    getGradingHistoryByRubric(rubricId: string): GradingResult[];
    /**
     * Return the most recent grading result, or undefined if none exists.
     */
    getLatestGrading(): GradingResult | undefined;
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
    createCompositeRubric(id: string, name: string, criteria: Array<{
        rubricId: string;
        criterionId: string;
        weight: number;
    }>, passingThreshold: number, maxRevisions?: number, evaluatorModel?: string): Rubric;
    /**
     * Evaluate output against all criteria in a rubric using an isolated LLM call.
     * The evaluator runs in a separate context window from the agent, ensuring
     * objective assessment.
     */
    private evaluateWithLLM;
    /**
     * Parse the LLM's JSON evaluation response into structured CriterionResult objects.
     * Handles malformed responses gracefully.
     */
    private parseEvaluationResponse;
    /**
     * Evaluate output using heuristic pattern matching when no LLM is available.
     * Provides basic quality signals based on code/text analysis.
     */
    private evaluateWithHeuristics;
    /**
     * Apply heuristic scoring for a single criterion based on its type and name.
     */
    private evaluateCriterionHeuristic;
    /**
     * Build a prompt that asks the agent to revise its output based on grading feedback.
     */
    private buildRevisionPrompt;
    /**
     * Generate specific, actionable revision suggestions based on failed criteria.
     */
    private generateRevisionSuggestions;
    /**
     * Synthesize overall feedback from criterion results.
     */
    private synthesizeFeedback;
    /**
     * Validate that a rubric is well-formed.
     * Throws descriptive errors for structural problems.
     */
    private validateRubric;
    /**
     * Count duplicate non-empty, non-trivial lines in the output.
     */
    private countDuplicateLines;
    /**
     * Estimate maximum nesting depth of code by counting brace/paren indent levels.
     */
    private maxNestingDepth;
    /**
     * Persist a grading result to disk for historical analysis.
     */
    private persistGradingResult;
}
/**
 * Create a new OutcomeGrader with optional API client and configuration.
 */
export declare function createOutcomeGrader(apiClient?: any, config?: Partial<GradingConfig>): OutcomeGrader;
/**
 * Create a quick rubric with a simpler API.
 * Useful for one-off grading tasks.
 */
export declare function createQuickRubric(id: string, name: string, criteria: Array<{
    name: string;
    description: string;
    type: 'boolean' | 'scale' | 'descriptive';
    passingScore?: number;
}>, passingThreshold?: number, maxRevisions?: number, evaluatorModel?: string): Rubric;
/**
 * Grade output against a rubric in a single call without
 * managing an OutcomeGrader instance.
 */
export declare function quickGrade(output: string, rubric: Rubric, apiClient?: any, config?: Partial<GradingConfig>): Promise<GradingResult>;
export {};
//# sourceMappingURL=outcome-grading.d.ts.map
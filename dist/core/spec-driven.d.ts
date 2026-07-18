export interface Requirement {
    id: string;
    title: string;
    description: string;
    priority: 'must' | 'should' | 'could';
    acceptanceCriteria: string[];
    status: 'pending' | 'implemented' | 'verified' | 'failed';
}
export interface Component {
    name: string;
    description: string;
    responsibilities: string[];
    interfaces: string[];
    dependencies: string[];
}
export interface Risk {
    id: string;
    description: string;
    likelihood: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    mitigation: string;
}
export interface Task {
    id: string;
    description: string;
    completed: boolean;
    files?: string[];
    verification?: string;
}
export interface Phase {
    name: string;
    tasks: Task[];
    order: number;
}
export interface DesignDoc {
    architecture: string;
    components: Component[];
    dataFlow: string;
    apiDesign: string[];
    errorHandling: string;
}
export interface ImplementationPlan {
    phases: Phase[];
    estimatedEffort: string;
    dependencies: string[];
    risks: Risk[];
}
export interface VerificationChecklist {
    acceptanceCriteriaMet: boolean;
    testsPass: boolean;
    codeReviewComplete: boolean;
    notes: string[];
}
export interface Spec {
    id: string;
    name: string;
    status: 'draft' | 'approved' | 'implementing' | 'complete' | 'rejected';
    requirements: Requirement[];
    design: DesignDoc;
    implementationPlan: ImplementationPlan;
    verification: VerificationChecklist;
    createdAt: Date;
    updatedAt: Date;
    /** Hash of the requirements content for integrity tracking */
    requirementsHash: string;
    /** Hash of the design content for integrity tracking */
    designHash: string;
    /** Reason for rejection, if applicable */
    rejectionReason?: string;
    /** Original prompt that generated this spec */
    originalPrompt?: string;
    /** Current phase index being implemented */
    currentPhaseIndex: number;
    /** Current task index within current phase */
    currentTaskIndex: number;
}
export interface SpecSummary {
    id: string;
    name: string;
    status: Spec['status'];
    createdAt: Date;
    updatedAt: Date;
    requirementCount: number;
    completedTaskCount: number;
    totalTaskCount: number;
}
export interface ExecOptions {
    /** Automatically approve each phase before implementation */
    autoApprove?: boolean;
    /** Maximum number of LLM iterations per task */
    maxIterations?: number;
    /** Callback for status updates during execution */
    onProgress?: (phase: string, task: string, iteration: number) => void;
    /** Whether to run tests after each phase */
    testAfterPhase?: boolean;
    /** Specific phases to execute (0-indexed); omit to run all remaining */
    phases?: number[];
    /** Resume from a previously incomplete execution */
    resume?: boolean;
}
export interface ExecutionResult {
    success: boolean;
    phasesCompleted: number;
    tasksCompleted: number;
    tasksTotal: number;
    errors: string[];
    filesModified: string[];
    durationMs: number;
}
export interface VerificationResult {
    passed: boolean;
    criteriaResults: CriteriaCheckResult[];
    overallScore: number;
    issues: string[];
    suggestions: string[];
}
export interface CriteriaCheckResult {
    requirementId: string;
    criteriaIndex: number;
    criteriaText: string;
    passed: boolean;
    evidence: string;
}
export interface SpecDiff {
    specFiles: string[];
    actualFiles: string[];
    missingFiles: string[];
    extraFiles: string[];
    contentDiffs: FileDiff[];
    coveragePercentage: number;
}
export interface FileDiff {
    file: string;
    specExpectation: string;
    actualContent: string;
    matches: boolean;
    differences: string[];
}
export interface PipelineOptions {
    /** Skip the approval step and auto-approve the spec */
    autoApprove?: boolean;
    /** Which model to use for spec generation */
    model?: string;
    /** Callback for pipeline stage updates */
    onStageChange?: (stage: PipelineStage, details: string) => void;
    /** Maximum cost in USD (0 = unlimited) */
    maxCost?: number;
    /** Maximum time in ms (0 = unlimited) */
    maxTimeMs?: number;
}
export type PipelineStage = 'requirements' | 'design' | 'plan' | 'approval' | 'implementation' | 'verification';
export interface PipelineResult {
    spec: Spec;
    executionResult: ExecutionResult;
    verificationResult: VerificationResult;
    totalDurationMs: number;
    totalCost: number;
    stages: PipelineStageResult[];
}
export interface PipelineStageResult {
    stage: PipelineStage;
    success: boolean;
    durationMs: number;
    cost: number;
    details: string;
}
/**
 * Minimal interface that any execution engine must satisfy for
 * SpecDrivenPipeline to orchestrate it.  Loosely coupled like AutoModeEngine.
 */
export interface SpecDrivenEngine {
    /** Run a single prompt through the engine and return the assistant text */
    runPrompt(prompt: string, model?: string): Promise<{
        text: string;
        inputTokens: number;
        outputTokens: number;
        cost: number;
        filesChanged: number;
        commandsRun: number;
        error?: string;
    }>;
}
export declare class SpecDrivenPipeline {
    private engine;
    private projectRoot;
    private specsDir;
    private model;
    private totalCost;
    constructor(engine: SpecDrivenEngine, projectRoot: string, model?: string);
    private ensureSpecsDir;
    private hashContent;
    private callLLM;
    private extractJSON;
    private parseJSON;
    generateRequirements(prompt: string): Promise<Requirement[]>;
    generateDesign(requirements: Requirement[]): Promise<DesignDoc>;
    generatePlan(design: DesignDoc): Promise<ImplementationPlan>;
    executePlan(plan: ImplementationPlan, options?: ExecOptions): Promise<ExecutionResult>;
    verifyImplementation(spec: Spec): Promise<VerificationResult>;
    runFullPipeline(prompt: string, options?: PipelineOptions): Promise<PipelineResult>;
    saveSpec(spec: Spec): Promise<void>;
    loadSpec(id: string): Promise<Spec>;
    listSpecs(): Promise<SpecSummary[]>;
    approveSpec(id: string): Promise<void>;
    rejectSpec(id: string, reason: string): Promise<void>;
    deleteSpec(id: string): Promise<void>;
    checkAcceptanceCriteria(spec: Spec): Promise<CriteriaCheckResult[]>;
    private checkSingleCriteria;
    diffSpecVsImplementation(spec: Spec): Promise<SpecDiff>;
    resumeImplementation(id: string, options?: ExecOptions): Promise<ExecutionResult>;
    private serializeSpecToMarkdown;
    private deserializeSpecFromMarkdown;
    private parseSimpleYAML;
    private parseRequirementsSection;
    private parseDesignSection;
    private parseImplementationPlanSection;
    private parseVerificationSection;
    private getSpecFilePath;
    private extractFeatureName;
    private toTitleCase;
    private detectModifiedFiles;
    private gatherProjectState;
    private gatherRelevantFiles;
    private getSpecExpectationForFile;
    private computeFileDiff;
    private findProjectSourceFiles;
    private runProjectTests;
    /** Get the total cost accumulated by this pipeline instance */
    getTotalCost(): number;
    /** Get the specs directory path */
    getSpecsDir(): string;
}
//# sourceMappingURL=spec-driven.d.ts.map
export type CICDSystem = 'github-actions' | 'gitlab-ci' | 'jenkins' | 'circleci' | 'unknown';
export interface CICDDetectionResult {
    system: CICDSystem;
    configFile: string;
    configExists: boolean;
    multipleSystems: CICDSystem[];
}
export interface CICDConfig {
    system: CICDSystem;
    projectRoot: string;
    configFile: string;
    /** GitHub: repo slug (owner/repo). GitLab: project path. Jenkins: job name. CircleCI: slug. */
    projectSlug?: string;
    /** Default branch name */
    defaultBranch?: string;
    /** Remote URL if available */
    remoteUrl?: string;
}
export interface PipelineOptions {
    /** Branch or ref to run the pipeline on */
    ref?: string;
    /** Pipeline-specific parameters / inputs */
    parameters?: Record<string, string>;
    /** Whether to wait for completion */
    watch?: boolean;
    /** Timeout in ms for watching */
    timeout?: number;
}
export interface PipelineRun {
    id: string;
    system: CICDSystem;
    name: string;
    status: PipelineRunStatus;
    branch: string;
    commit: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    triggeredBy: string;
}
export type PipelineRunStatus = 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'waiting' | 'unknown';
export interface PipelineLog {
    runId: string;
    system: CICDSystem;
    /** Full log text or segmented by job */
    jobs: Array<{
        name: string;
        status: PipelineRunStatus;
        log: string;
        startedAt?: string;
        completedAt?: string;
    }>;
}
export interface PipelineInfo {
    id: string;
    name: string;
    system: CICDSystem;
    configFile: string;
    triggers: string[];
    lastRun?: PipelineRun;
}
export interface CreatePipelineConfigOptions {
    /** Target CI/CD system */
    type: CICDSystem;
    /** Programming language of the project */
    language: string;
    /** Build command (e.g., "npm run build") */
    buildCommand?: string;
    /** Test command (e.g., "npm test") */
    testCommand?: string;
    /** Lint command (e.g., "npm run lint") */
    lintCommand?: string;
    /** Deploy command or stage */
    deployCommand?: string;
    /** Node.js version */
    nodeVersion?: string;
    /** Python version */
    pythonVersion?: string;
    /** Docker image to use */
    dockerImage?: string;
    /** Branches to trigger on */
    branches?: string[];
    /** Environment variables */
    envVars?: Record<string, string>;
    /** Additional stages */
    stages?: Array<{
        name: string;
        command: string;
        condition?: string;
    }>;
}
export interface ValidationIssue {
    severity: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    file: string;
}
export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    system: CICDSystem;
}
export interface PipelineWatchEvent {
    runId: string;
    status: PipelineRunStatus;
    timestamp: number;
    message: string;
    jobName?: string;
}
export declare class CICDIntegration {
    private config;
    private projectRoot;
    private ghAvailable;
    constructor(projectRoot?: string);
    private ensureGh;
    private gh;
    private git;
    private resolvePath;
    private getRepoSlug;
    private getDefaultBranch;
    /**
     * Detect which CI/CD system(s) are configured in the project
     */
    detectPipeline(projectRoot?: string): CICDDetectionResult;
    /**
     * Get or initialize the CI/CD config
     */
    private getConfig;
    /**
     * Trigger a pipeline run
     */
    runPipeline(pipeline?: string, options?: PipelineOptions): {
        success: boolean;
        run?: PipelineRun;
        error?: string;
    };
    /**
     * Get pipeline status
     */
    getPipelineStatus(runId?: string): {
        success: boolean;
        run?: PipelineRun;
        runs?: PipelineRun[];
        error?: string;
    };
    /**
     * Get pipeline logs
     */
    getPipelineLogs(runId: string): {
        success: boolean;
        logs?: PipelineLog;
        error?: string;
    };
    /**
     * List available pipelines
     */
    listPipelines(): {
        success: boolean;
        pipelines?: PipelineInfo[];
        error?: string;
    };
    /**
     * Generate a CI/CD config file
     */
    createPipelineConfig(type: CICDSystem, options: CreatePipelineConfigOptions): {
        success: boolean;
        path?: string;
        error?: string;
    };
    /**
     * Validate current CI/CD config
     */
    validateConfig(): {
        success: boolean;
        result?: ValidationResult;
        error?: string;
    };
    /**
     * Get recent pipeline runs
     */
    getPipelineHistory(limit?: number): {
        success: boolean;
        runs?: PipelineRun[];
        error?: string;
    };
    /**
     * Cancel a running pipeline
     */
    cancelPipeline(runId: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Re-run a pipeline
     */
    rerunPipeline(runId: string): {
        success: boolean;
        newRunId?: string;
        error?: string;
    };
    /**
     * Watch a pipeline in real-time
     */
    watchPipeline(runId: string, callback: (event: PipelineWatchEvent) => void, options?: {
        interval?: number;
        timeout?: number;
    }): {
        success: boolean;
        stop: () => void;
        error?: string;
    };
    private runGitHubActions;
    private getLatestGitHubActionsRun;
    private getGitHubActionsStatus;
    private getGitHubActionsLogs;
    private listGitHubActionsPipelines;
    private getGitHubActionsHistory;
    private cancelGitHubActionsRun;
    private rerunGitHubActions;
    private runGitLabCI;
    private getGitLabCIStatus;
    private getGitLabCILogs;
    private listGitLabCIPipelines;
    private getGitLabCIHistory;
    private cancelGitLabCIRun;
    private rerunGitLabCI;
    private runJenkins;
    private getJenkinsStatus;
    private getJenkinsLogs;
    private listJenkinsPipelines;
    private getJenkinsHistory;
    private cancelJenkinsRun;
    private rerunJenkins;
    private runCircleCI;
    private getCircleCIStatus;
    private getCircleCILogs;
    private listCircleCIPipelines;
    private getCircleCIHistory;
    private cancelCircleCIRun;
    private rerunCircleCI;
    private createGitHubActionsConfig;
    private createGitLabCIConfig;
    private createJenkinsConfig;
    private createCircleCIConfig;
    private validateGitHubActionsConfig;
    private validateGitLabCIConfig;
    private validateJenkinsConfig;
    private validateCircleCIConfig;
    private mapGitHubActionsRun;
    private mapGitHubStatus;
    private extractYAMLTriggers;
    private extractYAMLWorkflowName;
    private extractYAMLStages;
    private extractJenkinsStages;
    private extractCircleCIJobs;
}
//# sourceMappingURL=cicd.d.ts.map
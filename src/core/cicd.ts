// ============================================================
// NeuroCLI - CI/CD Pipeline Integration
// Detect, run, and manage CI/CD pipelines across platforms
// ============================================================

import { execSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  watchFile,
  unwatchFile,
} from 'fs';
import { join, basename } from 'path';

// ---- Interfaces ----

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

export type PipelineRunStatus =
  | 'queued'
  | 'in_progress'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'waiting'
  | 'unknown';

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

// ---- Config file paths ----

const GITHUB_WORKFLOWS_DIR = '.github/workflows';
const GITLAB_CI_FILE = '.gitlab-ci.yml';
const JENKINS_FILE = 'Jenkinsfile';
const CIRCLECI_DIR = '.circleci';
const CIRCLECI_CONFIG_FILE = '.circleci/config.yml';

// ---- Helper: Execute shell command ----

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function execCommand(command: string, options?: { cwd?: string; timeout?: number }): ExecResult {
  const timeout = options?.timeout ?? 60000;
  const cwd = options?.cwd ?? process.cwd();
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      cwd,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString().trim() ?? '',
      stderr: error.stderr?.toString().trim() ?? '',
      exitCode: error.status ?? 1,
    };
  }
}

function parseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isGhAvailable(): boolean {
  return execCommand('gh --version').exitCode === 0;
}

// ---- CICDIntegration Class ----

export class CICDIntegration {
  private config: CICDConfig | null = null;
  private projectRoot: string;
  private ghAvailable: boolean | null = null;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  private ensureGh(): boolean {
    if (this.ghAvailable === null) {
      this.ghAvailable = isGhAvailable();
    }
    return this.ghAvailable;
  }

  private gh(args: string, timeout?: number): ExecResult {
    return execCommand(`gh ${args}`, { cwd: this.projectRoot, timeout });
  }

  private git(args: string): ExecResult {
    return execCommand(`git ${args}`, { cwd: this.projectRoot });
  }

  private resolvePath(relativePath: string): string {
    return join(this.projectRoot, relativePath);
  }

  private getRepoSlug(): string | null {
    const result = this.git('remote get-url origin');
    if (result.exitCode !== 0 || !result.stdout) return null;
    const match = result.stdout.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  }

  private getDefaultBranch(): string {
    const result = this.git('rev-parse --abbrev-ref HEAD');
    return result.exitCode === 0 ? result.stdout : 'main';
  }

  // ---- Detection ----

  /**
   * Detect which CI/CD system(s) are configured in the project
   */
  detectPipeline(projectRoot?: string): CICDDetectionResult {
    const root = projectRoot ?? this.projectRoot;
    const detected: CICDSystem[] = [];
    let primarySystem: CICDSystem = 'unknown';
    let primaryConfigFile = '';

    // Check GitHub Actions
    const workflowsDir = join(root, GITHUB_WORKFLOWS_DIR);
    if (existsSync(workflowsDir)) {
      try {
        const files = readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
        if (files.length > 0) {
          detected.push('github-actions');
          if (primarySystem === 'unknown') {
            primarySystem = 'github-actions';
            primaryConfigFile = join(GITHUB_WORKFLOWS_DIR, files[0]);
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    // Check GitLab CI
    if (existsSync(join(root, GITLAB_CI_FILE))) {
      detected.push('gitlab-ci');
      if (primarySystem === 'unknown') {
        primarySystem = 'gitlab-ci';
        primaryConfigFile = GITLAB_CI_FILE;
      }
    }

    // Check Jenkins
    if (existsSync(join(root, JENKINS_FILE))) {
      detected.push('jenkins');
      if (primarySystem === 'unknown') {
        primarySystem = 'jenkins';
        primaryConfigFile = JENKINS_FILE;
      }
    }

    // Check CircleCI
    if (existsSync(join(root, CIRCLECI_CONFIG_FILE))) {
      detected.push('circleci');
      if (primarySystem === 'unknown') {
        primarySystem = 'circleci';
        primaryConfigFile = CIRCLECI_CONFIG_FILE;
      }
    }

    // Cache config
    if (primarySystem !== 'unknown') {
      this.config = {
        system: primarySystem,
        projectRoot: root,
        configFile: primaryConfigFile,
        projectSlug: this.getRepoSlug() ?? undefined,
        defaultBranch: this.getDefaultBranch(),
        remoteUrl: this.git('remote get-url origin').exitCode === 0
          ? this.git('remote get-url origin').stdout
          : undefined,
      };
    }

    return {
      system: primarySystem,
      configFile: primaryConfigFile,
      configExists: primarySystem !== 'unknown',
      multipleSystems: detected,
    };
  }

  /**
   * Get or initialize the CI/CD config
   */
  private getConfig(): CICDConfig {
    if (!this.config) {
      const detection = this.detectPipeline();
      if (!this.config) {
        this.config = {
          system: detection.system,
          projectRoot: this.projectRoot,
          configFile: detection.configFile,
          projectSlug: this.getRepoSlug() ?? undefined,
          defaultBranch: this.getDefaultBranch(),
        };
      }
    }
    return this.config;
  }

  // ---- Pipeline Execution ----

  /**
   * Trigger a pipeline run
   */
  runPipeline(pipeline?: string, options?: PipelineOptions): { success: boolean; run?: PipelineRun; error?: string } {
    const config = this.getConfig();
    const opts = options ?? {};

    switch (config.system) {
      case 'github-actions':
        return this.runGitHubActions(pipeline, opts);
      case 'gitlab-ci':
        return this.runGitLabCI(pipeline, opts);
      case 'jenkins':
        return this.runJenkins(pipeline, opts);
      case 'circleci':
        return this.runCircleCI(pipeline, opts);
      default:
        return { success: false, error: 'No CI/CD system detected. Run detectPipeline() first.' };
    }
  }

  /**
   * Get pipeline status
   */
  getPipelineStatus(runId?: string): { success: boolean; run?: PipelineRun; runs?: PipelineRun[]; error?: string } {
    const config = this.getConfig();

    switch (config.system) {
      case 'github-actions':
        return this.getGitHubActionsStatus(runId);
      case 'gitlab-ci':
        return this.getGitLabCIStatus(runId);
      case 'jenkins':
        return this.getJenkinsStatus(runId);
      case 'circleci':
        return this.getCircleCIStatus(runId);
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * Get pipeline logs
   */
  getPipelineLogs(runId: string): { success: boolean; logs?: PipelineLog; error?: string } {
    const config = this.getConfig();

    switch (config.system) {
      case 'github-actions':
        return this.getGitHubActionsLogs(runId);
      case 'gitlab-ci':
        return this.getGitLabCILogs(runId);
      case 'jenkins':
        return this.getJenkinsLogs(runId);
      case 'circleci':
        return this.getCircleCILogs(runId);
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * List available pipelines
   */
  listPipelines(): { success: boolean; pipelines?: PipelineInfo[]; error?: string } {
    const config = this.getConfig();

    switch (config.system) {
      case 'github-actions':
        return this.listGitHubActionsPipelines();
      case 'gitlab-ci':
        return this.listGitLabCIPipelines();
      case 'jenkins':
        return this.listJenkinsPipelines();
      case 'circleci':
        return this.listCircleCIPipelines();
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * Generate a CI/CD config file
   */
  createPipelineConfig(type: CICDSystem, options: CreatePipelineConfigOptions): { success: boolean; path?: string; error?: string } {
    switch (type) {
      case 'github-actions':
        return this.createGitHubActionsConfig(options);
      case 'gitlab-ci':
        return this.createGitLabCIConfig(options);
      case 'jenkins':
        return this.createJenkinsConfig(options);
      case 'circleci':
        return this.createCircleCIConfig(options);
      default:
        return { success: false, error: `Unsupported CI/CD system: ${type}` };
    }
  }

  /**
   * Validate current CI/CD config
   */
  validateConfig(): { success: boolean; result?: ValidationResult; error?: string } {
    const config = this.getConfig();

    switch (config.system) {
      case 'github-actions':
        return this.validateGitHubActionsConfig();
      case 'gitlab-ci':
        return this.validateGitLabCIConfig();
      case 'jenkins':
        return this.validateJenkinsConfig();
      case 'circleci':
        return this.validateCircleCIConfig();
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * Get recent pipeline runs
   */
  getPipelineHistory(limit?: number): { success: boolean; runs?: PipelineRun[]; error?: string } {
    const config = this.getConfig();
    const maxResults = limit ?? 10;

    switch (config.system) {
      case 'github-actions':
        return this.getGitHubActionsHistory(maxResults);
      case 'gitlab-ci':
        return this.getGitLabCIHistory(maxResults);
      case 'jenkins':
        return this.getJenkinsHistory(maxResults);
      case 'circleci':
        return this.getCircleCIHistory(maxResults);
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * Cancel a running pipeline
   */
  cancelPipeline(runId: string): { success: boolean; error?: string } {
    const config = this.getConfig();

    switch (config.system) {
      case 'github-actions':
        return this.cancelGitHubActionsRun(runId);
      case 'gitlab-ci':
        return this.cancelGitLabCIRun(runId);
      case 'jenkins':
        return this.cancelJenkinsRun(runId);
      case 'circleci':
        return this.cancelCircleCIRun(runId);
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * Re-run a pipeline
   */
  rerunPipeline(runId: string): { success: boolean; newRunId?: string; error?: string } {
    const config = this.getConfig();

    switch (config.system) {
      case 'github-actions':
        return this.rerunGitHubActions(runId);
      case 'gitlab-ci':
        return this.rerunGitLabCI(runId);
      case 'jenkins':
        return this.rerunJenkins(runId);
      case 'circleci':
        return this.rerunCircleCI(runId);
      default:
        return { success: false, error: 'No CI/CD system detected.' };
    }
  }

  /**
   * Watch a pipeline in real-time
   */
  watchPipeline(runId: string, callback: (event: PipelineWatchEvent) => void, options?: { interval?: number; timeout?: number }): { success: boolean; stop: () => void; error?: string } {
    const config = this.getConfig();
    const interval = options?.interval ?? 10000;
    const timeoutMs = options?.timeout ?? 600000; // 10 minutes default

    let timer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStatus: PipelineRunStatus = 'unknown';
    const startTime = Date.now();

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timer = null;
      }
    };

    const poll = () => {
      const statusResult = this.getPipelineStatus(runId);
      if (!statusResult.success || !statusResult.run) {
        callback({
          runId,
          status: 'unknown',
          timestamp: Date.now(),
          message: statusResult.error ?? 'Failed to get status',
        });
        return;
      }

      const run = statusResult.run;
      const currentStatus = run.status;

      if (currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        callback({
          runId,
          status: currentStatus,
          timestamp: Date.now(),
          message: `Status changed to: ${currentStatus}`,
        });
      }

      // Check if pipeline is complete
      if (['success', 'failure', 'cancelled', 'skipped'].includes(currentStatus)) {
        callback({
          runId,
          status: currentStatus,
          timestamp: Date.now(),
          message: `Pipeline completed with status: ${currentStatus}`,
        });
        stop();
      }
    };

    // Start polling
    poll(); // Initial check
    timer = setInterval(poll, interval);

    // Set timeout
    timeoutTimer = setTimeout(() => {
      callback({
        runId,
        status: lastStatus,
        timestamp: Date.now(),
        message: 'Watch timed out',
      });
      stop();
    }, timeoutMs);

    return { success: true, stop };
  }

  // ================================================================
  // GitHub Actions Implementation
  // ================================================================

  private runGitHubActions(workflow?: string, options?: PipelineOptions): { success: boolean; run?: PipelineRun; error?: string } {
    if (!this.ensureGh()) {
      return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
    }

    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';
    const ref = options?.ref ?? this.getDefaultBranch();

    if (workflow) {
      const refFlag = ref ? `--ref "${ref}"` : '';
      let paramFlags = '';
      if (options?.parameters) {
        for (const [key, value] of Object.entries(options.parameters)) {
          paramFlags += ` -f ${key}="${value}"`;
        }
      }

      const result = this.gh(`workflow run "${workflow}" ${refFlag}${paramFlags} ${repoFlag}`.trim());
      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || 'Failed to trigger workflow' };
      }

      // gh workflow run doesn't return a run ID directly; fetch the latest
      return this.getLatestGitHubActionsRun(workflow);
    }

    // No specific workflow - try to trigger all on-push workflows by pushing a dummy commit or listing
    return { success: false, error: 'Specify a workflow name or ID to trigger GitHub Actions' };
  }

  private getLatestGitHubActionsRun(workflowName?: string): { success: boolean; run?: PipelineRun; error?: string } {
    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';
    const workflowFilter = workflowName ? `--workflow="${workflowName}"` : '';
    const result = this.gh(`run list ${workflowFilter} --limit 1 --json databaseId,name,status,conclusion,headBranch,headSha,htmlUrl,createdAt,updatedAt,event ${repoFlag}`.trim());

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to fetch latest run' };
    }

    const runs = parseJSON<Record<string, any>[]>(result.stdout);
    if (!runs || runs.length === 0) {
      return { success: false, error: 'No workflow runs found' };
    }

    return {
      success: true,
      run: this.mapGitHubActionsRun(runs[0]),
    };
  }

  private getGitHubActionsStatus(runId?: string): { success: boolean; run?: PipelineRun; runs?: PipelineRun[]; error?: string } {
    if (!this.ensureGh()) {
      return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
    }

    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';

    if (runId) {
      const result = this.gh(`run view ${runId} --json databaseId,name,status,conclusion,headBranch,headSha,htmlUrl,createdAt,updatedAt,event ${repoFlag}`.trim());
      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || 'Failed to get run status' };
      }
      const run = parseJSON<Record<string, any>>(result.stdout);
      if (!run) return { success: false, error: 'Failed to parse run status' };
      return { success: true, run: this.mapGitHubActionsRun(run) };
    }

    // List recent runs
    const result = this.gh(`run list --limit 10 --json databaseId,name,status,conclusion,headBranch,headSha,htmlUrl,createdAt,updatedAt,event ${repoFlag}`.trim());
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to list runs' };
    }
    const runs = parseJSON<Record<string, any>[]>(result.stdout);
    if (!runs) return { success: false, error: 'Failed to parse runs' };
    return { success: true, runs: runs.map(r => this.mapGitHubActionsRun(r)) };
  }

  private getGitHubActionsLogs(runId: string): { success: boolean; logs?: PipelineLog; error?: string } {
    if (!this.ensureGh()) {
      return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
    }

    // Get jobs for this run
    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';

    const runResult = this.gh(`run view ${runId} --json jobs ${repoFlag}`.trim());
    if (runResult.exitCode !== 0) {
      return { success: false, error: runResult.stderr || 'Failed to get run details' };
    }

    const runData = parseJSON<Record<string, any>>(runResult.stdout);
    if (!runData) return { success: false, error: 'Failed to parse run data' };

    const jobs: PipelineLog['jobs'] = [];

    for (const job of runData.jobs ?? []) {
      // Get log for each job
      const logResult = this.gh(`run view ${runId} --job=${job.databaseId ?? job.id} --log ${repoFlag}`.trim());
      jobs.push({
        name: job.name ?? '',
        status: this.mapGitHubStatus(job.status, job.conclusion),
        log: logResult.exitCode === 0 ? logResult.stdout : `Failed to retrieve logs: ${logResult.stderr}`,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    }

    return {
      success: true,
      logs: {
        runId,
        system: 'github-actions',
        jobs,
      },
    };
  }

  private listGitHubActionsPipelines(): { success: boolean; pipelines?: PipelineInfo[]; error?: string } {
    const workflowsDir = this.resolvePath(GITHUB_WORKFLOWS_DIR);
    const pipelines: PipelineInfo[] = [];

    if (!existsSync(workflowsDir)) {
      return { success: false, error: 'No .github/workflows directory found' };
    }

    try {
      const files = readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

      for (const file of files) {
        const filePath = join(workflowsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const triggers = this.extractYAMLTriggers(content);
        const name = this.extractYAMLWorkflowName(content) ?? basename(file, '.yml').replace(/\.yaml$/, '');

        pipelines.push({
          id: file,
          name,
          system: 'github-actions',
          configFile: join(GITHUB_WORKFLOWS_DIR, file),
          triggers,
        });
      }
    } catch (error) {
      return { success: false, error: `Failed to read workflows: ${error instanceof Error ? error.message : String(error)}` };
    }

    return { success: true, pipelines };
  }

  private getGitHubActionsHistory(limit: number): { success: boolean; runs?: PipelineRun[]; error?: string } {
    if (!this.ensureGh()) {
      return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
    }

    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';

    const result = this.gh(`run list --limit ${limit} --json databaseId,name,status,conclusion,headBranch,headSha,htmlUrl,createdAt,updatedAt,event ${repoFlag}`.trim());
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get run history' };
    }

    const runs = parseJSON<Record<string, any>[]>(result.stdout);
    if (!runs) return { success: false, error: 'Failed to parse run history' };

    return { success: true, runs: runs.map(r => this.mapGitHubActionsRun(r)) };
  }

  private cancelGitHubActionsRun(runId: string): { success: boolean; error?: string } {
    if (!this.ensureGh()) {
      return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
    }

    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';

    const result = this.gh(`run cancel ${runId} ${repoFlag}`.trim());
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to cancel run' };
    }

    return { success: true };
  }

  private rerunGitHubActions(runId: string): { success: boolean; newRunId?: string; error?: string } {
    if (!this.ensureGh()) {
      return { success: false, error: 'GitHub CLI (`gh`) is not installed or not authenticated' };
    }

    const slug = this.getRepoSlug();
    const repoFlag = slug ? `--repo ${slug}` : '';

    const result = this.gh(`run rerun ${runId} ${repoFlag}`.trim());
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to rerun' };
    }

    // Get the new run (most recent)
    const latestResult = this.gh(`run list --limit 1 --json databaseId ${repoFlag}`.trim());
    if (latestResult.exitCode === 0) {
      const runs = parseJSON<Record<string, any>[]>(latestResult.stdout);
      if (runs && runs.length > 0) {
        return { success: true, newRunId: String(runs[0].databaseId) };
      }
    }

    return { success: true };
  }

  // ================================================================
  // GitLab CI Implementation
  // ================================================================

  private runGitLabCI(pipeline?: string, options?: PipelineOptions): { success: boolean; run?: PipelineRun; error?: string } {
    // GitLab CI pipelines are triggered via API; require `glab` CLI
    const ref = options?.ref ?? this.getDefaultBranch();
    const result = execCommand(`glab ci run --ref "${ref}"${pipeline ? ` --pipeline "${pipeline}"` : ''}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to trigger GitLab CI pipeline. Ensure `glab` CLI is installed.' };
    }

    return { success: true };
  }

  private getGitLabCIStatus(runId?: string): { success: boolean; run?: PipelineRun; runs?: PipelineRun[]; error?: string } {
    const result = execCommand(`glab ci status${runId ? ` --pipeline-id ${runId}` : ''}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get GitLab CI status' };
    }

    return {
      success: true,
      run: {
        id: runId ?? 'latest',
        system: 'gitlab-ci',
        name: 'GitLab CI Pipeline',
        status: 'unknown',
        branch: this.getDefaultBranch(),
        commit: '',
        url: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        triggeredBy: '',
      },
    };
  }

  private getGitLabCILogs(runId: string): { success: boolean; logs?: PipelineLog; error?: string } {
    const result = execCommand(`glab ci trace --pipeline-id ${runId}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get GitLab CI logs' };
    }

    return {
      success: true,
      logs: {
        runId,
        system: 'gitlab-ci',
        jobs: [{
          name: 'pipeline',
          status: 'unknown',
          log: result.stdout,
        }],
      },
    };
  }

  private listGitLabCIPipelines(): { success: boolean; pipelines?: PipelineInfo[]; error?: string } {
    const configFile = this.resolvePath(GITLAB_CI_FILE);
    if (!existsSync(configFile)) {
      return { success: false, error: 'No .gitlab-ci.yml found' };
    }

    const content = readFileSync(configFile, 'utf-8');
    const stages = this.extractYAMLStages(content);
    const pipelines: PipelineInfo[] = stages.map(stage => ({
      id: stage,
      name: stage,
      system: 'gitlab-ci',
      configFile: GITLAB_CI_FILE,
      triggers: ['push', 'merge_request'],
    }));

    return { success: true, pipelines };
  }

  private getGitLabCIHistory(limit: number): { success: boolean; runs?: PipelineRun[]; error?: string } {
    const result = execCommand(`glab ci list --per-page ${limit}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get GitLab CI history' };
    }

    return { success: true, runs: [] };
  }

  private cancelGitLabCIRun(runId: string): { success: boolean; error?: string } {
    const result = execCommand(`glab ci cancel --pipeline-id ${runId}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to cancel GitLab CI run' };
    }
    return { success: true };
  }

  private rerunGitLabCI(runId: string): { success: boolean; newRunId?: string; error?: string } {
    const result = execCommand(`glab ci retry --pipeline-id ${runId}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to rerun GitLab CI pipeline' };
    }
    return { success: true };
  }

  // ================================================================
  // Jenkins Implementation
  // ================================================================

  private runJenkins(pipeline?: string, options?: PipelineOptions): { success: boolean; run?: PipelineRun; error?: string } {
    // Jenkins builds are triggered via API or `jenkins-cli`
    const jobName = pipeline ?? 'main';
    const parameters = options?.parameters ?? {};
    let paramFlags = '';
    for (const [key, value] of Object.entries(parameters)) {
      paramFlags += ` -p ${key}="${value}"`;
    }

    // Try using jenkins-cli.jar if available
    const result = execCommand(`java -jar jenkins-cli.jar build ${jobName}${paramFlags}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: 'Failed to trigger Jenkins build. Ensure `jenkins-cli.jar` is available and Jenkins is accessible.',
      };
    }

    return { success: true };
  }

  private getJenkinsStatus(runId?: string): { success: boolean; run?: PipelineRun; runs?: PipelineRun[]; error?: string } {
    // Jenkins status via CLI
    return {
      success: true,
      run: {
        id: runId ?? 'latest',
        system: 'jenkins',
        name: 'Jenkins Build',
        status: 'unknown',
        branch: this.getDefaultBranch(),
        commit: '',
        url: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        triggeredBy: '',
      },
    };
  }

  private getJenkinsLogs(runId: string): { success: boolean; logs?: PipelineLog; error?: string } {
    const result = execCommand(`java -jar jenkins-cli.jar console ${runId}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get Jenkins console output' };
    }

    return {
      success: true,
      logs: {
        runId,
        system: 'jenkins',
        jobs: [{
          name: 'build',
          status: 'unknown',
          log: result.stdout,
        }],
      },
    };
  }

  private listJenkinsPipelines(): { success: boolean; pipelines?: PipelineInfo[]; error?: string } {
    const jenkinsfile = this.resolvePath(JENKINS_FILE);
    if (!existsSync(jenkinsfile)) {
      return { success: false, error: 'No Jenkinsfile found' };
    }

    const content = readFileSync(jenkinsfile, 'utf-8');
    const stages = this.extractJenkinsStages(content);

    return {
      success: true,
      pipelines: [{
        id: 'Jenkinsfile',
        name: 'Jenkins Pipeline',
        system: 'jenkins',
        configFile: JENKINS_FILE,
        triggers: stages,
      }],
    };
  }

  private getJenkinsHistory(limit: number): { success: boolean; runs?: PipelineRun[]; error?: string } {
    // Jenkins history via CLI - limited support
    return { success: true, runs: [] };
  }

  private cancelJenkinsRun(runId: string): { success: boolean; error?: string } {
    const result = execCommand(`java -jar jenkins-cli.jar stop ${runId}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: 'Failed to cancel Jenkins build' };
    }
    return { success: true };
  }

  private rerunJenkins(runId: string): { success: boolean; newRunId?: string; error?: string } {
    const result = execCommand(`java -jar jenkins-cli.jar build ${runId}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: 'Failed to rerun Jenkins build' };
    }
    return { success: true };
  }

  // ================================================================
  // CircleCI Implementation
  // ================================================================

  private runCircleCI(pipeline?: string, options?: PipelineOptions): { success: boolean; run?: PipelineRun; error?: string } {
    const slug = this.getRepoSlug() ?? '';
    const ref = options?.ref ?? this.getDefaultBranch();
    const slugFlag = slug ? `--repo ${slug}` : '';

    const result = execCommand(`circleci trigger-pipeline --branch "${ref}" ${slugFlag}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: 'Failed to trigger CircleCI pipeline. Ensure `circleci` CLI is installed and authenticated.',
      };
    }

    return { success: true };
  }

  private getCircleCIStatus(runId?: string): { success: boolean; run?: PipelineRun; runs?: PipelineRun[]; error?: string } {
    const slug = this.getRepoSlug() ?? '';
    const slugFlag = slug ? `--repo ${slug}` : '';

    const result = execCommand(`circleci pipeline status ${slugFlag}${runId ? ` --pipeline-id ${runId}` : ''}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get CircleCI status' };
    }

    return {
      success: true,
      run: {
        id: runId ?? 'latest',
        system: 'circleci',
        name: 'CircleCI Pipeline',
        status: 'unknown',
        branch: this.getDefaultBranch(),
        commit: '',
        url: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        triggeredBy: '',
      },
    };
  }

  private getCircleCILogs(runId: string): { success: boolean; logs?: PipelineLog; error?: string } {
    const result = execCommand(`circleci pipeline show --pipeline-id ${runId}`, { cwd: this.projectRoot });

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get CircleCI logs' };
    }

    return {
      success: true,
      logs: {
        runId,
        system: 'circleci',
        jobs: [{
          name: 'pipeline',
          status: 'unknown',
          log: result.stdout,
        }],
      },
    };
  }

  private listCircleCIPipelines(): { success: boolean; pipelines?: PipelineInfo[]; error?: string } {
    const configPath = this.resolvePath(CIRCLECI_CONFIG_FILE);
    if (!existsSync(configPath)) {
      return { success: false, error: 'No .circleci/config.yml found' };
    }

    const content = readFileSync(configPath, 'utf-8');
    const jobs = this.extractCircleCIJobs(content);

    return {
      success: true,
      pipelines: jobs.map(job => ({
        id: job,
        name: job,
        system: 'circleci',
        configFile: CIRCLECI_CONFIG_FILE,
        triggers: ['push'],
      })),
    };
  }

  private getCircleCIHistory(limit: number): { success: boolean; runs?: PipelineRun[]; error?: string } {
    const slug = this.getRepoSlug() ?? '';
    const slugFlag = slug ? `--repo ${slug}` : '';

    const result = execCommand(`circleci pipeline list ${slugFlag} --limit ${limit}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to get CircleCI history' };
    }
    return { success: true, runs: [] };
  }

  private cancelCircleCIRun(runId: string): { success: boolean; error?: string } {
    const result = execCommand(`circleci pipeline cancel --pipeline-id ${runId}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to cancel CircleCI pipeline' };
    }
    return { success: true };
  }

  private rerunCircleCI(runId: string): { success: boolean; newRunId?: string; error?: string } {
    const result = execCommand(`circleci pipeline rerun --pipeline-id ${runId}`, { cwd: this.projectRoot });
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Failed to rerun CircleCI pipeline' };
    }
    return { success: true };
  }

  // ================================================================
  // Config Generation
  // ================================================================

  private createGitHubActionsConfig(options: CreatePipelineConfigOptions): { success: boolean; path?: string; error?: string } {
    const lang = options.language.toLowerCase();
    const nodeVersion = options.nodeVersion ?? '20';
    const branches = options.branches ?? ['main'];
    const buildCmd = options.buildCommand ?? '';
    const testCmd = options.testCommand ?? '';
    const lintCmd = options.lintCommand ?? '';
    const deployCmd = options.deployCommand ?? '';

    let steps = '';

    // Setup steps based on language
    if (lang === 'typescript' || lang === 'javascript' || lang === 'node') {
      steps += `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'
          cache: 'npm'
      - run: npm ci`;
    } else if (lang === 'python') {
      const pyVersion = options.pythonVersion ?? '3.11';
      steps += `
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '${pyVersion}'
          cache: 'pip'
      - run: pip install -r requirements.txt`;
    } else if (lang === 'go') {
      steps += `
      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'`;
    } else {
      steps += `
      - name: Install dependencies
        run: |${buildCmd ? `\n          ${buildCmd.split(' ')[0]} install` : ' echo "Add your install step here"'}`;
    }

    if (lintCmd) {
      steps += `
      - name: Lint
        run: ${lintCmd}`;
    }

    if (buildCmd) {
      steps += `
      - name: Build
        run: ${buildCmd}`;
    }

    if (testCmd) {
      steps += `
      - name: Test
        run: ${testCmd}`;
    }

    if (deployCmd) {
      steps += `
      - name: Deploy
        run: ${deployCmd}
        if: github.ref == 'refs/heads/${branches[0]}'`;
    }

    // Add custom stages
    if (options.stages) {
      for (const stage of options.stages) {
        steps += `
      - name: ${stage.name}
        run: ${stage.command}${stage.condition ? `\n        if: ${stage.condition}` : ''}`;
      }
    }

    const yaml = `name: CI

on:
  push:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]
  pull_request:
    branches: [${branches.map(b => `'${b}'`).join(', ')}]

jobs:
  build:
    runs-on: ubuntu-latest
${options.dockerImage ? `    container: ${options.dockerImage}` : ''}
    steps:
      - name: Checkout
        uses: actions/checkout@v4${steps}
`;

    // Write file
    const workflowsDir = this.resolvePath(GITHUB_WORKFLOWS_DIR);
    if (!existsSync(workflowsDir)) {
      mkdirSync(workflowsDir, { recursive: true });
    }

    const filePath = join(workflowsDir, 'ci.yml');
    writeFileSync(filePath, yaml, 'utf-8');

    return { success: true, path: join(GITHUB_WORKFLOWS_DIR, 'ci.yml') };
  }

  private createGitLabCIConfig(options: CreatePipelineConfigOptions): { success: boolean; path?: string; error?: string } {
    const lang = options.language.toLowerCase();
    const nodeVersion = options.nodeVersion ?? '20';
    const buildCmd = options.buildCommand ?? '';
    const testCmd = options.testCommand ?? '';
    const lintCmd = options.lintCommand ?? '';
    const branches = options.branches ?? ['main'];

    let imageLine = '';
    if (options.dockerImage) {
      imageLine = `image: ${options.dockerImage}\n\n`;
    } else if (lang === 'typescript' || lang === 'javascript' || lang === 'node') {
      imageLine = `image: node:${nodeVersion}\n\n`;
    } else if (lang === 'python') {
      imageLine = `image: python:${options.pythonVersion ?? '3.11'}\n\n`;
    }

    let stages = 'stages:\n  - lint\n  - build\n  - test\n';
    let jobDefs = '';

    if (lintCmd) {
      stages += '  - deploy\n';
      jobDefs += `
lint:
  stage: lint
  script:
    - ${lintCmd}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "${branches[0]}"

`;
    }

    if (buildCmd) {
      jobDefs += `build:
  stage: build
  script:
    - ${buildCmd}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "${branches[0]}"

`;
    }

    if (testCmd) {
      jobDefs += `test:
  stage: test
  script:
    - ${testCmd}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "${branches[0]}"

`;
    }

    if (options.deployCommand) {
      jobDefs += `deploy:
  stage: deploy
  script:
    - ${options.deployCommand}
  rules:
    - if: $CI_COMMIT_BRANCH == "${branches[0]}"
  environment: production

`;
    }

    const yaml = `${imageLine}${stages}\n${jobDefs}`;

    const filePath = this.resolvePath(GITLAB_CI_FILE);
    writeFileSync(filePath, yaml, 'utf-8');

    return { success: true, path: GITLAB_CI_FILE };
  }

  private createJenkinsConfig(options: CreatePipelineConfigOptions): { success: boolean; path?: string; error?: string } {
    const buildCmd = options.buildCommand ?? 'echo "Build step"';
    const testCmd = options.testCommand ?? 'echo "Test step"';
    const lintCmd = options.lintCommand ?? '';

    let stages = '';

    if (lintCmd) {
      stages += `
    stage('Lint') {
      steps {
        sh '${lintCmd}'
      }
    }
`;
    }

    stages += `
    stage('Build') {
      steps {
        sh '${buildCmd}'
      }
    }
    stage('Test') {
      steps {
        sh '${testCmd}'
      }
    }
`;

    if (options.deployCommand) {
      stages += `
    stage('Deploy') {
      when {
        branch '${options.branches?.[0] ?? 'main'}'
      }
      steps {
        sh '${options.deployCommand}'
      }
    }
`;
    }

    if (options.stages) {
      for (const stage of options.stages) {
        stages += `
    stage('${stage.name}') {
${stage.condition ? `      when {\n        expression { ${stage.condition} }\n      }\n` : ''}      steps {
        sh '${stage.command}'
      }
    }
`;
      }
    }

    const jenkinsfile = `pipeline {
  agent any

  stages {${stages}
  }

  post {
    always {
      cleanWs()
    }
    success {
      echo 'Pipeline succeeded!'
    }
    failure {
      echo 'Pipeline failed!'
    }
  }
}
`;

    const filePath = this.resolvePath(JENKINS_FILE);
    writeFileSync(filePath, jenkinsfile, 'utf-8');

    return { success: true, path: JENKINS_FILE };
  }

  private createCircleCIConfig(options: CreatePipelineConfigOptions): { success: boolean; path?: string; error?: string } {
    const lang = options.language.toLowerCase();
    const nodeVersion = options.nodeVersion ?? '20';
    const buildCmd = options.buildCommand ?? '';
    const testCmd = options.testCommand ?? '';
    const lintCmd = options.lintCommand ?? '';

    let orbs = '';
    let setupSteps = '';
    let dockerImage = options.dockerImage ?? 'cimg/base:stable';

    if (lang === 'typescript' || lang === 'javascript' || lang === 'node') {
      dockerImage = `cimg/node:${nodeVersion}`;
      setupSteps = `      - run:\n          name: Install dependencies\n          command: npm ci\n`;
    } else if (lang === 'python') {
      dockerImage = `cimg/python:${options.pythonVersion ?? '3.11'}`;
      setupSteps = `      - run:\n          name: Install dependencies\n          command: pip install -r requirements.txt\n`;
    }

    let jobSteps = setupSteps;

    if (lintCmd) {
      jobSteps += `      - run:\n          name: Lint\n          command: ${lintCmd}\n`;
    }
    if (buildCmd) {
      jobSteps += `      - run:\n          name: Build\n          command: ${buildCmd}\n`;
    }
    if (testCmd) {
      jobSteps += `      - run:\n          name: Test\n          command: ${testCmd}\n`;
    }
    if (options.deployCommand) {
      jobSteps += `      - run:\n          name: Deploy\n          command: ${options.deployCommand}\n`;
    }

    if (options.stages) {
      for (const stage of options.stages) {
        jobSteps += `      - run:\n          name: ${stage.name}\n          command: ${stage.command}\n`;
      }
    }

    const yaml = `version: 2.1

${orbs}jobs:
  build-and-test:
    docker:
      - image: ${dockerImage}
    steps:
      - checkout
${jobSteps}
workflows:
  ci:
    jobs:
      - build-and-test
`;

    const circleDir = this.resolvePath(CIRCLECI_DIR);
    if (!existsSync(circleDir)) {
      mkdirSync(circleDir, { recursive: true });
    }

    const filePath = join(circleDir, 'config.yml');
    writeFileSync(filePath, yaml, 'utf-8');

    return { success: true, path: join(CIRCLECI_DIR, 'config.yml') };
  }

  // ================================================================
  // Config Validation
  // ================================================================

  private validateGitHubActionsConfig(): { success: boolean; result?: ValidationResult; error?: string } {
    const workflowsDir = this.resolvePath(GITHUB_WORKFLOWS_DIR);
    const issues: ValidationIssue[] = [];

    if (!existsSync(workflowsDir)) {
      return {
        success: true,
        result: {
          valid: false,
          issues: [{ severity: 'error', message: 'No .github/workflows directory found', file: GITHUB_WORKFLOWS_DIR }],
          system: 'github-actions',
        },
      };
    }

    try {
      const files = readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

      if (files.length === 0) {
        issues.push({ severity: 'warning', message: 'No workflow files found in .github/workflows', file: GITHUB_WORKFLOWS_DIR });
      }

      for (const file of files) {
        const filePath = join(workflowsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Basic YAML structure checks
        let hasOn = false;
        let hasJobs = false;
        let hasRunsOn = false;
        let hasCheckout = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/^on\s*:/.test(line.trim())) hasOn = true;
          if (/^jobs\s*:/.test(line.trim())) hasJobs = true;
          if (/runs-on\s*:/.test(line)) hasRunsOn = true;
          if (/actions\/checkout/.test(line)) hasCheckout = true;
        }

        if (!hasOn) {
          issues.push({ severity: 'error', message: 'Missing "on" trigger definition', file, line: 1 });
        }
        if (!hasJobs) {
          issues.push({ severity: 'error', message: 'Missing "jobs" definition', file, line: 1 });
        }
        if (hasJobs && !hasRunsOn) {
          issues.push({ severity: 'warning', message: 'No "runs-on" found - jobs may not specify runner', file });
        }
        if (hasJobs && !hasCheckout) {
          issues.push({ severity: 'info', message: 'Consider adding "actions/checkout" step', file });
        }

        // Check for common YAML issues
        if (content.includes('\t')) {
          issues.push({ severity: 'warning', message: 'File contains tab characters (YAML requires spaces)', file });
        }

        // Check for trailing spaces on key lines
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].endsWith(' ') && lines[i].trim().endsWith(':')) {
            issues.push({ severity: 'info', message: 'Trailing whitespace after key', file, line: i + 1 });
          }
        }
      }
    } catch (error) {
      return { success: false, error: `Validation failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    const hasErrors = issues.some(i => i.severity === 'error');
    return {
      success: true,
      result: {
        valid: !hasErrors,
        issues,
        system: 'github-actions',
      },
    };
  }

  private validateGitLabCIConfig(): { success: boolean; result?: ValidationResult; error?: string } {
    const configPath = this.resolvePath(GITLAB_CI_FILE);
    const issues: ValidationIssue[] = [];

    if (!existsSync(configPath)) {
      return {
        success: true,
        result: {
          valid: false,
          issues: [{ severity: 'error', message: 'No .gitlab-ci.yml found', file: GITLAB_CI_FILE }],
          system: 'gitlab-ci',
        },
      };
    }

    const content = readFileSync(configPath, 'utf-8');

    if (!content.includes('stages:') && !content.includes('stage:')) {
      issues.push({ severity: 'warning', message: 'No "stages" definition found', file: GITLAB_CI_FILE });
    }

    if (content.includes('\t')) {
      issues.push({ severity: 'warning', message: 'File contains tab characters', file: GITLAB_CI_FILE });
    }

    const hasErrors = issues.some(i => i.severity === 'error');
    return {
      success: true,
      result: { valid: !hasErrors, issues, system: 'gitlab-ci' },
    };
  }

  private validateJenkinsConfig(): { success: boolean; result?: ValidationResult; error?: string } {
    const configPath = this.resolvePath(JENKINS_FILE);
    const issues: ValidationIssue[] = [];

    if (!existsSync(configPath)) {
      return {
        success: true,
        result: {
          valid: false,
          issues: [{ severity: 'error', message: 'No Jenkinsfile found', file: JENKINS_FILE }],
          system: 'jenkins',
        },
      };
    }

    const content = readFileSync(configPath, 'utf-8');

    if (!content.includes('pipeline') && !content.includes('node')) {
      issues.push({ severity: 'error', message: 'No "pipeline" or "node" block found', file: JENKINS_FILE });
    }

    if (!content.includes('stage')) {
      issues.push({ severity: 'warning', message: 'No "stage" definitions found', file: JENKINS_FILE });
    }

    if (!content.includes('agent')) {
      issues.push({ severity: 'info', message: 'No "agent" definition found - will use "any"', file: JENKINS_FILE });
    }

    const hasErrors = issues.some(i => i.severity === 'error');
    return {
      success: true,
      result: { valid: !hasErrors, issues, system: 'jenkins' },
    };
  }

  private validateCircleCIConfig(): { success: boolean; result?: ValidationResult; error?: string } {
    const configPath = this.resolvePath(CIRCLECI_CONFIG_FILE);
    const issues: ValidationIssue[] = [];

    if (!existsSync(configPath)) {
      return {
        success: true,
        result: {
          valid: false,
          issues: [{ severity: 'error', message: 'No .circleci/config.yml found', file: CIRCLECI_CONFIG_FILE }],
          system: 'circleci',
        },
      };
    }

    const content = readFileSync(configPath, 'utf-8');

    if (!content.includes('version:')) {
      issues.push({ severity: 'error', message: 'Missing "version" key', file: CIRCLECI_CONFIG_FILE });
    }

    if (!content.includes('jobs:')) {
      issues.push({ severity: 'error', message: 'Missing "jobs" definition', file: CIRCLECI_CONFIG_FILE });
    }

    if (!content.includes('workflows:')) {
      issues.push({ severity: 'error', message: 'Missing "workflows" definition', file: CIRCLECI_CONFIG_FILE });
    }

    if (content.includes('\t')) {
      issues.push({ severity: 'warning', message: 'File contains tab characters', file: CIRCLECI_CONFIG_FILE });
    }

    const hasErrors = issues.some(i => i.severity === 'error');
    return {
      success: true,
      result: { valid: !hasErrors, issues, system: 'circleci' },
    };
  }

  // ================================================================
  // YAML / Config Parsing Helpers
  // ================================================================

  private mapGitHubActionsRun(r: Record<string, any>): PipelineRun {
    return {
      id: String(r.databaseId ?? r.id ?? ''),
      system: 'github-actions',
      name: r.name ?? '',
      status: this.mapGitHubStatus(r.status, r.conclusion),
      branch: r.headBranch ?? '',
      commit: r.headSha ?? '',
      url: r.htmlUrl ?? '',
      createdAt: r.createdAt ?? '',
      updatedAt: r.updatedAt ?? '',
      triggeredBy: r.event ?? '',
    };
  }

  private mapGitHubStatus(status: string, conclusion: string | null): PipelineRunStatus {
    if (conclusion === 'success') return 'success';
    if (conclusion === 'failure') return 'failure';
    if (conclusion === 'cancelled') return 'cancelled';
    if (conclusion === 'skipped') return 'skipped';

    switch (status) {
      case 'queued': return 'queued';
      case 'in_progress': case 'running': return 'in_progress';
      case 'waiting': return 'waiting';
      case 'completed':
        return conclusion ? this.mapGitHubStatus('', conclusion) : 'unknown';
      default: return 'unknown';
    }
  }

  private extractYAMLTriggers(content: string): string[] {
    const triggers: string[] = [];
    const onMatch = content.match(/^on\s*:\s*$/m);

    if (onMatch) {
      const afterOn = content.slice(onMatch.index! + onMatch[0].length);
      const triggerBlock = afterOn.split(/^[\w_-]+\s*:/m)[0];

      const pushMatch = triggerBlock.match(/push\s*:/);
      const prMatch = triggerBlock.match(/pull_request\s*:/);
      const scheduleMatch = triggerBlock.match(/schedule\s*:/);
      const workflowDispatchMatch = triggerBlock.match(/workflow_dispatch\s*:/);

      if (pushMatch) triggers.push('push');
      if (prMatch) triggers.push('pull_request');
      if (scheduleMatch) triggers.push('schedule');
      if (workflowDispatchMatch) triggers.push('workflow_dispatch');
    }

    // Also check for single-line on: [push, pull_request]
    const inlineMatch = content.match(/^on\s*:\s*\[(.+?)\]/m);
    if (inlineMatch) {
      const items = inlineMatch[1].split(',').map(s => s.trim());
      triggers.push(...items);
    }

    // Check for simple on: push
    const simpleMatch = content.match(/^on\s*:\s*(\w+)\s*$/m);
    if (simpleMatch && triggers.length === 0) {
      triggers.push(simpleMatch[1]);
    }

    return triggers.length > 0 ? triggers : ['unknown'];
  }

  private extractYAMLWorkflowName(content: string): string | null {
    const match = content.match(/^name\s*:\s*['"]?(.+?)['"]?\s*$/m);
    return match ? match[1].trim() : null;
  }

  private extractYAMLStages(content: string): string[] {
    const stages: string[] = [];
    const match = content.match(/^stages\s*:\s*$/m);
    if (match) {
      const afterStages = content.slice(match.index! + match[0].length);
      const lines = afterStages.split('\n');
      for (const line of lines) {
        const stageMatch = line.match(/^\s+-\s*['"]?(.+?)['"]?\s*$/);
        if (stageMatch) {
          stages.push(stageMatch[1].trim());
        } else if (line.trim() && !line.trim().startsWith('#') && !line.match(/^\s+-/)) {
          break;
        }
      }
    }
    return stages.length > 0 ? stages : ['build', 'test', 'deploy'];
  }

  private extractJenkinsStages(content: string): string[] {
    const stages: string[] = [];
    const stageRegex = /stage\s*\(\s*['"](.+?)['"]\s*\)/g;
    let match;
    while ((match = stageRegex.exec(content)) !== null) {
      stages.push(match[1]);
    }
    return stages;
  }

  private extractCircleCIJobs(content: string): string[] {
    const jobs: string[] = [];
    const lines = content.split('\n');
    let inJobs = false;

    for (const line of lines) {
      if (/^jobs\s*:/.test(line.trim())) {
        inJobs = true;
        continue;
      }
      if (inJobs) {
        const jobMatch = line.match(/^\s{2}(\w[\w-]*)\s*:/);
        if (jobMatch) {
          jobs.push(jobMatch[1]);
        } else if (line.trim() && !line.trim().startsWith('#') && !line.match(/^\s{4,}/)) {
          inJobs = false;
        }
      }
    }

    return jobs.length > 0 ? jobs : ['build'];
  }
}

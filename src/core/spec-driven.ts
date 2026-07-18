// ============================================================
// NeuroCLI - Spec-Driven Development Pipeline (GAP-30)
// Inspired by Kiro/AWS spec-driven development approach
// Instead of going directly from prompt to code, generate
// structured specifications first, then implement from specs.
// Pipeline: Requirements -> Design -> Plan -> Implement -> Verify
// ============================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, resolve, relative } from 'path';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { Message } from './types.js';

// ============================================================
// Public Interfaces
// ============================================================

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

export type PipelineStage =
  | 'requirements'
  | 'design'
  | 'plan'
  | 'approval'
  | 'implementation'
  | 'verification';

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

// ============================================================
// Engine type – minimal contract for spec-driven pipeline
// ============================================================

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

// ============================================================
// Constants
// ============================================================

const SPECS_DIR = '.neuro/specs';
const SPEC_FILE_EXTENSION = '.md';

const REQUIREMENTS_SYSTEM_PROMPT = `You are a requirements analyst for a software project. Given a natural language description, generate structured functional requirements.

For each requirement, provide:
- A clear title
- A detailed description
- A priority (must, should, or could) using the MoSCoW method
- Testable acceptance criteria

Output your response as a JSON array of requirement objects with this exact shape:
[
  {
    "id": "FR-001",
    "title": "...",
    "description": "...",
    "priority": "must|should|could",
    "acceptanceCriteria": ["...", "..."],
    "status": "pending"
  }
]

Be thorough, precise, and ensure every acceptance criterion is independently testable. Number requirements sequentially starting from FR-001.`;

const DESIGN_SYSTEM_PROMPT = `You are a software architect. Given a set of functional requirements, generate a technical design document.

Provide:
- Architecture overview: High-level architecture pattern and key decisions
- Components: List of components with name, description, responsibilities, interfaces, and dependencies
- Data flow: How data moves through the system
- API design: Key APIs or interfaces (as string descriptions)
- Error handling: Strategy for error handling and edge cases

Output your response as a JSON object with this exact shape:
{
  "architecture": "...",
  "components": [
    {
      "name": "...",
      "description": "...",
      "responsibilities": ["..."],
      "interfaces": ["..."],
      "dependencies": ["..."]
    }
  ],
  "dataFlow": "...",
  "apiDesign": ["..."],
  "errorHandling": "..."
}

Be specific about component interactions and data flow. Each component should have clear, single responsibilities.`;

const PLAN_SYSTEM_PROMPT = `You are a project planner. Given a technical design document, generate a step-by-step implementation plan.

Provide:
- Phases: Ordered groups of tasks, each with a name and order number
- Tasks within each phase: Specific, actionable implementation tasks with optional file paths and verification steps
- Estimated effort: Overall effort estimate
- Dependencies: External dependencies or prerequisites
- Risks: Potential risks with likelihood, impact, and mitigation strategies

Output your response as a JSON object with this exact shape:
{
  "phases": [
    {
      "name": "Phase 1: ...",
      "tasks": [
        {
          "id": "T-001",
          "description": "...",
          "completed": false,
          "files": ["path/to/file.ts"],
          "verification": "..."
        }
      ],
      "order": 1
    }
  ],
  "estimatedEffort": "...",
  "dependencies": ["..."],
  "risks": [
    {
      "id": "R-001",
      "description": "...",
      "likelihood": "low|medium|high",
      "impact": "low|medium|high",
      "mitigation": "..."
    }
  ]
}

Make tasks small, incremental, and independently verifiable. Each phase should produce a working checkpoint.`;

const VERIFICATION_SYSTEM_PROMPT = `You are a QA engineer. Given a specification with requirements and acceptance criteria, verify the implementation.

For each acceptance criterion, determine:
- Whether it is met (passed/failed)
- Evidence supporting the determination

Also provide:
- An overall score (0-100)
- A list of issues found
- Suggestions for improvement

Output your response as a JSON object with this exact shape:
{
  "passed": true|false,
  "criteriaResults": [
    {
      "requirementId": "FR-001",
      "criteriaIndex": 0,
      "criteriaText": "...",
      "passed": true|false,
      "evidence": "..."
    }
  ],
  "overallScore": 85,
  "issues": ["..."],
  "suggestions": ["..."]
}

Be rigorous and evidence-based. A criterion passes only when you can confirm it from the code or tests.`;

const IMPLEMENTATION_TASK_PROMPT = `You are an expert software developer. Implement the following task as part of a larger project.

Task: {taskDescription}

Files to modify: {files}
Verification criteria: {verification}

Context from design:
{designContext}

Requirements this task addresses:
{relevantRequirements}

Write the implementation code. Create or modify the specified files. Ensure the code is complete, well-structured, and follows the project's existing patterns. After implementation, describe what you did and verify it meets the acceptance criteria.`;

// ============================================================
// SpecDrivenPipeline class
// ============================================================

export class SpecDrivenPipeline {
  private engine: SpecDrivenEngine;
  private projectRoot: string;
  private specsDir: string;
  private model: string;
  private totalCost: number;

  constructor(engine: SpecDrivenEngine, projectRoot: string, model?: string) {
    this.engine = engine;
    this.projectRoot = resolve(projectRoot);
    this.specsDir = join(this.projectRoot, SPECS_DIR);
    this.model = model || 'qwen/qwen3-coder:free';
    this.totalCost = 0;
    this.ensureSpecsDir();
  }

  // -------------------------------------------------------------------
  // Directory management
  // -------------------------------------------------------------------

  private ensureSpecsDir(): void {
    if (!existsSync(this.specsDir)) {
      mkdirSync(this.specsDir, { recursive: true });
    }
  }

  // -------------------------------------------------------------------
  // Hashing utilities
  // -------------------------------------------------------------------

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // -------------------------------------------------------------------
  // LLM helper
  // -------------------------------------------------------------------

  private async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    const result = await this.engine.runPrompt(fullPrompt, this.model);
    this.totalCost += result.cost;

    if (result.error) {
      throw new Error(`LLM call failed: ${result.error}`);
    }

    return result.text;
  }

  // -------------------------------------------------------------------
  // JSON extraction from LLM responses
  // -------------------------------------------------------------------

  private extractJSON(text: string): string {
    // Try to find a JSON block wrapped in markdown code fences
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find a raw JSON array or object
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    const objectMatch = text.match(/\{[\s\S]*\}/);

    if (arrayMatch && objectMatch) {
      // Return whichever comes first
      const arrayIndex = text.indexOf(arrayMatch[0]);
      const objectIndex = text.indexOf(objectMatch[0]);
      return arrayIndex < objectIndex ? arrayMatch[0] : objectMatch[0];
    }

    if (arrayMatch) return arrayMatch[0];
    if (objectMatch) return objectMatch[0];

    return text.trim();
  }

  private parseJSON<T>(text: string): T {
    const jsonStr = this.extractJSON(text);
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      throw new Error(`Failed to parse LLM response as JSON: ${jsonStr.substring(0, 200)}...`);
    }
  }

  // -------------------------------------------------------------------
  // Pipeline Stage 1: Generate Requirements
  // -------------------------------------------------------------------

  async generateRequirements(prompt: string): Promise<Requirement[]> {
    const userPrompt = `Generate detailed functional requirements for the following feature request:\n\n${prompt}`;
    const response = await this.callLLM(REQUIREMENTS_SYSTEM_PROMPT, userPrompt);
    const requirements = this.parseJSON<Requirement[]>(response);

    // Validate and normalize
    return requirements.map((req, index) => ({
      id: req.id || `FR-${String(index + 1).padStart(3, '0')}`,
      title: req.title || `Requirement ${index + 1}`,
      description: req.description || '',
      priority: ['must', 'should', 'could'].includes(req.priority) ? req.priority : 'should',
      acceptanceCriteria: Array.isArray(req.acceptanceCriteria) ? req.acceptanceCriteria : [],
      status: 'pending' as const,
    }));
  }

  // -------------------------------------------------------------------
  // Pipeline Stage 2: Generate Design
  // -------------------------------------------------------------------

  async generateDesign(requirements: Requirement[]): Promise<DesignDoc> {
    const requirementsText = requirements
      .map(r => `${r.id}: ${r.title}\n  Priority: ${r.priority}\n  Description: ${r.description}\n  Acceptance Criteria:\n${r.acceptanceCriteria.map(ac => `    - ${ac}`).join('\n')}`)
      .join('\n\n');

    const userPrompt = `Generate a technical design document based on these requirements:\n\n${requirementsText}`;
    const response = await this.callLLM(DESIGN_SYSTEM_PROMPT, userPrompt);
    const design = this.parseJSON<DesignDoc>(response);

    return {
      architecture: design.architecture || '',
      components: Array.isArray(design.components)
        ? design.components.map((c, i) => ({
            name: c.name || `Component ${i + 1}`,
            description: c.description || '',
            responsibilities: Array.isArray(c.responsibilities) ? c.responsibilities : [],
            interfaces: Array.isArray(c.interfaces) ? c.interfaces : [],
            dependencies: Array.isArray(c.dependencies) ? c.dependencies : [],
          }))
        : [],
      dataFlow: design.dataFlow || '',
      apiDesign: Array.isArray(design.apiDesign) ? design.apiDesign : [],
      errorHandling: design.errorHandling || '',
    };
  }

  // -------------------------------------------------------------------
  // Pipeline Stage 3: Generate Implementation Plan
  // -------------------------------------------------------------------

  async generatePlan(design: DesignDoc): Promise<ImplementationPlan> {
    const designText = [
      `Architecture: ${design.architecture}`,
      `Data Flow: ${design.dataFlow}`,
      `Error Handling: ${design.errorHandling}`,
      `Components:\n${design.components.map(c => `  - ${c.name}: ${c.description}\n    Responsibilities: ${c.responsibilities.join(', ')}\n    Interfaces: ${c.interfaces.join(', ')}\n    Dependencies: ${c.dependencies.join(', ')}`).join('\n')}`,
      `API Design:\n${design.apiDesign.map(a => `  - ${a}`).join('\n')}`,
    ].join('\n\n');

    const userPrompt = `Generate a step-by-step implementation plan for this design:\n\n${designText}`;
    const response = await this.callLLM(PLAN_SYSTEM_PROMPT, userPrompt);
    const plan = this.parseJSON<ImplementationPlan>(response);

    return {
      phases: Array.isArray(plan.phases)
        ? plan.phases.map((phase, pi) => ({
            name: phase.name || `Phase ${pi + 1}`,
            order: phase.order ?? pi + 1,
            tasks: Array.isArray(phase.tasks)
              ? phase.tasks.map((task, ti) => ({
                  id: task.id || `T-${String(pi + 1).padStart(1, '0')}-${String(ti + 1).padStart(2, '0')}`,
                  description: task.description || '',
                  completed: false,
                  files: Array.isArray(task.files) ? task.files : undefined,
                  verification: task.verification || undefined,
                }))
              : [],
          }))
        : [],
      estimatedEffort: plan.estimatedEffort || 'Unknown',
      dependencies: Array.isArray(plan.dependencies) ? plan.dependencies : [],
      risks: Array.isArray(plan.risks)
        ? plan.risks.map((risk, ri) => ({
            id: risk.id || `R-${String(ri + 1).padStart(3, '0')}`,
            description: risk.description || '',
            likelihood: ['low', 'medium', 'high'].includes(risk.likelihood) ? risk.likelihood : 'medium',
            impact: ['low', 'medium', 'high'].includes(risk.impact) ? risk.impact : 'medium',
            mitigation: risk.mitigation || '',
          }))
        : [],
    };
  }

  // -------------------------------------------------------------------
  // Pipeline Stage 4: Execute Implementation Plan
  // -------------------------------------------------------------------

  async executePlan(plan: ImplementationPlan, options?: ExecOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const result: ExecutionResult = {
      success: true,
      phasesCompleted: 0,
      tasksCompleted: 0,
      tasksTotal: totalTasks,
      errors: [],
      filesModified: [],
      durationMs: 0,
    };

    const maxIterations = options?.maxIterations ?? 3;
    const phasesToRun = options?.phases ?? plan.phases.map((_, i) => i);
    const resume = options?.resume ?? false;

    for (const phaseIndex of phasesToRun) {
      if (phaseIndex >= plan.phases.length) continue;

      const phase = plan.phases[phaseIndex];
      let allTasksComplete = true;

      for (let taskIndex = 0; taskIndex < phase.tasks.length; taskIndex++) {
        const task = phase.tasks[taskIndex];

        // Skip already completed tasks when resuming
        if (resume && task.completed) {
          result.tasksCompleted++;
          continue;
        }

        options?.onProgress?.(phase.name, task.description, 0);

        const taskPrompt = IMPLEMENTATION_TASK_PROMPT
          .replace('{taskDescription}', task.description)
          .replace('{files}', task.files?.join(', ') || 'Determine appropriate files')
          .replace('{verification}', task.verification || 'Verify correctness')
          .replace('{designContext}', `Architecture: ${plan.phases[0]?.name || 'N/A'}`)
          .replace('{relevantRequirements}', task.description);

        let taskSucceeded = false;

        for (let iteration = 1; iteration <= maxIterations; iteration++) {
          options?.onProgress?.(phase.name, task.description, iteration);

          try {
            const llmResult = await this.engine.runPrompt(taskPrompt, this.model);
            this.totalCost += llmResult.cost;

            if (llmResult.error) {
              result.errors.push(`Task ${task.id} iteration ${iteration}: ${llmResult.error}`);
              continue;
            }

            // Track files changed by the engine
            if (llmResult.filesChanged > 0) {
              taskSucceeded = true;
              result.filesModified.push(...this.detectModifiedFiles(task.files));
              break;
            }

            // If the engine reports no file changes but no error, consider it informational
            if (llmResult.text && llmResult.text.length > 0) {
              taskSucceeded = true;
              break;
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Task ${task.id} iteration ${iteration}: ${errorMsg}`);
          }
        }

        if (taskSucceeded) {
          task.completed = true;
          result.tasksCompleted++;
        } else {
          allTasksComplete = false;
          result.errors.push(`Task ${task.id} failed after ${maxIterations} iterations`);
        }
      }

      if (allTasksComplete) {
        result.phasesCompleted++;
      } else {
        result.success = false;
      }

      // Optional test run after phase
      if (options?.testAfterPhase) {
        const testResult = this.runProjectTests();
        if (!testResult.passed) {
          result.errors.push(`Tests failed after phase "${phase.name}": ${testResult.output}`);
          result.success = false;
        }
      }
    }

    result.durationMs = Date.now() - startTime;

    // Update totals (already set at initialization, but recalculate in case phases were filtered)
    result.tasksTotal = result.tasksTotal || plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);

    return result;
  }

  // -------------------------------------------------------------------
  // Pipeline Stage 5: Verify Implementation
  // -------------------------------------------------------------------

  async verifyImplementation(spec: Spec): Promise<VerificationResult> {
    const criteriaList = spec.requirements.flatMap(req =>
      req.acceptanceCriteria.map((criteria, index) => ({
        requirementId: req.id,
        criteriaIndex: index,
        criteriaText: criteria,
      }))
    );

    // Gather current project state
    const projectState = this.gatherProjectState(spec);

    const userPrompt = [
      `Verify the following implementation against its specification.`,
      ``,
      `== REQUIREMENTS ==`,
      spec.requirements.map(r =>
        `${r.id} (${r.priority}): ${r.title}\n  ${r.description}\n  Acceptance Criteria:\n${r.acceptanceCriteria.map((ac, i) => `    [${i}] ${ac}`).join('\n')}`
      ).join('\n\n'),
      ``,
      `== DESIGN ==`,
      `Architecture: ${spec.design.architecture}`,
      `Components: ${spec.design.components.map(c => c.name).join(', ')}`,
      ``,
      `== CURRENT PROJECT STATE ==`,
      projectState,
      ``,
      `For each acceptance criterion, determine if it is met by the current implementation.`,
      `Provide evidence from the code for your determination.`,
    ].join('\n');

    const response = await this.callLLM(VERIFICATION_SYSTEM_PROMPT, userPrompt);

    let parsed: VerificationResult;
    try {
      const raw = this.parseJSON<{
        passed: boolean;
        criteriaResults: CriteriaCheckResult[];
        overallScore: number;
        issues: string[];
        suggestions: string[];
      }>(response);

      parsed = {
        passed: raw.passed ?? false,
        criteriaResults: Array.isArray(raw.criteriaResults)
          ? raw.criteriaResults.map(cr => ({
              requirementId: cr.requirementId || '',
              criteriaIndex: cr.criteriaIndex ?? 0,
              criteriaText: cr.criteriaText || '',
              passed: cr.passed ?? false,
              evidence: cr.evidence || '',
            }))
          : [],
        overallScore: typeof raw.overallScore === 'number' ? raw.overallScore : 0,
        issues: Array.isArray(raw.issues) ? raw.issues : [],
        suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
      };
    } catch {
      // Fallback: perform a basic check based on file existence
      parsed = {
        passed: false,
        criteriaResults: criteriaList.map(cl => ({
          requirementId: cl.requirementId,
          criteriaIndex: cl.criteriaIndex,
          criteriaText: cl.criteriaText,
          passed: false,
          evidence: 'Could not verify automatically - LLM response parsing failed',
        })),
        overallScore: 0,
        issues: ['Failed to parse verification response from LLM'],
        suggestions: ['Manually verify the implementation against the spec'],
      };
    }

    // Update requirement statuses based on verification
    for (const req of spec.requirements) {
      const relevantResults = parsed.criteriaResults.filter(
        cr => cr.requirementId === req.id
      );
      if (relevantResults.length > 0 && relevantResults.every(cr => cr.passed)) {
        req.status = 'verified';
      } else if (relevantResults.some(cr => cr.passed)) {
        req.status = 'implemented';
      } else {
        req.status = 'failed';
      }
    }

    return parsed;
  }

  // -------------------------------------------------------------------
  // Full Pipeline
  // -------------------------------------------------------------------

  async runFullPipeline(prompt: string, options?: PipelineOptions): Promise<PipelineResult> {
    const startTime = Date.now();
    const stages: PipelineStageResult[] = [];
    let stageStart: number;
    let stageCost: number;

    // Stage 1: Generate Requirements
    options?.onStageChange?.('requirements', 'Generating requirements from prompt');
    stageStart = Date.now();
    stageCost = this.totalCost;
    const requirements = await this.generateRequirements(prompt);
    stages.push({
      stage: 'requirements',
      success: requirements.length > 0,
      durationMs: Date.now() - stageStart,
      cost: this.totalCost - stageCost,
      details: `Generated ${requirements.length} requirements`,
    });

    // Stage 2: Generate Design
    options?.onStageChange?.('design', 'Generating technical design from requirements');
    stageStart = Date.now();
    stageCost = this.totalCost;
    const design = await this.generateDesign(requirements);
    stages.push({
      stage: 'design',
      success: design.architecture.length > 0,
      durationMs: Date.now() - stageStart,
      cost: this.totalCost - stageCost,
      details: `Generated design with ${design.components.length} components`,
    });

    // Stage 3: Generate Implementation Plan
    options?.onStageChange?.('plan', 'Generating implementation plan from design');
    stageStart = Date.now();
    stageCost = this.totalCost;
    const plan = await this.generatePlan(design);
    const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    stages.push({
      stage: 'plan',
      success: plan.phases.length > 0,
      durationMs: Date.now() - stageStart,
      cost: this.totalCost - stageCost,
      details: `Generated ${plan.phases.length} phases with ${totalTasks} tasks`,
    });

    // Build the spec
    const spec: Spec = {
      id: `spec-${randomUUID().substring(0, 8)}`,
      name: this.extractFeatureName(prompt),
      status: 'draft',
      requirements,
      design,
      implementationPlan: plan,
      verification: {
        acceptanceCriteriaMet: false,
        testsPass: false,
        codeReviewComplete: false,
        notes: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      requirementsHash: this.hashContent(JSON.stringify(requirements)),
      designHash: this.hashContent(JSON.stringify(design)),
      originalPrompt: prompt,
      currentPhaseIndex: 0,
      currentTaskIndex: 0,
    };

    // Save the draft spec
    await this.saveSpec(spec);

    // Stage 4: Approval
    options?.onStageChange?.('approval', 'Waiting for spec approval');
    stageStart = Date.now();
    stageCost = this.totalCost;

    if (options?.autoApprove) {
      spec.status = 'approved';
      spec.updatedAt = new Date();
      await this.saveSpec(spec);
    } else {
      // In non-auto mode, the user should call approveSpec() manually.
      // We save the draft and return with a partial result.
      stages.push({
        stage: 'approval',
        success: false,
        durationMs: Date.now() - stageStart,
        cost: this.totalCost - stageCost,
        details: 'Spec saved as draft - awaiting manual approval',
      });

      return {
        spec,
        executionResult: {
          success: false,
          phasesCompleted: 0,
          tasksCompleted: 0,
          tasksTotal: spec.implementationPlan.phases.reduce((sum, p) => sum + p.tasks.length, 0),
          errors: ['Spec not yet approved'],
          filesModified: [],
          durationMs: Date.now() - startTime,
        },
        verificationResult: {
          passed: false,
          criteriaResults: [],
          overallScore: 0,
          issues: ['Implementation not started - spec awaiting approval'],
          suggestions: ['Call approveSpec() to proceed with implementation'],
        },
        totalDurationMs: Date.now() - startTime,
        totalCost: this.totalCost,
        stages,
      };
    }

    stages.push({
      stage: 'approval',
      success: true,
      durationMs: Date.now() - stageStart,
      cost: this.totalCost - stageCost,
      details: 'Spec auto-approved',
    });

    // Stage 5: Implementation
    options?.onStageChange?.('implementation', 'Executing implementation plan');
    stageStart = Date.now();
    stageCost = this.totalCost;
    spec.status = 'implementing';
    spec.updatedAt = new Date();
    await this.saveSpec(spec);

    const executionResult = await this.executePlan(plan, {
      autoApprove: true,
      maxIterations: 3,
      onProgress: (phase, task, iteration) => {
        options?.onStageChange?.('implementation', `${phase} > ${task} (iteration ${iteration})`);
      },
      testAfterPhase: true,
    });
    stages.push({
      stage: 'implementation',
      success: executionResult.success,
      durationMs: Date.now() - stageStart,
      cost: this.totalCost - stageCost,
      details: `Completed ${executionResult.tasksCompleted}/${executionResult.tasksTotal} tasks`,
    });

    if (executionResult.success) {
      spec.status = 'complete';
    }
    spec.updatedAt = new Date();
    await this.saveSpec(spec);

    // Stage 6: Verification
    options?.onStageChange?.('verification', 'Verifying implementation against spec');
    stageStart = Date.now();
    stageCost = this.totalCost;
    const verificationResult = await this.verifyImplementation(spec);
    stages.push({
      stage: 'verification',
      success: verificationResult.passed,
      durationMs: Date.now() - stageStart,
      cost: this.totalCost - stageCost,
      details: `Score: ${verificationResult.overallScore}/100, ${verificationResult.issues.length} issues`,
    });

    // Update verification checklist
    spec.verification = {
      acceptanceCriteriaMet: verificationResult.passed,
      testsPass: verificationResult.criteriaResults.every(cr => cr.passed),
      codeReviewComplete: false,
      notes: verificationResult.suggestions,
    };
    spec.updatedAt = new Date();
    await this.saveSpec(spec);

    return {
      spec,
      executionResult,
      verificationResult,
      totalDurationMs: Date.now() - startTime,
      totalCost: this.totalCost,
      stages,
    };
  }

  // -------------------------------------------------------------------
  // Spec Management
  // -------------------------------------------------------------------

  async saveSpec(spec: Spec): Promise<void> {
    this.ensureSpecsDir();
    const filePath = this.getSpecFilePath(spec.id);
    const content = this.serializeSpecToMarkdown(spec);
    writeFileSync(filePath, content, 'utf-8');
  }

  async loadSpec(id: string): Promise<Spec> {
    const filePath = this.getSpecFilePath(id);
    if (!existsSync(filePath)) {
      throw new Error(`Spec not found: ${id}`);
    }
    const content = readFileSync(filePath, 'utf-8');
    return this.deserializeSpecFromMarkdown(content);
  }

  async listSpecs(): Promise<SpecSummary[]> {
    this.ensureSpecsDir();
    const summaries: SpecSummary[] = [];

    if (!existsSync(this.specsDir)) return summaries;

    const files = readdirSync(this.specsDir).filter(f => f.endsWith(SPEC_FILE_EXTENSION));

    for (const file of files) {
      try {
        const content = readFileSync(join(this.specsDir, file), 'utf-8');
        const spec = this.deserializeSpecFromMarkdown(content);
        const totalTasks = spec.implementationPlan.phases.reduce(
          (sum, p) => sum + p.tasks.length, 0
        );
        const completedTasks = spec.implementationPlan.phases.reduce(
          (sum, p) => sum + p.tasks.filter(t => t.completed).length, 0
        );

        summaries.push({
          id: spec.id,
          name: spec.name,
          status: spec.status,
          createdAt: spec.createdAt,
          updatedAt: spec.updatedAt,
          requirementCount: spec.requirements.length,
          completedTaskCount: completedTasks,
          totalTaskCount: totalTasks,
        });
      } catch {
        // Skip malformed spec files
      }
    }

    return summaries.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  async approveSpec(id: string): Promise<void> {
    const spec = await this.loadSpec(id);
    if (spec.status !== 'draft' && spec.status !== 'rejected') {
      throw new Error(`Cannot approve spec in "${spec.status}" status. Only draft or rejected specs can be approved.`);
    }
    spec.status = 'approved';
    spec.updatedAt = new Date();
    spec.rejectionReason = undefined;
    await this.saveSpec(spec);
  }

  async rejectSpec(id: string, reason: string): Promise<void> {
    const spec = await this.loadSpec(id);
    if (spec.status === 'complete') {
      throw new Error('Cannot reject a completed spec.');
    }
    spec.status = 'rejected';
    spec.rejectionReason = reason;
    spec.updatedAt = new Date();
    await this.saveSpec(spec);
  }

  async deleteSpec(id: string): Promise<void> {
    const filePath = this.getSpecFilePath(id);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  // -------------------------------------------------------------------
  // Acceptance Criteria Checking
  // -------------------------------------------------------------------

  async checkAcceptanceCriteria(spec: Spec): Promise<CriteriaCheckResult[]> {
    const results: CriteriaCheckResult[] = [];

    for (const req of spec.requirements) {
      for (let i = 0; i < req.acceptanceCriteria.length; i++) {
        const criteria = req.acceptanceCriteria[i];
        const checkResult = await this.checkSingleCriteria(req.id, i, criteria, spec);
        results.push(checkResult);
      }
    }

    return results;
  }

  private async checkSingleCriteria(
    requirementId: string,
    criteriaIndex: number,
    criteriaText: string,
    spec: Spec,
  ): Promise<CriteriaCheckResult> {
    // Gather relevant files from the spec's implementation plan
    const relevantFiles = this.gatherRelevantFiles(spec);

    const prompt = [
      `Check if the following acceptance criterion is met:`,
      ``,
      `Criterion: ${criteriaText}`,
      `Requirement ID: ${requirementId}`,
      ``,
      `Relevant project files:`,
      relevantFiles,
      ``,
      `Respond with a JSON object:`,
      `{ "passed": true/false, "evidence": "explanation of why it passed or failed" }`,
    ].join('\n');

    try {
      const response = await this.callLLM(
        'You are a QA verification assistant. Check if acceptance criteria are met by examining the codebase.',
        prompt
      );
      const parsed = this.parseJSON<{ passed: boolean; evidence: string }>(response);
      return {
        requirementId,
        criteriaIndex,
        criteriaText,
        passed: parsed.passed ?? false,
        evidence: parsed.evidence || 'No evidence provided',
      };
    } catch {
      return {
        requirementId,
        criteriaIndex,
        criteriaText,
        passed: false,
        evidence: 'Failed to verify automatically',
      };
    }
  }

  // -------------------------------------------------------------------
  // Spec vs Implementation Diff
  // -------------------------------------------------------------------

  async diffSpecVsImplementation(spec: Spec): Promise<SpecDiff> {
    // Collect all files mentioned in the spec's implementation plan
    const specFiles = new Set<string>();
    for (const phase of spec.implementationPlan.phases) {
      for (const task of phase.tasks) {
        if (task.files) {
          for (const f of task.files) {
            specFiles.add(f);
          }
        }
      }
    }

    // Also add files from design components
    for (const component of spec.design.components) {
      for (const iface of component.interfaces) {
        // Extract file-like paths from interface descriptions
        const fileMatch = iface.match(/[\w/.-]+\.\w+/g);
        if (fileMatch) {
          for (const f of fileMatch) {
            specFiles.add(f);
          }
        }
      }
    }

    const specFileArray = Array.from(specFiles);

    // Check which files actually exist in the project
    const actualFiles: string[] = [];
    const contentDiffs: FileDiff[] = [];
    let matchingCount = 0;

    for (const specFile of specFileArray) {
      const fullPath = join(this.projectRoot, specFile);
      if (existsSync(fullPath)) {
        actualFiles.push(specFile);

        // Read actual content and compare with spec expectations
        try {
          const actualContent = readFileSync(fullPath, 'utf-8');
          const specExpectation = this.getSpecExpectationForFile(spec, specFile);

          const diff = this.computeFileDiff(specExpectation, actualContent, specFile);
          contentDiffs.push(diff);
          if (diff.matches) matchingCount++;
        } catch {
          contentDiffs.push({
            file: specFile,
            specExpectation: 'Could not read spec expectation',
            actualContent: 'Could not read file',
            matches: false,
            differences: ['File exists but could not be read'],
          });
        }
      }
    }

    // Find extra files that exist but weren't in the spec
    const specFileSet = new Set(specFileArray.map(f => resolve(this.projectRoot, f)));
    const extraFiles = this.findProjectSourceFiles()
      .filter(f => !specFileSet.has(f));

    const missingFiles = specFileArray.filter(
      f => !existsSync(join(this.projectRoot, f))
    );

    const coveragePercentage = specFileArray.length > 0
      ? Math.round((actualFiles.length / specFileArray.length) * 100)
      : 100;

    return {
      specFiles: specFileArray,
      actualFiles,
      missingFiles,
      extraFiles,
      contentDiffs,
      coveragePercentage,
    };
  }

  // -------------------------------------------------------------------
  // Resume implementation from where we left off
  // -------------------------------------------------------------------

  async resumeImplementation(id: string, options?: ExecOptions): Promise<ExecutionResult> {
    const spec = await this.loadSpec(id);

    if (spec.status !== 'approved' && spec.status !== 'implementing') {
      throw new Error(`Cannot resume implementation for spec in "${spec.status}" status. Spec must be approved or already implementing.`);
    }

    spec.status = 'implementing';
    spec.updatedAt = new Date();
    await this.saveSpec(spec);

    // Find where we left off
    const phaseIndices: number[] = [];
    let startPhaseIndex = spec.currentPhaseIndex;

    for (let i = startPhaseIndex; i < spec.implementationPlan.phases.length; i++) {
      phaseIndices.push(i);
    }

    const result = await this.executePlan(spec.implementationPlan, {
      ...options,
      resume: true,
      phases: phaseIndices,
    });

    if (result.success) {
      spec.status = 'complete';
    }
    spec.updatedAt = new Date();
    await this.saveSpec(spec);

    return result;
  }

  // -------------------------------------------------------------------
  // Serialization: Spec -> Markdown with YAML frontmatter
  // -------------------------------------------------------------------

  private serializeSpecToMarkdown(spec: Spec): string {
    const frontmatter: Record<string, unknown> = {
      id: spec.id,
      name: spec.name,
      created: spec.createdAt.toISOString().split('T')[0],
      updated: spec.updatedAt.toISOString().split('T')[0],
      status: spec.status,
      requirements_hash: spec.requirementsHash,
      design_hash: spec.designHash,
      current_phase: spec.currentPhaseIndex,
      current_task: spec.currentTaskIndex,
    };

    if (spec.rejectionReason) {
      frontmatter.rejection_reason = spec.rejectionReason;
    }

    if (spec.originalPrompt) {
      frontmatter.original_prompt = spec.originalPrompt;
    }

    const yamlLines = Object.entries(frontmatter)
      .map(([key, value]) => {
        if (typeof value === 'string' && value.includes(':')) {
          return `${key}: "${value}"`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');

    const sections: string[] = [
      `---`,
      yamlLines,
      `---`,
      ``,
      `# Feature: ${spec.name}`,
      ``,
      `## Requirements`,
      ``,
    ];

    for (const req of spec.requirements) {
      sections.push(`### ${req.id}: ${req.title}`);
      sections.push(`- Priority: ${req.priority}`);
      sections.push(`- Status: ${req.status}`);
      sections.push(`- Description: ${req.description}`);
      sections.push(`- Acceptance Criteria:`);
      for (const ac of req.acceptanceCriteria) {
        sections.push(`  - [ ] ${ac}`);
      }
      sections.push('');
    }

    sections.push('## Design');
    sections.push('');
    sections.push('### Architecture');
    sections.push(spec.design.architecture);
    sections.push('');
    sections.push('### Components');
    for (const comp of spec.design.components) {
      sections.push(`- **${comp.name}**: ${comp.description}`);
      sections.push(`  - Responsibilities: ${comp.responsibilities.join(', ')}`);
      sections.push(`  - Interfaces: ${comp.interfaces.join(', ')}`);
      sections.push(`  - Dependencies: ${comp.dependencies.join(', ')}`);
    }
    sections.push('');
    sections.push('### Data Flow');
    sections.push(spec.design.dataFlow);
    sections.push('');
    sections.push('### API Design');
    for (const api of spec.design.apiDesign) {
      sections.push(`- ${api}`);
    }
    sections.push('');
    sections.push('### Error Handling');
    sections.push(spec.design.errorHandling);
    sections.push('');
    sections.push('## Implementation Plan');
    sections.push('');

    for (const phase of spec.implementationPlan.phases) {
      sections.push(`### Phase ${phase.order}: ${phase.name}`);
      for (const task of phase.tasks) {
        const check = task.completed ? 'x' : ' ';
        sections.push(`- [${check}] ${task.id}: ${task.description}`);
        if (task.files && task.files.length > 0) {
          sections.push(`  - Files: ${task.files.join(', ')}`);
        }
        if (task.verification) {
          sections.push(`  - Verification: ${task.verification}`);
        }
      }
      sections.push('');
    }

    sections.push(`**Estimated Effort**: ${spec.implementationPlan.estimatedEffort}`);
    sections.push('');

    if (spec.implementationPlan.dependencies.length > 0) {
      sections.push('### Dependencies');
      for (const dep of spec.implementationPlan.dependencies) {
        sections.push(`- ${dep}`);
      }
      sections.push('');
    }

    if (spec.implementationPlan.risks.length > 0) {
      sections.push('### Risks');
      for (const risk of spec.implementationPlan.risks) {
        sections.push(`- **${risk.id}**: ${risk.description}`);
        sections.push(`  - Likelihood: ${risk.likelihood}, Impact: ${risk.impact}`);
        sections.push(`  - Mitigation: ${risk.mitigation}`);
      }
      sections.push('');
    }

    sections.push('## Verification');
    sections.push('');
    sections.push(`- [${spec.verification.acceptanceCriteriaMet ? 'x' : ' '}] All acceptance criteria met`);
    sections.push(`- [${spec.verification.testsPass ? 'x' : ' '}] Tests pass`);
    sections.push(`- [${spec.verification.codeReviewComplete ? 'x' : ' '}] Code review complete`);

    if (spec.verification.notes.length > 0) {
      sections.push('');
      sections.push('### Notes');
      for (const note of spec.verification.notes) {
        sections.push(`- ${note}`);
      }
    }

    return sections.join('\n');
  }

  // -------------------------------------------------------------------
  // Deserialization: Markdown -> Spec
  // -------------------------------------------------------------------

  private deserializeSpecFromMarkdown(content: string): Spec {
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new Error('Invalid spec file: missing YAML frontmatter');
    }

    const yamlText = frontmatterMatch[1];
    const frontmatter = this.parseSimpleYAML(yamlText);

    // Parse requirements
    const requirements = this.parseRequirementsSection(content);

    // Parse design
    const design = this.parseDesignSection(content);

    // Parse implementation plan
    const implementationPlan = this.parseImplementationPlanSection(content);

    // Parse verification
    const verification = this.parseVerificationSection(content);

    return {
      id: (frontmatter.id as string) || `spec-${randomUUID().substring(0, 8)}`,
      name: (frontmatter.name as string) || 'Unnamed Spec',
      status: (frontmatter.status as Spec['status']) || 'draft',
      requirements,
      design,
      implementationPlan,
      verification,
      createdAt: frontmatter.created
        ? new Date(frontmatter.created as string)
        : new Date(),
      updatedAt: frontmatter.updated
        ? new Date(frontmatter.updated as string)
        : new Date(),
      requirementsHash: (frontmatter.requirements_hash as string) || this.hashContent(JSON.stringify(requirements)),
      designHash: (frontmatter.design_hash as string) || this.hashContent(JSON.stringify(design)),
      rejectionReason: frontmatter.rejection_reason as string | undefined,
      originalPrompt: frontmatter.original_prompt as string | undefined,
      currentPhaseIndex: typeof frontmatter.current_phase === 'number' ? frontmatter.current_phase : 0,
      currentTaskIndex: typeof frontmatter.current_task === 'number' ? frontmatter.current_task : 0,
    };
  }

  private parseSimpleYAML(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        let value: unknown = match[2].trim();

        // Remove surrounding quotes
        if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        // Parse booleans
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        // Parse numbers
        else if (typeof value === 'string' && /^\d+$/.test(value)) {
          value = parseInt(value, 10);
        }

        result[key] = value;
      }
    }

    return result;
  }

  private parseRequirementsSection(content: string): Requirement[] {
    const requirements: Requirement[] = [];
    const reqRegex = /### (FR-\d+): (.+)(?:\n(?!###)[\s\S]*?)(?=\n### |$)/g;
    let match;

    while ((match = reqRegex.exec(content)) !== null) {
      const id = match[1];
      const title = match[2];
      const block = match[0];

      const priorityMatch = block.match(/Priority:\s*(must|should|could)/);
      const statusMatch = block.match(/Status:\s*(pending|implemented|verified|failed)/);
      const descMatch = block.match(/Description:\s*(.+)/);

      const criteriaLines: string[] = [];
      const criteriaRegex = /- \[ \] (.+)/g;
      let criteriaMatch;
      while ((criteriaMatch = criteriaRegex.exec(block)) !== null) {
        criteriaLines.push(criteriaMatch[1]);
      }

      requirements.push({
        id,
        title,
        description: descMatch ? descMatch[1] : '',
        priority: (priorityMatch?.[1] as Requirement['priority']) || 'should',
        acceptanceCriteria: criteriaLines,
        status: (statusMatch?.[1] as Requirement['status']) || 'pending',
      });
    }

    return requirements;
  }

  private parseDesignSection(content: string): DesignDoc {
    const designMatch = content.match(/## Design\s*\n([\s\S]*?)(?=\n## (?:Implementation|Verification))/);
    const block = designMatch ? designMatch[1] : '';

    // Architecture
    const archMatch = block.match(/### Architecture\s*\n([\s\S]*?)(?=\n###|$)/);
    const architecture = archMatch ? archMatch[1].trim() : '';

    // Components
    const components: Component[] = [];
    const compRegex = /\*\*(.+?)\*\*:\s*(.+)/g;
    const compBlock = block.match(/### Components([\s\S]*?)(?=\n###|$)/);
    if (compBlock) {
      let compMatch;
      while ((compMatch = compRegex.exec(compBlock[1])) !== null) {
        const compLines = compBlock[1].substring(compMatch.index);
        const nextCompIdx = compLines.indexOf('\n- **', 1);
        const compSection = nextCompIdx > 0 ? compLines.substring(0, nextCompIdx) : compLines;

        const respMatch = compSection.match(/Responsibilities:\s*(.+)/);
        const ifaceMatch = compSection.match(/Interfaces:\s*(.+)/);
        const depMatch = compSection.match(/Dependencies:\s*(.+)/);

        components.push({
          name: compMatch[1],
          description: compMatch[2].trim(),
          responsibilities: respMatch ? respMatch[1].split(',').map(s => s.trim()) : [],
          interfaces: ifaceMatch ? ifaceMatch[1].split(',').map(s => s.trim()) : [],
          dependencies: depMatch ? depMatch[1].split(',').map(s => s.trim()) : [],
        });
      }
    }

    // Data Flow
    const dataFlowMatch = block.match(/### Data Flow\s*\n([\s\S]*?)(?=\n###|$)/);
    const dataFlow = dataFlowMatch ? dataFlowMatch[1].trim() : '';

    // API Design
    const apiMatch = block.match(/### API Design([\s\S]*?)(?=\n###|$)/);
    const apiDesign: string[] = [];
    if (apiMatch) {
      const apiLineRegex = /- (.+)/g;
      let apiLineMatch;
      while ((apiLineMatch = apiLineRegex.exec(apiMatch[1])) !== null) {
        apiDesign.push(apiLineMatch[1]);
      }
    }

    // Error Handling
    const errorMatch = block.match(/### Error Handling\s*\n([\s\S]*?)(?=\n###|$)/);
    const errorHandling = errorMatch ? errorMatch[1].trim() : '';

    return {
      architecture,
      components,
      dataFlow,
      apiDesign,
      errorHandling,
    };
  }

  private parseImplementationPlanSection(content: string): ImplementationPlan {
    const planMatch = content.match(/## Implementation Plan\s*\n([\s\S]*?)(?=\n## Verification|$)/);
    const block = planMatch ? planMatch[1] : '';

    const phases: Phase[] = [];
    const phaseRegex = /### Phase (\d+): (.+)([\s\S]*?)(?=\n### Phase|$)/g;
    let phaseMatch;

    while ((phaseMatch = phaseRegex.exec(block)) !== null) {
      const order = parseInt(phaseMatch[1], 10);
      const name = phaseMatch[2].trim();
      const phaseBlock = phaseMatch[3];

      const tasks: Task[] = [];
      const taskRegex = /- \[([ x])\] (T-[\d-]+): (.+)/g;
      let taskMatch;
      while ((taskMatch = taskRegex.exec(phaseBlock)) !== null) {
        const completed = taskMatch[1] === 'x';
        const taskId = taskMatch[2];
        const taskDesc = taskMatch[3];

        // Extract files and verification from subsequent lines
        const taskBlockStart = phaseBlock.indexOf(taskMatch[0]);
        const nextTaskIdx = phaseBlock.indexOf('\n- [', taskBlockStart + 1);
        const taskSection = nextTaskIdx > 0
          ? phaseBlock.substring(taskBlockStart, nextTaskIdx)
          : phaseBlock.substring(taskBlockStart);

        const filesMatch = taskSection.match(/Files:\s*(.+)/);
        const verifMatch = taskSection.match(/Verification:\s*(.+)/);

        tasks.push({
          id: taskId,
          description: taskDesc,
          completed,
          files: filesMatch ? filesMatch[1].split(',').map(s => s.trim()) : undefined,
          verification: verifMatch ? verifMatch[1].trim() : undefined,
        });
      }

      phases.push({ name, tasks, order });
    }

    // Estimated effort
    const effortMatch = block.match(/\*\*Estimated Effort\*\*:\s*(.+)/);
    const estimatedEffort = effortMatch ? effortMatch[1].trim() : 'Unknown';

    // Dependencies
    const depMatch = block.match(/### Dependencies([\s\S]*?)(?=\n###|$)/);
    const dependencies: string[] = [];
    if (depMatch) {
      const depLineRegex = /- (.+)/g;
      let depLineMatch;
      while ((depLineMatch = depLineRegex.exec(depMatch[1])) !== null) {
        dependencies.push(depLineMatch[1]);
      }
    }

    // Risks
    const risks: Risk[] = [];
    const riskMatch = block.match(/### Risks([\s\S]*?)(?=\n###|$)/);
    if (riskMatch) {
      const riskRegex = /\*\*(R-\d+)\*\*:\s*(.+)\n\s+Likelihood:\s*(low|medium|high),\s*Impact:\s*(low|medium|high)\n\s+Mitigation:\s*(.+)/g;
      let riskLineMatch;
      while ((riskLineMatch = riskRegex.exec(riskMatch[1])) !== null) {
        risks.push({
          id: riskLineMatch[1],
          description: riskLineMatch[2].trim(),
          likelihood: riskLineMatch[3] as Risk['likelihood'],
          impact: riskLineMatch[4] as Risk['impact'],
          mitigation: riskLineMatch[5].trim(),
        });
      }
    }

    return {
      phases,
      estimatedEffort,
      dependencies,
      risks,
    };
  }

  private parseVerificationSection(content: string): VerificationChecklist {
    const verMatch = content.match(/## Verification\s*\n([\s\S]*?)$/);
    if (!verMatch) {
      return {
        acceptanceCriteriaMet: false,
        testsPass: false,
        codeReviewComplete: false,
        notes: [],
      };
    }

    const block = verMatch[1];

    const criteriaMetMatch = block.match(/- \[([ x])\] All acceptance criteria met/);
    const testsMatch = block.match(/- \[([ x])\] Tests pass/);
    const reviewMatch = block.match(/- \[([ x])\] Code review complete/);

    const notes: string[] = [];
    const noteRegex = /- (.+)/g;
    let noteMatch;
    while ((noteMatch = noteRegex.exec(block)) !== null) {
      // Skip the main checklist items
      if (!noteMatch[1].includes('acceptance criteria') &&
          !noteMatch[1].includes('Tests pass') &&
          !noteMatch[1].includes('Code review')) {
        notes.push(noteMatch[1]);
      }
    }

    return {
      acceptanceCriteriaMet: criteriaMetMatch?.[1] === 'x',
      testsPass: testsMatch?.[1] === 'x',
      codeReviewComplete: reviewMatch?.[1] === 'x',
      notes,
    };
  }

  // -------------------------------------------------------------------
  // Helper methods
  // -------------------------------------------------------------------

  private getSpecFilePath(id: string): string {
    // Sanitize id for use as filename
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '_');
    return join(this.specsDir, `${safeId}${SPEC_FILE_EXTENSION}`);
  }

  private extractFeatureName(prompt: string): string {
    // Try to extract a meaningful name from the prompt
    const trimmed = prompt.trim();

    // Common patterns: "Add X", "Implement X", "Create X", "Build X"
    const actionMatch = trimmed.match(/^(?:add|implement|create|build|develop|make|write)\s+(?:a\s+|an\s+)?(.+?)(?:\s*(?:\.|that|which|for|to|with|using))$/i);
    if (actionMatch) {
      return this.toTitleCase(actionMatch[1].trim());
    }

    // Take the first sentence or first N characters
    const firstSentence = trimmed.split(/[.!?]/)[0].trim();
    if (firstSentence.length <= 60) {
      return this.toTitleCase(firstSentence);
    }

    return this.toTitleCase(trimmed.substring(0, 50).trim() + '...');
  }

  private toTitleCase(text: string): string {
    return text
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectModifiedFiles(expectedFiles?: string[]): string[] {
    // Try to detect which files were actually modified using git
    const modified: string[] = [];

    try {
      const gitOutput = execSync('git diff --name-only HEAD 2>/dev/null', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (gitOutput) {
        modified.push(...gitOutput.split('\n').filter(f => f.length > 0));
      }

      // Also check untracked files
      const untrackedOutput = execSync('git ls-files --others --exclude-standard 2>/dev/null', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (untrackedOutput) {
        modified.push(...untrackedOutput.split('\n').filter(f => f.length > 0));
      }
    } catch {
      // Git not available; fall back to expected files
      if (expectedFiles) {
        modified.push(...expectedFiles.filter(f => existsSync(join(this.projectRoot, f))));
      }
    }

    return Array.from(new Set(modified));
  }

  private gatherProjectState(spec: Spec): string {
    const parts: string[] = [];

    // List files mentioned in the spec that exist
    const specFiles = new Set<string>();
    for (const phase of spec.implementationPlan.phases) {
      for (const task of phase.tasks) {
        if (task.files) {
          for (const f of task.files) {
            specFiles.add(f);
          }
        }
      }
    }

    for (const filePath of Array.from(specFiles)) {
      const fullPath = join(this.projectRoot, filePath);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.size < 50000) {
            const content = readFileSync(fullPath, 'utf-8');
            parts.push(`--- ${filePath} ---\n${content.substring(0, 2000)}${content.length > 2000 ? '\n... (truncated)' : ''}`);
          } else {
            parts.push(`--- ${filePath} --- (file too large: ${stat.size} bytes)`);
          }
        } catch {
          parts.push(`--- ${filePath} --- (could not read)`);
        }
      } else {
        parts.push(`--- ${filePath} --- (does not exist)`);
      }
    }

    // Also include a file tree of the project
    try {
      const treeOutput = execSync('find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | head -100', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      parts.push(`\n--- Project File Tree ---\n${treeOutput}`);
    } catch {
      // Tree not available
    }

    return parts.join('\n\n');
  }

  private gatherRelevantFiles(spec: Spec): string {
    const parts: string[] = [];

    for (const phase of spec.implementationPlan.phases) {
      for (const task of phase.tasks) {
        if (task.files) {
          for (const filePath of task.files) {
            const fullPath = join(this.projectRoot, filePath);
            if (existsSync(fullPath)) {
              try {
                const content = readFileSync(fullPath, 'utf-8');
                parts.push(`--- ${filePath} ---\n${content.substring(0, 1000)}`);
              } catch {
                parts.push(`--- ${filePath} --- (unreadable)`);
              }
            }
          }
        }
      }
    }

    return parts.join('\n\n') || 'No relevant files found';
  }

  private getSpecExpectationForFile(spec: Spec, filePath: string): string {
    const parts: string[] = [];

    // Find all tasks that mention this file
    for (const phase of spec.implementationPlan.phases) {
      for (const task of phase.tasks) {
        if (task.files?.includes(filePath)) {
          parts.push(`Task ${task.id}: ${task.description}`);
          if (task.verification) {
            parts.push(`  Verification: ${task.verification}`);
          }
        }
      }
    }

    // Find component descriptions that might relate to this file
    for (const component of spec.design.components) {
      const ifaceMatch = component.interfaces.some(iface => iface.includes(filePath));
      if (ifaceMatch) {
        parts.push(`Component ${component.name}: ${component.description}`);
        parts.push(`  Responsibilities: ${component.responsibilities.join('; ')}`);
      }
    }

    return parts.join('\n') || `File ${filePath} was mentioned in the implementation plan`;
  }

  private computeFileDiff(specExpectation: string, actualContent: string, filePath: string): FileDiff {
    const differences: string[] = [];

    // Simple heuristic: check if key terms from the spec appear in the actual content
    const keyTerms = specExpectation
      .split(/[\s,;:]+/)
      .filter(term => term.length > 4)
      .map(term => term.toLowerCase());

    const contentLower = actualContent.toLowerCase();
    const matchedTerms = keyTerms.filter(term => contentLower.includes(term));
    const matchRatio = keyTerms.length > 0 ? matchedTerms.length / keyTerms.length : 0;

    if (matchRatio < 0.3) {
      differences.push(`Low keyword overlap between spec expectations and actual content (${Math.round(matchRatio * 100)}%)`);
    }

    // Check for common structural elements
    if (specExpectation.includes('class') && !actualContent.includes('class ')) {
      differences.push('Spec expects a class definition but none found');
    }
    if (specExpectation.includes('interface') && !actualContent.includes('interface ')) {
      differences.push('Spec expects an interface definition but none found');
    }
    if (specExpectation.includes('function') && !actualContent.includes('function ') && !actualContent.includes('=>')) {
      differences.push('Spec expects function definitions but none found');
    }

    // Check for export statements (module should export something)
    if (specExpectation.includes('export') && !actualContent.includes('export ')) {
      differences.push('Spec expects exports but none found');
    }

    const matches = differences.length === 0 && actualContent.length > 0;

    return {
      file: filePath,
      specExpectation,
      actualContent: actualContent.substring(0, 500) + (actualContent.length > 500 ? '...' : ''),
      matches,
      differences,
    };
  }

  private findProjectSourceFiles(): string[] {
    const files: string[] = [];

    try {
      const output = execSync(
        'find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" 2>/dev/null | head -200',
        {
          cwd: this.projectRoot,
          encoding: 'utf-8',
          timeout: 10000,
        }
      ).trim();

      if (output) {
        files.push(...output.split('\n').filter(f => f.length > 0).map(f => resolve(this.projectRoot, f)));
      }
    } catch {
      // find not available or failed
    }

    return files;
  }

  private runProjectTests(): { passed: boolean; output: string } {
    try {
      const output = execSync('npm test 2>&1', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 60000,
      });
      return { passed: true, output: output.substring(0, 500) };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = (error.stdout || error.stderr || error.message || '').toString();
      return { passed: false, output: output.substring(0, 500) };
    }
  }

  // -------------------------------------------------------------------
  // Utility getters
  // -------------------------------------------------------------------

  /** Get the total cost accumulated by this pipeline instance */
  getTotalCost(): number {
    return this.totalCost;
  }

  /** Get the specs directory path */
  getSpecsDir(): string {
    return this.specsDir;
  }
}

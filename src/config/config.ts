// ============================================================
// NeuroCLI - Configuration System
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { NeuroConfig } from '../core/types.js';

const CONFIG_DIR = join(homedir(), '.neuro');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export const DEFAULT_CONFIG: NeuroConfig = {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'qwen/qwen3-coder:free',
  agents: {
    planner: {
      name: 'Planner',
      description: 'Task decomposition and planning specialist',
      systemPrompt: `You are an expert software architect and planner. Your job is to break down complex tasks into clear, actionable steps. For each step, specify which agent should handle it and what tools they should use. Be thorough but concise.`,
      model: 'qwen/qwen3-coder:free',
      temperature: 0.7,
      maxTokens: 4096,
      tools: ['read_file', 'search_files', 'list_directory'],
      maxIterations: 10,
    },
    coder: {
      name: 'Coder',
      description: 'Code generation and modification specialist',
      systemPrompt: `You are an expert software developer. You write clean, efficient, well-documented code. You understand design patterns, best practices, and can work with any programming language or framework. When modifying existing code, you make minimal, targeted changes. Always consider edge cases and error handling.`,
      model: 'qwen/qwen3-coder:free',
      temperature: 0.4,
      maxTokens: 16384,
      tools: ['read_file', 'write_file', 'edit_file', 'search_files', 'list_directory', 'run_command', 'apply_diff'],
      maxIterations: 50,
    },
    reviewer: {
      name: 'Reviewer',
      description: 'Code review and quality assurance specialist',
      systemPrompt: `You are an expert code reviewer. You analyze code for bugs, security vulnerabilities, performance issues, and adherence to best practices. You provide specific, actionable feedback with line references. You categorize issues by severity (critical, warning, suggestion). You also check for test coverage and documentation.`,
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      temperature: 0.3,
      maxTokens: 8192,
      tools: ['read_file', 'search_files', 'list_directory'],
      maxIterations: 15,
    },
    researcher: {
      name: 'Researcher',
      description: 'Information gathering and analysis specialist',
      systemPrompt: `You are an expert researcher and analyst. You gather information from files, web resources, and codebases. You synthesize findings into clear, structured reports. You can explain complex technical concepts and find relevant examples or documentation.`,
      model: 'google/gemma-4-31b-it:free',
      temperature: 0.5,
      maxTokens: 8192,
      tools: ['read_file', 'search_files', 'list_directory', 'web_search', 'web_fetch'],
      maxIterations: 20,
    },
    tester: {
      name: 'Tester',
      description: 'Test generation and execution specialist',
      systemPrompt: `You are an expert QA engineer. You write comprehensive test suites covering unit tests, integration tests, and edge cases. You run tests and analyze failures to identify root causes. You ensure code meets quality standards before it's considered complete.`,
      model: 'qwen/qwen3-coder:free',
      temperature: 0.3,
      maxTokens: 8192,
      tools: ['read_file', 'write_file', 'search_files', 'run_command', 'list_directory'],
      maxIterations: 25,
    },
    debugger: {
      name: 'Debugger',
      description: 'Bug investigation and fixing specialist',
      systemPrompt: `You are an expert debugger. You systematically investigate bugs by reading code, running diagnostic commands, analyzing error messages and stack traces. You identify root causes and implement targeted fixes. You verify fixes work before reporting completion.`,
      model: 'qwen/qwen3-coder:free',
      temperature: 0.2,
      maxTokens: 8192,
      tools: ['read_file', 'edit_file', 'search_files', 'run_command', 'list_directory', 'apply_diff'],
      maxIterations: 20,
    },
    architect: {
      name: 'Architect',
      description: 'System design and architecture specialist',
      systemPrompt: `You are an expert software architect. You design scalable, maintainable system architectures. You make technology stack decisions, define component boundaries, and establish coding standards. You create detailed technical specifications that other agents can implement.`,
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      temperature: 0.7,
      maxTokens: 8192,
      tools: ['read_file', 'search_files', 'list_directory'],
      maxIterations: 15,
    },
    devops: {
      name: 'DevOps',
      description: 'Deployment and infrastructure specialist',
      systemPrompt: `You are an expert DevOps engineer. You handle CI/CD pipelines, Docker configurations, cloud deployments, and infrastructure as code. You optimize build processes and ensure reliable deployments.`,
      model: 'cohere/north-mini-code:free',
      temperature: 0.3,
      maxTokens: 8192,
      tools: ['read_file', 'write_file', 'edit_file', 'run_command', 'search_files', 'list_directory'],
      maxIterations: 25,
    },
  },
  tools: {
    autoApprove: ['read_file', 'search_files', 'list_directory', 'web_search'],
    requireApproval: ['write_file', 'edit_file', 'apply_diff', 'run_command', 'delete_file'],
    denied: [],
  },
  context: {
    maxTokens: 180000,
    systemPromptRatio: 0.15,
  },
  session: {
    autoSave: true,
    maxHistory: 100,
  },
  ui: {
    theme: 'claude',
    showTokenCount: true,
    showCost: true,
    streaming: true,
    syntaxHighlight: true,
  },
  permissionMode: 'auto' as const,
  fallbackChain: {
    models: ['qwen/qwen3-coder:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'cohere/north-mini-code:free'],
    maxRetries: 2,
    retryDelayMs: 3000,
  },
  doomLoop: {
    maxConsecutiveErrors: 3,
    maxRepetitiveActions: 3,
    similarityThreshold: 0.7,
    autoBreak: true,
  },
  mcp: {
    servers: {},
    autoConnect: true,
  },
  diffPreview: true,
  sandbox: {
    enabled: false,
    rootDir: process.cwd(),
    allowedDirs: [],
    deniedDirs: ['node_modules', '.git', '__pycache__', '.env'],
    deniedPatterns: ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/credentials.json'],
    allowCommands: true,
    allowedCommands: [],
    deniedCommands: ['rm -rf /', 'sudo rm', 'mkfs', 'dd if='],
    backupOnModify: true,
    backupDir: '.neuro/backups',
    maxFileSize: 10 * 1024 * 1024,
    allowNetwork: true,
    allowEnvAccess: false,
    readOnly: false,
  },
  spendingLimit: 0,
  promptCache: {
    enabled: false,
    cacheDir: join(homedir(), '.neuro', 'cache'),
    maxEntries: 100,
    ttlMs: 3600000,
    similarityThreshold: 0.9,
  },
  customAgents: {},
  // P2/P3 new config sections
  telemetry: {
    enabled: false,
    trackModelPerformance: true,
    trackToolUsage: true,
    trackSessionMetrics: true,
    retentionDays: 90,
  },
  vimMode: {
    enabled: false,
    showModeIndicator: true,
    bellOnError: true,
  },
  i18n: {
    locale: 'en',
    fallbackLocale: 'en',
    autoDetect: true,
  },
  multimodal: {
    enabled: true,
    maxImageSize: 20 * 1024 * 1024,
    autoDetectImages: true,
  },
  voice: {
    enabled: false,
    ttsEngine: 'auto',
    sttEngine: 'auto',
    autoSpeak: false,
    language: 'en',
  },
  apiServer: {
    enabled: false,
    host: '127.0.0.1',
    port: 3141,
    requireAuth: true,
    enableWebSocket: true,
  },
  cloudSync: {
    enabled: false,
    backend: 'gist',
    autoSync: false,
    includeContent: true,
  },
  dashboard: {
    enabled: false,
    host: '127.0.0.1',
    port: 3142,
    autoOpen: true,
    refreshInterval: 5000,
  },
  // v4.0 new configs
  autoMode: {
    enabled: false,
    safetyLevel: 'conservative',
    maxIterations: 50,
    maxCost: 0,
    maxTimeMs: 0,
    blockedCommands: ['rm -rf /', 'mkfs', 'dd if=/dev/zero'],
    blockedPatterns: ['/etc/passwd', '/etc/shadow'],
    autoCommit: false,
    autoTest: false,
    pauseOnError: true,
  },
  scheduledTasks: {
    enabled: true,
    maxConcurrent: 5,
    defaultIntervalUnit: 'hours',
    persistTasks: true,
    tasksDir: '',
  },
  linting: {
    enabled: true,
    autoRunOnChange: false,
    autoFix: false,
    failOnError: false,
    timeout: 30000,
    excludePatterns: ['node_modules', '.git', 'dist'],
  },
  testing: {
    enabled: true,
    autoRunOnChange: false,
    runOnSave: false,
    coverageThreshold: 80,
    timeout: 60000,
    relatedTestsOnly: false,
  },
  codeReview: {
    enabled: true,
    autoReviewOnChange: false,
    focusAreas: ['security', 'performance', 'correctness', 'style'],
    severityThreshold: 'minor',
    excludePatterns: ['node_modules', '.git', 'dist'],
  },
  securityScanner: {
    enabled: true,
    autoScanOnChange: false,
    failOnSeverity: 'high',
    excludePatterns: ['node_modules', '.git', 'dist', 'coverage'],
    customRules: [],
  },
};

export function loadConfig(): NeuroConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...saved };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: NeuroConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getProjectConfigPath(): string {
  return join(process.cwd(), '.neuro.json');
}

export function loadProjectConfig(): Partial<NeuroConfig> | null {
  const projectConfigPath = getProjectConfigPath();
  if (existsSync(projectConfigPath)) {
    try {
      const data = readFileSync(projectConfigPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

export function initConfig(apiKey?: string): NeuroConfig {
  const config = loadConfig();
  if (apiKey) {
    config.apiKey = apiKey;
  }
  if (!config.apiKey) {
    const envKey = process.env.OPENROUTER_API_KEY;
    if (envKey) {
      config.apiKey = envKey;
    }
  }
  // Merge project-level config
  const projectConfig = loadProjectConfig();
  if (projectConfig) {
    Object.assign(config, projectConfig);
  }
  return config;
}

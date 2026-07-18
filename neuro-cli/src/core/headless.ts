// ============================================================
// NeuroCLI - Headless/CI Mode
// Non-interactive execution for automation pipelines
// ============================================================

import { NeuroEngine } from './engine.js';
import { initConfig } from '../config/config.js';
import { NeuroConfig } from './types.js';

export interface HeadlessOptions {
  prompt: string;
  model?: string;
  agent?: string;
  maxTurns?: number;        // max agent iterations (default: 30)
  allowedTools?: string[];  // only allow these tools (default: all)
  deniedTools?: string[];   // deny these tools
  outputFormat?: 'text' | 'json' | 'stream-json';
  autoApprove?: boolean;    // auto-approve all tool calls (default: true in headless)
  workingDirectory?: string;
  continueSession?: string; // session ID to continue
}

export interface HeadlessResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  exitCode: number;       // 0 = success, 1 = error, 2 = max turns reached
  sessionId: string;
  duration: number;       // ms
  toolCallsCount: number;
}

export class HeadlessMode {
  /**
   * Run a single headless task and return structured result
   */
  static async run(options: HeadlessOptions): Promise<HeadlessResult> {
    const startTime = Date.now();
    const maxTurns = options.maxTurns || 30;

    // Initialize config
    const config = initConfig();
    if (options.model) config.defaultModel = options.model;
    if (options.autoApprove !== false) {
      config.tools.autoApprove = [
        ...config.tools.autoApprove,
        ...config.tools.requireApproval,
      ];
      config.tools.requireApproval = [];
    }

    // Override working directory
    if (options.workingDirectory) {
      process.chdir(options.workingDirectory);
    }

    // Configure tool restrictions
    if (options.allowedTools && options.allowedTools.length > 0) {
      const denied = Object.keys(config.tools).filter(
        t => !options.allowedTools!.includes(t)
      );
      config.tools.denied = denied;
    }
    if (options.deniedTools) {
      config.tools.denied = [...config.tools.denied, ...options.deniedTools];
    }

    try {
      const engine = new NeuroEngine(config);

      // Continue existing session if specified
      if (options.continueSession) {
        engine.sessionManager.load(options.continueSession);
      }

      // Track iterations
      let iterations = 0;
      let toolCallsCount = 0;

      const callbacks = {
        onToolCall: () => { toolCallsCount++; },
        onIteration: (i: number) => {
          iterations = i;
          if (i >= maxTurns) {
            throw new Error(`MAX_TURNS_REACHED: ${maxTurns}`);
          }
        },
      };

      const result = await engine.processMessage(
        options.prompt,
        options.agent ? 'direct' : 'auto',
        options.agent || 'Coder',
      );

      const duration = Date.now() - startTime;

      // Format output
      const headlessResult: HeadlessResult = {
        content: result.content,
        model: config.defaultModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cost: result.usage.cost,
        exitCode: 0,
        sessionId: engine.sessionManager.getCurrent()?.id || '',
        duration,
        toolCallsCount,
      };

      // Output based on format
      if (options.outputFormat === 'json') {
        console.log(JSON.stringify(headlessResult, null, 2));
      } else if (options.outputFormat === 'stream-json') {
        // Stream JSON events (for CI integration)
        console.log(JSON.stringify({ type: 'result', ...headlessResult }));
      }
      // text format: just the content (already printed by engine)

      return headlessResult;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isMaxTurns = errMsg.includes('MAX_TURNS_REACHED');

      const headlessResult: HeadlessResult = {
        content: isMaxTurns ? 'Max turns reached' : errMsg,
        model: config.defaultModel,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        exitCode: isMaxTurns ? 2 : 1,
        sessionId: '',
        duration: Date.now() - startTime,
        toolCallsCount: 0,
      };

      if (options.outputFormat === 'json') {
        console.log(JSON.stringify(headlessResult, null, 2));
      }

      return headlessResult;
    }
  }
}

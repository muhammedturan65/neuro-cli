// ============================================================
// NeuroCLI - GAP-37: Auto-Compact with Model-Aware Context Management
// Automatic context compaction that adapts to model context windows
// ============================================================

import { Message } from './types.js';
import { MODELS } from '../api/models.js';
import { ContextCompactor, CompactionResult } from '../context/compaction.js';
import { ContextManager } from './context.js';

// ---- Token Estimation ----

const CJK_RANGES = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

function estimateTokensForText(text: string): number {
  const cjkMatches = text.match(CJK_RANGES);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 2 + otherCount / 4);
}

// ---- Interfaces ----

export interface AutoCompactConfig {
  enabled: boolean;
  warningThreshold: number; // 0-1, default 0.7
  compactThreshold: number; // 0-1, default 0.85
  emergencyThreshold: number; // 0-1, default 0.95
  preserveRecentCount: number; // always keep last N messages
  preserveSystemPrompt: boolean;
  compactStrategy: 'summarize' | 'drop-oldest' | 'hybrid';
  tokenBudget: {
    systemPrompt: number; // max tokens for system prompt
    conversation: number; // max tokens for conversation
    tools: number; // max tokens for tool definitions
    output: number; // reserved tokens for output
  };
}

export interface ContextUsage {
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
  breakdown: {
    systemPrompt: number;
    conversation: number;
    tools: number;
    available: number;
  };
  level: 'normal' | 'warning' | 'compact' | 'emergency';
}

export interface AutoCompactResult {
  messages: Message[];
  usage: ContextUsage;
  strategy: AutoCompactConfig['compactStrategy'];
  tokensSaved: number;
  level: ContextUsage['level'];
}

// ---- Default Config ----

export const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig = {
  enabled: true,
  warningThreshold: 0.7,
  compactThreshold: 0.85,
  emergencyThreshold: 0.95,
  preserveRecentCount: 6,
  preserveSystemPrompt: true,
  compactStrategy: 'hybrid',
  tokenBudget: {
    systemPrompt: 0.15, // 15% of context window
    conversation: 0.45, // 45% of context window
    tools: 0.10,        // 10% of context window
    output: 0.30,       // 30% of context window (reserved for output)
  },
};

// ---- Fallback Context Window ----

const DEFAULT_CONTEXT_WINDOW = 128000;

// ---- AutoCompactManager ----

type LevelCallback = (usage: ContextUsage) => void;
type CompactCallback = (usage: ContextUsage, result: Message[]) => void;

export class AutoCompactManager {
  private config: AutoCompactConfig;
  private currentModelId: string;
  private contextManager: ContextManager | null = null;
  private compactor: ContextCompactor | null = null;

  // Callbacks
  private warningCallbacks: LevelCallback[] = [];
  private compactCallbacks: CompactCallback[] = [];
  private emergencyCallbacks: LevelCallback[] = [];

  // Track last level to avoid duplicate callbacks
  private lastLevel: ContextUsage['level'] = 'normal';

  constructor(config: Partial<AutoCompactConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_COMPACT_CONFIG, ...config };
    // Deep merge tokenBudget
    if (config.tokenBudget) {
      this.config.tokenBudget = {
        ...DEFAULT_AUTO_COMPACT_CONFIG.tokenBudget,
        ...config.tokenBudget,
      };
    }
    this.currentModelId = '';
  }

  /**
   * Update the current model and recalculate model-aware thresholds.
   * Rebuilds ContextManager and ContextCompactor for the new model.
   */
  setModel(modelId: string): void {
    this.currentModelId = modelId;
    const model = MODELS[modelId];
    const contextWindow = model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

    this.contextManager = new ContextManager(modelId, contextWindow);

    // ContextCompactor requires a ContextManager and an OpenRouterClient.
    // We keep a null reference because we implement our own compaction logic
    // that delegates to the ContextManager's token counting and summarization,
    // falling back to the compactor only when available.
    this.compactor = null;
  }

  /**
   * Set the ContextCompactor for LLM-backed summarization.
   * This is optional — without it, auto-compact uses local strategies only.
   */
  setCompactor(compactor: ContextCompactor): void {
    this.compactor = compactor;
  }

  // ---- Monitoring ----

  /**
   * Compute detailed context usage breakdown for the given messages and model.
   */
  getContextUsage(messages: Message[], modelId: string): ContextUsage {
    const model = MODELS[modelId];
    const maxTokens = model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

    // Calculate token counts per category
    let systemPromptTokens = 0;
    let conversationTokens = 0;
    let toolsTokens = 0;

    for (const msg of messages) {
      const msgTokens = this.estimateMessageTokens(msg);

      if (msg.role === 'system') {
        systemPromptTokens += msgTokens;
      } else if (msg.role === 'tool') {
        toolsTokens += msgTokens;
      } else {
        conversationTokens += msgTokens;
      }

      // Tool calls on assistant messages count toward tools budget
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          toolsTokens += estimateTokensForText(tc.function.name + tc.function.arguments);
        }
      }
    }

    const totalTokens = systemPromptTokens + conversationTokens + toolsTokens;
    const outputReserve = Math.floor(maxTokens * this.config.tokenBudget.output);
    const availableTokens = Math.max(0, maxTokens - totalTokens - outputReserve);
    const usagePercent = totalTokens / maxTokens;

    let level: ContextUsage['level'] = 'normal';
    if (usagePercent >= this.config.emergencyThreshold) {
      level = 'emergency';
    } else if (usagePercent >= this.config.compactThreshold) {
      level = 'compact';
    } else if (usagePercent >= this.config.warningThreshold) {
      level = 'warning';
    }

    return {
      totalTokens,
      maxTokens,
      usagePercent,
      breakdown: {
        systemPrompt: systemPromptTokens,
        conversation: conversationTokens,
        tools: toolsTokens,
        available: availableTokens,
      },
      level,
    };
  }

  /**
   * Determine whether compaction is needed and at what level.
   * Fires callbacks when the level transitions.
   */
  shouldCompact(messages: Message[], modelId: string): { needed: boolean; level: ContextUsage['level'] } {
    const usage = this.getContextUsage(messages, modelId);
    const needed = usage.level === 'compact' || usage.level === 'emergency';

    // Fire callbacks on level transitions
    if (usage.level !== this.lastLevel) {
      if (usage.level === 'warning') {
        for (const cb of this.warningCallbacks) {
          cb(usage);
        }
      } else if (usage.level === 'compact') {
        // Also fire warning callbacks at compact level if transitioning from normal
        if (this.lastLevel === 'normal') {
          for (const cb of this.warningCallbacks) {
            cb(usage);
          }
        }
      } else if (usage.level === 'emergency') {
        for (const cb of this.emergencyCallbacks) {
          cb(usage);
        }
      }
      this.lastLevel = usage.level;
    }

    return { needed, level: usage.level };
  }

  // ---- Compaction ----

  /**
   * Compact messages according to the configured or specified strategy.
   * Returns the compacted message list along with usage metrics.
   */
  async compact(
    messages: Message[],
    strategy?: AutoCompactConfig['compactStrategy'],
  ): Promise<Message[]> {
    if (!this.config.enabled) {
      return messages;
    }

    const effectiveModelId = this.currentModelId || 'openrouter/free';
    const usage = this.getContextUsage(messages, effectiveModelId);
    const effectiveStrategy = strategy ?? this.config.compactStrategy;

    let result: Message[];

    switch (effectiveStrategy) {
      case 'summarize':
        result = await this.compactBySummarize(messages, usage);
        break;
      case 'drop-oldest':
        result = this.compactByDropOldest(messages, usage);
        break;
      case 'hybrid':
        result = await this.compactByHybrid(messages, usage);
        break;
      default:
        result = this.compactByDropOldest(messages, usage);
    }

    // Fire compact callbacks
    const newUsage = this.getContextUsage(result, effectiveModelId);
    for (const cb of this.compactCallbacks) {
      cb(newUsage, result);
    }

    // Update tracked level
    this.lastLevel = newUsage.level;

    return result;
  }

  /**
   * Strategy: Summarize older messages into a single context message.
   * Keeps last N messages verbatim, summarizes everything else.
   */
  private async compactBySummarize(messages: Message[], usage: ContextUsage): Promise<Message[]> {
    const model = MODELS[this.currentModelId];
    const maxTokens = model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const targetTokens = Math.floor(maxTokens * this.config.compactThreshold * 0.75); // compact to 75% of threshold

    const { systemMessages, nonSystemMessages } = this.partitionMessages(messages);

    if (nonSystemMessages.length <= this.config.preserveRecentCount) {
      // Nothing to summarize
      return messages;
    }

    // Split into "old" and "recent"
    const preserveCount = this.config.preserveRecentCount;
    const recentMessages = nonSystemMessages.slice(-preserveCount);
    const oldMessages = nonSystemMessages.slice(0, -preserveCount);

    // Build summary of old messages
    const summaryContent = this.buildSummary(oldMessages);

    const summaryMessage: Message = {
      role: 'system',
      content: `## Earlier Conversation Summary\n${summaryContent}`,
      timestamp: Date.now(),
    };

    let result = [...systemMessages, summaryMessage, ...recentMessages];

    // If we still exceed the target, try LLM-backed compaction
    const resultUsage = this.getContextUsage(result, this.currentModelId);
    if (resultUsage.usagePercent >= this.config.compactThreshold && this.compactor) {
      try {
        const compactionResult: CompactionResult = await this.compactor.compact(result);
        result = compactionResult.messages;
      } catch {
        // Fall through — keep local summary result
      }
    }

    // If still over budget, progressively drop oldest from the old messages section
    if (this.getContextUsage(result, this.currentModelId).usagePercent >= this.config.emergencyThreshold) {
      result = this.emergencyDrop(result);
    }

    return result;
  }

  /**
   * Strategy: Drop oldest messages (except system prompt and recent).
   */
  private compactByDropOldest(messages: Message[], usage: ContextUsage): Message[] {
    const model = MODELS[this.currentModelId];
    const maxTokens = model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const targetTokens = Math.floor(maxTokens * this.config.compactThreshold * 0.75);

    const { systemMessages, nonSystemMessages } = this.partitionMessages(messages);

    if (nonSystemMessages.length <= this.config.preserveRecentCount) {
      return messages;
    }

    // Start by keeping system + recent; progressively add older messages from newest to oldest
    const preserveCount = this.config.preserveRecentCount;
    const recentMessages = nonSystemMessages.slice(-preserveCount);
    const olderMessages = nonSystemMessages.slice(0, -preserveCount);

    // Work backwards through older messages, adding as many as we can afford
    const keptOlder: Message[] = [];
    let currentTokens = this.estimateMessagesTokens([...systemMessages, ...recentMessages]);

    for (let i = olderMessages.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateMessageTokens(olderMessages[i]);
      if (currentTokens + msgTokens <= targetTokens) {
        keptOlder.unshift(olderMessages[i]);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    // If we dropped some messages, add a brief context note
    const droppedCount = olderMessages.length - keptOlder.length;
    let result: Message[];

    if (droppedCount > 0) {
      const contextNote: Message = {
        role: 'system',
        content: `## Context Note\n${droppedCount} earlier message(s) were dropped to fit the context window. Key details may have been lost.`,
        timestamp: Date.now(),
      };
      result = [...systemMessages, contextNote, ...keptOlder, ...recentMessages];
    } else {
      result = [...systemMessages, ...keptOlder, ...recentMessages];
    }

    return result;
  }

  /**
   * Strategy: Hybrid — summarize first, then drop oldest if still over budget.
   */
  private async compactByHybrid(messages: Message[], usage: ContextUsage): Promise<Message[]> {
    // First pass: summarize
    const summarized = await this.compactBySummarize(messages, usage);

    // Check if still over budget
    const postUsage = this.getContextUsage(summarized, this.currentModelId);
    if (postUsage.usagePercent < this.config.compactThreshold) {
      return summarized;
    }

    // Second pass: drop oldest from the summarized result
    return this.compactByDropOldest(summarized, postUsage);
  }

  /**
   * Emergency compaction: keep only system prompt + last 3 exchanges (6 messages).
   * This is the last resort when everything else fails.
   */
  private emergencyDrop(messages: Message[]): Message[] {
    const { systemMessages, nonSystemMessages } = this.partitionMessages(messages);

    // Keep exactly the last 3 exchanges (6 messages: user/assistant/tool pairs)
    const emergencyPreserveCount = 6;
    const recentMessages = nonSystemMessages.slice(-emergencyPreserveCount);

    const emergencyNote: Message = {
      role: 'system',
      content: '## Emergency Compaction\nContext was critically over budget. Older messages were dropped. Only the most recent exchanges are preserved.',
      timestamp: Date.now(),
    };

    return [...systemMessages, emergencyNote, ...recentMessages];
  }

  // ---- Token Estimation ----

  /**
   * Estimate the number of tokens in a text string for a given model.
   * Uses ~4 chars/token for English, ~2 chars/token for CJK.
   */
  estimateTokens(text: string, _modelId?: string): number {
    return estimateTokensForText(text);
  }

  /**
   * Estimate total tokens across an array of messages,
   * including tool calls.
   */
  estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
  }

  /**
   * Estimate tokens for a single message including tool calls.
   */
  private estimateMessageTokens(msg: Message): number {
    let tokens = estimateTokensForText(msg.content);

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tokens += estimateTokensForText(tc.function.name + tc.function.arguments);
      }
    }

    // Overhead per message: role label, formatting, etc. (~4 tokens)
    tokens += 4;

    return tokens;
  }

  // ---- Callbacks ----

  onWarning(callback: (usage: ContextUsage) => void): void {
    this.warningCallbacks.push(callback);
  }

  onCompact(callback: (usage: ContextUsage, result: Message[]) => void): void {
    this.compactCallbacks.push(callback);
  }

  onEmergency(callback: (usage: ContextUsage) => void): void {
    this.emergencyCallbacks.push(callback);
  }

  // ---- Helpers ----

  /**
   * Partition messages into system and non-system buckets.
   */
  private partitionMessages(messages: Message[]): {
    systemMessages: Message[];
    nonSystemMessages: Message[];
  } {
    const systemMessages: Message[] = [];
    const nonSystemMessages: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        nonSystemMessages.push(msg);
      }
    }

    return { systemMessages, nonSystemMessages };
  }

  /**
   * Build a concise summary from a list of messages.
   * Prioritizes user intent, tool interactions, and assistant decisions.
   */
  private buildSummary(messages: Message[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      const preview = msg.content.length > 150
        ? msg.content.slice(0, 150) + '...'
        : msg.content;

      switch (msg.role) {
        case 'user':
          parts.push(`[User]: ${preview}`);
          break;
        case 'assistant':
          if (msg.toolCalls?.length) {
            const toolNames = msg.toolCalls.map(tc => tc.function.name).join(', ');
            parts.push(`[Assistant called: ${toolNames}] ${preview}`);
          } else {
            parts.push(`[Assistant]: ${preview}`);
          }
          break;
        case 'tool':
          parts.push(`[Tool result]: ${preview.slice(0, 80)}`);
          break;
        default:
          break;
      }
    }

    return parts.join('\n');
  }
}

// ---- Convenience: Auto-Compact Middleware ----

/**
 * Middleware function that can be called before each LLM call.
 * Checks context usage, auto-compacts if needed, and returns
 * the (possibly compacted) message list.
 */
export async function autoCompactMiddleware(
  manager: AutoCompactManager,
  messages: Message[],
  modelId: string,
): Promise<Message[]> {
  if (!manager['config'].enabled) {
    return messages;
  }

  manager.setModel(modelId);

  const { needed, level } = manager.shouldCompact(messages, modelId);

  if (!needed) {
    return messages;
  }

  // Choose strategy based on severity
  let strategy: AutoCompactConfig['compactStrategy'];

  if (level === 'emergency') {
    strategy = 'drop-oldest'; // Fastest, most aggressive
  } else if (level === 'compact') {
    strategy = manager['config'].compactStrategy;
  } else {
    return messages;
  }

  return manager.compact(messages, strategy);
}

// ---- Convenience: Create a pre-configured AutoCompactManager ----

export function createAutoCompactManager(
  overrides?: Partial<AutoCompactConfig>,
): AutoCompactManager {
  return new AutoCompactManager(overrides);
}

// ============================================================
// NeuroCLI - 5-Layer Context Compaction
// (Like Claude Code's sophisticated context management)
// ============================================================

import { Message } from '../core/types.js';
import { ContextManager } from '../core/context.js';
import { OpenRouterClient } from '../api/openrouter.js';

export type CompactionLayer =
  | 'tool_budget'       // Layer 1: Limit tool output size
  | 'snip'              // Layer 2: Snip old conversation turns
  | 'micro'             // Layer 3: Per-turn micro-compaction
  | 'session_memory'    // Layer 4: Extract key session memories
  | 'full_collapse';    // Layer 5: Full conversation collapse

export interface CompactionResult {
  messages: Message[];
  layer: CompactionLayer;
  originalTokens: number;
  compactedTokens: number;
  savings: number;
  memories?: string[];
}

export class ContextCompactor {
  private contextManager: ContextManager;
  private client: OpenRouterClient;
  private model: string;
  private maxToolOutputTokens: number = 5000;
  private compactionThreshold: number = 0.85; // 85% of context window

  constructor(
    contextManager: ContextManager,
    client: OpenRouterClient,
    model: string,
  ) {
    this.contextManager = contextManager;
    this.client = client;
    this.model = model;
  }

  /**
   * Check if compaction is needed
   */
  needsCompaction(messages: Message[]): boolean {
    const summary = this.contextManager.analyze(messages);
    const ratio = summary.totalTokens / this.contextManager.maxInputTokens;
    return ratio >= this.compactionThreshold;
  }

  /**
   * Apply 5-layer compaction strategy
   */
  async compact(messages: Message[]): Promise<CompactionResult> {
    const originalTokens = this.contextManager.countTokens(messages);

    // Layer 1: Tool Budget - Limit tool output sizes
    let result = this.layerToolBudget(messages);
    if (this.contextManager.countTokens(result.messages) < this.contextManager.maxInputTokens * 0.9) {
      return { ...result, originalTokens };
    }

    // Layer 2: Snip - Remove old conversation turns
    result = this.layerSnip(result.messages);
    if (this.contextManager.countTokens(result.messages) < this.contextManager.maxInputTokens * 0.9) {
      return { ...result, originalTokens };
    }

    // Layer 3: Micro-compaction - Compress each turn
    result = this.layerMicroCompact(result.messages);
    if (this.contextManager.countTokens(result.messages) < this.contextManager.maxInputTokens * 0.9) {
      return { ...result, originalTokens };
    }

    // Layer 4: Session Memory - Extract key memories
    result = await this.layerSessionMemory(result.messages);
    if (this.contextManager.countTokens(result.messages) < this.contextManager.maxInputTokens * 0.9) {
      return { ...result, originalTokens };
    }

    // Layer 5: Full Collapse - Nuclear option
    result = await this.layerFullCollapse(result.messages);
    return { ...result, originalTokens };
  }

  /**
   * Layer 1: Tool Budget
   * Limit the size of tool outputs to prevent context bloat
   */
  private layerToolBudget(messages: Message[]): CompactionResult {
    const maxOutput = this.maxToolOutputTokens * 4; // ~4 chars per token

    const compacted = messages.map(msg => {
      if (msg.role === 'tool' && msg.content.length > maxOutput) {
        const truncated = msg.content.slice(0, maxOutput) +
          `\n\n... [output truncated, ${msg.content.length - maxOutput} chars removed]`;
        return { ...msg, content: truncated };
      }
      return msg;
    });

    const compactedTokens = this.contextManager.countTokens(compacted);
    return {
      messages: compacted,
      layer: 'tool_budget',
      originalTokens: compactedTokens,
      compactedTokens,
      savings: 0,
    };
  }

  /**
   * Layer 2: Snip
   * Remove old conversation turns, keeping system + recent messages
   */
  private layerSnip(messages: Message[]): CompactionResult {
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    // Keep last N messages (roughly last 20 turns)
    const keepCount = Math.min(40, nonSystemMessages.length);
    const kept = nonSystemMessages.slice(-keepCount);
    const removed = nonSystemMessages.slice(0, -keepCount);

    // Create a summary of removed messages
    const summaryParts: string[] = [];
    for (const msg of removed) {
      const preview = msg.content.slice(0, 100);
      switch (msg.role) {
        case 'user':
          summaryParts.push(`[User asked]: ${preview}`);
          break;
        case 'assistant':
          if (msg.toolCalls?.length) {
            summaryParts.push(`[AI called: ${msg.toolCalls.map(tc => tc.function.name).join(', ')}]`);
          } else {
            summaryParts.push(`[AI responded]: ${preview}`);
          }
          break;
        case 'tool':
          summaryParts.push(`[Tool result]: ${preview.slice(0, 50)}`);
          break;
      }
    }

    const contextSummary: Message = {
      role: 'system',
      content: `## Earlier Conversation Summary\n${summaryParts.join('\n')}`,
      timestamp: Date.now(),
    };

    const compacted = [...systemMessages, contextSummary, ...kept];
    const compactedTokens = this.contextManager.countTokens(compacted);
    const originalTokens = this.contextManager.countTokens(messages);

    return {
      messages: compacted,
      layer: 'snip',
      originalTokens,
      compactedTokens,
      savings: originalTokens - compactedTokens,
    };
  }

  /**
   * Layer 3: Micro-compaction
   * Compress each message to its essential content
   */
  private layerMicroCompact(messages: Message[]): CompactionResult {
    const compacted = messages.map(msg => {
      // Only compress long messages
      if (msg.content.length < 500) return msg;

      // For tool results, keep first and last portions
      if (msg.role === 'tool') {
        const half = Math.floor(1000 / 2);
        const compressed = msg.content.slice(0, half) +
          '\n...[compressed]...\n' +
          msg.content.slice(-half);
        return { ...msg, content: compressed };
      }

      // For assistant messages, keep first part
      if (msg.role === 'assistant' && msg.content.length > 1000) {
        return { ...msg, content: msg.content.slice(0, 800) + '\n...[compressed]' };
      }

      return msg;
    });

    const compactedTokens = this.contextManager.countTokens(compacted);
    const originalTokens = this.contextManager.countTokens(messages);

    return {
      messages: compacted,
      layer: 'micro',
      originalTokens,
      compactedTokens,
      savings: originalTokens - compactedTokens,
    };
  }

  /**
   * Layer 4: Session Memory Compaction
   * Extract key memories from conversation, replace with summary
   */
  private async layerSessionMemory(messages: Message[]): Promise<CompactionResult> {
    // Build a prompt to extract key information
    const conversation = messages
      .filter(m => m.role !== 'system')
      .map(m => `[${m.role}]: ${m.content.slice(0, 200)}`)
      .join('\n');

    try {
      const response = await this.client.quickChat(
        this.model,
        [
          { role: 'system', content: 'Extract the key facts, decisions, and context from this conversation. Return a concise list of important points.', timestamp: Date.now() },
          { role: 'user', content: conversation, timestamp: Date.now() },
        ],
      );

      const memories = response.content.split('\n').filter(l => l.trim());

      // Keep system messages + memory summary + last 10 messages
      const systemMessages = messages.filter(m => m.role === 'system');
      const recentMessages = messages.slice(-10);

      const memoryMessage: Message = {
        role: 'system',
        content: `## Session Memories\n${response.content}`,
        timestamp: Date.now(),
      };

      const compacted = [...systemMessages, memoryMessage, ...recentMessages];
      const compactedTokens = this.contextManager.countTokens(compacted);
      const originalTokens = this.contextManager.countTokens(messages);

      return {
        messages: compacted,
        layer: 'session_memory',
        originalTokens,
        compactedTokens,
        savings: originalTokens - compactedTokens,
        memories,
      };
    } catch {
      // Fallback to snip
      return this.layerSnip(messages);
    }
  }

  /**
   * Layer 5: Full Collapse
   * Nuclear option - completely summarize the conversation
   */
  private async layerFullCollapse(messages: Message[]): Promise<CompactionResult> {
    const systemMessages = messages.filter(m => m.role === 'system');

    // Get the user's original request
    const userMessages = messages.filter(m => m.role === 'user');
    const originalRequest = userMessages[0]?.content || '';

    // Get the latest state
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    const latestState = lastAssistant?.content || '';

    try {
      const response = await this.client.quickChat(
        this.model,
        [
          {
            role: 'system',
            content: 'You are a context compactor. Create a comprehensive but concise summary of the conversation that preserves all critical context for continuing the task.',
            timestamp: Date.now(),
          },
          {
            role: 'user',
            content: `Original request: ${originalRequest}\n\nCurrent state: ${latestState}\n\nFull conversation:\n${messages.map(m => `[${m.role}]: ${m.content.slice(0, 300)}`).join('\n')}`,
            timestamp: Date.now(),
          },
        ],
      );

      const collapsedMessage: Message = {
        role: 'system',
        content: `## Collapsed Context\n${response.content}`,
        timestamp: Date.now(),
      };

      // Keep system + collapsed context + last user message + last assistant message
      const compacted = [
        ...systemMessages,
        collapsedMessage,
        ...(userMessages.length > 0 ? [userMessages[userMessages.length - 1]] : []),
        ...(lastAssistant ? [lastAssistant] : []),
      ];

      const compactedTokens = this.contextManager.countTokens(compacted);
      const originalTokens = this.contextManager.countTokens(messages);

      return {
        messages: compacted,
        layer: 'full_collapse',
        originalTokens,
        compactedTokens,
        savings: originalTokens - compactedTokens,
      };
    } catch {
      // Ultimate fallback
      return this.layerSnip(messages);
    }
  }
}

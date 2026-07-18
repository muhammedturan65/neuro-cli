// ============================================================
// NeuroCLI - Context Manager
// Smart context window management
// ============================================================

import { Message } from '../core/types.js';
import { MODELS } from '../api/models.js';

// Simple token estimation (≈4 chars per token for English, ≈2 for CJK)
function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

export interface ContextSummary {
  totalMessages: number;
  totalTokens: number;
  systemTokens: number;
  conversationTokens: number;
  availableTokens: number;
  truncationNeeded: boolean;
}

export class ContextManager {
  private modelId: string;
  private maxContextTokens: number;
  private systemPromptRatio: number;
  private reservedOutputTokens: number;

  constructor(
    modelId: string,
    maxContextTokens?: number,
    systemPromptRatio: number = 0.15,
    reservedOutputRatio: number = 0.3,
  ) {
    this.modelId = modelId;
    const model = MODELS[modelId];
    this.maxContextTokens = maxContextTokens || (model?.contextWindow || 128000);
    this.systemPromptRatio = systemPromptRatio;
    this.reservedOutputTokens = Math.floor(this.maxContextTokens * reservedOutputRatio);
  }

  get maxInputTokens(): number {
    return this.maxContextTokens - this.reservedOutputTokens;
  }

  /**
   * Analyze the current context
   */
  analyze(messages: Message[]): ContextSummary {
    const totalTokens = this.countTokens(messages);
    const systemTokens = messages
      .filter(m => m.role === 'system')
      .reduce((sum, m) => sum + estimateTokens(m.content), 0);

    return {
      totalMessages: messages.length,
      totalTokens,
      systemTokens,
      conversationTokens: totalTokens - systemTokens,
      availableTokens: this.maxInputTokens - totalTokens,
      truncationNeeded: totalTokens > this.maxInputTokens,
    };
  }

  /**
   * Count total tokens in messages
   */
  countTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => {
      let msgTokens = estimateTokens(m.content);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          msgTokens += estimateTokens(tc.function.name + tc.function.arguments);
        }
      }
      return sum + msgTokens;
    }, 0);
  }

  /**
   * Manage context window - truncate if needed
   */
  manage(messages: Message[]): Message[] {
    const summary = this.analyze(messages);

    if (!summary.truncationNeeded) {
      return messages;
    }

    // Strategy: Keep system prompt + recent messages, summarize older ones
    const result: Message[] = [];
    const systemMessages = messages.filter(m => m.role === 'system');
    result.push(...systemMessages);

    // Calculate how many tokens we need to remove
    const tokensToRemove = summary.totalTokens - this.maxInputTokens + 500; // buffer

    // Add a context summary of removed messages
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    let removedTokens = 0;
    let cutoffIndex = 0;

    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msgTokens = estimateTokens(nonSystemMessages[i].content);
      if (removedTokens + msgTokens > tokensToRemove) {
        cutoffIndex = i;
        break;
      }
      removedTokens += msgTokens;
    }

    if (cutoffIndex > 0) {
      // Create a summary of the removed messages
      const removedMessages = nonSystemMessages.slice(0, cutoffIndex);
      const summaryContent = this.createSummary(removedMessages);

      result.push({
        role: 'system',
        content: `## Previous Context Summary\n${summaryContent}`,
        timestamp: Date.now(),
      });
    }

    // Add remaining messages
    result.push(...nonSystemMessages.slice(cutoffIndex));

    return result;
  }

  /**
   * Create a summary of old messages
   */
  private createSummary(messages: Message[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      const preview = msg.content.length > 200
        ? msg.content.slice(0, 200) + '...'
        : msg.content;

      switch (msg.role) {
        case 'user':
          parts.push(`[User asked]: ${preview}`);
          break;
        case 'assistant':
          if (msg.toolCalls?.length) {
            parts.push(`[Assistant called tools: ${msg.toolCalls.map(tc => tc.function.name).join(', ')}]`);
          } else {
            parts.push(`[Assistant responded]: ${preview}`);
          }
          break;
        case 'tool':
          parts.push(`[Tool result]: ${preview}`);
          break;
      }
    }

    return parts.join('\n');
  }

  /**
   * Build the final message array for an API call
   */
  buildMessages(
    systemPrompt: string,
    conversation: Message[],
    injectedContext?: string,
  ): Message[] {
    const messages: Message[] = [
      { role: 'system', content: systemPrompt, timestamp: Date.now() },
    ];

    if (injectedContext) {
      messages.push({
        role: 'system',
        content: `## Project Context\n${injectedContext}`,
        timestamp: Date.now(),
      });
    }

    messages.push(...conversation);

    return this.manage(messages);
  }
}

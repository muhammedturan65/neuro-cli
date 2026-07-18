// ============================================================
// NeuroCLI - Fallback Model Chain
// Automatic model fallback on failure
// ============================================================

import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { MODELS } from '../api/models.js';
import { Message } from './types.js';
import chalk from 'chalk';

export interface FallbackConfig {
  models: string[];           // ordered list of fallback models
  maxRetries: number;         // max retries per model (default: 2)
  retryDelayMs: number;       // delay between retries (default: 3000)
  fallbackOnErrors: string[]; // error patterns that trigger fallback
}

export interface FallbackResult {
  content: string;
  modelUsed: string;
  attempts: Array<{ model: string; success: boolean; error?: string }>;
  usage: TokenUsage;
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export class FallbackChain {
  private config: FallbackConfig;
  private client: OpenRouterClient;

  constructor(client: OpenRouterClient, config?: Partial<FallbackConfig>) {
    this.client = client;
    this.config = {
      models: [],
      maxRetries: 2,
      retryDelayMs: 3000,
      fallbackOnErrors: ['rate_limit', 'overloaded', 'context_length_exceeded', 'timeout', 'server_error'],
      ...config,
    };
  }

  /**
   * Execute a chat request with fallback chain
   */
  async chatWithFallback(
    primaryModel: string,
    messages: Message[],
    options: {
      tools?: unknown[];
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    },
    onModelSwitch?: (from: string, to: string) => void,
  ): Promise<FallbackResult> {
    const chain = [primaryModel, ...this.config.models.filter(m => m !== primaryModel)];
    const attempts: Array<{ model: string; success: boolean; error?: string }> = [];
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };

    for (const model of chain) {
      for (let retry = 0; retry <= this.config.maxRetries; retry++) {
        try {
          const modelInfo = MODELS[model];
          console.log(chalk.gray(`  → Trying ${modelInfo?.name || model}${retry > 0 ? ` (retry ${retry})` : ''}...`));

          const response = await this.client.chat({
            model,
            messages,
            tools: options.tools as any[],
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: options.stream ?? false,
          });

          totalUsage.inputTokens += response.usage.inputTokens;
          totalUsage.outputTokens += response.usage.outputTokens;
          totalUsage.cost += response.usage.cost;

          attempts.push({ model, success: true });

          // If we used a fallback model, notify
          if (model !== primaryModel && onModelSwitch) {
            onModelSwitch(primaryModel, model);
          }

          return {
            content: response.content,
            modelUsed: model,
            attempts,
            usage: totalUsage,
            toolCalls: response.toolCalls || [],
          };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          attempts.push({ model, success: false, error: errMsg });

          // Check if this error should trigger fallback
          const shouldFallback = this.config.fallbackOnErrors.some(pattern =>
            errMsg.toLowerCase().includes(pattern.toLowerCase()) ||
            errMsg.includes('429') ||
            errMsg.includes('503') ||
            errMsg.includes('500')
          );

          if (shouldFallback) {
            console.log(chalk.yellow(`  ⚠ ${model} failed: ${errMsg.slice(0, 80)}`));
            break; // Try next model in chain
          }

          // For other errors, retry on same model
          if (retry < this.config.maxRetries) {
            const delay = this.config.retryDelayMs * (retry + 1);
            console.log(chalk.gray(`  ↻ Retrying in ${delay / 1000}s...`));
            await this.sleep(delay);
          }
        }
      }
    }

    // All models failed
    throw new Error(`All models in fallback chain failed. Attempts: ${JSON.stringify(attempts)}`);
  }

  /**
   * Set fallback models
   */
  setFallbackModels(models: string[]): void {
    this.config.models = models;
  }

  /**
   * Add a fallback model
   */
  addFallbackModel(model: string): void {
    if (!this.config.models.includes(model)) {
      this.config.models.push(model);
    }
  }

  /**
   * Get current fallback chain
   */
  getFallbackChain(): string[] {
    return [...this.config.models];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

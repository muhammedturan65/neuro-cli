// ============================================================
// NeuroCLI - OpenRouter API Client
// Streaming + Tool Use + Multi-model support
// ============================================================

// @ts-ignore
import { createParser } from 'eventsource-parser';
import { Message, ToolCall, ToolDefinition, ToolResult } from '../core/types.js';
import { MODELS, calculateCost } from './models.js';

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onThinking?: (thinking: string) => void;
  onComplete?: (fullResponse: string, usage: TokenUsage) => void;
  onError?: (error: Error) => void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };

  constructor(apiKey: string, baseUrl: string = 'https://openrouter.ai/api/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  get usage(): TokenUsage {
    return { ...this.totalUsage };
  }

  resetUsage(): void {
    this.totalUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
  }

  /**
   * Main chat completion with streaming
   */
  async chat(request: ChatRequest, callbacks?: StreamCallbacks): Promise<{ content: string; toolCalls: ToolCall[]; usage: TokenUsage }> {
    const model = MODELS[request.model];
    if (!model) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      stream: request.stream ?? true,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? model.maxOutput,
    };

    if (request.tools && request.tools.length > 0 && model.supportsTools) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 5s, 15s, 30s
        const waitTime = Math.min(5000 * Math.pow(3, attempt - 1), 30000);
        callbacks?.onThinking?.(`⏳ Rate limited, retrying in ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neurocli.dev',
          'X-Title': 'NeuroCLI',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        // Parse retry_after from 429 errors
        if (response.status === 429) {
          try {
            const errorData = JSON.parse(errorBody);
            const retryAfter = errorData?.error?.metadata?.retry_after_seconds;
            if (retryAfter && attempt < maxRetries) {
              lastError = new Error(`Rate limited, retry after ${retryAfter}s`);
              continue; // Retry
            }
          } catch {}
          // If we can't parse retry_after or max retries reached, throw
          if (attempt < maxRetries) {
            lastError = new Error(`Rate limited (429): ${errorBody}`);
            continue;
          }
        }
        throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
      }

      if (request.stream && callbacks) {
        return this.handleStreamingResponse(response, request.model, callbacks);
      } else {
        return this.handleNonStreamingResponse(response, request.model);
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Handle SSE streaming response
   */
  private async handleStreamingResponse(
    response: Response,
    modelId: string,
    callbacks: StreamCallbacks
  ): Promise<{ content: string; toolCalls: ToolCall[]; usage: TokenUsage }> {
    const fullContent: string[] = [];
    const toolCalls: Map<number, ToolCall> = new Map();
    let inputTokens = 0;
    let outputTokens = 0;

    const parser = createParser((event: any) => {
      if (event.type === 'event') {
        if (event.data === '[DONE]') return;

        try {
          const parsed = JSON.parse(event.data) as any;
          
          // Extract usage if available
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens || 0;
            outputTokens = parsed.usage.completion_tokens || 0;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) return;

          // Handle thinking/reasoning tokens
          if (delta.reasoning_content) {
            callbacks.onThinking?.(delta.reasoning_content);
          }

          // Handle content tokens
          if (delta.content) {
            fullContent.push(delta.content);
            callbacks.onToken?.(delta.content);
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index);
              if (existing) {
                if (tc.function?.arguments) {
                  existing.function.arguments += tc.function.arguments;
                }
              } else {
                toolCalls.set(tc.index, {
                  id: tc.id || `tc_${tc.index}`,
                  type: 'function',
                  function: {
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  },
                });
              }
            }
          }

          // Handle finish
          if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
            const toolCallList = Array.from(toolCalls.values());
            for (const tc of toolCallList) {
              callbacks.onToolCall?.(tc);
            }
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        parser.feed(chunk);
      }
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    }

    const content = fullContent.join('');
    const toolCallList = Array.from(toolCalls.values());
    const cost = calculateCost(modelId, inputTokens, outputTokens);
    const usage: TokenUsage = { inputTokens, outputTokens, cost };

    this.totalUsage.inputTokens += inputTokens;
    this.totalUsage.outputTokens += outputTokens;
    this.totalUsage.cost += cost;

    callbacks.onComplete?.(content, usage);
    return { content, toolCalls: toolCallList, usage };
  }

  /**
   * Handle non-streaming response
   */
  private async handleNonStreamingResponse(
    response: Response,
    modelId: string
  ): Promise<{ content: string; toolCalls: ToolCall[]; usage: TokenUsage }> {
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    const toolCalls: ToolCall[] = data.choices?.[0]?.message?.tool_calls || [];
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const cost = calculateCost(modelId, inputTokens, outputTokens);
    const usage: TokenUsage = { inputTokens, outputTokens, cost };

    this.totalUsage.inputTokens += inputTokens;
    this.totalUsage.outputTokens += outputTokens;
    this.totalUsage.cost += cost;

    return { content, toolCalls, usage };
  }

  /**
   * Quick completion without streaming (for sub-agents)
   */
  async quickChat(
    model: string,
    messages: Message[],
    tools?: ToolDefinition[],
    temperature?: number
  ): Promise<{ content: string; toolCalls: ToolCall[]; usage: TokenUsage }> {
    return this.chat({
      model,
      messages,
      tools,
      temperature: temperature ?? 0.5,
      stream: false,
    });
  }
}

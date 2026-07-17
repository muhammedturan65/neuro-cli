// ============================================================
// NeuroCLI - Advisor Model
// Second model consultation during tasks (like Claude Code's Advisor)
// ============================================================

import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { Message } from '../core/types.js';

export interface AdvisorConfig {
  enabled: boolean;
  model: string;
  consultOn: AdvisorTrigger[];
  maxConsultations: number;
}

export type AdvisorTrigger =
  | 'before_approach'     // Before committing to an approach
  | 'recurring_error'    // When stuck on recurring errors
  | 'before_complete'    // Before declaring task complete
  | 'complex_decision'   // When facing a complex architectural decision
  | 'security_sensitive' // When dealing with security-sensitive code
  | 'manual';            // Only when explicitly requested

export interface AdvisorResult {
  advice: string;
  shouldProceed: boolean;
  suggestedChanges?: string;
  usage: TokenUsage;
}

export class AdvisorSystem {
  private client: OpenRouterClient;
  private config: AdvisorConfig;
  private consultationCount: number = 0;
  private recentErrors: string[] = [];

  constructor(client: OpenRouterClient, config?: Partial<AdvisorConfig>) {
    this.client = client;
    this.config = {
      enabled: config?.enabled ?? true,
      model: config?.model ?? 'nvidia/nemotron-3-super-120b-a12b:free',
      consultOn: config?.consultOn ?? ['before_complete', 'recurring_error', 'security_sensitive'],
      maxConsultations: config?.maxConsultations ?? 5,
    };
  }

  /**
   * Check if advisor should be consulted for a given trigger
   */
  shouldConsult(trigger: AdvisorTrigger): boolean {
    if (!this.config.enabled) return false;
    if (this.consultationCount >= this.config.maxConsultations) return false;
    return this.config.consultOn.includes(trigger);
  }

  /**
   * Consult the advisor model
   */
  async consult(
    conversation: Message[],
    trigger: AdvisorTrigger,
    currentAction: string,
    context?: string,
  ): Promise<AdvisorResult> {
    this.consultationCount++;

    const triggerDescriptions: Record<AdvisorTrigger, string> = {
      'before_approach': 'The agent is about to commit to a specific approach. Review the plan.',
      'recurring_error': 'The agent has encountered a recurring error. Suggest alternative approaches.',
      'before_complete': 'The agent is about to declare the task complete. Verify quality.',
      'complex_decision': 'The agent faces a complex architectural decision. Provide guidance.',
      'security_sensitive': 'The agent is modifying security-sensitive code. Review for vulnerabilities.',
      'manual': 'The user requested an advisor consultation.',
    };

    // Build advisor prompt
    const advisorMessages: Message[] = [
      {
        role: 'system',
        content: `You are an expert advisor AI. Your role is to review the agent's work and provide constructive guidance.

You have access to the full conversation including every tool call and result.

When advising:
1. Identify potential issues or risks
2. Suggest better approaches if applicable
3. Point out anything the agent might have missed
4. Assess code quality and correctness
5. Consider security implications

Be concise but thorough. End with a clear recommendation: PROCEED or REVISE.`,
        timestamp: Date.now(),
      },
      {
        role: 'user',
        content: `## Advisor Consultation: ${trigger}

${triggerDescriptions[trigger]}

## Current Action
${currentAction}

${context ? `## Additional Context\n${context}\n` : ''}

## Conversation So Far
${this.summarizeConversation(conversation)}

Please provide your assessment and recommendation.`,
        timestamp: Date.now(),
      },
    ];

    try {
      const response = await this.client.quickChat(
        this.config.model,
        advisorMessages,
      );

      const advice = response.content;
      const shouldProceed = advice.toUpperCase().includes('PROCEED') &&
        !advice.toUpperCase().includes('REVISE');

      return {
        advice,
        shouldProceed,
        suggestedChanges: shouldProceed ? undefined : this.extractSuggestions(advice),
        usage: response.usage,
      };
    } catch (error) {
      return {
        advice: 'Advisor consultation failed. Proceed with caution.',
        shouldProceed: true,
        usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Track errors for recurring error detection
   */
  trackError(error: string): void {
    this.recentErrors.push(error);
    // Keep last 5 errors
    if (this.recentErrors.length > 5) {
      this.recentErrors.shift();
    }
  }

  /**
   * Check if an error is recurring
   */
  isRecurringError(error: string): boolean {
    const similar = this.recentErrors.filter(e =>
      this.computeSimilarity(e, error) > 0.5
    );
    return similar.length >= 2;
  }

  /**
   * Get consultation count
   */
  getConsultationCount(): number {
    return this.consultationCount;
  }

  /**
   * Reset for new task
   */
  reset(): void {
    this.consultationCount = 0;
    this.recentErrors = [];
  }

  // ---- Private ----

  private summarizeConversation(messages: Message[]): string {
    const parts: string[] = [];
    const maxMessages = 30;
    const recent = messages.slice(-maxMessages);

    for (const msg of recent) {
      switch (msg.role) {
        case 'user':
          parts.push(`[User]: ${msg.content.slice(0, 200)}`);
          break;
        case 'assistant':
          if (msg.toolCalls?.length) {
            parts.push(`[Assistant called: ${msg.toolCalls.map(tc => tc.function.name).join(', ')}]`);
          } else {
            parts.push(`[Assistant]: ${msg.content.slice(0, 300)}`);
          }
          break;
        case 'tool':
          parts.push(`[Tool result]: ${msg.content.slice(0, 200)}`);
          break;
      }
    }

    return parts.join('\n');
  }

  private extractSuggestions(advice: string): string {
    // Extract suggested changes from advisor response
    const lines = advice.split('\n');
    const suggestions: string[] = [];
    let inSuggestion = false;

    for (const line of lines) {
      if (line.match(/^#{1,3}\s+(suggestion|recommendation|change|fix)/i)) {
        inSuggestion = true;
        continue;
      }
      if (inSuggestion && line.trim()) {
        suggestions.push(line.trim());
      }
    }

    return suggestions.join('\n') || advice.slice(0, 500);
  }

  private computeSimilarity(a: string, b: string): number {
    // Simple similarity: word overlap
    const wordsA = new Set(a.toLowerCase().split(/\W+/));
    const wordsB = new Set(b.toLowerCase().split(/\W+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}

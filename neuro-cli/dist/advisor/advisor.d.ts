import { OpenRouterClient, TokenUsage } from '../api/openrouter.js';
import { Message } from '../core/types.js';
export interface AdvisorConfig {
    enabled: boolean;
    model: string;
    consultOn: AdvisorTrigger[];
    maxConsultations: number;
}
export type AdvisorTrigger = 'before_approach' | 'recurring_error' | 'before_complete' | 'complex_decision' | 'security_sensitive' | 'manual';
export interface AdvisorResult {
    advice: string;
    shouldProceed: boolean;
    suggestedChanges?: string;
    usage: TokenUsage;
}
export declare class AdvisorSystem {
    private client;
    private config;
    private consultationCount;
    private recentErrors;
    constructor(client: OpenRouterClient, config?: Partial<AdvisorConfig>);
    /**
     * Check if advisor should be consulted for a given trigger
     */
    shouldConsult(trigger: AdvisorTrigger): boolean;
    /**
     * Consult the advisor model
     */
    consult(conversation: Message[], trigger: AdvisorTrigger, currentAction: string, context?: string): Promise<AdvisorResult>;
    /**
     * Track errors for recurring error detection
     */
    trackError(error: string): void;
    /**
     * Check if an error is recurring
     */
    isRecurringError(error: string): boolean;
    /**
     * Get consultation count
     */
    getConsultationCount(): number;
    /**
     * Reset for new task
     */
    reset(): void;
    private summarizeConversation;
    private extractSuggestions;
    private computeSimilarity;
}
//# sourceMappingURL=advisor.d.ts.map
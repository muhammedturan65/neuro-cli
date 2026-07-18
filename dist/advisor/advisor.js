// ============================================================
// NeuroCLI - Advisor Model
// Second model consultation during tasks (like Claude Code's Advisor)
// ============================================================
export class AdvisorSystem {
    client;
    config;
    consultationCount = 0;
    recentErrors = [];
    constructor(client, config) {
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
    shouldConsult(trigger) {
        if (!this.config.enabled)
            return false;
        if (this.consultationCount >= this.config.maxConsultations)
            return false;
        return this.config.consultOn.includes(trigger);
    }
    /**
     * Consult the advisor model
     */
    async consult(conversation, trigger, currentAction, context) {
        this.consultationCount++;
        const triggerDescriptions = {
            'before_approach': 'The agent is about to commit to a specific approach. Review the plan.',
            'recurring_error': 'The agent has encountered a recurring error. Suggest alternative approaches.',
            'before_complete': 'The agent is about to declare the task complete. Verify quality.',
            'complex_decision': 'The agent faces a complex architectural decision. Provide guidance.',
            'security_sensitive': 'The agent is modifying security-sensitive code. Review for vulnerabilities.',
            'manual': 'The user requested an advisor consultation.',
        };
        // Build advisor prompt
        const advisorMessages = [
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
            const response = await this.client.quickChat(this.config.model, advisorMessages);
            const advice = response.content;
            const shouldProceed = advice.toUpperCase().includes('PROCEED') &&
                !advice.toUpperCase().includes('REVISE');
            return {
                advice,
                shouldProceed,
                suggestedChanges: shouldProceed ? undefined : this.extractSuggestions(advice),
                usage: response.usage,
            };
        }
        catch (error) {
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
    trackError(error) {
        this.recentErrors.push(error);
        // Keep last 5 errors
        if (this.recentErrors.length > 5) {
            this.recentErrors.shift();
        }
    }
    /**
     * Check if an error is recurring
     */
    isRecurringError(error) {
        const similar = this.recentErrors.filter(e => this.computeSimilarity(e, error) > 0.5);
        return similar.length >= 2;
    }
    /**
     * Get consultation count
     */
    getConsultationCount() {
        return this.consultationCount;
    }
    /**
     * Reset for new task
     */
    reset() {
        this.consultationCount = 0;
        this.recentErrors = [];
    }
    // ---- Private ----
    summarizeConversation(messages) {
        const parts = [];
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
                    }
                    else {
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
    extractSuggestions(advice) {
        // Extract suggested changes from advisor response
        const lines = advice.split('\n');
        const suggestions = [];
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
    computeSimilarity(a, b) {
        // Simple similarity: word overlap
        const wordsA = new Set(a.toLowerCase().split(/\W+/));
        const wordsB = new Set(b.toLowerCase().split(/\W+/));
        const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
        const union = new Set([...wordsA, ...wordsB]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    }
}
//# sourceMappingURL=advisor.js.map
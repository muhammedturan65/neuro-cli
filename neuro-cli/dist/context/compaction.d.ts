import { Message } from '../core/types.js';
import { ContextManager } from '../core/context.js';
import { OpenRouterClient } from '../api/openrouter.js';
export type CompactionLayer = 'tool_budget' | 'snip' | 'micro' | 'session_memory' | 'full_collapse';
export interface CompactionResult {
    messages: Message[];
    layer: CompactionLayer;
    originalTokens: number;
    compactedTokens: number;
    savings: number;
    memories?: string[];
}
export declare class ContextCompactor {
    private contextManager;
    private client;
    private model;
    private maxToolOutputTokens;
    private compactionThreshold;
    constructor(contextManager: ContextManager, client: OpenRouterClient, model: string);
    /**
     * Check if compaction is needed
     */
    needsCompaction(messages: Message[]): boolean;
    /**
     * Apply 5-layer compaction strategy
     */
    compact(messages: Message[]): Promise<CompactionResult>;
    /**
     * Layer 1: Tool Budget
     * Limit the size of tool outputs to prevent context bloat
     */
    private layerToolBudget;
    /**
     * Layer 2: Snip
     * Remove old conversation turns, keeping system + recent messages
     */
    private layerSnip;
    /**
     * Layer 3: Micro-compaction
     * Compress each message to its essential content
     */
    private layerMicroCompact;
    /**
     * Layer 4: Session Memory Compaction
     * Extract key memories from conversation, replace with summary
     */
    private layerSessionMemory;
    /**
     * Layer 5: Full Collapse
     * Nuclear option - completely summarize the conversation
     */
    private layerFullCollapse;
}
//# sourceMappingURL=compaction.d.ts.map
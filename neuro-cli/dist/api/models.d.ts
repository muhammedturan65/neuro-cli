import { ModelConfig } from '../core/types.js';
export declare const MODELS: Record<string, ModelConfig>;
export declare const MODEL_CATEGORIES: {
    flagship: string[];
    balanced: string[];
    fast: string[];
    'open-source': string[];
};
export declare function getModel(id: string): ModelConfig | undefined;
export declare function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number;
//# sourceMappingURL=models.d.ts.map
import { ModelConfig } from '../core/types.js';
export declare const MODELS: Record<string, ModelConfig>;
export declare const MODEL_CATEGORIES: {
    free: string[];
    'free-vision': string[];
    'free-tools': string[];
    flagship: string[];
    balanced: string[];
    fast: string[];
    'open-source': string[];
};
/** Best free model for coding (with tool support) */
export declare const BEST_FREE_CODING_MODEL = "qwen/qwen3-coder:free";
/** Best free model overall (largest context + tools) */
export declare const BEST_FREE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
/** Default free model for agents */
export declare const DEFAULT_FREE_MODEL = "qwen/qwen3-coder:free";
export declare function getModel(id: string): ModelConfig | undefined;
export declare function isFreeModel(modelId: string): boolean;
export declare function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number;
export declare function getFreeModels(): ModelConfig[];
export declare function getFreeModelsWithTools(): ModelConfig[];
//# sourceMappingURL=models.d.ts.map
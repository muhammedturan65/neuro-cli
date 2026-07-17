// ============================================================
// NeuroCLI - Model Definitions
// Comprehensive OpenRouter model registry
// ============================================================
export const MODELS = {
    // ---- Anthropic ----
    'anthropic/claude-sonnet-4': {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 64000,
        inputPrice: 3.0,
        outputPrice: 15.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    'anthropic/claude-opus-4': {
        id: 'anthropic/claude-opus-4',
        name: 'Claude Opus 4',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 32000,
        inputPrice: 15.0,
        outputPrice: 75.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    'anthropic/claude-3.5-haiku': {
        id: 'anthropic/claude-3.5-haiku',
        name: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 8192,
        inputPrice: 0.80,
        outputPrice: 4.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    // ---- Google ----
    'google/gemini-2.5-pro': {
        id: 'google/gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: 'google',
        contextWindow: 1048576,
        maxOutput: 65536,
        inputPrice: 1.25,
        outputPrice: 10.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    'google/gemini-2.5-flash': {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'google',
        contextWindow: 1048576,
        maxOutput: 65536,
        inputPrice: 0.15,
        outputPrice: 0.60,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    // ---- OpenAI ----
    'openai/gpt-4o': {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        contextWindow: 128000,
        maxOutput: 16384,
        inputPrice: 2.50,
        outputPrice: 10.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    'openai/gpt-4o-mini': {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        contextWindow: 128000,
        maxOutput: 16384,
        inputPrice: 0.15,
        outputPrice: 0.60,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    'openai/o3': {
        id: 'openai/o3',
        name: 'OpenAI o3',
        provider: 'openai',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 10.0,
        outputPrice: 40.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    'openai/o4-mini': {
        id: 'openai/o4-mini',
        name: 'OpenAI o4-mini',
        provider: 'openai',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 1.10,
        outputPrice: 4.40,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    // ---- Meta ----
    'meta-llama/llama-4-maverick': {
        id: 'meta-llama/llama-4-maverick',
        name: 'Llama 4 Maverick',
        provider: 'meta',
        contextWindow: 1048576,
        maxOutput: 32768,
        inputPrice: 0.20,
        outputPrice: 0.60,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
    // ---- DeepSeek ----
    'deepseek/deepseek-r1': {
        id: 'deepseek/deepseek-r1',
        name: 'DeepSeek R1',
        provider: 'deepseek',
        contextWindow: 163840,
        maxOutput: 32768,
        inputPrice: 0.55,
        outputPrice: 2.19,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
    },
    'deepseek/deepseek-chat': {
        id: 'deepseek/deepseek-chat',
        name: 'DeepSeek V3',
        provider: 'deepseek',
        contextWindow: 163840,
        maxOutput: 32768,
        inputPrice: 0.14,
        outputPrice: 0.28,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
    },
    // ---- Qwen ----
    'qwen/qwen3-235b-a22b': {
        id: 'qwen/qwen3-235b-a22b',
        name: 'Qwen3 235B',
        provider: 'qwen',
        contextWindow: 131072,
        maxOutput: 32768,
        inputPrice: 0.22,
        outputPrice: 0.88,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
    },
    // ---- Mistral ----
    'mistralai/mistral-large-2411': {
        id: 'mistralai/mistral-large-2411',
        name: 'Mistral Large',
        provider: 'mistral',
        contextWindow: 131072,
        maxOutput: 32768,
        inputPrice: 2.0,
        outputPrice: 6.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
    },
};
export const MODEL_CATEGORIES = {
    'flagship': ['anthropic/claude-opus-4', 'openai/o3', 'google/gemini-2.5-pro'],
    'balanced': ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
    'fast': ['anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    'open-source': ['meta-llama/llama-4-maverick', 'qwen/qwen3-235b-a22b', 'deepseek/deepseek-r1'],
};
export function getModel(id) {
    return MODELS[id];
}
export function calculateCost(modelId, inputTokens, outputTokens) {
    const model = MODELS[modelId];
    if (!model)
        return 0;
    return (inputTokens / 1_000_000) * model.inputPrice + (outputTokens / 1_000_000) * model.outputPrice;
}
//# sourceMappingURL=models.js.map
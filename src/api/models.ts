// ============================================================
// NeuroCLI - Model Definitions
// Comprehensive OpenRouter model registry
// Including 23 FREE models + premium models
// ============================================================

import { ModelConfig } from '../core/types.js';

export const MODELS: Record<string, ModelConfig> = {
  // ================================================================
  //  🆓 FREE MODELS (23 models - $0 input / $0 output)
  // ================================================================

  // ---- Free: Qwen ----
  'qwen/qwen3-coder:free': {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen3 Coder 480B (Free)',
    provider: 'qwen',
    contextWindow: 1048576,
    maxOutput: 262000,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  'qwen/qwen3-next-80b-a3b-instruct:free': {
    id: 'qwen/qwen3-next-80b-a3b-instruct:free',
    name: 'Qwen3 Next 80B (Free)',
    provider: 'qwen',
    contextWindow: 262144,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: NVIDIA Nemotron ----
  'nvidia/nemotron-3-super-120b-a12b:free': {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B (Free)',
    provider: 'nvidia',
    contextWindow: 1000000,
    maxOutput: 262144,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  'nvidia/nemotron-3-ultra-550b-a55b:free': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra 550B (Free)',
    provider: 'nvidia',
    contextWindow: 1000000,
    maxOutput: 65536,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'Nemotron 3 Nano Omni 30B (Free)',
    provider: 'nvidia',
    contextWindow: 256000,
    maxOutput: 65536,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  'nvidia/nemotron-3-nano-30b-a3b:free': {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    name: 'Nemotron 3 Nano 30B (Free)',
    provider: 'nvidia',
    contextWindow: 256000,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  'nvidia/nemotron-nano-12b-v2-vl:free': {
    id: 'nvidia/nemotron-nano-12b-v2-vl:free',
    name: 'Nemotron Nano 12B VL (Free)',
    provider: 'nvidia',
    contextWindow: 128000,
    maxOutput: 128000,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  'nvidia/nemotron-nano-9b-v2:free': {
    id: 'nvidia/nemotron-nano-9b-v2:free',
    name: 'Nemotron Nano 9B (Free)',
    provider: 'nvidia',
    contextWindow: 128000,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Meta Llama ----
  'meta-llama/llama-3.3-70b-instruct:free': {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B (Free)',
    provider: 'meta',
    contextWindow: 131072,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  'meta-llama/llama-3.2-3b-instruct:free': {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B (Free)',
    provider: 'meta',
    contextWindow: 131072,
    maxOutput: 8192,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Google Gemma ----
  'google/gemma-4-31b-it:free': {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B (Free)',
    provider: 'google',
    contextWindow: 262144,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  'google/gemma-4-26b-a4b-it:free': {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B A4B (Free)',
    provider: 'google',
    contextWindow: 262144,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },

  // ---- Free: Poolside ----
  'poolside/laguna-m.1:free': {
    id: 'poolside/laguna-m.1:free',
    name: 'Poolside Laguna M.1 (Free)',
    provider: 'poolside',
    contextWindow: 262144,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  'poolside/laguna-xs-2.1:free': {
    id: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS 2.1 (Free)',
    provider: 'poolside',
    contextWindow: 262144,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Cohere ----
  'cohere/north-mini-code:free': {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code (Free)',
    provider: 'cohere',
    contextWindow: 256000,
    maxOutput: 64000,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: OpenAI ----
  'openai/gpt-oss-20b:free': {
    id: 'openai/gpt-oss-20b:free',
    name: 'OpenAI gpt-oss-20b (Free)',
    provider: 'openai',
    contextWindow: 131072,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Nous Research ----
  'nousresearch/hermes-3-llama-3.1-405b:free': {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    name: 'Hermes 3 405B (Free)',
    provider: 'nous',
    contextWindow: 131072,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Tencent ----
  'tencent/hy3:free': {
    id: 'tencent/hy3:free',
    name: 'Tencent Hy3 (Free)',
    provider: 'tencent',
    contextWindow: 262144,
    maxOutput: 262144,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Venice (Uncensored) ----
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free': {
    id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    name: 'Dolphin Mistral 24B Uncensored (Free)',
    provider: 'venice',
    contextWindow: 32768,
    maxOutput: 8192,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
  },

  // ---- Free: Router ----
  'openrouter/free': {
    id: 'openrouter/free',
    name: 'Free Models Router',
    provider: 'openrouter',
    contextWindow: 200000,
    maxOutput: 32768,
    inputPrice: 0,
    outputPrice: 0,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },

  // ================================================================
  //  💎 PREMIUM MODELS
  // ================================================================

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
  'deepseek/deepseek-chat-v3-0324': {
    id: 'deepseek/deepseek-chat-v3-0324',
    name: 'DeepSeek V3 0324',
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
  'free': [
    'qwen/qwen3-coder:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-4-31b-it:free',
    'cohere/north-mini-code:free',
    'openai/gpt-oss-20b:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'tencent/hy3:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'poolside/laguna-m.1:free',
  ],
  'free-vision': [
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
  ],
  'free-tools': [
    'qwen/qwen3-coder:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'cohere/north-mini-code:free',
    'poolside/laguna-m.1:free',
    'poolside/laguna-xs-2.1:free',
    'tencent/hy3:free',
  ],
  'flagship': ['anthropic/claude-opus-4', 'openai/o3', 'google/gemini-2.5-pro'],
  'balanced': ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
  'fast': ['anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
  'open-source': ['meta-llama/llama-4-maverick', 'qwen/qwen3-235b-a22b', 'deepseek/deepseek-r1'],
};

/** Best free model for coding (with tool support) */
export const BEST_FREE_CODING_MODEL = 'qwen/qwen3-coder:free';

/** Best free model overall (largest context + tools) */
export const BEST_FREE_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

/** Default free model for agents */
export const DEFAULT_FREE_MODEL = 'qwen/qwen3-coder:free';

export function getModel(id: string): ModelConfig | undefined {
  return MODELS[id];
}

export function isFreeModel(modelId: string): boolean {
  const model = MODELS[modelId];
  return model ? model.inputPrice === 0 && model.outputPrice === 0 : modelId.includes(':free');
}

export function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = MODELS[modelId];
  if (!model) return 0;
  if (model.inputPrice === 0 && model.outputPrice === 0) return 0;
  return (inputTokens / 1_000_000) * model.inputPrice + (outputTokens / 1_000_000) * model.outputPrice;
}

export function getFreeModels(): ModelConfig[] {
  return Object.values(MODELS).filter(m => m.inputPrice === 0 && m.outputPrice === 0);
}

export function getFreeModelsWithTools(): ModelConfig[] {
  return Object.values(MODELS).filter(m => m.inputPrice === 0 && m.outputPrice === 0 && m.supportsTools);
}

// ============================================================
// NeuroCLI - Ollama (Local Model) Provider
// Supports Ollama API + OpenAI-compatible endpoints
// Streaming, Tool Use, Embeddings, Model Management
// ============================================================
export const DEFAULT_OLLAMA_CONFIG = {
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    timeout: 120000,
    maxRetries: 1,
};
// ----------------------------------------------------------------
// Error Classes
// ----------------------------------------------------------------
export class OllamaProviderError extends Error {
    statusCode;
    body;
    constructor(message, statusCode, body) {
        super(message);
        this.statusCode = statusCode;
        this.body = body;
        this.name = 'OllamaProviderError';
    }
}
export class OllamaTimeoutError extends OllamaProviderError {
    constructor(timeout) {
        super(`Request timed out after ${timeout}ms`);
        this.name = 'OllamaTimeoutError';
    }
}
export class OllamaConnectionError extends OllamaProviderError {
    constructor(baseUrl, cause) {
        super(`Cannot connect to Ollama at ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'OllamaConnectionError';
    }
}
// ----------------------------------------------------------------
// OllamaProvider
// ----------------------------------------------------------------
export class OllamaProvider {
    config;
    mode = 'ollama';
    constructor(config) {
        this.config = { ...DEFAULT_OLLAMA_CONFIG, ...config };
        this.detectMode();
    }
    // ==============================================================
    // Public API
    // ==============================================================
    /**
     * Chat completion with optional streaming.
     *
     * When callbacks are provided and stream is not explicitly false,
     * the response is streamed token-by-token via the callbacks.
     */
    async chat(messages, options, callbacks) {
        const model = options?.model ?? this.config.defaultModel;
        const shouldStream = options?.stream !== false;
        if (this.mode === 'ollama') {
            return this.chatOllama(model, messages, options, shouldStream, callbacks);
        }
        return this.chatOpenAICompatible(model, messages, options, shouldStream, callbacks);
    }
    /**
     * List locally available models.
     */
    async listModels() {
        if (this.mode === 'ollama') {
            return this.listModelsOllama();
        }
        return this.listModelsOpenAICompatible();
    }
    /**
     * Health check -- returns true if the endpoint is reachable.
     */
    async isAvailable() {
        try {
            if (this.mode === 'ollama') {
                const response = await this.fetch(`${this.config.baseUrl}`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000),
                });
                return response.ok;
            }
            // OpenAI-compatible: try /v1/models
            const response = await this.fetch(`${this.config.baseUrl}/v1/models`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Generate embeddings for a prompt using the Ollama native API.
     * Not supported on OpenAI-compatible endpoints through this method.
     */
    async generateEmbeddings(prompt, model) {
        if (this.mode !== 'ollama') {
            throw new OllamaProviderError('Embeddings are only supported when using the native Ollama API. ' +
                'Switch baseUrl to an Ollama endpoint to use embeddings.');
        }
        const body = {
            model: model ?? this.config.defaultModel,
            prompt,
        };
        const data = await this.request('/api/embeddings', 'POST', body);
        return data.embedding;
    }
    /**
     * Pull a model from the Ollama registry.
     * Returns true on success.
     */
    async pullModel(name) {
        if (this.mode !== 'ollama') {
            throw new OllamaProviderError('Model pulling is only supported when using the native Ollama API.');
        }
        try {
            const response = await this.fetch(`${this.config.baseUrl}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, stream: false }),
                signal: AbortSignal.timeout(Math.max(this.config.timeout, 600000)), // 10 min floor for pulls
            });
            if (!response.ok) {
                const body = await response.text();
                throw new OllamaProviderError(`Failed to pull model "${name}": ${response.status} ${body}`, response.status, body);
            }
            return true;
        }
        catch (error) {
            if (error instanceof OllamaProviderError)
                throw error;
            throw new OllamaConnectionError(this.config.baseUrl, error);
        }
    }
    /**
     * Estimate token count for a text string.
     *
     * Uses a heuristic based on the model family. Ollama does not expose
     * a tokenization endpoint, so this is an approximation:
     *   - For most models: ~4 characters per token (GPT-style)
     *   - For CJK-heavy text: ~2 characters per token
     *   - A slight overhead is added for special tokens / formatting.
     */
    estimateTokens(text) {
        if (!text)
            return 0;
        // Detect proportion of CJK characters
        const cjkPattern = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
        const cjkMatches = text.match(cjkPattern);
        const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0;
        // Blend between the two heuristics
        const charsPerToken = 4 - 2 * cjkRatio; // 4 for pure ASCII, 2 for pure CJK
        const baseEstimate = Math.ceil(text.length / charsPerToken);
        // Add ~5% overhead for special tokens, formatting, etc.
        return Math.ceil(baseEstimate * 1.05);
    }
    /**
     * Get the current configuration (read-only copy).
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration. Merges with existing config.
     * Re-detects provider mode if baseUrl changes.
     */
    updateConfig(updates) {
        const oldBaseUrl = this.config.baseUrl;
        this.config = { ...this.config, ...updates };
        if (updates.baseUrl && updates.baseUrl !== oldBaseUrl) {
            this.detectMode();
        }
    }
    // ==============================================================
    // Ollama Native Chat
    // ==============================================================
    async chatOllama(model, messages, options, shouldStream, callbacks) {
        const ollamaMessages = this.convertMessages(messages);
        const body = {
            model,
            messages: ollamaMessages,
            stream: shouldStream,
            options: {
                temperature: options?.temperature ?? this.config.temperature,
                num_predict: options?.maxTokens ?? this.config.maxTokens,
            },
        };
        // Add tools if provided and supported
        if (options?.tools && options.tools.length > 0) {
            body.tools = this.convertTools(options.tools);
        }
        let lastError = null;
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            if (attempt > 0) {
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await this.sleep(waitTime);
            }
            try {
                if (shouldStream && callbacks) {
                    return await this.streamOllamaChat(body, callbacks);
                }
                const data = await this.request('/api/chat', 'POST', body);
                return this.normalizeOllamaResponse(data, callbacks);
            }
            catch (error) {
                lastError = error;
                if (!this.isRetryable(error))
                    break;
            }
        }
        throw lastError ?? new OllamaProviderError('Max retries exceeded');
    }
    /**
     * Stream an Ollama native /api/chat response (NDJSON).
     */
    async streamOllamaChat(body, callbacks) {
        const response = await this.fetch(`${this.config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new OllamaProviderError(`Ollama chat error (${response.status}): ${text}`, response.status, text);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new OllamaProviderError('No response body for streaming');
        const decoder = new TextDecoder();
        let fullContent = '';
        let model = '';
        let totalDuration = 0;
        let evalCount = 0;
        let evalDuration = 0;
        const toolCalls = [];
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // NDJSON: each line is a JSON object
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? ''; // keep incomplete line in buffer
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    try {
                        const chunk = JSON.parse(trimmed);
                        // Accumulate metadata from all chunks
                        model = chunk.model || model;
                        // Stream content tokens
                        if (chunk.message?.content) {
                            fullContent += chunk.message.content;
                            callbacks.onToken?.(chunk.message.content);
                        }
                        // Handle tool calls
                        if (chunk.message?.tool_calls) {
                            for (const tc of chunk.message.tool_calls) {
                                const toolCall = {
                                    id: `tc_${toolCalls.length}`,
                                    type: 'function',
                                    function: {
                                        name: tc.function.name,
                                        arguments: typeof tc.function.arguments === 'string'
                                            ? tc.function.arguments
                                            : JSON.stringify(tc.function.arguments),
                                    },
                                };
                                toolCalls.push(toolCall);
                                callbacks.onToolCall?.(toolCall);
                            }
                        }
                        // Final chunk has stats
                        if (chunk.done) {
                            totalDuration = chunk.total_duration ?? 0;
                            evalCount = chunk.eval_count ?? 0;
                            evalDuration = chunk.eval_duration ?? 0;
                        }
                    }
                    catch {
                        // Skip malformed NDJSON lines
                    }
                }
            }
            // Process any remaining buffer
            if (buffer.trim()) {
                try {
                    const chunk = JSON.parse(buffer.trim());
                    if (chunk.message?.content) {
                        fullContent += chunk.message.content;
                        callbacks.onToken?.(chunk.message.content);
                    }
                    if (chunk.done) {
                        totalDuration = chunk.total_duration ?? 0;
                        evalCount = chunk.eval_count ?? 0;
                        evalDuration = chunk.eval_duration ?? 0;
                    }
                }
                catch {
                    // Ignore trailing malformed data
                }
            }
        }
        catch (error) {
            callbacks.onError?.(error);
            throw error;
        }
        // Append tool calls information to content if any
        let finalContent = fullContent;
        if (toolCalls.length > 0 && !fullContent) {
            finalContent = JSON.stringify(toolCalls.map(tc => ({
                name: tc.function.name,
                arguments: tc.function.arguments,
            })));
        }
        const result = {
            content: finalContent,
            model,
            totalDuration,
            evalCount,
            evalDuration,
        };
        callbacks.onComplete?.(result);
        return result;
    }
    /**
     * Normalize a non-streaming Ollama /api/chat response.
     */
    normalizeOllamaResponse(data, callbacks) {
        let content = data.message?.content ?? '';
        // If there are tool calls and no text content, serialize the tool calls
        if (data.message?.tool_calls && data.message.tool_calls.length > 0 && !content) {
            content = JSON.stringify(data.message.tool_calls.map((tc) => ({
                name: tc.function.name,
                arguments: tc.function.arguments,
            })));
        }
        const result = {
            content,
            model: data.model,
            totalDuration: data.total_duration ?? 0,
            evalCount: data.eval_count ?? 0,
            evalDuration: data.eval_duration ?? 0,
        };
        callbacks?.onComplete?.(result);
        return result;
    }
    // ==============================================================
    // OpenAI-Compatible Chat
    // ==============================================================
    async chatOpenAICompatible(model, messages, options, shouldStream, callbacks) {
        const openaiMessages = messages.map(m => {
            const msg = {
                role: m.role,
                content: m.content,
            };
            if (m.toolCalls) {
                msg.tool_calls = m.toolCalls;
            }
            if (m.toolCallId) {
                msg.tool_call_id = m.toolCallId;
            }
            return msg;
        });
        const body = {
            model,
            messages: openaiMessages,
            stream: shouldStream,
            temperature: options?.temperature ?? this.config.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? this.config.maxTokens,
        };
        // Add tools in OpenAI format
        if (options?.tools && options.tools.length > 0) {
            body.tools = options.tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }));
        }
        let lastError = null;
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            if (attempt > 0) {
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await this.sleep(waitTime);
            }
            try {
                if (shouldStream && callbacks) {
                    return await this.streamOpenAIChat(body, callbacks);
                }
                return await this.nonStreamOpenAIChat(body, callbacks);
            }
            catch (error) {
                lastError = error;
                if (!this.isRetryable(error))
                    break;
            }
        }
        throw lastError ?? new OllamaProviderError('Max retries exceeded');
    }
    /**
     * Stream an OpenAI-compatible /v1/chat/completions response (SSE).
     */
    async streamOpenAIChat(body, callbacks) {
        const response = await this.fetch(`${this.config.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new OllamaProviderError(`OpenAI-compatible chat error (${response.status}): ${text}`, response.status, text);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new OllamaProviderError('No response body for streaming');
        const decoder = new TextDecoder();
        let fullContent = '';
        let model = '';
        const toolCalls = new Map();
        let buffer = '';
        const startTime = Date.now();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // SSE format: lines starting with "data: "
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: '))
                        continue;
                    const data = trimmed.slice(6); // strip "data: "
                    if (data === '[DONE]')
                        continue;
                    try {
                        const parsed = JSON.parse(data);
                        model = parsed.model || model;
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta)
                            continue;
                        if (delta.content) {
                            fullContent += delta.content;
                            callbacks.onToken?.(delta.content);
                        }
                        // Handle tool calls in streaming
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const existing = toolCalls.get(tc.index);
                                if (existing) {
                                    if (tc.function?.arguments) {
                                        existing.function.arguments += tc.function.arguments;
                                    }
                                }
                                else {
                                    const toolCall = {
                                        id: tc.id || `tc_${tc.index}`,
                                        type: 'function',
                                        function: {
                                            name: tc.function?.name || '',
                                            arguments: tc.function?.arguments || '',
                                        },
                                    };
                                    toolCalls.set(tc.index, toolCall);
                                }
                            }
                        }
                        // Check for tool_calls finish
                        if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
                            for (const tc of Array.from(toolCalls.values())) {
                                callbacks.onToolCall?.(tc);
                            }
                        }
                    }
                    catch {
                        // Skip malformed SSE data
                    }
                }
            }
        }
        catch (error) {
            callbacks.onError?.(error);
            throw error;
        }
        // Notify tool calls
        if (toolCalls.size > 0) {
            for (const tc of Array.from(toolCalls.values())) {
                callbacks.onToolCall?.(tc);
            }
        }
        const elapsed = Date.now() - startTime;
        const result = {
            content: fullContent,
            model,
            totalDuration: elapsed * 1_000_000, // convert ms to ns for consistency
            evalCount: this.estimateTokens(fullContent),
            evalDuration: elapsed * 1_000_000,
        };
        callbacks.onComplete?.(result);
        return result;
    }
    /**
     * Non-streaming OpenAI-compatible /v1/chat/completions response.
     */
    async nonStreamOpenAIChat(body, callbacks) {
        const response = await this.fetch(`${this.config.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, stream: false }),
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new OllamaProviderError(`OpenAI-compatible chat error (${response.status}): ${text}`, response.status, text);
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content ?? '';
        const model = data.model ?? '';
        const result = {
            content,
            model,
            totalDuration: (data.usage?.total_tokens ?? 0) * 50_000_000, // rough ns estimate
            evalCount: data.usage?.completion_tokens ?? this.estimateTokens(content),
            evalDuration: (data.usage?.completion_tokens ?? 0) * 50_000_000,
        };
        callbacks?.onComplete?.(result);
        return result;
    }
    // ==============================================================
    // Model Listing
    // ==============================================================
    async listModelsOllama() {
        const data = await this.request('/api/tags', 'GET');
        return data.models ?? [];
    }
    async listModelsOpenAICompatible() {
        const response = await this.fetch(`${this.config.baseUrl}/v1/models`, {
            method: 'GET',
            signal: AbortSignal.timeout(this.config.timeout),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new OllamaProviderError(`Failed to list models (${response.status}): ${text}`, response.status, text);
        }
        const data = await response.json();
        const models = (data.data ?? []).map((m) => ({
            name: m.id ?? m.name,
            size: 0,
            modified_at: m.created ? new Date(m.created * 1000).toISOString() : new Date().toISOString(),
            details: {
                format: 'unknown',
                family: 'unknown',
                parameter_size: 'unknown',
                quantization_level: 'unknown',
            },
        }));
        return models;
    }
    // ==============================================================
    // Mode Detection
    // ==============================================================
    /**
     * Detect whether the configured endpoint is native Ollama or an
     * OpenAI-compatible server (LM Studio, etc.).
     *
     * Strategy: try the Ollama-specific GET /api/version endpoint. If it
     * responds with a JSON object containing a "version" field, we treat
     * it as native Ollama. Otherwise, fall back to OpenAI-compatible mode.
     */
    async detectMode() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${this.config.baseUrl}/api/version`, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (response.ok) {
                const data = await response.json();
                if (data && typeof data.version === 'string') {
                    this.mode = 'ollama';
                    return;
                }
            }
            this.mode = 'openai-compatible';
        }
        catch {
            this.mode = 'openai-compatible';
        }
    }
    /**
     * Get the current provider mode.
     */
    getMode() {
        return this.mode;
    }
    // ==============================================================
    // HTTP Helpers
    // ==============================================================
    /**
     * Fetch wrapper with timeout and error handling.
     */
    async fetch(url, init) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        // Merge abort signals
        const externalSignal = init?.signal;
        if (externalSignal) {
            externalSignal.addEventListener('abort', () => controller.abort());
        }
        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
            });
            return response;
        }
        catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new OllamaTimeoutError(this.config.timeout);
            }
            throw new OllamaConnectionError(this.config.baseUrl, error);
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    /**
     * Typed request helper for non-streaming JSON endpoints.
     */
    async request(path, method, body) {
        let lastError = null;
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            if (attempt > 0) {
                const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                await this.sleep(waitTime);
            }
            try {
                const init = {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(this.config.timeout),
                };
                if (body !== undefined) {
                    init.body = JSON.stringify(body);
                }
                const response = await this.fetch(`${this.config.baseUrl}${path}`, init);
                if (!response.ok) {
                    const text = await response.text();
                    throw new OllamaProviderError(`Ollama API error (${response.status}): ${text}`, response.status, text);
                }
                return await response.json();
            }
            catch (error) {
                lastError = error;
                if (!this.isRetryable(error))
                    break;
            }
        }
        throw lastError ?? new OllamaProviderError('Max retries exceeded');
    }
    // ==============================================================
    // Message / Tool Conversion
    // ==============================================================
    convertMessages(messages) {
        return messages.map(m => {
            const msg = {
                role: m.role,
                content: m.content,
            };
            // Convert tool calls to Ollama format
            if (m.toolCalls && m.toolCalls.length > 0) {
                msg.tool_calls = m.toolCalls.map((tc) => {
                    let args;
                    if (typeof tc.function?.arguments === 'string') {
                        try {
                            args = JSON.parse(tc.function.arguments);
                        }
                        catch {
                            args = { raw: tc.function.arguments };
                        }
                    }
                    else if (tc.function?.arguments) {
                        args = tc.function.arguments;
                    }
                    else {
                        args = {};
                    }
                    return {
                        function: {
                            name: tc.function?.name ?? '',
                            arguments: args,
                        },
                    };
                });
            }
            // Tool result reference
            if (m.toolCallId) {
                msg.tool_call_id = m.toolCallId;
            }
            return msg;
        });
    }
    convertTools(tools) {
        return tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
    }
    // ==============================================================
    // Utility
    // ==============================================================
    isRetryable(error) {
        if (error instanceof OllamaProviderError) {
            // Retry on server errors and rate limits
            return (error.statusCode === 429 ||
                (error.statusCode !== undefined && error.statusCode >= 500));
        }
        if (error instanceof OllamaTimeoutError)
            return true;
        if (error instanceof OllamaConnectionError)
            return true;
        // Network-level errors are retryable
        if (error instanceof TypeError && error.message.includes('fetch'))
            return true;
        return false;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=ollama.js.map
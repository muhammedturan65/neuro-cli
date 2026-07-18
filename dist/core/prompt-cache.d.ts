export interface CacheEntry {
    key: string;
    model: string;
    promptHash: string;
    response: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
    ttlMs: number;
}
export interface CacheStats {
    totalEntries: number;
    totalSizeBytes: number;
    hits: number;
    misses: number;
    hitRate: number;
    totalSavings: number;
    evictions: number;
}
export interface CacheBreakdown {
    byModel: Record<string, {
        entries: number;
        hits: number;
        savings: number;
    }>;
    totalSavings: number;
    totalHits: number;
    totalMisses: number;
}
export interface CacheExportFormat {
    version: number;
    exportedAt: number;
    entries: CacheEntry[];
}
export declare class PromptCache {
    private cacheDir;
    private maxEntries;
    private ttlMs;
    private similarityThreshold;
    private enabled;
    /** In-memory index mapping cache key to lightweight metadata. */
    private index;
    /** Runtime statistics -- not persisted beyond the process lifetime. */
    private stats;
    constructor(config: {
        cacheDir?: string;
        maxEntries?: number;
        ttlMs?: number;
        similarityThreshold?: number;
        enabled?: boolean;
    });
    /**
     * Look up a cached response for the given model + messages.
     * Performs an exact-key lookup first, then falls back to
     * similarity-based matching across entries for the same model.
     */
    get(model: string, messages: Array<{
        role: string;
        content: string;
    }>): CacheEntry | null;
    /**
     * Store a response in the cache.
     */
    set(model: string, messages: Array<{
        role: string;
        content: string;
    }>, response: string, usage: {
        inputTokens: number;
        outputTokens: number;
        cost: number;
    }): void;
    /**
     * Remove a specific cache entry by key.
     */
    invalidate(key: string): boolean;
    /**
     * Remove all cache entries and reset statistics.
     */
    clear(): void;
    /**
     * Return aggregate cache statistics.
     */
    getStats(): CacheStats;
    /**
     * Return a cost breakdown grouped by model (for the /cost command).
     */
    getBreakdown(): CacheBreakdown;
    /**
     * Pre-populate the cache with common prompts.
     * Returns the number of entries successfully warmed.
     */
    warmup(entries: Array<{
        model: string;
        messages: Array<{
            role: string;
            content: string;
        }>;
        response: string;
    }>): Promise<number>;
    /**
     * Export all non-expired cache entries to a portable format.
     */
    exportEntries(): CacheExportFormat;
    /**
     * Import cache entries from a previously exported format.
     * Returns the number of entries imported.
     */
    importEntries(data: CacheExportFormat): number;
    /**
     * Print a human-readable stats summary to stdout.
     */
    printStats(): void;
    private hashContent;
    private messagesKey;
    private serializeMessages;
    private isExpired;
    private evictIfNeeded;
    /**
     * Search for a non-expired entry for the same model whose prompt is
     * similar enough to the provided text (Jaccard similarity on trigrams).
     */
    private findSimilar;
    private ensureCacheDir;
    private loadIndex;
    private saveIndex;
    private entryFilePath;
    /**
     * Persist a StoredEntry (with _promptText) to its individual JSON file.
     */
    private persistStoredEntry;
    /**
     * Load a StoredEntry from disk. Returns null if the file is missing or corrupt.
     */
    private loadStoredEntry;
    /**
     * Remove an entry (index metadata + file on disk).
     */
    private removeEntry;
    /**
     * Update the in-memory index metadata for a given entry.
     */
    private updateIndexMeta;
    /**
     * Strip the internal _promptText field to return the public CacheEntry shape.
     */
    private toPublicEntry;
    /**
     * Rough token estimate based on the ~4 chars per token heuristic.
     * Used for warmup entries that lack actual token counts.
     */
    private estimateTokens;
}
export declare const DEFAULT_PROMPT_CACHE_CONFIG: {
    cacheDir: string;
    maxEntries: number;
    ttlMs: number;
    similarityThreshold: number;
    enabled: boolean;
};
//# sourceMappingURL=prompt-cache.d.ts.map
// ============================================================
// NeuroCLI - Prompt Cache System
// Hash-based response caching with TTL, LRU eviction,
// similarity matching, and cost tracking
// ============================================================

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

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
  totalSavings: number; // USD saved
  evictions: number;
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Lightweight metadata kept in the index file. The full entry lives on disk. */
interface CacheEntryMeta {
  key: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  ttlMs: number;
  sizeBytes: number;
}

interface CacheIndex {
  version: number;
  entries: Record<string, CacheEntryMeta>;
}

export interface CacheBreakdown {
  byModel: Record<string, { entries: number; hits: number; savings: number }>;
  totalSavings: number;
  totalHits: number;
  totalMisses: number;
}

export interface CacheExportFormat {
  version: number;
  exportedAt: number;
  entries: CacheEntry[];
}

/**
 * The full payload stored on disk for each entry.
 * Extends CacheEntry with a private prompt text field used for
 * similarity-based cache lookups. This field is not exposed in the
 * public CacheEntry interface.
 */
interface StoredEntry extends CacheEntry {
  _promptText: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_DIR = join(homedir(), '.neuro', 'cache');
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 3_600_000; // 1 hour
const DEFAULT_SIMILARITY_THRESHOLD = 0.92;
const INDEX_FILENAME = 'cache-index.json';
const INDEX_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the trigram set from a normalised string.
 * Used for Jaccard-similarity comparisons between prompts.
 */
function trigrams(text: string): Set<string> {
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const padded = `  ${normalised} `;
  const result = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Jaccard similarity between two strings based on trigram overlap.
 * Returns a value in [0, 1].
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// PromptCache
// ---------------------------------------------------------------------------

export class PromptCache {
  private cacheDir: string;
  private maxEntries: number;
  private ttlMs: number;
  private similarityThreshold: number;
  private enabled: boolean;

  /** In-memory index mapping cache key to lightweight metadata. */
  private index: CacheIndex;

  /** Runtime statistics -- not persisted beyond the process lifetime. */
  private stats: { hits: number; misses: number; evictions: number };

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  constructor(config: {
    cacheDir?: string;
    maxEntries?: number;
    ttlMs?: number;
    similarityThreshold?: number;
    enabled?: boolean;
  }) {
    this.cacheDir = config.cacheDir ?? DEFAULT_CACHE_DIR;
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.similarityThreshold = config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    this.enabled = config.enabled ?? true;

    this.index = { version: INDEX_VERSION, entries: {} };
    this.stats = { hits: 0, misses: 0, evictions: 0 };

    this.loadIndex();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Look up a cached response for the given model + messages.
   * Performs an exact-key lookup first, then falls back to
   * similarity-based matching across entries for the same model.
   */
  get(model: string, messages: Array<{ role: string; content: string }>): CacheEntry | null {
    if (!this.enabled) return null;

    const key = this.messagesKey(model, messages);

    // 1. Exact match
    const exactEntry = this.loadStoredEntry(key);
    if (exactEntry !== null && !this.isExpired(exactEntry)) {
      exactEntry.lastAccessedAt = Date.now();
      exactEntry.accessCount += 1;
      this.persistStoredEntry(exactEntry);
      this.updateIndexMeta(exactEntry);
      this.saveIndex();
      this.stats.hits++;
      // Return the public CacheEntry subset (strip _promptText)
      return this.toPublicEntry(exactEntry);
    }

    // If the exact key exists but is expired, remove it
    if (exactEntry !== null && this.isExpired(exactEntry)) {
      this.removeEntry(key);
    }

    // 2. Similarity-based match (only within the same model)
    const promptText = this.serializeMessages(messages);
    const similarEntry = this.findSimilar(model, promptText);
    if (similarEntry !== null) {
      similarEntry.lastAccessedAt = Date.now();
      similarEntry.accessCount += 1;
      this.persistStoredEntry(similarEntry);
      this.updateIndexMeta(similarEntry);
      this.saveIndex();
      this.stats.hits++;
      return this.toPublicEntry(similarEntry);
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store a response in the cache.
   */
  set(
    model: string,
    messages: Array<{ role: string; content: string }>,
    response: string,
    usage: { inputTokens: number; outputTokens: number; cost: number },
  ): void {
    if (!this.enabled) return;

    const key = this.messagesKey(model, messages);
    const promptText = this.serializeMessages(messages);
    const promptHash = this.hashContent(promptText);
    const now = Date.now();

    const entry: StoredEntry = {
      key,
      model,
      promptHash,
      response,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: usage.cost,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      ttlMs: this.ttlMs,
      _promptText: promptText,
    };

    this.evictIfNeeded();
    this.persistStoredEntry(entry);
    this.updateIndexMeta(entry);
    this.saveIndex();
  }

  /**
   * Remove a specific cache entry by key.
   */
  invalidate(key: string): boolean {
    if (!this.index.entries[key]) return false;
    this.removeEntry(key);
    this.saveIndex();
    return true;
  }

  /**
   * Remove all cache entries and reset statistics.
   */
  clear(): void {
    for (const key of Object.keys(this.index.entries)) {
      this.removeEntry(key);
    }
    this.index = { version: INDEX_VERSION, entries: {} };
    this.stats = { hits: 0, misses: 0, evictions: 0 };
    this.saveIndex();
  }

  /**
   * Return aggregate cache statistics.
   */
  getStats(): CacheStats {
    const entries = Object.values(this.index.entries);
    const totalSizeBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);

    // Total savings: sum of cost for every hit beyond the initial write.
    // The first access is the write; subsequent accesses are cache hits.
    let totalSavings = 0;
    for (const e of entries) {
      const cachedHits = Math.max(0, e.accessCount - 1);
      totalSavings += e.cost * cachedHits;
    }

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      totalEntries: entries.length,
      totalSizeBytes,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      totalSavings,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Return a cost breakdown grouped by model (for the /cost command).
   */
  getBreakdown(): CacheBreakdown {
    const byModel: CacheBreakdown['byModel'] = {};

    for (const meta of Object.values(this.index.entries)) {
      if (!byModel[meta.model]) {
        byModel[meta.model] = { entries: 0, hits: 0, savings: 0 };
      }
      const bucket = byModel[meta.model];
      bucket.entries += 1;
      const cachedHits = Math.max(0, meta.accessCount - 1);
      bucket.hits += cachedHits;
      bucket.savings += meta.cost * cachedHits;
    }

    const totalSavings = Object.values(byModel).reduce((s, b) => s + b.savings, 0);
    const totalHits = Object.values(byModel).reduce((s, b) => s + b.hits, 0);

    return {
      byModel,
      totalSavings,
      totalHits,
      totalMisses: this.stats.misses,
    };
  }

  /**
   * Pre-populate the cache with common prompts.
   * Returns the number of entries successfully warmed.
   */
  async warmup(
    entries: Array<{
      model: string;
      messages: Array<{ role: string; content: string }>;
      response: string;
    }>,
  ): Promise<number> {
    if (!this.enabled) return 0;

    let count = 0;
    for (const entry of entries) {
      try {
        const key = this.messagesKey(entry.model, entry.messages);

        // Skip if already cached and not expired
        if (this.index.entries[key]) {
          const existing = this.loadStoredEntry(key);
          if (existing !== null && !this.isExpired(existing)) continue;
        }

        // Estimate tokens heuristically for warmup entries
        const inputTokens = this.estimateTokens(this.serializeMessages(entry.messages));
        const outputTokens = this.estimateTokens(entry.response);

        this.set(entry.model, entry.messages, entry.response, {
          inputTokens,
          outputTokens,
          cost: 0, // warmup entries have no actual API cost
        });
        count++;
      } catch {
        // Silently skip entries that fail during warmup
      }
    }
    return count;
  }

  /**
   * Export all non-expired cache entries to a portable format.
   */
  exportEntries(): CacheExportFormat {
    const entries: CacheEntry[] = [];
    for (const key of Object.keys(this.index.entries)) {
      const entry = this.loadStoredEntry(key);
      if (entry !== null && !this.isExpired(entry)) {
        entries.push(this.toPublicEntry(entry));
      }
    }

    return {
      version: INDEX_VERSION,
      exportedAt: Date.now(),
      entries,
    };
  }

  /**
   * Import cache entries from a previously exported format.
   * Returns the number of entries imported.
   */
  importEntries(data: CacheExportFormat): number {
    if (!data.version || !Array.isArray(data.entries)) {
      throw new Error('Invalid cache export format');
    }

    let imported = 0;
    for (const entry of data.entries) {
      // Validate required fields
      if (!entry.key || !entry.model || !entry.promptHash || !entry.response) {
        continue;
      }

      // Skip if already present and not expired
      if (this.index.entries[entry.key]) {
        const existing = this.loadStoredEntry(entry.key);
        if (existing !== null && !this.isExpired(existing)) continue;
      }

      // Reset access count on import -- this is a fresh import
      const stored: StoredEntry = {
        ...entry,
        accessCount: 0,
        lastAccessedAt: Date.now(),
        _promptText: entry.promptHash, // Best-effort: no original text available
      };

      this.evictIfNeeded();
      this.persistStoredEntry(stored);
      this.updateIndexMeta(stored);
      imported++;
    }

    if (imported > 0) {
      this.saveIndex();
    }
    return imported;
  }

  /**
   * Print a human-readable stats summary to stdout.
   */
  printStats(): void {
    const stats = this.getStats();
    const breakdown = this.getBreakdown();

    const lines: string[] = [
      '--- Prompt Cache Statistics ---',
      `  Status     : ${this.enabled ? 'ENABLED' : 'DISABLED'}`,
      `  Directory  : ${this.cacheDir}`,
      `  Entries    : ${stats.totalEntries} / ${this.maxEntries}`,
      `  Disk usage : ${formatBytes(stats.totalSizeBytes)}`,
      `  TTL        : ${(this.ttlMs / 1000 / 60).toFixed(0)} min`,
      `  Similarity : ${(this.similarityThreshold * 100).toFixed(0)}%`,
      '',
      '--- Performance ---',
      `  Hits       : ${stats.hits}`,
      `  Misses     : ${stats.misses}`,
      `  Hit rate   : ${(stats.hitRate * 100).toFixed(1)}%`,
      `  Evictions  : ${stats.evictions}`,
      '',
      '--- Cost Savings ---',
      `  Total saved: ${formatUsd(stats.totalSavings)}`,
    ];

    const modelKeys = Object.keys(breakdown.byModel);
    if (modelKeys.length > 0) {
      lines.push('');
      lines.push('--- Per-Model Breakdown ---');
      for (const model of modelKeys) {
        const info = breakdown.byModel[model];
        lines.push(
          `  ${model}: ${info.entries} entries, ${info.hits} cache hits, ${formatUsd(info.savings)} saved`,
        );
      }
    }

    lines.push('-------------------------------');
    console.log(lines.join('\n'));
  }

  // -----------------------------------------------------------------------
  // Private -- hashing
  // -----------------------------------------------------------------------

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private messagesKey(
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): string {
    const raw = `${model}::${this.serializeMessages(messages)}`;
    return this.hashContent(raw);
  }

  private serializeMessages(messages: Array<{ role: string; content: string }>): string {
    return messages.map((m) => `${m.role}:${m.content}`).join('|');
  }

  // -----------------------------------------------------------------------
  // Private -- expiration & eviction
  // -----------------------------------------------------------------------

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt > entry.ttlMs;
  }

  private evictIfNeeded(): void {
    const currentCount = Object.keys(this.index.entries).length;
    if (currentCount < this.maxEntries) return;

    // Find the entry with the oldest lastAccessedAt (LRU)
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, meta] of Object.entries(this.index.entries)) {
      if (meta.lastAccessedAt < oldestTime) {
        oldestTime = meta.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.removeEntry(oldestKey);
      this.stats.evictions++;
    }
  }

  // -----------------------------------------------------------------------
  // Private -- similarity search
  // -----------------------------------------------------------------------

  /**
   * Search for a non-expired entry for the same model whose prompt is
   * similar enough to the provided text (Jaccard similarity on trigrams).
   */
  private findSimilar(model: string, promptText: string): StoredEntry | null {
    const candidates: Array<{ entry: StoredEntry; similarity: number }> = [];

    for (const key of Object.keys(this.index.entries)) {
      const meta = this.index.entries[key];
      if (meta.model !== model) continue;

      const entry = this.loadStoredEntry(key);
      if (entry === null) continue;

      if (this.isExpired(entry)) {
        // Clean up expired entry discovered during scan
        this.removeEntry(key);
        continue;
      }

      // Compute similarity against the stored prompt text
      const referenceText = entry._promptText;
      const similarity = jaccardSimilarity(promptText, referenceText);

      if (similarity >= this.similarityThreshold) {
        candidates.push({ entry, similarity });
      }
    }

    if (candidates.length === 0) return null;

    // Return the most similar candidate
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates[0].entry;
  }

  // -----------------------------------------------------------------------
  // Private -- persistence
  // -----------------------------------------------------------------------

  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    const indexPath = join(this.cacheDir, INDEX_FILENAME);
    if (!existsSync(indexPath)) {
      this.index = { version: INDEX_VERSION, entries: {} };
      return;
    }

    try {
      const raw = readFileSync(indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as CacheIndex;

      if (parsed.version !== INDEX_VERSION) {
        // Version mismatch -- start fresh
        this.index = { version: INDEX_VERSION, entries: {} };
        return;
      }

      this.index = parsed;

      // Prune expired entries on load
      const now = Date.now();
      const expiredKeys: string[] = [];
      for (const [key, meta] of Object.entries(this.index.entries)) {
        if (now - meta.createdAt > meta.ttlMs) {
          expiredKeys.push(key);
        }
      }
      for (const key of expiredKeys) {
        this.removeEntry(key);
      }
      if (expiredKeys.length > 0) {
        this.saveIndex();
      }
    } catch {
      // Corrupt index -- start fresh
      this.index = { version: INDEX_VERSION, entries: {} };
    }
  }

  private saveIndex(): void {
    this.ensureCacheDir();
    const indexPath = join(this.cacheDir, INDEX_FILENAME);
    try {
      writeFileSync(indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
    } catch (err) {
      // Log but do not throw -- cache failures should not crash the CLI
      console.error(`[prompt-cache] Failed to save index: ${String(err)}`);
    }
  }

  private entryFilePath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  /**
   * Persist a StoredEntry (with _promptText) to its individual JSON file.
   */
  private persistStoredEntry(entry: StoredEntry): void {
    this.ensureCacheDir();
    const filePath = this.entryFilePath(entry.key);

    try {
      writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[prompt-cache] Failed to persist entry ${entry.key}: ${String(err)}`);
    }
  }

  /**
   * Load a StoredEntry from disk. Returns null if the file is missing or corrupt.
   */
  private loadStoredEntry(key: string): StoredEntry | null {
    const filePath = this.entryFilePath(key);
    if (!existsSync(filePath)) return null;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Ensure _promptText exists (backward compatibility with older entries)
      if (!parsed._promptText) {
        parsed._promptText = parsed.promptHash ?? '';
      }

      return parsed as StoredEntry;
    } catch {
      return null;
    }
  }

  /**
   * Remove an entry (index metadata + file on disk).
   */
  private removeEntry(key: string): void {
    delete this.index.entries[key];

    const filePath = this.entryFilePath(key);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Best-effort deletion
    }
  }

  /**
   * Update the in-memory index metadata for a given entry.
   */
  private updateIndexMeta(entry: StoredEntry): void {
    const filePath = this.entryFilePath(entry.key);
    let sizeBytes = 0;
    try {
      if (existsSync(filePath)) {
        sizeBytes = statSync(filePath).size;
      }
    } catch {
      // Estimate based on response length if stat fails
      sizeBytes = entry.response.length * 2;
    }

    this.index.entries[entry.key] = {
      key: entry.key,
      model: entry.model,
      promptHash: entry.promptHash,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cost: entry.cost,
      createdAt: entry.createdAt,
      lastAccessedAt: entry.lastAccessedAt,
      accessCount: entry.accessCount,
      ttlMs: entry.ttlMs,
      sizeBytes,
    };
  }

  /**
   * Strip the internal _promptText field to return the public CacheEntry shape.
   */
  private toPublicEntry(stored: StoredEntry): CacheEntry {
    return {
      key: stored.key,
      model: stored.model,
      promptHash: stored.promptHash,
      response: stored.response,
      inputTokens: stored.inputTokens,
      outputTokens: stored.outputTokens,
      cost: stored.cost,
      createdAt: stored.createdAt,
      lastAccessedAt: stored.lastAccessedAt,
      accessCount: stored.accessCount,
      ttlMs: stored.ttlMs,
    };
  }

  // -----------------------------------------------------------------------
  // Private -- heuristics
  // -----------------------------------------------------------------------

  /**
   * Rough token estimate based on the ~4 chars per token heuristic.
   * Used for warmup entries that lack actual token counts.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// ---------------------------------------------------------------------------
// Default config convenience export
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPT_CACHE_CONFIG = {
  cacheDir: DEFAULT_CACHE_DIR,
  maxEntries: DEFAULT_MAX_ENTRIES,
  ttlMs: DEFAULT_TTL_MS,
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  enabled: true,
};
